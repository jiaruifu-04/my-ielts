<script setup lang="ts">
import type { BackupPreview } from '~/composables/useLearningStore'
import { useLearningStore } from '~/composables/useLearningStore'
import { MAX_BACKUP_TEXT_BYTES, SKILLS, SKILL_LABELS } from '~/domain/learning'

const { state, ready, exportBackup, previewBackup, importBackup } = useLearningStore()
const preview = shallowRef<BackupPreview | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const filename = ref('')
const restoreProfile = ref(false)
const previewing = ref(false)
const exporting = ref(false)
const importing = ref(false)
const operationError = ref('')
const success = ref('')
const busy = computed(() => importing.value || exporting.value)
let previewVersion = 0
let disposed = false
const downloadUrls = new Set<string>()

const duplicateRecords = computed(() => {
  if (!preview.value)
    return 0
  const existingIds = new Set(state.value.records.map(record => record.id))
  return preview.value.data.records.filter(record => existingIds.has(record.id)).length
})
const attachmentConflictRecords = computed(() => {
  if (!preview.value)
    return 0
  const existingRecords = new Set(state.value.records.map(record => record.id))
  const existingAttachments = new Set(state.value.attachments.map(attachment => attachment.id))
  return preview.value.data.records.filter(record => !existingRecords.has(record.id) && record.attachmentIds.some(id => existingAttachments.has(id))).length
})

function sizeLabel(bytes: number) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(2)} MiB` : '0 MiB'
}

function exportDateLabel(date: string) {
  const parsed = new Date(date)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('zh-CN') : date
}

function clearPreview() {
  previewVersion++
  preview.value = null
  previewing.value = false
  filename.value = ''
  restoreProfile.value = false
  operationError.value = ''
  if (fileInput.value)
    fileInput.value.value = ''
}

async function selectBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const version = ++previewVersion
  preview.value = null
  restoreProfile.value = false
  operationError.value = ''
  success.value = ''
  filename.value = file?.name || ''
  if (!file) {
    previewing.value = false
    return
  }
  previewing.value = true
  try {
    if (!file.size || file.size > MAX_BACKUP_TEXT_BYTES)
      throw new Error('请选择大于 0 且不超过 150 MiB 的 JSON 备份文件。')
    const text = await file.text()
    if (disposed || version !== previewVersion)
      return
    const candidate = await previewBackup(text)
    if (disposed || version !== previewVersion)
      return
    preview.value = candidate
    restoreProfile.value = !state.value.profile && !!candidate.data.profile
  }
  catch (error) {
    if (!disposed && version === previewVersion)
      operationError.value = error instanceof Error ? error.message : '备份无法读取，请选择有效的 JSON 备份文件。'
  }
  finally {
    if (!disposed && version === previewVersion)
      previewing.value = false
  }
}

async function downloadBackup() {
  if (busy.value || !ready.value)
    return
  exporting.value = true
  operationError.value = ''
  success.value = ''
  try {
    const text = await exportBackup()
    if (disposed)
      return
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    downloadUrls.add(url)
    const link = document.createElement('a')
    const date = new Date()
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    link.href = url
    link.download = `my-ielts-learning-${stamp}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => {
      URL.revokeObjectURL(url)
      downloadUrls.delete(url)
    }, 1000)
    success.value = '包含目标、记录和音频的备份已生成，已请求浏览器下载。请确认文件已保存在设备上。'
  }
  catch (error) {
    if (!disposed)
      operationError.value = error instanceof Error ? error.message : '备份生成失败，请重试。'
  }
  finally {
    exporting.value = false
  }
}

async function confirmImport() {
  if (!preview.value || busy.value || previewing.value || !ready.value)
    return
  importing.value = true
  operationError.value = ''
  success.value = ''
  try {
    const result = await importBackup(preview.value, { restoreProfile: restoreProfile.value && !!preview.value.data.profile })
    if (disposed)
      return
    clearPreview()
    success.value = `合并完成：新增 ${result.recordsAdded} 条记录，跳过 ${result.recordsSkipped} 条已有记录；新增 ${result.attachmentsAdded} 个音频，跳过 ${result.attachmentsSkipped} 个音频。${result.profileRestored ? '已恢复备份目标设置。' : '当前目标设置已保留。'}`
  }
  catch (error) {
    if (!disposed)
      operationError.value = error instanceof Error ? error.message : '合并失败，请重试。'
  }
  finally {
    importing.value = false
  }
}

onBeforeUnmount(() => {
  disposed = true
  previewVersion++
  for (const url of downloadUrls)
    URL.revokeObjectURL(url)
  downloadUrls.clear()
})
</script>

