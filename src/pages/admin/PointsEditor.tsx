import { useState } from 'react'
import type { Route, TrackPoint, TrackPointKind } from '../../types'
import { uid } from '../../lib/id'
import { trackLines } from '../../lib/geo'
import { PointPicker } from '../../components/PointPicker'
import { RouteMap } from '../../components/RouteMap'
import { useConfirm, useToast } from '../../components/Feedback'

const KIND_LABEL: Record<TrackPointKind, string> = {
  start: '起点',
  end: '终点',
  via: '途经点',
  aid: '补给点',
  peak: '山峰',
}

interface Props {
  route: Route
  onPatch: (patch: Partial<Route>) => void
}

export function PointsEditor({ route, onPatch }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const [draft, setDraft] = useState<{ name: string; lng: string; lat: string; ele: string; kind: TrackPointKind }>({
    name: '',
    lng: '',
    lat: '',
    ele: '',
    kind: 'via',
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
      kind: draft.kind,
    }
    setPoints([...points, p])
    setDraft({ name: '', lng: '', lat: '', ele: '', kind: 'via' })
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= points.length) return
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

      <div className="add-row">
        <input
          className="input"
          placeholder="点名，如：金顶"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <select
          className="input"
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as TrackPointKind })}
        >
          {(Object.keys(KIND_LABEL) as TrackPointKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <input
          className="input input-num"
          placeholder="经度"
          value={draft.lng}
          onChange={(e) => setDraft({ ...draft, lng: e.target.value })}
        />
        <input
          className="input input-num"
          placeholder="纬度"
          value={draft.lat}
          onChange={(e) => setDraft({ ...draft, lat: e.target.value })}
        />
        <input
          className="input input-num"
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
          {points.map((p, i) => (
            <tr key={p.id}>
              <td>{i + 1}</td>
              <td>
                <input className="input input-xs" value={p.name} onChange={(e) => patch(p.id, { name: e.target.value })} />
              </td>
              <td>
                <select
                  className="input input-xs"
                  value={p.kind}
                  onChange={(e) => patch(p.id, { kind: e.target.value as TrackPointKind })}
                >
                  {(Object.keys(KIND_LABEL) as TrackPointKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  className="input input-xs"
                  type="number"
                  step="0.000001"
                  value={p.lng}
                  onChange={(e) => patch(p.id, { lng: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  className="input input-xs"
                  type="number"
                  step="0.000001"
                  value={p.lat}
                  onChange={(e) => patch(p.id, { lat: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  className="input input-xs"
                  type="number"
                  value={p.ele ?? ''}
                  onChange={(e) => patch(p.id, { ele: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </td>
              <td className="td-right">
                <button className="btn btn-xs" onClick={() => move(i, -1)} disabled={i === 0}>
                  ↑
                </button>
                <button className="btn btn-xs" onClick={() => move(i, 1)} disabled={i === points.length - 1}>
                  ↓
                </button>
                <button
                  className="btn btn-xs btn-danger"
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
          ))}
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
