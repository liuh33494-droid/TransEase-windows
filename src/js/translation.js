/**
 * TransEase (透镜) - Windows 核心翻译引擎与本地缓存管理
 * Tauri 桌面环境下全量路由至 Rust 后端 (MD5 签名、代理配置、CORS 免疫、智能降级)；
 * 纯浏览器预览时降级直连 Google GTX / MyMemory。
 */

class TranslationEngine {
  constructor() {
    this.cache = new Map();
    this.historyKey = 'transease_win_history';
  }

  getSettings() {
    return {
      baiduAppId: (localStorage.getItem('transease_baidu_app_id') || '').trim(),
      baiduAppKey: (localStorage.getItem('transease_baidu_app_key') || '').trim(),
      engine: localStorage.getItem('transease_engine') || 'auto',
      targetLang: localStorage.getItem('transease_target_lang') || 'zh-CN',
      proxyMode: localStorage.getItem('transease_proxy_mode') || 'system',
      proxyUrl: (localStorage.getItem('transease_proxy_url') || '').trim()
    };
  }

  getHistory() {
    try {
      const raw = localStorage.getItem(this.historyKey);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  addHistory(source, translated, engineUsed) {
    const cleanSrc = source.trim();
    const cleanDst = translated.trim();
    if (!cleanSrc || !cleanDst) return;
    const list = this.getHistory();
    if (list.length > 0 && list[0].source === cleanSrc && list[0].translated === cleanDst) return;
    list.unshift({
      source: cleanSrc,
      translated: cleanDst,
      engine: engineUsed || '',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    if (list.length > 100) list.length = 100;
    try {
      localStorage.setItem(this.historyKey, JSON.stringify(list));
    } catch (_) {}
  }

  clearHistory() {
    localStorage.removeItem(this.historyKey);
  }

  async translate(text, targetLangOverride = null, sourceLang = 'auto') {
    const cleanText = text.trim();
    if (!cleanText) {
      return { success: true, translatedText: '', engineUsed: '就绪', errorMessage: '' };
    }

    const settings = this.getSettings();
    const targetLang = targetLangOverride || settings.targetLang;
    const cacheKey = `${settings.engine}:${sourceLang}->${targetLang}:${cleanText}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // 1. Tauri 原生桌面后端通道（真实 MD5 + 代理 + 无 CORS 限制）
    if (window.__TAURI__ && window.__TAURI__.core) {
      try {
        const res = await window.__TAURI__.core.invoke('translate_text', {
          text: cleanText,
          targetLang: targetLang,
          sourceLang: sourceLang,
          engine: settings.engine,
          baiduAppId: settings.baiduAppId,
          baiduAppKey: settings.baiduAppKey,
          proxyMode: settings.proxyMode,
          proxyUrl: settings.proxyUrl
        });
        const output = {
          success: !!res.success,
          translatedText: res.translated_text || '',
          detectedSource: res.detected_source || sourceLang,
          engineUsed: res.engine_used || settings.engine,
          errorMessage: res.error_message || ''
        };
        if (output.success && output.translatedText) {
          this.cache.set(cacheKey, output);
          this.addHistory(cleanText, output.translatedText, output.engineUsed);
        }
        return output;
      } catch (err) {
        return {
          success: false,
          translatedText: '',
          engineUsed: 'IPC 异常',
          errorMessage: String(err && err.message ? err.message : err)
        };
      }
    }

    // 2. 纯浏览器预览兜底（Google GTX -> MyMemory）
    try {
      const gtxText = await this.translateViaGoogleBrowser(cleanText, targetLang, sourceLang);
      if (gtxText) {
        const out = { success: true, translatedText: gtxText, engineUsed: 'Google 极速 (预览)', errorMessage: '' };
        this.cache.set(cacheKey, out);
        this.addHistory(cleanText, gtxText, out.engineUsed);
        return out;
      }
    } catch (_) {}

    try {
      const mmText = await this.translateViaMyMemoryBrowser(cleanText, targetLang, sourceLang);
      if (mmText) {
        const out = { success: true, translatedText: mmText, engineUsed: 'MyMemory (预览)', errorMessage: '' };
        this.cache.set(cacheKey, out);
        this.addHistory(cleanText, mmText, out.engineUsed);
        return out;
      }
    } catch (_) {}

    return {
      success: false,
      translatedText: '',
      engineUsed: '网络受阻',
      errorMessage: '翻译请求失败，请检查网络连接或配置百度直连 / 代理'
    };
  }

  async translateViaGoogleBrowser(text, target, source) {
    const sl = source === 'auto' ? 'auto' : source;
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data && Array.isArray(data[0])) {
      return data[0].map((item) => item[0]).join('');
    }
    return '';
  }

  async translateViaMyMemoryBrowser(text, target, source) {
    const sl = source === 'auto' ? 'en' : source;
    const langpair = `${sl}|${target}`;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data && data.responseStatus === 200 && data.responseData && data.responseData.translatedText) {
      return data.responseData.translatedText;
    }
    return '';
  }
}

window.translator = new TranslationEngine();
