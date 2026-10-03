/**
 * 行程篮的「今晚住哪」推荐引擎（纯函数）。
 *
 * ## 为什么要分成两级
 * 项目里现在**没有任何预置住宿数据**（`Hotel` 类型、后台录入、详情页展示都就位了，
 * 但 29 条 seed 一律 `hotels: []`）。所以「自动匹配住宿」不能只做酒店级 —— 没数据可推。
 *
 * 于是做成两级：
 * - **L1 区域级（保底，任何时候都有）**：从 `tripPlans.ts` 每条路线既有的
 *   `stayReturn`（走完当天建议住的城镇）/ `stay`（建议前一晚住哪）推导「住哪个城镇 + 为什么」。
 * - **L2 酒店级（有数据才出现）**：从用户录入的 `Route.hotels` 里，按「离今晚终点」和
 *   「离明早起点」的加权距离排候选。**它叠加在 L1 之上，不覆盖 L1。**
 *
 * ## 纪律
 * 拿不到的一律返回空/降级，**不编造酒店名**。宁可显示「附近没有已录入的住宿」，
 * 也不能虚构一家看起来合理的民宿 —— 用户会照着找过去。
 */
import type { Hotel, PlanItem, Route } from '../types'
import { TRIP_PLANS, type TripPlan } from './tripPlans'
import { haversineKm } from './geo'
import type { DayPlan } from './dayPlan'
import { isIslandRoute, routeEnds, stayIdOfDay } from './dayPlan'
import { stayName } from './stayName'

/** 候选搜索半径（km）：超过这个距离的住宿不做候选，住过去等于白折腾 */
export const STAY_SEARCH_KM = 8

/** 挂在某条路线下的住宿（保留来源，方便跳回详情页看） */
export interface LinkedHotel {
  hotel: Hotel
  routeId: string
  routeName?: string
}

export interface StayCandidate {
  hotel: Hotel
  routeId: string
  /** 距今晚终点（当天最后一条的官方/实际终点）的直线距离 km */
  toEndKm: number
  /** 距明早起点的直线距离 km；没有下一天则为 null */
  toNextStartKm: number | null
  /** 排序分，越小越靠前 */
  score: number
  /** 是否在候选半径内（全量列表里用它标出「超出 8 km」的那批） */
  near: boolean
}

export type StaySource = 'locked' | 'island' | 'lastRoute' | 'fallback'

export interface StaySuggestion {
  /** 建议入住的区域文本（如 "성산（城山）"） */
  area: string
  /** 为什么推荐这里 —— 必须能让人判断要不要听 */
  reason: string
  /** 另一个可选区域及其取舍说明 */
  altArea?: string
  altReason?: string
  source: StaySource
  candidates: StayCandidate[]
  /**
   * 用户锁定的住宿。**不影响 area / reason** —— 那两项始终是系统推的区域建议，
   * 锁定的这家由界面在建议后面补「已定：XXX」，两者并存而不是互相顶替。
   */
  lockedHotel?: Hotel
}

/** 前夜候选：只按「离第一天出发点近」排序，没有第二个权重 */
export interface PrevStayCandidate {
  hotel: Hotel
  routeId: string
  /** 距第一天出发点（官方/实际起点）的直线距离 km */
  toStartKm: number
  score: number
  /** 是否在候选半径内（全量列表里用它标出「超出 8 km」的那批） */
  near: boolean
}

export type PrevStaySource = 'locked' | 'official' | 'fallback'

/** 「出发前一晚住哪」的建议 —— 独立于每天，不属于任何一天 */
export interface PrevStaySuggestion {
  area: string
  reason: string
  source: PrevStaySource
  candidates: PrevStayCandidate[]
  lockedHotel?: Hotel
}

interface EndGeo {
  lng: number
  lat: number
}

/** 取 TripPlan：路线编号优先，没有编号就用路线 id */
function tripPlanOf(route: Route): TripPlan | undefined {
  const key = (route.code ?? route.id ?? '').trim()
  return TRIP_PLANS[key]
}

/** 官方口径里「走完这条当天建议住哪」 */
function nightAreaOf(route: Route): string | undefined {
  return tripPlanOf(route)?.stayReturn?.trim() || undefined
}

/** 官方口径里「走这条的前一晚建议住哪」 */
function morningAreaOf(route: Route): string | undefined {
  return tripPlanOf(route)?.stay?.trim() || undefined
}

