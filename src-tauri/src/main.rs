// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

#[derive(Serialize, Deserialize)]
pub struct BaiduTestResponse {
    pub success: bool,
    pub latency_ms: u64,
    pub message: String,
}

#[derive(Serialize, Deserialize)]
pub struct TranslateResponse {
    pub success: bool,
    pub translated_text: String,
    pub detected_source: String,
    pub engine_used: String,
    pub error_message: String,
}

fn build_http_client(proxy_mode: &str, proxy_url: &str, timeout_secs: u64) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36");

    match proxy_mode {
        "direct" => {
            builder = builder.no_proxy();
        }
        "manual" => {
            let trimmed = proxy_url.trim();
            if !trimmed.is_empty() {
                let normalized = if trimmed.contains("://") {
                    trimmed.to_string()
                } else {
                    format!("http://{}", trimmed)
                };
                if let Ok(proxy) = reqwest::Proxy::all(&normalized) {
                    builder = builder.proxy(proxy);
                }
            }
        }
        _ => {}
    }

    builder.build().map_err(|e| format!("网络客户端初始化失败: {}", e))
}

fn map_baidu_lang(lang: &str) -> &str {
    match lang.to_lowercase().as_str() {
        "zh" | "zh-cn" | "zh-hans" => "zh",
        "zh-tw" | "zh-hant" => "cht",
        "en" | "en-us" | "en-gb" => "en",
        "ja" | "ja-jp" => "jp",
        "ko" | "ko-kr" => "kor",
        "fr" | "fr-fr" => "fra",
        "de" | "de-de" => "de",
        "es" | "es-es" => "spa",
        "ru" | "ru-ru" => "ru",
        _ => "auto",
    }
}

fn map_google_lang(lang: &str) -> &str {
    match lang.to_lowercase().as_str() {
        "zh" | "zh-cn" | "zh-hans" => "zh-CN",
        "zh-tw" | "zh-hant" => "zh-TW",
        "en" | "en-us" | "en-gb" => "en",
        "ja" | "ja-jp" => "ja",
        "ko" | "ko-kr" => "ko",
        "fr" | "fr-fr" => "fr",
        "de" | "de-de" => "de",
        "es" | "es-es" => "es",
        "ru" | "ru-ru" => "ru",
        _ => "auto",
    }
}

fn explain_baidu_error(err_code: &str, raw_msg: Option<&str>) -> String {
    let detail = match err_code {
        "54001" => "签名错误 (请核对 App ID 与密钥是否匹配)",
        "52003" => "未授权用户 (请在百度平台确认已开通通用文本翻译服务)",
        "54004" => "账户余额不足 (请检查百度平台账户额度)",
        "54003" => "访问频率受限",
        "54005" => "单次请求文本过长",
        _ => raw_msg.unwrap_or("百度返回错误码"),
    };
    format!("{} [{}]", detail, err_code)
}

async fn request_baidu_translate(
    client: &reqwest::Client,
    text: &str,
    source_lang: &str,
    target_lang: &str,
    app_id: &str,
    app_key: &str,
) -> Result<(String, String), String> {
    let clean_id = app_id.trim();
    let clean_key = app_key.trim();
    if clean_id.is_empty() || clean_key.is_empty() {
        return Err("请先配置百度翻译 App ID 与密钥".into());
    }

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let salt = format!("{}", nanos % 1_000_000_000);
    let sign_raw = format!("{}{}{}{}", clean_id, text, salt, clean_key);
    let sign = format!("{:x}", md5::compute(sign_raw.as_bytes()));

    let from_code = map_baidu_lang(source_lang);
    let to_code = map_baidu_lang(target_lang);

    let form_params = [
        ("q", text),
        ("from", from_code),
        ("to", to_code),
        ("appid", clean_id),
        ("salt", salt.as_str()),
        ("sign", sign.as_str()),
    ];

    let res = client
        .post("https://api.fanyi.baidu.com/api/trans/vip/translate")
        .form(&form_params)
        .send()
        .await
        .map_err(|e| format!("百度网络请求失败: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("百度服务 HTTP {}", res.status().as_u16()));
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("百度响应解析失败: {}", e))?;

    if let Some(err_code) = json.get("error_code").and_then(|v| v.as_str()) {
        if err_code != "52000" {
            let msg = json.get("error_msg").and_then(|v| v.as_str());
            return Err(explain_baidu_error(err_code, msg));
        }
    }

    let list = json
        .get("trans_result")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "百度接口未返回有效译文".to_string())?;

    let mut lines: Vec<String> = Vec::with_capacity(list.len());
    for item in list {
        if let Some(dst) = item.get("dst").and_then(|v| v.as_str()) {
            lines.push(dst.to_string());
        }
    }
    let translated = lines.join("\n").trim().to_string();
    if translated.is_empty() {
        return Err("百度返回译文为空".into());
    }
    let detected = json
        .get("from")
        .and_then(|v| v.as_str())
        .unwrap_or(from_code)
        .to_string();
    Ok((translated, detected))
}

