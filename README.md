# 偶来小路 · 百公里攻略（济州岛 Jeju Olle Trail）

> 🌐 语言 / Language：**[中文](README.md)** · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md)
>
> 📌 数据采集的来龙去脉、试错记录与历史数据快照已搬到 **[CHANGELOG.md](CHANGELOG.md)**。README 只留当前该怎么用。

把济州岛 29 条偶来小路（올레길）攒成自己的行程，自动算里程、看有没有凑够百公里，顺带管理起终点、沿途住宿、路边景色和相册。

纯前端，数据保存在本机浏览器（localStorage + IndexedDB），npm 管理依赖，最终用户使用 `npm run build` 产出的静态页面。

## 快速开始（总览）

| 步骤 | 命令 | 说明 |
| --- | --- | --- |
| 1 | `npm install` | 安装依赖 |
| 2 | `npm run dev` | 本地开发，打开 http://127.0.0.1:5180 |
| 3 | `npm run build` | 产出 `dist/`，即最终用户使用的静态页面 |
| 4 | `npm run preview` | 本地验证构建产物 |
| 5 | 部署（可选） | `dist/` 挂到任意静态服务器 / Dokploy 子路径即可 |

> 关键：**底图数据来自 OpenStreetMap，全球覆盖、无需申请 Key**。济州岛的街道、海岸线、地形都能正常显示；断网时地图区域为空，凑里程等核心功能不受影响。详见第 5 节。

## 1. 预置了什么

首次打开自动写入**官方公布的 29 条偶来小路**（数据来源 jejuolle.org 与官方 Olle App）：

- **21 条主线 + 6 条支线**（1-1 牛岛、7-1、10-1 加波岛、14-1、18-1 上楮子、18-2 下楮子）
- **3 号线、15 号线各多一条 A/B 替代走法**（`03-A`/`03-B`、`15-A`/`15-B`，见下节）
- 官方里程已填进「实际里程」，因此**里程以官方值为准**，不走直线估算
- 官方难度 Low / Medium / High 已映射为 2 / 3 / 4 星
- 主线单条 10.1 ~ 20.9 km；**29 条逐条合计 430 km**（`OLLE_TOTAL_KM` 由 `SPECS` 推导，不写死）
  —— 官网首页那句「437km 27코스」是宣传口径，两个数都对，别为它去改哪一边
  —— A/B 是同一段路的二选一，合计里两条都算，比「实际走完一圈」多 27.6 km；想按实际走完算就把目标设成 403

| 数据 | 现状 |
| --- | --- |
| 编号、起终点名称、官方里程、官方难度 | 官方网站（jejuolle.org）与官方 Olle App，可直接用 |
| 路线几何（走向、起终点经纬度） | **29 条全部有轨迹**（`28` 条实测 + `15-B` 由 OSM 路网推断，见下节） |
| 海拔与累计爬升 | 按轨迹算或沿轨迹补采样，**29 条全有海拔**，见下节 |
| 沿途住宿 | 预置 OSM 抓来的 239 家（12 条线命中），可在 `/admin` 编辑 |
| 卡片封面 | 该路线一带的风景照（Wikimedia Commons 自由授权，需先跑 `scripts/fetch_photos.py`）；没跑脚本时回落到官方路线图 |
| 看点、相册 | 预置为空，在 `/admin` 录入 |

### 3 号线 / 15 号线的 A、B 两种走法

官方把这两条各拆成 **A 山线** 与 **B 海线**，同起终点、二选一，走完任意一条就算走完该号：

| 路线 | 走法 | 官方里程 | 官方耗时 | 难度 | 走向 |
| --- | --- | --- | --- | --- | --- |
| `03-A` | 山线 | 20.9 km | 6~7h | ★★★★ | 内陆中山间，过桶岳·独子峰 |
| `03-B` | 海线 | 14.6 km | 4~5h | ★★ | 海岸（바당올레），两线在 신풍신천바다목장 汇合；**已有实测轨迹 14.75 km** |
| `15-A` | 山线 | 15.5 km | 5~6h | ★★★ | 山林道，过锦山公园·纳邑林道 |
| `15-B` | 海线 | 13.0 km | 4~5h | ★★ | 海岸，翰林港 → 郭支 → 汉潭海边散步路 → 涯月 → 高内浦口；**已有 OSM 推断轨迹 12.26 km** |

两条在路线列表、行程篮里都是**各自独立的一条**（编号徽标带 `-A` / `-B`，卡片标签带「山线」/「海线」，搜「山线」「海线」可筛）。

### 轨迹来源（2026-10-03 现状）

29 条**全部已有轨迹**（`public/tracks.json`，运行时 `fetch` 读取，**不进 localStorage**，换轨迹直接替换文件）。
其中 **28 条是实测轨迹**，`15-B` 是唯一一条**由 OSM 路网推断**的（下面单独说明）。
自己新建的路线仍按起终点连成**灰绿虚线**示意，爬升显示「—」。

`03-B` 的轨迹是 2026-10-03 补上的：OSM 的 `올레길3` 父关系下有 `올레길3A` / `올레길3B` 两个子关系，
A 与 B **没有共享 way**（`A∩B=0`），父关系自己还挂着 32 条 way 作为两线共用的首尾段。
所以拿「父关系的 32 条 + 3B 关系的 25 条」单独缝合，就得到一条 14.88 km 的连续海线（官方 14.6 km，覆盖 1.02）。
另有一份独立的社区 KML（`Jeju Olle 3B`，14.84 km）与它首末点一致，两个源互相印证。

