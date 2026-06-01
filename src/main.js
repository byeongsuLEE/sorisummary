import { initDB, saveMeeting, getAllMeetings, getMeeting, deleteMeeting } from './db.js';
import { AudioRecorder } from './audioRecorder.js';
import { GeminiService } from './geminiService.js';

// APP STATE
let currentView = 'dashboard';
let recorder = null;
let currentMeeting = null;
let activeVisualizerFrame = null;

// DOM ELEMENTS
const views = {
  dashboard: document.getElementById('view-dashboard'),
  recording: document.getElementById('view-recording'),
  detail: document.getElementById('view-detail')
};

const emptyState = document.getElementById('empty-state');
const historyContainer = document.getElementById('history-container');
const meetingList = document.getElementById('meeting-list');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const modalSettings = document.getElementById('modal-settings');
const inputApiKey = document.getElementById('input-api-key');

const btnRecordStart = document.getElementById('btn-record-start');
const btnRecordPause = document.getElementById('btn-record-pause');
const btnRecordStop = document.getElementById('btn-record-stop');
const recordingTitleInput = document.getElementById('recording-title');
const recordingTimer = document.getElementById('recording-timer');
const chunkStatus = document.getElementById('chunk-status');
const canvas = document.getElementById('visualizer');

const btnDetailBack = document.getElementById('btn-detail-back');
const detailTitle = document.getElementById('detail-title');
const detailDate = document.getElementById('detail-date');
const detailDuration = document.getElementById('detail-duration');
const detailStatus = document.getElementById('detail-status');
const audioPlaybackCard = document.getElementById('audio-playback-card');
const audioPlayer = document.getElementById('audio-player');

const analysisLoadingPanel = document.getElementById('analysis-loading-panel');
const analysisStage = document.getElementById('analysis-stage');
const analysisDetail = document.getElementById('analysis-detail');
const detailContentArea = document.getElementById('detail-content-area');

const tabTranscript = document.getElementById('tab-transcript');
const tabSummary = document.getElementById('tab-summary');
const contentTranscript = document.getElementById('content-transcript');
const contentSummary = document.getElementById('content-summary');
const transcriptList = document.getElementById('transcript-list');
const summaryContent = document.getElementById('summary-content');

const btnTriggerSummarize = document.getElementById('btn-trigger-summarize');
const btnExportTranscript = document.getElementById('btn-export-transcript');
const btnCopySummary = document.getElementById('btn-copy-summary');

// --- 1. PWA SERVICE WORKER REGISTRATION ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js')
      .then(reg => console.log('ServiceWorker registered successfully', reg.scope))
      .catch(err => console.warn('ServiceWorker registration failed', err));
  });
}

// --- 2. INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved API key from localStorage or Vite environment variables
  const envKey = import.meta.env.VITE_GEMINI_API_KEY || '';
  const savedKey = localStorage.getItem('SORI_API_KEY') || envKey;
  inputApiKey.value = savedKey;

  if (envKey && !localStorage.getItem('SORI_API_KEY')) {
    localStorage.setItem('SORI_API_KEY', envKey);
  }

  // Initialize DB and load list
  try {
    await initDB();
    await loadMeetingsList();
  } catch (err) {
    alert('데이터베이스 초기화 실패: ' + err.message);
  }

  setupEventListeners();
});

// --- 3. VIEW NAVIGATION ---
function switchView(viewName) {
  Object.keys(views).forEach(key => {
    if (key === viewName) {
      views[key].classList.add('active');
    } else {
      views[key].classList.remove('active');
    }
  });
  currentView = viewName;

  // Cancel any canvas animation frame if leaving recording view
  if (viewName !== 'recording' && activeVisualizerFrame) {
    cancelAnimationFrame(activeVisualizerFrame);
    activeVisualizerFrame = null;
  }
}

