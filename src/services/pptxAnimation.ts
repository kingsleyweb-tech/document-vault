/**
 * Reads slide transitions (<p:transition>) and the main animation sequence
 * (<p:timing>) from a parsed slide part.
 *
 * PowerPoint stores far more than a browser preview can reproduce, so effects
 * are reduced to a small vocabulary the slideshow can draw with CSS. Anything
 * unrecognised plays as the nearest simple effect (usually a fade) rather than
 * being dropped, so content never appears without some motion or stays hidden.
 *
 * Timing layout of the main sequence:
 *   mainSeq > childTnLst > par            one entry per click ("step")
 *     > cTn > childTnLst > par            time-offset groups within the step
 *       > cTn > childTnLst > par > cTn    the effect (presetClass / presetID)
 */

export type Direction = 'left' | 'right' | 'up' | 'down'

export type TransitionKind = 'cut' | 'fade' | 'push' | 'wipe' | 'cover' | 'uncover' | 'split' | 'zoom' | 'circle'

export interface SlideTransition {
  kind: TransitionKind
  /** Which way the motion travels; for push, the new slide comes in from the opposite side. */
  direction: Direction
  /** For split: true when the opening travels outwards from the centre. */
  outward: boolean
  /** For split: true for a vertical split line (opens left/right). */
  vertical: boolean
  throughBlack: boolean
  durationMs: number
  advanceOnClick: boolean
  advanceAfterMs?: number
}

export type EffectClass = 'entrance' | 'exit' | 'emphasis' | 'motion'

export type EffectName =
  | 'appear'
  | 'fade'
  | 'fly'
  | 'wipe'
  | 'split'
  | 'zoom'
  | 'circle'
  | 'float'
  | 'bounce'
  | 'spin'
  | 'grow'
  | 'pulse'
  | 'teeter'
  | 'transparency'
  | 'path'

export interface SlideEffect {
  /** cNvPr id of the shape (or group) the effect animates. */
  targetId: string
  /** Set when only one paragraph of a text box is animated (bullet builds). */
  paragraph?: number
  effectClass: EffectClass
  name: EffectName
  /** Side the object enters from / leaves towards, where the effect has one. */
  direction: Direction
  /** Start time relative to the start of the step. */
  delayMs: number
  durationMs: number
  /** Motion paths: end offset as a fraction of the slide size. */
  pathEnd?: { x: number; y: number }
}

export interface AnimationStep {
  /** Plays without a click: at slide start for the first step, otherwise straight after the previous step. */
  auto: boolean
  effects: SlideEffect[]
}

const SPEED_MS: Record<string, number> = { fast: 500, med: 750, slow: 1000 }
const IGNORED_TRANSITION_CHILDREN = new Set(['sndAc', 'extLst'])

const TRANSITION_KINDS: Record<string, TransitionKind> = {
  fade: 'fade',
  dissolve: 'fade',
  randomBar: 'fade',
  random: 'fade',
  blinds: 'wipe',
  checker: 'fade',
  comb: 'wipe',
  strips: 'wipe',
  newsflash: 'zoom',
  plus: 'circle',
  wedge: 'circle',
  wheel: 'circle',
  wheelReverse: 'circle',
  circle: 'circle',
  diamond: 'circle',
  push: 'push',
  wipe: 'wipe',
  cover: 'cover',
  pull: 'uncover',
  split: 'split',
  zoom: 'zoom',
  cut: 'cut',
  // PowerPoint 2010+ (p14 / p15 / p159) effects, mapped to the closest simple motion.
  reveal: 'fade',
  flash: 'fade',
  glitter: 'fade',
  honeycomb: 'zoom',
  vortex: 'zoom',
  ripple: 'circle',
  shred: 'fade',
  switch: 'push',
  flip: 'push',
  gallery: 'push',
  cube: 'push',
  box: 'push',
  pan: 'push',
  conveyor: 'push',
  ferris: 'push',
  doors: 'split',
  window: 'split',
  prism: 'push',
  warp: 'zoom',
  flythrough: 'zoom',
  prstTrans: 'fade',
  morph: 'fade',
}

