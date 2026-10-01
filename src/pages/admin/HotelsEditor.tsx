import type { Hotel, Route } from '../../types'
import { emptyHotel } from '../../lib/storage'
import { PointPicker } from '../../components/PointPicker'
import { ImageField } from '../../components/ImageField'
import { useConfirm } from '../../components/Feedback'
import { projectToRoute, formatKm, trackLines } from '../../lib/geo'

interface Props {
  route: Route
  onPatch: (patch: Partial<Route>) => void
}

export function HotelsEditor({ route, onPatch }: Props) {
  const confirm = useConfirm()
  const hotels = route.hotels
  const setHotels = (next: Hotel[]) => onPatch({ hotels: next })
  const patch = (id: string, p: Partial<Hotel>) => setHotels(hotels.map((h) => (h.id === id ? { ...h, ...p } : h)))

  return (
    <div>
      <div className="section-head">
        <h3>附近住宿（{hotels.length}）</h3>
        <button className="btn btn-sm btn-primary" onClick={() => setHotels([...hotels, emptyHotel()])}>
          添加住宿
        </button>
      </div>

      {hotels.length === 0 && <p className="muted">还没有住宿记录。住宿会按「沿线里程」自动排序显示在路线详情页。</p>}

      <div className="editor-list">
        {hotels.map((h) => {
          const pos = projectToRoute({ lng: h.lng, lat: h.lat }, route.points)
          return (
            <div key={h.id} className="editor-card">
              <div className="editor-card-head">
                <div className="field-row" style={{ flex: 1, alignItems: 'flex-end' }}>
                  <label className="field">
                    <span>中文名</span>
                    <input
                      className="input"
                      value={h.nameZh ?? ''}
                      onChange={(e) => patch(h.id, { nameZh: e.target.value })}
                      placeholder="中文名（音译，待核对）"
                    />
                  </label>
                  <label className="field">
                    <span>原名 / 韩文</span>
                    <input
                      className="input"
                      value={h.name}
                      onChange={(e) => patch(h.id, { name: e.target.value })}
                    />
                  </label>
                </div>
                <button
                  className="btn btn-xs btn-danger"
                  onClick={async () => {
                    if (await confirm({ title: '删除住宿', message: `删除「${h.name}」？`, confirmText: '删除', danger: true })) {
                      setHotels(hotels.filter((x) => x.id !== h.id))
                    }
                  }}
                >
                  删除
                </button>
              </div>
              <div className="field">
                <span>封面图</span>
                <ImageField value={h.cover} onChange={(v) => patch(h.id, { cover: v })} ratio="4 / 3" layout="row" />
              </div>
              <div className="field-row">
                <label className="field">
                  <span>地址</span>
                  <input className="input" value={h.address ?? ''} onChange={(e) => patch(h.id, { address: e.target.value })} />
                </label>
                <label className="field">
                  <span>价格区间</span>
                  <input
                    className="input"
                    placeholder="300-500"
                    value={h.priceRange ?? ''}
                    onChange={(e) => patch(h.id, { priceRange: e.target.value })}
                  />
                </label>
              </div>
              <div className="field-row">
                <label className="field">
                  <span>电话</span>
                  <input className="input" value={h.phone ?? ''} onChange={(e) => patch(h.id, { phone: e.target.value })} />
                </label>
                <label className="field">
                  <span>评分</span>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    value={h.rating ?? ''}
                    onChange={(e) => patch(h.id, { rating: e.target.value === '' ? undefined : Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>经度</span>
                  <input
                    className="input"
                    type="number"
                    step="0.000001"
                    value={h.lng}
                    onChange={(e) => patch(h.id, { lng: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>纬度</span>
                  <input
                    className="input"
                    type="number"
                    step="0.000001"
                    value={h.lat}
                    onChange={(e) => patch(h.id, { lat: Number(e.target.value) })}
                  />
                </label>
                <div className="field">
                  <span>坐标</span>
                  <PointPicker
                    points={route.points}
                    lines={trackLines(route)}
                    hotels={route.hotels}
                    sights={route.sights}
                    onChange={(p) => patch(h.id, { lng: p.lng, lat: p.lat })}
                  />
                </div>
              </div>
              <label className="field">
                <span>备注</span>
                <textarea className="input" rows={2} value={h.note ?? ''} onChange={(e) => patch(h.id, { note: e.target.value })} />
              </label>
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
