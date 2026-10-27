// Start a project from a raw take: copy, transcribe, find pauses, mark the
// rough cut, measure the face and write edit.json.
// node scripts/start.mjs <video> [--look quiet] [--lang en] [--out <folder>]
import fs from 'fs'
import path from 'path'
import { ff, probe, run, applyLook, writeEdit, catalogue, SKILL } from './lib.mjs'
import { measureFace } from './face.mjs'

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
const input = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--'))) || '')
if (!fs.existsSync(input)) { console.error('Usage: node scripts/start.mjs <video> [--look quiet] [--lang en]'); process.exit(1) }
const lang = opt('lang', 'en')
const name = opt('name', null) || path.basename(input, path.extname(input)).replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'reel'
const title = opt('title', null) || path.basename(input, path.extname(input))
const dir = path.resolve(opt('out', path.join(path.dirname(input), `${name}-ay`)))
fs.mkdirSync(path.join(dir, 'out'), { recursive: true })
const step = (s) => console.log('·', s)

/* 1 · Copy, never overwrite. A clean 1080x1920, 30 fps copy to work from. */
const info = probe(input)
const LIM = catalogue().limits
if (!info.width) { console.error('NOT_A_VIDEO: this file has no video in it.'); process.exit(2) }
if (!info.audio) { console.error('NO_AUDIO: this video has no sound, so there is nothing to caption or cut.'); process.exit(2) }
if (info.duration > LIM.maxSeconds + 1) { console.error(`TOO_LONG: ${info.duration.toFixed(0)} s. The limit is ${LIM.maxSeconds / 60} minutes; trim it first.`); process.exit(2) }
if (info.duration < LIM.minSeconds) { console.error(`TOO_SHORT: ${info.duration.toFixed(1)} s. It needs at least ${LIM.minSeconds} seconds.`); process.exit(2) }
const landscape = info.width > info.height && !Math.abs(info.rotation || 0)
step(`copying ${path.basename(input)} (${info.duration.toFixed(1)} s${landscape ? ', landscape: centre will be cropped to 9:16' : ''})`)
ff(['-i', input, '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1',
  '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
  '-movflags', '+faststart', path.join(dir, 'raw.mp4')])
ff(['-i', path.join(dir, 'raw.mp4'), '-vn', '-ac', '1', '-ar', '16000', path.join(dir, 'audio.wav')])

/* 2 · Words with timings. English uses the English model; any other
   language is transcribed as itself (never translated). */
step('transcribing (the first run downloads the speech model)')
const tArgs = ['--yes', 'hyperframes', 'transcribe', 'audio.wav', '-d', dir, '--json']
if (lang === 'en') tArgs.push('-m', 'small.en')
else tArgs.push('-m', opt('model', 'medium'), '-l', lang)
run('npx', tArgs, { cwd: dir, shell: process.platform === 'win32' })
const raw = JSON.parse(fs.readFileSync(path.join(dir, 'transcript.json'), 'utf8'))
const words = raw.map((w) => ({ w: String(w.text).trim(), s: +w.start, e: +w.end })).filter((w) => w.w)

/* 3 · Pauses, from the audio itself (word end times run into silence).
   Loudness every 50 ms; "quiet" is set from this take's own room noise and
   voice level, so a noisy room and a silent studio both work. */
const meter = run('ffmpeg', ['-hide_banner', '-i', path.join(dir, 'audio.wav'), '-af',
  'asetnsamples=800,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-'], { allowFail: true }).stdout
const levels = [...meter.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -120 : +m[1]))
const sorted = [...levels].sort((a, b) => a - b)
const floor = sorted[Math.floor(sorted.length * 0.1)] ?? -60, voice = sorted[Math.floor(sorted.length * 0.9)] ?? -20
const quiet = floor + 0.3 * (voice - floor)
const pauses = []
let open = null
levels.forEach((db, i) => {
  const t = i * 0.05
  if (db < quiet) { if (open == null) open = t } else if (open != null) { if (t - open >= 0.25) pauses.push([+open.toFixed(3), +t.toFixed(3)]); open = null }
})
if (open != null && levels.length * 0.05 - open >= 0.25) pauses.push([+open.toFixed(3), +(levels.length * 0.05).toFixed(3)])
/* Whisper stretches a word over the silence after it; end it where the
   silence starts so cuts land on the real end of the word. */
for (const w of words) for (const [ps, pe] of pauses) if (ps > w.s && ps < w.e && pe >= w.e - 0.05) w.e = Math.max(w.s + 0.08, ps)

