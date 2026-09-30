import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './DatePicker.module.less'

export interface DatePickerProps {
  /** 'YYYY-MM-DD'；空串表示未选择 */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  ariaLabel?: string
  /** 触发按钮的原生 title（悬停提示） */
  title?: string
  size?: 'sm' | 'xs'
}

const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日']
const PANEL_W = 264

/** 'YYYY-MM-DD' → 本地 Date（正午，避开 DST 边界）；空串 / 非法 → null */
function parseDateStr(value: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}

function formatDateStr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 自定义日期选择器，替代原生 `<input type="date">`。
 *
 * 参考 task-system-frontend 的自研 DatePicker（周一开头、翻月、今天/清除），
 * 但面板用 portal 挂到 body，按触发按钮视口坐标定位并做左右越界钳制 ——
 * 这样即便触发按钮处于 overflow 容器里，日历也不会被裁剪，且不会溢出屏幕右侧。
 *
 * 视觉全部走本应用令牌，与原生控件在各浏览器各行其是的弹出层割裂问题一并解决。
 */
export function DatePicker(props: DatePickerProps) {
  const { value, onChange, placeholder = '选择日期', className, ariaLabel, title, size } = props
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 })
  /** 日历当前展示的年月（不动 value —— 翻月不应改变已选日期） */
  const [view, setView] = useState(() => {
    const init = parseDateStr(value) ?? new Date()
    return { year: init.getFullYear(), month: init.getMonth() }
  })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const reposition = () => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      const below = rect.bottom + 4 + 320 <= window.innerHeight
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_W - 8))
      setCoords(below ? { left, top: rect.bottom + 4 } : { left, bottom: window.innerHeight - rect.top + 4 })
    }
    reposition()
    document.addEventListener('mousedown', onDocClick, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', onDocClick, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  const todayStr = formatDateStr(new Date())
  const selectedDate = parseDateStr(value)

  const shiftMonth = (delta: number) =>
    setView((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1, 12)
      return { year: d.getFullYear(), month: d.getMonth() }
    })

  // 42 格（6 行），周一开头：getDay() 周日=0 → (day + 6) % 7
  const firstOfMonth = new Date(view.year, view.month, 1, 12)
  const lead = (firstOfMonth.getDay() + 6) % 7
  const cells: Array<{ date: Date; inMonth: boolean }> = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(view.year, view.month, 1 - lead + i, 12)
    cells.push({ date: d, inMonth: d.getMonth() === view.month })
  }

  const sizeCls = size === 'xs' ? ` ${styles.xs}` : size === 'sm' ? ` ${styles.sm}` : ''

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger}${open ? ` ${styles['is-open']}` : ''}${sizeCls}${
          className ? ` ${className}` : ''
        }`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        onClick={() => {
          const target = selectedDate ?? new Date()
          setView({ year: target.getFullYear(), month: target.getMonth() })
          setOpen((v) => !v)
        }}
      >
        <svg className={styles.cal} viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2 6h12M5 2v3M11 2v3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span className={`${styles.value}${value ? '' : ` ${styles.placeholder}`}`}>
          {value ? value.replace(/-/g, ' / ') : placeholder}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={styles.panel}
            role="dialog"
            style={{
              left: coords.left,
              width: PANEL_W,
              ...(coords.top !== undefined ? { top: coords.top } : { bottom: coords.bottom }),
            }}
          >
            <div className={styles.head}>
              <button
                type="button"
                className={styles.nav}
                onClick={() => shiftMonth(-1)}
                aria-label="上个月"
              >
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M7.5 3l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <span className={styles.title}>
                {view.year} 年 {view.month + 1} 月
              </span>
              <button type="button" className={styles.nav} onClick={() => shiftMonth(1)} aria-label="下个月">
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M4.5 3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <div className={styles.grid}>
              {WEEKDAY_HEADERS.map((w) => (
                <span key={w} className={styles.weekday}>
                  {w}
                </span>
              ))}
              {cells.map(({ date, inMonth }) => {
                const str = formatDateStr(date)
                const isSelected = str === value
                const isToday = str === todayStr
                return (
                  <button
                    key={str}
                    type="button"
                    role="gridcell"
                    aria-selected={isSelected}
                    className={[
                      styles.cell,
                      inMonth ? '' : styles.out,
                      isSelected ? styles.selected : '',
                      isToday && !isSelected ? styles.today : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      onChange(str)
                      setOpen(false)
                    }}
                  >
                    {date.getDate()}
                  </button>
                )
              })}
            </div>
            <div className={styles.foot}>
              <button
                type="button"
                className={styles.footBtn}
                onClick={() => {
                  onChange(todayStr)
                  setOpen(false)
                }}
              >
                今天
              </button>
              <button
                type="button"
                className={styles.footBtn}
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                清除
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
