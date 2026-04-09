import { QspEngine } from 'qsp-core/interpreter/engine.js';
import type { QspRuntimeAction, QspObject } from 'qsp-core/interpreter/state.js';

// ─── DOM Elements ────────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!;

const fileInput = $('file-input') as HTMLInputElement;
const gameEl = $('game');
const mainText = $('main-text');
const statText = $('stat-text');
const actionsList = $('actions-list');
const objectsList = $('objects-list');
const inputLine = $('input-line') as HTMLInputElement;
const inputSubmit = $('input-submit');
const inputPanel = $('input-panel');
const statPanel = $('stat-panel');
const actionsPanel = $('actions-panel');
const objectsPanel = $('objects-panel');
const msgOverlay = $('msg-overlay');
const msgText = $('msg-text');
const msgOk = $('msg-ok');
const restartBtn = $('restart-btn');

// ─── Engine ──────────────────────────────────────────────────────

// ─── Colour helpers ──────────────────────────────────────────────

/** QSP COLORREF integer (0x00BBGGRR) → CSS #rrggbb */
function qspColorToCss(color: number): string {
  const r = (color & 0xFF).toString(16).padStart(2, '0');
  const g = ((color >> 8) & 0xFF).toString(16).padStart(2, '0');
  const b = ((color >> 16) & 0xFF).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function applyColors(bcolor: number, fcolor: number, lcolor: number) {
  const root = gameEl.style;
  root.setProperty('--game-bg',   bcolor >= 0 ? qspColorToCss(bcolor) : '');
  root.setProperty('--game-fg',   fcolor >= 0 ? qspColorToCss(fcolor) : '');
  root.setProperty('--game-link', lcolor >= 0 ? qspColorToCss(lcolor) : '');
}

// ─── Engine ──────────────────────────────────────────────────────

const engine = new QspEngine();

/**
 * Browsers decode HTML entities in href attributes (e.g. &gt → >).
 * QSP exec: links use & as statement separator and keywords like gt/lt,
 * so "exec:dynamic ''&gt '0'" becomes "exec:dynamic ''>'0'" after parsing —
 * breaking the QSP code. Re-encode bare & inside exec: hrefs as &amp; so the
 * round-trip through the HTML parser preserves the original & characters.
 */
function protectExecHrefs(html: string): string {
  return html.replace(/href="exec:([^"]*)"/gi, (_, cmd) =>
    `href="exec:${cmd.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;')}"`
  );
}

engine.on({
  onMainTextChanged(text: string) {
    if (engine.state.useHtml) {
      mainText.innerHTML = protectExecHrefs(text);
    } else {
      mainText.textContent = text;
    }
    // Auto-scroll to bottom
    mainText.parentElement!.scrollTop = mainText.parentElement!.scrollHeight;
  },

  onStatTextChanged(text: string) {
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
      if (engine.state.useHtml) {
        li.innerHTML = actions[i].name;
      } else {
        li.textContent = actions[i].name;
      }
      li.addEventListener('click', () => { engine.execAction(i); });
      actionsList.appendChild(li);
    }
    actionsPanel.classList.toggle('hidden', !engine.state.showActs);
  },

  onObjectsChanged(objects: QspObject[]) {
    objectsList.innerHTML = '';
    for (let i = 0; i < objects.length; i++) {
      const li = document.createElement('li');
      if (engine.state.useHtml) {
        li.innerHTML = objects[i].name;
      } else {
        li.textContent = objects[i].name;
      }
      li.addEventListener('click', () => { engine.selectObject(i); });
      objectsList.appendChild(li);
    }
    objectsPanel.classList.toggle('hidden', !engine.state.showObjs || objects.length === 0);
  },

  onMessage(text: string) {
    msgText.textContent = text;
    msgOverlay.classList.remove('hidden');
  },

  onInput(prompt: string): string {
    return window.prompt(prompt) ?? '';
  },

  onView(path: string) {
    // Could show an image — for now just log
    console.log('VIEW:', path);
  },

  onColorsChanged(bcolor: number, fcolor: number, lcolor: number) {
    applyColors(bcolor, fcolor, lcolor);
  },

  onSaveGame(filename: string, data: string) {
    try { localStorage.setItem('qsp_' + currentGameId + '_' + filename, data); } catch {}
  },

  onLoadGame(filename: string): string | null {
    try { return localStorage.getItem('qsp_' + currentGameId + '_' + filename); } catch { return null; }
  },
});

