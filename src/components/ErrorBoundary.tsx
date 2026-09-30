import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { Modal } from './Modal'
import { clearAllLocalData } from '../lib/storage'
import { clearImageStore } from '../lib/imageStore'
import styles from './ErrorBoundary.module.less'

interface Props {
  children: ReactNode
  /** 'app' = 兜底整站（连顶栏一起挂了）；'page' = 只挂当前页面内容区 */
  scope?: 'app' | 'page'
}

interface State {
  error: Error | null
  /** React 的组件栈，用于展开排查 */
  componentStack?: string
}

/**
 * 全局错误边界：渲染期抛错时展示自定义错误页，而不是白屏。
 *
 * ⚠️ 能力边界（说清楚，别指望它能兜住一切）：
 * - 只捕获**渲染 / 生命周期 / 构造函数**里的错误；
 * - 事件回调、setTimeout、fetch 回调里的异步错误 React 不会往上抛，这里抓不到
 *   （这类错误不会白屏，但会在控制台报，界面表现为"点了没反应"）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 留一份到控制台，方便排查（生产构建里页面上的 message 常被压缩成 React error #xxx）
    console.error('[ErrorBoundary]', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? undefined })
  }

  private reset = () => this.setState({ error: null, componentStack: undefined })

  private goHome = () => {
    this.reset()
    window.location.hash = '#/'
  }

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children
    return (
      <ErrorView
        error={error}
        componentStack={componentStack}
        scope={this.props.scope ?? 'page'}
        onRetry={this.reset}
        onGoHome={this.goHome}
      />
    )
  }
}

function ErrorView({
  error,
  componentStack,
  scope,
  onRetry,
  onGoHome,
}: {
  error: Error
  componentStack?: string
  scope: 'app' | 'page'
  onRetry: () => void
  onGoHome: () => void
}) {
  const [showStack, setShowStack] = useState(false)
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [wipeOpen, setWipeOpen] = useState(false)

  const detail = [error.name ? `${error.name}: ${error.message}` : error.message, componentStack]
    .filter(Boolean)
    .join('\n\n组件栈：\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail)
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
    window.setTimeout(() => setCopied('idle'), 2400)
  }

  const wipe = async () => {
    await clearImageStore()
    clearAllLocalData()
    window.location.reload()
  }

  return (
    <div className={scope === 'app' ? 'error-page is-app' : 'error-page'}>
      <div className={`${styles['error-card']}`}>
        <div className={`${styles['error-badge']}`}>!</div>
        <h1>{scope === 'app' ? '页面加载失败了' : '这个页面出错了'}</h1>
        <p className={`${styles['error-lead']}`}>
          还好没白屏 —— 你的路线、行程篮和清单都存在本机浏览器里，不会因为这次报错丢掉。
        </p>

        <div className={`${styles['error-msg']}`}>{error.message || '未知错误'}</div>

        <div className="btn-row">
          <button className="btn btn-primary" onClick={onRetry}>
            重试
          </button>
          <button className="btn" onClick={onGoHome}>
            回到首页
          </button>
          <button className="btn" onClick={copy}>
            {copied === 'ok' ? '已复制' : copied === 'fail' ? '复制失败' : '复制错误信息'}
          </button>
          {componentStack && (
            <button className="btn btn-plain" onClick={() => setShowStack((v) => !v)}>
              {showStack ? '收起技术细节' : '查看技术细节'}
            </button>
          )}
        </div>

        {showStack && componentStack && <pre className={`${styles['error-stack']}`}>{componentStack.trim()}</pre>}

        <div className={`${styles['error-foot']}`}>
          <span className="muted">反复出错的话，多半是本机数据里有条坏记录。</span>
          <button className="btn-link btn-link-danger" onClick={() => setWipeOpen(true)}>
            清空本机数据并重载
          </button>
        </div>
      </div>

      <Modal
        open={wipeOpen}
        title="清空本机数据"
        width={440}
        onClose={() => setWipeOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setWipeOpen(false)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={wipe}>
              清空并重载
            </button>
          </>
        }
      >
        <p className="confirm-text">
          会删除这台浏览器里保存的全部路线、行程篮、行前清单和上传的图片，并重置默认素材，
          <b>无法恢复</b>。确定要继续吗？
        </p>
        <p className="muted">建议先试「重试」和「回到首页」；都不行再走这一步。</p>
      </Modal>
    </div>
  )
}
