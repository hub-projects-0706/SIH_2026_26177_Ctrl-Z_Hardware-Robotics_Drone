/**
 * =============================================================================
 * A.S.A.R.D - Autonomous Search And Rescue Drone
 * Backend Server (Node.js + Express + WebSocket)
 *
 * What this file does:
 *   - Serves the web dashboard (HTML, CSS, JS files)
 *   - Provides REST API endpoints for telemetry, detections, and commands
 *   - Uses WebSocket to push live updates to the browser in real time
 *   - Connects to the Python rescue_drone module for AI data
 *
 * Port: 3000 (default) — open http://localhost:3000 in your browser
 * =============================================================================
 */

// --- Node.js built-in modules ---
const express = require('express');  // Web server framework
const path = require('path');        // File path helper
const http = require('http');        // HTTP server
const https = require('https');      // HTTPS server (for SSL)
const os = require('os');            // Operating system info (for IP address)
const fs = require('fs');            // File system (read/write files)
const WebSocket = require('ws');     // WebSocket for real-time browser updates
const { execFile } = require('child_process'); // Run shell commands
const net = require('net');          // TCP networking for Mission Planner status testing

// --- Create the Express app and set the port ---
const app = express();
const PORT = process.env.PORT || 3000; // Use environment variable or 3000

// Allow the server to receive JSON bodies up to 10 MB (for image snapshots)
app.use(express.json({ limit: '10mb' }));

// Dynamically resolve public folder whether executed from project root or 'web dashboard' folder
const publicPath = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.resolve(__dirname, '..', 'public');
app.use(express.static(publicPath));

// Statically expose detection snapshots saved by YOLO edge node
const localDetectionsPath = path.resolve(__dirname, 'data', 'detections');
const legacyDetectionsPath = path.resolve(__dirname, '..', 'rescue_drone', 'detections');
const detectionsPath = fs.existsSync(legacyDetectionsPath) ? legacyDetectionsPath : localDetectionsPath;
if (!fs.existsSync(detectionsPath)) {
  try { fs.mkdirSync(detectionsPath, { recursive: true }); } catch (e) {}
}
app.use('/detections', express.static(detectionsPath));

// Helper to discover all local network IPv4 addresses
function getLocalNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ interface: name, address: iface.address });
      }
    }
  }
  return addresses;
}

// Mission & Telemetry State
let telemetry = {
  status: 'IN FLIGHT', // 'IN FLIGHT', 'PAUSED', 'RETURNING HOME', 'LANDED'
  battery: 78,
  altitude: 120.0,
  speed: 12.5,
  lat: 9.5456,
  lon: 78.6945,
  heading: 42,
  signalStrength: '4G LTE (SIM)',
  signalBars: 4,
  signalDbm: -68,
  latencyMs: 22,
  linkQuality: 98,
  packetLoss: 0.0,
  frequency: '868 MHz / 2.4 GHz',
  protocol: 'MAVLink v2 / AES-128 GCM',
  bitrateMbps: 14.2,
  flightTimeSeconds: 754, // 12m 34s
  distanceFromHome: 1.2,
  flightMode: 'AUTO',
  searchPattern: 'Grid Search',
  activeSector: 'Nainarkoil Search Sector (Ramanathapuram)',
  cameraSource: 'simulation', // 'simulation' or 'mobile_drone' or 'webcam'
  activeModel: 'RT-DETR-L (Trained)'
};

// Classified Disaster Scene State (Classified prior to human detection)
let currentDisaster = {
  type: 'Earthquake (Structural Collapse)',
  confidence: 94,
  severity: 'CRITICAL',
  primaryHazard: 'Structural Rubble & Void Entrapment',
  details: {
    rubble_index: 0.88,
    water_coverage: '3.4%',
    thermal_index: 0.12,
    soil_displacement: '14.0%'
  },
  detectedAt: new Date().toTimeString().split(' ')[0]
};

// Live AI Detections & Rescue Log (With Spatial Deduplication)
let detections = [
  {
    id: '#V001',
    victim_id: 'V001',
    type: 'Person',
    label: 'Person (Victim #V001)',
    confidence: 94,
    lat: 10.0234,
    lon: 78.1234,
    locationStr: '10.0234° N, 78.1234° E',
    rescueLat: 10.0234,
    rescueLon: 78.1234,
    rescueCoordsStr: '10.0234° N, 78.1234° E',
    altitude: '35 m',
    priority: 'CRITICAL',
    priority_explanation: 'OpenCV Red-Reticle AI Conf 94% | Imminent Hazard Proximity: 1.2m | High Debris Density',
    time: new Date().toTimeString().split(' ')[0],
    status: 'Not Rescued',
    disaster_type: 'Earthquake (Structural Collapse)',
    image: '/assets/victim_v001_snapshot.jpg',
    snapshot: '/assets/victim_v001_snapshot.jpg',
    bbox: [243, 153, 396, 345],
    deduplication_status: 'Single Verified Target (No Duplication)'
  }
];
let rescueLog = [
  {
    id: 1,
    targetId: '#V001',
    coords: '10.0234, 78.1234',
    status: 'Pending',
    assignedTeam: 'Rescue Team Alpha',
    eta: '6 min'
  }
];

// Two-Way Communications State (Bi-directional Ground Command <-> Drone <-> Field Responders)
let commsMessages = [
  {
    id: 'msg-1',
    sender: 'COMMAND_CENTER',
    senderName: 'NDRF Base Control',
    senderRole: 'gcs',
    text: 'A.S.A.R.D Recon Unit #01 deployed over Sector B Earthquake Zone. Two-Way Comms Link established.',
    type: 'system',
    timestamp: new Date(Date.now() - 300000).toTimeString().split(' ')[0],
    channel: 'CH-1'
  },
  {
    id: 'msg-2',
    sender: 'DRONE_01',
    senderName: 'Drone Recon Unit #01',
    senderRole: 'drone',
    text: 'Aerial camera feed synchronized. Optical AI detector scanning rubble pile at 35m altitude.',
    type: 'field',
    timestamp: new Date(Date.now() - 180000).toTimeString().split(' ')[0],
    channel: 'CH-1'
  },
  {
    id: 'msg-3',
    sender: 'COMMAND_CENTER',
    senderName: 'NDRF Base Control',
    senderRole: 'gcs',
    text: 'Acoustic Loudspeaker & Intercom active. Ready to broadcast instructions to trapped survivors.',
    type: 'broadcast',
    timestamp: new Date(Date.now() - 60000).toTimeString().split(' ')[0],
    channel: 'CH-1'
  }
];

// Waypoint search path coordinates (Nainarkoil Sector)
const searchPathWaypoints = [
  { lat: 9.5440, lon: 78.6920 },
  { lat: 9.5445, lon: 78.6928 },
  { lat: 9.5450, lon: 78.6930 },
  { lat: 9.5456, lon: 78.6945 },
  { lat: 9.5460, lon: 78.6948 },
  { lat: 9.5468, lon: 78.6953 },
  { lat: 9.5474, lon: 78.6945 },
  { lat: 9.5480, lon: 78.6955 },
  { lat: 9.5475, lon: 78.6965 }
];

// No-Fly Zone polygon coordinates (Nainarkoil Sector)
const noFlyZone = [
  { lat: 9.5472, lon: 78.6965 },
  { lat: 9.5485, lon: 78.6978 },
  { lat: 9.5470, lon: 78.6988 },
  { lat: 9.5460, lon: 78.6972 }
];

// Live Autonomous Mission State
let activeMission = {
  status: 'IDLE',
  pattern: 'Lawnmower Scan',
  waypoints: [],
  currentWpIndex: 0,
  altitude: 35
};

