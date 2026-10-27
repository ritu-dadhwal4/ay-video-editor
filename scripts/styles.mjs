// Lists the looks and every style with its code, for when the creator asks
// "what styles are there". node scripts/styles.mjs
import { catalogue } from './lib.mjs'

const A = catalogue()
console.log('LOOKS')
A.looks.forEach((l) => console.log(`  ${l.id.padEnd(10)} ${l.name}: ${l.feel} (${Object.values(l.picks).flat().filter(Boolean).join(' ')})`))
for (const g of A.groups) {
  console.log(`\n${g.id} · ${g.name.toUpperCase()}: ${g.blurb}`)
  g.items.forEach((it) => console.log(`  ${it.code.padEnd(4)} ${it.name}${it.behind ? ' (behind you)' : ''}: ${it.what}`))
}
console.log(`\nTitle entrances: ${A.entrances.map((e) => e.id).join(', ')}`)
console.log(`Word positions: ${A.captionPositions.map((e) => e.id).join(', ')}`)
console.log(`Picture sounds: ${A.sound.pictureSfx.map((e) => e.id).join(', ')}`)