`15-B` 拿不到实测轨迹 —— OSM 里 15 号线**没有 route 关系**（全岛 22 个 올레 关系无它），官网 `jejuolle.org/trail#/road/15_B`
只有**图片版路线图**（`assets/Road-*.js` 里全是 `road_15-B_map_pc.jpg` 这类图，没有矢量坐标），
社区站 `pamnjeff.com` 的 `JejuOlle15a/15b` 全 404。改用**路网推断**：
把翰林港→高内浦口之间 bbox 内的 OSM 步行路网 + 海岸线取出来建图，
按「**贴海最短路**」跑 Dijkstra（代价 = 路段长 × 道路类型系数 × 离海距离惩罚），
得到 **12.26 km / 爬升 45 m** 的连续走向（官方 13.0 km，覆盖 0.955）。
走向可信的旁证：官方点名的 4 个途经点 —— 云龙岬无人灯塔、济州海水浴场海女学校、金城里大海、郭支海水浴场 ——
**全部落在轨迹 80 m 内**；爬升仅 45 m 也与官方「全线平坦、无台阶、难度低」吻合。
这是推断而非实测，里程比官方短 5.7%，徒步时以官方里程为准。
有轨迹的路线：地图按真实轨迹画**实线**（白边 + 绿芯），起终点吸附到轨迹首末点，爬升按轨迹逐点累加。

| 项目 | 现状 |
| --- | --- |
| 轨迹来源 | OSM route relation / OSM 散 way / 整条偶来 GPX，按编号**逐条比选**后落在 `tracks/osm/*.geojson` |
| 官方 ↔ 轨迹偏差 | 16 条在 ±5% 内；**13 条超出**，其中 `15-A`（+19.0%）与 `08`（−11.9%）判 ⛔ |
| 海拔来源 | 4 条沿用轨迹自带海拔（`09 / 14-1 / 18-1 / 18-2`）；其余 25 条轨迹无海拔、由 SRTM 30m 沿轨迹补采样。**29 条全有海拔** |
| 爬升合计 | 29 条全有数据，合计 **6504 m** |

⚠️ **二手几何的边界**：这些数据是从 OSM / GPX 抓来的，**官方改线不会自动跟上**。
页面显示的「里程」恒取 `SPECS` 官方值，详情页另给「轨迹实测 X km」作对照，所以上表的偏差不会让页面数字自相矛盾；
但 `15-A` / `08` 这两条的**爬升与地图形状**请打折看。

> 📌 三源怎么比选、每条线曾拿到又撤下过什么几何、各轮实测的偏差快照 —— 见 [CHANGELOG.md](CHANGELOG.md)。

### 海拔与爬升怎么算

优先级：**手填「实际累计爬升」** > **轨迹自带海拔**（`elevSource: track`）
> **沿轨迹补采样**（SRTM 30m）> **途经点手填海拔** > 都没有则显示「—」。

- 高程序列就是 `public/tracks.json` 的轨迹点本身（`src/lib/olleeElevation.ts` 由 `scripts/build_elevation_from_tracks.py` 从它派生），
  与运行时叠加轨迹用的是**同一份数据**，所以加载完不会出现「估算剖面跳成真实剖面」。
- 累加用**带 3m 滞后阈值**的相邻差，抑制地形数据本身的抖动。
- **少于 2 个点有海拔时显示「—」而不是 0**（0 会让人误以为这条路是平的）—— 只在自己新建、没导入轨迹的路线上会出现。

想刷新数据：

```bash
python3 scripts/check_official_consistency.py            # 官方口径 ↔ 实际几何，逐条对账（改完必跑）
python3 scripts/fill_track_elevation.py                  # 给已入库但缺海拔的轨迹补采（有缓存，只补新点）
python3 scripts/build_elevation_from_tracks.py           # 由 tracks.json 重新派生 seed 用的高程序列
```

### 重导 / 补一批轨迹

改过脚本逻辑先跑回归（都不联网）：

```bash
python3 scripts/selftest_fetch_osm.py        # 缝合与判定
python3 scripts/selftest_import_tracks.py    # 导入与走向校正
```

正式流程：

```bash
# 1) 抓真实走向 —— 三个源一起喂，脚本逐条比选（导出 tracks/osm/olle-<编号>.geojson）
python3 scripts/fetch_olle_osm.py --gpx ~/Downloads/olle-all.gpx --dry   # 先看报表，不写文件
python3 scripts/fetch_olle_osm.py --gpx ~/Downloads/olle-all.gpx

# 2) 转成前端格式，必要时联网补海拔
python3 scripts/import_tracks.py --src tracks/osm --elevation
```

Overpass 常返回 504/429，所以留了三个「别再赌网络」的口子：

| 参数 | 用途 |
| --- | --- |
| `--cache-dir scripts/.cache/osm` | 每次响应按查询哈希落盘，重跑直接读盘。**调参时必开** |
| `--offline` | 只读缓存，绝不联网。缺哪条就报哪条 |
| `--reuse-dir tracks/osm` | relation 侧几何从已有 `olle-*.geojson` 读，跳过 relations 查询 |

