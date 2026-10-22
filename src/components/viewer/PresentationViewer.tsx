import { AlertCircle, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, EyeOff, PanelLeft, Play, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { openPptx, PPTX_EMU_PER_PX, type Corners, type PptxDocument, type SlideElement, type SlideModel, type TextParagraph } from '../../services/pptx'
import type { Direction, SlideTransition } from '../../services/pptxAnimation'
import { createBuildStyler, stepDurationMs, type BuildStyler } from './slideBuild'
import './presentation.css'

interface PresentationViewerProps {
  /** The presentation, or null while it is still loading. */
  blob: Blob | null
  /** First slides kept on this device, shown until the file has been read. */
  snapshot?: PptxDocument | null
  /** Shown while only the snapshot is available. */
  waitingLabel?: string
  documentId: string
  documentName: string
  zoom: number
}

const THUMB_WIDTH = 168
const THUMB_ROW_HEIGHT = 128
const SEARCH_RESULT_LIMIT = 200

function positionKey(documentId: string) {
  return `documentVault.presentationPosition.${documentId}`
}

function readSavedPosition(documentId: string) {
  try {
    const value = Number(localStorage.getItem(positionKey(documentId)))
    return Number.isInteger(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

/**
 * Mount with `key={documentId}` so every newly opened presentation starts on
 * slide 1. A previous position is only offered, never applied automatically.
 */
export function PresentationViewer({ blob, snapshot, waitingLabel, documentId, documentName, zoom }: PresentationViewerProps) {
  const [opened, setOpened] = useState<PptxDocument | null>(null)
  // The snapshot stands in until the file has been read; the slide in view stays put.
  const pptx = opened ?? snapshot ?? null
  const [openError, setOpenError] = useState<string | null>(null)
  const [openMs, setOpenMs] = useState<number | null>(null)
  const [index, setIndex] = useState(0)
  const [pageInput, setPageInput] = useState('1')
  const [savedPosition, setSavedPosition] = useState<number | null>(() => readSavedPosition(documentId))
  const [showThumbnails, setShowThumbnails] = useState(() => window.innerWidth > 960)
  const [showSearch, setShowSearch] = useState(false)
  // Slide being presented, or null when not in slideshow mode.
  const [showIndex, setShowIndex] = useState<number | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!blob) return undefined
    let cancelled = false
    let opened: PptxDocument | null = null
    const started = performance.now()
    openPptx(blob)
      .then((doc) => {
        if (cancelled) {
          doc.dispose()
          return
        }
        opened = doc
        setOpened(doc)
        setOpenMs(Math.round(performance.now() - started))
      })
      .catch((error: unknown) => {
        console.error(error)
        if (!cancelled) setOpenError('This presentation could not be read. The file may be damaged or password protected.')
      })
    return () => {
      cancelled = true
      opened?.dispose()
    }
  }, [blob])

  const slideCount = pptx?.slides.length ?? 0

  const goTo = useCallback(
    (target: number) => {
      if (!slideCount) return
      const clamped = Math.max(0, Math.min(slideCount - 1, target))
      setIndex(clamped)
      setPageInput(String(clamped + 1))
    },
    [slideCount],
  )

  // Remember the position so it can be offered next time. Slide 1 needs no entry.
  useEffect(() => {
    if (!slideCount) return undefined
    const timer = window.setTimeout(() => {
      try {
        if (index > 0) localStorage.setItem(positionKey(documentId), String(index + 1))
        else localStorage.removeItem(positionKey(documentId))
      } catch {
        // Storage can be unavailable in private windows; resume is optional.
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [documentId, index, slideCount])

  const startShow = useCallback((from: number) => setShowIndex(from), [])
  // Leaving the show lands the normal view on the last slide presented.
  const exitShow = useCallback((lastIndex: number) => {
    setShowIndex(null)
    goTo(Math.min(lastIndex, slideCount - 1))
  }, [goTo, slideCount])

  useEffect(() => {
    if (!slideCount) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return
      // PowerPoint shortcuts: F5 presents from the start, Shift+F5 from the current slide.
      if (event.key === 'F5') {
        event.preventDefault()
        // The slideshow needs the whole file, not just the stored first slides.
        if (opened) startShow(event.shiftKey ? index : 0)
        return
      }
      let target: number | null = null
      if (event.key === 'ArrowRight' || event.key === 'PageDown') target = index + 1
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') target = index - 1
      else if (event.key === 'Home') target = 0
      else if (event.key === 'End') target = slideCount - 1
      if (target === null) return
      // Claimed here so the document viewer does not also switch documents.
      event.preventDefault()
      goTo(target)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [goTo, index, opened, slideCount, startShow])

  useEffect(() => {
    const element = stageRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [pptx])

  // Parse the neighbouring slides in the background so stepping feels instant.
  useEffect(() => {
    if (!pptx) return
    const timer = window.setTimeout(() => {
      for (const neighbour of [index + 1, index - 1, index + 2]) {
        if (neighbour >= 0 && neighbour < pptx.slides.length) void pptx.loadSlide(neighbour).catch(() => undefined)
      }
    }, 120)
    return () => window.clearTimeout(timer)
  }, [pptx, index])

  if (openError) {
    return (
      <div className="viewer-message viewer-message--error">
        <AlertCircle aria-hidden="true" />
        <strong>{openError}</strong>
      </div>
    )
  }

  if (!pptx) {
    return (
      <div className="viewer-message" role="status">
        <div className="pdf-page-skeleton-spinner" style={{ margin: '0 auto 12px auto' }} />
        <span>Reading presentation...</span>
      </div>
    )
  }

  // The slide covers the whole stage at 100%, as in PowerPoint; zooming in scrolls.
  const padding = 0
  const fitScale =
    stageSize.width > 0
      ? Math.min((stageSize.width - padding) / pptx.width, (stageSize.height - padding) / pptx.height)
      : 0
  const scale = Math.max(0.05, fitScale * zoom)
  const submitPage = (event: FormEvent) => {
    event.preventDefault()
    const parsed = Number.parseInt(pageInput, 10)
    if (Number.isFinite(parsed)) goTo(parsed - 1)
    else setPageInput(String(index + 1))
    // Hand the keyboard back to slide navigation after jumping.
    if (event.type === 'submit' && document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  return (
    <div className="pptx-viewer">
      <div className="pptx-toolbar" role="toolbar" aria-label="Presentation controls">
        <button
          type="button"
          className={showThumbnails ? 'icon-button is-active' : 'icon-button'}
          onClick={() => setShowThumbnails((value) => !value)}
          aria-label={showThumbnails ? 'Hide slide list' : 'Show slide list'}
          aria-pressed={showThumbnails}
          title="Slide list"
        >
          <PanelLeft aria-hidden="true" size={18} />
        </button>
        <form className="pptx-nav" onSubmit={submitPage}>
          <button type="button" className="icon-button" onClick={() => goTo(0)} disabled={index === 0} aria-label="First slide" title="First slide">
            <ChevronsLeft aria-hidden="true" size={16} />
          </button>
          <button type="button" className="icon-button" onClick={() => goTo(index - 1)} disabled={index === 0} aria-label="Previous slide" title="Previous slide">
            <ChevronLeft aria-hidden="true" size={16} />
          </button>
          <label className="pptx-page-field">
            <span className="sr-only">Slide number</span>
            <input
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={submitPage}
              inputMode="numeric"
              aria-label="Slide number"
            />
            <span>of {slideCount}</span>
          </label>
          <button type="button" className="icon-button" onClick={() => goTo(index + 1)} disabled={index >= slideCount - 1} aria-label="Next slide" title="Next slide">
            <ChevronRight aria-hidden="true" size={16} />
          </button>
          <button type="button" className="icon-button" onClick={() => goTo(slideCount - 1)} disabled={index >= slideCount - 1} aria-label="Last slide" title="Last slide">
            <ChevronsRight aria-hidden="true" size={16} />
          </button>
        </form>
        <button
          type="button"
          className={showSearch ? 'icon-button is-active' : 'icon-button'}
          onClick={() => setShowSearch((value) => !value)}
          aria-label="Search in presentation"
          aria-pressed={showSearch}
          title="Search in presentation"
        >
          <Search aria-hidden="true" size={18} />
        </button>
        {openMs !== null ? <span className="pptx-meta">Opened in {openMs} ms</span> : null}
        {!opened && waitingLabel ? <span className="pptx-meta" role="status">{waitingLabel}</span> : null}
        <button
          type="button"
          className="primary-button button--small pptx-present"
          onClick={() => startShow(index)}
          disabled={!opened}
          title="Slideshow from this slide (Shift+F5). F5 starts from slide 1."
        >
          <Play aria-hidden="true" size={16} />
          <span>Slideshow</span>
        </button>
      </div>

      {savedPosition && savedPosition <= slideCount && savedPosition > 1 ? (
        <div className="resume-reading-banner pptx-resume" role="status">
          <span>
            You last viewed <strong>slide {savedPosition}</strong> of this presentation.
          </span>
          <div className="resume-banner-actions">
            <button
              type="button"
              className="resume-banner-btn resume-banner-btn--primary"
              onClick={() => {
                goTo(savedPosition - 1)
                setSavedPosition(null)
              }}
            >
              Resume at slide {savedPosition}
            </button>
            <button type="button" className="resume-banner-btn resume-banner-btn--secondary" onClick={() => setSavedPosition(null)}>
              Stay on slide 1
            </button>
          </div>
        </div>
      ) : null}

      <div className="pptx-body">
        {showThumbnails ? <ThumbnailRail
            pptx={pptx}
            activeIndex={index}
            onSelect={(slide) => {
              goTo(slide)
              // On a phone the list covers the slide, so it closes once one is picked.
              if (window.matchMedia('(max-width: 720px)').matches) setShowThumbnails(false)
            }}
          /> : null}

        <div className="pptx-stage" ref={stageRef}>
          {scale > 0.05 ? (
            <SlideCanvas pptx={pptx} index={index} scale={scale} label={`${documentName}, slide ${index + 1} of ${slideCount}`} />
          ) : null}
        </div>

        {showSearch ? <SearchPanel pptx={pptx} onSelect={goTo} onClose={() => setShowSearch(false)} /> : null}
      </div>

      {showIndex !== null
        ? createPortal(<Slideshow pptx={pptx} startIndex={showIndex} onExit={exitShow} />, document.body)
        : null}

      <p className="pptx-fidelity-note">
        Simplified preview. Transitions and animations play in Slideshow, using the closest matching effect. Charts,
        SmartArt, embedded media and some formatting are not reproduced. Download the original file to see it exactly as
        authored.
      </p>
    </div>
  )
}

// ─── Slideshow ───────────────────────────────────────────────────────────────

const CONTROLS_HIDE_MS = 2500
const SWIPE_MIN_PX = 50
/** Stands for "every step done" when stepping back onto a slide whose model is not loaded yet. */
const ALL_STEPS = Number.MAX_SAFE_INTEGER

interface ShowPosition {
  /** Slide shown; `slideCount` is the closing "End of slideshow" screen. */
  index: number
  /** Animation steps completed on this slide. */
  done: number
  /** Step being animated, or null. */
  playing: number | null
  /** Slide being transitioned away from, while the incoming slide's transition plays. */
  from: { index: number; done: number } | null
  /** Direction of travel, used to skip hidden slides the right way. */
  forward: boolean
}

/**
 * Full-screen presentation: one slide at a time on black, sized to fit, with
 * the deck's slide transitions and click-by-click animations.
 */
function Slideshow({ pptx, startIndex, onExit }: { pptx: PptxDocument; startIndex: number; onExit: (lastIndex: number) => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimerRef = useRef<number | null>(null)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const slideCount = pptx.slides.length
  const [pos, setPos] = useState<ShowPosition>({ index: startIndex, done: 0, playing: null, from: null, forward: true })
  const atEnd = pos.index >= slideCount
  const loaded = useSlide(pptx, atEnd ? Math.max(0, slideCount - 1) : pos.index)
  const model = !atEnd ? loaded?.model : undefined
  const steps = useMemo(() => model?.animationSteps ?? [], [model])
  const done = Math.min(pos.done, steps.length)
  const transition = model?.transition
  const transitioning = pos.from !== null && Boolean(model) && transition !== undefined && transition.kind !== 'cut'
  // Steps that need no click start by themselves once the slide is idle.
  const playing = pos.playing ?? (model && !transitioning && steps[done]?.auto ? done : null)

  // Read through a ref so the full-screen effect below runs once, not on every slide change.
  const exitRef = useRef(() => onExit(pos.index))
  useEffect(() => {
    exitRef.current = () => onExit(pos.index)
  }, [pos.index, onExit])
  const exit = useCallback(() => exitRef.current(), [])

  const goToSlide = useCallback(
    (index: number, forward: boolean, withTransition: boolean) => {
      setPos((current) => {
        const target = Math.max(0, Math.min(slideCount, index))
        return {
          index: target,
          done: forward ? 0 : ALL_STEPS,
          playing: null,
          from: withTransition && current.index < slideCount ? { index: current.index, done: current.done } : null,
          forward,
        }
      })
    },
    [slideCount],
  )

  const next = useCallback(() => {
    if (atEnd) {
      exit()
      return
    }
    if (!model) return
    // A click during a transition or an animation finishes it at once, as in PowerPoint.
    if (transitioning) {
      setPos((current) => ({ ...current, from: null }))
      return
    }
    if (playing !== null) {
      setPos((current) => ({ ...current, done: playing + 1, playing: null }))
      return
    }
    if (done < steps.length) {
      setPos((current) => ({ ...current, done, playing: done }))
      return
    }
    goToSlide(pos.index + 1, true, true)
  }, [atEnd, done, exit, goToSlide, model, playing, pos.index, steps.length, transitioning])

  const previous = useCallback(() => {
    if (pos.playing !== null || done > 0) {
      // Step back one build without animating, like PowerPoint's "previous".
      setPos((current) => ({ ...current, done: Math.max(0, done - (current.playing !== null ? 0 : 1)), playing: null, from: null }))
      return
    }
    if (pos.index > 0) goToSlide(pos.index - 1, false, false)
  }, [done, goToSlide, pos.index, pos.playing])

  // Hidden slides are skipped in the show.
  useEffect(() => {
    if (!model?.hidden) return undefined
    const target = pos.forward ? pos.index + 1 : pos.index - 1
    const timer = window.setTimeout(() => {
      if (target < 0) goToSlide(pos.index + 1, true, false)
      else goToSlide(target, pos.forward, pos.forward)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [goToSlide, model, pos.forward, pos.index])

  // Let the transition run, then drop the outgoing slide.
  useEffect(() => {
    if (!transitioning) return undefined
    const timer = window.setTimeout(() => setPos((current) => ({ ...current, from: null })), transition!.durationMs)
    return () => window.clearTimeout(timer)
  }, [transition, transitioning])

  // Finish the playing step when its last effect ends; the next automatic step then follows on its own.
  useEffect(() => {
    if (playing === null) return undefined
    const step = steps[playing]
    const timer = window.setTimeout(() => setPos((current) => ({ ...current, done: playing + 1, playing: null })), step ? stepDurationMs(step) : 0)
    return () => window.clearTimeout(timer)
  }, [playing, steps])

  // "After" timings: advance on their own once the slide is idle.
  useEffect(() => {
    const after = transition?.advanceAfterMs
    if (after === undefined || !model || transitioning || playing !== null) return undefined
    const timer = window.setTimeout(next, after)
    return () => window.clearTimeout(timer)
  }, [model, next, playing, transition, transitioning])

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS)
  }, [])

  // Enter full screen on open; leaving full screen (Esc, F11, system gesture) ends the show.
  useEffect(() => {
    const element = rootRef.current
    if (element?.requestFullscreen && !document.fullscreenElement) {
      // Not every browser allows it (iOS Safari); the overlay still covers the window.
      element.requestFullscreen().catch(() => undefined)
    }
    const handleChange = () => {
      if (!document.fullscreenElement) exit()
    }
    document.addEventListener('fullscreenchange', handleChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleChange)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
  }, [exit])

  useEffect(() => {
    const element = rootRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    element.focus()
    revealControls()
    return () => {
      observer.disconnect()
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    }
  }, [revealControls])

  // Captured on window so the viewer's own keys (slide and document switching) never fire underneath.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const key = event.key
      let handled = true
      if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ' || key === 'Enter' || key === 'n' || key === 'N') next()
      else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp' || key === 'Backspace' || key === 'p' || key === 'P') previous()
      else if (key === 'Home') goToSlide(0, true, false)
      else if (key === 'End') goToSlide(slideCount - 1, true, false)
      else if (key === 'Escape') exit()
      else handled = false
      if (!handled) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [exit, goToSlide, next, previous, slideCount])

  const scale = Math.max(0.05, Math.min(size.width / pptx.width, size.height / pptx.height))
  const label = `Slide ${pos.index + 1} of ${slideCount}`
  const layers = transitioning && pos.from ? transitionLayers(transition!) : null

  return (
    <div
      ref={rootRef}
      className={controlsVisible ? 'pptx-show' : 'pptx-show is-idle'}
      role="dialog"
      aria-modal="true"
      aria-label="Slideshow"
      tabIndex={-1}
      onPointerMove={revealControls}
      onPointerDown={(event) => {
        pointerStartRef.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerUp={(event) => {
        const start = pointerStartRef.current
        pointerStartRef.current = null
        if (!start || (event.target as HTMLElement).closest('.pptx-show-controls')) return
        const dx = event.clientX - start.x
        if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(event.clientY - start.y)) {
          if (dx < 0) next()
          else previous()
        } else if (event.button === 0 && (transition?.advanceOnClick ?? true)) {
          next()
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        previous()
      }}
    >
      {atEnd ? (
        <p className="pptx-show-end">End of slideshow. Click or press Space to exit.</p>
      ) : (
        <>
          {layers && pos.from ? (
            <div className="pptx-show-layer" style={layers.outgoing} key={`out-${pos.from.index}`}>
              <SlideCanvas pptx={pptx} index={pos.from.index} scale={scale} label={`Slide ${pos.from.index + 1}`} build={{ done: pos.from.done, playing: null }} />
            </div>
          ) : null}
          <div className="pptx-show-layer" style={layers?.incoming} key={`in-${pos.index}`}>
            <SlideCanvas pptx={pptx} index={pos.index} scale={scale} label={label} build={{ done, playing }} />
          </div>
        </>
      )}

      <div className="pptx-show-controls" role="toolbar" aria-label="Slideshow controls">
        <button type="button" onClick={previous} disabled={pos.index === 0 && done === 0 && playing === null} aria-label="Previous" title="Previous (Left arrow)">
          <ChevronLeft aria-hidden="true" size={20} />
        </button>
        <span className="pptx-show-counter" aria-live="polite">
          {atEnd ? 'End' : `${pos.index + 1} / ${slideCount}`}
        </span>
        <button type="button" onClick={next} aria-label={atEnd ? 'Exit slideshow' : 'Next'} title="Next (Right arrow or Space)">
          <ChevronRight aria-hidden="true" size={20} />
        </button>
        <span className="pptx-show-divider" aria-hidden="true" />
        <button type="button" onClick={exit} aria-label="Exit slideshow" title="Exit (Esc)">
          <X aria-hidden="true" size={20} />
        </button>
      </div>
    </div>
  )
}

type LayerStyle = CSSProperties & Record<string, string | number | undefined>

/** CSS for the outgoing and incoming slide while a transition plays. */
function transitionLayers(transition: SlideTransition): { outgoing: LayerStyle; incoming: LayerStyle } {
  const ms = transition.durationMs
  const run = (name: string) => `${name} ${ms}ms ease-in-out 0ms 1 normal both`
  const travel = DIRECTION_VECTORS[transition.direction]
  // The side the new slide comes in from is opposite to the direction of travel.
  const enterFrom = `${-travel.x * 100}% ${-travel.y * 100}%`
  const leaveTo = `${travel.x * 100}% ${travel.y * 100}%`
  const below = { zIndex: 0 }
  const above = { zIndex: 1 }

  switch (transition.kind) {
    case 'push':
      return {
        outgoing: { ...below, '--pptx-tr-to': leaveTo, animation: run('pptx-tr-slide-out') },
        incoming: { ...above, '--pptx-tr-from': enterFrom, animation: run('pptx-tr-slide-in') },
      }
    case 'cover':
      return { outgoing: below, incoming: { ...above, '--pptx-tr-from': enterFrom, animation: run('pptx-tr-slide-in') } }
    case 'uncover':
      return { outgoing: { ...above, '--pptx-tr-to': leaveTo, animation: run('pptx-tr-slide-out') }, incoming: below }
    case 'wipe':
      return { outgoing: below, incoming: { ...above, '--pptx-tr-clip': wipeStartClip(transition.direction), animation: run('pptx-tr-clip') } }
    case 'split': {
      const closed = transition.vertical ? 'inset(0 50% 0 50%)' : 'inset(50% 0 50% 0)'
      // Outward: the new slide opens from the centre line. Inward: the old one closes onto it.
      return transition.outward
        ? { outgoing: below, incoming: { ...above, '--pptx-tr-clip': closed, animation: run('pptx-tr-clip') } }
        : { outgoing: { ...above, '--pptx-tr-clip': closed, animation: `pptx-tr-clip ${ms}ms ease-in-out 0ms 1 reverse both` }, incoming: below }
    }
    case 'zoom':
      return { outgoing: below, incoming: { ...above, animation: run('pptx-tr-zoom') } }
    case 'circle':
      return { outgoing: below, incoming: { ...above, animation: run('pptx-tr-circle') } }
    case 'fade':
    default:
      return transition.throughBlack
        ? {
            outgoing: { ...below, animation: `pptx-tr-fade-out ${ms / 2}ms ease-in 0ms 1 normal both` },
            incoming: { ...above, animation: `pptx-tr-fade ${ms / 2}ms ease-out ${ms / 2}ms 1 normal both` },
          }
        : { outgoing: below, incoming: { ...above, animation: run('pptx-tr-fade') } }
  }
}

const DIRECTION_VECTORS: Record<Direction, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
}

/** A wipe travelling in `direction` starts fully clipped on the side it moves towards. */
function wipeStartClip(direction: Direction) {
  switch (direction) {
    case 'right':
      return 'inset(0 100% 0 0)'
    case 'left':
      return 'inset(0 0 0 100%)'
    case 'down':
      return 'inset(0 0 100% 0)'
    case 'up':
      return 'inset(100% 0 0 0)'
  }
}

// ─── Slide rendering ─────────────────────────────────────────────────────────

function useSlide(pptx: PptxDocument, index: number) {
  const [loaded, setLoaded] = useState<{ index: number; model?: SlideModel; error?: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    pptx
      .loadSlide(index)
      .then((model) => {
        if (!cancelled) setLoaded({ index, model })
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoaded({ index, error: error instanceof Error ? error.message : 'This slide could not be read.' })
      })
    return () => {
      cancelled = true
    }
  }, [pptx, index])
  return loaded?.index === index ? loaded : null
}

function SlideCanvas({
  pptx,
  index,
  scale,
  label,
  compact = false,
  build,
}: {
  pptx: PptxDocument
  index: number
  scale: number
  label: string
  compact?: boolean
  /** Slideshow only: animation progress. Without it every object is shown in place. */
  build?: { done: number; playing: number | null }
}) {
  const slide = useSlide(pptx, index)
  const frameStyle: CSSProperties = { width: pptx.width * scale, height: pptx.height * scale }
  const steps = slide?.model?.animationSteps
  const styler = useMemo(
    () => (build && steps ? createBuildStyler(steps, build.done, build.playing, pptx.width, pptx.height) : null),
    [build?.done, build?.playing, steps, pptx.width, pptx.height], // eslint-disable-line react-hooks/exhaustive-deps
  )

  if (!slide) {
    return (
      <div className="pptx-slide-frame is-loading" style={frameStyle} aria-busy="true" aria-label={label}>
        {compact ? null : <div className="pdf-page-skeleton-spinner" />}
      </div>
    )
  }
  if (slide.error || !slide.model) {
    return (
      <div className="pptx-slide-frame is-error" style={frameStyle} role="img" aria-label={label}>
        {compact ? <AlertCircle aria-hidden="true" size={16} /> : <span>{slide.error}</span>}
      </div>
    )
  }

  const model = slide.model
  return (
    <div className="pptx-slide-frame" style={frameStyle} role="img" aria-label={`${label}: ${model.title}`}>
      <div
        className="pptx-slide"
        style={{
          width: pptx.width,
          height: pptx.height,
          transform: `scale(${scale})`,
          background: model.background ?? '#ffffff',
        }}
      >
        {model.backgroundImage ? <MediaImage pptx={pptx} path={model.backgroundImage} className="pptx-bg-image" /> : null}
        {model.elements.map((element, elementIndex) => (
          <SlideElementView key={elementIndex} pptx={pptx} element={element} styler={styler} />
        ))}
      </div>
      {model.hidden && !compact ? (
        <span className="pptx-hidden-badge">
          <EyeOff aria-hidden="true" size={14} /> Hidden slide
        </span>
      ) : null}
    </div>
  )
}

function boxStyle(element: SlideElement): CSSProperties {
  return {
    left: element.x / PPTX_EMU_PER_PX,
    top: element.y / PPTX_EMU_PER_PX,
    width: element.w / PPTX_EMU_PER_PX,
    height: element.h / PPTX_EMU_PER_PX,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
  }
}

function cornerRadius(element: SlideElement & { corners?: Corners }) {
  if (element.corners === 'ellipse') return '50%'
  // PowerPoint's default rounded rectangle rounds by a sixth of the shorter side.
  if (element.corners === 'round') return Math.min(element.w, element.h) / PPTX_EMU_PER_PX / 6
  return undefined
}

function SlideElementView({ pptx, element, styler }: { pptx: PptxDocument; element: SlideElement; styler: BuildStyler | null }) {
  const build = styler?.element(element)
  switch (element.type) {
    case 'text':
      return (
        <div
          className={`pptx-text pptx-text--${element.anchor}${element.w === 0 ? ' is-unplaced' : ''}`}
          style={{
            ...(element.w === 0 ? {} : boxStyle(element)),
            background: element.fill,
            border: element.border ? `1px solid ${element.border}` : undefined,
            borderRadius: cornerRadius(element),
            ...build,
          }}
        >
          <div>
            {element.paragraphs.map((paragraph, index) => (
              <Paragraph key={index} paragraph={paragraph} buildStyle={styler?.paragraph(element, index)} />
            ))}
          </div>
        </div>
      )
    case 'image':
      return (
        <div className="pptx-box" style={{ ...boxStyle(element), ...build }}>
          <MediaImage pptx={pptx} path={element.mediaPath} className="pptx-image" />
        </div>
      )
    case 'table':
      return (
        <div className="pptx-box pptx-table-box" style={{ ...boxStyle(element), ...build }}>
          <table className="pptx-table">
            <tbody>
              {element.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'shape':
      return (
        <div
          className="pptx-box"
          style={{
            ...boxStyle(element),
            background: element.fill,
            border: element.border ? `1px solid ${element.border}` : undefined,
            borderRadius: cornerRadius(element),
            ...build,
          }}
        />
      )
    case 'unsupported':
      return (
        <div className="pptx-box pptx-unsupported" style={{ ...boxStyle(element), ...build }}>
          <span>{element.label} not shown in preview</span>
        </div>
      )
  }
}

function Paragraph({ paragraph, buildStyle }: { paragraph: TextParagraph; buildStyle?: CSSProperties }) {
  const empty = paragraph.runs.every((run) => !run.text)
  const firstSize = paragraph.runs.find((run) => run.sizePt)?.sizePt ?? 18
  return (
    <p
      className="pptx-paragraph"
      style={{
        textAlign: paragraph.align,
        paddingLeft: paragraph.bullet ? 24 + paragraph.level * 36 : paragraph.level * 36,
        minHeight: empty ? ptToPx(firstSize) * 1.15 : undefined,
        ...buildStyle,
      }}
    >
      {paragraph.bullet && !empty ? <span className="pptx-bullet" style={{ fontSize: ptToPx(firstSize) }} aria-hidden="true">•</span> : null}
      {paragraph.runs.map((run, index) =>
        run.text === '\n' ? (
          <br key={index} />
        ) : (
          <span
            key={index}
            style={{
              fontSize: run.sizePt ? ptToPx(run.sizePt) : undefined,
              fontWeight: run.bold ? 700 : undefined,
              fontStyle: run.italic ? 'italic' : undefined,
              textDecoration: run.underline ? 'underline' : undefined,
              color: run.color,
            }}
          >
            {run.text}
          </span>
        ),
      )}
    </p>
  )
}

function ptToPx(pt: number) {
  return (pt * 96) / 72
}

function MediaImage({ pptx, path, className }: { pptx: PptxDocument; path: string; className: string }) {
  const [loaded, setLoaded] = useState<{ path: string; url: string | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    void pptx.getMediaUrl(path).then((url) => {
      if (!cancelled) setLoaded({ path, url })
    })
    return () => {
      cancelled = true
    }
  }, [pptx, path])
  const url = loaded?.path === path ? loaded.url : undefined
  if (url === null) return <div className="pptx-unsupported"><span>Image unavailable</span></div>
  if (!url) return null
  return <img className={className} src={url} alt="" draggable={false} />
}

// ─── Virtualized slide list ──────────────────────────────────────────────────

function ThumbnailRail({ pptx, activeIndex, onSelect }: { pptx: PptxDocument; activeIndex: number; onSelect: (index: number) => void }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewHeight, setViewHeight] = useState(600)
  const count = pptx.slides.length
  const thumbScale = THUMB_WIDTH / pptx.width

  useEffect(() => {
    const element = listRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewHeight(entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Keep the active slide visible without animating the list.
  useEffect(() => {
    const element = listRef.current
    if (!element) return
    const top = activeIndex * THUMB_ROW_HEIGHT
    if (top < element.scrollTop || top + THUMB_ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2 + THUMB_ROW_HEIGHT / 2)
    }
  }, [activeIndex])

  const first = Math.max(0, Math.floor(scrollTop / THUMB_ROW_HEIGHT) - 3)
  const last = Math.min(count - 1, Math.ceil((scrollTop + viewHeight) / THUMB_ROW_HEIGHT) + 3)
  const rows = []
  for (let i = first; i <= last; i += 1) rows.push(i)

  return (
    <nav className="pptx-thumbs" aria-label="Slides">
      <div className="pptx-thumbs-scroll" ref={listRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div style={{ height: count * THUMB_ROW_HEIGHT, position: 'relative' }}>
          {rows.map((slideIndex) => (
            <button
              key={slideIndex}
              type="button"
              className={slideIndex === activeIndex ? 'pptx-thumb is-active' : 'pptx-thumb'}
              style={{ top: slideIndex * THUMB_ROW_HEIGHT, height: THUMB_ROW_HEIGHT }}
              onClick={() => onSelect(slideIndex)}
              aria-current={slideIndex === activeIndex ? 'true' : undefined}
              aria-label={`Slide ${slideIndex + 1}`}
            >
              <span className="pptx-thumb-number">{slideIndex + 1}</span>
              <SlideCanvas pptx={pptx} index={slideIndex} scale={thumbScale} label={`Slide ${slideIndex + 1}`} compact />
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}

// ─── Search ──────────────────────────────────────────────────────────────────

interface SearchHit {
  index: number
  snippet: string
}

function SearchPanel({ pptx, onSelect, onClose }: { pptx: PptxDocument; onSelect: (index: number) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const runRef = useRef(0)

  useEffect(() => () => {
    runRef.current += 1
  }, [])

  const run = async (event: FormEvent) => {
    event.preventDefault()
    const needle = query.trim().toLowerCase()
    if (!needle) return
    const runId = ++runRef.current
    const found: SearchHit[] = []
    setHits(null)
    setProgress(0)
    for (let i = 0; i < pptx.slides.length && found.length < SEARCH_RESULT_LIMIT; i += 1) {
      const text = (await pptx.loadSlideText(i)).join(' ')
      const position = text.toLowerCase().indexOf(needle)
      if (position >= 0) {
        const start = Math.max(0, position - 40)
        found.push({ index: i, snippet: `${start > 0 ? '...' : ''}${text.slice(start, position + needle.length + 60)}` })
      }
      if (i % 25 === 24) {
        if (runId !== runRef.current) return
        setProgress(Math.round(((i + 1) / pptx.slides.length) * 100))
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
    }
    if (runId !== runRef.current) return
    setHits(found)
    setProgress(null)
  }

  const summary = useMemo(() => {
    if (!hits) return null
    if (hits.length === 0) return 'No slides contain that text.'
    const capped = hits.length >= SEARCH_RESULT_LIMIT ? ' (showing the first 200)' : ''
    return `${hits.length} ${hits.length === 1 ? 'slide matches' : 'slides match'}${capped}`
  }, [hits])

  return (
    <aside className="pptx-search" role="search" aria-label="Search in presentation">
      <div className="pptx-search-head">
        <strong>Search slides</strong>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close search">
          <X aria-hidden="true" size={14} />
        </button>
      </div>
      <form onSubmit={run} className="pptx-search-form">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Words on a slide" aria-label="Search text" />
        <button type="submit" className="primary-button">Find</button>
      </form>
      {progress !== null ? <p className="pptx-search-status" role="status">Searching... {progress}%</p> : null}
      {summary ? <p className="pptx-search-status" role="status">{summary}</p> : null}
      <ul className="pptx-search-results">
        {hits?.map((hit) => (
          <li key={hit.index}>
            <button type="button" onClick={() => onSelect(hit.index)}>
              <strong>Slide {hit.index + 1}</strong>
              <span>{hit.snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable
}
