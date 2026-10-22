import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}

export function PageHeader({ title, description, actions, children }: PageHeaderProps) {
  return (
    <header className="page-header">
      {children}
      <div className="page-header__row">
        <div className="page-header__text">
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>
    </header>
  )
}
