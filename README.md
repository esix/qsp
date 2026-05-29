# QSP

A TypeScript reimplementation of [QSP](https://qsp.org) (Quest Soft Player) — the Russian gamebook engine for text adventures and interactive fiction. Runs entirely in the browser. No installation, no Wine, no DLLs.

**Live: [if-quests.ru](https://if-quests.ru)**

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  qsp-player │    │   qsp-site  │    │  qsp-editor │
│ (drop-and-  │    │  (catalog + │    │  (author    │
│  play)      │    │   player)   │    │   games)    │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          ▼
                  ┌───────────────┐
                  │   qsp-core    │
                  │ (engine: lex, │
                  │  parse, run)  │
                  └───────────────┘
```

## Packages

| Package | Purpose |
|---|---|
| [`qsp-core`](packages/qsp-core)     | Pure engine library — lexer, parser, AST, interpreter, binary `.qsp` reader/writer. No DOM, no browser deps. |
| [`qsp-player`](packages/qsp-player) | Standalone web player. Drag a `.qsp` file or game folder; play. Also exports `QspRenderer` (used by the other apps), audio players, and folder/ZIP loading. |
| [`qsp-site`](packages/qsp-site)     | Public games catalog ([if-quests.ru](https://if-quests.ru)). Loads games from a JSON manifest, supports hash-routed direct links, and accepts drag-drop uploads. |
| [`qsp-editor`](packages/qsp-editor) | Visual authoring tool. Sidebar of locations, code editor, live preview, validation panel. Compiles `.qsps` (text) → `.qsp` (binary). |

## Getting started

```bash
npm install
npm run dev          # qsp-player on :5173
npm run dev:site     # qsp-site on :5174
npm run dev:editor   # qsp-editor on :5175
```

## Build

```bash
npm run build         # qsp-core + qsp-player
npm run build:site    # qsp-site → dist/site/
npm run build:editor  # qsp-editor → dist/editor/
```

Deployment for the live site is in [`deploy.md`](deploy.md).

## Status

- ✅ Reads modern UCS-2 `.qsp` binary format (and old ANSI format)
- ✅ Writes `.qsp` binary (round-trip safe)
- ✅ Lexer, parser, interpreter sufficient to run real games (Лабиринт, Подземелья Чёрного Замка, Стальная Крыса, Юпитер II, etc.)
- ✅ Audio (MIDI, MP3, WAV via Web Audio + soundfont-player)
- ✅ Mobile-responsive layout
- ✅ Autosave / resume on reload
- ✅ External library loading (`ADDQST` / `INCLIB`)

## License

MIT (the engine — your own games are yours).

## Source

[github.com/esix/qsp](https://github.com/esix/qsp)
