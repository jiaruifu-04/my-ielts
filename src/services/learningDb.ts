import type { AttachmentMeta, LearningSnapshot } from '../domain/learning'
import { createEmptySnapshot, validateSnapshot } from '../domain/learning'

export const LEARNING_DB_NAME = 'my-ielts-learning'
const DB_VERSION = 1
const SNAPSHOT_KEY = 'current'
let connection: Promise<IDBDatabase> | null = null

function storageError(error?: unknown): Error {
  if (error instanceof Error && error.message.startsWith('学习'))
    return error
  const detail = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '浏览器未允许保存本地数据'
  return new Error(`学习数据存储失败：${detail}`)
}

export function openLearningDb(): Promise<IDBDatabase> {
  if (connection)
    return connection
  connection = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('学习数据存储不可用，请使用支持 IndexedDB 的浏览器'))
      return
    }
    let request: IDBOpenDBRequest
    let failed = false
    try {
      request = indexedDB.open(LEARNING_DB_NAME, DB_VERSION)
    }
    catch (error) {
      reject(storageError(error))
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('state'))
        db.createObjectStore('state')
      if (!db.objectStoreNames.contains('attachments'))
        db.createObjectStore('attachments')
    }
    request.onblocked = () => {
      failed = true
      reject(new Error('学习数据存储被其他标签页占用，请关闭旧页面后重试'))
    }
    request.onerror = () => reject(storageError(request.error))
    request.onsuccess = () => {
      const db = request.result
      if (failed) {
        db.close()
        return
      }
      db.onversionchange = () => {
        db.close()
        connection = null
      }
      resolve(db)
    }
  })
  connection.catch(() => {
    connection = null
  })
  return connection
}

/** Close only the connection; this never deletes learning data. */
export async function closeLearningDb(): Promise<void> {
  const pending = connection
  connection = null
  if (pending) {
    try {
      (await pending).close()
    }
    catch {
      // A failed open has no connection to close.
    }
  }
}

export function assertAttachmentBlob(meta: AttachmentMeta, blob: unknown): asserts blob is Blob {
  if (!(blob instanceof Blob) || blob.size !== meta.size || blob.type.toLowerCase() !== meta.type.toLowerCase())
    throw new Error(`学习数据中的音频附件缺失或损坏：${meta.name}`)
}

export interface StoredLearningData {
  snapshot: LearningSnapshot
  blobs: Map<string, Blob>
}

/** Read metadata and blobs from the same readonly transaction. */
export async function readLearningData(includeBlobs = true): Promise<StoredLearningData> {
  const db = await openLearningDb()
  return new Promise((resolve, reject) => {
    let snapshot = createEmptySnapshot()
    const blobs = new Map<string, Blob>()
    let failure: unknown = null
    let transaction: IDBTransaction
    try {
      transaction = db.transaction(['state', 'attachments'], 'readonly')
    }
    catch (error) {
      reject(storageError(error))
      return
    }
    const request = transaction.objectStore('state').get(SNAPSHOT_KEY)
    request.onsuccess = () => {
      try {
        snapshot = request.result === undefined ? createEmptySnapshot() : validateSnapshot(request.result)
        if (includeBlobs) {
          for (const meta of snapshot.attachments) {
            const attachmentRequest = transaction.objectStore('attachments').get(meta.id)
            attachmentRequest.onsuccess = () => {
              try {
                assertAttachmentBlob(meta, attachmentRequest.result)
                blobs.set(meta.id, attachmentRequest.result)
              }
              catch (error) {
                failure = error
                transaction.abort()
              }
            }
          }
        }
      }
      catch (error) {
        failure = error
        transaction.abort()
      }
    }
    transaction.oncomplete = () => resolve({ snapshot, blobs })
    transaction.onabort = () => reject(failure || storageError(transaction.error))
    transaction.onerror = (event) => {
      failure ||= storageError((event.target as IDBRequest).error || transaction.error)
    }
  })
}

export interface LearningMutation<T> {
  snapshot: LearningSnapshot
  result: T
  putBlobs?: Map<string, Blob>
}

