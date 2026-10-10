/**
 * A.S.A.R.D - Target Details & Forensic Snapshot Viewer Module
 * Manages selected victim reconnaissance metadata and high-resolution
 * snapshot inspection with OpenCV red-box reticle & disaster classification.
 */

const TargetDetailsManager = (() => {
  let currentTarget = null;

  function init() {
    setupButtons();
    setupSnapshotModalHandlers();

    // Default seed target (#V001 with OpenCV red-box reticle snapshot)
    updateTarget({
      id: '#V001',
      victim_id: 'V001',
      type: 'Person',
      label: 'Person (Victim #V001)',
      confidence: 94,
      locationStr: '10.0234° N, 78.1234° E',
      rescueCoordsStr: '10.0234° N, 78.1234° E',
      altitude: '35 m',
      priority: 'CRITICAL',
      priority_explanation: 'OpenCV Red-Reticle AI Detected | Single Verified Target',
      time: new Date().toTimeString().split(' ')[0],
      status: 'Not Rescued',
      disaster_type: 'Earthquake (Structural Collapse)',
      image: '/assets/victim_v001_snapshot.jpg',
      snapshot: '/assets/victim_v001_snapshot.jpg',
      deduplication_status: 'Single Verified Target (No Duplication)'
    });
  }

  function getFallbackTarget() {
    if (currentTarget) return currentTarget;
    if (window.detections && window.detections.length > 0) return window.detections[0];
    return {
      id: '#V001',
      victim_id: 'V001',
      type: 'Person',
      label: 'Person (Victim #V001)',
      confidence: 94,
      locationStr: '10.0234° N, 78.1234° E',
      rescueCoordsStr: '10.0234° N, 78.1234° E',
      altitude: '35 m',
      priority: 'CRITICAL',
      time: new Date().toTimeString().split(' ')[0],
      status: 'Not Rescued',
      disaster_type: 'Earthquake (Structural Collapse)',
      image: '/assets/victim_v001_snapshot.jpg',
      snapshot: '/assets/victim_v001_snapshot.jpg',
      deduplication_status: 'Single Verified Target (No Duplication)'
    };
  }

  function setupButtons() {
    // Copy Coordinates Button
    const copyBtn = document.getElementById('copyCoordsBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const target = getFallbackTarget();
        if (target && target.rescueCoordsStr && target.rescueCoordsStr !== '-') {
          navigator.clipboard.writeText(target.rescueCoordsStr);
          if (window.showToast) {
            window.showToast(`Rescue Coordinates copied: ${target.rescueCoordsStr}`);
          }
        }
      });
    }

    // PRIMARY ACTION: View Forensic Optical Snapshot
    const viewSnapshotBtn = document.getElementById('btnViewSnapshot');
    if (viewSnapshotBtn) {
      viewSnapshotBtn.addEventListener('click', () => {
        const target = getFallbackTarget();
        openSnapshotViewer(target);
      });
    }

    // Clicking target image box also opens snapshot viewer
    const targetImg = document.getElementById('selectedTargetImg');
    if (targetImg) {
      targetImg.style.cursor = 'pointer';
      targetImg.title = 'Click to view full forensic snapshot with red bounding box';
      targetImg.addEventListener('click', () => {
        const target = getFallbackTarget();
        openSnapshotViewer(target);
      });
    }
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
    const disasterEl = document.getElementById('dtDisaster');
    const dedupEl = document.getElementById('dtDedupStatus');

    const snapSrc = target.snapshot || target.image || '/assets/victim_v001_snapshot.jpg';
    if (imgEl) imgEl.src = snapSrc;
    if (idEl) idEl.textContent = target.id;
    if (typeEl) typeEl.textContent = target.label || target.type;
    if (confEl) {
      confEl.textContent = target.confidence ? `${target.confidence}%` : '-';
    }
    if (locEl) locEl.textContent = target.locationStr;
    if (coordsEl) coordsEl.textContent = target.rescueCoordsStr;
    if (altEl) altEl.textContent = target.altitude || '35 m';
    if (timeEl) timeEl.textContent = target.time || '10:42:13';

    if (disasterEl) {
      disasterEl.textContent = target.disaster_type || 'Earthquake (Structural Collapse)';
    }

    if (dedupEl) {
      dedupEl.textContent = target.deduplication_status || 'Single Verified Target (No Duplication)';
    }

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

  function openSnapshotViewer(target) {
    const activeTarget = target || getFallbackTarget();
    const backdrop = document.getElementById('snapshotViewerModalBackdrop');
    if (!backdrop) {
      console.warn('[TargetDetails] #snapshotViewerModalBackdrop not found in DOM');
      return;
    }

    const snapSrc = activeTarget.snapshot || activeTarget.image || '/assets/victim_v001_snapshot.jpg';
    const coordsStr = activeTarget.rescueCoordsStr && activeTarget.rescueCoordsStr !== '-' ? activeTarget.rescueCoordsStr : activeTarget.locationStr;
    const disasterName = activeTarget.disaster_type || 'Earthquake (Structural Collapse)';
    const confVal = activeTarget.confidence || 94;

    // Set UI elements
    const titleEl = document.getElementById('modalSnapTitle');
    const disasterTextEl = document.getElementById('modalSnapDisasterText');
    const imgEl = document.getElementById('modalSnapImg');
    const timeEl = document.getElementById('modalSnapTimestamp');
    const idEl = document.getElementById('modalSnapId');
    const confEl = document.getElementById('modalSnapConf');
    const coordsEl = document.getElementById('modalSnapCoords');
    const priorityEl = document.getElementById('modalSnapPriority');
    const altEl = document.getElementById('modalSnapAlt');
    const downloadLink = document.getElementById('btnDownloadSnapshot');

    if (titleEl) titleEl.textContent = `FORENSIC OPTICAL SNAPSHOT - TARGET ${activeTarget.id}`;
    if (disasterTextEl) {
      disasterTextEl.textContent = `DISASTER CLASSIFIED: ${disasterName.toUpperCase()} [${confVal}% CONF]`;
    }
    if (imgEl) imgEl.src = snapSrc;
    if (timeEl) timeEl.textContent = `${activeTarget.time || '12:00:00'} UTC`;
    if (idEl) idEl.textContent = activeTarget.id;
    if (confEl) confEl.textContent = `${confVal}% (OPENCV AI)`;
    if (coordsEl) coordsEl.textContent = coordsStr;
    if (priorityEl) priorityEl.textContent = activeTarget.priority || 'CRITICAL';
    if (altEl) altEl.textContent = activeTarget.altitude ? (activeTarget.altitude.includes('m') ? activeTarget.altitude : `${activeTarget.altitude} m AGL`) : '35.0 m AGL';

    if (downloadLink) {
      downloadLink.href = snapSrc;
      downloadLink.download = `A.S.A.R.D_${activeTarget.id.replace('#', '')}_Forensic_Snapshot.jpg`;
    }

    backdrop.style.position = 'fixed';
    backdrop.style.zIndex = '99999';
    backdrop.style.display = 'flex';
    backdrop.classList.add('show');
    backdrop.classList.add('active');
  }

  function closeSnapshotViewer() {
    const backdrop = document.getElementById('snapshotViewerModalBackdrop');
    if (backdrop) {
      backdrop.style.display = 'none';
      backdrop.classList.remove('show');
      backdrop.classList.remove('active');
    }
  }

  function setupSnapshotModalHandlers() {
    const backdrop = document.getElementById('snapshotViewerModalBackdrop');
    const closeBtn = document.getElementById('btnCloseSnapshotModal');
    const closeFooterBtn = document.getElementById('btnCloseSnapshotModalBtn');
    const copyCoordsBtn = document.getElementById('btnCopyModalCoords');
    const copyCoordsBtn2 = document.getElementById('btnCopySnapshotCoords');

    if (closeBtn) closeBtn.addEventListener('click', closeSnapshotViewer);
    if (closeFooterBtn) closeFooterBtn.addEventListener('click', closeSnapshotViewer);

    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeSnapshotViewer();
      });
    }

    const copyHandler = () => {
      if (currentTarget) {
        const coords = currentTarget.rescueCoordsStr && currentTarget.rescueCoordsStr !== '-' 
          ? currentTarget.rescueCoordsStr 
          : currentTarget.locationStr;
        navigator.clipboard.writeText(coords);
        if (window.showToast) {
          window.showToast(`GPS Coordinates copied to clipboard: ${coords}`);
        }
      }
    };

    if (copyCoordsBtn) copyCoordsBtn.addEventListener('click', copyHandler);
    if (copyCoordsBtn2) copyCoordsBtn2.addEventListener('click', copyHandler);

    // Escape key listener to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSnapshotViewer();
    });
  }

  return {
    init,
    updateTarget,
    showTarget: updateTarget,
    getCurrentTarget: () => currentTarget,
    openSnapshotViewer,
    closeSnapshotViewer
  };
})();

window.TargetDetailsManager = TargetDetailsManager;
window.openSnapshotViewer = TargetDetailsManager.openSnapshotViewer;
