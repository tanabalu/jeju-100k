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
        标有「系统」的照片为程序默认素材，仅可预览，不可编辑或删除（重新加载数据后会自动恢复）。
      </p>

      {album.length === 0 && <p className="muted">还没有照片。支持本地上传（自动压缩）或填外链。</p>}

      <div className={`${styles['album-editor']}`}>
        {album.map((a) => {
          const isSystem = isSystemAlbumItem(a)
          return (
            <div key={a.id} className={`album-editor-cell${isSystem ? ' is-system' : ''}`}>
              {isSystem ? (
                <>
                  <div className={`${styles['album-editor-img']}`}>
                    <Thumb image={a.image} alt={a.caption ?? ''} />
                    <span className={`${styles['album-system-tag']}`}>系统</span>
                  </div>
                  {/* 系统照片仅预览：只读展示，不做任何编辑和按钮操作 */}
                  <div className={styles['album-system-preview']}>
                    <span className={styles['album-system-caption']}>{a.caption || '系统默认素材'}</span>
                    {a.takenAt && <span className={styles['album-system-date']}>{a.takenAt}</span>}
                  </div>
                </>
              ) : (
                <>
                  <ImageField
                    value={a.image}
                    onChange={(image) => image && patch(a.id, { image })}
                    height={120}
                  />
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
                    onClick={async () => {
                      if (
                        await confirm({ title: '删除照片', message: '从相册移除这张照片？', confirmText: '删除', danger: true })
                      ) {
                        setAlbum(album.filter((x) => x.id !== a.id))
                      }
                    }}
                  >
                    删除
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