> ⚠️ `--reuse-dir` **只复用来历是 OSM 关系的文件**（看 `geomSource` 字段，`both-*` 也放行）。
> 不卡这一条会把上一轮的 GPX 产物当成 relation 侧复用，来源标签越跑越糊。

拿到别处的 GPX / KML / GeoJSON 也一样，丢进一个目录直接导（文件名含 `1` / `01` / `10-1` 都能认出编号）：

```bash
python3 scripts/import_tracks.py --src ~/tracks --dry        # 先看识别结果
python3 scripts/import_tracks.py --src ~/tracks --elevation  # 正式导入
python3 scripts/import_tracks.py --src ~/tracks --strict     # 有未识别文件就退出
```

- 文件名认不出编号用 `--map 文件名=编号`；OSM 的 A/B 变体（如 `3코스-A`）用 `--alias 03-A=03` 归到你的编号。
- 走向默认按「相邻课程首尾相接」自动校正，也可 `--reverse 01` 手工翻转 / `--no-orient` 关掉。
  **自动校正只在链条完整时才灵** —— 中间缺编号时相邻对会漏判，改完导入清单要看输出里那行翻转提示。
- **有断口的轨迹按「分段」处理**：地图按段画、**不连线**；里程是各段之和，爬升逐段累加。
- 轨迹抽稀默认容差 8 m / 上限 420 点（Douglas–Peucker，预算按所有段合计）。
- 与官方里程偏差 >25% 会告警（多半是编号认错、轨迹含接驳段），先核对再落盘。

## 2. 功能

| 模块 | 页面 | 能做什么 |
| --- | --- | --- |
| 路线列表 | `/` | 29 条按编号排列（3 / 15 号线的 A、B 走法各占一条）；搜索（名称/地区/标签，支持「偶来 07」「西归浦」「海线」）、按类型筛选、按编号/里程/更新时间/名称排序；顶部行程篮可直接切换；卡片一键加入行程篮 |
| 路线详情 | `/routes/:id` | 地图看起终点、海拔剖面、沿途住宿（自动算「沿线 N km / 离路线 N km」）、路边景色、相册灯箱 |
| 行程篮 | `/plan` | 把路线加进来（**每条路线只算一次**，已加入的按钮置灰）、自定义目标里程（快捷选 **100** 或 **430 全程**；430 = 29 条逐条合计，含 A/B 两条替代走法），实时算累计并判达标；差多少给补线建议；**默认按加入顺序排列**（可切「按里程」），复制的 Markdown 跟随当前顺序；每条可勾选「已走完」查看走线进度（X/Y 条 + 已走里程），支持「只看未完成」；「行程位置」地图同屏看所有已加入路线（编号徽标 + 住宿/看点标），**住宿标可一键隐藏（默认显示）** |
| 行前准备 | `/prep` | 济州岛 checklist（5 组 35 项，可勾选、手动放弃/恢复、只看未完成、自己加条目；已放弃项集中在「补充我自己的条目」下方可查看与逐项/一键恢复）+ **徒步装备 / 女士常用 / 男士常用 / 大疆 / 相机 / 无人机 六份备选清单**（徒步装备 10 条、女士/男士各 11/10 条，逐条或整份加入总清单，加入后带来源标签、可随时移出）+ 吃喝住行速查（含 T-money 办卡/乘车要点、导航 App 对比、打车支付）与预算粗算 |
| 素材管理 | `/admin` | 路线增删改（含编号）；途经点支持地图点选与上下调序；住宿、看点（多图）、相册（本地上传自动压缩或外链）；JSON 导入导出 |
| 设置 | `/settings` | 地图底图样式、清空数据 |

> 页脚署名：底图服务 OpenStreetMap、数据来源 **jejuolletrailguide.net**（Jeju Olle Trail 官方英文指南）；该站同时列在页脚「友情链接」里（外链一律新开标签页 + `rel="noopener noreferrer"`）。友链列表在 `src/App.tsx` 的 `FRIEND_LINKS`，加一条即可。
> 页脚另有「配图来源」一行（`src/App.tsx` 的 `FooterPhotoCredit`）：**按运行时实际读到的清单渲染** —— 有多少条算多少条，`Wikimedia Commons` 自由授权照片与 `© Jeju Olle Foundation` 官方路线图各自出一段，**没下载过的那一类不会出现在页脚**（不会出现「配图来自 Commons」但图其实是官方兜底的错署名）；逐张作者与许可仍写在相册 caption 里，完整清单见 `public/photos/CREDITS.md`。

凑百公里的典型用法：主线平均 15~20 km，**挑 6 条左右就到 100 km**；想走完全岛就把目标设成 430。

## 3. 数据存哪

| 内容 | 位置 |
| --- | --- |
| 路线 / 行程篮 / 设置 | `localStorage`（key 前缀 `jejuolle100k.`） |
| 行前 checklist 的勾选与自定义条目 | `localStorage` 的 `jejuolle100k.checklist` |
| 本地上传的图片 | `IndexedDB`（库 `jejuolle100k` → store `images`），上传时压到最长边 1600px、JPEG 0.82 |

