import { PiperEngine } from './piper-engine.mjs'
import { KokoroEngine } from './kokoro-engine.mjs'
import { DeepSeekTtsEngine } from './deepseek-engine.mjs'
import { SapiEngine } from './sapi-engine.mjs'
import { OneCoreEngine } from './onecore-engine.mjs'
import { ensureModelsRoot, ensureRuntimeDir } from './cache.mjs'
import { cleanupModelTempDirs } from './model-manager.mjs'
import { getDeepSeekKey, getDeepSeekStatus } from '../deepseek-config.mjs'

class EngineManager {
  constructor() {
    this.engines = new Map()
  }

  register(engine) {
    if (!engine?.id) throw new Error('语音引擎缺少 id')
    this.engines.set(engine.id, engine)
  }

  get(engineId) {
    const id = engineId || 'sapi'
    const engine = this.engines.get(id)
    if (!engine) throw new Error(`未找到语音引擎「${id}」`)
    return engine
  }

  descriptors() {
    return [...this.engines.values()].map((engine) => engine.descriptor)
  }

  cancelAllDownloads() {
    for (const engine of this.engines.values()) {
      try {
        engine.cancelDownload?.()
      } catch {
        // ignore
      }
    }
  }

  hasActiveDownloads() {
    for (const engine of this.engines.values()) {
      if (engine.downloading) return true
    }
    return false
  }

  setModelsRoot(modelsRoot) {
    for (const engine of this.engines.values()) {
      try {
        engine.setModelsRoot?.(modelsRoot)
      } catch {
        // ignore
      }
    }
  }
}

export const engineManager = new EngineManager()

export async function initEngines() {
  const runtimeDir = await ensureRuntimeDir()
  const modelsRoot = await ensureModelsRoot()
  await cleanupModelTempDirs(modelsRoot)

  engineManager.register(new PiperEngine({ modelsRoot }))
  engineManager.register(new KokoroEngine({ modelsRoot }))
  engineManager.register(
    new DeepSeekTtsEngine({
      getApiKey: getDeepSeekKey,
      getKeyStatus: getDeepSeekStatus
    })
  )

  if (process.platform === 'win32') {
    engineManager.register(new OneCoreEngine({ runtimeDir }))
    engineManager.register(new SapiEngine({ runtimeDir }))
  }
}

export async function resolveVoice(engine, requestedName) {
  const voices = await engine.listVoices()
  const available = voices.filter((voice) => voice.enabled !== false)

  if (!available.length) {
    throw new Error('未检测到可用的系统语音，请在 Windows 设置中安装语音后重试')
  }

  const exact = requestedName ? available.find((voice) => voice.name === requestedName) : null
  const chinese = available.find((voice) => String(voice.culture || '').toLowerCase().startsWith('zh'))
  const english = available.find((voice) => String(voice.culture || '').toLowerCase().startsWith('en'))

  return exact || chinese || english || available[0]
}
