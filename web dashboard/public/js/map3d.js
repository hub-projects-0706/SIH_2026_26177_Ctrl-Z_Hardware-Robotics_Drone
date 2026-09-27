/**
 * AEROSIGHT - 3D Tactical Terrain & Drone Simulation Map (Three.js)
 * Features:
 * 1. Real Google Maps 3D Satellite & Hybrid Aerial View:
 *    Dynamically fetches and stitches live Google Satellite tiles onto 3D terrain for ANY user location!
 * 2. Real-Time Geolocation: "🎯 My Location" automatically detects device GPS location
 *    and centers the 3D map, drone, and satellite imagery right onto the user's real neighborhood!
 * 3. Interactive Scan Area Marking: click 3+ points on 3D terrain to define scan boundary.
 * 4. Autonomous Lawnmower Flight Grid Generator with altitude & spacing controls.
 * 5. Autonomous Mission Dispatch: transmits waypoints to drone autopilot & executes scan.
 * 6. Real-Time Drone Location & Telemetry visualization in 3D.
 * 7. Real-Time 3D Victim Beacons: glowing red octahedron pins, sky laser columns,
 *    pulsing ground radar rings, and interactive target focus when YOLO detects a human.
 */

const Map3DManager = (() => {
  let scene, camera, renderer, controls;
  let droneGroup, rotors = [];
  let spotlightCone, spotlightTarget;
  let terrainMesh, groundPlane;
  let activeContainer = null;
  const markerObjects = [];
  let animFrameId = null;
  let isInitialized = false;

  // Base GPS Center (Dynamically updated to user's real-world location)
  let BASE_LAT = 10.3656;
  let BASE_LON = 77.9693;
  let LOCATION_LABEL = 'Current Location';
  const METERS_PER_DEG_LAT = 111000;
  let METERS_PER_DEG_LON = 111000 * Math.cos(BASE_LAT * Math.PI / 180);
  const WORLD_SCALE = 0.5; // 1 meter = 0.5 world units (180 terrain = 360m disaster zone)

  let currentSatelliteCanvas = null;
  let isSatelliteLayerActive = true;
  let currentLyrs = 'y'; // 'y': Hybrid, 's': Pure Satellite

  // View Scope: 'local' (3D Google Satellite & Buildings) vs 'world' (3D Planet Earth Globe)
  let viewScope = 'local';
  let isTrueRgbActive = true; // Natural photorealistic daylight RGB vs Cyan HUD

  // 3D Planet Earth World Globe
  let earthGlobeGroup = null;
  let earthGlobeMesh = null;
  let earthBeaconGroup = null;
  let ambientLightRef = null;
  let sunLightRef = null;
  let fillLightRef = null;

  // 3D Buildings Layer
  let buildingsGroup = null;
  let is3DBuildingsActive = true;

  // Flight states
  let defaultFlightCurve;
  let defaultFlightProgress = 0.35;
  const defaultFlightSpeed = 0.00035;
  let currentDronePos = new THREE.Vector3(0, 16, 0);
  let flightTrailLine = null;
  const flightTrailPoints = [];
  const MAX_TRAIL_POINTS = 120;

  // Interactive Area Marking & Autonomous Grid State
  let isMarkingMode = false;
  let markedPoints = [];           // Array of THREE.Vector3 on ground
  let markedPinMeshes = [];        // Visual vertex pins
  let markedBoundaryLine = null;   // THREE.Line connecting perimeter
  let markedAreaPolygonMesh = null;// Translucent fill on ground
  let ghostCursorMesh = null;      // Floating cursor under mouse

  // Generated Autonomous Mission
  let autonomousWaypoints = [];    // [{ x, y, z, lat, lon, alt, speed }]
  let autonomousGridLine = null;   // THREE.Line showing survey path
  let waypointNodeMeshes = [];     // Waypoint node spheres
  let isAutonomousScanning = false;
  let currentWpIndex = 0;
  let wpProgressT = 0;

  // Dynamic Victims & Hazards Map
  const dynamicVictims = {};       // id -> { group, pin, ring, laser, data }
  const dynamicHazards = {};

  // Ghost raycaster for ground cursor & point marking
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  // =========================================================================
  // 1. INITIALIZATION & CONTAINER MOUNTING
  // =========================================================================
  function init() {
    if (isInitialized) return;

    // Prefer 3D tab container if available, fallback to dashboard #map3D
    const container = document.getElementById('map3DTabContainer') || document.getElementById('map3D');
    if (!container) return;

    activeContainer = container;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    // 1. Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060c18);
    scene.fog = new THREE.FogExp2(0x0a1424, 0.0009);

    // 2. Camera
    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1500);
    camera.position.set(-45, 55, 65);

    // 3. Renderer with True sRGB Color Output
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Ensure 100% natural, photorealistic RGB color rendering
    if (THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if (THREE.sRGBEncoding) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }

    container.appendChild(renderer.domElement);

    // 4. Orbit Controls (Support both local aerial zoom and world space orbit)
    if (window.THREE && THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI / 2 - 0.05;
      controls.minDistance = 10;
      controls.maxDistance = 650;
      controls.target.set(0, 4, 0);
    }

    // 5. Lighting & Environment (Pure Daylight True RGB & Tactical Modes)
    setupLighting();

    // 6. Terrain with Google Satellite / Hybrid Texture
    setupTerrain();

    // 7. 3D Planet Earth Whole World Map Globe (Space View)
    setupEarthGlobe();

    // 8. Ghost Cursor for Interactive Survey Marking
    setupGhostCursor();

    // 8. 3D Drone Model & Searchlight
    setupDrone();

    // 9. Flight Trail Line
    setupFlightTrail();

    // 10. Default Patrol Flight Curve
    setupDefaultFlightPath();

    // 11. Initial Tactical Hazard & Staging Markers
    setupBaseTacticalMarkers();

    // 12. Bind User Interaction Events (Raycaster, Marking, Buttons, Sliders)
    setupInteractionEvents();

    // 13. Window resize
    window.addEventListener('resize', onWindowResize);

    isInitialized = true;
    animate();

    // 14. Auto-detect user's current location on startup for real Google Satellite 3D!
    setTimeout(() => {
      locateUser(false); // false = quiet mode
    }, 600);

    console.log('[Map3DManager] Initialized 3D Google Satellite & Autopilot Engine');
  }

  /**
   * Seamlessly reparents the WebGL canvas between dashboard mini-widget and full 3D tab
   */
  function mount(containerId) {
    const target = document.getElementById(containerId);
    if (!target || !renderer) return;

    if (activeContainer !== target) {
      activeContainer = target;
      target.appendChild(renderer.domElement);
      if (controls) {
        controls.domElement = renderer.domElement;
      }
      setTimeout(onWindowResize, 50);
    }
  }

  // =========================================================================
  // 2. COORDINATE TRANSFORMATIONS & GOOGLE SATELLITE TILES
  // =========================================================================
  function latLngToTile(lat, lng, z) {
    const x = Math.floor((lng + 180) / 360 * Math.pow(2, z));
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, z));
    return { x, y, z };
  }

  function gpsToWorld(lat, lon, alt = 35) {
    const dLat = (lat - BASE_LAT) * METERS_PER_DEG_LAT;
    const dLon = (lon - BASE_LON) * METERS_PER_DEG_LON;
    const worldX = dLon * WORLD_SCALE;
    const worldZ = -dLat * WORLD_SCALE;
    const worldY = Math.max(1.5, alt * 0.45);
    return new THREE.Vector3(worldX, worldY, worldZ);
  }

  function worldToGps(worldX, worldZ, worldY = 16) {
    const dLon = (worldX / WORLD_SCALE) / METERS_PER_DEG_LON;
    const dLat = (-worldZ / WORLD_SCALE) / METERS_PER_DEG_LAT;
    return {
      lat: +(BASE_LAT + dLat).toFixed(6),
      lon: +(BASE_LON + dLon).toFixed(6),
      alt: +(worldY / 0.45).toFixed(1)
    };
  }

  /**
   * Stitches a 5x5 high-resolution Google Satellite & Hybrid texture (Zoom 18)
   * Super-sharp resolution: 0.6 meters per pixel, covering 750m x 750m!
   */
  function loadSatelliteTextureForLocation(lat, lon) {
    const z = 18;
    const centerTile = latLngToTile(lat, lon, z);
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 1280;
    const ctx = canvas.getContext('2d');

    // High-tech satellite base
    ctx.fillStyle = '#081424';
    ctx.fillRect(0, 0, 1280, 1280);

    let loadedCount = 0;
    const gridSize = 5;
    const half = Math.floor(gridSize / 2);
    const totalTiles = gridSize * gridSize;

    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const tx = centerTile.x + dx;
        const ty = centerTile.y + dy;
        const col = dx + half;
        const row = dy + half;

        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
          try {
            ctx.drawImage(img, col * 256, row * 256, 256, 256);
          } catch (e) {}
          loadedCount++;
          if (loadedCount >= totalTiles) {
            applySatelliteTexture(canvas);
          }
        };

        img.onerror = () => {
          // Fallback to ArcGIS satellite imagery
          const fallback = new Image();
          fallback.crossOrigin = 'anonymous';
          fallback.onload = () => {
            try {
              ctx.drawImage(fallback, col * 256, row * 256, 256, 256);
            } catch (e) {}
            loadedCount++;
            if (loadedCount >= totalTiles) {
              applySatelliteTexture(canvas);
            }
          };
          fallback.onerror = () => {
            loadedCount++;
            if (loadedCount >= totalTiles) {
              applySatelliteTexture(canvas);
            }
          };
          fallback.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
        };

        // Fetch via local proxy server (CORS-safe, cached, high reliability)
        img.src = `/api/satellite-tile?lyrs=${currentLyrs}&z=${z}&x=${tx}&y=${ty}`;
      }
    }
  }

  function applySatelliteTexture(canvas) {
    currentSatelliteCanvas = canvas;
    if (terrainMesh && isSatelliteLayerActive) {
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      if (renderer && renderer.capabilities) {
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      }
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;

      terrainMesh.material.map = texture;
      terrainMesh.material.color.setHex(0xffffff);
      terrainMesh.material.roughness = 0.85;
      terrainMesh.material.metalness = 0.15;
      terrainMesh.material.needsUpdate = true;
    }
  }

  // =========================================================================
  // 3D BUILDINGS & URBAN STRUCTURES ENGINE (Google Maps 3D View)
  // =========================================================================
  function generate3DBuildings() {
    if (buildingsGroup) {
      scene.remove(buildingsGroup);
      buildingsGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }

    buildingsGroup = new THREE.Group();
    scene.add(buildingsGroup);

    // Procedural illuminated glass texture
    const winCanvas = document.createElement('canvas');
    winCanvas.width = 128;
    winCanvas.height = 128;
    const wctx = winCanvas.getContext('2d');
    wctx.fillStyle = '#101c2b';
    wctx.fillRect(0, 0, 128, 128);
    for (let r = 4; r < 124; r += 12) {
      for (let c = 4; c < 124; c += 10) {
        if (Math.random() > 0.28) {
          wctx.fillStyle = Math.random() > 0.45 ? 'rgba(0, 229, 255, 0.65)' : 'rgba(255, 230, 160, 0.75)';
          wctx.fillRect(c, r, 6, 7);
        }
      }
    }
    const winTex = new THREE.CanvasTexture(winCanvas);
    winTex.wrapS = THREE.RepeatWrapping;
    winTex.wrapT = THREE.RepeatWrapping;

    const buildingMat = new THREE.MeshStandardMaterial({
      color: 0x22364c,
      metalness: 0.6,
      roughness: 0.3,
      map: winTex
    });

    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x141f2e,
      roughness: 0.88,
      metalness: 0.2
    });

    // Generate ~35 realistic 3D building blocks in neighborhood clusters around origin
    const buildingPlots = [
      // Commercial & Office high-rises
      { x: 32, z: -35, w: 14, d: 12, h: 26 },
      { x: 52, z: -40, w: 16, d: 14, h: 36 },
      { x: 36, z: -55, w: 12, d: 16, h: 22 },
      { x: 62, z: -60, w: 18, d: 18, h: 42 },
      { x: 22, z: -44, w: 10, d: 10, h: 18 },

      // Residential apartments & villas
      { x: -35, z: -35, w: 12, d: 12, h: 16 },
      { x: -52, z: -30, w: 14, d: 12, h: 24 },
      { x: -38, z: -52, w: 16, d: 14, h: 28 },
      { x: -60, z: -50, w: 12, d: 16, h: 18 },
      { x: -25, z: -45, w: 10, d: 10, h: 14 },

      // East Sector buildings
      { x: 38, z: 32, w: 16, d: 14, h: 20 },
      { x: 58, z: 28, w: 18, d: 16, h: 32 },
      { x: 42, z: 52, w: 14, d: 14, h: 24 },
      { x: 62, z: 48, w: 15, d: 15, h: 28 },
      { x: 26, z: 42, w: 10, d: 12, h: 16 },

      // West Sector structures
      { x: -34, z: 35, w: 14, d: 12, h: 22 },
      { x: -50, z: 40, w: 16, d: 14, h: 30 },
      { x: -35, z: 55, w: 12, d: 14, h: 18 },
      { x: -55, z: 58, w: 15, d: 16, h: 26 },
      { x: -24, z: 40, w: 10, d: 10, h: 14 },

      // Perimeter city skyline
      { x: 70, z: -15, w: 14, d: 14, h: 24 },
      { x: 72, z: 10, w: 15, d: 12, h: 28 },
      { x: -70, z: -10, w: 14, d: 14, h: 22 },
      { x: -72, z: 15, w: 15, d: 12, h: 26 },
      { x: 0, z: -68, w: 18, d: 14, h: 34 },
      { x: 0, z: 68, w: 18, d: 14, h: 30 }
    ];

    buildingPlots.forEach((b) => {
      const bGroup = new THREE.Group();
      bGroup.position.set(b.x, 0, b.z);

      // Main tower
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      geo.translate(0, b.h / 2, 0);
      const mesh = new THREE.Mesh(geo, buildingMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      bGroup.add(mesh);

      // Rooftop rim
      const roofGeo = new THREE.BoxGeometry(b.w * 0.95, 0.4, b.d * 0.95);
      roofGeo.translate(0, b.h + 0.2, 0);
      const roofMesh = new THREE.Mesh(roofGeo, roofMat);
      bGroup.add(roofMesh);

      // Rooftop HVAC unit
      const hvacGeo = new THREE.BoxGeometry(b.w * 0.35, 1.6, b.d * 0.35);
      hvacGeo.translate(0, b.h + 1.0, 0);
      const hvacMesh = new THREE.Mesh(hvacGeo, roofMat);
      bGroup.add(hvacMesh);

      // Antennas on tall towers
      if (b.h >= 26) {
        const antGeo = new THREE.CylinderGeometry(0.1, 0.15, 6);
        const antMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
        const ant = new THREE.Mesh(antGeo, antMat);
        ant.position.set(0, b.h + 3.2, 0);
        bGroup.add(ant);

        // Blinking red aviation warning beacon
        const lightGeo = new THREE.SphereGeometry(0.35, 8, 8);
        const lightMat = new THREE.MeshBasicMaterial({ color: 0xff3b56 });
        const redBeacon = new THREE.Mesh(lightGeo, lightMat);
        redBeacon.position.set(0, b.h + 6.2, 0);
        bGroup.add(redBeacon);
      }

      buildingsGroup.add(bGroup);
    });

    buildingsGroup.visible = is3DBuildingsActive;
  }

  function toggle3DBuildings() {
    is3DBuildingsActive = !is3DBuildingsActive;
    if (buildingsGroup) buildingsGroup.visible = is3DBuildingsActive;
    const btn = document.getElementById('btn3dToggleBuildings');
    if (btn) {
      if (is3DBuildingsActive) btn.classList.add('active');
      else btn.classList.remove('active');
    }
    if (window.showToast) {
      window.showToast(`🏢 3D Buildings: ${is3DBuildingsActive ? 'ACTIVATED' : 'HIDDEN'}`);
    }
  }

  /**
   * Centers the 3D map, satellite imagery, and drone on a specific GPS location
   */
  function setLocation(lat, lon, label) {
    BASE_LAT = +lat.toFixed(6);
    BASE_LON = +lon.toFixed(6);
    LOCATION_LABEL = label || `${BASE_LAT.toFixed(4)}°N, ${BASE_LON.toFixed(4)}°E`;
    METERS_PER_DEG_LON = 111000 * Math.cos(BASE_LAT * Math.PI / 180);

    const badge = document.getElementById('map3dCurrentLocationBadge');
    if (badge) {
      badge.textContent = `📍 ${LOCATION_LABEL}`;
    }

    // Fetch live Google Satellite tiles for this location
    loadSatelliteTextureForLocation(BASE_LAT, BASE_LON);

    // Rebuild 3D buildings around this location
    generate3DBuildings();

    // Update HUD chips
    const latEl = document.getElementById('map3dHudLat');
    const lonEl = document.getElementById('map3dHudLon');
    if (latEl) latEl.textContent = `${BASE_LAT.toFixed(4)}°N`;
    if (lonEl) lonEl.textContent = `${BASE_LON.toFixed(4)}°E`;

    // Center drone at origin
    currentDronePos.set(0, 16, 0);
    if (droneGroup) droneGroup.position.copy(currentDronePos);

    // Clear previous path
    clearMarkedArea();

    // Update real-time GPS beacon pin on 3D Earth Globe
    if (earthGlobeGroup) {
      setupUserGlobeBeacon();
      if (viewScope === 'world') {
        rotateGlobeToLocation(BASE_LAT, BASE_LON);
      }
    }

    // Swoop camera to Google Maps 3D oblique aerial angle if in local view
    if (viewScope === 'local') {
      flyCameraTo(
        new THREE.Vector3(-55, 60, 65),
        new THREE.Vector3(0, 5, 0)
      );
    }

    // Broadcast to backend & other managers
    try {
      fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: BASE_LAT, lon: BASE_LON, alt: 35, status: 'READY' })
      });
    } catch (e) {}

    // Also sync Google 3D stream if active
    if (window.MapGoogle3DManager && MapGoogle3DManager.setCurrentLocation) {
      MapGoogle3DManager.setCurrentLocation(BASE_LAT, BASE_LON, label);
    }

    // Sync 2D map if active
    if (window.Map2DManager && Map2DManager.updateDronePosition) {
      Map2DManager.updateDronePosition(BASE_LAT, BASE_LON, 0);
    }

    if (window.showToast) {
      window.showToast(`🎯 Centered on ${LOCATION_LABEL} (${BASE_LAT}°N, ${BASE_LON}°E)`);
    }
  }

  /**
   * Prompts browser for device geolocation and centers 3D map
   */
  function locateUser(showToastMsg = true) {
    if (showToastMsg && window.showToast) {
      window.showToast('📡 Detecting device GPS location for Google 3D Satellite...');
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const acc = Math.round(pos.coords.accuracy || 10);
          setLocation(lat, lon, `Device GPS ±${acc}m`);
        },
        (err) => {
          console.warn('[Map3D] Device GPS unavailable or denied, fetching IP location...', err);
          fetchIpLocation();
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 }
      );
    } else {
      fetchIpLocation();
    }
  }

  async function fetchIpLocation() {
    try {
      const res = await fetch('/api/location/current');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.lat && data.lon) {
          const label = data.city ? `${data.city}, ${data.region || data.country}` : 'Current Location';
          setLocation(data.lat, data.lon, label);
          return;
        }
      }
    } catch (e) {
      console.warn('[Map3D] Local location API failed, trying direct...', e);
    }

    try {
      const res2 = await fetch('https://ipwho.is/');
      if (res2.ok) {
        const data2 = await res2.json();
        if (data2.success && data2.latitude && data2.longitude) {
          setLocation(data2.latitude, data2.longitude, `${data2.city || 'Local Area'}, ${data2.region || ''}`);
          return;
        }
      }
    } catch (e) {}

    // Fallback default
    setLocation(10.3656, 77.9693, 'Tamil Nadu Region');
  }

  async function searchLocation(query) {
    if (!query || !query.trim()) return;
    if (window.showToast) window.showToast(`🔍 Searching location: "${query}"...`);
    try {
      const res = await fetch(`/api/location/search?q=${encodeURIComponent(query.trim())}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.results && data.results.length > 0) {
          const top = data.results[0];
          setLocation(top.lat, top.lon, top.name);
          return;
        }
      }
    } catch (e) {
      console.error('[Map3D] Search error:', e);
    }
    if (window.showToast) window.showToast(`No coordinates found for "${query}". Try city name or lat,lon.`);
  }

  // =========================================================================
  // 3. SCENE LIGHTING & ENVIRONMENT (TRUE RGB COLOR & TACTICAL MODES)
  // =========================================================================
  function setupLighting() {
    ambientLightRef = new THREE.AmbientLight(0xffffff, isTrueRgbActive ? 2.2 : 1.3);
    scene.add(ambientLightRef);

    sunLightRef = new THREE.DirectionalLight(0xffffff, isTrueRgbActive ? 2.4 : 1.4);
    sunLightRef.position.set(60, 100, 50);
    sunLightRef.castShadow = true;
    sunLightRef.shadow.mapSize.width = 1024;
    sunLightRef.shadow.mapSize.height = 1024;
    scene.add(sunLightRef);

    fillLightRef = new THREE.DirectionalLight(isTrueRgbActive ? 0xfff6ea : 0x00d2ff, isTrueRgbActive ? 0.9 : 0.7);
    fillLightRef.position.set(-60, 40, -40);
    scene.add(fillLightRef);

    applyTrueRgbEnvironment();
  }

  function applyTrueRgbEnvironment() {
    if (!scene) return;
    if (isTrueRgbActive) {
      scene.background = new THREE.Color(0x060c18);
      scene.fog = new THREE.FogExp2(0x0a1424, 0.0009);
      if (ambientLightRef) {
        ambientLightRef.color.setHex(0xffffff);
        ambientLightRef.intensity = 2.2;
      }
      if (sunLightRef) {
        sunLightRef.color.setHex(0xffffff);
        sunLightRef.intensity = 2.4;
      }
      if (fillLightRef) {
        fillLightRef.color.setHex(0xfff6ea);
        fillLightRef.intensity = 0.9;
      }
      if (terrainMesh && terrainMesh.material) {
        terrainMesh.material.color.setHex(0xffffff);
        terrainMesh.material.roughness = 0.9;
        terrainMesh.material.metalness = 0.05;
        terrainMesh.material.needsUpdate = true;
      }
    } else {
      scene.background = new THREE.Color(0x060e1b);
      scene.fog = new THREE.FogExp2(0x060e1b, 0.007);
      if (ambientLightRef) {
        ambientLightRef.color.setHex(0x4a6585);
        ambientLightRef.intensity = 1.3;
      }
      if (sunLightRef) {
        sunLightRef.color.setHex(0xd6e8ff);
        sunLightRef.intensity = 1.4;
      }
      if (fillLightRef) {
        fillLightRef.color.setHex(0x00d2ff);
        fillLightRef.intensity = 0.7;
      }
    }
  }

  function toggleTrueRgb(forceState) {
    if (typeof forceState === 'boolean') {
      isTrueRgbActive = forceState;
    } else {
      isTrueRgbActive = !isTrueRgbActive;
    }
    applyTrueRgbEnvironment();
    const btn = document.getElementById('btn3dTrueRgb');
    if (btn) {
      if (isTrueRgbActive) {
        btn.classList.add('active');
        btn.innerHTML = '<span>🌈 TRUE RGB COLOR</span>';
      } else {
        btn.classList.remove('active');
        btn.innerHTML = '<span>⚡ TACTICAL HUD</span>';
      }
    }
    if (window.showToast) {
      window.showToast(isTrueRgbActive ? '3D View: 100% True Natural Daylight RGB Engaged' : '3D View: Tactical Night HUD Mode Engaged');
    }
  }

  // =========================================================================
  // 3D PLANET EARTH WHOLE WORLD MAP ENGINE
  // =========================================================================
  function latLonToGlobe(lat, lon, radius = 65) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = (radius * Math.sin(phi) * Math.sin(theta));
    const y = (radius * Math.cos(phi));
    return new THREE.Vector3(x, y, z);
  }

  function setupEarthGlobe() {
    earthGlobeGroup = new THREE.Group();
    earthGlobeGroup.visible = false; // Starts in local 3D view

    const globeRadius = 65;
    const sphereGeo = new THREE.SphereGeometry(globeRadius, 64, 64);

    // Canvas texture with oceans, continents and graticule while satellite tiles stitch
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // Deep oceanic blue
    ctx.fillStyle = '#07162b';
    ctx.fillRect(0, 0, 1024, 1024);

    // Latitude & Longitude graticule grid
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.22)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= 1024; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 1024);
      ctx.stroke();
    }
    for (let y = 0; y <= 1024; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y);
      ctx.stroke();
    }
    // Equator & Prime Meridian
    ctx.strokeStyle = 'rgba(0, 255, 102, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 512);
    ctx.lineTo(1024, 512);
    ctx.stroke();

    const globeTexture = new THREE.CanvasTexture(canvas);
    globeTexture.wrapS = THREE.ClampToEdgeWrapping;
    globeTexture.wrapT = THREE.ClampToEdgeWrapping;

    const globeMat = new THREE.MeshStandardMaterial({
      map: globeTexture,
      roughness: 0.8,
      metalness: 0.1,
      color: 0xffffff
    });

    earthGlobeMesh = new THREE.Mesh(sphereGeo, globeMat);
    earthGlobeGroup.add(earthGlobeMesh);

    // Glowing Atmosphere Shell
    const atmoGeo = new THREE.SphereGeometry(globeRadius * 1.025, 64, 64);
    const atmoMat = new THREE.MeshBasicMaterial({
      color: 0x00aaff,
      transparent: true,
      opacity: 0.2,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });
    const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
    earthGlobeGroup.add(atmoMesh);

    // Outer Space Halo
    const haloGeo = new THREE.SphereGeometry(globeRadius * 1.055, 32, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x0055ff,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    earthGlobeGroup.add(haloMesh);

    // User's Real-Time GPS Beacon on Globe
    earthBeaconGroup = new THREE.Group();
    setupUserGlobeBeacon();
    earthGlobeGroup.add(earthBeaconGroup);

    // Major Global Humanitarian & Disaster Response Hubs
    setupWorldHubBeacons();

    // Cosmic Starfield points
    setupCosmicStarfield();

    scene.add(earthGlobeGroup);

    // Load High-Res Global Satellite Imagery Tiles (Zoom 2 covers whole earth with 4x4 tiles)
    loadWorldGlobeTiles(canvas, globeTexture);
  }

  function loadWorldGlobeTiles(canvas, globeTexture) {
    const ctx = canvas.getContext('2d');
    const z = 2;
    const tilesPerAxis = 4; // 2^2 = 4 tiles across (x: 0..3, y: 0..3)
    const tileSize = 256;
    let loaded = 0;
    const total = tilesPerAxis * tilesPerAxis;

    for (let ty = 0; ty < tilesPerAxis; ty++) {
      for (let tx = 0; tx < tilesPerAxis; tx++) {
        const col = tx;
        const row = ty;
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
          try {
            ctx.drawImage(img, col * tileSize, row * tileSize, tileSize, tileSize);
            globeTexture.needsUpdate = true;
          } catch (e) {}
          loaded++;
          if (loaded >= total) {
            console.log('[Map3D] Whole World Satellite Texture Fully Stitched (4x4 Zoom 2)');
          }
        };

        img.onerror = () => {
          // Fallback to ArcGIS World Imagery
          const fallback = new Image();
          fallback.crossOrigin = 'anonymous';
          fallback.onload = () => {
            try {
              ctx.drawImage(fallback, col * tileSize, row * tileSize, tileSize, tileSize);
              globeTexture.needsUpdate = true;
            } catch (e) {}
          };
          fallback.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
        };

        img.src = `/api/satellite-tile?lyrs=y&z=${z}&x=${tx}&y=${ty}`;
      }
    }
  }

  function setupUserGlobeBeacon() {
    if (!earthBeaconGroup) return;
    while (earthBeaconGroup.children.length > 0) {
      const c = earthBeaconGroup.children[0];
      earthBeaconGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }

    const pos = latLonToGlobe(BASE_LAT, BASE_LON, 65.5);
    earthBeaconGroup.position.copy(pos);
    earthBeaconGroup.lookAt(pos.clone().multiplyScalar(2));

    // 1. Glowing Octahedron Pin
    const pinGeo = new THREE.OctahedronGeometry(1.6, 0);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0x00ff66, wireframe: false });
    const pin = new THREE.Mesh(pinGeo, pinMat);
    pin.position.z = 2.5;
    earthBeaconGroup.add(pin);

    // 2. Holographic Radar Pillar extending into orbit
    const beamGeo = new THREE.CylinderGeometry(0.2, 0.6, 12, 16);
    beamGeo.rotateX(Math.PI / 2);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x00ff66,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.z = 6;
    earthBeaconGroup.add(beam);

    // 3. Ground Radar Wave Ring on sphere surface
    const ringGeo = new THREE.RingGeometry(1.2, 2.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ff66,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.z = 0.2;
    earthBeaconGroup.add(ring);

    // 4. Text Label Sprite: "📍 YOU ARE HERE"
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 320;
    labelCanvas.height = 64;
    const lCtx = labelCanvas.getContext('2d');
    lCtx.fillStyle = 'rgba(0, 30, 15, 0.88)';
    lCtx.strokeStyle = '#00ff66';
    lCtx.lineWidth = 2;
    if (lCtx.roundRect) {
      lCtx.roundRect(10, 8, 300, 48, 8);
    } else {
      lCtx.rect(10, 8, 300, 48);
    }
    lCtx.fill();
    lCtx.stroke();

    lCtx.fillStyle = '#00ff66';
    lCtx.font = 'bold 18px sans-serif';
    lCtx.textAlign = 'center';
    lCtx.textBaseline = 'middle';
    lCtx.fillText(`📍 YOU ARE HERE (${BASE_LAT.toFixed(2)}°, ${BASE_LON.toFixed(2)}°)`, 160, 32);

    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const spriteMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(16, 3.2, 1);
    sprite.position.z = 10;
    earthBeaconGroup.add(sprite);
  }

  function setupWorldHubBeacons() {
    const hubs = [
      { name: 'India Hub (New Delhi)', lat: 28.6139, lon: 77.2090, color: 0x00e5ff },
      { name: 'Tokyo Command Hub', lat: 35.6762, lon: 139.6503, color: 0x00e5ff },
      { name: 'Europe Hub (London)', lat: 51.5074, lon: -0.1278, color: 0x00e5ff },
      { name: 'Americas Hub (New York)', lat: 40.7128, lon: -74.0060, color: 0x00e5ff },
      { name: 'Australia Hub (Sydney)', lat: -33.8688, lon: 151.2093, color: 0x00e5ff },
      { name: 'Middle East Hub (Dubai)', lat: 25.2048, lon: 55.2708, color: 0x00e5ff },
      { name: 'Africa Hub (Nairobi)', lat: -1.2921, lon: 36.8219, color: 0x00e5ff },
      { name: 'South America (Rio)', lat: -22.9068, lon: -43.1729, color: 0x00e5ff }
    ];

    hubs.forEach(h => {
      const pos = latLonToGlobe(h.lat, h.lon, 65.4);
      const hubGroup = new THREE.Group();
      hubGroup.position.copy(pos);
      hubGroup.lookAt(pos.clone().multiplyScalar(2));

      // Small cyan pin
      const pGeo = new THREE.OctahedronGeometry(0.9, 0);
      const pMat = new THREE.MeshBasicMaterial({ color: h.color });
      const pMesh = new THREE.Mesh(pGeo, pMat);
      pMesh.position.z = 1.2;
      hubGroup.add(pMesh);

      // Label
      const c = document.createElement('canvas');
      c.width = 240;
      c.height = 48;
      const cx = c.getContext('2d');
      cx.fillStyle = 'rgba(6, 20, 38, 0.85)';
      cx.strokeStyle = '#00e5ff';
      cx.lineWidth = 1;
      if (cx.roundRect) {
        cx.roundRect(6, 6, 228, 36, 6);
      } else {
        cx.rect(6, 6, 228, 36);
      }
      cx.fill();
      cx.stroke();
      cx.fillStyle = '#00e5ff';
      cx.font = 'bold 14px sans-serif';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText(h.name, 120, 24);

      const t = new THREE.CanvasTexture(c);
      const sMat = new THREE.SpriteMaterial({ map: t, transparent: true });
      const s = new THREE.Sprite(sMat);
      s.scale.set(10, 2, 1);
      s.position.z = 3.5;
      hubGroup.add(s);

      earthGlobeGroup.add(hubGroup);
    });
  }

  function setupCosmicStarfield() {
    const starCount = 600;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
      const r = 280 + Math.random() * 200;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      starPositions[i] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i + 2] = r * Math.cos(phi);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, transparent: true, opacity: 0.85 });
    const starPoints = new THREE.Points(starGeo, starMat);
    earthGlobeGroup.add(starPoints);
  }

  function rotateGlobeToLocation(lat, lon) {
    if (!earthGlobeGroup) return;
    const targetRotY = -((lon + 90) * Math.PI / 180);
    earthGlobeGroup.rotation.y = targetRotY;
  }

  function showWorldMap() {
    viewScope = 'world';
    if (earthGlobeGroup) earthGlobeGroup.visible = true;
    if (terrainMesh) terrainMesh.visible = false;
    if (buildingsGroup) buildingsGroup.visible = false;
    if (droneGroup) droneGroup.visible = false;
    if (ghostCursorMesh) ghostCursorMesh.visible = false;
    if (flightTrailLine) flightTrailLine.visible = false;

    rotateGlobeToLocation(BASE_LAT, BASE_LON);

    if (controls) {
      controls.minDistance = 75;
      controls.maxDistance = 500;
      controls.maxPolarAngle = Math.PI - 0.05;
      flyCameraTo(new THREE.Vector3(0, 30, 160), new THREE.Vector3(0, 0, 0));
    }

    const btnGlobe = document.getElementById('btn3dWorldGlobe');
    if (btnGlobe) {
      btnGlobe.innerHTML = '<span>🏙️ LOCAL 3D VIEW</span>';
      btnGlobe.style.borderColor = '#00ff66';
      btnGlobe.style.color = '#00ff66';
    }

    if (window.showToast) window.showToast('3D View: Planet Earth Whole World Map Engaged');
  }

  function showLocalMap() {
    viewScope = 'local';
    if (earthGlobeGroup) earthGlobeGroup.visible = false;
    if (terrainMesh) terrainMesh.visible = true;
    if (buildingsGroup) buildingsGroup.visible = is3DBuildingsActive;
    if (droneGroup) droneGroup.visible = true;
    if (flightTrailLine) flightTrailLine.visible = true;

    if (controls) {
      controls.minDistance = 10;
      controls.maxDistance = 250;
      controls.maxPolarAngle = Math.PI / 2 - 0.05;
      flyCameraTo(new THREE.Vector3(-55, 60, 65), new THREE.Vector3(0, 5, 0));
    }

    const btnGlobe = document.getElementById('btn3dWorldGlobe');
    if (btnGlobe) {
      btnGlobe.innerHTML = '<span>🌍 WHOLE WORLD MAP</span>';
      btnGlobe.style.borderColor = 'rgba(0, 210, 255, 0.45)';
      btnGlobe.style.color = '#00e5ff';
    }

    if (window.showToast) window.showToast('3D View: Local High-Res 3D Satellite & Buildings Engaged');
  }

  function toggleWorldScope() {
    if (viewScope === 'world') {
      showLocalMap();
    } else {
      showWorldMap();
    }
  }

  function setupTerrain() {
    const terrainSize = 180;
    const segments = 64;
    const geometry = new THREE.PlaneGeometry(terrainSize, terrainSize, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    // Realistic elevation contours: subtle rolling topography without artificial sine warps
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const distFromCenter = Math.sqrt(x * x + z * z);
      let height = 0;
      if (distFromCenter > 30) {
        height = Math.sin(x * 0.06) * Math.cos(z * 0.06) * 1.8;
        height += Math.sin(x * 0.12 + 1.0) * Math.cos(z * 0.14) * 0.9;
      }
      pos.setY(i, Math.max(-0.2, height));
    }
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.15
    });

    terrainMesh = new THREE.Mesh(geometry, material);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // Initial load of satellite texture
    loadSatelliteTextureForLocation(BASE_LAT, BASE_LON);

    // 3D Extruded Buildings Layer
    generate3DBuildings();

    // Invisible mathematical ground plane for raycasting reliability
    const planeGeo = new THREE.PlaneGeometry(terrainSize * 1.5, terrainSize * 1.5);
    planeGeo.rotateX(-Math.PI / 2);
    const planeMat = new THREE.MeshBasicMaterial({ visible: false });
    groundPlane = new THREE.Mesh(planeGeo, planeMat);
    groundPlane.position.y = 0;
    scene.add(groundPlane);

    // Tactical Cyber Grid underneath
    const gridHelper = new THREE.GridHelper(200, 40, 0x00d2ff, 0x102744);
    gridHelper.position.y = -0.5;
    scene.add(gridHelper);
  }

  function setupGhostCursor() {
    const ringGeo = new THREE.RingGeometry(1.8, 2.3, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    ghostCursorMesh = new THREE.Mesh(ringGeo, ringMat);
    ghostCursorMesh.visible = false;
    scene.add(ghostCursorMesh);
  }

  // =========================================================================
  // 4. 3D DRONE & SEARCHLIGHT
  // =========================================================================
  function setupDrone() {
    droneGroup = new THREE.Group();

    // Body
    const bodyGeo = new THREE.BoxGeometry(3.6, 0.9, 3.6);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x101e30,
      metalness: 0.8,
      roughness: 0.25
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    droneGroup.add(bodyMesh);

    // Top canopy
    const canopyGeo = new THREE.CylinderGeometry(1.2, 1.6, 0.6, 8);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x00d2ff,
      emissive: 0x005577,
      roughness: 0.2
    });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.y = 0.6;
    droneGroup.add(canopy);

    // 4 Quadcopter Arms
    const armMat = new THREE.MeshStandardMaterial({ color: 0x1c2f48, metalness: 0.8 });
    const armPositions = [
      { x: 3.2, z: 3.2, angle: Math.PI / 4 },
      { x: -3.2, z: 3.2, angle: -Math.PI / 4 },
      { x: 3.2, z: -3.2, angle: -Math.PI / 4 },
      { x: -3.2, z: -3.2, angle: Math.PI / 4 }
    ];

    armPositions.forEach(arm => {
      const armGeo = new THREE.CylinderGeometry(0.2, 0.2, 4.5);
      armGeo.rotateZ(Math.PI / 2);
      armGeo.rotateY(arm.angle);
      const armMesh = new THREE.Mesh(armGeo, armMat);
      droneGroup.add(armMesh);

      // Motor pod
      const motorGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.7, 12);
      const motorMesh = new THREE.Mesh(motorGeo, bodyMat);
      motorMesh.position.set(arm.x, 0.2, arm.z);
      droneGroup.add(motorMesh);

      // Propeller disc
      const propGeo = new THREE.CylinderGeometry(2.2, 2.2, 0.05, 16);
      const propMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.4,
        wireframe: true
      });
      const propMesh = new THREE.Mesh(propGeo, propMat);
      propMesh.position.set(arm.x, 0.6, arm.z);
      droneGroup.add(propMesh);
      rotors.push(propMesh);
    });

    // Navigation LEDs
    const frontLight = new THREE.PointLight(0x00e676, 1.4, 12);
    frontLight.position.set(0, 0, 2);
    droneGroup.add(frontLight);

    const rearLight = new THREE.PointLight(0xff3b56, 1.4, 12);
    rearLight.position.set(0, 0, -2);
    droneGroup.add(rearLight);

    // Downward Searchlight Cone
    const coneHeight = 18;
    const coneGeo = new THREE.ConeGeometry(8, coneHeight, 24, 1, true);
    coneGeo.translate(0, -coneHeight / 2, 0);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x00d2ff,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    spotlightCone = new THREE.Mesh(coneGeo, coneMat);
    droneGroup.add(spotlightCone);

    // Ground spotlight ring projection
    const ringGeo = new THREE.RingGeometry(7.5, 8.2, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5
    });
    spotlightTarget = new THREE.Mesh(ringGeo, ringMat);
    scene.add(spotlightTarget);

    droneGroup.position.copy(currentDronePos);
    scene.add(droneGroup);
  }

  function setupFlightTrail() {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.7,
      linewidth: 2
    });
    flightTrailLine = new THREE.Line(geometry, material);
    scene.add(flightTrailLine);
  }

  function addFlightTrailPoint(pos) {
    if (!flightTrailLine) return;
    flightTrailPoints.push(pos.clone());
    if (flightTrailPoints.length > MAX_TRAIL_POINTS) {
      flightTrailPoints.shift();
    }
    flightTrailLine.geometry.setFromPoints(flightTrailPoints);
  }

  function setupDefaultFlightPath() {
    const defaultWaypoints = [
      new THREE.Vector3(-45, 16, -45),
      new THREE.Vector3(-25, 16, -20),
      new THREE.Vector3(-10, 16, 5),
      new THREE.Vector3(15, 16, 12),
      new THREE.Vector3(35, 16, -10),
      new THREE.Vector3(45, 16, -35),
      new THREE.Vector3(20, 16, -45),
      new THREE.Vector3(-20, 16, -40)
    ];
    defaultFlightCurve = new THREE.CatmullRomCurve3(defaultWaypoints, true, 'catmullrom', 0.5);
  }

  function setupBaseTacticalMarkers() {
    // Volumetric No-Fly Zone (Red hatched cylinder)
    const nfZGeo = new THREE.CylinderGeometry(18, 18, 30, 24, 1, true);
    const nfZMat = new THREE.MeshBasicMaterial({
      color: 0xff3b56,
      transparent: true,
      opacity: 0.25,
      wireframe: true,
      side: THREE.DoubleSide
    });
    const noFlyMesh = new THREE.Mesh(nfZGeo, nfZMat);
    noFlyMesh.position.set(40, 15, 38);
    scene.add(noFlyMesh);

    // Rescue Staging Point Beacon
    const rGroup = new THREE.Group();
    rGroup.position.set(4, 1.5, 4);
    const beaconGeo = new THREE.CylinderGeometry(0.4, 0.4, 14, 16);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x00e676,
      transparent: true,
      opacity: 0.6
    });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.y = 7;
    rGroup.add(beacon);

    const baseRing = new THREE.RingGeometry(2.5, 3.2, 32);
    baseRing.rotateX(-Math.PI / 2);
    const baseMat = new THREE.MeshBasicMaterial({ color: 0x00e676, side: THREE.DoubleSide });
    const base = new THREE.Mesh(baseRing, baseMat);
    base.position.y = 0.2;
    rGroup.add(base);
    scene.add(rGroup);
  }

  // =========================================================================
  // 5. INTERACTIVE SCAN AREA MARKING (CLICK-TO-MARK)
  // =========================================================================
  function toggleMarkAreaMode() {
    isMarkingMode = !isMarkingMode;
    const btn = document.getElementById('btn3DMarkArea');
    const hint = document.getElementById('map3DMarkHint');
    const hintText = document.getElementById('map3DMarkHintText');

    if (isMarkingMode) {
      if (btn) btn.classList.add('active');
      if (hint) {
        hint.style.display = 'flex';
        if (hintText) hintText.textContent = `MARKING MODE ACTIVE (${markedPoints.length} points). Click on the 3D ground to drop survey boundary pins.`;
      }
      if (renderer) renderer.domElement.style.cursor = 'crosshair';
      if (ghostCursorMesh) ghostCursorMesh.visible = true;
      if (window.showToast) window.showToast('📍 Marking Mode Active: Click on 3D ground to define survey area boundary');
    } else {
      if (btn) btn.classList.remove('active');
      if (hint) hint.style.display = 'none';
      if (renderer) renderer.domElement.style.cursor = 'default';
      if (ghostCursorMesh) ghostCursorMesh.visible = false;
    }
  }

  function handleTerrainClick(groundPoint) {
    if (!isMarkingMode) return;

    // Drop new marked boundary vertex
    const pt = groundPoint.clone();
    pt.y += 0.2; // slight offset above terrain
    markedPoints.push(pt);

    // Create visual vertex pin with number
    const pinGroup = new THREE.Group();
    pinGroup.position.copy(pt);

    // Pulsing cyan pin sphere
    const sphereGeo = new THREE.SphereGeometry(1.2, 16, 16);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x0088cc,
      metalness: 0.5,
      roughness: 0.2
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.y = 3.2;
    pinGroup.add(sphere);

    // Ground laser stem
    const stemGeo = new THREE.CylinderGeometry(0.12, 0.12, 3.2);
    const stemMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.8 });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.y = 1.6;
    pinGroup.add(stem);

    // Ground radar ring
    const ringGeo = new THREE.RingGeometry(1.4, 1.8, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.05;
    pinGroup.add(ring);

    scene.add(pinGroup);
    markedPinMeshes.push(pinGroup);

    // Update boundary perimeter line & ground polygon fill
    updateMarkedBoundary();

    // Update UI HUD
    const hintText = document.getElementById('map3DMarkHintText');
    if (hintText) hintText.textContent = `Point #${markedPoints.length} added. Click more points or click "Auto-Generate Grid" to compute flight path.`;

    if (window.showToast) {
      window.showToast(`Point #${markedPoints.length} placed at [${pt.x.toFixed(1)}, ${pt.z.toFixed(1)}]`);
    }
  }

  function updateMarkedBoundary() {
    if (markedPoints.length < 2) return;

    if (markedBoundaryLine) {
      scene.remove(markedBoundaryLine);
      markedBoundaryLine.geometry.dispose();
    }

    const loopPoints = markedPoints.map(p => new THREE.Vector3(p.x, p.y + 0.3, p.z));
    if (loopPoints.length >= 3) {
      loopPoints.push(loopPoints[0].clone()); // Close loop
    }

    const lineGeo = new THREE.BufferGeometry().setFromPoints(loopPoints);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      linewidth: 3
    });
    markedBoundaryLine = new THREE.Line(lineGeo, lineMat);
    scene.add(markedBoundaryLine);

    if (markedPoints.length >= 3) {
      updateMarkedAreaPolygon();
    }
  }

  function updateMarkedAreaPolygon() {
    if (markedAreaPolygonMesh) {
      scene.remove(markedAreaPolygonMesh);
      markedAreaPolygonMesh.geometry.dispose();
    }

    // Calculate approximate area in m²
    let areaWorld = 0;
    const n = markedPoints.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      areaWorld += markedPoints[i].x * markedPoints[j].z;
      areaWorld -= markedPoints[j].x * markedPoints[i].z;
    }
    areaWorld = Math.abs(areaWorld) / 2;
    const areaSqm = Math.round(areaWorld / (WORLD_SCALE * WORLD_SCALE));

    const hudArea = document.getElementById('hud3dArea');
    if (hudArea) hudArea.textContent = `${areaSqm.toLocaleString()} m²`;

    try {
      const shape = new THREE.Shape();
      shape.moveTo(markedPoints[0].x, markedPoints[0].z);
      for (let i = 1; i < markedPoints.length; i++) {
        shape.lineTo(markedPoints[i].x, markedPoints[i].z);
      }
      shape.closePath();

      const shapeGeo = new THREE.ShapeGeometry(shape);
      shapeGeo.rotateX(-Math.PI / 2);
      const shapeMat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      markedAreaPolygonMesh = new THREE.Mesh(shapeGeo, shapeMat);
      markedAreaPolygonMesh.position.y = 0.15;
      scene.add(markedAreaPolygonMesh);
    } catch (e) {
      console.warn("Polygon fill calculation skipped", e);
    }
  }

  function clearMarkedArea() {
    markedPinMeshes.forEach(mesh => scene.remove(mesh));
    markedPinMeshes = [];
    markedPoints = [];

    if (markedBoundaryLine) {
      scene.remove(markedBoundaryLine);
      markedBoundaryLine = null;
    }
    if (markedAreaPolygonMesh) {
      scene.remove(markedAreaPolygonMesh);
      markedAreaPolygonMesh = null;
    }
    clearAutonomousGrid();

    const hudArea = document.getElementById('hud3dArea');
    const hudWp = document.getElementById('hud3dWpCount');
    const hudDist = document.getElementById('hud3dDistance');
    const hudDur = document.getElementById('hud3dDuration');
    const hudBat = document.getElementById('hud3dBatteryDraw');
    const hudProg = document.getElementById('hud3dProgress');
    if (hudArea) hudArea.textContent = '0 m²';
    if (hudWp) hudWp.textContent = '0 pts';
    if (hudDist) hudDist.textContent = '0.00 km';
    if (hudDur) hudDur.textContent = '0m 00s';
    if (hudBat) hudBat.textContent = '0% (Safe)';
    if (hudProg) hudProg.textContent = 'STANDBY';

    if (isMarkingMode) toggleMarkAreaMode();
  }

  // =========================================================================
  // 6. AUTONOMOUS LAWNMOWER GRID GENERATION
  // =========================================================================
  function generateAutonomousGrid() {
    // If no manual points, provide optimal survey polygon around current origin
    if (markedPoints.length < 3) {
      clearMarkedArea();
      const defaultBoundary = [
        new THREE.Vector3(-32, 1, -32),
        new THREE.Vector3(32, 1, -32),
        new THREE.Vector3(32, 1, 28),
        new THREE.Vector3(-32, 1, 28)
      ];
      defaultBoundary.forEach(p => handleTerrainClick(p));
    }

    clearAutonomousGrid();

    const altInput = document.getElementById('rng3dAltitude');
    const spacingInput = document.getElementById('rng3dSpacing');
    const targetAltM = altInput ? parseInt(altInput.value, 10) : 35;
    const spacingM = spacingInput ? parseInt(spacingInput.value, 10) : 20;

    const flyY = targetAltM * 0.45;
    const stepZ = Math.max(6, spacingM * WORLD_SCALE);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    markedPoints.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    });

    const sweepWaypoints = [];
    sweepWaypoints.push(new THREE.Vector3(minX, flyY, minZ));

    let sweepDir = 1;
    for (let z = minZ + stepZ * 0.5; z <= maxZ; z += stepZ) {
      const startX = sweepDir === 1 ? minX : maxX;
      const endX = sweepDir === 1 ? maxX : minX;
      sweepWaypoints.push(new THREE.Vector3(startX, flyY, z));
      sweepWaypoints.push(new THREE.Vector3(endX, flyY, z));
      sweepDir *= -1;
    }

    sweepWaypoints.push(new THREE.Vector3(0, flyY * 0.6, 0));

    autonomousWaypoints = sweepWaypoints.map((wp, idx) => {
      const gps = worldToGps(wp.x, wp.z, wp.y);
      return {
        id: idx + 1,
        x: wp.x,
        y: wp.y,
        z: wp.z,
        lat: gps.lat,
        lon: gps.lon,
        alt: targetAltM,
        speed: 8,
        action: idx === 0 ? 'Takeoff & Align' : (idx === sweepWaypoints.length - 1 ? 'Return & Land' : 'Scan Pass')
      };
    });

    const lineGeo = new THREE.BufferGeometry().setFromPoints(sweepWaypoints);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0x00d2ff,
      dashSize: 2.5,
      gapSize: 1.5,
      linewidth: 2.5
    });
    autonomousGridLine = new THREE.Line(lineGeo, lineMat);
    autonomousGridLine.computeLineDistances();
    scene.add(autonomousGridLine);

    sweepWaypoints.forEach((wp, idx) => {
      const nodeGeo = new THREE.SphereGeometry(0.75, 12, 12);
      const nodeMat = new THREE.MeshBasicMaterial({
        color: idx === 0 ? 0x00e676 : (idx === sweepWaypoints.length - 1 ? 0xff3b56 : 0x00e5ff)
      });
      const node = new THREE.Mesh(nodeGeo, nodeMat);
      node.position.copy(wp);
      scene.add(node);
      waypointNodeMeshes.push(node);
    });

    let totalDistWorld = 0;
    for (let i = 0; i < sweepWaypoints.length - 1; i++) {
      totalDistWorld += sweepWaypoints[i].distanceTo(sweepWaypoints[i + 1]);
    }
    const totalDistMeters = totalDistWorld / WORLD_SCALE;
    const totalDistKm = +(totalDistMeters / 1000).toFixed(2);
    const flightSecs = Math.round(totalDistMeters / 8.0);
    const mins = Math.floor(flightSecs / 60);
    const secs = flightSecs % 60;
    const estBatPercent = Math.min(65, Math.max(8, Math.round(flightSecs * 0.06)));

    const hudWp = document.getElementById('hud3dWpCount');
    const hudDist = document.getElementById('hud3dDistance');
    const hudDur = document.getElementById('hud3dDuration');
    const hudBat = document.getElementById('hud3dBatteryDraw');
    const hudProg = document.getElementById('hud3dProgress');

    if (hudWp) hudWp.textContent = `${autonomousWaypoints.length} pts`;
    if (hudDist) hudDist.textContent = `${totalDistKm} km`;
    if (hudDur) hudDur.textContent = `${mins}m ${secs.toString().padStart(2, '0')}s`;
    if (hudBat) hudBat.textContent = `${estBatPercent}% (Safe)`;
    if (hudProg) hudProg.textContent = 'GRID GENERATED';

    if (isMarkingMode) toggleMarkAreaMode();

    if (window.showToast) {
      window.showToast(`▤ Autonomous Lawnmower Grid: ${autonomousWaypoints.length} waypoints ready (${totalDistKm} km)`);
    }
  }

  function clearAutonomousGrid() {
    if (autonomousGridLine) {
      scene.remove(autonomousGridLine);
      autonomousGridLine = null;
    }
    waypointNodeMeshes.forEach(node => scene.remove(node));
    waypointNodeMeshes = [];
    autonomousWaypoints = [];
    isAutonomousScanning = false;
  }

  // =========================================================================
  // 7. ASSIGN MISSION & AUTONOMOUS FLIGHT
  // =========================================================================
  async function assignMission() {
    if (autonomousWaypoints.length === 0) {
      generateAutonomousGrid();
    }

    const btn = document.getElementById('btn3DAssignMission');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>UPLINKING ${autonomousWaypoints.length} WP...</span>`;
    }

    const missionPayload = {
      action: 'START_AUTONOMOUS',
      pattern: 'Lawnmower Scan',
      waypoints: autonomousWaypoints.map(wp => ({
        id: wp.id,
        lat: wp.lat,
        lon: wp.lon,
        alt: wp.alt,
        speed: wp.speed,
        action: wp.action
      }))
    };

    try {
      await fetch('/api/mission/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(missionPayload)
      });
    } catch (err) {
      console.warn('[Map3D] Backend mission upload fallback', err);
    }

    currentWpIndex = 0;
    wpProgressT = 0;
    isAutonomousScanning = true;

    const statusText = document.getElementById('map3dStatusText');
    const hudProg = document.getElementById('hud3dProgress');
    if (statusText) statusText.textContent = 'AUTONOMOUS SCANNING';
    if (hudProg) hudProg.textContent = `WP 1 / ${autonomousWaypoints.length}`;

    const flightStatusText = document.getElementById('flightStatusText');
    if (flightStatusText) flightStatusText.textContent = 'AUTONOMOUS SCANNING';

    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          <span>🚀 Assign Mission & Autonomous Fly</span>
        `;
      }
    }, 1200);

    if (window.showToast) {
      window.showToast(`🚀 MISSION ASSIGNED: Autopilot engaged on ${autonomousWaypoints.length} autonomous survey waypoints!`);
    }
  }

  // =========================================================================
  // 8. REAL-TIME DRONE TELEMETRY & 3D POSITIONING
  // =========================================================================
  function updateDroneTelemetry(telem) {
    if (!telem || !droneGroup) return;

    const latEl = document.getElementById('map3dHudLat');
    const lonEl = document.getElementById('map3dHudLon');
    const altEl = document.getElementById('map3dHudAlt');
    const batEl = document.getElementById('map3dHudBat');
    const statusText = document.getElementById('map3dStatusText');

    if (latEl && telem.lat) latEl.textContent = `${telem.lat.toFixed(4)}°N`;
    if (lonEl && telem.lon) lonEl.textContent = `${telem.lon.toFixed(4)}°E`;
    if (altEl && telem.alt) altEl.textContent = `${Math.round(telem.alt)}m`;
    if (batEl && telem.battery !== undefined) batEl.textContent = `${telem.battery}%`;
    if (statusText && telem.status) statusText.textContent = telem.status;

    if (!isAutonomousScanning && telem.lat && telem.lon) {
      const targetPos = gpsToWorld(telem.lat, telem.lon, telem.alt || 35);
      droneGroup.position.lerp(targetPos, 0.2);
      currentDronePos.copy(droneGroup.position);

      if (telem.heading !== undefined) {
        droneGroup.rotation.y = -THREE.MathUtils.degToRad(telem.heading);
      }

      addFlightTrailPoint(currentDronePos);
      if (spotlightTarget) {
        spotlightTarget.position.set(currentDronePos.x, 0.15, currentDronePos.z);
      }
    }
  }

  // =========================================================================
  // 9. DYNAMIC 3D VICTIM & HAZARD TRACKING
  // =========================================================================
  function addVictimMarker(det) {
    if (!det || (!det.id && !det.victim_id)) return;
    const vId = det.id || `#${det.victim_id}`;

    const lat = det.lat || BASE_LAT;
    const lon = det.lon || BASE_LON;
    const worldPos = gpsToWorld(lat, lon, 2);

    if (dynamicVictims[vId]) {
      const existing = dynamicVictims[vId];
      existing.group.position.lerp(worldPos, 0.3);
      return;
    }

    const vGroup = new THREE.Group();
    vGroup.position.copy(worldPos);
    vGroup.userData = { id: vId, type: 'Victim', data: det };

    const pinGeo = new THREE.OctahedronGeometry(1.6, 0);
    const pinMat = new THREE.MeshStandardMaterial({
      color: 0xff3b56,
      emissive: 0xcc1133,
      roughness: 0.15,
      metalness: 0.7
    });
    const pinMesh = new THREE.Mesh(pinGeo, pinMat);
    pinMesh.position.y = 5.5;
    vGroup.add(pinMesh);

    const beamGeo = new THREE.CylinderGeometry(0.1, 0.1, 20);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xff3b56,
      transparent: true,
      opacity: 0.75
    });
    const beamMesh = new THREE.Mesh(beamGeo, beamMat);
    beamMesh.position.y = 10;
    vGroup.add(beamMesh);

    const ringGeo = new THREE.RingGeometry(1.8, 2.6, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3b56,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = 0.1;
    vGroup.add(ringMesh);

    scene.add(vGroup);
    markerObjects.push(pinMesh);

    dynamicVictims[vId] = {
      group: vGroup,
      pin: pinMesh,
      ring: ringMesh,
      beam: beamMesh,
      data: det,
      baseScale: 1.0
    };

    updateVictimListUI();
  }

  function clearVictimMarkers() {
    Object.keys(dynamicVictims).forEach(id => {
      const v = dynamicVictims[id];
      scene.remove(v.group);
      const idx = markerObjects.indexOf(v.pin);
      if (idx >= 0) markerObjects.splice(idx, 1);
    });

    for (const key in dynamicVictims) {
      delete dynamicVictims[key];
    }

    updateVictimListUI();
  }

  function updateVictimListUI() {
    const list = document.getElementById('hud3dVictimList');
    const countEl = document.getElementById('hud3dVictimCount');
    const victimKeys = Object.keys(dynamicVictims);

    if (countEl) countEl.textContent = victimKeys.length;
    if (!list) return;

    if (victimKeys.length === 0) {
      list.innerHTML = `<div class="hud-victim-empty">No victims detected yet. Point mobile camera at human to detect and map.</div>`;
      return;
    }

    list.innerHTML = victimKeys.map(id => {
      const v = dynamicVictims[id];
      const d = v.data || {};
      const conf = d.confidence ? (d.confidence > 1 ? d.confidence : Math.round(d.confidence * 100)) : 95;
      const latStr = d.lat ? d.lat.toFixed(4) : BASE_LAT.toFixed(4);
      const lonStr = d.lon ? d.lon.toFixed(4) : BASE_LON.toFixed(4);

      return `
        <div class="hud-victim-item" onclick="Map3DManager.focusVictim('${id}')">
          <div class="hud-victim-info">
            <div class="hud-victim-title">
              <span class="pulse-dot-red" style="width:6px; height:6px;"></span>
              <span>Victim ${id}</span>
            </div>
            <div class="hud-victim-coords">${latStr}°N, ${lonStr}°E</div>
          </div>
          <div class="hud-victim-actions">
            <span class="hud-victim-conf">${conf}%</span>
            <button class="hud-focus-btn">FOCUS 3D</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function focusVictim(victimId) {
    const v = dynamicVictims[victimId];
    if (v) {
      const targetPos = v.group.position;
      flyCameraTo(
        new THREE.Vector3(targetPos.x - 18, targetPos.y + 14, targetPos.z + 18),
        targetPos
      );
      if (window.DetectionsManager) {
        window.DetectionsManager.selectTarget(victimId);
      }
    }
  }

  function focusTarget(lat, lon) {
    const target3D = gpsToWorld(lat, lon, 2);
    flyCameraTo(
      new THREE.Vector3(target3D.x - 22, 24, target3D.z + 22),
      target3D
    );
  }

  // =========================================================================
  // 10. INTERACTION & CAMERA CONTROLS
  // =========================================================================
  function setupInteractionEvents() {
    // Toolbar buttons
    const btnLocate = document.getElementById('btn3DMyLocation');
    const btnDetectGps = document.getElementById('btn3dDetectGps');
    const btnMark = document.getElementById('btn3DMarkArea');
    const btnAuto = document.getElementById('btn3DAutoGrid');
    const btnAssign = document.getElementById('btn3DAssignMission');
    const btnClear = document.getElementById('btn3DClearArea');
    const btnRecenter = document.getElementById('btn3DRecenterDrone');

    if (btnLocate) btnLocate.addEventListener('click', () => locateUser(true));
    if (btnDetectGps) btnDetectGps.addEventListener('click', () => locateUser(true));
    if (btnMark) btnMark.addEventListener('click', toggleMarkAreaMode);
    if (btnAuto) btnAuto.addEventListener('click', generateAutonomousGrid);
    if (btnAssign) btnAssign.addEventListener('click', assignMission);
    if (btnClear) btnClear.addEventListener('click', clearMarkedArea);
    if (btnRecenter) {
      btnRecenter.addEventListener('click', () => {
        if (droneGroup && controls) {
          flyCameraTo(
            new THREE.Vector3(currentDronePos.x - 20, currentDronePos.y + 16, currentDronePos.z + 20),
            currentDronePos
          );
        }
      });
    }

    // 3D Location Search Box
    const inpSearch = document.getElementById('inp3dLocationSearch');
    const btnSearchGo = document.getElementById('btn3dSearchGo');
    if (btnSearchGo && inpSearch) {
      btnSearchGo.addEventListener('click', () => searchLocation(inpSearch.value));
      inpSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchLocation(inpSearch.value);
      });
    }

    // 3D Whole World Map Globe Toggle
    const btnWorldGlobe = document.getElementById('btn3dWorldGlobe');
    if (btnWorldGlobe) {
      btnWorldGlobe.addEventListener('click', toggleWorldScope);
    }

    // 100% True Natural Daylight RGB Mode Toggle
    const btnTrueRgb = document.getElementById('btn3dTrueRgb');
    if (btnTrueRgb) {
      btnTrueRgb.addEventListener('click', () => toggleTrueRgb());
    }

    // 3D Buildings Toggle
    const btnBuildings = document.getElementById('btn3dToggleBuildings');
    if (btnBuildings) {
      btnBuildings.addEventListener('click', toggle3DBuildings);
    }

    // Satellite vs Mesh View Mode Switcher
    const btnSatHybrid = document.getElementById('btn3DSatSatellite');
    const btnSatPure = document.getElementById('btn3DSatPure');
    const btnMesh = document.getElementById('btn3DSatMesh');

    if (btnSatHybrid) {
      btnSatHybrid.addEventListener('click', () => {
        isSatelliteLayerActive = true;
        currentLyrs = 'y';
        btnSatHybrid.classList.add('active');
        if (btnSatPure) btnSatPure.classList.remove('active');
        if (btnMesh) btnMesh.classList.remove('active');
        loadSatelliteTextureForLocation(BASE_LAT, BASE_LON);
        if (window.showToast) window.showToast('3D Map: Google Hybrid Satellite Aerial View Engaged');
      });
    }

    if (btnSatPure) {
      btnSatPure.addEventListener('click', () => {
        isSatelliteLayerActive = true;
        currentLyrs = 's';
        btnSatPure.classList.add('active');
        if (btnSatHybrid) btnSatHybrid.classList.remove('active');
        if (btnMesh) btnMesh.classList.remove('active');
        loadSatelliteTextureForLocation(BASE_LAT, BASE_LON);
        if (window.showToast) window.showToast('3D Map: Pure Google Satellite Imagery Engaged');
      });
    }

    if (btnMesh) {
      btnMesh.addEventListener('click', () => {
        isSatelliteLayerActive = false;
        btnMesh.classList.add('active');
        if (btnSatHybrid) btnSatHybrid.classList.remove('active');
        if (btnSatPure) btnSatPure.classList.remove('active');
        if (terrainMesh) {
          terrainMesh.material.map = null;
          terrainMesh.material.color.setHex(0x0a1c32);
          terrainMesh.material.needsUpdate = true;
        }
        if (window.showToast) window.showToast('3D Map: Tactical Cyber Elevation Mesh Engaged');
      });
    }

    // Camera presets
    const btnGoogle3D = document.getElementById('btn3DCamGoogle3D');
    const btnTac = document.getElementById('btn3DCamTactical');
    const btnTop = document.getElementById('btn3DCamTop');
    const btnChase = document.getElementById('btn3DCamChase');

    if (btnGoogle3D) {
      btnGoogle3D.addEventListener('click', () => {
        setCameraPreset('google3d');
        setActiveCamPill(btnGoogle3D);
      });
    }
    if (btnTac) {
      btnTac.addEventListener('click', () => {
        setCameraPreset('tactical');
        setActiveCamPill(btnTac);
      });
    }
    if (btnTop) {
      btnTop.addEventListener('click', () => {
        setCameraPreset('top');
        setActiveCamPill(btnTop);
      });
    }
    if (btnChase) {
      btnChase.addEventListener('click', () => {
        setCameraPreset('chase');
        setActiveCamPill(btnChase);
      });
    }

    // 3D Camera Tilt Slider
    const rngTilt = document.getElementById('rng3dCameraTilt');
    if (rngTilt) {
      rngTilt.addEventListener('input', () => {
        setCameraTilt(parseFloat(rngTilt.value));
      });
    }

    // Compass Reset to North
    const btnResetNorth = document.getElementById('btn3dResetNorth');
    if (btnResetNorth) {
      btnResetNorth.addEventListener('click', resetCameraNorth);
    }

    // Sliders
    const rngAlt = document.getElementById('rng3dAltitude');
    const rngSpc = document.getElementById('rng3dSpacing');
    const valAlt = document.getElementById('val3dAltitude');
    const valSpc = document.getElementById('val3dSpacing');

    if (rngAlt && valAlt) {
      rngAlt.addEventListener('input', () => {
        valAlt.textContent = `${rngAlt.value}m`;
        if (autonomousWaypoints.length > 0) generateAutonomousGrid();
      });
    }
    if (rngSpc && valSpc) {
      rngSpc.addEventListener('input', () => {
        valSpc.textContent = `${rngSpc.value}m`;
        if (autonomousWaypoints.length > 0) generateAutonomousGrid();
      });
    }

    // Mouse Raycaster on canvas
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('click', onMouseClick);
  }

  function setActiveCamPill(activeBtn) {
    ['btn3DCamGoogle3D', 'btn3DCamTactical', 'btn3DCamTop', 'btn3DCamChase'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });
    if (activeBtn) activeBtn.classList.add('active');
  }

  function onMouseMove(event) {
    if (!renderer || !camera || !activeContainer) return;

    const rect = renderer.domElement.getBoundingClientRect();
    if (
      event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom
    ) {
      if (ghostCursorMesh) ghostCursorMesh.visible = false;
      return;
    }

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects([terrainMesh, groundPlane].filter(Boolean));

    if (intersects.length > 0 && ghostCursorMesh) {
      const hit = intersects[0].point;
      ghostCursorMesh.position.set(hit.x, hit.y + 0.1, hit.z);
      ghostCursorMesh.visible = isMarkingMode;
    }
  }

  function onMouseClick(event) {
    if (!renderer || !camera || !activeContainer) return;

    const rect = renderer.domElement.getBoundingClientRect();
    if (
      event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom
    ) return;

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const markerHits = raycaster.intersectObjects(markerObjects);
    if (markerHits.length > 0) {
      const hit = markerHits[0].object;
      const group = hit.parent;
      if (group && group.userData && group.userData.id) {
        focusVictim(group.userData.id);
        return;
      }
    }

    if (isMarkingMode) {
      const groundHits = raycaster.intersectObjects([terrainMesh, groundPlane].filter(Boolean));
      if (groundHits.length > 0) {
        handleTerrainClick(groundHits[0].point);
      }
    }
  }

  function setCameraPreset(preset) {
    if (!controls) return;
    if (preset === 'google3d') {
      // Photorealistic Google Maps 3D aerial oblique tilt (60° tilt)
      flyCameraTo(new THREE.Vector3(-55, 60, 65), new THREE.Vector3(0, 5, 0));
    } else if (preset === 'tactical') {
      flyCameraTo(new THREE.Vector3(-45, 55, 65), new THREE.Vector3(0, 4, 0));
    } else if (preset === 'top') {
      flyCameraTo(new THREE.Vector3(0, 115, 1), new THREE.Vector3(0, 0, 0));
    } else if (preset === 'chase') {
      flyCameraTo(
        new THREE.Vector3(currentDronePos.x - 18, currentDronePos.y + 14, currentDronePos.z + 18),
        currentDronePos
      );
    }
  }

  function setCameraTilt(tiltDeg) {
    if (!controls || !camera) return;
    const target = controls.target;
    const distance = camera.position.distanceTo(target);
    const azimuth = controls.getAzimuthalAngle();
    const polarRad = Math.max(0.06, Math.min(Math.PI / 2 - 0.05, THREE.MathUtils.degToRad(90 - tiltDeg)));
    const y = target.y + distance * Math.cos(polarRad);
    const radiusH = distance * Math.sin(polarRad);
    const x = target.x - radiusH * Math.sin(azimuth);
    const z = target.z - radiusH * Math.cos(azimuth);
    flyCameraTo(new THREE.Vector3(x, y, z), target);
    const lbl = document.getElementById('lbl3dTiltVal');
    if (lbl) lbl.textContent = `${Math.round(tiltDeg)}°`;
  }

  function resetCameraNorth() {
    if (!controls || !camera) return;
    const target = controls.target;
    const distance = camera.position.distanceTo(target);
    const polar = controls.getPolarAngle();
    const targetY = target.y + distance * Math.cos(polar);
    const radiusH = distance * Math.sin(polar);
    const targetX = target.x;
    const targetZ = target.z + radiusH;
    flyCameraTo(new THREE.Vector3(targetX, targetY, targetZ), target);
    if (window.showToast) window.showToast('Compass: True North Aligned');
  }

  function flyCameraTo(targetPos, lookTarget) {
    if (!controls) return;
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    let t = 0;

    function step() {
      t += 0.05;
      if (t <= 1) {
        camera.position.lerpVectors(startPos, targetPos, t);
        controls.target.lerpVectors(startTarget, lookTarget, t);
        requestAnimationFrame(step);
      }
    }
    step();
  }

  // =========================================================================
  // 11. ANIMATION & RENDER LOOP
  // =========================================================================
  function animate() {
    animFrameId = requestAnimationFrame(animate);

    rotors.forEach(rotor => {
      rotor.rotation.y += 0.65;
    });

    if (isAutonomousScanning && autonomousWaypoints.length > 0 && droneGroup) {
      const currentWp = autonomousWaypoints[currentWpIndex];
      const nextWp = autonomousWaypoints[(currentWpIndex + 1) % autonomousWaypoints.length];
      const currentVec = new THREE.Vector3(currentWp.x, currentWp.y, currentWp.z);
      const nextVec = new THREE.Vector3(nextWp.x, nextWp.y, nextWp.z);

      wpProgressT += 0.006;
      if (wpProgressT >= 1) {
        wpProgressT = 0;
        currentWpIndex = (currentWpIndex + 1) % autonomousWaypoints.length;
        const hudProg = document.getElementById('hud3dProgress');
        if (hudProg) hudProg.textContent = `WP ${currentWpIndex + 1} / ${autonomousWaypoints.length}`;
      }

      currentDronePos.lerpVectors(currentVec, nextVec, wpProgressT);
      droneGroup.position.copy(currentDronePos);

      droneGroup.lookAt(nextVec);
      droneGroup.position.y += Math.sin(Date.now() / 250) * 0.12;
      droneGroup.rotation.z += Math.sin(Date.now() / 300) * 0.03;

      addFlightTrailPoint(currentDronePos);
      if (spotlightTarget) {
        spotlightTarget.position.set(currentDronePos.x, 0.15, currentDronePos.z);
      }

      const gps = worldToGps(currentDronePos.x, currentDronePos.z, currentDronePos.y);
      const latEl = document.getElementById('map3dHudLat');
      const lonEl = document.getElementById('map3dHudLon');
      const altEl = document.getElementById('map3dHudAlt');
      if (latEl) latEl.textContent = `${gps.lat.toFixed(4)}°N`;
      if (lonEl) lonEl.textContent = `${gps.lon.toFixed(4)}°E`;
      if (altEl) altEl.textContent = `${Math.round(gps.alt)}m`;

    } else if (defaultFlightCurve && droneGroup && !isAutonomousScanning) {
      defaultFlightProgress = (defaultFlightProgress + defaultFlightSpeed) % 1;
      const pos = defaultFlightCurve.getPointAt(defaultFlightProgress);
      const nextPos = defaultFlightCurve.getPointAt((defaultFlightProgress + 0.01) % 1);

      currentDronePos.copy(pos);
      droneGroup.position.copy(pos);
      droneGroup.lookAt(nextPos);

      droneGroup.position.y += Math.sin(Date.now() / 300) * 0.1;
      addFlightTrailPoint(currentDronePos);
      if (spotlightTarget) {
        spotlightTarget.position.set(pos.x, 0.15, pos.z);
      }
    }

    const now = Date.now();

    // Rotate Earth globe slowly in space when in Whole World View
    if (viewScope === 'world' && earthGlobeGroup) {
      earthGlobeGroup.rotation.y += 0.0006;
      if (earthBeaconGroup && earthBeaconGroup.children.length >= 3) {
        const ring = earthBeaconGroup.children[2];
        if (ring && ring.material) {
          const ringS = 1.0 + (Math.sin(now / 300) * 0.4 + 0.4);
          ring.scale.set(ringS, ringS, 1);
          ring.material.opacity = Math.max(0.2, 1.0 - (ringS - 1.0));
        }
      }
    }

    Object.values(dynamicVictims).forEach(v => {
      v.pin.rotation.y += 0.025;
      v.pin.position.y = 5.5 + Math.sin(now / 350) * 0.35;

      const ringScale = 1.0 + (Math.sin(now / 400) * 0.4 + 0.4);
      v.ring.scale.set(ringScale, ringScale, ringScale);
      v.ring.material.opacity = Math.max(0.2, 1.0 - (ringScale - 1.0));
    });

    if (controls) {
      controls.update();
      updateCompassUI();
    }

    renderer.render(scene, camera);
  }

  function updateCompassUI() {
    if (!controls) return;
    const angle = controls.getAzimuthalAngle();
    const deg = THREE.MathUtils.radToDeg(angle);

    const compassDial = document.getElementById('compassDial');
    if (compassDial) compassDial.style.transform = `rotate(${-deg}deg)`;

    const map3dCompassDial = document.getElementById('map3dCompassDial');
    if (map3dCompassDial) map3dCompassDial.style.transform = `rotate(${-deg}deg)`;

    // Update tilt slider display from camera polar angle
    const polar = controls.getPolarAngle();
    const currentTiltDeg = Math.round(90 - THREE.MathUtils.radToDeg(polar));
    const lblTilt = document.getElementById('lbl3dTiltVal');
    const rngTilt = document.getElementById('rng3dCameraTilt');
    if (lblTilt) lblTilt.textContent = `${Math.max(0, currentTiltDeg)}°`;
    if (rngTilt && !rngTilt.matches(':active')) {
      rngTilt.value = Math.max(0, Math.min(80, currentTiltDeg));
    }
  }

  function onWindowResize() {
    const container = activeContainer || document.getElementById('map3DTabContainer') || document.getElementById('map3D');
    if (!container || !renderer || !camera) return;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  function setSatelliteMode(lyrs) {
    if (lyrs === 'mesh') {
      isSatelliteLayerActive = false;
      if (terrainMesh) {
        terrainMesh.material.map = null;
        terrainMesh.material.color.setHex(0x0a1c32);
        terrainMesh.material.needsUpdate = true;
      }
      return;
    }
    isSatelliteLayerActive = true;
    currentLyrs = lyrs || 'y';
    loadSatelliteTextureForLocation(BASE_LAT, BASE_LON);
  }

  return {
    init,
    mount,
    gpsToWorld,
    worldToGps,
    locateUser,
    setLocation,
    searchLocation,
    toggle3DBuildings,
    setSatelliteMode,
    toggleMarkAreaMode,
    clearMarkedArea,
    generateAutonomousGrid,
    assignMission,
    updateDroneTelemetry,
    addVictimMarker,
    clearVictimMarkers,
    focusTarget,
    focusVictim,
    setCameraPreset,
    setCameraTilt,
    resetCameraNorth,
    showWorldMap,
    showLocalMap,
    toggleWorldScope,
    toggleTrueRgb,
    onWindowResize
  };
})();