数据不上传任何服务器。换设备或清浏览器前，到 `/admin` 顶部「导出 JSON」备份，换机后「导入 JSON」恢复（可选合并/替换）。

## 4. 里程怎么算

| 场景 | 取值 |
| --- | --- |
| 预置的偶来路线 | 官方里程（`manualDistanceKm`）优先，不估 |
| 你自己新建、未手填的路线 | 相邻途经点直线距离累加 × 1.2（绕行系数） |
| 爬升 | 优先级见 §1「海拔与爬升怎么算」（轨迹自带 > 沿轨迹补采样 > 途经点手填 > 手填爬升最优先；都没有则显示「—」） |

行程篮：每条路线只计一次，全部里程之和与目标比对，直接给出「已达标 / 还差 N km」，并按缺口大小推荐还能补的路线。

## 5. 地图底图说明

底图用 **Leaflet** 渲染，数据来自 **OpenStreetMap**（瓦片由 OpenStreetMap / OpenTopoMap 公共服务提供），全球覆盖，济州岛的街道、海岸线、地形都能正常显示，**不需要申请 Key，也不需要任何配置**。

| 底图样式 | 瓦片来源 | 特点 |
| --- | --- | --- |
| 标准地图（默认） | OpenStreetMap `tile.openstreetmap.org` | 道路、POI、地名等要素最全 |
| 地形图 | OpenTopoMap `tile.opentopomap.org` | 等高线 + 山体阴影，适合徒步 / 越野判断爬升 |

样式在「设置」页一键切换、立即生效，选择存在本机。

- 瓦片需要联网加载，**离线时地图区域为空白**，其余功能不受影响。
- **两种线型**（`src/lib/geo.ts` 的 `mapLineSet()` → `MapLine.approx`）：
  **实线（白边 + 绿芯）** = `public/tracks.json` 里的轨迹（29 条全部有）；
  **灰绿虚线** = 没有轨迹的路线（只有你自己新建的），
  只是把途经点连起来的**示意线**，别当成真实路线。
  详情页、行程篮页都会在说明里点出这一点。
- 极端情况下 Leaflet 初始化失败会自动降级为**离线示意图**（SVG 投影），仍可点击反算经纬度。
- 坐标统一为 **WGS-84**（与 OSM 一致）。济州岛在中国境外，GCJ-02 偏移算法在境外不生效，因此历史坐标与 WGS-84 等价，换底图不会产生位置偏移。

> ⚠️ 合规提示：OpenStreetMap / OpenTopoMap 属境外图源，**不适用于面向中国大陆的测绘地图产品**。本项目定位是济州岛（海外）徒步攻略的个人自用工具，用境外图源没问题；若将来要对大陆用户作为测绘产品发布，需换回具备测绘资质且能覆盖目标区域的底图服务。

## 6. 路线配图与封面

卡片封面用**该路线一带的风景照**（Wikimedia Commons 自由授权），**官方路线图退到详情页相册**——官方图是照着走的示意图，缩到卡片尺寸只剩一片灰白，而风景照一眼就能认出这条线。两套素材都放在 `public/photos/`，前端启动时读清单按路线编号自动绑定（**不写进 localStorage**，换图直接替换文件即可）。

**封面优先级**：后台自己设的 cover > 风景照 > 官方路线图。**相册顺序**：风景照 → 官方路线图 → 自己上传的。

### 6.1 官方路线图 → 详情页相册（卡片封面的兜底）

把 Jeju Olle Foundation 官方《Route Map》PDF 按路线切成图片，每条线一页：

```bash
# 默认读 ~/Downloads/171011_jeju-olle-route-map.pdf
python3 scripts/split_route_map.py
python3 scripts/split_route_map.py --pdf /path/to/route-map.pdf
python3 scripts/split_route_map.py --limit 2      # 先切 2 条看效果
```

| 产出 | 说明 |
| --- | --- |
| `public/photos/maps/olle-<编号>.webp` | **详情页原图**：每条线一整页（1432×1012，约 100KB/张，26 张共 2.5MB），用于相册与灯箱 |
| `public/photos/maps/cover/olle-<编号>.webp` | **卡片封面（压缩版）**：760×537，约 25KB/张，26 张共 0.65MB |
| `public/photos/maps.json` | 编号 → `{ file: 原图, cover: 封面 }`，前端读它设 `cover` 并把原图加进相册（可点开看全尺寸） |

**一份图出两个尺寸**：卡片封面在列表里只渲染到约 300–400px 宽，塞 1432px 原图纯属浪费（首页 26 张要拉 2.5MB）。
封面单独压一份后首屏只要 0.65MB，详情页相册/灯箱照旧用 1432px 原图，放大看地名不受影响。

压缩是**本地**做的（Pillow 降尺寸 + WebP 降质，`--cover-width` / `--cover-quality` 可调），效果与 TinyPNG / tinyimg 这类在线服务同类，但不需要 API key、不需要把图片上传到第三方，且可复现。想换在线服务也可以，只要把压缩结果覆盖到 `maps/cover/` 同名文件即可。

几个约定：

