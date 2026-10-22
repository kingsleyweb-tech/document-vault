import { describe, expect, it } from 'vitest'
import type { SlideElement } from '../../services/pptx'
import type { AnimationStep, SlideEffect } from '../../services/pptxAnimation'
import { createBuildStyler, stepDurationMs } from './slideBuild'

const effect = (overrides: Partial<SlideEffect>): SlideEffect => ({
  targetId: '2',
  effectClass: 'entrance',
  name: 'fade',
  direction: 'left',
  delayMs: 0,
  durationMs: 500,
  ...overrides,
})

const shape = (id: string): SlideElement => ({ type: 'shape', id, x: 0, y: 0, w: 0, h: 0, rotation: 0 })

const steps: AnimationStep[] = [
  { auto: false, effects: [effect({ targetId: '2' })] },
  { auto: false, effects: [effect({ targetId: '3', effectClass: 'exit' }), effect({ targetId: '2', effectClass: 'emphasis', name: 'spin', delayMs: 500, durationMs: 1000 })] },
]

describe('createBuildStyler', () => {
  it('leaves slides without animations untouched', () => {
    expect(createBuildStyler([], 0, null, 960, 540).element(shape('2'))).toBeUndefined()
  })

  it('hides objects that enter later and shows objects that only leave', () => {
    const styler = createBuildStyler(steps, 0, null, 960, 540)
    expect(styler.element(shape('2'))?.visibility).toBe('hidden')
    expect(styler.element(shape('3'))?.visibility).toBeUndefined()
    expect(styler.element(shape('9'))).toBeUndefined()
  })

  it('animates the playing step and keeps exiting objects drawn until their effect ends', () => {
    const styler = createBuildStyler(steps, 1, 1, 960, 540)
    expect(styler.element(shape('3'))).toMatchObject({ visibility: undefined, animation: 'pptx-fx-fade 500ms ease-in 0ms 1 reverse both' })
    expect(styler.element(shape('2'))?.animation).toBe('pptx-fx-spin 1000ms ease-in-out 500ms 1 normal both')
  })

  it('hides exited objects once their step is done', () => {
    expect(createBuildStyler(steps, 2, null, 960, 540).element(shape('3'))?.visibility).toBe('hidden')
  })

  it('applies effects on a group to the shapes inside it', () => {
    const child: SlideElement = { ...shape('7'), groupIds: ['2'] }
    expect(createBuildStyler(steps, 0, null, 960, 540).element(child)?.visibility).toBe('hidden')
  })

  it('moves objects to the end of a finished motion path', () => {
    const path = [{ auto: false, effects: [effect({ effectClass: 'motion', name: 'path', pathEnd: { x: 0.5, y: -0.25 } })] }]
    expect(createBuildStyler(path, 1, null, 960, 540).element(shape('2'))?.translate).toBe('480px -135px')
  })
})

describe('stepDurationMs', () => {
  it('ends when the last effect ends', () => {
    expect(stepDurationMs(steps[1])).toBe(1500)
  })
})
