// Audio: an uploaded MP3 or MP4 plays through the Web Audio API, and every frame its loudness, its
// loudness in each pitch range (one per stave line), its beats, its treble and its waveform are
// read for the stave to react to.

/** What the stave reacts to this frame. */
export type Listening = {
  // overall loudness, 0 to about 1
  level: number
  // loudness in each line's pitch range, from the lowest (bass) to the highest, each measured
  // against its own recent peak so a quiet range still moves its line
  bands: Float32Array
  // jumps to 1 on each beat (a sudden rise in the bass) and dies away over about a fifth of a second
  kick: number
  // loudness of the highs: hi-hats, cymbals, the edges of voices
  treble: number
  // the last few moments' waveforms, oldest first, each read from `start` so it holds still like
  // an oscilloscope's trace
  waves: { data: Float32Array; start: number }[]
}

// samples in each waveform the analyser hands over
const FFT = 2048
// how many past waveforms are kept for the echoes
const HISTORY = 40
// the pitch ranges the lines share out, in Hz
const LOWEST = 40
const HIGHEST = 8000

const el = new Audio()
el.preload = 'auto'
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let recordingOut: MediaStreamAudioDestinationNode | null = null
let url = ''
let level = 0
let bands = new Float32Array(0)
// each pitch range's recent peak, which falls back slowly
let peaks = new Float32Array(0)
let kick = 0
let treble = 0
// the bass's recent average, and when the last beat was, for finding beats
let bassAverage = 0
let lastBeat = 0
const history: { data: Float32Array; start: number }[] = []
const freq = new Uint8Array(FFT / 2)

/** Whether the Audio switch is on, and the loaded file's name. */
export const player = { on: false, name: '' }

export function load(file: File) {
  if (url) URL.revokeObjectURL(url)
  url = URL.createObjectURL(file)
  el.src = url
  player.name = file.name
  history.length = 0
}

/** Sets up the Web Audio graph. Browsers only allow this after a click, so it waits for Play. */
function connect() {
  if (ctx) return
  ctx = new AudioContext()
  const source = ctx.createMediaElementSource(el)
  analyser = ctx.createAnalyser()
  analyser.fftSize = FFT
  analyser.smoothingTimeConstant = 0.6
  source.connect(analyser)
  analyser.connect(ctx.destination)
}

/** Plays the file; false if there's none, or the browser wouldn't start it. */
export async function play() {
  if (!player.name) return false
  connect()
  try {
    await ctx!.resume()
    await el.play()
    return true
  } catch {
    return false
  }
}

export const pause = () => el.pause()
export const playing = () => !el.paused && !el.ended
export const duration = () => (Number.isFinite(el.duration) ? el.duration : 0)
export const position = () => el.currentTime
export const seek = (seconds: number) => (el.currentTime = seconds)

/** Runs `fn` whenever playback starts, stops, ends or the file's length becomes known. */
export function onPlayback(fn: () => void) {
  for (const event of ['play', 'pause', 'ended', 'loadedmetadata']) el.addEventListener(event, fn)
}

/** The audio as tracks to add to a recording, if it's playing through Web Audio. */
export function recordingTracks(): MediaStreamTrack[] {
  if (!ctx || !analyser) return []
  if (!recordingOut) {
    recordingOut = ctx.createMediaStreamDestination()
    analyser.connect(recordingOut)
  }
  return recordingOut.stream.getAudioTracks()
}

/** Reads this frame's loudness, `lines` pitch ranges and waveform. */
export function listen(lines: number): Listening {
  if (bands.length !== lines) {
    bands = new Float32Array(lines)
    peaks = new Float32Array(lines)
  }
  // paused, everything holds where it was, so the stave freezes mid-move
  if (!playing()) return { level, bands, kick, treble, waves: history }
  // loudness rises quickly and falls back slowly, so the lines don't flicker
  const ease = (from: number, to: number) => from + (to - from) * (to > from ? 0.5 : 0.12)

  kick *= 0.82
  if (!analyser || !ctx) {
    level = ease(level, 0)
    treble = ease(treble, 0)
    for (let i = 0; i < lines; i++) bands[i] = ease(bands[i], 0)
    return { level, bands, kick, treble, waves: history }
  }

  const data = new Float32Array(FFT)
  analyser.getFloatTimeDomainData(data)
  let sum = 0
  for (const v of data) sum += v * v
  level = ease(level, Math.min(1, Math.sqrt(sum / FFT) * 3.5))

  // each line's share of the pitch range, spaced like the notes on a keyboard (evenly per octave)
  analyser.getByteFrequencyData(freq)
  const hzPerBin = ctx.sampleRate / FFT
  /** Average loudness from `lo` to `hi` Hz, 0 to 1. */
  const range = (lo: number, hi: number) => {
    const from = Math.floor(lo / hzPerBin)
    const to = Math.max(from + 1, Math.ceil(hi / hzPerBin))
    let total = 0
    for (let b = from; b < to; b++) total += freq[b]
    return total / (to - from) / 255
  }

  // A beat is the bass jumping well above its recent average, at most about eight times a second
  const bass = range(40, 160)
  const now = ctx.currentTime
  if (playing() && bass > 0.3 && bass > bassAverage * 1.25 && now - lastBeat > 0.12) {
    kick = 1
    lastBeat = now
  }
  bassAverage += (bass - bassAverage) * 0.08
  treble = ease(treble, Math.min(1, Math.max(0, (range(3000, 10000) - 0.1) / 0.4)))
  for (let i = 0; i < lines; i++) {
    const loud = range(LOWEST * (HIGHEST / LOWEST) ** (i / lines), LOWEST * (HIGHEST / LOWEST) ** ((i + 1) / lines))
    // against its own peak, so a song with little deep bass or high treble still moves those lines
    peaks[i] = Math.max(loud, peaks[i] * 0.997)
    bands[i] = ease(bands[i], Math.min(1, loud / Math.max(peaks[i], 0.08)))
  }

  // Start the waveform where it crosses zero going up, so it stands still from frame to frame like
  // an oscilloscope's trace. Only the first quarter is searched, leaving room for the lines to read
  // a little further along.
  let start = 0
  for (let i = 1; i < FFT / 4; i++) {
    if (data[i - 1] < 0 && data[i] >= 0) {
      start = i
      break
    }
  }
  history.push({ data, start })
  if (history.length > HISTORY) history.shift()
  return { level, bands, kick, treble, waves: history }
}

/** Seconds as m:ss. */
export function clockTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