- **不要裁切**。官方页是 842×596 的横版，地图铺满整页，裁掉上下 30% 会切到路线本体（01 线南端、10-1 的济州本岛侧都会被切）。卡片封面位 `.route-cover` 现在是 `aspect-ratio: 3 / 2`（按风景照的多数比例留位），官方图作为兜底落进去会上下各裁约 3%，路线本体不受影响。
- **页码 ↔ 路线号必须核对**。脚本里的 `PAGE_CODES` 是按每页右下角印的粗体路线号整理的（PDF 第 1 页是封面，2~27 页才是路线）。换新版 PDF 一定要重新核对这张表，否则会把路线号配错。
- 这份 2017.10 版**没有 Route 18-2（下楮子岛）那一页**；18-2 的封面由 6.2 的风景照补上，两边都没有才走「暂无配图」占位。
- 官方图保持 2017.10 版本，未随路线改线更新（详情页仍可看），卡片上已被风景照取代。

> ⚠️ 官方路线图版权归 **© Jeju Olle Foundation**，PDF 内页明确写着「未经许可禁止为商业目的翻印、复制与分发」。本项目是个人自用攻略工具、非商业用途，且相册与灯箱里都显示了署名的 `credit`；**不要拿去商用**。

### 6.2 卡片封面（风景照，Wikimedia Commons 自由授权）

小红书等站点的图片有版权且禁止抓取，**不要**批量扒下来放进项目。本项目改用 Wikimedia Commons 的自由授权作品（CC0 / CC-BY / CC-BY-SA / 公共领域）。

```bash
# 下载 29 条路线的封面（需要能访问 commons.wikimedia.org / upload.wikimedia.org）
python3 scripts/fetch_photos.py                 # 全量
python3 scripts/fetch_photos.py --limit 2       # 先跑 2 条试试
python3 scripts/fetch_photos.py --dry           # 只检索不下载，看会选中哪张
python3 scripts/fetch_photos.py --codes 18-2    # 只补某几条
python3 scripts/fetch_photos.py --proxy http://127.0.0.1:7890   # 走本机代理
python3 scripts/selftest_fetch_photos.py        # 离线自测挑选逻辑（不联网，改脚本前先跑）
```

> ⚠️ **Wikimedia 在部分网络环境（含大陆家用宽带）不可达**，脚本会直接超时报错。先探一下：
> `curl -s -o /dev/null -w '%{http_code}' https://commons.wikimedia.org/w/api.php`
> 返回 `000` 就是不通，用 `--proxy` 指向你的代理（或换网络环境）再跑。

脚本产出：

| 文件 | 作用 |
| --- | --- |
| `public/photos/scenes/olle-<编号>.webp` | **详情页原图**：1600px 宽，q82，约 120KB/张 |
| `public/photos/scenes/cover/olle-<编号>.webp` | **卡片封面**：760px 宽，q74，约 25KB/张（27 张共约 0.7MB） |
| `public/photos/manifest.json` | 编号 → `{ file, cover, caption, credit, source }`，前端启动时读取并绑定（**不写进 localStorage**） |

> 清单按**路线编号**绑定，改编号就得同步改键 —— 03 / 15 拆成 A/B 后若漏改，这两条线的封面与官方路线图会整块消失（页面不报错，只是显示占位色块）。
> 现状：**29 条线共用 27 张风景照** —— `03-A`/`03-B`、`15-A`/`15-B` 同起终点、同一带，A/B 各指向同一张图（caption 里分别写明山线/海线），B 线不带 gallery 以免相册里 A 线的图重复出现。
> 官方路线图 PDF 是 2017 版（3、15 那时还没拆 A/B），所以 **`03-B` / `15-B` 没有官方路线图**，这两条的封面只有风景照。
| `public/photos/CREDITS.md` | 署名清单（作者 / 许可 / 来源页），满足 CC-BY 的署名要求，请随项目一起分发 |

挑选规则写死在脚本里，避免抓回一堆不能用的图：

- **许可**：只收明确自由许可（CC0 / CC BY / CC BY-SA / Public domain）；许可字段缺失、`Fair use`、`All rights reserved` 一律跳过 —— 宁可这条线暂时没封面。
- **构图**：宽 ≥ 1200px 且**宽高比 ≥ 1.25**。近方形的图（如 6218×6012）当封面会被裁得几乎没内容。
- **排除示意图**：标题含 map / logo / sign / **signage** / diagram / chart / panorama / collage 的直接丢弃
  （`\bsign\b` 匹配不到 `signage`，所以两个词都要写）；韩文的 `안내판` / `표지판` / `간세` 同样排除。
- **相关性**：标题命中搜索关键词（具体地标，如 `Hyeopjae`）优先于只写「Jeju」的泛图。
- **必须真的跟济州有关**：标题或描述里要出现 `Jeju / 제주 / Olle / 올레`。Commons 是模糊检索，搜 "Jeju west coast" 会返回「加那利群岛涡旋云」「LNG 码头」「日本航拍」这类图。
- **路线号要对得上**：标题里若写了别条路线的编号（给 16 线选到 `Jejuolle-route-18(1)`），跳过。`route-18` / `route_18` 这类连字符写法同样识别。
- **一张图只服务一条线**：已被前面的路线选中的图不再重复选中（候选全被用光就返回空，让这条线回落到官方路线图，而不是列表里出现两张一样的封面）。
- **末位兜底用官方路线照**：具体地标全落空时，最后会试 `Jeju Olle Route <编号>` / `올레 <编号>코스`——Commons 上有「Jeju Olle Route NN.jpg」这类官方路线照，比纯泛词准得多（16 / 18-1 / 18-2 就是这么命中的）。
- **限流**：请求间隔默认 1.5s（`--sleep` 调大），遇 429 自动退避重试（5s / 10s / 15s）。29 条全量约 2–4 分钟。
- **检索结果缓存**：关键词结果存 `scripts/.cache/photos_search.json`（已被 git 忽略），`--dry` 看过再正式跑不会重复打 API；`--no-cache` 可关。
- **断点续跑**：已经下过的编号自动跳过（`--force` 强制重下）；本次没抓到的条线保留上一轮 `manifest.json` 里的结果，不会因为网络抖一片变灰。分批跑（`--codes`）也安全——已下载的路线会从 manifest 里取回 `title` 参与去重，不会被后面的路线抢走同一张图。

