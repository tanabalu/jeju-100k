import { useState } from 'react'
import type { Route, TrackPoint, WaypointType } from '../../types'
import { uid } from '../../lib/id'
import { trackLines } from '../../lib/geo'
import { PointPicker } from '../../components/PointPicker'
import { RouteMap, WP_TYPE_STYLE } from '../../components/RouteMap'
import { Select } from '../../components/Select'
import { useConfirm, useToast } from '../../components/Feedback'
import styles from './PointsEditor.module.less'

/**
 * 途经点设施类型选项：与地图图例（RouteMap 的 WP_TYPE_STYLE）完全一致，
 * 不再提供「起点 / 终点」（起终点由位置决定，且禁止编辑）。
 */
const WPTYPE_OPTIONS: { value: WaypointType; zh: string }[] = (
  Object.keys(WP_TYPE_STYLE) as WaypointType[]
).map((t) => ({ value: t, zh: WP_TYPE_STYLE[t].zh }))

interface Props {
  route: Route
  onPatch: (patch: Partial<Route>) => void
}

export function PointsEditor({ route, onPatch }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const [draft, setDraft] = useState<{ name: string; lng: string; lat: string; ele: string; wpType: WaypointType }>({
    name: '',
    lng: '',
    lat: '',
    ele: '',
    wpType: 'normal',
  })

  const points = route.points

  const setPoints = (next: TrackPoint[]) => onPatch({ points: next })

  const add = () => {
    const lng = Number(draft.lng)
    const lat = Number(draft.lat)
    if (!draft.name.trim()) {
      toast('请填写点名', 'error')
      return
    }
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      toast('经纬度必须是数字', 'error')
      return
    }
    const ele = draft.ele === '' ? undefined : Number(draft.ele)
    const p: TrackPoint = {
      id: uid('pt'),
      name: draft.name.trim(),
      lng,
      lat,
      ele: Number.isFinite(ele) ? ele : undefined,
      kind: 'via',
      wpType: draft.wpType,
    }
    // 新途经点插到「末位终点」之前，保证终点始终固定在列表最下面
    const insertAt = Math.max(0, points.length - 1)
    const next = [...points]
    next.splice(insertAt, 0, p)
    setPoints(next)
    setDraft({ name: '', lng: '', lat: '', ele: '', wpType: 'normal' })
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= points.length) return
    // 起终点固定首末位，任何交换都不得涉及它们（也不能把途经点换到首/末）
    if (index === 0 || index === points.length - 1) return
    if (target === 0 || target === points.length - 1) return
    const next = [...points]
    ;[next[index], next[target]] = [next[target], next[index]]
    setPoints(next)
  }

  const patch = (id: string, p: Partial<TrackPoint>) => {
    setPoints(points.map((x) => (x.id === id ? { ...x, ...p } : x)))
  }

  return (
    <div>
      <RouteMap points={points} lines={trackLines(route)} hotels={route.hotels} sights={route.sights} height={320} />

      <p className="muted" style={{ margin: '8px 0', fontSize: 12 }}>
        累计爬升和海拔剖面都来自这里的海拔值。预置的偶来小路自带地形采样序列；
        自建路线请给每个点填上海拔（可从轨迹软件、地图或 GPX 里读），
        少于 2 个点有海拔时爬升会显示「—」而不是 0。
      </p>

      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12, color: '#9a3412' }}>
        ⚠️ 起点（列表首行）与终点（末行）已锁定，不可编辑、不可删除；下方可继续为本路线添加途经点。
      </p>

      <div className="add-row">
        <input
          className="input"
          placeholder="点名，如：金顶"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <Select
          value={draft.wpType}
          onChange={(v) => setDraft({ ...draft, wpType: v as WaypointType })}
          options={WPTYPE_OPTIONS.map((o) => ({ value: o.value, label: o.zh }))}
          ariaLabel="途经点类型"
        />
        <input
          className={`input ${styles['input-num']}`}
          placeholder="经度"
          value={draft.lng}
          onChange={(e) => setDraft({ ...draft, lng: e.target.value })}
        />
        <input
          className={`input ${styles['input-num']}`}
          placeholder="纬度"
          value={draft.lat}
          onChange={(e) => setDraft({ ...draft, lat: e.target.value })}
        />
        <input
          className={`input ${styles['input-num']}`}
          placeholder="海拔"
          value={draft.ele}
          onChange={(e) => setDraft({ ...draft, ele: e.target.value })}
        />
        <PointPicker
          points={points}
          lines={trackLines(route)}
          hotels={route.hotels}
          sights={route.sights}
          label="地图选点"
          onChange={(p) => setDraft({ ...draft, lng: p.lng.toFixed(6), lat: p.lat.toFixed(6) })}
        />
        <button className="btn btn-primary btn-sm" onClick={add}>
          添加
        </button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th>名称</th>
            <th style={{ width: 96 }}>类型</th>
            <th style={{ width: 110 }}>经度</th>
            <th style={{ width: 110 }}>纬度</th>
            <th style={{ width: 90 }}>海拔</th>
            <th style={{ width: 150 }} />
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => {
            const isStart = i === 0
            const isEnd = i === points.length - 1
            const locked = isStart || isEnd
            return (
            <tr key={p.id} className={locked ? 'is-locked' : undefined}>
              <td>{i + 1}</td>
              <td>
                <input
                  className="input input-xs"
                  value={p.name}
                  disabled={locked}
                  onChange={(e) => patch(p.id, { name: e.target.value })}
                />
              </td>
              <td>
                {locked ? (
                  <span className={`${styles['locked-tag']}`}>{isStart ? '起点' : '终点'}</span>
                ) : (
                  <Select
                    size="xs"
                    value={p.wpType ?? 'normal'}
                    onChange={(v) => patch(p.id, { wpType: v as WaypointType })}
                    options={WPTYPE_OPTIONS.map((o) => ({ value: o.value, label: o.zh }))}
                    ariaLabel="途经点类型"
                  />
                )}
              </td>
              <td>
                <input
                  className="input input-xs"
                  type="number"
                  step="0.000001"
                  value={p.lng}
                  disabled={locked}
                  onChange={(e) => patch(p.id, { lng: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  className="input input-xs"
                  type="number"
                  step="0.000001"
                  value={p.lat}
                  disabled={locked}
                  onChange={(e) => patch(p.id, { lat: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  className="input input-xs"
                  type="number"
                  value={p.ele ?? ''}
                  disabled={locked}
                  onChange={(e) => patch(p.id, { ele: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </td>
              <td className="td-right">
                <button className="btn btn-xs" onClick={() => move(i, -1)} disabled={locked || i <= 1}>
                  ↑
                </button>
                <button className="btn btn-xs" onClick={() => move(i, 1)} disabled={locked || i >= points.length - 2}>
                  ↓
                </button>
                <button
                  className="btn btn-xs btn-danger"
                  disabled={locked}
                  onClick={async () => {
                    if (await confirm({ title: '删除途经点', message: `删除「${p.name}」？`, confirmText: '删除', danger: true })) {
                      setPoints(points.filter((x) => x.id !== p.id))
                    }
                  }}
                >
                  删
                </button>
              </td>
            </tr>
            )
          })}
          {points.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                还没有途经点。第一个点会被当作起点，最后一个点当作终点。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
