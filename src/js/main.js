/**
 * TransEase (透镜) - Windows 客户端完整交互控制器
 */

document.addEventListener('DOMContentLoaded', () => {
  initWorkbench();
  initSubtitleHUD();
  initHistoryPanel();
  initSettingsPanel();
  initHotkeys();
  initTauriEvents();
});

let isClickThrough = false;
let debounceTimer = null;
let translateSeq = 0;

// 4 行阶梯字幕状态
const subtitleLines = [];
const subtitleHistory = [];
let recognition = null;
let isListening = false;

function initWorkbench() {
  const sourceInput = document.getElementById('sourceInput');
  const lensTrans = document.getElementById('lensTrans');
  const engineBadge = document.getElementById('engineBadge');
  const selectTargetLang = document.getElementById('selectTargetLang');
  const btnClearInput = document.getElementById('btnClearInput');
  const btnClipboard = document.getElementById('btnClipboard');
  const btnSpeak = document.getElementById('btnSpeak');
  const btnCopy = document.getElementById('btnCopy');
  const btnPin = document.getElementById('btnPin');
  const btnMode = document.getElementById('btnMode');
  const btnHistory = document.getElementById('btnHistory');
  const btnSettings = document.getElementById('btnSettings');
  const btnClose = document.getElementById('btnClose');

  if (selectTargetLang) {
    selectTargetLang.value = localStorage.getItem('transease_target_lang') || 'zh-CN';
    selectTargetLang.addEventListener('change', (e) => {
      localStorage.setItem('transease_target_lang', e.target.value);
      if (sourceInput && sourceInput.value.trim()) {
        runTranslation(sourceInput.value);
      }
    });
  }

  sourceInput?.addEventListener('input', (e) => {
    const val = e.target.value;
    clearTimeout(debounceTimer);
    if (!val.trim()) {
      translateSeq += 1;
      if (lensTrans) {
        lensTrans.textContent = '在上方输入文本或点击 📋 / 按 Alt+D 读取剪贴板，译文将在此实时生成。';
        lensTrans.classList.remove('error');
      }
      if (engineBadge) engineBadge.textContent = '就绪';
      return;
    }
    debounceTimer = setTimeout(() => runTranslation(val), 280);
  });

  sourceInput?.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      clearTimeout(debounceTimer);
      runTranslation(sourceInput.value);
    }
  });

  btnClearInput?.addEventListener('click', () => {
    if (sourceInput) sourceInput.value = '';
    translateSeq += 1;
    if (lensTrans) {
      lensTrans.textContent = '在上方输入文本或点击 📋 / 按 Alt+D 读取剪贴板，译文将在此实时生成。';
      lensTrans.classList.remove('error');
    }
    if (engineBadge) engineBadge.textContent = '就绪';
    sourceInput?.focus();
  });

  btnClipboard?.addEventListener('click', () => translateFromClipboard());

  btnSpeak?.addEventListener('click', () => {
    const text = (sourceInput?.value || '').trim();
    if (!text || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    if (/[\u3040-\u30ff]/.test(text)) utter.lang = 'ja-JP';
    else if (/[\uac00-\ud7af]/.test(text)) utter.lang = 'ko-KR';
    else if (/[\u4e00-\u9fff]/.test(text)) utter.lang = 'zh-CN';
    else utter.lang = 'en-US';
    window.speechSynthesis.speak(utter);
  });

  btnCopy?.addEventListener('click', async () => {
    const result = lensTrans?.textContent?.trim();
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      btnCopy.textContent = '✓ 已复制';
      setTimeout(() => { btnCopy.textContent = '📄 复制'; }, 1400);
    } catch (_) {}
  });

  btnPin?.addEventListener('click', () => toggleClickThrough());

  btnMode?.addEventListener('click', () => switchView('subtitle'));

  btnHistory?.addEventListener('click', () => {
    renderHistoryList();
    const modal = document.getElementById('historyModal');
    if (modal) modal.style.display = 'flex';
  });

  btnSettings?.addEventListener('click', () => {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'flex';
  });

  btnClose?.addEventListener('click', () => hideMainWindow());
}

