# Third-Party Notices

RyJS TTS 的源代码采用 MIT 许可。下列第三方组件、模型和本地系统接口由各自的权利人提供，适用各自的许可条款。

## 运行时依赖

| 组件 | 用途 | 许可 | 来源 |
| --- | --- | --- | --- |
| `sherpa-onnx-node` | 本地神经语音推理 | Apache-2.0 | <https://github.com/k2-fsa/sherpa-onnx> |
| ONNX Runtime（随 sherpa-onnx 分发） | 神经网络推理 | MIT | <https://github.com/microsoft/onnxruntime> |
| `tar` | 解压模型包 | BlueOak-1.0.0 | <https://github.com/isaacs/node-tar> |
| `unbzip2-stream` | 解压 bzip2 模型包 | MIT | <https://github.com/regular/unbzip2-stream> |
| Electron | 桌面运行时 | MIT | <https://github.com/electron/electron> |
| Vue 3 | 界面框架 | MIT | <https://github.com/vuejs/core> |
| Element Plus / `@element-plus/icons-vue` | UI 组件 | MIT | <https://github.com/element-plus/element-plus> |
| Tailwind CSS / `@tailwindcss/vite` | 样式 | MIT | <https://github.com/tailwindlabs/tailwindcss> |
| electron-vite / Vite / `@vitejs/plugin-vue` | 构建工具 | MIT | <https://github.com/alex8088/electron-vite> |
| electron-builder | 安装包构建（开发依赖） | MIT | <https://github.com/electron-userland/electron-builder> |

Electron 内含 Chromium、Node.js 及其第三方组件，完整许可见 Electron 发行包中的 `LICENSES.chromium.html`。

## 本地语音模型

模型文件不包含在本项目的源码仓库中。用户在应用内确认后，从上游发布地址下载到本机 `userData/models`，也可以手动放置。

| 模型 | 用途 | 许可 | 来源 |
| --- | --- | --- | --- |
| Kokoro-82M v1.0（`kokoro-multi-lang-v1_0`） | 中文 / 英文神经语音 | Apache-2.0 | <https://huggingface.co/hexgrad/Kokoro-82M>、<https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models> |
| Piper 中文声音「超文」（`zh_CN-chaowen-medium`） | 中文神经语音 | MODEL_CARD 标注数据集 CC0；模型来自 Piper voices | <https://huggingface.co/rhasspy/piper-voices>、<https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models> |
| Sherpa-ONNX 模型打包文件 | 模型转换与推理配置 | Apache-2.0 | <https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models> |

下载的模型包中可能包含上游附带的 `LICENSE`、`MODEL_CARD` 或其他说明文件；这些文件会保留在模型目录中，供查阅和署名。应用不使用 `espeak-ng-data` 进行推理，安装时会删除该目录。

本项目不包含 `OHF-Voice/piper1-gpl` 的 GPL 引擎代码；Piper 声音模型通过 Apache-2.0 的 Sherpa-ONNX 加载和推理。

## Windows 系统语音

OneCore 与 SAPI 引擎调用 Windows 系统内置的语音合成接口：

- OneCore：`Windows.Media.SpeechSynthesis`（WinRT）
- SAPI：`System.Speech`（.NET）

应用不随源码分发这些系统语音或语音包，其可用性和使用条件由 Windows 与已安装语音包决定。

## DeepSeek 在线语音

DeepSeek 引擎调用 DeepSeek 官方 TTS API：

- 文档：<https://api-docs.deepseek.com/zh-cn/guides/tts/>
- 服务、音色、计费与数据处理适用 DeepSeek 的服务条款和隐私政策
- 本项目不内置任何 API Key；用户输入的 Key 仅保存在本机，并使用 Electron `safeStorage` 加密
- 使用 DeepSeek 时，待合成文本会发送到 `api.deepseek.com`

## 关于 edge-tts

本项目**没有**集成 `edge-tts` 或 Microsoft Edge「大声朗读」的非官方接口。该接口未公开，第三方客户端可能违反微软的服务条款；`edge-tts` 项目本身使用 GPLv3，也不适合直接并入 MIT 许可的桌面应用。需要在线神经音色时，本项目使用 DeepSeek 官方 API（用户自带 Key）；如需微软官方在线音色，可使用 Azure AI Speech 等有正式授权和 API Key 的服务。

## 合规提示

以上信息基于撰写时的上游许可。发布安装包、商业使用或再分发模型前，请再次核对上游项目的最新许可和署名要求。本文档不构成法律意见。
