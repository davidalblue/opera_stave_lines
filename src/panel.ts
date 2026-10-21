import { clock, newWarp, randomize, RANGES, reset, state, type NumberKey } from './state'
import { $, addSync, button, colour, onPanelChange, slider, syncPanel, toggle, type Bind } from './ui'

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

  $('#stave-sliders').append(num('Lines', 'lines'), num('Spacing', 'spacing'), num('Length', 'length'))

  toggle($('#warp-switch'), { get: () => state.warp, set: (v) => (state.warp = v) })
  $('#warp-sliders').append(
    num('Flow', 'flow', warping),
    num('Tension', 'tension', warping),
    num('Noise', 'noise', warping),
    num('Variation', 'variation', warping),
  )

  // echoes only show while the stave is warped
  $('#time-sliders').append(
    num('Speed', 'speed'),
    num('Echoes', 'echoes', warping),
    num('Elasticity', 'elasticity', warping),
    num('Clump', 'clump', warping),
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
