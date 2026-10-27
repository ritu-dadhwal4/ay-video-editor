/*
 * AY Video Editor: the timeline maths, shared by the editor in the browser
 * and the scripts in Node (scripts/lib.mjs loads this file), so the preview
 * and the render always agree on what is cut and when things happen.
 *
 * The finished cut is the kept words, joined, with long pauses inside them
 * taken out. Source seconds are times in the creator's take; finished seconds
 * are times in the edited video.
 */
;(function (root) {
  const PAD = 0.07 // breathing room left either side of every cut, in seconds

  /* Mark each word whose previous word is also kept, so a cut word always
     splits the timeline even when no pause sits there. */
  function markRuns(edit) {
    let prev = false
    for (const w of edit.words) { w.prevKept = prev && !w.cut; prev = !w.cut }
    return edit
  }

  function segments(edit) {
    markRuns(edit)
    const kept = edit.words.filter((w) => !w.cut)
    if (!kept.length) return []
    const segs = []
    for (const w of kept) {
      const last = segs[segs.length - 1]
      const s = Math.max(0, w.s - PAD), e = Math.min(edit.duration, w.e + PAD)
      if (last && w.prevKept) last[1] = Math.max(last[1], e)
      else segs.push([s, e])
    }
    // Take long pauses out of the inside of each segment.
    const out = []
    for (const [a, b] of segs) {
      let cur = a
      for (const [ps, pe] of edit.pauses || []) {
        if (pe <= cur || ps >= b) continue
        if (pe - ps < (edit.maxPause ?? 0.35)) continue
        const cutFrom = Math.max(cur, ps + PAD), cutTo = Math.min(b, pe - PAD)
        if (cutTo - cutFrom > 0.05) { out.push([cur, cutFrom]); cur = cutTo }
      }
      out.push([cur, b])
    }
    return out.filter(([a, b]) => b - a > 0.04)
  }

  function mapper(segs) {
    const starts = []
    let acc = 0
    for (const [a, b] of segs) { starts.push(acc); acc += b - a }
    return {
      length: acc, starts,
      /* Source → finished; times inside a removed gap land on the next kept moment. */
      toOut(t) {
        for (let i = 0; i < segs.length; i++) {
          const [a, b] = segs[i]
          if (t < a) return starts[i]
          if (t <= b) return starts[i] + (t - a)
        }
        return acc
      },
      /* Finished → source. */
      toSrc(t) {
        for (let i = segs.length - 1; i >= 0; i--) if (t >= starts[i]) return Math.min(segs[i][1], segs[i][0] + (t - starts[i]))
        return segs.length ? segs[0][0] : 0
      },
      /* For playback: where the take should be at source time t. Returns t
         itself inside a kept part, the next part's start inside a gap, or
         null past the end. */
      playable(t) {
        for (const [a, b] of segs) { if (t < a - 0.01) return a; if (t < b) return t }
        return null
      },
    }
  }

  /* The project the renderer draws: kept words on the finished timeline,
     plus the effects with their finished-time windows. */
  function project(edit) {
    const segs = segments(edit)
    const m = mapper(segs)
    const words = [], phrases = [], index = []
    let since = 0
    edit.words.forEach((w, i) => {
      if (w.cut) return
      const s = m.toOut(w.s), e = Math.max(s + 0.05, m.toOut(w.e))
      if (w.br || !words.length || since >= 6) { phrases.push(words.length); since = 0 }
      words.push([w.w, +s.toFixed(3), +e.toFixed(3), w.key ? 'key' : undefined].filter((x) => x !== undefined))
      index.push(i)
      since++
    })
    // Effects are pinned to a word in the full transcript; use the first kept
    // word at or after it.
    const outOfWord = (i) => {
      for (let k = i; k < edit.words.length; k++) if (!edit.words[k].cut) return m.toOut(edit.words[k].s)
      return m.length
    }
    const fx = (edit.fx || []).map((x) => {
      const start = x.word != null ? outOfWord(x.word) : x.start
      return { ...x, start: +start.toFixed(3), end: +(start + (x.for || 3)).toFixed(3) }
    })
    return {
      segs, map: m, length: m.length, fx, index,
      project: { length: m.length, words, phrases, face: edit.face, hook: edit.hook, hookWord: edit.hookWord },
    }
  }

  /* A look's effects, pinned to words: the call-to-action cards about 3 s
     before the end, the rest on keywords spread through the middle (never in
     the opening 3.5 s, where the title is). */
  function placeEffects(edit, codes) {
    const kept = edit.words.map((w, i) => ({ ...w, i })).filter((w) => !w.cut)
    if (!kept.length) return []
    const end = kept[kept.length - 1].e
    const lastPhrase = [...kept].reverse().find((w) => w.br) || kept[kept.length - 1]
    const keys = kept.filter((w) => w.key && w.s > 3.5 && w.s < lastPhrase.s - 1)
    const middle = codes.filter((c) => c !== 'E9' && c !== 'E10')
    const near = (list, t) => list.reduce((a, b) => (Math.abs(b.s - t) < Math.abs(a.s - t) ? b : a))
    const fx = []
    middle.forEach((code, n) => {
      const w = near(keys.length ? keys : kept, 3.5 + ((n + 1) / (middle.length + 1)) * (lastPhrase.s - 3.5))
      const word = w.w.replace(/[^\p{L}\p{N}%-]/gu, '')
      fx.push({ code, word: w.i, for: 3, ...(code === 'E2' || code === 'E3' ? { text: word } : {}) })
    })
    const cta = near(kept, Math.max(3.5, end - 3.2))
    codes.filter((c) => c === 'E9' || c === 'E10').forEach((code) => fx.push({ code, word: cta.i, for: +Math.min(3.5, end - cta.s).toFixed(2) }))
    return fx
  }

  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, o[k]]))

  /* A look's picks, fonts, colours and effects, with the creator's saved kit
     (`mine`) on top: their name, handle and keyword always; their fonts and
     colours when they asked for them to win. */
  function applyLook(edit, A, lookId, mine = {}) {
    const look = A.looks.find((l) => l.id === lookId)
    if (!look) throw new Error(`No look "${lookId}". Looks: ${A.looks.map((l) => l.id).join(', ')}`)
    edit.look = look.id
    edit.picks = { ...look.picks }
    delete edit.picks.E
    edit.kit = {
      ...A.kit, ...look.type, colours: { ...look.colours },
      // A look never changes who the video is by.
      ...pick(edit.kit || {}, ['name', 'handle', 'cta']),
      ...pick(mine, ['name', 'handle', 'cta']),
      ...(mine.keepMyType ? pick(mine, ['titleFont', 'titleFont2', 'captionFont']) : {}),
    }
    if (mine.keepMyColours && mine.colours) edit.kit.colours = { ...edit.kit.colours, ...mine.colours }
    Object.assign(edit, { entrance: look.entrance, caption: look.caption, sfx: look.sfx, mood: look.mood })
    edit.fx = placeEffects(edit, look.picks.E || [])
    return edit
  }

  root.AYT = { PAD, markRuns, segments, mapper, project, placeEffects, applyLook }
})(typeof window !== 'undefined' ? window : globalThis)
