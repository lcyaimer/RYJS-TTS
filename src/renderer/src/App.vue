<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { WarningFilled } from '@element-plus/icons-vue'
import TitleBar from './components/TitleBar.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import EditorPanel from './components/EditorPanel.vue'
import ResultPanel from './components/ResultPanel.vue'
import PlayerBar from './components/PlayerBar.vue'
import { state, initStudio, startSynthesis } from './store'

function handleKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    startSynthesis()
  }
}

function preventFileNavigation(event) {
  event.preventDefault()
}

onMounted(() => {
  initStudio()
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('dragover', preventFileNavigation)
  window.addEventListener('drop', preventFileNavigation)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('dragover', preventFileNavigation)
  window.removeEventListener('drop', preventFileNavigation)
})
</script>

<template>
  <div class="app-canvas flex h-screen flex-col overflow-hidden">
    <TitleBar />

    <div class="flex min-h-0 flex-1 gap-4 px-4 pb-4 pt-4">
      <aside class="flex w-[300px] shrink-0 flex-col overflow-y-auto pb-0.5 pr-1">
        <div
          v-if="state.initError"
          class="mb-3 flex gap-2 rounded-xl border border-rose-200/70 bg-rose-50/80 px-3 py-2 text-[10.5px] leading-relaxed text-rose-600"
        >
          <WarningFilled class="mt-[1px] h-3.5 w-3.5 shrink-0" />
          <p class="min-w-0 break-words">主进程连接异常：{{ state.initError }}</p>
        </div>

        <SettingsPanel />
      </aside>

      <main class="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <EditorPanel style="flex: 0.95 1 0%" class="min-h-[220px]" />
        <ResultPanel style="flex: 1.25 1 0%" class="min-h-[220px]" />
        <PlayerBar />
      </main>
    </div>
  </div>
</template>
