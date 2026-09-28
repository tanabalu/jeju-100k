import type { AlbumItem, Route } from '../../types'
import { emptyAlbumItem } from '../../lib/storage'
import { ImageField } from '../../components/ImageField'
import { Thumb } from '../../components/Thumb'
import { useConfirm } from '../../components/Feedback'

interface Props {
  route: Route
  onPatch: (patch: Partial<Route>) => void
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

      {album.length === 0 && <p className="muted">还没有照片。支持本地上传（自动压缩）或填外链。</p>}

      <div className="album-editor">
        {album.map((a) => (
          <div key={a.id} className="album-editor-cell">
            <div className="album-editor-img">
              <Thumb image={a.image} alt={a.caption ?? ''} />
            </div>
            <ImageField value={a.image} onChange={(image) => patch(a.id, { image: image ?? { kind: 'url', value: '' } })} height={90} />
            <input
              className="input input-xs"
              placeholder="说明"
              value={a.caption ?? ''}
              onChange={(e) => patch(a.id, { caption: e.target.value })}
            />
            <input
              className="input input-xs"
              type="date"
              value={a.takenAt ?? ''}
              onChange={(e) => patch(a.id, { takenAt: e.target.value })}
            />
            <button
              className="btn btn-xs btn-danger"
              onClick={async () => {
                if (await confirm({ title: '删除照片', message: '从相册移除这张照片？', confirmText: '删除', danger: true })) {
                  setAlbum(album.filter((x) => x.id !== a.id))
                }
              }}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
