/**
 * Windows 更多语音引擎（OneCore / WinRT）
 * - 与 Edge、讲述人、浏览器 Web Speech API 使用同一套系统本地语音
 * - 通常比经典 SAPI 多出更多中文音色
 * - 直接输出 WAV，完全离线，可复用分段、试听、合并与下载流程
 */

import fsp from 'node:fs/promises'
import { join } from 'node:path'
import { ONECORE_VOICES_SCRIPT, ONECORE_SYNTH_SCRIPT } from './onecore-scripts.mjs'
import {
  SCRIPT_TIMEOUT,
  cleanPowerShellError,
  createAbortError,
  runPowerShell,
  writeScriptIfChanged
} from './powershell.mjs'

const VOICE_LIST_TIMEOUT = 30_000

export class OneCoreEngine {
  constructor({ runtimeDir }) {
    this.id = 'onecore'
    this.name = 'Windows 更多语音'
    this.description = 'OneCore 引擎，与浏览器本地朗读同源；通常有更多中文音色，完全离线且可导出 WAV'
    this.local = true
    this.runtimeDir = runtimeDir
    this.voicesCache = null
    this.voicesPromise = null
    this.scriptsReady = null
  }

  get descriptor() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      local: this.local,
      outputFormat: 'wav',
      capabilities: {
        speed: true,
        volume: true,
        maxCharsPerRequest: 5000
      }
    }
  }

  async listVoices(force = false) {
    if (this.voicesCache && !force) return this.voicesCache
    if (this.voicesPromise) return this.voicesPromise

    this.voicesPromise = this.loadVoices().finally(() => {
      this.voicesPromise = null
    })

    return this.voicesPromise
  }

  async loadVoices() {
    await this.ensureScripts()
    const voicesFile = join(this.runtimeDir, `onecore-voices-${process.pid}-${Date.now()}.json`)

    try {
      await runPowerShell(this.voicesScript, ['-OutFile', voicesFile], {
        timeoutMs: VOICE_LIST_TIMEOUT,
        timeoutMessage: '读取 OneCore 语音列表超时，请重试或重启应用'
      })

      const raw = await fsp.readFile(voicesFile, 'utf8')
      const parsed = JSON.parse(raw)
      const list = (Array.isArray(parsed) ? parsed : [parsed])
        .filter(Boolean)
        .map((voice) => ({
          name: String(voice.name || ''),
          culture: String(voice.culture || ''),
          gender: String(voice.gender || ''),
          description: String(voice.description || ''),
          enabled: voice.enabled !== false,
          local: true
        }))
        .filter((voice) => voice.name)

      if (!list.length) {
        throw new Error('未检测到 OneCore 语音，请在 Windows 设置中安装更多语音')
      }

      this.voicesCache = list
      return list
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      const message = cleanPowerShellError(error?.message)
      throw new Error(message || '读取 Windows OneCore 语音失败')
    } finally {
      await fsp.rm(voicesFile, { force: true }).catch(() => {})
    }
  }

  async synthesize({ text, textFile, outFile, voiceName, rate = 0, volume = 100, signal }) {
    if (!textFile || !outFile) throw new Error('缺少合成所需的文本或输出路径')
    if (!text || !String(text).trim()) throw new Error('待合成的文字为空')
    if (signal?.aborted) throw createAbortError()

    await this.ensureScripts()
    await fsp.rm(outFile, { force: true }).catch(() => {})

    const safeRate = Math.max(-10, Math.min(10, Math.round(Number(rate) || 0)))
    const safeVolume = Math.max(0, Math.min(100, Math.round(Number(volume) ?? 100)))

    try {
      await runPowerShell(
        this.synthScript,
        [
          '-TextFile', textFile,
          '-OutFile', outFile,
          '-VoiceName', voiceName || '',
          '-Rate', String(safeRate),
          '-Volume', String(safeVolume)
        ],
        {
          signal,
          timeoutMs: SCRIPT_TIMEOUT,
          timeoutMessage: '单段语音合成超时，请缩短单段上限或降低文稿长度后重试'
        }
      )
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw createAbortError()
      const detail = cleanPowerShellError(error?.message)
      throw new Error(detail ? `OneCore 语音合成失败：${detail}` : 'OneCore 语音合成失败')
    }

    const stat = await fsp.stat(outFile).catch(() => null)
    if (!stat || stat.size <= 44) {
      await fsp.rm(outFile, { force: true }).catch(() => {})
      throw new Error('OneCore 语音没有生成有效的音频文件')
    }

    return { file: outFile, bytes: stat.size }
  }

  async ensureScripts() {
    if (this.scriptsReady) {
      await this.scriptsReady
      return
    }

    this.scriptsReady = (async () => {
      await fsp.mkdir(this.runtimeDir, { recursive: true })
      this.synthScript = join(this.runtimeDir, 'onecore-synthesize.ps1')
      this.voicesScript = join(this.runtimeDir, 'onecore-list-voices.ps1')

      await Promise.all([
        writeScriptIfChanged(this.synthScript, ONECORE_SYNTH_SCRIPT),
        writeScriptIfChanged(this.voicesScript, ONECORE_VOICES_SCRIPT)
      ])
    })()

    try {
      await this.scriptsReady
    } catch (error) {
      this.scriptsReady = null
      throw error
    }
  }
}
