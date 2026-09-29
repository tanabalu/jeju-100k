# Jeju Olle Trail · 100K Guide (Jeju Island 제주올레)

> 🌐 Language: [中文](README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md)
>
> This document translates the user- and deployment-facing sections. The data-acquisition developer log (§1.3 "Replace approximate coordinates with real tracks" — OSM three-source comparison, historical import records) is kept in Chinese in `README.md`. See the link above.

## Overview

Turn Jeju Island's 27 Olle trails (올레길) into your own itinerary: automatically calculate distance, see whether you've pieced together a 100 km, and manage start/end points, roadside lodging, scenery, and a photo album.

Pure front-end. Data is saved in the local browser (localStorage + IndexedDB). Dependencies are managed with npm; end users use the static site produced by `npm run build`.

## Quick Start (Overview)

| Step | Command | Description |
| --- | --- | --- |
| 1 | `npm install` | Install dependencies |
| 2 | `npm run dev` | Local development, open http://127.0.0.1:5180 |
| 3 | `npm run build` | Produce `dist/`, the static site end users use |
| 4 | `npm run preview` | Verify the build locally |
| 5 | Deploy (optional) | Serve `dist/` from any static server / Dokploy subpath |

> Key: **Basemap data comes from OpenStreetMap — global coverage, no API key needed**. Jeju's streets, coastline, and terrain all render normally; when offline the map area is blank but core functions like distance tallying are unaffected. See §5.

## 1. What's preloaded

On first open, the **official 27 Olle trails** (source: jejuolle.org) are written automatically:

