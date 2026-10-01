import type {
  AlbumItem,
  AppSettings,
  ElevSample,
  Hotel,
  ImageRef,
  Plan,
  PlanItem,
  Route,
  Sight,
  TrackPoint,
} from '../types'
import type { PrepItem } from './prep'
import { uid } from './id'

const K_ROUTES = 'jejuolle100k.routes'
const K_PLANS = 'jejuolle100k.plans'
const K_SETTINGS = 'jejuolle100k.settings'
const K_PLAN_DRAFT = 'jejuolle100k.planDraft'
const K_CHECKLIST = 'jejuolle100k.checklist'
const K_UI = 'jejuolle100k.ui'

/** 从备选清单（女士常用 / 男士常用 / 大疆 / 相机 / 无人机）加进总清单的条目 */
export interface ChecklistExtra extends PrepItem {
  /** 来自哪份备选清单（PREP_PRESETS.id）；数据源改了也能认出来源 */
  from: string
}

/** 行前 checklist：勾选项 id + 手动放弃的项 id + 自己补充的条目 + 从备选清单加入的条目 */
export interface ChecklistState {
  checked: string[]
  /** 手动放弃：不算未完成、也不计入进度分母 */
  skipped: string[]
  custom: PrepItem[]
  /** 从备选清单（女士常用 / 男士常用 / 大疆 / 相机 / 无人机）挑着加进来的条目 */
  extras: ChecklistExtra[]
}

const EMPTY_CHECKLIST: ChecklistState = { checked: [], skipped: [], custom: [], extras: [] }

/**
 * 界面上的筛选开关（只看未完成等）。
 *
 * 单独一个键，不塞进 settings / checklist：这两个都进备份文件（exportBackup / importBackup），
 * 而「筛选开关」是本机视图偏好 —— 导入别人的备份不该顺手把我的筛选状态改掉。
 */
export interface UiState {
  /** 行前清单：只看未完成 */
  prepOnlyTodo: boolean
  /** 行程篮：只看未完成（隐藏已走完的路线） */
  planHideDone: boolean
  /** 行前清单：被折叠的分组 id（PREP_GROUPS 的 id + custom / extras），默认全展开 */
  prepGroupsCollapsed: string[]
  /** 行前清单：被展开的备选卡片 id（PREP_PRESETS 的 id），默认全折叠 */
  prepPresetsOpen: string[]
  /** 行前清单：就地展开图文教程的条目 id，默认全部收起 */
  prepTutorialsOpen: string[]
}

const EMPTY_UI: UiState = {
  prepOnlyTodo: false,
  planHideDone: false,
  prepGroupsCollapsed: [],
  prepPresetsOpen: [],
  prepTutorialsOpen: [],
}

/** 逐字段兜底：布尔字段回落到 false、数组字段回落到 []，不让 undefined 漏进渲染 */
function normalizeUi(raw: Partial<UiState> | undefined | null): UiState {
  if (!raw || typeof raw !== 'object') return EMPTY_UI
  return {
    prepOnlyTodo: raw.prepOnlyTodo === true,
    planHideDone: raw.planHideDone === true,
    prepGroupsCollapsed: arr<string>(raw.prepGroupsCollapsed),
    prepPresetsOpen: arr<string>(raw.prepPresetsOpen),
    prepTutorialsOpen: arr<string>(raw.prepTutorialsOpen),
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function write<T>(key: string, value: T): void {
  // 配额超限时 setItem 会抛 QuotaExceededError，不该让整个应用崩掉
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    console.error('[storage] 写入失败', key, err)
  }
}

/** 清空本机全部应用数据（用于错误页的「清数据重载」，不可恢复） */
export function clearAllLocalData(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('jejuolle100k.'))
      .forEach((k) => localStorage.removeItem(k))
  } catch (err) {
    console.error('[storage] 清空失败', err)
  }
}

/** 只保留数组，其余（undefined / null / 对象）一律视为空数组 */
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

/**
 * 归一化一条路线：把可能缺失的数组字段补成 []。
 *
 * 数据的不可控入口是「导入备份」的 JSON（人手改过 / 别人给的），只要 `points` / `sights` /
 * `album` 里任意一个缺失，页面就会在 `.length` / `.map` 上直接白屏。所以在读取边界一次性补齐。
 */
export function normalizeRoute(route: Route): Route {
  return {
    ...route,
    tags: arr<string>(route.tags),
    points: arr<TrackPoint>(route.points),
    hotels: arr<Hotel>(route.hotels),
    sights: arr<Sight>(route.sights).map((s) => ({
      ...s,
      images: arr<ImageRef>(s?.images),
    })),
    album: arr<AlbumItem>(route.album),
    elevationProfile: arr<ElevSample>(route.elevationProfile),
    // 有断口的轨迹：分段几何。每段至少 2 个点，脏段直接丢
    ...(() => {
      const segs = (Array.isArray(route.elevationSegments) ? route.elevationSegments : [])
        .map((s) => arr<ElevSample>(s))
        .filter((s) => s.length >= 2)
      return segs.length ? { elevationSegments: segs } : {}
    })(),
  }
}

