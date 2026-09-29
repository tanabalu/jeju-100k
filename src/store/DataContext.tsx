import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AlbumItem, AppSettings, ElevSample, ImageRef, Plan, Route, TrackPoint } from '../types'
import { store, LEGACY_SEED_IDS, SEED_VERSION, type ChecklistState } from '../lib/storage'
import { PREP_GROUPS, PREP_PRESETS, normItemText } from '../lib/prep'
import { buildSeedRoutes, nearestEle } from '../lib/seed'
import { uid } from '../lib/id'

export interface PhotoEntry {
  /** 相对站点根目录的原图路径，如 photos/olle-01.jpg */
  file: string
  caption: string
  credit: string
  source?: string
  /**
   * 卡片封面专用的压缩版（可选）；缺省时封面回落到 file。
   * 列表里的封面只渲染到 ~300–400px 宽，用原图纯属浪费流量。
   */
  cover?: string
}

export type PhotoManifest = Record<string, PhotoEntry>

/** public/tracks.json 的一条：真实轨迹（scripts/import_tracks.py 从 GPX/KML/GeoJSON 导入） */
export interface TrackEntry {
  /** 轨迹点 [lng, lat, ele]；该轨迹没录海拔时 ele 为 null */
  points: [number, number, number | null][]
  /**
   * 有断口时的**分段**几何（`points` 是各段顺序拼起来的一整串）。
   * 段之间是数据真空，画线不能连线，里程/爬升也得逐段算。
   */
  segments?: [number, number, number | null][][]
  basis: 'track'
  /** 轨迹实测里程（km） */
  km?: number
  gainM?: number | null
  /** 轨迹文件原名，便于回溯 */
  source?: string
  sourceUrl?: string
  sourceNote?: string
}

export type TrackManifest = Record<string, TrackEntry>

/** 相对路径补成站点可用 URL；http 开头原样返回（base 为相对路径，子路径部署也能用） */
function resolveAsset(file: string): ImageRef {
  const base = import.meta.env.BASE_URL || './'
  return { kind: 'url', value: file.startsWith('http') ? file : `${base}${file}` }
}

/**
 * 叠加随包分发的素材到路线上（不落库，manifest 变了刷新即生效）。
 *
 * 两个来源，各司其职：
 * - `public/photos/manifest.json` 该路线一带的**风景照**（scripts/fetch_photos.py 从 Wikimedia Commons 抓）
 *     → `cover`（压缩版 760px，约 25KB）作卡片封面；`file`（原图 1600px）进相册
 * - `public/photos/maps.json`   官方路线图（scripts/split_route_map.py 切 PDF 产出）
 *     → 同样出 cover/file 两份，但**只进相册**，卡片上让位给风景照
 *
 * 封面优先级：**用户在后台设的 cover > 风景照 > 官方路线图**。
 * 官方图是照着走的示意图，缩到卡片尺寸只剩一片灰白；风景照一眼能认出这条线，
 * 而路线图仍保留在详情页相册里，点开看全尺寸。
 *
 * 相册顺序：风景照 → 官方路线图 → 用户自己上传的。
 */
function mergeAssets(route: Route, photos: PhotoManifest, maps: PhotoManifest): Route {
  const code = route.code
  if (!code) return route
  const mapEntry = maps[code]
  const photoEntry = photos[code]
  if (!mapEntry && !photoEntry) return route

  // 相册/灯箱用原图，卡片封面用压缩版
  const mapImage = mapEntry ? resolveAsset(mapEntry.file) : undefined
  const mapCover = mapEntry ? resolveAsset(mapEntry.cover ?? mapEntry.file) : undefined
  const photoImage = photoEntry ? resolveAsset(photoEntry.file) : undefined
  const photoCover = photoEntry ? resolveAsset(photoEntry.cover ?? photoEntry.file) : undefined
  const inAlbum = (image?: ImageRef) =>
    !!image && route.album.some((a) => a.image.kind === image.kind && a.image.value === image.value)

  const prepend: AlbumItem[] = []
  if (photoImage && !inAlbum(photoImage)) {
    // 署名写进 caption：相册与灯箱都会显示，满足 CC-BY 的署名要求
    prepend.push({
      id: `photo_${code}`,
      image: photoImage,
      caption: [photoEntry.caption, photoEntry.credit].filter(Boolean).join(' · '),
    })
  }
  if (mapImage && !inAlbum(mapImage)) {
    prepend.push({ id: `map_${code}`, image: mapImage, caption: `${mapEntry.caption} · ${mapEntry.credit}` })
  }

  return {
    ...route,
    cover: route.cover ?? photoCover ?? mapCover,
    album: [...prepend, ...route.album],
  }
}

