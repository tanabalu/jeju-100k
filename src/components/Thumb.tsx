import { useEffect, useState, type CSSProperties } from 'react'
import type { ImageRef } from '../types'
import { resolveImageSrc } from '../lib/imageStore'
import styles from './Thumb.module.less'

interface ThumbProps {
  image?: ImageRef
  alt?: string
  /** CSS object-fit */
  fit?: 'cover' | 'contain'
  radius?: number
  /** 高度自适应图片原始比例（瀑布流用）；默认撑满容器 */
  autoHeight?: boolean
}

/** 读取已解析地址的图片原始尺寸；本地图走 IndexedDB 无网络开销，用于提前预留高度，避免瀑布流回流 */
function readImageSize(url: string): Promise<{ w: number; h: number } | undefined> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(undefined)
    img.src = url
  })
}

/** 未知比例时的兜底比例（竖图更贴近常见照片），仅用于加载占位阶段 */
const DEFAULT_RATIO = 4 / 5

/**
 * 统一渲染外链图与本地上传图。
 * - 懒加载（loading="lazy"）避免首屏一次性拉完；
 * - 加载中显示「空背景色 + 扫光」占位，并预留高度（autoHeight 用真实比例），不塌陷、不闪跳；
 * - 图片真正解码完成后淡入，而不是突然冒出来。
 */
export function Thumb({ image, alt = '', fit = 'cover', radius = 8, autoHeight = false }: ThumbProps) {
  const [src, setSrc] = useState<string>()
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [ratio, setRatio] = useState<number>()

  useEffect(() => {
    let alive = true
    setFailed(false)
    setSrc(undefined)
    setLoaded(false)
    setRatio(undefined)
    if (!image || !image.value) return
    resolveImageSrc(image)
      .then(async (url) => {
        if (!alive || !url) return
        setSrc(url)
        // 本地图解析后即可同步拿到尺寸，瀑布流提前占位（外链图留到 onLoad 再补，避免提前发请求）
        if (image.kind === 'local') {
          const size = await readImageSize(url)
          if (alive && size && size.h > 0) setRatio(size.w / size.h)
        }
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [image?.kind, image?.value])

  if (!image || !image.value || failed) {
    return <div className={`${styles['thumb-empty']}`} style={{ borderRadius: radius }}>无图</div>
  }

  // autoHeight：用 aspect-ratio 预留高度（已知真实比例最好，未知先用默认），避免加载时塌陷 / 瀑布流回流
  const wrapStyle: CSSProperties = autoHeight
    ? { aspectRatio: ratio ?? DEFAULT_RATIO }
    : { height: '100%' }

  return (
    <div className={`${styles['thumb']}`} style={{ ...wrapStyle, borderRadius: radius }}>
      {!loaded && <div className={`${styles['shimmer']}`} aria-hidden />}
      {src && (
        <img
          className={`${styles['img']} ${loaded ? styles['is-loaded'] : ''}`}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={(e) => {
            setLoaded(true)
            const el = e.currentTarget
            // 兜底：外链图 / 比例尚未算出时，用真实尺寸定一次版，消除占位到成图的跳变
            if (autoHeight && el.naturalWidth && el.naturalHeight) {
              setRatio(el.naturalWidth / el.naturalHeight)
            }
          }}
          onError={() => setFailed(true)}
          style={{ objectFit: fit }}
        />
      )}
    </div>
  )
}
