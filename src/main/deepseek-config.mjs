/**
 * DeepSeek API Key 的本地安全存储。
 * 优先使用 Electron safeStorage（Windows DPAPI / macOS Keychain）；
 * 系统加密不可用时只在当前进程内保存，不落盘明文。
 */

import { app, safeStorage } from 'electron'
import fsp from 'node:fs/promises'
import { join } from 'node:path'

let loaded = false
let cachedKey = ''
let persisted = false
let source = ''

function keyFile() {
  return join(app.getPath('userData'), 'deepseek-api-key.json')
}

async function encryptionAvailable() {
  try {
    if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
      return await safeStorage.isAsyncEncryptionAvailable()
    }
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

async function decryptKey(value) {
  const buffer = Buffer.from(String(value), 'base64')
  if (typeof safeStorage.decryptStringAsync === 'function') {
    return safeStorage.decryptStringAsync(buffer)
  }
  return safeStorage.decryptString(buffer)
}

async function encryptKey(value) {
  if (typeof safeStorage.encryptStringAsync === 'function') {
    return safeStorage.encryptStringAsync(value)
  }
  return safeStorage.encryptString(value)
}

export async function initDeepSeekConfig() {
  if (loaded) return
  loaded = true

  try {
    const data = JSON.parse(await fsp.readFile(keyFile(), 'utf8'))
    if (data?.encryptedKey && (await encryptionAvailable())) {
      const value = String(await decryptKey(data.encryptedKey)).trim()

      if (value) {
        cachedKey = value
        persisted = true
        source = 'file'
      }
    }
  } catch {
    // 没有配置文件或无法解密时忽略
  }

  const envKey = String(process.env.DEEPSEEK_API_KEY || '').trim()
  if (!cachedKey && envKey) {
    cachedKey = envKey
    persisted = false
    source = 'env'
  }
}

export async function getDeepSeekStatus() {
  await initDeepSeekConfig()

  return {
    hasKey: Boolean(cachedKey),
    persisted,
    source,
    encryptionAvailable: await encryptionAvailable()
  }
}

export function getDeepSeekKey() {
  return cachedKey
}

export async function saveDeepSeekKey(value) {
  await initDeepSeekConfig()

  const key = String(value || '').trim()
  if (!key) throw new Error('API Key 不能为空')
  if (key.length < 8 || key.length > 512) throw new Error('API Key 格式不正确')

  if (await encryptionAvailable()) {
    const encrypted = (await encryptKey(key)).toString('base64')
    await fsp.mkdir(app.getPath('userData'), { recursive: true })
    await fsp.writeFile(
      keyFile(),
      JSON.stringify(
        {
          encryptedKey: encrypted,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      ),
      { encoding: 'utf8', mode: 0o600 }
    )
    persisted = true
    source = 'file'
  } else {
    persisted = false
    source = 'memory'
  }

  cachedKey = key
  return getDeepSeekStatus()
}

export async function clearDeepSeekKey() {
  await initDeepSeekConfig()

  cachedKey = ''
  persisted = false
  source = ''
  await fsp.rm(keyFile(), { force: true }).catch(() => {})

  return getDeepSeekStatus()
}
