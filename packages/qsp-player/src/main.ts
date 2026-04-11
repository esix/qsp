import { QspEngine } from 'qsp-core/interpreter/engine.js';
import type { QspRuntimeAction, QspObject } from 'qsp-core/interpreter/state.js';
import { MidiAudioPlayer, SimpleAudioPlayer } from './audio.js';
import { collectDroppedFiles, collectFromFile, prepareLocalGame, revokeAssets } from './local-files.js';

// ─── DOM ─────────────────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!;

const dropZone      = $('drop-zone');
const gameEl        = $('game');
const mainText      = $('main-text');
const statText      = $('stat-text');
const actionsList   = $('actions-list');
const objectsList   = $('objects-list');
const inputLine     = $('input-line') as HTMLInputElement;
const inputSubmit   = $('input-submit');
const inputPanel    = $('input-panel');
const statPanel     = $('stat-panel');
const actionsPanel  = $('actions-panel');
const objectsPanel  = $('objects-panel');
const msgOverlay    = $('msg-overlay');
const msgText       = $('msg-text');
const msgOk         = $('msg-ok');
const fileInput     = $('file-input') as HTMLInputElement;
const restartBtn    = $('restart-btn');
const dropOverlay   = $('drop-overlay');
const volumeControl = $('volume-control');
const volumeSlider  = $('volume-slider') as HTMLInputElement;
const viewPanel     = $('view-panel');
const viewImg       = $('view-img') as HTMLImageElement;
const menuOverlay   = $('menu-overlay');
const menuList      = $('menu-list');
const menuCancel    = $('menu-cancel');

// ─── Engine ──────────────────────────────────────────────────────

const engine = new QspEngine();
let currentGameData: Uint8Array | null = null;
let currentGameId = '';
/** When a server-hosted game is loaded, this is the base URL path (e.g. 'jupiter2/') */
let currentGameBase = '';
/** When a local game is loaded (drag-drop), maps lowercase relative path → blob URL */
let localAssets: Map<string, string> | null = null;
let menuCancelResolve: (() => void) | null = null;

const midiPlayer = new MidiAudioPlayer();
const simpleAudio = new SimpleAudioPlayer();

simpleAudio.onFileEnded = (url: string) => {
  if (localAssets) {
    for (const [path, blobUrl] of localAssets) {
      if (blobUrl === url) {
        engine.state.playingFiles.delete(path.toUpperCase());
        return;
      }
    }
  }
  const base = '/' + currentGameBase;
  const relative = url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, '');
  engine.state.playingFiles.delete(relative.toUpperCase());
};

function isMidi(file: string): boolean {
  return /\.(mid|midi)$/i.test(file);
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Resolve a game-relative asset path to a usable URL */
function resolveAssetUrl(path: string): string {
  if (localAssets) {
    const url = localAssets.get(path.toLowerCase());
    if (url) return url;
  }
  return '/' + currentGameBase + path;
}

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
  const mainPanel = $('main-panel');
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
    const resolved = resolveAssetUrl(path);
    return pre + (quote || '"') + resolved + (quote || '"');
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
      const ct = resp.headers.get('content-type') ?? '';
      if (!resp.ok || ct.includes('text/html')) {
        alert(`Cannot load library "${filename}".\nLoad a folder or ZIP containing all game files.`);
        return null;
      }
      return new Uint8Array(await resp.arrayBuffer());
    } catch {
      alert(`Cannot load library "${filename}".\nLoad a folder or ZIP containing all game files.`);
      return null;
    }
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

const savedVolume = localStorage.getItem('qsp_user_volume');
if (savedVolume !== null) {
  volumeSlider.value = savedVolume;
  midiPlayer.setUserVolume(Number(savedVolume));
  simpleAudio.setUserVolume(Number(savedVolume));
}

volumeSlider.addEventListener('input', () => {
  const v = Number(volumeSlider.value);
  midiPlayer.setUserVolume(v);
  simpleAudio.setUserVolume(v);
  localStorage.setItem('qsp_user_volume', String(v));
});

// ─── Input ───────────────────────────────────────────────────────

function submitInput() {
  engine.submitInput(inputLine.value);
  inputLine.value = '';
}
inputSubmit.addEventListener('click', submitInput);
inputLine.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitInput(); });

// ─── Game start ──────────────────────────────────────────────────

async function startGame(data: Uint8Array) {
  engine.stopTimer();
  applyColors(-1, -1, -1);
  applyBackImage('');
  engine.loadGame(data);
  await engine.start();

  dropZone.classList.add('hidden');
  gameEl.classList.remove('hidden');
  restartBtn.classList.remove('hidden');
  volumeControl.classList.remove('hidden');
  inputPanel.classList.toggle('hidden', !engine.state.showInput);
  statPanel.classList.toggle('hidden', !engine.state.showStat);
  actionsPanel.classList.toggle('hidden', !engine.state.showActs);
  objectsPanel.classList.toggle('hidden', !engine.state.showObjs || engine.state.objects.length === 0);
}

restartBtn.addEventListener('click', () => {
  if (currentGameData) {
    viewPanel.classList.add('hidden');
    viewImg.classList.remove('expanded');
    viewImg.src = '';
    startGame(currentGameData);
  }
});

// ─── Drag-and-drop & file input ─────────────────────────────────

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (gameEl.classList.contains('hidden')) {
    dropZone.classList.add('drag-hover');
  } else {
    dropOverlay.classList.remove('hidden');
  }
});
document.addEventListener('dragleave', (e) => {
  if (!(e as DragEvent).relatedTarget) {
    dropZone.classList.remove('drag-hover');
    dropOverlay.classList.add('hidden');
  }
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-hover');
  dropOverlay.classList.add('hidden');
  try {
    const files = await collectDroppedFiles(e as DragEvent);
    await loadLocalGame(files);
  } catch (err) {
    alert('Error: ' + (err as Error).message);
  }
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const files = await collectFromFile(file);
    await loadLocalGame(files);
  } catch (err) {
    alert('Error: ' + (err as Error).message);
  }
  fileInput.value = '';
});

// Folder input — loads all files from a selected directory
const folderInput = $('folder-input') as HTMLInputElement;
folderInput.addEventListener('change', async () => {
  const fileList = folderInput.files;
  if (!fileList || fileList.length === 0) return;
  try {
    const files = new Map<string, Blob>();
    for (let i = 0; i < fileList.length; i++) {
      // webkitRelativePath gives "dirname/subdir/file.ext"
      const rel = fileList[i].webkitRelativePath;
      // Strip the top-level directory name to get game-relative path
      const path = rel.includes('/') ? rel.slice(rel.indexOf('/') + 1) : rel;
      files.set(path.toLowerCase(), fileList[i]);
    }
    await loadLocalGame(files);
  } catch (err) {
    alert('Error: ' + (err as Error).message);
  }
  folderInput.value = '';
});

function cleanupLocalAssets() {
  if (localAssets) {
    revokeAssets(localAssets);
    localAssets = null;
  }
}

async function loadLocalGame(files: Map<string, Blob>) {
  engine.stopTimer();
  midiPlayer.stop(null);
  simpleAudio.stop(null);
  cleanupLocalAssets();

  const { qspData, title, assets } = await prepareLocalGame(files);
  localAssets = assets;
  currentGameData = qspData;
  currentGameId = 'local_' + title.replace(/[^a-zA-Z0-9._-]/g, '_');
  currentGameBase = '';

  document.title = title + ' — QSP Player';
  await startGame(qspData);
}
