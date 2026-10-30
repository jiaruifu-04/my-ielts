<script setup lang="ts">
import type { LearningRecord, RecordInput, RecordKind, ScoreSource, Skill } from '~/domain/learning'
import { MAX_ATTACHMENT_BYTES, SCORE_SOURCE_LABELS, SKILLS, SKILL_LABELS, audioType, validateRecordInput } from '~/domain/learning'
import { useLearningStore } from '~/composables/useLearningStore'

const { state, ready, addRecord, updateRecord, deleteRecord } = useLearningStore()
const busy = ref(false)
const operationError = ref('')
const success = ref('')
const editingId = ref<string | null>(null)
const pendingDelete = ref<LearningRecord | null>(null)
const skillFilter = ref<Skill | ''>('')
const kindFilter = ref<RecordKind | ''>('')
const files = ref<File[]>([])
const removeAttachmentIds = ref<string[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const formElement = ref<HTMLFormElement | null>(null)

function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function emptyForm() {
  return {
    title: '',
    skill: 'listening' as Skill,
    kind: 'practice' as RecordKind,
    examType: state.value.profile?.examType || 'academic' as 'academic' | 'general',
    date: today(),
    band: '',
    scoreSource: 'unassessed' as ScoreSource,
    rawScore: '',
    durationMinutes: '',
    notes: '',
    writing: '',
  }
}

const form = reactive(emptyForm())
const isListeningOrReading = computed(() => ['listening', 'reading'].includes(form.skill))
const editingAttachments = computed(() => state.value.attachments.filter(item => item.recordId === editingId.value))
const records = computed(() => state.value.records
  .filter(record => (!skillFilter.value || record.skill === skillFilter.value) && (!kindFilter.value || record.kind === kindFilter.value))
  .slice().sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)))

watch(ready, (isReady) => {
  if (isReady && !editingId.value)
    form.examType = state.value.profile?.examType || form.examType
})
watch(() => form.scoreSource, (source) => {
  if (source === 'unassessed')
    form.band = ''
})
watch(() => form.skill, (skill) => {
  if (!['listening', 'reading'].includes(skill))
    form.rawScore = ''
})

function resetForm() {
  editingId.value = null
  Object.assign(form, emptyForm())
  files.value = []
  removeAttachmentIds.value = []
  if (fileInput.value)
    fileInput.value.value = ''
}

async function edit(record: LearningRecord) {
  operationError.value = ''
  success.value = ''
  pendingDelete.value = null
  editingId.value = record.id
  Object.assign(form, {
    ...record,
    band: record.band === null ? '' : String(record.band),
    rawScore: record.rawScore === null ? '' : String(record.rawScore),
    durationMinutes: record.durationMinutes === null ? '' : String(record.durationMinutes),
  })
  files.value = []
  removeAttachmentIds.value = []
  if (fileInput.value)
    fileInput.value.value = ''
  await nextTick()
  formElement.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  formElement.value?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
}

function selectFiles(event: Event) {
  operationError.value = ''
  const input = event.target as HTMLInputElement
  const selected = Array.from(input.files || [])
  try {
    for (const file of selected) {
      audioType(file.name, file.type)
      if (!file.size || file.size > MAX_ATTACHMENT_BYTES)
        throw new Error(`“${file.name}”须大于 0 且不超过 20 MiB。`)
    }
    files.value = [...files.value, ...selected.filter(file => !files.value.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified))]
  }
  catch (error) {
    operationError.value = error instanceof Error ? error.message : '音频文件无效。'
  }
  input.value = ''
}

async function save() {
  if (busy.value || !ready.value)
    return
  busy.value = true
  operationError.value = ''
  success.value = ''
  try {
    const input: RecordInput = validateRecordInput({
      title: form.title,
      skill: form.skill,
      kind: form.kind,
      examType: form.examType,
      date: form.date,
      band: form.scoreSource === 'unassessed' || form.band === '' ? null : Number(form.band),
      scoreSource: form.scoreSource,
      rawScore: isListeningOrReading.value && form.rawScore !== '' ? Number(form.rawScore) : null,
      durationMinutes: form.durationMinutes === '' ? null : Number(form.durationMinutes),
      notes: form.notes,
      writing: form.writing,
    })
    if (editingId.value)
      await updateRecord(editingId.value, input, files.value, removeAttachmentIds.value)
    else
      await addRecord(input, files.value)
    const wasEditing = !!editingId.value
    resetForm()
    success.value = wasEditing ? '记录已更新，音频变更已保存。' : '学习记录已保存。'
  }
  catch (error) {
    operationError.value = error instanceof Error ? error.message : '保存失败，请重试。'
  }
  finally {
    busy.value = false
  }
}

