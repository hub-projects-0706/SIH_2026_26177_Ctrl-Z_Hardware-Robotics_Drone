/**
 * AEROSIGHT - 2D Tactical Satellite Map Module (Leaflet)
 */

const Map2DManager = (() => {
  let map = null;
  let droneMarker = null;
  let searchPathLine = null;
  let noFlyPolygon = null;
  const victimMarkers = {};
  const hazardMarkers = {};

  const CENTER = [10.0238, 78.1235];
  const ZOOM = 17;

  function init() {
    const container = document.getElementById('map2D');
    if (!container || map) return;

    map = L.map('map2D', {
      center: CENTER,
      zoom: ZOOM,
      zoomControl: false,
      attributionControl: false,
      maxZoom: 19,
      minZoom: 1,
      worldCopyJump: true
    });

    // High-Resolution Satellite Imagery Layer
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Satellite Imagery'
    }).addTo(map);

    // Subtle dark tactical label overlay
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
      opacity: 0.7
    }).addTo(map);

    setupLayers();
    setupControls();
  }

  function setupLayers() {
    // 1. Search Path (Cyan dashed polyline)
    const waypoints = [
      [10.0220, 78.1220],
      [10.0225, 78.1228],
      [10.0230, 78.1230],
      [10.0234, 78.1234],
      [10.0240, 78.1237],
      [10.0248, 78.1233],
      [10.0254, 78.1225],
      [10.0260, 78.1235],
      [10.0255, 78.1245]
    ];

    searchPathLine = L.polyline(waypoints, {
      color: '#00d2ff',
      weight: 2.5,
      dashArray: '6, 6',
      opacity: 0.85
    }).addTo(map);

    // 2. No-Fly Zone (Red hatched polygon)
    const noFlyCoords = [
      [10.0252, 78.1245],
      [10.0265, 78.1258],
      [10.0250, 78.1268],
      [10.0240, 78.1252]
    ];

    noFlyPolygon = L.polygon(noFlyCoords, {
      color: '#ff3b56',
      weight: 2,
      fillColor: '#ff3b56',
      fillOpacity: 0.25,
      dashArray: '4, 4'
    }).addTo(map);
    noFlyPolygon.bindTooltip("RESTRICTED AIRSPACE: Sector B Collapse Hazard", {
      className: 'tactical-map-tooltip'
    });

    // 3. Drone Marker (Pulsing blue directional icon)
    const droneIcon = L.divIcon({
      className: 'leaflet-drone-icon',
      html: `
        <div style="position:relative; width:36px; height:36px; display:flex; align-items:center; justify-content:center;">
          <svg class="drone-leaflet-svg" width="32" height="32" viewBox="0 0 40 40">
            <polygon points="20,4 36,36 20,28 4,36" fill="#00e5ff" stroke="#ffffff" stroke-width="2"/>
            <circle cx="20" cy="20" r="3" fill="#ffffff"/>
          </svg>
          <div style="position:absolute; width:44px; height:44px; border:2px solid #00d2ff; border-radius:50%; animation:marker-pulse 1.8s infinite;"></div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
    droneMarker = L.marker([10.0234, 78.1234], { icon: droneIcon, zIndexOffset: 1000 }).addTo(map);

    // 4. Detected Victims Pins (#001, #002, #003)
    const victims = [
      { id: '#001', lat: 10.0234, lon: 78.1234, label: 'Victim #001 (Possible Survivor)', conf: '96%' },
      { id: '#002', lat: 10.0241, lon: 78.1239, label: 'Victim #002 (Signal Detected)', conf: '92%' },
      { id: '#003', lat: 10.0250, lon: 78.1228, label: 'Victim #003 (Trapped)', conf: '88%' }
    ];

    victims.forEach(v => {
      const vIcon = L.divIcon({
        className: 'victim-leaflet-marker',
        html: `
          <div style="position:relative; width:28px; height:28px; display:flex; align-items:center; justify-content:center;">
            <div class="victim-pulse-ring"></div>
            <div style="width:20px; height:20px; background:#ff3b56; border:2px solid #ffffff; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 8px #ff3b56;">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="#ffffff">
                <circle cx="12" cy="7" r="5"/>
                <path d="M12 13c-5 0-9 4-9 9h18c0-5-4-9-9-9z"/>
              </svg>
            </div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const m = L.marker([v.lat, v.lon], { icon: vIcon }).addTo(map);
      m.bindTooltip(`<strong>${v.id}</strong>: ${v.label} (${v.conf})`);
      m.on('click', () => {
        if (window.DetectionsManager) {
          window.DetectionsManager.selectTarget(v.id);
        }
      });
      victimMarkers[v.id] = m;
    });

    // 5. Hazards Pins (#004, #005)
    const hazards = [
      { id: '#004', lat: 10.0230, lon: 78.1243, label: 'Hazard #004 (Structural Debris)' },
      { id: '#005', lat: 10.0248, lon: 78.1231, label: 'Hazard #005 (Gas Leak Threat)' }
    ];

    hazards.forEach(h => {
      const hIcon = L.divIcon({
        className: 'hazard-leaflet-marker',
        html: `
          <div style="width:22px; height:22px; background:#ffaa00; border:2px solid #ffffff; border-radius:4px; display:flex; align-items:center; justify-content:center; box-shadow:0 0 8px #ffaa00; transform: rotate(45deg);">
            <span style="transform: rotate(-45deg); font-weight:bold; font-size:12px; color:#06101d;">!</span>
          </div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      const m = L.marker([h.lat, h.lon], { icon: hIcon }).addTo(map);
      m.bindTooltip(`<strong>${h.id}</strong>: ${h.label}`);
      m.on('click', () => {
        if (window.DetectionsManager) {
          window.DetectionsManager.selectTarget(h.id);
        }
      });
      hazardMarkers[h.id] = m;
    });

    // 6. Rescue Location Marker (Green Pin)
    const rescueIcon = L.divIcon({
      className: 'rescue-leaflet-marker',
      html: `
        <div style="width:22px; height:22px; background:#00e676; border:2px solid #ffffff; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 10px #00e676;">
          <div style="width:8px; height:8px; background:#04140b; border-radius:50%;"></div>
        </div>
      `,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
    L.marker([10.0235, 78.1236], { icon: rescueIcon }).addTo(map)
      .bindTooltip("<strong>Primary Rescue Staging Point</strong>");
  }

  function setupControls() {
    // Zoom In
    const zoomInBtn = document.getElementById('mapZoomInBtn');
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        if (map && isVisible()) map.zoomIn();
      });
    }

    // Zoom Out
    const zoomOutBtn = document.getElementById('mapZoomOutBtn');
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        if (map && isVisible()) map.zoomOut();
      });
    }

    // Recenter on Drone
    const recenterBtn = document.getElementById('mapRecenterBtn');
    if (recenterBtn) {
      recenterBtn.addEventListener('click', () => {
        if (map && isVisible() && droneMarker) {
          map.panTo(droneMarker.getLatLng(), { animate: true });
        }
      });
    }
  }

  function updateDronePosition(lat, lon, heading) {
    if (!droneMarker) return;
    droneMarker.setLatLng([lat, lon]);
    
    // Rotate drone marker icon
    const el = droneMarker.getElement();
    if (el) {
      const svg = el.querySelector('.drone-leaflet-svg');
      if (svg) {
        svg.style.transform = `rotate(${heading || 0}deg)`;
      }
    }
  }

  function panToLocation(lat, lon) {
    if (map) {
      map.flyTo([lat, lon], 18, { duration: 1.2 });
    }
  }

  function invalidateSize() {
    if (map) {
      setTimeout(() => map.invalidateSize(), 50);
    }
  }

  function isVisible() {
    const el = document.getElementById('map2D');
    return el && el.classList.contains('active');
  }

  function addVictimMarker(v) {
    if (!map || !v.lat || !v.lon) return;
    const vId = v.id || `#${v.victim_id}`;
    if (victimMarkers[vId]) {
      victimMarkers[vId].setLatLng([v.lat, v.lon]);
      return;
    }

    const isCritical = (v.priority === 'CRITICAL');
    const color = isCritical ? '#ff1744' : '#ff3b56';

    const vIcon = L.divIcon({
      className: 'victim-leaflet-marker',
      html: `
        <div style="position:relative; width:32px; height:32px; display:flex; align-items:center; justify-content:center;">
          <div class="victim-pulse-ring" style="border-color:${color};"></div>
          <div style="width:22px; height:22px; background:${color}; border:2px solid #ffffff; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 12px ${color};">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#ffffff">
              <circle cx="12" cy="7" r="5"/>
              <path d="M12 13c-5 0-9 4-9 9h18c0-5-4-9-9-9z"/>
            </svg>
          </div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const m = L.marker([v.lat, v.lon], { icon: vIcon }).addTo(map);
    m.bindTooltip(`<strong>${vId}</strong>: ${v.label || 'Person (Victim)'} (${v.confidence || 94}% - ${v.priority || 'HIGH'})`);
    m.on('click', () => {
      if (window.DetectionsManager) {
        window.DetectionsManager.selectTarget(vId);
      }
    });
    victimMarkers[vId] = m;
  }

  function clearVictimMarkers() {
    if (!map) return;
    Object.keys(victimMarkers).forEach(id => {
      if (victimMarkers[id]) {
        map.removeLayer(victimMarkers[id]);
        delete victimMarkers[id];
      }
    });
    Object.keys(hazardMarkers).forEach(id => {
      if (hazardMarkers[id]) {
        map.removeLayer(hazardMarkers[id]);
        delete hazardMarkers[id];
      }
    });
  }

  function showWorldView() {
    if (!map) return;
    map.setView([20, 0], 2);
    if (window.showToast) window.showToast('2D Map: Whole World Satellite View');
  }

  function showLocalView() {
    if (!map) return;
    map.setView(CENTER, 17);
    if (window.showToast) window.showToast('2D Map: Local Tactical Aerial View');
  }

  return {
    init,
    updateDronePosition,
    panToLocation,
    showWorldView,
    showLocalView,
    invalidateSize,
    addVictimMarker,
    clearVictimMarkers
  };
})();
