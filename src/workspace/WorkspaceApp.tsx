import { BrowserRouter } from 'react-router-dom'
import './styles'
import App from '../App'
import { WORKSPACE_BASE } from '../routing'

// The workspace keeps its own routes (/files, /folders/...) and lives under /app.
export default function WorkspaceApp() {
  return (
    <BrowserRouter basename={WORKSPACE_BASE}>
      <App />
    </BrowserRouter>
  )
}
