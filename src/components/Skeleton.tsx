export function Skeleton({ w = '100%', h = 14, r = 6 }: { w?: number | string; h?: number; r?: number }) {
  return <span className="skeleton" style={{ width: w, height: h, borderRadius: r }} />
}

export function CardSkeleton() {
  return (
    <div className="card">
      <Skeleton h={150} r={10} />
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        <Skeleton w="60%" h={18} />
        <Skeleton w="40%" h={12} />
      </div>
    </div>
  )
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid-cards">
      {Array.from({ length: rows }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}