// Background ticker for live telemetry realism
setInterval(() => {
  if (telemetry.status === 'IN FLIGHT' || telemetry.status === 'AUTONOMOUS SCANNING') {
    telemetry.flightTimeSeconds += 1;

    // If in autonomous scanning along assigned waypoints
    if (telemetry.status === 'AUTONOMOUS SCANNING' && activeMission.waypoints.length > 0) {
      const targetWp = activeMission.waypoints[activeMission.currentWpIndex];
      if (targetWp && typeof targetWp.lat === 'number' && typeof targetWp.lon === 'number') {
        const dLat = targetWp.lat - telemetry.lat;
        const dLon = targetWp.lon - telemetry.lon;
        const dist = Math.sqrt(dLat * dLat + dLon * dLon);

        if (dist < 0.00012) {
          // Reached waypoint, advance to next
          activeMission.currentWpIndex = (activeMission.currentWpIndex + 1) % activeMission.waypoints.length;
        } else {
          // Fly toward waypoint smoothly (~10 m/s)
          const step = 0.00010;
          telemetry.lat += (dLat / dist) * Math.min(step, dist);
          telemetry.lon += (dLon / dist) * Math.min(step, dist);
          telemetry.heading = Math.round((Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360);
          telemetry.speed = 10.0;
        }
      }
    } else if (telemetry.cameraSource !== 'mobile_drone') {
      // Live coordinates over Nainarkoil
      telemetry.altitude = +(120 + (Math.sin(Date.now() / 3000) * 1.5)).toFixed(1);
      telemetry.speed = +(12.5 + (Math.cos(Date.now() / 2500) * 0.4)).toFixed(1);
      telemetry.heading = Math.round((telemetry.heading + 0.3) % 360);
      telemetry.lat = +(9.5456 + Math.sin(Date.now() / 15000) * 0.0004).toFixed(4);
      telemetry.lon = +(78.6945 + Math.cos(Date.now() / 15000) * 0.0004).toFixed(4);
    }
    
    // Battery discharge
    if (Math.random() < 0.04 && telemetry.battery > 5) {
      telemetry.battery -= 1;
    }

    // Dynamic RF Signal & Link Telemetry Realism
    if (telemetry.cameraSource === 'mobile_drone') {
      telemetry.signalStrength = '5G / Wi-Fi Mesh';
      telemetry.latencyMs = Math.round(15 + Math.sin(Date.now() / 4000) * 3);
      telemetry.signalDbm = Math.round(-63 + Math.sin(Date.now() / 7000) * 3);
      telemetry.frequency = '5.8 GHz Wi-Fi + LTE';
    } else {
      telemetry.signalStrength = '4G LTE (SIM)';
      telemetry.latencyMs = Math.round(22 + Math.sin(Date.now() / 3500) * 4);
      telemetry.signalDbm = Math.round(-68 + Math.cos(Date.now() / 5000) * 3);
      telemetry.frequency = '868 MHz ExpressLRS + 2.4 GHz';
    }
    telemetry.linkQuality = Math.min(100, Math.max(92, Math.round(100 - (Math.abs(telemetry.signalDbm + 60) * 0.7))));
    if (telemetry.signalDbm >= -75) {
      telemetry.signalBars = 4;
    } else if (telemetry.signalDbm >= -85) {
      telemetry.signalBars = 3;
    } else if (telemetry.signalDbm >= -95) {
      telemetry.signalBars = 2;
    } else {
      telemetry.signalBars = 1;
    }

    // Broadcast updated telemetry periodically
    broadcastToDashboards(JSON.stringify({
      type: 'telemetry_update',
      telemetry: telemetry
    }));
  }
}, 1000);

// API Routes
app.get('/api/network-info', (req, res) => {
  const addresses = getLocalNetworkAddresses();
  const port = server.address() ? server.address().port : PORT;
  const urls = addresses.map(a => `http://${a.address}:${port}/mobile`);
  res.json({
    port,
    addresses,
    urls,
    defaultUrl: urls.length > 0 ? urls[0] : `http://localhost:${port}/mobile`
  });
});

app.get('/api/telemetry', (req, res) => {
  res.json({
    success: true,
    data: telemetry,
    searchPath: searchPathWaypoints,
    noFlyZone: noFlyZone
  });
});

// Ingest telemetry from Python edge node or ESP32 MQTT bridge
app.post('/api/telemetry', (req, res) => {
  const data = req.body;
  if (data) {
    if (typeof data.lat === 'number') telemetry.lat = +data.lat.toFixed(4);
    if (typeof data.lon === 'number') telemetry.lon = +data.lon.toFixed(4);
    if (typeof data.alt === 'number') telemetry.altitude = +data.alt.toFixed(1);
    if (typeof data.speed === 'number') telemetry.speed = +data.speed.toFixed(1);
    if (typeof data.heading === 'number') telemetry.heading = Math.round(data.heading);
    if (typeof data.battery === 'number') telemetry.battery = Math.round(data.battery);
    if (data.status) telemetry.status = data.status;
    if (typeof data.obstacle_distance_m === 'number') telemetry.obstacleDistanceM = data.obstacle_distance_m;
    if (data.imu) telemetry.imu = data.imu;

    broadcastToDashboards(JSON.stringify({
      type: 'telemetry_update',
      telemetry: telemetry
    }));
  }
  res.json({ success: true, telemetry });
});

app.post('/api/mission/control', (req, res) => {
  const { action } = req.body;
  if (action === 'START') {
    telemetry.status = 'IN FLIGHT';
  } else if (action === 'PAUSE') {
    telemetry.status = 'PAUSED';
    telemetry.speed = 0.0;
  } else if (action === 'RETURN_HOME') {
    telemetry.status = 'RETURNING HOME';
    telemetry.speed = 18.2;
  } else if (action === 'EMERGENCY_LAND') {
    telemetry.status = 'LANDED';
    telemetry.speed = 0.0;
    telemetry.altitude = 0.0;
  }
  res.json({ success: true, status: telemetry.status, telemetry });
});

app.post('/api/mission/mode', (req, res) => {
  const { flightMode, searchPattern } = req.body;
  if (flightMode) telemetry.flightMode = flightMode;
  if (searchPattern) telemetry.searchPattern = searchPattern;
  res.json({ success: true, telemetry });
});

// Assign autonomous survey flight mission
app.post('/api/mission/assign', (req, res) => {
  const { waypoints, pattern, altitude } = req.body;
  if (waypoints && Array.isArray(waypoints) && waypoints.length > 0) {
    activeMission = {
      status: 'AUTONOMOUS SCANNING',
      pattern: pattern || 'Lawnmower Scan',
      waypoints: waypoints,
      currentWpIndex: 0,
      altitude: altitude || 35
    };
    telemetry.status = 'AUTONOMOUS SCANNING';
    telemetry.searchPattern = activeMission.pattern;
    if (altitude) telemetry.altitude = altitude;

    broadcastToDashboards(JSON.stringify({
      type: 'mission_assigned',
      mission: activeMission,
      telemetry: telemetry
    }));

    for (const aiWs of aiClients) {
      if (aiWs.readyState === WebSocket.OPEN) {
        aiWs.send(JSON.stringify({
          type: 'mission_assigned',
          mission: activeMission
        }));
      }
    }

    console.log(`[A.S.A.R.D] 🚀 Mission assigned with ${waypoints.length} waypoints. Autopilot engaged.`);
    return res.json({ success: true, message: `Mission assigned with ${waypoints.length} waypoints`, activeMission });
  }
  res.status(400).json({ success: false, message: 'Invalid waypoints provided' });
});

// Transmit Marked Mission Waypoints across Network to ArduPilot / Mission Planner via MAVLink
const handleMissionTransmission = (req, res) => {
  const { target_host, target_port, connection, waypoints } = req.body || {};
  let connStr = connection ? String(connection).trim() : null;
  const host = (target_host && String(target_host).trim()) || '172.27.172.87';
  const port = parseInt(target_port, 10) || 14550;

  if (!connStr) {
    if (host.startsWith('tcp:') || host.startsWith('udp:')) {
      connStr = host;
    } else if (port === 5762 || port === 5760 || port === 5763) {
      connStr = `tcp:${host}:${port}`;
    } else {
      connStr = `udpout:${host}:${port}`;
    }
  }

  const rawWaypoints = Array.isArray(waypoints) && waypoints.length > 0 ? waypoints : searchPathWaypoints;

  // Format waypoints with micro-degree precision and safe defaults
  const formattedWps = rawWaypoints.map((wp, idx) => ({
    id: idx + 1,
    lat: parseFloat(wp.lat || wp.latitude || 9.5456),
    lon: parseFloat(wp.lon || wp.longitude || 78.6945),
    alt: parseFloat(wp.alt || wp.altitude || 20.0),
    speed: parseFloat(wp.speed || 10.0)
  }));

  // Resolve Python runtime and MAVLink Transmitter script
  const venvPython = path.resolve(__dirname, '..', '.venv', 'Scripts', 'python.exe');
  const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python';
  const mavScript = path.resolve(__dirname, 'scripts', 'mavlink_transmitter.py');

  const dataDir = path.resolve(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
  }
  const missionJsonPath = path.resolve(dataDir, 'active_mission.json');
  try {
    fs.writeFileSync(missionJsonPath, JSON.stringify(formattedWps, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[A.S.A.R.D] Could not cache active_mission.json:', err.message);
  }

  // SAFETY: Action is 'transmit' without '--auto' flag (Strictly uploads waypoints, disarmed)
  const cliArgs = [
    mavScript,
    '--connection', connStr,
    '--waypoints', missionJsonPath,
    '--action', 'transmit'
  ];

  console.log(`[A.S.A.R.D] 🛰️ Transmitting ${formattedWps.length} waypoints via MAVLink to ArduPilot at ${connStr}...`);

  execFile(pythonPath, cliArgs, { timeout: 30000 }, (error, stdout, stderr) => {
    let result = null;
    if (stdout) {
      try {
        result = JSON.parse(stdout.trim());
      } catch (e) {
        const match = stdout.match(/\{[\s\S]*\}/);
        if (match) {
          try { result = JSON.parse(match[0]); } catch (err) {}
        }
      }
    }

    if (error || !result || result.success === false) {
      const errMsg = result?.message || result?.error || (error ? error.message : 'Mission upload failed');
      console.warn(`[A.S.A.R.D] ❌ MAVLink transmitter error: ${errMsg}`);
      if (stderr) console.warn(`[A.S.A.R.D] MAVLink stderr:\n${stderr}`);

      return res.status(502).json({
        success: false,
        message: errMsg,
        error: errMsg,
        endpoint: connStr,
        waypoints: formattedWps.length,
        target_system: result?.target_system || null,
        target_component: result?.target_component || null
      });
    }

    // Success: Cache active mission
    activeMission = {
      status: 'WAYPOINTS_UPLOADED',
      pattern: req.body?.pattern || 'MAVLink Autonomous Waypoint Mission',
      waypoints: formattedWps,
      currentWpIndex: 0,
      altitude: formattedWps[0]?.alt || 20,
      mavlink_target: result?.endpoint || connStr,
      target_system: result?.target_system || 1,
      target_component: result?.target_component || 1,
      verified: !!result?.verified,
      home: result?.home || null,
      transmitted_at: new Date().toISOString()
    };

    broadcastToDashboards(JSON.stringify({
      type: 'mission_assigned',
      mission: activeMission,
      telemetry: telemetry,
      mavlink_target: result?.endpoint || connStr
    }));

    console.log(`[A.S.A.R.D] ✅ MAVLink mission upload confirmed to ${result?.endpoint || connStr}! (sys=${result.target_system} comp=${result.target_component}, verified=${result?.verified})`);
    return res.json({
      success: true,
      message: result.message || 'Mission uploaded successfully',
      waypoints: result.waypoints || formattedWps.length,
      target_system: result.target_system,
      target_component: result.target_component,
      endpoint: result?.endpoint || connStr,
      verified: !!result?.verified,
      home: result?.home || null,
      readback_count: result?.readback_count || (formattedWps.length + 1)
    });
  });
};

app.post('/api/mavlink/transmit_mission', handleMissionTransmission);
app.post('/api/drone/transmit-route', handleMissionTransmission);

// Test connection to MAVLink endpoint / Autopilot
app.post('/api/mavlink/ping', (req, res) => {
  const { target_host, target_port, proto } = req.body || {};
  const host = (target_host && String(target_host).trim()) || '172.27.172.87';
  const port = parseInt(target_port, 10) || 14550;

  const testTcp = (h, p, timeoutMs = 1500) => new Promise(resolve => {
    const s = new net.Socket();
    let resolved = false;
    s.setTimeout(timeoutMs);
    s.on('connect', () => { resolved = true; s.destroy(); resolve(true); });
    s.on('timeout', () => { if (!resolved) { resolved = true; s.destroy(); resolve(false); } });
    s.on('error', () => { if (!resolved) { resolved = true; s.destroy(); resolve(false); } });
    s.connect(p, h);
  });

  (async () => {
    // 1. Check SITL TCP 5762 (Secondary GCS / Companion port)
    const sitl5762Open = await testTcp(host, 5762);
    if (sitl5762Open) {
      return res.json({
        connected: true,
        autopilot: true,
        endpoint: `tcp:${host}:5762`,
        message: `Connected to ArduPilot SITL Autopilot on ${host} via TCP 5762 (Vehicle 1 / Comp 1)`
      });
    }

    // 2. Check SITL TCP 5760 (Primary port)
    const sitl5760Open = await testTcp(host, 5760);
    if (sitl5760Open) {
      return res.json({
        connected: true,
        autopilot: true,
        endpoint: `tcp:${host}:5760`,
        message: `Connected to ArduPilot SITL Primary Port on ${host} via TCP 5760`
      });
    }

    // 3. If target is TCP and specific port is tested
    if (proto === 'tcp' || port === 5762 || port === 5760) {
      const portOpen = await testTcp(host, port);
      if (portOpen) {
        return res.json({
          connected: true,
          autopilot: true,
          endpoint: `tcp:${host}:${port}`,
          message: `Connected to MAVLink TCP endpoint ${host}:${port}`
        });
      }
    }

    // 4. If UDP or unreachable
    return res.json({
      connected: false,
      autopilot: false,
      endpoint: `udpout:${host}:${port}`,
      message: `No active MAVLink response on ${host}:${port}. ArduPilot SITL is not reachable on TCP 5762 or UDP ${port}. Ensure SITL is running on ${host}.`
    });
  })();
});

// Helper to execute MAVLink commands via Python bridge
const executeMavlinkAction = (action, options, callback) => {
  const host = (options.target_host && String(options.target_host).trim()) || '172.27.172.87';
  const port = parseInt(options.target_port, 10) || 14550;
  let connStr = options.connection ? String(options.connection).trim() : null;

  if (!connStr) {
    if (host.startsWith('tcp:') || host.startsWith('udp:')) {
      connStr = host;
    } else if (port === 5762 || port === 5760 || port === 5763) {
      connStr = `tcp:${host}:${port}`;
    } else {
      connStr = `udpout:${host}:${port}`;
    }
  }

  const venvPython = path.resolve(__dirname, '..', '.venv', 'Scripts', 'python.exe');
  const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python';
  const mavScript = path.resolve(__dirname, 'scripts', 'mavlink_transmitter.py');

  const cliArgs = [
    mavScript,
    '--connection', connStr,
    '--action', action
  ];

  if (action === 'arm' || action === 'takeoff') {
    cliArgs.push('--alt', String(options.altitude || 20.0));
    cliArgs.push('--speed', String(options.speed || 10.0));
  } else if (action === 'speed') {
    cliArgs.push('--speed', String(options.speed || 10.0));
  } else if (action === 'mode') {
    cliArgs.push('--mode', String(options.mode || 'LOITER'));
  } else if (action === 'execute') {
    cliArgs.push('--alt', String(options.altitude || 20.0));
    cliArgs.push('--speed', String(options.speed || 10.0));
    if (options.waypointsPath) {
      cliArgs.push('--waypoints', options.waypointsPath);
    }
  }

  console.log(`[A.S.A.R.D] ⚡ Dispatching MAVLink ${action.toUpperCase()} action to ${connStr}...`);

  execFile(pythonPath, cliArgs, { timeout: 15000 }, (error, stdout, stderr) => {
    let result = null;
    if (stdout) {
      try {
        result = JSON.parse(stdout.trim());
      } catch (e) {
        const match = stdout.match(/\{[\s\S]*\}/);
        if (match) {
          try { result = JSON.parse(match[0]); } catch (err) {}
        }
      }
    }

    if (error || !result || result.success === false) {
      const errMsg = result?.message || (error ? error.message : `MAVLink ${action} failed`);
      console.warn(`[A.S.A.R.D] ❌ MAVLink ${action} error: ${errMsg}`);
      return callback({
        success: false,
        error: errMsg,
        message: errMsg,
        endpoint: connStr
      });
    }

    return callback(result);
  });
};

// Arm Autopilot Motors & Climb to Flight Altitude (20m)
app.post('/api/mavlink/arm', (req, res) => {
  executeMavlinkAction('arm', { ...req.body, altitude: 20.0, speed: 10.0 }, (result) => {
    if (!result.success) return res.status(502).json(result);

    telemetry.isArmed = true;
    telemetry.status = 'IN FLIGHT';
    telemetry.flightMode = 'GUIDED';
    telemetry.altitude = 20.0;
    telemetry.speed = 10.0;
    broadcastToDashboards(JSON.stringify({ type: 'telemetry_update', telemetry }));

    console.log('[A.S.A.R.D] ✅ Drone Motors ARMED and TAKEOFF to 20m initiated at 10 m/s!');
    return res.json(result);
  });
});
app.post('/api/drone/arm', (req, res) => {
  executeMavlinkAction('arm', { ...req.body, altitude: 20.0, speed: 10.0 }, (result) => {
    if (!result.success) return res.status(502).json(result);
    telemetry.isArmed = true;
    telemetry.status = 'IN FLIGHT';
    telemetry.flightMode = 'GUIDED';
    telemetry.altitude = 20.0;
    telemetry.speed = 10.0;
    broadcastToDashboards(JSON.stringify({ type: 'telemetry_update', telemetry }));
    return res.json(result);
  });
});

// Disarm Autopilot Motors
app.post('/api/mavlink/disarm', (req, res) => {
  executeMavlinkAction('disarm', req.body || {}, (result) => {
    if (!result.success) return res.status(502).json(result);

    telemetry.isArmed = false;
    telemetry.status = 'STANDBY';
    broadcastToDashboards(JSON.stringify({ type: 'telemetry_update', telemetry }));

    console.log('[A.S.A.R.D] ✅ Drone Motors DISARMED.');
    return res.json(result);
  });
});
app.post('/api/drone/disarm', (req, res) => {
  executeMavlinkAction('disarm', req.body || {}, (result) => {
    if (!result.success) return res.status(502).json(result);
    telemetry.isArmed = false;
    telemetry.status = 'STANDBY';
    broadcastToDashboards(JSON.stringify({ type: 'telemetry_update', telemetry }));
    return res.json(result);
  });
});

// Guided Mode Arm & Takeoff directly via MAVLink
app.post('/api/mavlink/takeoff', (req, res) => {
  const targetAlt = parseFloat(req.body?.altitude || 20.0);
  executeMavlinkAction('takeoff', { ...req.body, altitude: targetAlt }, (result) => {
    if (!result.success) return res.status(502).json(result);

    telemetry.isArmed = true;
    telemetry.status = 'IN FLIGHT';
    telemetry.flightMode = 'GUIDED';
    telemetry.altitude = targetAlt;
    broadcastToDashboards(JSON.stringify({ type: 'telemetry_update', telemetry }));

    console.log(`[A.S.A.R.D] 🚀 Takeoff initiated to ${targetAlt}m.`);
    return res.json(result);
  });
});
app.post('/api/drone/takeoff', (req, res) => {
  const targetAlt = parseFloat(req.body?.altitude || 20.0);
  executeMavlinkAction('takeoff', { ...req.body, altitude: targetAlt }, (result) => {
    if (!result.success) return res.status(502).json(result);
    telemetry.isArmed = true;
    telemetry.status = 'IN FLIGHT';
    telemetry.altitude = targetAlt;
    broadcastToDashboards(JSON.stringify({ type: 'telemetry_update', telemetry }));
    return res.json(result);
  });
});

// Set Flight Groundspeed (MAV_CMD_DO_CHANGE_SPEED)
app.post('/api/mavlink/speed', (req, res) => {
  const targetSpeed = parseFloat(req.body?.speed || 10.0);
  executeMavlinkAction('speed', { ...req.body, speed: targetSpeed }, (result) => {
    telemetry.speed = targetSpeed;
    broadcastToDashboards(JSON.stringify({ type: 'telemetry_update', telemetry }));
    console.log(`[A.S.A.R.D] ⚡ Drone speed set to ${targetSpeed} m/s.`);
    return res.json({ success: true, speed: targetSpeed, result });
  });
});
app.post('/api/drone/speed', (req, res) => {
  const targetSpeed = parseFloat(req.body?.speed || 10.0);
  executeMavlinkAction('speed', { ...req.body, speed: targetSpeed }, (result) => {
    telemetry.speed = targetSpeed;
    broadcastToDashboards(JSON.stringify({ type: 'telemetry_update', telemetry }));
    return res.json({ success: true, speed: targetSpeed, result });
  });
});

// Full Autonomous Mission Initiation: Arm up to 20m, Speed up to 10 m/s, Navigate to Marked Coordinates
const handleInitiateMission = (req, res) => {
  const { waypoints, altitude = 20.0, speed = 10.0, connection, target_host, target_port } = req.body || {};
  const targetAlt = parseFloat(altitude || 20.0);
  const targetSpeed = parseFloat(speed || 10.0);

  let rawWaypoints = Array.isArray(waypoints) && waypoints.length > 0 ? waypoints : null;
  if (!rawWaypoints) {
    const dataDir = path.resolve(__dirname, 'data');
    const missionJsonPath = path.resolve(dataDir, 'active_mission.json');
    if (fs.existsSync(missionJsonPath)) {
      try {
        rawWaypoints = JSON.parse(fs.readFileSync(missionJsonPath, 'utf-8'));
      } catch (e) {}
    }
  }
  if (!rawWaypoints || rawWaypoints.length === 0) {
    rawWaypoints = searchPathWaypoints;
  }

  const formattedWps = rawWaypoints.map((wp, idx) => ({
    id: idx + 1,
    lat: parseFloat(wp.lat || wp.latitude || 9.5456),
    lon: parseFloat(wp.lon || wp.longitude || 78.6945),
    alt: targetAlt,
    speed: targetSpeed
  }));

  // Cache to active_mission.json
  const dataDir = path.resolve(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
  }
  const missionJsonPath = path.resolve(dataDir, 'active_mission.json');
  try {
    fs.writeFileSync(missionJsonPath, JSON.stringify(formattedWps, null, 2), 'utf-8');
  } catch (err) {}

  // Update server active mission and telemetry
  activeMission = {
    status: 'AUTONOMOUS SCANNING',
    pattern: 'Tactical Marked Route',
    waypoints: formattedWps,
    currentWpIndex: 0,
    altitude: targetAlt,
    speed: targetSpeed
  };

  telemetry.isArmed = true;
  telemetry.status = 'AUTONOMOUS SCANNING';
  telemetry.flightMode = 'AUTO';
  telemetry.altitude = targetAlt;
  telemetry.speed = targetSpeed;

  broadcastToDashboards(JSON.stringify({
    type: 'mission_assigned',
    mission: activeMission,
    telemetry: telemetry
  }));
  broadcastToDashboards(JSON.stringify({
    type: 'telemetry_update',
    telemetry: telemetry
  }));

  for (const aiWs of aiClients) {
    if (aiWs.readyState === WebSocket.OPEN) {
      aiWs.send(JSON.stringify({
        type: 'mission_assigned',
        mission: activeMission
      }));
    }
  }

  console.log(`[A.S.A.R.D] 🚀 INITIATING DRONE: Arming, climb to ${targetAlt}m, speed ${targetSpeed}m/s, navigating to ${formattedWps.length} marked coordinates!`);

  // Dispatch MAVLink bridge execution asynchronously to sitl/physical autopilot
  executeMavlinkAction('execute', {
    ...req.body,
    altitude: targetAlt,
    speed: targetSpeed,
    waypointsPath: missionJsonPath
  }, (mavResult) => {
    console.log('[A.S.A.R.D] MAVLink mission execution result:', mavResult?.message || mavResult);
  });

  return res.json({
    success: true,
    message: `Drone ARMED, climbing to ${targetAlt}m, speed set to ${targetSpeed} m/s, navigating to ${formattedWps.length} marked coordinates!`,
    armed: true,
    altitude: targetAlt,
    speed: targetSpeed,
    flightMode: 'AUTO',
    waypoints: formattedWps,
    telemetry
  });
};

app.post('/api/drone/initiate-mission', handleInitiateMission);
app.post('/api/mavlink/execute-mission', handleInitiateMission);

// Switch Flight Mode (AUTO, LOITER, RTL, LAND, GUIDED)
app.post('/api/mavlink/mode', (req, res) => {
  const mode = String(req.body?.mode || 'LOITER').toUpperCase();
  executeMavlinkAction('mode', { ...req.body, mode }, (result) => {
    if (!result.success) return res.status(502).json(result);

    telemetry.flightMode = mode;
    broadcastToDashboards(JSON.stringify({ type: 'telemetry_update', telemetry }));

    console.log(`[A.S.A.R.D] 🔄 Flight Mode switched to ${mode}.`);
    return res.json(result);
  });
});

// =============================================================================
// FastAPI Machine Learning Model Server Bridge (Port 8000)
// =============================================================================
const ML_SERVER_URL = process.env.ML_SERVER_URL || 'http://localhost:8000';

app.get('/api/ml/status', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const mlRes = await fetch(`${ML_SERVER_URL}/`, { signal: controller.signal });
    clearTimeout(timeout);
    if (mlRes.ok) {
      const data = await mlRes.json();
      return res.json({ online: true, ...data });
    }
    return res.json({ online: false, message: `FastAPI responded with ${mlRes.status}` });
  } catch (err) {
    return res.json({ online: false, message: `FastAPI server offline (${err.message})` });
  }
});

app.get('/api/ml/models', async (req, res) => {
  try {
    const mlRes = await fetch(`${ML_SERVER_URL}/models`);
    const data = await mlRes.json();
    return res.json(data);
  } catch (err) {
    return res.status(503).json({ error: 'FastAPI ML server unavailable' });
  }
});

app.post('/api/ml/load-model', async (req, res) => {
  try {
    const mlRes = await fetch(`${ML_SERVER_URL}/load-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await mlRes.json();
    return res.status(mlRes.status).json(data);
  } catch (err) {
    return res.status(503).json({ error: 'FastAPI ML server unavailable' });
  }
});

app.post('/api/ml/detect', async (req, res) => {
  try {
    const mlRes = await fetch(`${ML_SERVER_URL}/detect-base64`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await mlRes.json();

    // Broadcast detected target lock to all connected dashboard displays
    if (data && data.detections && data.detections.length > 0) {
      const firstVictim = data.detections.find(d => d.is_victim) || data.detections[0];
      broadcastToDashboards(JSON.stringify({
        type: 'target_lock',
        locked: true,
        model: data.model || 'RT-DETR-L',
        confidence: firstVictim.confidence,
        label: firstVictim.label,
        bbox: firstVictim.bbox
      }));

      // Automatically ingest human survivor into active mission roster & rescue log
      if (firstVictim.is_victim) {
        ingestDetectionRecord({
          id: firstVictim.id || '#SURVIVOR-01',
          victim_id: firstVictim.id ? firstVictim.id.replace('DET-', '') : '001',
          type: 'Person',
          label: 'Person (Survivor)',
          confidence: firstVictim.confidence,
          lat: telemetry.lat,
          lon: telemetry.lon,
          altitude: `${telemetry.altitude} m`,
          priority: 'CRITICAL',
          priority_explanation: 'RT-DETR-L AI Red-Reticle Locked | Confirmed Survivor',
          bbox: firstVictim.bbox,
          image: req.body.image
        });
      }
    }

    return res.json(data);
  } catch (err) {
    return res.status(503).json({ error: 'FastAPI ML server unavailable', message: err.message });
  }
});

// Disaster Classification Endpoints
app.get('/api/disaster/status', (req, res) => {
  res.json({ success: true, disaster: currentDisaster });
});

app.post('/api/disaster/classify', (req, res) => {
  if (req.body && req.body.type) {
    currentDisaster = {
      ...currentDisaster,
      ...req.body,
      detectedAt: new Date().toTimeString().split(' ')[0]
    };
    broadcastToDashboards(JSON.stringify({
      type: 'disaster_classified',
      disaster: currentDisaster
    }));
    console.log(`[A.S.A.R.D] 🚨 Disaster Classified: ${currentDisaster.type} (${currentDisaster.confidence}% Conf)`);
  }
  res.json({ success: true, disaster: currentDisaster });
});

app.get('/api/detections', (req, res) => {
  res.json({ success: true, count: detections.length, data: detections });
});

// Helper: Ingest detection with deduplication and broadcast
function ingestDetectionRecord(det) {
  if (!det || (!det.id && !det.victim_id)) return null;

  const detectionId = det.id || `#${det.victim_id}`;
  const targetLat = det.lat || det.latitude || telemetry.lat || 10.0234;
  const targetLon = det.lon || det.longitude || telemetry.lon || 78.1234;

  const formattedDetection = {
    id: detectionId,
    victim_id: det.victim_id || detectionId.replace('#', ''),
    type: det.type || 'Person',
    label: det.label || `Person (Victim ${det.victim_id || detectionId})`,
    confidence: typeof det.confidence === 'number' ? (det.confidence <= 1.0 ? Math.round(det.confidence * 100) : Math.round(det.confidence)) : 94,
    lat: targetLat,
    lon: targetLon,
    locationStr: det.locationStr || `${targetLat.toFixed(4)}° N, ${targetLon.toFixed(4)}° E`,
    rescueLat: det.rescueLat || targetLat,
    rescueLon: det.rescueLon || targetLon,
    rescueCoordsStr: det.rescueCoordsStr || `${(det.rescueLat || targetLat).toFixed(4)}° N, ${(det.rescueLon || targetLon).toFixed(4)}° E`,
    altitude: det.altitude ? (typeof det.altitude === 'number' ? `${det.altitude} m` : det.altitude) : `${telemetry.altitude} m`,
    priority: det.priority || 'CRITICAL',
    priority_explanation: det.priority_explanation || 'RT-DETR-L Red-Reticle AI Detected | Single Verified Target',
    time: det.time || new Date().toTimeString().split(' ')[0],
    status: det.status || 'Not Rescued',
    disaster_type: det.disaster_type || currentDisaster.type,
    image: det.image || (det.image_path ? `/${det.image_path}` : '/assets/victim_v001_snapshot.jpg'),
    snapshot: det.snapshot || det.image || (det.image_path ? `/${det.image_path}` : '/assets/victim_v001_snapshot.jpg'),
    bbox: det.bbox || null,
    deduplication_status: 'Single Verified Target (No Duplication)'
  };

  // DEDUPLICATION CONDITION: Match by exact ID or spatial proximity within ~10 meters (0.00012 deg)
  const existingIdx = detections.findIndex(d => {
    if (d.id === detectionId) return true;
    if (d.lat && d.lon && formattedDetection.lat && formattedDetection.lon) {
      const dLat = Math.abs(d.lat - formattedDetection.lat);
      const dLon = Math.abs(d.lon - formattedDetection.lon);
      return (dLat < 0.00012 && dLon < 0.00012);
    }
    return false;
  });

  if (existingIdx >= 0) {
    detections[existingIdx] = {
      ...detections[existingIdx],
      ...formattedDetection,
      id: detections[existingIdx].id,
      image: formattedDetection.image || detections[existingIdx].image,
      snapshot: formattedDetection.snapshot || formattedDetection.image || detections[existingIdx].snapshot
    };
  } else {
    detections.unshift(formattedDetection);

    if (formattedDetection.type === 'Person') {
      const rescueEntry = {
        id: rescueLog.length + 1,
        targetId: detectionId,
        coords: `${formattedDetection.rescueLat.toFixed(4)}, ${formattedDetection.rescueLon.toFixed(4)}`,
        status: 'Pending',
        assignedTeam: 'Rescue Team Alpha',
        eta: '7 min'
      };
      rescueLog.unshift(rescueEntry);
    }
    console.log(`[A.S.A.R.D] [NEW TARGET] Ingested AI Detection: ${formattedDetection.id} [${formattedDetection.priority}] (${formattedDetection.locationStr})`);
  }

  broadcastToDashboards(JSON.stringify({
    type: 'new_detection',
    data: existingIdx >= 0 ? detections[existingIdx] : formattedDetection,
    is_duplicate: existingIdx >= 0,
    count: detections.length
  }));

  return existingIdx >= 0 ? detections[existingIdx] : formattedDetection;
}

// Ingest new victim or hazard detection from OpenCV/YOLO edge node (With Deduplication)
app.post('/api/detections', (req, res) => {
  const det = req.body;
  if (!det || (!det.id && !det.victim_id)) {
    return res.status(400).json({ success: false, message: 'Invalid detection payload' });
  }

  const result = ingestDetectionRecord(det);
  const isDup = detections.some((d, idx) => idx > 0 && d.id === result.id);

  res.status(201).json({
    success: true,
    is_duplicate: isDup,
    count: detections.length,
    data: result
  });
});

// Emergency Alert ingestion
app.post('/api/alerts', (req, res) => {
  const alert = req.body;
  broadcastToDashboards(JSON.stringify({
    type: 'new_alert',
    alert: alert
  }));
  res.json({ success: true, alert });
});

app.post('/api/detections/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const item = detections.find(d => d.id === id);
  if (item) {
    item.status = status;
    return res.json({ success: true, item });
  }
  res.status(404).json({ success: false, message: 'Detection not found' });
});

// Clear all detections and rescue log
app.post('/api/detections/clear', (req, res) => {
  detections = [];
  rescueLog = [];
  const clearPayload = JSON.stringify({ type: 'clear_detections', timestamp: Date.now() });
  broadcastToDashboards(clearPayload);
  if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN) {
    try { droneSenderSocket.send(clearPayload); } catch (e) {}
  }
  for (const aiWs of aiClients) {
    if (aiWs.readyState === WebSocket.OPEN) {
      try { aiWs.send(clearPayload); } catch (e) {}
    }
  }
  console.log('[A.S.A.R.D] Purged all detection records and rescue coordinates.');
  res.json({ success: true, message: 'All detection records purged successfully.' });
});

app.get('/api/rescue-log', (req, res) => {
  res.json({ success: true, data: rescueLog });
});

app.post('/api/rescue-log', (req, res) => {
  const { targetId, coords, assignedTeam, eta } = req.body;
  const newEntry = {
    id: rescueLog.length + 1,
    targetId: targetId || '#001',
    coords: coords || '10.0235, 78.1236',
    status: 'Pending',
    assignedTeam: assignedTeam || 'Team Delta',
    eta: eta || '10 min'
  };
  rescueLog.push(newEntry);
  
  const target = detections.find(d => d.id === newEntry.targetId);
  if (target) {
    target.status = 'Rescue Dispatched';
  }
  
  res.json({ success: true, data: newEntry, fullLog: rescueLog });
});

// CSV Export route
app.get('/api/rescue-log/csv', (req, res) => {
  let csv = 'Index,TargetID,RescueCoordinates,Status,AssignedTeam,ETA\n';
  rescueLog.forEach(row => {
    csv += `"${row.id}","${row.targetId}","${row.coords}","${row.status}","${row.assignedTeam}","${row.eta}"\n`;
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="A.S.A.R.D_rescue_coordinates_log.csv"');
  res.send(csv);
});

// ==========================================================================
// TWO-WAY COMMUNICATIONS & SIGNAL DIAGNOSTICS API
// ==========================================================================
app.get('/api/comms/messages', (req, res) => {
  res.json({ success: true, count: commsMessages.length, messages: commsMessages });
});

app.post('/api/comms/message', (req, res) => {
  const { text, sender, senderName, senderRole, type, channel, audioData } = req.body;
  if (!text && !audioData) {
    return res.status(400).json({ success: false, message: 'Message text or audio required' });
  }

  const newMsg = {
    id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    sender: sender || (senderRole === 'drone' ? 'DRONE_01' : 'COMMAND_CENTER'),
    senderName: senderName || (senderRole === 'drone' ? 'Drone Recon Unit #01' : 'NDRF Base Control'),
    senderRole: senderRole || 'gcs',
    text: text || '[Voice Transmission]',
    type: type || (audioData ? 'audio' : 'dispatch'),
    audioData: audioData || null,
    channel: channel || 'CH-1',
    timestamp: new Date().toTimeString().split(' ')[0]
  };

  commsMessages.push(newMsg);
  if (commsMessages.length > 100) commsMessages.shift(); // Keep latest 100

  const payload = JSON.stringify({
    type: 'comms_message',
    message: newMsg
  });

  broadcastToDashboards(payload);
  if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN) {
    try { droneSenderSocket.send(payload); } catch (e) {}
  }

  console.log(`[A.S.A.R.D] [2-Way Comms] [${newMsg.channel}] ${newMsg.senderName}: ${newMsg.text}`);
  res.status(201).json({ success: true, message: newMsg, allMessages: commsMessages });
});

// Emergency Loudspeaker Audio Broadcast (Text-to-Speech or Voice announcement to survivors)
app.post('/api/comms/broadcast', (req, res) => {
  const { text, priority, voice, repeat } = req.body;
  if (!text) {
    return res.status(400).json({ success: false, message: 'Broadcast announcement text required' });
  }

  const broadcastMsg = {
    id: `bcast-${Date.now()}`,
    sender: 'COMMAND_CENTER',
    senderName: 'NDRF Aerial Loudspeaker',
    senderRole: 'gcs',
    text: text,
    priority: priority || 'CRITICAL',
    type: 'loudspeaker_broadcast',
    channel: 'CH-1',
    timestamp: new Date().toTimeString().split(' ')[0]
  };

  commsMessages.push(broadcastMsg);
  if (commsMessages.length > 100) commsMessages.shift();

  const bcastPayload = JSON.stringify({
    type: 'comms_broadcast',
    text: text,
    priority: priority || 'CRITICAL',
    voice: voice || 'tactical_en',
    repeat: repeat || 1,
    message: broadcastMsg,
    timestamp: Date.now()
  });

  broadcastToDashboards(bcastPayload);
  if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN) {
    try { droneSenderSocket.send(bcastPayload); } catch (e) {}
  }

  console.log(`[A.S.A.R.D] 📢 EMERGENCY LOUDSPEAKER BROADCAST TRIGGERED: "${text}"`);
  res.json({ success: true, broadcast: broadcastMsg });
});

app.post('/api/comms/clear', (req, res) => {
  commsMessages = [];
  const clearPayload = JSON.stringify({ type: 'comms_cleared', timestamp: Date.now() });
  broadcastToDashboards(clearPayload);
  if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN) {
    try { droneSenderSocket.send(clearPayload); } catch (e) {}
  }
  res.json({ success: true, message: 'Comms message log cleared' });
});

// Comprehensive RF Signal & Link Telemetry Diagnostics
app.get('/api/comms/signal', (req, res) => {
  res.json({
    success: true,
    data: {
      signalStrength: telemetry.signalStrength,
      signalBars: telemetry.signalBars,
      signalDbm: telemetry.signalDbm,
      latencyMs: telemetry.latencyMs,
      linkQuality: telemetry.linkQuality,
      packetLoss: telemetry.packetLoss,
      frequency: telemetry.frequency,
      protocol: telemetry.protocol,
      bitrateMbps: telemetry.bitrateMbps,
      snrDb: 28.4,
      fecCorrection: 'MIL-STD-188 Forward Error Correction (Active)',
      uplinkThroughput: '4.2 Mbps',
      downlinkThroughput: `${telemetry.bitrateMbps} Mbps`,
      encryption: 'AES-128 GCM Encrypted Tunnel',
      antennaDiversity: 'Dual Polarized Patch + Omni 5.8 dBi',
      hardwareBridge: telemetry.cameraSource === 'mobile_drone' ? 'Smartphone Ultra-Low Latency WebSocket Link' : 'Simulated MAVLink Avionics Relay'
    }
  });
});

// HTTP Frame Relay endpoint as fallback (supports both mobile HTTP fallback and test uploads)
app.post('/api/drone/frame', (req, res) => {
  const { data, telemetry: telem } = req.body;
  if (data) {
    const framePayload = JSON.stringify({
      type: 'video_frame',
      data: data,
      telemetry: telem
    });
    broadcastToDashboards(framePayload);
    // Forward video frame to Python Edge AI Engine for YOLO detection
    for (const aiWs of aiClients) {
      if (aiWs.readyState === WebSocket.OPEN) {
        aiWs.send(framePayload);
      }
    }
    if (telem) {
      if (typeof telem.heading === 'number') telemetry.heading = Math.round(telem.heading);
      if (typeof telem.lat === 'number' && typeof telem.lon === 'number') {
        telemetry.lat = +telem.lat.toFixed(4);
        telemetry.lon = +telem.lon.toFixed(4);
      }
    }
  }
  res.json({ success: true });
});

// ==========================================================================
// IP WEBCAM PROXY & INTEGRATION
// ==========================================================================
let ipWebcamUrl = null;
let ipWebcamBaseUrl = null;

app.post('/api/ipwebcam/connect', (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ success: false, message: 'URL is required' });

  url = url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'http://' + url;
  }

  // Extract base URL (e.g. http://192.168.1.5:8080)
  try {
    const parsed = new URL(url);
    ipWebcamBaseUrl = `${parsed.protocol}//${parsed.host}`;
    if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname === '') {
      ipWebcamUrl = `${ipWebcamBaseUrl}/video`;
    } else {
      ipWebcamUrl = url;
    }
  } catch (e) {
    ipWebcamBaseUrl = url.replace(/\/+$/, '');
    ipWebcamUrl = `${ipWebcamBaseUrl}/video`;
  }

  telemetry.cameraSource = 'ip_webcam';
  console.log(`[A.S.A.R.D] Mobile IP Webcam Connected: ${ipWebcamUrl}`);
  broadcastToDashboards(JSON.stringify({
    type: 'ipwebcam_connected',
    url: ipWebcamUrl,
    baseUrl: ipWebcamBaseUrl
  }));

  // Start direct high-speed frame grabber to stream mobile camera to Python YOLO AI
  startIpWebcamPolling(ipWebcamBaseUrl);

  res.json({
    success: true,
    message: 'IP Webcam connected',
    targetUrl: ipWebcamUrl,
    baseUrl: ipWebcamBaseUrl,
    streamUrl: '/api/ipwebcam/stream'
  });
});

