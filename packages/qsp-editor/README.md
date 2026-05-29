# qsp-editor

A visual authoring tool for QSP games. Edit text source, see live validation, run the game right next to your code.

```
┌─────────────────────────────────────────────────────────────┐
│ ☰  QSP Editor                       ● несохранено  ▶ Запустить│
├──────────────┬──────────────────────────┬───────────────────┤
│ ЛОКАЦИИ    + │ START                    │ ПРЕДПРОСМОТР  ⟳   │
│              │                          │                   │
│ ▶ start      │  USEHTML = 1             │ <title screen>    │
│   roll_dice  │  $ONNEWLOC = '_onnewloc' │                   │
│   _onnewloc  │  …                       │ ─ Бросить кубики  │
│   add_money  │  ACT 'Бросить кубики':   │                   │
│   add_food   │      gt 'roll_dice'      │                   │
│   …          │  END                     │                   │
│   1          │                          │                   │
│   2          │                          │                   │
│   3          │                          │                   │
├──────────────┴──────────────────────────┴───────────────────┤
│ ПРОБЛЕМЫ: 1                                                  │
│ ⚠ start  "PACT '...':" — неизвестное ключевое слово          │
└──────────────────────────────────────────────────────────────┘
```

## Run

```bash
npm run dev:editor    # :5175
npm run build:editor  # → dist/editor/
```

## Features

- **Sidebar of locations** — click to switch. Pencil ✎ or double-click to rename inline. × to delete.
- **Code editor** — plain textarea (Monaco is on the roadmap). Auto-saves to `localStorage` on every keystroke.
- **Hamburger menu** — Новый / Открыть `.qsp`/`.qsps` / Сохранить `.qsps` / Скомпилировать `.qsp`
- **Live preview** — embed of the player. *Запустить* runs from start; *▶ С этой* runs from the currently selected location (handy for testing chapter N without playing chapters 1…N-1).
- **Validation panel** — runs the AST parser on every keystroke (300ms debounce):
  - Parse errors with line/column
  - Duplicate location names
  - Dangling `gt`/`gs` targets (warning)
  - Suspicious keyword typos like `PACT '…':` or `ACTT '…':`
  - **Click any problem** to jump to that line in the editor

## File formats

| Format | Description |
|---|---|
| **`.qsp`** | Binary, the format played by classic QSP and our players. |
| **`.qsps`** | Plain-text source. Each location starts with `# locname` on its own line; everything until the next `# ` is that location's QSP code. |

The editor reads and writes both. Recommended workflow: keep `.qsps` in version control; compile to `.qsp` when shipping.

```
# start
USEHTML = 1
'Hello, world.'
ACT 'Begin':
    gt 'chapter1'
END

# chapter1
'You are in a dark room. ((Look around|2)) or ((leave|3)).'
```

## Compile script (CLI)

For headless / CI builds, see [`_examples/povelitel/compile.ts`](../../_examples/povelitel/compile.ts) — a standalone script that does the same `.qsps` → `.qsp` compile (with the same validation) outside the editor:

```bash
npx tsx _examples/povelitel/compile.ts source.qsps output.qsp
```

## Architecture

```
main.ts
  ├── Sidebar:    renderSidebar(), startRename(), deleteLoc(), addLoc()
  ├── Code:       textarea wired to locs[curIdx].code with debounced validate()
  ├── Validation: AST parse + heuristic checks; click-to-jump to line
  ├── Open/save:  parseQsp / writeQsp (qsp-core), .qsps split/join
  └── Preview:    QspEngine + QspRenderer (shared with qsp-player)

style.css   ← dark VS-Code-ish theme with CSS variables on :root
```

## Storage

The current project is auto-saved to `localStorage` under `qsp_editor_project`. User volume preferences (in the preview) are kept under `qsp_user_volume`. Per-game saves use the standard `qsp_<gameId>_<filename>` key like the rest of the apps.

## Roadmap

- Monaco editor (syntax highlighting, autocomplete for QSP keywords, multi-cursor)
- Visual flow graph showing chapter navigation (gt/gs edges)
- Theme picker
- Undo across rename/delete
- Drag-to-reorder locations in the sidebar
