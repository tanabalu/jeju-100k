import { useRef, useState } from 'react'
import type { ImageRef } from '../types'
import { putImageFile } from '../lib/imageStore'
import { Thumb } from './Thumb'
import { useToast } from './Feedback'
import styles from './ImageField.module.less'

interface Props {
  value?: ImageRef
  onChange: (v?: ImageRef) => void
  /** 预览框高度 */
  height?: number
  /** 只读预览：不显示上传 / 清除 / 外链编辑控件 */
  readOnly?: boolean
}

/** 图片字段：支持本地上传（压缩后进 IndexedDB）或填外链 */
export function ImageField({ value, onChange, height = 120, readOnly = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [url, setUrl] = useState(value?.kind === 'url' ? value.value : '')
  const toast = useToast()

  const handleFile = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('请选择图片文件', 'error')
      return
    }
    setUploading(true)
    try {
      const ref = await putImageFile(file)
      onChange(ref)
      toast('已上传', 'success')
    } catch {
      toast('上传失败', 'error')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  if (readOnly) {
    return (
      <div className={`${styles['image-field']}`}>
        <div className={`${styles['image-preview']}`} style={{ height }}>
          <Thumb image={value} />
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles['image-field']}`}>
      <div className={`${styles['image-preview']}`} style={{ height }}>
        {uploading ? <div className="skeleton" style={{ width: '100%', height: '100%' }} /> : <Thumb image={value} />}
      </div>
      <div className={`${styles['image-ops']}`}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <button className="btn btn-sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? '上传中…' : '本地上传'}
        </button>
        {value && (
          <button className="btn btn-sm" onClick={() => onChange(undefined)}>
            清除
          </button>
        )}
        <input
          className="input input-sm"
          placeholder="或粘贴图片外链 URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => {
            const v = url.trim()
            if (v) onChange({ kind: 'url', value: v })
          }}
        />
      </div>
    </div>
  )
}
