import p5 from 'p5'
import './style.css'
import { listen, player, recordingTracks } from './audio'
import { followAudio, initPanel, toggleAudio } from './panel'
import { clock, decodeSettings, encodeSettings, state } from './state'
import { hint, syncPanel } from './ui'
import { buildFrame, drawFrame, frameSvg, type Frame } from './warp'

const stage = document.getElementById('stage')!
let canvas: HTMLCanvasElement | null = null
let frame: Frame = []
// size of the last frame drawn, for the SVG
let frameW = 0
let frameH = 0
let saveNextFrame = false
let recorder: MediaRecorder | null = null

// a link made with Copy Settings opens with those settings
const linked = new URLSearchParams(location.hash.slice(1)).get('s')
if (linked && !decodeSettings(linked)) hint("Couldn't read the settings in this link", true)

initPanel({
  savePng: () => (saveNextFrame = true),
  saveSvg: () => {
    if (!canvas) return
    download(new Blob([frameSvg(frame, frameW, frameH)], { type: 'image/svg+xml' }), 'stave.svg')
  },
  record: toggleRecording,
  isRecording: () => recorder !== null,
  copySettings: async () => {
    const link = `${location.origin}${location.pathname}#s=${encodeSettings()}`
    try {
      await navigator.clipboard.writeText(link)
      hint('Link to these settings copied')
    } catch {
      hint("Couldn't copy to the clipboard", true)
    }
  },
})

new p5((p: p5) => {
  p.setup = () => {
    p.createCanvas(stage.clientWidth, stage.clientHeight)
    canvas = (p.drawingContext as CanvasRenderingContext2D).canvas
  }

  p.draw = () => {
    sizeCanvas(p)
    const rate = (p.deltaTime / 1000) * (state.speed / 100) * 1.5
    // With the audio on, the usual animation stops: the Warp only moves while there's sound, and
    // as fast as it's loud
    const listening = player.on ? listen(state.lines) : null
    if (listening) clock.time += rate * listening.level * 2 * (state.sensitivity / 50)
    else if (clock.playing) clock.time += rate
    followAudio()
    frameW = p.width
    frameH = p.height
    frame = buildFrame(p.width, p.height, clock.time, listening)
    p.background(state.background)
    drawFrame(p.drawingContext as CanvasRenderingContext2D, frame, p.width, p.height)
    // saved at the end of a frame, after everything is drawn
    if (saveNextFrame) {
      saveNextFrame = false
      p.saveCanvas('stave', 'png')
    }
  }
}, stage)

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    saveNextFrame = true
    return
  }
  // Space pauses, unless it's pressing a focused button or typing somewhere
  const focused = document.activeElement
  if (e.key === ' ' && !(focused instanceof HTMLButtonElement || focused instanceof HTMLInputElement)) {
    e.preventDefault()
    // with the audio on, Space plays and pauses the audio
    if (player.on) toggleAudio()
    else clock.playing = !clock.playing
    syncPanel()
  }
})

/**
 * Fit: the canvas fills the stage at the screen's resolution. Otherwise it's exactly the chosen
 * width × height in pixels (so saved files are that size), shown scaled down to fit the stage.
 */
function sizeCanvas(p: p5) {
  const fit = state.canvasFit
  const w = fit ? stage.clientWidth : state.canvasW
  const h = fit ? stage.clientHeight : state.canvasH
  const density = fit ? window.devicePixelRatio || 1 : 1
  if (p.pixelDensity() !== density) p.pixelDensity(density)
  if (p.width !== w || p.height !== h) p.resizeCanvas(w, h)
  const scale = fit ? 1 : Math.min(stage.clientWidth / w, stage.clientHeight / h)
  const style = { width: `${w * scale}px`, height: `${h * scale}px` }
  if (canvas && (canvas.style.width !== style.width || canvas.style.height !== style.height)) Object.assign(canvas.style, style)
  canvas?.classList.toggle('is-fixed', !fit)
}

/** Starts recording the canvas as a video, or stops and downloads it. */
function toggleRecording() {
  if (recorder) {
    recorder.stop()
    return
  }
  if (!canvas) return
  // with the audio on, the video carries its sound
  const sound = player.on ? recordingTracks() : []
  const types = sound.length
    ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  const type = types.find((t) => MediaRecorder.isTypeSupported(t))
  if (!type) {
    hint("This browser can't record video", true)
    return
  }
  const chunks: Blob[] = []
  const stream = canvas.captureStream(60)
  for (const track of sound) stream.addTrack(track)
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 20_000_000 })
  rec.ondataavailable = (e) => chunks.push(e.data)
  rec.onstop = () => {
    recorder = null
    syncPanel()
    download(new Blob(chunks, { type }), `stave.${type.startsWith('video/mp4') ? 'mp4' : 'webm'}`)
  }
  rec.start()
  recorder = rec
  hint('Recording…')
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
