import { CANVAS_PRESETS, clock, newWarp, randomize, RANGES, reset, state, type NumberKey } from './state'
import { $, addSync, button, choice, colour, numberField, onPanelChange, slider, syncPanel, toggle, type Bind } from './ui'

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

/** Wires the controls in index.html to the state. */
export function initPanel(actions: Actions) {
  onPanelChange(() => {})
  const warping = () => state.warp
  const sounding = () => state.sound
  const moving = () => state.warp || state.sound

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

  $('#stave-sliders').append(num('Lines', 'lines'), num('Spacing', 'spacing'), num('Length', 'length'))

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

  const play = button($('#play'), () => (clock.playing = !clock.playing))
  addSync(() => (play.textContent = clock.playing ? 'Pause' : 'Play'))
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
