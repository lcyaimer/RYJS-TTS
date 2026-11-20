<script setup>
import { computed } from 'vue'
import {
  Clock,
  Document,
  FolderOpened,
  Lock,
  Microphone
} from '@element-plus/icons-vue'
import {
  state,
  charCount,
  overLimit,
  canStart,
  progressPercent,
  completedSegments,
  startSynthesis,
  cancelSynthesis,
  importTextFile,
  clearText,
  useSampleText,
  requiresModel,
  requiresApiKey,
  engineReady
} from '../store'
import { formatNumber, humanDuration } from '../utils'

const placeholder = `在这里粘贴或输入你的文稿…

支持数万字长文，会自动按段落与标点切分。
完成后可逐段试听，并导出合并后的完整音频。
提示：按 Ctrl + Enter 可以直接开始合成。`

const estimateSegments = computed(() => state.estimate.segments)
const estimateDuration = computed(() =>
  state.estimate.seconds ? `约 ${humanDuration(state.estimate.seconds)}` : '约 0 秒'
)
const maxCharsLabel = computed(() =>
  formatNumber(state.appInfo.maxTextChars || 200000)
)
</script>

<template>
  <section class="panel flex min-h-0 flex-col overflow-hidden">
    <div class="flex shrink-0 items-center gap-3 border-b border-slate-100/80 px-5 py-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="section-icon">
          <Document />
        </span>
        <div class="min-w-0">
          <h2 class="text-[13px] font-semibold text-ink-900">文稿</h2>
          <p class="truncate text-[10px] text-ink-400">支持数万字长文，自动按标点切分</p>
        </div>
      </div>

      <div class="ml-auto flex shrink-0 items-center gap-1">
        <span class="char-badge mr-1" :class="{ 'is-over': overLimit }">
          {{ formatNumber(charCount) }} 字
        </span>

        <el-button text size="small" :disabled="state.job.running" @click="importTextFile">
          <FolderOpened class="mr-1 h-3.5 w-3.5" />
          导入
        </el-button>

        <el-button v-if="!state.text" text size="small" @click="useSampleText">
          使用示例
        </el-button>

        <el-button
          v-else
          text
          size="small"
          :disabled="state.job.running"
          @click="clearText"
        >
          清空
        </el-button>
      </div>
    </div>

    <div class="editor-shell relative min-h-0 flex-1">
      <textarea
        id="script-input"
        v-model="state.text"
        class="script-textarea"
        :readonly="state.job.running"
        :placeholder="placeholder"
        spellcheck="false"
        aria-label="需要转换的文稿"
      ></textarea>

      <div
        v-if="state.job.running"
        class="absolute right-4 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] text-ink-400 shadow-sm ring-1 ring-slate-100"
      >
        <Lock class="h-3 w-3" />
        合成中已锁定
      </div>
    </div>

    <div class="shrink-0 border-t border-slate-100/80 bg-slate-50/40 px-5 py-3">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-400">
          <span class="estimate-chip">
            <Document />
            {{ estimateSegments }} 段
          </span>
          <span class="estimate-chip">
            <Clock />
            {{ estimateDuration }}
          </span>
          <span v-if="overLimit" class="font-medium text-rose-500">
            超过 {{ maxCharsLabel }} 字上限
          </span>
          <span
            v-else-if="requiresModel && !engineReady && !state.engineStatus.loading"
            class="font-medium text-amber-600"
          >
            请先在左侧下载模型
          </span>
          <span
            v-else-if="requiresApiKey && !engineReady && !state.engineStatus.loading"
            class="font-medium text-amber-600"
          >
            请先在左侧填写 DeepSeek API Key
          </span>
          <span v-else class="hidden text-ink-300 xl:inline">
            分段合成 · 每段可单独试听
          </span>
        </div>

        <div class="ml-auto flex items-center gap-2">
          <div
            v-if="state.job.running"
            class="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[11px] text-ink-500 ring-1 ring-slate-100"
          >
            <span class="spinner"></span>
            <span class="max-w-[210px] truncate">{{ state.job.message }}</span>
            <button
              class="cancel-link"
              :disabled="state.job.cancelling"
              @click="cancelSynthesis"
            >
              {{ state.job.cancelling ? '取消中…' : '取消' }}
            </button>
          </div>

          <el-button
            v-else
            id="btn-synthesize"
            class="btn-primary-gradient h-10 rounded-xl px-5 text-[12.5px]"
            type="primary"
            :disabled="!canStart"
            @click="startSynthesis"
          >
            <Microphone class="mr-1.5 h-4 w-4" />
            开始合成
          </el-button>
        </div>
      </div>

      <div v-if="state.job.running" class="mt-2.5">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${progressPercent}%` }"></div>
        </div>
        <div class="mt-1.5 flex items-center justify-between text-[9.5px] text-ink-300">
          <span>
            {{
              state.job.phase === 'merging'
                ? '正在合并完整音频…'
                : `已完成 ${completedSegments} / ${state.job.total || '—'} 段`
            }}
          </span>
          <span class="tabular-nums">{{ progressPercent }}%</span>
        </div>
      </div>
    </div>
  </section>
</template>
