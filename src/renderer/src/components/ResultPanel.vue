<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import {
  Download,
  FolderOpened,
  Headset,
  VideoPause,
  VideoPlay,
  WarningFilled
} from '@element-plus/icons-vue'
import {
  state,
  playSegment,
  playFullAudio,
  togglePlay,
  saveFullAudio,
  saveSegment,
  revealFullAudio,
  revealSegment
} from '../store'
import { formatDuration } from '../utils'

const listRef = ref(null)
const segments = computed(() => state.result.segments)

const isFullActive = computed(() => state.player.track?.kind === 'full')
const showError = computed(
  () => !state.result.ok && !state.result.cancelled && Boolean(state.result.error)
)

const modeLabel = computed(() => {
  if (state.result.fallbackApplied) return '已自动分段合成'
  if (state.result.modeUsed === 'single') return '整篇一次合成'
  return '自动分段合成'
})

const skeletonWidths = ['88%', '72%', '82%', '64%']

watch(
  () => state.result.segments.length,
  async () => {
    if (!state.job.running) return
    await nextTick()
    const element = listRef.value
    if (!element) return
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 140
    if (nearBottom) element.scrollTop = element.scrollHeight
  }
)

function isSegmentActive(segment) {
  return (
    state.player.track?.kind === 'segment' &&
    state.player.track.index === segment.index
  )
}

function handleFullPlay() {
  if (isFullActive.value) togglePlay()
  else playFullAudio()
}

function handleSegmentPlay(segment) {
  if (isSegmentActive(segment)) togglePlay()
  else playSegment(segment)
}
</script>

