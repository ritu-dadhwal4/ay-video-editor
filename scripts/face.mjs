// Measures where the face sits, as fractions of the frame height (top of
// the head, eyes, chin) and width (centre). Uses the median over frames
// spread across the kept part of the take, so one head-turn does not move
// every caption. node scripts/face.mjs <project>   (start.mjs calls it too)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import puppeteer from 'puppeteer-core'
import { SKILL, chrome, ff, readEdit, writeEdit } from './lib.mjs'

const DEFAULT = { top: 0.3, eyes: 0.42, chin: 0.56, cx: 0.5 }
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

export async function measureFace(video, edit, samples = 15) {
  const kept = edit.words.filter((w) => !w.cut)
  const span = kept.length ? [kept[0].s, kept[kept.length - 1].e] : [0, edit.duration]
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ay-face-'))
  const shots = []
  for (let i = 0; i < samples; i++) {
    const t = span[0] + ((i + 0.5) / samples) * (span[1] - span[0])
    const f = path.join(tmp, `f${i}.jpg`)
    ff(['-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=540:960', '-q:v', '4', f])
    shots.push(f)
  }
  const br = await puppeteer.launch({ executablePath: chrome(), headless: true, args: ['--allow-file-access-from-files'] })
  try {
    const pg = await br.newPage()
    await pg.goto(pathToFileURL(path.join(SKILL, 'engine/face.html')).href)
    await pg.waitForFunction('window.READY === true', { timeout: 60000 })
    const found = []
    for (const f of shots) {
      const r = await pg.evaluate((src) => window.detect(src), pathToFileURL(f).href)
      if (r) found.push(r)
    }
    if (found.length < Math.max(2, samples / 3)) return { ...DEFAULT, found: false }
    /* The detector's box runs brow to chin. Hair adds about 0.45 of the box
       above it; the chin sits just under the box. */
    const r3 = (x) => +x.toFixed(3)
    return {
      top: r3(median(found.map((d) => d.y - d.h * 0.45))),
      eyes: r3(median(found.map((d) => d.eyes))),
      chin: r3(median(found.map((d) => d.y + d.h * 1.02))),
      cx: r3(median(found.map((d) => d.x + d.w / 2))),
      found: true, frames: found.length,
    }
  } finally {
    await br.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const dir = path.resolve(process.argv[2])
  const edit = readEdit(dir)
  edit.face = await measureFace(path.join(dir, edit.source), edit)
  writeEdit(dir, edit)
  console.log(edit.face)
}
