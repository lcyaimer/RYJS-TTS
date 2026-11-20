/**
 * 本地神经语音引擎基类（Sherpa-ONNX）。
 * 使用 Apache-2.0 的 sherpa-onnx-node 推理；模型由用户在应用内下载。
 */

import fsp from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import {
  downloadModelPackage,
  getModelDir,
  getModelStatus,
  modelPublicInfo
} from './model-manager.mjs'
import { normalizeForNeuralTts } from './neural-text.mjs'
import { createAbortError } from './powershell.mjs'

const require = createRequire(import.meta.url)
let sherpaModule = null

function getSherpa() {
  if (sherpaModule) return sherpaModule

  try {
    sherpaModule = require('sherpa-onnx-node')
    return sherpaModule
  } catch (error) {
    throw new Error(`无法加载本地神经语音组件：${error?.message || error}`)
  }
}

export class SherpaTtsEngine {
  constructor({
    id,
    name,
    description,
    modelsRoot,
    modelDefinition,
    voices,
    buildModelConfig
  }) {
    this.id = id
    this.name = name
    this.description = description
    this.local = true
    this.modelsRoot = modelsRoot
    this.modelDefinition = modelDefinition
    this.voices = voices
    this.buildModelConfig = buildModelConfig
    this.tts = null
    this.ttsPromise = null
    this.downloading = false
    this.downloadController = null
    this.queue = Promise.resolve()
    this.maxCharsPerRequest = 2000
  }

  get descriptor() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      local: this.local,
      outputFormat: 'wav',
      requiresModel: true,
      model: modelPublicInfo(this.modelDefinition),
      capabilities: {
        speed: true,
        volume: true,
        maxCharsPerRequest: 2000,
        neural: true
      }
    }
  }

  async listVoices() {
    return this.voices.map((voice) => ({ ...voice }))
  }

  async getStatus() {
    const status = await getModelStatus(this.modelsRoot, this.modelDefinition)
    return {
      ...status,
      downloading: this.downloading,
      ready: status.ready && !this.downloading
    }
  }

  async assertReady() {
    if (this.downloading) throw new Error('语音模型正在下载，请稍候')
    const status = await getModelStatus(this.modelsRoot, this.modelDefinition)
    if (!status.ready) {
      throw new Error(`「${this.modelDefinition.name}」尚未下载，请先在左侧完成模型下载`)
    }
  }

  async downloadModel(sender) {
    if (this.downloading) throw new Error('模型正在下载，请稍候')

    const controller = new AbortController()
    this.downloading = true
    this.downloadController = controller

    const emitProgress = (payload) => {
      try {
        if (sender && !sender.isDestroyed()) {
          sender.send('tts:model-progress', { engineId: this.id, ...payload })
        }
      } catch {
        // 窗口关闭时忽略
      }
    }

    try {
      const status = await downloadModelPackage({
        modelsRoot: this.modelsRoot,
        definition: this.modelDefinition,
        signal: controller.signal,
        onProgress: emitProgress
      })

      this.reset()
      return { ok: true, status }
    } finally {
      this.downloading = false
      this.downloadController = null
    }
  }

  cancelDownload() {
    if (!this.downloading || !this.downloadController) return { ok: false }
    this.downloadController.abort()
    return { ok: true }
  }

  async synthesize({ text, outFile, voiceName, rate = 0, volume = 100, signal }) {
    if (!outFile) throw new Error('缺少合成所需的输出路径')
    if (!text || !String(text).trim()) throw new Error('待合成的文字为空')
    if (String(text).length > this.maxCharsPerRequest) {
      throw new Error(`单段文字超过神经引擎上限（${this.maxCharsPerRequest} 字），请使用自动分段`)
    }
    if (this.downloading) throw new Error('语音模型正在下载，请下载完成后再试')
    if (signal?.aborted) throw createAbortError()

    const status = await getModelStatus(this.modelsRoot, this.modelDefinition)
    if (!status.ready) {
      throw new Error(`「${this.modelDefinition.name}」尚未下载，请先在左侧完成模型下载`)
    }

    const normalizedText = normalizeForNeuralTts(text)
    if (!normalizedText.trim()) throw new Error('没有可合成的文字内容')

    const voice = this.voices.find((item) => item.name === voiceName) || this.voices[0]
    const safeRate = Math.max(-10, Math.min(10, Math.round(Number(rate) || 0)))
    const speed = safeRate >= 0 ? 1 + safeRate * 0.15 : Math.max(0.5, 1 + safeRate * 0.06)
    const gain = Math.max(0, Math.min(100, Math.round(Number(volume) ?? 100))) / 100

    return this.runExclusive(async () => {
      if (signal?.aborted) throw createAbortError()

      const sherpa = getSherpa()
      const tts = await this.ensureTts(sherpa, signal)

      if (signal?.aborted) throw createAbortError()

      let stopped = false
      let audio = null

      try {
        audio = await tts.generateAsync({
          text: normalizedText,
          // Electron 的 V8 不允许返回外部 ArrayBuffer，必须让 addon 复制音频数据
          enableExternalBuffer: false,
          generationConfig: new sherpa.GenerationConfig({
            sid: Number.isInteger(voice.sid) ? voice.sid : 0,
            speed,
            silenceScale: 0.2
          }),
          onProgress: () => {
            if (signal?.aborted) {
              stopped = true
              return 0
            }
            return 1
          }
        })
      } catch (error) {
        if (signal?.aborted || stopped) throw createAbortError()
        throw new Error(`${this.name} 合成失败：${error?.message || error}`)
      }

      if (stopped || signal?.aborted) throw createAbortError()
      if (!audio?.samples?.length || !audio.sampleRate) {
        throw new Error(`${this.name} 没有生成有效的音频数据`)
      }

      if (gain !== 1) {
        for (let index = 0; index < audio.samples.length; index += 1) {
          audio.samples[index] *= gain
        }
      }

      await fsp.mkdir(dirname(outFile), { recursive: true }).catch(() => {})
      const written = sherpa.writeWave(outFile, {
        samples: audio.samples,
        sampleRate: audio.sampleRate
      })

      if (!written) throw new Error('写入音频文件失败')
      if (signal?.aborted) {
        await fsp.rm(outFile, { force: true }).catch(() => {})
        throw createAbortError()
      }

      const stat = await fsp.stat(outFile).catch(() => null)
      if (!stat || stat.size <= 44) throw new Error('生成的音频文件为空')

      return { file: outFile, bytes: stat.size }
    })
  }

  reset() {
    this.tts = null
    this.ttsPromise = null
  }

  setModelsRoot(modelsRoot) {
    if (!modelsRoot || modelsRoot === this.modelsRoot) return
    this.modelsRoot = modelsRoot
    this.reset()
  }

  async ensureTts(sherpa, signal) {
    if (this.tts) return this.tts
    if (this.ttsPromise) return this.ttsPromise

    const modelDir = getModelDir(this.modelsRoot, this.id)
    const config = {
      model: this.buildModelConfig(modelDir),
      maxNumSentences: 1,
      numThreads: 2
    }

    this.ttsPromise = sherpa.OfflineTts.createAsync(config)
      .then((tts) => {
        if (signal?.aborted) throw createAbortError()
        this.tts = tts
        return tts
      })
      .finally(() => {
        this.ttsPromise = null
      })

    return this.ttsPromise
  }

  runExclusive(task) {
    const result = this.queue.then(task, task)
    this.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