async function runTranslation(text) {
  const clean = (text || '').trim();
  if (!clean) return;
  const seq = ++translateSeq;
  const lensTrans = document.getElementById('lensTrans');
  const engineBadge = document.getElementById('engineBadge');
  const targetLang = document.getElementById('selectTargetLang')?.value || 'zh-CN';

  if (engineBadge) engineBadge.textContent = '正在翻译...';
  const res = await window.translator.translate(clean, targetLang);
  if (seq !== translateSeq) return;

  if (res.success && res.translatedText) {
    if (lensTrans) {
      lensTrans.textContent = res.translatedText;
      lensTrans.classList.remove('error');
    }
    if (engineBadge) engineBadge.textContent = res.engineUsed;
  } else {
    if (lensTrans) {
      lensTrans.textContent = `翻译失败: ${res.errorMessage || '请检查网络或代理设置'}`;
      lensTrans.classList.add('error');
    }
    if (engineBadge) engineBadge.textContent = res.engineUsed || '失败';
  }
}

async function translateFromClipboard() {
  const sourceInput = document.getElementById('sourceInput');
  try {
    const clip = await navigator.clipboard.readText();
    if (clip && clip.trim()) {
      if (sourceInput) sourceInput.value = clip.trim();
      await runTranslation(clip.trim());
    } else if (sourceInput) {
      sourceInput.focus();
    }
  } catch (_) {
    sourceInput?.focus();
  }
}

async function toggleClickThrough(forceState = null) {
  const next = forceState !== null ? forceState : !isClickThrough;
  isClickThrough = next;
  const btnPin = document.getElementById('btnPin');
  const lensView = document.getElementById('lensView');
  btnPin?.classList.toggle('active', isClickThrough);
  lensView?.classList.toggle('click-through', isClickThrough);

  if (window.__TAURI__ && window.__TAURI__.core) {
    try {
      await window.__TAURI__.core.invoke('set_click_through', { ignore: isClickThrough });
    } catch (_) {}
  }
}

function switchView(mode) {
  const lens = document.getElementById('lensView');
  const hud = document.getElementById('subtitleHud');
  if (!lens || !hud) return;
  if (mode === 'subtitle') {
    lens.style.display = 'none';
    hud.style.display = 'flex';
  } else {
    hud.style.display = 'none';
    lens.style.display = 'flex';
  }
}

function hideMainWindow() {
  if (isClickThrough) {
    toggleClickThrough(false);
  }
  if (window.__TAURI__ && window.__TAURI__.window) {
    window.__TAURI__.window.getCurrentWindow().hide();
  }
}

function initSubtitleHUD() {
  const btnReturnLens = document.getElementById('btnReturnLens');
  const btnMicToggle = document.getElementById('btnMicToggle');
  const btnExportSRT = document.getElementById('btnExportSRT');
  const btnClearSubtitles = document.getElementById('btnClearSubtitles');
  const quickInput = document.getElementById('subtitleQuickInput');

  btnReturnLens?.addEventListener('click', () => {
    stopSpeechRecognition();
    switchView('lens');
  });

  btnMicToggle?.addEventListener('click', () => {
    if (isListening) stopSpeechRecognition();
    else startSpeechRecognition();
  });

  quickInput?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && quickInput.value.trim()) {
      const sentence = quickInput.value.trim();
      quickInput.value = '';
      await pushSubtitleLine(sentence);
    }
  });

  btnClearSubtitles?.addEventListener('click', () => {
    subtitleLines.length = 0;
    subtitleHistory.length = 0;
    renderSubtitleRows();
  });

  btnExportSRT?.addEventListener('click', async () => {
    if (subtitleHistory.length === 0) return;
    const srt = buildSRT(subtitleHistory);
    try {
      await navigator.clipboard.writeText(srt);
      btnExportSRT.textContent = '✓ 已复制 SRT';
      setTimeout(() => { btnExportSRT.textContent = 'SRT'; }, 1400);
    } catch (_) {}
  });
}

async function pushSubtitleLine(sourceText) {
  const targetLang = document.getElementById('selectTargetLang')?.value || localStorage.getItem('transease_target_lang') || 'zh-CN';
  const entry = {
    id: `${Date.now()}-${Math.random()}`,
    source: sourceText,
    translated: '翻译中...',
    timestamp: new Date()
  };
  subtitleLines.push(entry);
  if (subtitleLines.length > 4) subtitleLines.shift();
  subtitleHistory.push(entry);
  if (subtitleHistory.length > 120) subtitleHistory.shift();
  renderSubtitleRows();

  const res = await window.translator.translate(sourceText, targetLang);
  entry.translated = res.success && res.translatedText ? res.translatedText : `[失败] ${res.errorMessage || sourceText}`;
  renderSubtitleRows();
}

