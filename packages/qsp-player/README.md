# qsp-player

Drop a `.qsp` file (or game folder, or `.zip`) into the page; play in the browser.

```
┌──────────────────────────────────────────────────────┐
│ QSP Player    [Load file]  [Load folder]   ♪ — — ⟳   │
├──────────────────────────────────────────────────────┤
│                                       │ ACTIONS      │
│   Main text and game narrative.       │ ─ Идти на N  │
│   Click <a href="exec:…"> links.      │ ─ Атаковать  │
│   Inline images, HTML formatting.     │              │
│                                       │ INVENTORY    │
│                                       │ ─ Меч        │
│                                       │ ─ Ключ       │
├───────────────────────────────────────┴──────────────┤
│ Stat panel (HP, gold, status flags)                  │
├──────────────────────────────────────────────────────┤
│ [text input]                              [OK]       │
└──────────────────────────────────────────────────────┘
```

## Run

```bash
npm run dev          # dev server on :5173
npm run build        # build to dist/player/ (via root: npm run build)
```

## Loading games

Three ways:

1. **File picker / drag-drop a `.qsp` file** — works for self-contained games (no external assets)
2. **Drag-drop a folder** — picks up images, audio, and library `.qsp` files. Auto-detects which `.qsp` is the main game (the one that isn't referenced by `addqst` from another file).
3. **Drag-drop a `.zip` archive** — same as folder.

Saves and user volume persist in `localStorage` keyed by game ID. Dropping the same game later resumes from the autosave.

## What's exported (used by other packages)

`qsp-site` and `qsp-editor` import these directly:

| Module | Export |
|---|---|
| `qsp-player/audio.js`        | `MidiAudioPlayer`, `SimpleAudioPlayer` — Web Audio + soundfont-player wrappers |
| `qsp-player/local-files.js`  | `collectDroppedFiles`, `collectFromFile`, `prepareLocalGame`, `revokeAssets` — folder/ZIP loading |
| `qsp-player/renderer.js`     | `QspRenderer` — wires a `QspEngine` to a set of DOM elements (text, actions, objects, dialogs, audio). Used by all three apps to share rendering logic. |

## Architecture

```
main.ts (app-specific: drop zone, file picker, restart, volume)
   │
   ├── new QspEngine()                  ← from qsp-core
   ├── new QspRenderer({ engine, … })   ← wires callbacks to DOM
   ├── new MidiAudioPlayer()            ← MIDI playback
   └── new SimpleAudioPlayer()          ← MP3/WAV playback

renderer.ts (shared rendering layer)
   ├── onMainTextChanged → write to mainText (with <<expr>> already resolved)
   ├── onActionsChanged  → render <li> action buttons, wire click → execAction
   ├── onObjectsChanged  → render inventory <li>, wire click → selectObject
   ├── onMessage / onMenu → modal overlays
   ├── onColorsChanged   → set --game-bg/fg/link CSS vars
   ├── onPlayFile        → MIDI vs simpleAudio dispatch
   └── handleQspLink     → intercepts <a href="exec:…"> and <a href="N">
```

## Mobile

Single-column stacked layout below 768px. Volume control becomes a square ♪ button with a vertical-slider popup (touch-friendly). Sticky input bar.

## Themes

Colors are set via CSS variables on `:root` (`--bg`, `--surface`, `--accent`, etc.). When the QSP game itself calls `BCOLOR`/`FCOLOR`/`LCOLOR`, those override `--game-bg/fg/link` on `#game`.

## Source layout

```
src/
├── main.ts          # app shell: file loading, drop zone, volume slider
├── renderer.ts      # shared rendering (used by qsp-player, qsp-site, qsp-editor)
├── audio.ts         # MidiAudioPlayer + SimpleAudioPlayer
├── local-files.ts   # folder/ZIP loading + main-.qsp detection
└── style.css        # full theme (light beige / serif)
```