/**
 * 从区域文本里切出地名 token 用于比对。
 *
 * ⚠️ 字符集必须**同时**包含谚文和汉字：这些数据中韩混写
 * （"성산（城山）"、"표선（表善） 或城山"），只认谚文会把「两地都提到的中文地名」
 * 判成毫无关系 —— 明明官方口径是一致的，却给出一条假的取舍提示。
 */
const AREA_TOKEN_RE = /[가-힣A-Za-z一-鿿]{2,}/g

function areaTokens(text: string | undefined): string[] {
  if (!text) return []
  // 「或」是这批文案里的分隔符（"표선 或城山"），它本身也是中日韩区的汉字，
  // 直接算进 token 会把整个后半截吞成一个词 —— 先把它换成空格断开。
  return Array.from(text.replace(/或/g, ' ').matchAll(AREA_TOKEN_RE))
    .map((m) => m[0])
    .filter((t) => t !== '시내')
}

/** 两个区域建议是否兼容：有共同地名就算兼容 */
function areasCompatible(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  const ta = areaTokens(a)
  const tb = areaTokens(b)
  return ta.some((t) => tb.includes(t))
}

/**
 * 给某一天推荐住宿。
 *
 * @param day       当天的计算结果（`planDays` 出来的）
 * @param nextDay   下一天（存在时才做「明早出发」的交叉校验）
 * @param hotels    全部住宿候选（来自所有路线，去重后）
 * @param items     plan.items（用于读用户锁定的 stayId）
 *
 * **每一天都有自己的建议，最后一天也一样** —— 走完最后一段当晚还要落脚，
 * 多半第二天才飞机 / 船返程，把最后一晚漏掉等于把人丢在街上。
 *
 * 锁定了住宿**不改写区域建议**：`area` / `reason` 仍是官方口径推出来的那条，
 * 锁定的那家挂在 `lockedHotel` 上，界面在建议后面补一句「已定：XXX」。
 * 行程单是要照着走的，订了哪家用「已定」标注就够了 —— 把推荐区域换成酒店名，
 * 等于把「这一带为什么值得住」的判定依据一起抹掉。
 */
export function suggestStay(
  day: DayPlan,
  nextDay: DayPlan | undefined,
  hotels: LinkedHotel[],
  items: PlanItem[],
): StaySuggestion | null {
  if (!day.rows.length) return null

  const lastRoute = day.rows[day.rows.length - 1].route
  const nextFirstRoute = nextDay?.rows[0]?.route

  const lockedId = stayIdOfDay(items, day.day)
  const locked = lockedId ? hotels.find((h) => h.hotel.id === lockedId) : undefined
  const auto = autoStay(day, nextDay, hotels)

  if (!locked) return auto
  /* 有区域建议：保留它，锁定的那家另行标注 */
  if (auto) return { ...auto, lockedHotel: locked.hotel }
  /* 连区域都推不出来时，锁定的那家就是唯一能交代的「住哪」 */
  return {
    area: stayName(locked.hotel),
    reason: '你锁定了这家 —— 手动选择优先。',
    source: 'locked',
    lockedHotel: locked.hotel,
    candidates: rankCandidates(lastRoute, nextFirstRoute, hotels),
  }
}

/**
 * 系统给某一天推的住宿建议（不含用户锁定）。
 *
 * 优先级：离岛提示 → 当天最后一站的官方建议（并与「明早上哪出发」交叉校验）
 * → 按终点所在地降级。**拿不到就返回 null，不编造。**
 */
