import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { FeedbackProvider } from './components/Feedback'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DataProvider, useData, type PhotoManifest } from './store/DataContext'
import { RoutesPage } from './pages/RoutesPage'
import styles from './App.module.less'

// 首页（路线列表）保持首屏同步加载；其余页面按路由懒加载，
// 各自连同独有依赖（地图/echarts/html-to-image 等）拆成独立 chunk。
const RouteDetailPage = lazy(() =>
  import('./pages/RouteDetailPage').then((m) => ({ default: m.RouteDetailPage })),
)
const PlanPage = lazy(() => import('./pages/PlanPage').then((m) => ({ default: m.PlanPage })))
const PrepPage = lazy(() => import('./pages/PrepPage').then((m) => ({ default: m.PrepPage })))
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })))
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const ReceivePage = lazy(() =>
  import('./pages/ReceivePage').then((m) => ({ default: m.ReceivePage })),
)

const NAV = [
  { to: '/', label: '路线' },
  { to: '/plan', label: '行程篮' },
  { to: '/prep', label: '行前准备' },
  { to: '/admin', label: '素材管理' },
  { to: '/settings', label: '设置' },
]

/** 页脚「数据来源」署名（纯文本标注，不占链接位） */
const DATA_SOURCES = 'jejuolletrailguide.net'

/** 本项目仓库地址（README §9 的 Dokploy 部署与本页脚引用同一个仓）。 */
const GITHUB_REPO = 'https://github.com/tanabalu/jeju-olle-100k'

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
 * 一份清单里实际存在的图片数（默认相册的额外照片也算，它们和主图同源）。
 * 用来决定页脚要不要写某个来源 —— 没下载过就不写，不要凭空署名。
 */
function countImages(manifest: PhotoManifest): number {
  return Object.values(manifest).reduce((sum, entry) => sum + 1 + (entry.gallery?.length ?? 0), 0)
}

/**
 * 页脚「配图来源」：只写素材**来自哪个站 / 谁持有版权**，以及数量。
 *
 * 逐张作者与许可不在这里罗列 —— 那已经是 `mergeAssets` 拼进相册 caption 的内容
 * （相册与灯箱都显示，满足 CC BY 的署名要求），完整清单另见 `public/photos/CREDITS.md`。
 *
 * ⚠️ 来源是**运行时读到的清单**推出来的，不是写死的：没跑 `fetch_photos.py` 时
 * manifest.json 里没有条目，这一段会自动省掉，页脚不会谎称有 Commons 配图
 * （那种情况下封面回落到官方路线图）。
 */
function FooterPhotoCredit() {
  const { photoManifest, routeMaps } = useData()
  const commonsCount = countImages(photoManifest)
  const mapsCount = countImages(routeMaps)
  if (commonsCount === 0 && mapsCount === 0) return null
  return (
    <p className={`${styles['footer-line']}`}>
      配图来源：
      {commonsCount > 0 && (
        <>
          <a
            className={`${styles['footer-link']}`}
            href="https://commons.wikimedia.org/"
            target="_blank"
            rel="noopener noreferrer"
            title="本站风景配图的来源站：逐张作者与许可见详情页相册说明"
          >
            Wikimedia Commons
          </a>
          {`（${commonsCount} 张 · CC0 / CC BY / CC BY-SA / 公共领域）`}
        </>
      )}
      {commonsCount > 0 && mapsCount > 0 ? ' · ' : null}
      {mapsCount > 0 && `官方路线图 © Jeju Olle Foundation（${mapsCount} 张）`}
    </p>
  )
}

/**
 * GitHub 官方 Mark 图标（24×24 官方网格，实际尺寸由 CSS 定）。
 * path 来自 simple-icons 的 github.svg（CC0 公有领域）；fill 走 currentColor，
 * 因此深色图形会跟随链接文字色变化，不需要再维护一份 hover 色。
 */
function GitHubMark() {
  return (
    <svg
      className={`${styles['footer-github-icon']}`}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  )
}

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
      <Suspense fallback={<div className="empty">加载中…</div>}>
        <Routes>
          <Route path="/" element={<RoutesPage />} />
          <Route path="/routes/:id" element={<RouteDetailPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/prep" element={<PrepPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/receive" element={<ReceivePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
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
            <header className={`${styles['topbar']}`}>
              <Link to="/" className={`${styles['brand']}`} title="回到首页" onClick={closeMobileNav}>
                <span className={`${styles['brand-mark']}`}>100K</span>
                <span className={`${styles['brand-text']}`}>
                  偶来小路 · 百公里攻略
                  <em>济州岛 Jeju Olle Trail · 29 条路线凑里程（3 / 15 号线各分 A 山线 · B 海线）</em>
                </span>
              </Link>
              <button
                type="button"
                className={`${styles['mobile-menu-button']}`}
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
              <nav className={`${styles['nav']}`}>
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
                  className={`${styles['mobile-nav-backdrop']}`}
                  aria-label="关闭目录"
                  onClick={closeMobileNav}
                />
                <aside id="mobile-main-nav" className={`${styles['mobile-nav-drawer']}`} role="dialog" aria-modal="true" aria-label="主目录">
                  <div className={`${styles['mobile-nav-heading']}`}>
                    <strong>目录</strong>
                    <button type="button" className={`${styles['mobile-nav-close']}`} aria-label="关闭目录" onClick={closeMobileNav}>
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                  <nav className={`${styles['mobile-nav-links']}`}>
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
            <main className={`${styles['content']}`}>
              <PageRoutes />
            </main>
            <footer className={`${styles['footer']}`}>
              <p className={`${styles['footer-line']}`}>
                数据仅保存在本机浏览器 · 底图服务：OpenStreetMap · 住宿数据：OpenStreetMap contributors（ODbL，经 Overpass API 抓取）· 数据来源：{DATA_SOURCES}
              </p>
              <FooterPhotoCredit />
              <p className={`${styles['footer-line']} ${styles['footer-friends']}`}>
                <span className={`${styles['footer-tag']}`}>友情链接</span>
                {FRIEND_LINKS.map((l) => (
                  <a
                    key={l.url}
                    className={`${styles['footer-link']}`}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={l.desc}
                  >
                    {l.name}
                  </a>
                ))}
              </p>
              <p className={`${styles['footer-line']} ${styles['footer-github']}`}>
                <a
                  className={`${styles['footer-github-link']}`}
                  href={GITHUB_REPO}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="在 GitHub 上查看本项目源码（tanabalu/jeju-olle-100k）"
                >
                  <GitHubMark />
                  <span>GitHub</span>
                </a>
              </p>
            </footer>
          </div>
        </DataProvider>
      </FeedbackProvider>
    </HashRouter>
  )
}
