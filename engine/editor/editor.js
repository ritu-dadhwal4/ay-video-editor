/*
 * AY Video Editor, v1: a guided editor for one talking-head take.
 *
 * Six steps, each one job done completely: Cut (pauses and mistakes),
 * Captions (style, highlight, theme), Hook (the opening title), Sounds
 * (drag onto the timeline), Thumbnail (the cover) and Export.
 *
 * One `edit` object (the project's edit.json) drives everything. Every change
 * goes through change(), which keeps undo history, redraws the preview and
 * the timeline, and saves to disk half a second later. Claude edits the same
 * file; when it changes on disk the page picks it up.
 *
 * The preview plays the creator's own take with the cut parts skipped and
 * draws captions and the hook with engine/render.js, the same code the final
 * render uses, so what they see is what they get.
 */
const A = window.AY, T = window.AYT
const $ = (id) => document.getElementById(id)
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const fmt1 = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const styleOf = (code) => { for (const g of A.groups) for (const it of g.items) if (it.code === code) return it; return null }
const soundOf = (id) => A.sounds.find((s) => s.id === id) || { id, name: id }
const STEPS = A.steps

/* Where files come from. The local editor (scripts/editor.mjs) serves them;
   the web demo on aboveyellow.com sets window.AY_WEB to its own static
   copies, and web.js answers the /api/ calls from this browser's storage. */
const WEB = window.AY_WEB || null
const PATH = {
  project: WEB ? WEB.project : '/p/',
  thumb: (n) => (WEB ? `${WEB.project}thumbs/${n}.jpg` : `/p/work/thumbs/${n}.jpg`),
  frame: (t, w) => (WEB ? WEB.frame(t, w) : `/api/frame?t=${(+t).toFixed(2)}&w=${w}`),
  sfx: WEB ? WEB.sfx : '/sfx/',
  vision: WEB ? WEB.vision : '/vision/',
  model: WEB ? WEB.model : '/models/selfie_segmenter.tflite',
}
/* What the web demo shows where the installed editor would save or render. */
const installCard = (what) => `<div class="box install"><b>${what} needs AY Video Editor on your computer</b><p class="sub">It's free. Paste this into Claude Code and it sets itself up, then edit and export your own videos.</p><code>${esc(WEB.install)}</code><div class="row"><button class="primary" data-copy>Copy the install prompt</button><a class="ghost" href="${WEB.home}#install">How it works</a></div></div>`
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]'); if (!b || !WEB) return
  navigator.clipboard?.writeText(WEB.install).then(() => toast('Copied. Paste it into Claude Code.'), () => toast('Select the text and copy it.'))
})

let edit, mtime = 0, thumbsN = 0, outputs = [], myKit = {}, projectName = ''
let P = null // T.project(edit): segs, map, length, fx, index, project
let step = 'cut', mode = 'cut', selSound = null
const past = [], future = []
let lastKey = '', lastAt = 0

/* ── Load, and bring older projects up to v1 ────────── */
async function load() {
  const r = await fetch('/api/edit').then((x) => x.json())
  edit = r.edit; mtime = r.mtime; thumbsN = r.thumbs; outputs = r.outputs || []; projectName = r.name
  myKit = await fetch('/api/kit').then((x) => x.json()).catch(() => ({}))
  ensureV1(edit)
}
function ensureV1(e) {
  const first = e.words.find((w) => !w.cut) || e.words[0]
  if (!e.captions) e.captions = { layout: 'phrase', highlight: 'marker', size: 1, case: 'normal' }
  if (!e.theme && !e.kit.colours) e.theme = 'classic'
  if (!e.hookFor) e.hookFor = 3
  if (!Array.isArray(e.sounds)) e.sounds = e.sfx && e.sfx !== 'none' && first ? [{ sound: e.sfx, src: Math.max(0, first.s - 0.05), vol: 1 }] : []
  if (!e.thumb) e.thumb = { src: first ? first.s + 1 : 1, text: [...e.hook], hook: e.picks.O || 'O1' }
  if (!e.progress) e.progress = {}
  e.fx = e.fx || []
  Object.assign(e.picks, { F: 'F1', M: e.picks.M === 'M2' || e.picks.M === 'M1' || e.picks.M === 'M3' ? 'M4' : e.picks.M || 'M4', G: 'G0' })
  if (!e.music) e.music = { file: null, volume: 0.25 }
}

/* ── Changes, undo, save ─────────────────────────────── */
function change(fn, opts = {}) {
  const now = Date.now()
  // Typing in one field is one undo step, not one per key.
  if (!(opts.key && opts.key === lastKey && now - lastAt < 1500)) {
    past.push(JSON.stringify(edit)); if (past.length > 150) past.shift()
    future.length = 0
  }
  lastKey = opts.key || ''; lastAt = now
  fn(edit)
  refresh(opts)
  save()
}
function undo() { if (!past.length) return; future.push(JSON.stringify(edit)); edit = JSON.parse(past.pop()); lastKey = ''; refresh(); save() }
function redo() { if (!future.length) return; past.push(JSON.stringify(edit)); edit = JSON.parse(future.pop()); lastKey = ''; refresh(); save() }

let saveTimer = null, saving = false, dirty = false
function save() {
  dirty = true
  $('saved').textContent = 'Saving…'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    saving = true
    try {
      const clean = JSON.parse(JSON.stringify(edit, (k, v) => (k === 'prevKept' ? undefined : v)))
      const r = await fetch('/api/edit', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clean) }).then((x) => x.json())
      if (r.mtime) mtime = r.mtime
      $('saved').textContent = r.ok ? 'All changes saved' : 'Not saved: ' + (r.error || 'error')
      if (r.ok) dirty = false
    } catch { $('saved').textContent = 'Not saved. Is the editor still running?' }
    saving = false
  }, 500)
}
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = '' } })

/* Claude may change edit.json while the page is open. */
setInterval(async () => {
  if (saving || dirty) return
  try {
    const { mtime: m } = await fetch('/api/mtime').then((x) => x.json())
    if (m > mtime + 5) {
      const r = await fetch('/api/edit').then((x) => x.json())
      past.push(JSON.stringify(edit)); edit = r.edit; ensureV1(edit); mtime = r.mtime; outputs = r.outputs || []
      refresh(); toast('Updated with Claude’s changes')
    }
  } catch {}
}, 2500)

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true }, 2600)
}

/* ── Preview ──────────────────────────────────────────── */
const video = document.createElement('video')
Object.assign(video, { preload: 'auto', playsInline: true })
const cutCanvas = Object.assign(document.createElement('canvas'), { width: 540, height: 960 })
let stage = null, segmenter = null

const stateOf = (e = edit) => ({
  picks: e.picks, kit: e.kit, entrance: e.entrance, caption: e.caption,
  captions: e.captions, hookFor: e.hookFor, fx: P ? P.fx : [], quote: e.quote,
})

