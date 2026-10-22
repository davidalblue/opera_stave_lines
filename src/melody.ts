// A melody for the Soundwave. Along the stave the wave is split into notes, each with its own pitch
// from a scale and its own loudness. Notes rise in and fade out, some are held over two
// beats, some are rests, and the pitch glides briefly into each new note. The melody scrolls along
// the stave as time passes, like a score being played. Each line can break off into its own notes
// (Voices), so the lines don't all move alike.

// A major pentatonic scale over a little more than an octave, as multiples of the Pitch
const SCALE = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2]
// how often a beat is held over from the last note (making it two beats long), and how often it's a rest
const HOLD = 0.3
const REST = 0.12
// how much of a note the pitch glides into it over, and how long it takes to rise in and fade out
const GLIDE = 0.1
const ATTACK = 0.1
const RELEASE = 0.12
// beats the melody scrolls by per unit of time
const TEMPO = 0.5

type Note = { pitch: number; level: number; offset: number }

export type MelodySettings = {
  seed: number
  // 0 a steady tone, 1 the full melody
  amount: number
  // beats along the stave
  beats: number
  // how often a line plays its own note instead of the shared one
  voices: number
}

/**
 * Fills, at each of the points along stave line `line` at time `t`: `wave`, how far along the base
 * pitch's wave each point is (in beats at the base pitch: 1 more means 1 more beat's worth of
 * waves), and `level`, how loud it is (0 to 1).
 *
 * Each note's wave starts afresh where the note starts, and is set by where the point is in the
 * score, so the waves slide along with the notes as the melody scrolls. Notes are silent where they
 * meet, so the fresh starts don't show.
 */
export function melody(wave: Float64Array, level: Float64Array, line: number, t: number, m: MelodySettings) {
  const points = wave.length
  const a = m.amount
  let cachedBeat = NaN
  let from = 0
  let length = 1
  let note: Note = { pitch: 1, level: 1, offset: 0 }
  let before: Note = note
  for (let s = 0; s < points; s++) {
    const at = (s / (points - 1)) * m.beats - t * TEMPO
    if (!a) {
      wave[s] = at
      level[s] = 1
      continue
    }
    const beat = Math.floor(at)
    if (beat !== cachedBeat) {
      cachedBeat = beat
      // the note this beat belongs to, and the one before it
      from = held(m.seed, beat) ? beat - 1 : beat
      length = held(m.seed, from + 1) ? 2 : 1
      note = noteAt(m, line, from)
      const prev = held(m.seed, from - 1) ? from - 2 : from - 1
      before = noteAt(m, line, prev)
    }
    const q = (at - from) / length
    // glide into the pitch, then rise in, hold, and fade out before the next note
    const p = before.pitch + (note.pitch - before.pitch) * smooth(q / GLIDE)
    const own = p * (at - from) + note.offset
    const shape = note.level * smooth(q / ATTACK) * (1 - 0.4 * q) * smooth((1 - q) / RELEASE)
    // Melody blends from the steady tone to the tune. Even a little melody keeps the notes apart,
    // which hides where each note's wave starts afresh.
    wave[s] = at + (own - at) * a
    level[s] = shape ** a
  }
}

/** The note starting at `beat` on `line`: the shared melody's, or, as often as Voices says, its own. */
function noteAt(m: MelodySettings, line: number, beat: number): Note {
  const own = random(m.seed, 1000 + line, beat) < m.voices
  const voice = own ? line + 1 : 0
  const rest = random(m.seed, voice, beat * 4) < REST
  return {
    pitch: SCALE[Math.floor(random(m.seed, voice, beat * 4 + 1) * SCALE.length)],
    level: rest ? 0 : 0.45 + 0.55 * random(m.seed, voice, beat * 4 + 2),
    offset: random(m.seed, voice, beat * 4 + 3),
  }
}

/**
 * Whether `beat` carries on the note before it rather than starting a new one. Never two in a row,
 * so a note lasts one or two beats. Shared by every line.
 */
const held = (seed: number, beat: number) => random(seed, 500, beat) < HOLD && random(seed, 500, beat - 1) >= HOLD

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}

/** A repeatable random number from 0 to 1 for any three integers. */
function random(a: number, b: number, c: number) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}
