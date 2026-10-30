<script setup lang="ts">
import type { AttachmentMeta } from '~/domain/learning'
import { useLearningStore } from '~/composables/useLearningStore'

const props = defineProps<{ attachments: AttachmentMeta[] }>()
const { getAttachmentBlob } = useLearningStore()
const urls = reactive<Record<string, string>>({})
const loading = reactive<Record<string, boolean>>({})
const errors = reactive<Record<string, string>>({})
let disposed = false

function formatBytes(size: number) {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`
}

async function loadAudio(id: string) {
  if (loading[id] || urls[id])
    return
  loading[id] = true
  errors[id] = ''
  try {
    const blob = await getAttachmentBlob(id)
    if (!disposed && props.attachments.some(item => item.id === id))
      urls[id] = URL.createObjectURL(blob)
  }
  catch (error) {
    if (!disposed)
      errors[id] = error instanceof Error ? error.message : '无法读取音频，请重试。'
  }
  finally {
    loading[id] = false
  }
}

watch(() => props.attachments.map(item => item.id), (ids) => {
  for (const id of Object.keys(urls)) {
    if (!ids.includes(id)) {
      URL.revokeObjectURL(urls[id])
      delete urls[id]
      delete errors[id]
    }
  }
})

onBeforeUnmount(() => {
  disposed = true
  for (const url of Object.values(urls))
    URL.revokeObjectURL(url)
})
</script>

<template>
  <ul v-if="attachments.length" class="record-attachments" aria-label="音频附件">
    <li v-for="attachment in attachments" :key="attachment.id">
      <div class="study-actions">
        <span>{{ attachment.name }} <span class="study-muted">（{{ formatBytes(attachment.size) }}）</span></span>
        <button v-if="!urls[attachment.id]" type="button" class="study-button-secondary" :disabled="loading[attachment.id]" @click="loadAudio(attachment.id)">
          {{ loading[attachment.id] ? '正在读取…' : '载入回放与下载' }}
        </button>
        <a v-else class="study-button-secondary" :href="urls[attachment.id]" :download="attachment.name">下载音频</a>
      </div>
      <audio v-if="urls[attachment.id]" :src="urls[attachment.id]" controls preload="metadata" :aria-label="`回放 ${attachment.name}`" @error="errors[attachment.id] = '当前浏览器无法播放此音频，可下载后尝试其他播放器。'" />
      <p v-if="errors[attachment.id]" class="study-alert" role="alert">
        {{ errors[attachment.id] }}
      </p>
    </li>
  </ul>
</template>

<style scoped>
.record-attachments { list-style: none; padding: 0; margin: 0; }
.record-attachments li + li { margin-top: 1rem; }
audio { display: block; width: 100%; max-width: 28rem; margin-top: .75rem; }
</style>
