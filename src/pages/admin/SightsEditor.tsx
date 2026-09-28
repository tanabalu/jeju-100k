import type { ImageRef, Route, Sight, SightType } from '../../types'
import { emptySight } from '../../lib/storage'
import { PointPicker } from '../../components/PointPicker'
import { ImageField } from '../../components/ImageField'
import { useConfirm } from '../../components/Feedback'
import { projectToRoute, formatKm, trackLines } from '../../lib/geo'

const TYPE_LABEL: Record<SightType, string> = {
  view: '观景',
  water: '水景',
  forest: '林野',
  village: '村落',
  ruin: '遗迹',
  other: '其他',
}

interface Props {
  route: Route
  onPatch: (patch: Partial<Route>) => void
}

export function SightsEditor({ route, onPatch }: Props) {
  const confirm = useConfirm()
  const sights = route.sights
  const setSights = (next: Sight[]) => onPatch({ sights: next })
  const patch = (id: string, p: Partial<Sight>) => setSights(sights.map((s) => (s.id === id ? { ...s, ...p } : s)))
  const patchImages = (id: string, images: ImageRef[]) => patch(id, { images })

  return (
    <div>
      <div className="section-head">
        <h3>路边景色（{sights.length}）</h3>
        <button className="btn btn-sm btn-primary" onClick={() => setSights([...sights, emptySight()])}>
          添加看点
        </button>
      </div>

      {sights.length === 0 && <p className="muted">还没有看点。看点会按沿线里程排序，并标注在海拔剖面上。</p>}

      <div className="editor-list">
        {sights.map((s) => {
          const pos = projectToRoute({ lng: s.lng, lat: s.lat }, route.points)
          return (
            <div key={s.id} className="editor-card">
              <div className="editor-card-head">
                <input
                  className="input input-title"
                  value={s.name}
                  onChange={(e) => patch(s.id, { name: e.target.value })}
                  placeholder="看点名称"
                />
                <button
                  className="btn btn-xs btn-danger"
                  onClick={async () => {
                    if (await confirm({ title: '删除看点', message: `删除「${s.name}」？`, confirmText: '删除', danger: true })) {
                      setSights(sights.filter((x) => x.id !== s.id))
                    }
                  }}
                >
                  删除
                </button>
              </div>
              <div className="field-row">
                <label className="field">
                  <span>类型</span>
                  <select className="input" value={s.type} onChange={(e) => patch(s.id, { type: e.target.value as SightType })}>
                    {(Object.keys(TYPE_LABEL) as SightType[]).map((k) => (
                      <option key={k} value={k}>
                        {TYPE_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>经度</span>
                  <input
                    className="input"
                    type="number"
                    step="0.000001"
                    value={s.lng}
                    onChange={(e) => patch(s.id, { lng: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>纬度</span>
                  <input
                    className="input"
                    type="number"
                    step="0.000001"
                    value={s.lat}
                    onChange={(e) => patch(s.id, { lat: Number(e.target.value) })}
                  />
                </label>
                <div className="field">
                  <span>坐标</span>
                  <PointPicker
                    points={route.points}
                    lines={trackLines(route)}
                    hotels={route.hotels}
                    sights={route.sights}
                    onChange={(p) => patch(s.id, { lng: p.lng, lat: p.lat })}
                  />
                </div>
              </div>
              <label className="field">
                <span>描述</span>
                <textarea className="input" rows={2} value={s.desc ?? ''} onChange={(e) => patch(s.id, { desc: e.target.value })} />
              </label>
              <div className="field">
                <span>照片（最多 5 张）</span>
                <div className="image-multi">
                  {s.images.map((img, i) => (
                    <div key={`${img.kind}_${img.value}_${i}`} className="image-multi-cell">
                      <ImageField
                        value={img}
                        height={96}
                        onChange={(v) => {
                          if (!v) {
                            patchImages(s.id, s.images.filter((_, idx) => idx !== i))
                          } else {
                            const next = [...s.images]
                            next[i] = v
                            patchImages(s.id, next)
                          }
                        }}
                      />
                    </div>
                  ))}
                  {s.images.length < 5 && (
                    <div className="image-multi-cell">
                      <ImageField height={96} onChange={(v) => v && patchImages(s.id, [...s.images, v])} />
                    </div>
                  )}
                </div>
              </div>
              <div className="derived">
                <span className="pill">沿线 {formatKm(pos.atKm)} km</span>
                <span className="pill">离路线 {formatKm(pos.offRouteKm)} km</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
