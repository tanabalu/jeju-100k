import { useEffect, useState } from 'react'
import type { ImageRef } from '../types'
import { resolveImageSrc } from '../lib/imageStore'

interface ThumbProps {
  image?: ImageRef
  alt?: string
  /** CSS object-fit */
  fit?: 'cover' | 'contain'
  radius?: number
}

/** 统一渲染外链图与本地上传图；加载中显示骨架块，避免布局跳动 */
export function Thumb({ image, alt = '', fit = 'cover', radius = 8 }: ThumbProps) {
  const [src, setSrc] = useState<string>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setFailed(false)
    setSrc(undefined)
    if (!image || !image.value) return
    resolveImageSrc(image)
      .then((url) => {
        if (alive) setSrc(url)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [image?.kind, image?.value])

  if (!image || !image.value || failed) {
    return <div className="thumb-empty" style={{ borderRadius: radius }}>无图</div>
  }
  if (!src) return <div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: radius }} />
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      /* 首页 27 张封面各约 100KB，懒加载避免首屏一次性拉完 */
      loading="lazy"
      decoding="async"
      style={{ width: '100%', height: '100%', objectFit: fit, borderRadius: radius, display: 'block' }}
    />
  )
}
