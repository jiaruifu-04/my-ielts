import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toRaw } from 'vue'
import type { LearningRecord, RecordInput } from '../src/domain/learning'
import { MAX_ATTACHMENT_BYTES, calculateOverall, createDefaultProfile, createEmptySnapshot, isValidDate, isValidTimestamp, latestBaselines, validateProfile, validateRecordInput, validateSnapshot } from '../src/domain/learning'
import { useLearningStore } from '../src/composables/useLearningStore'
import { closeLearningDb, openLearningDb, readLearningData } from '../src/services/learningDb'

const store = useLearningStore()

function input(overrides: Partial<RecordInput> = {}): RecordInput {
  return { title: '听力基线', examType: 'academic', skill: 'listening', kind: 'baseline', date: '2026-10-30', band: 7, scoreSource: 'self', rawScore: 32, durationMinutes: 30, notes: '', writing: '', ...overrides }
}

function audio(name = 'answer.m4a'): File {
  return new NodeFile([new Uint8Array([0, 1, 2, 250, 251, 252, 255])], name, { type: 'audio/mp4' }) as unknown as File
}

function storedRecord(overrides: Partial<LearningRecord> = {}): LearningRecord {
  return { ...input(), id: 'record-test', attachmentIds: [], createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z', ...overrides }
}

beforeEach(async () => {
  await closeLearningDb()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('File', NodeFile)
  store.ready.value = false
  store.error.value = ''
  store.state.value = createEmptySnapshot()
  await store.init()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await closeLearningDb()
  vi.unstubAllGlobals()
})

describe('learning model', () => {
  it('validates real calendar dates and half bands', () => {
    expect(isValidDate('2024-02-29')).toBe(true)
    expect(isValidDate('2026-02-29')).toBe(false)
    expect(isValidDate('2026-02-30')).toBe(false)
    expect(isValidDate('2026-13-01')).toBe(false)
    expect(isValidTimestamp('2026-10-30T24:00:00.000Z')).toBe(false)
    expect(() => validateRecordInput(input({ band: 7.2 }))).toThrow('单项分数')
    expect(() => validateRecordInput(input({ rawScore: 41 }))).toThrow('原始分')
    expect(() => validateRecordInput(input({ date: '2026-02-30' }))).toThrow('日期')
    expect(() => validateRecordInput(input({ scoreSource: 'unassessed' }))).toThrow('尚未评分')
    expect(() => validateProfile({ ...createDefaultProfile(), overallTarget: 10 })).toThrow('目标总分')
  })

  it('rounds complete overall scores and preserves missing components', () => {
    expect(calculateOverall([8, 8, 7, 7])).toBe(7.5)
    expect(calculateOverall([6.5, 6.5, 5, 7])).toBe(6.5)
    expect(calculateOverall([8, 8, 7.5, 7.5])).toBe(8)
    expect(calculateOverall({ listening: 8, reading: 8, writing: null, speaking: 7 })).toBeNull()
    expect(calculateOverall([8, 8, 7])).toBeNull()
  })

  it('keeps academic and general baseline history separate', () => {
    const snapshot = createEmptySnapshot()
    snapshot.records = [storedRecord({ id: 'academic', examType: 'academic', date: '2026-10-29' }), storedRecord({ id: 'general', examType: 'general', date: '2026-10-30', band: 8 })]
    expect(latestBaselines(snapshot, 'academic').listening?.id).toBe('academic')
    expect(latestBaselines(snapshot, 'general').listening?.id).toBe('general')
    expect(latestBaselines(snapshot).reading).toBeNull()
  })

  it('does not promote an older same-day baseline when only its notes were edited', () => {
    const snapshot = createEmptySnapshot()
    snapshot.records = [
      storedRecord({ id: 'earlier', band: 6, createdAt: '2026-10-30T08:00:00.000Z', updatedAt: '2026-10-30T12:00:00.000Z' }),
      storedRecord({ id: 'later', band: 7, createdAt: '2026-10-30T10:00:00.000Z', updatedAt: '2026-10-30T10:00:00.000Z' }),
    ]
    expect(latestBaselines(snapshot, 'academic').listening?.id).toBe('later')
  })

  it('rejects duplicate IDs and orphan attachments', () => {
    const snapshot = createEmptySnapshot()
    snapshot.records = [storedRecord(), storedRecord()]
    expect(() => validateSnapshot(snapshot)).toThrow('重复 ID')
    snapshot.records = [storedRecord({ attachmentIds: ['missing'] })]
    expect(() => validateSnapshot(snapshot)).toThrow('缺失')
  })
})

describe('durable learning records', () => {
  it('persists target settings and record updates through a fresh read', async () => {
    await store.saveProfile(createDefaultProfile())
    const record = await store.addRecord(input())
    await store.updateRecord(record.id, input({ notes: '复习干扰项', band: 7.5 }))
    const loaded = await readLearningData()
    expect(loaded.snapshot.profile?.overallTarget).toBe(7.5)
    expect(loaded.snapshot.records[0].notes).toBe('复习干扰项')
    expect(loaded.snapshot.records[0].band).toBe(7.5)
    expect(loaded.snapshot.records[0].createdAt).toBe(record.createdAt)
    expect(loaded.snapshot.records[0].examType).toBe('academic')
  })

  it('saves four baselines together and rejects an invalid batch without partial writes', async () => {
    const records = await store.addRecords([
      input(), input({ skill: 'reading', title: '阅读' }),
      input({ skill: 'writing', title: '写作', rawScore: null }), input({ skill: 'speaking', title: '口语', rawScore: null }),
    ])
    expect(records).toHaveLength(4)
    await expect(store.addRecords([input(), input({ band: 7.2 })])).rejects.toThrow('单项分数')
    expect((await readLearningData()).snapshot.records).toHaveLength(4)
  })

  it('handles concurrent writes without dropping either record', async () => {
    await Promise.all([store.addRecord(input({ title: '第一条' })), store.addRecord(input({ title: '第二条' }))])
    expect((await readLearningData()).snapshot.records.map(record => record.title).sort()).toEqual(['第一条', '第二条'].sort())
  })

  it('adds, removes, and deletes audio in the same transaction as its record', async () => {
    const record = await store.addRecord(input({ skill: 'speaking', rawScore: null }), [audio()])
    const attachmentId = record.attachmentIds[0]
    expect(await (await store.getAttachmentBlob(attachmentId)).arrayBuffer()).toEqual(await audio().arrayBuffer())
    await store.updateRecord(record.id, input({ skill: 'speaking', rawScore: null }), [audio('retry.m4a')], [attachmentId])
    await expect(store.getAttachmentBlob(attachmentId)).rejects.toThrow('不存在')
    expect((await readLearningData()).blobs.size).toBe(1)
    await store.deleteRecord(record.id)
    const empty = await readLearningData()
    expect(empty.snapshot.records).toHaveLength(0)
    expect(empty.snapshot.attachments).toHaveLength(0)
    const db = await openLearningDb()
    const count = await new Promise<number>((resolve) => {
      const request = db.transaction('attachments').objectStore('attachments').count()
      request.onsuccess = () => resolve(request.result)
    })
    expect(count).toBe(0)
  })

  it('rejects oversized or non-audio uploads before writing a record', async () => {
    const bad = new NodeFile(['text'], 'notes.txt', { type: 'text/plain' }) as unknown as File
    await expect(store.addRecord(input(), [bad])).rejects.toThrow('音频文件')
    const large = new NodeFile([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], 'large.mp3', { type: 'audio/mpeg' }) as unknown as File
    await expect(store.addRecord(input(), [large])).rejects.toThrow('20 MiB')
    expect((await readLearningData()).snapshot.records).toHaveLength(0)
  })

  it('does not expose an in-memory save when the database transaction fails', async () => {
    const originalPut = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'state')
        throw new DOMException('Disk full', 'QuotaExceededError')
      return originalPut.call(this, value, key)
    })
    await expect(store.addRecord(input(), [audio()])).rejects.toThrow('Disk full')
    expect(store.error.value).toContain('Disk full')
    expect(store.state.value.records).toHaveLength(0)
    vi.restoreAllMocks()
    expect((await readLearningData()).snapshot.records).toHaveLength(0)
    const db = await openLearningDb()
    const count = await new Promise<number>((resolve) => {
      const request = db.transaction('attachments').objectStore('attachments').count()
      request.onsuccess = () => resolve(request.result)
    })
    expect(count).toBe(0)
  })

  it('reports unavailable storage rather than using temporary memory as a fallback', async () => {
    await closeLearningDb()
    vi.stubGlobal('indexedDB', undefined)
    store.ready.value = false
    await expect(store.init()).rejects.toThrow('存储不可用')
    expect(store.ready.value).toBe(false)
    expect(store.error.value).toContain('存储不可用')
  })
})

