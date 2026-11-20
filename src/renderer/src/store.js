import { computed, reactive, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  splitText,
  countChars,
  estimateDurationSeconds,
  formatDuration,
  clampInt,
  DEFAULT_MAX_CHARS,
  MAX_TEXT_CHARS
} from '@shared/text-splitter.mjs'
import { toErrorMessage } from './utils'

const STORAGE_KEY = 'ryjs-tts:settings:v1'

const DEFAULT_SETTINGS = {
  engineId: 'onecore',
  voiceName: '',
  rate: 0,
  volume: 100,
  mode: 'auto',
  maxChars: DEFAULT_MAX_CHARS,
  gapMs: 300,
  autoPlay: true
}

export const SAMPLE_TEXT = `傍晚的风穿过窗棂，把一整天的心事轻轻翻了过去。

这是一段用于试听的示例文字。它包含长短不一的句子，也有数字，比如 2026、3.14，还有英文单词 voice、story，用来观察本地语音在不同内容下的朗读效果。

如果把文字分段生成，每一段都可以单独试听；确认无误之后，再把它们合并成一份完整的音频，保存到电脑里。`

const VOICE_ALIASES = {
  'Microsoft Huihui Desktop': '慧慧',
  'Microsoft Huihui': '慧慧',
  'Microsoft Hanhan Desktop': '涵涵',
  'Microsoft Yaoyao': '瑶瑶',
  'Microsoft Kangkang': '康康',
  'Microsoft Zira Desktop': 'Zira',
  'Microsoft David Desktop': 'David',
  'Microsoft Mark': 'Mark',
  'Microsoft Hazel Desktop': 'Hazel',
  'Microsoft Susan Desktop': 'Susan'
}

const LANGUAGE_LABELS = {
  'zh-cn': '中文',
  'zh-tw': '中文（台湾）',
  'zh-hk': '中文（粤语）',
  'en-us': '英语（美国）',
  'en-gb': '英语（英国）',
  'ja-jp': '日语',
  'ko-kr': '韩语',
  'de-de': '德语',
  'fr-fr': '法语',
  'es-es': '西班牙语',
  'it-it': '意大利语',
  'pt-br': '葡萄牙语',
  'ru-ru': '俄语'
}

export const state = reactive({
  ready: false,
  initError: '',
  appInfo: {
    version: '',
    platform: '',
    engines: [],
    maxTextChars: MAX_TEXT_CHARS
  },
  voices: [],
  voicesLoading: false,
  voicesError: '',
  settings: loadSettings(),
  text: '',
  job: {
    running: false,
    cancelling: false,
    jobId: null,
    phase: 'idle',
    current: 0,
    total: 0,
    message: '',
    followSegments: false,
    autoStarted: false
  },
  result: emptyResult(),
  estimate: {
    segments: 0,
    seconds: 0
  },
  player: {
    track: null,
    playing: false,
    loading: false,
    currentTime: 0,
    duration: 0,
    error: '',
    followJob: false,
    waitingForNext: false
  },
  previewLoading: false,
  aiStatus: {
    loaded: false,
    hasKey: false,
    persisted: false,
    source: '',
    encryptionAvailable: false,
    saving: false,
    testing: false,
    error: '',
    message: ''
  },
  paths: {
    modelsDir: '',
    cacheDir: '',
    exportDir: ''
  },
  pathsLoading: true,
  pathsError: '',
  pathChanging: false,
  engineStatus: {
    engineId: null,
    ready: false,
    loading: true,
    downloading: false,
    error: '',
    name: '',
    sizeBytes: 0,
    license: '',
    modelDir: ''
  },
  modelDownload: {
    engineId: null,
    running: false,
    cancelling: false,
    percent: 0,
    received: 0,
    total: 0,
    phase: '',
    message: ''
  }
})

export const enabledVoices = computed(() =>
  state.voices.filter((voice) => voice.enabled !== false)
)

export const currentEngine = computed(() =>
  state.appInfo.engines.find((engine) => engine.id === state.settings.engineId) || null
)

export const currentVoice = computed(() =>
  enabledVoices.value.find((voice) => voice.name === state.settings.voiceName) || null
)

export const requiresModel = computed(() => Boolean(currentEngine.value?.requiresModel))

export const requiresApiKey = computed(() => Boolean(currentEngine.value?.requiresApiKey))

export const engineSupportsSpeed = computed(
  () => currentEngine.value?.capabilities?.speed !== false
)

