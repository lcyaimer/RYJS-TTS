<script setup>
import { computed } from 'vue'
import {
  DArrowLeft,
  DArrowRight,
  Download,
  FolderOpened,
  VideoPause,
  VideoPlay
} from '@element-plus/icons-vue'
import {
  state,
  togglePlay,
  seekTo,
  playAdjacentSegment,
  canPlayAdjacent,
  saveCurrentTrack,
  revealCurrentTrack
} from '../store'
import { formatDuration } from '../utils'

const bars = [
  { height: 9, delay: '0s' },
  { height: 17, delay: '0.12s' },
  { height: 12, delay: '0.24s' },
  { height: 21, delay: '0.36s' },
  { height: 14, delay: '0.18s' }
]

const trackTitle = computed(
  () => state.player.track?.title || '尚未选择音频'
)
const trackSubtitle = computed(() => {
  if (state.player.waitingForNext) return '等待下一段合成完成…'
  return state.player.track?.subtitle || '点击分段或完整音频开始试听'
})

const canPrev = computed(() => canPlayAdjacent(-1))
const canNext = computed(() => canPlayAdjacent(1))

const rangeMax = computed(() => Math.max(state.player.duration || 0, 0.001))

const progressStyle = computed(() => {
  const duration = state.player.duration
  const percent =
    duration > 0 ? Math.min(100, (state.player.currentTime / duration) * 100) : 0
  return { '--progress': `${percent}%` }
})

function onSeek(event) {
  seekTo(Number(event.target.value))
}
</script>

<template>
  <section class="player-bar flex shrink-0 items-center gap-3 px-4 py-3">
    <div class="eq hidden shrink-0 sm:flex" :class="{ 'is-playing': state.player.playing }" aria-hidden="true">
      <span
        v-for="(bar, index) in bars"
        :key="index"
        :style="{ height: `${bar.height}px`, animationDelay: bar.delay }"
      ></span>
    </div>

    <button
      class="play-primary"
      :disabled="!state.player.track"
      :aria-label="state.player.playing ? '暂停' : '播放'"
      @click="togglePlay"
    >
      <span
        v-if="state.player.loading"
        class="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white"
      ></span>
      <VideoPause v-else-if="state.player.playing" />
      <VideoPlay v-else />
    </button>

    <div class="w-[152px] min-w-0 shrink-0 md:w-[190px] xl:w-[220px]">
      <div class="flex items-center gap-1.5">
        <span class="truncate text-[12px] font-semibold text-white/95">
          {{ trackTitle }}
        </span>
        <span
          v-if="state.player.track?.kind === 'preview'"
          class="rounded-full bg-white/10 px-1.5 py-[1px] text-[8.5px] font-medium text-white/55"
        >
          试听
        </span>
      </div>
      <p class="mt-0.5 truncate text-[9.5px] text-white/40">{{ trackSubtitle }}</p>
    </div>

    <div class="hidden items-center gap-0.5 sm:flex">
      <button
        class="player-icon-btn"
        :disabled="!canPrev"
        aria-label="上一段"
        title="上一段"
        @click="playAdjacentSegment(-1)"
      >
        <DArrowLeft />
      </button>
      <button
        class="player-icon-btn"
        :disabled="!canNext"
        aria-label="下一段"
        title="下一段"
        @click="playAdjacentSegment(1)"
      >
        <DArrowRight />
      </button>
    </div>

    <span class="w-[38px] shrink-0 text-right text-[9.5px] tabular-nums text-white/45">
      {{ formatDuration(state.player.currentTime) }}
    </span>

    <input
      class="player-range min-w-0 flex-1"
      type="range"
      min="0"
      :max="rangeMax"
      step="0.01"
      :value="state.player.currentTime"
      :style="progressStyle"
      :disabled="!state.player.track"
      aria-label="播放进度"
      @input="onSeek"
    />

    <span class="w-[38px] shrink-0 text-[9.5px] tabular-nums text-white/45">
      {{ formatDuration(state.player.duration) }}
    </span>

    <div class="ml-0.5 flex shrink-0 items-center gap-0.5">
      <button
        class="player-icon-btn"
        :disabled="!state.player.track"
        aria-label="下载当前音频"
        title="下载当前音频"
        @click="saveCurrentTrack"
      >
        <Download />
      </button>
      <button
        class="player-icon-btn hidden sm:inline-flex"
        :disabled="!state.player.track"
        aria-label="在文件夹中显示"
        title="在文件夹中显示"
        @click="revealCurrentTrack"
      >
        <FolderOpened />
      </button>
    </div>
  </section>
</template>
