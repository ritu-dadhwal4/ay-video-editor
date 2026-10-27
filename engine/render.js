/*
 * AY Video Editor: the browser preview renderer.
 *
 * Draws any combination of catalogue styles over a 9:16 shot, driven only by
 * a time `t` in seconds, so the same call gives the same frame every time.
 * The review page, the five-looks strip and (later) the editor's timeline all
 * use it; the final MP4 is rendered by the skill, not by this file.
 *
 *   const s = AYR.mount(stageEl, state, { media: 'still' | 'clip' })
 *   s.at(t)          draw the frame at t (seconds)
 *   s.set(state)     swap styles or brand kit, keeps the media
 *
 * `opts.project` swaps the demo clip for a real one (the skill's render page
 * and the editor pass it): { length, words: [[text, start, end, key]], phrases,
 * face, hook }, every time on the finished timeline. One project per page.
 * `opts.media: 'frames'` leaves the shot empty; the caller sets `media.src`
 * and `cut.src` to each frame before calling at(t).
 *
 * Effects come from `state.fx` when it is there ([{ code, start, end, text,
 * lines, ... }], the edit file's effects in finished-timeline seconds) and
 * otherwise from `state.picks.E`, spread evenly after the opening.
 *
 * A stage has five layers, back to front: the shot (graded, moved by the
 * camera), `behind` (between the room and the person), the cutout of the
 * person, the vignette, and `front` (titles, words, cards). The cutout only
 * shows when a style needs it, so a plain look costs nothing extra.
 *
 * Sizes are in container units (cqw / cqh of the stage), so a 120 px card and
 * a 400 px preview draw the same picture.
 */
