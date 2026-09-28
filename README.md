# 偶来小路 · 百公里攻略（济州岛 Jeju Olle Trail）

把济州岛 27 条偶来小路（올레길）攒成自己的行程，自动算里程、看有没有凑够百公里，顺带管理起终点、沿途住宿、路边景色和相册。

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

首次打开自动写入**官方公布的 27 条偶来小路**（数据来源 jejuolle.org）：

- **21 条主线 + 6 条支线**（1-1 牛岛、7-1、10-1 加波岛、14-1、18-1 上楮子、18-2 下楮子）
- 官方里程已填进「实际里程」，因此**里程以官方值为准**，不走直线估算
- 官方难度 Low / Medium / High 已映射为 2 / 3 / 4 星
- 主线单条 10.1 ~ 20.9 km，官方全程合计 **437 km**

| 数据来源 | 准确度 | 需要你自己补的 |
| --- | --- | --- |
| 编号、起终点名称、官方里程、官方难度 | 官方网站，可直接用 | — |
| 起终点经纬度 | **城镇级近似坐标，非官方实测轨迹** | 用 `scripts/import_tracks.py` 导入真实轨迹一键替换，或在后台用地图选点校正 |
| 海拔与累计爬升 | **SRTM 30m 地形数据沿近似路径采样估算**，非官方实测 | 导入真实 GPX 后自动改按轨迹逐点累加（更准） |
| 卡片封面 | **官方 Route Map 路线图整页**（© Jeju Olle Foundation），26 条有图、18-2 无官方页 | 想换自己的照片：`/admin`「基本信息」里传一张 |
| 住宿、看点、相册 | 预置为空 | 在 `/admin` 录入 |

### 爬升是怎么算出来的（重要）

预置路线的海拔序列由 `scripts/fetch_elevation.py` 抓取，来源是 opentopodata.org 公开的
**SRTM 30m** 数据集，结果落在 `src/lib/olleeElevation.ts`（构建时打进产物，运行时不联网）。

- **非环线**：沿「起点→终点」直线均匀采样（每条 20~43 点）
- **环线**（牛岛 / 加波岛 / 上下楮子）：按官方里程反推的圆周采样
- 爬升用**带 3m 滞后阈值**的相邻差累加，抑制地形数据本身的抖动

⚠️ 这是**估算，不是官方实测爬升**：真实路线沿海岸蜿蜒、会翻越海岸小山丘，
直线采样覆盖不到，所以实际爬升通常比显示值更大。27 条合计约 2230 m，
拿来对「哪条更费力」排序可以，拿来配速和算补给请用真实轨迹（见下一节，导入后爬升会自动改按轨迹算）。

想刷新这些数据：

```bash
python3 scripts/fetch_elevation.py            # 重抓全部（有本地缓存，只补缺失）
python3 scripts/fetch_elevation.py --limit 2  # 先试 2 条看效果
python3 scripts/fetch_elevation.py --force    # 忽略缓存全部重抓
```

自己新建的路线没有采样数据，在 `/admin` 的「途经点」里给每个点填海拔即可；
**少于 2 个点有海拔时，爬升显示「—」而不是 0**（0 会让人误以为这条路是平的）。

### 用真实轨迹替换近似坐标（推荐）

预置坐标是**城镇级近似**，落在地图上是「大概这一带」，用来排序和看分布没问题，
但**导航、算补给、算真实爬升都不该用它**。

#### 轨迹从哪来

| 源 | 能拿到什么 | 怎么拿 |
| --- | --- | --- |
| **OSM 的 route relation**（首选） | **整条线的真实走向**——OSM 里部分偶来小路建了 `route=hiking` 关系（例：`올레길 19코스` = relation 9173551，79 个成员 way），成员就是实际步道/村道的 way，缝起来即可照着走 | `python3 scripts/fetch_olle_osm.py` |
| 官方 jejuolle.org | **只有起终点坐标**（如 7-1 线 `33.249104,126.508588 → 33.247461,126.558717`），拿不到中间走向 —— 用它还是只能画一根直线 | 官网各路线页 |
| hikeonearth.com | 整条 440 km 的**一个** GPX | 网站下载，需自己按线切开 |
| Wikiloc / AllTrails | 单条路线的个人 GPS 轨迹，**带真实海拔**（含气压计记录） | 注册后下载 GPX，补离岛支线最有用 |
| 你自己走 | 最真实 | 手机记录导出 GPX |

