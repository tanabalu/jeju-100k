import type { Route } from '../../types'
import { computeMetrics, formatKm } from '../../lib/geo'
import { ImageField } from '../../components/ImageField'

interface Props {
  route: Route
  onPatch: (patch: Partial<Route>) => void
}

export function BasicForm({ route, onPatch }: Props) {
  const m = computeMetrics(route)
  const tagsText = route.tags.join('、')

  return (
    <div className="form">
      <label className="field">
        <span>路线名称</span>
        <input className="input" value={route.name} onChange={(e) => onPatch({ name: e.target.value })} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>路线编号</span>
          <input
            className="input"
            placeholder="如：07 / 07-1"
            value={route.code ?? ''}
            onChange={(e) => onPatch({ code: e.target.value })}
          />
        </label>
        <label className="field">
          <span>地区</span>
          <input
            className="input"
            placeholder="如：韩国 · 济州岛 · 西归浦"
            value={route.region}
            onChange={(e) => onPatch({ region: e.target.value })}
          />
        </label>
        <label className="field">
          <span>类型</span>
          <select className="input" value={route.kind} onChange={(e) => onPatch({ kind: e.target.value as Route['kind'] })}>
            <option value="hike">徒步</option>
            <option value="trailrun">越野跑</option>
            <option value="fastpack">轻装快穿</option>
          </select>
        </label>
        <label className="field">
          <span>难度（1-5）</span>
          <select
            className="input"
            value={route.difficulty}
            onChange={(e) => onPatch({ difficulty: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} ★
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>简介</span>
        <textarea
          className="input"
          rows={3}
          value={route.summary}
          onChange={(e) => onPatch({ summary: e.target.value })}
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span>路面 / 地形</span>
          <input
            className="input"
            placeholder="如：山径 / 草甸 / 台阶"
            value={route.surface ?? ''}
            onChange={(e) => onPatch({ surface: e.target.value })}
          />
        </label>
        <label className="field">
          <span>最佳季节</span>
          <input
            className="input"
            placeholder="如：4-6 月、9-11 月"
            value={route.bestSeason ?? ''}
            onChange={(e) => onPatch({ bestSeason: e.target.value })}
          />
        </label>
      </div>

      <label className="field">
        <span>标签（用、或逗号分隔）</span>
        <input
          className="input"
          value={tagsText}
          onChange={(e) =>
            onPatch({
              tags: e.target.value
                .split(/[、,，\s]+/)
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span>
            实际里程（km）<em className="hint">留空则按途经点直线里程 × 1.2 估算，当前估算 {formatKm(m.straightKm * 1.2)} km</em>
          </span>
          <input
            className="input"
            type="number"
            step="0.1"
            placeholder={formatKm(m.straightKm * 1.2)}
            value={route.manualDistanceKm ?? ''}
            onChange={(e) => onPatch({ manualDistanceKm: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>
            实际累计爬升（m）
            <em className="hint">
              留空则用当前估算值（{m.gainM == null ? '无海拔数据' : `${m.gainM} m`}
              {m.gainSource === 'profile' ? '，来自地形采样' : ''}）。填了就以你填的为准
            </em>
          </span>
          <input
            className="input"
            type="number"
            step="10"
            value={route.manualGainM ?? ''}
            onChange={(e) => onPatch({ manualGainM: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="field">
        <span>封面图</span>
        <ImageField value={route.cover} onChange={(cover) => onPatch({ cover })} height={140} />
      </div>
    </div>
  )
}