function autoStay(
  day: DayPlan,
  nextDay: DayPlan | undefined,
  hotels: LinkedHotel[],
): StaySuggestion | null {
  const rows = day.rows
  if (!rows.length) return null

  const lastRow = rows[rows.length - 1]
  const lastRoute = lastRow.route
  const nextFirstRoute = nextDay?.rows[0]?.route

  /* ---- 规则 2：离岛 → 提示船班风险，住宿地以官方口径为准 ---- */
  const islandRow = rows.find((r) => isIslandRoute(r.route))
  if (islandRow) {
    const area = nightAreaOf(islandRow.route) ?? areaFromRoute(islandRow.route) ?? '岛上'
    return {
      area,
      // ⚠️ 文案不能断言「优先住岛上」：官方口径里牛岛这类短程离岛本来就建议回城山住，
      //    只有真的错过末班船才需要在岛上过夜。这里只把风险说清楚，不断言住哪。
      reason: `「${islandRow.route.name}」在离岛，需要坐船进出 —— 首末班船时间务必提前确认，一旦错过当晚只能在岛上过夜。`,
      source: 'island',
      candidates: rankCandidates(islandRow.route, nextFirstRoute, hotels),
    }
  }

  /* ---- 规则 3：当天最后一站的官方建议（首选） ---- */
  const primaryArea = nightAreaOf(lastRoute)

  /* ---- 规则 4：与「明早上哪出发」交叉校验 ---- */
  const nextMorning = nextFirstRoute ? morningAreaOf(nextFirstRoute) : undefined
  if (primaryArea && nextMorning && !areasCompatible(primaryArea, nextMorning)) {
    return {
      area: shortArea(primaryArea),
      // 这一支是「今晚的建议」和「明早的建议」不完全对上的情况：
      // 只陈述事实（终点在哪、官方怎么建议），不断言「终点就在推荐区内」。
      reason: `走完当天官方建议住 ${shortArea(primaryArea)}（今天终点在${
        lastRoute.endPoint?.name ?? lastRoute.name
      }）。`,
      altArea: shortArea(nextMorning),
      altReason: `明天第一条「${nextFirstRoute!.name}」官方建议前一晚住 ${shortArea(nextMorning)} —— 离明早出发点近，但离今晚终点远一些。`,
      source: 'lastRoute',
      candidates: rankCandidates(lastRoute, nextFirstRoute, hotels, ),
    }
  }

  if (primaryArea) {
    const compatible = nextMorning && areasCompatible(primaryArea, nextMorning)
    return {
      area: shortArea(primaryArea),
      reason: compatible
        ? `官方口径一致：走完当天建议住 ${shortArea(primaryArea)}，明天第一条的官方建议前一晚也是这里。`
        : `走完当天建议住 ${shortArea(primaryArea)}（终点在${lastRoute.endPoint?.name ?? '附近'}）。`,
      source: 'lastRoute',
      candidates: rankCandidates(lastRoute, nextFirstRoute, hotels, ),
    }
  }

  /* ---- 规则 6（降级）：没有官方口径时，按今天的实际终点所在地给一个区域名 ---- */
  const fallback = areaFromRoute(lastRoute)
  if (fallback) {
    return {
      area: shortArea(fallback),
      reason: `这条路线没有官方住宿建议数据，按今天终点所在地推的：住 ${shortArea(fallback)} 就近落脚。`,
      source: 'fallback',
      candidates: rankCandidates(lastRoute, nextFirstRoute, hotels, ),
    }
  }
  return null
}

/**
 * 「出发前一晚住哪」。
 *
 * 为什么要单独做这一档：行程单上「前一晚」和「每晚」是两件事 ——
 * 前者要的是**离第一天出发点近**（第二天一早直接开走），依据 `tripPlans.stay`
 * 的官方口径；后者要的是**离当天终点近**，依据 `stayReturn`。两套权重不一样，
 * 混在一起算会给出互相打架的建议。
 *
 * 与每晚一致：锁定了住宿**不改写区域建议**，`area` / `reason` 仍是官方口径那条，
 * 锁定的那家挂在 `lockedHotel` 上由界面补「已定：XXX」。
 */
export function suggestPrevNight(
  firstDay: DayPlan | undefined,
  hotels: LinkedHotel[],
  prevStayId: string | undefined,
): PrevStaySuggestion | null {
  if (!firstDay?.rows.length) return null
  const firstRoute = firstDay.rows[0].route
  const candidates = rankByStart(firstRoute, hotels)

  const locked = prevStayId ? hotels.find((h) => h.hotel.id === prevStayId) : undefined
  const auto = autoPrevNight(firstDay, hotels)

  if (!locked) return auto
  /* 有区域建议：保留它，锁定的那家另行标注 */
  if (auto) return { ...auto, lockedHotel: locked.hotel }
  /* 连区域都推不出来时，锁定的那家就是唯一能交代的「住哪」 */
  return {
    area: stayName(locked.hotel),
    reason: '你锁定了这家 —— 手动选择优先。',
    source: 'locked',
    lockedHotel: locked.hotel,
    candidates,
  }
}

/**
 * 系统给的「出发前一晚住哪」（不含用户锁定）。
 *
 * 优先级：官方口径 → 按第一天起点所在地降级。**拿不到就返回 null，不编造。**
 */