let ipWebcamPollInterval = null;
function startIpWebcamPolling(baseUrl) {
  if (ipWebcamPollInterval) clearInterval(ipWebcamPollInterval);
  const shotUrl = `${baseUrl}/shot.jpg`;
  const client = shotUrl.startsWith('https') ? https : http;

  console.log(`[A.S.A.R.D] Streaming mobile camera frames from ${shotUrl} to Python YOLO AI Engine...`);
  ipWebcamPollInterval = setInterval(() => {
    if (!ipWebcamUrl) {
      clearInterval(ipWebcamPollInterval);
      ipWebcamPollInterval = null;
      return;
    }
    client.get(shotUrl, { timeout: 1500 }, (res) => {
      if (res.statusCode === 200) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const b64 = 'data:image/jpeg;base64,' + buf.toString('base64');
          const payload = JSON.stringify({
            type: 'video_frame',
            data: b64,
            source: 'mobile_ipwebcam',
            timestamp: Date.now()
          });
          // Broadcast to dashboards and forward to Python AI
          broadcastToDashboards(payload);
          for (const aiWs of aiClients) {
            if (aiWs.readyState === WebSocket.OPEN) {
              aiWs.send(payload);
            }
          }
        });
      }
    }).on('error', () => {});
  }, 90); // ~11 FPS stream
}

