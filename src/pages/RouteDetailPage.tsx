import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { useData } from '../store/DataContext'
import { RouteMap } from '../components/RouteMap'
import { ElevationChart } from '../components/ElevationChart'
import { Thumb } from '../components/Thumb'
import { computeMetrics, formatGain, formatKm, projectToRoute, trackLines } from '../lib/geo'
import { TRIP_PLANS, TRIP_PLAN_DISCLAIMER } from '../lib/tripPlans'
import { resolveImageSrc } from '../lib/imageStore'
import { useActivePlan } from '../hooks/useActivePlan'
import { routeKindLabel } from '../lib/routeKind'
import type { AlbumItem, RouteMetrics } from '../types'

/** 爬升数字的口径说明，避免把「估算」和「实测」混为一谈 */
function gainHint(m: RouteMetrics | undefined): string {
  if (!m) return '—'
  const loss = m.lossM != null ? `下降 ${m.lossM} m · ` : ''
  switch (m.gainSource) {
    case 'manual':
      return '手填值'
    case 'profile':
      return `${loss}${basisLabel(m)}`
    case 'points':
      return `${loss}按途经点海拔累加`
    default:
      return '未采集海拔，可在后台补'
  }
}

/** 地形数据口径：真实轨迹就不再叫「估算」 */
function basisLabel(m: RouteMetrics): string {
  if (m.elevationBasis === 'track') return '沿真实轨迹逐点累加'
  return m.elevationBasis === 'loop' ? '环线圆周采样估算' : '直线采样估算'
}

