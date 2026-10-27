// AY Video Editor, on this computer only.
//   node scripts/editor.mjs                    opens the home page: upload a video, or pick one
//   node scripts/editor.mjs <project>          opens that project straight away
//   [--port 4400] [--no-open] [--workspace <folder>]
//
// Uploaded videos and their projects live in the workspace folder
// (Movies/AY Video Editor on a Mac, Videos/AY Video Editor elsewhere).
// The page saves edit.json as the creator works; Claude edits the same file.
import fs from 'fs'
import os from 'os'
import http from 'http'
import path from 'path'
import { spawn } from 'child_process'
import { SKILL, KIT_FILE, ff, probe, readEdit, writeEdit, catalogue } from './lib.mjs'

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
const LIM = catalogue().limits
const WORKSPACE = path.resolve(opt('workspace', path.join(os.homedir(), process.platform === 'darwin' ? 'Movies' : 'Videos', 'AY Video Editor')))
fs.mkdirSync(WORKSPACE, { recursive: true })
let port = +opt('port', 4400)

/* Projects: every folder in the workspace with an edit.json, plus any
   project opened by path. */
const extra = new Map()
const firstArg = args.find((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--')))
let startAt = '/'
if (firstArg) {
  const d = path.resolve(firstArg)
  if (!fs.existsSync(path.join(d, 'edit.json'))) { console.error(`No edit.json in ${d}`); process.exit(1) }
  const name = path.basename(d)
  extra.set(name, d)
  startAt = `/edit/${encodeURIComponent(name)}`
}
function projects() {
  const map = new Map(extra)
  for (const f of fs.readdirSync(WORKSPACE)) {
    const d = path.join(WORKSPACE, f)
    if (fs.existsSync(path.join(d, 'edit.json'))) map.set(f, d)
  }
  return map
}
const projectDir = (name) => projects().get(name) || null

let dir = null // the project open in the editor
function openProject(name) {
  const d = projectDir(name)
  if (!d) return false
  dir = d
  ensureThumbs(d)
  return true
}
/* Filmstrip: one small frame per second of the take, made once. */
function ensureThumbs(d) {
  const thumbs = path.join(d, 'work', 'thumbs')
  if (fs.existsSync(path.join(thumbs, 'done'))) return
  fs.mkdirSync(thumbs, { recursive: true })
  ff(['-i', path.join(d, readEdit(d).source), '-vf', 'fps=1,scale=120:-1', '-q:v', '5', path.join(thumbs, '%04d.jpg')])
  fs.writeFileSync(path.join(thumbs, 'done'), String(fs.readdirSync(thumbs).filter((f) => f.endsWith('.jpg')).length))
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.srt': 'text/plain; charset=utf-8' }

function sendFile(req, res, file, download) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found') }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'
    const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }
    if (download) head['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '')
    if (range) {
      // Video seeking needs byte ranges.
      const start = range[1] ? +range[1] : 0, end = range[2] ? +range[2] : st.size - 1
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 })
      return fs.createReadStream(file, { start, end }).pipe(res)
    }
    res.writeHead(200, { ...head, 'Content-Length': st.size })
    fs.createReadStream(file).pipe(res)
  })
}

