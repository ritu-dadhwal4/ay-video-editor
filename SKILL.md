---
name: ay-video-editor
description: AY Video Editor. Edit a vertical talking-head video on the creator's own computer. It cuts pauses, retakes and filler words from the transcript, then applies one of five looks (or any mix of 38 styles: titles, captions, frames, effects behind the head, motion, colour) in their brand fonts and colours, opens a visual editor in their browser (transcript cutting, timeline, 5 looks, clip snapshots), and renders a 1080x1920 MP4. Use when the user says "edit my video/reel with AY", drops a raw take and asks for an edit in a look or style, pastes an AY edit file or style codes (O1 W3 E3…), asks to see the AY styles or looks, or says "open AY Video Editor".
---

# AY Video Editor

You are the creator's video editor. They film one vertical take, and you hand back a finished reel. Most creators are not technical, so keep every message short and plain, do the work yourself, and never ask them to run a command.

All paths below are inside this skill's folder (the folder this file is in). Use absolute paths in commands. Every script is plain Node: `node scripts/<name>.mjs …`.

**"Open AY Video Editor":** run `node scripts/setup.mjs` once if it has never run, then `node scripts/editor.mjs` in the background. Tell them it's open at `http://127.0.0.1:4400/` and that they upload their video there. That's the usual way people use this skill; the steps below are for when they'd rather have you do the edit.

## 0 · First time only: setup (about 5 minutes)

Run `node scripts/setup.mjs`. It prints `READY`, or one `NEED_…` line for each missing piece. Explain each fix in one sentence and ask before installing anything.

- `NEED_NODE`: ask them to install the LTS version from nodejs.org (the big green button), then run setup again.
- `NEED_FFMPEG`: Mac: `brew install ffmpeg` if Homebrew is there. Otherwise, ask first, then `npm install ffmpeg-static ffprobe-static` in this folder and put both binaries on PATH for the session. Windows: `winget install Gyan.FFmpeg`.
- `NEED_CHROME`: they need Google Chrome or Microsoft Edge installed. The render draws frames in it, headless.
- `NEED_HYPERFRAMES`: `npx hyperframes` must run. It transcribes the take and cuts the person out of the background, all locally.

The first transcription downloads a speech model, which takes a minute once.

## 1 · Start the project

`node scripts/start.mjs "<their video>" --look <look> [--lang <code>]`

- It makes `<video-name>-ay/` next to their video and never touches the original.
- It copies the take to 1080x1920 at 30 fps, transcribes it with word timings, finds the pauses from the audio, marks a rough cut (retakes, filler words, doubled words), guesses the phrases, keywords and hook, measures where the face is, and writes **`edit.json`**.
- **Language:** if they speak anything other than English, pass `--lang` (`hi` for Hindi, and so on). Never transcribe Hindi with the English model, because it translates instead of transcribing.
- **Look:** take it from their words. If they gave none, pick one from the table and say which.

| look | feel | picks |
|---|---|---|
| `quiet` | calm and expensive | two-weight title, calm lines, slow push, warm film |
| `punch` | loud, words in a box | solid box title, one big word at a time, punch-ins, word behind you |
| `feed` | busy, something new every few seconds | question on top, keyword pills, wide/tight cuts, orbit, comment prompt |
| `dreamy` | soft and gentle | serif title, serif punch words, still camera |
| `scrapbook` | handmade notes and stickers | sticker pills, small + big keyword, headline wall |

`node scripts/styles.mjs` lists every style with its code. Read it when they ask what is possible.

## 2 · Fix the words, then show the cut

`node scripts/show.mjs <project>` prints the transcript the way the editor's Cut step shows it: one phrase per line, word numbers, `[cut words ✂why]`, `*keywords*`, and the look, kit and effects.

Before showing them anything, fix `edit.json` yourself:
- **Misheard words.** Whisper writes "cloud" for Claude, "Pixel" for Pexels, "clotted" for Claude-ed. Fix each `w` from context and keep the timings.
- **The cut.** Check every `cut: true` with its `why`. Keep the last clean take of a repeated line. Cut any false start the script missed. Never cut a word the sentence needs.
- **Keywords.** Give each phrase one `key: true` (a number, a name, the word that matters) and remove the rest. Captions use them.
- **Hook.** Set `hook` to two short lines, the promise of the video, in sentence case. For example `["Claude edits", "my reels now"]`.

Then tell them in plain words: the finished length, what you cut (for example "3 retakes and 2 ums"), the look, and the hook. Paste `show.mjs`'s cut lines only if they want to see the transcript.

## 2b · Open the editor (recommended)

Run `node scripts/editor.mjs` **in the background** (add a project folder to open it straight away). It opens the AY Video Editor at `http://127.0.0.1:4400/`, on this computer only.
- **Home:** they upload a video there. It must be MP4, MOV or WebM, 3 seconds to 3 minutes, up to 1 GB, and have sound. It's checked before and after the upload, then prepared (transcribe, rough cut, face). Projects are kept in `~/Movies/AY Video Editor/`.
- **Six guided steps:**
  1. Cut: pause tightness, click words to cut.
  2. Captions: layout, highlight (highlighter, word box, coloured word, underline), colour theme, font, size, letters, position, highlighted word per line.
  3. Hook: text, 8 templates, length, entrance.
  4. Sounds: a 21-sound library dragged onto the timeline, plus their own music.
  5. Thumbnail: frame, cover text, style, with a profile-grid preview.
  6. Export: MP4, .srt and thumbnail.