/** 两个坐标是否视为同一点（预置值的比较用，1e-9 度 ≈ 0.1 mm，足够区分有没有被手改过） */
const SAME_POINT_EPS = 1e-9

/** 途经点是否仍是最初预置的那几个点（= 用户没在后台动过坐标） */
function isUntouchedSeed(route: Route, seedPts: Map<string, { lng: number; lat: number }[]>): boolean {
  const seed = seedPts.get(route.id)
  const cur = route.points ?? []
  if (!seed || cur.length !== seed.length) return false
  return cur.every(
    (p, i) => Math.abs(p.lng - seed[i].lng) < SAME_POINT_EPS && Math.abs(p.lat - seed[i].lat) < SAME_POINT_EPS,
  )
}

/**
 * 把起点/终点吸附到真实轨迹的首末点。
 *
 * 预置坐标是「城镇级近似值」，实测偏差可达 10~13 km（Route 1 的起终点就是这样），
 * 所以只换折线不换途经点的话，起点/终点标记还会留在错的位置上。
 * 轨迹首末点就是这条线真实的起终点，直接用它。
 *
 * ⚠️ 例外：route.startPoint / route.endPoint 设置了官方权威坐标时，优先钉到官方命名地点
 *   （06 起点现在与 05 真实轨迹终点一致；07 为旧 GPX 与官方地图数字化补线）。07-1 的官方终点锚点离现有路线末点约 1.3km，
 *   因此保留其轨迹端点作为地图标记，避免标记脱离用户确认正确的线路。
 *   折线仍走真实轨迹，只把起终点标记挪回官方位置。
 *
 * ⚠️ 只在途经点「仍是预置值」时吸附 —— 你在后台手动校正过的坐标不会被覆盖。
 */
function snapRouteEnds(
  route: Route,
  track: [number, number, number | null][],
  seedPts: Map<string, { lng: number; lat: number }[]>,
): TrackPoint[] {
  const pts = route.points ?? []
  if (pts.length < 2 || !isUntouchedSeed(route, seedPts)) return pts
  const first = track[0]
  const last = track[track.length - 1]
  const eleOf = (p: [number, number, number | null]) => (typeof p[2] === 'number' ? p[2] : undefined)
  // 官方权威起/终点优先：06 / 07 的轨迹首末点可能偏离官方 trailhead，
  // 钉到官方命名地点才能让标记落到正确位置，折线仍走真实轨迹。
  const sAnchor = route.startPoint
  const eAnchor = route.endPoint
  return pts.map((p, i) => {
    if (i === 0 && sAnchor)
      return { ...p, lng: sAnchor.lng, lat: sAnchor.lat, ele: sAnchor.ele ?? eleOf(first) ?? p.ele }
    if (i === pts.length - 1 && eAnchor)
      return { ...p, lng: eAnchor.lng, lat: eAnchor.lat, ele: eAnchor.ele ?? eleOf(last) ?? p.ele }
    if (i === 0) return { ...p, lng: first[0], lat: first[1], ele: eleOf(first) ?? p.ele }
    if (i === pts.length - 1) return { ...p, lng: last[0], lat: last[1], ele: eleOf(last) ?? p.ele }
    return p
  })
}

/**
 * 叠加真实轨迹（不落库，改 `public/tracks.json` 刷新即生效）。
 *
 * 轨迹一到位，这条线的「位置 / 形状 / 里程 / 爬升」就全部改用真实数据：
 * - `elevationProfile` 换成轨迹点 —— 它本来就是「密采样序列」，剖面图与爬升都从它来；
 * - `elevationBasis` 置为 `'track'`，界面据此改口径文案（不再说「估算」）；
 * - 起点/终点吸附到轨迹首末点（见 `snapRouteEnds`）。
 * 没录海拔的轨迹：剖面会显示「暂缺海拔数据」，而不是拿旧的错线剖面冒充。
 */