function renderSubtitleRows() {
  const box = document.getElementById('subtitleRollingBox');
  if (!box) return;
  box.innerHTML = '';

  if (subtitleLines.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'subtitle-empty';
    empty.textContent = '点击「▶ 开始听写」进行实时语音同传，或在下方输入实时句回车即时上屏翻译。';
    box.appendChild(empty);
    return;
  }

  subtitleLines.forEach((line, idx) => {
    const row = document.createElement('div');
    const isActive = idx === subtitleLines.length - 1;
    row.className = `subtitle-row ${isActive ? 'active' : 'history'}`;

    const orig = document.createElement('span');
    orig.className = 'subtitle-row-orig';
    orig.textContent = line.source;

    const trans = document.createElement('span');
    trans.className = 'subtitle-row-trans';
    trans.textContent = line.translated;

    row.appendChild(orig);
    row.appendChild(trans);
    box.appendChild(row);
  });
}

function startSpeechRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hint = document.getElementById('speechStatusHint');
  const btnMic = document.getElementById('btnMicToggle');

  if (!SpeechRec) {
    if (hint) hint.textContent = 'WebView 不支持语音 API，请使用下方输入框';
    return;
  }

  try {
    recognition = new SpeechRec();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onstart = () => {
      isListening = true;
      if (btnMic) {
        btnMic.textContent = '⏹ 停止听写';
        btnMic.classList.add('recording');
      }
      if (hint) hint.textContent = '正在聆听...';
    };

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const transcript = event.results[i][0].transcript.trim();
          if (transcript) pushSubtitleLine(transcript);
        }
      }
    };

    recognition.onerror = (err) => {
      if (hint) hint.textContent = `语音状态: ${err.error || '受限'}`;
      stopSpeechRecognition();
    };

    recognition.onend = () => {
      if (isListening) {
        try { recognition.start(); } catch (_) { stopSpeechRecognition(); }
      }
    };

    recognition.start();
  } catch (_) {
    if (hint) hint.textContent = '无法启动语音识别，请使用下方输入框';
  }
}

function stopSpeechRecognition() {
  isListening = false;
  const btnMic = document.getElementById('btnMicToggle');
  const hint = document.getElementById('speechStatusHint');
  if (btnMic) {
    btnMic.textContent = '▶ 开始听写';
    btnMic.classList.remove('recording');
  }
  if (hint && hint.textContent === '正在聆听...') {
    hint.textContent = '已停止';
  }
  if (recognition) {
    try { recognition.stop(); } catch (_) {}
    recognition = null;
  }
}

function buildSRT(entries) {
  const base = entries[0].timestamp.getTime();
  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hrs = String(Math.floor(s / 3600)).padStart(2, '0');
    const mins = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const secs = String(s % 60).padStart(2, '0');
    const rem = String(Math.max(0, ms % 1000)).padStart(3, '0');
    return `${hrs}:${mins}:${secs},${rem}`;
  };
  return entries.map((item, idx) => {
    const startMs = item.timestamp.getTime() - base;
    const endMs = idx + 1 < entries.length
      ? Math.max(startMs + 1200, entries[idx + 1].timestamp.getTime() - base)
      : startMs + 3500;
    return `${idx + 1}\n${fmt(startMs)} --> ${fmt(endMs)}\n${item.translated}\n${item.source}\n`;
  }).join('\n');
}

function initHistoryPanel() {
  const modal = document.getElementById('historyModal');
  const btnClose = document.getElementById('btnCloseHistory');
  const btnClear = document.getElementById('btnClearHistory');

  btnClose?.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
  btnClear?.addEventListener('click', () => {
    window.translator.clearHistory();
    renderHistoryList();
  });
}

function renderHistoryList() {
  const container = document.getElementById('historyList');
  const modal = document.getElementById('historyModal');
  const sourceInput = document.getElementById('sourceInput');
  if (!container) return;
  container.innerHTML = '';

  const list = window.translator.getHistory();
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:#64748b;font-size:0.82rem;text-align:center;margin:auto 0;';
    empty.textContent = '暂无翻译记录';
    container.appendChild(empty);
    return;
  }

  list.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'history-item';

    const src = document.createElement('div');
    src.className = 'history-src';
    src.textContent = `[${item.time}] ${item.source}`;

    const dst = document.createElement('div');
    dst.className = 'history-dst';
    dst.textContent = item.translated;

    el.appendChild(src);
    el.appendChild(dst);
    el.addEventListener('click', () => {
      if (sourceInput) sourceInput.value = item.source;
      if (modal) modal.style.display = 'none';
      runTranslation(item.source);
    });
    container.appendChild(el);
  });
}

