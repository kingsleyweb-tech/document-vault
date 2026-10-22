import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/styles/components.css'
import '../../src/styles/viewer.css'
import { PresentationViewer } from '../../src/components/viewer/PresentationViewer'

declare global {
  interface Window {
    harnessOpenedAt?: number
  }
}

// Entry script, not a module consumed by Fast Refresh.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const [file, setFile] = useState<File | null>(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <input
        type="file"
        accept=".pptx"
        aria-label="Presentation file"
        onChange={(event) => {
          window.harnessOpenedAt = performance.now()
          setFile(event.target.files?.[0] ?? null)
        }}
      />
      <div className="viewer" style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
        {file ? <PresentationViewer key={file.name + file.size} blob={file} documentId={`harness-${file.name}`} documentName={file.name} zoom={1} /> : null}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
