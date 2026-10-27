// One-time check. Prints READY, or one NEED_… line per missing piece.
// node scripts/setup.mjs
import fs from 'fs'
import path from 'path'
import { SKILL, chrome, run } from './lib.mjs'

const need = []
const major = +process.versions.node.split('.')[0]
if (major < 18) need.push('NEED_NODE (version 18 or newer, from nodejs.org)')
for (const tool of ['ffmpeg', 'ffprobe']) {
  const r = run(tool, ['-version'], { allowFail: true })
  if (r.error || r.status !== 0) need.push(`NEED_FFMPEG (${tool} not found)`)
}
if (!chrome()) need.push('NEED_CHROME (Google Chrome or Microsoft Edge)')

if (!fs.existsSync(path.join(SKILL, 'node_modules/puppeteer-core'))) {
  console.log('Installing the two small packages this skill uses…')
  const r = run('npm', ['install', '--no-audit', '--no-fund'], { cwd: SKILL, allowFail: true, shell: process.platform === 'win32' })
  if (r.status !== 0) need.push('NEED_NPM_INSTALL (npm install failed in the skill folder)')
}
if (!fs.existsSync(path.join(SKILL, 'models/blaze_face_short_range.tflite'))) need.push('NEED_FACE_MODEL (models/blaze_face_short_range.tflite missing)')
if (!fs.existsSync(path.join(SKILL, 'models/selfie_segmenter.tflite'))) need.push('NEED_CUTOUT_MODEL (models/selfie_segmenter.tflite missing; the editor uses it for its live preview)')
if (!fs.existsSync(path.join(SKILL, 'sfx/pop.wav'))) await import('./sfx.mjs')

const hf = run('npx', ['--yes', 'hyperframes', '--version'], { allowFail: true, shell: process.platform === 'win32' })
if (hf.status !== 0) need.push('NEED_HYPERFRAMES (npx hyperframes did not run; it transcribes and cuts you out)')

console.log(need.length ? need.join('\n') : 'READY')