async function confirmDelete() {
  if (!pendingDelete.value || busy.value || !ready.value)
    return
  const record = pendingDelete.value
  busy.value = true
  operationError.value = ''
  success.value = ''
  try {
    await deleteRecord(record.id)
    if (editingId.value === record.id)
      resetForm()
    pendingDelete.value = null
    success.value = '记录及其音频附件已删除。'
  }
  catch (error) {
    operationError.value = error instanceof Error ? error.message : '删除失败，请重试。'
  }
  finally {
    busy.value = false
  }
}

function attachmentsFor(record: LearningRecord) {
  return state.value.attachments.filter(item => record.attachmentIds.includes(item.id))
}
</script>

<template>
  <StudyShell title="学习记录" description="记录四科学习、分数来源和作答材料，保留每次练习的真实依据。">
    <p v-if="operationError" class="study-alert" role="alert">
      {{ operationError }}
    </p>
    <p v-if="success" class="study-success" role="status">
      {{ success }}
    </p>

    <section class="study-card" aria-labelledby="record-form-title">
      <h2 id="record-form-title">
        {{ editingId ? '编辑学习记录' : '新增学习记录' }}
      </h2>
      <p class="study-muted">
        分数未知可以留空；自评和参考换算只作为学习参考。音频保存在当前浏览器，可通过备份完整导出。
      </p>
      <form ref="formElement" @submit.prevent="save">
        <fieldset :disabled="busy || !ready" class="record-fieldset">
          <div class="study-grid">
            <label class="study-field record-full">标题
              <input v-model="form.title" required maxlength="200" placeholder="例如：听力整套练习 / Task 2 二稿 / 口语 Part 2" autocomplete="off">
            </label>
            <label class="study-field">科目
              <select v-model="form.skill"><option v-for="skill in SKILLS" :key="skill" :value="skill">{{ SKILL_LABELS[skill] }}</option></select>
            </label>
            <label class="study-field">记录类型
              <select v-model="form.kind"><option value="practice">日常练习</option><option value="baseline">基线诊断</option></select>
            </label>
            <label class="study-field">考试类型
              <select v-model="form.examType"><option value="academic">学术类 Academic</option><option value="general">培训类 General Training</option></select>
            </label>
            <label class="study-field">日期
              <input v-model="form.date" type="date" required>
            </label>
            <label class="study-field">评分来源
              <select v-model="form.scoreSource"><option v-for="(label, source) in SCORE_SOURCE_LABELS" :key="source" :value="source">{{ label }}</option></select>
            </label>
            <label class="study-field">单项分数（可选）
              <select v-model="form.band" :disabled="form.scoreSource === 'unassessed'" aria-describedby="band-help">
                <option value="">未知 / 尚未取得分数</option><option v-for="n in 19" :key="n" :value="String((n - 1) / 2)">{{ ((n - 1) / 2).toFixed(1) }}</option>
              </select>
              <span id="band-help" class="study-muted">录入分数前请选择评分来源，不自动换算。</span>
            </label>
            <label v-if="isListeningOrReading" class="study-field">原始正确题数（可选）
              <input v-model="form.rawScore" type="number" min="0" max="40" step="1" placeholder="0–40">
            </label>
            <label class="study-field">学习时长（分钟，可选）
              <input v-model="form.durationMinutes" type="number" min="0.1" max="1440" step="any" placeholder="例如：40">
            </label>
            <label class="study-field record-full">备注、材料来源与下一步（可选）
              <textarea v-model="form.notes" rows="4" maxlength="10000" placeholder="记录材料来源、主要错因、收到的反馈，以及下一次要改进什么。" />
            </label>
            <label v-if="form.skill === 'writing' || form.writing" class="study-field record-full">作文正文（可选）
              <textarea v-model="form.writing" rows="10" maxlength="100000" placeholder="粘贴本次作文。修改后可以另存一条记录，保留首稿和二稿。" />
            </label>
          </div>
          <div class="record-audio">
            <label class="study-field">添加音频（可选）
              <input ref="fileInput" type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.opus,.webm,.flac" multiple @change="selectFiles">
              <span class="study-muted">支持 MP3、M4A、WAV 等；单个不超过 20 MiB，全部附件合计不超过 100 MiB。保存后可回放和下载。</span>
            </label>
            <ul v-if="files.length" class="record-files" aria-label="待上传音频">
              <li v-for="(file, index) in files" :key="`${file.name}-${index}`" class="study-actions">
                <span>{{ file.name }}（待保存）</span><button type="button" class="study-button-secondary" @click="files.splice(index, 1)">
                  移除 <span class="record-sr-only">{{ file.name }}</span>
                </button>
              </li>
            </ul>
            <div v-if="editingAttachments.length" class="record-existing">
              <p>已保存音频：勾选后将在保存修改时删除。</p>
              <label v-for="attachment in editingAttachments" :key="attachment.id" class="record-checkbox">
                <input v-model="removeAttachmentIds" type="checkbox" :value="attachment.id">移除 {{ attachment.name }}
              </label>
            </div>
          </div>
          <div class="study-actions">
            <button class="study-button" type="submit" :disabled="busy || !ready">
              {{ busy ? '正在保存…' : editingId ? '保存修改' : '保存记录' }}
            </button>
            <button v-if="editingId" type="button" class="study-button-secondary" @click="resetForm">
              取消编辑
            </button>
          </div>
        </fieldset>
      </form>
    </section>

    <section class="study-card" aria-labelledby="record-list-title">
      <h2 id="record-list-title">
        已保存记录
      </h2>
      <div class="study-grid">
        <label class="study-field">筛选科目
          <select v-model="skillFilter"><option value="">全部科目</option><option v-for="skill in SKILLS" :key="skill" :value="skill">{{ SKILL_LABELS[skill] }}</option></select>
        </label>
        <label class="study-field">筛选类型
          <select v-model="kindFilter"><option value="">全部类型</option><option value="baseline">基线诊断</option><option value="practice">日常练习</option></select>
        </label>
      </div>
      <div v-if="pendingDelete" class="record-delete" role="alert" aria-live="assertive">
        <p>确定删除“{{ pendingDelete.title }}”及其音频附件吗？此操作无法撤销。</p>
        <div class="study-actions">
          <button type="button" class="study-button-danger" :disabled="busy || !ready" @click="confirmDelete">
            {{ busy ? '正在删除…' : '确认删除' }}
          </button>
          <button type="button" class="study-button-secondary" :disabled="busy" @click="pendingDelete = null">
            取消
          </button>
        </div>
      </div>
      <p v-if="!ready" class="study-muted" role="status">
        正在读取记录…
      </p>
      <p v-else-if="!records.length" class="study-empty">
        {{ state.records.length ? '当前筛选下没有记录。' : '还没有学习记录。从上方保存第一次练习。' }}
      </p>
      <div v-else class="study-table-wrap">
        <table class="study-table">
          <caption class="record-sr-only">
            学习记录，共 {{ records.length }} 条
          </caption>
          <thead>
            <tr>
              <th scope="col">
                日期 / 类型
              </th><th scope="col">
                学习内容
              </th><th scope="col">
                成绩依据
              </th><th scope="col">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="record in records" :key="record.id">
              <td>{{ record.date }}<br><span class="study-muted">{{ record.kind === 'baseline' ? '基线诊断' : '日常练习' }}</span></td>
              <td>
                <strong>{{ record.title }}</strong><br>
                <span class="study-muted">{{ SKILL_LABELS[record.skill] }} · {{ record.examType === 'academic' ? '学术类' : '培训类' }}<template v-if="record.durationMinutes !== null"> · {{ record.durationMinutes }} 分钟</template></span>
                <details v-if="record.notes || record.writing || record.attachmentIds.length" class="record-details">
                  <summary>
                    查看备注、正文与音频<template v-if="record.attachmentIds.length">
                      （{{ record.attachmentIds.length }}）
                    </template>
                  </summary>
                  <p v-if="record.notes" class="record-text">
                    {{ record.notes }}
                  </p>
                  <div v-if="record.writing">
                    <h3>作文正文</h3><p class="record-text">
                      {{ record.writing }}
                    </p>
                  </div>
                  <RecordAttachments :attachments="attachmentsFor(record)" />
                </details>
              </td>
              <td>
                {{ record.band === null ? '分数未知' : `${record.band.toFixed(1)} 分` }}<br><span class="study-muted">{{ SCORE_SOURCE_LABELS[record.scoreSource] }}</span><p v-if="record.rawScore !== null" class="study-muted">
                  正确题数 {{ record.rawScore }} / 40
                </p>
              </td>
              <td>
                <div class="study-actions">
                  <button type="button" class="study-button-secondary" :disabled="busy || !ready" @click="edit(record)">
                    编辑<span class="record-sr-only"> {{ record.title }}</span>
                  </button><button type="button" class="study-button-danger" :disabled="busy || !ready" @click="pendingDelete = record">
                    删除<span class="record-sr-only"> {{ record.title }}</span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </StudyShell>
</template>

<style scoped>
.record-fieldset { border: 0; padding: 0; margin: 1rem 0 0; min-width: 0; }
.record-full { grid-column: 1 / -1; }
.record-audio { margin: 1.25rem 0; }
.record-files { list-style: none; padding: 0; margin: .75rem 0; }
.record-files li + li { margin-top: .5rem; }
.record-existing { margin-top: 1rem; }
.record-checkbox { display: flex; gap: .5rem; align-items: center; margin-top: .5rem; overflow-wrap: anywhere; }
.record-delete { border: 1px solid #dc2626; border-radius: .75rem; padding: 1rem; margin: 1rem 0; }
.record-delete p { margin-bottom: .75rem; }
.record-details { margin-top: .75rem; min-width: 14rem; }
.record-details summary { cursor: pointer; }
.record-text { white-space: pre-wrap; overflow-wrap: anywhere; margin: .75rem 0; max-height: 30rem; overflow: auto; }
.record-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