function sizeStage() {
  const wrap = $('stageWrap'), el = $('stage')
  const hgt = Math.min(wrap.clientHeight, Math.round(wrap.clientWidth * 16 / 9))
  el.style.height = hgt + 'px'; el.style.width = Math.round(hgt * 9 / 16) + 'px'
}

async function initSegmenter() {
  try {
    const { FilesetResolver, ImageSegmenter } = await import(PATH.vision + 'vision_bundle.mjs')
    const files = await FilesetResolver.forVisionTasks(PATH.vision + 'wasm')
    segmenter = await ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: PATH.model, delegate: 'CPU' },
      runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false,
    })
  } catch (e) { console.warn('cut-out unavailable', e) }
}
const SW = 288, SH = 512
const small = Object.assign(document.createElement('canvas'), { width: SW, height: SH })
const sctx = small.getContext('2d', { willReadFrequently: true })
const maskC = Object.assign(document.createElement('canvas'), { width: SW, height: SH })
const mctx = maskC.getContext('2d')
let segTs = 0
/* The person cut out of `src` (video or image) into canvas `out`, for the
   "behind you" hook. Runs on this computer. */
function cutout(src, out) {
  if (!segmenter) return false
  sctx.drawImage(src, 0, 0, SW, SH)
  segTs = Math.max(segTs + 1, performance.now())
  const r = segmenter.segmentForVideo(small, segTs)
  const m = r.confidenceMasks[0].getAsFloat32Array()
  const img = mctx.createImageData(SW, SH)
  for (let i = 0; i < m.length; i++) img.data[i * 4 + 3] = Math.max(0, Math.min(255, (m[i] - 0.25) * 510))
  r.close()
  mctx.putImageData(img, 0, 0)
  const c = out.getContext('2d')
  c.globalCompositeOperation = 'copy'
  c.drawImage(maskC, 0, 0, out.width, out.height)
  c.globalCompositeOperation = 'source-in'
  c.drawImage(src, 0, 0, out.width, out.height)
  c.globalCompositeOperation = 'source-over'
  return true
}

