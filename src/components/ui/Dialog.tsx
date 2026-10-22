import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'

interface DialogProps {
  open: boolean
  title: string
  description?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'danger'
  wide?: boolean
  onClose: () => void
  /** When set, the body and footer are wrapped in a form that submits here. */
  onSubmit?: () => void
  children?: ReactNode
  footer?: ReactNode
}

// Modal dialog: closes on Escape or backdrop click and moves focus inside on open.
export function Dialog({ open, title, description, icon, tone = 'default', wide, onClose, onSubmit, children, footer }: DialogProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusTarget = panel?.querySelector<HTMLElement>('[autofocus], input, select, textarea') ??
      panel?.querySelector<HTMLElement>('footer button:last-child')
    focusTarget?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previous?.focus?.()
    }
  }, [open])

  useBodyScrollLock(open)

  if (!open) return null

  const content = (
    <>
      {children ? <div className="dialog-body">{children}</div> : <div className="dialog-spacer" />}
      {footer ? <footer>{footer}</footer> : null}
    </>
  )

  return createPortal(
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={panelRef}
        className={wide ? 'dialog dialog--wide' : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            {icon ? <span className={tone === 'danger' ? 'dialog-icon dialog-icon--danger' : 'dialog-icon'}>{icon}</span> : null}
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </header>
        {onSubmit ? (
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              onSubmit()
            }}
          >
            {content}
          </form>
        ) : (
          content
        )}
      </section>
    </div>,
    document.body,
  )
}
