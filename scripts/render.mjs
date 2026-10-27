// Render the edit to an MP4, or a few stills to check first.
//   node scripts/render.mjs <project>                 full video → out/<name>-v001.mp4
//   node scripts/render.mjs <project> --stills 1,6,12 stills at those finished seconds
//   node scripts/render.mjs <project> --thumb          the cover image → out/<name>-thumbnail.jpg
//   node scripts/render.mjs <project> --srt            the captions file → out/<name>.srt
//
// 1. Join the kept parts of the take (cut.mp4), with tiny fades so joins never click.
// 2. Cut the person out, only around the styles that sit behind them.
// 3. Draw every frame in Chrome with engine/render.js, the same code as the preview.
// 4. Mix the voice, the picture sounds and any music, then -14 LUFS.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { pathToFileURL } from 'url'
import puppeteer from 'puppeteer-core'
import { SKILL, chrome, ff, run, readEdit, project, catalogue, probe } from './lib.mjs'

const args = process.argv.slice(2)
const dir = path.resolve(args[0] || '')
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null }
const stills = opt('stills') ? opt('stills').split(',').map(Number) : null
const thumbOnly = args.includes('--thumb'), srtOnly = args.includes('--srt')
const edit = readEdit(dir)
const A = catalogue()
const FPS = edit.fps || 30
const work = path.join(dir, 'work')
fs.mkdirSync(work, { recursive: true })
const step = (s) => console.log('·', s)
const url = (f) => pathToFileURL(f).href

const { segs, length, fx, map, project: proj } = project(edit)
const NF = Math.round(length * FPS)
fs.mkdirSync(path.join(dir, 'out'), { recursive: true })

