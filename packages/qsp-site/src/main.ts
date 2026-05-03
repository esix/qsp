import { QspEngine } from 'qsp-core/interpreter/engine.js';
import { MidiAudioPlayer, SimpleAudioPlayer } from 'qsp-player/audio.js';
import { collectDroppedFiles, collectFromFile, prepareLocalGame, revokeAssets } from 'qsp-player/local-files.js';
import { QspRenderer } from 'qsp-player/renderer.js';

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

const catalogEl     = $('catalog');
const gamesGrid     = $('games-grid');
const playerWrap    = $('player-wrap');
const playerTitle   = $('player-title');
const backBtn       = $('back-btn');
const restartBtn    = $('player-restart-btn');
const volumeSlider  = $('volume-slider') as HTMLInputElement;
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
let currentGameBase = '';
/** When a local game is loaded (drag-drop), maps lowercase relative path → blob URL */
let localAssets: Map<string, string> | null = null;

function resolveAssetUrl(path: string): string {
	const normalized = path.replace(/\\/g, '/');
	if (localAssets) {
		const url = localAssets.get(normalized.toLowerCase());
		if (url) return url;
	}
	return '/' + currentGameBase + normalized;
}

// Track audio playback completion (host-specific because we need localAssets)
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
			if (!resp.ok) return null;
			return new Uint8Array(await resp.arrayBuffer());
		} catch { return null; }
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

// ─── Player start/stop ───────────────────────────────────────────

async function startGame(data: Uint8Array) {
	engine.stopTimer();
	renderer.resetTheme();
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
		renderer.resetTheme();
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

if (location.hash.length > 1) catalogEl.classList.add('hidden');

loadCatalog();

// ─── Drag-and-drop & file-input local game loading ──────────────

const dropZone = $('drop-zone');
const fileInput = $('file-input') as HTMLInputElement;
const fileBtn = $('file-btn');

catalogEl.addEventListener('dragover', (e) => e.preventDefault());
catalogEl.addEventListener('dragenter', (e) => e.preventDefault());

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', handleDrop);
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