没跑脚本时，卡片封面回落到官方路线图（6.1）；两边都没有才显示「暂无配图」占位，不会报错。

> 注意：照片是「该路线所在地点」的风景照，**不是官方路线的官方摄影**，也**不是实测轨迹**。要拿来做攻略依据，请以官方资料和你自己的实拍为准。
> 若某张图不合适：删掉 `public/photos/scenes/` 下对应文件与 `manifest.json` 里的条目即可（会自动回落到官方路线图）。

## 7. 行前准备页的数据边界

`/prep` 的内容参考偶来小路官网（jejuolle.org）、韩国旅游发展局公开资料与公开游记，整理于 2026-09，写在 `src/lib/prep.ts`。

- **政策类项标了「临行复核」**（红色小标签）：免签口径、K-ETA 是否必需、IDP 租车、紧急电话都会变，出发前自己再确认一遍。
- **偶来护照不是临行复核项**：它是落地济州后在游客中心 / 起点附近店铺现场买的小册子（约 ₩20,000，建议备现金），价格以现场为准，出发前不用查。
- **价格只是常见区间**，用于估预算，以预订平台与门店实时信息为准。
- **不写具体店名与酒店名** —— 没核实过的名字不编，请自己在 Kakao Maps / Naver Maps 上看评价。
- **公交与支付的操作细节**（T-money 开卡费与换乘口径、iOS 开卡限制、STOP 铃与飞站、Uber 当面付等）来自实测经验与公开游记，不是官方条款，变动更快，已在页面里用红色提醒标注，并附参考链接。
- 租车那条是重点提醒：韩国要求短期停留者持 1949 年日内瓦公约纸质 IDP，而**中国大陆驾照不属于可签发 IDP 的范围**，实践中多数车行不接单。要自驾请先与车行书面确认。
- **备选清单（徒步装备 / 女士 / 男士 / 大疆 / 相机 / 无人机）**是「带什么、为什么带」的经验性建议，**不含政策与价格断言**；其中涉及随身液体容量、安检（指甲刀建议托运）等硬规定按常规口径写在 `note` 里当提示，不当承诺。各份清单的文案刻意不与官方 35 项重合 —— 否则会被去重逻辑判成「已在清单」，等于白写。

### checklist 的勾选 / 放弃状态机

`jejuolle100k.checklist`（见 `src/lib/storage.ts` 的 `ChecklistState`）四种 id 集合互斥管理：

| 状态 | 字段 | 含义 |
| --- | --- | --- |
| 已备齐 | `checked` | 打勾的项，计入进度 |
| 已放弃 | `skipped` | 手动放弃的项，**不计入进度分母、也不算未完成**，平时仍展示（灰掉 +「已放弃」标签，可一键「恢复」） |
| 自定义 | `custom` | 自己补充的条目（`PrepItem[]`） |
| 备选已加入 | `extras` | 从「徒步装备/女士常用/男士常用/大疆/相机/无人机」挑进来的条目（`ChecklistExtra[]`，比 `PrepItem` 多一个 `from` 记住来源） |

- 勾选某一项会自动把它从 `skipped` 移除（互斥）；放弃某一项会自动取消其勾选。
- 「只看未完成」会同时隐藏已勾选与已放弃；平时模式放弃的项仍可见，方便随时恢复。
- 「本组全选」只作用于未放弃的项，不会把已放弃的项重新勾上。
- 进度条与各组 `done/total` 只按「未放弃」的项计算。

### 备选清单（徒步装备 / 女士 / 男士 / 大疆 / 相机 / 无人机）怎么进总清单

数据源是 `src/lib/prep.ts` 的 `PREP_PRESETS`，共 6 份、各自独立 id（`gear.*` / `preset.f.*` / `preset.m.*` / `preset.dji.*` / `preset.cam.*` / `preset.uav.*`）。
⚠️ 徒步装备那一份的 id 沿用 `gear.*` —— **本机已存的勾选/放弃状态按 id 记录，改 id 会让用户之前勾过的项全部「失忆」**。
它们**不是默认清单**，只是候选池：`extras` 为空时页面上一个字都不多，用户挑了几条才出现「备选清单已加入」这一组。

