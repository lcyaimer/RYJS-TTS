<script setup>
import { computed, ref, watch } from 'vue'
import {
  Connection,
  Download,
  FolderOpened,
  Headset,
  Key,
  Lock,
  RefreshRight,
  VideoPlay,
  WarningFilled
} from '@element-plus/icons-vue'
import {
  state,
  enabledVoices,
  currentEngine,
  currentVoice,
  loadVoices,
  previewSelectedVoice,
  voiceMeta,
  voiceTitle,
  requiresModel,
  requiresApiKey,
  engineReady,
  engineSupportsSpeed,
  downloadCurrentModel,
  cancelModelDownload,
  openModelDir,
  saveDeepSeekKey,
  testDeepSeekKey,
  clearDeepSeekKey,
  chooseStoragePath
} from '../store'
import { formatBytes } from '../utils'

const engines = computed(() => {
  if (state.appInfo.engines?.length) return state.appInfo.engines
  return [
    {
      id: 'sapi',
      name: 'Windows 本地语音',
      description: '正在读取本地语音…',
      local: true
    }
  ]
})

const engineDescription = computed(
  () => currentEngine.value?.description || '使用本地语音引擎，文稿不会上传'
)

const rateLabel = computed(() => {
  if (!engineSupportsSpeed.value) return '固定'
  const rate = state.settings.rate
  if (rate === 0) return '标准'
  return rate > 0 ? `快 +${rate}` : `慢 ${Math.abs(rate)}`
})

const onlineEngine = computed(() => currentEngine.value?.local === false)
const apiKeyDraft = ref('')
const keyEditorOpen = ref(false)

watch(
  () => state.settings.engineId,
  () => {
    apiKeyDraft.value = ''
    keyEditorOpen.value = !state.aiStatus.hasKey
  },
  { immediate: true }
)

watch(
  () => state.aiStatus.hasKey,
  (hasKey) => {
    if (hasKey) keyEditorOpen.value = false
  }
)

async function handleSaveKey() {
  const saved = await saveDeepSeekKey(apiKeyDraft.value)
  if (!saved) return

  apiKeyDraft.value = ''
  keyEditorOpen.value = false
  await testDeepSeekKey()
}

async function handleClearKey() {
  const cleared = await clearDeepSeekKey()
  if (cleared) {
    apiKeyDraft.value = ''
    keyEditorOpen.value = true
  }
}

const gapLabel = computed(() =>
  state.settings.gapMs === 0 ? '无停顿' : `${state.settings.gapMs} 毫秒`
)

const modeHint = computed(() =>
  state.settings.mode === 'auto'
    ? '按段落与句末标点智能切分，长文更稳定，也能逐段试听。'
    : '整篇一次合成；若引擎不支持或中途失败，会自动切换为分段合成。'
)

const modelInfo = computed(() => currentEngine.value?.model || {})
const downloadPercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(state.modelDownload.percent || 0)))
)
const downloadBytes = computed(() => {
  if (!state.modelDownload.received) return ''
  const total = state.modelDownload.total || modelInfo.value.sizeBytes || 0
  return `${formatBytes(state.modelDownload.received)} / ${formatBytes(total)}`
})

const pathItems = computed(() => [
  {
    kind: 'models',
    label: '模型目录',
    value: state.paths.modelsDir,
    hint: 'Piper / Kokoro 模型下载位置'
  },
  {
    kind: 'cache',
    label: '合成缓存',
    value: state.paths.cacheDir,
    hint: '生成的音频缓存，自动清理 3 天前的任务'
  },
  {
    kind: 'export',
    label: '默认保存目录',
    value: state.paths.exportDir,
    hint: '点击「下载音频」时默认打开的目录'
  }
])
</script>

