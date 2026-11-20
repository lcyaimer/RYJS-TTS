/**
 * DeepSeek 官方在线语音合成。
 * API 文档：https://api-docs.deepseek.com/zh-cn/guides/tts/
 * 需要用户自己的 API Key；文本会发送到 DeepSeek，并按字符计费。
 */

import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createAbortError } from './powershell.mjs'
import { readWavInfo, scaleWavVolume } from './wav.mjs'

const DEEPSEEK_TTS_URL = 'https://api.deepseek.com/v1/tools/tts'
const MAX_BILLED_CHARS = 10_000
const MAX_BODY_BYTES = 64 * 1024
const REQUEST_TIMEOUT = 30 * 60_000

const DEEPSEEK_VOICES = [
  {
    name: 'stella',
    displayName: '海星',
    culture: 'zh-CN',
    gender: 'Female',
    description: 'DeepSeek 女声 · 默认 · 自动识别语种',
    enabled: true,
    local: false
  },
  {
    name: 'tide',
    displayName: '暗潮',
    culture: 'zh-CN',
    gender: 'Male',
    description: 'DeepSeek 男声 · 自动识别语种',
    enabled: true,
    local: false
  }
]

export class DeepSeekTtsEngine {
  constructor(options = {}) {
    this.id = 'deepseek'
    this.name = 'DeepSeek 在线语音'
    this.description = 'DeepSeek 官方 TTS，海星 / 暗潮两种音色；需要 API Key，文本会上传并计费'
    this.local = false
    this.online = true
    this.maxCharsPerRequest = 4500
    this.ttsUrl = options.ttsUrl || DEEPSEEK_TTS_URL
    this.getApiKey = options.getApiKey || (() => '')
    this.getKeyStatus = options.getKeyStatus || (async () => ({ hasKey: false }))
    this.voices = DEEPSEEK_VOICES
  }

