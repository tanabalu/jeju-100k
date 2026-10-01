import type { ImageRef } from '../types'
import { uid } from './id'

const DB_NAME = 'jejuolle100k'
const DB_VERSION = 1
const STORE = 'images'

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

/** 上传本地文件：压缩后存入 IndexedDB，返回 ImageRef（附带原图宽高，供相册 loading 卡片按比例占位） */
export async function putImageFile(file: File, maxWidth = 1600): Promise<ImageRef> {
  const { blob, width, height } = await compressImage(file, maxWidth)
  const key = uid('img')
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return { kind: 'local', value: key, width, height }
}

const urlCache = new Map<string, string>()

/** 把 ImageRef 解析成可直接用于 <img src> 的地址 */
export async function resolveImageSrc(ref: ImageRef | undefined): Promise<string | undefined> {
  if (!ref) return undefined
  if (ref.kind === 'url') return ref.value
  const cached = urlCache.get(ref.value)
  if (cached) return cached
  const db = await openDB()
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(ref.value)
    req.onsuccess = () => resolve(req.result as Blob | undefined)
    req.onerror = () => reject(req.error)
  })
  if (!blob) return undefined
  const url = URL.createObjectURL(blob)
  urlCache.set(ref.value, url)
  return url
}

function compressImage(file: File, maxWidth: number): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      // 原图宽高（用于相册 loading 卡片按比例占位，存的是原始尺寸而非压缩后）
      const width = img.width
      const height = img.height
      const scale = Math.min(1, maxWidth / width)
      const w = Math.round(width * scale)
      const h = Math.round(height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve({ blob: file, width, height })
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => resolve({ blob: blob ?? file, width, height }),
        'image/jpeg',
        0.82,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('图片解析失败'))
    }
    img.src = objectUrl
  })
}

/** 清掉整个图片库（错误页「清空本机数据」用，不可恢复） */
export async function clearImageStore(): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  } catch {
    /* 删不掉就算了，不阻塞后续重载 */
  }
  dbPromise = null
  urlCache.clear()
}
