import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Modal } from './Modal'

type ToastType = 'info' | 'success' | 'error'

interface ToastItem {
  id: number
  type: ToastType
  text: string
}

interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface FeedbackApi {
  toast: (text: string, type?: ToastType) => void
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

const FeedbackContext = createContext<FeedbackApi | null>(null)

export function useToast() {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('useToast 必须在 FeedbackProvider 内使用')
  return ctx.toast
}

export function useConfirm() {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('useConfirm 必须在 FeedbackProvider 内使用')
  return ctx.confirm
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const seq = useRef(0)

  const toast = useCallback((text: string, type: ToastType = 'info') => {
    const id = ++seq.current
    setToasts((prev) => [...prev, { id, type, text }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 2800)
  }, [])

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...opts, resolve })
    })
  }, [])

  const closeConfirm = (value: boolean) => {
    confirmState?.resolve(value)
    setConfirmState(null)
  }

  const api = useMemo(() => ({ toast, confirm }), [toast, confirm])

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type}`}>
              {t.text}
            </div>
          ))}
        </div>,
        document.body,
      )}
      {confirmState && (
        <Modal
          open
          title={confirmState.title}
          width={420}
          onClose={() => closeConfirm(false)}
          footer={
            <>
              <button className="btn" onClick={() => closeConfirm(false)}>
                {confirmState.cancelText ?? '取消'}
              </button>
              <button
                className={confirmState.danger ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={() => closeConfirm(true)}
              >
                {confirmState.confirmText ?? '确定'}
              </button>
            </>
          }
        >
          <p className="confirm-text">{confirmState.message}</p>
        </Modal>
      )}
    </FeedbackContext.Provider>
  )
}
