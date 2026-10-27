// Prints the edit the way the editor's Cut step shows it: one phrase per
// line, word numbers, cut words in [brackets] with the reason, the keyword
// in *stars*, plus the picks and effects. Claude reads this back to the
// creator in plain words. node scripts/show.mjs <project>
import path from 'path'
import { readEdit, project, catalogue } from './lib.mjs'

const dir = path.resolve(process.argv[2])
const edit = readEdit(dir)
const A = catalogue()
const name = (c) => { for (const g of A.groups) for (const it of g.items) if (it.code === c) return it.name; return '?' }
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

const lines = []
let line = null
edit.words.forEach((w, i) => {
  if (w.br || !line) { line = { at: w.s, parts: [] }; lines.push(line) }
  line.parts.push(w.cut ? `[${i}:${w.w} ✂${w.why || ''}]` : w.key ? `${i}:*${w.w}*` : `${i}:${w.w}`)
})
console.log(`HOOK  ${edit.hook.join(' / ')}`)
console.log('')
lines.forEach((l) => console.log(`${fmt(l.at)}  ${l.parts.join(' ')}`))
const { length, fx } = project(edit)
console.log('')
console.log(`LOOK  ${edit.look || 'custom'} · ${Object.entries(edit.picks).filter(([, v]) => v).map(([, v]) => `${v} ${name(v)}`).join(' · ')}`)
console.log(`KIT   ${edit.kit.titleFont} / ${edit.kit.titleFont2} / ${edit.kit.captionFont} · title ${edit.kit.colours.title} accent ${edit.kit.colours.accent} · ${edit.kit.handle}`)
console.log(`SOUND picture: ${edit.sfx} · music: ${edit.music.file ? path.basename(edit.music.file) : 'none'}`)
fx.forEach((x) => console.log(`FX    ${x.code} ${name(x.code)} at ${fmt(x.start)} for ${(x.end - x.start).toFixed(1)} s${x.text ? ` "${x.text}"` : ''}${x.lines ? ` ${JSON.stringify(x.lines)}` : ''}`))
console.log(`\nFinished length ${fmt(length)} (raw ${fmt(edit.duration)})`)
