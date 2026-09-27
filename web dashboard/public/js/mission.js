/**
 * AEROSIGHT - Mission Controls Module
 * Start Mission, Pause, Return Home, Emergency Land, Flight Mode & Search Patterns
 */

const MissionManager = (() => {
  function init() {
    setupButtons();
    setupSelectors();
  }

  function setupButtons() {
    const startBtn = document.getElementById('btnStartMission');
    const pauseBtn = document.getElementById('btnPauseMission');
    const returnBtn = document.getElementById('btnReturnHome');
    const emergBtn = document.getElementById('btnEmergencyLand');

    if (startBtn) {
      startBtn.addEventListener('click', () => sendAction('START', 'Mission Initiated: Drone patrolling Sector B grid.'));
    }

    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => sendAction('PAUSE', 'Mission Paused: Drone hovering at current waypoint.'));
    }

    if (returnBtn) {
      returnBtn.addEventListener('click', () => sendAction('RETURN_HOME', 'RTL Activated: Drone returning to launch coordinates.'));
    }

    if (emergBtn) {
      emergBtn.addEventListener('click', () => {
        if (confirm("CONFIRM EMERGENCY LANDING: Drone will initiate immediate vertical descent to nearest safe ground.")) {
          sendAction('EMERGENCY_LAND', 'EMERGENCY LANDING INITIATED: Descent in progress.');
        }
      });
    }
  }

  function setupSelectors() {
    const modeSelect = document.getElementById('flightModeSelect');
    const patternSelect = document.getElementById('searchPatternSelect');

    if (modeSelect) {
      modeSelect.addEventListener('change', async (e) => {
        const flightMode = e.target.value;
        try {
          await fetch('/api/mission/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ flightMode })
          });
        } catch (err) {}
        if (window.showToast) {
          window.showToast(`Flight Mode switched to: ${flightMode}`);
        }
      });
    }

    if (patternSelect) {
      patternSelect.addEventListener('change', async (e) => {
        const searchPattern = e.target.value;
        try {
          await fetch('/api/mission/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ searchPattern })
          });
        } catch (err) {}
        if (window.showToast) {
          window.showToast(`Search Pattern updated to: ${searchPattern}`);
        }
      });
    }
  }

  async function sendAction(action, message) {
    try {
      const res = await fetch('/api/mission/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        const json = await res.json();
        if (window.showToast) {
          window.showToast(message);
        }
      }
    } catch (err) {
      if (window.showToast) window.showToast(message);
    }
  }

  return {
    init
  };
})();
