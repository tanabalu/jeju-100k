import type { ElevSample, Route, TrackPoint, TrackPointKind } from '../types'
import { uid } from './id'
import { OLLE_ELEVATION } from './olleeElevation'

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
  siheung: { zh: '始兴', ko: '시흥', lng: 126.7833, lat: 33.4622 },
  gwangchigi: { zh: '广峙其', ko: '광치기', lng: 126.79, lat: 33.43 },
  onpyeong: { zh: '温坪', ko: '온평', lng: 126.823, lat: 33.42 },
  pyoseon: { zh: '表善', ko: '표선', lng: 126.851, lat: 33.324 },
  namwon: { zh: '南元', ko: '남원', lng: 126.79, lat: 33.283 },
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
//       `scripts/data/olle-app-routes.json`）：本文件 27 条的**里程与起终点全部一致**。
//       两边仅有的差别是 App 把 3 号线、15 号线各列成 A/B 两条走法（3-B 14.6km、15-B 13.0km），
//       而本项目把 A 线记作主线（`03`=3A 20.9km、`15`=15A 15.5km）。
//       ⚠️ 爬升**不在这两份官方基准里**（App 只给海拔剖面小图、不给数字），
//       界面上的爬升一律来自轨迹点 + SRTM 30m 地形。
//       `python3 scripts/check_official_consistency.py` 可复现这层核对（先对 App，再对轨迹）。
//    ⭐ 07 现行路线几何已结合旧 GPX 和用户提供的官方 Olle App 地图恢复：GPX 只保留
//       与官方站点里程及走向相符的旅客中心→斗马尼莫公园段；公园之后按官方图经过
//       Beophwan Elementary School 数字化补线至巴士总站。补绘段不是 GPS 实测，见 tracks.json 来源说明。
  olleCenter: { zh: '偶来旅客中心', ko: '제주올레여행자센터', lng: 126.558717, lat: 33.247461 }, // 官方 GPS
  seogwipoTerminal: { zh: '西归浦巴士总站', ko: '서귀포버스터미널', lng: 126.508588, lat: 33.249104 }, // 官方 GPS
  wolpyeong: { zh: '月坪', ko: '월평', lng: 126.47, lat: 33.248 },
  daepyeong: { zh: '大坪', ko: '대평', lng: 126.42, lat: 33.262 },
  hwasun: { zh: '和顺', ko: '화순', lng: 126.35, lat: 33.262 },
  moseulpo: { zh: '摹瑟浦', ko: '모슬포', lng: 126.248, lat: 33.216 },
  mureung: { zh: '武陵', ko: '무릉', lng: 126.28, lat: 33.28 },
  yongsu: { zh: '龙水', ko: '용수', lng: 126.31, lat: 33.315 },
  jeoji: { zh: '楮旨', ko: '저지', lng: 126.305, lat: 33.36 },
  hallim: { zh: '翰林', ko: '한림', lng: 126.27, lat: 33.4 },
  gonae: { zh: '高内', ko: '고내', lng: 126.352, lat: 33.43 },
  gwangnyeong: { zh: '广宁', ko: '광령', lng: 126.39, lat: 33.46 },
  kimmanduk: { zh: '金万德纪念馆', ko: '김만덕기념관', lng: 126.523, lat: 33.5 },
  jocheon: { zh: '朝天', ko: '조천', lng: 126.62, lat: 33.535 },
  gimnyeong: { zh: '金宁', ko: '김녕', lng: 126.72, lat: 33.55 },
  hado: { zh: '下道', ko: '하도', lng: 126.76, lat: 33.53 },
  jongdal: { zh: '终达', ko: '종달', lng: 126.775, lat: 33.5 },
  udo: { zh: '牛岛', ko: '우도', lng: 126.95, lat: 33.51 },
  gapado: { zh: '加波岛', ko: '가파도', lng: 126.26, lat: 33.17 },
  seogwang: { zh: '西广', ko: '서광', lng: 126.33, lat: 33.37 },
  chuja: { zh: '楮子岛', ko: '추자도', lng: 126.28, lat: 33.96 },
}