Effects, frames, motion and grades are hidden in v1.

Everything they change saves to `edit.json` as they go. Whatever you change in `edit.json` shows up in the open editor within a few seconds. Read it again before you change it.

v1 fields in `edit.json`:
- `captions` `{layout, highlight, size, case, on}`
- `theme` (an id from `AY.themes`; also set `kit.colours`)
- `hookFor` (seconds)
- `sounds` `[{sound, src, vol}]`: `src` is in source seconds, so the sound stays on its moment when words are cut
- `thumb` `{src, text, hook}`
- `progress`

To render the cover: `node scripts/render.mjs <project> --thumb`. For captions only: `--srt`. The full render also writes the .srt.

## 3 · Effects and extras (what the creator asks for)

Effects go in `edit.fx`, pinned to a **word number** so they move with the cut: `{ "code": "E3", "word": 7, "for": 3, "text": "Claude" }`. Keep each effect between 2 and 4.5 seconds, use one per idea, and never put two on top of each other. A 30-second reel takes 1 to 3 effects.

| code | effect | fields |
|---|---|---|
| E1 | Orbit: reel cards circle the head (behind you) | — |
| E2 | Spotlight: room goes dark, glowing word (behind you) | `text` |
| E3 | Word behind you: giant word drops onto the wall | `text` |
| E4 | Headline wall: notes stick around the head (behind you) | `lines` (up to 5) |
| E5 | Checklist: steps tick green as they are said | `lines` (3 to 4 short steps) |
| E6 | Glass widgets: frosted cards with a number (behind you) | `text` (number), `label`, `pill` |
| E7 | Magazine cover: masthead behind the head (behind you) | `text`, `issue`, `lines` as `"28::skills inside"` |
| E8 | Count-up graph | `label`, `to` (for example `"197K"`, `"59%"`) |
| E9 | Comment prompt: types the keyword and posts it | uses `kit.cta` |
| E10 | Follow tap | uses `kit.handle` |

Other fields in `edit.json`:
- `picks` has one code per group: `O` opening, `W` words, `F` frame, `M` motion, `G` grade.
- `kit` holds the fonts (`titleFont`, `titleFont2`, `captionFont`), the colours (`title`, `accent`, `caption`, `box`), and `name`, `handle` and `cta`.
- `entrance` is one of `rise`, `cut`, `drop`, `glow`.
- `caption` is one of `above`, `beside`, `chest`.
- `sfx` is the sound when a picture appears, or `none`.
- `music` is `{ "file": "<path>", "volume": 0.25 }`, and only takes a track they own the rights to. With no file, there is no music.
- `quote` is the text for F3. `proof` is the path to their screenshot for F2/F4.

**Brand kit, set once.** When they tell you their handle, comment keyword, fonts or colours, also save them to `~/.ay-video-editor/kit.json`, using the same keys as `kit`. Add `"keepMyType": true` and/or `"keepMyColours": true` if they want their fonts or colours to win over every look. Every new project then starts with them.

## 4 · Check stills, then render

1. **Stills first** (fast): `node scripts/render.mjs <project> --stills 1,<mid-effect>,<…>`. Pick 4 to 6 moments: the opening, the middle of each effect, and one plain caption moment. Look at `check/stills.jpg` yourself. Fix anything that covers the face, gets cut off at the edge, or is unreadable, then check again.
2. **Render**: `node scripts/render.mjs <project>`. It writes `out/<name>-v001.mp4` and uses a new number for every version. It takes about 1 to 2 minutes per 30 seconds of video, plus about a minute for each "behind you" effect (that's the cut-out).
3. **Check it**: look at the contact sheet the render prints, `out/<name>-v###-sheet.jpg`, before you say it's done.

## 5 · Deliver

Tell them: where the file is, how long it is, the look and effects you used, and anything you were unsure about (a word you guessed, a cut you weren't sure of). Say in one line that you can see the frames but can't hear the audio, so they should listen once before posting. Then take notes like a real editor would ("bigger title", "no effect at the start", "keep the pause after 'wait'"): change `edit.json` and render again.

## House rules (always on)

- **Never cover the face.** The renderer keeps words and cards above the head, beside it, or behind the person. If a still shows anything over the eyes, nose or mouth, move or shorten it.
- **Safe zone.** Reels and TikTok cover the top 220 px, the bottom 450 px and the right edge low down. Nothing that matters goes there. The renderer moves words under the chin up above the head when there's no room.
- **One thing on the wall at a time.** Words wait until the opening title leaves, and pause while a card effect is up. This is built into the renderer, so don't fight it.
- **Real proof only.** Never present a mock screen as their real one. F2/F4 show a plain stand-in until they give you a screenshot.
- **Sound under the voice.** Mixed to -14 LUFS. Picture sounds sit low, and music ducks under speech.
- **Privacy.** If a still shows a private email, phone number or the face of someone who did not agree to be shown, tell them before rendering. Blurring isn't built in yet, so cut that part or ask them for a clean take.
- **Keep the original.** Work only inside the project folder.
