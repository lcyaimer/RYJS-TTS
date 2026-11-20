import { join } from 'node:path'
import { MODEL_DEFINITIONS } from './model-manager.mjs'
import { SherpaTtsEngine } from './neural-engine.mjs'

const PIPER_VOICES = [
  {
    name: 'zh_CN-chaowen-medium',
    displayName: '超文',
    culture: 'zh-CN',
    gender: 'Male',
    description: 'Piper 中文男声',
    enabled: true,
    local: true,
    sid: 0
  }
]

export class PiperEngine extends SherpaTtsEngine {
  constructor({ modelsRoot }) {
    super({
      id: 'piper',
      name: 'Piper 神经语音',
      description: '本地 Piper 兼容中文模型（超文），首次使用需下载约 58 MB，下载后完全离线',
      modelsRoot,
      modelDefinition: MODEL_DEFINITIONS.piper,
      voices: PIPER_VOICES,
      buildModelConfig: (modelDir) => ({
        vits: {
          model: join(modelDir, 'zh_CN-chaowen-medium.onnx'),
          tokens: join(modelDir, 'tokens.txt'),
          lexicon: join(modelDir, 'lexicon.txt')
        }
      })
    })
  }
}