⚠️ **OSM 覆盖不全，这是最大的现实约束**：第一次跑只拿到 **19 个关系**（覆盖 01–11、16、18、19、20），
**12、13、14、15、17、21 以及 6 条支线（01-1 / 07-1 / 10-1 / 14-1 / 18-1 / 18-2）OSM 里根本没有关系**。
这不是脚本的问题 —— 报表里「根本没出现的编号」就是 OSM 没建，只能换源（hikeonearth 整条 GPX、
或 Wikiloc 单条下线），再丢给 `import_tracks.py`，两条链路是通的。

OSM 是众包数据：走向大体准确（都是照着指示带走过的），但**关系里的 way 是无序集合**，
还常有缺口（少画一段、被拆成父子关系、A/B 变体并存）。`fetch_olle_osm.py` 因此做了三件事：

1. **缝合按节点级匹配**，不是只看端点 —— 一条长 way 的中途节点被别的 way 接上是常态，
   只比端点会把它误判成断口，图上凭空多出一段跳线。岔路口按**直行优先**选下一段。
2. **接不上就收尾分段，不用直线硬连**。段与段之间就是 OSM 真没画的地方，导出成
   `MultiLineString`，前端按段画 → 地图上是**真的缺口**，不伪造。
3. **报表给出每条的判定**：`✅ 可用 / ⚠️ 有缺段 / ⛔ 太零碎`，判定看的是
   「实走里程 ÷ 官方里程」（默认 <60% 不可用）与「断口占比」（默认 >35% 不可用）。
   ⛔ 的不导出 —— 宁可这条线保持「近似」，也不给它半条线冒充整条。
   想连 ⛔ 的一起导就加 `--keep-bad`。

#### 跑

```bash
# 1) 从 OSM 抓真实走向（导出 tracks/osm/olle-<编号>.geojson）
python3 scripts/fetch_olle_osm.py --dry          # 先只看覆盖情况与判定，不写文件
python3 scripts/fetch_olle_osm.py

# 2) 转成前端格式，并联网补海拔（OSM 的 way 上没有海拔）
python3 scripts/import_tracks.py --src tracks/osm --elevation
```

`--dry` 的报表里有三样东西值得看：**覆盖**（实走 ÷ 官方）、**断口**（几处/总长）、**判定**；
底下「诊断」一节会列出成员构成（子关系 / 节点 / role）、岔路与劈开次数、最大的几个断口坐标
—— 用来判断某个断口是「OSM 真没画」还是「缝合出错」。

拿到别处的 GPX/KML 也一样，丢进一个目录直接导：

```bash
# 文件名带路线编号即可（1 / 01 / 10-1 都认）
python3 scripts/import_tracks.py --src ~/Downloads/jeju-olle-tracks --elevation
python3 scripts/import_tracks.py --src ~/tracks --dry        # 先看识别结果
python3 scripts/import_tracks.py --src ~/tracks --strict     # 有未识别文件就退出
```

- 文件名认不出编号的用 `--map 文件名=编号` 指定；轨迹方向反了用 `--reverse 01`。
  OSM 里的 A/B 变体（`3코스-A`、`15코스-B`）用 `--alias 03-A=03` 手工归到你的编号。
- **有断口的轨迹按「分段」处理**（GPX 多个 `<trkseg>`、KML 多个 `<coordinates>`、
  GeoJSON 的 `MultiLineString`）：段与段之间是数据真空，
  - 地图按段画，**不连线**，缺口就留缺口；
  - 里程是各段之和，**爬升逐段累加** —— 跨段那截海拔未知，混着算会凭空多出一大截；
  - `tracks.json` 里段数 > 1 才写 `segments`，前端据此走多段绘制。
