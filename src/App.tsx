import { useEffect, useRef, useState } from 'react'
import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { FeedbackProvider } from './components/Feedback'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DataProvider } from './store/DataContext'
import { RoutesPage } from './pages/RoutesPage'
import { RouteDetailPage } from './pages/RouteDetailPage'
import { PlanPage } from './pages/PlanPage'
import { PrepPage } from './pages/PrepPage'
import { AdminPage } from './pages/AdminPage'
import { SettingsPage } from './pages/SettingsPage'

const NAV = [
  { to: '/', label: '路线' },
  { to: '/plan', label: '行程篮' },
  { to: '/prep', label: '行前准备' },
  { to: '/admin', label: '素材管理' },
  { to: '/settings', label: '设置' },
]

/** 页脚「数据来源」署名（纯文本标注，不占链接位） */
const DATA_SOURCES = 'jejuolletrailguide.net'

/**
 * 页脚友链：加一条往这里塞就行。
 * 外链一律 target="_blank" + rel="noopener noreferrer"（防新开页通过 window.opener 反向控制本页）。
 */
const FRIEND_LINKS = [
  {
    name: 'Jeju Olle Trail 官方英文指南',
    url: 'https://jejuolletrailguide.net',
    desc: '济州偶来官方英文站：437km 步道里程、难度与实用信息',
  },
]

/**
 * 内容区单独包一层错误边界：某个页面挂了，顶栏导航还在，切到别的页面还能继续用。
 * key 绑 pathname —— 换路由就重建边界实例，避免上一个页面的错误态带到下一个页面。
 */
function PageRoutes() {
  const location = useLocation()
  // 路由切换（含从列表点卡片进详情页）不自动滚回顶部，
  // 新页面会停留在上一页的滚动位置 —— 这里统一在换路由时滚到顶部。
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])
  return (
    <ErrorBoundary key={location.pathname} scope="page">
      <Routes>
        <Route path="/" element={<RoutesPage />} />
        <Route path="/routes/:id" element={<RouteDetailPage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/prep" element={<PrepPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  )
}

function NotFound() {
  return (
    <div className="empty">
      页面不存在。<Link to="/">回到路线列表</Link>
    </div>
  )
}
export default function App() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!mobileNavOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false)
        mobileMenuButtonRef.current?.focus()
        return
      }
      if (event.key !== 'Tab') return

      const drawer = document.getElementById('mobile-main-nav')
      const focusable = drawer?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.querySelector<HTMLElement>('.mobile-nav-close')?.focus()
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [mobileNavOpen])

  const closeMobileNav = () => {
    setMobileNavOpen(false)
    mobileMenuButtonRef.current?.focus()
  }

  return (
    <HashRouter>
      <FeedbackProvider>
        <DataProvider>
          <div className="app">
            <header className="topbar">
              <Link to="/" className="brand" title="回到首页" onClick={closeMobileNav}>
                <span className="brand-mark">100K</span>
                <span className="brand-text">
                  偶来小路 · 百公里攻略
                  <em>济州岛 Jeju Olle Trail · 27 条路线凑里程</em>
                </span>
              </Link>
              <button
                type="button"
                className="mobile-menu-button"
                ref={mobileMenuButtonRef}
                aria-label={mobileNavOpen ? '关闭目录' : '打开目录'}
                aria-expanded={mobileNavOpen}
                aria-controls="mobile-main-nav"
                onClick={() => setMobileNavOpen((open) => !open)}
              >
                <span className={mobileNavOpen ? 'menu-icon is-open' : 'menu-icon'} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </button>
              <nav className="nav">
                {NAV.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'nav-link is-active' : 'nav-link')}>
                    {n.label}
                  </NavLink>
                ))}
              </nav>
            </header>
            {mobileNavOpen && (
              <>
                <button
                  type="button"
                  className="mobile-nav-backdrop"
                  aria-label="关闭目录"
                  onClick={closeMobileNav}
                />
                <aside id="mobile-main-nav" className="mobile-nav-drawer" role="dialog" aria-modal="true" aria-label="主目录">
                  <div className="mobile-nav-heading">
                    <strong>目录</strong>
                    <button type="button" className="mobile-nav-close" aria-label="关闭目录" onClick={closeMobileNav}>
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                  <nav className="mobile-nav-links">
                    {NAV.map((n) => (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        end={n.to === '/'}
                        onClick={closeMobileNav}
                        className={({ isActive }) => (isActive ? 'nav-link is-active' : 'nav-link')}
                      >
                        {n.label}
                      </NavLink>
                    ))}
                  </nav>
                </aside>
              </>
            )}
            <main className="content">
              <PageRoutes />
            </main>
            <footer className="footer">
              <p className="footer-line">
                数据仅保存在本机浏览器 · 底图服务：OpenStreetMap · 数据来源：{DATA_SOURCES}
              </p>
              <p className="footer-line footer-friends">
                <span className="footer-tag">友情链接</span>
                {FRIEND_LINKS.map((l) => (
                  <a
                    key={l.url}
                    className="footer-link"
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={l.desc}
                  >
                    {l.name}
                  </a>
                ))}
              </p>
            </footer>
          </div>
        </DataProvider>
      </FeedbackProvider>
    </HashRouter>
  )
}
