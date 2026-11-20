# RyJS TTS

本地优先的文字转语音桌面工具。基于 **Electron + electron-vite + Vue 3 + Element Plus + Tailwind CSS**，使用 JavaScript 开发。

应用提供四个本地引擎，并可选接入 DeepSeek 官方在线语音：

- **Kokoro 神经语音**：本地 Kokoro-82M 中文模型，8 种中文音色。首次需下载约 334 MB 模型，之后完全离线。
- **Piper 神经语音**：本地 Piper 兼容中文模型「超文」。首次需下载约 58 MB 模型，之后完全离线。
- **Windows 更多语音（OneCore）**：与 Edge、讲述人以及浏览器 Web Speech API 使用同一套本地音色，通常比经典 SAPI 多出更多中文声音。
- **Windows 基础语音（SAPI）**：经典 `System.Speech` 语音，兼容性最好。
- **DeepSeek 在线语音**：DeepSeek 官方 TTS，海星 / 暗潮两种音色。需要用户自己的 API Key；文本会发送到 DeepSeek 并按字符计费，可选但完全默认关闭。

> 本项目**没有集成 edge-tts**。edge-tts 使用微软未公开的 Edge「大声朗读」接口，且项目为 GPLv3；在开源项目中内置会带来微软服务条款与许可证风险。DeepSeek 使用的是官方公开 API，需用户自行提供 Key 并遵守 DeepSeek 的服务条款。

## 下载安装包

推荐从 GitHub Releases 下载：

**https://github.com/lcyaimer/RYJS-TTS/releases**

如果 GitHub 下载速度较慢，可以使用网盘下载（文件由维护者同步；如网盘链接失效或内容未更新，请以 Releases 为准）：

- **夸克网盘**：<https://pan.quark.cn/s/301800ecba9f?pwd=xtDc>　提取码：`xtDc`
- **百度网盘**：<https://pan.baidu.com/s/10HYjUcGmyk19HYcu8kqW1w?pwd=usmz>　提取码：`usmz`

下载后建议使用 Release 页面提供的 SHA-256 校验安装包。当前安装包未配置代码签名，Windows SmartScreen 或 macOS Gatekeeper 可能提示。

## 功能

- **更多音色**：Kokoro 内置小北、小妮、小晓、小艺、云健、云希、云夏、云扬；Piper 提供超文；Windows 本地语音可使用慧慧、瑶瑶、康康；DeepSeek 提供海星、暗潮。
- **数万字长文**：按段落和句末标点自动切分，逐段合成，默认单段上限 500 字（可调 100–2000）；超过引擎单次上限会自动改为分段合成。
- **实时进度与取消**：显示当前合成到第几段，随时可以取消；已完成的分段会保留。
- **逐段试听**：分段完成后即可试听、下载单段，不必等全部结束。
- **合成后自动播放**：默认开启。整篇合成完成后自动播放完整音频；分段合成时第 1 段完成即开始播放，并自动续播后续分段（可在设置中关闭）。
- **完整音频试听与导出**：使用 Node.js 内置模块合并为完整 WAV，不依赖 ffmpeg；可拖动进度、在文件夹中显示、另存为。
- **自定义存储路径**：模型目录、合成缓存目录、默认保存目录都可以在设置中更改。
- **DeepSeek 官方在线语音**：只需填入 API Key；Key 使用 Electron `safeStorage` 加密保存在本机，不写入 localStorage。
- **数字读法处理**：本地神经引擎会自动把日期、时间、百分比、小数、电话号码等转成中文读法，避免数字被词表跳过。
- **模型管理**：显示模型大小、许可、下载进度；支持取消、重试、打开模型目录和 SHA-256 校验。
- **跨平台安装包**：Windows NSIS（安装时可自定义目录）与 macOS DMG（Intel / Apple Silicon）。
- **文本导入**：支持 `txt / md / log`，自动识别 UTF-8、GBK、UTF-16。
- **引擎可扩展**：统一接口 + 注册表，后续可接入更多本地或云端引擎。

