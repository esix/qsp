import { QspEngine } from 'qsp-core/interpreter/engine.js';
import type { QspRuntimeAction, QspObject } from 'qsp-core/interpreter/state.js';
import { MidiAudioPlayer, SimpleAudioPlayer } from 'qsp-player/audio.js';
import { collectDroppedFiles, collectFromFile, prepareLocalGame, revokeAssets } from 'qsp-player/local-files.js';

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
const volumeSlider   = $('volume-slider') as HTMLInputElement;
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
const viewPanel      = $('view-panel');
const viewImg        = $('view-img') as HTMLImageElement;
const menuOverlay    = $('menu-overlay');
const menuList       = $('menu-list');
const menuCancel     = $('menu-cancel');

// ─── Engine ──────────────────────────────────────────────────────

const engine = new QspEngine();
let currentGameData: Uint8Array | null = null;
let currentGameId = '';
let currentGameBase = '';
let menuCancelResolve: (() => void) | null = null;
/** When a local game is loaded (drag-drop), maps lowercase relative path → blob URL */
let localAssets: Map<string, string> | null = null;

const midiPlayer = new MidiAudioPlayer();
const simpleAudio = new SimpleAudioPlayer();

// When a non-MIDI file finishes playing naturally, remove it from the engine's
// playingFiles set so that ISPLAY() correctly returns false afterwards.
simpleAudio.onFileEnded = (url: string) => {
  if (localAssets) {
    // For local games, find the original relative path that maps to this blob URL
    for (const [path, blobUrl] of localAssets) {
      if (blobUrl === url) {
        engine.state.playingFiles.delete(path.toUpperCase());
        return;
      }
    }
  }
  // Server-hosted: strip the leading "/<gameBase>" to recover the game-relative path.
  const base = '/' + currentGameBase;
  const relative = url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, '');
  engine.state.playingFiles.delete(relative.toUpperCase());
};

function isMidi(file: string): boolean {
  return /\.(mid|midi)$/i.test(file);
}

/** Resolve a game-relative asset path to a usable URL */
function resolveAssetUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (localAssets) {
    const url = localAssets.get(normalized.toLowerCase());
    if (url) return url;
  }
  return '/' + currentGameBase + normalized;
}

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

function applyBackImage(path: string) {
  const mainPanel = document.getElementById('main-panel')!;
  if (path) {
    mainPanel.style.setProperty('--game-backimage', `url('${resolveAssetUrl(path)}')`);
  } else {
    mainPanel.style.removeProperty('--game-backimage');
  }
}

function protectExecHrefs(html: string): string {
  return html.replace(/href="exec:([^"]*)"/gi, (_, cmd) =>
    `href="exec:${cmd.replace(/&/g, '&amp;')}"`
  );
}

/** Rewrite src="..." attributes in HTML to use resolved asset URLs.
 *  Handles quoted (src="path") and unquoted (src=path) attributes. */
