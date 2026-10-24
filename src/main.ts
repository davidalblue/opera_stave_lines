import p5 from 'p5'
import './style.css'
import { listen, player, playing, recordingTracks } from './audio'
import { followAudio, initPanel, toggleAudio } from './panel'
import { clock, decodeSettings, encodeSettings, state } from './state'
import { hint, syncPanel } from './ui'
import { createRenderer, type Renderer } from './render'
import { buildFrame, drawFrame, frameSvg, type Frame } from './warp'

const stage = document.getElementById('stage')!
// The renderer draws each frame at the size it's saved at (see render.ts for why it draws on the
// graphics card), and `view` shows it shrunk to fit the stage. p5 just keeps time.
const renderer: Renderer = createRenderer() ?? flatRenderer()
const canvas = renderer.canvas
const view = document.createElement('canvas')
const viewCtx = view.getContext('2d')!
// pixels per unit in saved files: the screen's resolution with Fit, exactly 1 at a fixed size
let outScale = 1
// the canvas's size in units this frame
let size = { w: 0, h: 0 }
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
    // p5's own canvas isn't drawn on
    p.createCanvas(1, 1).hide()
    stage.append(view)
  }

  p.draw = () => {
    sizeCanvas()
    const rate = (p.deltaTime / 1000) * (state.speed / 100) * 1.5
    // With the audio on, the usual animation stops: the Warp only moves while there's sound, as
    // fast as it's loud, and lurches forward on each beat. Pausing the song freezes it.
    const listening = player.on ? listen(state.lines) : null
    if (listening) {
      if (playing()) clock.time += rate * (listening.level * 3 + listening.kick * 8) * (state.sensitivity / 50)
    } else if (clock.playing) clock.time += rate
    followAudio()
    const { w, h } = size
    frameW = w
    frameH = h
    frame = buildFrame(w, h, clock.time, listening)
    renderer.draw(frame, w, h, outScale, { line: state.lineColour, echo: state.echoColour, background: state.background })
    viewCtx.imageSmoothingEnabled = true
    viewCtx.imageSmoothingQuality = 'high'
    viewCtx.drawImage(canvas, 0, 0, view.width, view.height)
    // saved at the end of a frame, after everything is drawn
    if (saveNextFrame) {
      saveNextFrame = false
      canvas.toBlob((png) => png && download(png, 'stave.png'), 'image/png')
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
 * Fit: the canvas fills the stage, saved at the screen's resolution. Otherwise it's exactly the
 * chosen width × height in pixels (so saved files are that size), shown scaled down to fit the stage.
 */
function sizeCanvas() {
  const fit = state.canvasFit
  const w = fit ? stage.clientWidth : state.canvasW
  const h = fit ? stage.clientHeight : state.canvasH
  const dpr = window.devicePixelRatio || 1
  outScale = fit ? dpr : 1
  size = { w, h }
  // the view: the stage's share of the screen, at the screen's resolution
  const scale = fit ? 1 : Math.min(stage.clientWidth / w, stage.clientHeight / h)
  const bw = Math.max(1, Math.round(w * scale * dpr))
  const bh = Math.max(1, Math.round(h * scale * dpr))
  if (view.width !== bw || view.height !== bh) {
    view.width = bw
    view.height = bh
  }
  const style = { width: `${w * scale}px`, height: `${h * scale}px` }
  if (view.style.width !== style.width || view.style.height !== style.height) Object.assign(view.style, style)
  view.classList.toggle('is-fixed', !fit)
}

/** Draws the usual way on a plain canvas, for browsers without WebGL 2. */
function flatRenderer(): Renderer {
  const flat = document.createElement('canvas')
  const ctx = flat.getContext('2d')!
  return {
    canvas: flat,
    draw(frame, w, h, scale, colours) {
      const W = Math.max(1, Math.round(w * scale))
      const H = Math.max(1, Math.round(h * scale))
      if (flat.width !== W || flat.height !== H) {
        flat.width = W
        flat.height = H
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = colours.background
      ctx.fillRect(0, 0, W, H)
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      drawFrame(ctx, frame, w, h)
    },
  }
}

/** Starts recording the canvas as a video, or stops and downloads it. */
function toggleRecording() {
  if (recorder) {
    recorder.stop()
    return
  }
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
  // recorded at the saved size
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