<template>
  <StudyShell title="备份与恢复" description="把目标、学习记录和音频一起带走；先查看备份内容，再决定是否合并。">
    <p v-if="operationError" class="study-alert" role="alert">
      {{ operationError }}
    </p>
    <p v-if="success" class="study-success" role="status">
      {{ success }}
    </p>
    <section class="study-card" aria-labelledby="export-title">
      <h2 id="export-title">
        下载完整备份
      </h2>
      <p>学习数据保存在当前浏览器。清除网站数据或更换设备前，请下载备份并妥善保存。</p>
      <p v-if="ready" class="study-muted">
        当前有 {{ state.records.length }} 条学习记录、{{ state.attachments.length }} 个音频附件，{{ state.profile ? '已设置学习目标' : '尚未设置学习目标' }}。
      </p>
      <p v-else class="study-muted" role="status">
        正在读取本地数据…
      </p>
      <div class="study-actions">
        <button type="button" class="study-button" :disabled="busy || previewing || !ready" @click="downloadBackup">
          {{ exporting ? '正在生成备份…' : '下载完整备份（含音频）' }}
        </button>
      </div>
    </section>

    <section class="study-card" aria-labelledby="import-title">
      <h2 id="import-title">
        从备份合并
      </h2>
      <p class="study-muted">
        选择文件只会校验和预览，不会立即写入。支持本应用导出的 JSON 备份，文件不超过 150 MiB。
      </p>
      <label class="study-field">选择备份文件
        <input ref="fileInput" type="file" accept="application/json,.json" :disabled="busy || !ready" @change="selectBackup">
      </label>
      <p v-if="previewing" class="study-muted" role="status">
        正在检查“{{ filename }}”的格式、记录和音频，请稍候…
      </p>
      <button v-if="previewing" type="button" class="study-button-secondary" :disabled="busy" @click="clearPreview">
        取消预览
      </button>

      <div v-if="preview" class="backup-preview" aria-labelledby="preview-title">
        <h3 id="preview-title">
          备份预览：{{ filename }}
        </h3>
        <p class="study-muted">
          导出时间：{{ exportDateLabel(preview.exportedAt) }}
        </p>
        <dl class="backup-facts">
          <div><dt>学习记录</dt><dd>{{ preview.recordCount }} 条</dd></div>
          <div><dt>音频附件</dt><dd>{{ preview.attachmentCount }} 个 · {{ sizeLabel(preview.totalBytes) }}</dd></div>
          <div><dt>同 ID 的已有记录</dt><dd>{{ duplicateRecords }} 条，将保留本地版本</dd></div>
          <div v-if="attachmentConflictRecords">
            <dt>音频 ID 冲突</dt><dd>{{ attachmentConflictRecords }} 条记录将整体跳过，保留本地音频</dd>
          </div>
        </dl>
        <div v-if="preview.data.profile" class="backup-profile">
          <h3>备份中的目标设置</h3>
          <p>{{ preview.data.profile.examType === 'academic' ? '学术类 Academic' : '培训类 General Training' }} · 总分目标 {{ preview.data.profile.overallTarget.toFixed(1) }}</p>
          <ul class="backup-minimums">
            <li v-for="skill in SKILLS" :key="skill">
              {{ SKILL_LABELS[skill] }}最低分：{{ preview.data.profile.minimumScores[skill] === null ? '未设置' : preview.data.profile.minimumScores[skill]?.toFixed(1) }}
            </li>
          </ul>
          <p>考试日期：{{ preview.data.profile.examDate || '未设置' }}</p>
          <label class="backup-checkbox"><input v-model="restoreProfile" type="checkbox" :disabled="busy">{{ state.profile ? '用备份中的目标设置替换当前目标' : '恢复备份中的目标设置' }}</label>
          <p class="study-muted">
            {{ state.profile ? '当前已有目标，默认保留；仅勾选后才替换。' : '当前没有目标，已默认勾选恢复；可以取消。' }}
          </p>
        </div>
        <p v-else class="study-muted">
          备份没有目标设置，当前目标将保留。
        </p>
        <div class="backup-policy">
          <h3>合并规则</h3>
          <p>新增本地没有且音频 ID 不冲突的记录。同 ID 的记录及其音频会跳过；音频 ID 冲突时，也会跳过所属整条备份记录。现有记录和音频不会覆盖或删除。</p>
          <p class="study-muted">
            新增内容通过校验且全部保存完成后，才会显示合并结果。
          </p>
        </div>
        <div class="study-actions">
          <button type="button" class="study-button" :disabled="busy || !ready || previewing" @click="confirmImport">
            {{ importing ? '正在合并…' : '确认合并此备份' }}
          </button>
          <button type="button" class="study-button-secondary" :disabled="busy" @click="clearPreview">
            取消
          </button>
        </div>
      </div>
    </section>
  </StudyShell>
</template>

<style scoped>
.backup-preview { margin-top: 1.5rem; border-top: 1px solid #94a3b8; padding-top: 1.25rem; }
.backup-preview h3 { font-weight: 650; overflow-wrap: anywhere; }
.backup-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 1rem; margin: 1rem 0; }
.backup-facts dt { font-size: .875rem; opacity: .8; }
.backup-facts dd { margin: .25rem 0 0; font-weight: 600; }
.backup-profile, .backup-policy { margin: 1.25rem 0; }
.backup-minimums { display: flex; gap: .5rem 1.5rem; flex-wrap: wrap; padding: 0; list-style: none; margin: .5rem 0; }
.backup-checkbox { display: flex; align-items: center; gap: .5rem; margin-top: 1rem; }
</style>
