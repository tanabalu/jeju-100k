import type { ElevSample, Route, TrackPoint, TrackPointKind } from '../types'
import { uid } from './id'
import { OLLE_ELEVATION } from './olleeElevation'
import { OLLE_SURFACES } from './olleSurfaces'
import { ROUTE_WAYPOINTS, type WaypointDef } from './waypointsData'
import { DEFAULT_SIGHTS } from './sightsData'
import { SEED_STAYS } from './seedStays'
import olleEndpointsJson from '../data/olle-endpoints.json'

/**
 * 29 条线的**权威起终点**（钉死值，不再靠运行时推导）。
 *
 * ⚠️ 为什么不再用 `PLACES` 的坐标当起终点：那是「城镇/地点级近似坐标」，
 *    实测 23/27 偏差 >1km、最大 6.7km。起终点已在此文件钉死为权威值，seed 时直接写入
 *    `points` 与 `startPoint`/`endPoint`，运行时不再做任何吸附；即使 `tracks.json` 后续被校正，
 *    起终点标记也不会被带走。轨迹若真变了，`scripts/check_endpoints.py` 三向对账会报警提醒重固化。
 *
 * ⚠️ 为什么按「线」而不是按「地点」存：`daepyeong`（08 终点 vs 09 起点）差 180m、
 *    `hwasun`（09 终点 vs 10 起点）、`jeoji`（13/14 vs 14-1 支线）同样不一致 ——
 *    同一个地名在不同线路上的端点并不重合，按地点存坐标必然有损。
 *
 * - `source: 'official'` = jejuolle.org 官方 GPS（仅 06/07），钉死；
 * - `source: 'track'`    = 跟随 `public/tracks.json` 首末点，是已固化下来的快照值。
 *
 * 由 `scripts/build_endpoints_data.py` 生成；改完必跑 `scripts/check_endpoints.py` 三向对账。
 */
interface EndpointDef {
  key: string
  zh: string
  ko: string
  lng: number
  lat: number
  source: 'official' | 'track'
  ref?: string
}
const ROUTE_ENDPOINTS = olleEndpointsJson as Record<string, { start: EndpointDef; end: EndpointDef }>

/**
 * 济州偶来小路（Jeju Olle Trail）预置数据。
 *
 * 数据来源：
 *  - 路线编号、起终点、官方里程、官方难度：偶来小路官方网站 jejuolle.org
 *  - 海拔与累计爬升：scripts/fetch_elevation.py 抓取的 SRTM 30m 公开地形数据
 *
 * ⚠️ 坐标说明：下面 PLACES 里的经纬度是「城镇/地点级近似坐标」，仅用于让地图和剖面图
 *    有东西可画，**不是官方实测轨迹点**，实测偏差可达 10 km 以上。拿来做实际导航前，
 *    请在管理后台用地图选点校正，或跑 scripts/import_tracks.py 导入真实轨迹一键替换
 *    （见 store/DataContext.tsx 的 mergeTrack：地图画线、爬升、起终点都会改按轨迹走）。
 * ⚠️ 官方里程已填进 manualDistanceKm，因此里程以官方值为准，不会走直线估算。
 * ⚠️ 爬升是「沿起终点直线/环线圆周采样出来的地形估算」，不是官方实测爬升，
 *    真实路线沿海岸蜿蜒，实际爬升通常比这个数大。界面上会标注「估算」；
 *    导入真实轨迹后自动改按轨迹逐点累加，标注随之变为「取自真实轨迹」。
 */

type PlaceKey =
  | 'siheung'
  | 'gwangchigi'
  | 'onpyeong'
  | 'pyoseon'
  | 'namwon'
  | 'soesokkak'
  | 'olleCenter'
  | 'seogwipoTerminal'
  | 'wolpyeong'
  | 'daepyeong'
  | 'hwasun'
  | 'moseulpo'
  | 'mureung'
  | 'yongsu'
  | 'jeoji'
  | 'hallim'
  | 'gonae'
  | 'gwangnyeong'
  | 'kimmanduk'
  | 'jocheon'
  | 'gimnyeong'
  | 'hado'
  | 'jongdal'
  | 'udo'
  | 'gapado'
  | 'seogwang'
  | 'chuja'

