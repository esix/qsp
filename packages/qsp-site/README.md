# qsp-site

**Live: [if-quests.ru](https://if-quests.ru)**

The public games catalog. Lists hosted games as cards; clicking one launches it in an embedded player. Also accepts user uploads (drag a folder or `.zip`).

## Run

```bash
npm run dev:site   # :5174
npm run build:site # → dist/site/
```

## Catalog manifest

Games are listed in [`public/games.json`](public/games.json):

```json
[
  {
    "id": "labyrinth",
    "file": "labyrinth/labyrinth_1.2.qsp",
    "title": "Лабиринт",
    "author": "Неизвестен",
    "genre": "Приключение",
    "description": "..."
  },
  ...
]
```

Each game's assets live under `public/<id>/`. The catalog renders a card per entry; clicking *Играть* fetches the `.qsp` and starts the engine.

## URL hash routing

`https://if-quests.ru/#labyrinth` opens the Labyrinth game directly. Useful for sharing links to specific games. The catalog auto-hides on initial load if a hash is present (avoids the catalog flash before the game loads).

## Local game upload

Drag a folder or `.zip` onto the page (or use the file button). Same code path as qsp-player — see [`qsp-player/local-files.ts`](../qsp-player/src/local-files.ts).

## Adding a new game

1. Drop the game files (qsp + assets) into `public/<id>/`
2. Add an entry to `public/games.json`
3. `npm run build:site`
4. Deploy (see root [`deploy.md`](../../deploy.md))

## Architecture

Same `QspRenderer` from `qsp-player` does all the rendering — the site only owns:

- Catalog rendering (`<div class="game-card">` per `games.json` entry)
- Hash routing (`location.hash` ↔ game ID)
- Two layouts: `#catalog` (card grid + drop zone) and `#player-wrap` (the embedded player)
- Server-hosted save/load (localStorage keyed by `meta.file`)

No build tooling beyond Vite. No backend — `games.json` and game files are served as static assets.

## Theme

Dark gold / brown serif. Color variables on `:root` in [`src/style.css`](src/style.css).

## Source layout

```
src/
├── main.ts      # catalog + player shell, hash routing, drop-drop
├── style.css    # dark theme
public/
├── games.json   # catalog manifest
├── <id>/        # one folder per game
```