## 环境要求

- **Windows 10 / 11**：可使用全部引擎（OneCore、SAPI、Piper、Kokoro、DeepSeek）
- **macOS**：可使用 Piper、Kokoro、DeepSeek；OneCore / SAPI 是 Windows 系统语音，不在 macOS 上提供
- Node.js `^20.19.0` 或 `>=22.12.0`（开发）
- pnpm（本项目使用 pnpm 10 开发）
- 首次使用 Piper / Kokoro 需要联网下载模型；下载 Kokoro 时峰值约需 700 MB 临时空间，安装后两个模型合计约 410 MB
- 使用 DeepSeek 需要联网，并在 DeepSeek 平台创建 API Key

Windows 语音需要系统中至少安装一个语音。中文 Windows 通常自带 OneCore 的「Microsoft Huihui / Yaoyao / Kangkang」和 SAPI 的「Microsoft Huihui Desktop」。可在：

**Windows 设置 → 时间和语言 → 语音 → 管理语音 → 添加语音**

中安装更多语音。Piper / Kokoro 使用应用内下载的模型，不依赖系统语音包。

## 开发运行

```bash
pnpm install
pnpm dev
```

首次运行如果本地没有 Electron 二进制，会自动下载。网络较慢时可以使用国内镜像（项目 `.npmrc` 已配置 npmmirror）：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install
```

`scripts/launch.mjs` 会移除 `ELECTRON_RUN_AS_NODE` 环境变量，避免某些 IDE 终端里 Electron 以纯 Node 模式启动而无法显示窗口。

## 构建与安装包

```bash
pnpm build      # 构建 main / preload / renderer 到 out/
pnpm start      # 运行构建后的应用
pnpm pack:dir   # 生成未打包目录，便于快速检查
```

安装包：

```bash
pnpm dist:win        # Windows x64 NSIS 安装包
pnpm dist:mac        # macOS，当前机器架构
pnpm dist:mac:x64    # macOS Intel
pnpm dist:mac:arm64  # macOS Apple Silicon
```

输出目录为 `dist/`。

- **Windows**：NSIS 安装程序关闭了一键安装，安装时可以选择自定义安装目录；默认当前用户安装，无需管理员权限。
- **macOS**：生成 DMG，拖入「应用程序」即可；安装后也可以把 App 移到任意目录。macOS 没有 Windows 安装器那种“选择安装路径”的步骤。
- **签名**：项目未配置代码签名。macOS 首次打开可能需要在「系统设置 → 隐私与安全性」中允许；Windows 可能出现 SmartScreen 提示。
- **原生模块**：`sherpa-onnx-node` 的原生 `.node/.dll` 已通过 `asarUnpack` 放到 asar 外。构建 macOS 包时必须在对应架构的 macOS 环境或 CI 上安装依赖，否则会带入错误平台的原生二进制。
- **CI**：`.github/workflows/build.yml` 会在 Windows x64、macOS Intel 与 macOS Apple Silicon 上分别构建安装包。

如果 electron-builder 下载工具较慢，可以设置：

```bash
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ pnpm dist:win
```

## 使用方式

1. 粘贴文稿，或点击「导入」选择文本文件。
2. 在左侧选择语音引擎：
   - **Kokoro / Piper**：第一次使用时点击「下载模型」，等待校验和解压完成，然后选择声音。
   - **Windows 更多语音 / 基础语音**：无需下载，直接选择系统声音。
   - **DeepSeek 在线语音**：在卡片中填入 DeepSeek API Key，点击「保存并测试」。测试会消耗少量字符。
3. 选择声音，调整音量；支持语速的引擎还可以调整语速。
4. 选择「自动分段」或「整篇一次」，设置单段上限与段间停顿。
5. 点击「开始合成」或按 `Ctrl + Enter`。
6. 在「试听与导出」中逐段播放、下载，或播放/下载合并后的完整音频。

### 自动播放

设置中默认开启「合成后自动播放」：

- **自动分段**：第 1 段合成完成后立即开始播放；一段播完时若下一段已合成完成会自动续播，若尚未完成则等待下一段。
- **整篇一次**：合并出完整音频后自动播放。
- 如果中途手动选择其他音频，会自动播放会停止；可在设置中关闭。

### 自定义存储路径

设置面板的「存储路径」可以分别更改：

| 项目 | 默认位置 | 说明 |
| --- | --- | --- |
| 模型目录 | 应用数据目录下的 `models`（Windows 通常为 `%APPDATA%\ryjs-tts\models`，macOS 通常为 `~/Library/Application Support/ryjs-tts/models`） | Piper / Kokoro 模型下载位置 |
| 合成缓存 | 应用数据目录下的 `audio-cache` | 生成的音频；自动清理 3 天前的任务目录 |
| 默认保存目录 | 系统「下载」目录 | 点击「下载音频」时默认打开的目录，仍可在对话框中另选 |

- 路径保存在应用配置目录的 `app-paths.json`。
- 修改模型目录不会自动移动已有模型；修改缓存目录后，之前的试听结果需要重新合成。
- 缓存清理只会删除本应用生成的任务目录，不会动其他文件。
- 也可通过 `RYJS_MODELS_DIR`、`RYJS_CACHE_DIR`、`RYJS_EXPORT_DIR` 设置首次启动的默认路径；应用内保存的路径优先。

## DeepSeek 在线语音

DeepSeek 于 2026-11-13 开放了官方 TTS API。本项目接入的是官方接口：

- 接口：`https://api.deepseek.com/v1/tools/tts`
- 音色：`stella`（海星，女声，默认）、`tide`（暗潮，男声）
- 自动识别普通话、粤语、英语、日语、韩语、马来语、阿拉伯语、印尼语、泰语、越南语
- 输出 WAV；官方 PCM 格式为 24 kHz / 16-bit / 单声道
- 单次请求最多 10,000 个计费字符（汉字算 2 个字符），请求体最大 64 KiB，单次音频最长 30 分钟
- **不支持调节语速**；音量由应用在本地对 WAV 做缩放
- 按字符计费，价格与额度以 DeepSeek 官方文档为准