/* Captions as an .srt file, one caption per phrase, for YouTube and others. */
function writeSrt() {
  const W = proj.words, P = proj.phrases
  const ts = (t) => { const ms = Math.round(t * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s2 = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}` }
  const cues = P.map((a, k) => {
    const b = (P[k + 1] ?? W.length) - 1
    const end = Math.min(W[b][2] + 0.25, k + 1 < P.length ? W[P[k + 1]][1] : length)
    return `${k + 1}\n${ts(W[a][1])} --> ${ts(end)}\n${W.slice(a, b + 1).map((w) => w[0]).join(' ')}\n`
  })
  const f = path.join(dir, 'out', `${edit.name}.srt`)
  fs.writeFileSync(f, cues.join('\n'))
  return f
}
if (srtOnly) { console.log(`Done: ${writeSrt()}`); process.exit(0) }

/* ── 1 · The cut ─────────────────────────────────────── */
const cutFile = path.join(work, 'cut.mp4')
const sig = JSON.stringify(segs)
const sigFile = path.join(work, 'cut.json')
if (!fs.existsSync(cutFile) || (fs.existsSync(sigFile) && fs.readFileSync(sigFile, 'utf8') !== sig) || !fs.existsSync(sigFile)) {
  step(`joining ${segs.length} kept parts (${length.toFixed(1)} s)`)
  const src = path.join(dir, edit.source)
  const parts = segs.map(([a, b], i) => {
    const d = b - a, f = Math.min(0.012, d / 4)
    return `[0:v]trim=${a.toFixed(3)}:${b.toFixed(3)},setpts=PTS-STARTPTS[v${i}];` +
      `[0:a]atrim=${a.toFixed(3)}:${b.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=${f.toFixed(3)},afade=t=out:st=${(d - f).toFixed(3)}:d=${f.toFixed(3)}[a${i}]`
  })
  const graph = parts.join(';') + ';' + segs.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${segs.length}:v=1:a=1[v][a]`
  const gfile = path.join(work, 'cut.graph')
  fs.writeFileSync(gfile, graph)
  // ffmpeg 7+ reads a filter graph from a file with -/filter_complex; older
  // versions call it -filter_complex_script.
  const rest = ['-map', '[v]', '-map', '[a]', '-r', String(FPS),
    '-c:v', 'libx264', '-crf', '14', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', path.join(work, 'cut.mov')]
  const r = ff(['-i', src, '-/filter_complex', gfile, ...rest], { allowFail: true })
  if (r.status !== 0) ff(['-i', src, '-filter_complex_script', gfile, ...rest])
  fs.renameSync(path.join(work, 'cut.mov'), cutFile)
  fs.writeFileSync(sigFile, sig)
}

/* Orbit cards: eight moments from across the cut, unless the edit names images. */
for (const x of fx) {
  if (x.code !== 'E1' || x.images) continue
  const odir = path.join(work, 'orbit')
  fs.mkdirSync(odir, { recursive: true })
  x.images = []
  for (let i = 0; i < 8; i++) {
    const f = path.join(odir, `o${i}.jpg`)
    if (!fs.existsSync(f)) ff(['-ss', ((i + 0.5) / 8 * length).toFixed(2), '-i', cutFile, '-frames:v', '1', '-vf', 'crop=iw*0.7:ih*0.62:iw*0.15:ih*0.3,scale=180:-1', '-q:v', '3', f])
    x.images.push(url(f))
  }
}
if (fx.some((x) => x.images)) fx.forEach((x) => { if (x.images) x.images = x.images.map((im) => (im.startsWith('file:') ? im : url(path.resolve(dir, im)))) })

/* ── The state the renderer draws ─────────────────────── */
const state = {
  picks: edit.picks, kit: edit.kit, entrance: edit.entrance, caption: edit.caption,
  captions: edit.captions, hookFor: edit.hookFor || 3,
  fx: fx.map((x) => ({ ...x })), quote: edit.quote,
  proof: edit.proof ? url(path.resolve(dir, edit.proof)) : null,
}

/* ── 2 · The cutout, only where a style sits behind the person ── */
const behind = new Set(A.groups.flatMap((g) => g.items.filter((it) => it.behind).map((it) => it.code)))
const windows = []
if (behind.has(edit.picks.O)) windows.push([0, (edit.hookFor || 3) + 0.6])
fx.forEach((x) => { if (behind.has(x.code)) windows.push([Math.max(0, x.start - 0.3), Math.min(length, x.end + 0.3)]) })
const inWindow = (t) => windows.findIndex(([a, b]) => t >= a && t <= b)

function cutoutFrames(wi) {
  const [a, b] = windows[wi]
  const wdir = path.join(work, `cutout-${a.toFixed(2)}-${b.toFixed(2)}`)
  if (fs.existsSync(path.join(wdir, 'done'))) return wdir
  fs.mkdirSync(wdir, { recursive: true })
  step(`cutting you out for ${a.toFixed(1)}–${b.toFixed(1)} s`)
  const clip = path.join(wdir, 'clip.mp4')
  ff(['-ss', a.toFixed(3), '-i', cutFile, '-t', (b - a).toFixed(3), '-an', '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', clip])
  run('npx', ['--yes', 'hyperframes', 'remove-background', clip, '-o', path.join(wdir, 'alpha.webm'), '--quality', 'best'], { shell: process.platform === 'win32' })
  ff(['-c:v', 'libvpx-vp9', '-i', path.join(wdir, 'alpha.webm'), '-compression_level', '1', path.join(wdir, '%05d.png')])
  fs.writeFileSync(path.join(wdir, 'done'), '')
  return wdir
}
function cutoutFor(t) {
  const wi = inWindow(t)
  if (wi < 0) return null
  const wdir = cutoutFrames(wi)
  const n = Math.round((t - windows[wi][0]) * FPS) + 1
  const f = path.join(wdir, String(n).padStart(5, '0') + '.png')
  return fs.existsSync(f) ? f : null
}

/* ── 3 · Draw ─────────────────────────────────────────── */
const br = await puppeteer.launch({
  executablePath: chrome(), headless: true, protocolTimeout: 900000,
  args: ['--allow-file-access-from-files', '--force-device-scale-factor=1', '--hide-scrollbars'],
})
const pg = await br.newPage()
pg.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); process.exit(1) })
await pg.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 })
await pg.goto(url(path.join(SKILL, 'engine/render.html')), { waitUntil: 'networkidle0', timeout: 120000 })
await pg.waitForFunction('window.READY === true')
const shot = (q = 92) => pg.screenshot({ type: 'jpeg', quality: q, clip: { x: 0, y: 0, width: 1080, height: 1920 }, optimizeForSpeed: true })

