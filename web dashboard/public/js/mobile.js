/**
 * AEROSIGHT - Mobile Drone Camera Transmitter
 * Streams mobile camera frames & sensor telemetry (compass, pitch, roll, GPS)
 * via WebSocket to the AEROSIGHT command dashboard in real-time.
 */

(() => {
  const videoEl = document.getElementById('cameraVideo');
  const canvasEl = document.getElementById('frameCanvas');
  const ctx = canvasEl.getContext('2d');

  // UI Elements
  const connectionBadge = document.getElementById('connectionBadge');
  const statusText = document.getElementById('statusText');
  const headingChip = document.getElementById('headingChip');
  const fpsChip = document.getElementById('fpsChip');
  const horizonLine = document.getElementById('horizonLine');
  const mobileAlt = document.getElementById('mobileAlt');
  const mobilePitch = document.getElementById('mobilePitch');
  const mobileRoll = document.getElementById('mobileRoll');

  // Dynamic Targeting Reticle & Accuracy Elements
  const targetingReticle = document.getElementById('targetingReticle');
  const lockStatusTitle = document.getElementById('lockStatusTitle');
  const reticleConfVal = document.getElementById('reticleConfVal');
  const btnMobileClear = document.getElementById('btnMobileClear');
  const httpsAlertBanner = document.getElementById('httpsAlertBanner');
  const linkSwitchHttps = document.getElementById('linkSwitchHttps');
  const btnMobileSnap = document.getElementById('btnMobileSnap');
  const mobileSnapInput = document.getElementById('mobileSnapInput');
  const snapshotPreview = document.getElementById('snapshotPreview');

  // Buttons
  const btnFlip = document.getElementById('btnFlipCamera');
  const btnQuality = document.getElementById('btnQuality');
  const qualityLabel = document.getElementById('qualityLabel');
  const btnToggleTx = document.getElementById('btnToggleTx');
  const txLabel = document.getElementById('txLabel');
  const btnTorch = document.getElementById('btnTorch');

  // Check if running on insecure HTTP on mobile (non-localhost)
  function checkSecureContext() {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isHttps = window.location.protocol === 'https:';
    if (!isHttps && !isLocal) {
      if (httpsAlertBanner && linkSwitchHttps) {
        httpsAlertBanner.style.display = 'flex';
        linkSwitchHttps.href = `https://${window.location.hostname}:3443/mobile`;
      }
    }
  }

  // 2. Camera Stream
  async function startCamera() {
    checkSecureContext();

    if (currentTrack) {
      currentTrack.stop();
    }

    // Modern mobile browsers restrict getUserMedia to secure contexts (HTTPS or localhost)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn('[Mobile Drone] navigator.mediaDevices is not available in this context (insecure HTTP).');
      if (httpsAlertBanner) httpsAlertBanner.style.display = 'flex';
      if (statusText) statusText.textContent = 'USE SNAP / HTTPS';
      return;
    }

    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: currentFacingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoEl.srcObject = stream;
      currentTrack = stream.getVideoTracks()[0];
      await videoEl.play();
      if (snapshotPreview) snapshotPreview.style.display = 'none';
      videoEl.style.display = 'block';
    } catch (err) {
      console.warn('Could not get ideal camera, trying fallback', err);
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        videoEl.srcObject = fallbackStream;
        currentTrack = fallbackStream.getVideoTracks()[0];
        await videoEl.play();
        if (snapshotPreview) snapshotPreview.style.display = 'none';
        videoEl.style.display = 'block';
      } catch (e) {
        console.warn('Camera access error:', e);
        if (httpsAlertBanner) httpsAlertBanner.style.display = 'flex';
        if (statusText) statusText.textContent = 'USE SNAP / HTTPS';
      }
    }
  }

  // State
  let ws = null;
  let isTransmitting = true;
  let currentFacingMode = 'environment'; // 'environment' (back) or 'user' (front)
  let currentTrack = null;
  let isTorchOn = false;
  let currentQuality = '720p'; // '480p', '720p', '1080p'
  let targetWidth = 640;
  let targetHeight = 360;
  let jpegQuality = 0.65;
  let frameInterval = 66; // ~15-18 FPS
  let txIntervalId = null;
  let framesSent = 0;
  let lastFpsCheck = Date.now();

  // Target Lock Tracking State
  let targetLockTimeout = null;
  let lastVibrateTime = 0;
  let audioCtx = null;

  function playLockChirp() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.08); // E6
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.09);
    } catch (e) {}
  }

  function setTargetLock(locked, confidence, label) {
    if (locked) {
      if (targetingReticle) targetingReticle.classList.add('locked');
      if (lockStatusTitle) lockStatusTitle.textContent = 'TARGET LOCKED: HUMAN';
      const confPct = typeof confidence === 'number' ? (confidence <= 1 ? (confidence * 100).toFixed(1) : confidence.toFixed(1)) : '94.2';
      if (reticleConfVal) reticleConfVal.textContent = `ACCURACY: ${confPct}%`;

      // Haptic pulse on mobile device (throttled to once every 2.5s)
      const now = Date.now();
      if (now - lastVibrateTime > 2500) {
        lastVibrateTime = now;
        if (navigator.vibrate) {
          navigator.vibrate([80, 40, 80]);
        }
        playLockChirp();
      }

      // Reset debounce timeout
      if (targetLockTimeout) clearTimeout(targetLockTimeout);
      targetLockTimeout = setTimeout(() => {
        resetTargetLock();
      }, 1500);
    } else {
      if (!targetLockTimeout) {
        resetTargetLock();
      }
    }
  }

  function resetTargetLock() {
    if (targetingReticle) targetingReticle.classList.remove('locked');
    if (lockStatusTitle) lockStatusTitle.textContent = 'SEARCHING...';
    if (reticleConfVal) reticleConfVal.textContent = 'AIM AT HUMAN';
    if (targetLockTimeout) {
      clearTimeout(targetLockTimeout);
      targetLockTimeout = null;
    }
  }

  // Telemetry buffer
  const telemetry = {
    heading: 42,
    pitch: 0,
    roll: 0,
    altitude: 120,
    lat: 10.0234,
    lon: 78.1234
  };

  // Initialize
  async function init() {
    setupWebSocket();
    await startCamera();
    setupSensors();
    setupButtons();
    startFrameLoop();
  }

  // 1. WebSocket Connection
  function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Mobile Drone] Connected to AEROSIGHT Server');
      connectionBadge.className = 'hud-connection connected';
      statusText.textContent = 'ONLINE [TX]';
      ws.send(JSON.stringify({ type: 'register', role: 'drone_sender' }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'target_lock') {
          setTargetLock(msg.locked, msg.confidence, msg.label);
        } else if (msg.type === 'new_detection' && msg.data) {
          const conf = msg.data.confidence;
          setTargetLock(true, conf, msg.data.label || 'Person');
        } else if (msg.type === 'clear_detections') {
          resetTargetLock();
        }
      } catch (err) {
        console.warn('Mobile WS message parse error', err);
      }
    };

    ws.onclose = () => {
      console.log('[Mobile Drone] Disconnected from server. Reconnecting in 2s...');
      connectionBadge.className = 'hud-connection';
      statusText.textContent = 'RECONNECTING...';
      setTimeout(setupWebSocket, 2000);
    };

    ws.onerror = (err) => {
      console.warn('[Mobile Drone] WS Error', err);
    };
  }


  // 3. Frame Capture & Streaming Loop
  function startFrameLoop() {
    if (txIntervalId) clearInterval(txIntervalId);

    txIntervalId = setInterval(() => {
      if (!isTransmitting) return;
      if (!videoEl.videoWidth || !videoEl.videoHeight) return;

      // Set canvas size according to quality settings
      canvasEl.width = targetWidth;
      canvasEl.height = targetHeight;

      // Draw current video frame
      ctx.drawImage(videoEl, 0, 0, targetWidth, targetHeight);

      // Convert to compressed JPEG data URL
      const dataUrl = canvasEl.toDataURL('image/jpeg', jpegQuality);

      const payload = {
        type: 'video_frame',
        data: dataUrl,
        telemetry: {
          heading: telemetry.heading,
          pitch: telemetry.pitch,
          roll: telemetry.roll,
          altitude: telemetry.altitude,
          lat: telemetry.lat,
          lon: telemetry.lon
        },
        timestamp: Date.now()
      };

      // Prefer WebSocket for ultra-low latency; fallback to HTTP POST
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      } else {
        fetch('/api/drone/frame', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => {});
      }

      framesSent++;
      const now = Date.now();
      if (now - lastFpsCheck >= 1000) {
        const fps = framesSent;
        fpsChip.textContent = `${fps} FPS`;
        framesSent = 0;
        lastFpsCheck = now;
      }
    }, frameInterval);
  }

  // 4. Sensors (Compass & Orientation & GPS)
  function setupSensors() {
    // Gyroscope / Compass
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', (e) => {
        let heading = 0;
        if (e.webkitCompassHeading) {
          // iOS Safari compass
          heading = e.webkitCompassHeading;
        } else if (e.alpha !== null) {
          // Android Chrome compass
          heading = 360 - e.alpha;
        }

        telemetry.heading = Math.round(heading % 360);
        telemetry.pitch = Math.round(e.beta || 0);
        telemetry.roll = Math.round(e.gamma || 0);

        // Update UI
        headingChip.textContent = `HDG: ${String(telemetry.heading).padStart(3, '0')}°`;
        mobilePitch.textContent = `${telemetry.pitch}°`;
        mobileRoll.textContent = `${telemetry.roll}°`;

        // Update artificial horizon bar
        if (horizonLine) {
          horizonLine.style.transform = `rotate(${-telemetry.roll}deg) translateY(${telemetry.pitch * 1.2}px)`;
        }
      });
    }

    // Geolocation (if allowed)
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (pos) => {
          telemetry.lat = pos.coords.latitude;
          telemetry.lon = pos.coords.longitude;
          if (pos.coords.altitude) {
            telemetry.altitude = Math.round(pos.coords.altitude);
            mobileAlt.textContent = `${telemetry.altitude} M`;
          }
        },
        (err) => {},
        { enableHighAccuracy: true }
      );
    }
  }

  // 5. Buttons Interaction
  function setupButtons() {
    // Flip Camera
    btnFlip.addEventListener('click', async () => {
      currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
      await startCamera();
    });

    // Snap Photo Universal Fallback
    if (btnMobileSnap && mobileSnapInput) {
      btnMobileSnap.addEventListener('click', () => {
        mobileSnapInput.click();
      });

      mobileSnapInput.addEventListener('change', () => {
        const file = mobileSnapInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            canvasEl.width = 640;
            canvasEl.height = Math.round(640 * (img.height / img.width));
            ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
            const dataUrl = canvasEl.toDataURL('image/jpeg', 0.75);

            if (snapshotPreview) {
              snapshotPreview.src = dataUrl;
              snapshotPreview.style.display = 'block';
              videoEl.style.display = 'none';
            }

            const payload = {
              type: 'video_frame',
              data: dataUrl,
              telemetry: { ...telemetry },
              timestamp: Date.now()
            };

            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(payload));
            } else {
              fetch('/api/drone/frame', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              }).catch(() => {});
            }

            if (fpsChip) fpsChip.textContent = 'PHOTO TX';
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    // Clear History Button
    if (btnMobileClear) {
      btnMobileClear.addEventListener('click', async () => {
        if (confirm('Clear all previous detection records and reset targets?')) {
          try {
            const res = await fetch('/api/detections/clear', { method: 'POST' });
            if (res.ok) {
              resetTargetLock();
              alert('All detection history cleared successfully.');
            }
          } catch (e) {
            console.error('Clear error:', e);
          }
        }
      });
    }

    // Quality selector
    btnQuality.addEventListener('click', () => {
      if (currentQuality === '720p') {
        currentQuality = '480p';
        targetWidth = 480;
        targetHeight = 270;
        qualityLabel.textContent = '480p SD';
      } else if (currentQuality === '480p') {
        currentQuality = '360p Fast';
        targetWidth = 360;
        targetHeight = 200;
        qualityLabel.textContent = '360p Fast';
      } else {
        currentQuality = '720p';
        targetWidth = 640;
        targetHeight = 360;
        qualityLabel.textContent = '720p HD';
      }
    });

    // Transmission Toggle
    btnToggleTx.addEventListener('click', () => {
      isTransmitting = !isTransmitting;
      if (isTransmitting) {
        btnToggleTx.classList.remove('paused');
        txLabel.textContent = 'TRANSMITTING';
      } else {
        btnToggleTx.classList.add('paused');
        txLabel.textContent = 'STANDBY';
      }
    });

    // Spotlight Torch
    btnTorch.addEventListener('click', async () => {
      if (!currentTrack) return;
      try {
        const capabilities = currentTrack.getCapabilities ? currentTrack.getCapabilities() : {};
        if (capabilities.torch) {
          isTorchOn = !isTorchOn;
          await currentTrack.applyConstraints({
            advanced: [{ torch: isTorchOn }]
          });
          btnTorch.style.color = isTorchOn ? 'var(--cyan-neon)' : '#ffffff';
        } else {
          alert('Torch flashlight is not supported on this camera/browser.');
        }
      } catch (err) {
        console.warn('Torch error', err);
      }
    });
  }

  window.addEventListener('DOMContentLoaded', init);
})();
