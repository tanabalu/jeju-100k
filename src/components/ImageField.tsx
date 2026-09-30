import { useRef, useState } from 'react'
import type { ImageRef } from '../types'
import { putImageFile } from '../lib/imageStore'
import { Thumb } from './Thumb'
import { useToast } from './Feedback'
import styles from './ImageField.module.less'

interface Props {
  value?: ImageRef
  onChange: (v?: ImageRef) => void
  /** 预览框高度（不传 ratio 时生效；此时预览为全宽条状） */
  height?: number
  /** 预览框宽高比（如 "4 / 3"）：设置后预览为常规比例的框（宽受 maxWidth 限制），忽略 height */
  ratio?: string
  /** ratio 模式下预览框最大宽度，默认 280 */
  maxWidth?: number
  /** 只读预览：不显示上传 / 清除 / 外链编辑控件 */
  readOnly?: boolean
  /** 是否显示「清除」按钮（默认不显示；需要移除图片能力的场景才开启） */
  allowClear?: boolean
  /** 布局：column = 预览在上、操作行在下（默认）；row = 预览在左、操作在右 */
  layout?: 'column' | 'row'
}

/** 图片字段：支持本地上传（压缩后进 IndexedDB）或填外链 */
export function ImageField({
  value,
  onChange,
  height = 120,
  ratio,
  maxWidth = 280,
  readOnly = false,
  allowClear = false,
  layout = 'column',
}: Props) {
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

  // 预览框尺寸：ratio 模式按宽高比 + 最大宽度；默认模式为全宽 × 固定高度（条状）
  const previewStyle = ratio ? { aspectRatio: ratio, maxWidth } : { height }
  const fieldClass = layout === 'row' ? `${styles['image-field']} ${styles['is-row']}` : `${styles['image-field']}`

  if (readOnly) {
    return (
      <div className={fieldClass}>
        <div className={`${styles['image-preview']}`} style={previewStyle}>
          <Thumb image={value} />
        </div>
      </div>
    )
  }

  return (
    <div className={fieldClass}>
      <div className={`${styles['image-preview']}`} style={previewStyle}>
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
        {allowClear && value && (
          <button className="btn btn-sm" onClick={() => onChange(undefined)}>
            清除
          </button>
        )}
        <input
          className={`input input-sm ${styles['url-input']}`}
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