/* 4 · The rough cut: filler words, doubled words and false starts. Keep the
   last clean take, like an editor would. Every cut says why. */
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'erm', 'hmm', 'mm', 'ah'])
words.forEach((w, i) => {
  if (FILLERS.has(norm(w.w))) Object.assign(w, { cut: true, why: 'filler' })
  const nx = words[i + 1]
  if (nx && norm(w.w) && norm(w.w) === norm(nx.w) && nx.s - w.e < 0.6) Object.assign(w, { cut: true, why: 'repeat' })
})
const gapAfter = (i) => {
  const w = words[i], nx = words[i + 1]
  if (!nx) return 99
  const p = pauses.find(([ps, pe]) => ps >= w.s && ps <= nx.s + 0.05)
  return p ? p[1] - p[0] : nx.s - w.e
}
const takes = []
let cur = []
words.forEach((w, i) => { cur.push(i); if (gapAfter(i) >= 0.45) { takes.push(cur); cur = [] } })
if (cur.length) takes.push(cur)
const opening = (t, n) => t.filter((i) => !words[i].cut).slice(0, n).map((i) => norm(words[i].w)).join(' ')
for (let k = 0; k < takes.length - 1; k++) {
  for (const later of takes.slice(k + 1, k + 3)) {
    const n = Math.min(3, takes[k].length, later.length)
    if (n >= 2 && opening(takes[k], n) === opening(later, n)) { takes[k].forEach((i) => Object.assign(words[i], { cut: true, why: 'retake' })); break }
  }
}

/* 5 · Phrase breaks (for line captions) and a first guess at one keyword
   per phrase: a number, else the longest word that is not a filler. */
const STOP = new Set('about after again because before being could every their there these thing things those through would which while where really should actually basically'.split(' '))
let phrase = []
const flush = () => {
  const live = phrase.filter((i) => !words[i].cut)
  if (!live.length) return
  words[live[0]].br = true
  const num = live.find((i) => /\d/.test(words[i].w))
  const best = num ?? live.filter((i) => norm(words[i].w).length >= 6 && !STOP.has(norm(words[i].w))).sort((a, b) => norm(words[b].w).length - norm(words[a].w).length)[0]
  if (best != null) words[best].key = true
  phrase = []
}
words.forEach((w, i) => {
  phrase.push(i)
  if (gapAfter(i) >= 0.25 || /[.!?,;:]$/.test(w.w) || phrase.length >= 6) flush()
})
flush()

/* 6 · The hook guess: the opening words (4 to 8, ending on a phrase
   break), split into two lines. Claude rewrites it in step 2 anyway. */
const firstLine = []
for (const w of words) { if (w.cut) continue; if ((w.br && firstLine.length >= 4) || firstLine.length >= 8) break; firstLine.push(w.w.replace(/[.,!?]$/, '')) }
const half = Math.ceil(firstLine.length / 2)
const hook = [firstLine.slice(0, half).join(' '), firstLine.slice(half).join(' ')].map((s) => s.charAt(0).toUpperCase() + s.slice(1))

let edit = {
  version: 1, name, title, lang, source: 'raw.mp4', original: input, fps: 30, size: [1080, 1920], duration: +info.duration.toFixed(3),
  hook, fx: [], music: { file: null, volume: 0.25 }, quote: null, proof: null,
  pauses, maxPause: 0.35, words,
}
edit = applyLook(edit, opt('look', 'quiet'))

/* v1 defaults: phrase captions with a highlighter, the Classic theme, the
   two-weight hook, a pop when it appears, a cover from the first second.
   Effects are not part of v1. */
{
  const A = catalogue()
  const first = words.find((w) => !w.cut) || words[0]
  edit.fx = []
  edit.captions = { layout: 'phrase', highlight: 'marker', size: 1, case: 'normal' }
  edit.theme = 'classic'
  edit.kit.colours = { ...A.themes.find((t) => t.id === 'classic').colours }
  edit.picks.O = edit.picks.O || 'O1'
  // Motion, frame and grade aren't controls in v1, so they stay neutral.
  Object.assign(edit.picks, { F: 'F1', M: 'M4', G: 'G0' })
  // The creator's saved defaults (Captions → "Use for every video").
  const mine = (await import('./lib.mjs')).savedKit().v1
  if (mine) {
    if (mine.captions) edit.captions = { ...mine.captions }
    if (mine.theme && A.themes.find((t) => t.id === mine.theme)) { edit.theme = mine.theme; edit.kit.colours = { ...A.themes.find((t) => t.id === mine.theme).colours } }
    for (const k of ['captionFont', 'titleFont', 'titleFont2']) if (mine[k]) edit.kit[k] = mine[k]
    if (mine.hook) edit.picks.O = mine.hook
    if (mine.caption) edit.caption = mine.caption
  }
  edit.hookFor = 3
  edit.sounds = first ? [{ sound: 'pop', src: +Math.max(0, first.s - 0.05).toFixed(3), vol: 1 }] : []
  edit.thumb = { src: first ? +(first.s + 1).toFixed(2) : 1, text: [...hook], hook: edit.picks.O }
}

/* 7 · Where the face is, so nothing is ever put over it. */
step('finding your face')
edit.face = await measureFace(path.join(dir, 'raw.mp4'), edit)
writeEdit(dir, edit)

const cut = words.filter((w) => w.cut)
console.log(`\nProject: ${dir}`)
console.log(`${words.length} words · ${cut.length} cut (${['retake', 'filler', 'repeat'].map((k) => `${cut.filter((w) => w.why === k).length} ${k}`).join(', ')}) · ${pauses.length} pauses`)
console.log(`Face: top ${edit.face.top}, eyes ${edit.face.eyes}, chin ${edit.face.chin}, centre ${edit.face.cx}${edit.face.found ? '' : ' (not found, using defaults)'}`)
console.log(`Next: node ${path.join(SKILL, 'scripts/show.mjs')} "${dir}"`)
