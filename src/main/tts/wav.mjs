/**
 * 极简 WAV 工具：解析 PCM WAV 头、按顺序合并多段音频。
 * 只依赖 Node 内置模块，生成的合并音频为 16-bit PCM WAV。
 */

import { createReadStream, createWriteStream } from 'node:fs'
import fsp from 'node:fs/promises'
import { pipeline, finished } from 'node:stream/promises'

const HEADER_PROBE_BYTES = 256 * 1024

export class WavError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WavError'
  }
}

export async function readWavInfo(filePath) {
  const handle = await fsp.open(filePath, 'r')
  try {
    const stat = await handle.stat()
    if (stat.size < 44) throw new WavError('音频文件不完整')

    const probeSize = Math.min(stat.size, HEADER_PROBE_BYTES)
    const buffer = Buffer.alloc(probeSize)
    await handle.read(buffer, 0, probeSize, 0)

    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
      throw new WavError('不是有效的 WAV 音频文件')
    }

    let offset = 12
    let format = null
    let data = null

    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString('ascii', offset, offset + 4)
      const chunkSize = buffer.readUInt32LE(offset + 4)
      const bodyOffset = offset + 8

      if (chunkId === 'fmt ') {
        if (bodyOffset + 16 > buffer.length) throw new WavError('WAV 格式信息不完整')
        format = {
          audioFormat: buffer.readUInt16LE(bodyOffset),
          channels: buffer.readUInt16LE(bodyOffset + 2),
          sampleRate: buffer.readUInt32LE(bodyOffset + 4),
          byteRate: buffer.readUInt32LE(bodyOffset + 8),
          blockAlign: buffer.readUInt16LE(bodyOffset + 12),
          bitsPerSample: buffer.readUInt16LE(bodyOffset + 14)
        }
      } else if (chunkId === 'data') {
        data = { offset: bodyOffset, declaredSize: chunkSize }
        break
      }

      offset = bodyOffset + chunkSize + (chunkSize % 2)
    }

    if (!format || !data) throw new WavError('WAV 文件缺少音频数据')
    if (!format.byteRate || !format.blockAlign) throw new WavError('WAV 格式信息无效')

    const available = Math.max(0, stat.size - data.offset)
    const dataSize = Math.min(data.declaredSize, available)
    const duration = dataSize / format.byteRate

    return {
      ...format,
      dataOffset: data.offset,
      dataSize,
      duration,
      fileSize: stat.size
    }
  } finally {
    await handle.close()
  }
}

export async function mergeWavFiles(inputFiles, outputFile, options = {}) {
  if (!Array.isArray(inputFiles) || inputFiles.length === 0) {
    throw new WavError('没有可合并的音频分段')
  }

  const infos = []
  for (const file of inputFiles) {
    infos.push({ file, ...(await readWavInfo(file)) })
  }

  const first = infos[0]
  if (first.audioFormat !== 1) throw new WavError('仅支持合并 PCM 格式的 WAV 音频')

  for (const info of infos.slice(1)) {
    const sameFormat =
      info.audioFormat === first.audioFormat &&
      info.channels === first.channels &&
      info.sampleRate === first.sampleRate &&
      info.byteRate === first.byteRate &&
      info.blockAlign === first.blockAlign &&
      info.bitsPerSample === first.bitsPerSample

    if (!sameFormat) throw new WavError('分段音频格式不一致，无法合并')
  }

  const gapMs = Math.min(3000, Math.max(0, Math.round(Number(options.gapMs) || 0)))
  const gapBytes = Math.floor((first.byteRate * gapMs) / 1000 / first.blockAlign) * first.blockAlign

  let dataSize = infos.reduce((total, info) => total + info.dataSize, 0)
  if (infos.length > 1) dataSize += gapBytes * (infos.length - 1)

  const { header, pad } = buildWavHeader(first, dataSize)
  const output = createWriteStream(outputFile, { flags: 'w' })

  try {
    output.write(header)

    for (let i = 0; i < infos.length; i += 1) {
      if (options.signal?.aborted) throw createAbortError()

      const info = infos[i]
      await pipeline(
        createReadStream(info.file, {
          start: info.dataOffset,
          end: info.dataOffset + info.dataSize - 1
        }),
        output,
        { end: false }
      )

      if (gapBytes > 0 && i < infos.length - 1) {
        output.write(Buffer.alloc(gapBytes))
      }
    }

    if (pad > 0) output.write(Buffer.alloc(pad))
    output.end()
    await finished(output)
  } catch (error) {
    output.destroy()
    await fsp.rm(outputFile, { force: true }).catch(() => {})
    throw error
  }

  return {
    file: outputFile,
    duration: dataSize / first.byteRate,
    dataSize,
    gapMs
  }
}

/**
 * 对 16-bit PCM WAV 做整体音量缩放（用于不支持音量的云端引擎）。
 * 其他格式直接跳过。
 */
export async function scaleWavVolume(filePath, gain) {
  const safeGain = Math.max(0, Math.min(1, Number(gain)))
  if (!Number.isFinite(safeGain) || safeGain >= 0.999) return

  const info = await readWavInfo(filePath)
  if (info.audioFormat !== 1 || info.bitsPerSample !== 16 || info.channels < 1) return

  const handle = await fsp.open(filePath, 'r+')
  try {
    const data = Buffer.alloc(info.dataSize)
    await handle.read(data, 0, data.length, info.dataOffset)

    for (let offset = 0; offset + 1 < data.length; offset += 2) {
      const scaled = Math.round(data.readInt16LE(offset) * safeGain)
      data.writeInt16LE(Math.max(-32768, Math.min(32767, scaled)), offset)
    }

    await handle.write(data, 0, data.length, info.dataOffset)
  } finally {
    await handle.close()
  }
}

function buildWavHeader(format, dataSize) {
  const pad = dataSize % 2
  const header = Buffer.alloc(44)

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataSize + pad, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(format.channels, 22)
  header.writeUInt32LE(format.sampleRate, 24)
  header.writeUInt32LE(format.byteRate, 28)
  header.writeUInt16LE(format.blockAlign, 32)
  header.writeUInt16LE(format.bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataSize, 40)

  return { header, pad }
}

function createAbortError() {
  const error = new Error('已取消')
  error.name = 'AbortError'
  return error
}
