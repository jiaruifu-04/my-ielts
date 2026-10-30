import { ref, toRaw } from 'vue'
import type { Ref } from 'vue'
import type { AttachmentMeta, LearnerProfile, LearningRecord, LearningSnapshot, RecordInput } from '../domain/learning'
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES, audioType, createEmptySnapshot, validateProfile, validateRecordInput } from '../domain/learning'
import type { BackupPreview, ImportSummary } from '../services/learningBackup'
import { createLearningBackup, previewLearningBackup, validatedBackupContents } from '../services/learningBackup'
import { mutateLearningData, readAttachmentBlob, readLearningData } from '../services/learningDb'

export type { BackupPreview, ImportSummary } from '../services/learningBackup'

const state = ref<LearningSnapshot>(createEmptySnapshot())
const ready = ref(false)
const error = ref('')
let initialization: Promise<void> | null = null

function id(prefix: string): string {
  if (globalThis.crypto?.randomUUID)
    return `${prefix}-${globalThis.crypto.randomUUID()}`
  if (!globalThis.crypto?.getRandomValues)
    throw new Error('浏览器不支持生成记录 ID，请使用更新的浏览器')
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0F) | 0x40
  bytes[8] = (bytes[8] & 0x3F) | 0x80
  return `${prefix}-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

async function execute<T>(action: () => Promise<T>): Promise<T> {
  error.value = ''
  try {
    return await action()
  }
  catch (reason) {
    const detail = reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string' ? reason.message : '学习数据操作失败，请重试'
    const failure = reason instanceof Error ? reason : new Error(detail)
    error.value = failure.message
    throw failure
  }
}

async function init(): Promise<void> {
  if (ready.value)
    return
  if (initialization)
    return initialization
  initialization = execute(async () => {
    const result = await readLearningData(false)
    state.value = result.snapshot
    ready.value = true
  })
  try {
    await initialization
  }
  finally {
    initialization = null
  }
}

function newRecord(input: RecordInput): LearningRecord {
  const now = new Date().toISOString()
  return { ...validateRecordInput(input), id: id('record'), attachmentIds: [], createdAt: now, updatedAt: now }
}

function prepareFiles(recordId: string, files: File[]): { metas: AttachmentMeta[]; blobs: Map<string, Blob> } {
  if (!Array.isArray(files) || files.length > MAX_ATTACHMENTS)
    throw new Error('音频附件数量超过限制')
  const metas: AttachmentMeta[] = []
  const blobs = new Map<string, Blob>()
  let total = 0
  for (const file of files) {
    if (!(file instanceof Blob) || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 255)
      throw new Error('音频附件格式或名称无效')
    if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES)
      throw new Error('单个音频附件须大于 0 且不超过 20 MiB')
    total += file.size
    if (total > MAX_TOTAL_ATTACHMENT_BYTES)
      throw new Error('音频附件总量不能超过 100 MiB')
    const type = audioType(file.name, file.type)
    const attachmentId = id('audio')
    metas.push({ id: attachmentId, name: file.name, type, size: file.size, recordId, createdAt: new Date().toISOString() })
    blobs.set(attachmentId, new Blob([file], { type }))
  }
  return { metas, blobs }
}

async function saveProfile(profile: LearnerProfile): Promise<void> {
  return execute(async () => {
    const validated = validateProfile(profile)
    const saved = await mutateLearningData(snapshot => ({ snapshot: { ...snapshot, profile: validated }, result: undefined }))
    state.value = saved.snapshot
    ready.value = true
  })
}

async function addRecords(inputs: RecordInput[]): Promise<LearningRecord[]> {
  return execute(async () => {
    if (!Array.isArray(inputs) || inputs.length === 0)
      throw new Error('请至少填写一条学习记录')
    const records = inputs.map(newRecord)
    const saved = await mutateLearningData(snapshot => ({ snapshot: { ...snapshot, records: [...snapshot.records, ...records] }, result: records }))
    state.value = saved.snapshot
    ready.value = true
    return saved.result
  })
}

async function addRecord(input: RecordInput, files: File[] = []): Promise<LearningRecord> {
  return execute(async () => {
    const record = newRecord(input)
    const attachments = prepareFiles(record.id, files)
    record.attachmentIds = attachments.metas.map(meta => meta.id)
    const saved = await mutateLearningData(snapshot => ({ snapshot: { ...snapshot, records: [...snapshot.records, record], attachments: [...snapshot.attachments, ...attachments.metas] }, result: record, putBlobs: attachments.blobs }))
    state.value = saved.snapshot
    ready.value = true
    return saved.result
  })
}

async function updateRecord(recordId: string, input: RecordInput, files: File[] = [], removeAttachmentIds: string[] = []): Promise<LearningRecord> {
  return execute(async () => {
    if (!Array.isArray(removeAttachmentIds) || removeAttachmentIds.some(value => typeof value !== 'string'))
      throw new Error('要删除的音频列表无效')
    const validated = validateRecordInput(input)
    const attachments = prepareFiles(recordId, files)
    const removed = new Set(removeAttachmentIds)
    const saved = await mutateLearningData((snapshot) => {
      const previous = snapshot.records.find(record => record.id === recordId)
      if (!previous)
        throw new Error('找不到要修改的学习记录，请刷新后重试')
      if ([...removed].some(attachmentId => !previous.attachmentIds.includes(attachmentId)))
        throw new Error('要删除的音频不属于这条学习记录')
      const record: LearningRecord = { ...previous, ...validated, attachmentIds: [...previous.attachmentIds.filter(attachmentId => !removed.has(attachmentId)), ...attachments.metas.map(meta => meta.id)], updatedAt: new Date().toISOString() }
      return {
        snapshot: { ...snapshot, records: snapshot.records.map(item => item.id === recordId ? record : item), attachments: [...snapshot.attachments.filter(meta => !removed.has(meta.id)), ...attachments.metas] },
        result: record,
        putBlobs: attachments.blobs,
      }
    })
    state.value = saved.snapshot
    ready.value = true
    return saved.result
  })
}

async function deleteRecord(recordId: string): Promise<void> {
  return execute(async () => {
    const saved = await mutateLearningData((snapshot) => {
      if (!snapshot.records.some(record => record.id === recordId))
        throw new Error('找不到要删除的学习记录，请刷新后重试')
      return { snapshot: { ...snapshot, records: snapshot.records.filter(record => record.id !== recordId), attachments: snapshot.attachments.filter(meta => meta.recordId !== recordId) }, result: undefined }
    })
    state.value = saved.snapshot
    ready.value = true
  })
}

async function getAttachmentBlob(attachmentId: string): Promise<Blob> {
  return execute(() => readAttachmentBlob(attachmentId))
}

async function exportBackup(): Promise<string> {
  return execute(async () => {
    const { snapshot, blobs } = await readLearningData()
    return createLearningBackup(snapshot, blobs)
  })
}

async function previewBackup(text: string): Promise<BackupPreview> {
  return execute(() => previewLearningBackup(text))
}

async function importBackup(preview: BackupPreview, options: { restoreProfile: boolean }): Promise<ImportSummary> {
  return execute(async () => {
    const incoming = validatedBackupContents(toRaw(preview))
    if (!options || typeof options.restoreProfile !== 'boolean')
      throw new Error('请选择是否恢复目标设置')
    const saved = await mutateLearningData((snapshot) => {
      const existingRecords = new Set(snapshot.records.map(record => record.id))
      const existingAttachments = new Set(snapshot.attachments.map(meta => meta.id))
      const addedRecords = incoming.snapshot.records.filter(record => !existingRecords.has(record.id) && !record.attachmentIds.some(attachmentId => existingAttachments.has(attachmentId)))
      const addedIds = new Set(addedRecords.map(record => record.id))
      const addedAttachments = incoming.snapshot.attachments.filter(meta => addedIds.has(meta.recordId))
      const putBlobs = new Map(addedAttachments.map(meta => [meta.id, incoming.blobs.get(meta.id)!]))
      const profileRestored = options.restoreProfile && incoming.snapshot.profile !== null
      return {
        snapshot: {
          ...snapshot,
          profile: profileRestored ? incoming.snapshot.profile : snapshot.profile,
          records: [...snapshot.records, ...addedRecords],
          attachments: [...snapshot.attachments, ...addedAttachments],
        },
        putBlobs,
        result: {
          recordsAdded: addedRecords.length,
          recordsSkipped: incoming.snapshot.records.length - addedRecords.length,
          attachmentsAdded: addedAttachments.length,
          attachmentsSkipped: incoming.snapshot.attachments.length - addedAttachments.length,
          profileRestored,
        },
      }
    })
    state.value = saved.snapshot
    ready.value = true
    return saved.result
  })
}

export interface LearningStore {
  state: Ref<LearningSnapshot>
  ready: Ref<boolean>
  error: Ref<string>
  init: typeof init
  saveProfile: typeof saveProfile
  addRecords: typeof addRecords
  addRecord: typeof addRecord
  updateRecord: typeof updateRecord
  deleteRecord: typeof deleteRecord
  getAttachmentBlob: typeof getAttachmentBlob
  exportBackup: typeof exportBackup
  previewBackup: typeof previewBackup
  importBackup: typeof importBackup
}

export function useLearningStore(): LearningStore {
  return { state, ready, error, init, saveProfile, addRecords, addRecord, updateRecord, deleteRecord, getAttachmentBlob, exportBackup, previewBackup, importBackup }
}