function initPreview() {
  if (WEB) video.crossOrigin = 'anonymous' // the cut-out reads its pixels
  video.src = PATH.project + edit.source
  sizeStage()
  stage = AYR.mount($('stage'), stateOf(), { mediaEl: video, cutEl: cutCanvas, project: P.project, onNotes: (n) => { $('notes').textContent = n.join(' ') } })
  video.addEventListener('loadeddata', () => { if (video.currentTime === 0) video.currentTime = P.segs[0] ? P.segs[0][0] : 0 })
  $('play').onclick = togglePlay
  $('scrub').oninput = (e) => seekOut(+e.target.value)
  $('safeBtn').onchange = (e) => stage.showSafe(e.target.checked)
  new ResizeObserver(sizeStage).observe($('stageWrap'))
  requestAnimationFrame(tick)
}
function togglePlay() {
  audio() // first gesture unlocks sound
  if (video.paused) {
    if (P.map.playable(video.currentTime) == null) video.currentTime = P.segs[0][0]
    video.play()
  } else video.pause()
}
video.addEventListener('play', () => { $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', 'Pause'); musicSync(true) })
video.addEventListener('pause', () => { $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play'); musicSync(false) })
function seekOut(t) { video.currentTime = P.map.toSrc(Math.max(0, Math.min(P.length - 0.01, t))); lastOut = -1 }
function seekWord(i) { video.currentTime = Math.max(0, edit.words[i].s - 0.05); lastOut = -1 }

/* Sound preview: the placed sounds play as the playhead crosses them. */
let ac = null
const buffers = new Map()
function audio() { if (!ac) ac = new AudioContext(); if (ac.state === 'suspended') ac.resume(); return ac }
async function buffer(id) {
  if (!buffers.has(id)) buffers.set(id, fetch(`${PATH.sfx}${id}.wav`).then((r) => r.arrayBuffer()).then((b) => audio().decodeAudioData(b)).catch(() => null))
  return buffers.get(id)
}
async function playSound(id, vol = 1) {
  const b = await buffer(id); if (!b) return
  const s = audio().createBufferSource(), g = ac.createGain()
  g.gain.value = 0.7 * vol
  s.buffer = b; s.connect(g); g.connect(ac.destination); s.start()
}
const music = new Audio()
function musicSync(play) {
  const m = edit.music
  if (!m || !m.file) { music.pause(); return }
  const src = '/p/' + m.file
  if (!music.src.endsWith(encodeURI(m.file))) music.src = src
  music.volume = Math.min(1, m.volume ?? 0.25)
  if (play) { const out = P.map.toOut(video.currentTime); music.currentTime = music.duration ? out % music.duration : out; music.play().catch(() => {}) }
  else music.pause()
}

let lastSrc = -1, lastWord = -1, lastOut = -1
function tick() {
  const src = video.currentTime
  if (!video.paused) {
    const p = P.map.playable(src)
    if (p == null) { video.pause(); video.currentTime = P.segs[0][0]; lastOut = -1 }
    else if (p - src > 0.03) video.currentTime = p
  }
  const out = P.map.toOut(video.currentTime)
  if (!video.paused && lastOut >= 0 && out > lastOut && out - lastOut < 0.5) {
    for (const s of edit.sounds) { const t = P.map.toOut(s.src); if (t > lastOut && t <= out) playSound(s.sound, s.vol ?? 1) }
  }
  lastOut = out
  if (stage.needsCutout && video.readyState >= 2 && src !== lastSrc) cutout(video, cutCanvas)
  lastSrc = src
  stage.at(out)
  $('scrub').max = P.length.toFixed(2); $('scrub').value = out
  $('tm').textContent = `${fmt(out)} / ${fmt(P.length)}`
  const ph = $('playhead'); if (ph) ph.style.left = X(out) + 'px'
  if (!video.paused) followPlayhead(out)
  let wi = -1
  for (let i = 0; i < edit.words.length; i++) { const w = edit.words[i]; if (src >= w.s - 0.02 && src < w.e + 0.05) { wi = i; break } }
  if (wi !== lastWord) {
    document.querySelector('.w.now')?.classList.remove('now')
    if (wi >= 0) document.querySelector(`.w[data-i="${wi}"]`)?.classList.add('now')
    lastWord = wi
  }
  smallTick()
  requestAnimationFrame(tick)
}

/* ── Small stages: hook cards and the thumbnail ──────── */
let stillUrl = '', cutStill = ''
const smalls = []
function smallStage(el, stFn, opts = {}) {
  const s = AYR.mount(el, stFn(), { media: 'still', still: opts.still || stillUrl, cutStill: opts.cutStill ?? cutStill, project: P.project, single: true })
  const rec = { el, s, stFn, fixed: opts.fixed }
  smalls.push(rec)
  return rec
}
function clearSmalls() { smalls.length = 0 }
function smallTick() {
  const loop = (edit.hookFor || 3) + 0.9
  const t = (performance.now() / 1000) % loop
  smalls.forEach((r) => { if (r.el.isConnected) r.s.at(r.fixed ?? t) })
}
async function stillFor(srcT, w = 540) {
  const url = PATH.frame(srcT, w)
  const img = new Image()
  if (WEB) img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode().catch(() => {})
  let cut = ''
  if (segmenter && img.naturalWidth) {
    const c = Object.assign(document.createElement('canvas'), { width: 540, height: 960 })
    cutout(img, c); cut = c.toDataURL('image/png')
  }
  return { url, cut }
}
async function makeStill() {
  const r = await stillFor(P.segs.length ? P.segs[0][0] + 1.2 : 1)
  stillUrl = r.url; cutStill = r.cut
}

/* ── Refresh after any change ───────────────────────── */
function refresh(opts = {}) {
  P = T.project(edit)
  if (!P.segs.length) { toast('Everything is cut. Bring some words back.'); return }
  stage.setProject(P.project)
  stage.set(stateOf())
  smalls.forEach((r) => { if (r.el.isConnected) r.s.set(r.stFn()) })
  $('undo').disabled = !past.length; $('redo').disabled = !future.length
  drawRail()
  drawTimeline()
  if (!opts.keepPanel) drawPanel()
}

/* ── Steps ────────────────────────────────────────────── */
function drawRail() {
  const r = $('rail')
  r.innerHTML = STEPS.map((s, i) => `<button data-step="${s.id}" class="${edit.progress[s.id] ? 'done' : ''}" ${s.id === step ? 'aria-current="step"' : ''}><span class="n">${edit.progress[s.id] && s.id !== step ? '✓' : i + 1}</span><b>${s.name}</b><small>${s.does}</small></button>`).join('') +
    (WEB ? `<p class="foot">This is a demo on a sample reel. Your changes stay in this browser. <button class="ghost sm" data-reset style="margin-top:8px">Start over</button></p>` : `<p class="foot">Everything saves as you go. Claude can help: just ask it in your chat.</p>`)
  r.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => go(b.dataset.step)))
  r.querySelector('[data-reset]')?.addEventListener('click', () => WEB.reset())
}
function go(s) {
  step = s
  drawRail()
  drawPanel()
  $('panel').scrollTop = 0
}
function drawPanel() {
  clearSmalls()
  const p = $('panel')
  const sc = p.scrollTop
  p.textContent = ''
  const i = STEPS.findIndex((x) => x.id === step)
  const meta = PANELS[step]
  p.append(h(`<div class="step-h"><span class="of">Step ${i + 1} of ${STEPS.length}</span><h1>${meta.title}</h1><p>${meta.lede}</p></div>`))
  const content = h('<div class="content"></div>')
  p.append(content)
  meta.draw(content)
  const nx = STEPS[i + 1], pv = STEPS[i - 1]
  const bar = h(`<div class="next">${pv ? `<button class="ghost" data-go="${pv.id}">← ${pv.name}</button>` : ''}<span class="sp"></span>${nx ? `<button class="primary lg" data-next="${nx.id}">Next: ${nx.name} →</button>` : ''}</div>`)
  bar.querySelector('[data-go]')?.addEventListener('click', (e) => go(e.currentTarget.dataset.go))
  bar.querySelector('[data-next]')?.addEventListener('click', (e) => {
    const to = e.currentTarget.dataset.next
    change((d) => { d.progress[step] = true }, { keepPanel: true })
    go(to)
  })
  p.append(bar)
  p.scrollTop = sc
}

/* Shared transcript: Cut uses ✂ and ✎; Captions uses ★, ↵ and ✎. */
function transcript(host, modes, hints) {
  if (!modes.includes(mode)) mode = modes[0]
  const LABEL = { cut: '✂ Cut', key: '★ Highlight word', br: '↵ New line', fix: '✎ Fix a word' }
  const tools = h(`<div class="tools"><div class="chips">${modes.map((m) => `<button data-m="${m}">${LABEL[m]}</button>`).join('')}</div><span class="hint" id="modeHint"></span></div>`)
  host.append(tools)
  const setMode = (m) => { mode = m; tools.querySelectorAll('[data-m]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.m === m)); tools.querySelector('#modeHint').textContent = hints[m] }
  tools.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => setMode(b.dataset.m)))
  setMode(mode)

  const words = edit.words
  const script = h(`<div class="script${modes.includes('key') ? '' : ' plain'}"></div>`)
  let line = null
  words.forEach((w, i) => {
    if (w.br || !line) {
      line = h(`<div class="line"><button class="at" title="Play from here">${fmt1(w.s)}</button><div class="ws"></div></div>`)
      line.querySelector('.at').onclick = () => { seekWord(i); togglePlay() }
      script.append(line)
    }
    const span = h(`<span class="w${w.cut ? ' cut' : ''}${w.key ? ' key' : ''}" data-i="${i}">${esc(w.w)}${w.cut && w.why && w.why !== 'you' ? `<span class="why">${w.why}</span>` : ''}</span>`)
    line.querySelector('.ws').append(span, document.createTextNode(' '))
  })
  host.append(script)

  let anchor = null, target = null
  const range = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k) }
  const mark = (ids) => { script.querySelectorAll('.w.sel').forEach((x) => x.classList.remove('sel')); ids.forEach((i) => script.querySelector(`.w[data-i="${i}"]`)?.classList.add('sel')) }
  script.onmousedown = (e) => {
    const el = e.target.closest('.w'); if (!el) return
    const i = +el.dataset.i
    if (mode === 'cut') { anchor = i; target = !words[i].cut; mark([i]); e.preventDefault() }
    else if (mode === 'key') change((d) => { const was = d.words[i].key; let a = i; while (a > 0 && !d.words[a].br) a--; let b = i + 1; while (b < d.words.length && !d.words[b].br) b++; for (let k = a; k < b; k++) delete d.words[k].key; if (!was) d.words[i].key = true })
    else if (mode === 'br') { if (i > 0) change((d) => { d.words[i].br = !d.words[i].br }) }
    else if (mode === 'fix') {
      const inp = h(`<input type="text" value="${esc(words[i].w)}" aria-label="Correct word">`)
      el.replaceChildren(inp); inp.focus(); inp.select()
      let done = false
      const finish = (ok) => { if (done) return; done = true; if (ok && inp.value.trim() && inp.value.trim() !== words[i].w) change((d) => { d.words[i].w = inp.value.trim() }); else drawPanel() }
      inp.onkeydown = (k) => { if (k.key === 'Enter') finish(true); if (k.key === 'Escape') finish(false) }
      inp.onblur = () => finish(true)
    }
  }
  script.onmouseover = (e) => { if (anchor == null) return; const el = e.target.closest('.w'); if (el) mark(range(anchor, +el.dataset.i)) }
  window.onmouseup = (e) => {
    if (anchor == null) return
    const el = e.target.closest && e.target.closest('.w')
    const ids = range(anchor, el ? +el.dataset.i : anchor)
    anchor = null
    change((d) => ids.forEach((i) => { d.words[i].cut = target; if (target) d.words[i].why = 'you'; else delete d.words[i].why }))
  }
}

const PANELS = {}

