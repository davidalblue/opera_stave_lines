// Draws frames on the graphics card (WebGL 2).
//
// The lines are finer than a pixel and the echoes pack them closely together. Drawn the usual way,
// each line covers the ones before it, so a pixel's colour depends on exactly where the lines fall
// within it, and across a dense ribbon that breaks into rings and bands. Here every line instead
// adds how much of each pixel it covers (and its colour, weighted by that) into a running total, and
// each pixel then shows the average colour at the total coverage. Closely packed lines add up to an
// even ribbon however they line up with the pixels, a lone line looks just as it would drawn
// normally, and where echoes of different colours overlap, their colours blend.
import { lineWidth, type Frame } from './warp'

export type Renderer = {
  canvas: HTMLCanvasElement
  /** Draws `frame` on a `w`×`h` canvas at `scale` pixels per unit. */
  draw(frame: Frame, w: number, h: number, scale: number, colours: Colours): void
}
export type Colours = { line: string; echo: string; background: string }

const LINE_VERTEX = `#version 300 es
in vec2 a_point;
in float a_across;
in float a_age;
uniform vec2 u_size;
uniform float u_scale;
out float v_across;
out float v_age;
void main() {
  vec2 p = a_point * u_scale / u_size * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  v_across = a_across;
  v_age = a_age;
}`

// How much of a pixel `v_across` px from the middle of the line the line covers, seen through a
// soft bell-shaped window (a Gaussian, SOFTNESS px wide) rather than a hard pixel-sized one: lines
// packed about as closely as the pixels would otherwise beat against them in rings. tanh(1.2x) is
// close to the error function the bell's edges call for.
const LINE_FRAGMENT = `#version 300 es
precision highp float;
in float v_across;
in float v_age;
uniform float u_half;
uniform float u_soft;
uniform vec3 u_line;
uniform vec3 u_echo;
out vec4 colour;
void main() {
  float k = 1.2025 / (u_soft * 1.41421356);
  float cover = 0.5 * (tanh((v_across + u_half) * k) - tanh((v_across - u_half) * k));
  colour = vec4(mix(u_echo, u_line, v_age) * cover, cover);
}`

// how soft each line's edge is, in px: wide enough to stop the rings, too narrow to look blurred
const SOFTNESS = 0.55

const SCREEN_VERTEX = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`

// the totals turned into the picture: the average colour, as much as the lines cover, over the ground
const SCREEN_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_totals;
uniform vec3 u_ground;
out vec4 colour;
void main() {
  vec4 total = texture(u_totals, v_uv);
  vec3 ink = total.a > 1e-5 ? total.rgb / total.a : vec3(0.0);
  colour = vec4(mix(u_ground, ink, min(total.a, 1.0)), 1.0);
}`

