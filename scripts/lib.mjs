// Shared helpers for the AY Video Editor scripts: paths, the catalogue,
// running ffmpeg, the edit file, and the timeline maths that turns the
// creator's source take into the finished cut.
import fs from 'fs'
import path from 'path'
import vm from 'vm'
import { spawnSync, spawn } from 'child_process'
import { fileURLToPath } from 'url'

export const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const KIT_FILE = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.ay-video-editor', 'kit.json')

/* styles.js is a browser file that sets window.AY; read it the same way here. */
export function catalogue() {
  const box = { window: {} }
  vm.runInNewContext(fs.readFileSync(path.join(SKILL, 'engine/styles.js'), 'utf8'), box)
  return box.window.AY
}

export function chrome() {
  const local = process.env.LOCALAPPDATA || ''
  return [
    process.env.AY_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    local + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].find((p) => p && fs.existsSync(p))
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts })
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.slice(0, 6).join(' ')} … failed:\n${(r.stderr || '').slice(-1500)}`)
  }
  return r
}
export const ff = (args, opts) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], opts)
export function probe(file) {
  const r = run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  const j = JSON.parse(r.stdout)
  const v = j.streams.find((s) => s.codec_type === 'video')
  return { duration: +j.format.duration, width: v && v.width, height: v && v.height, rotation: v && v.side_data_list && v.side_data_list[0] && v.side_data_list[0].rotation, audio: j.streams.some((s) => s.codec_type === 'audio') }
}

export function spawnAsync(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} failed: ${err.slice(-1500)}`))))
  })
}

export const readEdit = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'edit.json'), 'utf8'))
export const writeEdit = (dir, e) => fs.writeFileSync(path.join(dir, 'edit.json'), JSON.stringify(e, null, 1) + '\n')

export function savedKit() {
  try { return JSON.parse(fs.readFileSync(KIT_FILE, 'utf8')) } catch { return {} }
}

/* The timeline maths lives in engine/timeline.js so the editor in the
   browser and these scripts compute the same cut. */
const T = (() => {
  const box = { window: {} }
  vm.runInNewContext(fs.readFileSync(path.join(SKILL, 'engine/timeline.js'), 'utf8'), box)
  return box.window.AYT
})()
export const { PAD, markRuns, segments, mapper, placeEffects } = T

export function project(edit) {
  const r = T.project(edit)
  if (!r.segs.length) throw new Error('Every word is cut; nothing left to render.')
  return r
}

/* A look's picks, fonts, colours and effects, with the creator's saved kit on top. */
export function applyLook(edit, lookId) {
  return T.applyLook(edit, catalogue(), lookId, savedKit())
}
