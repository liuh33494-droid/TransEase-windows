// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::webview::WebviewWindow;
use tauri::Manager;

#[derive(Serialize, Deserialize)]
pub struct MousePoint {
    pub x: i32,
    pub y: i32,
}

#[derive(Serialize, Deserialize)]
pub struct BaiduTestResponse {
    pub success: bool,
    pub latency_ms: u64,
    pub message: String,
}

/// 穿透鼠标点击事件（通过 Tauri 2 原生 set_ignore_cursor_events 方法）
#[tauri::command]
fn set_click_through(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}

/// 获取当前全局光标物理像素坐标
#[tauri::command]
fn get_cursor_position(window: WebviewWindow) -> Result<MousePoint, String> {
    match window.cursor_position() {
        Ok(pos) => Ok(MousePoint {
            x: pos.x as i32,
            y: pos.y as i32,
        }),
        Err(e) => Err(e.to_string()),
    }
}

/// 百度翻译开放平台官方直连：MD5 签名生成与网络连通性测速
#[tauri::command]
async fn test_baidu_connectivity(app_id: String, app_key: String) -> Result<BaiduTestResponse, String> {
    let clean_id = app_id.trim();
    let clean_key = app_key.trim();

    if clean_id.is_empty() || clean_key.is_empty() {
        return Ok(BaiduTestResponse {
            success: false,
            latency_ms: 0,
            message: "请先输入完整的 App ID 与密钥 (Secret Key)".into(),
        });
    }

    let salt = format!("{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs());
    let query = "Hello";
    let sign_raw = format!("{}{}{}{}", clean_id, query, salt, clean_key);
    let digest = md5::compute(sign_raw.as_bytes());
    let sign = format!("{:x}", digest);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .map_err(|e| e.to_string())?;

    let start_time = Instant::now();
    let resp = client
        .post("https://api.fanyi.baidu.com/api/trans/vip/translate")
        .form(&[
            ("q", query),
            ("from", "en"),
            ("to", "zh"),
            ("appid", clean_id),
            ("salt", &salt),
            ("sign", &sign),
        ])
        .send()
        .await;

    let latency_ms = start_time.elapsed().as_millis() as u64;

    match resp {
        Ok(res) => {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(err_code) = json.get("error_code").and_then(|v| v.as_str()) {
                    if err_code != "52000" {
                        let explanation = match err_code {
                            "54001" => "签名错误 (请核对 App ID 与密钥是否匹配)",
                            "52003" => "未授权用户 (请在百度平台确认已开通通用文本翻译服务)",
                            "54004" => "账户余额不足 (请检查百度平台账户额度)",
                            "54003" => "访问频率受限",
                            _ => "百度返回错误码",
                        };
                        return Ok(BaiduTestResponse {
                            success: false,
                            latency_ms,
                            message: format!("{} [{}]", explanation, err_code),
                        });
                    }
                }
                if let Some(results) = json.get("trans_result").and_then(|v| v.as_array()) {
                    if !results.is_empty() {
                        return Ok(BaiduTestResponse {
                            success: true,
                            latency_ms,
                            message: format!("✓ 连通正常 (响应 {} ms)", latency_ms),
                        });
                    }
                }
            }
            Ok(BaiduTestResponse {
                success: false,
                latency_ms,
                message: "百度接口响应异常".into(),
            })
        }
        Err(e) => Ok(BaiduTestResponse {
            success: false,
            latency_ms,
            message: format!("网络请求失败: {}", e),
        }),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::init())
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            get_cursor_position,
            test_baidu_connectivity
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TransEase Windows application");
}
