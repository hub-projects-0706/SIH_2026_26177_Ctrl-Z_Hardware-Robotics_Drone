/**
 * AEROSIGHT - Selected Target Details Module
 * Manages target preview image, telemetry metadata, copy coordinates,
 * View on Map, Notify Rescue Team, and Mark as Rescued actions.
 */

const TargetDetailsManager = (() => {
  let currentTarget = null;

  function init() {
    setupButtons();
  }

  function setupButtons() {
    // Copy Coordinates Button
    const copyBtn = document.getElementById('copyCoordsBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        if (currentTarget && currentTarget.rescueCoordsStr && currentTarget.rescueCoordsStr !== '-') {
          navigator.clipboard.writeText(currentTarget.rescueCoordsStr);
          if (window.showToast) {
            window.showToast(`Rescue Coordinates copied: ${currentTarget.rescueCoordsStr}`);
          }
        }
      });
    }

    // View on Map Button
    const viewMapBtn = document.getElementById('btnViewOnMap');
    if (viewMapBtn) {
      viewMapBtn.addEventListener('click', () => {
        if (!currentTarget) return;
        if (window.Map2DManager && currentTarget.lat && currentTarget.lon) {
          window.Map2DManager.panToLocation(currentTarget.lat, currentTarget.lon);
        }
        if (window.Map3DManager && currentTarget.lat && currentTarget.lon) {
          window.Map3DManager.focusTarget(currentTarget.lat, currentTarget.lon);
        }
        if (window.showToast) {
          window.showToast(`Target ${currentTarget.id} centered in tactical live map view.`);
        }
      });
    }

    // Notify Rescue Team Button -> Opens Modal
    const notifyBtn = document.getElementById('btnNotifyRescue');
    if (notifyBtn) {
      notifyBtn.addEventListener('click', () => {
        if (!currentTarget) return;
        openRescueModal(currentTarget);
      });
    }

    // Mark as Rescued Button
    const markBtn = document.getElementById('btnMarkRescued');
    if (markBtn) {
      markBtn.addEventListener('click', async () => {
        if (!currentTarget) return;
        const newStatus = currentTarget.status === 'Rescued' ? 'Not Rescued' : 'Rescued';
        currentTarget.status = newStatus;
        updateTarget(currentTarget);

        if (window.DetectionsManager) {
          window.DetectionsManager.updateTargetStatus(currentTarget.id, newStatus);
        }

        // Call backend API
        try {
          await fetch(`/api/detections/${encodeURIComponent(currentTarget.id)}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
          });
        } catch (e) {
          console.warn("Status update fallback", e);
        }

        if (window.showToast) {
          window.showToast(`Target ${currentTarget.id} updated to: ${newStatus}`);
        }
      });
    }

    // Modal Close and Dispatch handlers
    setupModalHandlers();
  }

  function updateTarget(target) {
    currentTarget = target;

    const imgEl = document.getElementById('selectedTargetImg');
    const idEl = document.getElementById('dtTargetId');
    const typeEl = document.getElementById('dtType');
    const confEl = document.getElementById('dtConfidence');
    const locEl = document.getElementById('dtLocation');
    const coordsEl = document.getElementById('dtRescueCoords');
    const altEl = document.getElementById('dtAltitude');
    const timeEl = document.getElementById('dtTime');
    const statusEl = document.getElementById('dtStatus');

    if (imgEl && target.image) imgEl.src = target.image;
    if (idEl) idEl.textContent = target.id;
    if (typeEl) typeEl.textContent = target.label || target.type;
    if (confEl) {
      confEl.textContent = target.confidence ? `${target.confidence}%` : '-';
    }
    if (locEl) locEl.textContent = target.locationStr;
    if (coordsEl) coordsEl.textContent = target.rescueCoordsStr;
    if (altEl) altEl.textContent = target.altitude || '120 m';
    if (timeEl) timeEl.textContent = target.time || '10:42:13';

    if (statusEl) {
      statusEl.textContent = target.status;
      if (target.status === 'Rescued') {
        statusEl.className = 'info-val text-green font-bold';
      } else if (target.status === 'En Route' || target.status === 'Rescue Dispatched') {
        statusEl.className = 'info-val text-cyan font-bold';
      } else {
        statusEl.className = 'info-val text-red font-bold';
      }
    }
  }

  function openRescueModal(target) {
    const backdrop = document.getElementById('rescueModalBackdrop');
    const modalTargetId = document.getElementById('modalTargetId');
    const modalRescueCoords = document.getElementById('modalRescueCoords');

    if (modalTargetId) modalTargetId.value = `${target.id} - ${target.label || target.type}`;
    if (modalRescueCoords) modalRescueCoords.value = target.rescueCoordsStr !== '-' ? target.rescueCoordsStr : target.locationStr;
    if (backdrop) backdrop.classList.add('show');
  }

  function setupModalHandlers() {
    const backdrop = document.getElementById('rescueModalBackdrop');
    const closeBtn = document.getElementById('modalCloseBtn');
    const cancelBtn = document.getElementById('modalCancelBtn');
    const dispatchBtn = document.getElementById('modalDispatchBtn');

    const closeModal = () => {
      if (backdrop) backdrop.classList.remove('show');
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    if (dispatchBtn) {
      dispatchBtn.addEventListener('click', async () => {
        const teamSelect = document.getElementById('modalTeamSelect');
        const etaInput = document.getElementById('modalEta');
        const teamName = teamSelect ? teamSelect.value.split(' (')[0] : 'Team Alpha';
        const eta = etaInput ? etaInput.value : '7 min';

        if (currentTarget) {
          currentTarget.status = 'En Route';
          updateTarget(currentTarget);
          if (window.DetectionsManager) {
            window.DetectionsManager.updateTargetStatus(currentTarget.id, 'En Route');
          }

          // Add to Rescue Coordinates Log
          if (window.RescueLogManager) {
            window.RescueLogManager.addDispatch({
              targetId: currentTarget.id,
              coords: currentTarget.rescueCoordsStr !== '-' ? currentTarget.rescueCoordsStr : currentTarget.locationStr,
              assignedTeam: teamName,
              eta: eta
            });
          }
        }

        closeModal();
        if (window.showToast) {
          window.showToast(`Rescue Dispatched: ${teamName} assigned to ${currentTarget.id} (ETA ${eta})`);
        }
      });
    }
  }

  return {
    init,
    updateTarget
  };
})();

window.TargetDetailsManager = TargetDetailsManager;
