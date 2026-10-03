import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AlbumItem, AppSettings, ElevSample, Hotel, ImageRef, Plan, PlanItem, Route } from '../types'
import { store, type ChecklistState, type UiState } from '../lib/storage'
import { PREP_GROUPS, PREP_PRESETS, normItemText } from '../lib/prep'
import { buildSeedRoutes } from '../lib/seed'
import { uid } from '../lib/id'
// 住宿唯一真源（OSM / TourAPI / Kakao / 人工核对合并产物），随包打包进 JS。
// 改完 src/data/stays.json 后需重新构建；不再运行时 fetch，避免数据在源码里存两份。
import staysData from '../data/stays.json'

/** src/data/stays.json 的一条城镇住宿池（OSM 爬取，字段对齐 Hotel） */
export interface StayTown {
  ko: string
  zh: string
  /** [lng, lat] */
  center: [number, number]
  radiusM: number
  count: number
  hotels: Hotel[]
}

/** src/data/stays.json 顶层结构：随包打包的住宿池（构建期固化，不落库、不运行时 fetch） */
export interface StaysManifest {
  version: number
  generatedAt: string
  source: string
  license: string
  note?: string
  towns: StayTown[]
  /** 路线 code -> 建议住宿城镇（ko 名），由官方住宿建议推导 */
  routeTowns: Record<string, string[]>
}

/**
 * 把「官方建议住这的城镇」的住宿池合并进路线（不落库，对齐 mergeAssets 范式）。
 * 严格按 routeTowns 映射收集；跨城镇去重按 hotel.id，避免同一家被挂多次。
 *
 * ## 对账而不是追加（2026-10-02 修）
 * 旧实现是「只把 bundle 里的新 id 追加进 route.hotels」，于是路线在 localStorage 里存的那份
 * 住宿副本（`seed.ts` 首次 seed 时写入并持久化）永远盖住打包真源：改了 `stays.json` 重新构建后，
 * 同 id 的旧副本不更新、bundle 已删的条目不消失，点「重新加载数据」只是把同一份旧副本再读一遍，
 * 只有「清空全部数据」触发重新 seed 才刷新。
 *
 * 新口径：bundle 始终为权威 —— 这条路线官方建议的城镇对应的住宿取**最新打包数据**；
 * 只保留「id 不在全局 bundle 里、纯属后台手填」的住宿（不随 bundle 刷新、也不会被误删）。
 * 这样 reload 即可反映最新 `stays.json`，又不会丢素材管理里手补的住宿。
 */
function mergeStays(
  route: Route,
  townsByKo: Record<string, Hotel[]>,
  routeTowns: Record<string, string[]>,
  bundleIds: Set<string>,
): Route {
  const codes = route.code ? routeTowns[route.code] : undefined
  // 这条路线官方建议住的城市对应的住宿（始终取最新打包数据，刷新即生效）
  const bundle: Hotel[] = []
  const seen = new Set<string>()
  for (const ko of codes ?? []) {
    for (const h of townsByKo[ko] ?? []) {
      if (h.id && !seen.has(h.id)) {
        seen.add(h.id)
        bundle.push(h)
      }
    }
  }
  // 后台手填：id 不在全局 bundle 里的才保留（bundle 删了的 / 改映射不再推荐的，都随 bundle 走）
  const manualOnly = route.hotels.filter((h) => h.id && !bundleIds.has(h.id))
  const next = [...bundle, ...manualOnly]
  // 内容（含顺序）与现有一致就不新建 route 对象，避免每次渲染都触发下游 memo 重算
  if (next.length === route.hotels.length && next.every((h, i) => h === route.hotels[i])) {
    return route
  }
  return { ...route, hotels: next }
}

