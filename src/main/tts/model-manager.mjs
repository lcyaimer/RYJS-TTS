/**
 * 本地神经语音模型管理。
 * 模型文件体积较大，不随源码仓库分发；由用户在应用内确认后下载，
 * 下载完成后使用 SHA-256 校验，再解压到 userData/models。
 */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import fsp from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as tar from 'tar'
import unbzip2 from 'unbzip2-stream'
import { createAbortError } from './powershell.mjs'

const CONNECT_TIMEOUT_MS = 10_000
const PROGRESS_INTERVAL_MS = 350

const GITHUB_RELEASE_ROOT = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models'
const MIRROR_PREFIXES = ['https://gh-proxy.com/', 'https://ghproxy.net/']

function releaseUrls(fileName) {
  const canonical = `${GITHUB_RELEASE_ROOT}/${fileName}`
  const customBase = String(process.env.RYJS_MODEL_MIRROR || '').trim()

  if (customBase) {
    return [`${customBase.replace(/\/+$/, '')}/${fileName}`]
  }

  // 国内访问 GitHub 往往不可达，优先尝试镜像；文件仍会用固定 SHA-256 校验
  return [
    `${MIRROR_PREFIXES[0]}${canonical}`,
    canonical,
    `${MIRROR_PREFIXES[1]}${canonical}`
  ]
}

export const MODEL_DEFINITIONS = {
  piper: {
    engineId: 'piper',
    name: '超文 · Piper 中文模型',
    fileName: 'vits-piper-zh_CN-chaowen-medium.tar.bz2',
    sizeBytes: 60_443_846,
    sha256: '1b69bdcf10bb6331c7f8a7591940febeb175c6bb86caa3802d96531f8e4ad211',
    requiredFiles: ['zh_CN-chaowen-medium.onnx', 'tokens.txt', 'lexicon.txt'],
    license: '声音数据集 CC0 · Piper 模型 · Sherpa-ONNX 推理（Apache-2.0）',
    sourcePage: 'https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models',
    urls: releaseUrls('vits-piper-zh_CN-chaowen-medium.tar.bz2')
  },
  kokoro: {
    engineId: 'kokoro',
    name: 'Kokoro-82M 中文模型',
    fileName: 'kokoro-multi-lang-v1_0.tar.bz2',
    sizeBytes: 349_886_476,
    sha256: '60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4',
    requiredFiles: [
      'model.onnx',
      'voices.bin',
      'tokens.txt',
      'lexicon-zh.txt',
      'lexicon-us-en.txt'
    ],
    license: 'Kokoro-82M（Apache-2.0）· Sherpa-ONNX 推理（Apache-2.0）',
    sourcePage: 'https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models',
    urls: releaseUrls('kokoro-multi-lang-v1_0.tar.bz2')
  }
}

const activeDownloads = new Set()

export function getModelDir(modelsRoot, engineId) {
  return join(modelsRoot, engineId)
}

export function modelPublicInfo(definition) {
  return {
    engineId: definition.engineId,
    name: definition.name,
    sizeBytes: definition.sizeBytes,
    license: definition.license,
    sourcePage: definition.sourcePage
  }
}

export async function getModelStatus(modelsRoot, definition) {
  const modelDir = getModelDir(modelsRoot, definition.engineId)
  const missingFiles = []

  for (const fileName of definition.requiredFiles) {
    const stat = await fsp.stat(join(modelDir, fileName)).catch(() => null)
    if (!stat?.isFile() || stat.size === 0) missingFiles.push(fileName)
  }

  return {
    ...modelPublicInfo(definition),
    ready: missingFiles.length === 0,
    modelDir,
    missingFiles
  }
}

