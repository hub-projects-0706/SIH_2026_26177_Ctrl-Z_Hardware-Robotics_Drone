/**
 * =============================================================================
 * A.S.A.R.D - Autonomous Search And Rescue Drone
 * Telemetry Module (telemetry.js)
 *
 * This module reads live drone data (battery, altitude, speed, GPS)
 * and displays it on the dashboard. It polls the server every second.
 * =============================================================================
 */

const TelemetryManager = (() => {
  let telemetryData = {
    status: 'IN FLIGHT',
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
    frequency: '868 MHz / 2.4 GHz',
    protocol: 'MAVLink v2 / AES-128 GCM',
    bitrateMbps: 14.2,
    flightTimeSeconds: 754,
    distanceFromHome: 1.2
  };

  const listeners = [];

  function init() {
    setupSignalModal();
    fetchTelemetry();
    setInterval(fetchTelemetry, 1000);
  }

  function setupSignalModal() {
    const signalRow = document.getElementById('telemSignalRow');
    const btnDiag = document.getElementById('btnOpenSignalDiag');
    const modalBackdrop = document.getElementById('signalDiagnosticsModalBackdrop');
    const closeBtn = document.getElementById('closeSignalDiagModal');

    function openModal() {
      if (modalBackdrop) {
        modalBackdrop.style.display = 'flex';
        updateSignalModalUI();
      }
    }

    function closeModal() {
      if (modalBackdrop) modalBackdrop.style.display = 'none';
    }

    if (signalRow) signalRow.addEventListener('click', openModal);
    if (btnDiag) btnDiag.addEventListener('click', (e) => { e.stopPropagation(); openModal(); });
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeModal();
      });
    }
  }

  function updateSignalModalUI() {
    const qVal = document.getElementById('diagLinkQuality');
    const dbmVal = document.getElementById('diagSignalDbm');
    const latVal = document.getElementById('diagLatency');
    const freqVal = document.getElementById('diagFrequency');
    const protoVal = document.getElementById('diagProtocol');
    const bitVal = document.getElementById('diagThroughput');
    const statusVal = document.getElementById('diagLinkStatus');

    if (qVal) qVal.textContent = `${telemetryData.linkQuality || 98}%`;
    if (dbmVal) dbmVal.textContent = `${telemetryData.signalDbm || -68} dBm`;
    if (latVal) latVal.textContent = `${telemetryData.latencyMs || 22} ms`;
    if (freqVal) freqVal.textContent = telemetryData.frequency || '868 MHz / 2.4 GHz Dual-Band';
    if (protoVal) protoVal.textContent = telemetryData.protocol || 'MAVLink v2 / AES-128 GCM';
    if (bitVal) bitVal.textContent = `${telemetryData.bitrateMbps || 14.2} Mbps`;
    if (statusVal) {
      const bars = telemetryData.signalBars || 4;
      if (bars >= 4) {
        statusVal.textContent = 'OPTIMAL MILITARY-GRADE CARRIER LINK';
        statusVal.style.color = 'var(--green-rescue)';
      } else if (bars === 3) {
        statusVal.textContent = 'STABLE TELEMETRY LINK';
        statusVal.style.color = 'var(--cyan-primary)';
      } else if (bars === 2) {
        statusVal.textContent = 'DEGRADED / ELEVATING MESH RELAY';
        statusVal.style.color = 'var(--yellow-hazard)';
      } else {
        statusVal.textContent = 'CRITICAL MARGINAL LINK';
        statusVal.style.color = 'var(--red-alert)';
      }
    }
  }

  async function fetchTelemetry() {
    try {
      const res = await fetch('/api/telemetry');
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          telemetryData = { ...telemetryData, ...json.data };
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
      telemetryData.signalDbm = Math.round(-68 + Math.cos(Date.now() / 5000) * 3);
      telemetryData.latencyMs = Math.round(22 + Math.sin(Date.now() / 3500) * 4);
    }
  }

  function updateUI() {
    // Flight Status Badge
    const statusText = document.getElementById('flightStatusText');
    const statusBadge = document.getElementById('droneFlightStatusBadge');
    if (statusText) statusText.textContent = telemetryData.status;

    if (statusBadge) {
      if (telemetryData.status === 'IN FLIGHT' || telemetryData.status === 'AUTONOMOUS SCANNING') {
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
      } else {
        batFill.style.background = 'linear-gradient(90deg, #059669 0%, #10b981 100%)';
        if (batVal) batVal.style.color = 'var(--text-primary)';
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

    // Signal Details (CORRECT DYNAMIC RENDERING)
    const sigType = document.getElementById('telemSignalType');
    const sigDbm = document.getElementById('telemSignalDbm');
    const sigLatency = document.getElementById('telemSignalLatency');
    const sigBarsContainer = document.getElementById('telemSignalBars');

    if (sigType) sigType.textContent = telemetryData.signalStrength || '4G LTE (SIM)';
    if (sigDbm) sigDbm.textContent = `${telemetryData.signalDbm || -68} dBm`;
    if (sigLatency) sigLatency.textContent = `${telemetryData.latencyMs || 22} ms`;

    if (sigBarsContainer) {
      const bars = sigBarsContainer.querySelectorAll('.bar');
      const activeCount = Math.max(1, Math.min(4, telemetryData.signalBars || 4));
      
      let barColor = 'var(--green-rescue)';
      if (activeCount === 1) barColor = 'var(--red-alert)';
      else if (activeCount === 2) barColor = 'var(--yellow-hazard)';
      else if (activeCount === 3) barColor = '#00e5ff';
      else barColor = 'var(--green-rescue)';

      bars.forEach((b, idx) => {
        if (idx < activeCount) {
          b.classList.add('active');
          b.style.backgroundColor = barColor;
        } else {
          b.classList.remove('active');
          b.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
        }
      });
    }

    // If signal modal is open, refresh its values
    const modalBackdrop = document.getElementById('signalDiagnosticsModalBackdrop');
    if (modalBackdrop && modalBackdrop.style.display === 'flex') {
      updateSignalModalUI();
    }

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
