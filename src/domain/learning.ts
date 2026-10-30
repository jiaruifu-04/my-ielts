export const SKILLS = ['listening', 'reading', 'writing', 'speaking'] as const
export type Skill = typeof SKILLS[number]

export const SKILL_LABELS: Record<Skill, string> = {
  listening: '听力',
  reading: '阅读',
  writing: '写作',
  speaking: '口语',
}

export const SCORE_SOURCE_LABELS = {
  official: '正式考试',
  teacher: '教师评价',
  self: '自评',
  reference: '参考换算',
  unassessed: '尚未评分',
} as const
export type ScoreSource = keyof typeof SCORE_SOURCE_LABELS
export type RecordKind = 'baseline' | 'practice'

export interface LearnerProfile {
  examType: 'academic' | 'general'
  overallTarget: number
  minimumScores: Record<Skill, number | null>
  examDate: string | null
}

export interface LearningRecord {
  id: string
  title: string
  skill: Skill
  examType: 'academic' | 'general'
  kind: RecordKind
  date: string
  band: number | null
  scoreSource: ScoreSource
  rawScore: number | null
  durationMinutes: number | null
  notes: string
  writing: string
  attachmentIds: string[]
  createdAt: string
  updatedAt: string
}

export type RecordInput = Omit<LearningRecord, 'id' | 'attachmentIds' | 'createdAt' | 'updatedAt'>

export interface AttachmentMeta {
  id: string
  name: string
  type: string
  size: number
  recordId: string
  createdAt: string
}

export interface LearningSnapshot {
  schemaVersion: 1
  profile: LearnerProfile | null
  records: LearningRecord[]
  attachments: AttachmentMeta[]
}

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024
export const MAX_BACKUP_TEXT_BYTES = 150 * 1024 * 1024
export const MAX_RECORDS = 10000
export const MAX_ATTACHMENTS = 1000

export function createEmptySnapshot(): LearningSnapshot {
  return { schemaVersion: 1, profile: null, records: [], attachments: [] }
}

export function createDefaultProfile(): LearnerProfile {
  return {
    examType: 'academic',
    overallTarget: 7.5,
    minimumScores: { listening: null, reading: null, writing: null, speaking: null },
    examDate: null,
  }
}

