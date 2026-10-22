import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './site.css'
import { SiteLayout } from './SiteLayout'
import { Home } from './pages/Home'

const Features = lazy(() => import('./pages/Features'))
const About = lazy(() => import('./pages/About'))
const Downloads = lazy(() => import('./pages/Downloads'))
const Documentation = lazy(() => import('./pages/Documentation'))
const Security = lazy(() => import('./pages/Security'))
const Privacy = lazy(() => import('./pages/Privacy'))
const Terms = lazy(() => import('./pages/Terms'))
const NotFound = lazy(() => import('./pages/NotFound'))
// Sign-in needs Firebase, so it is the only part of this site that loads it.
const SignIn = lazy(() => import('./SignIn'))
const DesktopSignIn = lazy(() => import('./DesktopSignIn'))

export default function PublicSite() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Lazy><SignIn /></Lazy>} />
        <Route path="/register" element={<Lazy><SignIn mode="register" /></Lazy>} />
        <Route path="/desktop-sign-in" element={<Lazy><DesktopSignIn /></Lazy>} />
        <Route element={<SiteLayout />}>
          <Route index element={<Home />} />
          <Route path="features" element={<Features />} />
          <Route path="about" element={<About />} />
          <Route path="downloads" element={<Downloads />} />
          <Route path="documentation" element={<Documentation />} />
          <Route path="documentation/:slug" element={<Documentation />} />
          <Route path="security" element={<Security />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="terms" element={<Terms />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="route-loader">Loading...</div>}>{children}</Suspense>
}