function resolveHtmlAssets(html: string): string {
  return html.replace(/\b(src=)(["']?)([^"' >]+)\2/gi, (match, pre, quote, path) => {
    if (/^(https?:|data:|blob:)/i.test(path)) return match;
    return pre + (quote || '"') + resolveAssetUrl(path) + (quote || '"');
  });
}

// ─── Engine callbacks ────────────────────────────────────────────

engine.on({
  onMainTextChanged(text) {
    if (engine.state.useHtml) {
      mainText.innerHTML = resolveHtmlAssets(protectExecHrefs(text));
    } else {
      mainText.textContent = text;
    }
    mainText.parentElement!.scrollTop = mainText.parentElement!.scrollHeight;
  },
  onStatTextChanged(text) {
    if (engine.state.useHtml) {
      statText.innerHTML = resolveHtmlAssets(protectExecHrefs(text));
    } else {
      statText.textContent = text;
    }
    statPanel.classList.toggle('hidden', !text && !engine.state.showStat);
  },
  onActionsChanged(actions: QspRuntimeAction[]) {
    actionsList.innerHTML = '';
    for (let i = 0; i < actions.length; i++) {
      const li = document.createElement('li');
      if (engine.state.useHtml) li.innerHTML = resolveHtmlAssets(actions[i].name);
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
      if (engine.state.useHtml) li.innerHTML = resolveHtmlAssets(objects[i].name);
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
  onBackImage(path: string) {
    applyBackImage(path);
  },
  onView(path: string) {
    if (!path) {
      viewPanel.classList.add('hidden');
      viewImg.src = '';
    } else {
      viewImg.src = resolveAssetUrl(path);
      viewPanel.classList.remove('hidden');
    }
  },
  onMenu(items: string[]): Promise<number> {
    return new Promise(resolve => {
      menuList.innerHTML = '';
      for (let i = 0; i < items.length; i++) {
        const li = document.createElement('li');
        li.textContent = items[i];
        li.addEventListener('click', () => {
          menuOverlay.classList.add('hidden');
          resolve(i);
        });
        menuList.appendChild(li);
      }
      menuOverlay.classList.remove('hidden');
      // cancel resolves with -1 (no selection)
      menuCancelResolve = () => { menuOverlay.classList.add('hidden'); resolve(-1); };
    });
  },
  onPlayFile(file: string, volume: number) {
    const url = resolveAssetUrl(file);
    if (isMidi(file)) {
      midiPlayer.play(url, volume);
    } else {
      simpleAudio.play(url, volume);
    }
  },
  onSetVolume(volume: number) {
    volumeSlider.value = String(volume);
    midiPlayer.setGameVolume(volume);
    simpleAudio.setGameVolume(volume);
  },
  onCloseFile(file: string | null) {
    if (file === null) {
      midiPlayer.stop(null);
      simpleAudio.stop(null);
    } else {
      const url = resolveAssetUrl(file);
      if (isMidi(file)) midiPlayer.stop(url);
      else simpleAudio.stop(url);
    }
  },
  onSaveGame(filename: string, data: string) {
    try { localStorage.setItem('qsp_' + currentGameId + '_' + filename, data); } catch {}
  },
  onLoadGame(filename: string): string | null {
    try { return localStorage.getItem('qsp_' + currentGameId + '_' + filename); } catch { return null; }
  },
  async onLoadQst(filename: string): Promise<Uint8Array | null> {
    try {
      const url = resolveAssetUrl(filename);
      const resp = await fetch(url);
      if (!resp.ok) return null;
      return new Uint8Array(await resp.arrayBuffer());
    } catch { return null; }
  },
});

// ─── Link interception ───────────────────────────────────────────

function handleQspLink(e: MouseEvent) {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href') ?? '';
  if (href.toLowerCase().startsWith('exec:')) {
    e.preventDefault();
    engine.execDynamic(href.slice('exec:'.length).trim(), []);
    return;
  }
  const idx = parseInt(href, 10);
  if (!isNaN(idx) && String(idx) === href.trim()) {
    e.preventDefault();
    engine.execAction(idx - 1);
  }
}

viewImg.addEventListener('click', () => viewImg.classList.toggle('expanded'));

mainText.addEventListener('click', handleQspLink);
statText.addEventListener('click', handleQspLink);

// ─── Message dialog ──────────────────────────────────────────────

msgOk.addEventListener('click', () => msgOverlay.classList.add('hidden'));
document.addEventListener('keydown', (e) => {
  if (!msgOverlay.classList.contains('hidden') && (e.key === 'Enter' || e.key === 'Escape')) {
    msgOverlay.classList.add('hidden');
  }
});

// ─── Menu dialog ─────────────────────────────────────────────────

menuCancel.addEventListener('click', () => { menuCancelResolve?.(); menuCancelResolve = null; });
document.addEventListener('keydown', (e) => {
  if (!menuOverlay.classList.contains('hidden') && e.key === 'Escape') {
    menuCancelResolve?.(); menuCancelResolve = null;
  }
});

// ─── Volume slider ───────────────────────────────────────────────

const volumePopup = $('volume-popup');
const volumeSliderV = $('volume-slider-v') as HTMLInputElement;
const volumeIconEl = $('volume-icon');

const savedVolume = localStorage.getItem('qsp_user_volume');
if (savedVolume !== null) {
  volumeSlider.value = savedVolume;
  volumeSliderV.value = savedVolume;
  midiPlayer.setUserVolume(Number(savedVolume));
  simpleAudio.setUserVolume(Number(savedVolume));
}

function setVolume(v: number) {
  volumeSlider.value = String(v);
  volumeSliderV.value = String(v);
  midiPlayer.setUserVolume(v);
  simpleAudio.setUserVolume(v);
  localStorage.setItem('qsp_user_volume', String(v));
}

volumeSlider.addEventListener('input', () => setVolume(Number(volumeSlider.value)));
volumeSliderV.addEventListener('input', () => setVolume(Number(volumeSliderV.value)));

// Mobile: toggle vertical volume popup
volumeIconEl.addEventListener('click', (e) => {
  e.stopPropagation();
  volumePopup.classList.toggle('hidden');
});
document.addEventListener('click', () => volumePopup.classList.add('hidden'));

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
  applyBackImage('');
  engine.loadGame(data);
  await engine.start();
  inputPanel.classList.toggle('hidden', !engine.state.showInput);
  statPanel.classList.toggle('hidden', !engine.state.showStat);
  actionsPanel.classList.toggle('hidden', !engine.state.showActs);
  objectsPanel.classList.toggle('hidden', !engine.state.showObjs || engine.state.objects.length === 0);
}

restartBtn.addEventListener('click', async () => {
  if (currentGameData) {
    viewPanel.classList.add('hidden');
    viewImg.classList.remove('expanded');
    viewImg.src = '';
    engine.stopTimer();
    applyColors(-1, -1, -1);
    applyBackImage('');
    engine.loadGame(currentGameData);
    await engine.startFresh();
    inputPanel.classList.toggle('hidden', !engine.state.showInput);
    statPanel.classList.toggle('hidden', !engine.state.showStat);
    actionsPanel.classList.toggle('hidden', !engine.state.showActs);
    objectsPanel.classList.toggle('hidden', !engine.state.showObjs || engine.state.objects.length === 0);
  }
});

// ─── Catalog → Player ────────────────────────────────────────────

async function playGame(meta: GameMeta) {
  location.hash = meta.id;
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
    currentGameId = meta.file.replace(/[^a-zA-Z0-9._-]/g, '_');
    currentGameBase = meta.file.includes('/') ? meta.file.slice(0, meta.file.lastIndexOf('/') + 1) : '';
    await startGame(currentGameData);
  } catch (err) {
    mainText.textContent = `Ошибка загрузки игры: ${(err as Error).message}`;
  }
}

// ─── Back to catalog ─────────────────────────────────────────────

backBtn.addEventListener('click', () => {
  engine.stopTimer();
  midiPlayer.stop(null);
  simpleAudio.stop(null);
  currentGameData = null;
  revokeLocalAssets();
  viewPanel.classList.add('hidden');
  viewImg.classList.remove('expanded');
  viewImg.src = '';
  playerWrap.classList.add('hidden');
  catalogEl.classList.remove('hidden');
  history.replaceState(null, '', location.pathname);
});

function revokeLocalAssets() {
  if (localAssets) {
    revokeAssets(localAssets);
    localAssets = null;
  }
}

// ─── Catalog rendering ───────────────────────────────────────────

async function loadCatalog() {
  try {
    const resp = await fetch('/games.json');
    const games: GameMeta[] = await resp.json();
    renderCatalog(games);

    // Auto-open game from URL hash (e.g. #steelrat)
    const hash = location.hash.slice(1);
    if (hash) {
      const game = games.find(g => g.id === hash);
      if (game) playGame(game);
    }
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

// Hide catalog immediately if a game hash is present (avoids flash)
if (location.hash.length > 1) catalogEl.classList.add('hidden');

loadCatalog();

// ─── Drag-and-drop & file-input local game loading ──────────────

const dropZone = $('drop-zone');
const fileInput = $('file-input') as HTMLInputElement;
const fileBtn = $('file-btn');

// Prevent default on the whole catalog so the browser doesn't navigate away
catalogEl.addEventListener('dragover', (e) => e.preventDefault());
catalogEl.addEventListener('dragenter', (e) => e.preventDefault());

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', handleDrop);
// Also listen on catalog for convenience (files dropped anywhere on page)
catalogEl.addEventListener('drop', handleDrop);

fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const files = await collectFromFile(file);
    await playLocalGame(files);
  } catch (err) {
    alert('Ошибка: ' + (err as Error).message);
  }
  fileInput.value = '';
});

async function handleDrop(e: Event) {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('dragover');
  const de = e as DragEvent;
  try {
    const files = await collectDroppedFiles(de);
    await playLocalGame(files);
  } catch (err) {
    alert('Ошибка: ' + (err as Error).message);
  }
}

/** Load and start a local game from collected files */
async function playLocalGame(files: Map<string, Blob>) {
  revokeLocalAssets();
  const { qspData, title, assets } = await prepareLocalGame(files);
  localAssets = assets;

  playerTitle.textContent = title;
  catalogEl.classList.add('hidden');
  playerWrap.classList.remove('hidden');
  mainText.textContent = 'Загрузка…';
  actionsList.innerHTML = '';

  currentGameData = qspData;
  currentGameId = 'local_' + title.replace(/[^a-zA-Z0-9._-]/g, '_');
  currentGameBase = '';
  await startGame(qspData);
}