实现细节：

- 用户只需要 API Key，不需要填写模型名或接口地址。
- Key 通过 Electron `safeStorage` 加密保存（Windows DPAPI / macOS Keychain），不写入渲染进程 localStorage，也不会显示回界面。
- 「测试连接」会实际合成一句「你好」，会产生极少量字符费用。
- 文本会上传到 DeepSeek 云端；界面会显示在线状态，标题栏会切换为「在线引擎 · 需要网络」。请勿处理敏感文稿。
- 长文按分段请求；单段超过 4,500 字或超过计费/体积上限时会提示或自动改为分段。

官方文档：<https://api-docs.deepseek.com/zh-cn/guides/tts/>

## 模型管理

模型下载位置由「存储路径 → 模型目录」决定。也可以使用环境变量 `RYJS_MODELS_DIR` 作为默认目录。

应用会按顺序尝试镜像和官方 sherpa-onnx 模型发布地址。下载完成后使用固定 **SHA-256** 校验，校验失败会自动换源重试。也可以通过环境变量 `RYJS_MODEL_MIRROR` 指向自建镜像目录（目录中需包含对应 `.tar.bz2` 文件）。

如果自动下载不可用，可以手动下载并解压模型包，把以下文件放入模型目录下对应的 `piper/` 或 `kokoro/` 子目录：

| 引擎 | 模型包 | 必填文件 |
| --- | --- | --- |
| Piper | `vits-piper-zh_CN-chaowen-medium.tar.bz2` | `zh_CN-chaowen-medium.onnx`、`tokens.txt`、`lexicon.txt` |
| Kokoro | `kokoro-multi-lang-v1_0.tar.bz2` | `model.onnx`、`voices.bin`、`tokens.txt`、`lexicon-zh.txt`、`lexicon-us-en.txt` |