export const engineSupportsVolume = computed(
  () => currentEngine.value?.capabilities?.volume !== false
)

export const effectiveRate = computed(() =>
  engineSupportsSpeed.value ? state.settings.rate : 0
)

export const engineReady = computed(() => {
  if (state.engineStatus.engineId !== state.settings.engineId) return false
  return state.engineStatus.ready === true && !state.engineStatus.loading
})

export const charCount = computed(() => countChars(state.text))

export const overLimit = computed(() => charCount.value > (state.appInfo.maxTextChars || MAX_TEXT_CHARS))

export const canStart = computed(
  () =>
    !state.job.running &&
    Boolean(state.text.trim()) &&
    !overLimit.value &&
    enabledVoices.value.length > 0 &&
    !state.voicesLoading &&
    engineReady.value &&
    !state.modelDownload.running
)

export const completedSegments = computed(() => state.result.segments.length)

export const progressPercent = computed(() => {
  if (!state.job.running) return 0
  if (state.job.phase === 'merging' || state.job.phase === 'done') return 96

  const total = state.job.total || 0
  const completed = state.result.segments.length
  if (!total) return 4

  return Math.min(92, Math.max(4, Math.round((completed / total) * 92)))
})

let initPromise = null
let ipcBound = false
let audioElement = null
let estimateTimer = null
let lastAudioErrorUrl = ''

export function initStudio() {
  if (!initPromise) initPromise = initialize()
  return initPromise
}

async function initialize() {
  bindIpcEvents()
  scheduleEstimate()

  try {
    const info = await window.api.getAppInfo()
    if (info) state.appInfo = { ...state.appInfo, ...info }
  } catch (error) {
    state.initError = toErrorMessage(error)
  }

  const engineIds = (state.appInfo.engines || []).map((engine) => engine.id)
  if (engineIds.length && !engineIds.includes(state.settings.engineId)) {
    state.settings.engineId = engineIds[0]
  }

  state.engineStatus.engineId = state.settings.engineId
  await Promise.all([
    loadVoices(),
    refreshEngineStatus(),
    refreshAiStatus(),
    refreshPaths()
  ])
  state.ready = true
}

export async function refreshPaths() {
  if (!window.api?.getPaths) {
    state.pathsLoading = false
    return
  }

  state.pathsError = ''

  try {
    const paths = (await window.api.getPaths()) || {}
    state.paths = { ...state.paths, ...paths }
  } catch (error) {
    state.pathsError = toErrorMessage(error)
  } finally {
    state.pathsLoading = false
  }
}

export async function chooseStoragePath(kind) {
  if (state.job.running || state.modelDownload.running || state.pathChanging) return

  state.pathChanging = true

  try {
    const result = (await window.api.choosePath(kind)) || {}
    if (!result.cancelled) applyStoragePaths(kind, result.paths)
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    state.pathChanging = false
  }
}

export async function applyStoragePath(kind, path) {
  if (state.job.running || state.modelDownload.running || state.pathChanging) return false

  state.pathChanging = true

  try {
    const result = (await window.api.setPath(kind, path)) || {}
    applyStoragePaths(kind, result.paths)
    return true
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
    return false
  } finally {
    state.pathChanging = false
  }
}

function applyStoragePaths(kind, paths) {
  if (paths) state.paths = { ...state.paths, ...paths }

  if (kind === 'models') {
    refreshEngineStatus()
    loadVoices()
    ElMessage.success('模型目录已更新，新下载的模型会保存到新位置')
  } else if (kind === 'cache') {
    stopPlayback()
    state.result = emptyResult()
    ElMessage.info('合成缓存目录已更新，之前的试听结果需要重新合成')
  } else if (kind === 'export') {
    ElMessage.success('默认保存目录已更新')
  }
}

export async function refreshEngineStatus() {
  const engineId = state.settings.engineId
  if (!window.api?.getEngineStatus) {
    state.engineStatus = {
      ...state.engineStatus,
      engineId,
      ready: !currentEngine.value?.requiresModel,
      loading: false,
      error: ''
    }
    return
  }

  state.engineStatus = { ...state.engineStatus, engineId, loading: true, error: '' }

  try {
    const status = (await window.api.getEngineStatus(engineId)) || {}
    if (state.settings.engineId !== engineId) return

    state.engineStatus = {
      ...state.engineStatus,
      ...status,
      engineId,
      ready: status.ready !== false,
      loading: false,
      error: ''
    }
  } catch (error) {
    if (state.settings.engineId !== engineId) return

    state.engineStatus = {
      ...state.engineStatus,
      engineId,
      ready: !currentEngine.value?.requiresModel,
      loading: false,
      error: toErrorMessage(error)
    }
  }
}

