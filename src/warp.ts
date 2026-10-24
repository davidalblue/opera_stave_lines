// The stave and how it moves. Warp pushes each point of each line sideways and up/down by a sum of
// smooth waves that drift over time, so the lines fold and loop. Soundwave only moves the lines up
// and down, as waves travelling along the stave. Echoes are the same stave drawn at earlier moments,
// so wherever the lines move fast they fan out into ribbons.
import type { Listening } from './audio'
import { melody } from './melody'
import { state } from './state'

/** One stave line as x, y pairs. */
export type Line = Float32Array
/** All the lines of the stave at every echo, oldest echo first. */
export type Frame = Line[][]

type Wave = {
  // direction and relative frequency of the wave across the canvas
  kx: number
  ky: number
  // how fast it drifts, and where it starts
  rate: number
  phase: number
  // The push turns as the wave passes: cos(phase) pushes along (ax, ay), sin(phase) along (bx, by).
  // Points along the line trace small ellipses, and when the ellipses are bigger than the wave is
  // long, the line loops over itself.
  ax: number
  ay: number
  bx: number
  by: number
  // how much its phase shifts from one stave line to the next (Variation)
  shift: number
}

/** One harmonic of the Soundwave. */
type Partial = {
  // how far off an exact multiple of the pitch it is, so the harmonics drift against each other
  detune: number
  // how fast it travels along the stave, and where it starts
  rate: number
  phase: number
  // how fast and from where it swells and fades
  swell: number
  swellPhase: number
}

const MAIN_WAVES = 5
const PARTIALS = 6
const NOISE_WAVES = 6
// most points worked out and drawn per frame, across all lines and echoes
const POINT_BUDGET = 200_000
// how many bunches Clump gathers the echoes into
const BUNCHES = 4

let cached: { seed: number; main: Wave[]; noise: Wave[]; partials: Partial[] } | null = null

function wavesFor(seed: number) {
  if (cached?.seed === seed) return cached
  const rand = mulberry32(seed)
  const make = (count: number): Wave[] => {
    const waves = Array.from({ length: count }, () => {
      const dir = rand() * Math.PI * 2
      const turn = rand() * Math.PI * 2
      const f = 0.6 + rand() * 0.8
      const size = 0.5 + rand() * 0.5
      // round or flattened ellipses, turning either way
      const round = (0.2 + rand() * 0.8) * (rand() < 0.5 ? -1 : 1)
      return {
        kx: Math.cos(dir) * f,
        ky: Math.sin(dir) * f,
        rate: (0.25 + rand() * 0.6) * (rand() < 0.5 ? -1 : 1),
        phase: rand() * Math.PI * 2,
        ax: Math.cos(turn) * size,
        ay: Math.sin(turn) * size,
        bx: -Math.sin(turn) * size * round,
        by: Math.cos(turn) * size * round,
        shift: rand() * 2 - 1,
      }
    })
    // keep the overall push about the same size whatever the waves came out as
    const power = Math.sqrt(waves.reduce((sum, w) => sum + w.ax ** 2 + w.ay ** 2 + w.bx ** 2 + w.by ** 2, 0) / 2)
    for (const w of waves) {
      w.ax /= power
      w.ay /= power
      w.bx /= power
      w.by /= power
    }
    return waves
  }
  // The Soundwave's harmonics draw from a separate run of random numbers, so adding them didn't
  // change the Warp's waves: a seed gives the same warp as before Soundwave existed.
  const soundRand = mulberry32(seed)
  const partials = Array.from({ length: PARTIALS }, (_, i) => ({
    detune: i === 0 ? 1 : 1 + (soundRand() - 0.5) * 0.06,
    rate: 2.5 * Math.sqrt(i + 1) * (1 + soundRand() * 0.3),
    phase: soundRand() * Math.PI * 2,
    swell: 0.3 + soundRand() * 0.6,
    swellPhase: soundRand() * Math.PI * 2,
  }))
  cached = { seed, main: make(MAIN_WAVES), noise: make(NOISE_WAVES), partials }
  return cached
}