export function RouteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { getRoute } = useData()
  const route = id ? getRoute(id) : undefined
  const { addRoute, has } = useActivePlan()
  const [lbIndex, setLbIndex] = useState<number | null>(null)

  const m = useMemo(() => (route ? computeMetrics(route) : undefined), [route])

  if (!route) {
    return (
      <div className="page empty">
        <p>找不到这条路线，可能已被删除。</p>
        <Link to="/" className="btn btn-primary">
          返回路线列表
        </Link>
      </div>
    )
  }

  // 途经点只有起终点，直线里程远短于官方里程；
  // 「沿线 N km」要按同一比例拉伸到生效里程，否则标注会明显偏小
  const kmScale =
    m && m.straightKm > 0 && m.distanceKm > 0 ? m.distanceKm / m.straightKm : 1

  const hotelRows = route.hotels
    .map((h) => ({ hotel: h, ...projectToRoute({ lng: h.lng, lat: h.lat }, route.points) }))
    .map((r) => ({ ...r, atKm: r.atKm * kmScale }))
    .sort((a, b) => a.atKm - b.atKm)

  const sightRows = route.sights
    .map((s) => ({ sight: s, ...projectToRoute({ lng: s.lng, lat: s.lat }, route.points) }))
    .map((r) => ({ ...r, atKm: r.atKm * kmScale }))
    .sort((a, b) => a.atKm - b.atKm)

  const start = m?.startPoint
  const end = m?.endPoint
  const added = has(route.id)
  // 行程建议：按路线编号查表（27 条全量，见 src/lib/tripPlans.ts）
  const plan = route.code ? TRIP_PLANS[route.code] : undefined

  return (
    <div className="page">
      <div className="detail-head">
        <div>
          <div className="crumb">
            <Link to="/">全部路线</Link> / {route.name}
          </div>
          <h1 className="detail-title">
            {route.code && <span className="code-inline">偶来 {route.code}</span>}
            {route.name}
          </h1>
          <div className="route-meta">
            <span>{route.region || '—'}</span>
            <span>·</span>
            <span>{routeKindLabel(route.kind)}</span>
            <span>·</span>
            <span>难度 {'★'.repeat(Math.max(1, Math.min(5, route.difficulty)))}</span>
            {route.bestSeason && (
              <>
                <span>·</span>
                <span>最佳季节 {route.bestSeason}</span>
              </>
            )}
          </div>
        </div>
        <div className="detail-actions">
          <button
            className="btn btn-primary"
            disabled={added}
            onClick={() => addRoute(route.id)}
            title={added ? '已在当前行程篮里，每条路线只算一次' : undefined}
          >
            {added ? '已加入行程篮' : '加入行程篮'}
          </button>
          <Link to={`/admin?route=${route.id}`} className="btn">
            编辑
          </Link>
        </div>
      </div>

      <p className="detail-summary">{route.summary || '（还没有写简介）'}</p>

      <div className="stat-row">
        <Stat
          label="总里程"
          value={`${formatKm(m?.distanceKm ?? 0)} km`}
          hint={
            m?.trackKm
              ? `官方里程 · 轨迹实测 ${formatKm(m.trackKm)} km`
              : route.manualDistanceKm
                ? '手填里程'
                : '按途经点估算'
          }
        />
        <Stat
          label="累计爬升"
          value={formatGain(m?.gainM)}
          hint={gainHint(m)}
        />
        <Stat
          label="海拔区间"
          value={m?.highestM != null ? `${m.lowestM} ~ ${m.highestM} m` : '—'}
          hint={m?.gainSource === 'profile' ? (m.elevationBasis === 'track' ? '取自真实轨迹' : '取自地形采样') : '取自途经点海拔'}
        />
        <Stat label="途经点" value={`${route.points.length} 个`} hint={`${route.hotels.length} 住宿 / ${route.sights.length} 看点`} />
      </div>

      {/* 行程建议：27 条线全量（数据口径见 src/lib/tripPlans.ts 头注释） */}
      {route.code && plan && (
        <section className="section">
          <h2>行程建议</h2>
          <div className="trip-card">
            <div className="trip-head">
              <b>
                {route.code}号线 · {start?.name ?? '—'} → {end?.name ?? '—'}
              </b>
              <span className="trip-head-meta">
                {formatKm(m?.distanceKm ?? 0)} · 难度 {'★'.repeat(Math.max(1, Math.min(5, route.difficulty)))}
              </span>
            </div>
            <div className="trip-rows">
              <TripRow icon="🏨" label="前夜住宿" value={plan.stay} />
              <TripRow icon="⏰" label="建议起床" value={plan.wake} />
              <TripRow icon="🚌" label="去程交通" value={plan.access} />
              <TripRow icon="🚶" label="分段步行">
                <div className="trip-chips">
                  {plan.stages.map((s, i) => (
                    <span key={i} className="trip-chip">
                      {s}
                    </span>
                  ))}
                </div>
              </TripRow>
              <TripRow icon="🍚" label="午餐补给" value={plan.lunch} />
              <TripRow icon="🔙" label="回程交通" value={plan.back} />
              <TripRow icon="🛏️" label="回程住宿" value={plan.stayReturn} />
            </div>
            {plan.notes?.map((n, i) => (
              <p key={i} className={`trip-note ${n.startsWith('⚠️') ? 'is-warn' : ''}`}>
                <span className="trip-note-icon">{n.startsWith('⚠️') ? '⚠️' : 'ℹ️'}</span> {n.replace(/^⚠️\s*/, '')}
              </p>
            ))}
            <p className="trip-disclaimer">{TRIP_PLAN_DISCLAIMER}</p>
          </div>
        </section>
      )}

      <section className="section">
        <h2>起终点与轨迹</h2>
        <div className="start-end">
          <div className="se-card">
            <span className="dot dot-start" />
            <div>
              <b>起点</b>
              <p>{start?.name ?? '未设置'}</p>
              <code>{start ? `${start.lng.toFixed(5)}, ${start.lat.toFixed(5)}` : '—'}</code>
              {start?.ele != null && <span className="se-ele">海拔 {start.ele} m</span>}
            </div>
          </div>
          <div className="se-arrow">→</div>
          <div className="se-card">
            <span className="dot dot-end" />
            <div>
              <b>终点</b>
              <p>{end?.name ?? '未设置'}</p>
              <code>{end ? `${end.lng.toFixed(5)}, ${end.lat.toFixed(5)}` : '—'}</code>
              {end?.ele != null && <span className="se-ele">海拔 {end.ele} m</span>}
            </div>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          {route.elevationBasis === 'track'
            ? route.elevationSegments
              ? `坐标与轨迹均为实测数据。这条轨迹有 ${route.elevationSegments.length - 1} 处断口（数据源里那几段没画到），图上按实际有数据的段落绘制，不连线补全。`
              : '坐标与轨迹均为实测数据（轨迹导入），可直接用于导航与爬升判断。'
            : '坐标为城镇级近似值，用于排序 / 看分布；导航前请用「地图选点」校正，或导入真实轨迹一键替换。'}
        </p>
        {route.legacyWaypoints && (
          <p className="muted" style={{ marginTop: 4, fontSize: 12, color: '#b45309' }}>
            ⚠️ 旧走向 · 待核：途经点整理自 2017 官方线路图，这条线路此后改过线，途经点位置可能与现行路径不符。
          </p>
        )}
        {route.trackSource && (
          <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            轨迹来源：<a href={route.trackSource.url} target="_blank" rel="noopener noreferrer">{route.trackSource.name}</a>
          </p>
        )}
        <RouteMap
          points={route.points}
          lines={trackLines(route)}
          // 没有实测轨迹时，图上那根线只是「把两个近似坐标连起来」——
          // 走虚线，别让它看起来像真走过的路
          approxLines={route.elevationBasis === 'track' ? undefined : [true]}
          hotels={route.hotels}
          sights={route.sights}
          height={440}
        />
        {route.points.length > 2 && (
          <div className="point-flow">
            {route.points.map((p, i) => (
              <span key={p.id} className="point-chip">
                <i>{i === 0 ? '起' : i === route.points.length - 1 ? '终' : i}</i>
                {p.name}
                {p.ele != null && <em>{p.ele}m</em>}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>海拔剖面</h2>
        <ElevationChart
          points={route.points}
          samples={route.elevationProfile}
          totalKm={m?.distanceKm}
          marks={sightRows.map((s) => ({ name: s.sight.name, atKm: s.atKm }))}
        />
        {m?.gainSource === 'profile' && (
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            {m.elevationBasis === 'track' ? (
              <>
                剖面与爬升来自<b>导入的真实轨迹</b>（沿线逐点累加，3 m 噪声阈值），不是 SRTM 直线估算值。
                {route.elevationSegments && (
                  <>
                    轨迹有断口，里程与爬升按<b>各段分别累加</b>，跨断口的那一截不算进来。
                  </>
                )}
              </>
            ) : (
              <>
                剖面与爬升来自 SRTM 30m 公开地形数据，沿
                {m.elevationBasis === 'loop' ? '「官方里程反推的圆周」' : '「起点→终点直线」'}
                均匀采样估算，<b>不是官方实测爬升</b>。真实路线沿海岸蜿蜒，
                实际爬升通常比这个数大；要用它做配速和补给判断，请导入真实 GPX 轨迹。
              </>
            )}
          </p>
        )}
      </section>

      <section className="section">
        <h2>
          附近住宿 <span className="count">{route.hotels.length}</span>
        </h2>
        {hotelRows.length === 0 ? (
          <p className="muted">还没有录入住宿，去管理后台添加。</p>
        ) : (
          <div className="list">
            {hotelRows.map(({ hotel, atKm, offRouteKm }) => (
              <div key={hotel.id} className="list-item">
                <div className="list-main">
                  <b>{hotel.name}</b>
                  <span className="muted">{hotel.address || '（未填地址）'}</span>
                </div>
                <div className="list-side">
                  <span className="pill">沿线 {formatKm(atKm)} km</span>
                  <span className="pill">离路线 {formatKm(offRouteKm)} km</span>
                  {hotel.priceRange && <span className="pill">¥{hotel.priceRange}</span>}
                  {hotel.rating != null && <span className="pill">{hotel.rating} 分</span>}
                </div>
                {hotel.note && <p className="list-note">{hotel.note}</p>}
                {hotel.phone && <p className="list-note">电话：{hotel.phone}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>
          路边景色 <span className="count">{route.sights.length}</span>
        </h2>
        {sightRows.length === 0 ? (
          <p className="muted">还没有录入看点。</p>
        ) : (
          <div className="grid-sights">
            {sightRows.map(({ sight, atKm }) => (
              <div key={sight.id} className="sight-card">
                <div className="sight-img">
                  <Thumb image={sight.images[0]} alt={sight.name} radius={8} />
                </div>
                <div className="sight-body">
                  <b>{sight.name}</b>
                  <span className="pill">沿线 {formatKm(atKm)} km</span>
                  <p>{sight.desc || '（未填描述）'}</p>
                  {sight.images.length > 1 && <span className="muted">共 {sight.images.length} 张</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>
          相册 <span className="count">{route.album.length}</span>
        </h2>
        {route.album.length === 0 ? (
          <p className="muted">还没有照片，去管理后台上传。</p>
        ) : (
          <div className="album-grid">
            {route.album.map((item, idx) => (
              <button key={item.id} className="album-cell" onClick={() => setLbIndex(idx)}>
                <Thumb image={item.image} alt={item.caption ?? ''} radius={8} />
                {item.caption && <span className="album-cap">{item.caption}</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      {lbIndex != null && (
        <Lightbox
          album={route.album}
          index={lbIndex}
          onClose={() => setLbIndex(null)}
          onNav={(d) =>
            setLbIndex((i) =>
              i == null ? i : (i + d + route.album.length) % route.album.length,
            )
          }
        />
      )}
    </div>
  )
}

/** 行程建议卡的一行：图标 + 标签 + 内容（内容可以是文本，也可以是 chips） */
function TripRow({
  icon,
  label,
  value,
  children,
}: {
  icon: string
  label: string
  value?: string
  children?: React.ReactNode
}) {
  return (
    <div className="trip-row">
      <span className="trip-row-label">
        <span aria-hidden>{icon}</span> {label}
      </span>
      <div className="trip-row-value">{children ?? value}</div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  )
}

function Lightbox({
  album,
  index,
  onClose,
  onNav,
}: {
  album: AlbumItem[]
  index: number
  onClose: () => void
  onNav: (delta: number) => void
}) {
  const item = album[index]
  const [src, setSrc] = useState<string>()
  const canNav = album.length > 1

  // 切换照片时重新解析图片源，切换过程中先显示骨架占位
  useEffect(() => {
    let alive = true
    setSrc(undefined)
    resolveImageSrc(item.image).then((u) => alive && setSrc(u))
    return () => {
      alive = false
    }
  }, [item])

  // 键盘：Esc 关闭、左右方向键切换（方向键仅多张时生效）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (canNav && e.key === 'ArrowLeft') onNav(-1)
      else if (canNav && e.key === 'ArrowRight') onNav(1)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [canNav, onClose, onNav])

  return createPortal(
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={item.caption || `照片 ${index + 1} / ${album.length}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <button className="viewer-close" onClick={onClose} aria-label="关闭">
        ✕
      </button>
      {canNav && (
        <button className="viewer-nav viewer-prev" onClick={() => onNav(-1)} aria-label="上一张">
          ‹
        </button>
      )}
      {canNav && (
        <button className="viewer-nav viewer-next" onClick={() => onNav(1)} aria-label="下一张">
          ›
        </button>
      )}
      <div className="viewer-stage">
        {src ? (
          <img src={src} alt={item.caption ?? ''} className="viewer-img" />
        ) : (
          <div className="skeleton viewer-skeleton" />
        )}
        {item.caption && <p className="viewer-cap">{item.caption}</p>}
        {item.takenAt && <p className="viewer-taken">{item.takenAt}</p>}
      </div>
      {canNav && (
        <div className="viewer-counter">
          {index + 1} / {album.length}
        </div>
      )}
    </div>,
    document.body,
  )
}