function initSettingsPanel() {
  const modal = document.getElementById('settingsModal');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const btnTestBaidu = document.getElementById('btnTestBaidu');
  const baiduStatus = document.getElementById('baiduStatus');

  const inputAppId = document.getElementById('baiduAppId');
  const inputAppKey = document.getElementById('baiduAppKey');
  const selectEngine = document.getElementById('selectEngine');
  const selectProxyMode = document.getElementById('selectProxyMode');
  const proxyUrlInput = document.getElementById('proxyUrlInput');

  if (inputAppId) inputAppId.value = localStorage.getItem('transease_baidu_app_id') || '';
  if (inputAppKey) inputAppKey.value = localStorage.getItem('transease_baidu_app_key') || '';
  if (selectEngine) selectEngine.value = localStorage.getItem('transease_engine') || 'auto';
  if (selectProxyMode) selectProxyMode.value = localStorage.getItem('transease_proxy_mode') || 'system';
  if (proxyUrlInput) {
    proxyUrlInput.value = localStorage.getItem('transease_proxy_url') || 'http://127.0.0.1:7890';
    proxyUrlInput.style.display = selectProxyMode?.value === 'manual' ? 'block' : 'none';
  }

  inputAppId?.addEventListener('change', (e) => localStorage.setItem('transease_baidu_app_id', e.target.value.trim()));
  inputAppKey?.addEventListener('change', (e) => localStorage.setItem('transease_baidu_app_key', e.target.value.trim()));
  selectEngine?.addEventListener('change', (e) => localStorage.setItem('transease_engine', e.target.value));
  selectProxyMode?.addEventListener('change', (e) => {
    localStorage.setItem('transease_proxy_mode', e.target.value);
    if (proxyUrlInput) {
      proxyUrlInput.style.display = e.target.value === 'manual' ? 'block' : 'none';
    }
  });
  proxyUrlInput?.addEventListener('change', (e) => localStorage.setItem('transease_proxy_url', e.target.value.trim()));

  btnTestBaidu?.addEventListener('click', async () => {
    const appId = inputAppId?.value.trim() || '';
    const appKey = inputAppKey?.value.trim() || '';
    const proxyMode = selectProxyMode?.value || 'system';
    const proxyUrl = proxyUrlInput?.value.trim() || '';

    if (!appId || !appKey) {
      if (baiduStatus) {
        baiduStatus.textContent = '请先输入 App ID 和密钥';
        baiduStatus.className = 'status-badge error';
      }
      return;
    }

    if (baiduStatus) {
      baiduStatus.textContent = '测试连通性中...';
      baiduStatus.className = 'status-badge';
    }

    try {
      if (window.__TAURI__ && window.__TAURI__.core) {
        const res = await window.__TAURI__.core.invoke('test_baidu_connectivity', {
          appId,
          appKey,
          proxyMode,
          proxyUrl
        });
        if (baiduStatus) {
          baiduStatus.textContent = res.message;
          baiduStatus.className = res.success ? 'status-badge success' : 'status-badge error';
        }
      } else {
        if (baiduStatus) {
          baiduStatus.textContent = '请在 Windows 客户端内测试百度直连通道';
          baiduStatus.className = 'status-badge';
        }
      }
    } catch (err) {
      if (baiduStatus) {
        baiduStatus.textContent = `失败: ${err.message || err}`;
        baiduStatus.className = 'status-badge error';
      }
    }
  });

  btnCloseSettings?.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
  });
}

function initHotkeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const settingsModal = document.getElementById('settingsModal');
      const historyModal = document.getElementById('historyModal');
      if (settingsModal && settingsModal.style.display === 'flex') {
        settingsModal.style.display = 'none';
        return;
      }
      if (historyModal && historyModal.style.display === 'flex') {
        historyModal.style.display = 'none';
        return;
      }
      hideMainWindow();
    }
  });
}

function initTauriEvents() {
  if (!window.__TAURI__ || !window.__TAURI__.event) return;
  const { listen } = window.__TAURI__.event;
  listen('shortcut-toggle-lens', () => switchView('lens'));
  listen('shortcut-toggle-subtitle', () => {
    const hud = document.getElementById('subtitleHud');
    const isSub = hud && hud.style.display === 'flex';
    switchView(isSub ? 'lens' : 'subtitle');
  });
  listen('shortcut-translate-clipboard', () => {
    switchView('lens');
    toggleClickThrough(false);
    translateFromClipboard();
  });
  listen('shortcut-toggle-pin', () => toggleClickThrough());
}