/**
 * The stave on a `w`×`h` canvas at `time`, with its echoes. With `listening`, it reacts to the
 * audio instead: the Warp moves only as far as the sound pushes it, each line by its own pitch
 * range, and without the Warp each line draws the sound's waveform.
 */
export function buildFrame(w: number, h: number, time: number, listening: Listening | null = null): Frame {
  const { main, noise, partials } = wavesFor(state.seed)
  const S = Math.min(w, h)
  const warp = state.warp
  const sound = !warp && state.sound && !listening
  // with the audio on and no Warp, the lines draw the sound's waveform
  const scope = !warp && listening ? listening : null
  const sensitivity = state.sensitivity / 50
  // on a beat the lines burst apart, then close up again
  const kick = listening ? listening.kick : 0
  const burst = 1 + 1.5 * kick

  const lines = state.lines
  const gap = S * (0.004 + 0.0006 * state.spacing)
  // Continuous: the lines run the whole width, from just outside the left edge to just outside the
  // right, with their ends pinned there, so they always come in and go out off-screen
  const pinned = warp && state.join
  const len = pinned ? w + S * 0.1 : w * (state.length / 100)
  const left = (w - len) / 2
  const mid = h / 2

  // Flow is how far the waves push; Tension how tightly they bend. Past about Flow 40 at the
  // default Tension the push changes faster than the stave is long, so lines fold into loops.
  const flow = warp ? (state.flow / 100) * S * 0.5 : 0
  const k = 1.5 + (state.tension / 100) * 10
  const fizz = warp ? (state.noise / 100) * S * 0.05 : 0
  const vary = (state.variation / 100) * 0.9

  // Soundwave: Amplitude is how high the waves rise, Pitch how many fit along the stave, Harmonics
  // how much the higher ones add, Envelope how much the wave fades towards the ends of the stave
  const amp = sound ? (state.amplitude / 100) * S * 0.25 : 0
  const cycles = 0.5 + (state.pitch / 100) * 24
  const overtone = state.harmonics / 100
  const fade = state.envelope / 100
  const phase = (state.phase / 100) * Math.PI * 0.5

  // echoes are spread evenly over the trail; Elasticity sets how far back it reaches
  const moving = warp || sound || !!scope
  const clump = moving ? state.clump / 100 : 0
  const echoes = moving ? state.echoes : 1
  // sound waves travel fast, so their trail is shorter
  const trail = (state.elasticity / 100) * (sound ? 0.1 : 1.6)

  // a point every 5px along the stave (2px for the finer sound waves), fewer when there are many
  // lines and echoes
  const points = Math.max(40, Math.min(Math.round(len / (sound || scope ? 2 : 5)), Math.floor(POINT_BUDGET / (lines * echoes))))
  const step = len / (points - 1)
  const dx = new Float64Array(points)
  const dy = new Float64Array(points)

  /** Adds the push of `waves` to dx, dy for one line, at `scale` px and `kk` radians per S. */
  const push = (waves: Wave[], scale: number, kk: number, y: number, t: number, lineShift: number) => {
    for (const wv of waves) {
      const ax = wv.ax * scale
      const ay = wv.ay * scale
      const bx = wv.bx * scale
      const by = wv.by * scale
      const start = wv.rate * t + wv.phase + lineShift * wv.shift
      // along the line the phase grows by the same amount each point, so each point's
      // cos and sin come from turning the last one's on by that amount
      const arg = (kk * (wv.kx * left + wv.ky * y)) / S + start
      const turn = (kk * wv.kx * step) / S
      const ct = Math.cos(turn)
      const st = Math.sin(turn)
      let c = Math.cos(arg)
      let sn = Math.sin(arg)
      for (let s = 0; s < points; s++) {
        dx[s] += c * ax + sn * bx
        dy[s] += c * ay + sn * by
        const next = c * ct - sn * st
        sn = sn * ct + c * st
        c = next
      }
    }
  }

  // how far each point may move when the ends are pinned: nothing at the ends, easing up to the
  // full warp away from them
  const pin = new Float64Array(points).fill(1)
  if (pinned) {
    for (let s = 0; s < points; s++) {
      const e = Math.sin((Math.PI * s) / (points - 1))
      pin[s] = e * (2 - e)
    }
  }

  // the Envelope: from the same height all along (0) to silent at both ends (1)
  const envelope = new Float64Array(points)
  for (let s = 0; s < points; s++) envelope[s] = 1 - fade * (1 - Math.sin((Math.PI * s) / (points - 1)) ** 2)

  const tune = { seed: state.seed, amount: state.melody / 100, beats: 1 + (state.notes / 100) * 23, voices: state.voices / 100 }
  const wave = new Float64Array(points)
  const level = new Float64Array(points)
  // radians of the base pitch's wave per beat
  const perBeat = (Math.PI * 2 * cycles) / tune.beats

  /** Adds the Soundwave's up-and-down movement to dy for line `line`. */
  const ring = (t: number, line: number, lineShift: number) => {
    melody(wave, level, line, t, tune)
    // each harmonic is quieter than the last by `overtone`, and swells and fades on its own
    let total = 0
    for (let p = 0; p < partials.length; p++) total += overtone ** p
    partials.forEach((pt, p) => {
      const n = p + 1
      const size = ((amp * overtone ** p) / total) * (0.6 + 0.4 * Math.sin(pt.swell * t + pt.swellPhase))
      if (size < 0.01) return
      const k = perBeat * n * pt.detune
      const start = pt.phase - pt.rate * t + lineShift * n
      for (let s = 0; s < points; s++) dy[s] += Math.sin(k * wave[s] + start) * size * envelope[s] * level[s]
    })
  }

  // The waveform: each line shows the same moment of sound a little further along than the line
  // above, so the lines don't all match. The echoes show the last few moments.
  const WINDOW = 1024
  const shift = Math.floor(256 / lines)
  // louder lines swing further, and each beat throws them wider
  const height = S * 0.45 * sensitivity * burst
  // the trace eases off towards the ends of the stave, so it meets the margins at the stave line
  const taper = new Float64Array(points)
  for (let s = 0; s < points; s++) taper[s] = 0.5 + 0.5 * Math.sin((Math.PI * s) / (points - 1)) ** 2
  const trailFrames = Math.round((state.elasticity / 100) * 30)
  /** Adds echo `e`'s waveform to dy for line `line`. */
  const trace = (heard: Listening, e: number, line: number) => {
    const waves = heard.waves
    if (!waves.length) return
    const back = echoes > 1 ? Math.round((1 - e / (echoes - 1)) * trailFrames) : 0
    const { data, start } = waves[Math.max(0, waves.length - 1 - back)]
    const from = start + line * shift
    const swing = height * (0.8 + 0.6 * heard.bands[lines - 1 - line])
    for (let s = 0; s < points; s++) dy[s] += data[from + Math.floor((s / (points - 1)) * (WINDOW - 1))] * swing * taper[s]
  }

  // Listening with the Warp: the lines move together with the overall loudness, and each line's
  // own pitch range (bass on the bottom line) adds a little on top, so silence leaves the plain
  // stave. Each beat shoves every line harder for a moment, and the highs make the lines shiver.
  const loudness = (i: number) => {
    if (!listening || !warp) return 1
    return sensitivity * 1.6 * (0.7 * listening.level + 0.3 * listening.bands[lines - 1 - i]) * (1 + 1.5 * kick)
  }
  const shiver = (i: number) => {
    if (!listening || !warp) return 1
    return sensitivity * (0.3 * listening.level + 1.4 * listening.treble + 0.5 * listening.bands[lines - 1 - i]) * (1 + kick)
  }

  const frame: Frame = []
  for (let e = 0; e < echoes; e++) {
    const t = echoes > 1 ? time - trail * (1 - bunched(e / (echoes - 1), clump)) : time
    const staff: Line[] = []
    // total push on this echo, to keep it centred
    let sumX = 0
    let sumY = 0
    for (let i = 0; i < lines; i++) {
      const fromMiddle = i - (lines - 1) / 2
      const y = mid + fromMiddle * gap * burst
      dx.fill(0)
      dy.fill(0)
      const gain = loudness(i)
      // beats also set the lines moving apart from each other
      if (flow && gain) push(main, flow * gain, k, y, t, fromMiddle * vary * burst)
      const jitter = fizz * shiver(i)
      if (jitter) push(noise, jitter, k * 4, y, t * 3, 0)
      if (amp) ring(t, i, fromMiddle * phase)
      if (scope) trace(scope, e, i)

      const out = new Float32Array(points * 2)
      for (let s = 0; s < points; s++) {
        dx[s] *= pin[s]
        dy[s] *= pin[s]
        out[s * 2] = left + s * step + dx[s]
        out[s * 2 + 1] = y + dy[s]
        sumX += dx[s]
        sumY += dy[s]
      }
      staff.push(out)
    }
    // the stave warps in place rather than wandering off: each echo's average push is taken out
    // (pinned ends already hold it in place)
    if (warp && !pinned) {
      const mx = sumX / (lines * points)
      const my = sumY / (lines * points)
      for (const line of staff) {
        for (let i = 0; i < line.length; i += 2) {
          line[i] -= mx
          line[i + 1] -= my
        }
      }
    }
    frame.push(staff)
  }
  return frame
}