/* 1 · Cut */
PANELS.cut = {
  title: 'Take out the pauses and mistakes',
  lede: 'AY already removed long pauses, retakes and filler words. Play it, then click any word to cut it, or click a crossed-out word to bring it back.',
  draw(c) {
    const cut = edit.words.filter((w) => w.cut)
    const by = (k) => cut.filter((w) => w.why === k).length
    c.append(h(`<div class="stats sec">
      <div class="stat"><span>Your take</span><b>${fmt1(edit.duration)}</b></div>
      <div class="stat"><span>After the cut</span><b>${fmt1(P.length)}</b></div>
      <div class="stat"><span>Taken out</span><b>${(edit.duration - P.length).toFixed(1)} s</b></div>
      <div class="stat"><span>Words cut</span><b>${cut.length}</b></div></div>`))
    if (cut.length) c.append(h(`<p class="hint" style="margin-top:8px">${[['retake', 'retakes'], ['filler', 'filler words'], ['repeat', 'doubled words'], ['you', 'cut by you']].map(([k, n]) => by(k) ? `${by(k)} ${n}` : '').filter(Boolean).join(' · ')}</p>`))
    const mp = edit.maxPause ?? 0.35
    const pause = h(`<div class="sec box"><span class="lbl">How tight</span>
      <div class="row"><span class="sub">Natural</span><input type="range" id="maxPause" min="0.15" max="1" step="0.05" value="${1.15 - mp}" style="flex:1;max-width:320px"><span class="sub">Very tight</span></div>
      <p class="hint" id="mpLbl" style="margin-top:6px"></p></div>`)
    c.append(pause)
    const lbl = () => { $('mpLbl').textContent = `Pauses longer than ${(1.15 - $('maxPause').value).toFixed(2)} s are taken out.` }
    lbl()
    $('maxPause').oninput = (e) => { lbl(); change((d) => { d.maxPause = +(1.15 - e.target.value).toFixed(2) }, { key: 'maxPause' }) }
    const sec = h('<div class="sec"></div>')
    c.append(sec)
    transcript(sec, ['cut', 'fix'], { cut: 'Click a word, or drag across several, to cut them.', fix: 'Click a word that was heard wrong and type the right one.' })
    if (cut.length) { const b = h(`<button class="ghost sm" style="margin-top:12px">Bring back every word</button>`); b.onclick = () => change((d) => d.words.forEach((w) => { w.cut = false; delete w.why })); c.append(b) }
  },
}

/* 2 · Captions */
const SAMPLE = ['Skim', 'in', '6 sec']
function sampleHTML(hl, col) {
  const acc = col.accent, on = inkOn(acc)
  return SAMPLE.map((w, i) => {
    const key = i === 2, cur = i === 0
    if (hl === 'box' && cur) return `<span style="background:${acc};color:${on}">${w}</span>`
    if (!key) return `<span style="color:${col.caption}">${w}</span>`
    if (hl === 'marker') return `<span style="background:${acc};color:${on}">${w}</span>`
    if (hl === 'color') return `<span style="color:${acc}">${w}</span>`
    if (hl === 'underline') return `<span style="color:${col.caption};box-shadow:inset 0 -2px 0 ${acc}">${w}</span>`
    return `<span style="color:${col.caption}">${w}</span>`
  }).join(' ')
}
function inkOn(hex) { const n = parseInt(String(hex).slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150 ? '#0A0A0A' : '#FFFFFF' }
function themeGrid(host) {
  const g = h(`<div class="themes"></div>`)
  A.themes.forEach((t) => {
    const b = h(`<button class="theme" aria-pressed="${edit.theme === t.id}"><span class="sw"><span style="color:${t.colours.caption}">Your</span><span style="background:${t.colours.accent};color:${inkOn(t.colours.accent)}">words</span></span><b>${t.name}</b></button>`)
    b.onclick = () => change((d) => { d.theme = t.id; d.kit.colours = { ...t.colours } })
    g.append(b)
  })
  host.append(g)
}
function fontButtons(key, lists) {
  return lists.flatMap((l) => A.fonts[l]).map((f) => `<button data-k="${key}" data-v="${esc(f.name)}" aria-pressed="${edit.kit[key] === f.name}" style="font-family:'${f.name}';${f.italic ? 'font-style:italic;' : ''}">${esc(f.name)}<small>${f.note}</small></button>`).join('')
}
PANELS.captions = {
  title: 'Style your captions',
  lede: 'Captions appear word for word as you speak, never over your face. Pick how they look, then choose the highlighted word in each line.',
  draw(c) {
    const cap = edit.captions, col = edit.kit.colours
    const on = cap.on !== false
    const tog = h(`<label class="check"><input type="checkbox" ${on ? 'checked' : ''}> Show captions</label>`)
    tog.querySelector('input').onchange = (e) => change((d) => { d.captions.on = e.target.checked })
    c.append(tog)
    if (!on) return

    const lay = h(`<div class="sec"><span class="lbl">Layout</span><div class="opts"></div></div>`)
    A.captionLayouts.forEach((l) => {
      const words = l.id === 'word' ? `<span style="color:${col.caption};font-size:18px">SKIM</span>` : l.id === 'phrase' ? `<span style="color:${col.caption}">Recruiters skim</span><span style="color:${col.caption};opacity:.25">in 6</span>` : `<span style="color:${col.caption}">Recruiters skim in 6 seconds</span>`
      const b = h(`<button class="opt" aria-pressed="${cap.layout === l.id}"><span class="sample">${words}</span><b>${l.name}</b><small>${l.note}</small></button>`)
      b.onclick = () => change((d) => { d.captions.layout = l.id })
      lay.querySelector('.opts').append(b)
    })
    c.append(lay)

    const hl = h(`<div class="sec"><span class="lbl">Highlight</span><div class="opts"></div></div>`)
    A.highlights.forEach((x) => {
      const b = h(`<button class="opt" aria-pressed="${cap.highlight === x.id}"><span class="sample">${sampleHTML(x.id, col)}</span><b>${x.name}</b><small>${x.note}</small></button>`)
      b.onclick = () => change((d) => { d.captions.highlight = x.id })
      hl.querySelector('.opts').append(b)
    })
    c.append(hl)

    const th = h(`<div class="sec"><span class="lbl">Colour theme <span class="sub" style="text-transform:none;letter-spacing:0;font-weight:400">· also used for your hook and thumbnail</span></span></div>`)
    themeGrid(th)
    c.append(th)

    const more = h(`<div class="sec cols">
      <div><span class="lbl">Font</span><div class="fonts" data-fonts>${fontButtons('captionFont', ['sans', 'hand'])}</div></div>
      <div>
        <span class="lbl">Size</span><div class="row"><input type="range" id="capSize" min="0.7" max="1.4" step="0.05" value="${cap.size || 1}" style="width:200px"><span class="sub" id="capSizeL">${Math.round((cap.size || 1) * 100)}%</span></div>
        <span class="lbl" style="margin-top:16px">Letters</span><div class="chips" data-case>${A.captionCases.map((x) => `<button data-v="${x.id}" aria-pressed="${(cap.case || 'normal') === x.id}">${x.name}</button>`).join('')}</div>
        <span class="lbl" style="margin-top:16px">Position</span><div class="chips" data-pos>${A.captionPositions.map((x) => `<button data-v="${x.id}" aria-pressed="${edit.caption === x.id}">${x.name}</button>`).join('')}</div>
      </div></div>`)
    more.querySelector('[data-fonts]').onclick = (e) => { const b = e.target.closest('button'); if (b) change((d) => { d.kit.captionFont = b.dataset.v }) }
    more.querySelector('[data-case]').onclick = (e) => { const b = e.target.closest('button'); if (b) change((d) => { d.captions.case = b.dataset.v }) }
    more.querySelector('[data-pos]').onclick = (e) => { const b = e.target.closest('button'); if (b) change((d) => { d.caption = b.dataset.v }) }
    more.querySelector('#capSize').oninput = (e) => { $('capSizeL').textContent = Math.round(e.target.value * 100) + '%'; change((d) => { d.captions.size = +e.target.value }, { key: 'capSize', keepPanel: true }) }
    c.append(more)

    const def = h(`<div class="sec row"><button class="ghost">Use these caption settings for every new video</button><span class="hint" id="defL"></span></div>`)
    def.querySelector('button').onclick = () => saveDefaults('Caption settings saved for your next videos')
    c.append(def)

    const words = h(`<div class="sec"><span class="lbl">Highlighted words and lines</span><p class="sub">Each line highlights one word. Click a word to make it the highlighted one, or start a new caption line.</p></div>`)
    c.append(words)
    transcript(words, ['key', 'br', 'fix'], { key: 'Click the word to highlight in its line. Click it again to remove the highlight.', br: 'Click a word to start a new caption line there.', fix: 'Click a word that was heard wrong and type the right one.' })
  },
}
async function saveDefaults(msg) {
  myKit = { ...myKit, v1: { captions: { ...edit.captions }, theme: edit.theme, caption: edit.caption, captionFont: edit.kit.captionFont, titleFont: edit.kit.titleFont, titleFont2: edit.kit.titleFont2, hook: edit.picks.O } }
  await fetch('/api/kit', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(myKit) })
  toast(msg)
}