| 动作 | 行为 |
| --- | --- |
| 单条「加入」/「移除」 | 写 / 删 `extras` 里的一条，等价于开关，不做二次确认 |
| 「全部加入（N）」 | `ids` 省略 → 整份并入；按钮上的 N 是**去重后真正会新增的条数** |
| 「全部移出」 | 整份从总清单移出（走 Confirm，因为会连带清掉这些条目的勾选/放弃状态） |
| 「重置清单」 | `checked / skipped / custom / extras` 全清 |

去重口径（`addPresetItems`）：**按 id 判「这条加过没」，按 `normItemText(text)` 判「清单里是不是已经有同一件事」**
（忽略全部空白与大小写）。命中的条目不重复写入，选择器里显示为「已在清单」并去掉按钮。
同一条在官方分组里已经存在时也不会再加一遍 —— 所以两份清单的文案是刻意不与官方 43 项重合的。

⚠️ 去重必须在 `setChecklist(prev => ...)` 的 updater 里按 `prev` 计算，不能拿渲染期的 `checklist` 判断：
连点「加入」时渲染期快照是旧的，会重复写入同一条。同理，updater 无新增时返回 `prev` 原对象（React 会跳过重渲染，也不白写一次 localStorage）。

## 8. 出错时不会白屏

两层 `ErrorBoundary`（`src/components/ErrorBoundary.tsx`）：

| 层 | 位置 | 兜住什么 |
| --- | --- | --- |
| 整站 | `main.tsx` 包住 `<App />` | 连 Router / Provider 自己挂了也有页面 |
| 页面 | `App.tsx` 内容区，`key` 绑 pathname | 单个页面崩了顶栏导航还在，切别的页面能继续用；换路由自动重置错误态 |

错误页提供：重试 / 回到首页 / 复制错误信息 / 展开组件栈 / **清空本机数据并重载**（数据里有坏记录时的最后手段，走自研 Modal 二次确认）。

⚠️ 它只捕获**渲染期**错误。事件回调、`setTimeout`、请求回调里的异步错误 React 不会往上抛（表现为"点了没反应"，不会白屏）。
`DataProvider` 的数据加载在 `requestAnimationFrame` 里跑，异常同样冒泡不到 React —— 所以那里单独转成渲染期抛错交给边界，避免卡在骨架屏上假死。

## 9. 部署（Docker + nginx + Dokploy 子路径）

项目是**纯静态前端**（`HashRouter` + `base: './'`），无后端，按 `asset-system-frontend` 的范式打包成 nginx 静态镜像，挂在 `/jeju/` 子路径下，由 Dokploy 的 Traefik 按 PathPrefix 分发。

### 关键文件

| 文件 | 作用 |
| --- | --- |
| `Dockerfile` | 多阶段构建：node 装依赖 + `npm run build`，产物 `dist/` 复制到 nginx 的 `/usr/share/nginx/html/jeju` |
| `nginx.conf.template` | nginx:alpine 启动时会把 `templates/*.template` 经 envsubst 渲染成 `conf.d/default.conf`；本模板只做 `/jeju` → `/jeju/` 重定向 + 静态托管 + SPA 回退 |
| `.dockerignore` | 排除 node_modules / dist / .git / 本地脚本缓存，缩小构建上下文 |
| `.npmrc` | 用 npmmirror 镜像加速容器内 `npm ci` |

> 因为是 `HashRouter` + `base: './'`，`dist/` 资源用相对路径，`/jeju/` 下无需改 `vite.config.ts`，也不需要 history 路由的 rewrite。

### 构建并本地自测镜像

```bash
docker build -t jeju-olle-100k .
docker run --rm -p 8080:80 jeju-olle-100k
# 浏览器打开 http://localhost:8080/jeju/ 验证
```

### 推到 Dokploy

1. Dokploy 新建 **Application**，源码接 GitHub 公开仓 `tanabalu/jeju-olle-100k`（main 分支）。
2. 构建方式选 **Dockerfile**（多阶段已写好，无需额外参数）。
3. 端口：容器暴露 `80`，Dokploy 内网端口填 `80`。
4. **Traefik 路由规则**（PathPrefix）：`Path(\`/jeju\`) || PathPrefix(\`/jeju/\`)`，只匹配 `/jeju` 这一整段路径，避免同域 Pages 的 `/jeju-olle-100k/` 被 Dokploy 抢走。
5. 部署后访问 `https://你的域名/jeju/`（把「你的域名」换成你实际托管该子路径的域名）。

> 换子路径时改两处即可：`Dockerfile` 的 `COPY ... /usr/share/nginx/html/<新路径>` 与 `nginx.conf.template` 里的 `/jeju`、`/jeju/`、`/jeju/index.html`。

## 10. 目录结构

