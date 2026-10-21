// The stave and its warp. Each point of each line is pushed sideways and up/down by a sum of smooth
// waves that drift over time. Echoes are the same stave drawn at earlier moments, so wherever the
// warp moves fast the lines fan out into ribbons.
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

const MAIN_WAVES = 5
const NOISE_WAVES = 6
// most points worked out and drawn per frame, across all lines and echoes
const POINT_BUDGET = 200_000
// how many bunches Clump gathers the echoes into
const BUNCHES = 4

let cached: { seed: number; main: Wave[]; noise: Wave[] } | null = null

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
  cached = { seed, main: make(MAIN_WAVES), noise: make(NOISE_WAVES) }
  return cached
}

/** The stave on a `w`×`h` canvas at `time`, with its echoes. */
export function buildFrame(w: number, h: number, time: number): Frame {
  const { main, noise } = wavesFor(state.seed)
  const S = Math.min(w, h)
  const warp = state.warp

  const lines = state.lines
  const gap = S * (0.004 + 0.0006 * state.spacing)
  const len = w * (state.length / 100)
  const left = (w - len) / 2
  const mid = h / 2

  // Flow is how far the waves push; Tension how tightly they bend. Past about Flow 40 at the
  // default Tension the push changes faster than the stave is long, so lines fold into loops.
  const flow = warp ? (state.flow / 100) * S * 0.5 : 0
  const k = 1.5 + (state.tension / 100) * 10
  const fizz = warp ? (state.noise / 100) * S * 0.05 : 0
  const clump = warp ? state.clump / 100 : 0
  const vary = (state.variation / 100) * 0.9

  // echoes are spread evenly over the trail; Elasticity sets how far back it reaches
  const echoes = warp ? state.echoes : 1
  const trail = (state.elasticity / 100) * 1.6

  // about one point every 5px along the stave, fewer when there are many lines and echoes
  const points = Math.max(40, Math.min(Math.round(len / 5), Math.floor(POINT_BUDGET / (lines * echoes))))
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

  const frame: Frame = []
  for (let e = 0; e < echoes; e++) {
    const t = echoes > 1 ? time - trail * (1 - bunched(e / (echoes - 1), clump)) : time
    const staff: Line[] = []
    // total push on this echo, to keep it centred
    let sumX = 0
    let sumY = 0
    for (let i = 0; i < lines; i++) {
      const fromMiddle = i - (lines - 1) / 2
      const y = mid + fromMiddle * gap
      dx.fill(0)
      dy.fill(0)
      if (flow) push(main, flow, k, y, t, fromMiddle * vary)
      if (fizz) push(noise, fizz, k * 4, y, t * 3, 0)

      const out = new Float32Array(points * 2)
      for (let s = 0; s < points; s++) {
        out[s * 2] = left + s * step + dx[s]
        out[s * 2 + 1] = y + dy[s]
        sumX += dx[s]
        sumY += dy[s]
      }
      staff.push(out)
    }
    // the stave warps in place rather than wandering off: each echo's average push is taken out
    const mx = sumX / (lines * points)
    const my = sumY / (lines * points)
    for (const line of staff) {
      for (let i = 0; i < line.length; i += 2) {
        line[i] -= mx
        line[i + 1] -= my
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

export function drawFrame(ctx: CanvasRenderingContext2D, frame: Frame) {
  ctx.lineWidth = state.stroke / 10
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
    `<g fill="none" stroke-width="${state.stroke / 10}" stroke-linecap="round" stroke-linejoin="round">`,
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