/**
 * Where an echo sits along the trail, from 0 (oldest) to 1 (newest). Clump gathers the echoes into
 * bunches with gaps between them; at full Clump each bunch is a single moment, drawn many times.
 */
function bunched(at: number, clump: number) {
  if (!clump) return at
  const spot = Math.min(at * BUNCHES, BUNCHES - 1e-9)
  const bunch = Math.floor(spot)
  return (bunch + 0.5 + (spot - bunch - 0.5) * (1 - clump)) / BUNCHES
}

/** Colour of echo `e` of `count`: the echo colour for the oldest, the line colour for the newest. */
export function echoColour(e: number, count: number) {
  const t = count > 1 ? e / (count - 1) : 1
  const a = hex(state.echoColour)
  const b = hex(state.lineColour)
  const mix = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t)
  return `rgb(${mix(0)} ${mix(1)} ${mix(2)})`
}

/** Line width in px. Stroke is set for an 800px canvas and grows with it, so every size looks alike. */
export const lineWidth = (w: number, h: number) => (state.stroke / 10) * (Math.min(w, h) / 800)

/** Draws `frame` the usual way, each line over the ones before; used where WebGL isn't available. */
export function drawFrame(ctx: CanvasRenderingContext2D, frame: Frame, w: number, h: number) {
  ctx.lineWidth = lineWidth(w, h)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  frame.forEach((staff, e) => {
    ctx.strokeStyle = echoColour(e, frame.length)
    ctx.beginPath()
    for (const line of staff) {
      ctx.moveTo(line[0], line[1])
      for (let i = 2; i < line.length; i += 2) ctx.lineTo(line[i], line[i + 1])
    }
    ctx.stroke()
  })
}

/** The frame as an SVG file, one path per echo. */
export function frameSvg(frame: Frame, w: number, h: number) {
  const paths = frame.map((staff, e) => {
    const d = staff
      .map((line) => {
        let s = `M${line[0].toFixed(1)} ${line[1].toFixed(1)}`
        for (let i = 2; i < line.length; i += 2) s += `L${line[i].toFixed(1)} ${line[i + 1].toFixed(1)}`
        return s
      })
      .join('')
    return `<path d="${d}" stroke="${echoColour(e, frame.length)}"/>`
  })
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="100%" height="100%" fill="${state.background}"/>`,
    `<g fill="none" stroke-width="${lineWidth(w, h).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">`,
    ...paths,
    '</g></svg>',
  ].join('\n')
}

function hex(c: string) {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Small seeded random numbers, so a seed always gives the same warp
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
