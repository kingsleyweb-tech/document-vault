export function LoadingState() {
  return (
    <div className="loading-state" role="status" aria-live="polite" aria-label="Loading files and documents">
      <div className="loading-state__intro">
        <span className="app-spinner" aria-hidden="true" />
        <strong>Loading files/documents</strong>
      </div>
      <div className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="skeleton-card" key={index}>
            <span />
            <strong />
            <p />
            <p />
          </div>
        ))}
      </div>
    </div>
  )
}
