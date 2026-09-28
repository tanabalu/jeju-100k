import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Hotel, MapStyle, Sight, TrackPoint } from '../types'
import { useData } from '../store/DataContext'

const W = 800
const H = 460

/** 用内联 SVG 生成 marker 图标，避免依赖 Leaflet 默认的图片资源 */
function iconDataUri(color: string, glyph: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
<path d="M14 1C7.4 1 2 6.4 2 13c0 8.4 12 20 12 20s12-11.6 12-20C26 6.4 20.6 1 14 1z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
<text x="14" y="18" font-size="12" font-family="sans-serif" font-weight="700" fill="#ffffff" text-anchor="middle">${glyph}</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const COLORS: Record<string, string> = {
  start: '#16a34a',
  end: '#dc2626',
  via: '#2563eb',
  hotel: '#9333ea',
  sight: '#ea580c',
}

const GLYPH: Record<string, string> = {
  start: '起',
  end: '终',
  via: '·',
  hotel: '住',
  sight: '景',
}

function colorOf(kind: string): string {
  return COLORS[kind] ?? COLORS.via
}

/**
 * 归一化路线数据为「若干段折线」：
 * 过滤掉非数组的脏数据段，全空时用单段 points 兜底。
 * 纯防御性写法——地图是全局组件，不该因为某条路线缺 points 就整页白屏。
 */
function normalizeSegments(trails: TrackPoint[][] | undefined, points: TrackPoint[]): TrackPoint[][] {
  const segs = Array.isArray(trails)
    ? trails.filter((seg): seg is TrackPoint[] => Array.isArray(seg))
    : []
  if (segs.length) return segs
  return [Array.isArray(points) ? points : []]
}

/**
 * 只保留经纬度有效的点，脏数据（undefined / NaN / 非数组）直接丢弃而不是让下游崩掉。
 * 地图是全局组件，不该因为一条脏数据就整页白屏。
 */
function finitePts<T extends { lng: number; lat: number }>(arr: T[] | undefined): T[] {
  if (!Array.isArray(arr)) return []
  return arr.filter((p): p is T => !!p && Number.isFinite(p.lng) && Number.isFinite(p.lat))
}

/**
 * 底图瓦片：数据来自 OpenStreetMap，均为官方 / 社区公共服务，**不需要 Key**。
 * ⚠️ 别用 CARTO：其 basemaps 现已强制要求 API key，匿名请求会被盖上 "API key required" 水印。
 * - standard：OpenStreetMap 标准地图，地物信息最全（默认）
 * - terrain：OpenTopoMap 地形图，带等高线与山体阴影，适合徒步 / 越野
 */
const TILES: Record<
  MapStyle,
  { url: string; attr: string; subdomains?: string; maxZoom: number; maxNativeZoom?: number }
> = {
  standard: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    // OpenTopoMap 原生只到 17 级；maxNativeZoom 让 18-19 级放大量已经有的瓦片，
    // 否则继续放大时 Leaflet 不请求瓦片，地图会变成整片空白
    maxNativeZoom: 17,
    maxZoom: 19,
    attr: 'Kartendaten: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM | Kartendarstellung: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  },
}

/** 济州岛大致中心：无数据时的默认视野 */
const JEJU_CENTER: [number, number] = [33.38, 126.53]
const DEFAULT_ZOOM = 10

function makeIcon(kind: string): L.DivIcon {
  const small = kind === 'via'
  const w = small ? 24 : 28
  const h = small ? 31 : 36
  return L.divIcon({
    className: 'trail-marker',
    html: `<img src="${iconDataUri(colorOf(kind), GLYPH[kind] ?? GLYPH.via)}" width="${w}" height="${h}" alt="" draggable="false" />`,
    iconSize: [w, h],
    iconAnchor: [small ? 12 : 14, h],
  })
}

interface RouteMapProps {
  /** 单段路线（兼容旧用法）；与 trails 二选一 */
  points?: TrackPoint[]
  /** 多段路线：每段是一条折线，用于一次性展示多条路线的位置分布 */
  trails?: TrackPoint[][]
  hotels?: Hotel[]
  sights?: Sight[]
  height?: number
  /** 开启后点击地图可取点 */
  pickable?: boolean
  onPick?: (p: { lng: number; lat: number }) => void
}

type Status = 'ready' | 'fallback'

export function RouteMap({
  points = [],
  trails,
  hotels = [],
  sights = [],
  height = 420,
  pickable = false,
  onPick,
}: RouteMapProps) {
  const { settings } = useData()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  /** 上一次自适应视野时的几何签名；几何没变就不重复 fitBounds，避免打断用户手动缩放 */
  const fitKeyRef = useRef('')
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const styleRef = useRef<MapStyle>(settings.mapStyle ?? 'standard')
  styleRef.current = settings.mapStyle ?? 'standard'

  const [status, setStatus] = useState<Status>('ready')
  const [tip, setTip] = useState('')

  // 初始化地图（仅一次）
  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return
    try {
      const map = L.map(el, {
        center: JEJU_CENTER,
        zoom: DEFAULT_ZOOM,
        /** 与瓦片图源一致的上限，避免用户一路放大到没有瓦片的层级 */
        maxZoom: 19,
        zoomControl: true,
        worldCopyJump: true,
      })
      // 比例尺（公制），随缩放自动取整公里数
      L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 120 }).addTo(map)
      layerRef.current = L.layerGroup().addTo(map)
      map.on('click', (e: L.LeafletMouseEvent) => {
        if (!pickRef.current) return
        pickRef.current({ lng: Number(e.latlng.lng.toFixed(6)), lat: Number(e.latlng.lat.toFixed(6)) })
      })
      mapRef.current = map
      setStatus('ready')
    } catch (err) {
      setStatus('fallback')
      setTip(`底图初始化失败：${err instanceof Error ? err.message : String(err)}`)
      return
    }
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      tileRef.current = null
      layerRef.current = null
      // 地图被销毁重建（StrictMode 双调用 / 重新挂载）后需要重新自适应一次
      fitKeyRef.current = ''
    }
  }, [])

  // 底图瓦片：随样式切换重建
  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return
    const conf = TILES[styleRef.current] ?? TILES.standard
    if (tileRef.current) map.removeLayer(tileRef.current)
    const tile = L.tileLayer(conf.url, {
      attribution: conf.attr,
      maxZoom: conf.maxZoom,
      ...(conf.maxNativeZoom ? { maxNativeZoom: conf.maxNativeZoom } : {}),
      // ⚠️ 只在有子域时才传 subdomains：显式传 undefined 会覆盖 Leaflet 的默认 'abc'，
      // 之后 _getSubdomain 读 options.subdomains.length 直接抛 TypeError
      ...(conf.subdomains ? { subdomains: conf.subdomains } : {}),
    })
    tile.addTo(map)
    tile.bringToBack()
    tileRef.current = tile
  }, [status, settings.mapStyle])

  // 几何图层（路线 / 标记），数据变化时重绘并自适应视野
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer || status !== 'ready') return
    layer.clearLayers()

    // 多段优先；否则把单段 points 视为一段
    const segments = normalizeSegments(trails, points)
    const allPoints: TrackPoint[] = []

    segments.forEach((seg) => {
      const valid = finitePts(seg)
      allPoints.push(...valid)
      if (valid.length > 1) {
        const latlngs = valid.map((p) => [p.lat, p.lng] as [number, number])
        // 白色描边 + 绿色主线，保证在任何底图上都清晰
        L.polyline(latlngs, {
          color: '#ffffff',
          weight: 10,
          opacity: 0.9,
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(layer)
        L.polyline(latlngs, {
          color: '#2f7d4f',
          weight: 6,
          opacity: 1,
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(layer)
      }
    })

    segments.forEach((seg) => {
      const valid = finitePts(seg)
      valid.forEach((p, i) => {
        const kind = i === 0 ? 'start' : i === valid.length - 1 ? 'end' : 'via'
        L.marker([p.lat, p.lng], { icon: makeIcon(kind) }).addTo(layer)
      })
    })
    const hotelOk = finitePts(hotels)
    const sightOk = finitePts(sights)
    hotelOk.forEach((h) => L.marker([h.lat, h.lng], { icon: makeIcon('hotel') }).addTo(layer))
    sightOk.forEach((s) => L.marker([s.lat, s.lng], { icon: makeIcon('sight') }).addTo(layer))

    const coords: [number, number][] = [
      ...allPoints.map((p) => [p.lat, p.lng] as [number, number]),
      ...hotelOk.map((h) => [h.lat, h.lng] as [number, number]),
      ...sightOk.map((s) => [s.lat, s.lng] as [number, number]),
    ]
    if (coords.length === 0) return
    // 只有几何真的变了才重置视野，避免勾选「已完成」等无关状态变更把地图拉回全局
    const key = coords.map((c) => `${c[0]},${c[1]}`).join(';')
    if (key === fitKeyRef.current) return
    fitKeyRef.current = key
    if (coords.length === 1) {
      map.setView(coords[0], 14, { animate: false })
    } else {
      map.fitBounds(L.latLngBounds(coords), { padding: [60, 60], maxZoom: 15 })
    }
  }, [status, points, trails, hotels, sights])

  const fallbackBox = useMemo(
    () => project(normalizeSegments(trails, points), hotels, sights),
    [points, trails, hotels, sights],
  )

  return (
    <div className="map-wrap" style={{ height }}>
      <div ref={containerRef} className="map-canvas" style={{ height }} />
      {status === 'fallback' && (
        <div className="map-fallback" style={{ height }}>
          <FallbackSketch box={fallbackBox} pickable={pickable} onPick={onPick} tip={tip} />
        </div>
      )}
      {status === 'ready' && pickable && <div className="map-pick-hint">点击地图取点</div>}
      {status === 'ready' && !pickable && (
        <div className="map-legend">
          <span><i style={{ background: COLORS.start }} />起点</span>
          <span><i style={{ background: COLORS.end }} />终点</span>
          <span><i style={{ background: COLORS.via }} />途经点</span>
          <span><i style={{ background: COLORS.hotel }} />住宿</span>
          <span><i style={{ background: COLORS.sight }} />看点</span>
        </div>
      )}
    </div>
  )
}

interface Projected {
  items: { x: number; y: number; kind: string; name: string }[]
  paths: string[]
  hasData: boolean
  lngMin: number
  lngMax: number
  latMin: number
  latMax: number
}

/** 底图不可用时的离线示意图：把经纬度线性投影到画布 */
function project(segments: TrackPoint[][], hotels: Hotel[], sights: Sight[]): Projected {
  const segPts = segments.map((seg) => finitePts(seg))
  const hotelsOk = finitePts(hotels)
  const sightsOk = finitePts(sights)

  const coords = [
    ...segPts.flat().map((p) => ({ lng: p.lng, lat: p.lat })),
    ...hotelsOk.map((h) => ({ lng: h.lng, lat: h.lat })),
    ...sightsOk.map((s) => ({ lng: s.lng, lat: s.lat })),
  ]
  if (coords.length === 0) {
    return { items: [], paths: [], hasData: false, lngMin: 0, lngMax: 1, latMin: 0, latMax: 1 }
  }

  const lngs = coords.map((p) => p.lng)
  const lats = coords.map((p) => p.lat)
  const lngMin = Math.min(...lngs)
  const lngMax = Math.max(...lngs)
  const latMin = Math.min(...lats)
  const latMax = Math.max(...lats)
  const spanLng = Math.max(lngMax - lngMin, 1e-6)
  const spanLat = Math.max(latMax - latMin, 1e-6)
  const pad = 46
  const toX = (lng: number) => pad + ((lng - lngMin) / spanLng) * (W - pad * 2)
  const toY = (lat: number) => pad + (1 - (lat - latMin) / spanLat) * (H - pad * 2)

  const items: Projected['items'] = []
  segPts.forEach((seg) => {
    seg.forEach((p, i) => {
      const kind = i === 0 ? 'start' : i === seg.length - 1 ? 'end' : 'via'
      items.push({ x: toX(p.lng), y: toY(p.lat), kind, name: p.name })
    })
  })
  hotelsOk.forEach((h) => items.push({ x: toX(h.lng), y: toY(h.lat), kind: 'hotel', name: h.name }))
  sightsOk.forEach((s) => items.push({ x: toX(s.lng), y: toY(s.lat), kind: 'sight', name: s.name }))

  const paths = segPts
    .filter((seg) => seg.length > 1)
    .map((seg) =>
      seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.lng).toFixed(1)},${toY(p.lat).toFixed(1)}`).join(' '),
    )

  return { items, paths, hasData: true, lngMin, lngMax, latMin, latMax }
}

function FallbackSketch({
  box,
  pickable,
  onPick,
  tip,
}: {
  box: Projected
  pickable: boolean
  onPick?: (p: { lng: number; lat: number }) => void
  tip: string
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const handleClick = (e: MouseEvent<SVGSVGElement>) => {
    if (!pickable || !onPick || !svgRef.current || !box.hasData) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    const y = ((e.clientY - rect.top) / rect.height) * H
    const pad = 46
    const lng = box.lngMin + ((x - pad) / (W - pad * 2)) * (box.lngMax - box.lngMin)
    const lat = box.latMin + (1 - (y - pad) / (H - pad * 2)) * (box.latMax - box.latMin)
    onPick({ lng: Number(lng.toFixed(6)), lat: Number(lat.toFixed(6)) })
  }

  return (
    <div className="sketch">
      <div className="sketch-tip">{tip}</div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="sketch-svg"
        style={{ cursor: pickable ? 'crosshair' : 'default' }}
        onClick={handleClick}
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0 L0 0 0 40" fill="none" stroke="#e6e9ef" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="url(#grid)" />
        {box.paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="#2f7d4f"
            strokeWidth="4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {box.items.map((it, i) => (
          <g key={i}>
            <circle cx={it.x} cy={it.y} r={it.kind === 'via' ? 6 : 10} fill={colorOf(it.kind)} stroke="#fff" strokeWidth="2" />
            <text x={it.x} y={it.y - 16} fontSize="13" textAnchor="middle" fill="#475569">
              {it.name}
            </text>
          </g>
        ))}
        {!box.hasData && (
          <text x={W / 2} y={H / 2} fontSize="16" textAnchor="middle" fill="#94a3b8">
            还没有坐标点，先在管理后台添加起点 / 终点
          </text>
        )}
      </svg>
      <div className="sketch-foot">
        <span><i style={{ background: COLORS.start }} />起点</span>
        <span><i style={{ background: COLORS.end }} />终点</span>
        <span><i style={{ background: COLORS.via }} />途经点</span>
        <span><i style={{ background: COLORS.hotel }} />住宿</span>
        <span><i style={{ background: COLORS.sight }} />看点</span>
      </div>
    </div>
  )
}
