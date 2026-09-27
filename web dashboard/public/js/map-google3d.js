/**
 * AEROSIGHT - Google 3D Satellite Map Module
 * Pure Google Maps JavaScript API (Satellite / Hybrid 3D Aerial View)
 * Direct Google Earth / Google Maps 3D experience with:
 * 1. Native Google Photorealistic Satellite & Hybrid imagery with roads, buildings, & labels
 * 2. 3D oblique tilt (45°-67.5°) & 360° compass heading rotation
 * 3. Intuitive Place Marking ("Mark the Place") with custom tactical categories
 * 4. Place Search (Google Geocoder + Coordinates search)
 * 5. Autonomous Survey Area perimeter polygon with live area calculation
 * 6. Real-time Drone Telemetry tracking & radar sweep on Google Satellite
 * 7. AI Victim Detections plotting with target detail sync
 */

const MapGoogle3DManager = (function () {
  let googleMap = null;
  let isMapInitialized = false;
  let googleDroneMarker = null;
  let userGpsMarker = null;

  // Viewport State
  let currentCenter = { lat: 10.0235, lng: 78.1236 }; // Madurai Disaster Sector B default
  let currentZoom = 17;
  let currentTilt = 45; // 3D oblique tilt
  let currentHeading = 35; // Compass heading
  let currentMapTypeId = 'hybrid'; // 'hybrid': Google Satellite with roads & labels

  // Place Marking State
  let isMarkingMode = false;
  let markedPlaces = []; // Array of { id, name, category, lat, lng, alt, notes, timestamp, gMarker, infoWindow }
  let pendingCoords = null;

  // Area Perimeter Marking State
  let isAreaMarkingMode = false;
  let areaPoints = []; // Array of google.maps.LatLng
  let areaMarkers = [];
  let areaPolygon = null;

  // Victim Detections Markers
  const victimMarkers = {};

  // Tactical Search Flight Path Polyline
  let flightPathLine = null;

  // Category Configuration
  const CATEGORIES = {
    victim: { label: 'Survivor / Victim', icon: '🚨', color: '#ff3b56', pinColor: '#ff3b56' },
    hazard: { label: 'Hazard / Danger', icon: '⚠️', color: '#ffb300', pinColor: '#ffb300' },
    dropzone: { label: 'Rescue Drop Zone / LZ', icon: '🎯', color: '#00ff66', pinColor: '#00ff66' },
    base: { label: 'Base Camp / Medical', icon: '⛺', color: '#00d2ff', pinColor: '#00d2ff' },
    waypoint: { label: 'Tactical Waypoint', icon: '📍', color: '#00e5ff', pinColor: '#00e5ff' }
  };

  // =========================================================================
  // 1. INITIALIZATION & SCRIPT LOADER
  // =========================================================================
  function init() {
    const container = document.getElementById('google3dMap');
    if (!container) return;

    loadStoredPlaces();
    setupDOMControls();

    // Check if Google Maps JS API is already loaded in page
    if (window.google && window.google.maps) {
      buildGoogleMap();
    } else {
      loadGoogleMapsApiScript();
    }

    setupDroneTelemetry();
  }

  function loadGoogleMapsApiScript() {
    const existing = document.getElementById('googleMapsApiScript');
    if (existing) {
      existing.addEventListener('load', buildGoogleMap);
      return;
    }

    const apiKey = localStorage.getItem('aerosight_google_api_key') || '';
    const script = document.createElement('script');
    script.id = 'googleMapsApiScript';
    script.async = true;
    script.defer = true;
    
    // Load official Google Maps API with places, geometry, and drawing libraries
    let apiUrl = 'https://maps.googleapis.com/maps/api/js?v=weekly&libraries=places,geometry,drawing';
    if (apiKey) {
      apiUrl += `&key=${encodeURIComponent(apiKey)}`;
    }
    apiUrl += '&callback=initGoogle3DMapCallback';

    window.initGoogle3DMapCallback = () => {
      buildGoogleMap();
    };

    script.src = apiUrl;
    script.onerror = () => {
      console.warn('[Google3D] Google Maps script loading error.');
      if (window.showToast) {
        window.showToast('⚠️ Google Maps API failed to load. Check internet or API key.');
      }
    };

    document.head.appendChild(script);
  }

  function buildGoogleMap() {
    const container = document.getElementById('google3dMap');
    if (!container || googleMap) return;

    try {
      googleMap = new google.maps.Map(container, {
        center: currentCenter,
        zoom: currentZoom,
        mapTypeId: google.maps.MapTypeId.HYBRID, // Real Google Satellite with roads, building outlines & place names
        tilt: currentTilt, // 3D oblique tilt (Google Earth style)
        heading: currentHeading,
        rotateControl: true,
        tiltControl: true,
        zoomControl: true,
        mapTypeControl: true,
        mapTypeControlOptions: {
          style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
          position: google.maps.ControlPosition.TOP_RIGHT,
          mapTypeIds: [
            google.maps.MapTypeId.HYBRID,
            google.maps.MapTypeId.SATELLITE,
            google.maps.MapTypeId.ROADMAP,
            google.maps.MapTypeId.TERRAIN
          ]
        },
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'greedy'
      });

      isMapInitialized = true;

      // Event Listeners on Google Map
      setupMapEventListeners();
      setupDroneMarker();
      setupDefaultSearchPath();
      renderAllMarkedPlaces();
      updateCompassDial();

      // Auto-locate user on startup
      setTimeout(() => {
        locateUser(false);
      }, 1000);

      if (window.showToast) {
        window.showToast('🌍 Google Maps 3D Satellite Connected (Photorealistic Earth Mode)');
      }
    } catch (err) {
      console.error('[Google3D] Error building Google Map:', err);
    }
  }

  // =========================================================================
  // 2. MAP EVENT LISTENERS
  // =========================================================================
  function setupMapEventListeners() {
    if (!googleMap) return;

    // Click on map
    googleMap.addListener('click', (event) => {
      const lat = event.latLng.lat();
      const lng = event.latLng.lng();

      if (isAreaMarkingMode) {
        addAreaPoint(lat, lng);
        return;
      }

      if (isMarkingMode) {
        openPlaceCreationModal(lat, lng);
        setMarkingMode(false);
        return;
      }
    });

    // Compass & Heading tracking
    googleMap.addListener('heading_changed', updateCompassDial);
    googleMap.addListener('tilt_changed', updateTiltStatus);
    googleMap.addListener('center_changed', updateOsdCoordinates);

    googleMap.addListener('mousemove', (event) => {
      const coordsEl = document.getElementById('mapCursorCoords');
      if (coordsEl && event.latLng) {
        coordsEl.textContent = `${event.latLng.lat().toFixed(5)}° N, ${event.latLng.lng().toFixed(5)}° E`;
      }
    });
  }

  // =========================================================================
  // 3. PLACE MARKING IMPLEMENTATION ("MARK THE PLACE")
  // =========================================================================
  function setMarkingMode(enabled) {
    isMarkingMode = enabled;
    isAreaMarkingMode = false;

    const btn = document.getElementById('btnMarkPlaceMode');
    const banner = document.getElementById('markingModeBanner');
    const container = document.getElementById('google3dMap');

    if (isMarkingMode) {
      if (btn) btn.classList.add('active');
      if (banner) {
        banner.style.display = 'flex';
        const txt = document.getElementById('markingBannerText');
        if (txt) txt.textContent = 'MARKING MODE ACTIVE: Click anywhere on Google Satellite to place a marker.';
      }
      if (container) container.style.cursor = 'crosshair';
      if (window.showToast) window.showToast('📍 Click anywhere on the Google Satellite Map to mark a place.');
    } else {
      if (btn) btn.classList.remove('active');
      if (!isAreaMarkingMode && banner) banner.style.display = 'none';
      if (container) container.style.cursor = '';
    }
  }

  function setAreaMarkingMode(enabled) {
    isAreaMarkingMode = enabled;
    isMarkingMode = false;

    const btn = document.getElementById('btnMarkAreaMode');
    const banner = document.getElementById('markingModeBanner');
    const container = document.getElementById('google3dMap');

    if (isAreaMarkingMode) {
      if (btn) btn.classList.add('active');
      if (banner) {
        banner.style.display = 'flex';
        const txt = document.getElementById('markingBannerText');
        if (txt) txt.textContent = 'SURVEY AREA MODE: Click 3+ points on Google Map to outline search perimeter.';
      }
      if (container) container.style.cursor = 'crosshair';
      if (window.showToast) window.showToast('📐 Click 3 or more points on Google Satellite to outline survey boundary.');
    } else {
      if (btn) btn.classList.remove('active');
      if (!isMarkingMode && banner) banner.style.display = 'none';
      if (container) container.style.cursor = '';
    }
  }

  function openPlaceCreationModal(lat, lng) {
    pendingCoords = { lat, lng };

    const modal = document.getElementById('placeMarkingModal');
    const inputName = document.getElementById('inpPlaceName');
    const inputCoords = document.getElementById('inpPlaceCoords');
    const inputNotes = document.getElementById('inpPlaceNotes');
    const catSelect = document.getElementById('selPlaceCategory');

    if (!modal) return;

    if (inputName) inputName.value = `Site #${markedPlaces.length + 1}`;
    if (inputCoords) inputCoords.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    if (inputNotes) inputNotes.value = '';
    if (catSelect) catSelect.value = 'victim';

    modal.classList.add('show');
    if (inputName) setTimeout(() => inputName.focus(), 100);

    // Google Geocoder reverse lookup for place name
    if (window.google && google.maps && google.maps.Geocoder) {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status === 'OK' && results && results[0] && inputName && inputName.value.startsWith('Site #')) {
          const parts = results[0].formatted_address.split(',');
          inputName.value = parts.slice(0, 2).join(', ').trim();
        }
      });
    }
  }

  function savePendingPlace() {
    if (!pendingCoords) return;

    const inputName = document.getElementById('inpPlaceName');
    const catSelect = document.getElementById('selPlaceCategory');
    const inputNotes = document.getElementById('inpPlaceNotes');
    const modal = document.getElementById('placeMarkingModal');

    const name = (inputName && inputName.value.trim()) || `Marked Site #${markedPlaces.length + 1}`;
    const category = (catSelect && catSelect.value) || 'waypoint';
    const notes = (inputNotes && inputNotes.value.trim()) || '';

    const newPlace = {
      id: 'PL-' + Date.now().toString(36).toUpperCase(),
      name: name,
      category: category,
      lat: pendingCoords.lat,
      lng: pendingCoords.lng,
      alt: 35,
      notes: notes,
      timestamp: new Date().toLocaleTimeString()
    };

    markedPlaces.push(newPlace);
    saveStoredPlaces();
    renderPlaceMarker(newPlace);
    updateMarkedPlacesDrawer();

    if (modal) modal.classList.remove('show');
    pendingCoords = null;

    if (window.showToast) {
      window.showToast(`✅ Place Marked on Google Satellite: "${name}"`);
    }
  }

  function createMarkerIcon(category) {
    const cat = CATEGORIES[category] || CATEGORIES.waypoint;
    // SVG Pin Symbol for Google Maps
    return {
      path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
      fillColor: cat.color,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 1.8,
      scale: 1.5,
      anchor: new google.maps.Point(12, 22)
    };
  }

  function renderPlaceMarker(place) {
    if (!googleMap) return;

    const cat = CATEGORIES[place.category] || CATEGORIES.waypoint;
    const pos = { lat: place.lat, lng: place.lng };

    const marker = new google.maps.Marker({
      position: pos,
      map: googleMap,
      title: place.name,
      icon: createMarkerIcon(place.category),
      animation: google.maps.Animation.DROP
    });

    const infoContent = `
      <div style="padding: 6px; font-family: 'Inter', sans-serif; color: #040810; max-width: 250px;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px; border-bottom: 2px solid ${cat.color}; padding-bottom: 4px;">
          <span style="font-size: 16px;">${cat.icon}</span>
          <div>
            <strong style="font-size: 13px; color: #0a182c; display: block;">${place.name}</strong>
            <span style="font-size: 10.5px; font-weight: 700; color: ${cat.color};">${cat.label}</span>
          </div>
        </div>
        <div style="font-size: 11px; margin-bottom: 4px; color: #334155;">
          <strong>COORDS:</strong> ${place.lat.toFixed(6)}° N, ${place.lng.toFixed(6)}° E
        </div>
        ${place.notes ? `<div style="font-size: 11px; margin-bottom: 6px; color: #475569;"><em>${place.notes}</em></div>` : ''}
        <div style="display: flex; gap: 6px; margin-top: 8px;">
          <button onclick="MapGoogle3DManager.flyToPlace('${place.id}')" style="flex: 1; background: #0066cc; color: #fff; border: none; border-radius: 4px; padding: 4px 6px; font-size: 10.5px; font-weight: 600; cursor: pointer;">🎯 Fly Here</button>
          <button onclick="MapGoogle3DManager.deletePlace('${place.id}')" style="background: #e11d48; color: #fff; border: none; border-radius: 4px; padding: 4px 6px; font-size: 10.5px; font-weight: 600; cursor: pointer;">🗑️ Del</button>
        </div>
      </div>
    `;

    const infoWindow = new google.maps.InfoWindow({ content: infoContent });

    marker.addListener('click', () => {
      infoWindow.open(googleMap, marker);
    });

    place.gMarker = marker;
    place.infoWindow = infoWindow;
  }

  function renderAllMarkedPlaces() {
    markedPlaces.forEach(p => renderPlaceMarker(p));
    updateMarkedPlacesDrawer();
  }

  function flyToPlace(id) {
    const p = markedPlaces.find(x => x.id === id);
    if (!p || !googleMap) return;

    googleMap.panTo({ lat: p.lat, lng: p.lng });
    googleMap.setZoom(18);
    googleMap.setTilt(45);

    if (p.infoWindow && p.gMarker) {
      p.infoWindow.open(googleMap, p.gMarker);
    }
  }

  function deletePlace(id) {
    const idx = markedPlaces.findIndex(x => x.id === id);
    if (idx === -1) return;

    const p = markedPlaces[idx];
    if (p.gMarker) p.gMarker.setMap(null);
    if (p.infoWindow) p.infoWindow.close();
    markedPlaces.splice(idx, 1);
    saveStoredPlaces();
    updateMarkedPlacesDrawer();

    if (window.showToast) {
      window.showToast(`🗑️ Removed mark: "${p.name}"`);
    }
  }

  function clearAllMarks() {
    if (markedPlaces.length === 0) return;
    if (!confirm('Are you sure you want to clear all marked places?')) return;

    markedPlaces.forEach(p => {
      if (p.gMarker) p.gMarker.setMap(null);
      if (p.infoWindow) p.infoWindow.close();
    });
    markedPlaces = [];
    saveStoredPlaces();
    updateMarkedPlacesDrawer();

    if (window.showToast) window.showToast('Cleared all marked places.');
  }

  function saveStoredPlaces() {
    try {
      const serializable = markedPlaces.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        lat: p.lat,
        lng: p.lng,
        alt: p.alt,
        notes: p.notes,
        timestamp: p.timestamp
      }));
      localStorage.setItem('aerosight_google3d_places', JSON.stringify(serializable));
    } catch (e) {}
  }

  function loadStoredPlaces() {
    try {
      const saved = localStorage.getItem('aerosight_google3d_places');
      if (saved) {
        markedPlaces = JSON.parse(saved);
      }
    } catch (e) {
      markedPlaces = [];
    }

    if (!markedPlaces || markedPlaces.length === 0) {
      markedPlaces = [
        {
          id: 'PL-INIT-1',
          name: 'Sector B-2 Collapsed Building',
          category: 'victim',
          lat: 10.0235,
          lng: 78.1236,
          alt: 35,
          notes: 'Trapped survivor detected by thermal sensor under rubble.',
          timestamp: 'Initial Detection'
        },
        {
          id: 'PL-INIT-2',
          name: 'Forward Medical Assembly Zone',
          category: 'base',
          lat: 10.0210,
          lng: 78.1210,
          alt: 30,
          notes: 'Ambulance triage center positioned.',
          timestamp: 'Staging'
        },
        {
          id: 'PL-INIT-3',
          name: 'Gas Pipeline Rupture Hazard',
          category: 'hazard',
          lat: 10.0258,
          lng: 78.1245,
          alt: 40,
          notes: 'High combustible gas plume. Avoid low-altitude passes.',
          timestamp: 'Hazmat Alert'
        }
      ];
      saveStoredPlaces();
    }
  }

  function updateMarkedPlacesDrawer() {
    const listEl = document.getElementById('markedPlacesList');
    const countBadge = document.getElementById('markedPlacesCount');
    if (countBadge) countBadge.textContent = markedPlaces.length;

    if (!listEl) return;

    if (markedPlaces.length === 0) {
      listEl.innerHTML = `
        <div class="places-empty-state">
          <span style="font-size: 22px;">📍</span>
          <div>No places marked yet.</div>
          <small>Click "Mark Place" above, then click anywhere on the Google 3D Satellite view to drop a pin.</small>
        </div>
      `;
      return;
    }

    listEl.innerHTML = markedPlaces.map(p => {
      const cat = CATEGORIES[p.category] || CATEGORIES.waypoint;
      return `
        <div class="place-list-item" onclick="MapGoogle3DManager.flyToPlace('${p.id}')">
          <div class="place-item-icon" style="color: ${cat.color};">${cat.icon}</div>
          <div class="place-item-details">
            <div class="place-item-title">${p.name}</div>
            <div class="place-item-sub">
              <span class="place-cat-tag" style="background: ${cat.color}22; color: ${cat.color}; border: 1px solid ${cat.color}44;">${cat.label}</span>
              <span>${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</span>
            </div>
          </div>
          <button class="place-item-del-btn" title="Delete Mark" onclick="event.stopPropagation(); MapGoogle3DManager.deletePlace('${p.id}')">×</button>
        </div>
      `;
    }).join('');
  }

  // =========================================================================
  // 4. AUTONOMOUS SURVEY AREA & FLIGHT PATH
  // =========================================================================
  function addAreaPoint(lat, lng) {
    if (!googleMap) return;
    const latLng = new google.maps.LatLng(lat, lng);
    areaPoints.push(latLng);

    // Add visual vertex marker
    const marker = new google.maps.Marker({
      position: latLng,
      map: googleMap,
      label: {
        text: String(areaPoints.length),
        color: '#ffffff',
        fontWeight: 'bold'
      },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 11,
        fillColor: '#00d2ff',
        fillOpacity: 0.9,
        strokeColor: '#ffffff',
        strokeWeight: 2
      }
    });

    areaMarkers.push(marker);
    updateAreaPolygon();

    if (window.showToast) {
      window.showToast(`Boundary vertex #${areaPoints.length} placed on Google Satellite.`);
    }
  }

  function updateAreaPolygon() {
    if (!googleMap) return;

    if (areaPolygon) {
      areaPolygon.setMap(null);
      areaPolygon = null;
    }

    if (areaPoints.length < 3) return;

    areaPolygon = new google.maps.Polygon({
      paths: areaPoints,
      strokeColor: '#00e5ff',
      strokeOpacity: 0.9,
      strokeWeight: 2.5,
      fillColor: '#00d2ff',
      fillOpacity: 0.22,
      map: googleMap
    });

    // Calculate Area
    if (google.maps.geometry && google.maps.geometry.spherical) {
      const areaSqM = google.maps.geometry.spherical.computeArea(areaPolygon.getPath());
      const areaEl = document.getElementById('surveyAreaMetrics');
      if (areaEl) {
        if (areaSqM > 10000) {
          areaEl.textContent = `${(areaSqM / 1000000).toFixed(2)} km²`;
        } else {
          areaEl.textContent = `${Math.round(areaSqM)} m²`;
        }
      }
    }
  }

  function clearAreaBoundary() {
    areaMarkers.forEach(m => m.setMap(null));
    areaMarkers = [];
    areaPoints = [];
    if (areaPolygon) {
      areaPolygon.setMap(null);
      areaPolygon = null;
    }
    const areaEl = document.getElementById('surveyAreaMetrics');
    if (areaEl) areaEl.textContent = '0 m²';
    setAreaMarkingMode(false);
    if (window.showToast) window.showToast('Survey perimeter cleared.');
  }

  function setupDefaultSearchPath() {
    if (!googleMap) return;

    const pathCoords = [
      { lat: 10.0215, lng: 78.1210 },
      { lat: 10.0255, lng: 78.1215 },
      { lat: 10.0258, lng: 78.1245 },
      { lat: 10.0218, lng: 78.1242 },
      { lat: 10.0235, lng: 78.1265 },
      { lat: 10.0210, lng: 78.1210 }
    ];

    flightPathLine = new google.maps.Polyline({
      path: pathCoords,
      geodesic: true,
      strokeColor: '#00ffff',
      strokeOpacity: 0.85,
      strokeWeight: 2.5,
      map: googleMap
    });
  }

  // =========================================================================
  // 5. LOCATION SEARCH (GEOCODER)
  // =========================================================================
  function searchLocation(query) {
    if (!query || !query.trim() || !googleMap) return;
    const q = query.trim();

    // Check if raw coordinates
    const coordMatch = q.match(/^([-+]?\d{1,2}(?:\.\d+)?)[,\s]+([-+]?\d{1,3}(?:\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        googleMap.panTo({ lat, lng });
        googleMap.setZoom(17);
        googleMap.setTilt(45);
        if (window.showToast) window.showToast(`🎯 Swooped to coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        return;
      }
    }

    if (window.showToast) window.showToast(`🔍 Searching Google Maps for "${q}"...`);

    if (window.google && google.maps && google.maps.Geocoder) {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address: q }, (results, status) => {
        if (status === 'OK' && results && results[0]) {
          const loc = results[0].geometry.location;
          googleMap.panTo(loc);
          googleMap.setZoom(17);
          googleMap.setTilt(45);
          if (window.showToast) {
            window.showToast(`🎯 Found: ${results[0].formatted_address.split(',').slice(0, 2).join(', ')}`);
          }
        } else {
          // Fallback to OSM Nominatim
          fallbackSearch(q);
        }
      });
    } else {
      fallbackSearch(q);
    }
  }

  async function fallbackSearch(q) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`);
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        googleMap.panTo({ lat, lng });
        googleMap.setZoom(17);
        googleMap.setTilt(45);
        if (window.showToast) {
          window.showToast(`🎯 Found: ${data[0].display_name.split(',').slice(0, 2).join(', ')}`);
        }
      } else {
        if (window.showToast) window.showToast(`Location "${q}" not found.`);
      }
    } catch (e) {
      if (window.showToast) window.showToast('Search network error.');
    }
  }

  // =========================================================================
  // 6. USER GEOLOCATION ("🎯 MY LOCATION")
  // =========================================================================
  function locateUser(showToastMsg = true) {
    if (showToastMsg && window.showToast) {
      window.showToast('📡 Detecting device GPS for Google Satellite...');
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          onUserLocationFound(lat, lng, 'Device GPS');
        },
        (err) => {
          console.warn('[Google3D] Geolocation error, checking IP fallback...', err);
          fallbackIpLocation();
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    } else {
      fallbackIpLocation();
    }
  }

  async function fallbackIpLocation() {
    try {
      const res = await fetch('https://ipapi.co/json/');
      if (res.ok) {
        const data = await res.json();
        if (data.latitude && data.longitude) {
          onUserLocationFound(data.latitude, data.longitude, `${data.region || 'Local Area'}`);
          return;
        }
      }
    } catch (e) {}
  }

  function onUserLocationFound(lat, lng, label) {
    currentCenter = { lat, lng };

    if (!userGpsMarker && googleMap) {
      userGpsMarker = new google.maps.Marker({
        position: currentCenter,
        map: googleMap,
        title: 'My Location',
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: '#00ff66',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2
        }
      });
    } else if (userGpsMarker) {
      userGpsMarker.setPosition(currentCenter);
    }

    if (googleMap) {
      googleMap.panTo(currentCenter);
      googleMap.setZoom(17);
      googleMap.setTilt(45);
    }

    updateDronePosition(lat, lng, 0, 35);

    if (window.showToast) {
      window.showToast(`🎯 Google 3D Satellite centered on ${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E (${label})`);
    }
  }

  // =========================================================================
  // 7. 3D CAMERA CONTROLS (TILT & COMPASS HEADING)
  // =========================================================================
  function toggleTilt() {
    if (!googleMap) return;
    const current = googleMap.getTilt();
    const newTilt = current > 20 ? 0 : 45;
    googleMap.setTilt(newTilt);
    updateTiltStatus();

    if (window.showToast) {
      window.showToast(`Google 3D Satellite: Camera tilt set to ${newTilt === 0 ? 'Top-Down (2D 0°)' : 'Google Earth 3D Oblique (45°)'}`);
    }
  }

  function updateTiltStatus() {
    if (!googleMap) return;
    const t = googleMap.getTilt();
    const btn = document.getElementById('btnToggle3DTilt');
    if (btn) {
      btn.innerHTML = t > 20
        ? '<span style="font-weight: 700; color: #00ffff;">3D (45°)</span>'
        : '<span style="color: var(--text-muted);">2D (0°)</span>';
    }
  }

  function resetNorth() {
    if (!googleMap) return;
    googleMap.setHeading(0);
    updateCompassDial();
    if (window.showToast) window.showToast('🧭 Google Map reset to True North');
  }

  function updateCompassDial() {
    if (!googleMap) return;
    const heading = googleMap.getHeading() || 0;
    const dial = document.getElementById('mapCompassNeedle');
    if (dial) {
      dial.style.transform = `rotate(${-heading}deg)`;
    }
  }

  function toggleFullscreen() {
    const card = document.querySelector('.live-map-card');
    if (!card) return;

    card.classList.toggle('map-fullscreen-active');
    const btn = document.getElementById('btnMapFullscreen');
    if (btn) {
      const isFull = card.classList.contains('map-fullscreen-active');
      btn.title = isFull ? 'Exit Fullscreen' : 'Expand Fullscreen';
      btn.innerHTML = isFull
        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`
        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
    }

    setTimeout(() => {
      resize();
    }, 200);
  }

  // =========================================================================
  // 8. LIVE DRONE TELEMETRY TRACKER
  // =========================================================================
  function setupDroneMarker() {
    if (!googleMap || googleDroneMarker) return;

    // Tactical Drone SVG Icon
    const droneSvg = {
      path: 'M20 4L34 32L24 28L20 20L16 28L6 32L20 4Z',
      fillColor: '#00d2ff',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
      scale: 0.85,
      anchor: new google.maps.Point(20, 20),
      rotation: currentHeading
    };

    googleDroneMarker = new google.maps.Marker({
      position: currentCenter,
      map: googleMap,
      icon: droneSvg,
      title: 'AEROSIGHT UAV-1'
    });
  }

  function updateDronePosition(lat, lon, heading, alt) {
    if (!lat || !lon) return;

    currentCenter = { lat, lng: lon };

    if (googleDroneMarker) {
      googleDroneMarker.setPosition(currentCenter);

      if (heading !== undefined) {
        const icon = googleDroneMarker.getIcon();
        if (icon && typeof icon === 'object') {
          icon.rotation = heading;
          googleDroneMarker.setIcon(icon);
        }
      }
    }

    updateOsdCoordinates();
  }

  function recenterOnDrone() {
    if (!googleMap) return;
    googleMap.panTo(currentCenter);
    googleMap.setZoom(17);
    googleMap.setTilt(45);
    if (window.showToast) window.showToast('🎯 Centered on Drone (AEROSIGHT UAV-1)');
  }

  function setupDroneTelemetry() {
    if (window.TelemetryManager) {
      TelemetryManager.onUpdate((data) => {
        updateDronePosition(data.lat, data.lon, data.heading, data.altitude);
      });
    }
  }

  function updateOsdCoordinates() {
    const coordsEl = document.getElementById('satOsdCoords');
    if (coordsEl && currentCenter) {
      coordsEl.textContent = `${currentCenter.lat.toFixed(5)}° N, ${currentCenter.lng.toFixed(5)}° E`;
    }
  }

  // =========================================================================
  // 9. AI VICTIMS & TARGETS INTEGRATION
  // =========================================================================
  function addVictimMarker(det) {
    if (!googleMap || !det.id) return;

    const lat = det.lat || (currentCenter.lat + (Math.random() - 0.5) * 0.003);
    const lng = det.lon || (currentCenter.lng + (Math.random() - 0.5) * 0.003);

    if (victimMarkers[det.id]) {
      victimMarkers[det.id].setPosition({ lat, lng });
      return;
    }

    const victimPin = {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: '#ff3b56',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2
    };

    const marker = new google.maps.Marker({
      position: { lat, lng },
      map: googleMap,
      title: `Victim ${det.id}`,
      icon: victimPin,
      animation: google.maps.Animation.BOUNCE
    });

    // Stop bounce after 2 seconds
    setTimeout(() => {
      marker.setAnimation(null);
    }, 2000);

    marker.addListener('click', () => {
      if (window.TargetDetailsManager) {
        TargetDetailsManager.showTarget(det.id);
      }
    });

    victimMarkers[det.id] = marker;
  }

  function clearVictimMarkers() {
    Object.keys(victimMarkers).forEach(id => {
      victimMarkers[id].setMap(null);
      delete victimMarkers[id];
    });
  }

  function focusTarget(lat, lon) {
    if (!googleMap || !lat || !lon) return;
    googleMap.panTo({ lat, lng: lon });
    googleMap.setZoom(18);
    googleMap.setTilt(45);
  }

  // =========================================================================
  // 10. DOM EVENT WIRING
  // =========================================================================
  function setupDOMControls() {
    // 1. Mark Place Toggle
    const btnMark = document.getElementById('btnMarkPlaceMode');
    if (btnMark) {
      btnMark.addEventListener('click', () => setMarkingMode(!isMarkingMode));
    }

    // 2. Area Marking Toggle
    const btnArea = document.getElementById('btnMarkAreaMode');
    if (btnArea) {
      btnArea.addEventListener('click', () => setAreaMarkingMode(!isAreaMarkingMode));
    }

    // 3. Clear Area Button
    const btnClearArea = document.getElementById('btnClearAreaBtn');
    if (btnClearArea) {
      btnClearArea.addEventListener('click', clearAreaBoundary);
    }

    // 4. Modal Save & Cancel
    const btnSavePlace = document.getElementById('btnSavePlaceModal');
    if (btnSavePlace) {
      btnSavePlace.addEventListener('click', savePendingPlace);
    }

    const btnCloseModal = document.getElementById('btnClosePlaceModal');
    const btnCancelModal = document.getElementById('btnCancelPlaceModal');
    const modal = document.getElementById('placeMarkingModal');
    [btnCloseModal, btnCancelModal].forEach(b => {
      if (b && modal) {
        b.addEventListener('click', () => modal.classList.remove('show'));
      }
    });

    // 5. Drawer Toggle
    const btnToggleDrawer = document.getElementById('btnTogglePlacesDrawer');
    const drawer = document.getElementById('markedPlacesDrawer');
    if (btnToggleDrawer && drawer) {
      btnToggleDrawer.addEventListener('click', () => drawer.classList.toggle('open'));
    }

    const btnCloseDrawer = document.getElementById('btnClosePlacesDrawer');
    if (btnCloseDrawer && drawer) {
      btnCloseDrawer.addEventListener('click', () => drawer.classList.remove('open'));
    }

    const btnClearAllPlaces = document.getElementById('btnClearAllPlaces');
    if (btnClearAllPlaces) {
      btnClearAllPlaces.addEventListener('click', clearAllMarks);
    }

    // 6. Camera Controls: Tilt, Compass, Recenter, My Location, Fullscreen
    const btnTilt = document.getElementById('btnToggle3DTilt');
    if (btnTilt) btnTilt.addEventListener('click', toggleTilt);

    const btnCompass = document.getElementById('btnResetMapNorth');
    if (btnCompass) btnCompass.addEventListener('click', resetNorth);

    const btnRecenter = document.getElementById('btnMapRecenterDrone');
    if (btnRecenter) btnRecenter.addEventListener('click', recenterOnDrone);

    const btnMyLocation = document.getElementById('btnMapMyLocation');
    if (btnMyLocation) btnMyLocation.addEventListener('click', () => locateUser(true));

    const btnFull = document.getElementById('btnMapFullscreen');
    if (btnFull) btnFull.addEventListener('click', toggleFullscreen);

    // 7. Place Search Box
    const searchInp = document.getElementById('inpMapSearchLocation');
    const searchBtn = document.getElementById('btnMapSearchGo');
    if (searchInp && searchBtn) {
      searchBtn.addEventListener('click', () => searchLocation(searchInp.value));
      searchInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchLocation(searchInp.value);
      });
    }
  }

  function resize() {
    if (googleMap) {
      google.maps.event.trigger(googleMap, 'resize');
      if (currentCenter) googleMap.setCenter(currentCenter);
    }
  }

  return {
    init,
    resize,
    invalidateSize: resize,
    onWindowResize: resize,
    mount: resize,
    toggleTilt,
    resetNorth,
    setMarkingMode,
    setAreaMarkingMode,
    clearAreaBoundary,
    searchLocation,
    locateUser,
    flyToPlace,
    deletePlace,
    clearAllMarks,
    updateDronePosition,
    recenterOnDrone,
    addVictimMarker,
    clearVictimMarkers,
    panToLocation: (lat, lon) => focusTarget(lat, lon),
    focusTarget
  };
})();

// Aliases for seamless backward compatibility
window.MapGoogle3DManager = MapGoogle3DManager;
window.Map3DManager = MapGoogle3DManager;
window.Map2DManager = MapGoogle3DManager;
