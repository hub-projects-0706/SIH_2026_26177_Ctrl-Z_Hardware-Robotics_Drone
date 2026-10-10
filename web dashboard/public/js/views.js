/**
 * =============================================================================
 * A.S.A.R.D - Autonomous Search And Rescue Drone
 * Views Manager (views.js)
 *
 * Controls which page/view is shown (tab switching):
 *   - Dashboard (main overview)
 *   - Mission Plan (set waypoints for the drone)
 *   - Live Feed (camera wall and thermal view)
 *   - Drone Control (manual joystick override)
 * =============================================================================
 */

const ViewsManager = (function () {
  let currentView = 'dashboard';
  let plannerMap = null;
  let plannerPolyline = null;
  let plannerMarkers = [];
  let plannerAreaPolygon = null;

  let updateDroneRouteSummaryGlobal = null;

  // Default mission waypoints around disaster zone (Madurai Sector B)
  let waypoints = [
    { id: 1, lat: 10.0215, lon: 78.1210, alt: 35, speed: 8, action: 'Takeoff & Climb' },
    { id: 2, lat: 10.0255, lon: 78.1215, alt: 35, speed: 8, action: 'Survey Pass 1' },
    { id: 3, lat: 10.0258, lon: 78.1245, alt: 35, speed: 8, action: 'Turn & Re-align' },
    { id: 4, lat: 10.0218, lon: 78.1242, alt: 35, speed: 8, action: 'Survey Pass 2 (Victim Zone)' },
    { id: 5, lat: 10.0235, lon: 78.1265, alt: 30, speed: 6, action: 'Loiter & Scan' },
    { id: 6, lat: 10.0210, lon: 78.1210, alt: 15, speed: 4, action: 'Return & Land' }
  ];

  // Captured forensic snapshots
  let snapshots = [
    {
      id: 'SNAP-0941',
      title: 'Target #001 (Victim)',
      time: '11:42:15',
      coords: '10.0235° N, 78.1236° E',
      img: '/images/survivor_rubble_target.jpg',
      confidence: '96%'
    },
    {
      id: 'SNAP-0938',
      title: 'Structural Rupture B-2',
      time: '11:38:02',
      coords: '10.0248° N, 78.1252° E',
      img: '/images/aerial_rubble_rgb.jpg',
      confidence: '94%'
    },
    {
      id: 'SNAP-0932',
      title: 'Thermal Hotspot (38.6°C)',
      time: '11:31:40',
      coords: '10.0236° N, 78.1237° E',
      img: '/images/aerial_rubble_thermal.jpg',
      confidence: 'FLIR IR'
    }
  ];

  // Joystick states
  const joyState = {
    left: { x: 0, y: 0, active: false },
    right: { x: 0, y: 0, active: false }
  };

  let thermalAnimId = null;
  let motorAnimId = null;

  function init() {
    setupTabNavigation();
    setupMissionPlanner();
    setupLiveFeedWall();
    setupDroneControl();
    renderSnapshotsGallery();
  }

  // =========================================================================
  // 1. TAB ROUTING & SWITCHING
  // =========================================================================
  function setupTabNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        const targetNav = item.getAttribute('data-nav');
        if (targetNav) {
          switchView(targetNav);
        }
      });
    });

    // Handle hash route on load (e.g. when opened in a new tab via target="_blank")
    checkInitialHashRoute();
    window.addEventListener('hashchange', checkInitialHashRoute);
  }

  function checkInitialHashRoute() {
    const hash = (window.location.hash || '').replace('#', '').toLowerCase();
    if (hash) {
      if (hash === 'mission-plan' || hash === 'missionplan') switchView('mission-plan');
      else if (hash === 'live-feed' || hash === 'livefeed') switchView('live-feed');
      else if (hash === 'drone-control' || hash === 'dronecontrol') switchView('drone-control');
      else if (hash === 'two-way-comms' || hash === 'comms') switchView('two-way-comms');
      else if (hash === 'overview' || hash === 'dashboard') switchView('dashboard');
    }
  }

  function switchView(viewName) {
    // Check if it's an anchor on dashboard
    if (viewName === 'ai-detections') {
      switchView('dashboard');
      const el = document.getElementById('aiDetectionsCard') || document.querySelector('.detections-card');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (viewName === 'rescue-coord') {
      switchView('dashboard');
      const el = document.getElementById('rescueCoordCard') || document.querySelector('.rescue-log-card');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (viewName === 'reports') {
      window.showToast('NDRF Incident Report: Generating tactical summary PDF/CSV export...');
      setTimeout(() => {
        const btnExport = document.getElementById('btnExportDetections');
        if (btnExport) btnExport.click();
      }, 500);
      return;
    }
    if (viewName === 'settings') {
      window.showToast('Tactical Settings: System operating at optimal military-grade parameters.');
      return;
    }

    currentView = viewName;

    // Update nav links
    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.getAttribute('data-nav') === viewName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Hide all view panels
    const panels = ['viewDashboard', 'viewMissionPlan', 'viewLiveFeed', 'viewDroneControl', 'viewTwoWayComms'];
    panels.forEach(id => {
      const p = document.getElementById(id);
      if (p) p.style.display = 'none';
    });

    // Show selected panel
    if (viewName === 'dashboard') {
      const dash = document.getElementById('viewDashboard');
      if (dash) dash.style.display = 'flex';
      setTimeout(() => {
        if (window.MapGoogle3DManager) MapGoogle3DManager.resize();
      }, 100);
      window.showToast('Switched to: Main Tactical Command Dashboard');
    } else if (viewName === 'mission-plan') {
      const mp = document.getElementById('viewMissionPlan');
      if (mp) mp.style.display = 'flex';
      setTimeout(() => {
        if (plannerMap && window.google && google.maps) {
          google.maps.event.trigger(plannerMap, 'resize');
        } else {
          initPlannerMap();
        }
      }, 150);
      window.showToast('Switched to: Autonomous Mission Flight Planner');
    } else if (viewName === 'live-feed') {
      const lf = document.getElementById('viewLiveFeed');
      if (lf) lf.style.display = 'flex';
      startWallThermalLoop();
      syncWallVideoSource();
      window.showToast('Switched to: Reconnaissance Video Wall (Dual Sensor)');
    } else if (viewName === 'drone-control') {
      const dc = document.getElementById('viewDroneControl');
      if (dc) dc.style.display = 'flex';
      startMotorAnimation();
      syncGimbalSource();
      if (typeof updateDroneRouteSummaryGlobal === 'function') updateDroneRouteSummaryGlobal();
      window.showToast('Switched to: Fly-By-Wire Manual Drone Control');
    } else if (viewName === 'two-way-comms') {
      const tc = document.getElementById('viewTwoWayComms');
      if (tc) tc.style.display = 'flex';
      if (window.CommsManager) CommsManager.renderMessages();
      window.showToast('Switched to: Two-Way Tactical Communications & Loudspeaker Intercom');
    }
  }

  // =========================================================================
  // 2. MISSION PLANNER
  // =========================================================================
  function setupMissionPlanner() {
    const btnAuto = document.getElementById('btnAutoGenerateGrid');
    const btnClear = document.getElementById('btnClearWaypoints');
    const btnExport = document.getElementById('btnExportWaypoints');
    const btnAddManual = document.getElementById('btnAddWaypointManual');
    const btnTransmit = document.getElementById('btnTransmitMission');
    const btnMainTransmit = document.getElementById('btnMainTransmitMavlink');
    const btnTransmitMarked = document.getElementById('btnTransmitMarkedPlacesMavlink');

    const btnTakeoff = document.getElementById('btnMainMavlinkTakeoff');

    const rngAlt = document.getElementById('rngPlanAltitude');
    const rngSpacing = document.getElementById('rngPlanSpacing');
    const rngSpeed = document.getElementById('rngPlanSpeed');
    const selPattern = document.getElementById('planPatternSelect');

    const inpMavIp = document.getElementById('mavTargetIp');
    const inpMainMavIp = document.getElementById('mainMavTargetIp');
    const inpMavPort = document.getElementById('mavTargetPort');

    // Restore persisted remote ArduPilot / Mission Planner endpoint
    const savedIp = localStorage.getItem('A.S.A.R.D_mavlink_ip') || 'tcp:10.10.95.188:5762';
    const savedPort = localStorage.getItem('A.S.A.R.D_mavlink_port') || '5762';
    if (inpMavIp) inpMavIp.value = savedIp;
    if (inpMainMavIp) inpMainMavIp.value = savedIp;
    if (inpMavPort) inpMavPort.value = savedPort;

    // Bidirectional sync between Flight Planner and Main Dashboard IP inputs
    const handleIpChange = (newIp) => {
      const val = newIp.trim();
      localStorage.setItem('A.S.A.R.D_mavlink_ip', val);
      if (inpMavIp && inpMavIp.value !== val) inpMavIp.value = val;
      if (inpMainMavIp && inpMainMavIp.value !== val) inpMainMavIp.value = val;
    };
    if (inpMavIp) inpMavIp.addEventListener('input', (e) => handleIpChange(e.target.value));
    if (inpMainMavIp) inpMainMavIp.addEventListener('input', (e) => handleIpChange(e.target.value));
    if (inpMavPort) {
      inpMavPort.addEventListener('input', (e) => {
        localStorage.setItem('A.S.A.R.D_mavlink_port', e.target.value.trim());
      });
    }

    if (btnAuto) btnAuto.addEventListener('click', generateLawnmowerGrid);
    if (btnClear) btnClear.addEventListener('click', clearWaypoints);
    if (btnExport) btnExport.addEventListener('click', exportWaypointsFile);
    if (btnAddManual) btnAddManual.addEventListener('click', addManualWaypoint);

    // Primary MAVLink Transmit Triggers
    if (btnTransmit) btnTransmit.addEventListener('click', () => transmitMission());
    if (btnMainTransmit) btnMainTransmit.addEventListener('click', () => transmitMission());
    if (btnTransmitMarked) btnTransmitMarked.addEventListener('click', () => initiateDroneToMarkedCoordinates(20, 10));
    const btnInitiateMarks = document.getElementById('btnInitiateDroneMarks');
    if (btnInitiateMarks) btnInitiateMarks.addEventListener('click', () => initiateDroneToMarkedCoordinates(20, 10));
    if (btnTakeoff) btnTakeoff.addEventListener('click', () => armAndTakeoffMavlink(20));

    if (rngAlt) {
      rngAlt.addEventListener('input', (e) => {
        document.getElementById('lblPlanAltitude').textContent = `${e.target.value} m`;
        updateMissionMetrics();
      });
    }
    if (rngSpacing) {
      rngSpacing.addEventListener('input', (e) => {
        document.getElementById('lblPlanSpacing').textContent = `${e.target.value} m`;
        generateLawnmowerGrid();
      });
    }
    if (rngSpeed) {
      rngSpeed.addEventListener('input', (e) => {
        const speed = parseFloat(e.target.value);
        const kmh = (speed * 3.6).toFixed(1);
        document.getElementById('lblPlanSpeed').textContent = `${speed} m/s (${kmh} km/h)`;
        updateMissionMetrics();
      });
    }
    if (selPattern) {
      selPattern.addEventListener('change', (e) => {
        document.getElementById('planPatternName').textContent = e.target.options[e.target.selectedIndex].text;
        generateLawnmowerGrid();
      });
    }
  }

  function initPlannerMap() {
    const container = document.getElementById('missionPlannerMap');
    if (!container || plannerMap) return;

    if (!window.google || !google.maps) {
      setTimeout(initPlannerMap, 300);
      return;
    }

    plannerMap = new google.maps.Map(container, {
      center: { lat: 10.0235, lng: 78.1236 },
      zoom: 16,
      mapTypeId: 'hybrid',
      tilt: 45,
      rotateControl: true,
      tiltControl: true
    });

    const bounds = [
      { lat: 10.0210, lng: 78.1205 },
      { lat: 10.0265, lng: 78.1205 },
      { lat: 10.0265, lng: 78.1270 },
      { lat: 10.0210, lng: 78.1270 }
    ];

    plannerAreaPolygon = new google.maps.Polygon({
      paths: bounds,
      strokeColor: '#00d2ff',
      strokeOpacity: 0.85,
      strokeWeight: 2,
      fillColor: '#00d2ff',
      fillOpacity: 0.15,
      map: plannerMap
    });

    plannerMap.addListener('click', (e) => {
      const alt = parseInt(document.getElementById('rngPlanAltitude')?.value || 35);
      const speed = parseInt(document.getElementById('rngPlanSpeed')?.value || 8);
      const newWp = {
        id: waypoints.length + 1,
        lat: parseFloat(e.latLng.lat().toFixed(5)),
        lon: parseFloat(e.latLng.lng().toFixed(5)),
        alt: alt,
        speed: speed,
        action: 'Survey Waypoint'
      };
      waypoints.push(newWp);
      renderWaypointsOnMap();
      renderWaypointsTable();
      updateMissionMetrics();
      window.showToast(`Waypoint #${newWp.id} placed at ${newWp.lat}, ${newWp.lon}`);
    });

    renderWaypointsOnMap();
    renderWaypointsTable();
    updateMissionMetrics();
  }

  function renderWaypointsOnMap() {
    if (!plannerMap || !window.google || !google.maps) return;

    // Clear old markers & polyline
    plannerMarkers.forEach(m => m.setMap(null));
    plannerMarkers = [];
    if (plannerPolyline) {
      plannerPolyline.setMap(null);
      plannerPolyline = null;
    }

    const pathCoords = waypoints.map(wp => ({ lat: wp.lat, lng: wp.lon }));

    // Draw connecting tactical path
    if (pathCoords.length > 1) {
      plannerPolyline = new google.maps.Polyline({
        path: pathCoords,
        strokeColor: '#00e676',
        strokeOpacity: 0.9,
        strokeWeight: 3,
        map: plannerMap
      });
    }

    // Place numbered waypoints
    waypoints.forEach((wp, index) => {
      const isStart = index === 0;
      const isEnd = index === waypoints.length - 1;
      const color = isStart ? '#00e676' : isEnd ? '#ffaa00' : '#00d2ff';

      const marker = new google.maps.Marker({
        position: { lat: wp.lat, lng: wp.lon },
        map: plannerMap,
        draggable: true,
        label: {
          text: String(wp.id),
          color: '#040810',
          fontWeight: 'bold',
          fontSize: '12px'
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 13,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2
        },
        title: `Waypoint #${wp.id} (${wp.alt}m)`
      });

      marker.addListener('dragend', (ev) => {
        wp.lat = parseFloat(ev.latLng.lat().toFixed(5));
        wp.lon = parseFloat(ev.latLng.lng().toFixed(5));
        renderWaypointsOnMap();
        renderWaypointsTable();
        updateMissionMetrics();
      });

      plannerMarkers.push(marker);
    });
  }

  function renderWaypointsTable() {
    const tbody = document.getElementById('missionWpTableBody');
    const countEl = document.getElementById('missionWpCount');
    if (countEl) countEl.textContent = waypoints.length;
    if (!tbody) return;

    if (waypoints.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted); padding: 14px;">No waypoints defined. Click map or click "Auto-Generate Lawnmower Grid".</td></tr>`;
      return;
    }

    tbody.innerHTML = waypoints.map((wp, idx) => `
      <tr>
        <td style="font-family: var(--font-tactical); font-weight: 700; color: var(--cyan-primary);">WP #${wp.id}</td>
        <td>${wp.lat.toFixed(5)}</td>
        <td>${wp.lon.toFixed(5)}</td>
        <td><span style="color: #ffaa00;">${wp.alt}m</span></td>
        <td>${wp.speed} m/s</td>
        <td><span style="font-size: 11px; color: var(--text-secondary);">${wp.action}</span></td>
        <td>
          <button class="tactical-btn" style="padding: 2px 6px; font-size: 10px; border-color: rgba(255,59,86,0.4); color: #ff5c73;" onclick="ViewsManager.removeWaypoint(${idx})">✕</button>
        </td>
      </tr>
    `).join('');
  }

  function removeWaypoint(index) {
    if (index >= 0 && index < waypoints.length) {
      waypoints.splice(index, 1);
      // Re-number
      waypoints.forEach((wp, i) => wp.id = i + 1);
      renderWaypointsOnMap();
      renderWaypointsTable();
      updateMissionMetrics();
      window.showToast('Waypoint removed.');
    }
  }

  function addManualWaypoint() {
    const lastWp = waypoints[waypoints.length - 1] || { lat: 10.0235, lon: 78.1236, alt: 35, speed: 8 };
    const newWp = {
      id: waypoints.length + 1,
      lat: parseFloat((lastWp.lat + 0.0008).toFixed(5)),
      lon: parseFloat((lastWp.lon + 0.0008).toFixed(5)),
      alt: lastWp.alt,
      speed: lastWp.speed,
      action: 'Search Point'
    };
    waypoints.push(newWp);
    renderWaypointsOnMap();
    renderWaypointsTable();
    updateMissionMetrics();
    window.showToast(`Waypoint #${newWp.id} appended.`);
  }

  function clearWaypoints() {
    waypoints = [];
    renderWaypointsOnMap();
    renderWaypointsTable();
    updateMissionMetrics();
    window.showToast('Flight path cleared.');
  }

  function generateLawnmowerGrid() {
    const spacingMeters = parseInt(document.getElementById('rngPlanSpacing')?.value || 25);
    const alt = parseInt(document.getElementById('rngPlanAltitude')?.value || 35);
    const speed = parseInt(document.getElementById('rngPlanSpeed')?.value || 8);

    // Degree conversion approx: 1 deg lat ~ 111,000m, 1 deg lon ~ 111,000 * cos(10 deg) ~ 109,300m
    const spacingLon = spacingMeters / 109300;

    const minLat = 10.0215;
    const maxLat = 10.0260;
    const minLon = 78.1210;
    const maxLon = 78.1265;

    const newWaypoints = [];
    let wpCounter = 1;
    let currentLon = minLon;
    let toggle = false;

    // Home / Takeoff
    newWaypoints.push({
      id: wpCounter++,
      lat: minLat - 0.0005,
      lon: minLon,
      alt: alt,
      speed: speed,
      action: 'Takeoff & Altitude Hold'
    });

    while (currentLon <= maxLon) {
      if (!toggle) {
        newWaypoints.push({
          id: wpCounter++,
          lat: parseFloat(minLat.toFixed(5)),
          lon: parseFloat(currentLon.toFixed(5)),
          alt: alt,
          speed: speed,
          action: 'Grid Leg Start'
        });
        newWaypoints.push({
          id: wpCounter++,
          lat: parseFloat(maxLat.toFixed(5)),
          lon: parseFloat(currentLon.toFixed(5)),
          alt: alt,
          speed: speed,
          action: 'Grid Leg End'
        });
      } else {
        newWaypoints.push({
          id: wpCounter++,
          lat: parseFloat(maxLat.toFixed(5)),
          lon: parseFloat(currentLon.toFixed(5)),
          alt: alt,
          speed: speed,
          action: 'Grid Leg Start'
        });
        newWaypoints.push({
          id: wpCounter++,
          lat: parseFloat(minLat.toFixed(5)),
          lon: parseFloat(currentLon.toFixed(5)),
          alt: alt,
          speed: speed,
          action: 'Grid Leg End'
        });
      }
      toggle = !toggle;
      currentLon += spacingLon;
    }

    // RTL Return point
    newWaypoints.push({
      id: wpCounter++,
      lat: minLat - 0.0005,
      lon: minLon,
      alt: 15,
      speed: 4,
      action: 'RTL Landing Zone'
    });

    waypoints = newWaypoints;
    renderWaypointsOnMap();
    renderWaypointsTable();
    updateMissionMetrics();
    window.showToast(`Lawnmower Grid generated: ${waypoints.length} survey points.`);
  }

  function updateMissionMetrics() {
    let totalDistKm = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const p1 = waypoints[i];
      const p2 = waypoints[i + 1];
      // Haversine approximation
      const dLat = (p2.lat - p1.lat) * 111000;
      const dLon = (p2.lon - p1.lon) * 109300;
      totalDistKm += Math.sqrt(dLat * dLat + dLon * dLon) / 1000;
    }

    const speed = parseFloat(document.getElementById('rngPlanSpeed')?.value || 8);
    const speedKmH = speed * 3.6;
    const timeHours = speedKmH > 0 ? (totalDistKm / speedKmH) : 0;
    const totalSeconds = Math.round(timeHours * 3600);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;

    // Approx battery: 200W cruise = ~4.2% per minute of flight
    const flightMinutes = totalSeconds / 60;
    const estBatteryPercent = Math.min(100, Math.round(flightMinutes * 4.2 + 5));
    const coverageAreaM2 = Math.round(totalDistKm * 1000 * 25);

    const elDist = document.getElementById('planDistance');
    const elDur = document.getElementById('planDuration');
    const elBat = document.getElementById('planBatteryDraw');
    const elCov = document.getElementById('planCoverage');

    if (elDist) elDist.textContent = `${totalDistKm.toFixed(2)} km`;
    if (elDur) elDur.textContent = `${mins}m ${secs.toString().padStart(2, '0')}s`;
    if (elBat) {
      elBat.textContent = `${estBatteryPercent}% (Safe)`;
      elBat.style.color = estBatteryPercent > 65 ? '#ff3b56' : '#00e676';
    }
    if (elCov) elCov.textContent = `${coverageAreaM2.toLocaleString()} m²`;
  }

  function exportWaypointsFile() {
    if (waypoints.length === 0) {
      window.showToast('Error: No waypoints to export.');
      return;
    }

    // MAVLink standard .waypoints file format
    let content = 'QGC WPL 110\n';
    waypoints.forEach((wp, index) => {
      // INDEX CURRENT COORD_FRAME COMMAND PARAM1 PARAM2 PARAM3 PARAM4 LAT LON ALT AUTOCONTINUE
      const isCurrent = index === 0 ? 1 : 0;
      content += `${index}\t${isCurrent}\t3\t16\t0\t0\t0\t0\t${wp.lat.toFixed(7)}\t${wp.lon.toFixed(7)}\t${wp.alt}.000000\t1\n`;
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `A.S.A.R.D_Mission_${Date.now()}.waypoints`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    window.showToast('Mission Plan: MAVLink .waypoints file exported.');
  }

  function transmitMarkedPlaces() {
    let places = [];
    if (window.MapGoogle3DManager && MapGoogle3DManager.getMarkedPlaces) {
      places = MapGoogle3DManager.getMarkedPlaces();
    } else {
      try {
        places = JSON.parse(localStorage.getItem('A.S.A.R.D_marked_places') || '[]');
      } catch (e) {}
    }

    if (!places || places.length === 0) {
      if (window.showToast) {
        window.showToast('⚠️ No marked places found. Click on the 3D Satellite Map to mark tactical points first.');
      }
      return;
    }

    const convertedWps = places.map((p, i) => ({
      id: i + 1,
      lat: parseFloat(p.lat),
      lon: parseFloat(p.lng || p.lon),
      alt: 20,
      speed: 10,
      action: `Tactical Mark: ${p.name || 'Waypoint'}`
    }));

    waypoints = convertedWps;
    renderWaypointsOnMap();
    renderWaypointsTable();
    updateMissionMetrics();

    initiateDroneToMarkedCoordinates(20, 10);
  }

  async function initiateDroneToMarkedCoordinates(altitude = 20, speed = 10) {
    let places = [];
    if (window.MapGoogle3DManager && MapGoogle3DManager.getMarkedPlaces) {
      places = MapGoogle3DManager.getMarkedPlaces();
    } else {
      try {
        places = JSON.parse(localStorage.getItem('A.S.A.R.D_marked_places') || '[]');
      } catch (e) {}
    }

    let wpsToFly = [];
    if (places && places.length > 0) {
      wpsToFly = places.map((p, i) => ({
        id: i + 1,
        lat: parseFloat(p.lat),
        lon: parseFloat(p.lng || p.lon),
        alt: altitude,
        speed: speed,
        action: `Tactical Mark: ${p.name || 'Waypoint'}`
      }));
    } else if (Array.isArray(waypoints) && waypoints.length > 0) {
      wpsToFly = waypoints.map(wp => ({ ...wp, alt: altitude, speed: speed }));
    } else {
      wpsToFly = [
        { id: 1, lat: 10.0235, lon: 78.1236, alt: altitude, speed: speed, action: 'Marked Target Alpha' },
        { id: 2, lat: 10.0210, lon: 78.1210, alt: altitude, speed: speed, action: 'Marked Target Bravo' },
        { id: 3, lat: 10.0258, lon: 78.1245, alt: altitude, speed: speed, action: 'Marked Target Charlie' }
      ];
    }

    waypoints = wpsToFly;
    renderWaypointsOnMap();
    renderWaypointsTable();
    updateMissionMetrics();

    if (window.showToast) {
      window.showToast(`🚀 INITIATING: Arming drone, climb to ${altitude}m, speed ${speed} m/s, navigating to ${wpsToFly.length} marked coordinates!`);
    }

    try {
      const res = await fetch('/api/drone/initiate-mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          altitude: altitude,
          speed: speed,
          waypoints: wpsToFly
        })
      });
      const data = await res.json();
      if (data && data.success) {
        if (window.showToast) {
          window.showToast(`✅ ${data.message}`);
        }
        const badgeDroneMavStatus = document.getElementById('badgeDroneMavStatus');
        if (badgeDroneMavStatus) {
          badgeDroneMavStatus.textContent = 'AUTO ACTIVE';
          badgeDroneMavStatus.className = 'status-pill-green';
        }
      } else {
        if (window.showToast) {
          window.showToast(`⚠️ Drone Mission Notice: ${data?.message || 'Initiation queued'}`);
        }
      }
    } catch (err) {
      if (window.showToast) {
        window.showToast(`⚠️ Mission trigger error: ${err.message}`);
      }
    }
  }

  async function transmitMission(customWaypoints) {
    const btnPlan = document.getElementById('btnTransmitMission');
    const btnMain = document.getElementById('btnMainTransmitMavlink');

    // Retrieve waypoints to transmit
    const wpToSend = (Array.isArray(customWaypoints) && customWaypoints.length > 0) ? customWaypoints : waypoints;
    if (!wpToSend || wpToSend.length === 0) {
      if (window.showToast) window.showToast('⚠️ No waypoints defined! Add waypoints or generate a search grid first.');
      return;
    }

    // Retrieve target IP and Port (multi-system network support)
    const targetIp = (
      document.getElementById('mavTargetIp')?.value || 
      document.getElementById('mainMavTargetIp')?.value || 
      localStorage.getItem('A.S.A.R.D_mavlink_ip') || 
      '127.0.0.1'
    ).trim();

    const targetPort = parseInt(
      document.getElementById('mavTargetPort')?.value || 
      localStorage.getItem('A.S.A.R.D_mavlink_port') || 
      '14550', 
      10
    );

    // Save target IP & Port
    localStorage.setItem('A.S.A.R.D_mavlink_ip', targetIp);
    localStorage.setItem('A.S.A.R.D_mavlink_port', String(targetPort));

    // Button loading states
    const spinHtml = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin-icon">
        <line x1="12" y1="2" x2="12" y2="6"></line>
        <line x1="12" y1="18" x2="12" y2="22"></line>
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
        <line x1="2" y1="12" x2="6" y2="12"></line>
        <line x1="18" y1="12" x2="22" y2="12"></line>
        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
      </svg>
      <span>TRANSMITTING TO ${targetIp}:${targetPort} (MAVLINK)...</span>
    `;

    if (btnPlan) {
      btnPlan.disabled = true;
      btnPlan.innerHTML = spinHtml;
    }
    if (btnMain) {
      btnMain.disabled = true;
      btnMain.innerHTML = `<span>TRANSMITTING (${targetIp})...</span>`;
    }

    if (window.showToast) {
      window.showToast(`📡 Transmitting ${wpToSend.length} waypoints across network to Mission Planner (${targetIp}:${targetPort})...`);
    }

    try {
      const response = await fetch('/api/mavlink/transmit_mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_host: targetIp,
          target_port: targetPort,
          waypoints: wpToSend,
          auto_start: false
        })
      });

      const data = await response.json();

      if (data && data.success) {
        if (window.showToast) {
          window.showToast(`✅ ${data.message || 'Mission uploaded successfully'} (${data.waypoints} waypoints, sys=${data.target_system})`);
        }
      } else {
        if (window.showToast) {
          window.showToast(`❌ MAVLink Error: ${data?.message || data?.error || 'Mission upload rejected'}`);
        }
      }
    } catch (err) {
      console.error('[ViewsManager] MAVLink transmission error:', err);
      if (window.showToast) {
        window.showToast(`⚠️ Uplink error: ${err.message}. Check remote endpoint (${targetIp})`);
      }
    } finally {
      if (btnPlan) {
        btnPlan.disabled = false;
        btnPlan.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <span>TRANSMIT TO MISSION PLANNER (START AUTONOMOUS FLIGHT)</span>
        `;
      }
      if (btnMain) {
        btnMain.disabled = false;
        btnMain.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M4.93 19.07a10 10 0 0 1 0-14.14M7.76 16.24a6 6 0 0 1 0-8.48M12 12h.01"></path>
            <circle cx="12" cy="12" r="2"></circle>
            <path d="M16.24 7.76a6 6 0 0 1 0 8.48M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          </svg>
          <span>TRANSMIT MISSION (MAVLINK AUTO)</span>
        `;
      }
    }
  }

  async function armAndTakeoffMavlink(altitude = 20) {
    const btn = document.getElementById('btnMainMavlinkTakeoff');
    const targetConn = (
      document.getElementById('mainMavTargetIp')?.value || 
      document.getElementById('mavTargetIp')?.value || 
      localStorage.getItem('A.S.A.R.D_mavlink_ip') || 
      'tcp:10.10.95.188:5762'
    ).trim();

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>TAKING OFF (${altitude}M)...</span>`;
    }

    if (window.showToast) {
      window.showToast(`🚀 Sending GUIDED Mode, ARM & TAKEOFF (${altitude}m) to ${targetConn}...`);
    }

    try {
      const res = await fetch('/api/mavlink/takeoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection: targetConn,
          altitude: altitude
        })
      });
      const data = await res.json();
      if (data && data.success) {
        const selFlightMode = document.getElementById('flightModeSelect');
        if (selFlightMode) selFlightMode.value = 'GUIDED';
        const statusText = document.getElementById('flightStatusText');
        if (statusText) statusText.textContent = 'IN FLIGHT (GUIDED)';
        if (window.TelemetryManager && TelemetryManager.updateTelemetry) {
          TelemetryManager.updateTelemetry({
            status: 'IN FLIGHT',
            flightMode: 'GUIDED',
            altitude: altitude
          });
        }
        if (window.showToast) {
          window.showToast(`✅ ARMED & TAKEOFF SUCCESSFUL: Drone ascending to ${altitude}m via ${targetConn}! Mode: GUIDED`);
        }
      } else {
        if (window.showToast) window.showToast(`⚠️ Takeoff notice: ${data?.message}`);
      }
    } catch (err) {
      if (window.showToast) window.showToast(`⚠️ Takeoff error: ${err.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"></polyline></svg>
          <span>ARM & TAKEOFF (20M)</span>
        `;
      }
    }
  }

  // =========================================================================
  // 3. LIVE FEED RECON WALL
  // =========================================================================
  function setupLiveFeedWall() {
    const btnSnap = document.getElementById('btnWallTakeSnapshot');
    const btnSwitch = document.getElementById('btnWallSwitchSource');
    const btnSplit = document.getElementById('btnWallLayoutSplit');
    const btnRgbOnly = document.getElementById('btnWallLayoutRgb');
    const btnThermalOnly = document.getElementById('btnWallLayoutThermal');
    const chkAi = document.getElementById('chkWallAiOverlay');

    if (btnSnap) btnSnap.addEventListener('click', captureForensicSnapshot);
    if (btnSwitch) {
      btnSwitch.addEventListener('click', () => {
        // Open the existing IP webcam modal
        const btnIp = document.getElementById('btnConnectIpWebcam');
        if (btnIp) btnIp.click();
      });
    }

    if (btnSplit) {
      btnSplit.addEventListener('click', () => {
        document.getElementById('wallFeedRgb').style.display = 'flex';
        document.getElementById('wallFeedThermal').style.display = 'flex';
        btnSplit.classList.add('active');
        btnRgbOnly.classList.remove('active');
        btnThermalOnly.classList.remove('active');
      });
    }

    if (btnRgbOnly) {
      btnRgbOnly.addEventListener('click', () => {
        document.getElementById('wallFeedRgb').style.display = 'flex';
        document.getElementById('wallFeedThermal').style.display = 'none';
        btnRgbOnly.classList.add('active');
        btnSplit.classList.remove('active');
        btnThermalOnly.classList.remove('active');
      });
    }

    if (btnThermalOnly) {
      btnThermalOnly.addEventListener('click', () => {
        document.getElementById('wallFeedRgb').style.display = 'none';
        document.getElementById('wallFeedThermal').style.display = 'flex';
        btnThermalOnly.classList.add('active');
        btnSplit.classList.remove('active');
        btnRgbOnly.classList.remove('active');
      });
    }

    if (chkAi) {
      chkAi.addEventListener('change', (e) => {
        const overlay = document.getElementById('wallAiOverlay');
        if (overlay) overlay.style.display = e.target.checked ? 'block' : 'none';
      });
    }
  }

  function syncWallVideoSource() {
    const wallImg = document.getElementById('wallRgbImage');
    const activeSource = (window.CameraFeedManager && CameraFeedManager.getActiveVisualElement) 
      ? CameraFeedManager.getActiveVisualElement() 
      : (document.getElementById('cameraRgbFeed') || document.getElementById('rgbFeedImage'));
    if (wallImg && activeSource && activeSource.src) {
      wallImg.src = activeSource.src;
    }
  }

  function startWallThermalLoop() {
    const canvas = document.getElementById('wallThermalCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function renderThermal() {
      if (currentView !== 'live-feed') return;

      const activeSource = (window.CameraFeedManager && CameraFeedManager.getActiveVisualElement) 
        ? CameraFeedManager.getActiveVisualElement() 
        : (document.getElementById('wallRgbImage') || document.getElementById('cameraRgbFeed'));

      if (activeSource) {
        const wallImg = document.getElementById('wallRgbImage');
        if (wallImg && activeSource.src && wallImg.src !== activeSource.src) {
          wallImg.src = activeSource.src;
        }

        try {
          ctx.drawImage(activeSource, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;
          const palette = document.getElementById('wallThermalPaletteSelect')?.value || 'ironbow';

          for (let i = 0; i < data.length; i += 4) {
            const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
            let r, g, b;

            if (palette === 'whitehot') {
              r = g = b = gray * 255;
            } else if (palette === 'blackhot') {
              r = g = b = (1.0 - gray) * 255;
            } else if (palette === 'rainbow') {
              r = Math.sin(gray * Math.PI) * 255;
              g = Math.sin(gray * Math.PI + 2) * 255;
              b = Math.cos(gray * Math.PI) * 255;
            } else {
              // Ironbow FLIR signature
              r = Math.sin(gray * Math.PI * 1.5) * 255;
              g = Math.sin(gray * Math.PI) * 220;
              b = Math.cos(gray * Math.PI * 0.9) * 240;
            }

            data[i] = Math.max(0, Math.min(255, r));
            data[i + 1] = Math.max(0, Math.min(255, g));
            data[i + 2] = Math.max(0, Math.min(255, b));
          }
          ctx.putImageData(imgData, 0, 0);
        } catch (e) {
          // Cross-origin image fallback
        }
      }
      thermalAnimId = requestAnimationFrame(renderThermal);
    }

    if (thermalAnimId) cancelAnimationFrame(thermalAnimId);
    thermalAnimId = requestAnimationFrame(renderThermal);
  }

  function captureForensicSnapshot() {
    const wallImg = document.getElementById('wallRgbImage') || document.getElementById('cameraRgbFeed');
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const cx = c.getContext('2d');
    if (wallImg && wallImg.complete) {
      cx.drawImage(wallImg, 0, 0, 640, 480);
    } else {
      cx.fillStyle = '#081628';
      cx.fillRect(0, 0, 640, 480);
    }

    // Add forensic watermark
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    cx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    cx.fillRect(10, 440, 400, 32);
    cx.font = 'bold 12px Rajdhani, sans-serif';
    cx.fillStyle = '#00d2ff';
    cx.fillText(`A.S.A.R.D UAV • 10.0235° N, 78.1236° E • ${timeStr} UTC+5:30`, 16, 460);

    const dataUrl = c.toDataURL('image/jpeg', 0.92);
    const snapId = `SNAP-${Math.floor(1000 + Math.random() * 9000)}`;
    const newSnap = {
      id: snapId,
      title: 'Target Capture (Recon)',
      time: timeStr,
      coords: '10.0235° N, 78.1236° E',
      img: dataUrl,
      confidence: 'Forensic Live'
    };

    snapshots.unshift(newSnap);
    renderSnapshotsGallery();
    window.showToast(`Forensic Snapshot ${snapId} saved to incident gallery.`);
  }

  function renderSnapshotsGallery() {
    const strip = document.getElementById('reconGalleryStrip');
    const countEl = document.getElementById('galleryCount');
    if (countEl) countEl.textContent = snapshots.length;
    if (!strip) return;

    strip.innerHTML = snapshots.map(s => `
      <div class="gallery-item" onclick="ViewsManager.openSnapshot('${s.id}')">
        <img src="${s.img}" class="gallery-thumb" alt="${s.title}">
        <div class="gallery-meta">
          <span class="gallery-id">${s.id}</span>
          <span style="color: #ffffff; font-weight: 500; font-size: 10px;">${s.title}</span>
          <span style="color: var(--text-muted); font-size: 9.5px;">${s.time} • ${s.confidence}</span>
        </div>
      </div>
    `).join('');
  }

  function openSnapshot(snapId) {
    const snap = snapshots.find(s => s.id === snapId);
    if (!snap) return;

    // Create tactical modal popup preview
    const overlay = document.createElement('div');
    overlay.className = 'tactical-modal-backdrop active';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="tactical-modal" style="max-width: 600px;">
        <div class="modal-header">
          <div class="modal-title">
            <span>FORENSIC RECON PHOTO: ${snap.id}</span>
          </div>
          <button class="modal-close-btn" onclick="this.closest('.tactical-modal-backdrop').remove()">&times;</button>
        </div>
        <div class="modal-body" style="text-align: center;">
          <img src="${snap.img}" style="width: 100%; max-height: 380px; object-fit: contain; border-radius: 4px; border: 1px solid var(--border-card);">
          <div style="display: flex; justify-content: space-between; margin-top: 10px; font-size: 11.5px;">
            <span><strong>COORDINATES:</strong> ${snap.coords}</span>
            <span><strong>CAPTURED:</strong> ${snap.time}</span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" onclick="this.closest('.tactical-modal-backdrop').remove()">Close</button>
          <a href="${snap.img}" download="${snap.id}.jpg" class="btn-dispatch" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center;">Download Forensic File</a>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  // =========================================================================
  // 4. DRONE CONTROL & MANUAL FLY-BY-WIRE
  // =========================================================================
  function setupDroneControl() {
    setupJoystick('joyLeftBase', 'joyLeftStick', (x, y) => {
      // Throttle (y: -1 is up, 1 is down), Yaw (x: -1 is left, 1 is right)
      joyState.left.x = x;
      joyState.left.y = y;
    });

    setupJoystick('joyRightBase', 'joyRightStick', (x, y) => {
      // Pitch (y: -1 is forward, 1 is back), Roll (x: -1 is left, 1 is right)
      joyState.right.x = x;
      joyState.right.y = y;
    });

    setupKeyboardControls();

    // =========================================================================
    // Mission Planner / ArduPilot Route Transmit & Connect in Drone Control
    // =========================================================================
    const btnDroneConnectMav = document.getElementById('btnDroneCtrlConnectMav');
    const btnDroneTransmitRoute = document.getElementById('btnDroneCtrlTransmitRoute');
    const inpDroneIp = document.getElementById('droneCtrlMavIp');
    const inpDronePort = document.getElementById('droneCtrlMavPort');
    const selDroneProto = document.getElementById('droneCtrlMavProto');
    const badgeDroneMavStatus = document.getElementById('droneCtrlMavStatusBadge');
    const lblDroneRouteSummary = document.getElementById('droneCtrlRouteSummary');

    // Fetch local PC IP dynamically to show on UI
    fetch('/api/network-info').then(r => r.json()).then(info => {
      const lbl = document.getElementById('thisDashboardIpLabel');
      if (lbl && (info.primaryIp || info.defaultUrl)) {
        lbl.textContent = info.primaryIp || '172.27.172.218';
      }
    }).catch(() => {});

    // Populate initial inputs from localStorage if present
    if (inpDroneIp) {
      inpDroneIp.value = localStorage.getItem('A.S.A.R.D_mavlink_ip') || '172.27.172.87';
    }
    if (inpDronePort && localStorage.getItem('A.S.A.R.D_mavlink_port')) {
      inpDronePort.value = localStorage.getItem('A.S.A.R.D_mavlink_port');
    }

    // Refresh route summary badge
    function updateDroneRouteSummary() {
      if (!lblDroneRouteSummary) return;
      let count = 0;
      if (window.MapGoogle3DManager && MapGoogle3DManager.getMarkedPlaces) {
        const places = MapGoogle3DManager.getMarkedPlaces();
        if (places && places.length > 0) count = places.length;
      }
      if (count === 0 && Array.isArray(waypoints) && waypoints.length > 0) {
        count = waypoints.length;
      }
      if (count > 0) {
        lblDroneRouteSummary.innerHTML = `Route Ready: <strong style="color: var(--orange-primary);">${count} tactical waypoints</strong> prepared for Mission Planner upload`;
      } else {
        lblDroneRouteSummary.innerHTML = `No custom pins yet. Transmit will dispatch default tactical reconnaissance route (or mark places on Satellite Map)`;
      }
    }
    updateDroneRouteSummaryGlobal = updateDroneRouteSummary;
    updateDroneRouteSummary();

    // Connect / Ping button
    if (btnDroneConnectMav) {
      btnDroneConnectMav.addEventListener('click', async () => {
        const ip = (inpDroneIp ? inpDroneIp.value : '172.27.172.87').trim();
        const port = parseInt(inpDronePort ? inpDronePort.value : '14550', 10);
        const proto = selDroneProto ? selDroneProto.value : 'udp';

        localStorage.setItem('A.S.A.R.D_mavlink_ip', ip);
        localStorage.setItem('A.S.A.R.D_mavlink_port', String(port));

        if (badgeDroneMavStatus) {
          badgeDroneMavStatus.textContent = 'TESTING...';
          badgeDroneMavStatus.className = 'status-pill-amber';
        }

        try {
          const res = await fetch('/api/mavlink/ping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_host: ip, target_port: port, proto: proto })
          });
          const data = await res.json();
          if (data && data.connected) {
            if (badgeDroneMavStatus) {
              badgeDroneMavStatus.textContent = 'CONNECTED';
              badgeDroneMavStatus.className = 'status-pill-green';
            }
            if (window.showToast) window.showToast(`✅ ${data.message}`);
          } else {
            if (badgeDroneMavStatus) {
              badgeDroneMavStatus.textContent = 'UNREACHABLE';
              badgeDroneMavStatus.className = 'status-pill-amber';
            }
            if (window.showToast) window.showToast(`⚠️ ${data.message || 'Mission Planner not detected.'}`);
          }
        } catch (e) {
          if (badgeDroneMavStatus) {
            badgeDroneMavStatus.textContent = 'OFFLINE';
            badgeDroneMavStatus.className = 'status-pill-amber';
          }
          if (window.showToast) window.showToast(`⚠️ Connection test failed: ${e.message}`);
        }
      });
    }

    // Transmit Route Button
    if (btnDroneTransmitRoute) {
      btnDroneTransmitRoute.addEventListener('click', async () => {
        const ip = (inpDroneIp ? inpDroneIp.value : '172.27.172.87').trim();
        const port = parseInt(inpDronePort ? inpDronePort.value : '14550', 10);
        const proto = selDroneProto ? selDroneProto.value : 'udp';

        // Retrieve route data from 3D Satellite Map marked places or mission planner waypoints
        let routeWps = [];
        if (window.MapGoogle3DManager && MapGoogle3DManager.getMarkedPlaces) {
          const marked = MapGoogle3DManager.getMarkedPlaces();
          if (marked && marked.length > 0) {
            routeWps = marked.map((p, i) => ({
              id: i + 1,
              lat: parseFloat(p.lat),
              lon: parseFloat(p.lng || p.lon),
              alt: 20,
              speed: 10,
              action: `Tactical Mark: ${p.name || 'Waypoint'}`
            }));
          }
        }

        if (routeWps.length === 0 && Array.isArray(waypoints) && waypoints.length > 0) {
          routeWps = waypoints;
        }

        // If no route waypoints exist yet, prompt to define or generate fallback route from active target
        if (routeWps.length === 0) {
          routeWps = [
            { id: 1, lat: 9.5440, lon: 78.6920, alt: 20, speed: 10, action: 'Nainarkoil Recon #001' },
            { id: 2, lat: 9.5475, lon: 78.6925, alt: 20, speed: 10, action: 'Perimeter Scan B-2' },
            { id: 3, lat: 9.5480, lon: 78.6965, alt: 20, speed: 10, action: 'Thermal Point Return' },
            { id: 4, lat: 9.5456, lon: 78.6945, alt: 20, speed: 10, action: 'Nainarkoil Base WP' }
          ];
        }

        const origHtml = btnDroneTransmitRoute.innerHTML;
        btnDroneTransmitRoute.disabled = true;
        btnDroneTransmitRoute.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin-icon">
            <line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line>
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
            <line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line>
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
          </svg>
          <span>SENDING ${routeWps.length} ROUTE POINTS...</span>
        `;

        if (badgeDroneMavStatus) {
          badgeDroneMavStatus.textContent = 'TRANSMITTING';
          badgeDroneMavStatus.className = 'status-pill-amber';
        }

        if (window.showToast) {
          window.showToast(`🛰️ Transmitting ${routeWps.length} route waypoints to Mission Planner (${ip}:${port})...`);
        }

        try {
          const connStr = (proto === 'tcp') ? `tcp:${ip}:${port}` : `udpout:${ip}:${port}`;
          const res = await fetch('/api/mavlink/transmit_mission', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              target_host: ip,
              target_port: port,
              connection: connStr,
              waypoints: routeWps,
              auto_start: false
            })
          });

          const data = await res.json();
          if (data && data.success) {
            if (badgeDroneMavStatus) {
              badgeDroneMavStatus.textContent = 'VERIFIED';
              badgeDroneMavStatus.className = 'status-pill-green';
            }
            if (window.showToast) {
              window.showToast(`✅ ${data.message || 'Mission uploaded successfully'} (${data.waypoints} waypoints, sys=${data.target_system})`);
            }
          } else {
            if (badgeDroneMavStatus) {
              badgeDroneMavStatus.textContent = 'ERROR';
              badgeDroneMavStatus.className = 'status-pill-amber';
            }
            if (window.showToast) {
              window.showToast(`❌ MAVLink Error: ${data?.message || data?.error || 'Mission upload rejected'}`);
            }
          }
        } catch (err) {
          if (badgeDroneMavStatus) {
            badgeDroneMavStatus.textContent = 'OFFLINE';
            badgeDroneMavStatus.className = 'status-pill-amber';
          }
          if (window.showToast) {
            window.showToast(`❌ Route transmission failed: ${err.message}`);
          }
        } finally {
          btnDroneTransmitRoute.disabled = false;
          btnDroneTransmitRoute.innerHTML = origHtml;
          updateDroneRouteSummary();
        }
      });
    }

    // Flight Action & Arming Controls
    const btnArm = document.getElementById('btnCtrlArm');
    const btnDisarm = document.getElementById('btnCtrlDisarm');
    const btnTakeoff = document.getElementById('btnCtrlTakeoff');
    const btnHold = document.getElementById('btnCtrlHold');
    const btnOrbit = document.getElementById('btnCtrlOrbit');
    const btnRtl = document.getElementById('btnCtrlRtl');
    const btnEmergency = document.getElementById('btnCtrlEmergencyLand');

    const getMavTargetParams = () => {
      const ip = (inpDroneIp ? inpDroneIp.value : '172.27.172.87').trim();
      const port = parseInt(inpDronePort ? inpDronePort.value : '14550', 10);
      const proto = selDroneProto ? selDroneProto.value : 'udp';
      const conn = (proto === 'tcp') ? `tcp:${ip}:${port}` : `udpout:${ip}:${port}`;
      return { target_host: ip, target_port: port, connection: conn };
    };

    if (btnArm) {
      btnArm.addEventListener('click', async () => {
        window.showToast('⚡ Arming motors and initiating takeoff to 20m (preventing auto-disarm)...');
        try {
          // Trigger arming, automated climb to 20m, and speed 10 m/s navigation
          const res = await fetch('/api/drone/initiate-mission', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...getMavTargetParams(),
              altitude: 20,
              speed: 10
            })
          });
          const data = await res.json();
          if (data && data.success) {
            window.showToast(`✅ ${data.message || 'Drone ARMED & Airborne at 20m!'}`);
            if (badgeDroneMavStatus) {
              badgeDroneMavStatus.textContent = 'ARMED & FLYING';
              badgeDroneMavStatus.className = 'status-pill-green';
            }
          } else {
            // Fallback to direct arming if mission initiation returned notice
            const armRes = await fetch('/api/mavlink/arm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(getMavTargetParams())
            });
            const armData = await armRes.json();
            if (armData && armData.success) {
              window.showToast('✅ Drone Motors ARMED');
            } else {
              window.showToast(`⚠️ Arming notice: ${armData?.message || data?.message}`);
            }
          }
        } catch (e) {
          window.showToast(`❌ Error: ${e.message}`);
        }
      });
    }

    if (btnDisarm) {
      btnDisarm.addEventListener('click', async () => {
        window.showToast('🛑 Sending DISARM command...');
        try {
          const res = await fetch('/api/mavlink/disarm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getMavTargetParams())
          });
          const data = await res.json();
          window.showToast(`✅ ${data.message || 'Drone Motors DISARMED'}`);
          if (badgeDroneMavStatus) {
            badgeDroneMavStatus.textContent = 'STANDBY';
            badgeDroneMavStatus.className = 'status-pill-amber';
          }
        } catch (e) {
          window.showToast(`❌ Error sending DISARM command: ${e.message}`);
        }
      });
    }

    if (btnTakeoff) {
      btnTakeoff.addEventListener('click', async () => {
        window.showToast('🚀 Initiating automated vertical takeoff to 20m AGL...');
        try {
          const res = await fetch('/api/mavlink/takeoff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getMavTargetParams(), altitude: 20 })
          });
          const data = await res.json();
          if (data && data.success) {
            window.showToast(`✅ ${data.message || 'Drone ARMED & TAKEOFF initiated!'}`);
          } else {
            window.showToast(`⚠️ Takeoff Failed: ${data?.message || data?.error || 'Rejected'}`);
          }
        } catch (e) {
          window.showToast(`❌ Error initiating Takeoff: ${e.message}`);
        }
      });
    }

    if (btnHold) {
      btnHold.addEventListener('click', async () => {
        window.showToast('Engaging Position Hold (LOITER)...');
        try {
          const res = await fetch('/api/mavlink/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getMavTargetParams(), mode: 'LOITER' })
          });
          const data = await res.json();
          window.showToast(`✅ ${data.message || 'Mode set to LOITER'}`);
        } catch (e) {
          window.showToast(`❌ Mode error: ${e.message}`);
        }
      });
    }

    if (btnOrbit) {
      btnOrbit.addEventListener('click', async () => {
        window.showToast('Engaging CIRCLE Orbit Mode...');
        try {
          const res = await fetch('/api/mavlink/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getMavTargetParams(), mode: 'CIRCLE' })
          });
          const data = await res.json();
          window.showToast(`✅ ${data.message || 'Mode set to CIRCLE'}`);
        } catch (e) {
          window.showToast(`❌ Orbit error: ${e.message}`);
        }
      });
    }

    if (btnRtl) {
      btnRtl.addEventListener('click', async () => {
        window.showToast('EMERGENCY RTL: Returning to Launch Coordinate...');
        try {
          const res = await fetch('/api/mavlink/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getMavTargetParams(), mode: 'RTL' })
          });
          const data = await res.json();
          window.showToast(`✅ ${data.message || 'RTL Engaged'}`);
        } catch (e) {
          window.showToast(`❌ RTL error: ${e.message}`);
        }
      });
    }

    if (btnEmergency) {
      btnEmergency.addEventListener('click', async () => {
        const confirmed = confirm('CRITICAL WARNING: This will immediately cut power to all 4 motors. Confirm motor kill?');
        if (confirmed) {
          window.showToast('MOTORS KILLED: Safety override engaged.');
          try {
            await fetch('/api/mavlink/disarm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(getMavTargetParams())
            });
          } catch (e) {}
        }
      });
    }

    // Gimbal Pitch and Zoom
    const rngGimbal = document.getElementById('rngGimbalPitch');
    const rngZoom = document.getElementById('rngOpticalZoom');

    if (rngGimbal) {
      rngGimbal.addEventListener('input', (e) => {
        const pitch = e.target.value;
        document.getElementById('valGimbalPitch').textContent = `${pitch}°`;
        document.getElementById('lblGimbalPitch').textContent = `${pitch}°`;
      });
    }

    if (rngZoom) {
      rngZoom.addEventListener('input', (e) => {
        const zoom = (e.target.value / 10).toFixed(1);
        document.getElementById('valOpticalZoom').textContent = `${zoom}x`;
        const img = document.getElementById('gimbalFpvImg');
        if (img) img.style.transform = `scale(${zoom})`;
      });
    }

    // Payload Drop
    const chkArm = document.getElementById('chkArmPayload');
    const btnDrop = document.getElementById('btnReleasePayload');
    const lblStatus = document.getElementById('lblPayloadStatus');

    if (chkArm && btnDrop) {
      chkArm.addEventListener('change', (e) => {
        if (e.target.checked) {
          btnDrop.disabled = false;
          btnDrop.style.opacity = '1';
          btnDrop.style.cursor = 'pointer';
          lblStatus.textContent = 'ARMED (READY TO DROP)';
          lblStatus.style.color = '#ff3b56';
          window.showToast('PAYLOAD MECHANISM ARMED: Safe to drop.');
        } else {
          btnDrop.disabled = true;
          btnDrop.style.opacity = '0.5';
          btnDrop.style.cursor = 'not-allowed';
          lblStatus.textContent = 'DISARMED';
          lblStatus.style.color = 'var(--text-muted)';
        }
      });

      btnDrop.addEventListener('click', () => {
        if (!chkArm.checked) return;

        btnDrop.disabled = true;
        btnDrop.textContent = 'RELEASING PAYLOAD SERVO...';

        setTimeout(() => {
          btnDrop.textContent = 'PAYLOAD DEPLOYED';
          btnDrop.style.background = '#00e676';
          lblStatus.textContent = 'DEPLOYED AT 10.0235, 78.1236';
          lblStatus.style.color = '#00e676';
          chkArm.checked = false;

          // Dispatch Rescue log entry
          if (window.RescueLogManager) {
            RescueLogManager.addEvent('Team Alpha', 'PAYLOAD_DROPPED', 'Emergency First Aid Kit & Beacon dropped to Victim #001.');
          }

          window.showToast('PAYLOAD RELEASED: First Aid Kit dropped successfully onto Target #001!');
        }, 1200);
      });
    }
  }

  function syncGimbalSource() {
    const fpvImg = document.getElementById('gimbalFpvImg');
    const activeSource = (window.CameraFeedManager && CameraFeedManager.getActiveVisualElement) 
      ? CameraFeedManager.getActiveVisualElement() 
      : (document.getElementById('cameraRgbFeed') || document.getElementById('rgbFeedImage'));
    if (fpvImg && activeSource && activeSource.src) {
      fpvImg.src = activeSource.src;
    }
  }

  function setupJoystick(baseId, stickId, onMove) {
    const base = document.getElementById(baseId);
    const stick = document.getElementById(stickId);
    if (!base || !stick) return;

    const maxRadius = 38; // Maximum stick travel in px

    function handlePointer(clientX, clientY) {
      const rect = base.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }

      stick.style.transform = `translate(${dx}px, ${dy}px)`;

      // Normalized coordinates -1.0 to 1.0
      const normX = parseFloat((dx / maxRadius).toFixed(2));
      const normY = parseFloat((dy / maxRadius).toFixed(2));
      onMove(normX, normY);
    }

    function resetStick() {
      stick.style.transform = 'translate(0px, 0px)';
      onMove(0, 0);
    }

    let isDragging = false;

    base.addEventListener('pointerdown', (e) => {
      isDragging = true;
      base.setPointerCapture(e.pointerId);
      handlePointer(e.clientX, e.clientY);
    });

    base.addEventListener('pointermove', (e) => {
      if (isDragging) {
        handlePointer(e.clientX, e.clientY);
      }
    });

    const endDrag = (e) => {
      if (isDragging) {
        isDragging = false;
        try { base.releasePointerCapture(e.pointerId); } catch (_) {}
        resetStick();
      }
    };

    base.addEventListener('pointerup', endDrag);
    base.addEventListener('pointercancel', endDrag);
  }

  function setupKeyboardControls() {
    const keyMap = {};

    window.addEventListener('keydown', (e) => {
      if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        keyMap[e.key] = true;
        updateFromKeys();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        keyMap[e.key] = false;
        updateFromKeys();
      }
    });

    function updateFromKeys() {
      // Left Stick: W/S (throttle), A/D (yaw)
      let lx = 0, ly = 0;
      if (keyMap['a']) lx -= 1;
      if (keyMap['d']) lx += 1;
      if (keyMap['w']) ly -= 1;
      if (keyMap['s']) ly += 1;

      const stickL = document.getElementById('joyLeftStick');
      if (stickL) stickL.style.transform = `translate(${lx * 30}px, ${ly * 30}px)`;

      // Right Stick: Arrows (pitch & roll)
      let rx = 0, ry = 0;
      if (keyMap['ArrowLeft']) rx -= 1;
      if (keyMap['ArrowRight']) rx += 1;
      if (keyMap['ArrowUp']) ry -= 1;
      if (keyMap['ArrowDown']) ry += 1;

      const stickR = document.getElementById('joyRightStick');
      if (stickR) stickR.style.transform = `translate(${rx * 30}px, ${ry * 30}px)`;
    }
  }

  function startMotorAnimation() {
    if (motorAnimId) return;

    function step() {
      if (currentView === 'drone-control') {
        const baseRpm = 5400;
        const delta = Math.floor((Math.random() - 0.5) * 60);

        for (let i = 1; i <= 4; i++) {
          const rpmEl = document.getElementById(`motor${i}Rpm`);
          const fillEl = document.getElementById(`motor${i}Fill`);
          const rpm = baseRpm + delta + (i * 12);
          const percent = Math.min(100, Math.round((rpm / 8000) * 100));

          if (rpmEl) rpmEl.textContent = rpm;
          if (fillEl) fillEl.style.height = `${percent}%`;
        }
      }
      motorAnimId = setTimeout(step, 600);
    }

    step();
  }

  return {
    init: init,
    switchView: switchView,
    removeWaypoint: removeWaypoint,
    openSnapshot: openSnapshot,
    transmitMission: transmitMission,
    transmitMarkedPlaces: transmitMarkedPlaces,
    armAndTakeoffMavlink: armAndTakeoffMavlink,
    initiateDroneToMarkedCoordinates: initiateDroneToMarkedCoordinates
  };
})();

// Export globally
window.ViewsManager = ViewsManager;
