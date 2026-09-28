import type { GeoPoint, Route, RouteMetrics, TrackPoint } from '../types'

const EARTH_RADIUS_KM = 6371.0088
const RAD = Math.PI / 180

/** 两点球面距离（km） */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLng = (b.lng - a.lng) * RAD
  const lat1 = a.lat * RAD
  const lat2 = b.lat * RAD
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 折线总长（km） */
export function pathLengthKm(points: GeoPoint[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) sum += haversineKm(points[i - 1], points[i])
  return sum
}

/** 每个点对应的累计里程（km），长度与 points 一致，首点为 0 */
export function cumulativeKm(points: GeoPoint[]): number[] {
  const out: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + haversineKm(points[i - 1], points[i]))
  }
  return out
}

/** 高程噪声阈值（米）：小于此值的起伏不计入，避免 SRTM/GPS 抖动把爬升虚高 */
export const ELEV_NOISE_M = 3

/**
 * 累计爬升 / 下降（m），带 3m 滞后阈值（与 scripts/fetch_elevation.py 口径一致）。
 * 有效高程点不足 2 个时返回 null —— 此时「没有数据」，不能当成 0，
 * 否则界面上会显示一个假的「爬升 0 m」。
 */
export function elevationProfile(points: GeoPoint[]): { gainM: number; lossM: number } | null {
  const eles = points
    .map((p) => p.ele)
    .filter((e): e is number => typeof e === 'number' && Number.isFinite(e))
  if (eles.length < 2) return null
  let gain = 0
  let loss = 0
  let ref = eles[0]
  for (let i = 1; i < eles.length; i++) {
    const d = eles[i] - ref
    if (d > ELEV_NOISE_M) {
      gain += d
      ref = eles[i]
    } else if (d < -ELEV_NOISE_M) {
      loss += -d
      ref = eles[i]
    }
  }
  return { gainM: Math.round(gain), lossM: Math.round(loss) }
}

/** 点到线段的球面距离（km）+ 投影比例 t（0-1） */
function distanceToSegmentKm(p: GeoPoint, a: GeoPoint, b: GeoPoint): { km: number; t: number } {
  // 在小范围内用平面近似，足够用于沿线里程标注
  const kx = Math.cos(((a.lat + b.lat) / 2) * RAD)
  const ax = (a.lng - p.lng) * kx
  const ay = a.lat - p.lat
  const bx = (b.lng - p.lng) * kx
  const by = b.lat - p.lat
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const px = ax + t * dx
  const py = ay + t * dy
  const km = Math.sqrt(px * px + py * py) * 111.32
  return { km, t }
}

/**
 * 把一个 POI（酒店/景点）投影到路线上，
 * 返回它所在的沿线里程与到路线的直线距离。
 */
export function projectToRoute(
  p: GeoPoint,
  points: TrackPoint[],
): { atKm: number; offRouteKm: number } {
  if (points.length === 0) return { atKm: 0, offRouteKm: 0 }
  if (points.length === 1) {
    return {
      atKm: 0,
      offRouteKm: haversineKm(points[0], p),
    }
  }
  const cum = cumulativeKm(points)
  let best = { km: Number.POSITIVE_INFINITY, t: 0, segIndex: 0 }
  for (let i = 1; i < points.length; i++) {
    const r = distanceToSegmentKm(p, points[i - 1], points[i])
    if (r.km < best.km) best = { km: r.km, t: r.t, segIndex: i }
  }
  const segLen = cum[best.segIndex] - cum[best.segIndex - 1]
  return {
    atKm: cum[best.segIndex - 1] + segLen * best.t,
    offRouteKm: best.km,
  }
}

/**
 * 绕行系数：轨迹点越稀疏、实际徒步路径越弯，
 * 直线里程越容易低估。给一个默认值，用户可用手填里程覆盖。
 */
export const DEFAULT_WINDING_FACTOR = 1.2

/** 计算一条路线的全部派生指标 */
export function computeMetrics(route: Route, windingFactor = DEFAULT_WINDING_FACTOR): RouteMetrics {
  const points = route.points ?? []
  const straightKm = pathLengthKm(points)
  const manual = route.manualDistanceKm
  const distanceKm = typeof manual === 'number' && manual > 0 ? manual : straightKm * windingFactor

  // 爬升优先用密的地形采样序列；没有才退回途经点上的海拔
  const samples = route.elevationProfile ?? []
  const src: GeoPoint[] =
    samples.length >= 2
      ? samples.map(([lng, lat, ele]) => ({ lng, lat, ele }))
      : points
  const prof = elevationProfile(src)

  const hasManual = typeof route.manualGainM === 'number' && route.manualGainM > 0
  const gainM = hasManual ? (route.manualGainM as number) : (prof?.gainM ?? null)
  const gainSource: RouteMetrics['gainSource'] = hasManual
    ? 'manual'
    : samples.length >= 2
      ? 'profile'
      : prof
        ? 'points'
        : 'none'

  const eles = src.map((p) => p.ele).filter((e): e is number => typeof e === 'number')
  return {
    straightKm,
    distanceKm,
    gainM,
    lossM: prof?.lossM ?? null,
    gainSource,
    elevationBasis: route.elevationBasis,
    highestM: eles.length ? Math.max(...eles) : undefined,
    lowestM: eles.length ? Math.min(...eles) : undefined,
    startPoint: points[0],
    endPoint: points[points.length - 1],
  }
}

/** 爬升展示：无数据时给「—」，别把「没采集」显示成 0 */
export function formatGain(m: number | null | undefined): string {
  return m == null || !Number.isFinite(m) ? '—' : `${Math.round(m)} m`
}

/** 把路线按里程切成 N 段用于剖面/进度展示 */
export function distanceLabels(points: TrackPoint[]): { km: number; name: string }[] {
  const cum = cumulativeKm(points)
  return points.map((p, i) => ({ km: cum[i], name: p.name }))
}

export function formatKm(km: number): string {
  if (!Number.isFinite(km)) return '—'
  return km >= 10 ? km.toFixed(1) : km.toFixed(2)
}
