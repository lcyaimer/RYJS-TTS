/**
 * 合成任务编排：
 * 切分文稿 → 逐段调用引擎 → 实时推送进度 → 合并为完整 WAV。
 * 长文默认分段；整篇模式失败时自动回退为分段合成。
 */

import fsp from 'node:fs/promises'
import { join } from 'node:path'
import {
  splitText,
  countChars,
  clampInt,
  DEFAULT_MAX_CHARS,
  MIN_MAX_CHARS,
  MAX_MAX_CHARS,
  MAX_TEXT_CHARS
} from '../../shared/text-splitter.mjs'
import { buildMediaUrl } from '../media-protocol.mjs'
import { engineManager, resolveVoice } from './engine-manager.mjs'
import { ensureCacheRoot, isValidJobId } from './cache.mjs'
import { mergeWavFiles, readWavInfo } from './wav.mjs'

const MAX_SEGMENT_ATTEMPTS = 2
const activeJobs = new Map()

export async function synthesizeJob(payload, sender) {
  const jobId = String(payload?.jobId || '')
  if (!isValidJobId(jobId)) throw new Error('无效的任务标识，请重试')
  if (activeJobs.has(jobId)) throw new Error('该合成任务已在运行')

  const text = String(payload?.text ?? '')
  if (!text.trim()) throw new Error('请先输入需要转换的文字')

  const chars = countChars(text)
  if (chars > MAX_TEXT_CHARS) {
    throw new Error(`文稿超过 ${MAX_TEXT_CHARS.toLocaleString()} 字上限，请分批转换`)
  }

  const options = normalizeOptions(payload?.options)
  const engine = engineManager.get(options.engineId)
  const controller = new AbortController()

  activeJobs.set(jobId, { controller, startedAt: Date.now() })

  try {
    return await runSynthesis({
      jobId,
      text,
      chars,
      options,
      engine,
      sender,
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) {
      sendProgress(sender, { jobId, phase: 'cancelled', message: '已取消合成' })
      return cancelledResult(jobId, chars, [], options.mode, false, null)
    }

    const message = toErrorMessage(error)
    sendProgress(sender, { jobId, phase: 'error', message })
    const result = baseResult({
      jobId,
      chars,
      segments: [],
      modeUsed: options.mode,
      fallbackApplied: false,
      voice: null
    })
    result.error = message
    return result
  } finally {
    activeJobs.delete(jobId)
  }
}

async function runSynthesis({ jobId, text, chars, options, engine, sender, signal }) {
  sendProgress(sender, {
    jobId,
    phase: 'preparing',
    current: 0,
    total: 0,
    message: '正在读取系统语音…'
  })

  const voice = await resolveVoice(engine, options.voiceName)
  await engine.assertReady?.()
  const root = await ensureCacheRoot()
  const jobDir = join(root, jobId)

  await fsp.rm(jobDir, { recursive: true, force: true })
  await fsp.mkdir(jobDir, { recursive: true })

  const engineMaxChars = Number(
    engine.maxCharsPerRequest || engine.descriptor?.capabilities?.maxCharsPerRequest || 0
  )
  const safeMaxChars =
    engineMaxChars > 0 ? Math.min(options.maxChars, engineMaxChars) : options.maxChars

  let modeUsed = options.mode
  let fallbackApplied = false
  let autoSplitMessage = ''
  let plans = splitText(text, { maxChars: safeMaxChars, mode: options.mode })

  if (options.mode === 'single' && engineMaxChars > 0 && chars > engineMaxChars) {
    modeUsed = 'auto'
    fallbackApplied = true
    autoSplitMessage = `文稿超过「${engine.name}」单次合成上限（${engineMaxChars} 字），已自动改为分段合成`
    plans = splitText(text, { maxChars: safeMaxChars, mode: 'auto' })
  }

  let total = plans.length
  let index = 0
  const segments = []

  if (!total) {
    const error = new Error('没有可转换的文字内容')
    sendProgress(sender, { jobId, phase: 'error', message: error.message })
    const result = baseResult({ jobId, chars, segments, modeUsed, fallbackApplied, voice })
    result.error = error.message
    return result
  }

  sendProgress(sender, {
    jobId,
    phase: 'preparing',
    current: 0,
    total,
    message: modeUsed === 'single' ? '正在准备整篇合成…' : `已切分为 ${total} 段，准备合成`
  })

  if (autoSplitMessage) {
    sendProgress(sender, {
      jobId,
      phase: 'fallback',
      current: 0,
      total,
      message: autoSplitMessage
    })
  }

  while (index < plans.length) {
    if (signal.aborted) {
      return cancelledResult(jobId, chars, segments, modeUsed, fallbackApplied, voice, sender)
    }

    const number = index + 1
    const paddedNumber = String(number).padStart(4, '0')
    const fileName = `seg-${paddedNumber}.wav`
    const textFileName = `seg-${paddedNumber}.txt`
    const outFile = join(jobDir, fileName)
    const textFile = join(jobDir, textFileName)
    const segmentText = plans[index]

    sendProgress(sender, {
      jobId,
      phase: 'synthesizing',
      current: number,
      total,
      message: `正在合成第 ${number} / ${total} 段`
    })

    let segment = null
    let lastError = null

    for (let attempt = 1; attempt <= MAX_SEGMENT_ATTEMPTS; attempt += 1) {
      if (signal.aborted) {
        return cancelledResult(jobId, chars, segments, modeUsed, fallbackApplied, voice, sender)
      }

      try {
        await fsp.writeFile(textFile, segmentText, 'utf8')
        await engine.synthesize({
          text: segmentText,
          textFile,
          outFile,
          voiceName: voice.name,
          rate: options.rate,
          volume: options.volume,
          signal
        })

        const info = await readWavInfo(outFile)
        if (!info.dataSize) throw new Error('生成的音频为空')

        segment = {
          index: number,
          text: segmentText,
          charCount: countChars(segmentText),
          fileName,
          textFileName,
          url: buildMediaUrl(jobId, fileName),
          duration: info.duration,
          status: 'done'
        }
        break
      } catch (error) {
        if (signal.aborted) {
          return cancelledResult(jobId, chars, segments, modeUsed, fallbackApplied, voice, sender)
        }
        lastError = error
        if (attempt < MAX_SEGMENT_ATTEMPTS) await delay(350)
      }
    }

    if (!segment) {
      // 整篇模式失败 → 自动切换为分段模式重试
      if (modeUsed === 'single' && !fallbackApplied) {
        fallbackApplied = true
        modeUsed = 'auto'
        plans = splitText(text, { maxChars: safeMaxChars, mode: 'auto' })
        total = plans.length
        index = 0
        segments.length = 0

        await fsp.rm(jobDir, { recursive: true, force: true })
        await fsp.mkdir(jobDir, { recursive: true })

        sendProgress(sender, {
          jobId,
          phase: 'fallback',
          current: 0,
          total,
          message: `整篇合成未成功，已自动改为分段合成（共 ${total} 段）`
        })
        continue
      }

      const detail = toErrorMessage(lastError)
      const message = total === 1
        ? `语音合成失败：${detail}`
        : `第 ${number} 段合成失败：${detail}`

      sendProgress(sender, { jobId, phase: 'error', current: index, total, message })
      const result = baseResult({ jobId, chars, segments, modeUsed, fallbackApplied, voice })
      result.error = message
      return result
    }

    segments.push(segment)
    sendSegment(sender, {
      jobId,
      segment,
      completed: segments.length,
      total
    })
    sendProgress(sender, {
      jobId,
      phase: 'synthesizing',
      current: number,
      total,
      message: `已完成 ${number} / ${total} 段`
    })

    index += 1
  }

  if (signal.aborted) {
    return cancelledResult(jobId, chars, segments, modeUsed, fallbackApplied, voice, sender)
  }

  sendProgress(sender, {
    jobId,
    phase: 'merging',
    current: total,
    total,
    message: '正在合并完整音频…'
  })

  const outputFile = join(jobDir, 'output.wav')

  try {
    const merged = await mergeWavFiles(
      segments.map((item) => join(jobDir, item.fileName)),
      outputFile,
      { gapMs: options.gapMs, signal }
    )

    const outputInfo = await readWavInfo(outputFile)
    if (!outputInfo.dataSize) throw new Error('合并后的音频为空')

    const result = baseResult({
      jobId,
      chars,
      segments,
      modeUsed,
      fallbackApplied,
      voice
    })

    Object.assign(result, {
      ok: true,
      error: '',
      outputUrl: buildMediaUrl(jobId, 'output.wav'),
      outputFileName: 'output.wav',
      totalDuration: merged.duration || outputInfo.duration,
      segmentCount: segments.length,
      createdAt: Date.now()
    })

    await writeMeta(jobDir, {
      jobId,
      createdAt: result.createdAt,
      text,
      options,
      voice,
      modeUsed,
      fallbackApplied,
      segments: segments.map((item) => ({
        index: item.index,
        fileName: item.fileName,
        charCount: item.charCount,
        duration: item.duration
      })),
      outputFileName: 'output.wav',
      totalDuration: result.totalDuration
    })

    sendProgress(sender, {
      jobId,
      phase: 'done',
      current: total,
      total,
      message: '合成完成'
    })

    return result
  } catch (error) {
    if (signal.aborted) {
      return cancelledResult(jobId, chars, segments, modeUsed, fallbackApplied, voice, sender)
    }

    const message = `合并音频失败：${toErrorMessage(error)}`
    sendProgress(sender, { jobId, phase: 'error', message })
    const result = baseResult({ jobId, chars, segments, modeUsed, fallbackApplied, voice })
    result.error = message
    return result
  }
}

function normalizeOptions(raw = {}) {
  return {
    engineId: typeof raw.engineId === 'string' && raw.engineId ? raw.engineId : 'sapi',
    voiceName: typeof raw.voiceName === 'string' ? raw.voiceName : '',
    rate: clampInt(raw.rate, -10, 10, 0),
    volume: clampInt(raw.volume, 0, 100, 100),
    mode: raw.mode === 'single' ? 'single' : 'auto',
    maxChars: clampInt(raw.maxChars, MIN_MAX_CHARS, MAX_MAX_CHARS, DEFAULT_MAX_CHARS),
    gapMs: clampInt(raw.gapMs, 0, 3000, 300)
  }
}

function baseResult({ jobId, chars, segments, modeUsed, fallbackApplied, voice }) {
  return {
    ok: false,
    cancelled: false,
    jobId,
    error: '',
    segments,
    outputUrl: null,
    outputFileName: null,
    totalDuration: 0,
    chars,
    segmentCount: segments.length,
    modeUsed,
    fallbackApplied,
    voice: voice
      ? { name: voice.name, culture: voice.culture, gender: voice.gender }
      : null,
    createdAt: Date.now()
  }
}

function cancelledResult(jobId, chars, segments, modeUsed, fallbackApplied, voice, sender) {
  if (sender) {
    sendProgress(sender, {
      jobId,
      phase: 'cancelled',
      current: segments.length,
      message: '已取消合成'
    })
  }
  const result = baseResult({ jobId, chars, segments, modeUsed, fallbackApplied, voice })
  result.cancelled = true
  result.error = ''
  return result
}

function sendProgress(sender, payload) {
  try {
    if (sender && !sender.isDestroyed()) sender.send('tts:progress', payload)
  } catch {
    // 窗口已关闭时忽略
  }
}

function sendSegment(sender, payload) {
  try {
    if (sender && !sender.isDestroyed()) sender.send('tts:segment', payload)
  } catch {
    // 窗口已关闭时忽略
  }
}

async function writeMeta(jobDir, meta) {
  try {
    await fsp.writeFile(join(jobDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  } catch {
    // meta 仅用于排查和后续扩展，写入失败不影响合成结果
  }
}

export function cancelJob(jobId) {
  if (!isValidJobId(jobId)) return { ok: false, message: '无效的任务标识' }
  const job = activeJobs.get(jobId)
  if (!job) return { ok: false, message: '任务已结束或不存在' }
  job.controller.abort()
  return { ok: true }
}

export function cancelAllJobs() {
  for (const job of activeJobs.values()) {
    try {
      job.controller.abort()
    } catch {
      // ignore
    }
  }
}

export function hasActiveJobs() {
  return activeJobs.size > 0
}

function toErrorMessage(error) {
  const message = String(error?.message || error || '').trim()
  return message || '未知错误'
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
