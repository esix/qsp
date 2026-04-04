import { QspEngine } from 'qsp-core/interpreter/engine.js';
import type { QspRuntimeAction, QspObject } from 'qsp-core/interpreter/state.js';

// ─── Types ───────────────────────────────────────────────────────

interface GameMeta {
  id: string;
  file: string;
  title: string;
  author?: string;
  genre?: string;
  description: string;
}

// ─── DOM ─────────────────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!;

const catalogEl      = $('catalog');
const gamesGrid      = $('games-grid');
const playerWrap     = $('player-wrap');
const playerTitle    = $('player-title');
const backBtn        = $('back-btn');
const restartBtn     = $('player-restart-btn');
const gameEl         = $('game');
const mainText       = $('main-text');
const statText       = $('stat-text');
const actionsList    = $('actions-list');
const objectsList    = $('objects-list');
const inputLine      = $('input-line') as HTMLInputElement;
const inputSubmit    = $('input-submit');
const inputPanel     = $('input-panel');
const statPanel      = $('stat-panel');
const actionsPanel   = $('actions-panel');
const objectsPanel   = $('objects-panel');
const msgOverlay     = $('msg-overlay');
const msgText        = $('msg-text');
const msgOk          = $('msg-ok');

// ─── Engine ──────────────────────────────────────────────────────

const engine = new QspEngine();
let currentGameData: Uint8Array | null = null;

// ─── Helpers ─────────────────────────────────────────────────────

function qspColorToCss(color: number): string {
  const r = (color & 0xFF).toString(16).padStart(2, '0');
  const g = ((color >> 8) & 0xFF).toString(16).padStart(2, '0');
  const b = ((color >> 16) & 0xFF).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function applyColors(bcolor: number, fcolor: number, lcolor: number) {
  gameEl.style.setProperty('--game-bg',   bcolor >= 0 ? qspColorToCss(bcolor) : '');
  gameEl.style.setProperty('--game-fg',   fcolor >= 0 ? qspColorToCss(fcolor) : '');
  gameEl.style.setProperty('--game-link', lcolor >= 0 ? qspColorToCss(lcolor) : '');
}

function protectExecHrefs(html: string): string {
  return html.replace(/href="exec:([^"]*)"/g, (_, cmd) =>
    `href="exec:${cmd.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;')}"`
  );
}

// ─── Engine callbacks ────────────────────────────────────────────

engine.on({
  onMainTextChanged(text) {
    if (engine.state.useHtml) {
      mainText.innerHTML = protectExecHrefs(text);
    } else {
      mainText.textContent = text;
    }
    mainText.parentElement!.scrollTop = mainText.parentElement!.scrollHeight;
  },
  onStatTextChanged(text) {
    if (engine.state.useHtml) {
      statText.innerHTML = protectExecHrefs(text);
    } else {
      statText.textContent = text;
    }
    statPanel.classList.toggle('hidden', !text && !engine.state.showStat);
  },
  onActionsChanged(actions: QspRuntimeAction[]) {
    actionsList.innerHTML = '';
    for (let i = 0; i < actions.length; i++) {
      const li = document.createElement('li');
      if (engine.state.useHtml) li.innerHTML = actions[i].name;
      else li.textContent = actions[i].name;
      li.addEventListener('click', () => engine.execAction(i));
      actionsList.appendChild(li);
    }
    actionsPanel.classList.toggle('hidden', !engine.state.showActs);
  },
  onObjectsChanged(objects: QspObject[]) {
    objectsList.innerHTML = '';
    for (let i = 0; i < objects.length; i++) {
      const li = document.createElement('li');
      if (engine.state.useHtml) li.innerHTML = objects[i].name;
      else li.textContent = objects[i].name;
      li.addEventListener('click', () => engine.selectObject(i));
      objectsList.appendChild(li);
    }
    objectsPanel.classList.toggle('hidden', !engine.state.showObjs || objects.length === 0);
  },
  onMessage(text) {
    msgText.textContent = text;
    msgOverlay.classList.remove('hidden');
  },
  onInput(prompt) {
    return window.prompt(prompt) ?? '';
  },
  onColorsChanged(bcolor, fcolor, lcolor) {
    applyColors(bcolor, fcolor, lcolor);
  },
});