function tp(place: PlaceKey, kind: TrackPointKind): TrackPoint {
  const p = PLACES[place]
  return { id: uid('pt'), name: `${p.zh}（${p.ko}）`, lng: p.lng, lat: p.lat, kind }
}

/** 构造一个「途经点」（kind: 'via'）。坐标来自官方路线指南（部分吸附到真实轨迹、部分为近似）。 */
function viaPt(zh: string, ko: string, lng: number, lat: number): TrackPoint {
  return { id: uid('pt'), name: `${zh}（${ko}）`, lng, lat, kind: 'via' }
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
}

/** 官方公布的 27 条路线（21 主线 + 6 支线），里程与难度取自 jejuolle.org */
const SPECS: OlleSpec[] = [
  { code: '01', start: 'siheung', end: 'gwangchigi', km: 15.1, difficulty: 'Medium', region: '东海岸 · 城山' },
  { code: '01-1', start: 'udo', end: 'udo', km: 13.2, difficulty: 'Medium', branch: true, region: '离岛 · 牛岛', tags: ['离岛', '需坐船'] },
  { code: '02', start: 'gwangchigi', end: 'onpyeong', km: 14.8, difficulty: 'Medium', region: '东海岸' },
  { code: '03', start: 'onpyeong', end: 'pyoseon', km: 20.9, difficulty: 'High', region: '东南海岸' },
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
  { code: '15', start: 'hallim', end: 'gonae', km: 15.5, difficulty: 'Medium', region: '北海岸' },
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
 * 27 条官方里程的**逐条合计**（计划页「全程」快捷目标用它）。
 *
 * ⚠️ 官网首页另外写着「꼬닥꼬닥 걸어, 함께 만든 제주올레 길 437km 27코스」——
 *    那是**宣传口径**，与它自己逐条列出的里程加起来（≈403km）对不上，两个数都不算错。
 *    这里**从 SPECS 推导**而不是写死：写死就会出现「选『437 全程』，
 *    把 27 条全加进来却只有 403km，永远差一截」这种自相矛盾。
 */
export const OLLE_TOTAL_KM = Math.round(SPECS.reduce((sum, s) => sum + s.km, 0))

/**
 * 各路线的官方命名途经点（kind: 'via'），按官方路线指南（jejuolle.org + Namu Wiki 转写）整理。
 *
 * 放置策略（与「好猜坐标」两害相权）：
 * - **有真实轨迹的线**（如 01）：坐标按官方里程标记吸附到 `public/tracks.json` 的真实轨迹上
 *   （见 scripts/compute_route_via.py 思路），所以标记精准落在线上，且不会随 `mergeTrack`
 *   被冲掉（它只动首尾，中间点原样保留）。
 * - **无轨迹的线**（18-2）：坐标取官方描述里的近似位置，同时把虚线折线也带出形状。
 *   07 已有混合来源轨迹（前段 GPX、末段官方图数字化），途经点吸附到轨迹上。
 *   ⚠️ **14-1 已由 codex 用真实 GPX（`sungbh98.tistory.com/1448` 2024 实走）校正**，在 `tracks.json` 中有真实轨迹，
 *      故不走这里的近似途经点；其起终点标记由真实轨迹端点决定（不挂官方坐标锚点，避免偏离真实线 4~5km）。
 *      不要再给 14-1 在此加近似点，也不要在 buildRoute 里给它挂 startPoint/endPoint。
 *
 * 试点（1 / 7）；全量铺开时按同样结构补齐其余主线。
 * 口径优先级：① jejuolle.org 现行编号表 + 改线公告 ② 官网标注起终点 GPS ③ 官方路线指南散文。
 */
interface ViaDef {
  zh: string
  ko: string
  lng: number
  lat: number
}
const WAYPOINTS: Record<string, ViaDef[]> = {
  // 01：坐标已按官方里程（1.1/2.8/6.4/6.5/8.1/11.1/13.7km）吸附到真实轨迹，精准。
  '01': [
    { zh: '末木岳', ko: '말미오름', lng: 126.88515, lat: 33.47406 },
    { zh: '卵岳', ko: '알오름', lng: 126.88548, lat: 33.48054 },
    { zh: '终达里会馆', ko: '종달리회관', lng: 126.89985, lat: 33.4931 },
    { zh: '终达里旧盐田', ko: '종달리옛소금밭', lng: 126.90039, lat: 33.49255 },
    { zh: '木花休息站', ko: '목화휴게소', lng: 126.902, lat: 33.48155 },
    { zh: '城山闸门', ko: '성산갯문', lng: 126.92534, lat: 33.46882 },
    { zh: '水玛浦海岸', ko: '수마포해안', lng: 126.93325, lat: 33.46067 },
  ],
  // 07（现行 12.9km，参考官方 Olle App 线路图及 2022 实走 GPX；后段按官方图数字化补线）。
  '07': [
    { zh: '七十里诗公园', ko: '칠십리 시공원', lng: 126.553534, lat: 33.246588 },
    { zh: 'Solbit Bada Café', ko: '솔빛바다카페', lng: 126.548092, lat: 33.242266 },
    { zh: '法还浦口', ko: '법환포구', lng: 126.520191, lat: 33.241046 },
    { zh: '斗马尼莫公园', ko: '두머니물공원', lng: 126.513411, lat: 33.233940 },
  ],
}

function buildRoute(spec: OlleSpec): Route {
  const now = Date.now()
  const s = PLACES[spec.start]
  const e = PLACES[spec.end]
  const isLoop = spec.start === spec.end
  const tags = [...(spec.branch ? ['支线'] : ['主线']), ...(spec.tags ?? [])]
  // 地形采样序列：剖面图与爬升都从它来
  const elev = OLLE_ELEVATION[spec.code]
  const samples = elev?.samples ?? []
  const start = tp(spec.start, 'start')
  const end = tp(spec.end, 'end')
  if (samples.length > 0) {
    start.ele = nearestEle(samples, start.lng, start.lat)
    end.ele = nearestEle(samples, end.lng, end.lat)
  }
  return {
    id: `olle_${spec.code.replace(/-/g, '_')}`,
    code: spec.code,
    name: `偶来 ${spec.code} · ${s.zh} → ${e.zh}`,
    region: `韩国 · 济州岛 · ${spec.region ?? ''}`,
    // 对有可信线路几何、但采集端点不在官方命名地点的路线，地图标记钉在官方地点。
    // 07-1 的现有路径以其几何首末点为准：官方中心锚点会把终点标记拉离路径约 1.3km。
    // 06 起点锚点已校准到 05 号线 GPS 终点；07 混合来源轨迹首尾与官方端点吻合，保留官方端点。
    // 14-1 已有 codex 校正过的真实 GPX 轨迹（tracks.json 14-1 条目，sungbh98 2024 实走），
    // 起终点标记直接跟随真实轨迹端点，不再钉到 jeoji/seogwang 近似地点（偏离真实端点 4~5km）。
    ...(spec.code === '06' || spec.code === '07'
      ? { startPoint: start, endPoint: end }
      : {}),
    summary: isLoop
      ? `${s.zh}环线，官方里程 ${spec.km} km，官方难度 ${spec.difficulty}。`
      : `${s.zh}（${s.ko}）到 ${e.zh}（${e.ko}），官方里程 ${spec.km} km，官方难度 ${spec.difficulty}。`,
    kind: 'hike',
    difficulty: DIFF_NUM[spec.difficulty],
    // 途经点：起点 → 官方命名途经点（kind:'via'）→ 终点。
    // 有轨迹的线坐标已吸附到真实轨迹；无轨迹的线坐标为近似，同时带出虚线形状。
    points: [start, ...(WAYPOINTS[spec.code] ?? []).map((v) => viaPt(v.zh, v.ko, v.lng, v.lat)), end],
    manualDistanceKm: spec.km,
    elevationProfile: samples.length >= 2 ? samples : undefined,
    elevationBasis: elev?.basis,
    surface: '海岸步道 / 村道 / 小路',
    bestSeason: '3-5 月（油菜花）、9-11 月（秋高气爽）',
    tags,
    hotels: [],
    sights: [],
    album: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** 首次打开时写入：27 条偶来小路骨架（坐标/住宿/看点/相册留给你在后台补） */
export function buildSeedRoutes(): Route[] {
  return SPECS.map(buildRoute)
}