// --- 4. DATA MANAGEMENT (INDEXEDDB & LIST RENDERING) ---
async function loadMeetingsList() {
  try {
    const list = await getAllMeetings();
    if (list.length === 0) {
      emptyState.style.display = 'block';
      historyContainer.style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      historyContainer.style.display = 'block';
      renderMeetings(list);
    }
  } catch (err) {
    console.error('Meetings load failed:', err);
  }
}

function renderMeetings(meetings) {
  meetingList.innerHTML = '';
  meetings.forEach(meeting => {
    const isAnalyzed = meeting.status === 'analyzed';
    const item = document.createElement('div');
    item.className = 'meeting-item glass-card';
    
    // Format duration
    const formattedDuration = formatTime(meeting.duration);
    // Format Date
    const formattedDate = new Date(meeting.date).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    item.innerHTML = `
      <div class="meeting-item-info">
        <div class="meeting-item-title">${escapeHTML(meeting.title)}</div>
        <div class="meeting-item-meta">
          <span>📅 ${formattedDate}</span>
          <span>⏱️ ${formattedDuration}</span>
          <span class="status-badge ${isAnalyzed ? 'analyzed' : 'pending'}">${isAnalyzed ? '분석 완료' : '분석 대기'}</span>
        </div>
      </div>
      <button class="btn-delete" title="삭제" data-id="${meeting.id}">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
      </button>
    `;

    // Click item -> open detail
    item.addEventListener('click', (e) => {
      // If delete button clicked, do not open detail
      if (e.target.closest('.btn-delete')) return;
      openMeetingDetail(meeting.id);
    });

    // Delete button logic
    const deleteBtn = item.querySelector('.btn-delete');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`'${meeting.title}' 회의 기록을 영구적으로 삭제하시겠습니까?`)) {
        try {
          await deleteMeeting(meeting.id);
          await loadMeetingsList();
        } catch (err) {
          alert('삭제 실패: ' + err.message);
        }
      }
    });

    meetingList.appendChild(item);
  });
}

// --- 5. AUDIO RECORDING & VISUALIZATION ---
function startVisualizer() {
  const ctx = canvas.getContext('2d');
  
  // Set dimensions correctly based on bounding rectangle for high DPI
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  function draw() {
    if (currentView !== 'recording') return;
    
    activeVisualizerFrame = requestAnimationFrame(draw);
    
    const dataArray = recorder ? recorder.getAnalyserData() : null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!dataArray) {
      // Draw standard flat glowing center line if inactive
      ctx.beginPath();
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }

    const bufferLength = dataArray.length;
    const barWidth = (canvas.width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;

    // Draw mirroring aesthetic neon waves
    for (let i = 0; i < bufferLength; i++) {
      barHeight = (dataArray[i] / 255) * (canvas.height / 1.5);
      
      // Gradient color for bars
      const grad = ctx.createLinearGradient(0, canvas.height / 2 - barHeight / 2, 0, canvas.height / 2 + barHeight / 2);
      grad.addColorStop(0, '#06b6d4'); // Cyan
      grad.addColorStop(0.5, '#10b981'); // Emerald
      grad.addColorStop(1, '#06b6d4');

      ctx.fillStyle = grad;
      // Draw centered bars
      ctx.fillRect(x, canvas.height / 2 - barHeight / 2, barWidth - 2, barHeight);
      
      x += barWidth;
    }
  }
  
  draw();
}

