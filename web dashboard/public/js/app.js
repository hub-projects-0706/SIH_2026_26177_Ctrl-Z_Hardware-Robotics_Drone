/**
 * AEROSIGHT - Main Application Orchestrator
 * Initializes all tactical dashboard modules and manages global view states
 */

// Global Toast Notification Helper
window.showToast = function(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'tactical-toast';
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00d2ff" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 14 14"></polyline>
    </svg>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'all 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
};

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Subsystems
  TelemetryManager.init();
  if (window.MapGoogle3DManager) MapGoogle3DManager.init();
  CameraFeedManager.init();
  DetectionsManager.init();
  TargetDetailsManager.init();
  MissionManager.init();
  RescueLogManager.init();
  if (window.ViewsManager) ViewsManager.init();

  // 2. Connect Live Telemetry to Google 3D Satellite Map Drone Marker
  TelemetryManager.onUpdate((data) => {
    if (window.MapGoogle3DManager && data.lat && data.lon) {
      MapGoogle3DManager.updateDronePosition(data.lat, data.lon, data.heading, data.altitude);
    }
  });

  // 3. Sidebar Collapse Toggle
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebarNav = document.getElementById('sidebarNav');
  if (menuToggleBtn && sidebarNav) {
    menuToggleBtn.addEventListener('click', () => {
      sidebarNav.classList.toggle('collapsed');
      setTimeout(() => {
        if (window.MapGoogle3DManager) MapGoogle3DManager.resize();
      }, 310);
    });
  }

  // 4. Notification Dropdown Toggle
  const notifBtn = document.getElementById('notifBtn');
  const notifDropdown = document.getElementById('notifDropdown');
  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notifDropdown.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!notifDropdown.contains(e.target) && e.target !== notifBtn) {
        notifDropdown.classList.remove('show');
      }
    });
  }

  // 5. Tactical Layers Toggle
  const layerToggleBtn = document.getElementById('layerToggleBtn');
  const tacticalLegend = document.getElementById('tacticalLegend');
  if (layerToggleBtn && tacticalLegend) {
    layerToggleBtn.addEventListener('click', () => {
      const isVisible = tacticalLegend.style.display !== 'none';
      tacticalLegend.style.display = isVisible ? 'none' : 'flex';
      window.showToast(isVisible ? 'HUD Legend Hidden' : 'HUD Legend Visible');
    });
  }

  console.log('[AEROSIGHT] Google 3D Satellite Autonomous Disaster Response Platform initialized.');
});