```
src/
  types.ts               数据模型（Route 含 code 路线编号）
  lib/geo.ts             Haversine 里程、爬升（带噪声阈值）、POI 投影到路线
  lib/olleeElevation.ts  29 条路线的真实轨迹高程序列（由 public/tracks.json 派生，脚本生成勿手改）
  lib/storage.ts         localStorage 仓库 + 导入导出
  lib/imageStore.ts      IndexedDB 图片存储与压缩
  lib/seed.ts            29 条偶来小路预置数据（3 / 15 号线拆 A 山线 · B 海线）
  lib/seedStays.ts       沿线住宿 seed（import src/data/stays.json 实时派生，不再内联 3.6 万行副本）
  lib/prep.ts            行前 checklist 与吃喝住行速查数据（政策项标 verify）
  lib/dayPlan.ts         行程单的按天排期与时间序列推算
  store/DataContext.tsx  全局数据 + 素材（官方路线图 / 照片 / 真实轨迹）叠加 + checklist 状态
  hooks/useActivePlan.ts 行程篮操作
  components/            RouteMap / ElevationChart / Modal / Feedback / Skeleton / ErrorBoundary ...
  pages/                 Routes / RouteDetail / Plan / Prep / Admin / Settings
  pages/admin/           基本信息 / 途经点 / 住宿 / 看点 / 相册 五个编辑器
public/photos/           封面风景照（scenes/ + scenes/cover/ + manifest.json + CREDITS.md）与官方路线图（maps/ + maps/cover/ + maps.json）
src/data/stays.json     沿线住宿唯一真源（OSM / TourAPI / Kakao / 人工核对合并；构建期打包，运行时不再 fetch）
public/tracks.json      真实轨迹（import_tracks.py 生成，运行时 fetch 读取）
scripts/fetch_stays.py  Overpass 抓取沿线住宿 → src/data/stays.json
scripts/gen_stay_zh.py  给住宿生成中文名（音译 + 固定映射）
scripts/fetch_stays*.py / gen_stay_*.py  维护 src/data/stays.json（住宿唯一真源）；seedStays.ts 直接派生，不再有 build_seed_stays.py
scripts/fetch_photos.py  Commons 自由授权图片抓取（卡片封面 + 详情页原图两份）
scripts/selftest_fetch_photos.py  fetch_photos 的离线自测（不联网）
scripts/split_route_map.py  官方 Route Map PDF 按路线切割成卡片封面（压缩版）+ 详情页原图
scripts/fill_track_elevation.py  给已入库但缺海拔的轨迹补采 SRTM 30m 海拔（就地改 tracks.json，只动那一条）
scripts/fetch_olle_osm.py   从 OSM（relation + 散 way）与整条 GPX **三源比选**，抓每条线的真实走向（→ tracks/osm/*.geojson）
scripts/selftest_fetch_osm.py  缝合器回归自测（不联网，52 条断言，改缝合逻辑后先跑这个）
scripts/import_tracks.py    GPX / KML / GeoJSON 轨迹导入（认编号、校正走向、抽稀、算里程爬升 → tracks.json）
scripts/selftest_import_tracks.py  导入器回归自测（不联网，改走向校正/导入逻辑后先跑这个）
scripts/check_official_consistency.py  逐条对账「seed.ts 的官方口径 ↔ tracks.json 的实际几何」（改 SPECS 或重导后必跑）
scripts/check-elevation.ts  校验 tracks.json 的海拔与爬升是否自洽
scripts/build_elevation_from_tracks.py  由 tracks.json 派生 seed 用的高程序列（olleeElevation.ts）
```

## 11. 已知边界

- **轨迹是二手几何**：29 条中 28 条来自 OSM / GPX、`15-B` 由 OSM 路网推断，而**官方改线不会自动跟上**。页面里程恒取官方 `SPECS`，
  详情页另给「轨迹实测 X km」作对照。偏差超 ±5% 的有 13 条，其中 **`15-A`（+19.0%）与 `08`（−11.9%）超 ±10%**，
  这两条的**爬升与地图形状打折看**；其余 11 条（`01-1 / 03-A / 05 / 06 / 07 / 13 / 14 / 15-B / 17 / 18 / 21`）在 5~10% 之间。
  - `15-A` 偏长的根因已查明：官方是**改线后**把 15 号线拆成 A/B 的（visitjeju：先前的 15 号线变更为 15-A、15-B
    后重新开放），而它的轨迹来自改线**之前**的旧 15 号线（18.67 km），比新的 15-A（15.5 km）长是必然的。
    想要新的 15-A 几何，得等 OSM 或社区有人按新走向补 —— 目前 OSM 里 15 号线**没有 route 关系**，
    只有散 way（其中标了 A 的 7 条、标了 B 的 1 条），缝出来是 15 段 / 9.93 km 的碎片，达不到可用门槛。
- **海拔分两种来源**：4 条（`09 / 14-1 / 18-1 / 18-2`）是 GPX 自带海拔，其余 25 条由 SRTM 30m 沿轨迹补采样。
  补采值与官方实测爬升必然有差，只用于看剖面形状与量级，别当官方数据引用。
- **官方宣传口径 437km vs 逐条相加 430km**：两个数都对，差约 7km 未明（疑似官方把连接路段算进 437）。
  前端目标里程用推导值 **430**，也就是「全程」快捷预设。想按「实际走完一圈」算（A/B 二选一，同一段路只算一次）设 **403**。
- **自己新建的路线没有轨迹**：地图把它画成**灰绿虚线**（`mapLineSet()` 的 `approx: true`），
  只是把途经点连起来的示意 —— 要准的走向请在后台逐点校正，或导入自己的 GPX。
- **住宿缺评分与价格**：OSM 不提供这两项，页面采取「没有就不显示」，不编造数据。
- **看点 / 相册**仍预置为空，需要按实际行程录入（也可导入 JSON 批量填）。
- 底图瓦片需要联网；离线时地图区域空白，极端情况下降级为 SVG 离线示意图。
