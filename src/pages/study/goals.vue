<script setup lang="ts">
import { SKILLS, SKILL_LABELS, createDefaultProfile } from '~/domain/learning'
import { useLearningStore } from '~/composables/useLearningStore'

const { state, ready, saveProfile } = useLearningStore()
const form = reactive(createDefaultProfile())
const bands = Array.from({ length: 19 }, (_, i) => i / 2)
const busy = ref(false)
const message = ref('')
const formError = ref('')
watch(() => [ready.value, state.value.profile], () => {
  if (ready.value) {
    const profile = state.value.profile || createDefaultProfile()
    Object.assign(form, profile, { minimumScores: { ...profile.minimumScores } })
  }
}, { immediate: true })

async function save() {
  if (busy.value || !ready.value)
    return
  busy.value = true
  message.value = ''
  formError.value = ''
  try {
    await saveProfile({ ...form, examDate: form.examDate || null, minimumScores: { ...form.minimumScores } })
    message.value = '目标已保存。下一步，录入四科基线。'
  }
  catch (error) { formError.value = error instanceof Error ? error.message : '目标保存失败，请重试。' }
  finally { busy.value = false }
}
</script>

<template>
  <StudyShell title="目标设置" description="把总分目标和单项要求分别记下来，让每次训练都有方向。">
    <div v-if="message" class="study-success" role="status">
      {{ message }} <RouterLink class="study-link" to="/study/baseline">
        录入基线 →
      </RouterLink>
    </div>
    <div v-if="formError" class="study-alert" role="alert">
      {{ formError }}
    </div>
    <form class="study-card" @submit.prevent="save">
      <fieldset :disabled="busy || !ready">
        <h2>你的考试目标</h2>
        <div class="study-grid">
          <label class="study-field">考试类型
            <select v-model="form.examType" required><option value="academic">A 类 · 学术类</option><option value="general">G 类 · 培训类</option></select>
          </label>
          <label class="study-field">目标总分
            <select v-model="form.overallTarget" required><option v-for="band in bands" :key="band" :value="band">{{ band.toFixed(1) }}</option></select>
          </label>
          <label class="study-field">考试日期（可选）
            <input v-model="form.examDate" type="date">
            <small class="study-muted">还没报名也可以先保存目标。</small>
          </label>
        </div>
        <h2>单项最低要求</h2>
        <p class="study-muted" style="margin-bottom: 18px">
          按学校或机构的要求填写；没有单独要求的科目可以留空。
        </p>
        <div class="study-grid-four">
          <label v-for="skill in SKILLS" :key="skill" class="study-field">{{ SKILL_LABELS[skill] }}最低分
            <select v-model="form.minimumScores[skill]">
              <option :value="null">未设置</option>
              <option v-for="band in bands" :key="band" :value="band">{{ band.toFixed(1) }}</option>
            </select>
          </label>
        </div>
        <p class="study-muted">
          例如听力 8、阅读 8、写作 7、口语 7，参考总分为 7.5。具体单项安排可以在建立基线后调整。
        </p>
        <div class="study-actions">
          <button class="study-button" type="submit" :disabled="busy">
            {{ busy ? '保存中…' : '保存目标' }}
          </button><RouterLink class="study-button-secondary" to="/study">
            返回概览
          </RouterLink>
        </div>
      </fieldset>
    </form>
  </StudyShell>
</template>