const PLACES: Record<PlaceKey, { zh: string; ko: string; lng: number; lat: number }> = {
  siheung: { zh: '始兴', ko: '시흥', lng: 126.895977, lat: 33.477241 },
  gwangchigi: { zh: '广峙其', ko: '광치기', lng: 126.924201, lat: 33.452006 },
  onpyeong: { zh: '温坪', ko: '온평', lng: 126.904173, lat: 33.405194 },
  pyoseon: { zh: '表善', ko: '표선', lng: 126.84249, lat: 33.32553 },
  namwon: { zh: '南元', ko: '남원', lng: 126.719698, lat: 33.278124 },
  // 与 05 号线真实轨迹终点相同，作为 06 号线的准确起点。
  soesokkak: { zh: '牛沼河口', ko: '쇠소깍', lng: 126.622978, lat: 33.251662 },
// ⚠️ 除下面标注「官方 GPS」的两条外，其余是**城镇/地点级近似坐标**（偏差可达 10km）。
//    seogwipoTerminal 原先写 126.563,33.253（在市区里），与官方实测点差了约 5km，
//    会让 07 / 07-1 的近似连线短成一根 0.9km 的短棒 —— 已按 jejuolle.org 官方 GPS 校正。
//    ⚠️ 6/7/7-1 的起终点**不要**照抄网上流传的手绘路线图。2026-09-29 逐一核对 jejuolle.org：
//       06 = 쇠소깍 → 제주올레여행자센터 10.1km
//       07 = 제주올레여행자센터 → 서귀포버스터미널 12.9km
//       07-1 = 서귀포버스터미널 → 제주올레여행자센터 15.7km
//       网上那张「6=牛沼河口-独立岩(14km) / 7=独立岩-月坪(13.8km) / 7-1=世界杯竞技场-独立岩(15.1km)」
//       是 **2025-06 改线前**的旧口径。官网 코스 안내 挂过对应公告：
//       「제주올레 16코스 종점 루트 변경(2025-06-24)」「17코스 시작점 루트 변경(2025-06-24)」
//       「7코스 법환포구 구간 변경(2026-07-01)」。**判断口径有冲突时，一律以官网当前值为准。**
//    ⭐ 2026-09-29 再拿**官方 Olle App 的路线列表**逐条核过（用户截图，快照固化在
//       `scripts/data/olle-app-routes.json`）：本文件的**里程与起终点全部一致**。
//       ⭐ 2026-10-03 起按官方口径把 3 号线、15 号线拆成 A/B 两条走法（`03-A`/`03-B`、
//       `15-A`/`15-B`，编号与 App 完全对齐，共 29 条）：**A = 山线**（内陆/中山间、翻岳穿林），
//       **B = 海线**（海岸、基本无爬升）。两条起终点相同，是同一段路的二选一走法。
//       ⚠️ 爬升**不在这两份官方基准里**（App 只给海拔剖面小图、不给数字），
//       界面上的爬升一律来自轨迹点 + SRTM 30m 地形。
//       `python3 scripts/check_official_consistency.py` 可复现这层核对（先对 App，再对轨迹）。
  olleCenter: { zh: '偶来旅客中心', ko: '제주올레여행자센터', lng: 126.558717, lat: 33.247461 }, // 官方 GPS
  seogwipoTerminal: { zh: '西归浦巴士总站', ko: '서귀포버스터미널', lng: 126.508588, lat: 33.249104 }, // 官方 GPS
  wolpyeong: { zh: '月坪', ko: '월평', lng: 126.457121, lat: 33.243879 },
  daepyeong: { zh: '大坪', ko: '대평', lng: 126.361624, lat: 33.237279 },
  hwasun: { zh: '和顺', ko: '화순', lng: 126.335433, lat: 33.240096 },
  moseulpo: { zh: '摹瑟浦', ko: '모슬포', lng: 126.25279, lat: 33.21915 },
  mureung: { zh: '武陵', ko: '무릉', lng: 126.236735, lat: 33.274624 },
  yongsu: { zh: '龙水', ko: '용수', lng: 126.16674, lat: 33.32355 },
  jeoji: { zh: '楮旨', ko: '저지', lng: 126.25635, lat: 33.33292 },
  hallim: { zh: '翰林', ko: '한림', lng: 126.26238, lat: 33.41864 },
  gonae: { zh: '高内', ko: '고내', lng: 126.33809, lat: 33.46689 },
  gwangnyeong: { zh: '广宁', ko: '광령', lng: 126.438946, lat: 33.460912 },
  kimmanduk: { zh: '金万德纪念馆', ko: '김만덕기념관', lng: 126.52732, lat: 33.51313 },
  jocheon: { zh: '朝天', ko: '조천', lng: 126.64183, lat: 33.53974 },
  gimnyeong: { zh: '金宁', ko: '김녕', lng: 126.74493, lat: 33.55745 },
  hado: { zh: '下道', ko: '하도', lng: 126.86276, lat: 33.52299 },
  jongdal: { zh: '终达', ko: '종달', lng: 126.90539, lat: 33.48868 },
  udo: { zh: '牛岛', ko: '우도', lng: 126.957624, lat: 33.492759 },
  gapado: { zh: '加波岛', ko: '가파도', lng: 126.271131, lat: 33.174535 },
  seogwang: { zh: '西广', ko: '서광', lng: 126.287705, lat: 33.306953 },
  chuja: { zh: '楮子岛', ko: '추자도', lng: 126.296191, lat: 33.963529 },
}