app.post('/api/ipwebcam/disconnect', (req, res) => {
  ipWebcamUrl = null;
  ipWebcamBaseUrl = null;
  if (ipWebcamPollInterval) {
    clearInterval(ipWebcamPollInterval);
    ipWebcamPollInterval = null;
  }
  telemetry.cameraSource = 'simulation';
  console.log('[A.S.A.R.D] Mobile IP Webcam Disconnected');
  broadcastToDashboards(JSON.stringify({ type: 'ipwebcam_disconnected' }));
  res.json({ success: true });
});

app.get('/api/ipwebcam/status', (req, res) => {
  res.json({
    connected: !!ipWebcamUrl,
    targetUrl: ipWebcamUrl,
    baseUrl: ipWebcamBaseUrl,
    streamUrl: ipWebcamUrl ? '/api/ipwebcam/stream' : null
  });
});

// Proxy MJPEG video stream from IP Webcam (prevents CORS & private network issues)
app.get('/api/ipwebcam/stream', (req, res) => {
  const target = req.query.url || ipWebcamUrl;
  if (!target) {
    return res.status(404).send('No IP Webcam stream configured.');
  }

  try {
    const client = target.startsWith('https') ? https : http;
    const proxyReq = client.get(target, { timeout: 10000 }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'multipart/x-mixed-replace; boundary=--boundarydonotcross',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Connection': 'close'
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('[A.S.A.R.D] IP Webcam proxy error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to connect to IP Webcam: ' + err.message });
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// Proxy Google Satellite Tiles (prevents CORS, adds caching, with ArcGIS fallback)
app.get('/api/satellite-tile', (req, res) => {
  const z = parseInt(req.query.z) || 18;
  const x = parseInt(req.query.x) || 93980;
  const y = parseInt(req.query.y) || 61955;
  const lyrs = req.query.lyrs || 'y'; // 'y': Hybrid, 's': Satellite, 'p': Terrain
  const serverNum = Math.abs(x + y) % 4; // mt0, mt1, mt2, mt3
  const targetUrl = `https://mt${serverNum}.google.com/vt/lyrs=${lyrs}&x=${x}&y=${y}&z=${z}`;

  https.get(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    },
    timeout: 5000
  }, (proxyRes) => {
    if (proxyRes.statusCode === 200) {
      res.set({
        'Content-Type': proxyRes.headers['content-type'] || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'Access-Control-Allow-Origin': '*'
      });
      return proxyRes.pipe(res);
    }
    // Fallback to ArcGIS World Imagery if Google returns error or rate limit
    const fallbackUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    https.get(fallbackUrl, (fbRes) => {
      if (fbRes.statusCode === 200) {
        res.set({
          'Content-Type': fbRes.headers['content-type'] || 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*'
        });
        return fbRes.pipe(res);
      }
      res.status(fbRes.statusCode || 404).send('Tile unavailable');
    }).on('error', () => {
      res.status(502).send('Tile fetch error');
    });
  }).on('error', (err) => {
    // Fallback on network error
    const fallbackUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    https.get(fallbackUrl, (fbRes) => {
      if (fbRes.statusCode === 200) {
        res.set({
          'Content-Type': fbRes.headers['content-type'] || 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*'
        });
        return fbRes.pipe(res);
      }
      res.status(502).json({ error: 'Failed to fetch satellite tile' });
    }).on('error', () => {
      res.status(502).json({ error: 'Failed to fetch tile: ' + err.message });
    });
  });
});

// Automatic User Current Location Discovery (Multi-provider)
app.get('/api/location/current', (req, res) => {
  // Query ipwho.is for high-accuracy client public IP geolocation
  https.get('https://ipwho.is/', { timeout: 4000 }, (apiRes) => {
    let raw = '';
    apiRes.on('data', chunk => raw += chunk);
    apiRes.on('end', () => {
      try {
        const data = JSON.parse(raw);
        if (data.success && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
          return res.json({
            success: true,
            lat: +data.latitude.toFixed(6),
            lon: +data.longitude.toFixed(6),
            city: data.city || '',
            region: data.region || '',
            country: data.country || '',
            ip: data.ip,
            provider: 'ipwho.is'
          });
        }
      } catch (e) {}
      fallbackIpLocation(res);
    });
  }).on('error', () => {
    fallbackIpLocation(res);
  });
});

function fallbackIpLocation(res) {
  // Secondary fallback: ip-api.com
  http.get('http://ip-api.com/json/', { timeout: 3500 }, (apiRes) => {
    let raw = '';
    apiRes.on('data', chunk => raw += chunk);
    apiRes.on('end', () => {
      try {
        const data = JSON.parse(raw);
        if (data.status === 'success' && data.lat && data.lon) {
          return res.json({
            success: true,
            lat: +data.lat.toFixed(6),
            lon: +data.lon.toFixed(6),
            city: data.city || '',
            region: data.regionName || '',
            country: data.country || '',
            ip: data.query,
            provider: 'ip-api'
          });
        }
      } catch (e) {}
      // Default to Tamil Nadu coordinates if network disconnected
      res.json({
        success: true,
        lat: 10.3656,
        lon: 77.9693,
        city: 'Local Area',
        region: 'Tamil Nadu',
        country: 'India',
        provider: 'fallback'
      });
    });
  }).on('error', () => {
    res.json({
      success: true,
      lat: 10.3656,
      lon: 77.9693,
      city: 'Local Area',
      region: 'Tamil Nadu',
      country: 'India',
      provider: 'fallback'
    });
  });
}

// Location Search / Geocoding endpoint via OpenStreetMap Nominatim
app.get('/api/location/search', (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.status(400).json({ success: false, message: 'Query required' });

  // If query is coordinates (e.g. "10.3656, 77.9693")
  const coordMatch = query.match(/^([-+]?\d{1,2}(?:\.\d+)?)[,\s]+([-+]?\d{1,3}(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return res.json({
        success: true,
        results: [{
          name: `Custom Location (${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E)`,
          lat,
          lon
        }]
      });
    }
  }

  const searchUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
  https.get(searchUrl, {
    headers: {
      'User-Agent': 'A.S.A.R.D-RescueDrone/2.0 (Tactical 3D Command)'
    },
    timeout: 5000
  }, (apiRes) => {
    let raw = '';
    apiRes.on('data', chunk => raw += chunk);
    apiRes.on('end', () => {
      try {
        const list = JSON.parse(raw);
        if (Array.isArray(list) && list.length > 0) {
          const results = list.map(item => ({
            name: item.display_name,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon)
          }));
          return res.json({ success: true, results });
        }
      } catch (e) {}
      res.json({ success: false, results: [] });
    });
  }).on('error', (err) => {
    res.status(502).json({ success: false, error: err.message, results: [] });
  });
});

// Discovery endpoint for mobile transmitter URLs and active LAN interfaces
app.get('/api/network-info', (req, res) => {
  const ips = getLocalNetworkAddresses();
  const primaryIp = ips.length > 0 ? ips[0].address : 'localhost';
  const sslPort = process.env.SSL_PORT || 3443;
  res.json({
    success: true,
    primaryIp,
    httpPort: PORT,
    sslPort: sslPort,
    httpsUrl: `https://${primaryIp}:${sslPort}/mobile`,
    httpUrl: `http://${primaryIp}:${PORT}/mobile`,
    defaultUrl: `https://${primaryIp}:${sslPort}/mobile`,
    ips: ips.map(i => ({
      name: i.interface,
      ip: i.address,
      httpUrl: `http://${i.address}:${PORT}/mobile`,
      httpsUrl: `https://${i.address}:${sslPort}/mobile`
    }))
  });
});

// Dedicated Mobile Drone Camera Routes
app.get('/mobile', (req, res) => {
  res.sendFile(path.join(publicPath, 'mobile.html'));
});
app.get('/drone-cam', (req, res) => {
  res.sendFile(path.join(publicPath, 'mobile.html'));
});

// Fallback to index.html for dashboard SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ==========================================================================
// SERVERS & WEBSOCKET SETUP (HTTP 3000 & HTTPS 3443 for Mobile Camera)
// ==========================================================================
const SSL_PORT = process.env.SSL_PORT || 3443;
const sslCertPath = path.join(__dirname, 'ssl', 'cert.pem');
const sslKeyPath = path.join(__dirname, 'ssl', 'key.pem');

let sslOptions = null;
if (fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath)) {
  try {
    sslOptions = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath)
    };
    console.log('[A.S.A.R.D] SSL certificates loaded successfully for HTTPS camera access.');
  } catch (e) {
    console.warn('[A.S.A.R.D] Warning: Could not read SSL certs:', e.message);
  }
}

