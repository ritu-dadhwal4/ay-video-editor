// Synthesises the "sound when a picture appears" set into sfx/*.wav.
// Made from scratch here (no samples), so there is nothing to license.
// node scripts/sfx.mjs
import fs from 'fs'
import path from 'path'
import { SKILL } from './lib.mjs'

const RATE = 48000
let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1

function wav(file, samples) {
  const n = samples.length, buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  const peak = Math.max(1e-6, ...samples.map(Math.abs))
  samples.forEach((s, i) => buf.writeInt16LE(Math.round((s / peak) * 0.7 * 32767), 44 + i * 2))
  fs.writeFileSync(file, buf)
}
const len = (sec) => new Float32Array(Math.round(sec * RATE))
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d))

/* A short filtered tick: noise burst through a one-pole band, plus a body tone. */
function click(sec, tone, bright, decay) {
  const out = len(sec)
  let lp = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE
    lp += bright * (rnd() - lp)
    out[i] = (lp * 0.8 + Math.sin(2 * Math.PI * tone * t) * 0.5) * env(t, 0.0008, decay)
  }
  return out
}
/* A pitch-dropping sine: the bubble of a pop. */
function pop(sec, f0, f1, decay) {
  const out = len(sec)
  let ph = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE, f = f1 + (f0 - f1) * Math.exp(-t / 0.018)
    ph += (2 * Math.PI * f) / RATE
    out[i] = Math.sin(ph) * env(t, 0.002, decay)
  }
  return out
}
function mix(...parts) {
  const out = len(Math.max(...parts.map(([a, at]) => a.length / RATE + at)))
  for (const [a, at, g = 1] of parts) a.forEach((s, i) => { out[i + Math.round(at * RATE)] += s * g })
  return out
}

/* A struck bell: a few inharmonic partials, each fading at its own rate. */
function bell(sec, f, decay, partials = [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.9, 0.12]]) {
  const out = len(sec)
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE
    let v = 0
    for (const [m, g] of partials) v += Math.sin(2 * Math.PI * f * m * t) * g * Math.exp(-t / (decay / m ** 0.5))
    out[i] = v * env(t, 0.002, 99)
  }
  return out
}
/* Filtered noise whose brightness follows `shape(p)` over its length. */
function airy(sec, shape, gain = (p) => Math.sin(Math.PI * p)) {
  const out = len(sec)
  let lp = 0
  for (let i = 0; i < out.length; i++) {
    const p = i / out.length
    lp += shape(p) * (rnd() - lp)
    out[i] = lp * gain(p)
  }
  return out
}
function tone(sec, f0, f1, decay, wave = Math.sin) {
  const out = len(sec)
  let ph = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE, f = f0 + (f1 - f0) * (t / sec)
    ph += (2 * Math.PI * f) / RATE
    out[i] = wave(ph) * env(t, 0.003, decay)
  }
  return out
}

const SOUNDS = {
  tick: () => click(0.04, 3200, 0.8, 0.004),
  typing: () => mix(...[0, 0.09, 0.16, 0.27, 0.33, 0.45, 0.52, 0.63].map((at, i) => [click(0.05, 1800 + (i % 3) * 300, 0.6, 0.007), at, 0.7 + (i % 2) * 0.3])),
  camera: () => mix([click(0.06, 1200, 0.7, 0.01), 0], [airy(0.12, () => 0.5, (p) => Math.exp(-p * 6)), 0.02, 0.6], [click(0.06, 900, 0.6, 0.012), 0.11, 0.8]),
  bubble: () => mix([pop(0.12, 500, 1400, 0.03), 0], [pop(0.1, 700, 1800, 0.025), 0.06, 0.5]),
  'swoosh-up': () => airy(0.5, (p) => 0.02 + 0.4 * p * p, (p) => Math.sin(Math.PI * Math.min(1, p * 1.2)) * (p < 0.85 ? 1 : (1 - p) / 0.15)),
  swipe: () => airy(0.22, (p) => 0.35 - 0.25 * p, (p) => Math.sin(Math.PI * p)),
  riser: () => mix([airy(1.6, (p) => 0.01 + 0.3 * p ** 2, (p) => p ** 1.5 * (p < 0.96 ? 1 : (1 - p) / 0.04)), 0], [tone(1.6, 180, 900, 99, (x) => Math.sin(x) * 0.4), 0, 0.5]),
  boom: () => mix([tone(0.9, 120, 38, 0.25), 0], [airy(0.3, () => 0.1, (p) => Math.exp(-p * 8)), 0, 0.5]),
  ding: () => bell(1.4, 1320, 0.5),
  chime: () => mix([bell(1.2, 1046, 0.45), 0], [bell(1.2, 1318, 0.45), 0.12, 0.8], [bell(1.4, 1568, 0.5), 0.24, 0.7]),
  sparkle: () => mix(...[2093, 2637, 3136, 2349, 3520].map((f, i) => [bell(0.6, f, 0.12, [[1, 1], [2.4, 0.3]]), i * 0.06, 0.5 + (i % 2) * 0.3])),
  notification: () => mix([bell(0.6, 1760, 0.18, [[1, 1], [3, 0.2]]), 0], [bell(0.8, 2349, 0.22, [[1, 1], [3, 0.2]]), 0.11]),
  success: () => mix([bell(0.5, 784, 0.2, [[1, 1], [2, 0.3]]), 0], [bell(0.5, 988, 0.2, [[1, 1], [2, 0.3]]), 0.1], [bell(0.9, 1175, 0.35, [[1, 1], [2, 0.3]]), 0.2]),
  error: () => mix([tone(0.18, 140, 140, 0.12, (x) => Math.sign(Math.sin(x)) * 0.5), 0], [tone(0.22, 120, 120, 0.15, (x) => Math.sign(Math.sin(x)) * 0.5), 0.2]),
  click: () => click(0.08, 2200, 0.55, 0.012),
  'double-click': () => mix([click(0.08, 2200, 0.55, 0.012), 0], [click(0.08, 2400, 0.55, 0.012), 0.085, 0.85]),
  'soft-click': () => click(0.1, 900, 0.2, 0.02),
  'soft-pop': () => pop(0.18, 700, 260, 0.05),
  pop: () => mix([pop(0.16, 1100, 380, 0.035), 0], [click(0.05, 3000, 0.7, 0.006), 0, 0.4]),
  slap: () => {
    const out = len(0.22)
    let lp = 0
    for (let i = 0; i < out.length; i++) { const t = i / RATE; lp += 0.35 * (rnd() - lp); out[i] = lp * env(t, 0.001, 0.035) + Math.sin(2 * Math.PI * 140 * t) * 0.6 * env(t, 0.001, 0.05) }
    return out
  },
  whoosh: () => {
    const out = len(0.45)
    let lp = 0
    for (let i = 0; i < out.length; i++) {
      const t = i / RATE, p = t / 0.45
      lp += (0.02 + 0.25 * Math.sin(Math.PI * p)) * (rnd() - lp)
      out[i] = lp * Math.sin(Math.PI * p) ** 1.5
    }
    return out
  },
}

const dir = path.join(SKILL, 'sfx')
fs.mkdirSync(dir, { recursive: true })
for (const [name, make] of Object.entries(SOUNDS)) wav(path.join(dir, name + '.wav'), Array.from(make()))
console.log('sfx ready:', Object.keys(SOUNDS).join(', '))