async fn request_google_translate(
    client: &reqwest::Client,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<(String, String), String> {
    let sl = map_google_lang(source_lang);
    let tl = map_google_lang(target_lang);
    let res = client
        .post("https://translate.googleapis.com/translate_a/single")
        .query(&[("client", "gtx"), ("sl", sl), ("tl", tl), ("dt", "t")])
        .form(&[("q", text)])
        .send()
        .await
        .map_err(|e| format!("Google 请求失败: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Google 服务 HTTP {}", res.status().as_u16()));
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Google 响应解析失败: {}", e))?;

    let rows = json
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Google 响应结构异常".to_string())?;

    let mut out = String::new();
    for row in rows {
        if let Some(seg) = row.as_array().and_then(|r| r.first()).and_then(|s| s.as_str()) {
            out.push_str(seg);
        }
    }
    let trimmed = out.trim().to_string();
    if trimmed.is_empty() {
        return Err("Google 译文为空".into());
    }
    let detected = json
        .as_array()
        .and_then(|arr| arr.get(2))
        .and_then(|v| v.as_str())
        .unwrap_or(sl)
        .to_string();
    Ok((trimmed, detected))
}

async fn request_mymemory_translate(
    client: &reqwest::Client,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<(String, String), String> {
    let sl = if source_lang == "auto" {
        "en"
    } else {
        map_google_lang(source_lang)
    };
    let tl = map_google_lang(target_lang);
    let langpair = format!("{}|{}", sl, tl);

    let res = client
        .get("https://api.mymemory.translated.net/get")
        .query(&[("q", text), ("langpair", langpair.as_str())])
        .send()
        .await
        .map_err(|e| format!("MyMemory 请求失败: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("MyMemory 服务 HTTP {}", res.status().as_u16()));
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("MyMemory 响应解析失败: {}", e))?;

    let status = json.get("responseStatus").and_then(|v| v.as_i64()).unwrap_or(0);
    if status != 200 {
        return Err("MyMemory 返回异常状态".into());
    }

    let translated = json
        .get("responseData")
        .and_then(|d| d.get("translatedText"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if translated.is_empty() {
        return Err("MyMemory 译文为空".into());
    }
    Ok((translated, sl.to_string()))
}

/// 穿透鼠标点击事件（通过 Tauri 2 原生 set_ignore_cursor_events 方法）
#[tauri::command]
fn set_click_through(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}

/// 百度翻译开放平台官方直连：MD5 签名生成与网络连通性测速
#[tauri::command]
async fn test_baidu_connectivity(
    app_id: String,
    app_key: String,
    proxy_mode: Option<String>,
    proxy_url: Option<String>,
) -> Result<BaiduTestResponse, String> {
    let clean_id = app_id.trim();
    let clean_key = app_key.trim();

    if clean_id.is_empty() || clean_key.is_empty() {
        return Ok(BaiduTestResponse {
            success: false,
            latency_ms: 0,
            message: "请先输入完整的 App ID 与密钥 (Secret Key)".into(),
        });
    }

    let client = build_http_client(
        proxy_mode.as_deref().unwrap_or("system"),
        proxy_url.as_deref().unwrap_or(""),
        8,
    )?;

    let start_time = Instant::now();
    match request_baidu_translate(&client, "Hello", "en", "zh-CN", clean_id, clean_key).await {
        Ok(_) => {
            let latency_ms = start_time.elapsed().as_millis() as u64;
            Ok(BaiduTestResponse {
                success: true,
                latency_ms,
                message: format!("✓ 连通正常 (响应 {} ms)", latency_ms),
            })
        }
        Err(err_msg) => Ok(BaiduTestResponse {
            success: false,
            latency_ms: start_time.elapsed().as_millis() as u64,
            message: err_msg,
        }),
    }
}

/// 统一 Rust 后端翻译引擎（原生 MD5 签名、CORS 免疫、代理注入、多通道自适应降级）
#[tauri::command]
async fn translate_text(
    text: String,
    target_lang: String,
    source_lang: String,
    engine: String,
    baidu_app_id: String,
    baidu_app_key: String,
    proxy_mode: String,
    proxy_url: String,
) -> Result<TranslateResponse, String> {
    let clean_text = text.trim();
    if clean_text.is_empty() {
        return Ok(TranslateResponse {
            success: true,
            translated_text: String::new(),
            detected_source: source_lang,
            engine_used: "空文本".into(),
            error_message: String::new(),
        });
    }

    let client = build_http_client(&proxy_mode, &proxy_url, 8)?;
    let has_baidu = !baidu_app_id.trim().is_empty() && !baidu_app_key.trim().is_empty();

    match engine.as_str() {
        "baidu" => {
            match request_baidu_translate(&client, clean_text, &source_lang, &target_lang, &baidu_app_id, &baidu_app_key).await {
                Ok((translated, detected)) => Ok(TranslateResponse {
                    success: true,
                    translated_text: translated,
                    detected_source: detected,
                    engine_used: "百度翻译 (国内直连)".into(),
                    error_message: String::new(),
                }),
                Err(baidu_err) => {
                    if let Ok((translated, detected)) = request_mymemory_translate(&client, clean_text, &source_lang, &target_lang).await {
                        return Ok(TranslateResponse {
                            success: true,
                            translated_text: translated,
                            detected_source: detected,
                            engine_used: "MyMemory (百度兜底)".into(),
                            error_message: String::new(),
                        });
                    }
                    Ok(TranslateResponse {
                        success: false,
                        translated_text: String::new(),
                        detected_source: source_lang,
                        engine_used: "百度翻译".into(),
                        error_message: baidu_err,
                    })
                }
            }
        }
        "google" => {
            match request_google_translate(&client, clean_text, &source_lang, &target_lang).await {
                Ok((translated, detected)) => Ok(TranslateResponse {
                    success: true,
                    translated_text: translated,
                    detected_source: detected,
                    engine_used: "Google 极速".into(),
                    error_message: String::new(),
                }),
                Err(err) => Ok(TranslateResponse {
                    success: false,
                    translated_text: String::new(),
                    detected_source: source_lang,
                    engine_used: "Google 极速".into(),
                    error_message: err,
                }),
            }
        }
        "mymemory" => {
            match request_mymemory_translate(&client, clean_text, &source_lang, &target_lang).await {
                Ok((translated, detected)) => Ok(TranslateResponse {
                    success: true,
                    translated_text: translated,
                    detected_source: detected,
                    engine_used: "MyMemory 公共源".into(),
                    error_message: String::new(),
                }),
                Err(err) => Ok(TranslateResponse {
                    success: false,
                    translated_text: String::new(),
                    detected_source: source_lang,
                    engine_used: "MyMemory".into(),
                    error_message: err,
                }),
            }
        }
        _ => {
            // 智能自适应：若已配置百度密钥则优先国内毫秒直连，失败时再切 Google / MyMemory；未配置则走 Google -> MyMemory
            if has_baidu {
                if let Ok((translated, detected)) = request_baidu_translate(&client, clean_text, &source_lang, &target_lang, &baidu_app_id, &baidu_app_key).await {
                    return Ok(TranslateResponse {
                        success: true,
                        translated_text: translated,
                        detected_source: detected,
                        engine_used: "百度翻译 (国内直连)".into(),
                        error_message: String::new(),
                    });
                }
            }

            if let Ok((translated, detected)) = request_google_translate(&client, clean_text, &source_lang, &target_lang).await {
                return Ok(TranslateResponse {
                    success: true,
                    translated_text: translated,
                    detected_source: detected,
                    engine_used: "Google 极速".into(),
                    error_message: String::new(),
                });
            }

            match request_mymemory_translate(&client, clean_text, &source_lang, &target_lang).await {
                Ok((translated, detected)) => Ok(TranslateResponse {
                    success: true,
                    translated_text: translated,
                    detected_source: detected,
                    engine_used: "MyMemory 兜底".into(),
                    error_message: String::new(),
                }),
                Err(err) => Ok(TranslateResponse {
                    success: false,
                    translated_text: String::new(),
                    detected_source: source_lang,
                    engine_used: "全部通道失败".into(),
                    error_message: err,
                }),
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            test_baidu_connectivity,
            translate_text
        ])
        .setup(|app| {
            let shortcut_plugin = tauri_plugin_global_shortcut::Builder::<tauri::Wry>::new()
                .with_shortcuts(["alt+x", "alt+v", "alt+d", "alt+p"]);

            match shortcut_plugin {
                Ok(builder) => {
                    let plugin = builder
                        .with_handler(|app, shortcut, event| {
                            if event.state != ShortcutState::Pressed {
                                return;
                            }
                            if let Some(win) = app.get_webview_window("main") {
                                if shortcut.matches(Modifiers::ALT, Code::KeyX) {
                                    let visible = win.is_visible().unwrap_or(false);
                                    if visible {
                                        let _ = win.hide();
                                    } else {
                                        let _ = win.show();
                                        let _ = win.set_focus();
                                        let _ = win.emit("shortcut-toggle-lens", ());
                                    }
                                } else if shortcut.matches(Modifiers::ALT, Code::KeyV) {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                    let _ = win.emit("shortcut-toggle-subtitle", ());
                                } else if shortcut.matches(Modifiers::ALT, Code::KeyD) {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                    let _ = win.set_ignore_cursor_events(false);
                                    let _ = win.emit("shortcut-translate-clipboard", ());
                                } else if shortcut.matches(Modifiers::ALT, Code::KeyP) {
                                    let _ = win.emit("shortcut-toggle-pin", ());
                                }
                            }
                        })
                        .build();
                    let _ = app.handle().plugin(plugin);
                }
                Err(_) => {
                    let _ = app.handle().plugin(tauri_plugin_global_shortcut::Builder::<tauri::Wry>::new().build());
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TransEase Windows application");
}