export async function refreshAiStatus() {
  if (!window.api?.getAiStatus) {
    state.aiStatus = { ...state.aiStatus, loaded: true }
    return
  }

  try {
    const status = (await window.api.getAiStatus()) || {}
    state.aiStatus = {
      ...state.aiStatus,
      ...status,
      loaded: true,
      error: '',
      message: ''
    }
  } catch (error) {
    state.aiStatus = {
      ...state.aiStatus,
      loaded: true,
      error: toErrorMessage(error)
    }
  }
}

export async function saveDeepSeekKey(apiKey) {
  if (state.job.running || state.modelDownload.running) {
    ElMessage.warning('合成或模型下载过程中不能修改 API Key')
    return false
  }

  const value = String(apiKey || '').trim()
  if (!value) {
    ElMessage.warning('请输入 DeepSeek API Key')
    return false
  }

  state.aiStatus.saving = true
  state.aiStatus.error = ''
  state.aiStatus.message = ''

  try {
    const status = (await window.api.saveAiKey(value)) || {}
    state.aiStatus = { ...state.aiStatus, ...status, loaded: true }
    await refreshEngineStatus()
    ElMessage.success('DeepSeek API Key 已保存')
    return true
  } catch (error) {
    state.aiStatus.error = toErrorMessage(error)
    ElMessage.error(state.aiStatus.error)
    return false
  } finally {
    state.aiStatus.saving = false
  }
}

export async function testDeepSeekKey() {
  if (state.job.running || state.modelDownload.running) {
    ElMessage.warning('合成或模型下载过程中不能测试 API Key')
    return false
  }

  state.aiStatus.testing = true
  state.aiStatus.error = ''
  state.aiStatus.message = ''

  try {
    await window.api.testAiKey()
    state.aiStatus.message = '连接成功，API Key 可用'
    ElMessage.success('DeepSeek 连接成功')
    await refreshEngineStatus()
    return true
  } catch (error) {
    state.aiStatus.error = toErrorMessage(error)
    ElMessage.error(state.aiStatus.error)
    return false
  } finally {
    state.aiStatus.testing = false
  }
}

