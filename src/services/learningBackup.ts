import type { LearningSnapshot } from '../domain/learning'
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_BACKUP_TEXT_BYTES, isValidTimestamp, validateSnapshot } from '../domain/learning'
import { assertAttachmentBlob } from './learningDb'

const BACKUP_FORMAT = 'my-ielts-learning-backup'

export interface BackupPreview {
  readonly data: LearningSnapshot
  readonly exportedAt: string
  readonly recordCount: number
  readonly attachmentCount: number
  readonly totalBytes: number
}

export interface ImportSummary {
  recordsAdded: number
  recordsSkipped: number
  attachmentsAdded: number
  attachmentsSkipped: number
  profileRestored: boolean
}

interface ValidatedBackup {
  snapshot: LearningSnapshot
  blobs: Map<string, Blob>
}

const validatedPreviews = new WeakMap<BackupPreview, ValidatedBackup>()

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('备份文件结构无效')
  return value as Record<string, unknown>
}

function validateTextSize(value: string): void {
  if (value.length > MAX_BACKUP_TEXT_BYTES || new Blob([value]).size > MAX_BACKUP_TEXT_BYTES)
    throw new Error('备份文件超过 150 MiB 限制')
}

async function toBase64(blob: Blob): Promise<string> {
  let bytes: Uint8Array
  if (typeof blob.arrayBuffer === 'function') {
    bytes = new Uint8Array(await blob.arrayBuffer())
  }
  else {
    bytes = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
      reader.onerror = () => reject(new Error('无法读取备份中的音频文件'))
      reader.readAsArrayBuffer(blob)
    })
  }
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 32768)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)))
  return btoa(chunks.join(''))
}

function fromBase64(value: unknown, size: number, type: string): Blob {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new Error('备份中存在无效或过大的 Base64 音频')
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  if (value.length / 4 * 3 - padding !== size)
    throw new Error('备份音频大小与附件信息不一致')
  let binary: string
  try {
    binary = atob(value)
  }
  catch {
    throw new Error('备份中存在无法解码的 Base64 音频')
  }
  // Canonical encoding also rejects non-zero unused bits in the final quartet.
  const lastBytes = binary.slice(-(padding ? 3 - padding : 3))
  if (btoa(lastBytes) !== value.slice(-4))
    throw new Error('备份中的 Base64 音频编码不规范')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

/** JSON contains every attachment, rather than only file names or browser URLs. */
export async function createLearningBackup(data: LearningSnapshot, blobs: Map<string, Blob>): Promise<string> {
  const snapshot = validateSnapshot(data)
  const attachments: { id: string; base64: string }[] = []
  for (const meta of snapshot.attachments) {
    const blob = blobs.get(meta.id)
    assertAttachmentBlob(meta, blob)
    attachments.push({ id: meta.id, base64: await toBase64(blob) })
  }
  const json = JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: new Date().toISOString(), data: snapshot, blobs: attachments })
  validateTextSize(json)
  return json
}

/** Parse and validate before the UI offers an import action; no storage writes occur. */
export async function previewLearningBackup(text: string): Promise<BackupPreview> {
  if (typeof text !== 'string')
    throw new Error('请选择 JSON 备份文件')
  validateTextSize(text)
  let raw: unknown
  try {
    raw = JSON.parse(text)
  }
  catch {
    throw new Error('备份文件不是有效的 JSON')
  }
  const backup = object(raw)
  if (backup.format !== BACKUP_FORMAT || backup.schemaVersion !== 1)
    throw new Error('不支持的备份格式或版本，仅支持本应用 schemaVersion 1 备份')
  if (!isValidTimestamp(backup.exportedAt))
    throw new Error('备份导出时间无效')
  const snapshot = validateSnapshot(backup.data)
  if (!Array.isArray(backup.blobs) || backup.blobs.length > MAX_ATTACHMENTS || backup.blobs.length !== snapshot.attachments.length)
    throw new Error('备份中的音频数量不完整或超出限制')
  const metadata = new Map(snapshot.attachments.map(meta => [meta.id, meta]))
  const blobs = new Map<string, Blob>()
  for (const item of backup.blobs) {
    const entry = object(item)
    if (typeof entry.id !== 'string' || blobs.has(entry.id) || !metadata.has(entry.id))
      throw new Error('备份中存在重复或未关联的音频内容')
    const meta = metadata.get(entry.id)!
    const blob = fromBase64(entry.base64, meta.size, meta.type)
    assertAttachmentBlob(meta, blob)
    blobs.set(meta.id, blob)
  }
  const preview: BackupPreview = Object.freeze({
    data: validateSnapshot(snapshot),
    exportedAt: backup.exportedAt,
    recordCount: snapshot.records.length,
    attachmentCount: snapshot.attachments.length,
    totalBytes: snapshot.attachments.reduce((sum, meta) => sum + meta.size, 0),
  })
  validatedPreviews.set(preview, { snapshot, blobs })
  return preview
}

/** Only previews produced by the parser are accepted; UI edits cannot modify imported data. */
export function validatedBackupContents(preview: BackupPreview): ValidatedBackup {
  const contents = validatedPreviews.get(preview)
  if (!contents)
    throw new Error('备份预览已失效，请重新选择备份文件')
  return { snapshot: validateSnapshot(contents.snapshot), blobs: new Map(contents.blobs) }
}
