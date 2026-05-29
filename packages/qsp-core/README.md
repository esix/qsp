# qsp-core

The QSP engine — pure TypeScript, no DOM, no browser dependencies. Lex, parse, run, read, and write QSP games.

## What's inside

```
src/
├── parser/
│   ├── qsp-parser.ts   # binary .qsp → QspGame (locations, actions)
│   ├── qsp-writer.ts   # QspGame → binary .qsp (round-trip safe)
│   └── encoding.ts     # CP1251/UCS-2 + Caesar cipher used by .qsp files
├── lexer/
│   ├── lexer.ts        # source → tokens (handles ! comments / not-equal,
│   │                   #   line continuation, statement separators)
│   └── tokens.ts       # keyword table
├── ast/
│   ├── parser.ts       # tokens → AST (statements, expressions, blocks)
│   └── nodes.ts        # AST node types
└── interpreter/
    ├── engine.ts       # game lifecycle, location nav, timer, autosave
    ├── executor.ts     # statement execution
    ├── evaluator.ts    # expression evaluation, built-in functions
    ├── state.ts        # variables (dual num/str storage), objects, callbacks
    └── subexpr.ts      # <<expr>> substitution in strings
```

## API

```ts
import { parseQsp, writeQsp, QspEngine } from 'qsp-core';

// 1. Parse a .qsp file
const game = parseQsp(uint8Array);
//   → { version, password, locations: [{ name, description, code, actions }] }

// 2. Write one back (e.g. after edits)
const bytes = writeQsp({ locations });

// 3. Run it
const engine = new QspEngine();
engine.on({
  onMainTextChanged: text => { /* render text */ },
  onActionsChanged:  acts => { /* render action buttons */ },
  onObjectsChanged:  objs => { /* render inventory */ },
  onStatTextChanged: text => { /* render stat panel */ },
  onMessage:         text => { /* show modal */ },
  onMenu:            items => Promise.resolve(0), // user picks; return index
  // ...plus onColorsChanged, onBackImage, onView, onPlayFile, onCloseFile,
  //   onSetVolume, onInput, onSaveGame, onLoadGame, onLoadQst
});
engine.loadGame(uint8Array);     // or loadParsedGame(game)
await engine.start();             // resumes from autosave if onLoadGame returns one
// later, on user action:
await engine.execAction(index);
```

The interpreter is async (`engine.start()` returns a Promise) because game code can include `WAIT` (animated delays) and asynchronous user input.

## QSP language coverage

Reasonably complete:

- Variables: numeric and string (`$var`), arrays (numeric and string-keyed), `var[] = value` append
- Control flow: `IF/ELSEIF/ELSE/END`, `LOOP/WHILE/STEP`, `JUMP :label`, `GOTO`/`GOSUB`/`XGT`/`XGOTO`
- Display: `'text'`, `*pl/*nl/*p`, `pl/nl/p` (stat), `<<expr>>` substitution, HTML mode (`USEHTML=1`)
- Game UI: `ACT 'name': … END`, `ADDOBJ`/`DELOBJ`/`KILLOBJ`, `MENU`, `MSG`, `INPUT`, `VIEW`
- Audio: `PLAY`, `CLOSE`, `SETVOL`, `ISPLAY()`
- Persistence: `SAVEGAME`, `OPENGAME`, `$ONNEWLOC`, `$ONACTSEL`, `$ONOBJSEL`, `$ONGSAVE`, `$ONGLOAD`
- External libraries: `ADDQST`/`INCLIB`/`FREELIB` (loads another `.qsp` at runtime)
- Built-ins: `RAND`, `RND`, `IIF`, `RGB`, `LEN`, `MID`, `INSTR`, `REPLACE`, `STRPOS`, `STRFIND`, `STRCOMP`, `ARRSIZE`, `ARRPOS`, `LOC`, `OBJ`, `$DESC`, `$GETOBJ`, `FUNC`, `DYNEVAL`, …

QSP variables are **dual-typed**: every slot stores both a number and a string independently. `var[i] = 5` updates only the numeric component; `$var[i] = 'x'` updates only the string. Reading via `var` returns the number, `$var` the string. The interpreter implements this faithfully.

## Tests

```bash
npm test --workspace=packages/qsp-core
```

(Vitest config currently has an ESM/CJS rough edge in this Node + Vite version; the engine itself is exercised in-browser via the player and editor against real games.)

## Used by

- [`qsp-player`](../qsp-player) — standalone player (uses `parseQsp`, `QspEngine`)
- [`qsp-site`](../qsp-site) — games catalog (same)
- [`qsp-editor`](../qsp-editor) — uses `parseQsp`, `writeQsp`, `Parser` (for live validation)
