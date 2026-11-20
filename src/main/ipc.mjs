import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fsp from 'node:fs/promises'
import { basename, join } from 'node:path'
import { MAX_TEXT_CHARS } from '../shared/text-splitter.mjs'
import { engineManager } from './tts/engine-manager.mjs'
import { resolveJobFile } from './tts/cache.mjs'
import { synthesizeJob, cancelJob, hasActiveJobs } from './tts/job-service.mjs'
import { previewVoice } from './tts/preview-service.mjs'
import {
  clearDeepSeekKey,
  getDeepSeekStatus,
  saveDeepSeekKey
} from './deepseek-config.mjs'
import {
  getStoragePaths,
  getExportDirPath,
  setStoragePath
} from './storage-config.mjs'

const MAX_IMPORT_BYTES = 10 * 1024 * 1024

export function registerIpcHandlers() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    engines: engineManager.descriptors(),
    maxTextChars: MAX_TEXT_CHARS
  }))

  ipcMain.handle('app:get-paths', () => getStoragePaths())

  ipcMain.handle('app:choose-path', async (event, kind) => {
    ensureNoBusyWork('合成或模型下载过程中不能修改存储路径')

    const key = pathKeyFor(kind)
    const labels = {
      models: '选择模型目录',
      cache: '选择合成缓存目录',
      export: '选择默认保存目录'
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win, {
      title: labels[kind],
      defaultPath: getStoragePaths()[key],
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || !result.filePaths?.length) {
      return { cancelled: true, kind, paths: getStoragePaths() }
    }

    return applyStoragePathChange(key, result.filePaths[0], kind)
  })

  ipcMain.handle('app:set-path', async (_event, payload = {}) => {
    ensureNoBusyWork('合成或模型下载过程中不能修改存储路径')
    const kind = String(payload.kind || '')
    const key = pathKeyFor(kind)
    return applyStoragePathChange(key, payload.path, kind)
  })

  ipcMain.handle('tts:voices', async (_event, engineId) => {
    const engine = engineManager.get(engineId)
    return engine.listVoices()
  })

  ipcMain.handle('tts:engine-status', async (_event, engineId) => {
    const engine = engineManager.get(engineId)
    if (typeof engine.getStatus === 'function') return engine.getStatus()
    return { engineId: engine.id, ready: true, downloading: false }
  })

  ipcMain.handle('tts:model-download', async (event, engineId) => {
    const engine = engineManager.get(engineId)
    if (typeof engine.downloadModel !== 'function') {
      throw new Error('该引擎不需要下载模型')
    }
    if (hasActiveJobs()) {
      throw new Error('合成过程中无法下载语音模型，请等待合成结束')
    }
    return engine.downloadModel(event.sender)
  })

  ipcMain.handle('tts:model-cancel', async (_event, engineId) => {
    const engine = engineManager.get(engineId)
    return engine.cancelDownload?.() || { ok: false }
  })

  ipcMain.handle('tts:open-model-dir', async (_event, engineId) => {
    const engine = engineManager.get(engineId)
    if (typeof engine.getStatus !== 'function') return { ok: false }
    const status = await engine.getStatus()
    if (!status.modelDir) return { ok: false }
    await fsp.mkdir(status.modelDir, { recursive: true })
    const error = await shell.openPath(status.modelDir)
    if (error) throw new Error(`无法打开模型目录：${error}`)
    return { ok: true, path: status.modelDir }
  })

  ipcMain.handle('ai:status', async () => getDeepSeekStatus())

  ipcMain.handle('ai:save-key', async (_event, apiKey) => {
    ensureNoBusyWork('合成或模型下载过程中不能修改 API Key')
    return saveDeepSeekKey(apiKey)
  })

  ipcMain.handle('ai:clear-key', async () => {
    ensureNoBusyWork('合成或模型下载过程中不能修改 API Key')
    return clearDeepSeekKey()
  })

  ipcMain.handle('ai:test', async () => {
    ensureNoBusyWork('合成或模型下载过程中不能测试 API Key')
    const engine = engineManager.get('deepseek')
    return engine.testConnection()
  })

  ipcMain.handle('tts:preview-voice', async (_event, payload) => {
    return previewVoice(payload || {})
  })

  ipcMain.handle('tts:synthesize', async (event, payload) => {
    return synthesizeJob(payload || {}, event.sender)
  })

  ipcMain.handle('tts:cancel', async (_event, jobId) => {
    return cancelJob(jobId)
  })

  ipcMain.handle('tts:save-audio', async (event, payload = {}) => {
    const source = await resolveJobFile(payload.jobId, payload.fileName)
    const stat = await fsp.stat(source).catch(() => null)
    if (!stat?.isFile()) throw new Error('音频文件不存在或已被清理')

    const win = BrowserWindow.fromWebContents(event.sender)
    const defaultName = sanitizeFileName(payload.defaultName, payload.fileName)

    let defaultDir = getExportDirPath()
    try {
      await fsp.mkdir(defaultDir, { recursive: true })
    } catch {
      defaultDir = app.getPath('downloads')
    }

    const result = await dialog.showSaveDialog(win, {
      title: '保存音频',
      defaultPath: join(defaultDir, defaultName),
      filters: [{ name: 'WAV 音频', extensions: ['wav'] }]
    })

    if (result.canceled || !result.filePath) return { saved: false }

    const target = result.filePath.toLowerCase().endsWith('.wav')
      ? result.filePath
      : `${result.filePath}.wav`

    await fsp.copyFile(source, target)
    return { saved: true, filePath: target }
  })

  ipcMain.handle('tts:reveal', async (_event, payload = {}) => {
    const filePath = await resolveJobFile(payload.jobId, payload.fileName)
    const stat = await fsp.stat(filePath).catch(() => null)
    if (!stat?.isFile()) throw new Error('音频文件不存在或已被清理')
    shell.showItemInFolder(filePath)
    return { ok: true }
  })

  ipcMain.handle('dialog:open-text', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win, {
      title: '导入文本文件',
      properties: ['openFile'],
      filters: [
        { name: '文本文件', extensions: ['txt', 'md', 'markdown', 'log'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePaths?.length) return null

    const filePath = result.filePaths[0]
    const stat = await fsp.stat(filePath)
    if (!stat.isFile()) throw new Error('所选路径不是文件')
    if (stat.size > MAX_IMPORT_BYTES) {
      throw new Error('文件超过 10 MB，请拆分后再导入')
    }

    const buffer = await fsp.readFile(filePath)
    const { content, encoding } = decodeText(buffer)

    return {
      name: basename(filePath),
      content: stripBom(content),
      encoding,
      size: stat.size
    }
  })
}

function ensureNoBusyWork(message) {
  if (hasActiveJobs() || engineManager.hasActiveDownloads()) {
    throw new Error(message)
  }
}

function pathKeyFor(kind) {
  const map = { models: 'modelsDir', cache: 'cacheDir', export: 'exportDir' }
  const key = map[kind]
  if (!key) throw new Error('未知的存储路径类型')
  return key
}

async function applyStoragePathChange(key, value, kind) {
  const paths = await setStoragePath(key, value)

  if (key === 'modelsDir') {
    engineManager.setModelsRoot(paths.modelsDir)
  }

  return { cancelled: false, kind, paths }
}

function decodeText(buffer) {
  if (!buffer.length) return { content: '', encoding: 'UTF-8' }

  const utf8Bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
  const utf16leBom = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe
  const utf16beBom = buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff

  try {
    if (utf16leBom) {
      return { content: new TextDecoder('utf-16le').decode(buffer.subarray(2)), encoding: 'UTF-16 LE' }
    }
    if (utf16beBom) {
      return { content: new TextDecoder('utf-16be').decode(buffer.subarray(2)), encoding: 'UTF-16 BE' }
    }
    if (utf8Bom) {
      return { content: new TextDecoder('utf-8').decode(buffer.subarray(3)), encoding: 'UTF-8' }
    }

    return { content: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'UTF-8' }
  } catch {
    try {
      return { content: new TextDecoder('gbk').decode(buffer), encoding: 'GBK' }
    } catch {
      return { content: new TextDecoder('utf-8').decode(buffer), encoding: 'UTF-8（含无法识别字符）' }
    }
  }
}

function stripBom(text) {
  return String(text || '').replace(/^﻿/, '')
}

function sanitizeFileName(name, fallback) {
  const raw = String(name || fallback || 'RyJS-TTS.wav')
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)

  const base = cleaned || 'RyJS-TTS'
  return base.toLowerCase().endsWith('.wav') ? base : `${base}.wav`
}