async function startRecordingSession() {
  // Setup Title
  const defaultDate = new Date();
  const dateStr = defaultDate.toLocaleDateString('ko-KR', {
    month: '2-digit',
    day: '2-digit'
  }).replace('. ', '.').replace('.', '');
  recordingTitleInput.value = `회의기록-${dateStr}`;

  recorder = new AudioRecorder();
  
  // Custom rotation size: for testing/dev you could lower it, but default is 50 minutes.
  recorder.onChunkFinished = (blob, index) => {
    console.log(`Chunk ${index + 1} finished, size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
  };

  recorder.onProgress = (seconds) => {
    recordingTimer.textContent = formatTime(seconds);
    const chunkIndex = Math.floor(seconds / (50 * 60)) + 1;
    chunkStatus.innerHTML = `<span class="recording-dot"></span> 파트 ${chunkIndex} 녹음 중 (${formatTime(seconds % (50 * 60))})`;
  };

  try {
    await recorder.start();
    switchView('recording');
    startVisualizer();
    
    // Reset pause state buttons
    btnRecordPause.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"></rect></svg>`;
  } catch (err) {
    alert('마이크 접근 권한이 없거나 오디오 리소스를 사용할 수 없습니다: ' + err.message);
  }
}

async function stopRecordingSession() {
  if (!recorder) return;

  if (confirm('녹음을 완료하고 AI 분석을 시작하시겠습니까?')) {
    const title = recordingTitleInput.value.trim() || '무제 회의 기록';
    
    // Stop recording and get chunks
    const result = await recorder.stop();
    if (!result || result.chunks.length === 0) {
      alert('녹음된 데이터가 존재하지 않습니다.');
      switchView('dashboard');
      return;
    }

    // Save pending meeting inside IndexedDB
    const newMeeting = {
      id: Date.now().toString(),
      title: title,
      date: new Date().toISOString(),
      duration: result.duration,
      status: 'pending',
      audioChunks: result.chunks, // Array of Audio Blobs
      mimeType: result.mimeType,
      transcript: [], // Empty to start
      summary: ''
    };

    try {
      await saveMeeting(newMeeting);
      currentMeeting = newMeeting;
      
      // Go to detail view and trigger analysis automatically
      switchView('detail');
      await triggerAIAnalysis(newMeeting);
    } catch (err) {
      alert('기록 저장 실패: ' + err.message);
      switchView('dashboard');
    }
  }
}

// --- 6. AI ANALYSIS PIPELINE ---
async function triggerAIAnalysis(meeting) {
  const apiKey = localStorage.getItem('SORI_API_KEY') || '';

  // UI Setup
  analysisLoadingPanel.style.display = 'flex';
  detailContentArea.style.display = 'none';
  audioPlaybackCard.style.display = 'none';
  btnDetailBack.style.disabled = true;

  const gemini = new GeminiService(apiKey);

  try {
    // 1. Process Chunks sequentially
    const combinedTranscriptText = await gemini.processAudioChunks(
      meeting.audioChunks,
      meeting.mimeType,
      (statusMsg) => {
        analysisStage.textContent = 'STT 변환 진행 중';
        analysisDetail.textContent = statusMsg;
      }
    );

    // Parse transcript into structured turns
    meeting.transcript = parseRawTranscript(combinedTranscriptText);

    // 2. Generate Summary
    analysisStage.textContent = '요약본 생성 중';
    analysisDetail.textContent = '대화 내용을 정독하고 핵심 안건 및 결론을 축약하고 있습니다...';
    
    const summaryMarkdown = await gemini.summarizeTranscript(combinedTranscriptText, (statusMsg) => {
      analysisDetail.textContent = statusMsg;
    });

    meeting.summary = summaryMarkdown;
    meeting.status = 'analyzed';

    // 3. Save to database
    await saveMeeting(meeting);
    currentMeeting = meeting;
    
    // Reload dashboard list background
    await loadMeetingsList();
    
    // Display result details!
    renderMeetingDetailContent(meeting);

  } catch (error) {
    console.error('AI Analysis failed:', error);
    alert('AI 분석 중 오류가 발생했습니다: ' + error.message + '\n\n녹음 파일은 안전하게 저장되었으니, 대화록 탭 하단 버튼을 통해 다시 분석할 수 있습니다.');
    renderMeetingDetailOffline(meeting);
  } finally {
    analysisLoadingPanel.style.display = 'none';
    detailContentArea.style.display = 'block';
    btnDetailBack.style.disabled = false;
  }
}

// Helper to parse text lines like "[00:12] 화자 1: 안녕" into structured array
function parseRawTranscript(rawText) {
  const turns = [];
  const lines = rawText.split('\n');
  
  // Match standard [hh:mm:ss] or [mm:ss] Speaker: text pattern
  const pattern = /^\[([\d:]+)\]\s*([^:]+):\s*(.*)$/;

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const match = trimmed.match(pattern);
    if (match) {
      turns.push({
        time: match[1],
        speaker: match[2].trim(),
        text: match[3].trim()
      });
    } else {
      // Fallback for lines without timestamps or non-matching
      if (turns.length > 0) {
        // Append to previous turn text if it's continuous
        turns[turns.length - 1].text += '\n' + trimmed;
      } else {
        turns.push({
          time: '00:00',
          speaker: '알 수 없음',
          text: trimmed
        });
      }
    }
  });

  return turns;
}