/* 3 · Hook */
PANELS.hook = {
  title: 'Add a hook',
  lede: 'The title on screen for the first seconds, while you say your opening line. It is what makes people stop scrolling, so keep it short.',
  draw(c) {
    const on = !!edit.picks.O
    const tog = h(`<label class="check"><input type="checkbox" ${on ? 'checked' : ''}> Show a hook at the start</label>`)
    tog.querySelector('input').onchange = (e) => change((d) => { d.picks.O = e.target.checked ? (d.thumb?.hook || 'O1') : null })
    c.append(tog)
    if (!on) return
    const txt = h(`<div class="sec"><span class="lbl">Hook text · two short lines</span><div class="cols" style="gap:10px"><input type="text" id="h0" value="${esc(edit.hook[0])}" maxlength="40" aria-label="First line"><input type="text" id="h1" value="${esc(edit.hook[1] || '')}" maxlength="40" aria-label="Second line"></div><p class="hint" style="margin-top:6px">Under 6 words a line reads best.</p></div>`)
    txt.querySelector('#h0').oninput = (e) => change((d) => { d.hook[0] = e.target.value }, { key: 'h0', keepPanel: true })
    txt.querySelector('#h1').oninput = (e) => change((d) => { d.hook[1] = e.target.value }, { key: 'h1', keepPanel: true })
    c.append(txt)

    const tpl = h(`<div class="sec"><span class="lbl">Template</span><div class="cards"></div></div>`)
    A.hooks.forEach((code) => {
      const it = styleOf(code)
      const b = h(`<button class="card" aria-pressed="${edit.picks.O === code}" title="${esc(it.what)}"><div class="ayr-stage"></div><b>${esc(it.name)}</b></button>`)
      b.onclick = () => change((d) => { d.picks.O = code })
      tpl.querySelector('.cards').append(b)
      smallStage(b.querySelector('.ayr-stage'), () => ({ ...stateOf(), picks: { O: code, G: 'G0' }, captions: { on: false }, fx: [] }))
    })
    c.append(tpl)

    const opts = h(`<div class="sec cols">
      <div><span class="lbl">How long it stays</span><div class="row"><input type="range" id="hf" min="2" max="5" step="0.5" value="${edit.hookFor}" style="width:200px"><span class="sub" id="hfL">${edit.hookFor} s</span></div>
        <span class="lbl" style="margin-top:16px">How it comes in</span><div class="chips" data-ent>${A.entrances.map((x) => `<button data-v="${x.id}" aria-pressed="${edit.entrance === x.id}">${x.name}</button>`).join('')}</div></div>
      <div><span class="lbl">Colours</span><p class="sub">From your theme: <b>${esc((A.themes.find((t) => t.id === edit.theme) || { name: 'custom' }).name)}</b>. Change it in Captions.</p></div>
      <div><span class="lbl">Main font</span><div class="fonts" data-f="titleFont">${fontButtons('titleFont', ['serif', 'hand'])}</div></div>
      <div><span class="lbl">Bold line font</span><div class="fonts" data-f="titleFont2">${fontButtons('titleFont2', ['sans'])}</div></div>
    </div>`)
    opts.querySelector('#hf').oninput = (e) => { $('hfL').textContent = e.target.value + ' s'; change((d) => { d.hookFor = +e.target.value }, { key: 'hf', keepPanel: true }) }
    opts.querySelector('[data-ent]').onclick = (e) => { const b = e.target.closest('button'); if (b) change((d) => { d.entrance = b.dataset.v }) }
    opts.querySelectorAll('[data-f]').forEach((box) => (box.onclick = (e) => { const b = e.target.closest('button'); if (b) change((d) => { d.kit[b.dataset.k] = b.dataset.v }) }))
    c.append(opts)
  },
}

