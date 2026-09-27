const express = require('express');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const fs = require('fs');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

// Dynamically resolve public folder whether executed from project root or 'web dashboard' folder
const publicPath = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.resolve(__dirname, '..', 'public');
app.use(express.static(publicPath));

// Statically expose detection snapshots saved by YOLO edge node
const detectionsPath = path.resolve(__dirname, '..', 'rescue_drone', 'detections');
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
  lat: 10.0234,
  lon: 78.1234,
  heading: 42,
  signalStrength: '4G (SIM)',
  signalBars: 4,
  flightTimeSeconds: 754, // 12m 34s
  distanceFromHome: 1.2,
  flightMode: 'AUTO',
  searchPattern: 'Grid Search',
  activeSector: 'Sector B - Earthquake Zone',
  cameraSource: 'simulation', // 'simulation' or 'mobile_drone' or 'webcam'
  activeModel: 'RT-DETR-L (Trained)'
};

// Live AI Detections & Rescue Log (Clean store)
let detections = [];
let rescueLog = [];

// Waypoint search path coordinates
const searchPathWaypoints = [
  { lat: 10.0220, lon: 78.1220 },
  { lat: 10.0225, lon: 78.1228 },
  { lat: 10.0230, lon: 78.1230 },
  { lat: 10.0234, lon: 78.1234 },
  { lat: 10.0240, lon: 78.1237 },
  { lat: 10.0248, lon: 78.1233 },
  { lat: 10.0254, lon: 78.1225 },
  { lat: 10.0260, lon: 78.1235 },
  { lat: 10.0255, lon: 78.1245 }
];

// No-Fly Zone polygon coordinates
const noFlyZone = [
  { lat: 10.0252, lon: 78.1245 },
  { lat: 10.0265, lon: 78.1258 },
  { lat: 10.0250, lon: 78.1268 },
  { lat: 10.0240, lon: 78.1252 }
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
          // Fly toward waypoint smoothly (~8 m/s)
          const step = 0.00008;
          telemetry.lat += (dLat / dist) * Math.min(step, dist);
          telemetry.lon += (dLon / dist) * Math.min(step, dist);
          telemetry.heading = Math.round((Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360);
          telemetry.speed = 8.0;
        }
      }
    } else if (telemetry.cameraSource !== 'mobile_drone') {
      // Only jitter if not fed by mobile phone
      telemetry.altitude = +(120 + (Math.sin(Date.now() / 3000) * 1.5)).toFixed(1);
      telemetry.speed = +(12.5 + (Math.cos(Date.now() / 2500) * 0.4)).toFixed(1);
      telemetry.heading = Math.round((telemetry.heading + 0.3) % 360);
      telemetry.lat = +(10.0234 + Math.sin(Date.now() / 15000) * 0.0004).toFixed(4);
      telemetry.lon = +(78.1234 + Math.cos(Date.now() / 15000) * 0.0004).toFixed(4);
    }
    
    // Battery discharge
    if (Math.random() < 0.04 && telemetry.battery > 5) {
      telemetry.battery -= 1;
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

    console.log(`[AEROSIGHT] 🚀 Mission assigned with ${waypoints.length} waypoints. Autopilot engaged.`);
    return res.json({ success: true, message: `Mission assigned with ${waypoints.length} waypoints`, activeMission });
  }
  res.status(400).json({ success: false, message: 'Invalid waypoints provided' });
});

app.get('/api/detections', (req, res) => {
  res.json({ success: true, count: detections.length, data: detections });
});

