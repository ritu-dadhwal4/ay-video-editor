# AY Video Editor

A free Claude Code skill for editing talking-head reels, on your own computer. Try it on a sample reel first: **[aboveyellow.com/apps/ay-video-editor](https://aboveyellow.com/apps/ay-video-editor)**

Upload one take of you talking to camera. It walks you through six steps:

1. **Cut**: long pauses, retakes and filler words come out automatically. Click any word to cut it or bring it back.
2. **Captions**: word by word, never over your face. Highlighter, word box, coloured word or underline, in one of nine colour themes.
3. **Hook**: a title for your opening line, in one of eight templates.
4. **Sounds**: drag a pop, whoosh or ding onto the timeline. Add your own music.
5. **Thumbnail**: pick a frame, add a few words, and see how it crops in your profile grid.
6. **Export**: a 1080×1920 MP4 at -14 LUFS, an .srt captions file, and your thumbnail.

Your video never leaves your computer.

## Install

Open Claude Code (the Code tab in the Claude desktop app) and paste:

```
Install the AY Video Editor skill: git clone https://github.com/ritu-dadhwal4/ay-video-editor into ~/.claude/skills/ay-video-editor, run its setup (node scripts/setup.mjs), then open AY Video Editor.
```

The first setup takes about 5 minutes. Claude checks for Node.js, ffmpeg, Chrome (or Edge) and HyperFrames, and asks before installing anything.

After that, just say **"Open AY Video Editor"**.

## What you can upload

MP4, MOV or WebM · 3 seconds to 3 minutes · up to 1 GB · with sound. Vertical 9:16 with one person talking to camera works best. Landscape videos are cropped to the centre. English and Hindi are transcribed as spoken.

## How it works

- `scripts/editor.mjs` runs the editor at `http://127.0.0.1:4400/`, on your computer only. Projects live in `~/Movies/AY Video Editor/` (`~/Videos/…` on Windows and Linux).
- `scripts/start.mjs` prepares a take: transcribes it with word timings (HyperFrames, locally), finds the pauses, marks a rough cut and finds your face.
- `scripts/render.mjs` draws every frame in headless Chrome with `engine/render.js`, the same code as the editor's preview, so the export matches what you saw.
- `edit.json` in each project is the whole edit. The editor and Claude both work on it, so you can ask Claude to change things while the editor is open.

See `SKILL.md` for the full workflow Claude follows.

## Credits

Made by [Above Yellow](https://aboveyellow.com). MIT licence (see `LICENSE`). The face and person models in `models/` are Google MediaPipe models under the Apache 2.0 licence (see `models/NOTICE.md`). Sound effects are synthesised by `scripts/sfx.mjs`. Fonts load from Google Fonts (SIL Open Font Licence).
