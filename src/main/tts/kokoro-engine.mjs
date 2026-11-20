import { join } from 'node:path'
import { MODEL_DEFINITIONS } from './model-manager.mjs'
import { SherpaTtsEngine } from './neural-engine.mjs'

const KOKORO_VOICES = [
  ['zf_xiaobei', '小北', 'Female', 45],
  ['zf_xiaoni', '小妮', 'Female', 46],
  ['zf_xiaoxiao', '小晓', 'Female', 47],
  ['zf_xiaoyi', '小艺', 'Female', 48],
  ['zm_yunjian', '云健', 'Male', 49],
  ['zm_yunxi', '云希', 'Male', 50],
  ['zm_yunxia', '云夏', 'Male', 51],
  ['zm_yunyang', '云扬', 'Male', 52]
].map(([name, displayName, gender, sid]) => ({
  name,
  displayName,
  culture: 'zh-CN',
  gender,
  description: `Kokoro 中文${gender === 'Female' ? '女' : '男'}声`,
  enabled: true,
  local: true,
  sid
}))

export class KokoroEngine extends SherpaTtsEngine {
  constructor({ modelsRoot }) {
    super({
      id: 'kokoro',
      name: 'Kokoro 神经语音',
      description: '本地 Kokoro-82M 中文模型，8 种音色，首次使用需下载约 334 MB，下载后完全离线',
      modelsRoot,
      modelDefinition: MODEL_DEFINITIONS.kokoro,
      voices: KOKORO_VOICES,
      buildModelConfig: (modelDir) => ({
        kokoro: {
          model: join(modelDir, 'model.onnx'),
          voices: join(modelDir, 'voices.bin'),
          tokens: join(modelDir, 'tokens.txt'),
          lexicon: [
            join(modelDir, 'lexicon-us-en.txt'),
            join(modelDir, 'lexicon-zh.txt')
          ].join(',')
        }
      })
    })
  }
}
