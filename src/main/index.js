import { app, BrowserWindow, Menu, dialog, session } from 'electron'
import { join } from 'node:path'
import icon from '../../resources/icon.png?asset'
import { registerMediaSchemePrivileges, registerMediaProtocol } from './media-protocol.mjs'
import { engineManager, initEngines } from './tts/engine-manager.mjs'
import { cancelAllJobs } from './tts/job-service.mjs'
import { cleanupOldCache, ensureCacheRoot } from './tts/cache.mjs'
import { initDeepSeekConfig } from './deepseek-config.mjs'
import { initStorageConfig } from './storage-config.mjs'
import { registerIpcHandlers } from './ipc.mjs'

// 允许合成完成后自动播放
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// 必须在 app ready 之前注册自定义协议
registerMediaSchemePrivileges()

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.whenReady().then(bootstrap).catch((error) => {
    console.error(error)
    dialog.showErrorBox('应用启动失败', String(error?.message || error))
    app.quit()
  })
}

async function bootstrap() {
  if (process.platform === 'win32') app.setAppUserModelId('com.ryjs.tts')

  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)

  await initStorageConfig()
  await initDeepSeekConfig()
  await ensureCacheRoot()
  await initEngines()
  registerMediaProtocol()
  registerIpcHandlers()
  cleanupOldCache(3).catch(() => {})

  createMainWindow()
}

function createMainWindow() {
  const isWindows = process.platform === 'win32'
  const isMac = process.platform === 'darwin'

  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    center: true,
    title: 'RyJS TTS',
    icon,
    backgroundColor: '#f4f6fb',
    autoHideMenuBar: true,
    ...(isWindows
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#ffffff',
            symbolColor: '#475569',
            height: 58
          }
        }
      : isMac
        ? {
            titleBarStyle: 'hiddenInset',
            trafficLightPosition: { x: 18, y: 20 }
          }
        : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: true
    }
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    if (!devUrl && url.startsWith('file://')) return
    event.preventDefault()
  })

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools()
    }
  })

  if (!app.isPackaged) {
    win.webContents.on('console-message', (...args) => {
      const details = args[1] && typeof args[1] === 'object'
        ? args[1]
        : {
            level: args[1],
            message: args[2],
            lineNumber: args[3],
            sourceId: args[4]
          }
      const level = details.level
      if (level === 3 || level === 'error' || level === 'warning' || level === 2) {
        console.log(
          `[renderer:${level}] ${details.message ?? ''}` +
            (details.sourceId ? ` (${details.sourceId}:${details.lineNumber ?? 0})` : '')
        )
      }
    })
  }

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.on('before-quit', () => {
  cancelAllJobs()
  engineManager.cancelAllDownloads()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
})
