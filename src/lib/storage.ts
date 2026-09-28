import type { AlbumItem, AppSettings, Hotel, ImageRef, Plan, Route, Sight } from '../types'
import type { PrepItem } from './prep'
import { uid } from './id'

const K_ROUTES = 'trail100k.routes'
const K_PLANS = 'trail100k.plans'
const K_SETTINGS = 'trail100k.settings'
const K_PLAN_DRAFT = 'trail100k.planDraft'
const K_SEED_VERSION = 'trail100k.seedVersion'
const K_CHECKLIST = 'trail100k.checklist'

/** 行前 checklist：勾选项 id + 手动放弃的项 id + 自己补充的条目 */
export interface ChecklistState {
  checked: string[]
  /** 手动放弃：不算未完成、也不计入进度分母 */
  skipped: string[]
  custom: PrepItem[]
}

const EMPTY_CHECKLIST: ChecklistState = { checked: [], skipped: [], custom: [] }

/** 默认素材版本：内容变更时 +1，用于提示用户更新（2=27 条偶来小路；3=补上地形/爬升数据） */
export const SEED_VERSION = 3

/** 上一版（国内徒步 3 条）的示例路线 id，用于识别旧素材 */
export const LEGACY_SEED_IDS = ['route_wugong_demo', 'route_xihu_demo', 'route_shenzhen_demo']

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
      .filter((k) => k.startsWith('trail100k.'))
      .forEach((k) => localStorage.removeItem(k))
  } catch (err) {
    console.error('[storage] 清空失败', err)
  }
}

export const store = {
  getRoutes: () => read<Route[]>(K_ROUTES, []),
  setRoutes: (v: Route[]) => write(K_ROUTES, v),

  getPlans: () => read<Plan[]>(K_PLANS, []),
  setPlans: (v: Plan[]) => write(K_PLANS, v),

  getSettings: () => read<AppSettings>(K_SETTINGS, { mapStyle: 'light' }),
  setSettings: (v: AppSettings) => write(K_SETTINGS, v),

  /** 当前正在编辑的行程篮 id */
  getPlanDraftId: () => read<string>(K_PLAN_DRAFT, ''),
  setPlanDraftId: (v: string) => write(K_PLAN_DRAFT, v),

  getSeedVersion: () => read<number>(K_SEED_VERSION, 0),
  setSeedVersion: (v: number) => write(K_SEED_VERSION, v),

  // 兼容升级前存的数据（没有 skipped 字段），逐字段兜底，避免读到脏数据时整页崩
  getChecklist: (): ChecklistState => {
    const raw = read<Partial<ChecklistState> | null>(K_CHECKLIST, EMPTY_CHECKLIST)
    if (!raw || typeof raw !== 'object') return EMPTY_CHECKLIST
    return {
      checked: Array.isArray(raw.checked) ? raw.checked : [],
      skipped: Array.isArray(raw.skipped) ? raw.skipped : [],
      custom: Array.isArray(raw.custom) ? raw.custom : [],
    }
  },
  setChecklist: (v: ChecklistState) => write(K_CHECKLIST, v),
}

export function emptyRoute(partial: Partial<Route> = {}): Route {
  const now = Date.now()
  return {
    id: uid('route'),
    name: '未命名路线',
    region: '',
    summary: '',
    kind: 'hike',
    difficulty: 3,
    points: [],
    tags: [],
    hotels: [],
    sights: [],
    album: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
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

export type BackupFile = {
  version: 1
  exportedAt: number
  routes: Route[]
  plans: Plan[]
  settings?: AppSettings
}

export function exportBackup(): string {
  const data: BackupFile = {
    version: 1,
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
  const incoming = parsed.routes
  const incomingPlans = Array.isArray(parsed.plans) ? parsed.plans : []
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

/** 收集一条路线里用到的所有本地图片 key */
export function collectLocalImages(route: Route): Set<string> {
  const out = new Set<string>()
  const push = (ref?: ImageRef) => {
    if (ref && ref.kind === 'local') out.add(ref.value)
  }
  push(route.cover)
  route.sights.forEach((s: Sight) => s.images.forEach(push))
  route.album.forEach((a: AlbumItem) => push(a.image))
  return out
}