/* The cover image: one frame of the take, the hook in a template, no captions. */
if (thumbOnly) {
  const th = edit.thumb || {}
  const code = th.hook || edit.picks.O || 'O1'
  const at = th.src ?? (segs[0][0] + 1)
  const tdir = path.join(work, 'thumb')
  fs.mkdirSync(tdir, { recursive: true })
  const img = path.join(tdir, 'frame.jpg')
  ff(['-ss', (+at).toFixed(3), '-i', path.join(dir, edit.source), '-frames:v', '1', '-q:v', '1', img])
  let cutImg = ''
  if (behind.has(code)) {
    step('cutting you out for the cover')
    run('npx', ['--yes', 'hyperframes', 'remove-background', img, '-o', path.join(tdir, 'cut.png')], { shell: process.platform === 'win32' })
    cutImg = url(path.join(tdir, 'cut.png'))
  }
  const tp = { ...proj, hook: th.text && th.text.some(Boolean) ? th.text : edit.hook }
  const ts = { ...state, picks: { O: code, G: 'G0' }, captions: { on: false }, fx: [], entrance: 'cut', hookFor: 99 }
  await pg.evaluate((p, s) => window.setup(p, s), tp, ts)
  await pg.evaluate((a, b) => window.frame(1.6, a, b), url(img), cutImg)
  const out = path.join(dir, 'out', `${edit.name}-thumbnail.jpg`)
  fs.writeFileSync(out, await shot(95))
  await br.close()
  console.log(`Done: ${out}`)
  process.exit(0)
}

const { events } = await pg.evaluate((p, s) => window.setup(p, s), proj, state)

function frameAt(t, file) {
  ff(['-ss', t.toFixed(3), '-i', cutFile, '-frames:v', '1', '-q:v', '2', file])
  return file
}

if (stills) {
  const sdir = path.join(dir, 'check')
  fs.mkdirSync(sdir, { recursive: true })
  const outs = []
  for (const t of stills) {
    const f = frameAt(Math.min(t, length - 0.05), path.join(work, `still-${t}.jpg`))
    await pg.evaluate((tt, a, b) => window.frame(tt, a, b), t, url(f), cutoutFor(t) ? url(cutoutFor(t)) : '')
    const o = path.join(sdir, `still-${String(t).padStart(5, '0')}.jpg`)
    fs.writeFileSync(o, await shot())
    outs.push(o)
  }
  await br.close()
  const sheet = path.join(sdir, 'stills.jpg')
  ff([...outs.flatMap((o) => ['-i', o]), '-filter_complex', outs.map((_, i) => `[${i}]scale=360:-1[s${i}]`).join(';') + ';' + outs.map((_, i) => `[s${i}]`).join('') + `hstack=inputs=${outs.length}`, sheet], { allowFail: outs.length < 2 })
  console.log(outs.length > 1 ? sheet : outs[0])
  process.exit(0)
}

const version = (() => {
  const have = fs.readdirSync(path.join(dir, 'out')).map((f) => /-v(\d{3})\.mp4$/.exec(f)).filter(Boolean).map((m) => +m[1])
  return String((have.length ? Math.max(...have) : 0) + 1).padStart(3, '0')
})()
const silent = path.join(work, `video-v${version}.mp4`)
const enc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', silent], { stdio: ['pipe', 'inherit', 'inherit'] })
const done = new Promise((r) => enc.on('close', r))