function autoPrevNight(
  firstDay: DayPlan | undefined,
  hotels: LinkedHotel[],
): PrevStaySuggestion | null {
  if (!firstDay?.rows.length) return null
  const firstRoute = firstDay.rows[0].route
  const candidates = rankByStart(firstRoute, hotels)

  /* 规则 2：官方口径 —— 走这条之前那一晚建议住哪 */
  const area = morningAreaOf(firstRoute)
  if (area) {
    const startName = firstRoute.startPoint?.name ?? routeEnds(firstRoute).start?.name
    return {
      area: shortArea(area),
      reason: `第一天要从${startName ? ` ${startName} ` : ''}开走 —— 官方建议前一晚住 ${shortArea(
        area,
      )}，落地休整一晚，明早不用赶路。`,
      source: 'official',
      candidates,
    }
  }

  /* 规则 3（降级）：按第一天起点所在地给一个区域名 */
  const fallback = areaFromRoute(firstRoute)
  if (fallback) {
    return {
      area: shortArea(fallback),
      reason: `这条路线没有官方的前夜住宿建议，按第一天起点所在地推的：住 ${shortArea(
        fallback,
      )} 就近落脚。`,
      source: 'fallback',
      candidates,
    }
  }
  return null
}

/**
 * 按「离出发点」排序的前夜候选。
 *
 * @param maxKm 距离上限，默认候选半径（8 km）。传 Infinity 就是不截断的全量列表。
 */
function rankByStart(
  route: Route,
  hotels: LinkedHotel[],
  maxKm: number = STAY_SEARCH_KM,
): PrevStayCandidate[] {
  const start = endpointGeo(route, 'start')
  if (!start) return []
  const seen = new Set<string>()
  const out: PrevStayCandidate[] = []
  for (const { hotel, routeId } of hotels) {
    if (seen.has(hotel.id)) continue
    if (!Number.isFinite(hotel.lng) || !Number.isFinite(hotel.lat)) continue
    const toStartKm = haversineKm(start, { lng: hotel.lng, lat: hotel.lat })
    if (toStartKm > maxKm) continue
    seen.add(hotel.id)
    out.push({ hotel, routeId, toStartKm, score: toStartKm, near: toStartKm <= STAY_SEARCH_KM })
  }
  return out.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.05) return a.score - b.score
    const ra = a.hotel.rating ?? 0
    const rb = b.hotel.rating ?? 0
    if (rb !== ra) return rb - ra
    return priceFloor(a.hotel) - priceFloor(b.hotel)
  })
}

/**
 * 从官方口径里提取一个能拿来当**标题**的短地名。
 *
 * `tripPlans` 里的 `stay` / `stayReturn` 是给人读的一整句，例如：
 *
 *   "성산（城山） 或济州市 —— 起点 시흥리（始兴里） 属旧左邑，住城山最顺（次日可接 1-1 牛岛 / 2 号线）"
 *
 * 直接拿它当标题，界面上就会印出「建议住：성산（城山） 或济州市 —— 起点 시흥리…」，
 * 行程单同理。所以三步清洗：
 * ① 破折号之后全是解释，砍掉；
 * ② 全角括号里如果是一整句说明（含逗号/分号/空格），砍掉它以及后面的全部内容；
 * ③ 「或 / · / /」只是并列备选，取第一个。
 *
 * ⚠️ 单独的其他字段（起终点名）仍用原始 text —— 比对「两地是否兼容」需要全部 token。
 */
function shortArea(text: string): string {
  let s = text.trim()
  s = s.split('——')[0].split('—')[0]
  const explain = s.search(/（[^）]{0,40}(，|；|,|;|\s)[^）]*）/)
  if (explain > 0) s = s.slice(0, explain)
  const first = s.split(/\s*或\s*|\s*·\s*|\s*\/\s*/)[0].trim()
  return first || text.trim()
}

/** 兜底的区域名：取路线 region 的最后一段（"韩国 · 济州岛 · 西归浦" → "西归浦"） */
function areaFromRoute(route: Route): string | undefined {
  const seg = (route.region ?? '').split('·').map((s) => s.trim()).filter(Boolean)
  return seg.length ? seg[seg.length - 1] : undefined
}

