<script setup lang="ts">
import { SCORE_SOURCE_LABELS, SKILLS, SKILL_LABELS, calculateOverall, latestBaselines } from '~/domain/learning'
import { useLearningStore } from '~/composables/useLearningStore'

const { state } = useLearningStore()
const examType = computed(() => state.value.profile?.examType || 'academic')
const baseline = computed(() => latestBaselines(state.value, examType.value))
const overall = computed(() => calculateOverall(SKILLS.map(skill => baseline.value[skill]?.band ?? null)))
const target = computed(() => state.value.profile?.overallTarget ?? 7.5)
const records = computed(() => state.value.records.filter(record => record.examType === examType.value))
const recent = computed(() => [...records.value].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4))
const baselineCount = computed(() => SKILLS.filter(skill => baseline.value[skill] !== null).length)
const gradedCount = computed(() => SKILLS.filter(skill => baseline.value[skill]?.band !== null && baseline.value[skill]?.band !== undefined).length)
const recommendations = computed(() => {
  const result: string[] = []
  if (!state.value.profile)
    result.push('先设置考试类型、目标总分和单项要求。')
  const missing = SKILLS.filter(skill => baseline.value[skill]?.band === null || baseline.value[skill]?.band === undefined)
  if (missing.length)
    result.push(`补充${missing.map(skill => SKILL_LABELS[skill]).join('、')}基线分数，建立更完整的起点。`)
  for (const skill of SKILLS) {
    const score = baseline.value[skill]?.band
    const minimum = state.value.profile?.minimumScores[skill]
    if (score !== null && score !== undefined && minimum !== null && minimum !== undefined && score < minimum)
      result.push(`${SKILL_LABELS[skill]}基线 ${score.toFixed(1)}，距单项最低要求 ${minimum.toFixed(1)} 还差 ${(minimum - score).toFixed(1)} 分，优先记录这一科的错误和反馈。`)
  }
  if (!result.length)
    result.push('四科起点已建立。完成下一次训练后，记录表现、具体问题和反馈。')
  return result
})
</script>

<template>
  <StudyShell :title="`你的 ${target.toFixed(1)} 备考中心`" description="从一次真实测评出发，记录每一步训练，让进步有据可查。">
    <section class="study-card">
      <div class="study-compare">
        <div>
          <p class="study-stat-label">
            {{ state.profile ? '目标总分' : '建议目标 · 尚未保存' }}
          </p><p class="study-stat">
            {{ target.toFixed(1) }}
          </p><p class="study-muted">
            {{ examType === 'academic' ? 'A 类 · 学术类' : 'G 类 · 培训类' }}<span v-if="state.profile?.examDate"> · {{ state.profile.examDate }} 考试</span>
          </p>
        </div>
        <div>
          <p class="study-stat-label">
            基线参考总分
          </p><p class="study-stat">
            {{ overall === null ? '—' : overall.toFixed(1) }}
          </p><p class="study-muted">
            {{ gradedCount }}/4 科已填写分数
          </p>
        </div>
        <div>
          <p class="study-stat-label">
            本类型学习记录
          </p><p class="study-stat">
            {{ records.length }}
          </p><p class="study-muted">
            {{ baselineCount }} 科已有基线记录
          </p>
        </div>
      </div>
      <div class="study-actions">
        <RouterLink class="study-button" :to="state.profile ? '/study/baseline' : '/study/goals'">
          {{ state.profile ? '录入基线诊断' : '设置我的目标' }}
        </RouterLink><RouterLink class="study-button-secondary" to="/study/records">
          记录一次训练
        </RouterLink>
      </div>
    </section>
    <div class="study-grid-four">
      <section v-for="skill in SKILLS" :key="skill" class="study-card">
        <h2>{{ SKILL_LABELS[skill] }}</h2>
        <p class="study-stat">
          {{ baseline[skill]?.band?.toFixed(1) ?? '—' }}
        </p>
        <p class="study-muted">
          最低要求 {{ state.profile?.minimumScores[skill]?.toFixed(1) ?? '未设置' }}
        </p>
        <div class="study-progress" aria-hidden="true">
          <span :style="{ width: `${((baseline[skill]?.band ?? 0) / 9) * 100}%` }" />
        </div>
        <p class="study-stat-label">
          {{ baseline[skill] ? `${baseline[skill]?.date} · ${SCORE_SOURCE_LABELS[baseline[skill]!.scoreSource]}` : '还没有基线记录' }}
        </p>
      </section>
    </div>
    <div class="study-grid">
      <section class="study-card">
        <h2>接下来做什么</h2>
        <div v-for="(item, index) in recommendations" :key="item" class="study-step">
          <span class="study-step-number">{{ index + 1 }}</span><p>{{ item }}</p>
        </div>
        <p class="study-muted" style="margin-top: 15px">
          基线参考总分由各科最新基线组合计算，可能来自不同测评。训练成绩和自评只用于规划。
        </p>
      </section>
      <section class="study-card">
        <h2>最近的学习记录</h2>
        <p v-if="!recent.length" class="study-empty">
          还没有记录。可以先录入基线，或记下今天的一次训练。
        </p>
        <div v-for="record in recent" :key="record.id" class="study-step">
          <div>
            <p style="font-weight: 650">
              {{ record.title }}
            </p><p class="study-muted">
              {{ record.date }} · {{ SKILL_LABELS[record.skill] }} · {{ record.band === null ? '未评分' : `${record.band.toFixed(1)} 分` }}
            </p>
          </div>
        </div>
        <RouterLink class="study-link" to="/study/records">
          查看全部记录 →
        </RouterLink>
      </section>
    </div>
  </StudyShell>
</template>
