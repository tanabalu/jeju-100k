import { useEffect, useMemo, useState } from 'react'
import { useData } from '../store/DataContext'
import { useConfirm, useToast } from '../components/Feedback'
import { BUDGET_HINTS, GUIDE_SECTIONS, PREP_GROUPS, type PrepGroup, type PrepItem } from '../lib/prep'

export function PrepPage() {
  const { checklist, toggleCheck, toggleSkip, resetChecklist, addCustomItem, removeCustomItem } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const [onlyTodo, setOnlyTodo] = useState(false)
  const [draft, setDraft] = useState('')

  const checked = useMemo(() => new Set(checklist.checked), [checklist.checked])
  const skipped = useMemo(() => new Set(checklist.skipped), [checklist.skipped])

  // 分组渲染：done/total 只算「未放弃」的项，放弃的项不计入进度分母
  type ViewGroup = PrepGroup & { done: number; total: number }
  const groups: ViewGroup[] = useMemo(() => {
    // 只看未完成时：隐藏已勾选和已放弃；平时：放弃的项也展示（带「已放弃」样式，可一键恢复）
    const keep = (i: PrepItem) => !skipped.has(i.id) && (!onlyTodo || !checked.has(i.id))
    const base: ViewGroup[] = PREP_GROUPS.map((g) => {
      const total = g.items.filter((i) => !skipped.has(i.id)).length
      const done = g.items.filter((i) => !skipped.has(i.id) && checked.has(i.id)).length
      return { ...g, done, total, items: g.items.filter(keep) }
    }).filter((g) => g.items.length > 0)
    if (checklist.custom.length === 0) return base
    const cTotal = checklist.custom.filter((i) => !skipped.has(i.id)).length
    const cDone = checklist.custom.filter((i) => !skipped.has(i.id) && checked.has(i.id)).length
    const custom: ViewGroup = {
      id: 'custom',
      title: '我自己加的',
      desc: '官方清单没覆盖到的，自己补。',
      done: cDone,
      total: cTotal,
      items: checklist.custom.filter(keep),
    }
    if (onlyTodo && custom.items.length === 0) return base
    return [...base, custom]
  }, [onlyTodo, checked, skipped, checklist.custom])

  const allItems: PrepItem[] = useMemo(
    () => [...PREP_GROUPS.flatMap((g) => g.items), ...checklist.custom],
    [checklist.custom],
  )
  // 进度只衡量「未放弃」的项：放弃即退出分母，也不算未完成
  const active = useMemo(() => allItems.filter((i) => !skipped.has(i.id)), [allItems, skipped])
  const total = active.length
  const done = active.filter((i) => checked.has(i.id)).length
  const pct = total ? Math.round((done / total) * 100) : 0
  const complete = total > 0 && done === total
  const skippedCount = allItems.length - total
  const verifyLeft = active.filter((i) => i.verify && !checked.has(i.id)).length

  // 本页目录：列出所有模块，点击平滑滚动。
  // ⚠️ HashRouter 下「href="#id"」会破坏路由，必须用 scrollIntoView 而非锚点链接。
  const toc = useMemo<{ id: string; label: string }[]>(() => {
    const items = [{ id: 'prep-progress', label: '总进度' }]
    groups.forEach((g) => items.push({ id: `prep-g-${g.id}`, label: g.title }))
    items.push({ id: 'prep-custom', label: '我的条目' })
    if (skippedCount > 0) items.push({ id: 'prep-skipped', label: '已放弃' })
    GUIDE_SECTIONS.forEach((s) => items.push({ id: `prep-s-${s.id}`, label: s.title }))
    items.push({ id: 'prep-budget', label: '预算' })
    return items
  }, [groups, skippedCount])

  const [activeId, setActiveId] = useState('prep-progress')
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) setActiveId(visible[0].target.id)
      },
      // 顶部边距覆盖吸顶区(顶栏+目录)，使高亮在模块真正露出吸顶区下方时触发
      { rootMargin: '-140px 0px -55% 0px', threshold: 0 },
    )
    toc.forEach((t) => {
      const el = document.getElementById(t.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [toc])

  return (
    <div className="page">
      <h1 className="detail-title">行前准备 · 济州岛</h1>
      <p className="muted">
        出发前逐项打勾，进度保存在本机浏览器。政策与价格会变，标「<span className="verify-tag">临行复核</span>」
        的项目请自己再确认一遍。
      </p>

      {/* ---------- 本页目录：快速跳转模块 ---------- */}
      <nav className="prep-toc" aria-label="本页目录">
        {toc.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`toc-link${activeId === t.id ? ' is-active' : ''}`}
            onClick={() => {
              const el = document.getElementById(t.id)
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* ---------- 总进度 ---------- */}
      <section id="prep-progress" className="section prep-summary">
        <div className="prep-summary-head">
          <div className="prep-summary-num">
            <b>{done}</b>
            <i>/ {total}</i>
            <em>已备齐</em>
          </div>
          <div className="prep-summary-bar">
            <div className="progress progress-lg">
              <div
                className={`progress-bar${complete ? ' is-done' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="muted">
              {complete
                ? '全部打勾了，出发吧'
                : `还差 ${total - done} 项${verifyLeft ? `，其中 ${verifyLeft} 项需要临行前复核` : ''}`}
            </span>
          </div>
        </div>
        <div className="btn-row">
          <label className="switch">
            <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} />
            <span>只看未完成</span>
          </label>
          {skippedCount > 0 && <span className="muted">已放弃 {skippedCount} 项</span>}
          <button
            className="btn btn-sm btn-danger"
            disabled={done === 0 && checklist.custom.length === 0}
            onClick={async () => {
              if (await confirm({ title: '重置清单', message: '清空所有勾选和自定义条目？', confirmText: '重置', danger: true })) {
                resetChecklist()
                toast('已重置', 'success')
              }
            }}
          >
            重置清单
          </button>
        </div>
      </section>

      {/* ---------- checklist ---------- */}
      {groups.map((g) => {
        return (
          <section id={`prep-g-${g.id}`} className="section" key={g.id}>
            <div className="section-head">
              <h2>
                {g.title}
                <span className="count">
                  {g.done} / {g.total}
                </span>
              </h2>
              <button
                className="btn btn-sm"
                onClick={() => {
                  g.items.forEach((i) => {
                    if (!skipped.has(i.id) && !checked.has(i.id)) toggleCheck(i.id)
                  })
                  toast(`「${g.title}」已全选`, 'success')
                }}
              >
                本组全选
              </button>
            </div>
            {g.desc && <p className="muted">{g.desc}</p>}
            <ul className="check-list">
              {g.items.map((item) => {
                const isDone = checked.has(item.id)
                const isSkipped = skipped.has(item.id)
                return (
                  <li
                    key={item.id}
                    className={`check-item${isDone ? ' is-done' : ''}${isSkipped ? ' is-skipped' : ''}`}
                  >
                    <div className="check-main">
                      <label>
                        <input type="checkbox" checked={isDone} onChange={() => toggleCheck(item.id)} />
                        <span className="check-text">
                          {item.text}
                          {item.verify && <span className="verify-tag">临行复核</span>}
                          {isSkipped && <span className="skip-tag">已放弃</span>}
                        </span>
                      </label>
                      <div className="check-actions">
                        {isSkipped ? (
                          <button className="btn-link" onClick={() => toggleSkip(item.id)}>
                            恢复
                          </button>
                        ) : (
                          <button className="btn-link" onClick={() => toggleSkip(item.id)}>
                            放弃
                          </button>
                        )}
                        {g.id === 'custom' && (
                          <button
                            className="btn-link"
                            onClick={async () => {
                              if (await confirm({ title: '删除条目', message: `删除「${item.text}」？`, confirmText: '删除', danger: true })) {
                                removeCustomItem(item.id)
                              }
                            }}
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </div>
                    {item.note && <p className="check-note">{item.note}</p>}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {groups.length === 0 && <div className="empty">清单都勾完了，没有未完成项</div>}

      {/* ---------- 自己补充 ---------- */}
      <section id="prep-custom" className="section">
        <h2>补充我自己的条目</h2>
        <div className="add-row">
          <input
            className="input"
            placeholder="例：带一双备用袜 / 提前预约汉拿山"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                addCustomItem(draft)
                setDraft('')
              }
            }}
          />
          <button
            className="btn btn-primary"
            disabled={!draft.trim()}
            onClick={() => {
              addCustomItem(draft)
              setDraft('')
            }}
          >
            添加
          </button>
        </div>
      </section>

      {/* ---------- 已放弃：集中查看 + 恢复（次要信息，置于自定义补充下方） ---------- */}
      {skippedCount > 0 && (
        <section id="prep-skipped" className="section prep-skipped">
          <div className="section-head">
            <h2>
              已放弃
              <span className="count">{skippedCount}</span>
            </h2>
            <button
              className="btn btn-sm"
              onClick={() => {
                skipped.forEach((id) => toggleSkip(id))
                toast('已恢复全部放弃项', 'success')
              }}
            >
              全部恢复
            </button>
          </div>
          <ul className="check-list">
            {allItems
              .filter((i) => skipped.has(i.id))
              .map((item) => {
                const grp = PREP_GROUPS.find((g) => g.items.some((x) => x.id === item.id))
                const isCustom = checklist.custom.some((c) => c.id === item.id)
                const src = isCustom ? '我自己加的' : grp ? grp.title : ''
                return (
                  <li key={item.id} className="check-item is-skipped">
                    <div className="check-main">
                      <span className="check-text">
                        {item.text}
                        {item.verify && <span className="verify-tag">临行复核</span>}
                        <span className="skip-tag">已放弃</span>
                      </span>
                      <div className="check-actions">
                        <button className="btn-link" onClick={() => toggleSkip(item.id)}>
                          恢复
                        </button>
                      </div>
                    </div>
                    {src && <p className="check-note">来自：{src}</p>}
                  </li>
                )
              })}
          </ul>
        </section>
      )}

      {/* ---------- 吃喝住行 ---------- */}
      <h2 className="prep-h2">吃喝住行速查</h2>
      <p className="muted">
        按品类给方向，不推荐具体店名 —— 没核实过的名字不写，请自己在 Kakao / Naver 地图上看实时评价。
        价格是公开攻略里的常见区间，只用来估预算。
      </p>
      {GUIDE_SECTIONS.map((s) => (
        <section id={`prep-s-${s.id}`} className="section" key={s.id}>
          <div className="section-head">
            <h2>{s.title}</h2>
          </div>
          <p className="muted">{s.desc}</p>
          <div className="grid-guide">
            {s.cards.map((c) => (
              <div className="guide-card" key={c.title}>
                <h3>{c.title}</h3>
                <ul>
                  {c.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                {c.warn && <p className="guide-warn">{c.warn}</p>}
                {c.sources && c.sources.length > 0 && (
                  <div className="guide-sources">
                    <span>参考：</span>
                    {c.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                        {s.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      <section id="prep-budget" className="section">
        <h2>预算粗算（每人每天，含住）</h2>
        <ul className="plain-list">
          {BUDGET_HINTS.map((b) => (
            <li key={b.label}>
              <span>{b.label}</span>
              <b>{b.value}</b>
            </li>
          ))}
        </ul>
        <div className="callout">
          <b>数据来源与边界</b>
          <p className="muted">
            内容与价格参考偶来小路官网（jejuolle.org）、韩国旅游发展局公开资料、公开游记，以及个人实测经验，
            整理于 2026-09。签证、K-ETA、IDP 与票价政策会调整，出发前请以官方公告为准；住宿与餐饮价格以预订平台和门店实时信息为准。
            公交与支付的操作细节（开卡费、换乘口径、iOS 开卡限制、打车支付方式等）变动更快，只作为方向参考。
          </p>
        </div>
      </section>
    </div>
  )
}