const body = (req, limit = 200 * 1024 * 1024) => new Promise((res, rej) => {
  const chunks = []
  let n = 0
  req.on('data', (c) => { n += c.length; if (n > limit) { rej(new Error('too big')); req.destroy() } else chunks.push(c) })
  req.on('end', () => res(Buffer.concat(chunks)))
})
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)) }
const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`

/* ── Upload → prepare ─────────────────────────────────── */
const prep = new Map() // name → { stage, done, ok, error, log }
const STAGES = [['· copying', 'Preparing your video'], ['· transcribing', 'Writing down every word'], ['· finding your face', 'Finding your face'], ['Project:', 'Ready']]

function slug(s) {
  const base = s.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video'
  let n = base, k = 2
  while (fs.existsSync(path.join(WORKSPACE, n))) n = `${base}-${k++}`
  return n
}

async function receiveVideo(req, res, url) {
  const file = url.searchParams.get('file') || 'video.mp4'
  const ext = path.extname(file).slice(1).toLowerCase()
  const lang = /^[a-z]{2}$/.test(url.searchParams.get('lang') || '') ? url.searchParams.get('lang') : 'en'
  if (!LIM.types.includes(ext)) return json(res, 415, { error: `That's a .${ext} file. Upload MP4, MOV or WebM.` })
  const size = +req.headers['content-length'] || 0
  if (size > LIM.maxBytes) return json(res, 413, { error: `That file is ${mb(size)}. The limit is ${mb(LIM.maxBytes)}.` })
  const name = slug(file)
  const d = path.join(WORKSPACE, name)
  fs.mkdirSync(path.join(d, 'upload'), { recursive: true })
  const dest = path.join(d, 'upload', `original.${ext}`)
  // Stream to disk; never hold a 1 GB video in memory.
  const ok = await new Promise((resolve) => {
    let n = 0
    const w = fs.createWriteStream(dest)
    req.on('data', (c) => { n += c.length; if (n > LIM.maxBytes) { req.destroy(); w.destroy(); resolve(false) } })
    req.pipe(w)
    w.on('finish', () => resolve(true))
    w.on('error', () => resolve(false))
  })
  const fail = (code, error) => { fs.rmSync(d, { recursive: true, force: true }); return json(res, code, { error }) }
  if (!ok) return fail(413, `That file is over ${mb(LIM.maxBytes)}.`)
  let info
  try { info = probe(dest) } catch { return fail(422, "That file isn't a video we can read. Try exporting it again as MP4.") }
  if (!info.width) return fail(422, 'That file has no video in it.')
  if (!info.audio) return fail(422, 'That video has no sound, so there is nothing to caption or cut.')
  if (info.duration > LIM.maxSeconds + 1) return fail(422, `That video is ${fmtDur(info.duration)}. The limit is ${fmtDur(LIM.maxSeconds)}: trim it first.`)
  if (info.duration < LIM.minSeconds) return fail(422, `That video is only ${info.duration.toFixed(1)} seconds. It needs at least ${LIM.minSeconds}.`)
  const landscape = info.width > info.height && !Math.abs(info.rotation || 0)
  fs.writeFileSync(path.join(d, 'upload', 'about.json'), JSON.stringify({ file, size, duration: info.duration, landscape, uploaded: Date.now() }))
  prepare(name, dest, lang, d, file.replace(/\.[^.]+$/, ''))
  return json(res, 200, { name, landscape, duration: info.duration })
}
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

function prepare(name, input, lang, d, title) {
  const st = { stage: 'Preparing your video', step: 0, done: false, ok: false, error: null, log: [] }
  prep.set(name, st)
  const child = spawn(process.execPath, [path.join(SKILL, 'scripts/start.mjs'), input, '--out', d, '--lang', lang, '--name', name, '--title', title], { cwd: SKILL })
  const take = (data) => String(data).split('\n').filter(Boolean).forEach((l) => {
    st.log.push(l); if (st.log.length > 60) st.log.shift()
    STAGES.forEach(([k, label], i) => { if (l.startsWith(k)) { st.stage = label; st.step = i } })
  })
  child.stdout.on('data', take)
  child.stderr.on('data', take)
  child.on('close', (code) => {
    st.done = true; st.ok = code === 0
    if (!st.ok) st.error = (st.log.filter((l) => /^[A-Z_]+:/.test(l)).pop() || st.log.slice(-1)[0] || 'Something went wrong.').replace(/^[A-Z_]+: /, '')
    else try { ff(['-ss', '1', '-i', path.join(d, 'raw.mp4'), '-frames:v', '1', '-vf', 'scale=270:-2', '-q:v', '4', path.join(d, 'work', 'cover.jpg')]) } catch {}
  })
}

function listProjects() {
  return [...projects()].map(([name, d]) => {
    try {
      const e = readEdit(d)
      const st = fs.statSync(path.join(d, 'edit.json'))
      const out = path.join(d, 'out')
      const rendered = fs.existsSync(out) && fs.readdirSync(out).some((f) => /-v\d{3}\.mp4$/.test(f))
      return { name, title: e.title || e.name, duration: e.duration, updated: st.mtimeMs, rendered, cover: `/api/cover?name=${encodeURIComponent(name)}` }
    } catch { return null }
  }).filter(Boolean).concat([...prep].filter(([n, s]) => !s.done || !s.ok).map(([name, s]) => ({ name, preparing: true, stage: s.stage, error: s.error })))
    .filter((p, i, a) => a.findIndex((q) => q.name === p.name) === i)
    .sort((a, b) => (b.updated || 9e15) - (a.updated || 9e15))
}