export function isBand(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 9 && Number.isInteger(value * 2)
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}格式无效`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new Error(`${label}格式无效或超出长度限制`)
  return value
}

function identifier(value: unknown, label: string): string {
  const result = text(value, label, 200, true)
  if (Array.from(result).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
    throw new Error(`${label}包含无效字符`)
  return result
}

export function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    return false
  return isValidDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60 && Number.isFinite(Date.parse(value))
}

function timestamp(value: unknown, label: string): string {
  if (!isValidTimestamp(value))
    throw new Error(`${label}必须是有效的 UTC 时间`)
  return value
}

export function validateProfile(value: unknown): LearnerProfile {
  const data = object(value, '目标设置')
  if (!['academic', 'general'].includes(data.examType as string))
    throw new Error('考试类型无效')
  if (!isBand(data.overallTarget))
    throw new Error('目标总分必须为 0 到 9 的整数或半分')
  const scores = object(data.minimumScores, '单项目标')
  const minimumScores = {} as LearnerProfile['minimumScores']
  for (const skill of SKILLS) {
    if (scores[skill] !== null && !isBand(scores[skill]))
      throw new Error(`${SKILL_LABELS[skill]}最低分无效`)
    minimumScores[skill] = scores[skill] as number | null
  }
  if (data.examDate !== null && !isValidDate(data.examDate))
    throw new Error('考试日期无效')
  return { examType: data.examType as LearnerProfile['examType'], overallTarget: data.overallTarget, minimumScores, examDate: data.examDate as string | null }
}

export function validateRecordInput(value: unknown): RecordInput {
  const data = object(value, '学习记录')
  if (!SKILLS.includes(data.skill as Skill))
    throw new Error('学习科目无效')
  if (!['academic', 'general'].includes(data.examType as string))
    throw new Error('记录的考试类型无效')
  if (!['baseline', 'practice'].includes(data.kind as string))
    throw new Error('记录类型无效')
  if (!isValidDate(data.date))
    throw new Error('练习日期无效')
  if (data.band !== null && !isBand(data.band))
    throw new Error('单项分数必须为 0 到 9 的整数或半分')
  if (typeof data.scoreSource !== 'string' || !Object.prototype.hasOwnProperty.call(SCORE_SOURCE_LABELS, data.scoreSource))
    throw new Error('评分来源无效')
  if (data.scoreSource === 'unassessed' && data.band !== null)
    throw new Error('尚未评分的记录不能填写单项分数')
  if (data.rawScore !== null && (typeof data.rawScore !== 'number' || !Number.isInteger(data.rawScore) || data.rawScore < 0 || data.rawScore > 40))
    throw new Error('原始分必须为 0 到 40 的整数')
  if (data.rawScore !== null && !['listening', 'reading'].includes(data.skill as string))
    throw new Error('只有听力和阅读可以填写原始分')
  if (data.durationMinutes !== null && (typeof data.durationMinutes !== 'number' || !Number.isFinite(data.durationMinutes) || data.durationMinutes <= 0 || data.durationMinutes > 1440))
    throw new Error('练习时长必须大于 0 且不超过 1440 分钟')
  return {
    title: text(data.title, '标题', 200, true).trim(),
    skill: data.skill as Skill,
    examType: data.examType as LearnerProfile['examType'],
    kind: data.kind as RecordKind,
    date: data.date,
    band: data.band as number | null,
    scoreSource: data.scoreSource as ScoreSource,
    rawScore: data.rawScore as number | null,
    durationMinutes: data.durationMinutes as number | null,
    notes: text(data.notes, '备注', 10000),
    writing: text(data.writing, '作文正文', 100000),
  }
}

export function validateRecord(value: unknown): LearningRecord {
  const data = object(value, '学习记录')
  if (!Array.isArray(data.attachmentIds) || data.attachmentIds.length > MAX_ATTACHMENTS)
    throw new Error('附件列表无效')
  const attachmentIds = data.attachmentIds.map(id => identifier(id, '附件 ID'))
  if (new Set(attachmentIds).size !== attachmentIds.length)
    throw new Error('记录中包含重复的附件 ID')
  const createdAt = timestamp(data.createdAt, '记录创建时间')
  const updatedAt = timestamp(data.updatedAt, '记录更新时间')
  if (Date.parse(updatedAt) < Date.parse(createdAt))
    throw new Error('记录更新时间早于创建时间')
  return { ...validateRecordInput(data), id: identifier(data.id, '记录 ID'), attachmentIds, createdAt, updatedAt }
}

const AUDIO_EXTENSIONS: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
  flac: 'audio/flac',
}

export function audioType(name: string, type: string): string {
  if (/^audio\/[a-z0-9.+-]+$/i.test(type))
    return type.toLowerCase()
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if ((!type || type === 'application/octet-stream' || type === 'video/mp4' || type === 'video/webm') && AUDIO_EXTENSIONS[ext])
    return AUDIO_EXTENSIONS[ext]
  throw new Error('附件必须为 MP3、M4A、WAV、OGG 等音频文件')
}

export function validateAttachment(value: unknown): AttachmentMeta {
  const data = object(value, '音频附件')
  const name = text(data.name, '附件名称', 255, true)
  if (typeof data.type !== 'string' || !/^audio\/[a-z0-9.+-]+$/i.test(data.type))
    throw new Error('附件音频类型无效')
  if (typeof data.size !== 'number' || !Number.isInteger(data.size) || data.size <= 0 || data.size > MAX_ATTACHMENT_BYTES)
    throw new Error('单个音频附件须大于 0 且不超过 20 MiB')
  return { id: identifier(data.id, '附件 ID'), name, type: data.type.toLowerCase(), size: data.size, recordId: identifier(data.recordId, '附件所属记录 ID'), createdAt: timestamp(data.createdAt, '附件创建时间') }
}

export function validateSnapshot(value: unknown): LearningSnapshot {
  const data = object(value, '学习数据')
  if (data.schemaVersion !== 1)
    throw new Error('不支持的备份数据版本，仅支持 schemaVersion 1')
  if (!Array.isArray(data.records) || data.records.length > MAX_RECORDS || !Array.isArray(data.attachments) || data.attachments.length > MAX_ATTACHMENTS)
    throw new Error('记录或附件列表无效，或超过数量限制')
  const profile = data.profile === null ? null : validateProfile(data.profile)
  const records = data.records.map(validateRecord)
  const attachments = data.attachments.map(validateAttachment)
  const recordMap = new Map(records.map(record => [record.id, record]))
  const attachmentMap = new Map(attachments.map(attachment => [attachment.id, attachment]))
  if (recordMap.size !== records.length || attachmentMap.size !== attachments.length)
    throw new Error('学习数据中存在重复 ID')
  if (attachments.reduce((sum, attachment) => sum + attachment.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES)
    throw new Error('音频附件总量不能超过 100 MiB')
  for (const record of records) {
    for (const id of record.attachmentIds) {
      const attachment = attachmentMap.get(id)
      if (!attachment || attachment.recordId !== record.id)
        throw new Error('记录引用了缺失或不属于它的音频附件')
    }
  }
  for (const attachment of attachments) {
    if (!recordMap.get(attachment.recordId)?.attachmentIds.includes(attachment.id))
      throw new Error('发现没有所属记录的孤立音频附件')
  }
  return { schemaVersion: 1, profile, records, attachments }
}

/** IELTS overall rounding; partial component scores have no overall result. */
export function calculateOverall(bands: Record<Skill, number | null> | readonly (number | null)[]): number | null {
  const values = Array.isArray(bands) ? bands : SKILLS.map(skill => (bands as Record<Skill, number | null>)[skill])
  if (values.length !== 4 || values.some(value => !isBand(value)))
    return null
  return Math.round(values.reduce<number>((sum, value) => sum + (value as number), 0) / 4 * 2) / 2
}

export function latestBaselines(snapshot: LearningSnapshot, examType?: LearnerProfile['examType']): Record<Skill, LearningRecord | null> {
  const result: Record<Skill, LearningRecord | null> = { listening: null, reading: null, writing: null, speaking: null }
  const records = snapshot.records.filter(record => record.kind === 'baseline' && (!examType || record.examType === examType)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  for (const record of records) {
    if (!result[record.skill])
      result[record.skill] = record
  }
  return result
}