/** A WebGL renderer, or null if the browser can't do what it needs. */
export function createRenderer(): Renderer | null {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true })
  // the running totals need more than 8 bits per channel
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null

  const lineProgram = program(gl, LINE_VERTEX, LINE_FRAGMENT)
  const screenProgram = program(gl, SCREEN_VERTEX, SCREEN_FRAGMENT)
  if (!lineProgram || !screenProgram) return null
  const at = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name)
  const u = {
    size: at(lineProgram, 'u_size'),
    scale: at(lineProgram, 'u_scale'),
    half: at(lineProgram, 'u_half'),
    soft: at(lineProgram, 'u_soft'),
    line: at(lineProgram, 'u_line'),
    echo: at(lineProgram, 'u_echo'),
    totals: at(screenProgram, 'u_totals'),
    ground: at(screenProgram, 'u_ground'),
  }

  // each vertex: x, y (units), how far across the line it is (px), and how new its echo is (0–1)
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const vertexBuffer = gl.createBuffer()
  const indexBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
  const attribute = (name: string, size: number, offset: number) => {
    const loc = gl.getAttribLocation(lineProgram, name)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 16, offset)
  }
  attribute('a_point', 2, 0)
  attribute('a_across', 1, 8)
  attribute('a_age', 1, 12)
  gl.bindVertexArray(null)

  // the running totals, a texture the lines add into
  const totals = gl.createTexture()
  const framebuffer = gl.createFramebuffer()
  let totalsW = 0
  let totalsH = 0

  let vertices = new Float32Array(0)
  let indices = new Uint32Array(0)

  return {
    canvas,
    draw(frame, w, h, scale, colours) {
      const W = Math.max(1, Math.round(w * scale))
      const H = Math.max(1, Math.round(h * scale))
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W
        canvas.height = H
      }
      if (totalsW !== W || totalsH !== H) {
        totalsW = W
        totalsH = H
        gl.bindTexture(gl.TEXTURE_2D, totals)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, W, H, 0, gl.RGBA, gl.HALF_FLOAT, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, totals, 0)
      }

      // Each line becomes a strip a little wider than itself, so its soft edge fits: two corners
      // at every point, either side of it, and two triangles between each point and the next.
      const half = (lineWidth(w, h) * scale) / 2
      const edge = half + SOFTNESS * 3
      const reach = edge / scale
      let count = 0
      let pointCount = 0
      for (const staff of frame) for (const line of staff) pointCount += line.length / 2
      if (vertices.length < pointCount * 8) vertices = new Float32Array(pointCount * 8 * 1.5)
      if (indices.length < pointCount * 6) indices = new Uint32Array(pointCount * 6 * 1.5)
      let v = 0
      let ix = 0
      frame.forEach((staff, e) => {
        const age = frame.length > 1 ? e / (frame.length - 1) : 1
        for (const line of staff) {
          const n = line.length / 2
          for (let k = 0; k < n; k++) {
            const a = Math.max(0, k - 1)
            const b = Math.min(n - 1, k + 1)
            const tx = line[b * 2] - line[a * 2]
            const ty = line[b * 2 + 1] - line[a * 2 + 1]
            const l = Math.hypot(tx, ty) || 1
            const nx = (-ty / l) * reach
            const ny = (tx / l) * reach
            const x = line[k * 2]
            const y = line[k * 2 + 1]
            vertices[v++] = x + nx
            vertices[v++] = y + ny
            vertices[v++] = edge
            vertices[v++] = age
            vertices[v++] = x - nx
            vertices[v++] = y - ny
            vertices[v++] = -edge
            vertices[v++] = age
            if (k < n - 1) {
              const i0 = count + k * 2
              indices[ix++] = i0
              indices[ix++] = i0 + 1
              indices[ix++] = i0 + 2
              indices[ix++] = i0 + 1
              indices[ix++] = i0 + 3
              indices[ix++] = i0 + 2
            }
          }
          count += n * 2
        }
      })

      // add every line into the totals
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.viewport(0, 0, W, H)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.useProgram(lineProgram)
      gl.uniform2f(u.size, W, H)
      gl.uniform1f(u.scale, scale)
      gl.uniform1f(u.half, half)
      gl.uniform1f(u.soft, SOFTNESS)
      gl.uniform3fv(u.line, rgb(colours.line))
      gl.uniform3fv(u.echo, rgb(colours.echo))
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, vertices.subarray(0, v), gl.STREAM_DRAW)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices.subarray(0, ix), gl.STREAM_DRAW)
      gl.drawElements(gl.TRIANGLES, ix, gl.UNSIGNED_INT, 0)
      gl.bindVertexArray(null)
      gl.disable(gl.BLEND)

      // then show the totals on the canvas
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, W, H)
      gl.useProgram(screenProgram)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, totals)
      gl.uniform1i(u.totals, 0)
      gl.uniform3fv(u.ground, rgb(colours.background))
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
  }
}

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, source)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s))
      return null
    }
    return s
  }
  const vs = shader(gl.VERTEX_SHADER, vertex)
  const fs = shader(gl.FRAGMENT_SHADER, fragment)
  if (!vs || !fs) return null
  const p = gl.createProgram()!
  gl.attachShader(p, vs)
  gl.attachShader(p, fs)
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p))
    return null
  }
  return p
}

/** A #rrggbb colour as three numbers from 0 to 1. */
function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
