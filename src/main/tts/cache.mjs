import fsp from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { getCacheDirPath, getModelsDirPath } from '../storage-config.mjs'

export function getCacheRoot() {
  return getCacheDirPath()
}

export function getRuntimeDir() {
  return join(getCacheRoot(), '.runtime')
}

export function getModelsRoot() {
  return getModelsDirPath()
}

export async function ensureCacheRoot() {
  const root = getCacheRoot()
  await fsp.mkdir(root, { recursive: true })
  return root
}

export async function ensureRuntimeDir() {
  const dir = getRuntimeDir()
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

export async function ensureModelsRoot() {
  const dir = getModelsRoot()
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

export function isValidJobId(jobId) {
  return typeof jobId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(jobId)
}

export function isValidAudioFileName(fileName) {
  return (
    typeof fileName === 'string' &&
    fileName.length <= 128 &&
    /^[a-zA-Z0-9._-]+$/.test(fileName) &&
    fileName.toLowerCase().endsWith('.wav') &&
    !fileName.includes('..')
  )
}

export async function resolveJobFile(jobId, fileName) {
  if (!isValidJobId(jobId) && jobId !== 'preview') throw new Error('无效的任务标识')
  if (!isValidAudioFileName(fileName)) throw new Error('无效的音频文件名')

  const root = getCacheRoot()
  const target = resolve(join(root, jobId, fileName))
  const rootPrefix = resolve(root) + sep

  if (!target.startsWith(rootPrefix)) throw new Error('非法的文件路径')
  return target
}

/**
 * 清理超过指定天数的合成缓存，避免长期占用磁盘。
 */
export async function cleanupOldCache(maxAgeDays = 3) {
  const root = getCacheRoot()
  const maxAgeMs = Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000

  try {
    const entries = await fsp.readdir(root, { withFileTypes: true })
    const now = Date.now()

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      // 用户可以把缓存目录指向任意位置，只清理本应用生成的任务目录
      if (!isValidJobId(entry.name)) continue
      const folder = join(root, entry.name)
      try {
        const stat = await fsp.stat(folder)
        if (now - stat.mtimeMs > maxAgeMs) {
          await fsp.rm(folder, { recursive: true, force: true })
        }
      } catch {
        // 单个目录清理失败不影响应用启动
      }
    }
  } catch {
    // 缓存目录不存在时无需处理
  }
}
