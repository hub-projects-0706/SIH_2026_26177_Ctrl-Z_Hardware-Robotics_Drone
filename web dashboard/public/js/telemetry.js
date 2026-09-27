/**
 * AEROSIGHT - Drone Telemetry Module
 * Handles real-time telemetry polling, battery gauge, and status updates
 */

const TelemetryManager = (() => {
  let telemetryData = {
    status: 'IN FLIGHT',
    battery: 78,
    altitude: 120.0,
    speed: 12.5,
    lat: 10.0234,
    lon: 78.1234,
    heading: 42,
    signalStrength: '4G (SIM)',
    signalBars: 4,
    flightTimeSeconds: 754,
    distanceFromHome: 1.2
  };

  const listeners = [];

  function init() {
    fetchTelemetry();
    setInterval(fetchTelemetry, 1000);
  }

  async function fetchTelemetry() {
    try {
      const res = await fetch('/api/telemetry');
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          telemetryData = json.data;
          updateUI();
          notifyListeners();
        }
      }
    } catch (err) {
      // Fallback local simulation if offline
      simulateLocalTick();
      updateUI();
      notifyListeners();
    }
  }

  function simulateLocalTick() {
    if (telemetryData.status === 'IN FLIGHT') {
      telemetryData.flightTimeSeconds += 1;
      telemetryData.altitude = +(120 + (Math.sin(Date.now() / 3000) * 1.5)).toFixed(1);
      telemetryData.speed = +(12.5 + (Math.cos(Date.now() / 2500) * 0.4)).toFixed(1);
    }
  }

  function updateUI() {
    // Flight Status Badge
    const statusText = document.getElementById('flightStatusText');
    const statusBadge = document.getElementById('droneFlightStatusBadge');
    if (statusText) statusText.textContent = telemetryData.status;

    if (statusBadge) {
      if (telemetryData.status === 'IN FLIGHT') {
        statusBadge.className = 'status-pill-green';
      } else if (telemetryData.status === 'PAUSED') {
        statusBadge.className = 'status-badge pending';
      } else if (telemetryData.status === 'RETURNING HOME') {
        statusBadge.className = 'status-badge en-route';
      } else if (telemetryData.status === 'LANDED') {
        statusBadge.className = 'status-badge';
        statusBadge.style.background = 'rgba(255, 59, 86, 0.2)';
        statusBadge.style.color = '#ff3b56';
      }
    }

    // Battery
    const batVal = document.getElementById('telemBatteryVal');
    const batFill = document.getElementById('telemBatteryFill');
    if (batVal) batVal.textContent = `${telemetryData.battery}%`;
    if (batFill) {
      batFill.style.width = `${telemetryData.battery}%`;
      if (telemetryData.battery < 20) {
        batFill.style.background = 'var(--red-alert)';
        if (batVal) batVal.style.color = 'var(--red-alert)';
      } else if (telemetryData.battery < 40) {
        batFill.style.background = 'var(--yellow-hazard)';
        if (batVal) batVal.style.color = 'var(--yellow-hazard)';
      }
    }

    // Altitude
    const altVal = document.getElementById('telemAltitudeVal');
    if (altVal) altVal.textContent = `${telemetryData.altitude} m`;

    // Speed
    const spdVal = document.getElementById('telemSpeedVal');
    if (spdVal) spdVal.textContent = `${telemetryData.speed} m/s`;

    // GPS
    const gpsVal = document.getElementById('telemGpsVal');
    if (gpsVal) gpsVal.textContent = `${telemetryData.lat.toFixed(4)}° N, ${telemetryData.lon.toFixed(4)}° E`;

    // Flight Time (format mm:ss)
    const timeVal = document.getElementById('telemFlightTimeVal');
    if (timeVal) {
      const mins = Math.floor(telemetryData.flightTimeSeconds / 60);
      const secs = telemetryData.flightTimeSeconds % 60;
      timeVal.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')} min`;
    }

    // Distance from home
    const distVal = document.getElementById('telemDistVal');
    if (distVal) distVal.textContent = `${telemetryData.distanceFromHome} km`;

    // Map Bottom Bar HUD values
    const hudLat = document.getElementById('hudLat');
    const hudLon = document.getElementById('hudLon');
    const hudAlt = document.getElementById('hudAlt');
    if (hudLat) hudLat.textContent = `${telemetryData.lat.toFixed(4)}° N`;
    if (hudLon) hudLon.textContent = `${telemetryData.lon.toFixed(4)}° E`;
    if (hudAlt) hudAlt.textContent = `${Math.round(telemetryData.altitude)} m`;
  }

  function updateTelemetry(newData) {
    if (!newData) return;
    telemetryData = { ...telemetryData, ...newData };
    updateUI();
    notifyListeners();
  }

  function onUpdate(fn) {
    listeners.push(fn);
  }

  function notifyListeners() {
    listeners.forEach(fn => fn(telemetryData));
    if (window.Map3DManager && Map3DManager.updateDroneTelemetry) {
      Map3DManager.updateDroneTelemetry(telemetryData);
    }
  }

  function getData() {
    return telemetryData;
  }

  return {
    init,
    getData,
    updateTelemetry,
    onUpdate
  };
})();
