/**
 * =============================================================================
 * A.S.A.R.D - Autonomous Search And Rescue Drone
 * Communications Module (comms.js)
 *
 * Manages all two-way communication features:
 *   - Push-To-Talk (PTT) voice from ground station to drone speaker
 *   - Text chat between Command Center, Drone, and Field Teams
 *   - Emergency loudspeaker broadcast to trapped survivors (TTS)
 *   - Live audio waveform visualizer
 * =============================================================================
 */

const CommsManager = (() => {
  let ws = null;
  let currentChannel = 'CH-1';
  let messages = [];
  let isTransmittingPtt = false;
  let pttMediaRecorder = null;
  let pttAudioStream = null;
  let audioContext = null;
  let analyser = null;
  let visualizerAnimId = null;
  let isSpeakerMuted = false;

  // Sound effects generator via Web Audio API (tactical radio chirp)
  function playRadioChirp(type = 'tx_start') {
    try {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();

      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.connect(gain);
      gain.connect(audioContext.destination);

      if (type === 'tx_start') {
        // High dual beep (PTT ON)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(950, audioContext.currentTime);
        osc.frequency.setValueAtTime(1400, audioContext.currentTime + 0.04);
        gain.gain.setValueAtTime(0.12, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.09);
        osc.start();
        osc.stop(audioContext.currentTime + 0.1);
      } else if (type === 'tx_end') {
        // Rogers chirp / squelch burst (PTT OFF)
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, audioContext.currentTime);
        osc.frequency.setValueAtTime(600, audioContext.currentTime + 0.05);
        gain.gain.setValueAtTime(0.1, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.08);
        osc.start();
        osc.stop(audioContext.currentTime + 0.09);
      } else if (type === 'bcast_alert') {
        // Emergency siren tone
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(600, audioContext.currentTime);
        osc.frequency.linearRampToValueAtTime(1100, audioContext.currentTime + 0.15);
        osc.frequency.linearRampToValueAtTime(600, audioContext.currentTime + 0.3);
        gain.gain.setValueAtTime(0.18, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.32);
        osc.start();
        osc.stop(audioContext.currentTime + 0.33);
      } else if (type === 'msg_in') {
        // Incoming message pip
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, audioContext.currentTime);
        gain.gain.setValueAtTime(0.08, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.06);
        osc.start();
        osc.stop(audioContext.currentTime + 0.07);
      }
    } catch (e) {}
  }

  function init() {
    setupWebSocket();
    setupEventListeners();
    fetchMessages();
    initVisualizerCanvas();
  }

  function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[A.S.A.R.D Comms] WebSocket connected');
        ws.send(JSON.stringify({ type: 'register', role: 'dashboard' }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'comms_history') {
            if (Array.isArray(data.messages)) {
              messages = data.messages;
              renderMessages();
            }
          } else if (data.type === 'comms_message') {
            if (data.message) {
              messages.push(data.message);
              renderMessages();
              playRadioChirp('msg_in');
              showCommsToast(data.message);
            }
          } else if (data.type === 'comms_broadcast') {
            if (data.message) {
              messages.push(data.message);
              renderMessages();
            }
            playRadioChirp('bcast_alert');
            window.showToast(`📢 LOUDSPEAKER BROADCAST: "${data.text}"`);
          } else if (data.type === 'comms_audio') {
            playIncomingAudio(data.audioData, data.senderName);
          } else if (data.type === 'comms_ptt_state') {
            updateRemotePttIndicator(data);
          } else if (data.type === 'comms_cleared') {
            messages = [];
            renderMessages();
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        setTimeout(setupWebSocket, 3000);
      };
    } catch (e) {
      console.warn('[Comms] WebSocket init failed:', e);
    }
  }

  async function fetchMessages() {
    try {
      const res = await fetch('/api/comms/messages');
      if (res.ok) {
        const json = await res.json();
        if (json.messages) {
          messages = json.messages;
          renderMessages();
        }
      }
    } catch (e) {}
  }

  function showCommsToast(msg) {
    if (msg.senderRole === 'drone') {
      window.showToast(`📻 [${msg.channel}] ${msg.senderName}: "${msg.text}"`);
    }
  }

  function playIncomingAudio(base64Audio, senderName) {
    if (!base64Audio || isSpeakerMuted) return;
    try {
      playRadioChirp('msg_in');
      const audio = new Audio(base64Audio);
      audio.volume = 1.0;
      audio.play().catch(e => console.warn('Audio play blocked:', e));
      window.showToast(`🔊 Live Voice Transmission from ${senderName || 'Field Unit'}`);
    } catch (e) {}
  }

  function updateRemotePttIndicator(data) {
    const indicator = document.getElementById('commsRemoteTxIndicator');
    const label = document.getElementById('commsRemoteTxLabel');
    if (indicator && label) {
      if (data.isTransmitting && data.senderRole === 'drone') {
        indicator.style.display = 'inline-flex';
        label.textContent = `${data.senderName || 'DRONE'} IS TRANSMITTING...`;
      } else {
        indicator.style.display = 'none';
      }
    }
  }

  function setupEventListeners() {
    // 1. Channel Selector Buttons
    document.querySelectorAll('.comms-channel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.comms-channel-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentChannel = btn.getAttribute('data-channel') || 'CH-1';
        const chNameEl = document.getElementById('commsActiveChannelName');
        if (chNameEl) chNameEl.textContent = btn.getAttribute('data-channel-name') || currentChannel;
        renderMessages();
      });
    });

    // 2. Push-To-Talk Button (PTT)
    const btnPtt = document.getElementById('btnCommsPtt');
    if (btnPtt) {
      // Mouse & Touch events for Press-and-Hold
      btnPtt.addEventListener('mousedown', startPtt);
      window.addEventListener('mouseup', () => {
        if (isTransmittingPtt) stopPtt();
      });
      btnPtt.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startPtt();
      });
      window.addEventListener('touchend', () => {
        if (isTransmittingPtt) stopPtt();
      });
    }

    // Toggle PTT Lock button (Click to lock talk)
    const btnPttLock = document.getElementById('btnCommsPttLock');
    if (btnPttLock) {
      btnPttLock.addEventListener('click', () => {
        if (isTransmittingPtt) {
          stopPtt();
          btnPttLock.classList.remove('locked');
          btnPttLock.textContent = '🔒 Lock Mic';
        } else {
          startPtt();
          btnPttLock.classList.add('locked');
          btnPttLock.textContent = '🔓 Release Mic';
        }
      });
    }

    // Quick Comms Drawer PTT
    const btnQuickPtt = document.getElementById('btnQuickCommsPtt');
    if (btnQuickPtt) {
      btnQuickPtt.addEventListener('mousedown', startPtt);
      btnQuickPtt.addEventListener('touchstart', (e) => { e.preventDefault(); startPtt(); });
    }

    // 3. Loudspeaker TTS Announcement Button
    const btnTriggerBcast = document.getElementById('btnTriggerBroadcast');
    const inpBcastText = document.getElementById('inpBroadcastText');
    if (btnTriggerBcast && inpBcastText) {
      btnTriggerBcast.addEventListener('click', () => {
        const text = inpBcastText.value.trim();
        if (text) {
          broadcastLoudspeakerMessage(text);
          inpBcastText.value = '';
        }
      });
    }

    // Preset Announcement Chips
    document.querySelectorAll('.bcast-preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const text = chip.getAttribute('data-text');
        if (text) {
          if (inpBcastText) inpBcastText.value = text;
          broadcastLoudspeakerMessage(text);
        }
      });
    });

    // 4. Send Text Message
    const btnSendMsg = document.getElementById('btnSendCommsMsg');
    const inpMsgText = document.getElementById('inpCommsMsgText');
    if (btnSendMsg && inpMsgText) {
      btnSendMsg.addEventListener('click', () => {
        sendTextMessage(inpMsgText.value);
        inpMsgText.value = '';
      });
      inpMsgText.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendTextMessage(inpMsgText.value);
          inpMsgText.value = '';
        }
      });
    }

    // Quick Action Chips in Chat
    document.querySelectorAll('.comms-quick-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const text = chip.getAttribute('data-cmd') || chip.textContent;
        sendTextMessage(text);
      });
    });

    // 5. Floating Quick Comms Drawer Toggle
    const btnToggleQuick = document.getElementById('btnToggleQuickComms');
    const quickDrawer = document.getElementById('quickCommsDrawer');
    const btnCloseDrawer = document.getElementById('btnCloseQuickComms');
    if (btnToggleQuick && quickDrawer) {
      btnToggleQuick.addEventListener('click', () => {
        quickDrawer.classList.toggle('open');
      });
    }
    if (btnCloseDrawer && quickDrawer) {
      btnCloseDrawer.addEventListener('click', () => {
        quickDrawer.classList.remove('open');
      });
    }

    // Mute Loudspeaker Toggle
    const chkMuteSpeaker = document.getElementById('chkMuteSpeaker');
    if (chkMuteSpeaker) {
      chkMuteSpeaker.addEventListener('change', (e) => {
        isSpeakerMuted = e.target.checked;
        window.showToast(isSpeakerMuted ? 'Comms Speaker Output Muted' : 'Comms Speaker Output Active');
      });
    }
  }

  // =========================================================================
  // PUSH-TO-TALK AUDIO CAPTURE & STREAMING
  // =========================================================================
  async function startPtt() {
    if (isTransmittingPtt) return;
    isTransmittingPtt = true;
    playRadioChirp('tx_start');

    updatePttUI(true);
    notifyPttState(true);

    try {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') await audioContext.resume();

      if (!pttAudioStream) {
        pttAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const source = audioContext.createMediaStreamSource(pttAudioStream);
      if (!analyser) {
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
      }
      source.connect(analyser);
      startVisualizerLoop();

      // Setup MediaRecorder to capture audio chunk
      const recordedChunks = [];
      pttMediaRecorder = new MediaRecorder(pttAudioStream);
      pttMediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
      };
      pttMediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result;
          sendAudioMessage(base64Audio);
        };
        reader.readAsDataURL(blob);
      };
      pttMediaRecorder.start();
    } catch (err) {
      console.warn('[Comms] Microphone access issue (using simulated transmission):', err.message);
      startSimulatedWaveform();
    }
  }

  function stopPtt() {
    if (!isTransmittingPtt) return;
    isTransmittingPtt = false;
    playRadioChirp('tx_end');

    updatePttUI(false);
    notifyPttState(false);
    stopVisualizerLoop();

    if (pttMediaRecorder && pttMediaRecorder.state !== 'inactive') {
      try { pttMediaRecorder.stop(); } catch (e) {}
    }
  }

  function updatePttUI(active) {
    const btnPtt = document.getElementById('btnCommsPtt');
    const pttLabel = document.getElementById('commsPttLabel');
    const pttStatusBadge = document.getElementById('commsPttStatusBadge');
    const btnQuickPtt = document.getElementById('btnQuickCommsPtt');

    if (active) {
      if (btnPtt) btnPtt.classList.add('transmitting');
      if (btnQuickPtt) btnQuickPtt.classList.add('transmitting');
      if (pttLabel) pttLabel.textContent = 'TRANSMITTING TO DRONE LOUDSPEAKER...';
      if (pttStatusBadge) {
        pttStatusBadge.textContent = 'LIVE ON AIR';
        pttStatusBadge.className = 'comms-badge-live';
      }
    } else {
      if (btnPtt) btnPtt.classList.remove('transmitting');
      if (btnQuickPtt) btnQuickPtt.classList.remove('transmitting');
      if (pttLabel) pttLabel.textContent = 'PUSH TO TALK (HOLD TO SPEAK)';
      if (pttStatusBadge) {
        pttStatusBadge.textContent = 'STANDBY';
        pttStatusBadge.className = 'comms-badge-standby';
      }
    }
  }

  function notifyPttState(active) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'comms_ptt_state',
        isTransmitting: active,
        senderRole: 'gcs',
        senderName: 'NDRF Base Control'
      }));
    }
  }

  function sendAudioMessage(base64Audio) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'comms_audio',
        audioData: base64Audio,
        senderRole: 'gcs',
        senderName: 'NDRF Base Control'
      }));
    }

    // Also log as voice message in chat
    const msg = {
      sender: 'COMMAND_CENTER',
      senderName: 'NDRF Base Control',
      senderRole: 'gcs',
      text: '🎙️ Voice Message Broadcasted to Drone Loudspeaker',
      type: 'voice_clip',
      audioData: base64Audio,
      channel: currentChannel
    };

    fetch('/api/comms/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg)
    }).catch(e => {});
  }

  // =========================================================================
  // EMERGENCY LOUDSPEAKER TTS BROADCASTER
  // =========================================================================
  function broadcastLoudspeakerMessage(text) {
    if (!text) return;
    playRadioChirp('bcast_alert');

    // 1. Speak locally using Web Speech API (Text-to-Speech)
    if ('speechSynthesis' in window && !isSpeakerMuted) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        window.speechSynthesis.speak(utterance);
      } catch (e) {}
    }

    // 2. Dispatch to server & remote drone / mobile speaker via WebSocket
    fetch('/api/comms/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        priority: 'CRITICAL',
        channel: currentChannel,
        repeat: 1
      })
    }).catch(e => {});

    window.showToast(`📢 Transmitted emergency broadcast to Drone Loudspeaker!`);
  }

  // =========================================================================
  // TEXT & DISPATCH MESSAGING
  // =========================================================================
  function sendTextMessage(text) {
    text = (text || '').trim();
    if (!text) return;

    const payload = {
      sender: 'COMMAND_CENTER',
      senderName: 'NDRF Base Control',
      senderRole: 'gcs',
      text: text,
      type: 'dispatch',
      channel: currentChannel
    };

    fetch('/api/comms/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(e => {});
  }

  // =========================================================================
  // AUDIO WAVEFORM VISUALIZER
  // =========================================================================
  let waveCanvas = null;
  let waveCtx = null;
  let simWavePhase = 0;

  function initVisualizerCanvas() {
    waveCanvas = document.getElementById('commsWaveCanvas');
    if (waveCanvas) {
      waveCtx = waveCanvas.getContext('2d');
      drawIdleWave();
    }
  }

  function drawIdleWave() {
    if (!waveCtx || !waveCanvas || isTransmittingPtt) return;
    const w = waveCanvas.width = waveCanvas.offsetWidth || 300;
    const h = waveCanvas.height = waveCanvas.offsetHeight || 60;

    waveCtx.clearRect(0, 0, w, h);
    waveCtx.strokeStyle = 'rgba(0, 210, 255, 0.25)';
    waveCtx.lineWidth = 1.5;
    waveCtx.beginPath();
    waveCtx.moveTo(0, h / 2);
    waveCtx.lineTo(w, h / 2);
    waveCtx.stroke();
  }

  function startVisualizerLoop() {
    if (visualizerAnimId) cancelAnimationFrame(visualizerAnimId);

    function render() {
      if (!isTransmittingPtt) {
        drawIdleWave();
        return;
      }

      if (waveCtx && waveCanvas) {
        const w = waveCanvas.width = waveCanvas.offsetWidth || 300;
        const h = waveCanvas.height = waveCanvas.offsetHeight || 60;

        waveCtx.clearRect(0, 0, w, h);

        if (analyser) {
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyser.getByteTimeDomainData(dataArray);

          waveCtx.lineWidth = 2.5;
          waveCtx.strokeStyle = '#00e5ff';
          waveCtx.shadowBlur = 8;
          waveCtx.shadowColor = '#00d2ff';
          waveCtx.beginPath();

          const sliceWidth = w / bufferLength;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * h) / 2;

            if (i === 0) waveCtx.moveTo(x, y);
            else waveCtx.lineTo(x, y);
            x += sliceWidth;
          }

          waveCtx.stroke();
          waveCtx.shadowBlur = 0;
        } else {
          // Synthetic audio wave
          simWavePhase += 0.25;
          waveCtx.lineWidth = 2.5;
          waveCtx.strokeStyle = '#00ff66';
          waveCtx.beginPath();
          for (let x = 0; x < w; x += 3) {
            const y = (h / 2) + Math.sin(x * 0.08 + simWavePhase) * (14 + Math.sin(x * 0.03) * 6);
            if (x === 0) waveCtx.moveTo(x, y);
            else waveCtx.lineTo(x, y);
          }
          waveCtx.stroke();
        }
      }

      visualizerAnimId = requestAnimationFrame(render);
    }

    render();
  }

  function stopVisualizerLoop() {
    if (visualizerAnimId) {
      cancelAnimationFrame(visualizerAnimId);
      visualizerAnimId = null;
    }
    setTimeout(drawIdleWave, 100);
  }

  function startSimulatedWaveform() {
    startVisualizerLoop();
  }

  // =========================================================================
  // MESSAGE LOG RENDERING
  // =========================================================================
  function renderMessages() {
    const listEl = document.getElementById('commsMessagesList');
    const quickListEl = document.getElementById('quickCommsMessagesList');
    const countBadge = document.getElementById('sidebarCommsBadge');

    const filtered = messages.filter(m => !m.channel || m.channel === currentChannel || m.type === 'loudspeaker_broadcast');

    if (countBadge) {
      countBadge.textContent = `${filtered.length} MSGS`;
    }

    if (listEl) {
      listEl.innerHTML = '';
      if (filtered.length === 0) {
        listEl.innerHTML = `
          <div style="text-align: center; color: var(--text-muted); font-size: 11px; padding: 30px;">
            Secure radio channel quiet. Ready for tactical transmission.
          </div>
        `;
      } else {
        filtered.forEach(msg => {
          listEl.appendChild(createMessageElement(msg));
        });
        listEl.scrollTop = listEl.scrollHeight;
      }
    }

    if (quickListEl) {
      quickListEl.innerHTML = '';
      const recent = filtered.slice(-10);
      recent.forEach(msg => {
        const item = document.createElement('div');
        item.className = `quick-msg-item ${msg.senderRole || 'gcs'}`;
        item.innerHTML = `
          <div class="quick-msg-head">
            <strong>${msg.senderName || msg.sender}</strong>
            <span>${msg.timestamp || ''}</span>
          </div>
          <div class="quick-msg-text">${msg.text}</div>
        `;
        quickListEl.appendChild(item);
      });
      quickListEl.scrollTop = quickListEl.scrollHeight;
    }
  }

  function createMessageElement(msg) {
    const div = document.createElement('div');
    const isGcs = msg.senderRole === 'gcs';
    const isBroadcast = msg.type === 'loudspeaker_broadcast';
    const isAudio = msg.audioData || msg.type === 'voice_clip';

    div.className = `comms-message-bubble ${isGcs ? 'outgoing' : 'incoming'} ${isBroadcast ? 'bcast-bubble' : ''}`;

    let audioPlayerHtml = '';
    if (isAudio && msg.audioData) {
      audioPlayerHtml = `
        <div class="comms-audio-player">
          <button class="btn-play-voice" onclick="new Audio('${msg.audioData}').play()">
            ▶ Play Voice Clip
          </button>
        </div>
      `;
    }

    div.innerHTML = `
      <div class="bubble-header">
        <span class="bubble-sender">${msg.senderName || msg.sender}</span>
        <span class="bubble-time">${msg.timestamp || ''}</span>
      </div>
      <div class="bubble-body">
        ${isBroadcast ? '<span class="bcast-tag">📢 LOUDSPEAKER</span>' : ''}
        ${msg.text}
        ${audioPlayerHtml}
      </div>
    `;

    return div;
  }

  return {
    init,
    startPtt,
    stopPtt,
    broadcastLoudspeakerMessage,
    sendTextMessage,
    renderMessages
  };
})();

window.CommsManager = CommsManager;