<template>
  <div class="flex flex-col gap-4">
    <section class="panel p-4">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="section-title">语音引擎</h2>
        <span
          class="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[9px] font-semibold tracking-[0.08em] ring-1 ring-inset"
          :class="
            onlineEngine
              ? 'bg-amber-50 text-amber-700 ring-amber-100'
              : 'bg-emerald-50 text-emerald-700 ring-emerald-100'
          "
        >
          <span
            class="h-1 w-1 rounded-full"
            :class="onlineEngine ? 'bg-amber-500' : 'bg-emerald-500'"
          ></span>
          {{ onlineEngine ? 'ONLINE' : 'LOCAL' }}
        </span>
      </div>

      <el-select
        v-model="state.settings.engineId"
        class="w-full"
        :disabled="state.job.running || state.modelDownload.running"
        placeholder="选择语音引擎"
      >
        <el-option
          v-for="engine in engines"
          :key="engine.id"
          :label="engine.name"
          :value="engine.id"
        >
          <div class="flex w-full items-center justify-between gap-3">
            <span>{{ engine.name }}</span>
            <span
              class="text-[10px]"
              :class="engine.local ? 'text-emerald-600' : 'text-amber-600'"
            >
              {{ engine.local ? '本地' : '在线' }}
            </span>
          </div>
        </el-option>
      </el-select>

      <p class="mt-2 text-[10.5px] leading-relaxed text-ink-400">
        {{ engineDescription }}
      </p>

      <div
        v-if="requiresApiKey"
        class="mt-3 rounded-xl border border-amber-200/70 bg-amber-50/50 p-3"
      >
        <div class="flex items-start gap-2">
          <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-amber-600 shadow-sm ring-1 ring-amber-100/80">
            <Key class="h-3.5 w-3.5" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <p class="text-[11px] font-semibold text-ink-700">DeepSeek API Key</p>
              <span
                class="shrink-0 rounded-full px-1.5 py-[1px] text-[9px] font-medium"
                :class="
                  state.aiStatus.hasKey
                    ? 'bg-emerald-100/80 text-emerald-700'
                    : 'bg-amber-100/80 text-amber-700'
                "
              >
                {{ state.aiStatus.hasKey ? '已保存' : '未设置' }}
              </span>
            </div>

            <p v-if="state.aiStatus.hasKey && !keyEditorOpen" class="mt-0.5 text-[10px] leading-relaxed text-ink-400">
              {{
                state.aiStatus.source === 'env'
                  ? '来自环境变量 DEEPSEEK_API_KEY'
                  : state.aiStatus.persisted
                    ? '已使用系统安全存储加密保存在本机'
                    : '系统安全存储不可用，仅在本次运行有效'
              }}
            </p>
            <p v-else class="mt-0.5 text-[10px] leading-relaxed text-ink-400">
              填入 Key 即可使用海星 / 暗潮音色。文稿会发送到 DeepSeek，并按字符计费。
            </p>

            <div v-if="!state.aiStatus.hasKey || keyEditorOpen" class="mt-2 space-y-2">
              <el-input
                v-model="apiKeyDraft"
                type="password"
                show-password
                placeholder="sk-..."
                autocomplete="new-password"
                spellcheck="false"
                :disabled="state.aiStatus.saving || state.aiStatus.testing"
              />
              <div class="flex flex-wrap items-center gap-2">
                <el-button
                  size="small"
                  type="primary"
                  :loading="state.aiStatus.saving || state.aiStatus.testing"
                  @click="handleSaveKey"
                >
                  保存并测试
                </el-button>
                <button
                  v-if="state.aiStatus.hasKey"
                  class="text-[10px] text-ink-400 hover:text-brand-600"
                  @click="keyEditorOpen = false"
                >
                  取消
                </button>
              </div>
              <p class="text-[9px] leading-relaxed text-ink-300">
                请在 platform.deepseek.com 创建 API Key。测试连接和声音试听都会实际调用 DeepSeek，产生少量字符费用。
              </p>
            </div>

            <div v-else class="mt-2 flex flex-wrap items-center gap-2">
              <el-button size="small" :loading="state.aiStatus.testing" @click="testDeepSeekKey">
                测试连接
              </el-button>
              <button class="text-[10px] text-ink-400 hover:text-brand-600" @click="keyEditorOpen = true">
                更换 Key
              </button>
              <button class="text-[10px] text-rose-400 hover:text-rose-600" @click="handleClearKey">
                清除
              </button>
            </div>

            <p v-if="state.aiStatus.error" class="mt-2 text-[9.5px] leading-relaxed text-rose-500">
              {{ state.aiStatus.error }}
            </p>
            <p v-else-if="state.aiStatus.message" class="mt-2 text-[9.5px] leading-relaxed text-emerald-600">
              {{ state.aiStatus.message }}
            </p>

            <p class="mt-1.5 text-[9px] leading-relaxed text-ink-300">
              DeepSeek 暂不支持调节语速；文本会上传云端，请勿处理敏感内容。
            </p>
          </div>
        </div>
      </div>

      <div
        v-if="requiresModel && !engineReady && !state.engineStatus.loading"
        class="mt-3 rounded-xl border border-brand-100/80 bg-brand-50/40 p-3"
      >
        <div class="flex items-start gap-2">
          <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 shadow-sm ring-1 ring-brand-100/70">
            <Download class="h-3.5 w-3.5" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <p class="text-[11px] font-semibold text-ink-700">需要语音模型</p>
              <span class="shrink-0 text-[9.5px] text-ink-300">
                {{ formatBytes(modelInfo.sizeBytes) }}
              </span>
            </div>
            <p class="mt-0.5 text-[10px] leading-relaxed text-ink-400">
              {{ modelInfo.name || currentEngine?.name }} 首次使用需下载，完成后完全离线，文稿不会上传。
            </p>
            <p class="mt-0.5 text-[9px] leading-relaxed text-ink-300">
              许可：{{ modelInfo.license }}
            </p>

            <div v-if="state.modelDownload.running" class="mt-2.5">
              <div class="progress-track h-1.5">
                <div class="progress-fill" :style="{ width: `${downloadPercent}%` }"></div>
              </div>
              <div class="mt-1 flex items-center justify-between gap-2 text-[9.5px] text-ink-400">
                <span class="truncate">{{ state.modelDownload.message }}</span>
                <button
                  class="cancel-link"
                  :disabled="state.modelDownload.cancelling"
                  @click="cancelModelDownload"
                >
                  {{ state.modelDownload.cancelling ? '取消中…' : '取消' }}
                </button>
              </div>
              <div class="mt-0.5 flex items-center justify-between text-[9px] text-ink-300">
                <span>{{ downloadBytes }}</span>
                <span class="tabular-nums">{{ downloadPercent }}%</span>
              </div>
            </div>

            <div v-else class="mt-2.5 flex flex-wrap items-center gap-2">
              <el-button size="small" type="primary" @click="downloadCurrentModel">
                <el-icon class="mr-1"><Download /></el-icon>
                下载模型
              </el-button>
              <button
                class="inline-flex items-center gap-1 text-[10px] text-ink-400 hover:text-brand-600"
                @click="openModelDir"
              >
                <FolderOpened class="h-3 w-3" />
                打开模型目录
              </button>
            </div>

            <p
              v-if="state.engineStatus.error"
              class="mt-2 text-[9.5px] leading-relaxed text-rose-500"
            >
              {{ state.engineStatus.error }}
            </p>
          </div>
        </div>
      </div>

      <div class="my-4 h-px bg-slate-100"></div>

      <div class="mb-1.5 flex items-center justify-between gap-2">
        <label class="field-label">声音</label>
        <span class="truncate text-[10px] text-ink-300">
          {{ currentVoice ? voiceMeta(currentVoice) : '未选择' }}
        </span>
      </div>

      <div class="flex gap-2">
        <el-select
          v-model="state.settings.voiceName"
          class="min-w-0 flex-1"
          :loading="state.voicesLoading"
          :disabled="state.job.running || !engineReady || !enabledVoices.length"
          placeholder="选择声音"
        >
          <el-option
            v-for="voice in enabledVoices"
            :key="voice.name"
            :label="voiceTitle(voice)"
            :value="voice.name"
          >
            <div class="flex w-full items-center justify-between gap-3">
              <span>{{ voiceTitle(voice) }}</span>
              <span class="text-[10px] text-ink-300">{{ voiceMeta(voice) }}</span>
            </div>
          </el-option>
        </el-select>

        <el-button
          class="voice-preview-btn"
          :loading="state.previewLoading"
          :disabled="state.job.running || !engineReady || !state.settings.voiceName"
          @click="previewSelectedVoice"
        >
          <el-icon v-if="!state.previewLoading" class="mr-1"><VideoPlay /></el-icon>
          试听
        </el-button>
      </div>

      <div
        v-if="state.voicesError"
        class="mt-2.5 rounded-xl border border-amber-200/70 bg-amber-50/80 px-3 py-2 text-[10.5px] leading-relaxed text-amber-700"
      >
        <div class="flex gap-2">
          <WarningFilled class="mt-[1px] h-3.5 w-3.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <p>{{ state.voicesError }}</p>
            <button
              class="mt-1 inline-flex items-center gap-1 font-semibold text-amber-800 hover:underline"
              @click="loadVoices"
            >
              <RefreshRight class="h-3 w-3" />
              重新读取
            </button>
          </div>
        </div>
      </div>

      <p
        v-else-if="state.voicesLoading"
        class="mt-2 flex items-center gap-1.5 text-[10.5px] text-ink-400"
      >
        <span class="spinner"></span>
        正在读取系统语音…
      </p>

      <div class="mt-4 space-y-3">
        <div>
          <div class="mb-0.5 flex items-center justify-between">
            <span class="field-label">语速</span>
            <span class="field-value">{{ rateLabel }}</span>
          </div>
          <el-slider
            v-model="state.settings.rate"
            :min="-10"
            :max="10"
            :step="1"
            :show-tooltip="false"
            :disabled="state.job.running || !engineSupportsSpeed"
          />
          <p v-if="!engineSupportsSpeed" class="text-[9.5px] text-ink-300">
            当前引擎暂不支持调节语速
          </p>
        </div>

        <div>
          <div class="mb-0.5 flex items-center justify-between">
            <span class="field-label">音量</span>
            <span class="field-value">{{ state.settings.volume }}%</span>
          </div>
          <el-slider
            v-model="state.settings.volume"
            :min="0"
            :max="100"
            :step="5"
            :show-tooltip="false"
            :disabled="state.job.running"
          />
        </div>
      </div>
    </section>

    <section class="panel p-4">
      <div class="mb-3 flex items-center gap-2">
        <Headset class="h-3.5 w-3.5 text-ink-300" />
        <h2 class="section-title">切分与节奏</h2>
      </div>

      <el-segmented
        v-model="state.settings.mode"
        :options="[
          { label: '自动分段', value: 'auto' },
          { label: '整篇一次', value: 'single' }
        ]"
        :disabled="state.job.running"
      />

      <p class="mt-2 min-h-[30px] text-[10.5px] leading-relaxed text-ink-400">
        {{ modeHint }}
      </p>

      <div v-if="state.settings.mode === 'auto'" class="mt-2">
        <div class="mb-0.5 flex items-center justify-between">
          <span class="field-label">单段上限</span>
          <span class="field-value">{{ state.settings.maxChars }} 字</span>
        </div>
        <el-slider
          v-model="state.settings.maxChars"
          :min="100"
          :max="2000"
          :step="50"
          :show-tooltip="false"
          :disabled="state.job.running"
        />
        <div class="flex justify-between text-[9.5px] text-ink-300">
          <span>短段 · 更细</span>
          <span>长段 · 更少请求</span>
        </div>
      </div>

      <div class="mt-3">
        <div class="mb-0.5 flex items-center justify-between">
          <span class="field-label">段间停顿</span>
          <span class="field-value">{{ gapLabel }}</span>
        </div>
        <el-slider
          v-model="state.settings.gapMs"
          :min="0"
          :max="2000"
          :step="100"
          :show-tooltip="false"
          :disabled="state.job.running"
        />
        <p class="text-[9.5px] text-ink-300">仅作用于导出的完整音频</p>
      </div>

      <div class="mt-3 flex items-start justify-between gap-3 border-t border-slate-100 pt-3">
        <div class="min-w-0">
          <span class="field-label">合成后自动播放</span>
          <p class="mt-0.5 text-[9.5px] leading-relaxed text-ink-300">
            分段合成时第 1 段完成即开始播放，并自动续播后续分段。
          </p>
        </div>
        <el-switch
          v-model="state.settings.autoPlay"
          :disabled="state.job.running || state.modelDownload.running"
        />
      </div>
    </section>

    <section class="panel p-4">
      <div class="mb-3 flex items-center gap-2">
        <FolderOpened class="h-3.5 w-3.5 text-ink-300" />
        <h2 class="section-title">存储路径</h2>
      </div>

      <p v-if="state.pathsLoading" class="flex items-center gap-1.5 text-[10px] text-ink-400">
        <span class="spinner"></span>
        正在读取路径…
      </p>

      <div v-else class="space-y-3.5">
        <div v-for="item in pathItems" :key="item.kind">
          <div class="mb-1 flex items-center justify-between gap-2">
            <span class="field-label">{{ item.label }}</span>
            <el-button
              text
              size="small"
              :disabled="
                state.job.running || state.modelDownload.running || state.pathChanging
              "
              @click="chooseStoragePath(item.kind)"
            >
              更改
            </el-button>
          </div>
          <p
            class="break-all rounded-lg bg-slate-50/80 px-2 py-1.5 font-mono text-[9px] leading-relaxed text-ink-400"
            :title="item.value"
          >
            {{ item.value || '未设置' }}
          </p>
          <p class="mt-0.5 text-[9px] leading-relaxed text-ink-300">{{ item.hint }}</p>
        </div>
      </div>

      <p v-if="state.pathsError" class="mt-2 text-[9.5px] text-rose-500">
        {{ state.pathsError }}
      </p>
      <p class="mt-2.5 text-[9px] leading-relaxed text-ink-300">
        更改模型目录不会自动移动已有模型；更改缓存目录后需重新合成当前文稿。
      </p>
    </section>

    <section
      class="rounded-2xl border p-3.5 shadow-[0_12px_30px_-26px_rgba(76,55,209,0.55)]"
      :class="
        onlineEngine
          ? 'border-amber-200/70 bg-gradient-to-br from-amber-50/90 via-white to-white'
          : 'border-brand-100/80 bg-gradient-to-br from-brand-50/90 via-white to-white'
      "
    >
      <div
        class="flex items-center gap-1.5 text-[11px] font-semibold"
        :class="onlineEngine ? 'text-amber-700' : 'text-brand-700'"
      >
        <Connection v-if="onlineEngine" class="h-3.5 w-3.5" />
        <Lock v-else class="h-3.5 w-3.5" />
        {{ onlineEngine ? '在线合成' : '本地合成' }}
      </div>
      <p class="mt-1.5 text-[10.5px] leading-relaxed text-ink-400">
        {{
          onlineEngine
            ? 'DeepSeek 会收到待合成文稿并按字符计费；API Key 仅加密保存在本机。切换到本地引擎可完全离线。'
            : '文稿只在本机合成，不会上传。Windows 语音（仅 Windows）可直接使用；Piper / Kokoro 首次需下载模型，下载后即可完全离线。'
        }}
      </p>
      <div
        class="mt-2 flex items-center gap-1.5 border-t pt-2 text-[9.5px] text-ink-300"
        :class="onlineEngine ? 'border-amber-100/70' : 'border-brand-100/60'"
      >
        <Connection class="h-3 w-3" />
        {{ onlineEngine ? '在线引擎 · 需要网络' : '引擎可扩展 · 后续可接入大模型 API' }}
      </div>
    </section>
  </div>
</template>