- 落盘结果是 `public/tracks.json`，**运行时 `fetch` 读取，不进 localStorage**，换轨迹直接替换文件即可。
- 有轨迹的路线，地图按真实轨迹画线、起终点吸附到轨迹首末点；
  **累计爬升与海拔区间改按轨迹逐点累加**（标高提示变为「取自真实轨迹」）；
  里程仍**以官方值为准**，详情页同时给出「轨迹实测 X km」便于对照。
  没轨迹的仍走原来的近似逻辑，互不影响。
- 轨迹抽稀默认容差 8 m / 上限 420 点（Douglas–Peucker，**预算按所有段合计算**），既保形状又不让产物膨胀。
- 与官方里程偏差 >25% 会告警（多半是编号认错、轨迹含接驳段，或 OSM 那块没画完），先核对再落盘。
- 只有轨迹没海拔也能用：总里程照算，爬升显示「—」并提示「暂缺海拔数据」；
  加 `--elevation` 就用 opentopodata 的 SRTM 30m 补上（同一份数据源口径与预置剖面一致，结果有缓存）。

## 2. 功能

| 模块 | 页面 | 能做什么 |
| --- | --- | --- |
| 路线列表 | `/` | 27 条按编号排列；搜索（名称/地区/标签，支持「偶来 07」「西归浦」）、按类型筛选、按编号/里程/更新时间/名称排序；顶部行程篮可直接切换；卡片一键加入行程篮 |
| 路线详情 | `/routes/:id` | 地图看起终点、海拔剖面、沿途住宿（自动算「沿线 N km / 离路线 N km」）、路边景色、相册灯箱 |
| 行程篮 | `/plan` | 把路线加进来（**每条路线只算一次**，已加入的按钮置灰）、自定义目标里程（快捷选 **100** 或 **437 全程**），实时算累计并判达标；差多少给补线建议；**默认按加入顺序排列**（可切「按里程」），复制的 Markdown 跟随当前顺序；每条可勾选「已走完」查看走线进度（X/Y 条 + 已走里程），支持「只看未完成」 |
| 行前准备 | `/prep` | 济州岛 checklist（6 组 43 项，可勾选、手动放弃/恢复、只看未完成、自己加条目；已放弃项集中在「补充我自己的条目」下方可查看与逐项/一键恢复）+ 吃喝住行速查（含 T-money 办卡/乘车要点、导航 App 对比、打车支付）与预算粗算 |
| 素材管理 | `/admin` | 路线增删改（含编号）；途经点支持地图点选与上下调序；住宿、看点（多图）、相册（本地上传自动压缩或外链）；JSON 导入导出 |
| 设置 | `/settings` | 地图底图样式、清空数据 |

> 页脚署名：底图服务 OpenStreetMap、数据来源 **jejuolletrailguide.net**（Jeju Olle Trail 官方英文指南）；该站同时列在页脚「友情链接」里（外链一律新开标签页 + `rel="noopener noreferrer"`）。友链列表在 `src/App.tsx` 的 `FRIEND_LINKS`，加一条即可。

凑百公里的典型用法：主线平均 15~20 km，**挑 6 条左右就到 100 km**；想走完全岛就把目标设成 437。

## 3. 数据存哪

| 内容 | 位置 |
| --- | --- |
| 路线 / 行程篮 / 设置 | `localStorage`（key 前缀 `trail100k.`） |
| 行前 checklist 的勾选与自定义条目 | `localStorage` 的 `trail100k.checklist` |
| 本地上传的图片 | `IndexedDB`（库 `trail100k` → store `images`），上传时压到最长边 1600px、JPEG 0.82 |

数据不上传任何服务器。换设备或清浏览器前，到 `/admin` 顶部「导出 JSON」备份，换机后「导入 JSON」恢复（可选合并/替换）。