// --- 7. INTERACTIVE DETAIL VIEW RENDERING ---
async function openMeetingDetail(id) {
  try {
    const meeting = await getMeeting(id);
    if (!meeting) return;

    currentMeeting = meeting;
    switchView('detail');

    if (meeting.status === 'analyzed') {
      analysisLoadingPanel.style.display = 'none';
      detailContentArea.style.display = 'block';
      renderMeetingDetailContent(meeting);
    } else {
      // Ask user to trigger transcription or just show offline placeholder
      renderMeetingDetailOffline(meeting);
    }
  } catch (err) {
    alert('불러오기 실패: ' + err.message);
  }
}

function renderMeetingDetailOffline(meeting) {
  detailTitle.textContent = escapeHTML(meeting.title);
  detailDate.textContent = '📅 ' + new Date(meeting.date).toLocaleDateString('ko-KR');
  detailDuration.textContent = '⏱️ ' + formatTime(meeting.duration);
  detailStatus.textContent = '분석 대기';
  detailStatus.className = 'status-badge pending';

  setupAudioPlayback(meeting);

  transcriptList.innerHTML = `
    <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
      <p>이 회의는 아직 AI 분석이 완료되지 않았습니다.</p>
      <button id="btn-start-delayed-analysis" class="btn-text primary" style="margin-top: 16px; display: inline-flex;">💡 AI 분석 시작하기 (화자 구분 & 요약)</button>
    </div>
  `;
  summaryContent.innerHTML = `<p style="color: var(--text-secondary); text-align: center; padding: 20px;">AI 분석을 완료하면 이곳에 요약본이 표시됩니다.</p>`;
  btnTriggerSummarize.style.display = 'none';

  document.getElementById('btn-start-delayed-analysis')?.addEventListener('click', () => {
    triggerAIAnalysis(meeting);
  });
}

function renderMeetingDetailContent(meeting) {
  detailTitle.textContent = escapeHTML(meeting.title);
  detailDate.textContent = '📅 ' + new Date(meeting.date).toLocaleDateString('ko-KR');
  detailDuration.textContent = '⏱️ ' + formatTime(meeting.duration);
  detailStatus.textContent = '분석 완료';
  detailStatus.className = 'status-badge analyzed';

  setupAudioPlayback(meeting);
  renderTranscriptTab(meeting.transcript);
  renderSummaryTab(meeting.summary);

  // Show re-summarize button on transcript tab
  btnTriggerSummarize.style.display = 'inline-flex';
}

function setupAudioPlayback(meeting) {
  if (meeting.audioChunks && meeting.audioChunks.length > 0) {
    audioPlaybackCard.style.display = 'flex';
    // Combine all chunks into one single Blob for clean continuous playback
    const combinedBlob = new Blob(meeting.audioChunks, { type: meeting.mimeType });
    audioPlayer.src = URL.createObjectURL(combinedBlob);
  } else {
    audioPlaybackCard.style.display = 'none';
  }
}

