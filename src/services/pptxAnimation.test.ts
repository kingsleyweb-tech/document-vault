// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { readAnimationSteps, readTransition } from './pptxAnimation'

const NS =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"'

const slide = (inner: string) => new DOMParser().parseFromString(`<p:sld ${NS}><p:cSld/>${inner}</p:sld>`, 'application/xml')

function effect(attrs: string, spid: string, extra = '', para?: number, dur = 500) {
  const target = para === undefined ? `<p:spTgt spid="${spid}"/>` : `<p:spTgt spid="${spid}"><p:txEl><p:pRg st="${para}" en="${para}"/></p:txEl></p:spTgt>`
  return `<p:par><p:cTn id="9" ${attrs} fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
    <p:set><p:cBhvr><p:cTn id="10" dur="1" fill="hold"/><p:tgtEl>${target}</p:tgtEl></p:cBhvr></p:set>
    <p:animEffect><p:cBhvr><p:cTn id="11" dur="${dur}"/><p:tgtEl>${target}</p:tgtEl></p:cBhvr></p:animEffect>${extra}
  </p:childTnLst></p:cTn></p:par>`
}

function click(groups: Array<[number, string]>, delay = 'indefinite') {
  const inner = groups
    .map(([offset, effects]) => `<p:par><p:cTn id="5" fill="hold"><p:stCondLst><p:cond delay="${offset}"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par>`)
    .join('')
  return `<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par>`
}

const timing = (clicks: string) =>
  `<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${clicks}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`

describe('readTransition', () => {
  it('returns nothing when the slide has no transition', () => {
    expect(readTransition(slide(''))).toBeUndefined()
  })

  it('reads kind, direction and speed', () => {
    expect(readTransition(slide('<p:transition spd="med"><p:push dir="u"/></p:transition>'))).toMatchObject({
      kind: 'push',
      direction: 'up',
      durationMs: 750,
      advanceOnClick: true,
    })
  })

  it('reads split orientation and auto-advance timing', () => {
    expect(readTransition(slide('<p:transition advClick="0" advTm="3000"><p:split orient="vert" dir="in"/></p:transition>'))).toMatchObject({
      kind: 'split',
      vertical: true,
      outward: false,
      advanceOnClick: false,
      advanceAfterMs: 3000,
    })
  })

  it('maps PowerPoint 2010 effects and keeps their duration from the modern variant', () => {
    const doc = slide(`<mc:AlternateContent><mc:Choice Requires="p14"><p:transition spd="slow" p14:dur="2000"><p14:vortex dir="r"/></p:transition></mc:Choice>
      <mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`)
    expect(readTransition(doc)).toMatchObject({ kind: 'zoom', durationMs: 2000 })
  })

  it('treats an empty transition as a cut', () => {
    expect(readTransition(slide('<p:transition advTm="5000"/>'))).toMatchObject({ kind: 'cut', durationMs: 0, advanceAfterMs: 5000 })
  })

  it('falls back to a fade for effects it does not know', () => {
    expect(readTransition(slide('<p:transition><p:somethingNew/></p:transition>'))?.kind).toBe('fade')
  })
})

describe('readAnimationSteps', () => {
  it('returns no steps without a main sequence', () => {
    expect(readAnimationSteps(slide(''))).toEqual([])
  })

  it('splits effects into click steps and reads targets, classes and durations', () => {
    const doc = slide(
      timing(
        click([[0, effect('presetID="2" presetClass="entr" presetSubtype="8" nodeType="clickEffect"', '4', '', 0)]]) +
          click([[0, effect('presetID="2" presetClass="entr" presetSubtype="2" nodeType="clickEffect"', '4', '', 1)]]) +
          click([
            [0, effect('presetID="8" presetClass="emph" nodeType="clickEffect"', '7', '', undefined, 1000)],
            [1000, effect('presetID="10" presetClass="exit" nodeType="afterEffect"', '8')],
          ]),
      ),
    )
    const steps = readAnimationSteps(doc)
    expect(steps).toHaveLength(3)
    expect(steps[0]).toMatchObject({ auto: false, effects: [{ targetId: '4', paragraph: 0, effectClass: 'entrance', name: 'fly', direction: 'left' }] })
    expect(steps[1].effects[0]).toMatchObject({ paragraph: 1, direction: 'right' })
    expect(steps[2].effects).toEqual([
      expect.objectContaining({ targetId: '7', effectClass: 'emphasis', name: 'spin', delayMs: 0, durationMs: 1000 }),
      expect.objectContaining({ targetId: '8', effectClass: 'exit', name: 'fade', delayMs: 1000, durationMs: 500 }),
    ])
  })

  it('marks steps that start without a click as automatic', () => {
    const doc = slide(timing(click([[0, effect('presetID="10" presetClass="entr" nodeType="afterEffect"', '3')]], '0')))
    expect(readAnimationSteps(doc)[0].auto).toBe(true)
  })

  it('reads the end point of motion paths', () => {
    const motion = '<p:animMotion path="M 0 0 L 0.3 -0.125 E"><p:cBhvr><p:cTn id="12" dur="1500"/></p:cBhvr></p:animMotion>'
    const doc = slide(timing(click([[0, effect('presetID="0" presetClass="path" nodeType="clickEffect"', '5', motion)]])))
    expect(readAnimationSteps(doc)[0].effects[0]).toMatchObject({ effectClass: 'motion', name: 'path', pathEnd: { x: 0.3, y: -0.125 }, durationMs: 1500 })
  })

  it('ignores media and other non-visual effects', () => {
    const doc = slide(timing(click([[0, effect('presetClass="mediacall" nodeType="clickEffect"', '6')]])))
    expect(readAnimationSteps(doc)).toEqual([])
  })
})