/** The synchronous callback runs against the latest committed snapshot, including other tabs. */
export async function mutateLearningData<T>(update: (snapshot: LearningSnapshot) => LearningMutation<T>): Promise<{ snapshot: LearningSnapshot; result: T }> {
  const db = await openLearningDb()
  return new Promise((resolve, reject) => {
    let committed: { snapshot: LearningSnapshot; result: T } | null = null
    let failure: unknown = null
    let transaction: IDBTransaction
    try {
      transaction = db.transaction(['state', 'attachments'], 'readwrite')
    }
    catch (error) {
      reject(storageError(error))
      return
    }
    const request = transaction.objectStore('state').get(SNAPSHOT_KEY)
    request.onsuccess = () => {
      try {
        const previous = request.result === undefined ? createEmptySnapshot() : validateSnapshot(request.result)
        const oldAttachments = new Map(previous.attachments.map(meta => [meta.id, meta]))
        const mutation = update(previous)
        const snapshot = validateSnapshot(mutation.snapshot)
        const newAttachments = new Map(snapshot.attachments.map(meta => [meta.id, meta]))
        const puts = mutation.putBlobs || new Map<string, Blob>()
        for (const [id, blob] of puts) {
          const meta = newAttachments.get(id)
          if (!meta)
            throw new Error('学习数据更新包含未关联的音频附件')
          assertAttachmentBlob(meta, blob)
        }
        for (const meta of snapshot.attachments) {
          const previousMeta = oldAttachments.get(meta.id)
          if ((!previousMeta || previousMeta.size !== meta.size || previousMeta.type !== meta.type || previousMeta.recordId !== meta.recordId) && !puts.has(meta.id))
            throw new Error('学习数据更新缺少音频内容')
        }
        for (const id of oldAttachments.keys()) {
          if (!newAttachments.has(id))
            transaction.objectStore('attachments').delete(id)
        }
        for (const [id, blob] of puts)
          transaction.objectStore('attachments').put(blob, id)
        transaction.objectStore('state').put(snapshot, SNAPSHOT_KEY)
        committed = { snapshot, result: mutation.result }
      }
      catch (error) {
        failure = error
        transaction.abort()
      }
    }
    transaction.oncomplete = () => {
      if (committed)
        resolve(committed)
      else
        reject(new Error('学习数据没有完成保存，请重试'))
    }
    transaction.onabort = () => reject(failure || storageError(transaction.error))
    transaction.onerror = (event) => {
      failure ||= storageError((event.target as IDBRequest).error || transaction.error)
    }
  })
}

export async function readAttachmentBlob(id: string): Promise<Blob> {
  const db = await openLearningDb()
  return new Promise((resolve, reject) => {
    let result: Blob | null = null
    let failure: unknown = null
    let transaction: IDBTransaction
    try {
      transaction = db.transaction(['state', 'attachments'], 'readonly')
    }
    catch (error) {
      reject(storageError(error))
      return
    }
    const request = transaction.objectStore('state').get(SNAPSHOT_KEY)
    request.onsuccess = () => {
      try {
        const snapshot = request.result === undefined ? createEmptySnapshot() : validateSnapshot(request.result)
        const meta = snapshot.attachments.find(attachment => attachment.id === id)
        if (!meta)
          throw new Error('学习记录中不存在这个音频附件')
        const blobRequest = transaction.objectStore('attachments').get(id)
        blobRequest.onsuccess = () => {
          try {
            assertAttachmentBlob(meta, blobRequest.result)
            result = blobRequest.result
          }
          catch (error) {
            failure = error
            transaction.abort()
          }
        }
      }
      catch (error) {
        failure = error
        transaction.abort()
      }
    }
    transaction.oncomplete = () => result ? resolve(result) : reject(new Error('学习音频读取失败'))
    transaction.onabort = () => reject(failure || storageError(transaction.error))
    transaction.onerror = (event) => {
      failure ||= storageError((event.target as IDBRequest).error || transaction.error)
    }
  })
}
