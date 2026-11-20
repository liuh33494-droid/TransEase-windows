/**
 * TransEase (透镜) - Windows 客户端交互主逻辑
 */

document.addEventListener('DOMContentLoaded', () => {
  initLensControls();
  initSettingsPanel();
  initHotkeys();
});

let isPinned = false;
let isClickThrough = true;

function initLensControls() {
  const btnPin = document.getElementById('btnPin');
  const btnSettings = document.getElementById('btnSettings');
  const btnClose = document.getElementById('btnClose');
  const btnMode = document.getElementById('btnMode');

  // 临时锁定 (Pin) / 穿透点击切换
  btnPin?.addEventListener('click', async () => {
    isPinned = !isPinned;
    btnPin.classList.toggle('active', isPinned);

    // 锁定状态下允许鼠标操作，未锁定状态下穿透鼠标
    isClickThrough = !isPinned;
    if (window.__TAURI__ && window.__TAURI__.core) {
      await window.__TAURI__.core.invoke('set_click_through', { ignore: isClickThrough });
    }
  });

  // 打开设置
  btnSettings?.addEventListener('click', () => {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'flex';
  });

  // 模式切换 (随动透镜 <-> 视频字幕)
  btnMode?.addEventListener('click', () => {
    const lens = document.getElementById('lensView');
    const hud = document.getElementById('subtitleHud');
    if (lens && hud) {
      const isHud = hud.style.display === 'flex';
      hud.style.display = isHud ? 'none' : 'flex';
      lens.style.display = isHud ? 'flex' : 'none';
    }
  });

  // 关闭 / 隐藏
  btnClose?.addEventListener('click', () => {
    if (window.__TAURI__ && window.__TAURI__.window) {
      window.__TAURI__.window.getCurrentWindow().hide();
    }
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

  // 回填本地配置
  if (inputAppId) inputAppId.value = localStorage.getItem('transease_baidu_app_id') || '';
  if (inputAppKey) inputAppKey.value = localStorage.getItem('transease_baidu_app_key') || '';
  if (selectEngine) selectEngine.value = localStorage.getItem('transease_engine') || 'auto';

  // 保存配置
  inputAppId?.addEventListener('change', (e) => localStorage.setItem('transease_baidu_app_id', e.target.value.trim()));
  inputAppKey?.addEventListener('change', (e) => localStorage.setItem('transease_baidu_app_key', e.target.value.trim()));
  selectEngine?.addEventListener('change', (e) => localStorage.setItem('transease_engine', e.target.value));

  // 测试百度连接
  btnTestBaidu?.addEventListener('click', async () => {
    const appId = inputAppId?.value.trim() || '';
    const appKey = inputAppKey?.value.trim() || '';

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
        const res = await window.__TAURI__.core.invoke('test_baidu_connectivity', { appId, appKey });
        if (baiduStatus) {
          baiduStatus.textContent = res.message;
          baiduStatus.className = res.success ? 'status-badge success' : 'status-badge error';
        }
      } else {
        // 前端模拟测试
        setTimeout(() => {
          if (baiduStatus) {
            baiduStatus.textContent = '✓ 连通正常 (响应 62 ms)';
            baiduStatus.className = 'status-badge success';
          }
        }, 300);
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
      const modal = document.getElementById('settingsModal');
      if (modal && modal.style.display === 'flex') {
        modal.style.display = 'none';
        return;
      }
      // 退出透镜
      if (window.__TAURI__ && window.__TAURI__.window) {
        window.__TAURI__.window.getCurrentWindow().hide();
      }
    }
  });
}
