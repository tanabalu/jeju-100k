import type { Route } from '../../types'
import { computeMetrics, formatKm } from '../../lib/geo'
import { routeKindLabel } from '../../lib/routeKind'
import { ImageField } from '../../components/ImageField'

interface Props {
  route: Route
}

export function BasicForm({ route }: Props) {
  const m = computeMetrics(route)
  const stars = '★'.repeat(Math.max(1, Math.min(5, route.difficulty)))
  const distance =
    route.manualDistanceKm != null
      ? `${route.manualDistanceKm} km`
      : `${formatKm(m.straightKm * 1.2)} km（按直线 ×1.2 估算）`
  const gain =
    route.manualGainM != null
      ? `${route.manualGainM} m`
      : m.gainM == null
      ? '无海拔数据'
      : `${m.gainM} m${m.gainSource === 'profile' ? '（来自地形采样）' : ''}`

  const rows: Array<{ label: string; value: string }> = [
    { label: '路线编号', value: route.code ?? '—' },
    { label: '地区', value: route.region || '—' },
    { label: '类型', value: routeKindLabel(route.kind) },
    { label: '难度', value: `${route.difficulty} 级（${stars}）` },
    { label: '路面 / 地形', value: route.surface || '—' },
    { label: '最佳季节', value: route.bestSeason || '—' },
    { label: '标签', value: route.tags.length ? route.tags.join('、') : '—' },
    { label: '实际里程', value: distance },
    { label: '实际累计爬升', value: gain },
  ]

  return (
    <div className="info-view">
      <h3 className="info-title">{route.name}</h3>
      <dl className="info-list">
        {rows.map((r) => (
          <div className="info-row" key={r.label}>
            <dt className="info-label">{r.label}</dt>
            <dd className="info-value">{r.value}</dd>
          </div>
        ))}
      </dl>
      {route.summary && (
        <div className="info-block">
          <div className="info-label">简介</div>
          <p className="info-value">{route.summary}</p>
        </div>
      )}
      {route.cover && (
        <div className="info-block">
          <div className="info-label">封面图</div>
          <ImageField value={route.cover} onChange={() => {}} readOnly />
        </div>
      )}
    </div>
  )
}