export function readTransition(doc: Document): SlideTransition | undefined {
  const nodes = descendants(doc, 'transition')
  if (nodes.length === 0) return undefined

  let durationMs: number | undefined
  let kindNode: Element | null = null
  let kind: TransitionKind | undefined
  let advanceOnClick = true
  let advanceAfterMs: number | undefined

  // A transition often appears twice: a modern variant inside mc:Choice and a
  // classic fallback. Take the duration from whichever states one, and the
  // first effect we can draw.
  // An exact duration (p14:dur, in ms) beats the fast/med/slow keyword.
  for (const node of nodes) {
    const dur = attributeByLocalName(node, 'dur')
    if (dur && Number.isFinite(Number(dur))) {
      durationMs = Number(dur)
      break
    }
  }
  for (const node of nodes) {
    const speed = node.getAttribute('spd')
    if (durationMs === undefined && speed && SPEED_MS[speed]) durationMs = SPEED_MS[speed]
    if (node.getAttribute('advClick') === '0') advanceOnClick = false
    const advTm = node.getAttribute('advTm')
    if (advTm && Number.isFinite(Number(advTm))) advanceAfterMs = Number(advTm)

    const child = Array.from(node.children).find((element) => !IGNORED_TRANSITION_CHILDREN.has(element.localName))
    if (!kind && child && TRANSITION_KINDS[child.localName]) {
      kind = TRANSITION_KINDS[child.localName]
      kindNode = child
    }
  }

  const hasEffect = nodes.some((node) => Array.from(node.children).some((element) => !IGNORED_TRANSITION_CHILDREN.has(element.localName)))
  const resolvedKind: TransitionKind = kind ?? (hasEffect ? 'fade' : 'cut')
  const dir = kindNode?.getAttribute('dir') ?? ''

  return {
    kind: resolvedKind,
    direction: sideDirection(dir, 'left'),
    outward: dir !== 'in',
    vertical: (kindNode?.getAttribute('orient') ?? 'horz') === 'vert',
    throughBlack: kindNode?.getAttribute('thruBlk') === '1',
    durationMs: durationMs ?? (resolvedKind === 'cut' ? 0 : 700),
    advanceOnClick,
    advanceAfterMs,
  }
}

/** OOXML side directions: l / r / u / d, plus corner values that we fold onto the nearest side. */
function sideDirection(value: string, fallback: Direction): Direction {
  switch (value) {
    case 'l':
    case 'lu':
    case 'ld':
      return 'left'
    case 'r':
    case 'ru':
    case 'rd':
      return 'right'
    case 'u':
      return 'up'
    case 'd':
      return 'down'
    default:
      return fallback
  }
}

export function readAnimationSteps(doc: Document): AnimationStep[] {
  const mainSeq = descendants(doc, 'cTn').find((ctn) => ctn.getAttribute('nodeType') === 'mainSeq')
  const clickList = mainSeq ? child(mainSeq, 'childTnLst') : null
  if (!clickList) return []

  const steps: AnimationStep[] = []
  for (const clickPar of children(clickList, 'par')) {
    const clickCtn = child(clickPar, 'cTn')
    const groupList = clickCtn ? child(clickCtn, 'childTnLst') : null
    if (!groupList) continue

    const effects: SlideEffect[] = []
    let firstNodeType: string | null = null
    for (const groupPar of children(groupList, 'par')) {
      const groupCtn = child(groupPar, 'cTn')
      const effectList = groupCtn ? child(groupCtn, 'childTnLst') : null
      if (!groupCtn || !effectList) continue
      const groupDelay = conditionDelay(groupCtn)
      for (const effectPar of children(effectList, 'par')) {
        const effectCtn = child(effectPar, 'cTn')
        if (!effectCtn) continue
        firstNodeType ??= effectCtn.getAttribute('nodeType')
        const effect = readEffect(effectCtn, groupDelay + conditionDelay(effectCtn))
        if (effect) effects.push(effect)
      }
    }
    if (effects.length > 0) steps.push({ auto: firstNodeType !== null && firstNodeType !== 'clickEffect', effects })
  }
  return steps
}

