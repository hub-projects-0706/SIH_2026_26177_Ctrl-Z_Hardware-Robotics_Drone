/**
 * AEROSIGHT - Drone Camera Feed Module
 * Supports:
 * 1. Live Smartphone Camera streaming as the Drone Recon Feed via WebSocket
 * 2. Real-time FLIR Ironbow Thermal heat filter transform
 * 3. Local PC Webcam direct connection
 * 4. Split-view, PIP, Swap, Fullscreen, and tactical HUD reticles
 */

const CameraFeedManager = (() => {
  let container;
  let splitBtn, rgbBtn, thermalBtn, pipBtn, swapBtn, fsBtn;
  let rgbWindow, thermalWindow;
  let currentMode = 'split';
  let isSwapped = false;

  // Live video elements
  let rgbImage, rgbCanvas, rgbCtx;
  let thermalImage, thermalCanvas, thermalCtx;
  let liveBadge, rgbLabelTag, thermalLabelTag;

  // Offscreen processing canvas for real-time Thermal conversion
  let offscreenCanvas, offscreenCtx;
  let ironbowPalette = [];

  // WebSocket
  let ws = null;
  let isMobileDroneActive = false;
  let localWebcamStream = null;
  let liveOverlayDetections = [];
  let lastIpWebcamTxTime = 0;
  let ipWebcamTxCanvas = null;
  let ipWebcamTxCtx = null;

  // Big Screen & ML Model Elements
  let bigScreenBtn = null;
  let bannerBigScreenBtn = null;
  let mobileLiveBanner = null;
  let activeMlModelText = null;
  let isBigScreen = false;
  let currentMlModel = 'RT-DETR-L';

  function init() {
    container = document.getElementById('cameraViewportContainer');
    splitBtn = document.getElementById('splitViewBtn');
    rgbBtn = document.getElementById('showRgbBtn');
    thermalBtn = document.getElementById('showThermalBtn');
    pipBtn = document.getElementById('showPipBtn');
    swapBtn = document.getElementById('swapFeedsBtn');
    fsBtn = document.getElementById('cameraFullscreenBtn');

    rgbWindow = document.getElementById('rgbFeedWindow');
    thermalWindow = document.getElementById('thermalFeedWindow');
    rgbImage = document.getElementById('rgbFeedImage');
    thermalImage = document.getElementById('thermalFeedImage');
    rgbCanvas = document.getElementById('rgbLiveCanvas');
    thermalCanvas = document.getElementById('thermalLiveCanvas');
    liveBadge = document.getElementById('liveDroneCamBadge');
    rgbLabelTag = document.getElementById('rgbLabelTag');
    thermalLabelTag = document.getElementById('thermalLabelTag');
    bigScreenBtn = document.getElementById('btnBigScreenToggle');
    bannerBigScreenBtn = document.getElementById('btnBannerBigScreen');
    mobileLiveBanner = document.getElementById('mobileLiveBanner');
    activeMlModelText = document.getElementById('activeMlModelText');

    if (rgbCanvas) rgbCtx = rgbCanvas.getContext('2d');
    if (thermalCanvas) thermalCtx = thermalCanvas.getContext('2d');

    // Create offscreen buffer for image processing
    offscreenCanvas = document.createElement('canvas');
    offscreenCtx = offscreenCanvas.getContext('2d');

    // Precompute 256-color FLIR Ironbow gradient lookup table for high performance
    generateIronbowPalette();

    setupEventListeners();
    setupMobileDroneModal();
    setupIpWebcamModal();
    setupTestImageUpload();
    setupWebSocket();
    startLiveTimestamp();
  }

  // Precompute Ironbow thermal colors (black -> purple -> crimson -> orange -> yellow -> white)
  function generateIronbowPalette() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0.0, '#000000');
    grad.addColorStop(0.18, '#350059');
    grad.addColorStop(0.38, '#870094');
    grad.addColorStop(0.62, '#e63b00');
    grad.addColorStop(0.82, '#ffae00');
    grad.addColorStop(0.94, '#ffff4d');
    grad.addColorStop(1.0, '#ffffff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 1);
    const data = ctx.getImageData(0, 0, 256, 1).data;
    ironbowPalette = [];
    for (let i = 0; i < 256; i++) {
      const idx = i * 4;
      ironbowPalette.push({
        r: data[idx],
        g: data[idx + 1],
        b: data[idx + 2]
      });
    }
  }

  // 1. WebSocket Client: Connects to AEROSIGHT Server
  function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Dashboard Live Feed] Subscribing as receiver...');
      ws.send(JSON.stringify({ type: 'register', role: 'dashboard' }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'drone_connected') {
          setDroneConnectedState(true);
        } else if (msg.type === 'drone_disconnected') {
          setDroneConnectedState(false);
        } else if (msg.type === 'video_frame') {
          renderLiveFrame(msg.data, msg.telemetry);
        } else if (msg.type === 'target_lock') {
          if (msg.model) {
            currentMlModel = msg.model;
            if (activeMlModelText) activeMlModelText.textContent = `ML: ${msg.model}`;
          }
          if (msg.locked && msg.bbox && Array.isArray(msg.bbox)) {
            liveOverlayDetections = [{
              bbox: msg.bbox,
              label: msg.label || 'Person',
              conf: msg.confidence,
              type: msg.label === 'Hazard' ? 'Hazard' : 'Person',
              model: msg.model || currentMlModel,
              id: 'LOCK',
              timestamp: Date.now()
            }];
          } else if (!msg.locked) {
            // Expire target lock promptly if no target
            liveOverlayDetections = [];
          }
        } else if (msg.type === 'new_detection' && msg.data) {
          if (msg.data.bbox && Array.isArray(msg.data.bbox)) {
            liveOverlayDetections = [{
              bbox: msg.data.bbox,
              label: msg.data.label || 'Person',
              conf: msg.data.confidence,
              type: msg.data.type || 'Person',
              id: msg.data.id || msg.data.victim_id || '',
              timestamp: Date.now()
            }];
          }
        } else if (msg.type === 'clear_detections') {
          liveOverlayDetections = [];
        }
      } catch (err) {
        console.error('Error handling live frame', err);
      }
    };

    ws.onclose = () => {
      setTimeout(setupWebSocket, 2500);
    };
  }

  function setDroneConnectedState(connected) {
    isMobileDroneActive = connected;
    const modalStatus = document.getElementById('mobileModalStatus');
    const modalStatusDot = document.getElementById('mobileModalStatusDot');
    const modalStatusText = document.getElementById('mobileModalStatusText');

    if (connected) {
      if (liveBadge) liveBadge.style.display = 'flex';
      if (mobileLiveBanner) mobileLiveBanner.style.display = 'flex';
      if (rgbLabelTag) rgbLabelTag.textContent = 'RGB (Live Smartphone Stream)';
      if (thermalLabelTag) thermalLabelTag.textContent = 'THERMAL FLIR (Live Synthetic)';
      if (modalStatus) modalStatus.className = 'mobile-connection-status connected';
      if (modalStatusDot) modalStatusDot.className = 'pulse-dot-green';
      if (modalStatusText) modalStatusText.textContent = 'Mobile Drone Online! Transmitting live video.';

      if (window.showToast) {
        window.showToast('Smartphone Camera Connected! Live video active. Click Big Screen to expand.');
      }
    } else {
      if (liveBadge) liveBadge.style.display = 'none';
      if (mobileLiveBanner) mobileLiveBanner.style.display = 'none';
      if (rgbLabelTag) rgbLabelTag.textContent = 'RGB (Visible Light)';
      if (thermalLabelTag) thermalLabelTag.textContent = 'THERMAL (IR)';
      if (modalStatus) modalStatus.className = 'mobile-connection-status';
      if (modalStatusDot) modalStatusDot.className = 'pulse-dot-amber';
      if (modalStatusText) modalStatusText.textContent = 'Waiting for smartphone transmitter...';

      // Restore static simulation views
      if (rgbImage) rgbImage.style.display = 'block';
      if (rgbCanvas) rgbCanvas.style.display = 'none';
      if (thermalImage) thermalImage.style.display = 'block';
      if (thermalCanvas) thermalCanvas.style.display = 'none';

      if (window.showToast) {
        window.showToast('Mobile Drone stream disconnected. Reverted to standby.');
      }
    }
  }

  // 2. Render Live Frame onto RGB and Real-Time FLIR Thermal Canvas
  function renderLiveFrame(dataUrl, telemetryData) {
    if (!dataUrl) return;

    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;

      // Switch to live canvases
      if (rgbImage && rgbCanvas) {
        rgbImage.style.display = 'none';
        rgbCanvas.style.display = 'block';
        rgbCanvas.width = w;
        rgbCanvas.height = h;
        rgbCtx.drawImage(img, 0, 0, w, h);

        // Draw live tactical AI reticles on mobile frame
        const now = Date.now();
        liveOverlayDetections = liveOverlayDetections.filter(d => (now - d.timestamp) < 3500);
        for (const det of liveOverlayDetections) {
          drawTacticalReticleOverlay(rgbCtx, det.bbox, det.label, det.conf, det.type, w, h);
        }
      }

      // Process Real-time Thermal Image on thermalCanvas
      if (thermalImage && thermalCanvas) {
        thermalImage.style.display = 'none';
        thermalCanvas.style.display = 'block';
        thermalCanvas.width = w;
        thermalCanvas.height = h;

        // Downscale offscreen for fast 60fps thermal pixel calculation
        offscreenCanvas.width = Math.min(w, 360);
        offscreenCanvas.height = Math.min(h, 240);
        offscreenCtx.drawImage(img, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

        const imgData = offscreenCtx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        const pixels = imgData.data;
        const total = pixels.length;

        for (let i = 0; i < total; i += 4) {
          // Compute luminance / heat proxy
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          // High contrast thermal mapping (reds/skin tones appear hotter)
          let heat = Math.round(0.4 * r + 0.4 * g + 0.2 * b);
          if (heat > 255) heat = 255;

          const color = ironbowPalette[heat] || ironbowPalette[0];
          pixels[i] = color.r;
          pixels[i + 1] = color.g;
          pixels[i + 2] = color.b;
        }

        offscreenCtx.putImageData(imgData, 0, 0);

        // Draw smoothly scaled to thermalCanvas
        thermalCtx.imageSmoothingEnabled = true;
        thermalCtx.drawImage(offscreenCanvas, 0, 0, w, h);
      }

      // If mobile sent heading, sync with compass & 3D drone
      if (telemetryData && typeof telemetryData.heading === 'number') {
        const compassDial = document.getElementById('compassDial');
        if (compassDial) {
          compassDial.style.transform = `rotate(${-telemetryData.heading}deg)`;
        }
      }
    };
    img.src = dataUrl;
  }

  function drawTacticalReticleOverlay(ctx, bbox, label, conf, type, w, h) {
    if (!bbox || bbox.length < 4) return;
    const [x1, y1, x2, y2] = bbox;
    const isPerson = (type !== 'Hazard' && label !== 'Hazard');
    
    // Clean, high-contrast tactical colors (solid emerald for survivor, solid crimson for hazard - NO NEON GLOW)
    const color = isPerson ? '#10b981' : '#ef4444';
    const tagBg = isPerson ? 'rgba(12, 28, 22, 0.95)' : 'rgba(38, 14, 18, 0.95)';
    const tagColor = isPerson ? '#34d399' : '#f87171';
    const cornerLen = Math.min(28, Math.max(14, (x2 - x1) / 3));

    ctx.save();
    // Zero neon blur or glow
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    // Thin clean target outline
    ctx.strokeStyle = isPerson ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

    // Solid, sharp corner brackets
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;

    // Top-Left
    ctx.beginPath();
    ctx.moveTo(x1, y1 + cornerLen);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 + cornerLen, y1);
    ctx.stroke();

    // Top-Right
    ctx.beginPath();
    ctx.moveTo(x2 - cornerLen, y1);
    ctx.lineTo(x2, y1);
    ctx.lineTo(x2, y1 + cornerLen);
    ctx.stroke();

    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(x1, y2 - cornerLen);
    ctx.lineTo(x1, y2);
    ctx.lineTo(x1 + cornerLen, y2);
    ctx.stroke();

    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(x2 - cornerLen, y2);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2, y2 - cornerLen);
    ctx.stroke();

    // Center crosshair (clean lines)
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
    ctx.moveTo(cx - 9, cy); ctx.lineTo(cx - 3, cy);
    ctx.moveTo(cx + 3, cy);  ctx.lineTo(cx + 9, cy);
    ctx.moveTo(cx, cy - 9); ctx.lineTo(cx, cy - 3);
    ctx.moveTo(cx, cy + 3);  ctx.lineTo(cx, cy + 9);
    ctx.stroke();

    // Crisp Non-Neon Target Lock Badge displaying trained model name
    const confVal = (typeof conf === 'number') ? (conf <= 1.0 ? (conf * 100).toFixed(1) : conf.toFixed(1)) : '94.2';
    const tagText = isPerson ? `🎯 TARGET LOCKED: HUMAN [${currentMlModel}] | ACCURACY: ${confVal}%` : `⚠️ HAZARD IDENTIFIED | CONF: ${confVal}%`;
    ctx.font = '600 12px "Inter", "Rajdhani", sans-serif';
    const textWidth = ctx.measureText(tagText).width;

    const tagY = Math.max(y1 - 18, 18);
    ctx.fillStyle = tagBg;
    ctx.fillRect(x1, tagY - 14, textWidth + 14, 20);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, tagY - 14, textWidth + 14, 20);

    ctx.fillStyle = tagColor;
    ctx.fillText(tagText, x1 + 7, tagY + 1);
    ctx.restore();
  }

  // ==========================================================================
  // 3. IP WEBCAM STREAM INTEGRATION (MJPEG via Proxy)
  // ==========================================================================
  let isIpWebcamActive = false;
  let ipWebcamImage = null;
  let ipWebcamLoopActive = false;

  function setupIpWebcamModal() {
    const btnConnect = document.getElementById('btnConnectIpWebcam');
    const modalBackdrop = document.getElementById('ipWebcamModalBackdrop');
    const btnClose = document.getElementById('ipModalCloseBtn');
    const btnCancel = document.getElementById('ipModalCancelBtn');
    const btnConfirm = document.getElementById('btnConfirmIpWebcam');
    const btnDisconnect = document.getElementById('btnDisconnectIpWebcam');
    const urlInput = document.getElementById('ipWebcamUrlInput');
    const statusText = document.getElementById('ipStatusText');
    const statusDot = document.getElementById('ipStatusDot');

    if (btnConnect && modalBackdrop) {
      btnConnect.addEventListener('click', () => {
        modalBackdrop.classList.add('show');
      });
    }

    const closeModal = () => {
      if (modalBackdrop) modalBackdrop.classList.remove('show');
    };

    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    // Connect IP Webcam Button
    if (btnConfirm && urlInput) {
      btnConfirm.addEventListener('click', async () => {
        const rawUrl = urlInput.value.trim();
        if (!rawUrl) {
          alert('Please enter your phone IP Webcam address (e.g. http://192.168.1.5:8080)');
          return;
        }

        if (statusText) statusText.textContent = 'Connecting to IP Webcam stream...';
        if (statusDot) statusDot.className = 'pulse-dot-amber';

        try {
          const res = await fetch('/api/ipwebcam/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: rawUrl })
          });

          if (res.ok) {
            const data = await res.json();
            startIpWebcamStream(data.targetUrl);

            if (statusText) statusText.textContent = `Connected to ${rawUrl}`;
            if (statusDot) statusDot.className = 'pulse-dot-green';
            if (btnDisconnect) btnDisconnect.style.display = 'inline-block';

            closeModal();
            if (window.showToast) {
              window.showToast(`IP Webcam connected! Streaming live video from ${rawUrl}`);
            }
          } else {
            throw new Error('Server rejected connection');
          }
        } catch (err) {
          alert('Could not connect to IP Webcam: ' + err.message);
          if (statusText) statusText.textContent = 'Connection failed. Check IP & Wi-Fi.';
          if (statusDot) statusDot.className = 'pulse-dot-amber';
        }
      });
    }

    // Disconnect IP Webcam Button
    if (btnDisconnect) {
      btnDisconnect.addEventListener('click', async () => {
        stopIpWebcamStream();
        try {
          await fetch('/api/ipwebcam/disconnect', { method: 'POST' });
        } catch (e) {}

        if (btnDisconnect) btnDisconnect.style.display = 'none';
        if (statusText) statusText.textContent = 'Disconnected. Enter IP to reconnect.';
        if (statusDot) statusDot.className = 'pulse-dot-amber';

        closeModal();
        if (window.showToast) {
          window.showToast('IP Webcam disconnected. Reverted to standby.');
        }
      });
    }
  }

  function startIpWebcamStream(directTargetUrl) {
    isIpWebcamActive = true;
    ipWebcamLoopActive = true;

    // Use server proxy stream to prevent CORS/private network blocking
    const streamProxyUrl = `/api/ipwebcam/stream?t=${Date.now()}`;

    // Create stream image element
    ipWebcamImage = new Image();
    ipWebcamImage.crossOrigin = 'anonymous';
    ipWebcamImage.src = streamProxyUrl;

    // Update UI headers
    if (liveBadge) {
      liveBadge.style.display = 'flex';
      liveBadge.innerHTML = `<span class="pulse-dot-green"></span><span>IP WEBCAM ONLINE</span>`;
    }
    if (rgbLabelTag) rgbLabelTag.textContent = 'RGB (Live IP Webcam)';
    if (thermalLabelTag) thermalLabelTag.textContent = 'THERMAL FLIR (Live IP Stream)';

    // Switch to canvas display
    if (rgbImage && rgbCanvas) {
      rgbImage.style.display = 'none';
      rgbCanvas.style.display = 'block';
    }
    if (thermalImage && thermalCanvas) {
      thermalImage.style.display = 'none';
      thermalCanvas.style.display = 'block';
    }

    // High performance frame rendering loop
    function renderLoop() {
      if (!isIpWebcamActive || !ipWebcamLoopActive) return;

      if (ipWebcamImage && ipWebcamImage.naturalWidth && ipWebcamImage.naturalHeight) {
        const w = ipWebcamImage.naturalWidth;
        const h = ipWebcamImage.naturalHeight;

        // Draw RGB canvas
        if (rgbCanvas && rgbCtx) {
          if (rgbCanvas.width !== w || rgbCanvas.height !== h) {
            rgbCanvas.width = w;
            rgbCanvas.height = h;
          }
          rgbCtx.drawImage(ipWebcamImage, 0, 0, w, h);
        }

        // Draw real-time Thermal Canvas
        if (thermalCanvas && thermalCtx) {
          if (thermalCanvas.width !== w || thermalCanvas.height !== h) {
            thermalCanvas.width = w;
            thermalCanvas.height = h;
          }

          // Scale to offscreen for fast thermal processing
          offscreenCanvas.width = 320;
          offscreenCanvas.height = Math.round(320 * (h / w));
          offscreenCtx.drawImage(ipWebcamImage, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

          const imgData = offscreenCtx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
          const pixels = imgData.data;
          const len = pixels.length;

          for (let i = 0; i < len; i += 4) {
            const heat = Math.round(0.4 * pixels[i] + 0.4 * pixels[i + 1] + 0.2 * pixels[i + 2]);
            const color = ironbowPalette[heat] || ironbowPalette[0];
            pixels[i] = color.r;
            pixels[i + 1] = color.g;
            pixels[i + 2] = color.b;
          }

          offscreenCtx.putImageData(imgData, 0, 0);
          thermalCtx.imageSmoothingEnabled = true;
          thermalCtx.drawImage(offscreenCanvas, 0, 0, w, h);
        }

        // Transmit mobile camera frame to Python YOLO AI Engine (~11 FPS)
        const now = Date.now();
        if (now - lastIpWebcamTxTime >= 90) {
          lastIpWebcamTxTime = now;
          if (!ipWebcamTxCanvas) {
            ipWebcamTxCanvas = document.createElement('canvas');
            ipWebcamTxCtx = ipWebcamTxCanvas.getContext('2d');
          }
          ipWebcamTxCanvas.width = 640;
          ipWebcamTxCanvas.height = Math.round(640 * (h / w)) || 360;
          ipWebcamTxCtx.drawImage(ipWebcamImage, 0, 0, ipWebcamTxCanvas.width, ipWebcamTxCanvas.height);
          const dataUrl = ipWebcamTxCanvas.toDataURL('image/jpeg', 0.65);

          const payload = {
            type: 'video_frame',
            data: dataUrl,
            source: 'mobile_ipwebcam',
            timestamp: now
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
        }
      }

      requestAnimationFrame(renderLoop);
    }

    renderLoop();
  }

  function stopIpWebcamStream() {
    isIpWebcamActive = false;
    ipWebcamLoopActive = false;
    if (ipWebcamImage) {
      ipWebcamImage.src = '';
      ipWebcamImage = null;
    }

    if (liveBadge) liveBadge.style.display = 'none';
    if (rgbLabelTag) rgbLabelTag.textContent = 'RGB (Visible Light)';
    if (thermalLabelTag) thermalLabelTag.textContent = 'THERMAL (IR)';

    if (rgbImage && rgbCanvas) {
      rgbImage.style.display = 'block';
      rgbCanvas.style.display = 'none';
    }
    if (thermalImage && thermalCanvas) {
      thermalImage.style.display = 'block';
      thermalCanvas.style.display = 'none';
    }
  }

  // 4. Mobile Drone Connection Modal & QR Code
  function setupMobileDroneModal() {
    const btnConnect = document.getElementById('btnConnectMobileDrone');
    const modalBackdrop = document.getElementById('mobileDroneModalBackdrop');
    const btnClose = document.getElementById('mobileModalCloseBtn');
    const btnCopy = document.getElementById('btnCopyMobileUrl');
    const urlInput = document.getElementById('mobileStreamUrlInput');
    const qrcodeContainer = document.getElementById('qrcodeCanvasContainer');
    const btnWebcamDirect = document.getElementById('btnUseWebcamDirect');

    if (btnConnect && modalBackdrop) {
      btnConnect.addEventListener('click', async () => {
        modalBackdrop.classList.add('show');
        await loadMobileNetworkInfo();
      });
    }

    if (btnClose && modalBackdrop) {
      btnClose.addEventListener('click', () => {
        modalBackdrop.classList.remove('show');
      });
    }

    if (btnCopy && urlInput) {
      btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(urlInput.value);
        if (window.showToast) {
          window.showToast(`Transmitter link copied: ${urlInput.value}`);
        }
      });
    }

    // Direct PC Webcam button
    if (btnWebcamDirect) {
      btnWebcamDirect.addEventListener('click', async () => {
        if (modalBackdrop) modalBackdrop.classList.remove('show');
        await startLocalWebcamDirect();
      });
    }
  }

  async function loadMobileNetworkInfo() {
    const urlInput = document.getElementById('mobileStreamUrlInput');
    const qrcodeContainer = document.getElementById('qrcodeCanvasContainer');
    if (!qrcodeContainer) return;

    try {
      const res = await fetch('/api/network-info');
      if (res.ok) {
        const info = await res.json();
        // Prefer HTTPS so mobile browsers grant camera permissions without block
        const mobileUrl = info.httpsUrl || info.defaultUrl || `https://${window.location.hostname}:3443/mobile`;

        if (urlInput) {
          urlInput.value = mobileUrl;
        }

        // Render QR Code with secure HTTPS URL
        qrcodeContainer.innerHTML = '';
        if (window.QRCode) {
          new QRCode(qrcodeContainer, {
            text: mobileUrl,
            width: 140,
            height: 140,
            colorDark: "#04101e",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
          });
        }
      }
    } catch (err) {
      const fallbackUrl = `${window.location.origin}/mobile`;
      if (urlInput) urlInput.value = fallbackUrl;
      qrcodeContainer.innerHTML = '';
      if (window.QRCode) {
        new QRCode(qrcodeContainer, { text: fallbackUrl, width: 140, height: 140 });
      }
    }
  }

  // 4. Local Webcam Direct (Streams PC webcam directly to Python YOLO AI Engine)
  async function startLocalWebcamDirect() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      await video.play();

      setDroneConnectedState(true);
      if (rgbLabelTag) rgbLabelTag.textContent = 'RGB (Local PC Webcam Live)';

      // Register with server as dashboard_webcam stream
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'register', role: 'dashboard_webcam' }));
      }

      let lastWebcamTxTime = 0;
      const txCanvas = document.createElement('canvas');
      const txCtx = txCanvas.getContext('2d');

      // Canvas render loop
      function captureLoop() {
        if (video.videoWidth) {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (rgbCanvas) {
            rgbImage.style.display = 'none';
            rgbCanvas.style.display = 'block';
            rgbCanvas.width = w;
            rgbCanvas.height = h;
            rgbCtx.drawImage(video, 0, 0, w, h);
          }

          // Generate real-time thermal
          if (thermalCanvas) {
            thermalImage.style.display = 'none';
            thermalCanvas.style.display = 'block';
            thermalCanvas.width = w;
            thermalCanvas.height = h;

            offscreenCanvas.width = 320;
            offscreenCanvas.height = 200;
            offscreenCtx.drawImage(video, 0, 0, 320, 200);
            const imgData = offscreenCtx.getImageData(0, 0, 320, 200);
            const pixels = imgData.data;
            for (let i = 0; i < pixels.length; i += 4) {
              const heat = Math.round(0.4 * pixels[i] + 0.4 * pixels[i + 1] + 0.2 * pixels[i + 2]);
              const color = ironbowPalette[heat] || ironbowPalette[0];
              pixels[i] = color.r;
              pixels[i + 1] = color.g;
              pixels[i + 2] = color.b;
            }
            offscreenCtx.putImageData(imgData, 0, 0);
            thermalCtx.drawImage(offscreenCanvas, 0, 0, w, h);
          }

          // Transmit frame to Python Edge AI Engine for YOLO detection (~10 FPS)
          const now = Date.now();
          if (now - lastWebcamTxTime >= 100) {
            lastWebcamTxTime = now;
            txCanvas.width = 640;
            txCanvas.height = Math.round(640 * (h / w)) || 360;
            txCtx.drawImage(video, 0, 0, txCanvas.width, txCanvas.height);
            const dataUrl = txCanvas.toDataURL('image/jpeg', 0.65);

            const payload = {
              type: 'video_frame',
              data: dataUrl,
              source: 'pc_webcam',
              timestamp: now
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
          }
        }
        requestAnimationFrame(captureLoop);
      }
      requestAnimationFrame(captureLoop);

      if (window.showToast) {
        window.showToast('Local PC camera active and transmitting to YOLO11n AI!');
      }
    } catch (err) {
      alert('Could not access local webcam: ' + err.message);
    }
  }

  // 5. Test Photo Upload Handling (Instant YOLO Human Detection)
  function setupTestImageUpload() {
    const btnUpload = document.getElementById('btnTestUploadImage');
    const fileInput = document.getElementById('testPhotoFileInput');
    if (!btnUpload || !fileInput) return;

    btnUpload.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          setDroneConnectedState(true);
          if (rgbLabelTag) rgbLabelTag.textContent = 'RGB (Test Photo AI Lock)';

          const w = img.width;
          const h = img.height;
          if (rgbCanvas) {
            rgbImage.style.display = 'none';
            rgbCanvas.style.display = 'block';
            rgbCanvas.width = w;
            rgbCanvas.height = h;
            rgbCtx.drawImage(img, 0, 0, w, h);
          }

          // Generate thermal view
          if (thermalCanvas) {
            thermalImage.style.display = 'none';
            thermalCanvas.style.display = 'block';
            thermalCanvas.width = w;
            thermalCanvas.height = h;

            offscreenCanvas.width = 320;
            offscreenCanvas.height = 200;
            offscreenCtx.drawImage(img, 0, 0, 320, 200);
            const imgData = offscreenCtx.getImageData(0, 0, 320, 200);
            const pixels = imgData.data;
            for (let i = 0; i < pixels.length; i += 4) {
              const heat = Math.round(0.4 * pixels[i] + 0.4 * pixels[i + 1] + 0.2 * pixels[i + 2]);
              const color = ironbowPalette[heat] || ironbowPalette[0];
              pixels[i] = color.r;
              pixels[i + 1] = color.g;
              pixels[i + 2] = color.b;
            }
            offscreenCtx.putImageData(imgData, 0, 0);
            thermalCtx.drawImage(offscreenCanvas, 0, 0, w, h);
          }

          // Send to Python YOLO Edge AI
          const txCanvas = document.createElement('canvas');
          txCanvas.width = 640;
          txCanvas.height = Math.round(640 * (h / w)) || 360;
          const txCtx = txCanvas.getContext('2d');
          txCtx.drawImage(img, 0, 0, txCanvas.width, txCanvas.height);
          const dataUrl = txCanvas.toDataURL('image/jpeg', 0.75);

          const payload = {
            type: 'video_frame',
            data: dataUrl,
            source: 'test_photo',
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

          if (window.showToast) {
            window.showToast('Test image sent to YOLO11n! Detecting human targets...');
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // 5. Standard Feed UI Controls
  function setupEventListeners() {
    if (splitBtn) splitBtn.addEventListener('click', () => setMode('split'));
    if (rgbBtn) rgbBtn.addEventListener('click', () => setMode('rgb'));
    if (thermalBtn) thermalBtn.addEventListener('click', () => setMode('thermal'));
    if (pipBtn) pipBtn.addEventListener('click', () => setMode('pip'));
    if (swapBtn) swapBtn.addEventListener('click', toggleSwap);
    if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
    if (bigScreenBtn) bigScreenBtn.addEventListener('click', () => toggleBigScreen());
    if (bannerBigScreenBtn) bannerBigScreenBtn.addEventListener('click', () => toggleBigScreen(true));

    if (thermalWindow) {
      thermalWindow.addEventListener('click', () => {
        if (currentMode === 'pip') toggleSwap();
      });
    }
  }

  function toggleBigScreen(forceState) {
    const card = document.querySelector('.drone-camera-card');
    const rowTop = document.querySelector('.row-top');
    const labelSpan = document.getElementById('bigScreenBtnText');
    if (!card) return;

    if (typeof forceState === 'boolean') {
      isBigScreen = forceState;
    } else {
      isBigScreen = !isBigScreen;
    }

    if (isBigScreen) {
      card.classList.add('big-screen-active');
      if (rowTop) rowTop.classList.add('camera-big-screen-layout');
      if (bigScreenBtn) bigScreenBtn.classList.add('active');
      if (labelSpan) labelSpan.textContent = 'Normal View';
      
      // If in split mode, default to RGB for maximum clarity on big screen unless already configured
      if (currentMode === 'split') {
        setMode('rgb');
      }

      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (window.showToast) window.showToast('Big Screen View Active: High-Resolution Mobile Feed');
    } else {
      card.classList.remove('big-screen-active');
      if (rowTop) rowTop.classList.remove('camera-big-screen-layout');
      if (bigScreenBtn) bigScreenBtn.classList.remove('active');
      if (labelSpan) labelSpan.textContent = 'Big Screen';
      if (window.showToast) window.showToast('Returned to Standard View');
    }

    // Trigger map and layout resize
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      if (window.MapGoogle3DManager && MapGoogle3DManager.resize) {
        MapGoogle3DManager.resize();
      }
    }, 200);
  }

  function setMode(mode) {
    currentMode = mode;
    clearModeButtons();

    if (!container) return;
    container.className = 'camera-viewport-container';

    if (mode === 'split') {
      container.classList.add('split-mode');
      if (splitBtn) splitBtn.classList.add('active');
      rgbWindow.classList.remove('hidden', 'pip-main', 'pip-sub');
      thermalWindow.classList.remove('hidden', 'pip-main', 'pip-sub');
    } else if (mode === 'rgb') {
      container.classList.add('single-mode');
      if (rgbBtn) rgbBtn.classList.add('active');
      rgbWindow.classList.remove('hidden', 'pip-main', 'pip-sub');
      thermalWindow.classList.add('hidden');
    } else if (mode === 'thermal') {
      container.classList.add('single-mode');
      if (thermalBtn) thermalBtn.classList.add('active');
      thermalWindow.classList.remove('hidden', 'pip-main', 'pip-sub');
      rgbWindow.classList.add('hidden');
    } else if (mode === 'pip') {
      container.classList.add('pip-mode');
      if (pipBtn) pipBtn.classList.add('active');
      if (!isSwapped) {
        rgbWindow.className = 'feed-window feed-rgb pip-main';
        thermalWindow.className = 'feed-window feed-thermal pip-sub';
      } else {
        thermalWindow.className = 'feed-window feed-thermal pip-main';
        rgbWindow.className = 'feed-window feed-rgb pip-sub';
      }
    }
  }

  function clearModeButtons() {
    [splitBtn, rgbBtn, thermalBtn, pipBtn].forEach(btn => {
      if (btn) btn.classList.remove('active');
    });
  }

  function toggleSwap() {
    isSwapped = !isSwapped;
    if (isSwapped) {
      container.appendChild(rgbWindow);
    } else {
      container.appendChild(thermalWindow);
    }
    if (currentMode === 'pip') setMode('pip');
  }

  function toggleFullscreen() {
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(err => console.warn(err));
    } else {
      document.exitFullscreen();
    }
  }

  function startLiveTimestamp() {
    const stamp = document.getElementById('rgbTimestamp');
    if (!stamp) return;

    setInterval(() => {
      const now = new Date();
      const h = String(now.getUTCHours()).padStart(2, '0');
      const m = String(now.getUTCMinutes()).padStart(2, '0');
      const s = String(now.getUTCSeconds()).padStart(2, '0');
      stamp.textContent = `REC [●] ${h}:${m}:${s} UTC`;
    }, 1000);
  }

  function getActiveVisualElement() {
    if (isIpWebcamActive && ipWebcamImage) return ipWebcamImage;
    if (isMobileDroneActive && rgbCanvas && rgbCanvas.style.display !== 'none') return rgbCanvas;
    if (localWebcamStream && rgbCanvas && rgbCanvas.style.display !== 'none') return rgbCanvas;
    return rgbImage;
  }

  return {
    init,
    setMode,
    getActiveVisualElement
  };
})();