/**
 * 候选排序：0.6 × 离今晚终点 + 0.4 × 离明早起点（km），越小越靠前。
 * 同一家住宿被挂在多条路线下时只会入选一次 —— 按 hotel.id 去重。
 *
 * @param maxKm 距离上限，默认候选半径（8 km）。传 Infinity 就是不截断的全量列表。
 */
function rankCandidates(
  lastRoute: Route,
  nextFirstRoute: Route | undefined,
  hotels: LinkedHotel[],
  maxKm: number = STAY_SEARCH_KM,
): StayCandidate[] {
  const end = endpointGeo(lastRoute, 'end')
  const nextStart = nextFirstRoute ? endpointGeo(nextFirstRoute, 'start') : undefined
  if (!end) return []
  const seen = new Set<string>()
  const out: StayCandidate[] = []
  for (const { hotel, routeId } of hotels) {
    if (seen.has(hotel.id)) continue
    if (!Number.isFinite(hotel.lng) || !Number.isFinite(hotel.lat)) continue
    const toEndKm = haversineKm(end, { lng: hotel.lng, lat: hotel.lat })
    if (toEndKm > maxKm) continue
    const toNextStartKm = nextStart
      ? haversineKm(nextStart, { lng: hotel.lng, lat: hotel.lat })
      : null
    const score = 0.6 * toEndKm + 0.4 * (toNextStartKm ?? toEndKm)
    seen.add(hotel.id)
    out.push({ hotel, routeId, toEndKm, toNextStartKm, score, near: toEndKm <= STAY_SEARCH_KM })
  }
  return out.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.05) return a.score - b.score
    // 分数接近时：评分高的排前，再看价格低的
    const ra = a.hotel.rating ?? 0
    const rb = b.hotel.rating ?? 0
    if (rb !== ra) return rb - ra
    return priceFloor(a.hotel) - priceFloor(b.hotel)
  })
}

/** 价格区间取下限用于排序（"80000-120000" / "₩8万" / "300-500" 都尽量兼容） */
function priceFloor(hotel: Hotel): number {
  const raw = (hotel.priceRange ?? '').replace(/[^\d.-]/g, '')
  const nums = raw.split('-').map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
  return nums.length ? Math.min(...nums) : Number.POSITIVE_INFINITY
}

function endpointGeo(route: Route, which: 'start' | 'end'): EndGeo | undefined {
  const p = which === 'end' ? routeEnds(route).end : routeEnds(route).start
const src =
    p ??
    (which === 'end'
      ? (route.points ?? []).slice(-1)[0]
      : (route.points ?? [])[0])
  if (!src || !Number.isFinite(src.lng) || !Number.isFinite(src.lat)) return undefined
  return { lng: src.lng, lat: src.lat }
}

/**
 * 「查看全部住宿」抽屉用的全量列表：**不做半径截断**，远近都列，远的排在后面。
 *
 * 排序权重与候选一致（0.6 × 今晚终点 + 0.4 × 明早起点），所以列表开头的顺序
 * 和卡片上那几条的口径是一致的 —— 抽屉只是把后面没露出来的部分补全。
 * 超出 8 km 的那批标 `near: false`，界面上单独隔开提示「较远」，但**不隐藏**：
 * 有车 / 愿意多走一段时，用户仍要能从这里选它。
 */
export function rankAllStays(
  lastRoute: Route,
  nextFirstRoute: Route | undefined,
  hotels: LinkedHotel[],
): StayCandidate[] {
  return rankCandidates(lastRoute, nextFirstRoute, hotels, Number.POSITIVE_INFINITY)
}

/**
 * 「查看全部住宿」抽屉用的前夜全量列表：**不做半径截断**，远的排在后面。
 *
 * 排序权重与候选一致（离第一天出发点越近越靠前），所以列表开头的顺序和卡片上
 * 那几条是一致的 —— 抽屉只是把 8 km 以外没露出来的部分补全，方便有车时挑远处的。
 */
export function rankAllByStart(firstRoute: Route, hotels: LinkedHotel[]): PrevStayCandidate[] {
  return rankByStart(firstRoute, hotels, Number.POSITIVE_INFINITY)
}

/** 把全部路线的住宿收集成候选池（去重靠 id 冲突时的先到先得） */
export function collectHotels(routes: Route[]): LinkedHotel[] {
  const out: LinkedHotel[] = []
  for (const r of routes) {
    for (const h of r.hotels ?? []) out.push({ hotel: h, routeId: r.id, routeName: r.name })
  }
  return out
}