function readEffect(ctn: Element, delayMs: number): SlideEffect | null {
  const presetClass = ctn.getAttribute('presetClass')
  const effectClass: EffectClass | null =
    presetClass === 'entr' ? 'entrance' : presetClass === 'exit' ? 'exit' : presetClass === 'emph' ? 'emphasis' : presetClass === 'path' ? 'motion' : null
  if (!effectClass) return null

  const target = descendants(ctn, 'spTgt')[0]
  const targetId = target?.getAttribute('spid')
  if (!targetId) return null
  const range = descendants(target, 'pRg')[0]
  const paragraph = range ? Number(range.getAttribute('st')) : undefined

  const presetId = Number(ctn.getAttribute('presetID') ?? 0)
  const subtype = Number(ctn.getAttribute('presetSubtype') ?? 0)

  let pathEnd: SlideEffect['pathEnd']
  if (effectClass === 'motion') {
    const path = descendants(ctn, 'animMotion')[0]?.getAttribute('path') ?? ''
    const numbers = path.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) ?? []
    if (numbers.length >= 2) pathEnd = { x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] }
  }

  return {
    targetId,
    paragraph: Number.isInteger(paragraph) ? paragraph : undefined,
    effectClass,
    name: effectClass === 'motion' ? 'path' : effectClass === 'emphasis' ? emphasisName(presetId) : entranceName(presetId),
    direction: subtypeDirection(subtype, presetId),
    delayMs: Math.max(0, delayMs),
    durationMs: Math.max(1, effectDuration(ctn)),
    pathEnd,
  }
}

/** Entrance and exit presets share ids (exit is the same effect reversed). */
function entranceName(presetId: number): EffectName {
  switch (presetId) {
    case 1:
      return 'appear'
    case 2:
    case 7:
    case 12:
      return 'fly'
    case 3:
    case 18:
    case 22:
      return 'wipe'
    case 16:
    case 17:
      return 'split'
    case 4:
    case 6:
    case 8:
    case 21:
      return 'circle'
    case 23:
    case 53:
    case 31:
      return 'zoom'
    case 26:
      return 'bounce'
    case 37:
    case 42:
    case 47:
      return 'float'
    default:
      return 'fade'
  }
}

function emphasisName(presetId: number): EffectName {
  switch (presetId) {
    case 6:
      return 'grow'
    case 8:
      return 'spin'
    case 9:
      return 'transparency'
    case 32:
      return 'teeter'
    default:
      return 'pulse'
  }
}

/**
 * Fly/wipe subtypes are bit flags for the side the object comes from:
 * 1 top, 2 right, 4 bottom, 8 left (corners combine two). Float Down (47)
 * moves downwards; other floats rise.
 */
function subtypeDirection(subtype: number, presetId: number): Direction {
  if (presetId === 47) return 'up'
  if (presetId === 37 || presetId === 42) return 'down'
  if (subtype & 8) return 'left'
  if (subtype & 2) return 'right'
  if (subtype & 1) return 'up'
  if (subtype & 4) return 'down'
  return 'down'
}

/** Longest delay + duration among the effect's behaviours. */
function effectDuration(ctn: Element) {
  let end = 0
  for (const behaviour of descendants(ctn, 'cTn')) {
    const dur = Number(behaviour.getAttribute('dur'))
    if (!Number.isFinite(dur)) continue
    end = Math.max(end, conditionDelay(behaviour) + dur)
  }
  return end || 500
}

function conditionDelay(ctn: Element) {
  const conditions = child(ctn, 'stCondLst')
  const condition = conditions ? child(conditions, 'cond') : null
  const delay = Number(condition?.getAttribute('delay'))
  return Number.isFinite(delay) ? delay : 0
}

function attributeByLocalName(element: Element, localName: string) {
  // Some DOMs report a prefixed attribute's localName with its prefix ("p14:dur").
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.localName === localName || attribute.name.endsWith(`:${localName}`)) return attribute.value
  }
  return null
}

function descendants(root: Document | Element, localName: string) {
  return Array.from(root.getElementsByTagName('*')).filter((element) => element.localName === localName)
}

function children(parent: Element, localName: string) {
  return Array.from(parent.children).filter((element) => element.localName === localName)
}

function child(parent: Element, localName: string) {
  return children(parent, localName)[0] ?? null
}
