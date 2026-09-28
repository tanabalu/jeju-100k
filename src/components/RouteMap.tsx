import { useEffect, useMemo, useRef, useState } from 'react'
import type { Hotel, Sight, TrackPoint } from '../types'
import { isMapUnavailable, loadTMap } from '../lib/mapLoader'
import { useData } from '../store/DataContext'

const W = 800
const H = 460

/** 用内联 SVG 生成 marker 图标，避免引用外部 demo 图片资源 */
function iconDataUri(color: string, glyph: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
<path d="M14 1C7.4 1 2 6.4 2 13c0 8.4 12 20 12 20s12-11.6 12-20C26 6.4 20.6 1 14 1z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
<text x="14" y="18" font-size="12" font-family="sans-serif" font-weight="700" fill="#ffffff" text-anchor="middle">${glyph}</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const COLORS = {
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

interface RouteMapProps {
  points: TrackPoint[]
  hotels?: Hotel[]
  sights?: Sight[]
  height?: number
  /** 开启后点击地图可取点 */
  pickable?: boolean
  onPick?: (p: { lng: number; lat: number }) => void
}

type Status = 'loading' | 'ready' | 'fallback'

export function RouteMap({ points, hotels = [], sights = [], height = 420, pickable = false, onPick }: RouteMapProps) {
  const { settings } = useData()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const lineRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick

  const [status, setStatus] = useState<Status>('loading')
  const [tip, setTip] = useState('底图加载中…')

  useEffect(() => {
    let disposed = false
    setStatus('loading')
    loadTMap(settings.tmapKey)
      .then(() => {
        if (disposed || !containerRef.current) return
        const TMap = window.TMap
        const map = new TMap.Map(containerRef.current, {
          center: new TMap.LatLng(30.26, 114.3),
          zoom: 11,
          pitch: 0,
        })
        // 容器刚从隐藏态切换 / 异步加载完成时，强制同步一次尺寸，
        // 避免 GL 投影矩阵因尺寸未就绪算出 far<=0
        requestAnimationFrame(() => {
          try {
            map.invalidateSize?.()
          } catch {
            /* 部分版本无该方法，忽略 */
          }
        })
        mapRef.current = map
        lineRef.current = new TMap.MultiPolyline({
          map,
          styles: {
            trail: new TMap.PolylineStyle({
              color: '#2f7d4f',
              width: 6,
              borderWidth: 2,
              borderColor: '#ffffff',
              lineCap: 'round',
            }),
          },
          geometries: [],
        })
        markerRef.current = new TMap.MultiMarker({
          map,
          styles: {
            start: new TMap.MarkerStyle({ width: 28, height: 36, anchor: { x: 14, y: 36 }, src: iconDataUri(COLORS.start, GLYPH.start) }),
            end: new TMap.MarkerStyle({ width: 28, height: 36, anchor: { x: 14, y: 36 }, src: iconDataUri(COLORS.end, GLYPH.end) }),
            via: new TMap.MarkerStyle({ width: 24, height: 31, anchor: { x: 12, y: 31 }, src: iconDataUri(COLORS.via, GLYPH.via) }),
            hotel: new TMap.MarkerStyle({ width: 28, height: 36, anchor: { x: 14, y: 36 }, src: iconDataUri(COLORS.hotel, GLYPH.hotel) }),
            sight: new TMap.MarkerStyle({ width: 28, height: 36, anchor: { x: 14, y: 36 }, src: iconDataUri(COLORS.sight, GLYPH.sight) }),
          },
          geometries: [],
        })
        map.on('click', (evt: any) => {
          if (!pickRef.current) return
          const ll = evt.latLng
          const lat = typeof ll.getLat === 'function' ? ll.getLat() : ll.lat
          const lng = typeof ll.getLng === 'function' ? ll.getLng() : ll.lng
          pickRef.current({ lng, lat })
        })
        setStatus('ready')
      })
      .catch((err) => {
        if (disposed) return
        setStatus('fallback')
        setTip(
          isMapUnavailable(err)
            ? '当前环境没有可用的底图服务，已降级为路线示意图'
            : `底图加载失败：${err instanceof Error ? err.message : String(err)}`,
        )
      })
    return () => {
      disposed = true
      try {
        mapRef.current?.destroy()
      } catch {
        /* 忽略销毁异常 */
      }
      mapRef.current = null
    }
  }, [settings.tmapKey])

  // 几何数据变化时刷新图层
  useEffect(() => {
    if (status !== 'ready') return
    const TMap = window.TMap
    const map = mapRef.current
    if (!TMap || !map) return

    const valid = points.filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat))
    if (valid.length > 1) {
      lineRef.current?.setGeometries([
        {
          id: 'trail',
          styleId: 'trail',
          paths: valid.map((p) => new TMap.LatLng(p.lat, p.lng)),
        },
      ])
    } else {
      lineRef.current?.setGeometries([])
    }

    const geoms: any[] = valid.map((p, i) => ({
      id: `pt_${p.id}`,
      styleId: i === 0 ? 'start' : i === valid.length - 1 ? 'end' : 'via',
      position: new TMap.LatLng(p.lat, p.lng),
    }))
    hotels.forEach((h) => {
      geoms.push({ id: `hotel_${h.id}`, styleId: 'hotel', position: new TMap.LatLng(h.lat, h.lng) })
    })
    sights.forEach((s) => {
      geoms.push({ id: `sight_${s.id}`, styleId: 'sight', position: new TMap.LatLng(s.lat, s.lng) })
    })
    markerRef.current?.setGeometries(geoms)

    if (valid.length === 0) return
    const bounds = new TMap.LatLngBounds()
    valid.forEach((p) => bounds.extend(new TMap.LatLng(p.lat, p.lng)))
    hotels.forEach((h) => bounds.extend(new TMap.LatLng(h.lat, h.lng)))
    sights.forEach((s) => bounds.extend(new TMap.LatLng(s.lat, s.lng)))
    if (valid.length === 1) {
      map.setCenter(new TMap.LatLng(valid[0].lat, valid[0].lng))
      map.setZoom(14)
    } else {
      map.fitBounds(bounds, { padding: 60 })
    }
  }, [status, points, hotels, sights])

  const fallbackBox = useMemo(() => project(points, hotels, sights), [points, hotels, sights])

  return (
    <div className="map-wrap" style={{ height }}>
      <div ref={containerRef} className="map-canvas" style={{ height }} />
      {status !== 'ready' && (
        <div className="map-fallback" style={{ height }}>
          {status === 'loading' ? (
            <div className="map-loading">
              <span className="spinner" />
              <span>底图加载中…</span>
            </div>
          ) : (
            <FallbackSketch
              box={fallbackBox}
              pickable={pickable}
              onPick={onPick}
              tip={tip}
            />
          )}
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
  lngMin: number
  lngMax: number
  latMin: number
  latMax: number
  items: { x: number; y: number; kind: string; name: string }[]
  path: string
}

function project(points: TrackPoint[], hotels: Hotel[], sights: Sight[]): Projected {
  const all = [
    ...points.map((p) => ({ lng: p.lng, lat: p.lat, kind: p.kind, name: p.name })),
    ...hotels.map((h) => ({ lng: h.lng, lat: h.lat, kind: 'hotel' as const, name: h.name })),
    ...sights.map((s) => ({ lng: s.lng, lat: s.lat, kind: 'sight' as const, name: s.name })),
  ].filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat))

  if (all.length === 0) {
    return { lngMin: 0, lngMax: 1, latMin: 0, latMax: 1, items: [], path: '' }
  }
  const lngs = all.map((p) => p.lng)
  const lats = all.map((p) => p.lat)
  const lngMin = Math.min(...lngs)
  const lngMax = Math.max(...lngs)
  const latMin = Math.min(...lats)
  const latMax = Math.max(...lats)
  const spanLng = Math.max(lngMax - lngMin, 1e-6)
  const spanLat = Math.max(latMax - latMin, 1e-6)
  const pad = 46
  const kx = Math.cos(((latMin + latMax) / 2) * (Math.PI / 180))
  const toX = (lng: number) => pad + ((lng - lngMin) / spanLng) * (W - pad * 2) * 1
  const toY = (lat: number) => pad + (1 - (lat - latMin) / spanLat) * (H - pad * 2)
  void kx

  const items = all.map((p) => ({ x: toX(p.lng), y: toY(p.lat), kind: p.kind, name: p.name }))
  const line = points
    .filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat))
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.lng).toFixed(1)},${toY(p.lat).toFixed(1)}`)
    .join(' ')
  return { lngMin, lngMax, latMin, latMax, items, path: line }
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
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!pickable || !onPick || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    const y = ((e.clientY - rect.top) / rect.height) * H
    const pad = 46
    const lng = box.lngMin + ((x - pad) / (W - pad * 2)) * (box.lngMax - box.lngMin)
    const lat = box.latMin + (1 - (y - pad) / (H - pad * 2)) * (box.latMax - box.latMin)
    onPick({ lng: Number(lng.toFixed(6)), lat: Number(lat.toFixed(6)) })
  }

  const colorOf = (kind: string) =>
    kind === 'start' ? COLORS.start : kind === 'end' ? COLORS.end : kind === 'hotel' ? COLORS.hotel : kind === 'sight' ? COLORS.sight : COLORS.via

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
        {box.path && <path d={box.path} fill="none" stroke="#2f7d4f" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />}
        {box.items.map((it, i) => (
          <g key={i}>
            <circle cx={it.x} cy={it.y} r={it.kind === 'via' ? 6 : 10} fill={colorOf(it.kind)} stroke="#fff" strokeWidth="2" />
            <text x={it.x} y={it.y - 16} fontSize="13" textAnchor="middle" fill="#475569">
              {it.name}
            </text>
          </g>
        ))}
        {box.items.length === 0 && (
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
