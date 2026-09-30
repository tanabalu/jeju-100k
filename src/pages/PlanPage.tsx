import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../store/DataContext'
import { computeMetrics, formatKm, mapLineSet, routeBadgeAnchor } from '../lib/geo'
import { useActivePlan } from '../hooks/useActivePlan'
import { useConfirm, useToast } from '../components/Feedback'
import { Modal } from '../components/Modal'
import { RouteMap } from '../components/RouteMap'
import { OLLE_TOTAL_KM } from '../lib/seed'
import styles from './PlanPage.module.less'

type PlanSort = 'added' | 'km'

export function PlanPage() {
  const { routes, ui, updateUi } = useData()
  const planApi = useActivePlan()
  const { plan, plans, addRoute, removeRoute, toggleDone, setTarget, rename, clear, createPlan, removePlan, selectPlan } = planApi
  const toast = useToast()
  const confirm = useConfirm()
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTarget, setNewTarget] = useState(100)
  /** 默认按加入行程篮的先后顺序排（也就是你打算走的次序） */
  const [sort, setSort] = useState<PlanSort>('added')
  /** 只看未完成：隐藏已勾选走完的路线。状态存在本机缓存（trail100k.ui），刷新后仍然保持 */
  const hideDone = ui.planHideDone
  const setHideDone = (v: boolean) => updateUi({ planHideDone: v })

  const metrics = useMemo(() => new Map(routes.map((r) => [r.id, computeMetrics(r)])), [routes])

  const rows = useMemo(() => {
    if (!plan) return []
    // plan.items 的顺序 = 加入行程篮的先后顺序，先按它原样取出
    const list = plan.items
      .map((i) => {
        const r = routes.find((x) => x.id === i.routeId)
        if (!r) return null
        const km = metrics.get(r.id)?.distanceKm ?? 0
        return { route: r, km, subtotal: km, done: !!i.done }
      })
      .filter((x): x is { route: (typeof routes)[number]; km: number; subtotal: number; done: boolean } => !!x)
    return sort === 'km' ? [...list].sort((a, b) => b.subtotal - a.subtotal) : list
  }, [plan, routes, metrics, sort])

  /** 勾选过滤只影响展示，不改变合计与复制结果 */
  const visibleRows = hideDone ? rows.filter((r) => !r.done) : rows

  /** 已加入行程篮的各段路线坐标，合并后一次性展示在地图上 */
  const planTrails = useMemo(
    () => rows.map((r) => r.route.points).filter((pts) => pts && pts.length > 0),
    [rows],
  )
  /**
   * 画线几何：每条路线恰好一段 —— 有真实轨迹走轨迹，没有就把途经点连起来。
   * ⚠️ 别只把有轨迹的那几条塞进去：`lines` 一旦非空就整体接管画线，
   * 没轨迹的路线会整条从图上消失（这正是 mapLines 存在的原因）。
   *
   * 同时把「这段是不是示意线」一并传下去：OSM 里 17 / 21 / 18-1 / 18-2 等**没有轨迹**，
   * 图上只能把 seed.ts 的城镇级近似坐标连成直线 —— 不标出来的话，「西海岸一根斜穿
   * 岛内的直线」看起来就跟真走过的路一样。虚线 + 灰绿一眼可辨。
   */
  const planLineSet = useMemo(() => mapLineSet(rows.map((r) => r.route)), [rows])
  const planLines = useMemo(() => planLineSet.map((l) => l.seg), [planLineSet])
  const planApprox = useMemo(() => planLineSet.map((l) => l.approx), [planLineSet])
  /**
   * 标记改用路线编号（而不是起 / 终）：几条线同屏时，
   * 两组起终标记根本分不出哪条是几号，编号徽标一眼就能对上列表。
   */
  const planBadges = useMemo(
    () =>
      rows
        .map((r) => {
          const anchor = routeBadgeAnchor(r.route)
          if (!anchor) return null
          const label = r.route.code || r.route.name
          return { lng: anchor.lng, lat: anchor.lat, label, title: r.route.name }
        })
        .filter((b): b is { lng: number; lat: number; label: string; title: string } => !!b),
    [rows],
  )
  const planHotels = useMemo(() => rows.flatMap((r) => r.route.hotels ?? []), [rows])
  const planSights = useMemo(() => rows.flatMap((r) => r.route.sights ?? []), [rows])

  const total = rows.reduce((s, r) => s + r.subtotal, 0)
  const target = plan?.targetKm ?? 100
  const gap = target - total
  const done = total >= target
  const pct = Math.min(100, (total / Math.max(target, 1)) * 100)

  /** 走完进度：按条数 + 已走里程 */
  const doneCount = rows.filter((r) => r.done).length
  const totalCount = rows.length
  const doneKm = rows.filter((r) => r.done).reduce((s, r) => s + r.km, 0)
  const donePct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0
  const allDone = totalCount > 0 && doneCount === totalCount

  const suggestions = useMemo(() => {
    if (done) return []
    const inPlan = new Set(plan?.items.map((i) => i.routeId) ?? [])
    return routes
      .filter((r) => !inPlan.has(r.id))
      .map((r) => ({ route: r, km: metrics.get(r.id)?.distanceKm ?? 0 }))
      .filter((x) => x.km > 0)
      .sort((a, b) => Math.abs(a.km - gap) - Math.abs(b.km - gap))
      .slice(0, 4)
  }, [done, plan, routes, metrics, gap])

  const copyMarkdown = async () => {
    if (!plan) return
    const order = sort === 'added' ? '按加入顺序' : '按里程排序'
    const lines = [
      `# ${plan.name}`,
      '',
      `- 目标里程：${target} km`,
      `- 当前合计：**${formatKm(total)} km** ${done ? '✅ 已达标' : `（还差 ${formatKm(gap)} km）`}`,
      `- 排序：${order}`,
      '',
      '| 序 | 路线 | 里程 | 完成 |',
      '| --- | --- | --- | --- |',
      ...rows.map((r, i) => `| ${i + 1} | ${r.route.name} | ${formatKm(r.km)} | ${r.done ? '✅' : ''} |`),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast('已复制为 Markdown', 'success')
    } catch {
      toast('复制失败，请手动选择文本', 'error')
    }
  }

  return (
    <div className="page">
      <div className={`${styles['plan-head']}`}>
        <div>
          <h1 className="detail-title">行程篮 · 自动算百公里</h1>
          <p className="muted">把想走的路线加进来，实时累计里程，看看到没到 100 公里。</p>
        </div>
        <div className={`${styles['plan-head-actions']}`}>
          <select className="input" value={plan?.id ?? ''} onChange={(e) => selectPlan(e.target.value)}>
            {plans.length === 0 && <option value="">（暂无行程篮）</option>}
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            onClick={() => {
              setNewName(`行程 ${plans.length + 1}`)
              setNewTarget(100)
              setNewOpen(true)
            }}
          >
            新建行程篮
          </button>
        </div>
      </div>

      {!plan ? (
        <div className="empty">
          <p>还没有行程篮。新建一个，然后从路线列表把路线加进来。</p>
          <button className="btn btn-primary" onClick={() => createPlan('我的百公里行程', 100)}>
            新建行程篮
          </button>
        </div>
      ) : (
        <>
          <div className={`${styles['plan-summary']}`}>
            <div className={`${styles['plan-target']}`}>
              <label>
                目标里程（km）
                <div className={`${styles['target-row']}`}>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={target}
                    onChange={(e) => setTarget(Number(e.target.value))}
                  />
                  <button className="btn btn-sm" onClick={() => setTarget(100)}>
                    100
                  </button>
                  <button className="btn btn-sm" onClick={() => setTarget(OLLE_TOTAL_KM)}>
                    {OLLE_TOTAL_KM}（全程）
                  </button>
                </div>
              </label>
              <label>
                行程篮名称
                <input className="input" value={plan.name} onChange={(e) => rename(e.target.value)} />
              </label>
            </div>
            <div className={`plan-result ${done ? 'is-done' : ''}`}>
              <div className={`${styles['plan-result-km']}`}>
                <b>{formatKm(total)}</b>
                <span>/ {target} km</span>
              </div>
              <div className="progress progress-lg">
                <div className={`progress-bar ${done ? 'is-done' : ''}`} style={{ width: `${pct}%` }} />
              </div>
              <div className={`${styles['plan-result-tip']}`}>
                {done
                  ? `已达标，超出 ${formatKm(total - target)} km`
                  : `还差 ${formatKm(gap)} km，从下面挑几条补上即可`}
              </div>
            </div>
          </div>

          {rows.length > 0 && (
            <section className="section">
              <h2>行程位置</h2>
              <p className="muted">
                已加入行程篮的各段路线在地图上的分布（黑标=路线编号，紫=住宿，橙=看点）。
                标识落在每段线中间，避开相邻路线共享的端点；有真实轨迹的按轨迹画线，
                其余连途经点。<strong>虚线（灰绿）= 这条线还没有实测轨迹</strong>，
                只是把近似坐标连起来示意，走向不作数。
                底图加载失败时自动降级为离线示意图，位置信息不受影响。
              </p>
              <RouteMap
                trails={planTrails}
                lines={planLines}
                approxLines={planApprox}
                badges={planBadges}
                hotels={planHotels}
                sights={planSights}
                height={380}
                fixedZoom={10}
                center={{ lng: 126.5992, lat: 33.3747 }}
              />
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <h2>
                已加入 <span className="count">{rows.length}</span>
              </h2>
              {rows.length > 0 && (
                <div className="btn-row">
                  <button
                    className={`btn btn-sm${hideDone ? ' is-active' : ''}`}
                    onClick={() => setHideDone(!hideDone)}
                  >
                    只看未完成
                  </button>
                  <button
                    className={`btn btn-sm${sort === 'added' ? ' is-active' : ''}`}
                    onClick={() => setSort('added')}
                  >
                    按加入顺序
                  </button>
                  <button
                    className={`btn btn-sm${sort === 'km' ? ' is-active' : ''}`}
                    onClick={() => setSort('km')}
                  >
                    按里程
                  </button>
                </div>
              )}
            </div>

            {rows.length > 0 && (
              <div className={`${styles['plan-done']}`}>
                <div className={`progress ${styles['progress-sm']}`}>
                  <div
                    className={`progress-bar${allDone ? ' is-done' : ''}`}
                    style={{ width: `${donePct}%` }}
                  />
                </div>
                <span className="muted">
                  {allDone
                    ? `全部走完啦 · 共 ${formatKm(doneKm)} km`
                    : `已完成 ${doneCount} / ${totalCount} 条 · ${formatKm(doneKm)} km`}
                </span>
              </div>
            )}

            {rows.length === 0 ? (
              <div className="empty">
                <p>行程篮是空的。</p>
                <Link to="/" className="btn btn-primary">
                  去挑路线
                </Link>
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="empty">
                <p>没有未完成的路线，都走完啦 🎉</p>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th className={`${styles['th-done']}`} title="标记走完">
                      <span className={`${styles['sr-only']}`}>完成</span>
                    </th>
                    <th className={`${styles['th-idx']}`}>序</th>
                    <th>路线</th>
                    <th>里程</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ route, km, done: isDone }, idx) => (
                    <tr key={route.id} className={isDone ? 'is-done' : ''}>
                      <td className={`${styles['td-done']}`}>
                        <input
                          type="checkbox"
                          checked={isDone}
                          onChange={() => toggleDone(route.id)}
                          aria-label={`标记 ${route.name} 已走完`}
                        />
                      </td>
                      <td className={`${styles['td-idx']}`}>{idx + 1}</td>
                      <td>
                        <Link to={`/routes/${route.id}`}>{route.name}</Link>
                      </td>
                      <td>
                        <b>{formatKm(km)} km</b>
                      </td>
                      <td className="td-right">
                        <button className="btn btn-sm" onClick={() => removeRoute(route.id)}>
                          移除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={`${styles['td-done']}`} />
                    <td className={`${styles['td-idx']}`} />
                    <td>合计</td>
                    <td>
                      <b>{formatKm(total)} km</b>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </section>

          {!done && suggestions.length > 0 && (
            <section className="section">
              <h2>还差 {formatKm(gap)} km，这几条可以补上</h2>
              <div className="list">
                {suggestions.map(({ route, km }) => (
                  <div key={route.id} className="list-item">
                    <div className="list-main">
                      <b>{route.name}</b>
                      <span className="muted">{route.region || '—'}</span>
                    </div>
                    <div className="list-side">
                      <span className="pill">{formatKm(km)} km</span>
                      <button className="btn btn-sm btn-primary" onClick={() => addRoute(route.id)}>
                        加入
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className={`${styles['plan-foot']}`}>
            <button className="btn" onClick={copyMarkdown}>
              复制为 Markdown
            </button>
            <button
              className="btn"
              onClick={async () => {
                if (await confirm({ title: '清空行程篮', message: '移除行程篮里的全部路线？', confirmText: '清空', danger: true })) {
                  clear()
                  toast('已清空', 'success')
                }
              }}
            >
              清空
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                if (await confirm({ title: '删除行程篮', message: `删除「${plan.name}」？不可恢复。`, confirmText: '删除', danger: true })) {
                  removePlan(plan.id)
                  toast('已删除', 'success')
                }
              }}
            >
              删除行程篮
            </button>
          </div>
        </>
      )}

      <Modal
        open={newOpen}
        title="新建行程篮"
        width={440}
        onClose={() => setNewOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setNewOpen(false)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                createPlan(newName.trim() || '未命名行程', newTarget)
                setNewOpen(false)
                toast('已创建', 'success')
              }}
            >
              创建
            </button>
          </>
        }
      >
        <label className="field">
          <span>名称</span>
          <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <label className="field">
          <span>目标里程（km）</span>
          <input className="input" type="number" min={1} value={newTarget} onChange={(e) => setNewTarget(Number(e.target.value))} />
        </label>
      </Modal>
    </div>
  )
}
