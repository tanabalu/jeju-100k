import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 最外层兜底：连 Router / Provider 自己崩了也不会白屏 */}
    <ErrorBoundary scope="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