/* ── Render jobs (one at a time) ──────────────────────── */
let job = null
function startJob(kind, extraArgs) {
  const log = []
  const d = dir
  if (kind === 'stills') for (const f of fs.existsSync(path.join(d, 'check')) ? fs.readdirSync(path.join(d, 'check')) : []) if (/^still-/.test(f)) fs.rmSync(path.join(d, 'check', f))
  const child = spawn(process.execPath, [path.join(SKILL, 'scripts/render.mjs'), d, ...extraArgs], { cwd: SKILL })
  job = { id: Date.now(), kind, log, done: false, ok: false, result: null, project: path.basename(d) }
  const take = (x) => String(x).split('\n').filter(Boolean).forEach((l) => { log.push(l); if (log.length > 200) log.shift() })
  child.stdout.on('data', take)
  child.stderr.on('data', take)
  child.on('close', (code) => {
    job.done = true; job.ok = code === 0
    if (!job.ok) return
    if (kind === 'stills') job.result = fs.readdirSync(path.join(d, 'check')).filter((f) => /^still-.*\.jpg$/.test(f)).sort().map((f) => `/p/check/${f}?v=${job.id}`)
    else { const m = log.map((l) => /^Done: (.*)$/.exec(l)).filter(Boolean).pop(); job.result = m ? `/p/${path.relative(d, m[1]).split(path.sep).join('/')}?v=${job.id}` : null }
  })
}

function outputs(d) {
  const out = path.join(d, 'out')
  if (!fs.existsSync(out)) return []
  return fs.readdirSync(out).filter((f) => /-v\d{3}\.mp4$|-thumbnail\.jpg$|\.srt$/.test(f)).sort().map((f) => ({ name: f, url: `/p/out/${f}`, at: fs.statSync(path.join(out, f)).mtimeMs }))
}

