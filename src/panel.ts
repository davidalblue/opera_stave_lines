import { clockTime, duration, load, onPlayback, pause, play, player, playing, position, seek } from './audio'
import { CANVAS_PRESETS, clock, newWarp, randomize, RANGES, reset, state, type NumberKey } from './state'
import { $, addSync, button, choice, colour, hint, numberField, onPanelChange, slider, syncPanel, toggle, type Bind, type Slider } from './ui'

/** Binds a slider to a number in the state, over its range. */
const num = (label: string, key: NumberKey, when: () => boolean = () => true, off = 'Off') => {
  const bind: Bind<number> = { get: () => state[key], set: (v) => (state[key] = v) }
  return slider(label, bind, () => (when() ? RANGES[key] : null), off)
}

/** What the export buttons do; main.ts owns the canvas, so it supplies these. */
export type Actions = {
  savePng(): void
  saveSvg(): void
  record(): void
  isRecording(): boolean
  copySettings(): void
}

let timeSlider: Slider | null = null

/** Moves the audio's Time slider along with the song; run every frame. */
export function followAudio() {
  if (player.name) timeSlider?.sync()
}

/** Plays or pauses the audio, turning the Audio switch on to play. */
export async function toggleAudio() {
  if (playing()) {
    pause()
    return
  }
  player.on = true
  syncPanel()
  if (!(await play())) hint(player.name ? "The browser wouldn't play this file" : 'Upload an MP3 or MP4 first', true)
}

/** Wires the controls in index.html to the state. */
export function initPanel(actions: Actions) {
  onPanelChange(() => {})
  const warping = () => state.warp
  // the Soundwave's own waves rest while the lines react to audio
  const sounding = () => state.sound && !player.on
  const moving = () => state.warp || state.sound || player.on

  // Canvas: Fit, a ready-made size, or any width × height
  const sizes = [{ value: 'fit', label: 'Fit' }, ...Object.keys(CANVAS_PRESETS).map((value) => ({ value, label: value }))]
  choice($('#canvas-sizes'), sizes, {
    get: () => {
      if (state.canvasFit) return 'fit'
      const match = Object.entries(CANVAS_PRESETS).find(([, [w, h]]) => w === state.canvasW && h === state.canvasH)
      return match?.[0] ?? ''
    },
    set: (v) => {
      state.canvasFit = v === 'fit'
      if (v !== 'fit') [state.canvasW, state.canvasH] = CANVAS_PRESETS[v]
    },
  })
  const sizeField = (sel: string, key: 'canvasW' | 'canvasH') => {
    numberField($<HTMLInputElement>(sel), { get: () => state[key], set: (v) => Object.assign(state, { [key]: v, canvasFit: false }) }, RANGES[key])
  }
  sizeField('#canvas-w', 'canvasW')
  sizeField('#canvas-h', 'canvasH')
  // the size fields are dimmed while the canvas fits the window
  addSync(() => $('.size-row').classList.toggle('is-dim', state.canvasFit))

  // with Continuous on, the stave always runs the full width
  const sized = () => !(state.warp && state.join)
  $('#stave-sliders').append(num('Lines', 'lines'), num('Spacing', 'spacing'), num('Length', 'length', sized, 'Full'))

  // Warp and Soundwave take turns: switching one on switches the other off
  toggle($('#warp-switch'), {
    get: () => state.warp,
    set: (v) => {
      state.warp = v
      if (v) state.sound = false
    },
  })
  $('#warp-sliders').append(
    num('Flow', 'flow', warping),
    num('Tension', 'tension', warping),
    num('Noise', 'noise', warping),
    num('Variation', 'variation', warping),
  )
  // Continuous only shapes the Warp
  const join = toggle($('#join'), { get: () => state.join, set: (v) => (state.join = v) })
  addSync(() => ((join as HTMLButtonElement).disabled = !state.warp))

  toggle($('#sound-switch'), {
    get: () => state.sound,
    set: (v) => {
      state.sound = v
      if (v) state.warp = false
    },
  })
  $('#sound-sliders').append(
    num('Amplitude', 'amplitude', sounding),
    num('Pitch', 'pitch', sounding),
    num('Harmonics', 'harmonics', sounding),
    num('Envelope', 'envelope', sounding),
    num('Phase', 'phase', sounding),
    num('Melody', 'melody', sounding),
    num('Notes', 'notes', sounding),
    num('Voices', 'voices', sounding),
  )

  // Audio: upload, play and seek a song; while the switch is on the lines only react to it
  toggle($('#audio-switch'), {
    get: () => player.on,
    set: (v) => {
      player.on = v
      if (!v) pause()
      else if (!player.name) hint('Upload an MP3 or MP4 for the lines to react to')
    },
  })
  const file = $<HTMLInputElement>('#audio-file')
  button($('#audio-upload'), () => file.click())
  file.addEventListener('change', async () => {
    const picked = file.files?.[0]
    file.value = ''
    if (!picked) return
    load(picked)
    player.on = true
    syncPanel()
    if (!(await play())) hint('Press Play to start the audio')
  })
  const playButton = button($('#audio-play'), () => toggleAudio())
  timeSlider = slider('Time', { get: position, set: seek }, () => (player.name && duration() ? [0, Math.floor(duration())] : null), '–', clockTime)
  $('#audio-sliders').append(timeSlider, num('Sensitivity', 'sensitivity'))
  addSync(() => {
    playButton.textContent = playing() ? 'Pause' : 'Play'
    ;(playButton as HTMLButtonElement).disabled = !player.name
    $('#audio-note').textContent = player.name ? `${player.name} · ${clockTime(duration())}` : 'Upload a song for the lines to react to'
  })
  onPlayback(syncPanel)

  // echoes only show while the stave is moving
  $('#time-sliders').append(
    num('Speed', 'speed'),
    num('Echoes', 'echoes', moving),
    num('Elasticity', 'elasticity', moving),
    num('Clump', 'clump', moving),
  )

  $('#stroke-slider').append(num('Stroke', 'stroke'))
  colour($('#line-colour'), { get: () => state.lineColour, set: (v) => (state.lineColour = v) })
  colour($('#echo-colour'), { get: () => state.echoColour, set: (v) => (state.echoColour = v) })
  colour($('#background-colour'), { get: () => state.background, set: (v) => (state.background = v) })

  // with the audio on, Pause and Play are the audio's
  const playAll = button($('#play'), () => (player.on ? toggleAudio() : (clock.playing = !clock.playing)))
  addSync(() => (playAll.textContent = (player.on ? playing() : clock.playing) ? 'Pause' : 'Play'))
  button($('#new-warp'), newWarp)
  button($('#randomize'), randomize)
  button($('#reset'), reset)

  button($('#save-png'), actions.savePng)
  button($('#save-svg'), actions.saveSvg)
  const record = button($('#record'), actions.record)
  addSync(() => {
    record.textContent = actions.isRecording() ? 'Stop Recording' : 'Record'
    record.classList.toggle('is-recording', actions.isRecording())
  })
  button($('#copy-settings'), actions.copySettings)

  syncPanel()
}