// Render Transcript turns inside container
function renderTranscriptTab(transcript) {
  transcriptList.innerHTML = '';
  
  if (!transcript || transcript.length === 0) {
    transcriptList.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 20px;">대화 내용이 존재하지 않습니다.</p>`;
    return;
  }

  transcript.forEach((turn, index) => {
    const turnEl = document.createElement('div');
    turnEl.className = 'transcript-turn';
    turnEl.innerHTML = `
      <div class="transcript-turn-header">
        <span class="speaker-tag" data-index="${index}" title="이름 일괄 변경">${escapeHTML(turn.speaker)}</span>
        <span class="turn-time">${turn.time}</span>
      </div>
      <div class="turn-text" contenteditable="true" data-index="${index}" title="텍스트 수정">${escapeHTML(turn.text)}</div>
    `;

    // A. Interactively change speaker names globally
    const speakerTag = turnEl.querySelector('.speaker-tag');
    speakerTag.addEventListener('click', () => {
      const oldName = turn.speaker;
      const newName = prompt(`'${oldName}' 화자의 이름을 어떻게 변경할까요?\n(대화록 내 모든 '${oldName}'이(가) 변경됩니다.)`, oldName);
      
      if (newName && newName.trim() && newName !== oldName) {
        const cleanedName = newName.trim();
        // Edit in global transcript array
        currentMeeting.transcript.forEach(t => {
          if (t.speaker === oldName) {
            t.speaker = cleanedName;
          }
        });

        // Save immediately
        saveMeeting(currentMeeting).then(() => {
          renderTranscriptTab(currentMeeting.transcript);
          loadMeetingsList(); // refresh background list titles
        });
      }
    });

    // B. Interactively edit speech text
    const textNode = turnEl.querySelector('.turn-text');
    textNode.addEventListener('blur', () => {
      const newText = textNode.innerText.trim();
      if (newText && newText !== turn.text) {
        currentMeeting.transcript[index].text = newText;
        saveMeeting(currentMeeting); // Save in background
      }
    });

    transcriptList.appendChild(turnEl);
  });
}

function renderSummaryTab(markdown) {
  if (!markdown) {
    summaryContent.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 20px;">요약 내용이 존재하지 않습니다.</p>`;
    return;
  }
  summaryContent.innerHTML = parseMarkdownToHTML(markdown);
}