## 4. 里程怎么算

| 场景 | 取值 |
| --- | --- |
| 预置的偶来路线 | 官方里程（`manualDistanceKm`）优先，不估 |
| 你自己新建、未手填的路线 | 相邻途经点直线距离累加 × 1.2（绕行系数） |
| 爬升 | 优先用「地形采样序列」算（带 3m 阈值）；没有采样就退回途经点海拔；手填「实际累计爬升」最优先；都没有则显示「—」 |

行程篮：每条路线只计一次，全部里程之和与目标比对，直接给出「已达标 / 还差 N km」，并按缺口大小推荐还能补的路线。

## 5. 地图底图说明

底图用 **Leaflet** 渲染，数据来自 **OpenStreetMap**（瓦片由 OpenStreetMap / OpenTopoMap 公共服务提供），全球覆盖，济州岛的街道、海岸线、地形都能正常显示，**不需要申请 Key，也不需要任何配置**。

| 底图样式 | 瓦片来源 | 特点 |
| --- | --- | --- |
| 标准地图（默认） | OpenStreetMap `tile.openstreetmap.org` | 道路、POI、地名等要素最全 |
| 地形图 | OpenTopoMap `tile.opentopomap.org` | 等高线 + 山体阴影，适合徒步 / 越野判断爬升 |

> ⚠️ 图源选型注意：**不要用 CARTO**（`basemaps.cartocdn.com`）——它现在对匿名请求强制返回带 "API key required" 水印的瓦片，需要自己申请 Key。OSM / OpenTopoMap 的公共服务才是真正免 Key 的。

样式在「设置」页一键切换、立即生效，选择存在本机。

- 瓦片需要联网加载，**离线时地图区域为空白**，其余功能不受影响。
- 极端情况下 Leaflet 初始化失败会自动降级为**离线示意图**（SVG 投影），仍可点击反算经纬度。
- 坐标统一为 **WGS-84**（与 OSM 一致）。济州岛在中国境外，GCJ-02 偏移算法在境外不生效，因此历史坐标与 WGS-84 等价，换底图不会产生位置偏移。

> ⚠️ 合规提示：OpenStreetMap / OpenTopoMap 属境外图源，**不适用于面向中国大陆的测绘地图产品**。本项目定位是济州岛（海外）徒步攻略的个人自用工具，用境外图源没问题；若将来要对大陆用户作为测绘产品发布，需换回具备测绘资质且能覆盖目标区域的底图服务。

## 6. 路线配图与封面

卡片封面用**官方路线图**（每条线一整页），相册用 **Wikimedia Commons 自由授权照片**。两套素材都放在 `public/photos/`，前端启动时读清单按路线编号自动绑定（**不写进 localStorage**，换图直接替换文件即可）。

### 6.1 官方路线图 → 卡片封面

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

**为什么一份图出两个尺寸**：卡片封面在列表里只渲染到约 300–400px 宽（`.cards` 是 `minmax(min(300px,100%),1fr)`），把 1432px 的原图塞进去纯属浪费——首页 26 张封面要拉 2.5MB。封面单独压一份后首屏只要 0.65MB，而详情页相册/灯箱照旧显示 1432px 原图，放大看地名不受影响。

压缩是**本地**做的（Pillow 降尺寸 + WebP 降质，`--cover-width` / `--cover-quality` 可调），效果与 TinyPNG / tinyimg 这类在线服务同类，但不需要 API key、不需要把图片上传到第三方，且可复现。想换在线服务也可以，只要把压缩结果覆盖到 `maps/cover/` 同名文件即可。

几个约定：

