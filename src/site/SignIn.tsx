import '../index.css'
import '../styles/components.css'
import '../styles/shell.css'
import '../styles/pages.css'
import { Login } from '../pages/Login'

export default function SignIn({ mode }: { mode?: 'sign-in' | 'register' }) {
  return <Login mode={mode} />
}