// ─── HTML link interception ──────────────────────────────────────
// In QSP HTML mode, <a href="N"> executes action N (1-based index).

function handleQspLink(e: MouseEvent) {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return;

  const href = anchor.getAttribute('href') ?? '';

  // exec: links run an arbitrary QSP command, e.g. <a href="exec:gt'location'"> or <a href="EXEC: gt 'location'">
  if (href.toLowerCase().startsWith('exec:')) {
    e.preventDefault();
    engine.execDynamic(href.slice('exec:'.length).trim(), []);
    return;
  }

  // Numeric hrefs execute the corresponding action (1-based)
  const actionIndex = parseInt(href, 10);
  if (!isNaN(actionIndex) && String(actionIndex) === href.trim()) {
    e.preventDefault();
    engine.execAction(actionIndex - 1);
  }
}

mainText.addEventListener('click', handleQspLink);
statText.addEventListener('click', handleQspLink);

// ─── Message dialog ──────────────────────────────────────────────

msgOk.addEventListener('click', () => {
  msgOverlay.classList.add('hidden');
});

// ─── Input handling ──────────────────────────────────────────────

function submitInput() {
  const text = inputLine.value;
  engine.submitInput(text);
  inputLine.value = '';
}

inputSubmit.addEventListener('click', submitInput);
inputLine.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitInput();
});

// ─── File loading ────────────────────────────────────────────────

let currentGameData: Uint8Array | null = null;
let currentGameId = '';

async function startGame(data: Uint8Array) {
  try {
    engine.stopTimer();
    applyColors(-1, -1, -1);
    engine.loadGame(data);
    gameEl.classList.remove('hidden');
    dropZone.classList.add('hidden');
    gameRunning = true;
    restartBtn.classList.remove('hidden');
    await engine.start();

    inputPanel.classList.toggle('hidden', !engine.state.showInput);
    statPanel.classList.toggle('hidden', !engine.state.showStat);
    actionsPanel.classList.toggle('hidden', !engine.state.showActs);
    objectsPanel.classList.toggle('hidden', !engine.state.showObjs || engine.state.objects.length === 0);
  } catch (e) {
    alert('Failed to load game: ' + (e as Error).message);
    console.error(e);
  }
}

async function loadFile(file: File) {
  const buffer = await file.arrayBuffer();
  currentGameData = new Uint8Array(buffer);
  currentGameId = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  await startGame(currentGameData);
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

restartBtn.addEventListener('click', () => {
  if (currentGameData) startGame(currentGameData);
});

// ─── Drag & Drop ─────────────────────────────────────────────────

const dropZone = $('drop-zone');
const dropOverlay = $('drop-overlay');
let gameRunning = false;

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (gameRunning) {
    dropOverlay.classList.remove('hidden');
  } else {
    dropZone.classList.add('drag-hover');
  }
});

document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) {
    dropZone.classList.remove('drag-hover');
    dropOverlay.classList.add('hidden');
  }
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-hover');
  dropOverlay.classList.add('hidden');

  const file = e.dataTransfer?.files[0];
  if (file && file.name.endsWith('.qsp')) {
    loadFile(file);
  }
});

// ─── Keyboard shortcuts ──────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (msgOverlay.classList.contains('hidden')) return;
  if (e.key === 'Enter' || e.key === 'Escape') {
    msgOverlay.classList.add('hidden');
  }
});
