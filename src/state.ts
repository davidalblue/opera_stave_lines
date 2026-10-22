/** Everything the panel controls. Reset puts it back to these, except the canvas size. */
const DEFAULTS = {
  // Canvas: Fit fills the stage; otherwise it's drawn and saved at exactly width × height
  canvasFit: true,
  canvasW: 1080,
  canvasH: 1350,
  // Stave
  lines: 5,
  spacing: 40,
  length: 70,
  // Warp: a smooth field that pushes the stave around in both directions
  warp: true,
  flow: 50,
  tension: 40,
  noise: 0,
  variation: 10,
  // Soundwave: the lines only move up and down, as waves travelling along the stave.
  // Warp and Soundwave take turns; with both off the stave is still.
  sound: false,
  amplitude: 40,
  pitch: 20,
  harmonics: 30,
  envelope: 50,
  phase: 10,
  // the melody the Soundwave plays: how much, how many notes along the stave, and how often each
  // line plays its own notes instead of the shared ones
  melody: 70,
  notes: 30,
  voices: 30,
  // Time: how fast the field changes, and the trail of earlier staves (Clump bunches it up)
  speed: 25,
  echoes: 30,
  elasticity: 40,
  clump: 0,
  // Look
  stroke: 6,
  lineColour: '#ffffff',
  echoColour: '#ffffff',
  background: '#000000',
  // which warp: a new seed is a new set of waves
  seed: 1,
}

export type State = typeof DEFAULTS
export type NumberKey = { [K in keyof State]: State[K] extends number ? K : never }[keyof State]

/** Each number's range: the slider's ends, and the limits for settings read from a link. */
export const RANGES: Record<NumberKey, [number, number]> = {
  canvasW: [100, 6000],
  canvasH: [100, 6000],
  lines: [5, 40],
  spacing: [0, 100],
  length: [10, 100],
  flow: [0, 100],
  tension: [0, 100],
  noise: [0, 100],
  clump: [0, 100],
  variation: [0, 100],
  amplitude: [0, 100],
  pitch: [0, 100],
  harmonics: [0, 100],
  envelope: [0, 100],
  phase: [0, 100],
  melody: [0, 100],
  notes: [0, 100],
  voices: [0, 100],
  speed: [0, 100],
  echoes: [1, 100],
  elasticity: [0, 100],
  stroke: [1, 40],
  seed: [0, 1e9],
}

export const state: State = { ...DEFAULTS }

/** Whether time is running. Kept out of the state so links and Reset don't change it. */
export const clock = { playing: true, time: 0 }

/** Ready-made canvas sizes, in px. */
export const CANVAS_PRESETS: Record<string, [number, number]> = {
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '9:16': [1080, 1920],
  '16:9': [1920, 1080],
}

/** Puts the controls back, keeping the current warp and canvas size. */
export function reset() {
  const { seed, canvasFit, canvasW, canvasH } = state
  Object.assign(state, DEFAULTS, { seed, canvasFit, canvasW, canvasH })
}

export function newWarp() {
  state.seed = Math.floor(Math.random() * 1e9)
}

/** New random settings for whichever of Warp or Soundwave is on; the stave and colours stay. */
export function randomize() {
  const between = (min: number, max: number) => Math.round(min + Math.random() * (max - min))
  newWarp()
  state.clump = Math.random() < 0.5 ? 0 : between(20, 90)
  state.echoes = between(10, 80)
  state.elasticity = between(15, 90)
  if (state.sound) {
    state.amplitude = between(15, 80)
    state.pitch = between(5, 60)
    state.harmonics = between(0, 80)
    state.envelope = between(0, 100)
    state.phase = between(0, 60)
    state.melody = between(30, 100)
    state.notes = between(10, 70)
    state.voices = between(0, 80)
    return
  }
  state.warp = true
  state.flow = between(25, 90)
  state.tension = between(10, 80)
  state.noise = Math.random() < 0.6 ? 0 : between(5, 40)
  state.variation = between(0, 70)
}

/** The settings as text for a link, and back. Unknown or mistyped values are ignored. */
export const encodeSettings = () => btoa(JSON.stringify(state))

export function decodeSettings(text: string) {
  let read: Record<string, unknown>
  try {
    read = JSON.parse(atob(text))
  } catch {
    return false
  }
  for (const key of Object.keys(DEFAULTS) as (keyof State)[]) {
    const value = read[key]
    if (typeof value !== typeof DEFAULTS[key]) continue
    if (typeof value === 'number') {
      const [min, max] = RANGES[key as NumberKey]
      if (Number.isFinite(value)) Object.assign(state, { [key]: Math.round(Math.min(max, Math.max(min, value))) })
    } else if (typeof value === 'boolean' || (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))) {
      Object.assign(state, { [key]: value })
    }
  }
  // Warp and Soundwave take turns
  if (state.warp && state.sound) state.sound = false
  return true
}
