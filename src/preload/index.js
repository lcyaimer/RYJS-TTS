import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getAppInfo: () => ipcRenderer.invoke('app:info'),

  listVoices: (engineId) => ipcRenderer.invoke('tts:voices', engineId),

  getEngineStatus: (engineId) => ipcRenderer.invoke('tts:engine-status', engineId),

  downloadModel: (engineId) => ipcRenderer.invoke('tts:model-download', engineId),

  cancelModelDownload: (engineId) => ipcRenderer.invoke('tts:model-cancel', engineId),

  openModelDir: (engineId) => ipcRenderer.invoke('tts:open-model-dir', engineId),

  getAiStatus: () => ipcRenderer.invoke('ai:status'),

  saveAiKey: (apiKey) => ipcRenderer.invoke('ai:save-key', apiKey),

  clearAiKey: () => ipcRenderer.invoke('ai:clear-key'),

  testAiKey: () => ipcRenderer.invoke('ai:test'),

  getPaths: () => ipcRenderer.invoke('app:get-paths'),

  choosePath: (kind) => ipcRenderer.invoke('app:choose-path', kind),

  setPath: (kind, path) => ipcRenderer.invoke('app:set-path', { kind, path }),

  previewVoice: (options) => ipcRenderer.invoke('tts:preview-voice', options),

  synthesize: (payload) => ipcRenderer.invoke('tts:synthesize', payload),

  cancel: (jobId) => ipcRenderer.invoke('tts:cancel', jobId),

  saveAudio: (payload) => ipcRenderer.invoke('tts:save-audio', payload),

  reveal: (payload) => ipcRenderer.invoke('tts:reveal', payload),

  openTextFile: () => ipcRenderer.invoke('dialog:open-text'),

  onProgress: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('tts:progress', listener)
    return () => ipcRenderer.removeListener('tts:progress', listener)
  },

  onSegment: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('tts:segment', listener)
    return () => ipcRenderer.removeListener('tts:segment', listener)
  },

  onModelProgress: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('tts:model-progress', listener)
    return () => ipcRenderer.removeListener('tts:model-progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