模型包来源：<https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models>。

下载过程中产生的 `espeak-ng-data` 不会参与推理，安装时会被删除；应用使用的是 Sherpa-ONNX 的 lexicon / pinyin 前端，不需要 espeak-ng。

### 模型许可

- **Piper 超文（Chaowen）**：声音数据集标注为 CC0；模型来自 Piper 声音库，推理使用 Sherpa-ONNX（Apache-2.0）。
- **Kokoro-82M**：Apache-2.0；推理使用 Sherpa-ONNX（Apache-2.0）。
- 模型文件由用户在使用时下载，不随本项目源码分发。若用于商业场景，请保留上游模型页面的许可与署名信息，并自行确认最终用途。

## 音频格式、合并与缓存

- 输出为 **WAV，单声道 / 16-bit PCM**：Piper 为 22050 Hz，Kokoro 为 24000 Hz，DeepSeek 为 24000 Hz，SAPI 为 22050 Hz，OneCore 为 16000 Hz。
- 多段合并使用项目内的 `src/main/tts/wav.mjs`，基于 Node.js 内置 `fs` / `stream` 实现，不依赖 ffmpeg 等额外工具；段间停顿可配置。
- 合成缓存位于当前「合成缓存」路径，启动时会清理 3 天前的任务目录；模型目录不会被自动清理。
- 单段音频与完整音频都在缓存目录内；通过「下载音频」另存到默认保存目录或自选位置。

如果需要 MP3 等压缩格式，可以在后续版本中接入 ffmpeg 或纯 JS 编码器。

## 引擎扩展

核心接口定义在 `src/main/tts/`：

```
src/main/tts/
├── engine-manager.mjs     # 引擎注册表 + 默认声音选择
├── neural-engine.mjs      # Sherpa-ONNX 神经引擎基类
├── neural-text.mjs        # 数字 / 日期 / 时间等中文读法规范化
├── piper-engine.mjs       # Piper 中文模型
├── kokoro-engine.mjs      # Kokoro 中文模型
├── deepseek-engine.mjs    # DeepSeek 官方在线 TTS
├── model-manager.mjs      # 模型状态、下载、校验、解压
├── onecore-engine.mjs     # OneCore 引擎（仅 Windows）
├── onecore-scripts.mjs    # 调用 WinRT SpeechSynthesizer 的 PowerShell 脚本
├── sapi-engine.mjs        # 经典 SAPI 引擎（仅 Windows）
├── sapi-scripts.mjs       # 调用 System.Speech 的 PowerShell 脚本
├── powershell.mjs         # PowerShell 进程、脚本文件与错误处理
├── job-service.mjs        # 切分 → 合成 → 合并 → 进度推送
├── preview-service.mjs    # 声音试听与缓存
├── wav.mjs                # WAV 解析、分段合并、音量缩放
└── cache.mjs              # 缓存目录、路径校验、清理
```

新增引擎时：

1. 实现一个类，包含 `id`、`name`、`description`、`local`、`outputFormat`、`capabilities`、`descriptor`。
2. 实现 `async listVoices()`，返回 `{ name, culture, gender, enabled, ... }` 数组。
3. 实现 `async synthesize({ text, textFile, outFile, voiceName, rate, volume, signal })`，生成 **PCM WAV** 文件；`signal` 被 abort 时应终止请求。
4. 在 `engine-manager.mjs` 的 `initEngines()` 中注册。

可选能力：

- `assertReady()`：合成前检查模型 / API Key 是否可用。
- `getStatus()`、`downloadModel(sender)`、`cancelDownload()`：需要下载大模型的引擎，界面会自动显示下载卡片和进度。
- `requiresModel`、`model`、`requiresApiKey`：让界面展示对应的设置卡片。
- `capabilities.speed = false`：界面会禁用并提示不支持调节语速。

