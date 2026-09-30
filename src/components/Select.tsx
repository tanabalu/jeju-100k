import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './Select.module.less'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  disabled?: boolean
  className?: string
  ariaLabel?: string
  placeholder?: string
  /** 尺寸变体：sm / xs 用于工具栏与表格内紧凑场景 */
  size?: 'sm' | 'xs'
  /** 透传到触发按钮的内联样式（如 flex 容器里要 fill） */
  style?: React.CSSProperties
}

interface Coords {
  left: number
  width: number
  top?: number
  bottom?: number
}

const PANEL_MAX_H = 260

function computeCoords(rect: DOMRect): Coords {
  const spaceBelow = rect.bottom + 4 + PANEL_MAX_H <= window.innerHeight
  const spaceAbove = rect.top - 4 - PANEL_MAX_H >= 0
  const below = spaceBelow || !spaceAbove
  return below
    ? { left: rect.left, width: rect.width, top: rect.bottom + 4 }
    : { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + 4 }
}

/**
 * 自定义下拉框组件，用来替代项目里所有原生 `<select>`。
 *
 * 为什么不用原生 select：原生下拉在移动端会唤起系统选择器、且无法统一视觉；
 * 这里用按钮 + portal 面板实现，触屏直接点按即可（不依赖原生 select 的 tap 行为），
 * 同时支持键盘（Enter/Space 开、↑↓ 移动、Enter 选、Esc 关）。
 *
 * 用 portal 渲染面板，挂在 document.body 上，按触发按钮的视口坐标定位 ——
 * 这样即使触发按钮处在 `overflow-x:auto` / `overflow:hidden` 的容器里（如按天看板的滚动区），
 * 展开的选项也不会被裁剪。
 */
export function Select(props: SelectProps) {
  const { value, onChange, options, disabled, className, ariaLabel, placeholder, size, style } = props
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [coords, setCoords] = useState<Coords>({ left: 0, width: 120 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value) ?? null
  const sizeCls = size === 'xs' ? ` ${styles.xs}` : size === 'sm' ? ` ${styles.sm}` : ''

  const openMenu = () => {
    if (disabled || !triggerRef.current) return
    const idx = Math.max(0, options.findIndex((o) => o.value === value))
    setActive(idx)
    setCoords(computeCoords(triggerRef.current.getBoundingClientRect()))
    setOpen(true)
  }

  // 打开时：焦点移到面板（listbox），并用捕获监听处理「点外部关闭 / Esc / 滚动缩放跟随定位」
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
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
      setCoords(computeCoords(triggerRef.current.getBoundingClientRect()))
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  useLayoutEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  // 键盘移动焦点时把高亮项滚进可视区
  useEffect(() => {
    if (!open || !panelRef.current) return
    const el = panelRef.current.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (v: string) => {
    onChange(v)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      openMenu()
    }
  }

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => {
        let n = i
        do n = (n + 1) % options.length
        while (options[n].disabled && n !== i)
        return n
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => {
        let n = i
        do n = (n - 1 + options.length) % options.length
        while (options[n].disabled && n !== i)
        return n
      })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const o = options[active]
      if (o && !o.disabled) choose(o.value)
    } else if (e.key === 'Escape') {
      setOpen(false)
      triggerRef.current?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger}${open ? ` ${styles['is-open']}` : ''}${
          disabled ? ` ${styles.disabled}` : ''
        }${sizeCls}${className ? ` ${className}` : ''}`}
        style={style}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKey}
      >
        <span className={`${styles.label}${selected ? '' : ` ${styles.placeholder}`}`}>
          {selected ? selected.label : (placeholder ?? '')}
        </span>
        <svg className={styles.chev} viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2 4l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={styles.panel}
            role="listbox"
            tabIndex={-1}
            style={{
              left: coords.left,
              width: coords.width,
              minWidth: coords.width,
              maxWidth: 360,
              ...(coords.top !== undefined ? { top: coords.top } : { bottom: coords.bottom }),
            }}
            onKeyDown={onListKey}
          >
            {options.map((o, i) => (
              <div
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                data-active={i === active}
                className={`${styles.opt}${i === active ? ` ${styles['is-active']}` : ''}${
                  o.value === value ? ` ${styles['is-selected']}` : ''
                }${o.disabled ? ` ${styles.disabled}` : ''}`}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onClick={() => !o.disabled && choose(o.value)}
              >
                <span className={styles['opt-label']}>{o.label}</span>
                {o.value === value && <span className={styles['opt-check']}>✓</span>}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
