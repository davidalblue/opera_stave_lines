import p5 from 'p5'
import './style.css'
import { initPanel } from './panel'
import { clock, decodeSettings, encodeSettings, state } from './state'
import { hint, syncPanel } from './ui'
import { buildFrame, drawFrame, frameSvg, type Frame } from './warp'

const stage = document.getElementById('stage')!
let canvas: HTMLCanvasElement | null = null
let frame: Frame = []
let saveNextFrame = false
let recorder: MediaRecorder | null = null

// a link made with Copy Settings opens with those settings
const linked = new URLSearchParams(location.hash.slice(1)).get('s')
if (linked && !decodeSettings(linked)) hint("Couldn't read the settings in this link", true)

initPanel({
  savePng: () => (saveNextFrame = true),
  saveSvg: () => {
    if (!canvas) return
    download(new Blob([frameSvg(frame, stage.clientWidth, stage.clientHeight)], { type: 'image/svg+xml' }), 'stave.svg')
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
    new ResizeObserver(() => p.resizeCanvas(stage.clientWidth, stage.clientHeight)).observe(stage)
  }

  p.draw = () => {
    if (clock.playing) clock.time += (p.deltaTime / 1000) * (state.speed / 100) * 1.5
    frame = buildFrame(p.width, p.height, clock.time)
    p.background(state.background)
    drawFrame(p.drawingContext as CanvasRenderingContext2D, frame)
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
    clock.playing = !clock.playing
    syncPanel()
  }
})

/** Starts recording the canvas as a video, or stops and downloads it. */
function toggleRecording() {
  if (recorder) {
    recorder.stop()
    return
  }
  if (!canvas) return
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
  if (!type) {
    hint("This browser can't record video", true)
    return
  }
  const chunks: Blob[] = []
  const rec = new MediaRecorder(canvas.captureStream(60), { mimeType: type, videoBitsPerSecond: 20_000_000 })
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