/**
 * 归一化一个行程篮：缺 items 时补空数组，避免「已加入」列表整页崩掉。
 * 天数 / 住宿锁定 / 出发日期等可选字段缺省就读成 undefined（= 未分天）。
 */
export function normalizePlan(plan: Plan): Plan {
  return { ...plan, items: arr<PlanItem>(plan.items) }
}

/** 归一化设置：底图样式走白名单，未知/已下线的旧值一律回落到 standard，避免瓦片配置取空导致地图空白 */
function normalizeSettings(raw: Partial<AppSettings> | undefined): AppSettings {
  return { mapStyle: raw?.mapStyle === 'terrain' ? 'terrain' : 'standard' }
}

export const store = {
  getRoutes: () => arr<Route>(read<Route[]>(K_ROUTES, [])).map(normalizeRoute),
  setRoutes: (v: Route[]) => write(K_ROUTES, v),

  getPlans: () => arr<Plan>(read<Plan[]>(K_PLANS, [])).map(normalizePlan),
  setPlans: (v: Plan[]) => write(K_PLANS, v),

  getSettings: () => normalizeSettings(read<Partial<AppSettings>>(K_SETTINGS, {})),
  setSettings: (v: AppSettings) => write(K_SETTINGS, normalizeSettings(v)),

  /** 当前正在编辑的行程篮 id */
  getPlanDraftId: () => read<string>(K_PLAN_DRAFT, ''),
  setPlanDraftId: (v: string) => write(K_PLAN_DRAFT, v),

  getChecklist: (): ChecklistState =>
    read<ChecklistState>(K_CHECKLIST, EMPTY_CHECKLIST),
  setChecklist: (v: ChecklistState) => write(K_CHECKLIST, v),

  getUi: () => normalizeUi(read<Partial<UiState> | null>(K_UI, EMPTY_UI)),
  setUi: (v: UiState) => write(K_UI, normalizeUi(v)),
}

export function emptyHotel(partial: Partial<Hotel> = {}): Hotel {
  return { id: uid('hotel'), name: '未命名住宿', lng: 0, lat: 0, ...partial }
}

export function emptySight(partial: Partial<Sight> = {}): Sight {
  return { id: uid('sight'), name: '未命名看点', lng: 0, lat: 0, type: 'view', images: [], ...partial }
}

export function emptyAlbumItem(partial: Partial<AlbumItem> = {}): AlbumItem {
  return { id: uid('album'), image: { kind: 'url', value: '' }, ...partial }
}

/**
 * 备份文件格式。version 是写入端的格式标记；导入时不识别 version、不做转换，
 * 缺失的可选字段交给 `normalizePlan` / `normalizeRoute` 兜底成可用状态。
 */
export type BackupFile = {
  version: 2
  exportedAt: number
  routes: Route[]
  plans: Plan[]
  settings?: AppSettings
}

export function exportBackup(): string {
  const data: BackupFile = {
    version: 2,
    exportedAt: Date.now(),
    routes: store.getRoutes(),
    plans: store.getPlans(),
    settings: store.getSettings(),
  }
  return JSON.stringify(data, null, 2)
}

export function importBackup(text: string, mode: 'merge' | 'replace'): { routes: number; plans: number } {
  const parsed = JSON.parse(text) as Partial<BackupFile>
  if (!parsed || !Array.isArray(parsed.routes)) throw new Error('文件格式不正确：缺少 routes 数组')
  // 导入的 JSON 是「人手改过 / 别人给的」最脏的一份数据，先归一化再落库
  const incoming = arr<Route>(parsed.routes).filter((r) => !!r && typeof r.id === 'string').map(normalizeRoute)
  const incomingPlans = arr<Plan>(parsed.plans).filter((p) => !!p && typeof p.id === 'string').map(normalizePlan)
  let routes: Route[]
  if (mode === 'replace') {
    routes = incoming
  } else {
    const current = store.getRoutes()
    const map = new Map(current.map((r) => [r.id, r]))
    for (const r of incoming) map.set(r.id, r)
    routes = Array.from(map.values())
  }
  store.setRoutes(routes)
  if (mode === 'replace') {
    store.setPlans(incomingPlans)
  } else {
    const current = store.getPlans()
    const map = new Map(current.map((p) => [p.id, p]))
    for (const p of incomingPlans) map.set(p.id, p)
    store.setPlans(Array.from(map.values()))
  }
  if (parsed.settings) store.setSettings(parsed.settings)
  return { routes: routes.length, plans: store.getPlans().length }
}

