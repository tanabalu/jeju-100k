import { useEffect, useState } from 'react'

/** 与项目统一移动断点（Modal / global 都用 720px）保持一致 */
const MOBILE_QUERY = '(max-width: 720px)'

/**
 * 是否处于移动端视图。基于视口宽度判断，跟随 resize 实时更新；
 * 与「用视口变窄模拟手机」的开发场景也一致 —— 窄屏就该走移动端布局。
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(MOBILE_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    // 旧浏览器用 addListener / removeListener
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else mql.removeListener(onChange)
    }
  }, [])

  return isMobile
}
