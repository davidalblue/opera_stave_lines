/** Everything the panel controls. Reset puts it back to these. */
const DEFAULTS = {
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
  // Time: how fast the field changes, and the trail of earlier staves (Clump bunches it up)
  speed: 25,
  echoes: 30,
  elasticity: 40,
  clump: 0,
  // Look
  stroke: 6,
  lineColour: '#ff4d00',
  echoColour: '#ff4d00',
  background: '#5a4f49',
  // which warp: a new seed is a new set of waves
  seed: 1,
}

export type State = typeof DEFAULTS
export type NumberKey = { [K in keyof State]: State[K] extends number ? K : never }[keyof State]

/** Each number's range: the slider's ends, and the limits for settings read from a link. */
export const RANGES: Record<NumberKey, [number, number]> = {
  lines: [5, 40],
  spacing: [0, 100],
  length: [10, 100],
  flow: [0, 100],
  tension: [0, 100],
  noise: [0, 100],
  clump: [0, 100],
  variation: [0, 100],
  speed: [0, 100],
  echoes: [1, 100],
  elasticity: [0, 100],
  stroke: [1, 40],
  seed: [0, 1e9],
}

export const state: State = { ...DEFAULTS }

/** Whether time is running. Kept out of the state so links and Reset don't change it. */
export const clock = { playing: true, time: 0 }

/** Puts the controls back, keeping the current warp. */
export function reset() {
  Object.assign(state, DEFAULTS, { seed: state.seed })
}

export function newWarp() {
  state.seed = Math.floor(Math.random() * 1e9)
}

/** A new warp with random settings; the stave itself and the colours stay. */
export function randomize() {
  const between = (min: number, max: number) => Math.round(min + Math.random() * (max - min))
  newWarp()
  state.warp = true
  state.flow = between(25, 90)
  state.tension = between(10, 80)
  state.noise = Math.random() < 0.6 ? 0 : between(5, 40)
  state.clump = Math.random() < 0.5 ? 0 : between(20, 90)
  state.variation = between(0, 70)
  state.echoes = between(10, 80)
  state.elasticity = between(15, 90)
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
  return true
}
