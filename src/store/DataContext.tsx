import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AlbumItem, AppSettings, ImageRef, Plan, Route } from '../types'
import { store, LEGACY_SEED_IDS, SEED_VERSION, type ChecklistState } from '../lib/storage'
import { buildSeedRoutes, nearestEle } from '../lib/seed'
import { uid } from '../lib/id'

export interface PhotoEntry {
  /** 相对站点根目录的图片路径，如 photos/olle-01.jpg */
  file: string
  caption: string
  credit: string
  source?: string
}

export type PhotoManifest = Record<string, PhotoEntry>

/** 相对路径补成站点可用 URL；http 开头原样返回（base 为相对路径，子路径部署也能用） */
function resolveAsset(file: string): ImageRef {
  const base = import.meta.env.BASE_URL || './'
  return { kind: 'url', value: file.startsWith('http') ? file : `${base}${file}` }
}

/**
 * 叠加随包分发的素材到路线上（不落库，manifest 变了刷新即生效）。
 *
 * 两个来源，各司其职：
 * - `public/photos/maps.json`  官方路线图（scripts/split_route_map.py 切 PDF 产出）→ 作卡片封面，并进相册以便点开看全尺寸
 * - `public/photos/manifest.json` Wikimedia 自由授权照片 → 只进相册
 *
 * 封面优先级：**用户自己在后台设的 cover > 官方路线图 > 照片**（官方图比地点示意照更能说明「这条线怎么走」）。
 * 相册顺序：官方路线图 → 照片 → 用户自己上传的。
 */
function mergeAssets(route: Route, photos: PhotoManifest, maps: PhotoManifest): Route {
  const code = route.code
  if (!code) return route
  const mapEntry = maps[code]
  const photoEntry = photos[code]
  if (!mapEntry && !photoEntry) return route

  const mapImage = mapEntry ? resolveAsset(mapEntry.file) : undefined
  const photoImage = photoEntry ? resolveAsset(photoEntry.file) : undefined
  const inAlbum = (image?: ImageRef) =>
    !!image && route.album.some((a) => a.image.kind === image.kind && a.image.value === image.value)

  const prepend: AlbumItem[] = []
  if (mapImage && !inAlbum(mapImage)) {
    // 署名写进 caption：相册与灯箱都会显示，满足官方图的 © 标注要求
    prepend.push({ id: `map_${code}`, image: mapImage, caption: `${mapEntry.caption} · ${mapEntry.credit}` })
  }
  if (photoImage && !inAlbum(photoImage)) {
    prepend.push({ id: `photo_${code}`, image: photoImage, caption: photoEntry.caption })
  }

  return {
    ...route,
    cover: route.cover ?? mapImage ?? photoImage,
    album: [...prepend, ...route.album],
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
  const [checklist, setChecklist] = useState<ChecklistState>({ checked: [], skipped: [], custom: [] })
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

  // 随包分发的素材清单：官方路线图（maps.json）+ 自由授权照片（manifest.json）。
  // 缺文件就静默跳过，站点照常跑（卡片退化成「暂无配图」占位）
  useEffect(() => {
    const base = import.meta.env.BASE_URL || './'
    const load = (file: string) =>
      fetch(`${base}${file}`)
        .then((r) => (r.ok ? (r.json() as Promise<PhotoManifest>) : null))
        .catch(() => null)
    let alive = true
    Promise.all([load('photos/maps.json'), load('photos/manifest.json')]).then(([maps, photos]) => {
      if (!alive) return
      if (maps) setRouteMaps(maps)
      if (photos) setPhotoManifest(photos)
    })
    return () => {
      alive = false
    }
  }, [])

  const routes = useMemo(
    () =>
      Object.keys(photoManifest).length || Object.keys(routeMaps).length
        ? rawRoutes.map((r) => mergeAssets(r, photoManifest, routeMaps))
        : rawRoutes,
    [rawRoutes, photoManifest, routeMaps],
  )

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
    const next: ChecklistState = { checked: [], skipped: [], custom: [] }
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
    ],
  )

  // 数据加载在 rAF 里跑，抛错时冒泡不到 React（会一直停在骨架屏，看着像卡死）。
  // 这里在渲染期重新抛出，交给外层 ErrorBoundary 显示错误页。
  // 必须放在所有 hooks 之后 —— 提前 throw 会让下次渲染少调用 hooks，触发 hooks 顺序报错。
  if (fatalError) throw fatalError

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
