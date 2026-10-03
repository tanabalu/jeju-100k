import { useEffect, useMemo, useRef, useState } from 'react'
import { useData } from '../store/DataContext'
import { useConfirm, useToast } from '../components/Feedback'
import {
  BUDGET_HINTS,
  GUIDE_SECTIONS,
  PREP_GROUPS,
  PREP_PRESETS,
  normItemText,
  tutorialOf,
  type PrepGroup,
  type PrepItem,
  type PrepPreset,
} from '../lib/prep'
import { TutorialBody } from '../components/Tutorial'
import styles from './PrepPage.module.less'

/** 条目来源说明（「已放弃」区块用来标注这条原本属于哪） */
function sourceOf(
  item: PrepItem,
  presets: PrepPreset[],
  extras: { id: string; from: string }[],
  customs: PrepItem[],
): string {
  const ex = extras.find((e) => e.id === item.id)
  if (ex) return presets.find((p) => p.id === ex.from)?.title ?? '备选清单'
  if (customs.some((c) => c.id === item.id)) return '我自己加的'
  return PREP_GROUPS.find((g) => g.items.some((x) => x.id === item.id))?.title ?? ''
}

export function PrepPage() {
  const {
    checklist,
    ui,
    updateUi,
    toggleCheck,
    toggleSkip,
    resetChecklist,
    addCustomItem,
    removeCustomItem,
    addPresetItems,
    removePresetItems,
    removeExtraItem,
  } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  /** 只看未完成：状态存在本机缓存（jejuolle100k.ui），刷新/关掉页面后仍然保持 */
  const onlyTodo = ui.prepOnlyTodo
  const setOnlyTodo = (v: boolean) => updateUi({ prepOnlyTodo: v })
  const [draft, setDraft] = useState('')

  /**
   * 折叠状态同样存在 ui（本机视图偏好），刷新后保持。
   * 两组极性相反是刻意的：分组默认展开（存「折叠的」），备选卡片默认收起（存「展开的」）——
   * 备选清单是候选池，默认不该占满整屏。
   */
  const collapsedGroups = ui.prepGroupsCollapsed
  const openPresets = ui.prepPresetsOpen
  const collapsedSet = useMemo(() => new Set(collapsedGroups), [collapsedGroups])
  const openPresetSet = useMemo(() => new Set(openPresets), [openPresets])
  const setGroupCollapsed = (id: string, collapsed: boolean) =>
    updateUi({
      prepGroupsCollapsed: collapsed
        ? Array.from(new Set([...collapsedGroups, id]))
        : collapsedGroups.filter((x) => x !== id),
    })
  const setPresetOpen = (id: string, open: boolean) =>
    updateUi({
      prepPresetsOpen: open ? Array.from(new Set([...openPresets, id])) : openPresets.filter((x) => x !== id),
    })

  /** 条目图文教程：就地展开的条目 id（默认收起，展开状态同样本机记住） */
  const openTutorials = ui.prepTutorialsOpen
  const openTutorialSet = useMemo(() => new Set(openTutorials), [openTutorials])
  const setTutorialOpen = (id: string, open: boolean) =>
    updateUi({
      prepTutorialsOpen: open
        ? Array.from(new Set([...openTutorials, id]))
        : openTutorials.filter((x) => x !== id),
    })

  const checked = useMemo(() => new Set(checklist.checked), [checklist.checked])
  const skipped = useMemo(() => new Set(checklist.skipped), [checklist.skipped])

  // 分组渲染：done/total 只算「未放弃」的项，放弃的项不计入进度分母
  type ViewGroup = PrepGroup & { done: number; total: number }
  const groups: ViewGroup[] = useMemo(() => {
    // 只看未完成时：隐藏已勾选和已放弃；平时：放弃的项也展示（带「已放弃」样式，可一键恢复）
    const keep = (i: PrepItem) => !skipped.has(i.id) && (!onlyTodo || !checked.has(i.id))
    const view = (g: PrepGroup): ViewGroup => {
      const activeItems = g.items.filter((i) => !skipped.has(i.id))
      return {
        ...g,
        total: activeItems.length,
        done: activeItems.filter((i) => checked.has(i.id)).length,
        items: g.items.filter(keep),
      }
    }

    const list: ViewGroup[] = PREP_GROUPS.map(view).filter((g) => g.items.length > 0)
    // 自己补充的条目、从「女士/男士常用清单」加进来的条目，各成一组接在官方分组后面。
    // 备选那组会在条目标题后带来源标签（女士/男士），一眼认得出是挑进来的。
    const mine: PrepGroup[] = [
      { id: 'custom', title: '我自己加的', desc: '官方清单没覆盖到的，自己补。', items: checklist.custom },
      {
        id: 'extras',
        title: '备选清单已加入',
        desc: '从「徒步装备 / 女士常用 / 男士常用 / 大疆 / 相机 / 无人机」几份备选清单里挑进来的，不想要的那一条直接移除即可。',
        items: checklist.extras,
      },
    ].filter((g) => g.items.length > 0)

    mine.forEach((g) => {
      const v = view(g)
      if (!onlyTodo || v.items.length > 0) list.push(v)
    })
    return list
  }, [onlyTodo, checked, skipped, checklist.custom, checklist.extras])

  const allItems: PrepItem[] = useMemo(
    () => [...PREP_GROUPS.flatMap((g) => g.items), ...checklist.custom, ...checklist.extras],
    [checklist.custom, checklist.extras],
  )
  // 备选条目的按钮要判两件事：这条本身加过没（按 id）；清单里是否已有同文案的条目（别重复加）
  const extraIds = useMemo(() => new Set(checklist.extras.map((e) => e.id)), [checklist.extras])
  const takenTexts = useMemo(() => new Set(allItems.map((i) => normItemText(i.text))), [allItems])
  // 已加入条目的来源标签：id → 女士/男士
  const extraTagById = useMemo(() => {
    const byPreset = new Map<string, string>()
    PREP_PRESETS.forEach((p) => byPreset.set(p.id, p.tag))
    const byItem = new Map<string, string>()
    checklist.extras.forEach((e) => byItem.set(e.id, byPreset.get(e.from) ?? '备选'))
    return byItem
  }, [checklist.extras])
  const presetPending = useMemo(() => {
    const m = new Map<string, PrepItem[]>()
    PREP_PRESETS.forEach((p) =>
      m.set(
        p.id,
        p.items.filter((i) => !extraIds.has(i.id) && !takenTexts.has(normItemText(i.text))),
      ),
    )
    return m
  }, [extraIds, takenTexts])
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
    items.push({ id: 'prep-presets', label: '备选清单' })
    if (skippedCount > 0) items.push({ id: 'prep-skipped', label: '已放弃' })
    GUIDE_SECTIONS.forEach((s) => items.push({ id: `prep-s-${s.id}`, label: s.title }))
    items.push({ id: 'prep-budget', label: '预算' })
    return items
  }, [groups, skippedCount])

  const [activeId, setActiveId] = useState('prep-progress')
  const tocNavigationRef = useRef(false)
  const tocSettleTimerRef = useRef<number | undefined>(undefined)
  const scrollFrameRef = useRef<number | undefined>(undefined)
  const finishTocNavigationRef = useRef<() => void>(() => {})

  useEffect(() => {
    const sections = toc
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
    const updateActiveSection = () => {
      scrollFrameRef.current = undefined
      if (tocNavigationRef.current || sections.length === 0) return

      // 与 scroll-margin-top 使用同一参考线，点击跳转到哪一节，停稳后就高亮哪一节。
      const configuredOffset = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--anchor-offset'),
      )
      const activationLine = Math.min(
        Number.isFinite(configuredOffset) ? configuredOffset : 110,
        window.innerHeight * 0.45,
      )

      let current = sections[0].id
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
        current = sections[sections.length - 1].id
      } else {
        for (const section of sections) {
          if (section.getBoundingClientRect().top <= activationLine + 4) current = section.id
          else break
        }
      }
      setActiveId(current)
    }

    const scheduleActiveUpdate = () => {
      if (scrollFrameRef.current === undefined) {
        scrollFrameRef.current = window.requestAnimationFrame(updateActiveSection)
      }
    }
    const finishTocNavigation = () => {
      if (tocSettleTimerRef.current !== undefined) {
        window.clearTimeout(tocSettleTimerRef.current)
        tocSettleTimerRef.current = undefined
      }
      tocNavigationRef.current = false
      updateActiveSection()
    }
    finishTocNavigationRef.current = finishTocNavigation

    const onScroll = () => {
      if (tocNavigationRef.current) {
        // 平滑滚动期间保持用户刚点的项；滚动停顿后再交还给位置计算。
        if (tocSettleTimerRef.current !== undefined) window.clearTimeout(tocSettleTimerRef.current)
        tocSettleTimerRef.current = window.setTimeout(finishTocNavigation, 180)
      } else {
        scheduleActiveUpdate()
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    updateActiveSection()
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (tocSettleTimerRef.current !== undefined) window.clearTimeout(tocSettleTimerRef.current)
      if (scrollFrameRef.current !== undefined) window.cancelAnimationFrame(scrollFrameRef.current)
      tocNavigationRef.current = false
    }
  }, [toc])

  return (
    <div className="page">
      {/* 标题+描述单独包一层：.page 是 gap:18px 的 flex 列，标题和描述合为一个子项，间距不受父级 gap 影响 */}
      <div className={`${styles['prep-head']}`}>
        <h1 className="detail-title">行前准备 · 济州岛</h1>
        <p className="muted">
          逐项打勾，进度存在本机浏览器。标「<span className={`${styles['verify-tag']}`}>临行复核</span>」
          的请出发前再确认一遍；不会动手的条目点右侧「<b>图文教程</b>」看分步骤图解。因人而异的装备 / 拍摄器材，到下方备选清单挑着加入。
        </p>
      </div>

      {/* ---------- 本页目录：快速跳转模块 ---------- */}
      <nav className={`${styles['prep-toc']}`} aria-label="本页目录">
        {toc.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`toc-link${activeId === t.id ? ' is-active' : ''}`}
            onClick={() => {
              tocNavigationRef.current = true
              if (tocSettleTimerRef.current !== undefined) window.clearTimeout(tocSettleTimerRef.current)
              // 无滚动（例如再次点击当前项）时也能释放导航锁。
              tocSettleTimerRef.current = window.setTimeout(
                () => finishTocNavigationRef.current(),
                1200,
              )
              setActiveId(t.id)
              // 跳到折叠中的分组时顺手展开 —— 否则滚过去了却是一片空标题
              const groupId = t.id.startsWith('prep-g-') ? t.id.slice('prep-g-'.length) : ''
              if (groupId && collapsedSet.has(groupId)) setGroupCollapsed(groupId, false)
              const el = document.getElementById(t.id)
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* ---------- 总进度 ---------- */}
      <section id="prep-progress" className={`section ${styles['prep-summary']}`}>
        <div className={`${styles['prep-summary-head']}`}>
          <div className={`${styles['prep-summary-num']}`}>
            <b>{done}</b>
            <i>/ {total}</i>
            <em>已备齐</em>
          </div>
          <div className={`${styles['prep-summary-bar']}`}>
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
          <label className={`${styles['switch']}`}>
            <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} />
            <span>只看未完成</span>
          </label>
          {skippedCount > 0 && <span className="muted">已放弃 {skippedCount} 项</span>}
          <button
            className="btn btn-sm btn-danger"
            disabled={done === 0 && checklist.custom.length === 0 && checklist.extras.length === 0}
            onClick={async () => {
              if (
                await confirm({
                  title: '重置清单',
                  message: '清空所有勾选，以及自己补充、从备选清单加入的条目？',
                  confirmText: '重置',
                  danger: true,
                })
              ) {
                resetChecklist()
                toast('已重置', 'success')
              }
            }}
          >
            重置清单
          </button>
        </div>
        <div className="btn-row">
          <button
            className="btn btn-sm"
            disabled={collapsedGroups.length === 0}
            onClick={() => updateUi({ prepGroupsCollapsed: [] })}
          >
            全部展开
          </button>
          <button
            className="btn btn-sm"
            disabled={groups.length === 0 || collapsedGroups.length >= groups.length}
            onClick={() => updateUi({ prepGroupsCollapsed: groups.map((g) => g.id) })}
          >
            全部折叠
          </button>
        </div>
      </section>

      {/* ---------- checklist ---------- */}
      {groups.map((g) => {
        const collapsed = collapsedSet.has(g.id)
        return (
          <section id={`prep-g-${g.id}`} className="section" key={g.id}>
            <div className="section-head">
              {/* 整块标题做成折叠按钮：点标题任意处都能收起 / 展开这一组 */}
              <h2 className={`${styles['group-title']}`}>
                <button
                  type="button"
                  className={`${styles['group-toggle']}`}
                  aria-expanded={!collapsed}
                  onClick={() => setGroupCollapsed(g.id, !collapsed)}
                >
                  <span className={`${styles['chev']}${collapsed ? '' : ` ${styles['is-open']}`}`} aria-hidden="true">
                    ▸
                  </span>
                  <span>{g.title}</span>
                  <span className="count">
                    {g.done} / {g.total}
                  </span>
                </button>
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
            {collapsed ? null : (
              <>
              {g.desc && <p className="muted">{g.desc}</p>}
              <ul className={`${styles['check-list']}`}>
                {g.items.map((item) => {
                  const isDone = checked.has(item.id)
                  const isSkipped = skipped.has(item.id)
                const tutorial = tutorialOf(item.id)
                const tutorialOpen = tutorial ? openTutorialSet.has(item.id) : false
                return (
                    <li
                      key={item.id}
                      className={`check-item${isDone ? ' is-done' : ''}${isSkipped ? ' is-skipped' : ''}`}
                    >
                      <div className={`${styles['check-main']}`}>
                        <label>
                          <input type="checkbox" checked={isDone} onChange={() => toggleCheck(item.id)} />
                          <span className={`${styles['check-text']}`}>
                            {item.text}
                            {item.verify && <span className={`${styles['verify-tag']}`}>临行复核</span>}
                            {g.id === 'extras' && (
                              <span className={`${styles['src-tag']}`}>{extraTagById.get(item.id) ?? '备选'}</span>
                            )}
                            {isSkipped && <span className={`${styles['skip-tag']}`}>已放弃</span>}
                          </span>
                        </label>
                        <div className={`${styles['check-actions']}`}>
                        {tutorial && (
                          <button
                            className={`btn-link ${styles['tut-btn']}`}
                            aria-expanded={tutorialOpen}
                            onClick={() => setTutorialOpen(item.id, !tutorialOpen)}
                          >
                            <span
                              className={`${styles['tut-chev']}${tutorialOpen ? ` ${styles['is-open']}` : ''}`}
                              aria-hidden="true"
                            >
                              ▸
                            </span>
                            图文教程
                          </button>
                        )}
                          {isSkipped ? (
                            <button className="btn-link" onClick={() => toggleSkip(item.id)}>
                              恢复
                            </button>
                          ) : (
                            <button className="btn-link" onClick={() => toggleSkip(item.id)}>
                              放弃
                            </button>
                          )}
                          {g.id === 'extras' && (
                            <button
                              className="btn-link"
                              onClick={() => {
                                removeExtraItem(item.id)
                                toast('已移出总清单', 'success')
                              }}
                            >
                              移除
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
                    {item.note && <p className={`${styles['check-note']}`}>{item.note}</p>}
                    {/* 图文教程就地展开：展开在条目下方，再点一次收起 */}
                    {tutorial && tutorialOpen && (
                      <div className={`${styles['tut-inline']}`}>
                        <div className={`${styles['tut-inline-head']}`}>
                          <b>{tutorial.title}</b>
                          <button className="btn-link" onClick={() => setTutorialOpen(item.id, false)}>
                            收起
                          </button>
                        </div>
                        <TutorialBody tutorial={tutorial} />
                      </div>
                    )}
                  </li>
                )
              })}
              </ul>
              </>
            )}
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

      {/* ---------- 分性别备选清单：挑需要的加进总清单，不要求全加 ---------- */}
      <section id="prep-presets" className="section">
        <h2>按需加入备选清单</h2>
        <p className="muted">
          下面是分装备 / 性别 / 拍摄设备的补充项，<b>不要求全加</b>；点「加入」并进总清单一起算进度，加错随时移除，重复项会标「已在清单」。
        </p>
        <div className={`${styles['grid-preset']}`}>
          {PREP_PRESETS.map((p) => {
            const addedCount = checklist.extras.filter((e) => e.from === p.id).length
            const pending = presetPending.get(p.id) ?? []
            const open = openPresetSet.has(p.id)
            return (
              <div className={`${styles['preset-card']}`} id={`prep-p-${p.id}`} key={p.id}>
                {/* 备选卡片默认收起：它们是候选池，展开才逐条挑 */}
                <h3>
                  <button
                    type="button"
                    className={`${styles['preset-toggle']}`}
                    aria-expanded={open}
                    onClick={() => setPresetOpen(p.id, !open)}
                  >
                    <span className={`${styles['chev']}${open ? ` ${styles['is-open']}` : ''}`} aria-hidden="true">
                      ▸
                    </span>
                    <span>{p.title}</span>
                    <span className={`${styles['preset-count']}`}>
                      已加入 {addedCount} / {p.items.length}
                    </span>
                  </button>
                </h3>
                <p className="muted">{p.desc}</p>
                {p.warn && <p className={`${styles['guide-warn']}`}>{p.warn}</p>}
                {p.sources && p.sources.length > 0 && (
                  <div className={`${styles['guide-sources']}`}>
                    <span>官方依据：</span>
                    {p.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                        {s.label}
                      </a>
                    ))}
                  </div>
                )}
                <div className={`${styles['preset-ops']}`}>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={pending.length === 0}
                    onClick={() => {
                      addPresetItems(p.id)
                      toast(`已加入 ${pending.length} 条（${p.short}）`, 'success')
                    }}
                  >
                    全部加入{pending.length > 0 ? `（${pending.length}）` : ''}
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={addedCount === 0}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `移出${p.short}`,
                          message: `把已加入的 ${addedCount} 条从总清单移出？（勾选与放弃状态一并清除，随时可以再加回来）`,
                          confirmText: '移出',
                          danger: true,
                        })
                      ) {
                        removePresetItems(p.id)
                        toast('已移出总清单', 'success')
                      }
                    }}
                  >
                    全部移出
                  </button>
                </div>
                {open ? (
                  <ul className={`${styles['preset-list']}`}>
                    {p.items.map((it) => {
                      const owned = extraIds.has(it.id)
                      const taken = !owned && takenTexts.has(normItemText(it.text))
                      return (
                        <li className={`preset-item${owned ? ' is-added' : ''}`} key={it.id}>
                          <div className={`${styles['preset-main']}`}>
                            <span className={`${styles['preset-text']}`}>{it.text}</span>
                            {owned ? (
                              <button
                                className="btn-link"
                                onClick={() => {
                                  removeExtraItem(it.id)
                                  toast('已移出总清单', 'success')
                                }}
                              >
                                移除
                              </button>
                            ) : taken ? (
                              <span className={`${styles['preset-own']}`}>已在清单</span>
                            ) : (
                              <button
                                className="btn-link"
                                onClick={() => {
                                  addPresetItems(p.id, [it.id])
                                  toast('已加入总清单', 'success')
                                }}
                              >
                                加入
                              </button>
                            )}
                          </div>
                          {it.note && <p className={`${styles['check-note']}`}>{it.note}</p>}
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <button className="btn btn-sm" onClick={() => setPresetOpen(p.id, true)}>
                    展开 {p.items.length} 条
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ---------- 已放弃：集中查看 + 恢复（次要信息，置于自定义补充下方） ---------- */}
      {skippedCount > 0 && (
        <section id="prep-skipped" className={`section ${styles['prep-skipped']}`}>
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
          <ul className={`${styles['check-list']}`}>
            {allItems
              .filter((i) => skipped.has(i.id))
              .map((item) => {
                const src = sourceOf(item, PREP_PRESETS, checklist.extras, checklist.custom)
                return (
                  <li key={item.id} className="check-item is-skipped">
                    <div className={`${styles['check-main']}`}>
                      <span className={`${styles['check-text']}`}>
                        {item.text}
                        {item.verify && <span className={`${styles['verify-tag']}`}>临行复核</span>}
                        <span className={`${styles['skip-tag']}`}>已放弃</span>
                      </span>
                      <div className={`${styles['check-actions']}`}>
                        <button className="btn-link" onClick={() => toggleSkip(item.id)}>
                          恢复
                        </button>
                      </div>
                    </div>
                    {src && <p className={`${styles['check-note']}`}>来自：{src}</p>}
                  </li>
                )
              })}
          </ul>
        </section>
      )}

      {/* ---------- 吃喝住行 ---------- */}
      <h2 className={`${styles['prep-h2']}`}>吃喝住行速查</h2>
      <p className="muted">按品类给方向，不推荐具体店名；价格仅作预算参考。</p>
      {GUIDE_SECTIONS.map((s) => (
        <section id={`prep-s-${s.id}`} className="section" key={s.id}>
          <div className="section-head">
            <h2>{s.title}</h2>
          </div>
          <p className="muted">{s.desc}</p>
          <div className={`${styles['grid-guide']}`}>
            {s.cards.map((c) => (
              <div className={`${styles['guide-card']}`} key={c.title}>
                <h3>{c.title}</h3>
                <ul>
                  {c.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                {c.warn && <p className={`${styles['guide-warn']}`}>{c.warn}</p>}
                {c.sources && c.sources.length > 0 && (
                  <div className={`${styles['guide-sources']}`}>
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
        <h2>预算粗算（每人每天，含住，人民币口径）</h2>
        <p className="muted">
          按 1 元人民币 ≈ 200 韩元取整折算（2026-09 央行中间价约 201.7 韩元/元，会有波动）；
          括号内保留韩元原区间，方便对照当地实际支付。
        </p>
        <ul className={`${styles['plain-list']}`}>
          {BUDGET_HINTS.map((b) => (
            <li key={b.label}>
              <span>{b.label}</span>
              <b>{b.value}</b>
            </li>
          ))}
        </ul>
        <div className={`${styles['callout']}`}>
          <b>数据来源与边界</b>
          <p className="muted">
            内容整理于 2026-09，参考偶来小路官网、韩国旅游发展局公开资料与个人实测。签证 / 票价 / 住宿餐饮价格 / 公交支付等政策会调整，出发前请以官方实时信息为准。
          </p>
        </div>
      </section>
    </div>
  )
}