function mergeTrack(
  route: Route,
  tracks: TrackManifest,
  seedPts: Map<string, { lng: number; lat: number }[]>,
): Route {
  const entry = route.code ? tracks[route.code] : undefined
  const raw = entry?.points
  if (!Array.isArray(raw)) return route
  const clean = raw.filter(
    (p): p is [number, number, number | null] =>
      Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
  )
  if (clean.length < 2) return route

  const sample = (p: [number, number, number | null]): ElevSample =>
    typeof p[2] === 'number' ? [p[0], p[1], p[2]] : [p[0], p[1]]
  const samples: ElevSample[] = clean.map(sample)

  // 有断口的轨迹（OSM 只画了一部分、GPX 中途暂停）：段数 > 1 才带 `elevationSegments`。
  // ⚠️ 单段时**不要**写这个字段 —— `trackLines` 已经能退回用 elevationProfile，
  //    多一个字段只会让「有没有断口」这件事变得不好判断。
  const rawSegs = entry?.segments
  const segs: ElevSample[][] = Array.isArray(rawSegs)
    ? rawSegs
        .map((s) => (Array.isArray(s) ? s.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : []))
        .map((s) => s.map(sample))
        .filter((s) => s.length >= 2)
    : []

  // Track data is authoritative: strip any old locally cached segments before applying the
  // current manifest, otherwise a newly continuous route can still render as split.
  const { elevationSegments: _oldSegments, ...routeWithoutOldSegments } = route
  return {
    ...routeWithoutOldSegments,
    points: snapRouteEnds(route, clean, seedPts),
    elevationProfile: samples,
    ...(segs.length > 1 ? { elevationSegments: segs } : {}),
    elevationBasis: 'track',
    ...(entry?.sourceUrl && entry.sourceNote
      ? { trackSource: { name: entry.sourceNote, url: entry.sourceUrl } }
      : {}),
  }
}

interface DataApi {
  loading: boolean
  routes: Route[]
  plans: Plan[]
  settings: AppSettings
  upsertRoute: (route: Route) => void
  removeRoute: (id: string) => void
  getRoute: (id: string) => Route | undefined
  setPlans: (plans: Plan[]) => void
  upsertPlan: (plan: Plan) => void
  removePlan: (id: string) => void
  createPlan: (name?: string, targetKm?: number) => Plan
  updateSettings: (patch: Partial<AppSettings>) => void
  reload: () => void
  /** 本机存的是旧版默认素材时给出提示 */
  staleSeed: boolean
  /** 把默认素材更新为官方偶来小路（保留自建路线，只补官方条目与地形数据） */
  refreshSeedRoutes: () => { added: number; removed: number; updated: number }
  /** public/photos/manifest.json 里的配图表 */
  photoManifest: PhotoManifest
  /** 行前 checklist 的勾选状态与自定义条目 */
  checklist: ChecklistState
  toggleCheck: (id: string) => void
  /** 手动放弃 / 恢复某项：放弃后不计入进度，也不显示成待办 */
  toggleSkip: (id: string) => void
  resetChecklist: () => void
  addCustomItem: (text: string) => void
  removeCustomItem: (id: string) => void
  /**
   * 从「女士/男士常用清单」把备选条目加进总清单。
   * `ids` 省略 = 整份加入；已在清单里的（同 id 或同文案）会被跳过，不会重复加。
   */
  addPresetItems: (presetId: string, ids?: string[]) => void
  /** 把某份备选清单已加入的条目整批移出总清单 */
  removePresetItems: (presetId: string) => void
  /** 把单条备选条目移出总清单（加入的反操作） */
  removeExtraItem: (id: string) => void
}

const DataContext = createContext<DataApi | null>(null)