  get descriptor() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      local: this.local,
      online: this.online,
      outputFormat: 'wav',
      requiresApiKey: true,
      apiKeyProvider: 'deepseek',
      capabilities: {
        speed: false,
        volume: true,
        maxCharsPerRequest: this.maxCharsPerRequest,
        online: true
      }
    }
  }

  async listVoices() {
    return this.voices.map((voice) => ({ ...voice }))
  }

  async getStatus() {
    const status = await this.getKeyStatus()
    return {
      engineId: this.id,
      ready: Boolean(status?.hasKey),
      requiresApiKey: true,
      hasKey: Boolean(status?.hasKey),
      persisted: Boolean(status?.persisted),
      source: status?.source || '',
      encryptionAvailable: Boolean(status?.encryptionAvailable),
      downloading: false
    }
  }

  async assertReady() {
    const status = await this.getKeyStatus()
    if (!status?.hasKey) {
      throw new Error('请先在左侧填写 DeepSeek API Key')
    }
  }

  async testConnection() {
    const outFile = join(tmpdir(), `ryjs-deepseek-test-${randomUUID()}.wav`)

    try {
      await this.synthesize({
        text: '你好',
        outFile,
        voiceName: 'stella',
        volume: 100
      })
      return { ok: true }
    } finally {
      await fsp.rm(outFile, { force: true }).catch(() => {})
    }
  }

  async synthesize({ text, outFile, voiceName, rate = 0, volume = 100, signal }) {
    if (!outFile) throw new Error('缺少合成所需的输出路径')
    if (!text || !String(text).trim()) throw new Error('待合成的文字为空')
    if (signal?.aborted) throw createAbortError()

    const key = String(this.getApiKey() || '').trim()
    if (!key) throw new Error('请先在左侧填写 DeepSeek API Key')

    const cleanText = String(text)
    const billed = countBilledChars(cleanText)
    if (billed > MAX_BILLED_CHARS) {
      throw new Error(`单段文本超过 DeepSeek 上限（${MAX_BILLED_CHARS} 计费字符）`)
    }

    const voiceId = this.voices.some((voice) => voice.name === voiceName)
      ? voiceName
      : this.voices[0].name
    const body = JSON.stringify({
      text: cleanText,
      voice_id: voiceId,
      format: 'wav',
      filter_markdown: true
    })

    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      throw new Error('单段文本超过 DeepSeek 请求体上限（64 KiB）')
    }

    const controller = new AbortController()
    let timedOut = false
    const abort = () => controller.abort()
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, REQUEST_TIMEOUT)

    signal?.addEventListener('abort', abort, { once: true })
    await fsp.mkdir(dirname(outFile), { recursive: true }).catch(() => {})

    try {
      let response
      try {
        response = await fetch(this.ttsUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Accept: 'audio/wav'
          },
          body,
          signal: controller.signal
        })
      } catch (error) {
        if (signal?.aborted) throw createAbortError()
        if (timedOut) throw new Error('DeepSeek 语音合成超时，请缩短单段文字后重试')
        throw new Error(`无法连接 DeepSeek：${error?.message || error}`)
      }

      if (!response.ok) {
        throw await buildResponseError(response)
      }

      if (!response.body) {
        throw new Error('DeepSeek 没有返回音频数据')
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase()
      if (contentType.includes('application/json')) {
        const payload = await response.text().catch(() => '')
        throw new Error(`DeepSeek 返回异常：${extractErrorDetail(payload) || '不是音频数据'}`)
      }

      try {
        await pipeline(
          Readable.fromWeb(response.body),
          createWriteStream(outFile),
          { signal: controller.signal }
        )
      } catch (error) {
        if (signal?.aborted) throw createAbortError()
        if (timedOut) throw new Error('DeepSeek 语音合成超时，请缩短单段文字后重试')
        throw new Error(`下载 DeepSeek 音频失败：${error?.message || error}`)
      }

      if (signal?.aborted) throw createAbortError()

      let info
      try {
        info = await readWavInfo(outFile)
      } catch {
        throw new Error('DeepSeek 返回的音频格式不是有效的 WAV')
      }

      if (!info.dataSize) throw new Error('DeepSeek 返回的音频为空')

      const gain = Math.max(0, Math.min(100, Math.round(Number(volume) ?? 100))) / 100
      await scaleWavVolume(outFile, gain)

      const stat = await fsp.stat(outFile)
      return { file: outFile, bytes: stat.size }
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) {
        await fsp.rm(outFile, { force: true }).catch(() => {})
        throw createAbortError()
      }
      await fsp.rm(outFile, { force: true }).catch(() => {})
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}

function countBilledChars(text) {
  let total = 0
  for (const char of String(text)) {
    const code = char.codePointAt(0)
    const isChinese =
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff)
    total += isChinese ? 2 : 1
  }
  return total
}

async function buildResponseError(response) {
  const raw = await response.text().catch(() => '')
  const detail = extractErrorDetail(raw)

  switch (response.status) {
    case 400:
      return new Error(
        detail && /content|risk|审核/i.test(detail)
          ? `文本未通过 DeepSeek 内容审核：${detail}`
          : `DeepSeek 无法合成本段文字${detail ? `：${detail}` : ''}`
      )
    case 401:
      return new Error('DeepSeek API Key 无效或已过期，请检查后重试')
    case 402:
      return new Error('DeepSeek 账户余额不足，请充值后重试')
    case 403:
      return new Error('DeepSeek 拒绝访问，请检查 API Key 权限')
    case 429:
      return new Error('DeepSeek 请求过于频繁，请稍后再试')
    case 503:
    case 504:
      return new Error('DeepSeek 服务繁忙或合成超时，请稍后重试')
    default:
      return new Error(
        `DeepSeek 请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`
      )
  }
}

function extractErrorDetail(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''

  try {
    const data = JSON.parse(text)
    return String(
      data?.error?.message ||
        data?.message ||
        data?.error?.code ||
        data?.code ||
        ''
    ).slice(0, 240)
  } catch {
    return text.replace(/\s+/g, ' ').slice(0, 240)
  }
}
