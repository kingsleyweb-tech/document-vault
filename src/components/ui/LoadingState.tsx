export function LoadingState() {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="loading-state__intro">
        <span className="app-spinner" aria-hidden="true" />
        <span>Loading your documents</span>
      </div>
      <div className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="skeleton-card" key={index} />
        ))}
      </div>
    </div>
  )
}
