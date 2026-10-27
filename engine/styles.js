/*
 * AY Video Editor: the v1 style catalogue.
 *
 * One source of truth for every choice the editor offers: the styles (by
 * group, each with a short code the skill and the edit file both use), the
 * five looks, the brand kit defaults, fonts, colours, entrances, caption
 * positions and sounds. The editor UI, the review page and the skill all read
 * this file; nothing about a style is written down anywhere else.
 *
 * Codes: O opening · W words · F frame · E effects · M motion · G grade.
 * Sound has no codes: it is two plain settings (picture sound, music mood).
 *
 * `engine` says what renders a style in the final video:
 *   'hf' = HyperFrames HTML over the footage
 *   'fx' = the face-tracked effects engine (needs the person cut out)
 *   'ff' = ffmpeg alone (cuts, zooms, grades)
 * `behind: true` means the style draws between the room and the person, so it
 * needs the cutout.
 */
window.AY = {
  version: '2026-10-26',

  /* The demo clip the review page plays: 8 s of Ritu, words re-timed from the
     real transcript (Whisper heard "Claude" as "cloud"; fixed here). Face
     positions are fractions of the frame height, measured on the still. */
  sample: {
    still: 'sample/still.jpg',
    clip: 'sample/clip.mp4',
    cutoutStill: 'sample/cutout.png',
    cutoutClip: 'sample/cutout.webm',
    length: 8,
    face: { top: 0.55, eyes: 0.66, chin: 0.8, cx: 0.52 },
    hook: ['Claude edits', 'my videos now'],
    words: [
      ['This', 0.05, 0.29], ['whole', 0.35, 0.55], ['video', 0.57, 0.81], ['is', 0.87, 1.13],
      ['edited', 1.33, 1.77], ['by', 1.8, 1.95], ['Claude.', 1.95, 2.43, 'key'],
      ['Every', 2.55, 2.71], ['motion,', 2.79, 3.23], ['transition,', 3.25, 3.95], ['animation,', 4.11, 4.65],
      ['everything', 4.73, 5.01, 'key'], ['is', 5.03, 5.08], ['added', 5.16, 5.44], ['by', 5.5, 5.66], ['Claude', 5.68, 6.22, 'key'],
      ['and', 6.44, 6.54], ["it's", 6.68, 6.88], ['very', 6.9, 7.16], ['simple', 7.2, 7.5, 'key'], ['to', 7.56, 7.68], ['edit.', 7.74, 7.94],
    ],
    /* Phrase breaks for line-based caption styles: index of each phrase's first word. */
    phrases: [0, 4, 7, 11, 16],
  },

  /* ── Brand kit ─────────────────────────────────────────
     What a creator sets once and every look then wears. Colours are the
     creator's own, not the site's palette: they paint the video. */
  kit: {
    name: 'Your name',
    handle: '@yourname',
    cta: 'EDIT',
    titleFont: 'Instrument Serif',
    titleFont2: 'Inter Tight',
    captionFont: 'Inter Tight',
    colours: { title: '#FFFFFF', accent: '#FFD400', caption: '#FFFFFF', box: '#0A0A0A' },
  },

  /* Swatches offered for any colour in the kit. */
  swatches: ['#FFFFFF', '#F4EDE1', '#0A0A0A', '#FFD400', '#FF9900', '#E5484D', '#F6B7C9', '#B9A6F2', '#7FB2E5', '#2BB3A3', '#3F7A4F', '#C98B4E'],

  /* Google Fonts, all under the SIL Open Font Licence. `note` is the one-word
     feel shown under the name, so a creator who knows no type can choose. */
  fonts: {
    serif: [
      { name: 'Instrument Serif', note: 'soft, italic', italic: true },
      { name: 'Playfair Display', note: 'magazine' },
      { name: 'Cormorant Garamond', note: 'fine, bookish' },
      { name: 'Bodoni Moda', note: 'fashion' },
      { name: 'DM Serif Display', note: 'bold' },
      { name: 'Fraunces', note: 'warm' },
      { name: 'EB Garamond', note: 'literary' },
    ],
    sans: [
      { name: 'Inter Tight', note: 'clean' },
      { name: 'Montserrat', note: 'rounder' },
      { name: 'DM Sans', note: 'soft' },
      { name: 'Poppins', note: 'friendly' },
      { name: 'Syne', note: 'arty' },
      { name: 'Jost', note: 'geometric' },
      { name: 'Anton', note: 'tall, loud' },
      { name: 'Archivo Black', note: 'heavy' },
    ],
    hand: [
      { name: 'Caveat', note: 'handwritten' },
      { name: 'Permanent Marker', note: 'marker' },
      { name: 'Space Mono', note: 'typewriter' },
    ],
  },

  groups: [
    {
      id: 'O', name: 'Opening', blurb: 'The first three seconds. On screen from the first frame, then out of the way.',
      items: [
        { code: 'O1', name: 'Two-weight title', engine: 'hf', what: 'A heavy sans line over a thin serif line, centred in the space above your head. Lifts away at 3 s.' },
        { code: 'O2', name: 'Solid box', engine: 'hf', what: 'The hook in one flat colour box. Gone by 3 s, then the frame is clean.' },
        { code: 'O3', name: 'Title behind you', engine: 'fx', behind: true, what: 'One huge word sits on the wall behind your head; you stay in front of it.' },
        { code: 'O4', name: 'Question on top', engine: 'hf', what: 'Your first line types itself near the top as you say it, word by word.' },
        { code: 'O5', name: 'Sticker pills', engine: 'hf', what: 'The hook as stacked white pills with a thick dark outline, slightly tilted.' },
        { code: 'O6', name: 'Headline card', engine: 'hf', what: 'A headline card slides down from the top and pushes your shot into the lower half.' },
        { code: 'O7', name: 'Highlighter title', engine: 'hf', what: 'Bold lines with a highlighter swiping behind each one, in your accent colour.' },
        { code: 'O8', name: 'Small caps + serif', engine: 'hf', what: 'A small spaced-caps line over a big italic serif line. Quiet and expensive.' },
      ],
    },
    {
      id: 'W', name: 'Words', blurb: 'How your words show up as you say them. Never over your face.',
      items: [
        { code: 'W1', name: 'One word', engine: 'hf', what: 'Big caps, one word at a time, exactly when you say it.' },
        { code: 'W2', name: 'Karaoke line', engine: 'hf', what: 'The whole line shows; each word lights up in your accent colour as you say it.' },
        { code: 'W3', name: 'Calm lines', engine: 'hf', what: 'Short sentence-case lines that fade in and out. Quiet and easy to read.' },
        { code: 'W4', name: 'Small + big keyword', engine: 'hf', what: 'Small lowercase words; the keyword of each line lands big in the accent colour.' },
        { code: 'W5', name: 'Keyword pill', engine: 'hf', what: 'Short phrases pop in word by word; the keyword sits in a solid pill.' },
        { code: 'W6', name: 'Serif punch', engine: 'hf', what: 'A tiny spaced-caps line, then the keyword in a big italic serif rising into place.' },
        { code: 'W7', name: 'No words', engine: 'hf', what: 'No captions at all. Only the title and any effects.' },
      ],
    },
    {
      id: 'F', name: 'Frame', blurb: 'How you and everything else share the screen.',
      items: [
        { code: 'F1', name: 'Full frame', engine: 'ff', what: 'Your normal shot. Graphics float in the open space above your head.' },
        { code: 'F2', name: 'Split', engine: 'ff', what: 'Proof or a screen recording on top, you on the bottom half.' },
        { code: 'F3', name: 'Top band', engine: 'hf', what: 'You in the lower two thirds, a clean band on top for quotes and screenshots.' },
        { code: 'F4', name: 'Corner narrator', engine: 'hf', what: 'Your screen is the main picture; you talk from a small tilted card in the corner.' },
        { code: 'F5', name: 'Before / after', engine: 'hf', what: 'A small labelled Before card beside a big After card, both playing.' },
      ],
    },
    {
      id: 'E', name: 'Effects', blurb: 'One-moment showpieces, 2 to 4 seconds each. One per idea, never stacked.',
      items: [
        { code: 'E1', name: 'Orbit', engine: 'fx', behind: true, what: 'Small reel cards circle your head: behind you at the top, in front at the bottom.' },
        { code: 'E2', name: 'Spotlight', engine: 'fx', behind: true, what: 'The room goes dark and you stay lit, with one glowing word behind you.' },
        { code: 'E3', name: 'Word behind you', engine: 'fx', behind: true, what: 'A giant word drops onto the wall behind your head on the word you say.' },
        { code: 'E4', name: 'Headline wall', engine: 'fx', behind: true, what: 'Headlines and notes stick onto the wall around your head, one per beat.' },
        { code: 'E5', name: 'Checklist', engine: 'hf', what: 'A small card beside your head; each step ticks green as you say it.' },
        { code: 'E6', name: 'Glass widgets', engine: 'fx', behind: true, what: 'Frosted-glass widgets float around your head with your big number.' },
        { code: 'E7', name: 'Magazine cover', engine: 'fx', behind: true, what: 'Your frame becomes a magazine cover: masthead behind your head, cover lines around you.' },
        { code: 'E8', name: 'Count-up graph', engine: 'hf', what: 'A glass card with a line that climbs while your number counts up.' },
        { code: 'E9', name: 'Comment prompt', engine: 'hf', what: 'A comment box types your keyword and posts it. For the call to action.' },
        { code: 'E10', name: 'Follow tap', engine: 'hf', what: 'A Follow button pops up and flips to Following on your last line.' },
      ],
    },
    {
      id: 'M', name: 'Motion', blurb: 'How the edit moves between and within shots.',
      items: [
        { code: 'M1', name: 'Punch-ins', engine: 'ff', what: 'A hard 110 to 115% zoom at the start of each sentence, so the shot keeps changing.' },
        { code: 'M2', name: 'Slow push', engine: 'ff', what: 'A slow drift in towards your face on longer lines. Calm and cinematic.' },
        { code: 'M3', name: 'Wide / tight', engine: 'ff', what: 'Alternate a wide and a tight framing on every sentence. Hard cuts only.' },
        { code: 'M4', name: 'Still', engine: 'ff', what: 'Almost no movement. Fewer, stronger graphics and room to breathe.' },
      ],
    },
    {
      id: 'G', name: 'Grade', blurb: 'The colour of the whole video.',
      items: [
        { code: 'G0', name: 'As filmed', engine: 'ff', what: 'No grade. The colour your phone recorded.', filter: 'none' },
        { code: 'G1', name: 'Clean light', engine: 'ff', what: 'A little brighter and cleaner, true skin tones.', filter: 'brightness(1.06) contrast(1.04) saturate(1.02)' },
        { code: 'G2', name: 'Warm film', engine: 'ff', what: 'Soft warm tone and a light vignette.', filter: 'sepia(.22) saturate(1.1) contrast(1.04) brightness(1.02)', vignette: 0.35 },
        { code: 'G3', name: 'Moody', engine: 'ff', what: 'Darker room, cooler shadows, you kept lit.', filter: 'brightness(.86) contrast(1.15) saturate(.85) hue-rotate(-6deg)', vignette: 0.55 },
        { code: 'G4', name: 'Black and white', engine: 'ff', what: 'Clean black and white with soft contrast.', filter: 'grayscale(1) contrast(1.12) brightness(1.03)' },
        { code: 'G5', name: 'Pop colour', engine: 'ff', what: 'Richer colour and a touch more contrast.', filter: 'saturate(1.35) contrast(1.08)' },
      ],
    },
  ],

  /* How a title arrives. */
  entrances: [
    { id: 'rise', name: 'Rise', note: 'slides up softly' },
    { id: 'cut', name: 'Hard cut', note: 'just appears' },
    { id: 'drop', name: 'Drop', note: 'falls in with a small twist' },
    { id: 'glow', name: 'Glow', note: 'develops out of light' },
  ],

  /* Where words sit. The editor turns these into a height from the face
     measurements, then pulls them back inside the safe zone. */
  captionPositions: [
    { id: 'above', name: 'Above your head', note: 'in the open wall' },
    { id: 'beside', name: 'Beside your face', note: 'to one side' },
    { id: 'chest', name: 'Chest height', note: 'under your chin' },
  ],

  /* Reels and TikTok cover these with their own buttons and text, in
     fractions of a 1080 x 1920 frame (top 220 px, bottom 450 px, 35 px a
     side, the right 100 px from two thirds down). */
  safeZone: { top: 0.115, bottom: 0.234, side: 0.032, rightLower: 0.093, rightFrom: 0.66 },

  sound: {
    pictureSfx: [
      { id: 'none', name: 'None' },
      { id: 'double-click', name: 'Double click' },
      { id: 'click', name: 'Single click' },
      { id: 'soft-click', name: 'Soft click' },
      { id: 'soft-pop', name: 'Soft pop' },
      { id: 'pop', name: 'Pop' },
      { id: 'slap', name: 'Sticker slap' },
      { id: 'whoosh', name: 'Whoosh' },
    ],
    moods: ['calm', 'dreamy', 'cinematic', 'upbeat', 'warm', 'lofi', 'playful', 'focus'],
  },

  /* ── The five looks ───────────────────────────────────
     The same cut in five finished treatments. A look sets every group at
     once; the brand kit's colours and fonts still apply on top, except where
     a look names its own fonts (the creator can override those too). */
  looks: [
    {
      id: 'quiet', name: 'Quiet luxe', feel: 'calm and expensive',
      picks: { O: 'O1', W: 'W3', F: 'F1', E: [], M: 'M2', G: 'G2' },
      type: { titleFont: 'Instrument Serif', titleFont2: 'Inter Tight', captionFont: 'Inter Tight' },
      colours: { title: '#F4EDE1', accent: '#F4EDE1', caption: '#FFFFFF', box: '#0A0A0A' },
      entrance: 'glow', caption: 'above', sfx: 'soft-click', mood: 'calm',
    },
    {
      id: 'punch', name: 'Punch', feel: 'loud, words in a box',
      picks: { O: 'O2', W: 'W1', F: 'F1', E: ['E3'], M: 'M1', G: 'G5' },
      type: { titleFont: 'Archivo Black', titleFont2: 'Archivo Black', captionFont: 'Anton' },
      colours: { title: '#0A0A0A', accent: '#FFD400', caption: '#FFFFFF', box: '#FFD400' },
      entrance: 'cut', caption: 'above', sfx: 'pop', mood: 'upbeat',
    },
    {
      id: 'feed', name: 'Fast feed', feel: 'busy, something new every few seconds',
      picks: { O: 'O4', W: 'W5', F: 'F1', E: ['E1', 'E9'], M: 'M3', G: 'G1' },
      type: { titleFont: 'Inter Tight', titleFont2: 'Inter Tight', captionFont: 'Poppins' },
      colours: { title: '#FFFFFF', accent: '#FF9900', caption: '#FFFFFF', box: '#FFFFFF' },
      entrance: 'drop', caption: 'above', sfx: 'whoosh', mood: 'playful',
    },
    {
      id: 'dreamy', name: 'Dreamy', feel: 'soft and gentle',
      picks: { O: 'O1', W: 'W6', F: 'F1', E: [], M: 'M4', G: 'G1' },
      type: { titleFont: 'Cormorant Garamond', titleFont2: 'Jost', captionFont: 'Jost' },
      colours: { title: '#FFFFFF', accent: '#F6B7C9', caption: '#FFFFFF', box: '#F6B7C9' },
      entrance: 'rise', caption: 'above', sfx: 'soft-pop', mood: 'dreamy',
    },
    {
      id: 'scrapbook', name: 'Scrapbook', feel: 'handmade notes and stickers',
      picks: { O: 'O5', W: 'W4', F: 'F1', E: ['E4'], M: 'M1', G: 'G2' },
      type: { titleFont: 'Permanent Marker', titleFont2: 'Caveat', captionFont: 'Caveat' },
      colours: { title: '#0A0A0A', accent: '#E5484D', caption: '#FFFFFF', box: '#FFFFFF' },
      entrance: 'drop', caption: 'above', sfx: 'slap', mood: 'lofi',
    },
  ],
}