(function () {
  const A = window.AY
  let S = A.sample
  const ease = (p) => 1 - Math.pow(1 - clamp01(p), 3)
  const back = (p) => { p = clamp01(p); const c = 1.7; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2) }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
  const ramp = (t, a, d) => clamp01((t - a) / d)

  function h(tag, css, text) {
    const el = document.createElement(tag)
    if (css) el.style.cssText = css
    if (text != null) el.textContent = text
    return el
  }
  const font = (name, w) => `font-family:'${name}',system-ui,sans-serif;font-weight:${w || 400};`
  const shadow = 'text-shadow:0 .3cqw 1.6cqw rgba(0,0,0,.45);'
  const strip = (w) => w.replace(/[.,!?]$/, '')
  /* Black or white, whichever reads on a fill colour. */
  const inkOn = (hex) => {
    const n = parseInt(String(hex).replace('#', ''), 16)
    return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150 ? '#0A0A0A' : '#FFFFFF'
  }

  /* Words on screen at t, as indexes into S.words. */
  function wordAt(t) {
    let i = -1
    S.words.forEach((w, k) => { if (t >= w[1] - 0.04) i = k })
    return i
  }
  function phraseAt(t) {
    const i = wordAt(t)
    if (i < 0) return null
    let p = 0
    S.phrases.forEach((start, k) => { if (i >= start) p = k })
    const from = S.phrases[p]
    const to = (S.phrases[p + 1] ?? S.words.length) - 1
    const end = S.words[to][2] + 0.25
    if (t > end && p === S.phrases.length - 1) return null
    return { p, from, to, cur: i, start: S.words[from][1], end }
  }

  /* Where words sit, as a centre height (fraction of the frame). Under the
     chin only when there is room above the platform's bottom bar; otherwise
     above the head, so they never cover the face. */
  function wordsY(ctx) {
    const f = S.face, z = A.safeZone
    if (ctx.caption === 'chest') {
      const y = f.chin + 0.06
      if (y < 1 - z.bottom - 0.03) return { y, x: 0.5 }
      ctx.notes.add('Under-chin words moved above your head: not enough room below your chin in this shot.')
    }
    if (ctx.caption === 'beside') return { y: f.eyes - 0.02, x: 0.22, side: true }
    /* A giant word behind the head takes the wall, so words go higher. */
    return { y: f.top - (ctx.bigWord ? 0.27 : 0.12), x: 0.5 }
  }

  /* Title entrance at progress p (0 → 1), then the 3 s exit. */
  function entrance(kind, p) {
    const e = ease(p)
    switch (kind) {
      case 'cut': return { transform: 'none', opacity: p > 0 ? 1 : 0, filter: 'none' }
      case 'drop': return { transform: `translateY(${-(1 - back(p)) * 8}cqh) rotate(${(1 - e) * -7}deg)`, opacity: clamp01(p * 3), filter: 'none' }
      case 'glow': return { transform: `scale(${1.04 - 0.04 * e})`, opacity: e, filter: `blur(${(1 - e) * 1.2}cqw) brightness(${1 + (1 - e) * 1.6})` }
      default: return { transform: `translateY(${(1 - e) * 4}cqh)`, opacity: e, filter: 'none' }
    }
  }
  function titleAt(el, ctx, t, out = ctx.hookFor || 3) {
    const st = entrance(ctx.entrance, ramp(t, 0.05, 0.55))
    const x = ramp(t, out, 0.4)
    el.style.transform = st.transform + ` translateY(${-x * 3}cqh)`
    el.style.opacity = st.opacity * (1 - x)
    el.style.filter = st.filter
  }

  /* Effects get a time window: the whole loop on a single-style card, a
     share of the middle when a look stacks several. */
  const on = (ctx, t) => t >= ctx.win[0] && t <= ctx.win[1]
  const inP = (ctx, t, d = 0.45) => ease(ramp(t, ctx.win[0], d)) * (1 - ease(ramp(t, ctx.win[1] - 0.35, 0.35)))

  /* A copy of the shot drawn into a canvas: reel thumbnails, the corner
     narrator, before/after cards. */
  function shotCanvas(ctx, w, hgt, crop) {
    const c = h('canvas')
    c.width = w; c.height = hgt
    c.style.cssText = 'width:100%;height:100%;display:block;object-fit:cover'
    const g = c.getContext('2d')
    return {
      el: c,
      draw() {
        const m = ctx.media
        const mw = m.videoWidth || m.naturalWidth, mh = m.videoHeight || m.naturalHeight
        if (!mw) return false
        const [cx, cy, cw, ch] = crop || [0, 0, 1, 1]
        try { g.drawImage(m, cx * mw, cy * mh, cw * mw, ch * mh, 0, 0, w, hgt); return true } catch (e) { return false }
      },
    }
  }

  /* A stand-in for the creator's screen recording or proof. */
  function screenMock(dark) {
    const bg = dark ? '#171717' : '#FFFFFF', ln = dark ? '#262626' : '#EBEBEB', ink = dark ? '#404040' : '#D4D4D4'
    const el = h('div', `position:absolute;inset:0;background:${bg};overflow:hidden`)
    const bar = h('div', `height:7%;background:${ln};display:flex;align-items:center;gap:1.4cqw;padding:0 3cqw`)
    ;['#FF5F57', '#FEBC2E', '#28C840'].forEach((c) => bar.append(h('i', `width:2cqw;height:2cqw;border-radius:50%;background:${c}`)))
    el.append(bar)
    const body = h('div', 'padding:5cqw;display:grid;gap:3cqw')
    ;[70, 92, 55, 84, 40, 76].forEach((w, i) => body.append(h('i', `display:block;height:${i === 0 ? 5 : 2.6}cqw;width:${w}%;border-radius:1cqw;background:${i === 0 ? (dark ? '#525252' : '#A3A3A3') : ink}`)))
    el.append(body)
    return el
  }

  /* The creator's own screenshot when the edit gives one, else the stand-in. */
  function proofOr(ctx, dark) {
    if (!ctx.proof) return screenMock(dark)
    const img = h('img', 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top')
    img.src = ctx.proof
    return img
  }

  /* ── Styles ─────────────────────────────────────────── */
  const MAKE = {
    /* Opening */
    O1(ctx) {
      const el = h('div', `position:absolute;left:8cqw;right:8cqw;top:${(S.face.top - 0.33) * 100}cqh;text-align:center;color:${ctx.c.title};${shadow}`)
      el.append(h('div', `${font(ctx.f.titleFont2, 800)}font-size:9cqw;line-height:1;letter-spacing:-.02em;text-transform:uppercase`, S.hook[0]))
      el.append(h('div', `${font(ctx.f.titleFont, 400)}font-style:italic;font-size:11.5cqw;line-height:1.02;margin-top:.6cqw`, S.hook[1]))
      ctx.front.append(el)
      return (t) => titleAt(el, ctx, t)
    },
    O2(ctx) {
      const el = h('div', `position:absolute;left:50%;top:${(S.face.top - 0.3) * 100}cqh;translate:-50% 0;width:max-content;max-width:80cqw;background:${ctx.c.box};color:${inkOn(ctx.c.box)};padding:2.4cqw 4cqw;border-radius:1.4cqw;text-align:center;${font(ctx.f.titleFont2, 800)}font-size:7.4cqw;line-height:1.05;text-transform:uppercase`)
      el.innerHTML = `${S.hook[0]}<br>${S.hook[1]}`
      ctx.front.append(el)
      return (t) => titleAt(el, ctx, t)
    },
    O3(ctx) {
      ctx.needCut = true
      const el = h('div', `position:absolute;left:0;right:0;top:${(S.face.top - 0.07) * 100}cqh;text-align:center;color:${ctx.c.accent};${font(ctx.f.titleFont2, 900)}font-size:20cqw;line-height:.9;letter-spacing:-.04em;text-transform:uppercase`, S.hookWord || S.hook[0].split(' ')[0])
      ctx.behind.append(el)
      return (t) => titleAt(el, ctx, t)
    },
    O4(ctx) {
      const el = h('div', `position:absolute;left:8cqw;right:8cqw;top:${(A.safeZone.top + 0.03) * 100}cqh;text-align:center;color:${ctx.c.title};${font(ctx.f.titleFont2, 800)}font-size:7.6cqw;line-height:1.08;${shadow}`)
      const spans = S.words.slice(0, 7).map((w) => { const s = h('span', 'opacity:0;display:inline-block;margin:0 .8cqw', w[0]); el.append(s); return s })
      ctx.front.append(el)
      return (t) => {
        spans.forEach((s, i) => { const p = ramp(t, S.words[i][1] - 0.05, 0.12); s.style.opacity = p; s.style.transform = `translateY(${(1 - p) * 1.5}cqh)` })
        const x = ramp(t, ctx.hookFor || 3, 0.4)
        el.style.opacity = 1 - x
      }
    },
    O5(ctx) {
      const el = h('div', `position:absolute;left:0;right:0;top:${(S.face.top - 0.31) * 100}cqh;display:grid;justify-items:center;gap:1.6cqw`)
      S.hook.forEach((line, i) => el.append(h('div', `background:#FFFFFF;color:#0A0A0A;border:.9cqw solid #0A0A0A;border-radius:99cqw;padding:1.4cqw 4.4cqw;${font(ctx.f.titleFont, 400)}font-size:${i ? 8 : 6.6}cqw;line-height:1.1;rotate:${i ? 2 : -3}deg;box-shadow:0 1cqw 0 #0A0A0A`, line)))
      ctx.front.append(el)
      return (t) => titleAt(el, ctx, t)
    },
    O7(ctx) {
      const el = h('div', `position:absolute;left:7cqw;right:7cqw;top:${(S.face.top - 0.32) * 100}cqh;text-align:center;${font(ctx.f.titleFont2, 800)}font-size:8.4cqw;line-height:1.3`)
      const lines = S.hook.filter(Boolean).map((l) => {
        const s = h('span', `padding:.04em .22em;border-radius:.12em;color:${ctx.c.title};${shadow}`, l)
        const d = h('div', ''); d.append(s); el.append(d); return s
      })
      ctx.front.append(el)
      return (t) => {
        titleAt(el, ctx, t)
        lines.forEach((s, i) => {
          const p = ease(ramp(t, 0.35 + i * 0.25, 0.4)), acc = ctx.c.accent
          s.style.background = `linear-gradient(${acc},${acc}) no-repeat 0 55% / ${p * 100}% 80%`
          s.style.color = p > 0.5 ? inkOn(acc) : ctx.c.title
          s.style.textShadow = p > 0.5 ? 'none' : ''
        })
      }
    },
    O8(ctx) {
      const el = h('div', `position:absolute;left:6cqw;right:6cqw;top:${(S.face.top - 0.32) * 100}cqh;text-align:center;${shadow}`)
      el.append(h('div', `${font(ctx.f.captionFont, 600)}font-size:3.6cqw;letter-spacing:.3em;text-transform:uppercase;color:${ctx.c.title};margin-bottom:1.4cqw`, S.hook[0]))
      el.append(h('div', `${font(ctx.f.titleFont, 400)}font-style:italic;font-size:13cqw;line-height:1;color:${ctx.c.accent}`, S.hook[1] || ''))
      ctx.front.append(el)
      return (t) => titleAt(el, ctx, t)
    },
    O6(ctx) {
      const el = h('div', `position:absolute;left:0;right:0;top:0;height:46cqh;background:${ctx.c.box === '#0A0A0A' ? '#FFFFFF' : ctx.c.box};display:grid;align-content:end;padding:0 7cqw 5cqw;box-shadow:0 1cqw 4cqw rgba(0,0,0,.25)`)
      el.append(h('div', `${font(ctx.f.titleFont2, 700)}font-size:3.2cqw;letter-spacing:.2em;text-transform:uppercase;color:#525252;margin-bottom:2cqw`, ctx.kit.handle))
      el.append(h('div', `${font(ctx.f.titleFont, 400)}font-size:10cqw;line-height:1;color:#0A0A0A`, `${S.hook[0]} ${S.hook[1]}`))
      ctx.front.append(el)
      return (t) => {
        const p = ease(ramp(t, 0.1, 0.5)) * (1 - ease(ramp(t, ctx.hookFor || 3, 0.45)))
        el.style.transform = `translateY(${(p - 1) * 100}%)`
        return { camY: p * 0.2 }
      }
    },

    /* Words */
    W1(ctx) {
      const pos = wordsY(ctx)
      const el = h('div', `position:absolute;left:0;right:0;top:${pos.y * 100}cqh;translate:0 -50%;text-align:center;${font(ctx.f.captionFont, 800)}font-size:11cqw;line-height:1;text-transform:uppercase;${shadow}`)
      ctx.front.append(el)
      let last = -2
      return (t) => {
        const i = wordAt(t), w = S.words[i]
        const live = w && t < w[2] + 0.35
        if (i !== last) { el.textContent = live ? strip(w[0]) : ''; last = i }
        if (!live) { el.textContent = ''; last = -2; return }
        el.style.color = w[3] ? ctx.c.accent : ctx.c.caption
        el.style.transform = `scale(${0.82 + 0.18 * back(ramp(t, w[1] - 0.04, 0.14))})`
      }
    },
    W2(ctx) {
      const pos = wordsY(ctx)
      const el = h('div', `position:absolute;left:${pos.side ? 4 : 9}cqw;right:${pos.side ? 54 : 9}cqw;top:${pos.y * 100}cqh;translate:0 -50%;text-align:${pos.side ? 'left' : 'center'};${font(ctx.f.captionFont, 800)}font-size:6.4cqw;line-height:1.15;${shadow}`)
      ctx.front.append(el)
      let shown = -1, spans = []
      return (t) => {
        const ph = phraseAt(t)
        if (!ph) { el.textContent = ''; shown = -1; return }
        if (ph.p !== shown) {
          el.textContent = ''
          spans = S.words.slice(ph.from, ph.to + 1).map((w) => { const s = h('span', '', w[0] + ' '); el.append(s); return s })
          shown = ph.p
        }
        spans.forEach((s, k) => { s.style.color = ph.from + k === ph.cur ? ctx.c.accent : ctx.c.caption })
      }
    },
    W3(ctx) {
      const pos = wordsY(ctx)
      const el = h('div', `position:absolute;left:${pos.side ? 4 : 10}cqw;right:${pos.side ? 54 : 10}cqw;top:${pos.y * 100}cqh;translate:0 -50%;text-align:${pos.side ? 'left' : 'center'};color:${ctx.c.caption};${font(ctx.f.captionFont, 500)}font-size:5.4cqw;line-height:1.25;${shadow}`)
      ctx.front.append(el)
      let shown = -1
      return (t) => {
        const ph = phraseAt(t)
        if (!ph) { el.style.opacity = 0; return }
        if (ph.p !== shown) { el.textContent = S.words.slice(ph.from, ph.to + 1).map((w) => w[0]).join(' '); shown = ph.p }
        el.style.opacity = ease(ramp(t, ph.start - 0.05, 0.3)) * (1 - ramp(t, ph.end - 0.2, 0.2))
      }
    },
    W4(ctx) {
      const pos = wordsY(ctx)
      const el = h('div', `position:absolute;left:8cqw;right:8cqw;top:${pos.y * 100}cqh;translate:0 -50%;text-align:center;${shadow}`)
      ctx.front.append(el)
      let shown = -1, spans = []
      return (t) => {
        const ph = phraseAt(t)
        if (!ph) { el.textContent = ''; shown = -1; return }
        if (ph.p !== shown) {
          el.textContent = ''
          spans = S.words.slice(ph.from, ph.to + 1).map((w) => {
            const big = !!w[3]
            const s = h('span', `display:${big ? 'block' : 'inline-block'};margin:0 .7cqw;color:${big ? ctx.c.accent : ctx.c.caption};${font(big ? ctx.f.titleFont2 : ctx.f.captionFont, big ? 900 : 500)}font-size:${big ? 12 : 5}cqw;line-height:${big ? 1 : 1.3};text-transform:${big ? 'uppercase' : 'lowercase'}`, strip(w[0]))
            el.append(s); return s
          })
          shown = ph.p
        }
        spans.forEach((s, k) => { const p = ramp(t, S.words[ph.from + k][1] - 0.05, 0.14); s.style.opacity = p; s.style.transform = `scale(${0.85 + 0.15 * back(p)})` })
      }
    },
    W5(ctx) {
      const pos = wordsY(ctx)
      const el = h('div', `position:absolute;left:9cqw;right:9cqw;top:${pos.y * 100}cqh;translate:0 -50%;text-align:center;${font(ctx.f.captionFont, 700)}font-size:6.4cqw;line-height:1.5;${shadow}`)
      ctx.front.append(el)
      let shown = -1, spans = []
      return (t) => {
        const ph = phraseAt(t)
        if (!ph) { el.textContent = ''; shown = -1; return }
        if (ph.p !== shown) {
          el.textContent = ''
          spans = S.words.slice(ph.from, ph.to + 1).map((w) => {
            const s = h('span', `display:inline-block;margin:0 .6cqw;padding:${w[3] ? '.2cqw 2.2cqw' : '0'};border-radius:99cqw;color:${w[3] ? '#0A0A0A' : ctx.c.caption};background:${w[3] ? ctx.c.accent : 'transparent'};text-shadow:${w[3] ? 'none' : ''}`, strip(w[0]))
            el.append(s); return s
          })
          shown = ph.p
        }
        spans.forEach((s, k) => { const p = ramp(t, S.words[ph.from + k][1] - 0.05, 0.12); s.style.opacity = p; s.style.transform = `scale(${0.7 + 0.3 * back(p)})` })
      }
    },
    W6(ctx) {
      const pos = wordsY(ctx)
      const el = h('div', `position:absolute;left:6cqw;right:6cqw;top:${pos.y * 100}cqh;translate:0 -50%;text-align:center;color:${ctx.c.caption};${shadow}`)
      const small = h('div', `${font(ctx.f.captionFont, 600)}font-size:3.2cqw;letter-spacing:.28em;text-transform:uppercase;margin-bottom:1cqw`)
      const mask = h('div', 'overflow:hidden;padding:0 2cqw .8cqw')
      const big = h('div', `${font(ctx.f.titleFont, 400)}font-style:italic;font-size:13cqw;line-height:1.05;color:${ctx.c.accent}`)
      mask.append(big); el.append(small, mask)
      ctx.front.append(el)
      let shown = -1, keyAt = 0
      return (t) => {
        const ph = phraseAt(t)
        if (!ph) { el.style.opacity = 0; return }
        if (ph.p !== shown) {
          const ws = S.words.slice(ph.from, ph.to + 1)
          let k = ws.findIndex((w) => w[3]); if (k < 0) k = ws.length - 1
          small.textContent = ws.filter((_, i) => i !== k).map((w) => strip(w[0])).join(' ')
          big.textContent = strip(ws[k][0]).toLowerCase()
          keyAt = ws[k][1]; shown = ph.p
        }
        el.style.opacity = ramp(t, ph.start - 0.05, 0.2) * (1 - ramp(t, ph.end - 0.2, 0.2))
        big.style.transform = `translateY(${(1 - ease(ramp(t, keyAt - 0.08, 0.35))) * 110}%)`
      }
    },
    W7() { return () => {} },

    /* Captions, v1: one configurable style. `ctx.cap` = { layout: 'word' |
       'phrase' | 'line', highlight: 'none' | 'marker' | 'box' | 'color' |
       'underline', size (1 = default), case: 'normal' | 'upper' | 'lower' }.
       The box follows the word being said; the other highlights mark the
       line's keyword. */
    CAP(ctx) {
      const cap = { layout: 'phrase', highlight: 'marker', size: 1, case: 'normal', ...(ctx.cap || {}) }
      const pos = wordsY(ctx)
      const big = cap.layout === 'word'
      const el = h('div', `position:absolute;left:${pos.side ? 4 : 7}cqw;right:${pos.side ? 50 : 7}cqw;top:${pos.y * 100}cqh;translate:0 -50%;text-align:${pos.side ? 'left' : 'center'};${font(ctx.f.captionFont, 800)}font-size:${(big ? 10.5 : 6.4) * (cap.size || 1)}cqw;line-height:1.24;color:${ctx.c.caption};text-transform:${cap.case === 'upper' ? 'uppercase' : cap.case === 'lower' ? 'lowercase' : 'none'};${shadow}`)
      ctx.front.append(el)
      const acc = ctx.c.accent, onAcc = inkOn(acc)
      const span = (txt) => h('span', 'display:inline-block;margin:0 .06em;padding:0 .14em;border-radius:.2em', txt)
      function paint(s, w, t, isCur) {
        const hl = cap.highlight, isKey = !!w[3]
        s.style.background = 'none'; s.style.color = ''; s.style.textShadow = ''
        if (hl === 'box' && isCur) { s.style.background = acc; s.style.color = onAcc; s.style.textShadow = 'none' }
        else if (isKey && hl === 'color') s.style.color = acc
        else if (isKey && hl === 'marker') {
          const p = ease(ramp(t, w[1] - 0.05, 0.3))
          s.style.background = `linear-gradient(${acc},${acc}) no-repeat 0 55% / ${p * 100}% 76%`
          if (p > 0.5) { s.style.color = onAcc; s.style.textShadow = 'none' }
        } else if (isKey && hl === 'underline') {
          const p = ease(ramp(t, w[1] - 0.05, 0.3))
          s.style.background = `linear-gradient(${acc},${acc}) no-repeat 0 98% / ${p * 100}% .13em`
        }
      }
      let shown = -2, spans = []
      return (t) => {
        if (big) {
          const i = wordAt(t), w = S.words[i]
          if (!w || t > w[2] + 0.35) { el.textContent = ''; shown = -2; return }
          if (i !== shown) { el.textContent = ''; spans = [span(strip(w[0]))]; el.append(spans[0]); shown = i }
          spans[0].style.transform = `scale(${0.82 + 0.18 * back(ramp(t, w[1] - 0.04, 0.14))})`
          return paint(spans[0], w, t, true)
        }
        const ph = phraseAt(t)
        if (!ph) { el.textContent = ''; shown = -2; return }
        if (ph.p !== shown) {
          el.textContent = ''
          spans = S.words.slice(ph.from, ph.to + 1).map((w) => { const s = span(w[0]); el.append(s); return s })
          shown = ph.p
        }
        spans.forEach((s, k) => {
          const w = S.words[ph.from + k], p = ramp(t, w[1] - 0.05, 0.12)
          s.style.opacity = cap.layout === 'line' || p > 0 ? 1 : 0
          if (cap.layout === 'phrase') s.style.transform = `translateY(${(1 - ease(p)) * 0.25}em)`
          paint(s, w, t, ph.from + k === ph.cur)
        })
      }
    },

    /* Frame */
    F1() { return () => {} },
    F2(ctx) {
      const el = h('div', 'position:absolute;left:0;right:0;top:0;height:50cqh;overflow:hidden;border-bottom:.6cqw solid #0A0A0A')
      el.append(proofOr(ctx, false))
      ctx.front.append(el)
      return () => ({ camY: 0.06 })
    },
    F3(ctx) {
      const el = h('div', `position:absolute;left:0;right:0;top:0;height:34cqh;background:#F4EDE1;display:grid;align-content:end;padding:0 8cqw 4cqw`)
      el.append(h('div', `${font(ctx.f.titleFont, 400)}font-size:8cqw;line-height:1.05;color:#0A0A0A`, ctx.quote || '“Every motion is added by Claude.”'))
      el.append(h('div', `${font(ctx.f.captionFont, 600)}font-size:3cqw;margin-top:2cqw;color:#525252`, ctx.kit.handle))
      ctx.front.append(el)
      return () => ({ camY: 0.08 })
    },
    F4(ctx) {
      const scr = h('div', 'position:absolute;inset:0;z-index:0'); scr.append(proofOr(ctx, true))
      ctx.front.append(scr)
      const card = h('div', 'position:absolute;right:6cqw;bottom:27cqh;width:34cqw;height:44cqw;background:#FFFFFF;padding:1.6cqw 1.6cqw 6cqw;rotate:4deg;box-shadow:0 2cqw 5cqw rgba(0,0,0,.4)')
      const cv = shotCanvas(ctx, 240, 280, [0.2, 0.5, 0.64, 0.42])
      card.append(cv.el); ctx.front.append(card)
      return () => { cv.draw() }
    },
    F5(ctx) {
      const wrap = h('div', 'position:absolute;inset:0;background:#F5F5F5')
      const mk = (label, css, filter) => {
        const c = h('div', `position:absolute;${css};border-radius:2.4cqw;overflow:hidden;box-shadow:0 1.6cqw 4cqw rgba(0,0,0,.18);background:#000`)
        const cv = shotCanvas(ctx, 270, 480)
        cv.el.style.filter = filter
        c.append(cv.el, h('div', `position:absolute;left:2cqw;top:2cqw;background:#FFFFFF;color:#0A0A0A;border-radius:99cqw;padding:.6cqw 2.2cqw;${font('Inter Tight', 700)}font-size:3cqw`, label))
        wrap.append(c); return cv
      }
      const a = mk('Before', 'left:5cqw;top:30cqh;width:32cqw;height:57cqw', 'grayscale(.4) brightness(.9)')
      const b = mk('After', 'left:41cqw;top:18cqh;width:54cqw;height:96cqw', 'none')
      wrap.append(h('div', `position:absolute;left:0;right:0;top:${(A.safeZone.top + 0.005) * 100}cqh;text-align:center;${font(ctx.f.titleFont, 400)}font-style:italic;font-size:8cqw;color:#0A0A0A`, 'Edited by Claude'))
      ctx.front.append(wrap)
      return () => { a.draw(); b.draw() }
    },

    /* Effects */
    E1(ctx) {
      ctx.needCut = true
      const n = 8, cards = []
      for (let i = 0; i < n; i++) {
        const pair = [ctx.behind, ctx.front].map((layer) => {
          const c = h('div', 'position:absolute;left:0;top:0;width:13cqw;height:23cqw;border-radius:2cqw;overflow:hidden;border:.5cqw solid #FFFFFF;box-shadow:0 1cqw 3cqw rgba(0,0,0,.35);background:#262626')
          /* The creator's own moments when the edit passes them (the skill
             takes stills from across the video); else tinted copies. */
          let cv
          if (ctx.p.images && ctx.p.images.length) {
            const im = h('img', 'width:100%;height:100%;object-fit:cover;display:block')
            im.src = ctx.p.images[i % ctx.p.images.length]
            cv = { el: im, draw: () => true }
          } else {
            cv = shotCanvas(ctx, 78, 138, [0.18, 0.36 + (i % 3) * 0.04, 0.64, 0.64])
            cv.el.style.filter = `hue-rotate(${i * 45}deg) saturate(1.3)`
          }
          c.append(cv.el); layer.append(c)
          return { c, cv }
        })
        cards.push(pair)
      }
      const cx = S.face.cx * 100, cy = (S.face.eyes - 0.04) * 100
      let drawn = false
      return (t) => {
        const p = inP(ctx, t, 0.6)
        if (!drawn) drawn = cards.every((pr) => pr.every((x) => x.cv.draw()))
        cards.forEach((pr, i) => {
          const a = (i / n) * Math.PI * 2 + t * 1.1
          const front = Math.sin(a) > 0
          const x = cx + Math.cos(a) * 40 * p, y = cy + Math.sin(a) * 9 - 6
          const s = (0.78 + 0.28 * Math.sin(a)) * p
          pr.forEach((o, k) => {
            const vis = (k === 1) === front && p > 0.01
            o.c.style.display = vis ? 'block' : 'none'
            o.c.style.transform = `translate(calc(${x}cqw - 50%), calc(${y}cqh - 50%)) scale(${s}) rotate(${Math.cos(a) * 8}deg)`
          })
        })
      }
    },
    E2(ctx) {
      ctx.needCut = true
      const dark = h('div', 'position:absolute;inset:0;background:#000')
      const glow = h('div', `position:absolute;left:${S.face.cx * 100 - 45}cqw;top:${(S.face.top - 0.16) * 100}cqh;width:90cqw;height:90cqw;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.28),rgba(255,255,255,0) 62%)`)
      const word = h('div', `position:absolute;left:0;right:0;top:${(S.face.top - 0.07) * 100}cqh;text-align:center;${font(ctx.f.titleFont2, 900)}font-size:19cqw;letter-spacing:-.03em;text-transform:uppercase;color:${ctx.c.accent};text-shadow:0 0 3cqw ${ctx.c.accent},0 0 9cqw ${ctx.c.accent}`, ctx.p.text || 'Claude')
      ctx.behind.append(dark, glow, word)
      return (t) => {
        const p = inP(ctx, t, 0.35)
        dark.style.opacity = p * 0.78; glow.style.opacity = p
        word.style.opacity = ease(ramp(t, ctx.win[0] + 0.3, 0.4)) * p
      }
    },
    E3(ctx) {
      ctx.needCut = true
      const el = h('div', `position:absolute;left:0;right:0;top:${(S.face.top - 0.07) * 100}cqh;text-align:center;${font(ctx.f.titleFont2, 900)}font-size:20cqw;line-height:.9;letter-spacing:-.05em;text-transform:uppercase;color:${ctx.c.accent}`, ctx.p.text || 'Claude')
      ctx.behind.append(el)
      return (t) => {
        const p = back(ramp(t, ctx.win[0], 0.45))
        el.style.transform = `translateY(${(1 - p) * -40}cqh)`
        el.style.opacity = ramp(t, ctx.win[0], 0.1) * (1 - ramp(t, ctx.win[1] - 0.3, 0.3))
      }
    },
    E4(ctx) {
      ctx.needCut = true
      const spots = [[8, 14, -6, '#FFFFFF'], [58, 12, 5, '#F4EDE1'], [6, 30, 4, '#F4EDE1'], [60, 30, -4, '#FFFFFF'], [30, 21, 2, ctx.c.accent]]
      const texts = ctx.p.lines || ['Edited by Claude', '28 skills', 'no CapCut', 'one prompt', 'done in 10 min']
      const notes = texts.slice(0, 5).map((txt, i) => [txt, ...spots[i]])
      const els = notes.map(([txt, x, y, r, bg]) => {
        const n = h('div', `position:absolute;left:${x}cqw;top:${y}cqh;background:${bg};color:#0A0A0A;padding:2.4cqw 3.2cqw;rotate:${r}deg;box-shadow:0 1cqw 2.4cqw rgba(0,0,0,.3);${font(ctx.f.titleFont, 400)}font-size:5.2cqw;line-height:1.1`, txt)
        n.append(h('i', 'position:absolute;left:35%;top:-1.6cqw;width:30%;height:3.2cqw;background:rgba(255,255,255,.55);rotate:-3deg'))
        ctx.behind.append(n); return n
      })
      return (t) => {
        const span = ctx.win[1] - ctx.win[0] - 0.6
        els.forEach((n, i) => {
          const p = back(ramp(t, ctx.win[0] + (i * span) / els.length / 1.6, 0.25))
          n.style.opacity = clamp01(p * 2) * (1 - ramp(t, ctx.win[1] - 0.3, 0.3))
          n.style.transform = `scale(${0.6 + 0.4 * p})`
        })
      }
    },
    E5(ctx) {
      const steps = ctx.p.lines || ['Cut the pauses', 'Add the captions', 'Render the reel']
      const card = h('div', `position:absolute;left:12cqw;right:12cqw;top:${(S.face.top - 0.33) * 100}cqh;background:rgba(10,10,10,.86);border-radius:3cqw;padding:3.6cqw 4.4cqw;color:#FFFFFF;${font('Inter Tight', 600)}font-size:4.4cqw;display:grid;gap:2.4cqw;box-shadow:0 2cqw 5cqw rgba(0,0,0,.35)`)
      const ticks = steps.map((s) => {
        const row = h('div', 'display:flex;align-items:center;gap:2.6cqw')
        const box = h('span', 'width:5cqw;height:5cqw;border-radius:50%;border:.5cqw solid rgba(255,255,255,.5);display:grid;place-items:center;font-size:3.2cqw;color:#FFFFFF;flex:none')
        const label = h('span', '', s)
        row.append(box, label); card.append(row); return { box, label }
      })
      ctx.front.append(card)
      return (t) => {
        const p = inP(ctx, t, 0.35)
        card.style.opacity = p; card.style.transform = `translateY(${(1 - p) * 3}cqh)`
        const span = ctx.win[1] - ctx.win[0]
        ticks.forEach((k, i) => {
          const done = t > ctx.win[0] + span * (0.25 + i * 0.22)
          k.box.style.background = done ? '#34C759' : 'transparent'
          k.box.style.borderColor = done ? '#34C759' : 'rgba(255,255,255,.5)'
          k.box.textContent = done ? '✓' : ''
          k.label.style.opacity = done ? 1 : 0.6
        })
      }
    },
    E6(ctx) {
      ctx.needCut = true
      const glass = 'position:absolute;background:rgba(255,255,255,.16);backdrop-filter:blur(2.4cqw) saturate(1.4);-webkit-backdrop-filter:blur(2.4cqw) saturate(1.4);border:.4cqw solid rgba(255,255,255,.45);border-radius:4cqw;color:#FFFFFF;box-shadow:0 2cqw 5cqw rgba(0,0,0,.2)'
      const big = h('div', `${glass};left:8cqw;top:${(S.face.top - 0.3) * 100}cqh;padding:3cqw 5cqw;${font('Inter Tight', 800)}`)
      big.append(h('div', 'font-size:14cqw;line-height:1', ctx.p.text || '28'), h('div', 'font-size:3.4cqw;font-weight:600;opacity:.85', ctx.p.label || 'editing skills'))
      const bars = h('div', `${glass};right:8cqw;top:${(S.face.top - 0.33) * 100}cqh;width:30cqw;height:24cqw;display:flex;align-items:end;gap:2cqw;padding:3cqw`)
      const bs = [40, 65, 52, 88].map((v) => { const b = h('i', `flex:1;background:${ctx.c.accent};border-radius:1cqw;height:${v}%`); bars.append(b); return b })
      const pill = h('div', `${glass};left:50%;translate:-50% 0;top:${(S.face.top - 0.1) * 100}cqh;border-radius:99cqw;padding:1.6cqw 4cqw;white-space:nowrap;${font('Inter Tight', 700)}font-size:3.8cqw`, ctx.p.pill || 'Edited by Claude')
      ctx.behind.append(big, bars, pill)
      return (t) => {
        ;[big, bars, pill].forEach((el, i) => { const p = back(ramp(t, ctx.win[0] + i * 0.18, 0.4)) * (1 - ramp(t, ctx.win[1] - 0.3, 0.3)); el.style.opacity = clamp01(p); el.style.scale = 0.7 + 0.3 * p })
        const g = ease(ramp(t, ctx.win[0] + 0.4, 0.8))
        bs.forEach((b) => { b.style.transform = `scaleY(${g})`; b.style.transformOrigin = 'bottom' })
      }
    },
    E7(ctx) {
      ctx.needCut = true
      const mast = h('div', `position:absolute;left:0;right:0;top:${(A.safeZone.top + 0.005) * 100}cqh;text-align:center;${font(ctx.f.titleFont, 400)}font-size:31cqw;line-height:.85;letter-spacing:-.03em;color:${ctx.c.title}`, ctx.p.text || 'EDIT')
      const issue = h('div', `position:absolute;left:0;right:0;top:${(A.safeZone.top - 0.025) * 100}cqh;text-align:center;${font('Inter Tight', 700)}font-size:2.8cqw;letter-spacing:.3em;color:${ctx.c.title}`, ctx.p.issue || 'ISSUE 01 · OCTOBER 2026')
      const lines = h('div', `position:absolute;left:5cqw;top:${(S.face.top + 0.02) * 100}cqh;width:26cqw;display:grid;gap:2.4cqw;color:${ctx.c.title};${shadow}`)
      ;(ctx.p.lines ? ctx.p.lines.map((x) => x.split('::')) : [['28', 'skills inside'], ['10', 'minute reels'], ['0', 'CapCut']]).forEach(([n, l]) => {
        const r = h('div', `${font(ctx.f.titleFont2, 800)}font-size:3.6cqw;line-height:1.1`)
        r.append(h('div', `${font(ctx.f.titleFont, 400)}font-size:9cqw;line-height:.9`, n), document.createTextNode(l))
        lines.append(r)
      })
      ctx.behind.append(mast); ctx.front.append(issue, lines)
      return (t) => {
        const p = inP(ctx, t, 0.5)
        mast.style.opacity = p; mast.style.transform = `translateY(${(1 - p) * 3}cqh)`
        issue.style.opacity = p; lines.style.opacity = ease(ramp(t, ctx.win[0] + 0.4, 0.4)) * p
      }
    },
    E8(ctx) {
      const card = h('div', `position:absolute;left:10cqw;right:10cqw;top:${(S.face.top - 0.36) * 100}cqh;background:rgba(255,255,255,.18);backdrop-filter:blur(2.4cqw) saturate(1.4);-webkit-backdrop-filter:blur(2.4cqw) saturate(1.4);border:.4cqw solid rgba(255,255,255,.45);border-radius:4cqw;padding:3.4cqw 4.4cqw;color:#FFFFFF;${font('Inter Tight', 700)}`)
      card.append(h('div', 'font-size:3.4cqw;opacity:.85', ctx.p.label || 'Views this week'))
      const to = /^([\d.]+)(.*)$/.exec(ctx.p.to || '197K') || [0, 197, 'K']
      to[1] = +to[1]
      const num = h('div', 'font-size:12cqw;line-height:1;font-weight:800;font-variant-numeric:tabular-nums', '0')
      card.append(num)
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 100 30'); svg.style.cssText = 'width:100%;height:12cqw;display:block;margin-top:1.4cqw;overflow:visible'
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
      path.setAttribute('points', '0,27 14,24 28,25 42,19 56,20 70,12 84,9 100,1')
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', ctx.c.accent); path.setAttribute('stroke-width', '2.2'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round')
      path.setAttribute('pathLength', '1'); path.style.strokeDasharray = '1'
      svg.append(path); card.append(svg)
      ctx.front.append(card)
      return (t) => {
        const p = inP(ctx, t, 0.4)
        card.style.opacity = p; card.style.scale = 0.9 + 0.1 * p
        const g = ease(ramp(t, ctx.win[0] + 0.3, 1.6))
        path.style.strokeDashoffset = 1 - g
        num.textContent = (to[1] % 1 ? (to[1] * g).toFixed(1) : Math.round(to[1] * g)) + to[2]
      }
    },
    E9(ctx) {
      const card = h('div', `position:absolute;left:9cqw;right:9cqw;top:${(S.face.top - 0.27) * 100}cqh;background:#FFFFFF;border-radius:99cqw;padding:2cqw 2.4cqw 2cqw 3cqw;display:flex;align-items:center;gap:2.4cqw;box-shadow:0 2cqw 5cqw rgba(0,0,0,.3);${font('Inter Tight', 600)}font-size:5cqw;color:#0A0A0A`)
      const ring = h('i', 'width:8cqw;height:8cqw;border-radius:50%;flex:none;background:conic-gradient(#FEDA75,#FA7E1E,#D62976,#962FBF,#4F5BD5,#FEDA75);padding:.6cqw;background-clip:padding-box')
      const txt = h('span', 'flex:1;white-space:nowrap;overflow:hidden')
      const send = h('span', 'background:#0095F6;color:#FFFFFF;border-radius:99cqw;padding:1.2cqw 3.4cqw;font-size:3.8cqw;font-weight:700', 'Post')
      card.append(ring, txt, send)
      const bubble = h('div', `position:absolute;left:14cqw;top:${(S.face.top - 0.38) * 100}cqh;background:#FFFFFF;border-radius:4cqw;padding:2.2cqw 3.6cqw;${font('Inter Tight', 700)}font-size:4.6cqw;color:#0A0A0A;box-shadow:0 1.6cqw 4cqw rgba(0,0,0,.3)`)
      bubble.innerHTML = `<span style="opacity:.55;font-weight:600">${ctx.kit.handle}</span> ${ctx.kit.cta} ❤️`
      ctx.front.append(card, bubble)
      const word = 'Comment ' + ctx.kit.cta
      return (t) => {
        const p = inP(ctx, t, 0.35)
        card.style.opacity = p; card.style.scale = 0.85 + 0.15 * back(ramp(t, ctx.win[0], 0.4))
        const span = ctx.win[1] - ctx.win[0]
        const n = Math.round(word.length * ramp(t, ctx.win[0] + 0.4, span * 0.4))
        txt.innerHTML = n <= 8 ? word.slice(0, n) : `Comment <b style="background:linear-gradient(90deg,#FA7E1E,#D62976,#4F5BD5);-webkit-background-clip:text;color:transparent">${word.slice(8, n)}</b>`
        const posted = ramp(t, ctx.win[0] + span * 0.62, 0.3)
        send.style.transform = `scale(${1 - 0.12 * Math.sin(posted * Math.PI)})`
        bubble.style.opacity = back(posted) * p; bubble.style.transform = `translateY(${(1 - posted) * 3}cqh)`
      }
    },
    E10(ctx) {
      const el = h('div', `position:absolute;left:50%;translate:-50% 0;top:${(S.face.top - 0.2) * 100}cqh;background:#FFFFFF;border-radius:99cqw;padding:1.6cqw 1.6cqw 1.6cqw 1.6cqw;display:flex;align-items:center;gap:2.4cqw;box-shadow:0 2cqw 5cqw rgba(0,0,0,.3);${font('Inter Tight', 700)}font-size:4.2cqw;color:#0A0A0A;white-space:nowrap`)
      const av = h('div', 'width:9cqw;height:9cqw;border-radius:50%;overflow:hidden;flex:none')
      const cv = shotCanvas(ctx, 60, 60, [0.3, 0.55, 0.42, 0.24]); av.append(cv.el)
      const btn = h('span', 'border-radius:99cqw;padding:1.4cqw 4cqw;transition:none')
      el.append(av, h('span', '', ctx.kit.handle), btn)
      ctx.front.append(el)
      let drawn = false
      return (t) => {
        if (!drawn) drawn = cv.draw()
        const p = inP(ctx, t, 0.35)
        el.style.opacity = p; el.style.scale = 0.8 + 0.2 * back(ramp(t, ctx.win[0], 0.4))
        const flip = t > ctx.win[0] + (ctx.win[1] - ctx.win[0]) * 0.5
        btn.textContent = flip ? 'Following' : 'Follow'
        btn.style.background = flip ? '#EFEFEF' : '#0095F6'
        btn.style.color = flip ? '#0A0A0A' : '#FFFFFF'
      }
    },

    /* Motion: return a camera move; the shot and the cutout both follow it. */
    M1() { return (t) => { const ph = phraseAt(t); return { zoom: ph && ph.p % 2 ? 1.13 : 1 } } },
    M2() { return (t) => ({ zoom: 1 + 0.12 * ease(t / S.length) }) },
    M3() { return (t) => { const ph = phraseAt(t); return { zoom: ph && ph.p % 2 ? 1.38 : 1 } } },
    M4() { return () => ({ zoom: 1 }) },
  }

  /* ── Stage ─────────────────────────────────────────── */
  const CARDS = new Set(['E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10'])
  function codeGroup(code) { return code.replace(/\d+$/, '') }
  function styleDef(code) {
    for (const g of A.groups) for (const it of g.items) if (it.code === code) return it
    return null
  }

  function mount(stage, state, opts = {}) {
    stage.classList.add('ayr-stage')
    stage.textContent = ''
    if (opts.project) S = opts.project
    /* Several stages can be on one page with different projects (the
       editor's preview and its thumbnail); each one puts its own back
       before it draws. */
    let proj = S
    const useClip = opts.media === 'clip', frames = opts.media === 'frames'
    const cam = h('div', 'position:absolute;inset:0;will-change:transform')
    /* The editor hands in its own playing video and a live cut-out canvas. */
    const media = opts.mediaEl || (useClip ? h('video') : h('img'))
    const mediaCss = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block'
    media.style.cssText = mediaCss
    if (opts.mediaEl) {}
    else if (useClip) { Object.assign(media, { muted: true, playsInline: true, loop: true, preload: 'auto', src: S.clip }); media.muted = true }
    else if (!frames && (opts.still || S.still)) media.src = opts.still || S.still
    const behind = h('div', 'position:absolute;inset:0;overflow:hidden')
    const cut = opts.cutEl || (useClip ? h('video') : h('img'))
    cut.style.cssText = mediaCss + ';display:none'
    if (opts.cutEl) {}
    else if (useClip) { Object.assign(cut, { muted: true, playsInline: true, loop: true, preload: 'auto', src: S.cutoutClip }); cut.muted = true }
    else if (!frames && (opts.cutStill || S.cutoutStill)) cut.src = opts.cutStill || S.cutoutStill
    cam.append(media)
    const camCut = h('div', 'position:absolute;inset:0;will-change:transform')
    camCut.append(cut)
    const vig = h('div', 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 55%,rgba(0,0,0,0) 45%,rgba(0,0,0,.85) 100%);opacity:0')
    const front = h('div', 'position:absolute;inset:0;overflow:hidden')
    const safe = h('div', 'position:absolute;inset:0;pointer-events:none;display:none')
    const z = A.safeZone
    safe.append(
      h('div', `position:absolute;left:0;right:0;top:0;height:${z.top * 100}%;background:rgba(229,72,77,.28)`),
      h('div', `position:absolute;left:0;right:0;bottom:0;height:${z.bottom * 100}%;background:rgba(229,72,77,.28)`),
      h('div', `position:absolute;right:0;top:${z.rightFrom * 100}%;bottom:${z.bottom * 100}%;width:${z.rightLower * 100}%;background:rgba(229,72,77,.28)`),
    )
    stage.append(cam, behind, camCut, vig, front, safe)

    let fns = [], ctx, events = []
    const fxList = (st) => st.fx || (st.picks.E || []).map((code) => ({ code }))
    function set(st) {
      state = st
      S = proj
      behind.textContent = ''; front.textContent = ''
      const kit = st.kit
      ctx = {
        kit, c: kit.colours, f: kit, entrance: st.entrance, caption: st.caption,
        hookFor: st.hookFor || 3, cap: st.captions,
        behind, front, media, needCut: false, p: {}, quote: st.quote, proof: st.proof,
        bigWord: st.picks.O === 'O3' || fxList(st).some((x) => x.code === 'E2' || x.code === 'E3'), notes: new Set(), win: [0.6, S.length - 0.6],
      }
      events = []
      if (st.picks.O) events.push({ t: 0.05, code: st.picks.O })
      const p = st.picks
      const codes = [p.F, p.M, p.O].filter(Boolean)
      fns = codes.map((c) => MAKE[c] && MAKE[c](ctx)).filter(Boolean)
      /* Words wait for the opening title to leave, so the two never share
         the wall; the title already says the hook. */
      /* v1 captions (st.captions) replace the older W styles when set. */
      const wordsStyle = st.captions ? (st.captions.on === false ? null : 'CAP') : p.W
      if (wordsStyle && MAKE[wordsStyle]) {
        const w = MAKE[wordsStyle](ctx), from = p.O ? ctx.hookFor + 0.4 : 0
        /* Cards that take the open wall above the head pause the words too. */
        const busy = fxList(st).filter((x) => CARDS.has(x.code) && x.start != null).map((x) => [x.start - 0.15, x.end + 0.1])
        fns.push((t) => w(t < from || busy.some(([a, b]) => t >= a && t <= b) ? -1 : t))
      }
      /* Effects at their own times when the edit gives them; otherwise
         they share the middle of the clip, after the opening title. */
      const fx = fxList(st).filter((x) => MAKE[x.code])
      const a = p.O && !opts.single ? 3.1 : 0.6, b = S.length - 0.4
      fx.forEach((x, i) => {
        const n = fx.length, w = (b - a) / n
        const sub = Object.create(ctx)
        sub.win = x.start != null ? [x.start, x.end] : [a + i * w, a + (i + 1) * w - 0.1]
        sub.p = x
        const f = MAKE[x.code](sub)
        if (sub.needCut) ctx.needCut = true
        fns.push(f)
        events.push({ t: sub.win[0], code: x.code })
      })
      const g = styleDef(p.G || 'G0') || {}
      media.style.filter = g.filter || 'none'
      cut.style.filter = g.filter || 'none'
      vig.style.opacity = g.vignette || 0
      cut.style.display = ctx.needCut ? 'block' : 'none'
      if (opts.onNotes) opts.onNotes([...ctx.notes])
    }
    function at(t) {
      S = proj
      let zoom = 1, camY = 0
      for (const f of fns) {
        const r = f(t)
        if (r && r.zoom) zoom = r.zoom
        if (r && r.camY) camY = r.camY
      }
      const tf = `translateY(${camY * 100}%) scale(${zoom})`
      const origin = `${S.face.cx * 100}% ${S.face.eyes * 100}%`
      cam.style.transform = tf; cam.style.transformOrigin = origin
      camCut.style.transform = tf; camCut.style.transformOrigin = origin
    }
    set(state)
    return {
      at, set, media, cut,
      /* New words or timings after a cut; call set() afterwards to redraw. */
      setProject(p) { proj = p; S = p },
      /* When each picture appears, for the "sound when a picture appears". */
      get events() { return events },
      get needsCutout() { return ctx.needCut },
      showSafe(v) { safe.style.display = v ? 'block' : 'none' },
      get state() { return state },
    }
  }

  window.AYR = { mount, styleDef, codeGroup, wordAt, phraseAt }
})()
