import { useState } from 'react'
import type { GeoPoint, Route } from '../types'
import { RouteMap } from './RouteMap'
import { Modal } from './Modal'

interface Props {
  points: Route['points']
  onChange: (p: GeoPoint) => void
  /** 已存在的额外标记，便于选点时参照 */
  hotels?: Route['hotels']
  sights?: Route['sights']
  label?: string
}

/**
 * 在地图上点选取点。
 * 底图不可用时 RouteMap 会降级为示意图，示意图同样支持点击反算经纬度。
 */
export function PointPicker({ points, hotels, sights, onChange, label = '选择坐标' }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        {label}
      </button>
      <Modal open={open} title="点击地图选点" onClose={() => setOpen(false)} width={860}>
        <p className="muted" style={{ marginBottom: 8 }}>
          在地图上点击即可取点，选完点右上角关闭窗口。
        </p>
        <RouteMap
          points={points}
          hotels={hotels}
          sights={sights}
          height={460}
          pickable
          onPick={(p) => onChange(p)}
        />
      </Modal>
    </>
  )
}