describe('complete JSON backup', () => {
  it('round trips profile, text, and exact audio bytes into an empty database', async () => {
    await store.saveProfile(createDefaultProfile())
    await store.addRecord(input({ notes: '错因：同义改写', writing: 'A written response.' }), [audio()])
    const original = toRaw(store.state.value)
    const json = await store.exportBackup()
    const preview = await store.previewBackup(json)
    expect(preview.recordCount).toBe(1)
    expect(preview.attachmentCount).toBe(1)
    expect(preview.totalBytes).toBe(7)
    await closeLearningDb()
    vi.stubGlobal('indexedDB', new IDBFactory())
    const summary = await store.importBackup(preview, { restoreProfile: true })
    expect(summary).toEqual({ recordsAdded: 1, recordsSkipped: 0, attachmentsAdded: 1, attachmentsSkipped: 0, profileRestored: true })
    const restored = await readLearningData()
    expect(restored.snapshot).toEqual(original)
    expect(await restored.blobs.values().next().value!.arrayBuffer()).toEqual(await audio().arrayBuffer())
  })

  it('retains local same-ID records and their audio by default', async () => {
    const record = await store.addRecord(input({ notes: '本地版本' }), [audio()])
    const backup = JSON.parse(await store.exportBackup())
    backup.data.records[0].notes = '备份版本'
    backup.data.profile = { ...createDefaultProfile(), overallTarget: 8 }
    const preview = await store.previewBackup(JSON.stringify(backup))
    const summary = await store.importBackup(preview, { restoreProfile: false })
    expect(summary.recordsSkipped).toBe(1)
    expect(summary.attachmentsSkipped).toBe(1)
    expect(store.state.value.records.find(item => item.id === record.id)?.notes).toBe('本地版本')
    expect(store.state.value.profile).toBeNull()
    expect((await readLearningData()).blobs.size).toBe(1)
  })

  it('does not let modified preview data replace validated backup content', async () => {
    const record = await store.addRecord(input())
    const preview = await store.previewBackup(await store.exportBackup())
    preview.data.records[0].title = '预览后篡改'
    await store.deleteRecord(record.id)
    await store.importBackup(preview, { restoreProfile: false })
    expect(store.state.value.records[0].title).toBe('听力基线')
    await expect(store.importBackup({ ...preview }, { restoreProfile: false })).rejects.toThrow('预览已失效')
  })

  it('skips a new incoming record if its attachment ID conflicts with a local record', async () => {
    const local = await store.addRecord(input({ notes: '保留本地音频' }), [audio()])
    const backup = JSON.parse(await store.exportBackup())
    backup.data.records[0].id = 'incoming-new-record'
    backup.data.attachments[0].recordId = 'incoming-new-record'
    const preview = await store.previewBackup(JSON.stringify(backup))
    const summary = await store.importBackup(preview, { restoreProfile: false })
    expect(summary.recordsSkipped).toBe(1)
    expect(summary.attachmentsSkipped).toBe(1)
    const stored = await readLearningData()
    expect(stored.snapshot.records.map(record => record.id)).toEqual([local.id])
    expect(stored.blobs.size).toBe(1)
  })

  it('rejects non-canonical base64 padding even when decoded size matches', async () => {
    await store.addRecord(input(), [new NodeFile([new Uint8Array([0])], 'one.mp3', { type: 'audio/mpeg' }) as unknown as File])
    const backup = JSON.parse(await store.exportBackup())
    backup.blobs[0].base64 = 'AB=='
    await expect(store.previewBackup(JSON.stringify(backup))).rejects.toThrow('编码不规范')
  })

  it('rejects unknown schemas, invalid dates or scores, and orphan attachments', async () => {
    await store.addRecord(input(), [audio()])
    const source = await store.exportBackup()
    const mutations = [
      (data: any) => { data.schemaVersion = 2 },
      (data: any) => { data.data.schemaVersion = 2 },
      (data: any) => { data.exportedAt = '2026-02-30T00:00:00.000Z' },
      (data: any) => { data.data.records[0].date = '2026-02-30' },
      (data: any) => { data.data.records[0].band = 7.2 },
      (data: any) => { data.data.attachments[0].recordId = 'missing-record' },
    ]
    for (const mutate of mutations) {
      const malformed = JSON.parse(source)
      mutate(malformed)
      await expect(store.previewBackup(JSON.stringify(malformed))).rejects.toThrow()
    }
    expect((await readLearningData()).snapshot.records).toHaveLength(1)
  })

  it('rejects missing audio payloads, invalid base64, and mismatched sizes', async () => {
    await store.addRecord(input(), [audio()])
    const source = await store.exportBackup()
    for (const mutate of [
      (data: any) => { data.blobs = [] },
      (data: any) => { data.blobs[0].base64 = '!!!!' },
      (data: any) => { data.blobs[0].base64 = 'AB==' },
      (data: any) => { data.data.attachments[0].size += 1 },
      (data: any) => { data.data.attachments[0].size = MAX_ATTACHMENT_BYTES + 1 },
    ]) {
      const malformed = JSON.parse(source)
      mutate(malformed)
      await expect(store.previewBackup(JSON.stringify(malformed))).rejects.toThrow()
    }
  })

  it('refuses export when a stored audio blob is missing', async () => {
    const record = await store.addRecord(input(), [audio()])
    const db = await openLearningDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('attachments', 'readwrite')
      transaction.objectStore('attachments').delete(record.attachmentIds[0])
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    await expect(store.exportBackup()).rejects.toThrow('缺失或损坏')
  })
})
