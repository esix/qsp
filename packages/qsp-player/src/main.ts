import { QspEngine } from 'qsp-core/interpreter/engine.js';
import { MidiAudioPlayer, SimpleAudioPlayer } from './audio.js';
import { collectDroppedFiles, collectFromFile, prepareLocalGame, revokeAssets } from './local-files.js';
import { QspRenderer } from './renderer.js';

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
const mainPanel     = $('main-panel');
const volumePopup   = $('volume-popup');
const volumeSliderV = $('volume-slider-v') as HTMLInputElement;
const volumeIconEl  = $('volume-icon');

// ─── Engine + audio + state ─────────────────────────────────────

const engine = new QspEngine();
const midiPlayer = new MidiAudioPlayer();
const simpleAudio = new SimpleAudioPlayer();

let currentGameData: Uint8Array | null = null;
let currentGameId = '';
/** When a server-hosted game is loaded, this is the base URL path (e.g. 'jupiter2/'). */
let currentGameBase = '';
/** When a local game is loaded (drag-drop), maps lowercase relative path → blob URL. */
let localAssets: Map<string, string> | null = null;

/** Resolve a game-relative asset path to a usable URL (passed to renderer). */
function resolveAssetUrl(path: string): string {
	const normalized = path.replace(/\\/g, '/');
	if (localAssets) {
		const url = localAssets.get(normalized.toLowerCase());
		if (url) return url;
	}
	return '/' + currentGameBase + normalized;
}

// Track audio playback completion. Host-specific because we have access to localAssets
// for reverse-mapping blob URLs back to original paths.
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

// ─── Renderer ────────────────────────────────────────────────────

const renderer = new QspRenderer({
	engine,
	mainText, actionsList, statText, objectsList,
	gameEl, mainPanel,
	viewPanel, viewImg,
	statPanel, actionsPanel, objectsPanel,
	msgOverlay, msgText, msgOk,
	menuOverlay, menuList, menuCancel,
	inputLine, inputSubmit, inputPanel,
	resolveAssetUrl,
	midiPlayer, simpleAudio,
	volumeSliders: [volumeSlider, volumeSliderV],
	saveGame: (filename, data) => {
		try { localStorage.setItem('qsp_' + currentGameId + '_' + filename, data); } catch {}
	},
	loadGame: (filename) => {
		try { return localStorage.getItem('qsp_' + currentGameId + '_' + filename); } catch { return null; }
	},
	loadQst: async (filename) => {
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

// ─── User volume slider ──────────────────────────────────────────

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
volumeIconEl.addEventListener('click', () => volumePopup.classList.toggle('hidden'));
document.addEventListener('click', (e) => {
	if (!(e.target as HTMLElement).closest('#volume-control')) {
		volumePopup.classList.add('hidden');
	}
});

// ─── Game start ──────────────────────────────────────────────────

async function startGame(data: Uint8Array) {
	engine.stopTimer();
	renderer.resetTheme();
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

restartBtn.addEventListener('click', async () => {
	if (currentGameData) {
		viewPanel.classList.add('hidden');
		viewImg.classList.remove('expanded');
		viewImg.src = '';
		engine.stopTimer();
		renderer.resetTheme();
		engine.loadGame(currentGameData);
		await engine.startFresh();
		inputPanel.classList.toggle('hidden', !engine.state.showInput);
		statPanel.classList.toggle('hidden', !engine.state.showStat);
		actionsPanel.classList.toggle('hidden', !engine.state.showActs);
		objectsPanel.classList.toggle('hidden', !engine.state.showObjs || engine.state.objects.length === 0);
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
			const rel = fileList[i].webkitRelativePath;
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