// HTTP Server
const server = http.createServer(app);

// HTTPS Server (enables navigator.mediaDevices.getUserMedia on Android & iOS mobile browsers)
let httpsServer = null;
if (sslOptions) {
  try {
    httpsServer = https.createServer(sslOptions, app);
  } catch (e) {
    console.warn('[A.S.A.R.D] Warning: Failed to create HTTPS server:', e.message);
  }
}

// WebSocket Server attached to both HTTP and HTTPS via upgrade events
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

if (httpsServer) {
  httpsServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
}

let droneSenderSocket = null;
const dashboardClients = new Set();
const aiClients = new Set();

wss.on('connection', (ws) => {
  let clientRole = null;

  ws.on('message', (message, isBinary) => {
    try {
      if (!isBinary) {
        const text = message.toString();
        if (text.startsWith('{')) {
          const data = JSON.parse(text);

          if (data.type === 'register') {
            clientRole = data.role;
            if (clientRole === 'drone_sender') {
              droneSenderSocket = ws;
              telemetry.cameraSource = 'mobile_drone';
              console.log('[A.S.A.R.D] Mobile Drone Transmitter Connected (WebSocket)!');
              ws.send(JSON.stringify({ type: 'comms_history', messages: commsMessages }));
              broadcastToDashboards(JSON.stringify({
                type: 'drone_connected',
                timestamp: Date.now()
              }));
            } else if (clientRole === 'dashboard_webcam') {
              telemetry.cameraSource = 'webcam';
              console.log('[A.S.A.R.D] Dashboard Local Webcam Streamer Connected!');
              broadcastToDashboards(JSON.stringify({
                type: 'drone_connected',
                timestamp: Date.now()
              }));
            } else if (clientRole === 'dashboard') {
              dashboardClients.add(ws);
              console.log('[A.S.A.R.D] Dashboard client connected to live feed');
              ws.send(JSON.stringify({ type: 'comms_history', messages: commsMessages }));
              if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'drone_connected' }));
              }
            } else if (clientRole === 'ai_engine' || clientRole === 'edge_ai') {
              aiClients.add(ws);
              console.log('[A.S.A.R.D] Python Edge AI Node connected to WebSocket bridge');
              if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'drone_connected' }));
              }
            }
            return;
          }

          if (data.type === 'video_frame') {
            // Forward video frame to all connected dashboards
            broadcastToDashboards(text);

            // Forward video frame to Python Edge AI Engine for YOLO detection
            // CRITICAL: Do NOT echo frame back if sent by Python itself
            if (!aiClients.has(ws)) {
              for (const aiWs of aiClients) {
                if (aiWs.readyState === WebSocket.OPEN) {
                  aiWs.send(text);
                }
              }
            }

            // Update telemetry from phone sensors if present
            if (data.telemetry) {
              if (typeof data.telemetry.heading === 'number') {
                telemetry.heading = Math.round(data.telemetry.heading);
              }
              if (typeof data.telemetry.lat === 'number' && typeof data.telemetry.lon === 'number') {
                telemetry.lat = +data.telemetry.lat.toFixed(4);
                telemetry.lon = +data.telemetry.lon.toFixed(4);
              }
            }
            return;
          }

          if (data.type === 'telemetry_update') {
            if (data.telemetry) {
              if (typeof data.telemetry.lat === 'number') telemetry.lat = +data.telemetry.lat.toFixed(4);
              if (typeof data.telemetry.lon === 'number') telemetry.lon = +data.telemetry.lon.toFixed(4);
              if (typeof data.telemetry.alt === 'number') telemetry.altitude = +data.telemetry.alt.toFixed(1);
              if (typeof data.telemetry.speed === 'number') telemetry.speed = +data.telemetry.speed.toFixed(1);
              if (typeof data.telemetry.heading === 'number') telemetry.heading = Math.round(data.telemetry.heading);
              if (typeof data.telemetry.battery === 'number') telemetry.battery = Math.round(data.telemetry.battery);
              if (data.telemetry.status) telemetry.status = data.telemetry.status;
            }
            broadcastToDashboards(text);
            return;
          }

          if (data.type === 'target_lock') {
            if (data.model) telemetry.activeModel = data.model;
            // Forward real-time target locking telemetry to dashboard and mobile phone
            broadcastToDashboards(text);
            if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN) {
              droneSenderSocket.send(text);
            }
            return;
          }

          if (data.type === 'assign_mission') {
            if (data.waypoints && Array.isArray(data.waypoints)) {
              activeMission = {
                status: 'AUTONOMOUS SCANNING',
                pattern: data.pattern || 'Lawnmower Scan',
                waypoints: data.waypoints,
                currentWpIndex: 0,
                altitude: data.altitude || 35
              };
              telemetry.status = 'AUTONOMOUS SCANNING';
              telemetry.searchPattern = activeMission.pattern;

              broadcastToDashboards(JSON.stringify({
                type: 'mission_assigned',
                mission: activeMission,
                telemetry: telemetry
              }));

              for (const aiWs of aiClients) {
                if (aiWs.readyState === WebSocket.OPEN) {
                  aiWs.send(text);
                }
              }
              console.log(`[A.S.A.R.D] [WS] Mission assigned with ${data.waypoints.length} waypoints. Starting autonomous grid flight.`);
            }
            return;
          }

          if (data.type === 'clear_detections') {
            detections = [];
            rescueLog = [];
            broadcastToDashboards(text);
            if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN) {
              droneSenderSocket.send(text);
            }
            for (const aiWs of aiClients) {
              if (aiWs.readyState === WebSocket.OPEN) {
                aiWs.send(text);
              }
            }
            return;
          }

          if (data.type === 'new_detection') {
            const det = data.data;
            if (det) {
              const detectionId = det.id || `#${det.victim_id}`;
              const formatted = {
                id: detectionId,
                type: det.type || 'Person',
                label: det.label || `Person (Victim ${det.victim_id || detectionId})`,
                confidence: typeof det.confidence === 'number' ? (det.confidence <= 1.0 ? Math.round(det.confidence * 100) : Math.round(det.confidence)) : 94,
                lat: det.lat || det.latitude,
                lon: det.lon || det.longitude,
                locationStr: det.locationStr || `${(det.lat || det.latitude || 0).toFixed(4)}° N, ${(det.lon || det.longitude || 0).toFixed(4)}° E`,
                rescueLat: det.rescueLat || det.latitude || det.lat,
                rescueLon: det.rescueLon || det.longitude || det.lon,
                rescueCoordsStr: det.rescueCoordsStr || `${(det.rescueLat || det.latitude || det.lat || 0).toFixed(4)}° N, ${(det.rescueLon || det.longitude || det.lon || 0).toFixed(4)}° E`,
                altitude: det.altitude ? (typeof det.altitude === 'number' ? `${det.altitude} m` : det.altitude) : '120 m',
                priority: det.priority || 'HIGH',
                priority_explanation: det.priority_explanation || '',
                bbox: det.bbox || null,
                time: det.time || new Date().toTimeString().split(' ')[0],
                status: det.status || 'Not Rescued',
                image: det.image || (det.image_path ? `/${det.image_path}` : '/assets/survivor_rubble_target.jpg')
              };
              const existingIdx = detections.findIndex(d => d.id === detectionId);
              if (existingIdx >= 0) {
                detections[existingIdx] = { ...detections[existingIdx], ...formatted };
              } else {
                detections.unshift(formatted);
                if (formatted.type === 'Person') {
                  rescueLog.unshift({
                    id: rescueLog.length + 1,
                    targetId: detectionId,
                    coords: `${formatted.rescueLat.toFixed(4)}, ${formatted.rescueLon.toFixed(4)}`,
                    status: 'Pending',
                    assignedTeam: 'Rescue Team Alpha',
                    eta: '7 min'
                  });
                }
              }
            }
            broadcastToDashboards(text);
            if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN) {
              droneSenderSocket.send(text);
            }
            return;
          }

          if (data.type === 'new_alert') {
            broadcastToDashboards(text);
            return;
          }

          if (data.type === 'comms_message') {
            const msg = data.message || data;
            const formattedMsg = {
              id: msg.id || `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              sender: msg.sender || (ws === droneSenderSocket ? 'DRONE_01' : 'COMMAND_CENTER'),
              senderName: msg.senderName || (ws === droneSenderSocket ? 'Drone Recon Unit #01' : 'NDRF Base Control'),
              senderRole: msg.senderRole || (ws === droneSenderSocket ? 'drone' : 'gcs'),
              text: msg.text || '',
              type: msg.type || 'dispatch',
              channel: msg.channel || 'CH-1',
              timestamp: msg.timestamp || new Date().toTimeString().split(' ')[0]
            };
            commsMessages.push(formattedMsg);
            if (commsMessages.length > 100) commsMessages.shift();

            const broadcastStr = JSON.stringify({ type: 'comms_message', message: formattedMsg });
            broadcastToDashboards(broadcastStr);
            if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN && ws !== droneSenderSocket) {
              try { droneSenderSocket.send(broadcastStr); } catch (e) {}
            }
            console.log(`[A.S.A.R.D] [WS Comms] [${formattedMsg.channel}] ${formattedMsg.senderName}: ${formattedMsg.text}`);
            return;
          }

          if (data.type === 'comms_broadcast') {
            const bMsg = {
              id: `bcast-${Date.now()}`,
              sender: 'COMMAND_CENTER',
              senderName: 'NDRF Aerial Loudspeaker',
              senderRole: 'gcs',
              text: data.text || 'EMERGENCY ANNOUNCEMENT',
              priority: data.priority || 'CRITICAL',
              type: 'loudspeaker_broadcast',
              channel: data.channel || 'CH-1',
              timestamp: new Date().toTimeString().split(' ')[0]
            };
            commsMessages.push(bMsg);
            if (commsMessages.length > 100) commsMessages.shift();

            const bcastPayload = JSON.stringify({
              type: 'comms_broadcast',
              text: data.text,
              priority: data.priority || 'CRITICAL',
              voice: data.voice || 'tactical_en',
              repeat: data.repeat || 1,
              message: bMsg,
              timestamp: Date.now()
            });
            broadcastToDashboards(bcastPayload);
            if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN) {
              try { droneSenderSocket.send(bcastPayload); } catch (e) {}
            }
            return;
          }

          if (data.type === 'comms_audio') {
            const audioPayload = JSON.stringify({
              type: 'comms_audio',
              audioData: data.audioData,
              senderRole: data.senderRole || (ws === droneSenderSocket ? 'drone' : 'gcs'),
              senderName: data.senderName || (ws === droneSenderSocket ? 'Drone Recon Unit #01' : 'NDRF Base Control'),
              timestamp: Date.now()
            });
            broadcastToDashboards(audioPayload);
            if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN && ws !== droneSenderSocket) {
              try { droneSenderSocket.send(audioPayload); } catch (e) {}
            }
            return;
          }

          if (data.type === 'comms_ptt_state') {
            const pttPayload = JSON.stringify({
              type: 'comms_ptt_state',
              isTransmitting: !!data.isTransmitting,
              senderRole: data.senderRole || (ws === droneSenderSocket ? 'drone' : 'gcs'),
              senderName: data.senderName || (ws === droneSenderSocket ? 'Drone Recon Unit #01' : 'NDRF Base Control')
            });
            broadcastToDashboards(pttPayload);
            if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN && ws !== droneSenderSocket) {
              try { droneSenderSocket.send(pttPayload); } catch (e) {}
            }
            return;
          }
        }
      }
    } catch (err) {
      console.error('[A.S.A.R.D] Error handling WS message:', err);
    }
  });

  ws.on('close', () => {
    if (ws === droneSenderSocket) {
      droneSenderSocket = null;
      telemetry.cameraSource = 'simulation';
      console.log('[A.S.A.R.D] Mobile Drone Camera Disconnected');
      broadcastToDashboards(JSON.stringify({ type: 'drone_disconnected' }));
    }
    dashboardClients.delete(ws);
    aiClients.delete(ws);
  });
});

function broadcastToDashboards(msg) {
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// Start HTTP Server
server.listen(PORT, () => {
  const ips = getLocalNetworkAddresses();
  console.log(`\n================================================================`);
  console.log(`[A.S.A.R.D] Command Server running on http://localhost:${PORT}`);
  console.log(`[A.S.A.R.D] 📱 Mobile Drone Camera Streams:`);
  if (ips.length > 0) {
    ips.forEach(ip => {
      console.log(`  👉 HTTPS (Recommended for Mobile Camera): https://${ip.address}:${SSL_PORT}/mobile`);
      console.log(`  👉 HTTP:                                  http://${ip.address}:${PORT}/mobile`);
    });
  } else {
    console.log(`  👉 http://localhost:${PORT}/mobile`);
  }
  console.log(`================================================================\n`);
});

// Start HTTPS Server
if (httpsServer) {
  httpsServer.listen(SSL_PORT, () => {
    console.log(`[A.S.A.R.D] 🔒 Secure HTTPS Server active on port ${SSL_PORT} (Enables camera access on Android & iOS)`);
  });
  httpsServer.on('error', (err) => {
    console.warn(`[A.S.A.R.D] HTTPS server warning: ${err.message}`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[A.S.A.R.D] Error: Port ${PORT} is already in use by another process.`);
    console.error(`Tip: You can set a different port using: $env:PORT=3001; npm start\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
