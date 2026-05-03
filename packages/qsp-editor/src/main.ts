import { parseQsp, writeQsp } from 'qsp-core/parser/index.js';
import { Parser } from 'qsp-core/ast/parser.js';
import { QspEngine } from 'qsp-core/interpreter/engine.js';
import type { QspLocation } from 'qsp-core';
import { QspRenderer } from 'qsp-player/renderer.js';

// ─── DOM ─────────────────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!;

const newProjectBtn = $('new-project-btn');
const openInput     = $('open-input') as HTMLInputElement;
const saveQspsBtn   = $('save-qsps-btn');
const saveQspBtn    = $('save-qsp-btn');
const projectStatus = $('project-status');
const runBtn        = $('run-btn');

const locList       = $('loc-list');
const addLocBtn     = $('add-loc-btn');

const locNameInput  = $('loc-name-input') as HTMLInputElement;
const renameBtn     = $('rename-btn');
const deleteBtn     = $('delete-btn');
const codeEditor    = $('code-editor') as HTMLTextAreaElement;

const previewArea   = $('preview-area');
const playFromBtn   = $('play-from-here-btn');
const reloadBtn     = $('reload-preview-btn');

const problemsList  = $('problems-list');
const problemsCount = $('problems-count');

// ─── Project state ──────────────────────────────────────────────

interface Loc { name: string; code: string; }
let locs: Loc[] = [];
let curIdx: number | null = null;
let dirty = false;

const STORAGE_KEY = 'qsp_editor_project';

function saveLocal() {
	try { localStorage.setItem(STORAGE_KEY, JSON.stringify(locs)); } catch {}
}

function loadLocal(): Loc[] | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? arr : null;
	} catch { return null; }
}

function setDirty(v: boolean) {
	dirty = v;
	projectStatus.textContent = v ? '● несохранено' : '';
}

// ─── Sidebar rendering ──────────────────────────────────────────

function renderSidebar() {
	locList.innerHTML = '';
	locs.forEach((loc, i) => {
		const li = document.createElement('li');
		li.textContent = loc.name;
		li.className = (i === curIdx) ? 'selected' : '';
		li.addEventListener('click', () => selectLoc(i));
		locList.appendChild(li);
	});
}

function selectLoc(i: number | null) {
	// Save current edits before switching
	flushEditor();
	curIdx = i;
	if (i === null) {
		locNameInput.value = '';
		locNameInput.disabled = true;
		codeEditor.value = '';
		codeEditor.disabled = true;
		renameBtn.setAttribute('disabled', '');
		deleteBtn.setAttribute('disabled', '');
	} else {
		locNameInput.value = locs[i].name;
		locNameInput.disabled = false;
		codeEditor.value = locs[i].code;
		codeEditor.disabled = false;
		renameBtn.removeAttribute('disabled');
		deleteBtn.removeAttribute('disabled');
	}
	renderSidebar();
}

function flushEditor() {
	if (curIdx === null) return;
	const newCode = codeEditor.value;
	if (locs[curIdx].code !== newCode) {
		locs[curIdx].code = newCode;
		setDirty(true);
		saveLocal();
	}
}

// ─── Locations operations ──────────────────────────────────────

function addLoc() {
	const name = prompt('Имя новой локации:');
	if (!name) return;
	if (locs.some(l => l.name.toUpperCase() === name.toUpperCase())) {
		alert(`Локация "${name}" уже существует`);
		return;
	}
	locs.push({ name, code: '' });
	setDirty(true);
	saveLocal();
	selectLoc(locs.length - 1);
	codeEditor.focus();
	validate();
}

function deleteLoc() {
	if (curIdx === null) return;
	if (!confirm(`Удалить локацию "${locs[curIdx].name}"?`)) return;
	locs.splice(curIdx, 1);
	setDirty(true);
	saveLocal();
	selectLoc(locs.length ? Math.min(curIdx, locs.length - 1) : null);
	validate();
}

function renameLoc() {
	if (curIdx === null) return;
	const newName = locNameInput.value.trim();
	if (!newName) { locNameInput.value = locs[curIdx].name; return; }
	if (newName === locs[curIdx].name) return;
	if (locs.some((l, i) => i !== curIdx && l.name.toUpperCase() === newName.toUpperCase())) {
		alert(`Локация "${newName}" уже существует`);
		locNameInput.value = locs[curIdx].name;
		return;
	}
	locs[curIdx].name = newName;
	setDirty(true);
	saveLocal();
	renderSidebar();
	validate();
}