- **不要裁切**。官方页是 842×596 的横版，地图铺满整页，裁掉上下 30% 会切到路线本体（01 线南端、10-1 的济州本岛侧都会被切）。封面侧的 `.route-cover` 用 `aspect-ratio: 842 / 596` 按页面比例留位，零裁切。
- **页码 ↔ 路线号必须核对**。脚本里的 `PAGE_CODES` 是按每页右下角印的粗体路线号整理的（PDF 第 1 页是封面，2~27 页才是路线）。换新版 PDF 一定要重新核对这张表，否则会把路线号配错。
- 这份 2017.10 版**没有 Route 18-2（下楮子岛）那一页**，所以 18-2 走「暂无配图」占位。
- 封面优先级：**后台自己设的 cover > 官方路线图 > Commons 照片**。想换成自己的照片，在 `/admin` 的「基本信息」里传一张即可。

> ⚠️ 官方路线图版权归 **© Jeju Olle Foundation**，PDF 内页明确写着「未经许可禁止为商业目的翻印、复制与分发」。本项目是个人自用攻略工具、非商业用途，且相册与灯箱里都显示了署名的 `credit`；**不要拿去商用**。

### 6.2 相册配图（Wikimedia Commons 自由授权）

小红书等站点的图片有版权且禁止抓取，**不要**批量扒下来放进项目。本项目改用 Wikimedia Commons 的自由授权作品（CC0 / CC-BY / 公共领域）。

```bash
# 下载 27 条路线的配图（需要能访问 commons.wikimedia.org 的网络）
python3 scripts/fetch_photos.py            # 全量
python3 scripts/fetch_photos.py --limit 2  # 先跑 2 条试试
python3 scripts/fetch_photos.py --dry      # 只检索不下载
```

脚本会产出：

| 文件 | 作用 |
| --- | --- |
| `public/photos/olle-<编号>.jpg` | 配图（最长边 1600px） |
| `public/photos/manifest.json` | 编号 → 图片的映射，前端启动时自动读取并绑定到对应路线（**不写进 localStorage**，换图直接替换文件） |
| `public/photos/CREDITS.md` | 署名清单（作者 / 许可 / 来源页），满足 CC-BY 的署名要求，请随项目一起分发 |

没跑脚本时相册为空，界面显示「无图」占位，不会报错。

> 注意：照片是「该路线所在地点」的示意照片，**不是官方路线的官方摄影**，也**不是实测轨迹**。要拿来做攻略依据，请以官方资料和你自己的实拍为准。
> 若某张图不合适：删掉 `public/photos/` 下对应文件与 `manifest.json` 里的条目即可。

## 7. 行前准备页的数据边界

`/prep` 的内容参考偶来小路官网（jejuolle.org）、韩国旅游发展局公开资料与公开游记，整理于 2026-09，写在 `src/lib/prep.ts`。

- **政策类项标了「临行复核」**（红色小标签）：免签口径、K-ETA 是否必需、IDP 租车、偶来护照价格与紧急电话都会变，出发前自己再确认一遍。
- **价格只是常见区间**，用于估预算，以预订平台与门店实时信息为准。
- **不写具体店名与酒店名** —— 没核实过的名字不编，请自己在 Kakao Maps / Naver Maps 上看评价。
- **公交与支付的操作细节**（T-money 开卡费与换乘口径、iOS 开卡限制、STOP 铃与飞站、Uber 当面付等）来自实测经验与公开游记，不是官方条款，变动更快，已在页面里用红色提醒标注，并附参考链接。
- 租车那条是重点提醒：韩国要求短期停留者持 1949 年日内瓦公约纸质 IDP，而**中国大陆驾照不属于可签发 IDP 的范围**，实践中多数车行不接单。要自驾请先与车行书面确认。

### checklist 的勾选 / 放弃状态机

`trail100k.checklist`（见 `src/lib/storage.ts` 的 `ChecklistState`）三种 id 集合互斥管理：

| 状态 | 字段 | 含义 |
| --- | --- | --- |
| 已备齐 | `checked` | 打勾的项，计入进度 |
| 已放弃 | `skipped` | 手动放弃的项，**不计入进度分母、也不算未完成**，平时仍展示（灰掉 +「已放弃」标签，可一键「恢复」） |
| 自定义 | `custom` | 自己补充的条目（`PrepItem[]`） |

