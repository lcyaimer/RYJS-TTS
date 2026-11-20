/**
 * 声音试听：用当前语音 / 语速 / 音量合成一句示例。
 * 同一组参数会复用缓存文件，避免重复合成。
 */

import { createHash, randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import { join } from 'node:path'
import { clampInt } from '../../shared/text-splitter.mjs'
import { buildMediaUrl } from '../media-protocol.mjs'
import { engineManager, resolveVoice } from './engine-manager.mjs'
import { ensureCacheRoot } from './cache.mjs'
import { readWavInfo } from './wav.mjs'

const inflight = new Map()

export async function previewVoice(payload = {}) {
  const engineId = typeof payload.engineId === 'string' && payload.engineId ? payload.engineId : 'sapi'
  const engine = engineManager.get(engineId)
  const voice = await resolveVoice(
    engine,
    typeof payload.voiceName === 'string' ? payload.voiceName : ''
  )

  const rate = clampInt(payload.rate, -10, 10, 0)
  const volume = clampInt(payload.volume, 0, 100, 100)
  const sample = sampleForCulture(voice.culture)

  const hash = createHash('sha1')
    .update([engineId, voice.name, rate, volume, sample].join('|'))
    .digest('hex')
    .slice(0, 16)

  const fileName = `preview-${hash}.wav`
  const root = await ensureCacheRoot()
  const dir = join(root, 'preview')
  await fsp.mkdir(dir, { recursive: true })

  const target = join(dir, fileName)
  const existingInfo = await readExisting(target)
  if (existingInfo) {
    return buildResult(fileName, existingInfo.duration, sample, voice)
  }

  if (inflight.has(hash)) return inflight.get(hash)

  const pending = (async () => {
    const textFile = join(dir, `preview-${hash}.txt`)
    const tempFile = join(dir, `preview-${hash}-${randomUUID().slice(0, 8)}.wav`)

    try {
      await fsp.writeFile(textFile, sample, 'utf8')
      await engine.synthesize({
        text: sample,
        textFile,
        outFile: tempFile,
        voiceName: voice.name,
        rate,
        volume
      })

      const info = await readWavInfo(tempFile)
      if (!info.dataSize) throw new Error('试听音频为空')

      await fsp.rm(target, { force: true }).catch(() => {})
      await fsp.rename(tempFile, target)

      return buildResult(fileName, info.duration, sample, voice)
    } finally {
      await fsp.rm(tempFile, { force: true }).catch(() => {})
    }
  })().finally(() => {
    inflight.delete(hash)
  })

  inflight.set(hash, pending)
  return pending
}

async function readExisting(filePath) {
  try {
    const stat = await fsp.stat(filePath)
    if (stat.size <= 44) return null
    const info = await readWavInfo(filePath)
    return info.dataSize > 0 ? info : null
  } catch {
    return null
  }
}

function buildResult(fileName, duration, text, voice) {
  return {
    url: buildMediaUrl('preview', fileName),
    fileName,
    duration,
    text,
    voice: {
      name: voice.name,
      culture: voice.culture,
      gender: voice.gender
    }
  }
}

function sampleForCulture(culture) {
  const value = String(culture || '').toLowerCase()

  if (value.startsWith('zh')) {
    return '你好，我是当前选择的声音。这是一段试听，用来确认语速和音量是否合适。'
  }
  if (value.startsWith('ja')) {
    return 'こんにちは。これは選択した声のプレビューです。'
  }
  if (value.startsWith('ko')) {
    return '안녕하세요. 선택한 목소리의 미리듣기입니다.'
  }
  if (value.startsWith('de')) {
    return 'Hallo! Dies ist eine Vorschau der ausgewählten Stimme.'
  }
  if (value.startsWith('fr')) {
    return 'Bonjour ! Voici un aperçu de la voix sélectionnée.'
  }
  if (value.startsWith('es')) {
    return '¡Hola! Esta es una vista previa de la voz seleccionada.'
  }
  return 'Hello! This is a preview of the selected voice. Adjust the speed and volume to your liking.'
}
