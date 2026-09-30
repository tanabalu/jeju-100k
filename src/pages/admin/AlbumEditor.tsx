import type { AlbumItem, Route } from '../../types'
import { emptyAlbumItem } from '../../lib/storage'
import { ImageField } from '../../components/ImageField'
import { Thumb } from '../../components/Thumb'
import { DatePicker } from '../../components/DatePicker'
import { useConfirm } from '../../components/Feedback'
import styles from './AlbumEditor.module.less'

interface Props {
  route: Route
  onPatch: (patch: Partial<Route>) => void
}

/** 系统默认提供的照片素材（Wikimedia 风景照 / 官方路线图），id 固定为 photo_/map_ 前缀，不可删除 */
function isSystemAlbumItem(a: AlbumItem): boolean {
  return a.id.startsWith('photo_') || a.id.startsWith('map_')
}

export function AlbumEditor({ route, onPatch }: Props) {
  const confirm = useConfirm()
  const album = route.album
  const setAlbum = (next: AlbumItem[]) => onPatch({ album: next })
  const patch = (id: string, p: Partial<AlbumItem>) => setAlbum(album.map((a) => (a.id === id ? { ...a, ...p } : a)))

  return (
    <div>
      <div className="section-head">
        <h3>相册（{album.length}）</h3>
        <button className="btn btn-sm btn-primary" onClick={() => setAlbum([...album, emptyAlbumItem()])}>
          添加照片
        </button>
      </div>

      <p className="muted" style={{ marginTop: -4, marginBottom: 10, fontSize: 12 }}>
        标有「系统」的照片为程序默认素材，不可删除（重新加载数据后会自动恢复）。
      </p>

      {album.length === 0 && <p className="muted">还没有照片。支持本地上传（自动压缩）或填外链。</p>}

      <div className={`${styles['album-editor']}`}>
        {album.map((a) => {
          const isSystem = isSystemAlbumItem(a)
          return (
            <div key={a.id} className={`album-editor-cell${isSystem ? ' is-system' : ''}`}>
              <div className={`${styles['album-editor-img']}`}>
                <Thumb image={a.image} alt={a.caption ?? ''} />
                {isSystem && <span className={`${styles['album-system-tag']}`}>系统</span>}
              </div>
              <ImageField value={a.image} onChange={(image) => patch(a.id, { image: image ?? { kind: 'url', value: '' } })} height={90} />
              <input
                className="input input-xs"
                placeholder="说明"
                value={a.caption ?? ''}
                onChange={(e) => patch(a.id, { caption: e.target.value })}
              />
              <DatePicker
                size="xs"
                value={a.takenAt ?? ''}
                onChange={(v) => patch(a.id, { takenAt: v })}
                placeholder="拍摄日期"
                ariaLabel="拍摄日期"
              />
              <button
                className="btn btn-xs btn-danger"
                disabled={isSystem}
                title={isSystem ? '系统默认素材，不可删除' : undefined}
                onClick={async () => {
                  if (isSystem) return
                  if (await confirm({ title: '删除照片', message: '从相册移除这张照片？', confirmText: '删除', danger: true })) {
                    setAlbum(album.filter((x) => x.id !== a.id))
                  }
                }}
              >
                删除
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
