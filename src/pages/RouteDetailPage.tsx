import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { useData } from '../store/DataContext'
import { RouteMap } from '../components/RouteMap'
import { ElevationChart } from '../components/ElevationChart'
import { Thumb } from '../components/Thumb'
import { computeMetrics, formatGain, formatKm, projectToRoute, trackLines } from '../lib/geo'
import { TRIP_PLANS, TRIP_PLAN_DISCLAIMER } from '../lib/tripPlans'
import { estimateHours, formatHours } from '../lib/dayPlan'
import { formatDurationRange, officialDuration } from '../lib/olleDurations'
import { resolveImageSrc } from '../lib/imageStore'
import { useActivePlan } from '../hooks/useActivePlan'
import { routeKindLabel } from '../lib/routeKind'
import { matchStayName } from '../lib/staySearch'
import { stayName } from '../lib/stayName'
import { useStayIntro } from '../lib/stayIntro'
import type { Hotel, ImageRef, RouteMetrics } from '../types'
import styles from './RouteDetailPage.module.less'

/** 全屏查看器的条目：相册 / 景点图片统一成这个形状 */
interface LightboxItem {
  image: ImageRef
  caption?: string
  takenAt?: string
}

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

/** 按路线编号排序（与「全部路线」列表默认顺序一致），用于详情页上/下一条衔接 */
function byCode(a: { code?: string | null }, b: { code?: string | null }): number {
  const na = parseFloat(a.code ?? '999')
  const nb = parseFloat(b.code ?? '999')
  if (na !== nb) return na - nb
  return (a.code ?? '').localeCompare(b.code ?? '')
}

/** 详情页住宿列表默认陈列的条数；其余进「查看全部」抽屉 */
const STAY_PREVIEW = 3

