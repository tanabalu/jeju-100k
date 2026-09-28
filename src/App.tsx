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

/**
 * 内容区单独包一层错误边界：某个页面挂了，顶栏导航还在，切到别的页面还能继续用。
 * key 绑 pathname —— 换路由就重建边界实例，避免上一个页面的错误态带到下一个页面。
 */
function PageRoutes() {
  const location = useLocation()
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
  return (
    <HashRouter>
      <FeedbackProvider>
        <DataProvider>
          <div className="app">
            <header className="topbar">
            <Link to="/" className="brand" title="回到首页">
              <span className="brand-mark">100K</span>
              <span className="brand-text">
                偶来小路 · 百公里攻略
                <em>济州岛 Jeju Olle Trail · 27 条路线凑里程</em>
              </span>
            </Link>
              <nav className="nav">
                {NAV.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'nav-link is-active' : 'nav-link')}>
                    {n.label}
                  </NavLink>
                ))}
              </nav>
            </header>
            <main className="content">
              <PageRoutes />
            </main>
            <footer className="footer">
              数据仅保存在本机浏览器 · 底图服务：OpenStreetMap
            </footer>
          </div>
        </DataProvider>
      </FeedbackProvider>
    </HashRouter>
  )
}
