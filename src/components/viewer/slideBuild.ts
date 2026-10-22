import type { CSSProperties } from 'react'
import type { SlideElement } from '../../services/pptx'
import { PPTX_EMU_PER_PX } from '../../services/pptx'
import type { AnimationStep, Direction, SlideEffect } from '../../services/pptxAnimation'

/**
 * Turns a slide's animation steps into per-shape styles for the slideshow.
 *
 * `done` steps have finished: their end state is applied as plain styles.
 * The `playing` step (if any) is drawn with CSS animations that start from the
 * previous state; `animation-fill-mode: both` holds the start frame during an
 * effect's delay and the end frame afterwards. Exits reuse the entrance
 * keyframes played in reverse.
 */

interface TargetState {
  hidden: boolean
  dx: number
  dy: number
  scale: number
  opacity: number
}

const initialState = (): TargetState => ({ hidden: false, dx: 0, dy: 0, scale: 1, opacity: 1 })
const FLOAT_PX = 60
const BOUNCE_PX = 120

export function targetKey(id: string, paragraph?: number) {
  return paragraph === undefined ? id : `${id}:${paragraph}`
}

const effectKey = (effect: SlideEffect) => targetKey(effect.targetId, effect.paragraph)

function applyEffect(state: TargetState, effect: SlideEffect, slideWidth: number, slideHeight: number) {
  switch (effect.effectClass) {
    case 'entrance':
      state.hidden = false
      break
    case 'exit':
      state.hidden = true
      break
    case 'motion':
      if (effect.pathEnd) {
        state.dx += effect.pathEnd.x * slideWidth
        state.dy += effect.pathEnd.y * slideHeight
      }
      break
    case 'emphasis':
      if (effect.name === 'grow') state.scale *= 1.5
      if (effect.name === 'transparency') state.opacity = 0.5
      break
  }
}

/** State of every animated target after the first `count` steps. */
function statesAfter(steps: AnimationStep[], count: number, slideWidth: number, slideHeight: number) {
  const states = new Map<string, TargetState>()
  // Objects whose first effect is an entrance start out hidden, as in PowerPoint.
  for (const step of steps) {
    for (const effect of step.effects) {
      const key = effectKey(effect)
      if (!states.has(key)) states.set(key, { ...initialState(), hidden: effect.effectClass === 'entrance' })
    }
  }
  for (const step of steps.slice(0, count)) {
    for (const effect of step.effects) applyEffect(states.get(effectKey(effect))!, effect, slideWidth, slideHeight)
  }
  return states
}

export function stepDurationMs(step: AnimationStep) {
  return step.effects.reduce((end, effect) => Math.max(end, effect.delayMs + effect.durationMs), 0)
}

export interface BuildStyler {
  element(element: SlideElement): CSSProperties | undefined
  paragraph(element: SlideElement, index: number): CSSProperties | undefined
}

/**
 * @param done Steps already completed.
 * @param playing Index of the step being animated now, or null.
 * @param slideWidth / slideHeight Slide size in CSS px (unscaled).
 */