/* 4 · Sounds */
PANELS.sounds = {
  title: 'Add sounds',
  lede: 'Drag a sound onto the Sounds row of the timeline, right where you want it. Or press + to drop it at the playhead. Sounds always sit under your voice.',
  draw(c) {
    const placed = h(`<div class="sec"><span class="lbl">In your video (${edit.sounds.length})</span><div class="placed"></div></div>`)
    const list = placed.querySelector('.placed')
    if (!edit.sounds.length) list.append(h(`<p class="sub">No sounds yet. A pop when the hook appears is a good start.</p>`))
    edit.sounds.map((s, n) => ({ s, n, t: P.map.toOut(s.src) })).sort((a, b) => a.t - b.t).forEach(({ s, n, t }) => {
      const row = h(`<div class="pl${selSound === n ? ' sel' : ''}"><button class="ghost sm" data-a="play" aria-label="Play ${esc(soundOf(s.sound).name)}">▶</button><b>${esc(soundOf(s.sound).name)}</b><button class="t" data-a="go" title="Jump there">${fmt1(t)}</button><input type="range" min="0.1" max="1.5" step="0.05" value="${s.vol ?? 1}" aria-label="Volume"><button class="ghost sm" data-a="del">Remove</button></div>`)
      row.onclick = (e) => {
        const a = e.target.dataset.a
        if (a === 'play') playSound(s.sound, s.vol ?? 1)
        if (a === 'go') { seekOut(Math.max(0, t - 0.5)); selSound = n; drawTimeline() }
        if (a === 'del') { selSound = null; change((d) => d.sounds.splice(n, 1)) }
      }
      row.querySelector('input').oninput = (e) => change((d) => { d.sounds[n].vol = +e.target.value }, { key: 'vol' + n, keepPanel: true })
      list.append(row)
    })
    c.append(placed)

    const lib = h(`<div class="sec"><span class="lbl">Sound library</span></div>`)
    const cats = [...new Set(A.sounds.map((s) => s.cat))]
    cats.forEach((cat) => {
      lib.append(h(`<p class="cat">${cat}</p>`))
      const g = h(`<div class="lib"></div>`)
      A.sounds.filter((s) => s.cat === cat).forEach((s) => {
        const t = h(`<div class="snd" draggable="true" title="Drag onto the timeline"><button class="play" aria-label="Play ${esc(s.name)}">▶</button>${esc(s.name)}<button class="add" aria-label="Add ${esc(s.name)} at the playhead">+</button></div>`)
        t.ondragstart = (e) => { e.dataTransfer.setData('text/ay-sound', s.id); e.dataTransfer.effectAllowed = 'copy'; document.querySelector('.trow[data-lane=sounds]')?.classList.add('drop') }
        t.ondragend = () => document.querySelector('.trow[data-lane=sounds]')?.classList.remove('drop')
        t.querySelector('.play').onclick = () => playSound(s.id)
        t.querySelector('.add').onclick = () => addSound(s.id, P.map.toOut(video.currentTime))
        g.append(t)
      })
      lib.append(g)
    })
    c.append(lib)

    const m = edit.music
    const mus = h(`<div class="sec box"><span class="lbl">Music</span><p class="sub">Add a track you own the rights to. It plays quietly under your voice, dips when you talk and fades out at the end.</p>
      <div class="row" style="margin-top:10px">${WEB ? '<span class="hint">Adding music works in the editor on your computer.</span>' : m.file ? `<b>${esc(m.file.replace(/^assets\//, ''))}</b><button class="ghost sm" data-a="rm">Remove</button>` : `<label class="ghost" style="cursor:pointer">Choose a music file<input type="file" accept="audio/*" hidden></label><span class="hint">MP3, M4A or WAV, up to ${Math.round(A.limits.musicMaxBytes / 1024 / 1024)} MB</span>`}</div>
      ${m.file ? `<div class="row" style="margin-top:12px"><span class="sub">Volume</span><input type="range" min="0.05" max="0.6" step="0.01" value="${m.volume ?? 0.25}" style="width:200px"><span class="sub" id="mvL">${Math.round((m.volume ?? 0.25) * 100)}%</span></div>` : ''}</div>`)
    mus.querySelector('input[type=file]')?.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return
      if (f.size > A.limits.musicMaxBytes) return toast(`That file is over ${Math.round(A.limits.musicMaxBytes / 1024 / 1024)} MB.`)
      const r = await fetch('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: f }).then((x) => x.json())
      if (r.error) return toast(r.error)
      change((d) => { d.music = { file: r.path, volume: d.music.volume ?? 0.25 } })
    })
    mus.querySelector('[data-a=rm]')?.addEventListener('click', () => change((d) => { d.music = { file: null, volume: d.music.volume } }))
    mus.querySelector('input[type=range]')?.addEventListener('input', (e) => { $('mvL').textContent = Math.round(e.target.value * 100) + '%'; music.volume = +e.target.value; change((d) => { d.music.volume = +e.target.value }, { key: 'mv', keepPanel: true }) })
    c.append(mus)
  },
}
function addSound(id, out) {
  const src = +P.map.toSrc(Math.max(0, Math.min(P.length - 0.05, out))).toFixed(3)
  playSound(id)
  change((d) => { d.sounds.push({ sound: id, src, vol: 1 }); selSound = d.sounds.length - 1 })
  toast(`${soundOf(id).name} added at ${fmt1(out)}`)
}

/* 5 · Thumbnail */
PANELS.thumbnail = {
  title: 'Make the thumbnail',
  lede: 'The cover people see on your profile. Pick a frame where your face looks good, add a few words, and save it.',
  draw(c) {
    const th = edit.thumb
    const wrap = h(`<div class="thumb-wrap"><div><div class="ayr-stage" id="thumbStage"></div><p class="hint" style="margin-top:8px">How it looks in your profile grid:</p><div class="gridcrop" id="gridcrop"></div></div><div id="thumbOpts"></div></div>`)
    c.append(wrap)
    const o = wrap.querySelector('#thumbOpts')
    const n = Math.max(1, thumbsN)
    o.append(h(`<div><span class="lbl">Frame</span><div class="frames" id="frames">${Array.from({ length: n }, (_, k) => `<button data-t="${k + 0.5}" aria-pressed="${Math.floor(th.src) === k}" style="background-image:url(${PATH.thumb(String(k + 1).padStart(4, '0'))})" aria-label="Frame at ${k} seconds"></button>`).join('')}</div>
      <div class="row" style="margin-top:6px"><span class="sub">Fine-tune</span><input type="range" id="tFine" min="0" max="${edit.duration.toFixed(2)}" step="0.04" value="${th.src}" style="flex:1"></div></div>`))
    o.append(h(`<div class="sec"><span class="lbl">Words on the cover</span><div class="cols" style="gap:10px"><input type="text" id="t0" value="${esc(th.text[0] || '')}" maxlength="40" aria-label="First line"><input type="text" id="t1" value="${esc(th.text[1] || '')}" maxlength="40" aria-label="Second line"></div><button class="ghost sm" id="useHook" style="margin-top:8px">Use my hook text</button></div>`))
    const tpl = h(`<div class="sec"><span class="lbl">Style</span><div class="chips">${A.hooks.filter((x) => x !== 'O4').map((code) => `<button data-v="${code}" aria-pressed="${th.hook === code}">${esc(styleOf(code).name)}</button>`).join('')}</div><p class="hint" style="margin-top:6px">Colours come from your theme.</p></div>`)
    o.append(tpl)
    const make = WEB ? h(`<div class="sec">${installCard('Saving the thumbnail')}</div>`) : h(`<div class="sec row"><button class="primary lg" id="makeThumb">Save thumbnail</button><span class="hint" id="thumbState"></span></div>`)
    o.append(make)
    const have = outputs.find((x) => /-thumbnail\.jpg$/.test(x.name))
    if (have) o.append(h(`<div class="sec row"><a class="ghost" href="/dl/${encodeURIComponent(have.name)}">Download thumbnail</a><button class="ghost" data-reveal="out/${esc(have.name)}">Show in Finder</button></div>`))

    // Live preview: the chosen frame with the cover text drawn on it.
    let rec = null
    const draw = async () => {
      const s = await stillFor(edit.thumb.src)
      const proj = { ...P.project, hook: edit.thumb.text.some(Boolean) ? edit.thumb.text : edit.hook }
      const st = () => ({ ...stateOf(), picks: { O: edit.thumb.hook || 'O1', G: 'G0' }, captions: { on: false }, fx: [], entrance: 'cut', hookFor: 99 })
      const el = $('thumbStage'); if (!el) return
      rec = smallStage(el, st, { still: s.url, cutStill: s.cut, fixed: 1.6 })
      rec.s.setProject(proj); rec.s.set(st())
      rec.s.at(1.6)
      // The grid crop shows the saved cover; save it to see the latest.
      const saved = outputs.find((x) => /-thumbnail\.jpg$/.test(x.name))
      const gc = $('gridcrop'); if (gc) gc.innerHTML = saved ? `<img src="/p/out/${encodeURIComponent(saved.name)}?v=${saved.at}" alt="">` : '<span class="hint" style="color:#fff;padding:8px;display:block">Save the thumbnail to see it here</span>'
    }
    draw()
    o.querySelector('#frames').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) change((d) => { d.thumb.src = +b.dataset.t }) }
    o.querySelector('#tFine').onchange = (e) => change((d) => { d.thumb.src = +e.target.value })
    o.querySelector('#t0').oninput = (e) => change((d) => { d.thumb.text[0] = e.target.value }, { key: 't0', keepPanel: true })
    o.querySelector('#t1').oninput = (e) => change((d) => { d.thumb.text[1] = e.target.value }, { key: 't1', keepPanel: true })
    o.querySelector('#t0').onchange = o.querySelector('#t1').onchange = () => drawPanel()
    o.querySelector('#useHook').onclick = () => change((d) => { d.thumb.text = [...d.hook] })
    tpl.onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) change((d) => { d.thumb.hook = b.dataset.v }) }
    o.querySelector('#makeThumb')?.addEventListener('click', () => runJob({ kind: 'thumb' }))
  },
}

/* 6 · Export */
PANELS.export = {
  title: 'Export your reel',
  lede: 'Check a few frames first if you like, then export. You get the video, a captions file for YouTube, and your thumbnail.',
  draw(c) {
    const theme = (A.themes.find((t) => t.id === edit.theme) || { name: 'custom' }).name
    const cap = edit.captions
    c.append(h(`<div class="box summary">
      <div><span>Length</span><span>${fmt1(P.length)} <span class="sub">(from ${fmt1(edit.duration)})</span></span></div>
      <div><span>Captions</span><span>${cap.on === false ? 'Off' : `${A.captionLayouts.find((x) => x.id === cap.layout).name} · ${A.highlights.find((x) => x.id === cap.highlight).name} · ${theme}`}</span></div>
      <div><span>Hook</span><span>${edit.picks.O ? `${esc(edit.hook.filter(Boolean).join(' / '))} <span class="sub">· ${esc(styleOf(edit.picks.O).name)}, ${edit.hookFor} s</span>` : 'None'}</span></div>
      <div><span>Sounds</span><span>${edit.sounds.length} placed${edit.music.file ? ' · music' : ''}</span></div>
      <div><span>Thumbnail</span><span>${outputs.some((x) => /-thumbnail\.jpg$/.test(x.name)) ? '<span class="ok">Saved</span>' : 'Not made yet (Thumbnail step)'}</span></div>
    </div>`))
    if (WEB) { c.append(h(`<div class="sec">${installCard('Exporting your video')}</div>`)); return }
    c.append(h(`<div class="sec row"><button class="primary lg" id="expBtn">Export video</button><button class="ghost" id="stillsBtn">Check a few frames first</button><span class="hint">Takes about 1 to 2 minutes per 30 seconds of video.</span></div>`))
    $('expBtn').onclick = () => runJob({})
    $('stillsBtn').onclick = () => runJob({ stills: stillTimes() })
    c.append(h(`<div class="sec" id="jobBox"></div>`))
    drawJob()
    const files = outputs.slice().sort((a, b) => b.at - a.at)
    if (files.length) {
      const f = h(`<div class="sec"><span class="lbl">Your files</span><div class="files"></div><p class="hint" style="margin-top:8px">Saved in your project’s <b>out</b> folder.</p></div>`)
      files.forEach((x) => f.querySelector('.files').append(h(`<div class="row"><span style="min-width:220px">${esc(x.name)}</span><a class="ghost sm" href="/dl/${encodeURIComponent(x.name)}">Download</a><button class="ghost sm" data-reveal="out/${esc(x.name)}">Show in Finder</button></div>`)))
      c.append(f)
    }
  },
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-reveal]')
  if (b) fetch('/api/reveal?file=' + encodeURIComponent(b.dataset.reveal), { method: 'POST' })
})

/* ── Jobs: stills, thumbnail, video ─────────────────── */
let jobState = null, poll = null
function stillTimes() {
  const ts = [Math.min(1.2, P.length / 4), (edit.hookFor || 3) + 1, P.length * 0.45, P.length * 0.75]
  return [...new Set(ts.map((t) => +Math.min(P.length - 0.1, t).toFixed(2)))].sort((a, b) => a - b)
}
async function runJob(body) {
  const r = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json())
  if (r.error) return toast(r.error)
  jobState = { kind: body.stills ? 'stills' : body.kind || 'video', log: [], done: false }
  drawJob()
  clearInterval(poll)
  poll = setInterval(async () => {
    jobState = await fetch('/api/job').then((x) => x.json())
    drawJob()
    if (jobState && jobState.done) {
      clearInterval(poll)
      const e = await fetch('/api/edit').then((x) => x.json()); outputs = e.outputs || []
      if (jobState.ok) toast({ stills: 'Frames ready', thumb: 'Thumbnail saved', video: 'Your video is ready' }[jobState.kind] || 'Done')
      else toast('That did not work. Details are in the box.')
      if (step === 'export' || step === 'thumbnail') drawPanel()
    }
  }, 800)
}
function drawJob() {
  const busy = jobState && !jobState.done
  $('exportTop').disabled = !!busy
  const ts = $('thumbState'); if (ts) ts.textContent = jobState?.kind === 'thumb' && busy ? 'Saving…' : ''
  const box = $('jobBox'); if (!box || !jobState || jobState.kind === 'thumb') return
  const pct = Math.max(0, ...(jobState.log || []).map((l) => +(/(\d+)%/.exec(l) || [0, 0])[1]))
  const name = jobState.kind === 'stills' ? 'Checking frames' : 'Exporting your video'
  box.innerHTML = `<div class="job">
    <b>${busy ? name + '…' : jobState.ok ? (jobState.kind === 'stills' ? 'Frames ready' : '<span class="ok">✓</span> Your video is ready') : 'That did not work'}</b>
    ${busy && jobState.kind === 'video' ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
    ${busy || !jobState.ok ? `<div class="log">${esc((jobState.log || []).join('\n'))}</div>` : ''}
    ${jobState.ok && jobState.kind === 'stills' ? `<div class="stills">${jobState.result.map((u) => `<a href="${u}" target="_blank"><img src="${u}" alt=""></a>`).join('')}</div><p class="hint">Check nothing covers your face or gets cut off at an edge.</p>` : ''}
    ${jobState.ok && jobState.kind === 'video' && jobState.result ? `<div class="result"><video controls src="${jobState.result}"></video><div class="files"><p>Watch it once with sound before you post.</p><a class="primary" href="/dl/${encodeURIComponent(jobState.result.split('/').pop().split('?')[0])}">Download video</a><button class="ghost" data-reveal="${esc(jobState.result.replace('/p/', '').split('?')[0])}">Show in Finder</button></div></div>` : ''}
  </div>`
  ;['expBtn', 'stillsBtn'].forEach((id) => { if ($(id)) $(id).disabled = !!busy })
}

/* ── Timeline ─────────────────────────────────────────── */
const Z = () => +$('tlZoom').value // pixels per second
const X = (t) => 76 + t * Z()
function drawTimeline() {
  const inner = $('tlInner'), z = Z(), L = P.length
  inner.style.width = X(L) + 60 + 'px'
  const rows = []
  const row = (name, lane, cls, html) => rows.push(`<div class="trow ${cls}" data-lane="${lane}"><div class="nm">${name}</div>${html}</div>`)
  const stepS = z < 30 ? 5 : z < 60 ? 2 : 1
  let ticks = ''
  for (let t = 0; t <= L; t += stepS) ticks += `<span class="tick" style="left:${X(t)}px">${t}s</span>`
  row('', 'ruler', 'ruler', ticks)
  let film = ''
  for (let t = 0; t < L; t++) {
    const n = Math.min(thumbsN, Math.max(1, Math.floor(P.map.toSrc(t + 0.5)) + 1))
    film += `<span class="film" style="left:${X(t)}px;width:${Math.min(z, (L - t) * z)}px;background-image:url(${PATH.thumb(String(n).padStart(4, '0'))})"></span>`
  }
  P.map.starts.slice(1).forEach((s) => { film += `<span class="cutmark" style="left:${X(s) - 1}px" title="A cut"></span>` })
  row('Video', 'video', 'video', film)
  row('Hook', 'hook', '', edit.picks.O ? `<span class="blk dark" data-go="hook" style="left:${X(0)}px;width:${edit.hookFor * z}px">${esc(edit.hook.filter(Boolean).join(' '))}</span>` : '')
  const W = P.project.words, ph = P.project.phrases
  let caps = ''
  if (edit.captions.on !== false) ph.forEach((a, k) => { const b = (ph[k + 1] ?? W.length) - 1; const s = W[a][1], e = W[b][2]; if (edit.picks.O && e < edit.hookFor + 0.4) return; caps += `<span class="blk" data-go="captions" style="left:${X(s)}px;width:${Math.max(6, (e - s) * z - 2)}px">${esc(W.slice(a, b + 1).map((w) => w[0]).join(' '))}</span>` })
  row('Captions', 'captions', '', caps)
  let snd = ''
  edit.sounds.forEach((s, n) => { snd += `<span class="blk sfx${selSound === n ? ' sel' : ''}" data-snd="${n}" style="left:${X(P.map.toOut(s.src)) - 2}px" title="${esc(soundOf(s.sound).name)}: drag to move">${esc(soundOf(s.sound).name)}</span>` })
  row('Sounds', 'sounds', '', snd)
  row('Music', 'music', '', edit.music.file ? `<span class="blk" data-go="sounds" style="left:${X(0)}px;width:${L * z}px">♪ ${esc(edit.music.file.replace(/^assets\//, ''))}</span>` : '')
  inner.innerHTML = rows.join('') + `<div class="playhead" id="playhead"></div>`
}
function followPlayhead(out) {
  const sc = $('tlScroll'), x = X(out)
  if (x > sc.scrollLeft + sc.clientWidth - 60 || x < sc.scrollLeft + 76) sc.scrollLeft = x - 120
}
function initTimeline() {
  $('tlZoom').oninput = drawTimeline
  const sc = $('tlScroll')
  const timeAt = (clientX) => (clientX - sc.getBoundingClientRect().left + sc.scrollLeft - 76) / Z()
  let drag = null
  sc.onmousedown = (e) => {
    const sEl = e.target.closest('[data-snd]')
    if (sEl) { drag = { n: +sEl.dataset.snd, el: sEl, x0: e.clientX, left0: parseFloat(sEl.style.left), moved: false }; e.preventDefault(); return }
    const t = timeAt(e.clientX)
    if (t >= 0) seekOut(t)
    const g = e.target.closest('[data-go]')
    if (g && g.dataset.go !== step) go(g.dataset.go)
  }
  window.addEventListener('mousemove', (e) => {
    if (!drag) return
    const dx = e.clientX - drag.x0
    if (Math.abs(dx) > 3) drag.moved = true
    drag.el.style.left = drag.left0 + dx + 'px'
  })
  window.addEventListener('mouseup', () => {
    if (!drag) return
    const d = drag; drag = null
    selSound = d.n
    if (!d.moved) { const s = edit.sounds[d.n]; playSound(s.sound, s.vol ?? 1); if (step !== 'sounds') go('sounds'); else drawPanel(); drawTimeline(); return }
    const t = Math.max(0, (parseFloat(d.el.style.left) + 2 - 76) / Z())
    change((e) => { e.sounds[d.n].src = +P.map.toSrc(Math.min(P.length - 0.05, t)).toFixed(3) })
  })
  // Sounds dragged in from the library.
  sc.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/ay-sound')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } })
  sc.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData('text/ay-sound'); if (!id) return
    e.preventDefault()
    document.querySelector('.trow[data-lane=sounds]')?.classList.remove('drop')
    addSound(id, Math.max(0, timeAt(e.clientX)))
  })
}

/* ── Keys ─────────────────────────────────────────────── */
window.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox'
  if (typing) return
  if (e.code === 'Space') { e.preventDefault(); togglePlay() }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
  if ((e.key === 'Backspace' || e.key === 'Delete') && selSound != null && edit.sounds[selSound]) { const n = selSound; selSound = null; change((d) => d.sounds.splice(n, 1)) }
})

/* ── Start ────────────────────────────────────────────── */
await load()
P = T.project(edit)
$('pname').textContent = edit.title || edit.name
document.title = `${edit.title || edit.name} · AY Video Editor`
$('undo').onclick = undo; $('redo').onclick = redo
$('exportTop').onclick = () => go('export')
if (WEB) { const b = document.querySelector('.back'); b.href = WEB.home; b.textContent = '← AY Video Editor' }
step = STEPS.find((s) => !edit.progress[s.id])?.id || 'export'
initPreview()
initTimeline()
refresh()
initSegmenter().then(async () => { await makeStill(); if (step === 'hook' || step === 'thumbnail') drawPanel() })
makeStill()