export function useData(): DataApi {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData 必须在 DataProvider 内使用')
  return ctx
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [rawRoutes, setRawRoutes] = useState<Route[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [settings, setSettings] = useState<AppSettings>({ mapStyle: 'standard' })
  const [staleSeed, setStaleSeed] = useState(false)
  const [photoManifest, setPhotoManifest] = useState<PhotoManifest>({})
  const [routeMaps, setRouteMaps] = useState<PhotoManifest>({})
  const [trackManifest, setTrackManifest] = useState<TrackManifest>({})
  /** 预置途经点坐标，用于判断某条路线有没有被手动改过（决定要不要吸附到轨迹） */
  const seedPts = useMemo(
    () =>
      new Map(
        buildSeedRoutes().map((r) => [r.id, r.points.map((p) => ({ lng: p.lng, lat: p.lat }))] as const),
      ),
    [],
  )
  const [checklist, setChecklist] = useState<ChecklistState>({
    checked: [],
    skipped: [],
    custom: [],
    extras: [],
  })
  const [fatalError, setFatalError] = useState<Error | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    // 放在下一帧，让骨架屏有机会渲染，避免首屏空白
    requestAnimationFrame(() => {
      try {
        let r = store.getRoutes()
        if (r.length === 0) {
          r = buildSeedRoutes()
          store.setRoutes(r)
          store.setSeedVersion(SEED_VERSION)
        } else if (store.getSeedVersion() < SEED_VERSION) {
          // 06 / 07 / 07-1 / 14-1 的历史端点曾被错误保存到浏览器 localStorage；
          // 仅修复仍保持默认两点名称的官方路线，用户手工编辑过的点位不动。
          const seeds = new Map(buildSeedRoutes().map((route) => [route.id, route]))
          let changed = false
          r = r.map((route) => {
            if (route.code !== '06' && route.code !== '07' && route.code !== '07-1' && route.code !== '14-1') return route
            const seed = seeds.get(route.id)
            const points = route.points ?? []
            const seedPoints = seed?.points ?? []
            const isDefaultPair =
              points.length === 2 &&
              seedPoints.length === 2 &&
              points.every((point, index) => point.name === seedPoints[index].name)
            if (!isDefaultPair) return route
            changed = true
            const corrected = {
              ...route,
              points: points.map((point, index) => ({
                ...point,
                lng: seedPoints[index].lng,
                lat: seedPoints[index].lat,
              })),
            }
            // 14-1 改为以真实 GPX 首末点为准，清掉旧版错误的近似地点锚点。
            if (route.code === '14-1') {
              const { startPoint: _startPoint, endPoint: _endPoint, ...withoutAnchors } = corrected
              return withoutAnchors
            }
            return corrected
          })
          if (changed) store.setRoutes(r)
          store.setSeedVersion(SEED_VERSION)
        }
        const hasLegacy = r.some((x) => LEGACY_SEED_IDS.includes(x.id))
        setStaleSeed(hasLegacy || store.getSeedVersion() < SEED_VERSION)
        setRawRoutes(r)
        setPlans(store.getPlans())
        setSettings(store.getSettings())
        setChecklist(store.getChecklist())
      } catch (err) {
        // rAF 回调里的异常不会冒泡到 React（则骨架屏会一直转，看着像卡死），
        // 这里转成渲染期抛错交给 ErrorBoundary，让用户看到错误页而不是假死。
        setFatalError(err instanceof Error ? err : new Error(String(err)))
        return
      }
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // 随包分发的素材与轨迹清单：官方路线图（maps.json）+ 自由授权照片（manifest.json）
  // + 真实轨迹（tracks.json）。缺文件就静默跳过，站点照常跑
  // （卡片退化成「暂无配图」占位，路线退回预置的近似坐标）
  useEffect(() => {
    const base = import.meta.env.BASE_URL || './'
    const load = <T,>(file: string) =>
      fetch(`${base}${file}`)
        .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
        .catch(() => null)
    let alive = true
    Promise.all([
      load<PhotoManifest>('photos/maps.json'),
      load<PhotoManifest>('photos/manifest.json'),
      load<TrackManifest>('tracks.json'),
    ]).then(([maps, photos, tracks]) => {
      if (!alive) return
      if (maps) setRouteMaps(maps)
      if (photos) setPhotoManifest(photos)
      if (tracks) setTrackManifest(tracks)
    })
    return () => {
      alive = false
    }
  }, [])

  const routes = useMemo(() => {
    const hasAssets = Object.keys(photoManifest).length > 0 || Object.keys(routeMaps).length > 0
    const hasTracks = Object.keys(trackManifest).length > 0
    if (!hasAssets && !hasTracks) return rawRoutes
    return rawRoutes.map((r) => {
      const withAssets = hasAssets ? mergeAssets(r, photoManifest, routeMaps) : r
      return hasTracks ? mergeTrack(withAssets, trackManifest, seedPts) : withAssets
    })
  }, [rawRoutes, photoManifest, routeMaps, trackManifest, seedPts])

  const upsertRoute = useCallback((route: Route) => {
    setRawRoutes((prev) => {
      const next = prev.some((r) => r.id === route.id)
        ? prev.map((r) => (r.id === route.id ? { ...route, updatedAt: Date.now() } : r))
        : [...prev, { ...route, updatedAt: Date.now() }]
      store.setRoutes(next)
      return next
    })
  }, [])

  const removeRoute = useCallback((id: string) => {
    setRawRoutes((prev) => {
      const next = prev.filter((r) => r.id !== id)
      store.setRoutes(next)
      return next
    })
  }, [])

  const upsertPlan = useCallback((plan: Plan) => {
    setPlans((prev) => {
      const next = prev.some((p) => p.id === plan.id)
        ? prev.map((p) => (p.id === plan.id ? { ...plan, updatedAt: Date.now() } : p))
        : [...prev, { ...plan, updatedAt: Date.now() }]
      store.setPlans(next)
      return next
    })
  }, [])

  const removePlan = useCallback((id: string) => {
    setPlans((prev) => {
      const next = prev.filter((p) => p.id !== id)
      store.setPlans(next)
      return next
    })
  }, [])

  const createPlan = useCallback((name = '我的百公里行程', targetKm = 100) => {
    const now = Date.now()
    const plan: Plan = { id: uid('plan'), name, targetKm, items: [], createdAt: now, updatedAt: now }
    setPlans((prev) => {
      const next = [...prev, plan]
      store.setPlans(next)
      return next
    })
    store.setPlanDraftId(plan.id)
    return plan
  }, [])

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      store.setSettings(next)
      return next
    })
  }, [])

  const getRoute = useCallback((id: string) => routes.find((r) => r.id === id), [routes])

