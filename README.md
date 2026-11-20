# TransEase (透镜) - Windows 原生随动透镜与多语种实时字幕客户端

专为 Windows 11 / 10 打造的原生高质感随动透镜与实时同传字幕工具。基于 **Tauri 2.0 (Rust 内核 + Fluent Design 前端)** 架构。

---

## 🌟 核心特性与 Windows 原生集成

1. **🔮 鼠标随动透镜 (Hover Lens)**：
   - 采用 Win32 `WS_EX_TRANSPARENT` 与 `WS_EX_LAYERED` 底层扩展样式，实现真正的穿透点击与零阻碍鼠标滑行。
   - 鼠标扫过屏幕英文区域停顿 0.18 秒，母语译文原位呈现。
2. **🎙️ 实时视频字幕与同传 (4行阶梯歌词流)**：
   - 基于 Windows 原生 **WASAPI Loopback 扬声器回环技术**，无需安装虚拟音频驱动，零延迟直接内录浏览器、YouTube 或会议音频并实时流式转录。
3. **⚡ 国内网络免翻直连 & 极速自适应**：
   - 官方直连百度翻译开放平台，内置 Rust 毫秒级 MD5 签名与连通性测速诊断。
4. **⌨️ Windows 全局快捷键**：
   - `Alt + X`：唤醒 / 隐藏随动透镜
   - `Alt + V`：开启实时视频字幕
   - `Esc`：快速退出浮窗

---

## 💻 在华硕天选 3 (Windows) 上本地运行与调试

在天选 3 上克隆或解压本项目后：

### 环境前置要求
- 安装 **Node.js (v18+)**
- 安装 **Rust** (运行 `rustup-init.exe` 即可一键安装)
- Windows 10/11 已自带 WebView2 Runtime

### 快速启动
```bash
# 1. 安装前端与 Tauri CLI 依赖
npm install

# 2. 启动 Windows 原生调试预览
npm run tauri dev

# 3. 打包生成独立的 Windows 安装包 (.exe)
npm run tauri build
```
打包成功后，安装包将生成于：`src-tauri/target/release/bundle/nsis/TransEase_3.1.0_x64-setup.exe`。

---

## 🚀 GitHub Actions 云端全自动打包

本项目已配置 `.github/workflows/build-windows.yml`。每次推送到 GitHub `main` 分支，GitHub 的 Windows 官方虚拟机集群会自动执行编译，并在 Releases 与 Artifacts 中生成即开即用的 Windows 安装包。