// --- 8. MICRO MARKDOWN PARSER (EXTREMELY LIGHTWEIGHT & COMPACT) ---
function parseMarkdownToHTML(md) {
  let html = md;

  // Escaping raw brackets for HTML safety, but keeping basic block components
  html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Tables support
  const lines = html.split('\n');
  let insideTable = false;
  let tableHTML = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!insideTable) {
        insideTable = true;
        tableHTML = '<table>';
      }
      
      // Skip partition line like |---|---|
      if (line.includes('---')) continue;

      const cells = line.split('|').slice(1, -1);
      const rowType = tableHTML === '<table>' ? 'th' : 'td';
      
      tableHTML += '<tr>';
      cells.forEach(cell => {
        tableHTML += `<${rowType}>${cell.trim()}</${rowType}>`;
      });
      tableHTML += '</tr>';
      
      lines[i] = ''; // clear to bypass standard line rendering
    } else {
      if (insideTable) {
        insideTable = false;
        tableHTML += '</table>';
        lines[i] = tableHTML + '\n' + lines[i];
      }
    }
  }
  html = lines.join('\n');

  // Headers
  html = html.replace(/^# 📌 (.*$)/gim, '<h1>📌 $1</h1>');
  html = html.replace(/^# 🔍 (.*$)/gim, '<h1>🔍 $1</h1>');
  html = html.replace(/^# 📝 (.*$)/gim, '<h1>📝 $1</h1>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');

  // Bold Text
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Lists
  html = html.replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');
  // Clean up nested lists wrapping
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  // Line breaks
  html = html.replace(/\n([^\n]+)/g, '<p>$1</p>');

  return html;
}

// --- 9. EVENT LISTENERS AND HELPERS ---
function setupEventListeners() {
  // Navigation / Header
  btnSettings.addEventListener('click', () => {
    modalSettings.classList.add('active');
  });

  btnCloseSettings.addEventListener('click', () => {
    modalSettings.classList.remove('active');
  });

  document.querySelector('.modal-backdrop').addEventListener('click', () => {
    modalSettings.classList.remove('active');
  });

  btnSaveSettings.addEventListener('click', () => {
    const key = inputApiKey.value.trim();
    localStorage.setItem('SORI_API_KEY', key);
    modalSettings.classList.remove('active');
    alert('API Key가 로컬에 안전하게 저장되었습니다!');
  });

  // Recording triggers
  btnRecordStart.addEventListener('click', startRecordingSession);
  
  btnRecordPause.addEventListener('click', () => {
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause();
      btnRecordPause.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
      chunkStatus.innerHTML = `<span class="recording-dot" style="background-color: var(--color-secondary);"></span> 녹음 일시정지됨`;
    } else if (recorder.state === 'paused') {
      recorder.resume();
      btnRecordPause.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"></rect></svg>`;
    }
  });

  btnRecordStop.addEventListener('click', stopRecordingSession);

  // Detail panel back button
  btnDetailBack.addEventListener('click', () => {
    // Reset audio player source to avoid background loading/playing
    audioPlayer.pause();
    audioPlayer.src = '';
    switchView('dashboard');
  });

  // Tab controls
  tabTranscript.addEventListener('click', () => {
    tabTranscript.classList.add('active');
    tabSummary.classList.remove('active');
    contentTranscript.classList.add('active');
    contentSummary.classList.remove('active');
  });

  tabSummary.addEventListener('click', () => {
    tabSummary.classList.add('active');
    tabTranscript.classList.remove('active');
    contentSummary.classList.add('active');
    contentTranscript.classList.remove('active');
  });

  // Re-run 요약
  btnTriggerSummarize.addEventListener('click', async () => {
    const apiKey = localStorage.getItem('SORI_API_KEY') || '';

    if (confirm('현재 수정된 대화록 내용을 바탕으로 AI 요약본을 다시 작성하겠습니까?')) {
      // Construct raw script text from current transcript array
      const rawScript = currentMeeting.transcript
        .map(t => `[${t.time}] ${t.speaker}: ${t.text}`)
        .join('\n');
      
      btnTriggerSummarize.disabled = true;
      btnTriggerSummarize.textContent = '⏳ 생성 중...';

      const gemini = new GeminiService(apiKey);
      try {
        const newSummary = await gemini.summarizeTranscript(rawScript);
        currentMeeting.summary = newSummary;
        
        await saveMeeting(currentMeeting);
        renderSummaryTab(newSummary);
        
        // Auto-switch to summary tab
        tabSummary.click();
      } catch (err) {
        alert('요약 재생성 실패: ' + err.message);
      } finally {
        btnTriggerSummarize.disabled = false;
        btnTriggerSummarize.textContent = '💡 AI 요약 다시 만들기';
      }
    }
  });

  // Copy buttons
  btnExportTranscript.addEventListener('click', () => {
    if (!currentMeeting || currentMeeting.transcript.length === 0) return;
    const text = currentMeeting.transcript
      .map(t => `[${t.time}] ${t.speaker}: ${t.text}`)
      .join('\n');
    
    navigator.clipboard.writeText(text)
      .then(() => alert('대화록 전체 텍스트가 클립보드에 복사되었습니다!'))
      .catch(() => alert('클립보드 복사 실패'));
  });

  btnCopySummary.addEventListener('click', () => {
    if (!currentMeeting || !currentMeeting.summary) return;
    navigator.clipboard.writeText(currentMeeting.summary)
      .then(() => alert('AI 회의 요약본이 클립보드에 복사되었습니다!'))
      .catch(() => alert('클립보드 복사 실패'));
  });
}

// Helpers
function formatTime(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  
  const pad = (num) => String(num).padStart(2, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