// ─── Validation ─────────────────────────────────────────────────

const parser = new Parser();
let validateTimer: number | null = null;

interface Problem { severity: 'error' | 'warn'; loc: string; msg: string; }

function validate() {
	flushEditor();
	const problems: Problem[] = [];

	// Duplicate names
	const seen = new Map<string, string>();
	for (const loc of locs) {
		const key = loc.name.toUpperCase();
		if (seen.has(key)) {
			problems.push({ severity: 'error', loc: loc.name, msg: `дубликат имени "${loc.name}"` });
		} else {
			seen.set(key, loc.name);
		}
	}

	// Parse errors
	for (const loc of locs) {
		if (!loc.code.trim()) continue;
		try {
			parser.parse(loc.code);
		} catch (e: any) {
			problems.push({ severity: 'error', loc: loc.name, msg: e.message });
		}
	}

	// Dangling gt/gs targets
	const valid = new Set<string>(locs.map(l => l.name.toUpperCase()));
	const targetRe = /\b(gt|gs|goto|gosub|xgt|xgoto)\s*['"]([^'"]+)['"]/gi;
	for (const loc of locs) {
		let m: RegExpExecArray | null;
		targetRe.lastIndex = 0;
		while ((m = targetRe.exec(loc.code)) !== null) {
			const t = m[2].toUpperCase();
			if (!valid.has(t)) {
				problems.push({ severity: 'warn', loc: loc.name, msg: `${m[1]} '${m[2]}' — нет такой локации` });
			}
		}
	}

	renderProblems(problems);
}

function renderProblems(problems: Problem[]) {
	problemsList.innerHTML = '';
	problemsCount.textContent = String(problems.length);
	for (const p of problems) {
		const li = document.createElement('li');
		li.className = p.severity;
		li.innerHTML = `<span class="prob-loc">${p.loc}</span> ${p.msg}`;
		li.addEventListener('click', () => {
			const idx = locs.findIndex(l => l.name === p.loc);
			if (idx >= 0) selectLoc(idx);
		});
		problemsList.appendChild(li);
	}
}

function scheduleValidate() {
	if (validateTimer !== null) clearTimeout(validateTimer);
	validateTimer = window.setTimeout(validate, 300);
}

// ─── .qsps source format (same as _examples/povelitel/compile.ts) ──

function locsToQsps(locs: Loc[]): string {
	return locs.map(l => `# ${l.name}\n${l.code}\n`).join('\n');
}