- 勾选某一项会自动把它从 `skipped` 移除（互斥）；放弃某一项会自动取消其勾选。
- 「只看未完成」会同时隐藏已勾选与已放弃；平时模式放弃的项仍可见，方便随时恢复。
- 「本组全选」只作用于未放弃的项，不会把已放弃的项重新勾上。
- 进度条与各组 `done/total` 只按「未放弃」的项计算。

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
docker build -t trail-100k .
docker run --rm -p 8080:80 trail-100k
# 浏览器打开 http://localhost:8080/jeju/ 验证
```

### 推到 Dokploy

1. Dokploy 新建 **Application**，源码接 GitHub 公开仓 `tanabalu/trail-100k`（main 分支）。
2. 构建方式选 **Dockerfile**（多阶段已写好，无需额外参数）。
3. 端口：容器暴露 `80`，Dokploy 内网端口填 `80`。
4. **Traefik 路由规则**（PathPrefix）：`PathPrefix(\`/jeju\`)`，与 nginx 里的 `/jeju/` 对应（Traefik 的 PathPrefix 会自动匹配 `/jeju` 和 `/jeju/...`）。
5. 部署后访问 `https://你的域名/jeju/`（把「你的域名」换成你实际托管该子路径的域名）。

> 换子路径时改两处即可：`Dockerfile` 的 `COPY ... /usr/share/nginx/html/<新路径>` 与 `nginx.conf.template` 里的 `/jeju`、`/jeju/`、`/jeju/index.html`。

## 10. 目录结构

```
src/
  types.ts               数据模型（Route 含 code 路线编号）
  lib/geo.ts             Haversine 里程、爬升（带噪声阈值）、POI 投影到路线
  lib/olleeElevation.ts  27 条路线的地形采样序列（脚本生成，勿手改）
  lib/storage.ts         localStorage 仓库 + 导入导出
  lib/imageStore.ts      IndexedDB 图片存储与压缩
  lib/seed.ts            27 条偶来小路预置数据
  lib/prep.ts            行前 checklist 与吃喝住行速查数据（政策项标 verify）
  store/DataContext.tsx  全局数据 + 素材（官方路线图 / 照片 / 真实轨迹）叠加 + checklist 状态
  hooks/useActivePlan.ts 行程篮操作
  components/            RouteMap / ElevationChart / Modal / Feedback / Skeleton / ErrorBoundary ...
  pages/                 Routes / RouteDetail / Plan / Prep / Admin / Settings
  pages/admin/           基本信息 / 途经点 / 住宿 / 看点 / 相册 五个编辑器
public/photos/           官方路线图（maps/ + maps/cover/ + maps.json）与相册配图、署名清单
public/tracks.json       真实轨迹（import_tracks.py 生成，运行时 fetch 读取）
scripts/fetch_photos.py  Commons 自由授权图片抓取脚本
scripts/split_route_map.py  官方 Route Map PDF 按路线切割成卡片封面（压缩版）+ 详情页原图
scripts/fetch_elevation.py  SRTM 30m 高程抓取脚本（生成 olleeElevation.ts）
scripts/fetch_olle_osm.py   从 OSM route relation 抓取每条线的真实走向（→ tracks/osm/*.geojson）
scripts/import_tracks.py    GPX / KML / GeoJSON 轨迹导入（认编号、抽稀、算里程爬升 → tracks.json）
```

## 11. 已知边界与后续可做

- 预置坐标为城镇级近似值，**不是官方轨迹**；已提供 `scripts/import_tracks.py` 导入真实轨迹替换
  （地图画线、总里程、爬升全部改按轨迹走），把官方 / 自采轨迹放进 `public/tracks.json` 即生效。
- 住宿 / 看点 / 相册预置为空，需要你按实际行程录入（也可导入 JSON 批量填）。
- 底图使用 OpenStreetMap / OpenTopoMap 免费瓦片，需要联网；若在无网环境使用，可用离线示意图 + 后台手动校正坐标。
