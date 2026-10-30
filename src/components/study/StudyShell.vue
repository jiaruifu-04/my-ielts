<script setup lang="ts">
import { useLearningStore } from '~/composables/useLearningStore'

defineProps<{ title: string; description?: string }>()
const { state, ready, error, init } = useLearningStore()
const tabs = [
  { to: '/study', label: '备考概览' },
  { to: '/study/goals', label: '目标设置' },
  { to: '/study/baseline', label: '基线诊断' },
  { to: '/study/records', label: '学习记录' },
  { to: '/study/backup', label: '备份与恢复' },
]

async function load() {
  try {
    await init()
  }
  catch { /* The store exposes the recoverable error below. */ }
}
onMounted(load)
</script>

<template>
  <main class="study-root">
    <header class="study-heading">
      <div>
        <p class="study-eyebrow">
          MY IELTS · 目标 {{ (state.profile?.overallTarget ?? 7.5).toFixed(1) }}
        </p>
        <h1>{{ title }}</h1>
        <p v-if="description" class="study-description">
          {{ description }}
        </p>
      </div>
      <span class="study-local-badge">保存在此浏览器</span>
    </header>
    <nav class="study-tabs" aria-label="备考中心">
      <RouterLink v-for="tab in tabs" :key="tab.to" :to="tab.to" :aria-current="$route.path === tab.to ? 'page' : undefined" :class="{ 'is-current': $route.path === tab.to }">
        {{ tab.label }}
      </RouterLink>
    </nav>
    <div v-if="error" class="study-alert" role="alert">
      {{ error }}
      <button v-if="!ready" class="study-button-secondary" type="button" @click="load">
        重新读取
      </button>
    </div>
    <div v-if="!ready && !error" class="study-card" role="status">
      正在读取学习记录…
    </div>
    <template v-if="ready">
      <slot />
    </template>
    <p class="study-storage-note">
      记录属于当前浏览器。更换设备或清理浏览器数据前，请导出完整备份。
    </p>
  </main>
</template>
