/**
 * AEROSIGHT - AI Detection Results Module
 * Handles loading, filtering, rendering, and selecting AI detections
 */

const DetectionsManager = (() => {
  let detections = [];
  let currentFilter = 'all';
  let selectedTargetId = '#001';
  let ws = null;

  async function init() {
    setupFilterPills();
    setupClearButton();
    await fetchDetections();
    if (detections.length > 0) {
      selectTarget(detections[0].id);
    }
    setupWebSocket();
    // Periodic refresh for resilient offline-synced records
    setInterval(fetchDetections, 3000);
  }

  function setupWebSocket() {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'register', role: 'dashboard' }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'new_detection' && msg.data) {
            addOrUpdateDetection(msg.data);
          } else if (msg.type === 'clear_detections') {
            clearLocalDetections();
          } else if (msg.type === 'telemetry_update' && msg.telemetry && window.TelemetryManager) {
            TelemetryManager.updateTelemetry(msg.telemetry);
          } else if (msg.type === 'new_alert' && msg.alert) {
            if (window.showToast) {
              window.showToast(`🚨 ALERT [${msg.alert.severity || 'WARNING'}]: ${msg.alert.message || 'Disaster Event'}`);
            }
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        setTimeout(setupWebSocket, 3000);
      };
    } catch (err) {
      console.warn("WebSocket initialization deferred", err);
    }
  }

  async function fetchDetections() {
    try {
      const res = await fetch('/api/detections');
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          detections = json.data;
          renderTable();
          updateBadgeCount();

          // Sync with Map2D markers
          if (window.Map2DManager && Map2DManager.addVictimMarker) {
            detections.forEach(item => {
              if (item.type === 'Person' && item.lat && item.lon) {
                Map2DManager.addVictimMarker(item);
              }
            });
          }

          // Sync with Map3D markers
          if (window.Map3DManager && Map3DManager.addVictimMarker) {
            detections.forEach(item => {
              if (item.type === 'Person') {
                Map3DManager.addVictimMarker(item);
              }
            });
          }
        }
      }
    } catch (err) {
      console.warn("Using fallback detection data", err);
    }
  }

  function addOrUpdateDetection(det) {
    const existingIdx = detections.findIndex(d => d.id === det.id);
    if (existingIdx >= 0) {
      detections[existingIdx] = { ...detections[existingIdx], ...det };
    } else {
      detections.unshift(det);
    }
    renderTable();
    updateBadgeCount();

    if (window.Map2DManager && Map2DManager.addVictimMarker && det.type === 'Person') {
      Map2DManager.addVictimMarker(det);
    }

    if (window.Map3DManager && Map3DManager.addVictimMarker && det.type === 'Person') {
      Map3DManager.addVictimMarker(det);
    }

    if (window.showToast) {
      window.showToast(`🚨 VICTIM LOCATED: [${det.id}] Priority: ${det.priority || 'HIGH'}`);
    }

    selectTarget(det.id);
  }

  function setupFilterPills() {
    const pills = document.querySelectorAll('.filter-pill');
    pills.forEach(pill => {
      pill.addEventListener('click', () => {
        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentFilter = pill.getAttribute('data-category');
        renderTable();
      });
    });
  }

  function renderTable() {
    const tbody = document.getElementById('detectionsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const filtered = detections.filter(item => {
      if (currentFilter === 'all') return true;
      return item.type === currentFilter;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 20px; color: var(--text-muted);">No detections in this category</td></tr>`;
      return;
    }

    filtered.forEach(item => {
      const tr = document.createElement('tr');
      if (item.id === selectedTargetId) tr.classList.add('selected');

      // Type Icon & formatting
      let typeHtml = '';
      if (item.type === 'Person') {
        typeHtml = `
          <div class="type-cell person">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#ff3b56">
              <circle cx="12" cy="7" r="5"/>
              <path d="M12 13c-5 0-9 4-9 9h18c0-5-4-9-9-9z"/>
            </svg>
            <span>Person</span>
          </div>
        `;
      } else if (item.type === 'Hazard') {
        typeHtml = `
          <div class="type-cell hazard">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffaa00" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <span>Hazard</span>
          </div>
        `;
      } else {
        typeHtml = `<span>${item.type}</span>`;
      }

      // Confidence badge
      const confHtml = item.confidence ? `<span class="conf-badge">${item.confidence}%</span>` : `<span style="color:var(--text-muted);">-</span>`;

      // Rescue Coords
      const rescueHtml = item.rescueCoordsStr && item.rescueCoordsStr !== '-' ? `
        <div class="coords-copy-wrap">
          <span>${item.rescueCoordsStr}</span>
          <button class="copy-inline-btn" data-coords="${item.rescueCoordsStr}" title="Copy">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      ` : `<span style="color:var(--text-muted);">-</span>`;

      tr.innerHTML = `
        <td><span class="target-id-badge">${item.id}</span></td>
        <td>${typeHtml}</td>
        <td>${confHtml}</td>
        <td>${item.locationStr}</td>
        <td>${rescueHtml}</td>
        <td style="color:var(--text-muted); font-family:var(--font-tactical); font-size:11px;">${item.time}</td>
        <td><img src="${item.image}" class="table-thumb-img" alt="thumb"></td>
        <td><button class="btn-table-view" data-id="${item.id}">View</button></td>
      `;

      // Row click listener
      tr.addEventListener('click', (e) => {
        if (!e.target.closest('.copy-inline-btn')) {
          selectTarget(item.id);
        }
      });

      // Inline copy button
      const copyBtn = tr.querySelector('.copy-inline-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const coords = copyBtn.getAttribute('data-coords');
          navigator.clipboard.writeText(coords);
          if (window.showToast) {
            window.showToast(`Coordinates ${coords} copied to clipboard!`);
          }
        });
      }

      tbody.appendChild(tr);
    });
  }

  function selectTarget(targetId) {
    selectedTargetId = targetId;
    const target = detections.find(d => d.id === targetId);
    if (!target) return;

    // Highlight row
    const rows = document.querySelectorAll('#detectionsTableBody tr');
    rows.forEach(r => {
      const idBadge = r.querySelector('.target-id-badge');
      if (idBadge && idBadge.textContent === targetId) {
        r.classList.add('selected');
      } else {
        r.classList.remove('selected');
      }
    });

    // Update Target Details Panel
    if (window.TargetDetailsManager) {
      window.TargetDetailsManager.updateTarget(target);
    }

    // Pan / Focus 2D and 3D Maps
    if (window.Map2DManager && target.lat && target.lon) {
      window.Map2DManager.panToLocation(target.lat, target.lon);
    }
    if (window.Map3DManager && target.lat && target.lon) {
      window.Map3DManager.focusTarget(target.lat, target.lon);
    }
  }

  function updateBadgeCount() {
    const badge = document.getElementById('sidebarDetectionCount');
    if (badge) badge.textContent = detections.length;
    const newBadge = document.getElementById('detectionsNewBadge');
    if (newBadge) newBadge.textContent = detections.length > 0 ? `${detections.length} New` : 'Live';
  }

  function clearLocalDetections() {
    detections = [];
    selectedTargetId = null;
    renderTable();
    updateBadgeCount();
    if (window.Map2DManager && Map2DManager.clearVictimMarkers) {
      Map2DManager.clearVictimMarkers();
    }
    if (window.Map3DManager && Map3DManager.clearVictimMarkers) {
      Map3DManager.clearVictimMarkers();
    }
    const detailsWrap = document.querySelector('.target-details-body');
    if (detailsWrap) {
      detailsWrap.innerHTML = `
        <div style="text-align:center; padding: 45px 12px; color: var(--text-muted); font-family: var(--font-tactical);">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:12px; opacity:0.5;">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div style="font-weight:700; letter-spacing:0.8px;">NO TARGET SELECTED</div>
          <div style="font-size:11.5px; margin-top:5px; opacity:0.7;">Camera feed active. Detections will appear here in real time.</div>
        </div>
      `;
    }
  }

  function setupClearButton() {
    const btn = document.getElementById('btnClearDetections');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all previous detections and start a clean session?')) {
        try {
          const res = await fetch('/api/detections/clear', { method: 'POST' });
          if (res.ok) {
            clearLocalDetections();
            if (window.showToast) {
              window.showToast('✅ All previous detection records cleared successfully!');
            }
          }
        } catch (err) {
          console.error('Failed to clear detections', err);
        }
      }
    });
  }

  function getTarget(id) {
    return detections.find(d => d.id === id);
  }

  function updateTargetStatus(id, newStatus) {
    const item = detections.find(d => d.id === id);
    if (item) {
      item.status = newStatus;
      renderTable();
    }
  }

  return {
    init,
    selectTarget,
    getTarget,
    updateTargetStatus,
    addOrUpdateDetection,
    clearLocalDetections
  };
})();

window.DetectionsManager = DetectionsManager;