// ─── Link interception ───────────────────────────────────────────

function handleQspLink(e: MouseEvent) {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href') ?? '';
  if (href.startsWith('exec:')) {
    e.preventDefault();
    engine.execDynamic(href.slice('exec:'.length), []);
    return;
  }
  const idx = parseInt(href, 10);
  if (!isNaN(idx) && String(idx) === href.trim()) {
    e.preventDefault();
    engine.execAction(idx - 1);
  }
}

mainText.addEventListener('click', handleQspLink);
statText.addEventListener('click', handleQspLink);

// ─── Message dialog ──────────────────────────────────────────────

msgOk.addEventListener('click', () => msgOverlay.classList.add('hidden'));
document.addEventListener('keydown', (e) => {
  if (!msgOverlay.classList.contains('hidden') && (e.key === 'Enter' || e.key === 'Escape')) {
    msgOverlay.classList.add('hidden');
  }
});

// ─── Input ───────────────────────────────────────────────────────

function submitInput() {
  engine.submitInput(inputLine.value);
  inputLine.value = '';
}
inputSubmit.addEventListener('click', submitInput);
inputLine.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitInput(); });

// ─── Player start/stop ───────────────────────────────────────────

async function startGame(data: Uint8Array) {
  engine.stopTimer();
  applyColors(-1, -1, -1);
  engine.loadGame(data);
  await engine.start();
  inputPanel.classList.toggle('hidden', !engine.state.showInput);
  statPanel.classList.toggle('hidden', !engine.state.showStat);
  actionsPanel.classList.toggle('hidden', !engine.state.showActs);
  objectsPanel.classList.toggle('hidden', !engine.state.showObjs || engine.state.objects.length === 0);
}

restartBtn.addEventListener('click', () => {
  if (currentGameData) startGame(currentGameData);
});

// ─── Catalog → Player ────────────────────────────────────────────

async function playGame(meta: GameMeta) {
  playerTitle.textContent = meta.title;
  catalogEl.classList.add('hidden');
  playerWrap.classList.remove('hidden');

  // Show loading state
  mainText.textContent = 'Загрузка…';
  actionsList.innerHTML = '';

  try {
    const resp = await fetch(`/${meta.file}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    currentGameData = new Uint8Array(buffer);
    await startGame(currentGameData);
  } catch (err) {
    mainText.textContent = `Ошибка загрузки игры: ${(err as Error).message}`;
  }
}

// ─── Back to catalog ─────────────────────────────────────────────

backBtn.addEventListener('click', () => {
  engine.stopTimer();
  currentGameData = null;
  playerWrap.classList.add('hidden');
  catalogEl.classList.remove('hidden');
});

// ─── Catalog rendering ───────────────────────────────────────────

async function loadCatalog() {
  try {
    const resp = await fetch('/games.json');
    const games: GameMeta[] = await resp.json();
    renderCatalog(games);
  } catch {
    gamesGrid.innerHTML = '<p class="error">Не удалось загрузить каталог игр.</p>';
  }
}

function renderCatalog(games: GameMeta[]) {
  gamesGrid.innerHTML = '';
  for (const game of games) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.innerHTML = `
      <div class="card-genre">${game.genre ?? 'Игра'}</div>
      <h3 class="card-title">${game.title}</h3>
      ${game.author ? `<div class="card-author">${game.author}</div>` : ''}
      <p class="card-desc">${game.description}</p>
      <button class="play-btn">Играть</button>
    `;
    card.querySelector('.play-btn')!.addEventListener('click', () => playGame(game));
    gamesGrid.appendChild(card);
  }
}

loadCatalog();
