// TurboConvert Frontend Logic
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const sampleMovBtn = document.getElementById('sampleMovBtn');
  const hwAccelText = document.getElementById('hwAccelText');
  const togglePathBtn = document.getElementById('togglePathBtn');
  const localPathContainer = document.getElementById('localPathContainer');
  const localPathInput = document.getElementById('localPathInput');
  const probePathBtn = document.getElementById('probePathBtn');

  // Inspection Card Elements
  const inspectionCard = document.getElementById('inspectionCard');
  const changeFileBtn = document.getElementById('changeFileBtn');
  const inspectedFileName = document.getElementById('inspectedFileName');
  const fileTypeIcon = document.getElementById('fileTypeIcon');
  const metaSize = document.getElementById('metaSize');
  const metaDuration = document.getElementById('metaDuration');
  const metaResolution = document.getElementById('metaResolution');
  const metaFps = document.getElementById('metaFps');
  const codecVideo = document.getElementById('codecVideo');
  const codecAudio = document.getElementById('codecAudio');
  const estimatedSpeed = document.getElementById('estimatedSpeed');
  const recommendationAlert = document.getElementById('recommendationAlert');
  const recTitle = document.getElementById('recTitle');
  const recDesc = document.getElementById('recDesc');

  // Tabs & Modes
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = {
    turboMov: document.getElementById('tab-turboMov'),
    universalVideo: document.getElementById('tab-universalVideo'),
    audioOnly: document.getElementById('tab-audioOnly'),
    trimCut: document.getElementById('tab-trimCut')
  };
  const radioCards = document.querySelectorAll('.radio-card');
  const crfRange = document.getElementById('crfRange');
  const crfValue = document.getElementById('crfValue');
  const actionSummary = document.getElementById('actionSummary');
  const startConvertBtn = document.getElementById('startConvertBtn');
  const convertBtnText = document.getElementById('convertBtnText');

  // Progress Dashboard
  const progressDashboard = document.getElementById('progressDashboard');
  const progressStatusTitle = document.getElementById('progressStatusTitle');
  const progressStatusSubtitle = document.getElementById('progressStatusSubtitle');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressPercent = document.getElementById('progressPercent');
  const metricSpeed = document.getElementById('metricSpeed');
  const metricElapsed = document.getElementById('metricElapsed');
  const metricEta = document.getElementById('metricEta');
  const metricFps = document.getElementById('metricFps');

  // Success Card
  const successCard = document.getElementById('successCard');
  const doneTimeTaken = document.getElementById('doneTimeTaken');
  const doneOriginalSize = document.getElementById('doneOriginalSize');
  const doneOutputSize = document.getElementById('doneOutputSize');
  const doneModeBadge = document.getElementById('doneModeBadge');
  const previewVideo = document.getElementById('previewVideo');
  const previewAudio = document.getElementById('previewAudio');
  const downloadLink = document.getElementById('downloadLink');
  const openFolderBtn = document.getElementById('openFolderBtn');
  const convertAnotherBtn = document.getElementById('convertAnotherBtn');

  // History Elements
  const historyTableBody = document.getElementById('historyTableBody');
  const historyCount = document.getElementById('historyCount');

  // State
  let currentJobId = null;
  let currentMetadata = null;
  let currentActiveTab = 'turboMov';
  let eventSource = null;

  // Initialize
  fetchSystemInfo();
  fetchHistory();

  // 1. System Info Check
  async function fetchSystemInfo() {
    try {
      const res = await fetch('/api/system-info');
      const data = await res.json();
      const hw = data.hardwareAcceleration;
      if (hw.nvenc) {
        hwAccelText.textContent = '🚀 NVIDIA NVENC Active';
        hwAccelText.parentElement.style.borderColor = 'rgba(0, 245, 160, 0.4)';
      } else if (hw.qsv) {
        hwAccelText.textContent = '⚡ Intel QuickSync Active';
      } else if (hw.amf) {
        hwAccelText.textContent = '⚡ AMD AMF Active';
      } else if (hw.mediaFoundation) {
        hwAccelText.textContent = '⚡ Windows MediaFoundation';
      } else {
        hwAccelText.textContent = '⚡ Ultra-Fast CPU Engine';
      }
    } catch (e) {
      hwAccelText.textContent = '⚡ FFmpeg Engine Ready';
    }
  }

  // 2. Drag & Drop Handlers
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, e => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', e => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  });

  browseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFileUpload(fileInput.files[0]);
    }
  });

  // Sample MOV generator for instant testing
  sampleMovBtn.addEventListener('click', async () => {
    sampleMovBtn.disabled = true;
    sampleMovBtn.textContent = '⏳ Generating Sample...';
    try {
      const res = await fetch('/api/generate-sample', { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      displayInspection(data);
    } catch (err) {
      alert('Could not generate sample MOV: ' + err.message);
    } finally {
      sampleMovBtn.disabled = false;
      sampleMovBtn.textContent = '⚡ Test with Sample MOV';
    }
  });

  // Local file path toggle & probe
  togglePathBtn.addEventListener('click', () => {
    localPathContainer.classList.toggle('hidden');
  });

  probePathBtn.addEventListener('click', async () => {
    const pathVal = localPathInput.value.trim();
    if (!pathVal) return alert('Please enter a local file path');

    probePathBtn.disabled = true;
    probePathBtn.textContent = 'Analyzing...';
    try {
      const res = await fetch('/api/probe-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: pathVal })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      displayInspection(data);
    } catch (err) {
      alert(err.message);
    } finally {
      probePathBtn.disabled = false;
      probePathBtn.textContent = 'Inspect File';
    }
  });

  // Upload file via FormData
  async function handleFileUpload(file) {
    const formData = new FormData();
    formData.append('mediaFile', file);

    dropZone.classList.add('hidden');
    progressDashboard.classList.remove('hidden');
    progressStatusTitle.textContent = 'Uploading & Probing Media...';
    progressStatusSubtitle.textContent = `Analyzing streams for "${file.name}"`;
    progressBarFill.style.width = '35%';
    progressPercent.textContent = 'Inspecting...';

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      progressDashboard.classList.add('hidden');
      displayInspection(data);
    } catch (err) {
      alert('Upload failed: ' + err.message);
      progressDashboard.classList.add('hidden');
      dropZone.classList.remove('hidden');
    }
  }

  // Display inspected metadata and populate UI
  function displayInspection(data) {
    currentJobId = data.jobId;
    currentMetadata = data.metadata;

    dropZone.classList.add('hidden');
    localPathContainer.classList.add('hidden');
    successCard.classList.add('hidden');
    inspectionCard.classList.remove('hidden');

    // Populate file info
    inspectedFileName.textContent = data.originalName;
    const ext = data.originalName.split('.').pop().toUpperCase();
    fileTypeIcon.textContent = ext;

    metaSize.textContent = formatBytes(currentMetadata.fileSize);
    metaDuration.textContent = formatDuration(currentMetadata.duration);

    if (currentMetadata.video) {
      metaResolution.textContent = `${currentMetadata.video.width}x${currentMetadata.video.height}`;
      metaFps.textContent = `${currentMetadata.video.fps} fps`;
      codecVideo.textContent = `${currentMetadata.video.codec.toUpperCase()} (${currentMetadata.video.pixelFormat || 'yuv420p'})`;
    } else {
      metaResolution.textContent = 'Audio Only';
      metaFps.textContent = '--';
      codecVideo.textContent = 'None (Audio Track)';
    }

    if (currentMetadata.audio) {
      codecAudio.textContent = `${currentMetadata.audio.codec.toUpperCase()} (${currentMetadata.audio.sampleRate}Hz, ${currentMetadata.audio.channels}ch)`;
    } else {
      codecAudio.textContent = 'None (Muted)';
    }

    // Recommendation setup
    if (data.fastCopyPossible && data.recommendedMode === 'instant-remux') {
      estimatedSpeed.textContent = '⚡ 1,000x - 5,000x (Instant < 1s)';
      recommendationAlert.className = 'recommendation-banner banner-instant';
      recTitle.textContent = '⚡ Instant Lossless Remux Recommended!';
      recDesc.textContent = data.explanation || 'Compatible H.264/HEVC stream detected. Repackages into MP4 in < 1 second with 0% quality loss.';
      selectRadio('instant-remux');
      switchTab('turboMov');
    } else if (data.fastCopyPossible && data.recommendedMode === 'smart-passthrough') {
      estimatedSpeed.textContent = '🚀 500x - 1,500x (Smart ~1s)';
      recommendationAlert.className = 'recommendation-banner';
      recTitle.textContent = '🚀 Smart Passthrough Recommended!';
      recDesc.textContent = data.explanation || 'Copies heavy video stream untouched; audio transcoded to universal AAC.';
      selectRadio('smart-passthrough');
      switchTab('turboMov');
    } else {
      estimatedSpeed.textContent = '🔥 40x - 120x (Hardware Accelerated)';
      recommendationAlert.className = 'recommendation-banner';
      recTitle.textContent = '🔥 Fast Hardware Re-encode Ready';
      recDesc.textContent = data.explanation || 'Re-encoding optimized with ultrafast hardware acceleration.';
      selectRadio('reencode-fast');
      if (!currentMetadata.video && currentMetadata.audio) {
        switchTab('audioOnly');
      } else {
        switchTab('turboMov');
      }
    }

    updateActionSummary();
  }

  // Change file button
  changeFileBtn.addEventListener('click', () => {
    inspectionCard.classList.add('hidden');
    dropZone.classList.remove('hidden');
    fileInput.value = '';
    currentJobId = null;
  });

  // Tab switching
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  function switchTab(tabKey) {
    currentActiveTab = tabKey;
    tabButtons.forEach(b => {
      if (b.getAttribute('data-tab') === tabKey) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });

    Object.keys(tabPanes).forEach(key => {
      if (key === tabKey) {
        tabPanes[key].classList.remove('hidden');
      } else {
        tabPanes[key].classList.add('hidden');
      }
    });

    updateActionSummary();
  }

  // Radio cards for Turbo MOV
  radioCards.forEach(card => {
    card.addEventListener('click', () => {
      const radio = card.querySelector('input[type="radio"]');
      if (radio) {
        radio.checked = true;
        selectRadio(radio.value);
      }
    });
  });

  function selectRadio(val) {
    radioCards.forEach(c => {
      const r = c.querySelector('input[type="radio"]');
      if (r && r.value === val) {
        r.checked = true;
        c.classList.add('selected');
      } else if (r) {
        r.checked = false;
        c.classList.remove('selected');
      }
    });
    updateActionSummary();
  }

  // CRF range
  crfRange.addEventListener('input', () => {
    crfValue.textContent = crfRange.value;
  });

  // Update summary & button text
  function updateActionSummary() {
    if (currentActiveTab === 'turboMov') {
      const selectedRadio = document.querySelector('input[name="turboMode"]:checked');
      const mode = selectedRadio ? selectedRadio.value : 'instant-remux';
      if (mode === 'instant-remux') {
        actionSummary.innerHTML = 'Converting with <strong>⚡ Instant Stream Copy (Lossless &lt; 1s)</strong>';
        convertBtnText.textContent = 'Convert to MP4 (Instant)';
      } else if (mode === 'smart-passthrough') {
        actionSummary.innerHTML = 'Converting with <strong>🚀 Smart Passthrough (Video Copy + AAC Audio)</strong>';
        convertBtnText.textContent = 'Convert to MP4 (Smart)';
      } else {
        actionSummary.innerHTML = 'Converting with <strong>🔥 Fast Hardware Re-encode</strong>';
        convertBtnText.textContent = 'Convert to MP4 (Fast Re-encode)';
      }
    } else if (currentActiveTab === 'universalVideo') {
      const fmt = document.getElementById('videoFormatSelect').value.toUpperCase();
      const res = document.getElementById('resolutionSelect').value;
      actionSummary.innerHTML = `Converting to <strong>${fmt}</strong> &bull; Resolution: <strong>${res}</strong>`;
      convertBtnText.textContent = `Convert to ${fmt}`;
    } else if (currentActiveTab === 'audioOnly') {
      const fmt = document.getElementById('audioFormatSelect').value.toUpperCase();
      const br = document.getElementById('audioBitrateSelect').value;
      actionSummary.innerHTML = `Extracting Audio to <strong>${fmt}</strong> &bull; Bitrate: <strong>${br}</strong>`;
      convertBtnText.textContent = `Extract as ${fmt}`;
    } else if (currentActiveTab === 'trimCut') {
      actionSummary.innerHTML = 'Converting with <strong>✂️ Trimmed Range</strong>';
      convertBtnText.textContent = 'Trim & Convert';
    }
  }

  // Conversion Trigger
  startConvertBtn.addEventListener('click', startConversion);

  async function startConversion() {
    if (!currentJobId) return alert('Please select a file first.');

    // Build payload
    const payload = {
      jobId: currentJobId
    };

    if (currentActiveTab === 'turboMov') {
      const selectedRadio = document.querySelector('input[name="turboMode"]:checked');
      payload.mode = selectedRadio ? selectedRadio.value : 'instant-remux';
      payload.targetFormat = 'mp4';
    } else if (currentActiveTab === 'universalVideo') {
      payload.mode = 'custom-video';
      payload.targetFormat = document.getElementById('videoFormatSelect').value;
      payload.resolution = document.getElementById('resolutionSelect').value;
      payload.preset = document.getElementById('speedPresetSelect').value;
      payload.crf = parseInt(crfRange.value, 10);
    } else if (currentActiveTab === 'audioOnly') {
      payload.mode = 'audio-extract';
      payload.targetFormat = document.getElementById('audioFormatSelect').value;
      payload.audioBitrate = document.getElementById('audioBitrateSelect').value;
    } else if (currentActiveTab === 'trimCut') {
      payload.mode = 'custom-video';
      payload.targetFormat = 'mp4';
      payload.startTime = document.getElementById('trimStart').value.trim();
      payload.endTime = document.getElementById('trimEnd').value.trim();
    }

    // Switch to progress view
    inspectionCard.classList.add('hidden');
    progressDashboard.classList.remove('hidden');
    progressBarFill.style.width = '0%';
    progressPercent.textContent = '0%';
    metricSpeed.textContent = '⚡ Starting...';
    metricElapsed.textContent = '0.0s';
    metricEta.textContent = '--';
    metricFps.textContent = '--';

    progressStatusTitle.textContent = 'Processing Media...';
    progressStatusSubtitle.textContent = payload.mode === 'instant-remux' 
      ? '⚡ Instant Bitstream Remuxing in progress...' 
      : 'Executing optimized pipeline...';

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Listen to SSE progress
      listenToProgress(currentJobId);
    } catch (err) {
      alert('Conversion initiation error: ' + err.message);
      progressDashboard.classList.add('hidden');
      inspectionCard.classList.remove('hidden');
    }
  }

  function listenToProgress(jobId) {
    if (eventSource) eventSource.close();

    eventSource = new EventSource(`/api/progress/${jobId}`);

    eventSource.addEventListener('progress', e => {
      const data = JSON.parse(e.data);
      progressBarFill.style.width = `${data.percent}%`;
      progressPercent.textContent = `${data.percent}%`;
      metricSpeed.textContent = data.speed || '⚡ Fast';
      metricElapsed.textContent = `${data.elapsedSec}s`;
      metricEta.textContent = data.etaSec > 0 ? `${data.etaSec}s` : 'Finishing...';
      metricFps.textContent = data.fps > 0 ? `${data.fps}` : '--';
    });

    eventSource.addEventListener('done', e => {
      const data = JSON.parse(e.data);
      eventSource.close();
      progressBarFill.style.width = '100%';
      progressPercent.textContent = '100%';
      setTimeout(() => {
        showSuccess(data);
      }, 250);
    });

    eventSource.addEventListener('error', e => {
      if (e.data) {
        const data = JSON.parse(e.data);
        alert(`Conversion failed: ${data.error}`);
      }
      eventSource.close();
      progressDashboard.classList.add('hidden');
      inspectionCard.classList.remove('hidden');
    });
  }

  function showSuccess(result) {
    progressDashboard.classList.add('hidden');
    successCard.classList.remove('hidden');

    doneTimeTaken.textContent = `${result.elapsedSec} seconds`;
    doneOriginalSize.textContent = formatBytes(currentMetadata.fileSize);
    doneOutputSize.textContent = formatBytes(result.outputSize);

    if (result.mode === 'instant-remux') {
      doneModeBadge.textContent = '⚡ Instant Lossless Remux';
      doneModeBadge.className = 'size-badge badge-accent';
    } else if (result.mode === 'smart-passthrough') {
      doneModeBadge.textContent = '🚀 Smart Passthrough';
      doneModeBadge.className = 'size-badge badge-cyan';
    } else if (result.mode === 'audio-extract') {
      doneModeBadge.textContent = '🎵 Audio Extracted';
      doneModeBadge.className = 'size-badge badge-purple';
    } else {
      doneModeBadge.textContent = '🔥 Fast Encode';
      doneModeBadge.className = 'size-badge';
    }

    // Configure download & preview
    downloadLink.href = `/api/download/${currentJobId}`;
    downloadLink.setAttribute('download', result.outputFileName);

    const isAudio = result.outputFileName.match(/\.(mp3|wav|flac|aac|m4a|ogg)$/i);
    if (isAudio) {
      previewVideo.classList.add('hidden');
      previewAudio.classList.remove('hidden');
      previewAudio.src = `/api/preview/${currentJobId}?type=output`;
      previewAudio.load();
    } else {
      previewAudio.classList.add('hidden');
      previewVideo.classList.remove('hidden');
      previewVideo.src = `/api/preview/${currentJobId}?type=output`;
      previewVideo.load();
    }

    // Open in Windows folder button
    openFolderBtn.onclick = async () => {
      try {
        await fetch('/api/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: currentJobId })
        });
      } catch (e) {
        alert('Could not reveal in Windows Explorer');
      }
    };

    fetchHistory();
  }

  // Convert another
  convertAnotherBtn.addEventListener('click', () => {
    successCard.classList.add('hidden');
    dropZone.classList.remove('hidden');
    fileInput.value = '';
    currentJobId = null;
    previewVideo.pause();
    previewVideo.src = '';
    previewAudio.pause();
    previewAudio.src = '';
  });

  // History fetch
  async function fetchHistory() {
    try {
      const res = await fetch('/api/history');
      const history = await res.json();
      historyCount.textContent = `${history.length} items`;

      if (history.length === 0) {
        historyTableBody.innerHTML = `
          <tr class="empty-row">
            <td colspan="6">No files converted yet in this session. Drop a file above to begin!</td>
          </tr>`;
        return;
      }

      historyTableBody.innerHTML = history.map(item => `
        <tr>
          <td><strong>${item.outputFileName}</strong></td>
          <td><span class="meta-tag">${item.targetFormat.toUpperCase()}</span></td>
          <td><span class="badge-accent">${item.mode === 'instant-remux' ? '⚡ Instant' : item.mode}</span></td>
          <td>${item.elapsedSec}s</td>
          <td>${formatBytes(item.outputSize)}</td>
          <td>
            <a href="/api/download/${item.jobId}" class="table-btn">⬇️ Download</a>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      console.error('History fetch error:', e);
    }
  }

  // Helpers
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
  }
});