// Ingest new victim or hazard detection from YOLO edge node
app.post('/api/detections', (req, res) => {
  const det = req.body;
  if (!det || (!det.id && !det.victim_id)) {
    return res.status(400).json({ success: false, message: 'Invalid detection payload' });
  }

  const detectionId = det.id || `#${det.victim_id}`;
  const formattedDetection = {
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
    time: det.time || new Date().toTimeString().split(' ')[0],
    status: det.status || 'Not Rescued',
    image: det.image || (det.image_path ? `/${det.image_path}` : '/assets/survivor_rubble_target.jpg')
  };

  // Upsert into detections array
  const existingIdx = detections.findIndex(d => d.id === detectionId);
  if (existingIdx >= 0) {
    detections[existingIdx] = { ...detections[existingIdx], ...formattedDetection };
  } else {
    detections.unshift(formattedDetection);

    // Auto-create Rescue Log entry for Person detections
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
  }

  // Broadcast to all dashboard web clients
  broadcastToDashboards(JSON.stringify({
    type: 'new_detection',
    data: formattedDetection,
    count: detections.length
  }));

  console.log(`[AEROSIGHT] Ingested AI Detection: ${formattedDetection.id} [${formattedDetection.priority}] (${formattedDetection.locationStr})`);
  res.status(201).json({ success: true, count: detections.length, data: formattedDetection });
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
  console.log('[AEROSIGHT] Purged all detection records and rescue coordinates.');
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
  res.setHeader('Content-Disposition', 'attachment; filename="aerosight_rescue_coordinates_log.csv"');
  res.send(csv);
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
  console.log(`[AEROSIGHT] Mobile IP Webcam Connected: ${ipWebcamUrl}`);
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

  console.log(`[AEROSIGHT] Streaming mobile camera frames from ${shotUrl} to Python YOLO AI Engine...`);
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
  console.log('[AEROSIGHT] Mobile IP Webcam Disconnected');
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
      console.error('[AEROSIGHT] IP Webcam proxy error:', err.message);
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
      'User-Agent': 'AeroSight-RescueDrone/2.0 (Tactical 3D Command)'
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
    console.log('[AEROSIGHT] SSL certificates loaded successfully for HTTPS camera access.');
  } catch (e) {
    console.warn('[AEROSIGHT] Warning: Could not read SSL certs:', e.message);
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
    console.warn('[AEROSIGHT] Warning: Failed to create HTTPS server:', e.message);
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
              console.log('[AEROSIGHT] Mobile Drone Transmitter Connected (WebSocket)!');
              broadcastToDashboards(JSON.stringify({
                type: 'drone_connected',
                timestamp: Date.now()
              }));
            } else if (clientRole === 'dashboard_webcam') {
              telemetry.cameraSource = 'webcam';
              console.log('[AEROSIGHT] Dashboard Local Webcam Streamer Connected!');
              broadcastToDashboards(JSON.stringify({
                type: 'drone_connected',
                timestamp: Date.now()
              }));
            } else if (clientRole === 'dashboard') {
              dashboardClients.add(ws);
              console.log('[AEROSIGHT] Dashboard client connected to live feed');
              if (droneSenderSocket && droneSenderSocket.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'drone_connected' }));
              }
            } else if (clientRole === 'ai_engine' || clientRole === 'edge_ai') {
              aiClients.add(ws);
              console.log('[AEROSIGHT] Python Edge AI Node connected to WebSocket bridge');
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
              console.log(`[AEROSIGHT] [WS] Mission assigned with ${data.waypoints.length} waypoints. Starting autonomous grid flight.`);
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
        }
      }
    } catch (err) {
      console.error('[AEROSIGHT] Error handling WS message:', err);
    }
  });

  ws.on('close', () => {
    if (ws === droneSenderSocket) {
      droneSenderSocket = null;
      telemetry.cameraSource = 'simulation';
      console.log('[AEROSIGHT] Mobile Drone Camera Disconnected');
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
  console.log(`[AEROSIGHT] Command Server running on http://localhost:${PORT}`);
  console.log(`[AEROSIGHT] 📱 Mobile Drone Camera Streams:`);
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
    console.log(`[AEROSIGHT] 🔒 Secure HTTPS Server active on port ${SSL_PORT} (Enables camera access on Android & iOS)`);
  });
  httpsServer.on('error', (err) => {
    console.warn(`[AEROSIGHT] HTTPS server warning: ${err.message}`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[AEROSIGHT] Error: Port ${PORT} is already in use by another process.`);
    console.error(`Tip: You can set a different port using: $env:PORT=3001; npm start\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