export interface PhotoEntry {
  /** 相对站点根目录的原图路径，如 photos/olle-01.jpg */
  file: string
  caption: string
  credit: string
  source?: string
  /** 原图原始宽高（scripts/backfill_photo_dims.py 回填），用于相册 loading 卡片按比例预留高度 */
  width?: number
  height?: number
  /**
   * 卡片封面专用的压缩版（可选）；缺省时封面回落到 file。
   * 列表里的封面只渲染到 ~300–400px 宽，用原图纯属浪费流量。
   */
  cover?: string
  /**
   * 该路线「默认相册」的额外风景照（scripts/fetch_photos.py --gallery 抓取）。
   * 仅进相册（灯箱 / 详情页相册网格），**不**当作卡片封面。
   * 与 `file` 同源（Wikimedia Commons 自由授权），须带署名。
   */
  gallery?: GalleryPhoto[]
}

/** 默认相册里的一张额外风景照（与 PhotoEntry 同源，但无独立封面） */
export interface GalleryPhoto {
  /** 相对站点根目录的路径，如 photos/scenes/gallery/olle-01__2.webp */
  file: string
  caption?: string
  credit?: string
  source?: string
  /** 原图原始宽高（scripts/backfill_photo_dims.py 回填） */
  width?: number
  height?: number
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

/** 相对路径补成站点可用 URL；http 开头原样返回（base 为相对路径，子路径部署也能用）。
 * 若已知原图宽高，一并写进 ImageRef，供详情页相册的 loading 卡片按真实比例预留高度。 */
function resolveAsset(file: string, dims?: { width?: number; height?: number }): ImageRef {
  const base = import.meta.env.BASE_URL || './'
  const ref: ImageRef = { kind: 'url', value: file.startsWith('http') ? file : `${base}${file}` }
  if (dims?.width && dims?.height) {
    ref.width = dims.width
    ref.height = dims.height
  }
  return ref
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
  const mapImage = mapEntry ? resolveAsset(mapEntry.file, { width: mapEntry.width, height: mapEntry.height }) : undefined
  const mapCover = mapEntry ? resolveAsset(mapEntry.cover ?? mapEntry.file) : undefined
  const photoImage = photoEntry ? resolveAsset(photoEntry.file, { width: photoEntry.width, height: photoEntry.height }) : undefined
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
  // 默认相册的额外风景照：每张作为独立的系统相册项（id 带 _g<n>，仍属「系统」不可删）
  for (let i = 0; i < (photoEntry.gallery?.length ?? 0); i++) {
    const g = photoEntry.gallery![i]
    const gImage = resolveAsset(g.file, { width: g.width, height: g.height })
    if (!inAlbum(gImage)) {
      prepend.push({
        id: `photo_${code}_g${i}`,
        image: gImage,
        caption: [g.caption, g.credit].filter(Boolean).join(' · '),
      })
    }
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

/**
 * 叠加真实轨迹（不落库，改 `public/tracks.json` 刷新即生效）。
 *
 * 轨迹一到位，这条线的「位置 / 形状 / 里程 / 爬升」就全部改用真实数据：
 * - `elevationProfile` 换成轨迹点 —— 它本来就是「密采样序列」，剖面图与爬升都从它来；
 * - `elevationBasis` 置为 `'track'`，界面据此改口径文案（不再说「估算」）；
 * - 起点/终点用 `olle-endpoints.json` 固化的权威坐标（seed 时写入 `points`），此处不再二次处理；折线/海拔来自 `tracks.json`。
 * 没录海拔的轨迹：剖面会显示「暂缺海拔数据」，而不是拿旧的错线剖面冒充。
 */
function mergeTrack(
  route: Route,
  tracks: TrackManifest,
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
    points: route.points,
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
  /** items 允许建篮时就带上（见实现处的注释：一次写入，别分两步） */
  createPlan: (name?: string, targetKm?: number, items?: PlanItem[]) => Plan
  updateSettings: (patch: Partial<AppSettings>) => void
  /** 界面筛选开关（只看未完成等）：本机视图偏好，刷新后保持 */
  ui: UiState
  updateUi: (patch: Partial<UiState>) => void
  reload: () => void
  /** public/photos/manifest.json 里的配图表 */
  photoManifest: PhotoManifest
  /** public/photos/maps.json 里的官方路线图表 */
  routeMaps: PhotoManifest
  /** src/data/stays.json 里的住宿池（OSM 爬取，随包打包，构建期固化） */
  stays: StaysManifest
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
  const [ui, setUi] = useState<UiState>({
    prepOnlyTodo: false,
    planHideDone: false,
    planMapStayMode: 'all',
    prepGroupsCollapsed: [],
    prepPresetsOpen: [],
    prepTutorialsOpen: [],
  })
  const [photoManifest, setPhotoManifest] = useState<PhotoManifest>({})
  const [routeMaps, setRouteMaps] = useState<PhotoManifest>({})
  const [trackManifest, setTrackManifest] = useState<TrackManifest>({})
  // 住宿池直接取自打包进 JS 的唯一真源，无需运行时 fetch / 状态。
  const stays = staysData as unknown as StaysManifest
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
        }
        setRawRoutes(r)
        setPlans(store.getPlans())
        setSettings(store.getSettings())
        setChecklist(store.getChecklist())
        setUi(store.getUi())
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

  const townsByKo = useMemo(() => {
    const m: Record<string, Hotel[]> = {}
    for (const t of stays.towns) m[t.ko] = t.hotels
    return m
  }, [stays])

  /** 全局 bundle 住宿 id 集合（所有城镇并集）：用于 mergeStays 区分「打包真源」与「后台手填」 */
  const bundleIds = useMemo(() => {
    const s = new Set<string>()
    for (const t of stays.towns) for (const h of t.hotels) if (h.id) s.add(h.id)
    return s
  }, [stays])

  const routes = useMemo(() => {
    const hasAssets = Object.keys(photoManifest).length > 0 || Object.keys(routeMaps).length > 0
    const hasTracks = Object.keys(trackManifest).length > 0
    const hasStays = Object.keys(townsByKo).length > 0
    if (!hasAssets && !hasTracks && !hasStays) return rawRoutes
    return rawRoutes.map((r) => {
      const withAssets = hasAssets ? mergeAssets(r, photoManifest, routeMaps) : r
      const withStays = hasStays
        ? mergeStays(withAssets, townsByKo, stays.routeTowns, bundleIds)
        : withAssets
      return hasTracks ? mergeTrack(withStays, trackManifest) : withStays
    })
  }, [rawRoutes, photoManifest, routeMaps, trackManifest, stays, townsByKo, bundleIds])

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

  /**
   * 新建行程篮。
   *
   * `items` 允许在建篮时就带上：路线详情页点「加入行程篮」时如果还没有任何行程篮，
   * 必须**一次写入**就把这条路线放进去 —— 先建空篮再补第二步 update 是两次
   * `setPlans`，中间任何一次重排/覆盖都会让「篮建出来了、路线没进去」，
   * 表现就是按钮显示「已加入」但行程篮里空空如也。
   */
  const createPlan = useCallback(
    (name = '我的百公里行程', targetKm = 100, items: PlanItem[] = []) => {
      const now = Date.now()
      const plan: Plan = { id: uid('plan'), name, targetKm, items, createdAt: now, updatedAt: now }
      setPlans((prev) => {
        const next = [...prev, plan]
        store.setPlans(next)
        return next
      })
      store.setPlanDraftId(plan.id)
      return plan
    },
    [],
  )

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      store.setSettings(next)
      return next
    })
  }, [])

  const updateUi = useCallback((patch: Partial<UiState>) => {
    setUi((prev) => {
      const next = { ...prev, ...patch }
      store.setUi(next)
      return next
    })
  }, [])

  const getRoute = useCallback((id: string) => routes.find((r) => r.id === id), [routes])

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
      const goneIds = new Set(gone)
      const next: ChecklistState = {
        ...prev,
        checked: prev.checked.filter((x) => !goneIds.has(x)),
        skipped: prev.skipped.filter((x) => !goneIds.has(x)),
        extras: prev.extras.filter((e) => !goneIds.has(e.id)),
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
      ui,
      updateUi,
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
      photoManifest,
      routeMaps,
      stays,
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
      ui,
      updateUi,
      photoManifest,
      routeMaps,
      stays,
      townsByKo,
      checklist,
      upsertRoute,
      removeRoute,
      getRoute,
      upsertPlan,
      removePlan,
      createPlan,
      updateSettings,
      reload,
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