/* ── v1: what the guided editor offers ─────────────────
   v1 is five jobs done completely: cut, captions, hook, sounds, thumbnail.
   The other groups above stay in the catalogue but the editor hides them. */
Object.assign(window.AY, {
  /* What a creator can upload. 3 minutes is the Reels maximum; 1 GB covers
     3 minutes of 4K iPhone video. */
  limits: { maxBytes: 1024 * 1024 * 1024, maxSeconds: 180, minSeconds: 3, types: ['mp4', 'mov', 'm4v', 'webm'], musicMaxBytes: 50 * 1024 * 1024 },

  /* Hook templates offered in v1, in this order. */
  hooks: ['O1', 'O2', 'O7', 'O8', 'O5', 'O4', 'O6', 'O3'],

  captionLayouts: [
    { id: 'word', name: 'One word', note: 'big, one at a time' },
    { id: 'phrase', name: 'Phrase', note: 'words pop in as you say them' },
    { id: 'line', name: 'Full line', note: 'the whole line at once' },
  ],
  highlights: [
    { id: 'marker', name: 'Highlighter', note: 'a marker swipes behind the keyword' },
    { id: 'box', name: 'Word box', note: 'a box follows each word' },
    { id: 'color', name: 'Coloured word', note: 'the keyword changes colour' },
    { id: 'underline', name: 'Underline', note: 'a line draws under the keyword' },
    { id: 'none', name: 'None', note: 'plain captions' },
  ],
  captionCases: [
    { id: 'normal', name: 'As spoken' },
    { id: 'upper', name: 'CAPS' },
    { id: 'lower', name: 'lowercase' },
  ],

  /* Colour themes: one set of colours for captions, hook and thumbnail, so
     they always match. accent = highlight and keyword; box = title box. */
  themes: [
    { id: 'classic', name: 'Classic', colours: { title: '#FFFFFF', caption: '#FFFFFF', accent: '#FFD400', box: '#0A0A0A' } },
    { id: 'bold', name: 'Bold yellow', colours: { title: '#0A0A0A', caption: '#FFFFFF', accent: '#FFD400', box: '#FFD400' } },
    { id: 'cream', name: 'Cream', colours: { title: '#F4EDE1', caption: '#FFFFFF', accent: '#F4EDE1', box: '#F4EDE1' } },
    { id: 'orange', name: 'Orange', colours: { title: '#FFFFFF', caption: '#FFFFFF', accent: '#FF9900', box: '#FF9900' } },
    { id: 'blush', name: 'Blush', colours: { title: '#FFFFFF', caption: '#FFFFFF', accent: '#F6B7C9', box: '#F6B7C9' } },
    { id: 'lilac', name: 'Lilac', colours: { title: '#FFFFFF', caption: '#FFFFFF', accent: '#B9A6F2', box: '#B9A6F2' } },
    { id: 'mint', name: 'Mint', colours: { title: '#FFFFFF', caption: '#FFFFFF', accent: '#2BB3A3', box: '#2BB3A3' } },
    { id: 'red', name: 'Red pop', colours: { title: '#FFFFFF', caption: '#FFFFFF', accent: '#E5484D', box: '#E5484D' } },
    { id: 'mono', name: 'Black and white', colours: { title: '#FFFFFF', caption: '#FFFFFF', accent: '#FFFFFF', box: '#FFFFFF' } },
  ],

  /* The sound library (synthesised by scripts/sfx.mjs, so nothing to license). */
  sounds: [
    { id: 'pop', name: 'Pop', cat: 'Pops' }, { id: 'soft-pop', name: 'Soft pop', cat: 'Pops' }, { id: 'bubble', name: 'Bubble', cat: 'Pops' }, { id: 'slap', name: 'Sticker slap', cat: 'Pops' },
    { id: 'whoosh', name: 'Whoosh', cat: 'Moves' }, { id: 'swoosh-up', name: 'Swoosh up', cat: 'Moves' }, { id: 'swipe', name: 'Swipe', cat: 'Moves' }, { id: 'riser', name: 'Riser', cat: 'Moves' },
    { id: 'click', name: 'Click', cat: 'Clicks' }, { id: 'double-click', name: 'Double click', cat: 'Clicks' }, { id: 'soft-click', name: 'Soft click', cat: 'Clicks' }, { id: 'tick', name: 'Tick', cat: 'Clicks' }, { id: 'typing', name: 'Typing', cat: 'Clicks' }, { id: 'camera', name: 'Camera shutter', cat: 'Clicks' },
    { id: 'ding', name: 'Ding', cat: 'Bells' }, { id: 'chime', name: 'Chime', cat: 'Bells' }, { id: 'sparkle', name: 'Sparkle', cat: 'Bells' }, { id: 'notification', name: 'Notification', cat: 'Bells' }, { id: 'success', name: 'Success', cat: 'Bells' },
    { id: 'boom', name: 'Boom', cat: 'Hits' }, { id: 'error', name: 'Wrong buzz', cat: 'Hits' },
  ],

  /* The guided steps, in order. */
  steps: [
    { id: 'cut', name: 'Cut', does: 'Take out pauses and mistakes' },
    { id: 'captions', name: 'Captions', does: 'Style and highlight your words' },
    { id: 'hook', name: 'Hook', does: 'The title for the first seconds' },
    { id: 'sounds', name: 'Sounds', does: 'Drag sounds onto the timeline' },
    { id: 'thumbnail', name: 'Thumbnail', does: 'Make the cover image' },
    { id: 'export', name: 'Export', does: 'Render your video' },
  ],
})
