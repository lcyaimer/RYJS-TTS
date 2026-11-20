<script setup>
import { computed } from 'vue'
import { currentEngine, state } from '../store'

const isMac = computed(() => {
  const platform = state.appInfo.platform || navigator.platform || ''
  return String(platform).toLowerCase().includes('mac')
})

const onlineEngine = computed(() => currentEngine.value?.local === false)
const version = computed(() => state.appInfo.version || '1.3.0')
</script>

<template>
  <header
    class="titlebar app-drag flex h-[58px] shrink-0 items-center px-5"
    :class="isMac ? 'pl-[88px]' : ''"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <div class="brand-mark">
        <svg viewBox="0 0 24 24" fill="none" class="h-[18px] w-[18px]" aria-hidden="true">
          <path
            d="M3.5 10v4M7.5 6.5v11M11.5 3.5v17M15.5 8v8M19.5 10.5v3"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </div>

      <div class="min-w-0 leading-tight">
        <div class="flex items-center gap-2">
          <span class="text-[15px] font-semibold tracking-[-0.015em] text-ink-900">
            RyJS TTS
          </span>
          <span
            class="rounded-full bg-brand-50 px-2 py-[2px] text-[9px] font-semibold tracking-[0.06em] text-brand-600 ring-1 ring-inset ring-brand-100"
          >
            语音工作台
          </span>
        </div>
        <p class="mt-0.5 truncate text-[10.5px] text-ink-400">
          本地文字转语音 · 长文分段合成
        </p>
      </div>
    </div>

    <div
      class="ml-auto flex items-center gap-2 app-no-drag"
      :class="isMac ? 'pr-1' : 'pr-[142px]'"
    >
      <span
        class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ring-1 ring-inset"
        :class="
          onlineEngine
            ? 'bg-amber-50/80 text-amber-700 ring-amber-100'
            : 'bg-emerald-50/80 text-emerald-700 ring-emerald-100'
        "
      >
        <span class="relative flex h-1.5 w-1.5">
          <span
            class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50"
            :class="onlineEngine ? 'bg-amber-400' : 'bg-emerald-400'"
          ></span>
          <span
            class="relative inline-flex h-1.5 w-1.5 rounded-full"
            :class="onlineEngine ? 'bg-amber-500' : 'bg-emerald-500'"
          ></span>
        </span>
        {{ onlineEngine ? '在线引擎 · 需要网络' : '本地引擎 · 文稿不上传' }}
      </span>

      <span
        class="hidden rounded-full px-2 py-1 text-[10px] font-medium tabular-nums text-ink-300 sm:inline"
      >
        v{{ version }}
      </span>
    </div>
  </header>
</template>
