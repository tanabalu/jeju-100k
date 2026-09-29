#!/usr/bin/env python3
"""fetch_olle_osm.py 的缝合器回归自测（**不联网**，一次跑完）。

改动缝合/判定逻辑后先跑这个，再看真机报表：
    python3 scripts/selftest_fetch_osm.py

它覆盖的都是踩过坑的场景：成员乱序、长 way 中段节点、真断开、替代支线（并联段）、
环线收口、容差内就近接上、重叠 way、段内折返、以及判定闸门。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_olle_osm as F  # noqa: E402

OK = []


def check(name, got, want):
    ok = got == want
    OK.append(ok)
    print(f"  [{'OK ' if ok else 'FAIL'}] {name}: got={got} want={want}")


def line(p0, p1, n=12):
    return [(p0[0] + (p1[0] - p0[0]) * i / (n - 1),
             p0[1] + (p1[1] - p0[1]) * i / (n - 1)) for i in range(n)]


def W(i, pts, role=""):
    return {"id": i, "role": role, "pts": pts}


def run(name, ways, **kw):
    segs, gaps, st = F.join_ways(ways, **kw)
    km = sum(F.path_len_m(s) for s in segs) / 1000
    print(f"\n{name}: 段={len(segs)} 断口={len(gaps)} 里程={km:.2f}km "
          f"并联={st['parallelM'] / 1000:.2f}km 旁路={st['bypass']} "
          f"劈开={st['split']} 丢弃支线={st['spurDropped'] / 1000:.2f}km")
    return segs, gaps, st, km


P = [(126.30, 33.30), (126.33, 33.30), (126.36, 33.30), (126.39, 33.30)]
truth = (F.path_len_m(line(P[0], P[3])) / 1000)

print("=" * 78)
print("① 成员有序 / ② 成员乱序 —— 都应得到同一条线")
w = [W(1, line(P[0], P[1])), W(2, line(P[1], P[2])), W(3, line(P[2], P[3]))]
_, _, _, km = run("有序", w)
check("有序里程=真值", round(km, 3), round(truth, 3))
run("乱序", [w[2], w[0], w[1]])
check("乱序里程=真值", round(sum(F.path_len_m(s) for s in F.join_ways([w[2], w[0], w[1]])[0]) / 1000, 3),
      round(truth, 3))

print("\n" + "=" * 78)
print("③ 链子走到候选 way 的**中段节点**（必须就地劈开，不能误判成断口）")
# w_a 到 N4 为止；w_long 从 N2 到 N6，N4 正好是它的正中节点
N = [(126.30 + 0.015 * i, 33.30) for i in range(7)]      # N0..N6
w_a = W(1, N[0:5])                                       # N0..N4
w_long = W(2, N[2:7])                                    # N2..N6，N4 落在正中
segs, gaps, st, km = run("中段节点命中", [w_a, w_long])
check("无断口", len(gaps), 0)
check("劈开过", st["split"] > 0, True)
check("里程覆盖 N0..N6", round(km, 3), round(F.path_len_m(N) / 1000, 3))

print("\n" + "=" * 78)
print("④ 真断开两半 —— 必须是 2 段 + 1 断口，且**不能连线**")
w_a = W(1, line(P[0], P[1]))
w_b = W(2, line((126.50, 33.30), (126.53, 33.30)))   # 隔了十几公里
segs, gaps, st, km = run("真断开", [w_a, w_b])
check("2 段", len(segs), 2)
check("1 断口", len(gaps), 1)
check("并联=0（缺口续段不能误判）", st["parallelM"], 0.0)

print("\n" + "=" * 78)
print("⑤ 绕行替代支线（两端都接回主线）—— 既不接进主线，也不计入里程")
w1 = W(1, line(P[0], P[1]))
w2 = W(2, line(P[1], P[2]))
w3 = W(3, line(P[2], P[3]))
D = (126.345, 33.36)
bypass = W(4, line(P[1], D) + line(D, P[2])[1:])
segs_all, gaps_all, st_all, km_all = run("保留并联(--keep-parallel)", [w1, w2, w3, bypass],
                                         keep_parallel=True)
check("保留了并联段（且如实报长度）", round(st_all["parallelM"], 1) > 0, True)
check("保留时不算剔除", st_all["parallelDropped"], False)
segs, gaps, st, km = run("默认剔除并联", [w1, w2, w3, bypass])
check("里程=真值", round(km, 3), round(truth, 3))
check("并联被剔除", st["parallelN"], 1)
check("旁路被跳过", st["bypass"] > 0, True)
check("无断口", len(gaps), 0)

print("\n" + "=" * 78)
print("⑥ 环线（start==end）—— 端点不能阻止收口，也不能被当成并联剔掉")
L = [(126.30, 33.30), (126.36, 33.30), (126.36, 33.34), (126.30, 33.34), (126.30, 33.30)]
loop = [W(1, line(L[0], L[1])), W(2, line(L[1], L[2])),
        W(3, line(L[2], L[3])), W(4, line(L[3], L[4]))]
segs, gaps, st, km = run("环线", loop)
check("1 段收口", len(segs), 1)
check("无断口", len(gaps), 0)

print("\n" + "=" * 78)
print("⑦ 容差内 / 超容差")
near = W(2, [(126.3301, 33.30005)] + line((126.33, 33.30), (126.39, 33.30))[1:])
segs, gaps, st, km = run("容差内(约11m)", [W(1, line(P[0], P[1])), near])
check("拼成 1 段", len(segs), 1)
check("走的是就近接上", st["near"], 1)

print("\n" + "=" * 78)
print("⑧ 两条 way 有共享节点、且中段重叠：重叠那段不能走两遍")
segs, gaps, st, km = run("重叠 way", [W(3, N[0:5]), W(4, N[2:7])])
check("总里程=整条", round(km, 3), round(F.path_len_m(N) / 1000, 3))
check("1 段", len(segs), 1)

print("\n" + "=" * 78)
print("⑨ 段内折返（_loops）——「剔完并联段还比官方长」的那一类，只能报数剔不掉")
one_way = F.path_len_m(line(P[0], P[2])) / 1000
back = line(P[0], P[2]) + line(P[0], P[2])[::-1][1:]     # 去程 + 原路返回
n, m = F._loops(back)
check("折返只算一处（不是每个节点各报一次）", n, 1)
check("米数=去了又回", round(m / 1000, 2), round(2 * one_way, 2))
check("环线收口不报折返", F._loops(line(P[0], P[2]) + [P[0]])[0], 0)
check("普通线不报折返", F._loops(line(P[0], P[3]))[0], 0)

print("\n" + "=" * 78)
print("⑩ 判定闸门：超长（走向与官方不符）默认就拦，不是只提示")
mark, why = F.verdict_of(29.76, 4700.0, 20.9)
check("默认超长→⛔", mark, "⛔")
check("默认超长→说清是走向问题", "走向与官方里程不符" in why, True)
check("关掉闸门(max_cov=0)→只提示", F.verdict_of(29.76, 4700.0, 20.9, max_cov=0)[0], "⚠️")
check("正常线不受影响", F.verdict_of(15.22, 0.0, 15.1)[0], "✅")
check("画了一半→⛔", F.verdict_of(4.68, 100.0, 19.9)[0], "⛔")
els = [{"type": "relation", "id": 10, "members": [{"type": "relation", "ref": 99}], "tags": {}}]
check("缺子关系被识别", F.missing_child_ids(els), [99])
check("去重生效", len(F.dedupe_elements(els + [{"type": "relation", "id": 10}])), 1)
check("broad 查询不带名字过滤", "name" in F.build_broad_query(), False)

print("\n" + "=" * 78)
print("⑪ 散 way 按 (编号, 命名习惯) 归组 —— 12/13/14/15 这类没有 relation 的线靠它")
way_els = [
    {"type": "way", "id": 1, "tags": {"name": "올레길 12코스"},
     "geometry": [{"lon": 126.30, "lat": 33.30}, {"lon": 126.31, "lat": 33.30}]},
    {"type": "way", "id": 2, "tags": {"name": "올레길12"},
     "geometry": [{"lon": 126.31, "lat": 33.30}, {"lon": 126.32, "lat": 33.30}]},
    {"type": "way", "id": 3, "tags": {"name": "올레길 14-1"},
     "geometry": [{"lon": 126.30, "lat": 33.36}, {"lon": 126.31, "lat": 33.36}]},
    # ⚠️ 同一个编号的**英文名**是另一批 way，覆盖同一段路，必须单独一组
    {"type": "way", "id": 5, "tags": {"name": "Ollegil 12"},
     "geometry": [{"lon": 126.30, "lat": 33.30}, {"lon": 126.32, "lat": 33.30}]},
    {"type": "way", "id": 6, "tags": {"name": "ollegil 12"},
     "geometry": [{"lon": 126.32, "lat": 33.30}, {"lon": 126.33, "lat": 33.30}]},
    # 同一条 way 被两条 name 规则各命中一次 —— 不去重会缝两遍
    {"type": "way", "id": 1, "tags": {"name": "Ollegil 12"},
     "geometry": [{"lon": 126.30, "lat": 33.30}, {"lon": 126.31, "lat": 33.30}]},
    # 同名 POI（露营地）没有 highway，靠 build_ways_query 的过滤挡在门外；这里模拟万一漏进来
    {"type": "way", "id": 4, "tags": {"name": "바다올레길 카라반 캠핑장"},
     "geometry": [{"lon": 126.40, "lat": 33.40}, {"lon": 126.41, "lat": 33.41}]},
]
named = F.named_ways(way_els)
check("按 (编号, 命名习惯) 分组", sorted(named), [("12", "en"), ("12", "ko"), ("14-1", "ko")])
check("韩文 12 有 2 条", len(F.named_by_style(named, "12")["ko"]), 2)
check("英文 12 有 2 条（去重后，不是 3）", len(F.named_by_style(named, "12")["en"]), 2)
check("认不出编号的不进池子", any("캠핑" in str(v) for v in named.values()), False)
check("散 way 查询限定 highway", "highway" in F.build_ways_query(), True)
check("命名习惯判别", (F.style_of("Ollegil 12"), F.style_of("올레길6 (Ollegil 6)")), ("en", "ko"))

print("\n" + "=" * 78)
print("⑫ 只补缺、不取并集（uncovered_ways）—— 直接并集会被当成并联段整条剔掉")
base = [line((126.300, 33.300), (126.330, 33.300))]          # base 覆盖 300..330
dup = [W(7, line((126.300, 33.300), (126.330, 33.300)))]      # 与 base 完全重叠
tail = [W(8, line((126.330, 33.300), (126.350, 33.300)))]     # 前一半在 base 上，后半段是新的
check("完全重叠的被整条丢掉", len(F.uncovered_ways(dup, base)), 0)
kept = F.uncovered_ways(tail, base)
check("只留 base 上没有的那一段", len(kept), 1)
check("被 base 覆盖的首点已剪掉", len(kept[0]["pts"]), len(tail[0]["pts"]) - 1)
# 剪掉的是「落在 base 上的那一段前缀」，剩下的应当**原封不动**是尾巴本身
# （不是重新采样出来的近似几何）。line(n=12) 的采样间距约 168m，
# 用「距 base 端点 <150m」去卡会被采样间距卡住，所以这里直接比整个点列。
check("留下的那一段 = 原尾巴剪掉前缀（其余点原样保留）",
      kept[0]["pts"], tail[0]["pts"][1:])

print("\n" + "=" * 78)
print("⑬ 小断口直线桥接（--bridge）—— 默认不接；只接 ≤阈值 的小口子")
A = W(1, line((126.300, 33.300), (126.320, 33.300)))
B = W(2, line((126.340, 33.300), (126.322, 33.300)))   # 反向给的，近端在 [126.322]
s0, g0, st0, km0 = run("默认（不桥接）", [A, B])
check("默认仍是 2 段", len(s0), 2)
check("默认 1 断口", len(g0), 1)
check("默认没桥接", st0["bridgedN"], 0)

s1, g1, st1, km1 = run("--bridge 250", [A, B], bridge_m=250)
check("桥接后 1 段", len(s1), 1)
check("桥接后无断口", len(g1), 0)
check("桥接记 1 处", st1["bridgedN"], 1)
# ⚠️ 这条是防「接合端拼反了」的：拼反时这条线会掉头往回走，里程凭空多一整段。
#    实测就是这么发现 tb 判断写错了一个数（拼出来的线一路往东又折回西边）。
backtracks = sum(1 for p, q in zip(s1[0], s1[0][1:]) if q[0] < p[0])
check("桥接后不回头（经度单调不降）", backtracks, 0)
check("里程 = 两段 + 桥接那一段", round(km1 - km0, 3), round(st1["bridgedM"] / 1000, 3))

s2, g2, st2, km2 = run("--bridge 100（口子约 186m，接不上）", [A, B], bridge_m=100)
check("超阈值不接，仍 2 段", len(s2), 2)
check("超阈值没桥接", st2["bridgedN"], 0)

print("\n" + "=" * 78)
print(f"{sum(OK)}/{len(OK)} 断言通过" + ("  ✅ 全绿" if all(OK) else "  ❌ 有失败"))
sys.exit(0 if all(OK) else 1)
