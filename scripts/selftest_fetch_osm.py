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
print(f"{sum(OK)}/{len(OK)} 断言通过" + ("  ✅ 全绿" if all(OK) else "  ❌ 有失败"))
sys.exit(0 if all(OK) else 1)
