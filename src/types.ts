/** 经纬度点（WGS-84，与 OpenStreetMap 底图一致；济州岛在中国境外，无 GCJ-02 偏移） */
export interface GeoPoint {
  lng: number
  lat: number
  /** 海拔（米），可选 */
  ele?: number
}

/** 轨迹途经点：第一个为起点，最后一个为终点 */
export interface TrackPoint extends GeoPoint {
  id: string
  name: string
  kind: TrackPointKind
  note?: string
}

export type TrackPointKind = 'start' | 'end' | 'via' | 'aid' | 'peak'

/** 图片引用：外链 URL 或 IndexedDB 中的本地 key */
export interface ImageRef {
  kind: 'url' | 'local'
  /** url 时为完整链接；local 时为 IndexedDB 的 key */
  value: string
}

/** 附近酒店 / 住宿 */
export interface Hotel {
  id: string
  name: string
  lng: number
  lat: number
  address?: string
  /** 价格区间描述，如 "300-500" */
  priceRange?: string
  phone?: string
  rating?: number
  note?: string
}

/** 路边景色 / 沿途看点 */
export interface Sight {
  id: string
  name: string
  lng: number
  lat: number
  type: SightType
  desc?: string
  images: ImageRef[]
}

export type SightType = 'view' | 'water' | 'forest' | 'village' | 'ruin' | 'other'

/** 相册条目 */
export interface AlbumItem {
  id: string
  image: ImageRef
  caption?: string
  takenAt?: string
}

export type RouteKind = 'hike' | 'trailrun' | 'fastpack'

/**
 * 地形采样点：[lng, lat, ele?]。
 * - `olleeElevation.ts` 的 SRTM 采样点总是带 ele；
 * - `public/tracks.json` 的真实轨迹点若未录海拔，ele 缺省（此时界面显示「暂缺海拔数据」，
 *   而不是拿别的数据冒充）。
 */
export type ElevSample = [number, number, number?]

/**
 * 地形数据来源：
 * - track 真实轨迹（GPX 导入或实测）
 * - line  沿起终点直线采样估算
 * - loop  环线按里程反推圆周采样估算
 */
export type ElevBasis = 'track' | 'line' | 'loop'

/** 一条路线 */
export interface Route {
  id: string
  /** 路线编号，如 "01" / "07-1"（偶来小路官方编号） */
  code?: string
  name: string
  region: string
  summary: string
  kind: RouteKind
  /** 难度 1-5 */
  difficulty: number
  /** 有序途经点，index 0 为起点，最后一个为终点 */
  points: TrackPoint[]
  /** 手填里程（km），填了则以它为准（实际轨迹比直线长） */
  manualDistanceKm?: number
  /** 手填累计爬升（m） */
  manualGainM?: number
  /** 地形采样序列（剖面图 + 爬升估算的来源） */
  elevationProfile?: ElevSample[]
  /**
   * 有断口的轨迹：**分段**几何。段与段之间是真的没数据（OSM 里那一段没画），
   * 画线时不能连线，里程与爬升也要逐段算，否则会把断口处那根假直线算进去。
   * 没有断口时不要写这个字段，让 `elevationProfile` 单独承担即可。
   */
  elevationSegments?: ElevSample[][]
  /** 地形数据来源；缺省视为未知 */
  elevationBasis?: ElevBasis
  /** Optional attribution for an imported route track. */
  trackSource?: { name: string; url: string }
  surface?: string
  bestSeason?: string
  tags: string[]
  cover?: ImageRef
  hotels: Hotel[]
  sights: Sight[]
  album: AlbumItem[]
  createdAt: number
  updatedAt: number
}

/** 行程篮里的一条：每条路线只算一次，重复加入不会叠加 */
export interface PlanItem {
  routeId: string
  /** 是否已走完（用户手动勾选），用于查看完成进度 */
  done?: boolean
}

/** 行程篮：把若干路线加进来，自动算有没有百公里 */
export interface Plan {
  id: string
  name: string
  /** 目标里程，默认 100 */
  targetKm: number
  items: PlanItem[]
  createdAt: number
  updatedAt: number
}

/** 底图样式：standard = OpenStreetMap 标准地图，terrain = OpenTopoMap 地形图（等高线 / 山体阴影） */
export type MapStyle = 'standard' | 'terrain'

export interface AppSettings {
  /** 地图底图样式；瓦片来自 OpenStreetMap / OpenTopoMap 公共服务，无需申请 Key */
  mapStyle: MapStyle
}

/** 计算后的派生数据，不在库里存 */
export interface RouteMetrics {
  /** 途经点直线累加里程（km） */
  straightKm: number
  /** 真实轨迹实测里程（km）；有轨迹时它就是最准的里程，无轨迹为 undefined */
  trackKm?: number
  /** 生效里程：手填（官方）优先，其次真实轨迹，最后直线里程 × 绕行系数 */
  distanceKm: number
  /** 累计爬升（m）；无海拔数据时为 null，不要当成 0 展示 */
  gainM: number | null
  /** 累计下降（m）；无海拔数据时为 null */
  lossM: number | null
  /** 爬升数据是怎么来的：手填 / 地形采样 / 途经点 / 无数据 */
  gainSource?: 'manual' | 'profile' | 'points' | 'none'
  /** 地形采样口径（估算时） */
  elevationBasis?: ElevBasis
  highestM?: number
  lowestM?: number
  startPoint?: TrackPoint
  endPoint?: TrackPoint
}
