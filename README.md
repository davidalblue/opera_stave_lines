# Stave Warp

A five-line stave that moves in space and time, in one of two ways. **Warp** is a smooth field
that pushes every point of every line sideways and up and down, so the lines fold and loop.
**Soundwave** stays flat: the lines only move up and down, as waves travelling along the stave.
Echoes are the same stave drawn a moment earlier, so wherever the lines move fast they fan out.

Built from [template](https://github.com/davidalblue/template) with Vite, TypeScript and p5.

```sh
pnpm install
pnpm dev
```

## Controls

| Section | Control | What it does |
| --- | --- | --- |
| Canvas | Fit / 1:1 / 4:5 / 9:16 / 16:9, W × H | Fit fills the window. Any other size draws and saves at exactly that many pixels, shown scaled to fit |
| Stave | Lines | 5 to 40 stave lines |
| | Spacing | Gap between the lines |
| | Length | How much of the canvas width the stave covers |
| Warp | (switch) | With Warp and Soundwave both off, the stave is still |
| | Flow | How far the warp pushes. High values fold the lines into loops |
| | Tension | How tightly it bends. Low gives long sweeps, high gives small curls |
| | Noise | A fine wobble on top |
| | Variation | How differently each line moves, from a stave that stays together to lines that split apart |
| Soundwave | (switch) | Turning Soundwave on turns Warp off, and the other way round |
| | Amplitude | How high the waves rise |
| | Pitch | How many waves fit along the stave |
| | Harmonics | How much the higher harmonics add, from a pure sine to a rich, jagged wave |
| | Envelope | From the same height all along to silent at both ends of the stave |
| | Phase | How far each line lags behind the one above |
| | Melody | From one steady tone to a tune: notes with their own pitch (a pentatonic scale) and loudness, rests, held notes, and short glides between them. The tune scrolls along the stave like a score |
| | Notes | How many notes fit along the stave |
| | Voices | From every line playing the same tune to each line often playing its own notes |
| Time | Speed | How fast the lines move |
| | Echoes | How many earlier staves are drawn |
| | Elasticity | How far back the echoes reach, which sets how wide the ribbons are |
| | Clump | Gathers the echoes into four bunches |
| Colour | Stroke | Line width |
| | Line / Echo / Background | The newest stave, the oldest echo (the echoes blend between the two), and the ground. White on black to start |

**Quick actions:** Pause (or Space), New Warp (a different set of waves), Randomize, Reset.

**Export:** Save PNG (or ⌘S), Save SVG (vector, one path per echo), Record (an MP4 or WebM of the
canvas until you stop it), and Copy Settings (a link that opens with the same settings and warp).
