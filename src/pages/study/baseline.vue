<script setup lang="ts">
import { SCORE_SOURCE_LABELS, SKILLS, SKILL_LABELS, calculateOverall } from '~/domain/learning'
import type { LearnerProfile, RecordInput, ScoreSource, Skill } from '~/domain/learning'
import { useLearningStore } from '~/composables/useLearningStore'

const { state, ready, addRecords } = useLearningStore()
const date = ref(new Date().toLocaleDateString('en-CA'))
const title = ref('首次基线测评')
const examType = ref<LearnerProfile['examType']>('academic')
const assessments = reactive(Object.fromEntries(SKILLS.map(skill => [skill, { band: null as number | null, rawScore: '' as number | '', scoreSource: 'self' as ScoreSource, notes: '' }])) as Record<Skill, { band: number | null; rawScore: number | ''; scoreSource: ScoreSource; notes: string }>)
const bands = Array.from({ length: 19 }, (_, i) => i / 2)
const busy = ref(false)
const message = ref('')
const formError = ref('')
const overall = computed(() => calculateOverall(SKILLS.map(skill => assessments[skill].band)))
watch(ready, (loaded) => {
  if (loaded && state.value.profile)
    examType.value = state.value.profile.examType
}, { immediate: true })

async function save() {
  if (busy.value || !ready.value)
    return
  busy.value = true
  message.value = ''
  formError.value = ''
  try {
    const inputs: RecordInput[] = SKILLS.filter((skill) => {
      const row = assessments[skill]
      return row.band !== null || row.rawScore !== '' || row.notes.trim()
    }).map((skill) => {
      const row = assessments[skill]
      return {
        title: `${title.value.trim()} · ${SKILL_LABELS[skill]}`,
        skill,
        kind: 'baseline',
        examType: examType.value,
        date: date.value,
        band: row.band,
        scoreSource: row.band === null ? 'unassessed' : row.scoreSource,
        rawScore: row.rawScore === '' ? null : Number(row.rawScore),
        durationMinutes: null,
        notes: row.notes.trim(),
        writing: '',
      }
    })
    if (!title.value.trim())
      throw new Error('请填写测评名称或材料来源。')
    if (!inputs.length)
      throw new Error('请至少填写一科的分数、原始分或诊断备注。未知分数可以留空。')
    await addRecords(inputs)
    message.value = `已保存 ${inputs.length} 科基线。可在概览查看差距，或在学习记录中补充附件与评价。`
    for (const skill of SKILLS) Object.assign(assessments[skill], { band: null, rawScore: '', scoreSource: 'self', notes: '' })
  }
  catch (error) { formError.value = error instanceof Error ? error.message : '基线保存失败，请重试。' }
  finally { busy.value = false }
}
</script>

<template>
  <StudyShell title="基线诊断" description="录入一次完整测评的结果，建立你的备考起点。未知分数可以留空。">
    <div v-if="message" class="study-success" role="status">
      {{ message }} <RouterLink class="study-link" to="/study">
        查看概览 →
      </RouterLink>
    </div>
    <div v-if="formError" class="study-alert" role="alert">
      {{ formError }}
    </div>
    <form @submit.prevent="save">
      <fieldset :disabled="busy || !ready">
        <section class="study-card">
          <h2>测评信息</h2>
          <div class="study-grid">
            <label class="study-field">测评名称或材料来源<input v-model="title" required maxlength="160" placeholder="例如：完整模拟测评，或教师诊断"></label>
            <label class="study-field">测评日期<input v-model="date" required type="date"></label>
            <label class="study-field">本次测评类型<select v-model="examType"><option value="academic">A 类 · 学术类</option><option value="general">G 类 · 培训类</option></select></label>
          </div>
          <p class="study-muted">
            听读请使用完整测评的结果；写作和口语请注明评价来源。原始分不自动换算为 Band，以免把不同试卷的换算混为一谈。
          </p>
        </section>
        <div class="study-grid">
          <section v-for="skill in SKILLS" :key="skill" class="study-card" :aria-label="`${SKILL_LABELS[skill]}基线`">
            <h2>{{ SKILL_LABELS[skill] }}</h2>
            <div class="study-grid">
              <label class="study-field">{{ SKILL_LABELS[skill] }}基线分数<select v-model="assessments[skill].band"><option :value="null">尚不清楚</option><option v-for="band in bands" :key="band" :value="band">{{ band.toFixed(1) }}</option></select></label>
              <label v-if="skill === 'listening' || skill === 'reading'" class="study-field">{{ SKILL_LABELS[skill] }}原始分（满分 40）<input v-model.number="assessments[skill].rawScore" type="number" min="0" max="40" step="1" placeholder="可选"></label>
            </div>
            <label class="study-field">{{ SKILL_LABELS[skill] }}评分来源<select v-model="assessments[skill].scoreSource" :disabled="assessments[skill].band === null"><template v-for="(label, source) in SCORE_SOURCE_LABELS" :key="source"><option v-if="source !== 'unassessed'" :value="source">{{ label }}</option></template></select></label>
            <label class="study-field">{{ SKILL_LABELS[skill] }}诊断备注<textarea v-model="assessments[skill].notes" rows="3" maxlength="10000" :placeholder="skill === 'writing' ? '例如：观点展开不足，记录教师反馈或各评分维度表现' : skill === 'speaking' ? '例如：回答中停顿较多，记录反馈和待改善之处' : '例如：易错题型、时间分配或理解困难'" /></label>
          </section>
        </div>
        <section class="study-card">
          <div class="study-compare">
            <div>
              <p class="study-stat-label">
                本次四科参考总分
              </p><p class="study-stat">
                {{ overall === null ? '待补齐四科' : overall.toFixed(1) }}
              </p>
            </div><p class="study-muted">
              分数来自你录入的测评结果。自评与参考换算会保留来源，不作为正式考试成绩。
            </p>
          </div>
          <div class="study-actions">
            <button class="study-button" type="submit" :disabled="busy">
              {{ busy ? '保存中…' : '保存基线诊断' }}
            </button><RouterLink class="study-button-secondary" to="/study/records">
              查看历史记录
            </RouterLink>
          </div>
        </section>
      </fieldset>
    </form>
  </StudyShell>
</template>