export function RouteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { getRoute, routes } = useData()
  const route = id ? getRoute(id) : undefined
  const { addRoute, has } = useActivePlan()
  // 全屏查看器：items 是这次要看的图片集合（相册或某个景点的多图），index 是当前看到第几张
  const [lb, setLb] = useState<{ items: LightboxItem[]; index: number } | null>(null)
  // 住宿「查看更多」抽屉：详情页只陈列前几条，全部列表在右侧抽屉里看，不在详情页铺开
  const [stayOpen, setStayOpen] = useState(false)

  // 全量路线按编号排好序，再定位当前这条，才能拿到正确的上一条 / 下一条
  const ordered = useMemo(() => [...routes].sort(byCode), [routes])
  const idx = ordered.findIndex((r) => r.id === id)
  const prev = idx > 0 ? ordered[idx - 1] : undefined
  const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : undefined

  const m = useMemo(() => (route ? computeMetrics(route) : undefined), [route])
  const official = officialDuration(route?.code)

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
      <div className={`${styles['detail-head']}`}>
        <div>
          <div className={`${styles['crumb']}`}>
            <Link to="/">全部路线</Link> / {route.name}
          </div>
          <h1 className="detail-title">
            {route.code && <span className={`${styles['code-inline']}`}>偶来 {route.code}</span>}
            {route.name}
          </h1>
          <div className="route-meta">
            <span>{route.region || '—'}</span>
            <span>·</span>
            <span>{routeKindLabel(route.kind)}</span>
            <span>·</span>
            <span>难度 {'★'.repeat(Math.max(1, Math.min(5, route.difficulty)))}</span>
            {route.surface && (
              <>
                <span>·</span>
                <span>{route.surface}</span>
              </>
            )}
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

      <div className={`${styles['stat-row']}`}>
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
          label="预估耗时"
          value={
            official
              ? formatDurationRange(official)
              : m
                ? `约 ${formatHours(estimateHours(m.distanceKm, m.gainM))}`
                : '—'
          }
          hint={
            official
              ? '济州偶来官方口径'
              : '按里程 / 爬升估算（官方未公布）'
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
          <div className={`${styles['trip-card']}`}>
            <div className={`${styles['trip-rows']}`}>
              <TripRow icon="🏨" label="前夜住宿" value={plan.stay} />
              <TripRow icon="⏰" label="建议起床" value={plan.wake} />
              <TripRow icon="🚌" label="去程交通" value={plan.access} />
              <TripRow icon="🚶" label="分段步行">
                <div className={`${styles['trip-chips']}`}>
                  {plan.stages.map((s, i) => (
                    <span key={i} className={`${styles['trip-chip']}`}>
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
                <span className={`${styles['trip-note-icon']}`}>{n.startsWith('⚠️') ? '⚠️' : 'ℹ️'}</span> {n.replace(/^⚠️\s*/, '')}
              </p>
            ))}
            <p className={`${styles['trip-disclaimer']}`}>{TRIP_PLAN_DISCLAIMER}</p>
          </div>
        </section>
      )}

      <section className="section">
        <h2>起终点与轨迹</h2>
        <div className={`${styles['start-end']}`}>
          <div className={`${styles['se-card']}`}>
            <span className={`${styles['dot']} ${styles['dot-start']}`} />
            <div>
              <b>起点</b>
              <p>{start?.name ?? '未设置'}</p>
              <code>{start ? `${start.lng.toFixed(5)}, ${start.lat.toFixed(5)}` : '—'}</code>
              {start?.ele != null && <span className={`${styles['se-ele']}`}>海拔 {start.ele} m</span>}
            </div>
          </div>
          <div className={`${styles['se-arrow']}`}>→</div>
          <div className={`${styles['se-card']}`}>
            <span className={`${styles['dot']} ${styles['dot-end']}`} />
            <div>
              <b>终点</b>
              <p>{end?.name ?? '未设置'}</p>
              <code>{end ? `${end.lng.toFixed(5)}, ${end.lat.toFixed(5)}` : '—'}</code>
              {end?.ele != null && <span className={`${styles['se-ele']}`}>海拔 {end.ele} m</span>}
            </div>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          {route.elevationBasis === 'track'
            ? '坐标与轨迹均为实测数据，可直接用于导航与爬升判断。'
            : '坐标为城镇级近似值，用于排序 / 看分布；导航前请校正或导入真实轨迹。'}
        </p>
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
          <div className={`${styles['point-flow']}`}>
            {route.points.map((p, i) => (
              <span key={p.id} className={`${styles['point-chip']}`}>
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
            {m.elevationBasis === 'track'
              ? '剖面与爬升来自导入的真实轨迹，非 SRTM 估算值。'
              : '剖面与爬升来自 SRTM 30m 地形数据采样估算，非官方实测；真实爬升通常更大，配速补给判断建议导入真实 GPX 轨迹。'}
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
          <>
            {/* 详情页只陈列前 3 条，避免一长串铺满；其余在「查看全部」抽屉里看 */}
            <div className="list">
              {hotelRows.slice(0, STAY_PREVIEW).map(({ hotel, atKm, offRouteKm }) => (
                <HotelCard key={hotel.id} hotel={hotel} atKm={atKm} offRouteKm={offRouteKm} />
              ))}
            </div>
            {hotelRows.length > STAY_PREVIEW && (
              <button type="button" className={styles['stay-more']} onClick={() => setStayOpen(true)}>
                查看全部 {hotelRows.length} 家住宿
                <span className={styles['stay-more-arrow']}>→</span>
              </button>
            )}
          </>
        )}
      </section>

      <section className="section">
        <h2>
          路边景色 <span className="count">{route.sights.length}</span>
        </h2>
        {sightRows.length === 0 ? (
          <p className="muted">还没有录入看点。</p>
        ) : (
          <div className={`${styles['grid-sights']}`}>
            {sightRows.map(({ sight, atKm }) => (
              <div key={sight.id} className={`${styles['sight-card']}`}>
                {sight.images.length > 1 ? (
                  <SightGallery
                    images={sight.images}
                    name={sight.name}
                    onOpen={(i) => setLb({ items: sight.images.map((img) => ({ image: img })), index: i })}
                  />
                ) : (
                  <button
                    type="button"
                    className={`${styles['sight-img']} ${styles['sight-click']}`}
                    onClick={sight.images.length === 1 ? () => setLb({ items: [{ image: sight.images[0] }], index: 0 }) : undefined}
                    aria-label={sight.name}
                  >
                    <Thumb image={sight.images[0]} alt={sight.name} radius={0} />
                  </button>
                )}
                <div className={`${styles['sight-body']}`}>
                  <b>{sight.name}</b>
                  <span className="pill">沿线 {formatKm(atKm)} km</span>
                  <p>{sight.desc || '（未填描述）'}</p>
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
          <div className={`${styles['album-grid']}`}>
            {route.album.map((item, idx) => (
              <button key={item.id} className={`${styles['album-cell']}`} onClick={() => setLb({ items: route.album, index: idx })}>
                <Thumb image={item.image} alt={item.caption ?? ''} radius={8} autoHeight />
                {item.caption && <span className={`${styles['album-cap']}`}>{item.caption}</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 底部上一条 / 下一条：按编号顺序衔接，与「全部路线」列表默认顺序一致 */}
      <nav className={`${styles['pager']}`} aria-label="路线切换">
        {prev ? (
          <Link
            to={`/routes/${prev.id}`}
            className={`${styles['pager-link']} ${styles['pager-prev']}`}
            aria-label={`上一条：${prev.code ? `偶来 ${prev.code} · ` : ''}${prev.name}`}
          >
            <span className={`${styles['pager-dir']}`}>← 上一条</span>
            <span className={`${styles['pager-name']}`}>
              {prev.code && <em>偶来 {prev.code}</em>}
              {prev.name}
            </span>
          </Link>
        ) : (
          <span className={`${styles['pager-link']} ${styles['pager-prev']} ${styles['is-disabled']}`} aria-disabled="true">
            <span className={`${styles['pager-dir']}`}>← 上一条</span>
            <span className={`${styles['pager-name']}`}>已经是第一条</span>
          </span>
        )}
        <span className={`${styles['pager-count']}`}>
          {idx + 1} / {ordered.length}
        </span>
        {next ? (
          <Link
            to={`/routes/${next.id}`}
            className={`${styles['pager-link']} ${styles['pager-next']}`}
            aria-label={`下一条：${next.code ? `偶来 ${next.code} · ` : ''}${next.name}`}
          >
            <span className={`${styles['pager-dir']}`}>下一条 →</span>
            <span className={`${styles['pager-name']}`}>
              {next.code && <em>偶来 {next.code}</em>}
              {next.name}
            </span>
          </Link>
        ) : (
          <span className={`${styles['pager-link']} ${styles['pager-next']} ${styles['is-disabled']}`} aria-disabled="true">
            <span className={`${styles['pager-dir']}`}>下一条 →</span>
            <span className={`${styles['pager-name']}`}>已经是最后一条</span>
          </span>
        )}
      </nav>

      {lb && (
        <Lightbox
          items={lb.items}
          index={lb.index}
          onClose={() => setLb(null)}
          onNav={(d) =>
            setLb((l) => (l == null ? l : { ...l, index: (l.index + d + l.items.length) % l.items.length }))
          }
        />
      )}
      {stayOpen && <StayDrawer rows={hotelRows} onClose={() => setStayOpen(false)} />}
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
    <div className={`${styles['trip-row']}`}>
      <span className={`${styles['trip-row-label']}`}>
        <span aria-hidden>{icon}</span> {label}
      </span>
      <div className={`${styles['trip-row-value']}`}>{children ?? value}</div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={`${styles['stat']}`}>
      <span className={`${styles['stat-label']}`}>{label}</span>
      <b className={`${styles['stat-value']}`}>{value}</b>
      {hint && <span className={`${styles['stat-hint']}`}>{hint}</span>}
    </div>
  )
}

function Lightbox({
  items,
  index,
  onClose,
  onNav,
}: {
  items: LightboxItem[]
  index: number
  onClose: () => void
  onNav: (delta: number) => void
}) {
  const item = items[index]
  const [src, setSrc] = useState<string>()
  const canNav = items.length > 1

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
      className={`${styles['viewer']}`}
      role="dialog"
      aria-modal="true"
      aria-label={item.caption || `照片 ${index + 1} / ${items.length}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <button className={`${styles['viewer-close']}`} onClick={onClose} aria-label="关闭">
        ✕
      </button>
      {canNav && (
        <button className={`${styles['viewer-nav']} ${styles['viewer-prev']}`} onClick={() => onNav(-1)} aria-label="上一张">
          ‹
        </button>
      )}
      {canNav && (
        <button className={`${styles['viewer-nav']} ${styles['viewer-next']}`} onClick={() => onNav(1)} aria-label="下一张">
          ›
        </button>
      )}
      <div className={`${styles['viewer-stage']}`}>
        {src ? (
          <img src={src} alt={item.caption ?? ''} className={`${styles['viewer-img']}`} />
        ) : (
          <div className={`skeleton ${styles['viewer-skeleton']}`} />
        )}
        {item.caption && <p className={`${styles['viewer-cap']}`}>{item.caption}</p>}
        {item.takenAt && <p className={`${styles['viewer-taken']}`}>{item.takenAt}</p>}
      </div>
      {canNav && (
        <div className={`${styles['viewer-counter']}`}>
          {index + 1} / {items.length}
        </div>
      )}
    </div>,
    document.body,
  )
}

/**
 * 路边景色的多图轮播：scroll-snap 原生滑动（触屏直接划），两侧箭头 + 指示点 + 计数器。
 * 点击任意一张打开全屏查看器（从点的那张开始，可左右切换整个景点的图）。
 */
function SightGallery({
  images,
  name,
  onOpen,
}: {
  images: ImageRef[]
  name: string
  onOpen: (index: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [cur, setCur] = useState(0)

  // 滑动时同步指示点 / 计数器：scrollLeft ÷ 视口宽 = 当前页
  const onScroll = () => {
    const el = trackRef.current
    if (!el || el.clientWidth === 0) return
    setCur(Math.min(images.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))))
  }
  const go = (d: number) => {
    const el = trackRef.current
    if (!el) return
    el.scrollTo({ left: (cur + d) * el.clientWidth, behavior: 'smooth' })
  }

  return (
    <div className={`${styles['swipe']}`}>
      <div ref={trackRef} className={`${styles['swipe-track']}`} onScroll={onScroll}>
        {images.map((img, i) => (
          <button
            key={i}
            type="button"
            className={`${styles['swipe-slide']}`}
            onClick={() => onOpen(i)}
            aria-label={`查看 ${name} 第 ${i + 1} 张，共 ${images.length} 张`}
          >
            <Thumb image={img} alt={name} radius={0} />
          </button>
        ))}
      </div>
      {cur > 0 && (
        <button type="button" className={`${styles['swipe-nav']} ${styles['swipe-prev']}`} onClick={() => go(-1)} aria-label="上一张">
          ‹
        </button>
      )}
      {cur < images.length - 1 && (
        <button type="button" className={`${styles['swipe-nav']} ${styles['swipe-next']}`} onClick={() => go(1)} aria-label="下一张">
          ›
        </button>
      )}
      <span className={`${styles['swipe-counter']}`}>
        {cur + 1} / {images.length}
      </span>
      <div className={`${styles['swipe-dots']}`} aria-hidden>
        {images.map((_, i) => (
          <i key={i} className={i === cur ? styles['is-on'] : undefined} />
        ))}
      </div>
    </div>
  )
}

/**
 * 一条住宿卡片（详情页预览与抽屉共用）。
 * 主名优先级：中文(nameZh) > 英文(nameEn) > 韩文原名(name)；副行补韩文原名与英文名，方便对上检索结果。
 * 价格 / 评分：OSM 未提供时为 null，此处只在有真实数据时才渲染对应标签，绝不编造假数值。
 */
/**
 * 酒店介绍：显示打包默认介绍，并支持就地编辑保存。
 * 改写存进 localStorage 覆盖层（见 src/lib/stayIntro.ts），刷新后优先于默认介绍，
 * 且不会被 DataContext.mergeStays 用 bundle 真源整条覆盖掉。
 */
function HotelIntro({ hotel }: { hotel: Hotel }) {
  const { value, isOverridden, save, reset } = useStayIntro(hotel.id, hotel.intro)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const startEdit = () => {
    setDraft(value)
    setEditing(true)
  }
  const commit = () => {
    // 与默认介绍一致就回落覆盖，避免写一份和默认重复的冗余 override
    if (draft.trim() === (hotel.intro ?? '').trim()) reset()
    else save(draft)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className={styles['hotel-intro-edit']}>
        <textarea
          className="input"
          rows={4}
          value={draft}
          placeholder="填写酒店介绍：位置、设施、周边、参考价格等"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className={styles['hotel-intro-actions']}>
          <button className="btn btn-sm btn-primary" onClick={commit}>
            保存
          </button>
          <button className="btn btn-sm" onClick={() => setEditing(false)}>
            取消
          </button>
          {isOverridden && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                reset()
                setEditing(false)
              }}
            >
              恢复默认
            </button>
          )}
        </div>
      </div>
    )
  }

  if (value) {
    return (
      <div className={styles['hotel-intro']}>
        <p className={styles['list-note']}>{value}</p>
        <button className={styles['hotel-intro-edit-btn']} onClick={startEdit}>
          编辑介绍
        </button>
      </div>
    )
  }

  return (
    <button className={styles['hotel-intro-add']} onClick={startEdit}>
      ＋ 添加酒店介绍
    </button>
  )
}

function HotelCard({
  hotel,
  atKm,
  offRouteKm,
}: {
  hotel: Hotel
  atKm: number
  offRouteKm: number
}) {
  const main = stayName(hotel)
  /** 英文名（OSM 真实拉丁名）有且不与主标题重复时才补，便于和英文检索结果对上 */
  const en = hotel.nameEn && hotel.nameEn !== main && hotel.nameEn !== hotel.name ? hotel.nameEn : ''
  /** 副行：主标题不是韩文原名时补原名，再补英文名（两都有可能只有其一） */
  const subLine = [main !== hotel.name ? hotel.name : '', en].filter(Boolean).join(' · ')
  return (
    <div key={hotel.id} className="list-item">
      <div className="list-main">
        <div className={styles['hotel-head']}>
          {hotel.cover && (
            <div className={styles['hotel-cover']}>
              <Thumb image={hotel.cover} alt={hotel.name} radius={8} />
            </div>
          )}
          <div className="list-main">
            <b>{main}</b>
            {subLine && <span className="muted">{subLine}</span>}
          </div>
        </div>
      </div>
      <div className="list-side">
        <span className="pill">沿线 {formatKm(atKm)} km</span>
        <span className="pill">离路线 {formatKm(offRouteKm)} km</span>
        {hotel.priceRange && <span className="pill">¥{hotel.priceRange}</span>}
        {hotel.rating != null && <span className="pill">{hotel.rating} 分</span>}
      </div>
      {hotel.note && <p className={styles['list-note']}>{hotel.note}</p>}
      {hotel.phone && <p className={styles['list-note']}>电话：{hotel.phone}</p>}
      {hotel.website && (
        <p className={styles['list-note']}>
          官网：
          <a href={hotel.website} target="_blank" rel="noopener noreferrer" className={styles['list-link']}>
            访问 ↗
          </a>
        </p>
      )}
      <HotelIntro hotel={hotel} />
    </div>
  )
}

/**
 * 住宿「查看全部」抽屉：从右侧滑入的浮层（另一个容器），详情页本身不展开长列表。
 * 顶部带名称搜索（中文 / 韩文 / 英文 / 罗马音皆可），Esc 或点遮罩关闭，打开时锁背景滚动。
 */
function StayDrawer({
  rows,
  onClose,
}: {
  rows: { hotel: Hotel; atKm: number; offRouteKm: number }[]
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const t = q.trim()
    if (!t) return rows
    return rows.filter(({ hotel }) => matchStayName(hotel, t))
  }, [rows, q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return createPortal(
    <div
      className={styles['stay-mask']}
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside className={styles['stay-drawer']} role="dialog" aria-modal="true" aria-label="附近住宿全部列表">
        <header className={styles['stay-head']}>
          <div className={styles['stay-title']}>
            <b>附近住宿</b>
            <span className={styles['stay-count']}>共 {rows.length} 家</span>
          </div>
          <button className={styles['stay-close']} onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className={styles['stay-search-wrap']}>
          <input
            className={styles['stay-search']}
            placeholder="搜索名称（中文 / 韩文 / 英文）"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className={styles['stay-body']}>
          {filtered.length === 0 ? (
            <p className="muted">没有匹配的住宿。</p>
          ) : (
            <div className="list">
              {filtered.map(({ hotel, atKm, offRouteKm }) => (
                <HotelCard key={hotel.id} hotel={hotel} atKm={atKm} offRouteKm={offRouteKm} />
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
