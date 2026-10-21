# Stave Warp

A five-line stave that warps in space and time. A smooth 2D field pushes every point of every line
sideways and up and down, and the field drifts over time. Echoes are the same stave drawn a moment
earlier, so wherever the warp moves fast the lines fan out into ribbons.

Built from [template](https://github.com/davidalblue/template) with Vite, TypeScript and p5.

```sh
pnpm install
pnpm dev
```

## Controls

| Section | Control | What it does |
| --- | --- | --- |
| Stave | Lines | 5 to 40 stave lines |
| | Spacing | Gap between the lines |
| | Length | How much of the canvas width the stave covers |
| Warp | (switch) | Off shows the plain stave |
| | Flow | How far the warp pushes. High values fold the lines into loops |
| | Tension | How tightly it bends. Low gives long sweeps, high gives small curls |
| | Noise | A fine wobble on top |
| | Variation | How differently each line moves, from a stave that stays together to lines that split apart |
| Time | Speed | How fast the warp changes |
| | Echoes | How many earlier staves are drawn |
| | Elasticity | How far back the echoes reach, which sets how wide the ribbons are |
| | Clump | Gathers the echoes into four bunches |
| Colour | Stroke | Line width |
| | Line / Echo / Background | The newest stave, the oldest echo (the echoes blend between the two), and the ground |

**Quick actions:** Pause (or Space), New Warp (a different set of waves), Randomize, Reset.

**Export:** Save PNG (or ⌘S), Save SVG (vector, one path per echo), Record (an MP4 or WebM of the
canvas until you stop it), and Copy Settings (a link that opens with the same settings and warp).