function qspsToLocs(source: string): Loc[] {
	const out: Loc[] = [];
	let curName: string | null = null;
	let buf: string[] = [];
	const flush = () => {
		if (curName === null) return;
		while (buf.length && buf[buf.length - 1].trim() === '') buf.pop();
		out.push({ name: curName, code: buf.join('\r\n') });
		curName = null; buf = [];
	};
	for (const line of source.split(/\r?\n/)) {
		const m = line.match(/^#\s+(\S.*?)\s*$/);
		if (m) { flush(); curName = m[1]; }
		else if (curName !== null) buf.push(line);
	}
	flush();
	return out;
}

// ─── Open / save ────────────────────────────────────────────────

async function openFile(file: File) {
	try {
		const buf = await file.arrayBuffer();
		if (/\.qsps$/i.test(file.name)) {
			const text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
			locs = qspsToLocs(text);
		} else if (/\.qsp$/i.test(file.name)) {
			const game = parseQsp(new Uint8Array(buf));
			locs = game.locations.map(l => ({ name: l.name, code: l.code }));
		} else {
			alert('Поддерживаются только .qsp и .qsps файлы');
			return;
		}
		if (locs.length === 0) {
			alert('В файле не найдено ни одной локации.');
			return;
		}
		setDirty(false);
		saveLocal();
		selectLoc(0);
		validate();
	} catch (e: any) {
		alert('Ошибка открытия: ' + e.message);
	}
}

function download(filename: string, data: BlobPart, type: string) {
	const blob = new Blob([data], { type });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveQsps() {
	flushEditor();
	const text = locsToQsps(locs);
	download('project.qsps', text, 'text/plain;charset=utf-8');
	setDirty(false);
}

function saveQsp() {
	flushEditor();
	const fullLocs: QspLocation[] = locs.map(l => ({ name: l.name, code: l.code, description: '', actions: [] }));
	const bytes = writeQsp({ locations: fullLocs });
	download('project.qsp', bytes, 'application/octet-stream');
}

// ─── Live preview ───────────────────────────────────────────────

let engine: QspEngine | null = null;

function buildGame(): QspLocation[] {
	flushEditor();
	return locs.map(l => ({ name: l.name, code: l.code, description: '', actions: [] }));
}

function startPreview(fromLoc: string | null = null) {
	const locations = buildGame();
	if (locations.length === 0) {
		previewArea.textContent = 'Нет локаций';
		previewArea.className = 'empty';
		return;
	}
	previewArea.className = '';
	previewArea.innerHTML = `
		<div id="prev-main"></div>
		<ul id="prev-actions"></ul>
		<div id="prev-stat"></div>
	`;
	const mainDiv = previewArea.querySelector('#prev-main') as HTMLElement;
	const actsUl  = previewArea.querySelector('#prev-actions') as HTMLElement;
	const statDiv = previewArea.querySelector('#prev-stat') as HTMLElement;

	engine = new QspEngine();
	new QspRenderer({
		engine,
		mainText: mainDiv,
		actionsList: actsUl,
		statText: statDiv,
		// Editor doesn't have asset directory — pass paths through unchanged
		resolveAssetUrl: (path) => path,
	});

	engine.loadParsedGame({ version: 'QSP 5.7.0', password: '', isOldFormat: false, locations });
	(async () => {
		try {
			if (fromLoc) {
				await engine!.gotoLocation(fromLoc, [], false);
			} else {
				await engine!.start();
			}
		} catch (e: any) {
			mainDiv.textContent = 'Ошибка: ' + e.message;
		}
	})();
}

// ─── Wiring ─────────────────────────────────────────────────────

newProjectBtn.addEventListener('click', () => {
	if (dirty && !confirm('В проекте несохранённые изменения. Продолжить?')) return;
	locs = [];
	setDirty(false);
	saveLocal();
	selectLoc(null);
	validate();
});

openInput.addEventListener('change', async () => {
	const file = openInput.files?.[0];
	if (!file) return;
	if (dirty && !confirm('В проекте несохранённые изменения. Продолжить?')) {
		openInput.value = ''; return;
	}
	await openFile(file);
	openInput.value = '';
});

saveQspsBtn.addEventListener('click', saveQsps);
saveQspBtn.addEventListener('click', saveQsp);

addLocBtn.addEventListener('click', addLoc);
deleteBtn.addEventListener('click', deleteLoc);
renameBtn.addEventListener('click', renameLoc);
locNameInput.addEventListener('keydown', e => {
	if (e.key === 'Enter') renameLoc();
});

codeEditor.addEventListener('input', () => {
	setDirty(true);
	saveLocal();
	scheduleValidate();
});

function showPreview(fromLoc: string | null = null) {
	document.body.classList.add('show-preview');
	startPreview(fromLoc);
}

runBtn.addEventListener('click', () => showPreview());
reloadBtn.addEventListener('click', () => showPreview());
playFromBtn.addEventListener('click', () => {
	if (curIdx !== null) showPreview(locs[curIdx].name);
});

// "Back to editor" button (visible on narrow viewports)
const backBtn = document.createElement('button');
backBtn.textContent = '← Назад к редактору';
backBtn.id = 'back-to-editor';
backBtn.addEventListener('click', () => document.body.classList.remove('show-preview'));
$('preview-header').insertBefore(backBtn, $('preview-header').firstChild);

// Warn on close if dirty
window.addEventListener('beforeunload', e => {
	if (dirty) e.preventDefault();
});

// ─── Boot ───────────────────────────────────────────────────────

const restored = loadLocal();
if (restored && restored.length > 0) {
	locs = restored;
	selectLoc(0);
	setDirty(false);
} else {
	selectLoc(null);
}
validate();
