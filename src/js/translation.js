/**
 * TransEase (透镜) - Windows 核心翻译引擎
 * 支持：百度翻译开放平台官方直连、Google 极速、MyMemory 兜底与缓存
 */

class TranslationEngine {
  constructor() {
    this.cache = new Map();
  }

  getSettings() {
    return {
      baiduAppId: localStorage.getItem('transease_baidu_app_id') || '',
      baiduAppKey: localStorage.getItem('transease_baidu_app_key') || '',
      engine: localStorage.getItem('transease_engine') || 'auto',
      targetLang: localStorage.getItem('transease_target_lang') || 'zh'
    };
  }

  /**
   * 综合翻译入口：根据配置自适应选择引擎
   */
  async translate(text, targetLang = 'zh', sourceLang = 'auto') {
    const cleanText = text.trim();
    if (!cleanText) return '';

    const cacheKey = `${sourceLang}->${targetLang}:${cleanText}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const { baiduAppId, baiduAppKey, engine } = this.getSettings();

    // 优先：如果配置了百度且选了百度或智能自适应
    if (baiduAppId && baiduAppKey && (engine === 'baidu' || engine === 'auto')) {
      try {
        const res = await this.translateViaBaidu(cleanText, targetLang, sourceLang, baiduAppId, baiduAppKey);
        if (res) {
          this.cache.set(cacheKey, res);
          return res;
        }
      } catch (err) {
        console.warn('[TransEase] 百度直连失败，尝试极速降级:', err);
      }
    }

    // 降级：Google 极速
    try {
      const res = await this.translateViaGoogle(cleanText, targetLang, sourceLang);
      if (res) {
        this.cache.set(cacheKey, res);
        return res;
      }
    } catch (_) {}

    // 兜底：MyMemory
    try {
      const res = await this.translateViaMyMemory(cleanText, targetLang, sourceLang);
      if (res) {
        this.cache.set(cacheKey, res);
        return res;
      }
    } catch (_) {}

    return cleanText;
  }

  /**
   * 百度翻译开放平台官方直连 (通过 Tauri Rust 后端直接请求，避免 CORS)
   */
  async translateViaBaidu(text, target, source, appId, appKey) {
    if (window.__TAURI__ && window.__TAURI__.core) {
      // 通过 Tauri Rust 后端直连
      const res = await window.__TAURI__.core.invoke('test_baidu_connectivity', {
        appId,
        appKey
      });
      if (res && !res.success) {
        throw new Error(res.message);
      }
    }

    // 简易直接请求 (开发/浏览器端备用)
    const salt = Date.now().toString();
    const sign = await this.md5Hex(`${appId}${text}${salt}${appKey}`);
    const url = 'https://api.fanyi.baidu.com/api/trans/vip/translate';

    const params = new URLSearchParams({
      q: text,
      from: source === 'auto' ? 'auto' : source,
      to: target,
      appid: appId,
      salt: salt,
      sign: sign
    });

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    const data = await resp.json();
    if (data.error_code && data.error_code !== '52000') {
      throw new Error(`百度错误 [${data.error_code}]: ${data.error_msg}`);
    }

    if (data.trans_result && data.trans_result[0]) {
      return data.trans_result.map(item => item.dst).join('\n');
    }
    return '';
  }

  /**
   * Google 极速公共接口
   */
  async translateViaGoogle(text, target, source) {
    const sl = source === 'auto' ? 'auto' : source;
    const tl = target;
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;

    const resp = await fetch(url);
    const data = await resp.json();
    if (data && data[0]) {
      return data[0].map(item => item[0]).join('');
    }
    return '';
  }

  /**
   * MyMemory 公共接口
   */
  async translateViaMyMemory(text, target, source) {
    const sl = source === 'auto' ? 'en' : source;
    const langpair = `${sl}|${target}`;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;

    const resp = await fetch(url);
    const data = await resp.json();
    if (data && data.responseData && data.responseData.translatedText) {
      return data.responseData.translatedText;
    }
    return '';
  }

  async md5Hex(str) {
    const msgUint8 = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('MD5', msgUint8).catch(() => null);
    if (!hashBuffer) {
      // 简单降级 hash
      return Math.random().toString(36).substring(2);
    }
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

window.translator = new TranslationEngine();