- **21 main routes + 6 branch routes** (1-1 Udo Island, 7-1, 10-1 Gapado, 14-1, 18-1 Sangchujado, 18-2 Hajuchado)
- Official distances are filled into "actual distance", so **distance uses official values**, not straight-line estimates
- Official difficulty Low / Medium / High mapped to 2 / 3 / 4 stars
- Main routes are 10.1–20.9 km each; **27 routes total 403 km** (`OLLE_TOTAL_KM` is derived from `SPECS`, not hard-coded — the homepage's "437km 27코스" is a marketing figure, see "Official distance has versions" below)

| Data source | Accuracy | What you must supply yourself |
| --- | --- | --- |
| Route numbers, start/end names, official distance, official difficulty | Official website, directly usable | — |
| Start/end lat/lng | **Town-level approximate coordinates, not official measured tracks** | Import real tracks with `scripts/import_tracks.py` to replace in one step, or correct via map point-picking in the admin panel |
| Elevation & cumulative climb | **SRTM 30m terrain sampled along the approximate path — estimate, not official** | After importing real GPX, automatically switches to per-point accumulation along the track (more accurate) |
| Card cover | **Official Route Map page** (© Jeju Olle Foundation), 26 routes have images, 18-2 has no official page | To use your own photo: upload one in `/admin` "Basic Info" |
| Lodging, sights, album | Preloaded empty | Enter in `/admin` |

### How climb is calculated (important)

The preset routes' elevation series are fetched by `scripts/fetch_elevation.py` from opentopodata.org's public **SRTM 30m** dataset, landing in `src/lib/olleeElevation.ts` (bundled at build time, no network at runtime).

- **Non-loop routes**: uniform sampling along the "start → end" line (20–43 points each)
- **Loop routes** (Udo / Gapado / Sang/Hajuchado): circular sampling inferred from official distance
- Climb uses a **3m hysteresis threshold** on adjacent differences to suppress terrain-data jitter

⚠️ This is an **estimate, not official measured climb**: the real route winds along the coast and climbs small coastal hills that straight-line sampling can't capture, so actual climb is usually larger than shown. 27 routes total ~2230 m — fine for ranking "which is harder", but for pacing and resupply planning use real tracks (see next section; after import, climb auto-switches to track-based).

To refresh this data:

```bash
python3 scripts/fetch_elevation.py            # refetch all (has local cache, only fills missing)
python3 scripts/fetch_elevation.py --limit 2  # try 2 first to see effect
python3 scripts/fetch_elevation.py --force    # ignore cache, refetch all
```

Routes you create yourself have no sampled data; fill elevation per point in `/admin` "Waypoints"; **with fewer than 2 points having elevation, climb shows "—" not 0** (0 would falsely imply the route is flat).

### 1.3 Replace approximate coordinates with real tracks (developer log — Chinese only)

> ⚠️ **dev log, zh only.** The following section is kept in Chinese. See `README.md` §1.3 for the original.
>
> 预置坐标是**城镇级近似**，落在地图上是「大概这一带」，用来排序和看分布没问题，
> 但**导航、算补给、算真实爬升都不该用它**。
>
> #### 轨迹从哪来（**三个数据源，逐条比选，谁可信用谁**）
>
> | 源 | 能拿到什么 | 怎么拿 |
> | --- | --- | --- |
> | ① **OSM 的 route relation** | 整条线的真实走向。但偶来在 OSM 里**只建了一部分**关系 | `fetch_olle_osm.py`（默认） |
> | ② **OSM 里名字带编号的散 way** | **没有关系的那几条线（12/13/14/15 等）在这里** | `fetch_olle_osm.py`（默认，自动） |
> | ③ **按课程分段的整条偶来 GPX** | 25 条课程轨迹，**首尾严格相接**，覆盖 01–21 + 3A/3B/7-1/10-1/14-1 | `fetch_olle_osm.py --gpx <文件>` |
> | 官方 jejuolle.org | 起终点 GPS + 里程表（**没有中间走向**） | 官网；`seed.ts` 的 `SPECS` 就是它 |
> | Wikiloc / AllTrails | 单条路线的个人 GPS 轨迹（带真实海拔） | 注册后下载 GPX |
> | 你自己走 | 最真实 | 手机记录导出 GPX |
>
> > ⚠️ **只看 ① 会得出完全错误的结论。** 本项目一度就是这么错的：按 relation 判定
> > 「12、13、14、15、17、21 在 OSM 里没有数据」——**relation 确实没有，但散 way 有**。
> > 全岛 `highway` + 名字含「올레 / Olle」的 way **722 条**，12 有 77 条、13 有 74 条、15 有 96 条。
> > 前端当时只能把 `seed.ts` 的**城镇级近似坐标**连成一根斜穿岛内的直线 —— 就是地图上那根
> > 从西南直插东北的假线。**判断「某个源没有」之前，先把别的源都查一遍。**
>
> ##### 三个坑（都踩过，都静默）
>
> 1. **两套命名习惯覆盖同一段路**：`올레길 12`（韩文，零散 7 条）与 `Ollegil 12`（英文，完整 70 条）。
>    混在一个池子里缝 = 同一段路喂两遍（12 只能画出 43%）。`named_ways()` 按 **(编号, 命名习惯)** 分组。
> 2. **`Ollegil N` 几乎全是 `footway`**（12 号：73 条 footway + 4 条 unclassified，中位 138m），
>    只覆盖离路段步道，被村道隔成 16 段 —— **光靠散 way 也拼不出完整线路**（这是 ③ 存在的理由）。
> 3. **`<trkpt lat=".." lon="..">` 是 lat 在前**。解析时读成 `(lng, lat)` 才对，摆反**不报错**，
>    但里程全是垃圾（实测 374.6km，正确值 384.6km）。
>
> ##### OSM 覆盖实况（2026-09-28 实测）
>
> - 框内 `route=hiking` 关系共 **25 个**，其中名字含「올레」的 **20 个**；另外 3 个是汉拿山登山道
>   （관음사코스 / 사라오름코스 / 성판악코스）—— 加 `--broad` 复查过，没有漏掉偶来的线。
> - 能用的 relation 覆盖 **01–06、08–11、16、18、19、20**。
> - **12、13、14、15、17、21 没有 relation**，靠 ②③ 补；离岛支线：**01-1（牛岛）已补真实海岸环线**——
>   OSM `우도해안길` 海岸路，桥接 89m 缺口 → **12.0km 连续环线**（官方 13.2km，差 −9%）；
>   **18-1（上楮子）已补真实步道片段**——OSM `올레길 18-1` 的 25 条步道缝成 **9 段**，
>   段间缺口最大 3.5km，前端按段画、缺口留空不连线；片段总长 14.5km 比官方 11.4km 长，
>   因含绕行/观景点支线，**里程标签仍以官方 11.4km 为准**；
>   **18-2（下楮子）三源（relation / 散 way / GPX）均无数据，仍保持「示意虚线」**。
> - **07 的两套几何都是「改线前」的旧走向，都不能用**：OSM relation 19.80km（154%）、
>   hikeonearth 的 GPX 段 12.75km（98%，**光看里程完全看不出问题**）—— 两者的终点都落在**月坪**，
>   拿官方 GPS 端点一卡就露馅。官方**现行** 7 线是「제주올레여행자센터 → 서귀포버스터미널 **12.9km**」
>   （对应 2026-07-01「7코스 법환포구 구간 변경」）。所以 **07 保持「示意虚线」**，
>   等拿到 2026-07 之后的单条 GPX 再导入替换。
>
> > ⚠️ **OSM / GPX 都是历史快照，官方改线它不会自动跟上**。官方站会发「코스 구간 변경」公告
> > （例：2026-07-01「제주올레 7코스 법환포구 구간 변경」）。拿走向前先核官方里程差得不离谱。
>
> OSM 是众包数据：走向大体准确（都是照着指示带走过的），但**关系里的 way 是无序集合**，
> 还常有缺口（少画一段、被拆成父子关系、A/B 变体并存）。`fetch_olle_osm.py` 因此做了五件事：
>
> 1. **缝合按节点级匹配**，不是只看端点 —— 一条长 way 的中途节点被别的 way 接上是常态，
>    只比端点会把它误判成断口，图上凭空多出一段跳线。岔路口按**直行优先**选下一段。
> 2. **接不上就收尾分段，不用直线硬连**。段与段之间就是 OSM 真没画的地方，导出成
>    `MultiLineString`，前端按段画 → 地图上是**真的缺口**，不伪造。
>    被拆成「父关系 + 子关系」的线，`out geom` 不会递归下去，脚本会**按 id 精确补一次**
>    （不依赖 `rel(br.r)`，因为部分镜像不支持它、直接回 400）。
> 3. **拒绝「闭合旁路」**：如果走完候选 way 会落回链子**内部**已经走过的节点，说明它是
>    一条绕一圈回到原路的**替代支线**（OSM 常把 A/B 变体、无障碍路线塞在同一个关系里），
>    不是一个「往前走」的候选。这类段会被剔出几何与里程，报表如实写明剔了多长；
>    加 `--keep-parallel` 可保留原样。**实测证据只有 03**（剔前 29.76km/142% → 剔后 22.71km/109%）
>    与 05（15.33→14.60，剔 0.74km）—— 别拿它解释所有超长。
> 4. **段内折返单独报数**：同一节点在一段里被走了两次 → 中间那几公里是白走的，而且
>    **剔不掉**（它长在这一段里面），报表会给出「折返 N 处 / 共 X km」。
>    剩下的判断交给地图：要么这条线在 OSM 里本就含往返段（观景台来回），要么缝合走岔了。
> 5. **三个数据源逐条比选，打分不看里程长短**：`RANK = ✅0 / ⚠️1 / ⛔2 / —3`，
>    同档比**断口总长**，再平手才比「覆盖更接近 1.0」。
>    候选来源写着 `relation` / `ways-ko` / `ways-en` / `gpx` / `both-xx`，
>    报表里 `*` 标出选中的那个，落选的也全列出来（含里程/断口/判定）。
>    ⚠️ **只比里程长短会选错**：更长的那个往往只是混进了替代支线或邻线延伸。
> 6. **补缺只「补缺」，不取并集**：`uncovered_ways()` 只剪出 base 上真没有的那几段，
>    并且**逐套命名分别做**（同一段路在韩文名 / 英文名 / GPX 里各有一份，混起来缝就是重复）。
>    另有一道不变量：**合并结果不得比 base 短**（`add_merge`），否则放弃该候选并写明原因。
> 7. **报表给出每条的判定**：`✅ 可用 / ⚠️ 有缺段 / ⛔ 不可用`，看三条：
>    「实走 ÷ 官方」**<60%**（只画了一半）、**>130%**（走向与官方里程不符）、
>    「断口占比」**>35%**。⛔ 的不导出 —— 宁可这条线保持「近似」，
>    也不给它半条线、或走向对不上的线冒充。想连 ⛔ 的一起导就加 `--keep-bad`，
>    只关掉「超长」这道闸就加 `--max-coverage 0`。
> 8. ⭐ **第 4 道闸门：官方 GPS 端点校验**（`endpoint_verdict`，容差 2km）。
>    **里程对了 ≠ 走向对了** —— 实测 GPX 里的 07 段是 12.75km / 99%，看着完美，
>    但终点离官方「西归浦巴士总站」4.8km，走的是另一条线。只靠里程闸门拦不住这种。
>    端点取自 `seed.ts` 里标了 `// 官方 GPS` 的两个点 + `SPECS` 的起终点。
> 9. **明确排除清单**（`SKIP`）：现有几套几何**没有一套能拼成连贯的线**时，宁可留示意虚线。
>    目前只有 `14-1`（散 way 缝出来 4 段首尾乱跳；GPX 段 189% 超长）。
>    **故意写成「对某一条线的判断」而不是继续调阈值** —— 阈值是全局的，为一条线放宽会连带影响另外 20 多条。
>
> > ⭐ **一条极灵的判伪口径**：**实走里程 ≤ 官方里程**。一条线不可能比它自己长。
> > 倒挂只有三种原因，诊断区会分开报：
> > ① 替代支线/变体混进关系（**并联段**，两端挂回主线）→ 剔掉；
> > ② 段内折返（**同一节点走两次**）→ 剔不掉，只报数；
> > ③ **这个源映射的根本不是那条线**（官方已改线、OSM 还留着旧走向）→ 几何完全自洽，
> > 内部一致性检查查不出来，**只能靠里程倒挂发现**（实测 07 的 relation = 154%）。
> >
> > ⚠️ **但它的前提是基准本身是对的。** 官方里程只在 `src/lib/seed.ts` 的 `SPECS` 里存一份
> > （网页上给用户显示的就是它），脚本从那里读（`load_official_km`，解析不出来就大声报错）。
> > 脚本里曾手抄过一份副本，写着 09=8.0（官方 12.3）、18=19.8（官方 17.1）、15=19.0（官方 15.5），
> > 13 条是旧资料口径 —— 结果把 99% 正常的 **09 判成「153%、比官方长」**，白查了一轮缝合算法。
> > **判「超长」之前，先用官方站的里程表核一遍基准。**
>
> #### ⚠️ 官方里程有「版本」，基准只认两个现行源（2026-09-29 核实）
>
> 偶来各线的**起终点与里程改过好几轮**，第三方手绘路线图（小红书/旅游门户那类）
> 大多是**改线前**的口径。拿它当基准去「纠错」，会把已经对的改错。
>
> **现在的基准有两个，都是现行口径、互相独立：**
>
> | 基准 | 内容 | 固化在哪 |
> | --- | --- | --- |
> | ① jejuolle.org 官网编号表 | 编号 / 起终点 / 里程 / 难度 | `src/lib/seed.ts` 的 `SPECS`（唯一真源） |
> | ② **官方 Olle App 的路线列表** | 编号 / 中文起终点 / 里程 / 建议用时 | `scripts/data/olle-app-routes.json`（截图快照） |
>
> `python3 scripts/check_official_consistency.py` 会**先拿 ② 对一遍 `SPECS`**（外部权威基准），
> 再拿 `SPECS` 对一遍 `public/tracks.json`（内部几何）—— 两层分开查，别混在一起看。
>
> > **2026-09-29 逐条核对结果：27 条里程全对、起终点全对。**
> > 两个基准之间仅有的差别是：App 把 3 号线与 15 号线各列成 **A/B 两条走法**
> > （3-B 14.6km、15-B 13.0km），本项目记作主线（`03`=3A 20.9km、`15`=15A 15.5km），
> > 故 `SPECS` 里没有 3-B / 15-B。
> > ⚠️ **爬升不在这两个基准里**：App 只给海拔剖面小图、不给数字，官网也不公布。
> > 界面的爬升一律来自**轨迹点 + SRTM 30m 地形**，按 3m 滞后阈值累计（与 `geo.ts` 同口径）。
>
> 下面是改线前的旧图 vs 现行口径的逐条差（留档，说明为什么不能用二手图）：
>
> | 编号 | 官网现行 | 网上手绘图 | 差在哪 |
> | --- | --- | --- | --- |
> | 1 | 시흥-광치기 **15.1** | 15.6 | 里程 |
> | 2 | 광치기-온평 **14.8** | 10.5 | 里程（旧的 10.5 配 5-6 小时不合常理） |
> | 6 | 쇠소깍-**제주올레여행자센터** **10.1** | 牛沼河口-**独立岩** 14 | **终点变了** |
> | 7 | **여행자센터-서귀포버스터미널** **12.9** | **独立岩-月坪** 13.8 | **起终点都变了** |
> | 7-1 | **서귀포버스터미널-여행자센터** **15.7** | 世界杯竞技场-独立岩 15.1 | **整条换掉** |
> | 9 | 대평-화순 **12.3** | 大坪-和顺 7.1 | 里程（9 线延长过） |
> | 16 | 고내-**광령** **14.8** | 高内-**光令1里事务所** 16 | **终点变了** |
> | 17 | 광령-**김만덕기념관** **19.5** | 光令-观德亭-**甘穗休息室** 18.1 | **终点变了** |
> | 18 | **김만덕기념관**-조천 **17.1** | **济州原都心**-朝天万岁公园 19.7 | **起点变了** |
>
> 官网 `코스 안내` 公告栏挂着这些改线通知，日期与上表完全对得上：
>
> ```
> 제주올레 16코스 종점 스탬프&루트 변경 안내     2025-06-24
> 제주올레 17코스 시작점 스탬프&루트 변경 안내   2025-06-24
> 제주올레 7코스  법환포구 구간 변경             2026-07-01
> 제주올레 17코스 창오교~우평로 우회             2026-07-09
> ```
>
> > 🚨 **踩过**：曾经拿一张手绘路线图当「官方数据」，据此把 `07` 的终点从
> > `seogwipoTerminal` 改成 `wolpyeong` —— 正好改反了（`07-1` 才不走那里）。
> > 同时这张图上的「6=牛沼河口-独立岩」也对不上官网现行的
> > 「6=쇠소깍-제주올레여행자센터 10.1km」。
> > **口径有冲突时，一律以 jejuolle.org 当前值为准**，别用二手图。
>
> **07 拿到了第二份独立佐证（2026-09-29）**：官方分享给的行程是
> 「起点 제주올레여행자센터 ▸ 途经 **두머니물공원** ▸ 终点 서귀포버스터미널」——
> 与官网现行编号表逐字一致。途经点 `두머니물공원` 在 **서귀포시 법환동 1534**
> （法还村/江汀村交界、能望见범섬的小公园，中文译「斗马尼莫公园」），
> 正落在 2026-07-01「법환포구 구간 변경」那一段上 —— 三处互相印证。
>
> 算术也自洽：旧 7 线「여행자센터 → 월평 아왜낭목」约 **17.6 km**，
> 减去 월평 ↔ 서귀포버스터미널 的 **4.8 km** ≈ **12.8 km** ≈ 现行官方 **12.9 km**。
> 即**现行 7 线 = 旧线去掉往西那一腿、改在巴士总站收尾**。
>
> > ⚠️ 顺带一条：官网首页写的「총 437km 27코스」是**宣传口径**，
> > 把 `SPECS` 里 27 条逐条加起来是 **402.8 km** —— 两个数都对，别为它去改哪一边。
> > 页面用哪一份要在文案上说清（本项目取逐条合计，头部总计用 `OLLE_TOTAL_KM`）。
>
> #### 2026-09-28 实测（三源比选后）
>
> **23/27 条导出**（比只查 relation 时的 14 条多 9 条），**20 条零断口**。
> 剩下 3 条：**01-1 / 18-1 / 18-2 是离岛支线**（牛岛、楸子岛），三个源都没有几何，保持示意虚线。
>
> | 编号 | 选中源 | 实走 | 官方 | 覆盖 | 断口 |
> | --- | --- | --- | --- | --- | --- |
> | 01 | relation | 15.22 | 15.1 | 101% | — |
> | 02 | relation | 14.68 | 14.8 | 99% | 123m |
> | 03 | **gpx（3-A）** | 22.34 | 20.9 | 107% | — |
> | 04 | relation | 19.01 | 19.0 | 100% | 98m |
> | 05 | gpx | 14.54 | 13.4 | 108% | — |
> | 06 | both-gpx | 9.85 | 10.1 | 98% | 1.6km |
> | 07 | **gpx** | 12.75 | 12.9 | 99% | — |
> | 07-1 | gpx | 14.82 | 15.7 | 94% | — |
> | 08 | gpx | 17.14 | 19.3 | 89% | — |
> | 09 | relation | 12.23 | 12.3 | 99% | 366m |
> | 10 | gpx | 15.66 | 15.6 | 100% | — |
> | 10-1 | gpx | 4.30 | 4.2 | 102% | — |
> | 11 | relation | 17.05 | 17.3 | 98% | — |
> | 12 | **gpx** | 17.20 | 17.5 | 98% | — |
> | 13 | **gpx** | 15.60 | 16.2 | 96% | — |
> | 14 | **gpx** | 18.26 | 19.9 | 92% | — |
> | 15 | **gpx** | 18.67 | 15.5 | 120% ⚠️ | — |
> | 16 | gpx | 15.74 | 14.8 | 106% | — |
> | 17 | **gpx** | 18.18 | 19.5 | 93% | — |
> | 18 | gpx | 18.79 | 17.1 | 110% | — |
> | 19 | gpx | 19.00 | 19.4 | 98% | — |
> | 20 | gpx | 17.78 | 17.4 | 102% | — |
> | 21 | **gpx** | 10.65 | 11.3 | 94% | — |
>
> **加粗**的是这一轮新补上的线（此前地图上只是近似直线）。
> `03` 的 OSM relation 有 4.5km 断口，而 GPX 里的 `3-A` 段是 22.34km 连续无断口
> （OSM / GPX 把 3 线拆成 3A、3B 两种走法）—— 靠 `--alias 03-A=03` 归到 03（**已做成默认映射** `DEFAULT_ALIAS`）。
>
> 两条 ⚠️：
> - **15 = 120%**：GPX 段 18.67km / 官方 15.5km。几何是真的（起终点分别落在翰林、高内），
>   但比公布里程长 20%，可能含往返段或旧走向，**用时以官方 15.5km 为准**。
> - **06 = 98% 但有 1.6km 断口**：relation 只画到「偶来旅客中心」，GPX 段从「独立岩」起，
>   中间那 1.25km 城区段两个源都没有。
>
> > 📌 **不桥接。** 脚本有 `--bridge M`（把 ≤M 米的两段用直线接起来，默认关）。
> > 本项目**不用**：剩下的断口最大 366m，在地图上约 1px，肉眼看不出来；
> > 而直线桥接是**假几何**。要桥就把 `--bridge` 显式传上，报表与 GeoJSON 里都会写明接了几处、多少米。
>
> #### 2026-09-28 导入结果（历史记录，已被下面「2026-09-29 复核结果」取代）
>
> **方向已逐条核对**（拿官方 GPX 当基准比首末点，23 条全部同向）。
> `import_tracks.py` 的自动校正本轮判出 `06`、`11` 需要翻转（这两条的几何是 relation 侧，
> 拼接时方向随机）—— 判对了：翻转后 11 是「摹瑟浦 → 武陵」、06 是「牛沼端 → 济州偶来旅行者中心」，
> 与官方一致。
>
> | 编号 | 导入里程 | 官方 | 差 | 段数 |
> | --- | --- | --- | --- | --- |
> | 01 | 15.06 | 15.1 | −0.0 | 1 |
> | 02 | 14.44 | 14.8 | −0.4 | 2 |
> | 03 | 22.20 | 20.9 | +1.3 | 1 |
> | 04 | 18.80 | 19.0 | −0.2 | 2 |
> | 05 | 14.44 | 13.4 | +1.0 | 1 |
> | 06 | 9.76 | 10.1 | −0.3 | 3 |
> | 07 | 12.69 | 12.9 | −0.2 | 1 |
> | 07-1 | 14.73 | 15.7 | −1.0 | 1 |
> | 08 | 17.01 | 19.3 | **−2.3** | 1 |
> | 09 | 12.01 | 12.3 | −0.3 | 2 |
> | 10 | 15.55 | 15.6 | −0.0 | 1 |
> | 10-1 | 4.27 | 4.2 | +0.1 | 1 |
> | 11 | 16.95 | 17.3 | −0.4 | 1 |
> | 12 | 17.05 | 17.5 | −0.5 | 1 |
> | 13 | 15.37 | 16.2 | −0.8 | 1 |
> | 14 | 18.10 | 19.9 | −1.8 | 1 |
> | 15 | 18.44 | 15.5 | **+2.9** | 1 |
> | 16 | 15.53 | 14.8 | +0.7 | 1 |
> | 17 | 18.04 | 19.5 | −1.5 | 1 |
> | 18 | 18.51 | 17.1 | +1.4 | 1 |
> | 19 | 18.73 | 19.4 | −0.7 | 1 |
> | 20 | 17.48 | 17.4 | +0.1 | 1 |
> | 21 | 10.57 | 11.3 | −0.7 | 1 |
>
> - **18 条差 ≤1.5km**；只有 08（−2.3）、15（+2.9）超出。08 是数据源少画了一段，15 见上面那条 ⚠️。
> - **爬升/海拔改按轨迹逐点算**，不再用近似剖面 —— 这是「换成真实轨迹」最直接的收益。
> - 里程**仍以官方 `SPECS` 为准**显示，详情页另给「轨迹实测 X km」对照，
>   所以上表的差不会让页面数字自相矛盾。
>
> #### 2026-09-29 复核结果（现行口径，**22/27** 条真实轨迹）
>
> 以 jejuolle.org 当前值为基准重跑一遍（`--offline --cache-dir scripts/.cache/osm
> --reuse-dir <纯关系快照> --gpx <整条偶来 GPX>`，再 `import_tracks.py --reverse 07-1`）：
>
> - **撤下 2 条**：`07` 与 `14-1`。理由见下，属于「宁可缺、不可假」。
> - **`07-1` 的方向强制翻转**（`--reverse 07-1`）：几何是「여행자센터 → 버스터미널」，
>   而官网现行 7-1 号线的行进方向是反的。自动走向校正没兜住它 ——
>   它靠「相邻课程首尾相接」反推，而上游把 `07` 撤掉后，`06↔07-1` 的接点相距 0.44km（> 80m 阈值），
>   这一对没被判成相邻课程。**首尾相接的自动校正只在链条完整时才灵。**
> - 缺轨迹 5 条：`01-1 / 07 / 14-1 / 18-1 / 18-2`（页面走近似虚线并标注「暂无实测轨迹」）。
>
> **为什么撤 `07`**：上游端点闸门抓出来的 —— 它有几何，长度也「正好」是 12.75km
> （官方 12.9，98%，**光看里程完全看不出来**），但终点落在**月坪**，离官网的
> `seogwipoTerminal` **3.7km**。它走的是**旧走向**。这正是那条铁律的活例子：
> **里程对了 ≠ 走向对了**，必须另外拿官方端点卡一遍。
>
> > 🔁 **要补齐 `07`，得找 2026-07 之后的 GPX**：手头两套几何（OSM relation 19.80km、
> > hikeonearth GPX 段 12.75km）都是改线**前**的旧走向，都会撞端点闸门。
> > 在拿到新 GPX 之前，`07` 在图上走虚线示意线 —— 标注「暂无实测轨迹」，**宁可缺、不可假**。
>
> **为什么撤 `14-1`**：两套候选都不够格 ——
> OSM 那 19 条 en way 缝出来是 4 段且首尾乱跳（第 1 段往西南走 6.9km 后断掉、第 2 段又跳回起点附近）；
> GPX 里的 14-1 段 17.55km = 官方 9.3km 的 **189%**，是官方改线前的旧走向。
>
> 当前偏差（`check_official_consistency.py` 输出，只列非 ✅ 的）：
>
> | 编号 | 官方 | 轨迹 | 偏差 | 说明 |
> | --- | --- | --- | --- | --- |
> | 15 | 15.5 | 18.44 | **+19.0%** | 起终点（翰林/高内）对得上，但比公布里程长 2.9km |
> | 08 | 19.3 | 17.01 | **−11.9%** | 少画一段 |
> | 14 | 19.9 | 18.10 | −9.0% | |
> | 18 | 17.1 | 18.51 | +8.2% | |
> | 05 | 13.4 | 14.44 | +7.7% | |
> | 17 | 19.5 | 18.04 | −7.5% | |
> | 21 | 11.3 | 10.57 | −6.4% | |
> | 03 | 20.9 | 22.20 | +6.2% | 取的是 3-A 走法 |
> | 07-1 | 15.7 | 14.73 | −6.2% | |
> | 13 | 16.2 | 15.37 | −5.1% | |
>
> > 📌 **里程显示不受上表影响**：页面上的「里程」永远取官方 `SPECS`，
> > 「轨迹实测 X km」只作对照。上表的意义是**爬升与地图形状**存疑度分级 ——
> > 15 / 08 这两条的爬升数字别当准。
>
> > 🧭 **对账脚本**：`python3 scripts/check_official_consistency.py`
> > 把 27 条一次摊开，同时给出「官方口径 ↔ 实际几何」两侧的数，
> > 并按 ±5% / ±10% 打分。**改完 SPECS 或重导轨迹后跑它。**
> > （它从 `src/lib/seed.ts` 直接解析，不存副本 —— 避免又出现「脚本里的官方里程是旧的」。）
>
> #### 跑
>
> ```bash
> # 0) 改过缝合/判定逻辑的话先跑回归（不联网，52 条断言）
> python3 scripts/selftest_fetch_osm.py
> #    改过导入/走向校正的话跑这个（不联网，11 条断言）
> python3 scripts/selftest_import_tracks.py
>
> # 1) 抓真实走向 —— 三个源一起喂，脚本逐条比选（导出 tracks/osm/olle-<编号>.geojson）
> python3 scripts/fetch_olle_osm.py --gpx ~/Downloads/olle-all.gpx --dry   # 先看报表，不写文件
> python3 scripts/fetch_olle_osm.py --gpx ~/Downloads/olle-all.gpx
>
> # 2) 转成前端格式，并联网补海拔（OSM 的 way 上没有海拔）
> #    ⚠️ 若自动走向校正没兜住某条（见下面「走向会自动校正」），在这里补 --reverse <编号>
> python3 scripts/import_tracks.py --src tracks/osm --elevation --reverse 07-1
>
> # 3) 逐条对账：官方口径（SPECS） ↔ 实际几何（tracks.json）
> python3 scripts/check_official_consistency.py
> ```
>
> **Overpass 经常 504/429**（实测），所以脚本留了三个「别再赌网络」的口子：
>
> | 参数 | 用途 |
> |---|---|
> | `--cache-dir scripts/.cache/osm` | 每次响应按查询哈希落盘，重跑直接读盘。**调参时必开** |
> | `--offline` | 只读缓存，绝不联网。缺哪条就报哪条 |
> | `--reuse-dir tracks/osm` | relation 侧几何从已有的 `olle-*.geojson` 读，**跳过 relations 查询**（散 way / GPX 照常） |
>
> > ⚠️ `--reuse-dir` **只复用「来历是 OSM 关系」的文件**（看 `geomSource` 字段；
> > `both-*` 也放行，因为它的底子就是 relation）。
> > **不这么卡会滚成自引用**：把上一轮的 GPX 产物当成「relation 侧几何」复用，
> > 来源标签会从 `gpx` 变成 `复用的 olle-12.geojson`，越跑越看不出这条线到底是哪来的。
> > 本项目踩过这个坑，`tracks/osm` 里 23 个文件的 `geomSource` 一度全被写成 `relation`。
>
> `--gpx` 的输入就是「按课程分段的整条偶来 GPX」：每个 `<trk>` 一段，
> 段名形如 `KML Merge_Jeju Olle 12` / `… 3A` / `… 7-1`（`code_from_gpx_name()` 解析）。
> 段与段**首尾严格相接**，本身就是一条强校验 —— 若某段终点与下一段起点差出几百米，
> 说明那份 GPX 与官方现行走向不一致。
>
> `--dry` 的报表里有四样东西值得看：**覆盖**（实走 ÷ 官方）、**断口**（几处/总长）、
> **判定**、以及**分段明细**（每段多长、哪些是并联段）；底下「诊断」一节会列出成员构成
> （子关系 / 节点 / role）、岔路与劈开次数、跳过闭合旁路次数、最大的几个断口坐标
> —— 用来判断某个断口是「源里真没画」还是「缝合出错」。
>
> > ⚠️ **别拿 `seed.ts` 的 PLACES 坐标当「起终点是否正确」的判据**：那里是城镇级近似坐标
> > （自己文件里就写明偏差可达 10km，实测 `siheung` 偏 10km、`yongsu` 偏 13km），判不了。
> > **判「走向对不对」用 `endpoint_verdict()`**：它拿 `seed.ts` 里标了 `// 官方 GPS` 的点
> > （`olleCenter`、`seogwipoTerminal`）去卡轨迹两端（容差 2km）。
>
> > ⚠️ **自动校正只在「链条完整」时才灵**：它按相邻课程首尾相接反推，
> > 一旦中间缺了编号（比如上游把 `07` 撤了），`06↔07-1` 的接点相距 0.44km > 80m 阈值，
> > 这一对就不被判成相邻课程，漏掉的那条得手工 `--reverse`。**改完导入清单要重看这行输出。**
>
> #### 走向会自动校正（`import_tracks.py`）
>
> **方向 = 行进方向**，不是装饰：详情页的「起点 → 终点」坐标、剖面的爬升/下降都按它读，
> 反了会把上坡读成下坡，起点坐标还会贴到另一端去。而**拼接时不看成员顺序，方向本来就是随机的**
> （见上面「缝合算法」的警告），所以必须校正。
>
> 校正靠一条结构事实，不需要任何外部坐标：
>
> > 偶来 27 条**首尾相接**：课程 N 的终点 = 课程 N+1 的起点（`seed.ts` 的 `SPECS` 写死的）。
>
> 于是相邻两条课程在 OSM 里必然共享一个端点节点，共享点应当落在「N 的终点 / N+1 的起点」上；
> 若落成「N+1 的终点」，则这一对里**有且仅有**一条被反着拼了。谁错 —— 取**翻转条数最少**的解。
> 两个好处：
>
> - **数据源本身没问题时它给出 0 次翻转**，不会误伤一份方向本来就对的 Wikiloc GPX；
> - 实测 2026-09-28 的 23 条里判出 `06 / 11` 两条反向（`05↔06`、`10↔11` 共享的端点落成
>   「终点对终点」），导入时已自动翻回。**判得对**：这两条的几何来自 relation 侧（方向随机），
>   而 05、10 来自 GPX（方向本来就是官方的）；翻转后 06 = 「牛沼河口 → 独立岩」、
>   11 = 「摹瑟浦 → 武陵」，与官方一致。
> - 复核手段：拿 GPX（官方走向）当基准，逐条比「导入后的首点 ↔ GPX 首点 / 末点 ↔ GPX 末点」。
>   23 条全部同向。
>
> | 参数 | 用途 |
> |---|---|
> | `--no-orient` | 关掉走向自动校正（默认开） |
> | `--reverse 05` | 手工指定翻转某条（优先级高于自动判定，不会双重翻转） |
>
> 改这块逻辑前先跑 `python3 scripts/selftest_import_tracks.py`（不联网，11 条断言）。
>
> 可调的口子：
>
> | 参数 | 用途 |
> |---|---|
> | `--gpx FILE` | **第三个数据源**：按课程分段的整条偶来 GPX。12/13/14/15/17/21 这些没有 relation 的线靠它 |
> | `--broad` | 不带名字过滤再查一遍框内 hiking 关系，把「OSM 真没建」和「建了但名字没匹配上」分开 |
> | `--keep-parallel` | 不剔除并联段（默认剔除，否则里程会比官方还长） |
> | `--max-coverage 1.25` | 收紧「比官方长」这道闸（默认 1.30 一票否决） |
> | `--keep-bad` | ⛔ 与 `SKIP` 里的也照导（默认跳过） |
> | `--alias 15-B=15` | 变体编号映射到你的编号（`03-A=03` 已内置为默认，见 `DEFAULT_ALIAS`） |
> | `--bridge M` | ≤M 米的两段用**直线**接起来（默认 0 = 不接）。本项目不用，理由见上 |
>
> 拿到别处的 GPX/KML 也一样，丢进一个目录直接导：
>
> ```bash
> # 文件名带路线编号即可（1 / 01 / 10-1 都认）
> python3 scripts/import_tracks.py --src ~/Downloads/jeju-olle-tracks --elevation
> python3 scripts/import_tracks.py --src ~/tracks --dry        # 先看识别结果
> python3 scripts/import_tracks.py --src ~/tracks --strict     # 有未识别文件就退出
> ```
>
> - 文件名认不出编号的用 `--map 文件名=编号` 指定。**走向默认会按「相邻课程首尾相接」自动校正**
>   （见上面那节），要手工指定方向或关掉自动判定用 `--reverse 01` / `--no-orient`。
>   OSM 里的 A/B 变体（`3코스-A`、`15코스-B`）用 `--alias 03-A=03` 手工归到你的编号。
> - **有断口的轨迹按「分段」处理**（GPX 多个 `<trkseg>`、KML 多个 `<coordinates>`、
>   GeoJSON 的 `MultiLineString`）：段与段之间是数据真空，
>   - 地图按段画，**不连线**，缺口就留缺口；
>   - 里程是各段之和，**爬升逐段累加** —— 跨段那截海拔未知，混着算会凭空多出一大截；
>   - `tracks.json` 里段数 > 1 才写 `segments`，前端据此走多段绘制。
> - 落盘结果是 `public/tracks.json`，**运行时 `fetch` 读取，不进 localStorage**，换轨迹直接替换文件即可。
> - 有轨迹的路线，地图按真实轨迹画线、起终点吸附到轨迹首末点；
>   **累计爬升与海拔区间改按轨迹逐点累加**（标高提示变为「取自真实轨迹」）；
>   里程仍**以官方值为准**，详情页同时给出「轨迹实测 X km」便于对照。
>   没轨迹的仍走原来的近似逻辑，互不影响。
> - 轨迹抽稀默认容差 8 m / 上限 420 点（Douglas–Peucker，**预算按所有段合计算**），既保形状又不让产物膨胀。
> - 与官方里程偏差 >25% 会告警（多半是编号认错、轨迹含接驳段，或 OSM 那块没画完），先核对再落盘。
> - 只有轨迹没海拔也能用：总里程照算，爬升显示「—」并提示「暂缺海拔数据」；
>   加 `--elevation` 就用 opentopodata 的 SRTM 30m 补上（同一份数据源口径与预置剖面一致，结果有缓存）。

## 2. Features

| Module | Page | Capabilities |
| --- | --- | --- |
| Route list | `/` | 27 routes listed by number; search (name/region/tag, supports "올레 07"/"Seogwipo"), filter by type, sort by number/distance/updated/name; top trip basket toggles directly; one-click add to basket from card |
| Route detail | `/routes/:id` | Map shows start/end, elevation profile, roadside lodging (auto "N km along route / N km from route"), roadside scenery, photo lightbox |
| Trip basket | `/plan` | Add routes (each counted once; added button disabled), custom target distance (quick 100 or 437 full), live cumulative +达标 check; suggests fill routes by gap; **default order by adding sequence** (switchable to "by distance"), Markdown copy follows current order; per-route "done" checkbox shows progress (X/Y + distance), supports "unfinished only" |
| Pre-trip | `/prep` | Jeju checklist (6 groups 43 items, checkable, manually skip/restore, unfinished-only, add own; skipped items gathered under "my own items" for review/restore) + **women's / men's commonly-used preset lists** (11/10 each, add per-item or whole list, brings source tag, removable anytime) + transport/lodging/food cheat-sheet (T-money card/riding notes, nav app comparison, taxi payment) + rough budget |
| Asset management | `/admin` | Route CRUD (incl. number); waypoints support map point-pick + reorder; lodging, sights (multi-image), album (local upload auto-compress or external link); JSON import/export |
| Settings | `/settings` | Basemap style, clear data |

> Footer credit: basemap OpenStreetMap, data source **jejuolletrailguide.net** (Jeju Olle Trail official English guide); also listed in footer "friend links" (external links always new tab + `rel="noopener noreferrer"`). Friend links live in `src/App.tsx`'s `FRIEND_LINKS`; add one line to add.

Typical 100K usage: main routes average 15–20 km, **pick ~6 routes to reach 100 km**; to walk the whole island set target to 437.

## 3. Where data is stored

| Content | Location |
| --- | --- |
| Routes / trip basket / settings | `localStorage` (key prefix `trail100k.`) |
| Pre-trip checklist checks & custom items | `localStorage`'s `trail100k.checklist` |
| Locally uploaded images | `IndexedDB` (db `trail100k` → store `images`), compressed to max edge 1600px, JPEG 0.82 on upload |

Data is not uploaded to any server. Before switching devices or clearing the browser, go to `/admin` top "Export JSON" to back up; after switching, "Import JSON" to restore (merge or replace optional).

## 4. How distance is calculated

| Scenario | Value |
| --- | --- |
| Preset Olle routes | Official distance (`manualDistanceKm`) first, no estimate |
| Routes you create, not manually filled | Adjacent waypoint straight-line sum × 1.2 (detour factor) |
| Climb | Prefer "terrain sampling series" (3m threshold); fall back to waypoint elevation if none; manually filled "actual cumulative climb" highest priority; if none show "—" |

Trip basket: each route counted once, sum of all distances compared to target, directly gives "reached / N km short", and suggests fillable routes by gap size.

## 5. Map basemap notes

The basemap is rendered with **Leaflet**, data from **OpenStreetMap** (tiles served by OpenStreetMap / OpenTopoMap public services), global coverage, Jeju's streets/coastline/terrain all render normally, **no API key needed, no configuration needed**.

| Basemap style | Tile source | Traits |
| --- | --- | --- |
| Standard map (default) | OpenStreetMap `tile.openstreetmap.org` | Most complete road/POI/name elements |
| Terrain map | OpenTopoMap `tile.opentopomap.org` | Contour + hillshade, good for hiking / off-road climb判断 |

> ⚠️ Tile source selection note: **Do not use CARTO** (`basemaps.cartocdn.com`) — it now forces tiles with "API key required" watermark on anonymous requests, requiring your own key. OSM / OpenTopoMap public services are the truly key-free ones.

Style switches with one click in "Settings", takes effect immediately, choice stored locally.

- Tiles need network to load; **offline the map area is blank**, other functions unaffected.
- **Two line types** (`src/lib/geo.ts`'s `mapLineSet()` → `MapLine.approx`):
  **Solid line (white border + green core)** = measured track in `public/tracks.json`; **gray-green dashed** = no measured track yet,
  just connecting `seed.ts`'s approximate coordinates as a **schematic line** (deviation up to 10km, don't treat as the route).
  Detail page and trip basket page both point this out in their descriptions.
- In extreme cases Leaflet init failure auto-downgrades to **offline schematic** (SVG projection), still clickable to reverse geocode.
- Coordinates unified as **WGS-84** (consistent with OSM). Jeju is outside China; the GCJ-02 offset algorithm doesn't apply abroad, so historical coordinates are equivalent to WGS-84, switching basemaps won't cause position shift.

> ⚠️ Compliance note: OpenStreetMap / OpenTopoMap are foreign tile sources, **not applicable to surveying/mapping map products aimed at mainland China**. This project is positioned as a personal self-use tool for Jeju Island (overseas) hiking guides, foreign tile sources are fine; if later published to mainland users as a surveying product, you must switch to a basemap service with surveying qualifications that covers the target region.

## 6. Route illustrations & covers

Card covers use **official Route Map** (one page per route), album uses **Wikimedia Commons freely-licensed photos**. Both assets live in `public/photos/`, read by the frontend at startup by route number (not in localStorage, replace files to swap).

### 6.1 Official Route Map → card cover

Split Jeju Olle Foundation's official "Route Map" PDF by route into images, one page per route:

```bash
# default reads ~/Downloads/171011_jeju-olle-route-map.pdf
python3 scripts/split_route_map.py
python3 scripts/split_route_map.py --pdf /path/to/route-map.pdf
python3 scripts/split_route_map.py --limit 2      # cut 2 first to see effect
```

| Output | Description |
| --- | --- |
| `public/photos/maps/olle-<number>.webp` | **Detail page original**: one full page per route (1432×1012, ~100KB each, 26 images total 2.5MB), for album and lightbox |
| `public/photos/maps/cover/olle-<number>.webp` | **Card cover (compressed)**: 760×537, ~25KB each, 26 images total 0.65MB |
| `public/photos/maps.json` | number → `{ file: original, cover: cover }`, frontend reads it to set `cover` and add original to album (clickable for full size) |

**Why two sizes from one image**: card cover renders only ~300–400px wide in the list (`.cards` is `minmax(min(300px,100%),1fr)`), cramming the 1432px original is wasteful — 26 covers on homepage would pull 2.5MB. Separate compressed cover drops first screen to 0.65MB, while detail/lightbox still shows 1432px original, zooming to read place names unaffected.

Compression is **local** (Pillow resize + WebP quality drop, `--cover-width` / `--cover-quality` adjustable), same class as TinyPNG / tinyimg online services, but no API key, no uploading images to third parties, reproducible. You can switch to online services too, just overwrite the compressed result to the same-named file in `maps/cover/`.

Conventions:

- **Do not crop**. Official page is 842×596 landscape, map fills the whole page; cropping 30% top/bottom cuts into the route body (01's south end, 10-1's Jeju-mainland side get cut). Cover side's `.route-cover` uses `aspect-ratio: 842 / 596` to reserve space by page ratio, zero crop.
- **Page number ↔ route number must be verified**. `PAGE_CODES` in the script is organized by the bold route number printed at each page's bottom-right (PDF page 1 is cover, pages 2–27 are routes). When switching to a new PDF version, re-verify this table, otherwise route numbers get mismatched.
- This 2017.10 version **has no Route 18-2 (Hajuchado) page**, so 18-2 uses "no illustration" placeholder.
- Cover priority: **admin-set cover > official route map > Commons photo**. To use your own photo, upload one in `/admin` "Basic Info".

> ⚠️ Official route map copyright belongs to **© Jeju Olle Foundation**, PDF inner pages explicitly say "no permission for commercial reproduction, copying and distribution". This project is a personal self-use guide tool, non-commercial, and album/lightbox both show the credited `credit`; **do not use commercially**.

### 6.2 Album illustrations (Wikimedia Commons free license)

Images from Xiaohongshu etc. have copyright and are forbidden to scrape, **do not** bulk-download them into the project. This project uses Wikimedia Commons freely-licensed works (CC0 / CC-BY / public domain) instead.

```bash
# download illustrations for 27 routes (needs network access to commons.wikimedia.org)
python3 scripts/fetch_photos.py            # full
python3 scripts/fetch_photos.py --limit 2  # try 2 first
python3 scripts/fetch_photos.py --dry      # search only, no download
```

The script outputs:

| File | Role |
| --- | --- |
| `public/photos/olle-<number>.jpg` | illustration (max edge 1600px) |
| `public/photos/manifest.json` | number → image mapping, read at frontend startup and bound to corresponding route (not in localStorage, replace file to swap) |
| `public/photos/CREDITS.md` | attribution list (author / license / source page), satisfies CC-BY attribution requirement, distribute with the project |

When the script isn't run the album is empty, interface shows "no image" placeholder, no error.

> Note: photos are illustrative photos of "the place the route passes through", **not official route photography**, and **not measured tracks**. To use as guide basis, please rely on official materials and your own photos.
> If a photo is unsuitable: delete the corresponding file under `public/photos/` and the entry in `manifest.json`.

## 7. Pre-trip page data boundaries

`/prep` content references the Olle trail official site (jejuolle.org), Korea Tourism Organization public materials, and public travelogues, compiled 2026-09, written in `src/lib/prep.ts`.

- **Policy items marked "verify before departure"** (red small tag): visa waiver caliber, whether K-ETA is required, IDP car rental, Olle passport price and emergency phone may change, confirm again before departure.
- **Prices are only common ranges**, for budget estimation, subject to booking platform and store real-time info.
- **No specific store or hotel names** — unverified names aren't invented, check reviews on Kakao Maps / Naver Maps yourself.
- **Transit & payment operation details** (T-money card fee and transfer caliber, iOS card limit, STOP bell and skip-stop, Uber face-to-face pay, etc.) come from hands-on experience and public travelogues, not official terms, change faster, already marked red in page with reference links.
- The car rental item is a key reminder: Korea requires short-stay visitors to hold a 1949 Geneva Convention paper IDP, and **mainland China driver's licenses are not within the scope of issuable IDP**, most rental companies won't take the order in practice. For self-driving please confirm in writing with the rental company first.
- **Women's / men's preset lists** are experiential advice on "what to bring, why", **no policy or price assertions**; hard rules like carry-on liquid capacity, security (nail clippers suggest checked baggage) are written in `note` as prompts per conventional caliber, not promises. The two lists' copy is deliberately not overlapping with the official 43 items — otherwise the de-dup logic judges them as "already in list", equaling wasted writing.

### Checklist check / skip state machine

`trail100k.checklist` (see `ChecklistState` in `src/lib/storage.ts`) manages four mutually-exclusive id sets:

| State | Field | Meaning |
| --- | --- | --- |
| Ready | `checked` | checked items, counted in progress |
| Skipped | `skipped` | manually skipped items, **not counted in progress denominator, nor unfinished**, still shown normally (grayed + "skipped" tag, one-click "restore") |
| Custom | `custom` | self-added items (`PrepItem[]`) |
| Preset added | `extras` | items picked from "women's/men's commonly-used list" (`ChecklistExtra[]`, one more `from` than `PrepItem` to remember source) |

- Checking an item auto-removes it from `skipped` (mutually exclusive); skipping an item auto-unchecks it.
- "Unfinished only" hides both checked and skipped; normal mode skipped items still visible, for easy restore.
- "Select all in group" only acts on unskipped items, won't re-check skipped ones.
- Progress bar and each group's `done/total` only count "unskipped" items.

### How preset lists (women's / men's) enter the master list

Data source is `PREP_PRESETS` in `src/lib/prep.ts` (two sets with independent ids: `preset.f.*` / `preset.m.*`).
They are **not the default list**, just a candidate pool: when `extras` is empty the page shows nothing extra, only after the user picks some does the "preset list added" group appear.

| Action | Behavior |
| --- | --- |
| Single "add" / "remove" | write / delete one entry in `extras`, equivalent to toggle, no second confirmation |
| "Add all (N)" | `ids` omitted → whole merged in; N on button is **de-duped real new count** |
| "Remove all" | whole removed from master list (goes through Confirm, since it clears these items' check/skip states) |
| "Reset list" | `checked / skipped / custom / extras` all cleared |

De-dup caliber (`addPresetItems`): **judge "added this" by id, judge "is there already the same thing in list" by `normItemText(text)`** (ignore all whitespace and case). Matched entries aren't written again, selector shows "already in list" and removes button. When the same item already exists in the official group it won't be added again — so the two lists' copy is deliberately not overlapping with the official 43 items.

⚠️ De-dup must be calculated by `prev` inside `setChecklist(prev => ...)` updater, can't judge by render-phase `checklist`: clicking "add" repeatedly the render-phase snapshot is old, writes the same item repeatedly. Likewise, updater returning no new value returns `prev` original object (React skips re-render, also doesn't waste a localStorage write).

## 8. No white screen on error

Two-layer `ErrorBoundary` (`src/components/ErrorBoundary.tsx`):

| Layer | Location | Catches |
| --- | --- | --- |
| Whole site | `main.tsx` wraps `<App />` | even Router / Provider itself crashing has a page |
| Page | `App.tsx` content area, `key` bound to pathname | single page crash still keeps top nav, switch pages to continue; route change auto-resets error state |

Error page offers: retry / back to home / copy error info / expand component stack / **clear local data and reload** (last resort when bad records in data, goes through self-made Modal second confirmation).

⚠️ It only catches **render-phase** errors. Event callbacks, `setTimeout`, request callbacks' async errors React won't bubble up (manifests as "click does nothing", no white screen).
`DataProvider`'s data loading runs in `requestAnimationFrame`, exceptions also can't bubble to React — so there it's separately converted to render-phase throw to the boundary, avoiding stuck on skeleton screen fake-death.

## 9. Deployment (Docker + nginx + Dokploy subpath)

The project is a **pure static front-end** (`HashRouter` + `base: './'`), no backend, packaged as nginx static image per `asset-system-frontend` paradigm, mounted under `/jeju/` subpath, distributed by Dokploy's Traefik by PathPrefix.

### Key files

| File | Role |
| --- | --- |
| `Dockerfile` | multi-stage build: node install deps + `npm run build`, product `dist/` copied to nginx's `/usr/share/nginx/html/jeju` |
| `nginx.conf.template` | nginx:alpine renders `templates/*.template` via envsubst into `conf.d/default.conf` at startup; this template only does `/jeju` → `/jeju/` redirect + static hosting + SPA fallback |
| `.dockerignore` | exclude node_modules / dist / .git / local script cache, shrink build context |
| `.npmrc` | use npmmirror to speed up in-container `npm ci` |

> Because it's `HashRouter` + `base: './'`, `dist/` resources use relative paths, no need to change `vite.config.ts` under `/jeju/`, no history route rewrite needed.

### Build and self-test image locally

```bash
docker build -t jeju-100k .
docker run --rm -p 8080:80 jeju-100k
# open http://localhost:8080/jeju/ in browser to verify
```

### Push to Dokploy

1. Dokploy create **Application**, source connect GitHub public repo `tanabalu/jeju-100k` (main branch).
2. Build method select **Dockerfile** (multi-stage already written, no extra params).
3. Port: container exposes `80`, Dokploy internal port fill `80`.
4. **Traefik route rule** (PathPrefix): `PathPrefix(\`/jeju\`)`, corresponds to `/jeju/` in nginx (Traefik's PathPrefix auto-matches `/jeju` and `/jeju/...`).
5. After deploy access `https://your-domain/jeju/` (replace "your-domain" with the domain actually hosting this subpath).

> When switching subpath change two places: `Dockerfile`'s `COPY ... /usr/share/nginx/html/<new-path>` and `/jeju`, `/jeju/`, `/jeju/index.html` in `nginx.conf.template`.

## 10. Directory structure

```
src/
  types.ts               data model (Route with code route number)
  lib/geo.ts             Haversine distance, climb (with noise threshold), POI projection to route
  lib/olleeElevation.ts  27 routes' terrain sampling series (script-generated, do not hand-edit)
  lib/storage.ts         localStorage repository + import/export
  lib/imageStore.ts      IndexedDB image storage and compression
  lib/seed.ts            27 Olle trails preset data
  lib/prep.ts            pre-trip checklist & transport/lodging/food cheat-sheet data (policy items marked verify)
  store/DataContext.tsx  global data + assets (official route map / photos / real tracks) overlay + checklist state
  hooks/useActivePlan.ts trip basket operations
  components/            RouteMap / ElevationChart / Modal / Feedback / Skeleton / ErrorBoundary ...
  pages/                 Routes / RouteDetail / Plan / Prep / Admin / Settings
  pages/admin/           Basic Info / Waypoints / Lodging / Sights / Album five editors
public/photos/           official route map (maps/ + maps/cover/ + maps.json) and album illustrations, attribution list
public/tracks.json       real tracks (import_tracks.py generated, fetched at runtime)
scripts/fetch_photos.py  Commons free-license image scrape script
scripts/split_route_map.py  official Route Map PDF split by route into card cover (compressed) + detail original
scripts/fetch_elevation.py  SRTM 30m elevation scrape script (generates olleeElevation.ts)
scripts/fetch_olle_osm.py    from OSM (relation + loose way) and whole GPX **three-source comparison**, grab each route's real direction (→ tracks/osm/*.geojson)
scripts/selftest_fetch_osm.py  stitcher regression self-test (no network, 52 assertions, run this first after changing stitcher logic)
scripts/import_tracks.py    GPX / KML / GeoJSON track import (recognize number, correct direction, simplify, calculate distance/climb → tracks.json)
scripts/selftest_import_tracks.py  importer regression self-test (no network, run this first after changing direction correction/import logic)
scripts/check_official_consistency.py  per-route reconciliation "seed.ts official caliber ↔ tracks.json actual geometry" (must run after changing SPECS or re-import)
scripts/check-elevation.ts  verify tracks.json elevation and climb self-consistency
```

## 11. Known boundaries & future work

- Preset coordinates are town-level approximations, **not official tracks** (deviation up to 13km measured, e.g. `yongsu`, `seogwang`).
  **Routes without measured tracks draw as gray-green dashed on the map** (`mapLineSet()`'s `approx: true`) —
  dashed = just connecting two approximate coordinates, not a walked path; ones with tracks are solid (white border + green core).
- **23/27 routes already have real tracks** (`public/tracks.json`). Still missing **01-1, 18-1, 18-2**:
  all three are **island branch routes** (Udo 우도, Chujado 추자도), OSM relation / loose way / whole GPX three sources all have no geometry,
  and they're not in the main-island map view anyway (`uda` 126.95,33.51; `chuja` 126.28,33.96).
  To fill only by finding Wikiloc single GPX.
- **14-1 explicitly excluded** (script's `SKIP`): loose way stitched 4 segments jumping head-to-tail, GPX segment 189% over-long,
  neither qualifies → keep schematic dashed. To fix need to first clarify how official 14-1 (저지→서광, 9.3km) actually goes.
- **Two routes' distance still questionable** (geometry itself credible, but doesn't match published distance):
  `15` walked 18.67km / official 15.5km (120%); `08` walked 17.14km / official 19.3km (89%).
  Page shows official value, detail page's "track measured" reveals this difference.
- **Official total 437km vs per-route sum 402.8km** (`SPECS` 27 routes sum) — this difference (34.2km) not yet clarified,
  suspected official counts "connecting segments" into 437. Frontend top distance target uses 437 per official caliber.
- Lodging / sights / album preset empty, need you to enter by actual itinerary (or import JSON batch fill).
- Basemap uses OpenStreetMap / OpenTopoMap free tiles, needs network; if used in no-network environment, can use offline schematic + admin manual coordinate correction.