export function createBuildStyler(steps: AnimationStep[], done: number, playing: number | null, slideWidth: number, slideHeight: number): BuildStyler {
  if (steps.length === 0) return { element: () => undefined, paragraph: () => undefined }
  const before = statesAfter(steps, playing ?? done, slideWidth, slideHeight)
  const after = playing === null ? before : statesAfter(steps, playing + 1, slideWidth, slideHeight)
  const active = playing === null ? [] : steps[playing]?.effects ?? []

  const style = (keys: string[], box: SlideElement | null): CSSProperties | undefined => {
    const known = keys.filter((key) => after.has(key))
    if (known.length === 0) return undefined
    const effects = active.filter((effect) => known.includes(effectKey(effect)))
    const end = combine(known.map((key) => after.get(key)!))
    const start = combine(known.map((key) => before.get(key)!))
    // While an exit plays the object must still be drawn; the reversed animation's fill hides it at the end.
    const exiting = effects.some((effect) => effect.effectClass === 'exit')
    const hidden = exiting ? start.hidden : end.hidden

    const result: CSSProperties & Record<string, string | number | undefined> = {
      visibility: hidden ? 'hidden' : undefined,
      translate: end.dx || end.dy ? `${end.dx}px ${end.dy}px` : undefined,
      scale: end.scale !== 1 ? String(end.scale) : undefined,
      opacity: end.opacity !== 1 ? end.opacity : undefined,
    }
    if (effects.length === 0) return result

    result.animation = effects.map((effect) => animationFor(effect)).join(', ')
    const base = `${start.dx}px ${start.dy}px`
    result['--pptx-base'] = base
    for (const effect of effects) {
      if (effect.name === 'fly' || effect.name === 'float' || effect.name === 'bounce') {
        const offset = entryOffset(effect, box, slideWidth, slideHeight)
        result['--pptx-from'] = `${start.dx + offset.x}px ${start.dy + offset.y}px`
      }
      if (effect.name === 'path') {
        result['--pptx-from'] = base
        result['--pptx-to'] = `${end.dx}px ${end.dy}px`
      }
      if (effect.name === 'wipe') result['--pptx-clip'] = wipeClip(effect.direction)
      if (effect.name === 'split') result['--pptx-clip'] = 'inset(0 50% 0 50%)'
      if (effect.name === 'grow') {
        result['--pptx-scale-from'] = String(start.scale)
        result['--pptx-scale-to'] = String(end.scale)
      }
      if (effect.name === 'transparency') {
        result['--pptx-opacity-from'] = String(start.opacity)
        result['--pptx-opacity-to'] = String(end.opacity)
      }
    }
    return result
  }

  return {
    element: (element) => style([element.id, ...(element.groupIds ?? [])].filter((key): key is string => Boolean(key)), element),
    paragraph: (element, index) => (element.id ? style([targetKey(element.id, index)], null) : undefined),
  }
}

function combine(states: TargetState[]): TargetState {
  return states.reduce(
    (total, state) => ({
      hidden: total.hidden || state.hidden,
      dx: total.dx + state.dx,
      dy: total.dy + state.dy,
      scale: total.scale * state.scale,
      opacity: Math.min(total.opacity, state.opacity),
    }),
    initialState(),
  )
}

const EASING: Record<string, string> = {
  bounce: 'linear',
  spin: 'ease-in-out',
  path: 'ease-in-out',
  teeter: 'linear',
}

function animationFor(effect: SlideEffect) {
  const reverse = effect.effectClass === 'exit' ? 'reverse' : 'normal'
  const easing = EASING[effect.name] ?? (effect.effectClass === 'exit' ? 'ease-in' : 'ease-out')
  const duration = effect.name === 'appear' ? 1 : effect.durationMs
  return `pptx-fx-${effect.name} ${duration}ms ${easing} ${effect.delayMs}ms 1 ${reverse} both`
}

/** Offset (slide px) from which an object flies in, or towards which it flies out. */
function entryOffset(effect: SlideEffect, box: SlideElement | null, slideWidth: number, slideHeight: number) {
  if (effect.name === 'float') return { x: 0, y: effect.direction === 'up' ? -FLOAT_PX : FLOAT_PX }
  if (effect.name === 'bounce') return { x: 0, y: -BOUNCE_PX }
  const x = box ? box.x / PPTX_EMU_PER_PX : slideWidth / 2
  const y = box ? box.y / PPTX_EMU_PER_PX : slideHeight / 2
  const w = box ? box.w / PPTX_EMU_PER_PX : 0
  const h = box ? box.h / PPTX_EMU_PER_PX : 0
  switch (effect.direction) {
    case 'left':
      return { x: -(x + w), y: 0 }
    case 'right':
      return { x: slideWidth - x, y: 0 }
    case 'up':
      return { x: 0, y: -(y + h) }
    case 'down':
      return { x: 0, y: slideHeight - y }
  }
}

/** Clip shape at the start of a wipe that reveals from the given side. */
function wipeClip(from: Direction) {
  switch (from) {
    case 'left':
      return 'inset(0 100% 0 0)'
    case 'right':
      return 'inset(0 0 0 100%)'
    case 'up':
      return 'inset(0 0 100% 0)'
    case 'down':
      return 'inset(100% 0 0 0)'
  }
}