export async function clearDeepSeekKey() {
  if (state.job.running || state.modelDownload.running) {
    ElMessage.warning('合成或模型下载过程中不能修改 API Key')
    return false
  }

  try {
    await ElMessageBox.confirm(
      '清除后需要重新填写 DeepSeek API Key，确定继续吗？',
      '清除 API Key',
      { confirmButtonText: '清除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return false
  }

  try {
    const status = (await window.api.clearAiKey()) || {}
    state.aiStatus = {
      ...state.aiStatus,
      ...status,
      loaded: true,
      error: '',
      message: ''
    }
    await refreshEngineStatus()
    ElMessage.success('已清除 DeepSeek API Key')
    return true
  } catch (error) {
    state.aiStatus.error = toErrorMessage(error)
    ElMessage.error(state.aiStatus.error)
    return false
  }
}

export async function loadVoices() {
  if (!window.api?.listVoices) {
    state.voicesError = '主进程连接异常，请重启应用'
    return
  }

  state.voicesLoading = true
  state.voicesError = ''

  try {
    const voices = await window.api.listVoices(state.settings.engineId)
    state.voices = Array.isArray(voices) ? voices : []
    ensureVoiceSelection()

    if (!enabledVoices.value.length) {
      state.voicesError = '系统中没有可用的语音，请在 Windows 设置中安装'
    }
  } catch (error) {
    state.voices = []
    state.voicesError = toErrorMessage(error)
  } finally {
    state.voicesLoading = false
  }
}

function ensureVoiceSelection() {
  const voices = enabledVoices.value
  if (!voices.length) {
    state.settings.voiceName = ''
    return
  }

  if (voices.some((voice) => voice.name === state.settings.voiceName)) return

  const preferred =
    voices.find((voice) => String(voice.culture || '').toLowerCase().startsWith('zh')) ||
    voices.find((voice) => String(voice.culture || '').toLowerCase().startsWith('en')) ||
    voices[0]

  state.settings.voiceName = preferred?.name || ''
}

export async function startSynthesis() {
  if (state.job.running) return

  if (!state.text.trim()) {
    ElMessage.warning('请先输入需要转换的文字')
    return
  }
  if (overLimit.value) {
    ElMessage.warning(`文稿超过 ${state.appInfo.maxTextChars.toLocaleString('zh-CN')} 字上限，请分批转换`)
    return
  }
  if (state.voicesLoading) {
    ElMessage.warning('正在读取系统语音，请稍候')
    return
  }
  if (state.modelDownload.running) {
    ElMessage.warning('语音模型正在下载，请稍候')
    return
  }
  if (requiresModel.value && !engineReady.value) {
    ElMessage.warning('请先在左侧下载当前引擎的语音模型')
    return
  }
  if (requiresApiKey.value && !engineReady.value) {
    ElMessage.warning('请先在左侧填写 DeepSeek API Key')
    return
  }
  if (!enabledVoices.value.length) {
    ElMessage.error('没有可用的系统语音，请先安装语音')
    return
  }

  stopPlayback()

  const jobId = createJobId()
  const requestedVoice = state.settings.voiceName

  state.job = {
    running: true,
    cancelling: false,
    jobId,
    phase: 'preparing',
    current: 0,
    total: 0,
    message: '正在准备合成…',
    followSegments: state.settings.mode === 'auto',
    autoStarted: false
  }
  state.result = emptyResult()
  state.result.jobId = jobId
  state.result.startedAt = Date.now()

  try {
    const response = await window.api.synthesize({
      jobId,
      text: state.text,
      options: {
        engineId: state.settings.engineId,
        voiceName: state.settings.voiceName,
        rate: effectiveRate.value,
        volume: state.settings.volume,
        mode: state.settings.mode,
        maxChars: state.settings.maxChars,
        gapMs: state.settings.gapMs
      }
    })

    if (state.job.jobId !== jobId) return

    const result = response || {}
    const segments = Array.isArray(result.segments) ? result.segments : state.result.segments

    Object.assign(state.result, result, {
      jobId,
      segments,
      done: true,
      ok: Boolean(result.ok),
      cancelled: Boolean(result.cancelled),
      error: result.cancelled
        ? ''
        : result.error || (result.ok ? '' : '合成失败，请重试')
    })

    if (result.cancelled) {
      stopAutoFollow()
      ElMessage.info('已取消合成，已完成的段落仍可试听')
    } else if (!result.ok) {
      stopAutoFollow()
      ElMessage.error(result.error || '合成失败，请重试')
    } else {
      ElMessage.success(`合成完成，共 ${segments.length} 段，已生成完整音频`)
      if (result.voice?.name && requestedVoice && result.voice.name !== requestedVoice) {
        ElMessage.info(`所选声音不可用，本次使用「${voiceFullLabel(result.voice)}」`)
      }

      if (state.settings.autoPlay && !state.job.autoStarted && !state.player.track) {
        playFullAudio()
      }

      if (state.player.followJob && state.player.waitingForNext) {
        const current = state.player.track
        const next =
          current?.kind === 'segment' ? nextSegmentAfter(current.index) : null

        if (next) {
          state.player.waitingForNext = false
          startAutoPlaySegment(next)
        } else {
          stopAutoFollow()
        }
      }
    }
  } catch (error) {
    stopAutoFollow()
    if (state.job.jobId !== jobId) return
    const message = toErrorMessage(error)
    state.result.done = true
    state.result.jobId = jobId
    state.result.error = message
    ElMessage.error(message)
  } finally {
    if (state.job.jobId === jobId) {
      state.job = {
        running: false,
        cancelling: false,
        jobId: null,
        phase: 'idle',
        current: 0,
        total: 0,
        message: '',
        followSegments: false,
        autoStarted: false
      }

      if (state.player.waitingForNext) {
        state.player.waitingForNext = false
        state.player.followJob = false
      }
    }
  }
}

export async function cancelSynthesis() {
  if (!state.job.running || state.job.cancelling) return
  state.job.cancelling = true
  state.job.message = '正在取消…'

  try {
    await window.api.cancel(state.job.jobId)
  } catch (error) {
    state.job.cancelling = false
    ElMessage.error(toErrorMessage(error))
  }
}

export async function downloadCurrentModel() {
  const engineId = state.settings.engineId
  const engine = currentEngine.value
  if (!engine?.requiresModel || state.modelDownload.running) return

  state.engineStatus.error = ''
  state.modelDownload = {
    engineId,
    running: true,
    cancelling: false,
    percent: 0,
    received: 0,
    total: engine.model?.sizeBytes || 0,
    phase: 'connecting',
    message: '正在准备下载模型…'
  }

  try {
    await window.api.downloadModel(engineId)
    await refreshEngineStatus()
    await loadVoices()
    ElMessage.success('语音模型下载完成，现在可以开始合成')
  } catch (error) {
    if (state.modelDownload.cancelling) {
      ElMessage.info('已取消模型下载')
    } else {
      const message = toErrorMessage(error)
      state.engineStatus.error = message
      ElMessage.error(message)
    }
  } finally {
    state.modelDownload.running = false
    state.modelDownload.cancelling = false
  }
}

export async function cancelModelDownload() {
  if (!state.modelDownload.running || state.modelDownload.cancelling) return

  state.modelDownload.cancelling = true
  state.modelDownload.message = '正在取消下载…'

  try {
    await window.api.cancelModelDownload(state.settings.engineId)
  } catch (error) {
    state.modelDownload.cancelling = false
    ElMessage.error(toErrorMessage(error))
  }
}

export async function openModelDir() {
  try {
    await window.api.openModelDir(state.settings.engineId)
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

export async function importTextFile() {
  if (state.job.running) return

  try {
    const file = await window.api.openTextFile()
    if (!file) return

    if (state.text.trim() && state.text.trim() !== String(file.content || '').trim()) {
      try {
        await ElMessageBox.confirm(
          `导入「${file.name}」将替换当前文稿，是否继续？`,
          '导入文本',
          {
            confirmButtonText: '替换',
            cancelButtonText: '取消',
            type: 'warning'
          }
        )
      } catch {
        return
      }
    }

    state.text = file.content || ''
    ElMessage.success(`已导入 ${file.name}（${file.encoding}）`)

    if (overLimit.value) {
      ElMessage.warning('导入的内容超过单次合成上限，请拆分为多次转换')
    }
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

export function useSampleText() {
  if (state.job.running) return
  if (state.text.trim()) return
  state.text = SAMPLE_TEXT
}

export async function clearText() {
  if (state.job.running) {
    ElMessage.warning('合成过程中无法清空文稿')
    return
  }
  if (!state.text) return

  try {
    await ElMessageBox.confirm('确定清空当前文稿吗？', '清空文稿', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }

  state.text = ''
}

export async function previewSelectedVoice() {
  if (state.previewLoading || state.job.running) return
  if (state.modelDownload.running) {
    ElMessage.warning('语音模型正在下载，请稍候')
    return
  }
  if (requiresModel.value && !engineReady.value) {
    ElMessage.warning('请先在左侧下载当前引擎的语音模型')
    return
  }
  if (requiresApiKey.value && !engineReady.value) {
    ElMessage.warning('请先在左侧填写 DeepSeek API Key')
    return
  }
  if (!state.settings.voiceName) {
    ElMessage.warning('请先选择声音')
    return
  }

  state.previewLoading = true

  try {
    const result = await window.api.previewVoice({
      engineId: state.settings.engineId,
      voiceName: state.settings.voiceName,
      rate: effectiveRate.value,
      volume: state.settings.volume
    })

    playTrack({
      key: `preview:${result.fileName}`,
      kind: 'preview',
      title: '声音试听',
      subtitle: voiceFullLabel(result.voice),
      url: result.url,
      jobId: 'preview',
      fileName: result.fileName,
      duration: result.duration
    })
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  } finally {
    state.previewLoading = false
  }
}

export function playSegment(segment) {
  const track = segmentTrack(segment)
  if (track) playTrack(track)
}

export function playFullAudio() {
  const track = fullAudioTrack()
  if (track) playTrack(track)
}

function nextSegmentAfter(index) {
  const position = state.result.segments.findIndex((segment) => segment.index === index)
  if (position < 0) return null
  return state.result.segments[position + 1] || null
}

function stopAutoFollow() {
  state.player.followJob = false
  state.player.waitingForNext = false
}

function startAutoPlaySegment(segment) {
  const track = segmentTrack(segment)
  if (!track) return

  if (state.player.track?.key === track.key) {
    state.player.followJob = true
    state.player.waitingForNext = false
    if (!state.player.playing) togglePlay()
    return
  }

  playTrack(track, { follow: true })
}

export async function togglePlay() {
  const audio = ensureAudio()

  if (!state.player.track) {
    if (state.result.ok) playFullAudio()
    return
  }

  if (audio.paused) {
    try {
      await audio.play()
    } catch (error) {
      handlePlayError(error)
    }
  } else {
    audio.pause()
  }
}

export function seekTo(seconds) {
  if (!state.player.track) return
  const audio = ensureAudio()
  const duration = Number.isFinite(audio.duration) && audio.duration > 0
    ? audio.duration
    : state.player.duration
  const value = Math.min(Math.max(0, Number(seconds) || 0), duration || 0)

  try {
    audio.currentTime = value
    state.player.currentTime = value
  } catch {
    // 忽略拖动过程中的边界错误
  }
}

export function playAdjacentSegment(offset) {
  if (state.player.track?.kind !== 'segment') return
  const position = state.result.segments.findIndex(
    (segment) => segment.index === state.player.track.index
  )
  const next = state.result.segments[position + offset]
  if (next) playSegment(next)
}

export function canPlayAdjacent(offset) {
  if (state.player.track?.kind !== 'segment') return false
  const position = state.result.segments.findIndex(
    (segment) => segment.index === state.player.track.index
  )
  if (position < 0) return false
  return Boolean(state.result.segments[position + offset])
}

export async function saveFullAudio() {
  const track = fullAudioTrack()
  if (track) await saveTrack(track)
}

export async function saveSegment(segment) {
  const track = segmentTrack(segment)
  if (track) await saveTrack(track)
}

export async function saveCurrentTrack() {
  if (state.player.track) await saveTrack(state.player.track)
}

export async function revealFullAudio() {
  if (!state.result.ok || !state.result.outputFileName) return
  await revealFile({
    jobId: state.result.jobId,
    fileName: state.result.outputFileName
  })
}

export async function revealSegment(segment) {
  if (!segment) return
  await revealFile({
    jobId: state.result.jobId,
    fileName: segment.fileName
  })
}

export async function revealCurrentTrack() {
  const track = state.player.track
  if (!track?.jobId || !track?.fileName) return
  await revealFile({ jobId: track.jobId, fileName: track.fileName })
}

async function saveTrack(track) {
  if (!track?.jobId || !track?.fileName) return

  try {
    const result = await window.api.saveAudio({
      jobId: track.jobId,
      fileName: track.fileName,
      defaultName: defaultFileNameFor(track)
    })

    if (result?.saved && result.filePath) {
      ElMessage({
        type: 'success',
        message: `已保存到：${result.filePath}`,
        duration: 6000,
        showClose: true
      })
    }
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

async function revealFile({ jobId, fileName }) {
  try {
    await window.api.reveal({ jobId, fileName })
  } catch (error) {
    ElMessage.error(toErrorMessage(error))
  }
}

export function defaultFileNameFor(track) {
  const stamp = timestampForFile()
  if (track.kind === 'segment') return `RyJS-TTS-第${track.index}段-${stamp}.wav`
  if (track.kind === 'preview') return `RyJS-TTS-声音试听-${stamp}.wav`
  return `RyJS-TTS-完整音频-${stamp}.wav`
}

function segmentTrack(segment) {
  if (!segment || !state.result.jobId) return null
  return {
    key: `seg:${state.result.jobId}:${segment.index}`,
    kind: 'segment',
    title: `第 ${segment.index} 段`,
    subtitle: `分段音频 · ${formatDuration(segment.duration)} · ${segment.charCount} 字`,
    url: segment.url,
    jobId: state.result.jobId,
    fileName: segment.fileName,
    duration: segment.duration,
    index: segment.index
  }
}

function fullAudioTrack() {
  const result = state.result
  if (!result.ok || !result.outputUrl || !result.jobId || !result.outputFileName) return null

  return {
    key: `full:${result.jobId}`,
    kind: 'full',
    title: '完整音频',
    subtitle: `${result.segments.length} 段已合并 · ${formatDuration(result.totalDuration)}`,
    url: result.outputUrl,
    jobId: result.jobId,
    fileName: result.outputFileName,
    duration: result.totalDuration
  }
}

function ensureAudio() {
  if (audioElement) return audioElement

  audioElement = new Audio()
  audioElement.preload = 'metadata'

  audioElement.addEventListener('loadedmetadata', () => {
    const duration = audioElement.duration
    if (Number.isFinite(duration) && duration > 0) state.player.duration = duration
    state.player.loading = false
  })

  audioElement.addEventListener('durationchange', () => {
    const duration = audioElement.duration
    if (Number.isFinite(duration) && duration > 0) state.player.duration = duration
  })

  audioElement.addEventListener('timeupdate', () => {
    state.player.currentTime = audioElement.currentTime || 0
  })

  audioElement.addEventListener('play', () => {
    state.player.playing = true
  })

  audioElement.addEventListener('pause', () => {
    state.player.playing = false
  })

  audioElement.addEventListener('waiting', () => {
    state.player.loading = true
  })

  audioElement.addEventListener('playing', () => {
    state.player.loading = false
  })

  audioElement.addEventListener('canplay', () => {
    state.player.loading = false
  })

  audioElement.addEventListener('ended', () => {
    state.player.playing = false

    if (state.player.followJob && state.player.track?.kind === 'segment') {
      const next = nextSegmentAfter(state.player.track.index)

      if (next) {
        state.player.waitingForNext = false
        startAutoPlaySegment(next)
        return
      }

      if (state.job.running) {
        state.player.waitingForNext = true
        state.player.loading = false
        if (Number.isFinite(audioElement.duration)) {
          state.player.currentTime = audioElement.duration
        }
        return
      }
    }

    state.player.followJob = false
    if (Number.isFinite(audioElement.duration)) {
      state.player.currentTime = audioElement.duration
    }
  })

  audioElement.addEventListener('error', () => {
    state.player.loading = false
    state.player.playing = false
    const url = state.player.track?.url || ''
    if (url && url !== lastAudioErrorUrl) {
      lastAudioErrorUrl = url
      state.player.error = '音频加载失败'
      ElMessage.error('音频加载失败，请尝试重新合成')
    }
  })

  return audioElement
}

function playTrack(track, options = {}) {
  if (!track?.url) return
  const audio = ensureAudio()
  const follow = Boolean(options.follow)

  state.player.followJob = follow
  state.player.waitingForNext = false

  if (state.player.track?.key === track.key) {
    if (follow) {
      if (audio.paused) {
        audio.play().catch((error) => handlePlayError(error))
      }
      return
    }
    togglePlay()
    return
  }

  audio.pause()
  state.player.track = track
  state.player.currentTime = 0
  state.player.duration = track.duration || 0
  state.player.loading = true
  state.player.error = ''
  lastAudioErrorUrl = ''
  audio.src = track.url

  audio.play().catch((error) => {
    handlePlayError(error)
  })
}

function handlePlayError(error) {
  state.player.loading = false
  if (error?.name === 'AbortError') return
  state.player.playing = false
  const message = error?.name === 'NotAllowedError'
    ? '系统阻止了音频播放，请重试'
    : '音频播放失败，请重新合成后再试'
  ElMessage.error(message)
}

function stopPlayback() {
  state.player.track = null
  state.player.playing = false
  state.player.loading = false
  state.player.currentTime = 0
  state.player.duration = 0
  state.player.error = ''
  state.player.followJob = false
  state.player.waitingForNext = false
  lastAudioErrorUrl = ''

  if (!audioElement) return
  audioElement.pause()
  audioElement.removeAttribute('src')
  audioElement.load()
}

function bindIpcEvents() {
  if (ipcBound) return
  ipcBound = true

  window.api.onProgress((payload) => {
    if (!payload || payload.jobId !== state.job.jobId) return

    if (typeof payload.phase === 'string') state.job.phase = payload.phase
    if (typeof payload.message === 'string' && payload.message) state.job.message = payload.message
    if (Number.isFinite(payload.current)) state.job.current = payload.current
    if (Number.isFinite(payload.total) && payload.total > 0) state.job.total = payload.total

    if (payload.phase === 'fallback') {
      state.result.segments = []
      state.result.totalDuration = 0
      state.job.followSegments = true
      ElMessage.warning(payload.message || '整篇合成未成功，已自动改为分段合成')
    }
  })

  window.api.onSegment((payload) => {
    if (!payload || payload.jobId !== state.job.jobId || !payload.segment) return

    const entries = state.result.segments
    const position = entries.findIndex((item) => item.index === payload.segment.index)

    if (position >= 0) entries.splice(position, 1, payload.segment)
    else entries.push(payload.segment)

    entries.sort((a, b) => a.index - b.index)

    if (Number.isFinite(payload.total) && payload.total > 0) state.job.total = payload.total
    if (Number.isFinite(payload.completed)) state.job.current = payload.completed

    if (
      state.settings.autoPlay &&
      state.job.running &&
      state.job.followSegments &&
      !state.job.autoStarted &&
      !state.player.track
    ) {
      state.job.autoStarted = true
      startAutoPlaySegment(entries[0])
    }

    if (state.player.followJob && state.player.waitingForNext) {
      const current = state.player.track
      if (current?.kind === 'segment') {
        const next = nextSegmentAfter(current.index)
        if (next) {
          state.player.waitingForNext = false
          startAutoPlaySegment(next)
        }
      }
    }
  })

  window.api.onModelProgress?.((payload) => {
    if (!payload || payload.engineId !== state.modelDownload.engineId) return

    if (Number.isFinite(payload.percent)) {
      state.modelDownload.percent = Math.max(0, Math.min(100, payload.percent))
    }
    if (Number.isFinite(payload.received)) state.modelDownload.received = payload.received
    if (Number.isFinite(payload.total) && payload.total > 0) {
      state.modelDownload.total = payload.total
    }
    if (typeof payload.phase === 'string') state.modelDownload.phase = payload.phase
    if (typeof payload.message === 'string' && payload.message) {
      state.modelDownload.message = payload.message
    }
  })
}

function scheduleEstimate() {
  clearTimeout(estimateTimer)
  estimateTimer = setTimeout(() => {
    const chunks = splitText(state.text, {
      maxChars: state.settings.maxChars,
      mode: state.settings.mode
    })
    state.estimate.segments = chunks.length
    state.estimate.seconds = estimateDurationSeconds(state.text, effectiveRate.value)
  }, 120)
}

watch(
  [
    () => state.text,
    () => state.settings.mode,
    () => state.settings.maxChars,
    () => effectiveRate.value
  ],
  scheduleEstimate,
  { immediate: true }
)

watch(
  () => state.settings,
  (settings) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // 本地存储不可用时忽略
    }
  },
  { deep: true }
)

watch(
  () => state.settings.engineId,
  (engineId, previous) => {
    if (!state.ready || engineId === previous) return

    state.voices = []
    state.engineStatus = {
      ...state.engineStatus,
      engineId,
      ready: false,
      loading: true,
      error: ''
    }

    loadVoices()
    refreshEngineStatus()
    refreshAiStatus()
  }
)

export function voiceTitle(voice) {
  if (!voice) return ''
  return (
    voice.displayName ||
    VOICE_ALIASES[voice.name] ||
    voice.name.replace(/^Microsoft\s+/i, '').replace(/\s+Desktop$/i, '')
  )
}

export function voiceMeta(voice) {
  if (!voice) return ''
  const language = LANGUAGE_LABELS[String(voice.culture || '').toLowerCase()] || voice.culture || ''
  const gender = voice.gender === 'Female' ? '女声' : voice.gender === 'Male' ? '男声' : ''
  return [gender, language].filter(Boolean).join(' · ')
}

export function voiceFullLabel(voice) {
  if (!voice) return ''
  return [voiceTitle(voice), voiceMeta(voice)].filter(Boolean).join(' · ')
}

function loadSettings() {
  const defaults = { ...DEFAULT_SETTINGS }

  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return defaults

    return {
      engineId: typeof raw.engineId === 'string' && raw.engineId ? raw.engineId : defaults.engineId,
      voiceName: typeof raw.voiceName === 'string' ? raw.voiceName : '',
      rate: clampInt(raw.rate, -10, 10, defaults.rate),
      volume: clampInt(raw.volume, 0, 100, defaults.volume),
      mode: raw.mode === 'single' ? 'single' : 'auto',
      maxChars: clampInt(raw.maxChars, 100, 2000, defaults.maxChars),
      gapMs: clampInt(raw.gapMs, 0, 2000, defaults.gapMs),
      autoPlay: raw.autoPlay !== false
    }
  } catch {
    return defaults
  }
}

function emptyResult() {
  return {
    ok: false,
    done: false,
    cancelled: false,
    error: '',
    jobId: null,
    outputUrl: null,
    outputFileName: null,
    totalDuration: 0,
    chars: 0,
    segmentCount: 0,
    modeUsed: '',
    fallbackApplied: false,
    voice: null,
    segments: [],
    startedAt: null,
    createdAt: null
  }
}

function createJobId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()

  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  return `job-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function timestampForFile() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('')
}