/**
 * 给已存在的官方条目补地形数据：只写 elevationProfile / elevationBasis / 途经点海拔，
 * 坐标、名称、住宿、看点、相册这些用户可能改过的字段一律不动。
 */
function backfillElevation(route: Route, seed: Route): Route {
  const samples = seed.elevationProfile
  if (!samples || samples.length < 2) return route
  const points = route.points.map((p) =>
    p.ele == null ? { ...p, ele: nearestEle(samples, p.lng, p.lat) } : p,
  )
  return {
    ...route,
    points,
    elevationProfile: route.elevationProfile ?? samples,
    elevationBasis: route.elevationBasis ?? seed.elevationBasis,
  }
}

/**
 * 更新默认素材：清掉上一版的示例路线，补进官方 27 条偶来小路，
 * 并给已有条目回填地形/爬升数据。用户自建路线不会被删。
 */
const refreshSeedRoutes = useCallback(() => {
  const current = store.getRoutes()
  const removed = current.filter((r) => LEGACY_SEED_IDS.includes(r.id)).length
  const kept = current.filter((r) => !LEGACY_SEED_IDS.includes(r.id))
  const seeds = buildSeedRoutes()
  const seedById = new Map(seeds.map((s) => [s.id, s]))
  const existingIds = new Set(kept.map((r) => r.id))

  // 已有的官方条目：回填地形数据；不在 seed 里的：原样保留
  const updated = kept.map((r) => {
    const seed = seedById.get(r.id)
    return seed ? backfillElevation(r, seed) : r
  })
  const fresh = seeds.filter((r) => !existingIds.has(r.id))
  const next = [...updated, ...fresh]
  store.setRoutes(next)
  store.setSeedVersion(SEED_VERSION)
  setRawRoutes(next)
  setStaleSeed(false)
  return { added: fresh.length, removed, updated: updated.length }
}, [])

  const toggleCheck = useCallback(
    (id: string) => {
      setChecklist((prev) => {
        const has = prev.checked.includes(id)
        const next: ChecklistState = {
          ...prev,
          // 勾上就等于「不放弃了」，两个状态互斥
          checked: has ? prev.checked.filter((x) => x !== id) : [...prev.checked, id],
          skipped: has ? prev.skipped : prev.skipped.filter((x) => x !== id),
        }
        store.setChecklist(next)
        return next
      })
    },
    [],
  )

  /** 手动放弃某项：既不算完成也不算待办，进度分母里直接去掉 */
  const toggleSkip = useCallback((id: string) => {
    setChecklist((prev) => {
      const has = prev.skipped.includes(id)
      const next: ChecklistState = {
        ...prev,
        skipped: has ? prev.skipped.filter((x) => x !== id) : [...prev.skipped, id],
        // 放弃时取消已勾选，避免「已完成又放弃」的歧义状态
        checked: has ? prev.checked : prev.checked.filter((x) => x !== id),
      }
      store.setChecklist(next)
      return next
    })
  }, [])

  const resetChecklist = useCallback(() => {
    // extras 也算「用户自己攒的内容」，一并清掉；否则重置后清单里会剩下半截备选条目
    const next: ChecklistState = { checked: [], skipped: [], custom: [], extras: [] }
    setChecklist(next)
    store.setChecklist(next)
  }, [])

  const addCustomItem = useCallback(
    (text: string) => {
      const t = text.trim()
      if (!t) return
      setChecklist((prev) => {
        const next: ChecklistState = { ...prev, custom: [...prev.custom, { id: uid('prep'), text: t }] }
        store.setChecklist(next)
        return next
      })
    },
    [],
  )

  const removeCustomItem = useCallback((id: string) => {
    setChecklist((prev) => {
      const next: ChecklistState = {
        ...prev,
        checked: prev.checked.filter((x) => x !== id),
        skipped: prev.skipped.filter((x) => x !== id),
        custom: prev.custom.filter((x) => x.id !== id),
      }
      store.setChecklist(next)
      return next
    })
  }, [])

  /**
   * 把备选清单的条目并进总清单。
   * ⚠️ 去重必须在 updater 里按 `prev` 算，不能拿渲染期的 checklist 判断 ——
   *    连点「加入」时渲染期的快照是旧的，会重复写入同一条。
   */
  const addPresetItems = useCallback((presetId: string, ids?: string[]) => {
    const preset = PREP_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const wanted = ids ? preset.items.filter((i) => ids.includes(i.id)) : preset.items
    if (wanted.length === 0) return
    setChecklist((prev) => {
      const haveId = new Set(prev.extras.map((e) => e.id))
      // 「文案相同」也算已经有了：官方分组里已带的、自己补充过的，都不再重复加一遍
      const haveText = new Set<string>()
      ;[...PREP_GROUPS.flatMap((g) => g.items), ...prev.custom, ...prev.extras].forEach((i) =>
        haveText.add(normItemText(i.text)),
      )
      const add = wanted
        .filter((i) => !haveId.has(i.id) && !haveText.has(normItemText(i.text)))
        .map((i) => ({ ...i, from: presetId }))
      if (add.length === 0) return prev
      const next: ChecklistState = { ...prev, extras: [...prev.extras, ...add] }
      store.setChecklist(next)
      return next
    })
  }, [])

  /** 移出总清单（单条 / 整份）。它同时清掉这条的勾选与放弃状态，避免留下孤儿 id。 */
  const dropExtras = useCallback((match: (e: { id: string; from: string }) => boolean) => {
    setChecklist((prev) => {
      const gone = prev.extras.filter(match).map((e) => e.id)
      if (gone.length === 0) return prev
      const dead = new Set(gone)
      const next: ChecklistState = {
        ...prev,
        checked: prev.checked.filter((x) => !dead.has(x)),
        skipped: prev.skipped.filter((x) => !dead.has(x)),
        extras: prev.extras.filter((e) => !dead.has(e.id)),
      }
      store.setChecklist(next)
      return next
    })
  }, [])

  const removeExtraItem = useCallback((id: string) => dropExtras((e) => e.id === id), [dropExtras])
  const removePresetItems = useCallback(
    (presetId: string) => dropExtras((e) => e.from === presetId),
    [dropExtras],
  )

  const value = useMemo<DataApi>(
    () => ({
      loading,
      routes,
      plans,
      settings,
      upsertRoute,
      removeRoute,
      getRoute,
      setPlans: (next: Plan[]) => {
        setPlans(next)
        store.setPlans(next)
      },
      upsertPlan,
      removePlan,
      createPlan,
      updateSettings,
      reload,
      staleSeed,
      refreshSeedRoutes,
      photoManifest,
      checklist,
      toggleCheck,
      toggleSkip,
      resetChecklist,
      addCustomItem,
      removeCustomItem,
      addPresetItems,
      removePresetItems,
      removeExtraItem,
    }),
    [
      loading,
      routes,
      plans,
      settings,
      staleSeed,
      photoManifest,
      checklist,
      upsertRoute,
      removeRoute,
      getRoute,
      upsertPlan,
      removePlan,
      createPlan,
      updateSettings,
      reload,
      refreshSeedRoutes,
      toggleCheck,
      toggleSkip,
      resetChecklist,
      addCustomItem,
      removeCustomItem,
      addPresetItems,
      removePresetItems,
      removeExtraItem,
    ],
  )

  // 数据加载在 rAF 里跑，抛错时冒泡不到 React（会一直停在骨架屏，看着像卡死）。
  // 这里在渲染期重新抛出，交给外层 ErrorBoundary 显示错误页。
  // 必须放在所有 hooks 之后 —— 提前 throw 会让下次渲染少调用 hooks，触发 hooks 顺序报错。
  if (fatalError) throw fatalError

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
