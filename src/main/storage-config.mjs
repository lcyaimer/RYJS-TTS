/**
 * 可配置的本地存储路径。
 * - modelsDir：Piper / Kokoro 模型目录
 * - cacheDir：合成音频缓存目录
 * - exportDir：另存音频时默认打开的目录
 *
 * 配置保存在 userData/app-paths.json；模型和缓存目录可随时更换。
 */

import { app } from 'electron'
import fsp from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

const PATH_KEYS = ['modelsDir', 'cacheDir', 'exportDir']
let config = null
let loadingPromise = null

function defaults() {
  const userData = app.getPath('userData')
  return {
    modelsDir: process.env.RYJS_MODELS_DIR || join(userData, 'models'),
    cacheDir: process.env.RYJS_CACHE_DIR || join(userData, 'audio-cache'),
    exportDir: process.env.RYJS_EXPORT_DIR || app.getPath('downloads')
  }
}

function configFile() {
  return join(app.getPath('userData'), 'app-paths.json')
}

export async function initStorageConfig() {
  if (config) return config
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    const base = defaults()
    const paths = { ...base }

    try {
      const raw = JSON.parse(await fsp.readFile(configFile(), 'utf8'))
      for (const key of PATH_KEYS) {
        if (typeof raw?.[key] === 'string' && isAbsolute(raw[key])) {
          paths[key] = resolve(raw[key])
        }
      }
    } catch {
      // 没有配置文件时使用默认值
    }

    for (const key of PATH_KEYS) {
      try {
        await fsp.mkdir(paths[key], { recursive: true })
      } catch (error) {
        console.warn(`[storage] 无法使用配置目录 ${paths[key]}，回退到默认路径：${error.message}`)
        paths[key] = base[key]
        await fsp.mkdir(paths[key], { recursive: true }).catch(() => {})
      }
    }

    config = paths
    return config
  })()

  try {
    return await loadingPromise
  } finally {
    loadingPromise = null
  }
}

export function getStoragePaths() {
  return { ...config }
}

export function getModelsDirPath() {
  return config.modelsDir
}

export function getCacheDirPath() {
  return config.cacheDir
}

export function getExportDirPath() {
  return config.exportDir
}

export async function setStoragePath(key, value) {
  if (!PATH_KEYS.includes(key)) throw new Error('未知的存储路径类型')

  const raw = String(value || '').trim()
  if (!raw || !isAbsolute(raw)) throw new Error('请选择有效的绝对路径')

  const target = resolve(raw)
  const stat = await fsp.stat(target).catch(() => null)
  if (stat && !stat.isDirectory()) throw new Error('所选路径不是文件夹')

  await fsp.mkdir(target, { recursive: true })

  config = { ...config, [key]: target }
  await fsp.writeFile(configFile(), JSON.stringify(config, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  })

  return getStoragePaths()
}