<template>
  <section class="panel flex min-h-0 flex-col overflow-hidden">
    <div class="flex shrink-0 items-center gap-3 border-b border-slate-100/80 px-5 py-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="section-icon">
          <Headset />
        </span>
        <div class="flex min-w-0 items-baseline gap-2">
          <h2 class="text-[13px] font-semibold text-ink-900">试听与导出</h2>
          <span
            v-if="segments.length"
            class="rounded-full bg-slate-100/80 px-1.5 py-[1px] text-[9.5px] font-medium tabular-nums text-ink-400"
          >
            {{ segments.length }} 段
          </span>
          <span
            v-if="state.result.ok"
            class="text-[10px] tabular-nums text-ink-300"
          >
            {{ formatDuration(state.result.totalDuration) }}
          </span>
        </div>
      </div>

      <div class="ml-auto flex shrink-0 items-center gap-0.5">
        <el-button text size="small" :disabled="!state.result.ok" @click="handleFullPlay">
          <VideoPause
            v-if="isFullActive && state.player.playing"
            class="mr-1 h-3.5 w-3.5"
          />
          <VideoPlay v-else class="mr-1 h-3.5 w-3.5" />
          {{ isFullActive && state.player.playing ? '暂停' : '播放全部' }}
        </el-button>
        <el-button text size="small" :disabled="!state.result.ok" @click="saveFullAudio">
          <Download class="mr-1 h-3.5 w-3.5" />
          下载音频
        </el-button>
        <span class="mx-1 h-3 w-px bg-slate-200"></span>
        <button
          class="icon-btn"
          :disabled="!state.result.ok"
          title="在文件夹中显示完整音频"
          aria-label="在文件夹中显示完整音频"
          @click="revealFullAudio"
        >
          <FolderOpened />
        </button>
      </div>
    </div>

    <div ref="listRef" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
      <div
        v-if="state.result.cancelled"
        class="mb-2 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-[10.5px] leading-relaxed text-amber-700"
      >
        已取消合成，已经完成的段落仍可试听和下载。
      </div>

      <div
        v-else-if="showError"
        class="error-banner mb-2 flex gap-2 rounded-xl px-3 py-2 text-[10.5px] leading-relaxed"
      >
        <WarningFilled class="mt-[1px] h-3.5 w-3.5 shrink-0" />
        <div class="min-w-0">
          <p class="font-medium">{{ state.result.error }}</p>
          <p v-if="segments.length" class="mt-0.5 opacity-75">
            已生成的段落仍可单独试听和下载。
          </p>
        </div>
      </div>

      <div
        v-if="state.result.ok"
        class="full-audio-card mx-1 mb-2 flex items-center gap-3 rounded-xl px-3.5 py-2.5"
      >
        <button
          class="play-circle"
          :aria-label="isFullActive && state.player.playing ? '暂停完整音频' : '播放完整音频'"
          @click="handleFullPlay"
        >
          <VideoPause v-if="isFullActive && state.player.playing" />
          <VideoPlay v-else />
        </button>
        <div class="min-w-0 flex-1">
          <div class="text-[11.5px] font-semibold text-ink-900">完整音频</div>
          <div class="mt-0.5 truncate text-[9.5px] text-ink-400">
            {{ modeLabel }} · {{ segments.length }} 段已合并 ·
            {{ formatDuration(state.result.totalDuration) }}
          </div>
        </div>
        <span
          class="hidden rounded-full bg-white/70 px-2 py-1 text-[9px] font-medium text-brand-600 ring-1 ring-inset ring-brand-100 sm:inline"
        >
          WAV
        </span>
        <button
          class="icon-btn bg-white/60"
          title="下载完整音频"
          aria-label="下载完整音频"
          @click="saveFullAudio"
        >
          <Download />
        </button>
      </div>

      <div v-if="state.job.running && !segments.length" class="px-2 pt-1">
        <div class="mb-3 flex items-center gap-2 text-[10.5px] text-ink-400">
          <span class="spinner"></span>
          {{ state.job.message || '正在生成音频…' }}
        </div>
        <div
          v-for="(width, index) in skeletonWidths"
          :key="index"
          class="flex items-center gap-3 px-1 py-2"
        >
          <div class="skeleton h-7 w-7 rounded-full"></div>
          <div class="min-w-0 flex-1 space-y-2">
            <div class="skeleton h-2.5" :style="{ width }"></div>
            <div class="skeleton h-2 w-24"></div>
          </div>
        </div>
      </div>

      <div
        v-else-if="!segments.length && !showError && !state.result.cancelled"
        class="flex h-full min-h-[150px] flex-col items-center justify-center px-6 py-8 text-center"
      >
        <div class="empty-icon">
          <Headset />
        </div>
        <p class="mt-3 text-[12px] font-medium text-ink-500">合成完成后，在这里逐段试听</p>
        <p class="mt-1 max-w-[260px] text-[10px] leading-relaxed text-ink-300">
          每一段都可以单独播放和下载，全部完成后还可以导出合并好的完整音频。
        </p>
      </div>

      <p
        v-if="!segments.length && !state.job.running && showError"
        class="px-2 py-6 text-center text-[10.5px] text-ink-300"
      >
        本次没有生成可试听的音频，请调整参数后重试。
      </p>

      <div v-if="segments.length" class="space-y-1">
        <div
          v-for="segment in segments"
          :key="segment.index"
          class="segment-row group"
          :class="{ 'is-active': isSegmentActive(segment) }"
        >
          <span class="segment-index">{{ String(segment.index).padStart(2, '0') }}</span>

          <button
            class="row-play"
            :aria-label="isSegmentActive(segment) && state.player.playing ? '暂停此段' : '播放此段'"
            @click="handleSegmentPlay(segment)"
          >
            <VideoPause v-if="isSegmentActive(segment) && state.player.playing" />
            <VideoPlay v-else />
          </button>

          <div class="min-w-0 flex-1">
            <p class="truncate text-[11.5px] leading-relaxed text-ink-700" :title="segment.text">
              {{ segment.text }}
            </p>
            <div class="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-ink-300">
              <span>{{ segment.charCount }} 字</span>
              <span class="h-0.5 w-0.5 rounded-full bg-ink-300"></span>
              <span class="tabular-nums">{{ formatDuration(segment.duration) }}</span>
              <template v-if="isSegmentActive(segment)">
                <span class="h-0.5 w-0.5 rounded-full bg-brand-400"></span>
                <span class="font-medium text-brand-500">
                  {{ state.player.playing ? '正在播放' : '已暂停' }}
                </span>
              </template>
            </div>
          </div>

          <div class="flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
            <button
              class="icon-btn"
              title="下载此段"
              aria-label="下载此段"
              @click="saveSegment(segment)"
            >
              <Download />
            </button>
            <button
              class="icon-btn hidden sm:inline-flex"
              title="在文件夹中显示"
              aria-label="在文件夹中显示"
              @click="revealSegment(segment)"
            >
              <FolderOpened />
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="state.job.running && segments.length"
        class="mt-1.5 flex items-center gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-2.5 text-[10px] text-ink-300"
      >
        <span class="spinner"></span>
        {{ state.job.message }}
      </div>
    </div>
  </section>
</template>