function tp(place: PlaceKey, kind: TrackPointKind): TrackPoint {
  const p = PLACES[place]
  return { id: uid('pt'), name: `${p.zh}（${p.ko}）`, lng: p.lng, lat: p.lat, kind }
}

/** 构造一个「途经点」（kind: 'via'），坐标与类型来自官方线路图（已吸附到真实轨迹）。 */
function viaFromDef(d: WaypointDef): TrackPoint {
  return { id: uid('pt'), name: d.name, lng: d.lng, lat: d.lat, kind: 'via', wpType: d.type }
}

/** 在采样序列里找离给定坐标最近点的海拔（导出给数据回填用） */
export function nearestEle(samples: ElevSample[], lng: number, lat: number): number | undefined {
  let best: ElevSample | undefined
  let bestD = Number.POSITIVE_INFINITY
  for (const s of samples) {
    const d = (s[0] - lng) ** 2 + (s[1] - lat) ** 2
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best ? best[2] : undefined
}

type Difficulty = 'Low' | 'Medium' | 'High'
const DIFF_NUM: Record<Difficulty, number> = { Low: 2, Medium: 3, High: 4 }

interface OlleSpec {
  code: string
  start: PlaceKey
  end: PlaceKey
  km: number
  difficulty: Difficulty
  branch?: boolean
  tags?: string[]
  region?: string
  /**
   * **A/B 两种走法**（官方只把 3 号线和 15 号线拆开列，编号带 `-A` / `-B`）：
   * - `山线` = A 线：内陆 / 中山间走向，翻岳穿林，里程长、爬升大；
   * - `海线` = B 线：海岸走向（官方称 바당올레），基本无台阶，里程短、难度低。
   *
   * 两条起终点相同、是同一段路的二选一，走完任意一条都算走完该号。
   * 不带这个字段的路线就是没有 A/B 之分（其余 25 条）。
   */
  variant?: '山线' | '海线'
}

/**
 * 官方公布的 29 条路线（21 主线 + 6 支线 + 3 号线 / 15 号线各多一条 A/B 替代走法），
 * 里程与难度取自 jejuolle.org 与官方 Olle App。
 */
const SPECS: OlleSpec[] = [
  { code: '01', start: 'siheung', end: 'gwangchigi', km: 15.1, difficulty: 'Medium', region: '东海岸 · 城山' },
  { code: '01-1', start: 'udo', end: 'udo', km: 13.2, difficulty: 'Medium', branch: true, region: '离岛 · 牛岛', tags: ['离岛', '需坐船'] },
  { code: '02', start: 'gwangchigi', end: 'onpyeong', km: 14.8, difficulty: 'Medium', region: '东海岸' },
  // 3 号线：A 山线（内陆·翻桶岳与独子峰）/ B 海线（바당올레·沿海岸，两线在 신풍신천바다목장 汇合）
  { code: '03-A', start: 'onpyeong', end: 'pyoseon', km: 20.9, difficulty: 'High', region: '东南 · 内陆', variant: '山线' },
  { code: '03-B', start: 'onpyeong', end: 'pyoseon', km: 14.6, difficulty: 'Low', region: '东南海岸', variant: '海线' },
  { code: '04', start: 'pyoseon', end: 'namwon', km: 19.0, difficulty: 'Medium', region: '南海岸' },
  { code: '05', start: 'namwon', end: 'soesokkak', km: 13.4, difficulty: 'Medium', region: '南海岸' },
  { code: '06', start: 'soesokkak', end: 'olleCenter', km: 10.1, difficulty: 'Low', region: '西归浦' },
  { code: '07', start: 'olleCenter', end: 'seogwipoTerminal', km: 12.9, difficulty: 'Medium', region: '西归浦', tags: ['入门推荐'] },
  { code: '07-1', start: 'seogwipoTerminal', end: 'olleCenter', km: 15.7, difficulty: 'Medium', branch: true, region: '西归浦' },
  { code: '08', start: 'wolpyeong', end: 'daepyeong', km: 19.3, difficulty: 'Medium', region: '西南海岸' },
  { code: '09', start: 'daepyeong', end: 'hwasun', km: 12.3, difficulty: 'High', region: '西南海岸' },
  { code: '10', start: 'hwasun', end: 'moseulpo', km: 15.6, difficulty: 'Medium', region: '西南海岸', tags: ['山房山', '松岳山'] },
  { code: '10-1', start: 'gapado', end: 'gapado', km: 4.2, difficulty: 'Low', branch: true, region: '离岛 · 加波岛', tags: ['离岛', '需坐船'] },
  { code: '11', start: 'moseulpo', end: 'mureung', km: 17.3, difficulty: 'Medium', region: '西南部' },
  { code: '12', start: 'mureung', end: 'yongsu', km: 17.5, difficulty: 'Medium', region: '西海岸' },
  { code: '13', start: 'yongsu', end: 'jeoji', km: 16.2, difficulty: 'Medium', region: '西海岸' },
  { code: '14', start: 'jeoji', end: 'hallim', km: 19.9, difficulty: 'Medium', region: '西北海岸' },
  { code: '14-1', start: 'jeoji', end: 'seogwang', km: 9.3, difficulty: 'Low', branch: true, region: '西北部' },
  // 15 号线：A 山线（锦山公园·纳邑林道·과오름）/ B 海线（翰林港经郭支·汉潭海岸散步路到高内浦口）
  { code: '15-A', start: 'hallim', end: 'gonae', km: 15.5, difficulty: 'Medium', region: '北海岸 · 山林', variant: '山线' },
  { code: '15-B', start: 'hallim', end: 'gonae', km: 13.0, difficulty: 'Low', region: '北海岸', variant: '海线' },
  { code: '16', start: 'gonae', end: 'gwangnyeong', km: 14.8, difficulty: 'Medium', region: '北海岸' },
  { code: '17', start: 'gwangnyeong', end: 'kimmanduk', km: 19.5, difficulty: 'Medium', region: '济州市' },
  { code: '18', start: 'kimmanduk', end: 'jocheon', km: 17.1, difficulty: 'Medium', region: '东北海岸' },
  { code: '18-1', start: 'chuja', end: 'chuja', km: 11.4, difficulty: 'High', branch: true, region: '离岛 · 上楮子', tags: ['离岛', '需坐船'] },
  { code: '18-2', start: 'chuja', end: 'chuja', km: 9.7, difficulty: 'High', branch: true, region: '离岛 · 下楮子', tags: ['离岛', '需坐船'] },
  { code: '19', start: 'jocheon', end: 'gimnyeong', km: 19.4, difficulty: 'Medium', region: '东北海岸' },
  { code: '20', start: 'gimnyeong', end: 'hado', km: 17.4, difficulty: 'Medium', region: '东北海岸' },
  { code: '21', start: 'hado', end: 'jongdal', km: 11.3, difficulty: 'Low', region: '东海岸 · 终达' },
]

/**
 * 29 条官方里程的**逐条合计**（计划页「全程」快捷目标用它）。
 *
 * ⚠️ 官网首页另外写着「꼬닥꼬닥 걸어, 함께 만든 제주올레 길 437km 27코스」——
 *    那是**宣传口径**，与它自己逐条列出的里程加起来（≈430km）对不上，两个数都不算错。
 *    这里**从 SPECS 推导**而不是写死：写死就会出现「选『437 全程』，
 *    把 29 条全加进来却只有 430km，永远差一截」这种自相矛盾。
 *
 * ⚠️ 03-A / 03-B、15-A / 15-B 各是同一段路的二选一走法，实际只能走一条，
 *    所以这里的合计数**比真正走完一圈的里程多算了 27.6km**（14.6 + 13.0）。
 *    仍按 29 条全计，是为了和官方 App 列出的 29 个编号一一对应 —— 想凑「实际走完」的
 *    里程，把目标设成 403（只算 A 线）即可。
 */
export const OLLE_TOTAL_KM = Math.round(SPECS.reduce((sum, s) => sum + s.km, 0))

/**
 * 途经点数据已迁移到 `src/lib/waypointsData.ts`（由 scripts/build_waypoints_data.py 自动生成）：
 * 源 = 2017 官方英文线路图 PDF（scripts/data/olle-waypoints.json），按沿线距离吸附到
 * `public/tracks.json` 真实轨迹得到坐标，并带官方图例分类 `WaypointType`。
 * - 所有线路的起终点与路径（`src/data/olle-endpoints.json` / `public/tracks.json`）均为已勘验的
 *   定稿数据，一律不得改动；本管线只生成途经点标记，不触碰起终点与轨迹。
 */

function buildRoute(spec: OlleSpec): Route {
  const now = Date.now()
  const s = PLACES[spec.start]
  const e = PLACES[spec.end]
  // A/B 走法直接进标签：路线卡、检索（「山线」「海线」）都靠它区分两条同起终点的线
  const tags = [
    ...(spec.branch ? ['支线'] : ['主线']),
    ...(spec.variant ? [spec.variant] : []),
    ...(spec.tags ?? []),
  ]
  // 高程序列 = 真实轨迹点（由 public/tracks.json 派生），剖面图与爬升都从它来。
  // 与运行时 DataContext.mergeTrack 同源同值，所以加载完不会出现剖面跳变。
  const elev = OLLE_ELEVATION[spec.code]
  const samples = elev?.samples ?? []
  const start = tp(spec.start, 'start')
  const end = tp(spec.end, 'end')
  // 起终点坐标一律换成 `src/data/olle-endpoints.json` 里钉死的权威值。
  // 不再用 PLACES 的城镇级近似坐标，也不再依赖运行时吸附到轨迹首尾
  // （那条链路 2026-09-29 失效过一次，01 起终点直接偏了 5~6km，见文件头注释）。
  const ep = ROUTE_ENDPOINTS[spec.code]
  if (ep) {
    start.lng = ep.start.lng
    start.lat = ep.start.lat
    end.lng = ep.end.lng
    end.lat = ep.end.lat
  }
  // 海拔要按最终坐标取，所以放在坐标覆盖之后
  if (samples.length > 0) {
    start.ele = nearestEle(samples, start.lng, start.lat)
    end.ele = nearestEle(samples, end.lng, end.lat)
  }
  return {
    id: `olle_${spec.code.replace(/-/g, '_')}`,
    code: spec.code,
    // A/B 两条起终点完全一样，光看「温坪 → 表善」分不出是哪条，故把走法写进名字
    name: `偶来 ${spec.code} · ${s.zh} → ${e.zh}${spec.variant ? `（${spec.variant}）` : ''}`,
    region: `韩国 · 济州岛 · ${spec.region ?? ''}`,
  // 起终点标记一律钉在固化的权威坐标上（startPoint/endPoint）。tracks.json 后续被校正时标记不会被带走；
  // 若轨迹确实变了，`scripts/check_endpoints.py` 会对账报警提醒重新固化。
    startPoint: start,
    endPoint: end,
    kind: 'hike',
    difficulty: DIFF_NUM[spec.difficulty],
    // 途经点：起点 → 官方命名途经点（kind:'via'，带 wpType 设施分类）→ 终点。
    // 坐标已按官方里程吸附到真实轨迹（见 waypointsData.ts 头注释）。
    points: [
      start,
      ...(ROUTE_WAYPOINTS[spec.code] ?? []).map(viaFromDef),
      end,
    ],
    manualDistanceKm: spec.km,
    elevationProfile: samples.length >= 2 ? samples : undefined,
    elevationBasis: elev?.basis,
    surface: OLLE_SURFACES[spec.code] ?? '海岸步道 / 村道 / 小路',
    bestSeason: '3-5 月（油菜花）、9-11 月（秋高气爽）',
    tags,
    // 爬来的住宿（OSM）按路线 code 回填进 seed，作为后台可编辑的一等数据。
    // 住宿 seed 由 src/lib/seedStays.ts 从 src/data/stays.json 实时派生（import），
    // 改住宿后只需重新构建、无需重跑脚本。
    hotels: SEED_STAYS[spec.code] ?? [],
    // 看点（路边景色）默认数据：由 scripts/build_sights_data.py 从
    // scripts/data/curated_sights.json 生成（src/lib/sightsData.ts）。
    // 只补官方航点漏掉的标志性景点，坐标为估算；后台 SightsEditor 可继续增删改。
    sights: DEFAULT_SIGHTS[spec.code] ?? [],
    album: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** 首次打开时写入：29 条偶来小路骨架（坐标/住宿/看点/相册） */
export function buildSeedRoutes(): Route[] {
  return SPECS.map(buildRoute)
}
