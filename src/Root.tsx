import { Suspense, lazy } from 'react'
import { isWorkspacePath } from './routing'

// The workspace (and Firebase with it) only loads under /app; every other path
// is the public site, which stays small and never touches the user's data.
const WorkspaceApp = lazy(() => import('./workspace/WorkspaceApp'))
const PublicSite = lazy(() => import('./site/PublicSite'))

export function Root({ pathname }: { pathname: string }) {
  return (
    <Suspense fallback={<div className="boot-loader" role="status">Loading...</div>}>
      {isWorkspacePath(pathname) ? <WorkspaceApp /> : <PublicSite />}
    </Suspense>
  )
}