/* ── Routes ───────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    const p = decodeURIComponent(url.pathname)
    if (p === '/' || p === '/index.html') return sendFile(req, res, path.join(SKILL, 'engine/editor/home.html'))
    if (p.startsWith('/edit/')) {
      const name = p.slice(6)
      if (!openProject(name)) { res.writeHead(302, { Location: '/' }); return res.end() }
      return sendFile(req, res, path.join(SKILL, 'engine/editor/index.html'))
    }

    // Home
    if (p === '/api/home') return json(res, 200, { projects: listProjects(), limits: LIM, workspace: WORKSPACE })
    if (p === '/api/video' && req.method === 'POST') return receiveVideo(req, res, url)
    if (p === '/api/prepare') { const s = prep.get(url.searchParams.get('name')); return json(res, 200, s ? { ...s, log: s.log.slice(-5) } : null) }
    if (p === '/api/cover') {
      const d = projectDir(url.searchParams.get('name') || '')
      const f = d && [path.join(d, 'work', 'cover.jpg'), path.join(d, 'out', `${path.basename(d)}-thumbnail.jpg`)].find((x) => fs.existsSync(x))
      if (!f && d && fs.existsSync(path.join(d, 'raw.mp4'))) {
        fs.mkdirSync(path.join(d, 'work'), { recursive: true })
        ff(['-ss', '1', '-i', path.join(d, 'raw.mp4'), '-frames:v', '1', '-vf', 'scale=270:-2', '-q:v', '4', path.join(d, 'work', 'cover.jpg')])
        return sendFile(req, res, path.join(d, 'work', 'cover.jpg'))
      }
      return f ? sendFile(req, res, f) : (res.writeHead(404), res.end())
    }
    if (p === '/api/kit' && req.method === 'GET') { let k = {}; try { k = JSON.parse(fs.readFileSync(KIT_FILE, 'utf8')) } catch {} return json(res, 200, k) }
    if (p === '/api/kit' && req.method === 'PUT') {
      fs.mkdirSync(path.dirname(KIT_FILE), { recursive: true })
      fs.writeFileSync(KIT_FILE, JSON.stringify(JSON.parse(await body(req, 100000)), null, 1))
      return json(res, 200, { ok: true })
    }

    // Everything below works on the open project.
    if (p.startsWith('/api/') && !dir) return json(res, 409, { error: 'No video is open.' })
    if (p === '/api/edit' && req.method === 'GET') return json(res, 200, { edit: readEdit(dir), name: path.basename(dir), thumbs: +fs.readFileSync(path.join(dir, 'work', 'thumbs', 'done'), 'utf8'), outputs: outputs(dir), mtime: fs.statSync(path.join(dir, 'edit.json')).mtimeMs })
    if (p === '/api/edit' && req.method === 'PUT') {
      const e = JSON.parse(await body(req, 20 * 1024 * 1024))
      if (!Array.isArray(e.words) || !e.picks) return json(res, 400, { error: 'not an edit file' })
      // Keep the one before, in case a save ever goes wrong.
      fs.copyFileSync(path.join(dir, 'edit.json'), path.join(dir, 'edit.prev.json'))
      writeEdit(dir, e)
      return json(res, 200, { ok: true, mtime: fs.statSync(path.join(dir, 'edit.json')).mtimeMs })
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const name = (url.searchParams.get('name') || 'file').replace(/[^\w.-]+/g, '-').slice(-80)
      const max = /\.(mp3|m4a|wav|aac|ogg)$/i.test(name) ? LIM.musicMaxBytes : 30 * 1024 * 1024
      if ((+req.headers['content-length'] || 0) > max) return json(res, 413, { error: `That file is over ${mb(max)}.` })
      fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'assets', name), await body(req, max))
      return json(res, 200, { path: 'assets/' + name })
    }
    if (p === '/api/render' && req.method === 'POST') {
      if (job && !job.done) return json(res, 409, { error: 'Something is already rendering. Wait for it to finish.' })
      const { stills, kind } = JSON.parse((await body(req, 10000)).toString() || '{}')
      if (stills) startJob('stills', ['--stills', stills.map((t) => (+t).toFixed(2)).join(',')])
      else if (kind === 'thumb') startJob('thumb', ['--thumb'])
      else if (kind === 'srt') startJob('srt', ['--srt'])
      else startJob('video', [])
      return json(res, 200, { id: job.id })
    }
    if (p === '/api/job') return json(res, 200, job && job.project === path.basename(dir) ? { ...job, log: job.log.slice(-12) } : null)
    if (p === '/api/frame') {
      const t = Math.max(0, +url.searchParams.get('t') || 0), w = Math.min(1080, +url.searchParams.get('w') || 540)
      const cache = path.join(dir, 'work', 'frames-cache')
      fs.mkdirSync(cache, { recursive: true })
      const f = path.join(cache, `${t.toFixed(2)}-${w}.jpg`)
      if (!fs.existsSync(f)) ff(['-ss', t.toFixed(3), '-i', path.join(dir, readEdit(dir).source), '-frames:v', '1', '-vf', `scale=${w}:-2`, '-q:v', '3', f])
      return sendFile(req, res, f)
    }
    if (p === '/api/mtime') return json(res, 200, { mtime: fs.statSync(path.join(dir, 'edit.json')).mtimeMs })
    if (p === '/api/reveal' && req.method === 'POST') {
      // Show the file in Finder / Explorer.
      const f = path.resolve(dir, (url.searchParams.get('file') || 'out').replace(/^\/+/, ''))
      if (!f.startsWith(dir)) return json(res, 400, { error: 'outside the project' })
      const [cmd, a] = process.platform === 'darwin' ? ['open', ['-R', f]] : process.platform === 'win32' ? ['explorer', [`/select,${f}`]] : ['xdg-open', [path.dirname(f)]]
      spawn(cmd, a, { stdio: 'ignore', detached: true }).unref()
      return json(res, 200, { ok: true })
    }
    if (p.startsWith('/dl/')) return sendFile(req, res, path.resolve(dir, 'out', path.basename(p)), true)

    /* Only these folders are served; nothing outside them, ever. */
    const roots = { '/engine/': path.join(SKILL, 'engine'), '/vision/': path.join(SKILL, 'node_modules/@mediapipe/tasks-vision'), '/models/': path.join(SKILL, 'models'), '/sfx/': path.join(SKILL, 'sfx'), ...(dir ? { '/p/': dir } : {}) }
    for (const [prefix, root] of Object.entries(roots)) {
      if (!p.startsWith(prefix)) continue
      const file = path.resolve(root, '.' + p.slice(prefix.length - 1))
      if (file !== root && !file.startsWith(root + path.sep)) break
      return sendFile(req, res, file)
    }
    res.writeHead(404); res.end('Not found')
  } catch (e) {
    json(res, 500, { error: String(e.message || e) })
  }
})
server.requestTimeout = 0 // big uploads take a while

server.on('error', (e) => { if (e.code === 'EADDRINUSE' && port < 4450) { port++; server.listen(port, '127.0.0.1') } else throw e })
server.on('listening', () => {
  const url = `http://127.0.0.1:${port}${startAt}`
  console.log(`AY Video Editor: ${url}`)
  console.log(`Videos are kept in ${WORKSPACE}`)
  if (!args.includes('--no-open')) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
    spawn(cmd, process.platform === 'win32' ? ['/c', 'start', '', url] : [url], { stdio: 'ignore', detached: true }).unref()
  }
})
server.listen(port, '127.0.0.1')