export async function downloadModelPackage({
  modelsRoot,
  definition,
  signal,
  onProgress = () => {}
}) {
  const engineId = definition.engineId
  if (activeDownloads.has(engineId)) throw new Error('该模型正在下载，请稍候')

  activeDownloads.add(engineId)
  const tempRoot = join(modelsRoot, `.tmp-${engineId}-${randomUUID()}`)
  const archiveFile = join(tempRoot, definition.fileName)
  const extractDir = join(tempRoot, 'extract')
  const finalDir = getModelDir(modelsRoot, engineId)

  const report = (payload) => {
    try {
      onProgress(payload)
    } catch {
      // 渲染进程已关闭时忽略
    }
  }

  try {
    if (signal?.aborted) throw createAbortError()

    await fsp.mkdir(extractDir, { recursive: true })

    let sourceUrl = ''
    let downloadedHash = ''
    let lastError = null

    for (let index = 0; index < definition.urls.length; index += 1) {
      const url = definition.urls[index]
      try {
        report({
          phase: 'connecting',
          percent: 0,
          message: `正在连接下载源 ${index + 1} / ${definition.urls.length}…`,
          url
        })

        const result = await downloadToFile(url, archiveFile, {
          signal,
          expectedSize: definition.sizeBytes,
          onProgress: (payload) => {
            report({
              phase: 'downloading',
              percent: Math.min(99, payload.percent),
              received: payload.received,
              total: payload.total,
              message: `正在下载模型… ${formatMegabytes(payload.received)} / ${formatMegabytes(
                payload.total || definition.sizeBytes
              )}`,
              url
            })
          }
        })

        report({ phase: 'verifying', percent: 99, message: '正在校验模型文件…', url })

        if (String(result.sha256).toLowerCase() !== definition.sha256.toLowerCase()) {
          throw new Error('文件校验失败，可能下载不完整')
        }

        sourceUrl = url
        downloadedHash = result.sha256
        break
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw createAbortError()
        lastError = error
        await fsp.rm(archiveFile, { force: true }).catch(() => {})
      }
    }

    if (!sourceUrl) {
      throw new Error(`模型下载失败：${lastError?.message || '所有下载源均不可用'}`)
    }

    if (signal?.aborted) throw createAbortError()

    report({ phase: 'extracting', percent: 100, message: '正在解压模型（可能需要几十秒）…' })

    await pipeline(
      createReadStream(archiveFile),
      unbzip2(),
      tar.extract({
        cwd: extractDir,
        strip: 1,
        preservePaths: false
      }),
      { signal }
    )

    if (signal?.aborted) throw createAbortError()

    await validateExtracted(extractDir, definition)
    await removeUnusedPackageFiles(extractDir)
    await fsp.rm(finalDir, { recursive: true, force: true })
    await fsp.rename(extractDir, finalDir)

    await fsp.writeFile(
      join(finalDir, 'ryjs-model.json'),
      JSON.stringify(
        {
          engineId,
          name: definition.name,
          license: definition.license,
          sourcePage: definition.sourcePage,
          sourceUrl,
          sha256: downloadedHash,
          installedAt: new Date().toISOString()
        },
        null,
        2
      ),
      'utf8'
    )

    report({ phase: 'done', percent: 100, message: '模型安装完成' })

    return await getModelStatus(modelsRoot, definition)
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) throw createAbortError()
    throw error
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
    activeDownloads.delete(engineId)
  }
}

export async function cleanupModelTempDirs(modelsRoot) {
  try {
    const entries = await fsp.readdir(modelsRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('.tmp-')) continue
      await fsp.rm(join(modelsRoot, entry.name), { recursive: true, force: true }).catch(() => {})
    }
  } catch {
    // 模型目录不存在时忽略
  }
}

async function downloadToFile(url, target, { signal, expectedSize, onProgress }) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })

  let response = null
  const connectTimer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)

  try {
    try {
      response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    } catch (error) {
      if (signal?.aborted) throw createAbortError()
      const detail = error?.name === 'AbortError' ? '连接超时' : error?.message || String(error)
      throw new Error(`无法连接下载源（${detail}）`)
    } finally {
      clearTimeout(connectTimer)
    }

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      const detail = text ? `：${text.replace(/\s+/g, ' ').slice(0, 120)}` : ''
      throw new Error(`下载源返回 HTTP ${response.status}${detail}`)
    }

    const headerSize = Number(response.headers.get('content-length'))
    const total = Number.isFinite(headerSize) && headerSize > 0 ? headerSize : expectedSize || 0
    const hash = createHash('sha256')
    let received = 0
    let lastReport = 0

    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk)
        received += chunk.length

        const now = Date.now()
        if (now - lastReport >= PROGRESS_INTERVAL_MS) {
          lastReport = now
          onProgress({ received, total })
        }

        callback(null, chunk)
      }
    })

    try {
      await pipeline(
        Readable.fromWeb(response.body),
        meter,
        createWriteStream(target),
        { signal: controller.signal }
      )
    } catch (error) {
      if (signal?.aborted) throw createAbortError()
      throw new Error(`下载中断：${error?.message || String(error)}`)
    }

    onProgress({ received, total: total || received })

    return {
      sha256: hash.digest('hex'),
      bytes: received
    }
  } finally {
    clearTimeout(connectTimer)
    signal?.removeEventListener('abort', abort)
  }
}

async function validateExtracted(extractDir, definition) {
  const missing = []
  for (const fileName of definition.requiredFiles) {
    const stat = await fsp.stat(join(extractDir, fileName)).catch(() => null)
    if (!stat?.isFile() || stat.size === 0) missing.push(fileName)
  }

  if (missing.length) {
    throw new Error(`模型包不完整，缺少：${missing.join('、')}`)
  }
}

async function removeUnusedPackageFiles(extractDir) {
  // Sherpa-ONNX v2 不再使用 espeak-ng；删除它可避免额外占用空间
  for (const name of ['espeak-ng-data', 'dict', 'vits-piper.py', 'vits-piper.sh']) {
    await fsp.rm(join(extractDir, name), { recursive: true, force: true }).catch(() => {})
  }
}

function formatMegabytes(bytes) {
  const value = Number(bytes) || 0
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