云端 API Key 建议使用 Electron `safeStorage` 加密保存，不要写入渲染进程的 localStorage，也不要提交到仓库。`deepseek-config.mjs` 是一个可参考的实现。

## 项目结构

```
src/
├── main/                  # Electron 主进程
│   ├── index.js           # 窗口、安全策略、媒体协议、跨平台窗口设置
│   ├── ipc.mjs            # IPC 接口（合成、试听、模型、路径、API Key、保存）
│   ├── deepseek-config.mjs# DeepSeek API Key 加密存储
│   ├── storage-config.mjs # 模型 / 缓存 / 导出路径配置
│   ├── media-protocol.mjs # ryjs-media:// 本地音频流（支持 Range）
│   └── tts/               # 引擎与合成管线
├── preload/               # 受控的 IPC API 暴露
├── renderer/
│   ├── index.html
│   └── src/
│       ├── App.vue
│       ├── store.js       # 状态、任务、自动播放、模型、路径、API Key
│       ├── components/    # 标题栏、设置、文稿、结果、播放器
│       └── assets/main.css
├── shared/
│   └── text-splitter.mjs  # 主进程与界面共用的切分/时长预估
resources/icon.png         # 应用图标（1024×1024）
scripts/launch.mjs         # 启动包装
scripts/test-core.mjs      # 核心链路测试
scripts/test-deepseek.mjs  # DeepSeek 引擎 mock 测试
electron-builder.yml       # Windows NSIS / macOS DMG 打包配置
.github/workflows/build.yml # 三平台安装包 CI
```

## 测试

```bash
pnpm test:core
pnpm test:deepseek
```

`test:core` 会测试文本切分、神经语音数字规范化，并分别调用 OneCore 与 SAPI 合成音频、合并并校验时长与格式。测试文件位于项目内 `.tmp-test`，成功后自动清理。

`test:deepseek` 使用本地 mock HTTP 服务覆盖 DeepSeek 请求格式、WAV 输出、音量缩放、错误映射、长文本限制和取消逻辑，**不会使用真实 API Key，也不消耗真实额度**。

Piper / Kokoro 的神经推理依赖本地模型，未被自动下载；可以在应用内完成模型下载后，用界面试听或生成音频来验证。

## 开源与第三方许可

本项目代码采用 **MIT** 许可，见 [LICENSE](LICENSE)。主要第三方组件和模型许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

- `sherpa-onnx-node`：Apache-2.0（内含 ONNX Runtime，MIT）
- `tar`：BlueOak-1.0.0；`unbzip2-stream`：MIT
- Piper 超文模型：声音数据 CC0
- Kokoro-82M：Apache-2.0
- DeepSeek TTS：官方 API 服务，不随源码分发；使用时需遵守 DeepSeek 服务条款与隐私政策
- `electron-builder`：MIT（仅开发依赖）

## 已知限制

- 首次使用 Piper / Kokoro 必须联网下载模型；下载体积较大（约 58 MB / 334 MB）。
- 模型下载依赖第三方 GitHub 镜像；如果镜像不可用，可以手动放置模型文件或使用 `RYJS_MODEL_MIRROR`。
- Piper 超文是中文模型，英文单词可能被跳过；Kokoro 支持中英混合文本，但中文多音字仍可能出现误读。
- DeepSeek 在线语音需要网络、API Key 和账户额度；文本会上传云端，且不支持调节语速。
- OneCore 和 SAPI 仅在 Windows 可用，音质和数量取决于系统已安装的语言包。
- 当前只导出 WAV；超长文稿的完整音频文件可能达到上百 MB。
- Kokoro 比 Piper 慢；长文合成按分段顺序串行处理。
- 安装包未配置代码签名和自动更新；macOS 构建需要在 macOS 或对应 CI 上进行。