step(`drawing ${NF} frames`)
const CHUNK = 150
const t0 = Date.now()
for (let c = 0; c < NF; c += CHUNK) {
  const n = Math.min(CHUNK, NF - c)
  const fdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ay-frames-'))
  ff(['-ss', (c / FPS).toFixed(4), '-i', cutFile, '-frames:v', String(n), '-q:v', '2', path.join(fdir, '%05d.jpg')])
  for (let i = 0; i < n; i++) {
    const f = c + i, t = f / FPS
    const src = path.join(fdir, String(i + 1).padStart(5, '0') + '.jpg')
    const co = cutoutFor(t)
    await pg.evaluate((tt, a, b) => window.frame(tt, a, b), t, fs.existsSync(src) ? url(src) : '', co ? url(co) : '')
    const buf = await shot()
    if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r))
  }
  fs.rmSync(fdir, { recursive: true, force: true })
  const pct = Math.round(((c + n) / NF) * 100)
  console.log(`  ${pct}% · ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}
enc.stdin.end()
await done
await br.close()

/* ── 4 · Sound ────────────────────────────────────────── */
step('mixing sound')
const inputs = ['-i', cutFile]
const chains = ['[0:a]aformat=sample_rates=48000:channel_layouts=stereo[voice]']
const beds = []
let k = 1
if (Array.isArray(edit.sounds)) {
  /* v1: sounds the creator placed on the timeline, by source time, so they
     stay on the same moment when words are cut. */
  edit.sounds.forEach((snd) => {
    const sf = path.join(SKILL, 'sfx', snd.sound + '.wav')
    const t = map.toOut(snd.src)
    if (!fs.existsSync(sf) || t >= length - 0.05) return
    inputs.push('-i', sf)
    const ms = Math.max(0, Math.round(t * 1000))
    chains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${(0.5 * (snd.vol ?? 1)).toFixed(3)},adelay=${ms}|${ms}[s${k}]`)
    beds.push(`[s${k}]`); k++
  })
} else if (edit.sfx && edit.sfx !== 'none') {
  const sf = path.join(SKILL, 'sfx', edit.sfx + '.wav')
  if (fs.existsSync(sf)) {
    events.filter((e) => e.t < length - 0.2).forEach((e) => {
      inputs.push('-i', sf)
      const ms = Math.max(0, Math.round(e.t * 1000))
      chains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.35,adelay=${ms}|${ms}[s${k}]`)
      beds.push(`[s${k}]`); k++
    })
  }
}
if (edit.music && edit.music.file) {
  inputs.push('-stream_loop', '-1', '-i', path.resolve(dir, edit.music.file))
  chains.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${length.toFixed(3)},volume=${edit.music.volume ?? 0.25},afade=t=out:st=${Math.max(0, length - 1.5).toFixed(3)}:d=1.5[mraw]`)
  chains.push('[voice]asplit=2[voice][key]', '[mraw][key]sidechaincompress=threshold=0.05:ratio=6:attack=20:release=300[m]')
  beds.push('[m]'); k++
}
const all = ['[voice]', ...beds]
chains.push(`${all.join('')}amix=inputs=${all.length}:normalize=0:duration=first[mix]`)
const pre = path.join(work, `premix-v${version}.wav`), mix = path.join(work, `mix-v${version}.wav`)
ff([...inputs, '-filter_complex', chains.join(';'), '-map', '[mix]', '-ar', '48000', pre])
/* Two passes, so the finished file really lands on -14 LUFS. */
const LN = 'loudnorm=I=-14:TP=-1.2:LRA=11'
const meas = run('ffmpeg', ['-hide_banner', '-i', pre, '-af', LN + ':print_format=json', '-f', 'null', '-'], { allowFail: true }).stderr
const m = JSON.parse(meas.slice(meas.lastIndexOf('{'), meas.lastIndexOf('}') + 1))
ff(['-i', pre, '-af', `${LN}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`, '-ar', '48000', mix])
const final = path.join(dir, 'out', `${edit.name}-v${version}.mp4`)
ff(['-i', silent, '-i', mix, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', final])

/* ── Check ────────────────────────────────────────────── */
const p = probe(final)
const sheet = final.replace(/\.mp4$/, '-sheet.jpg')
ff(['-i', final, '-vf', `fps=${(12 / p.duration).toFixed(4)},scale=270:-1,tile=6x2`, '-frames:v', '1', sheet])
writeSrt()
console.log(`\nDone: ${final}`)
console.log(`${p.width}x${p.height} · ${p.duration.toFixed(1)} s · contact sheet ${sheet}`)
