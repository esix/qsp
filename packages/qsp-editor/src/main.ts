import { parseQsp, writeQsp } from 'qsp-core/parser/index.js';
import { Parser } from 'qsp-core/ast/parser.js';
import { QspEngine } from 'qsp-core/interpreter/engine.js';
import type { QspLocation } from 'qsp-core';
import { QspRenderer } from 'qsp-player/renderer.js';

// ─── DOM ─────────────────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!;

const menuBtn       = $('menu-btn');
const menuDropdown  = $('menu-dropdown');
const newProjectBtn = $('new-project-btn');
const openInput     = $('open-input') as HTMLInputElement;
const saveQspsBtn   = $('save-qsps-btn');
const saveQspBtn    = $('save-qsp-btn');
const projectStatus = $('project-status');
const runBtn        = $('run-btn');

const locList       = $('loc-list');
const addLocBtn     = $('add-loc-btn');

const locNameDisplay = $('loc-name-display');
const codeEditor    = $('code-editor') as HTMLTextAreaElement;

const previewArea   = $('preview-area');
const playFromBtn   = $('play-from-here-btn');
const reloadBtn     = $('reload-preview-btn');
const varsFilter    = $('vars-filter') as HTMLInputElement;
const varsCount     = $('vars-count');
const varsTbody     = document.querySelector('#vars-table tbody') as HTMLElement;
const tabProblems   = $('tab-problems');
const tabVars       = $('tab-vars');
const varsPane      = $('vars-pane');
const followBtn     = $('follow-toggle-btn');
const tabCode       = $('tab-code');
const tabGraph      = $('tab-graph');
const graphView     = $('graph-view');
const graphControls = $('graph-controls');
const graphHideInternal = $('graph-hide-internal') as HTMLInputElement;
const graphRefreshBtn = $('graph-refresh');

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
		li.className = (i === curIdx) ? 'selected' : '';
		li.draggable = true;
		li.dataset.idx = String(i);

		const nameSpan = document.createElement('span');
		nameSpan.className = 'loc-name';
		nameSpan.textContent = loc.name;

		const renameBtn = document.createElement('button');
		renameBtn.className = 'loc-action loc-rename';
		renameBtn.title = 'Переименовать';
		renameBtn.textContent = '✎';
		renameBtn.addEventListener('click', e => { e.stopPropagation(); startRename(i, nameSpan); });

		const deleteBtn = document.createElement('button');
		deleteBtn.className = 'loc-action loc-delete';
		deleteBtn.title = 'Удалить';
		deleteBtn.textContent = '×';
		deleteBtn.addEventListener('click', e => { e.stopPropagation(); deleteLoc(i); });

		li.appendChild(nameSpan);
		li.appendChild(renameBtn);
		li.appendChild(deleteBtn);

		li.addEventListener('click', () => selectLoc(i));
		nameSpan.addEventListener('dblclick', e => { e.stopPropagation(); startRename(i, nameSpan); });

		// Drag-to-reorder
		li.addEventListener('dragstart', e => {
			dragSrcIdx = i;
			li.classList.add('dragging');
			e.dataTransfer!.effectAllowed = 'move';
			// Some browsers require setData to start drag
			e.dataTransfer!.setData('text/plain', String(i));
		});
		li.addEventListener('dragend', () => {
			li.classList.remove('dragging');
			document.querySelectorAll('#loc-list li.drop-before, #loc-list li.drop-after')
				.forEach(el => el.classList.remove('drop-before', 'drop-after'));
		});
		li.addEventListener('dragover', e => {
			if (dragSrcIdx === null || dragSrcIdx === i) return;
			e.preventDefault();
			e.dataTransfer!.dropEffect = 'move';
			const r = li.getBoundingClientRect();
			const before = (e.clientY - r.top) < r.height / 2;
			li.classList.toggle('drop-before', before);
			li.classList.toggle('drop-after', !before);
		});
		li.addEventListener('dragleave', () => {
			li.classList.remove('drop-before', 'drop-after');
		});
		li.addEventListener('drop', e => {
			e.preventDefault();
			if (dragSrcIdx === null || dragSrcIdx === i) return;
			const r = li.getBoundingClientRect();
			const before = (e.clientY - r.top) < r.height / 2;
			let target = before ? i : i + 1;
			reorderLoc(dragSrcIdx, target);
			dragSrcIdx = null;
		});

		locList.appendChild(li);
	});
}

let dragSrcIdx: number | null = null;

function reorderLoc(from: number, to: number) {
	if (from < 0 || from >= locs.length) return;
	if (to > locs.length) to = locs.length;
	if (to === from || to === from + 1) return;
	const [moved] = locs.splice(from, 1);
	const insertAt = to > from ? to - 1 : to;
	locs.splice(insertAt, 0, moved);
	// Track curIdx through the move
	if (curIdx !== null) {
		if (curIdx === from) curIdx = insertAt;
		else if (from < curIdx && insertAt >= curIdx) curIdx--;
		else if (from > curIdx && insertAt <= curIdx) curIdx++;
	}
	setDirty(true);
	saveLocal();
	renderSidebar();
	// Sidebar order changes meaning of "first location" (start). Invalidate graph cache.
	cachedLayout = null;
	if (activeTab === 'graph') renderGraph(true);
	validate();
}

function selectLoc(i: number | null) {
	flushEditor();
	curIdx = i;
	if (i === null) {
		locNameDisplay.textContent = '(нет выбранной локации)';
		codeEditor.value = '';
		codeEditor.disabled = true;
		codeEditor.placeholder = 'Выберите локацию слева или создайте новую';
	} else {
		locNameDisplay.textContent = locs[i].name;
		codeEditor.value = locs[i].code;
		codeEditor.disabled = false;
		codeEditor.placeholder = `Код локации "${locs[i].name}"`;
	}
	renderSidebar();
	if (activeTab === 'graph') renderGraph();
	// Scroll the selected item into view (no-op if already visible)
	if (i !== null) {
		const li = locList.children[i] as HTMLElement | undefined;
		if (li) {
			const liTop = li.offsetTop;
			const liBottom = liTop + li.offsetHeight;
			const viewTop = locList.scrollTop;
			const viewBottom = viewTop + locList.clientHeight;
			if (liTop < viewTop) locList.scrollTop = liTop;
			else if (liBottom > viewBottom) locList.scrollTop = liBottom - locList.clientHeight;
		}
	}
}

/** Replace a name span with an inline <input> for renaming. */
function startRename(i: number, nameSpan: HTMLElement) {
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'loc-rename-input';
	input.value = locs[i].name;
	// Prevent clicks inside the input from bubbling to the <li> click handler
	// (which would re-render the sidebar and destroy the input).
	input.addEventListener('click', e => e.stopPropagation());
	input.addEventListener('mousedown', e => e.stopPropagation());
	nameSpan.replaceWith(input);
	input.focus();
	// Place cursor at end, no selection.
	// Defer with setTimeout — Chrome auto-selects after programmatic focus()
	// and we need to override that after the browser default settles.
	setTimeout(() => {
		const end = input.value.length;
		input.setSelectionRange(end, end);
	}, 0);

	let finished = false;
	const finish = (commit: boolean) => {
		if (finished) return;
		finished = true;
		if (commit) {
			const newName = input.value.trim();
			if (newName && newName !== locs[i].name) {
				if (locs.some((l, j) => j !== i && l.name.toUpperCase() === newName.toUpperCase())) {
					alert(`Локация "${newName}" уже существует`);
				} else {
					locs[i].name = newName;
					setDirty(true);
					saveLocal();
					if (curIdx === i) locNameDisplay.textContent = newName;
				}
			}
		}
		renderSidebar();
		validate();
	};
	input.addEventListener('keydown', e => {
		if (e.key === 'Enter') { e.preventDefault(); finish(true); }
		else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
	});
	input.addEventListener('blur', () => finish(true));
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

function deleteLoc(i: number) {
	if (i < 0 || i >= locs.length) return;
	if (!confirm(`Удалить локацию "${locs[i].name}"?`)) return;
	locs.splice(i, 1);
	setDirty(true);
	saveLocal();
	if (curIdx !== null) {
		if (i < curIdx) curIdx--;
		else if (i === curIdx) curIdx = locs.length ? Math.min(curIdx, locs.length - 1) : null;
	}
	selectLoc(curIdx);
	validate();
}

// ─── Validation ─────────────────────────────────────────────────

const parser = new Parser();
let validateTimer: number | null = null;

interface Problem { severity: 'error' | 'warn'; loc: string; msg: string; line?: number; col?: number; }

/** Line number (1-based) for an offset in `text`. */
function offsetToLine(text: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < text.length; i++) {
		if (text[i] === '\n') line++;
	}
	return line;
}

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

	// Parse errors — extract line/col from messages like "Parse error at line N, col M: ..."
	for (const loc of locs) {
		if (!loc.code.trim()) continue;
		try {
			parser.parse(loc.code);
		} catch (e: any) {
			const msg = e.message ?? String(e);
			const m = msg.match(/line (\d+)(?:,\s*col (\d+))?/);
			problems.push({
				severity: 'error', loc: loc.name, msg,
				line: m ? parseInt(m[1], 10) : undefined,
				col: m && m[2] ? parseInt(m[2], 10) : undefined,
			});
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
				problems.push({
					severity: 'warn', loc: loc.name,
					msg: `${m[1]} '${m[2]}' — нет такой локации`,
					line: offsetToLine(loc.code, m.index),
				});
			}
		}
	}

	// Unclosed ACT/IF/ACT blocks: track multiline `ACT '...':` and `IF cond:` openers
	// against `END` closers. One-liners (with body after the colon on the same line)
	// don't need an END.
	for (const loc of locs) {
		if (!loc.code.trim()) continue;
		const lines = loc.code.split(/\r?\n/);
		const stack: { kind: 'ACT' | 'IF'; line: number }[] = [];
		// Strip string literals so a `:` inside one isn't mistaken for a block opener.
		// Don't strip `!` comments — `!` is also the not-equal operator (e.g. `if x ! '':`),
		// and comments accidentally containing ACT/IF/END are vastly less common than that.
		const stripStrings = (s: string) => s.replace(/'(?:''|[^'])*'/g, "''").replace(/"(?:""|[^"])*"/g, '""');
		for (let i = 0; i < lines.length; i++) {
			const stripped = stripStrings(lines[i]).trim();
			if (!stripped) continue;
			// Multiline ACT: line ends with ':' AND there is nothing useful after the colon.
			const actMatch = stripped.match(/^(?:p?act)\s+.*:\s*$/i);
			if (actMatch) { stack.push({ kind: 'ACT', line: i + 1 }); continue; }
			// Multiline IF: starts with IF, ends with ':' and nothing after
			const ifMatch  = stripped.match(/^if\b.*:\s*$/i);
			if (ifMatch)  { stack.push({ kind: 'IF',  line: i + 1 }); continue; }
			// END closes the innermost block
			if (/^end\b/i.test(stripped)) {
				if (stack.length === 0) {
					problems.push({ severity: 'warn', loc: loc.name, msg: `END без открывающего блока`, line: i + 1 });
				} else {
					stack.pop();
				}
			}
		}
		for (const open of stack) {
			problems.push({
				severity: 'warn', loc: loc.name,
				msg: `${open.kind} без закрывающего END`,
				line: open.line,
			});
		}
	}

	// Suspicious keyword typos: line "<ident> 'string':" where ident isn't ACT.
	const suspiciousActRe = /^[ \t]*([A-Za-z_][A-Za-z_0-9]*)[ \t]+(['"])[^'"\n]+\2[ \t]*:/gm;
	for (const loc of locs) {
		let m: RegExpExecArray | null;
		suspiciousActRe.lastIndex = 0;
		while ((m = suspiciousActRe.exec(loc.code)) !== null) {
			if (m[1].toUpperCase() !== 'ACT') {
				problems.push({
					severity: 'warn', loc: loc.name,
					msg: `"${m[1]} '...':" — неизвестное ключевое слово, возможно опечатка ACT?`,
					line: offsetToLine(loc.code, m.index),
				});
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
			if (idx < 0) return;
			selectLoc(idx);
			// Focus must happen synchronously inside the click handler — Chrome
			// won't grant focus to inputs outside an active user gesture.
			codeEditor.focus();
			if (p.line !== undefined) jumpTo(p.line, p.col ?? 1);
		});
		problemsList.appendChild(li);
	}
}

function scheduleValidate() {
	if (validateTimer !== null) clearTimeout(validateTimer);
	validateTimer = window.setTimeout(validate, 300);
}

/** Jump the code editor cursor to a 1-based line/column and scroll it into view. */
function jumpTo(line: number, col: number) {
	const text = codeEditor.value;
	let offset = 0;
	let curLine = 1;
	while (curLine < line && offset < text.length) {
		if (text[offset] === '\n') curLine++;
		offset++;
	}
	offset += Math.max(0, col - 1);
	codeEditor.focus();
	codeEditor.setSelectionRange(offset, offset);
	// Approximate scroll: target line × line-height, centred. Use cached lineHeight from
	// computed style so we don't depend on hard-coded values.
	const lh = parseFloat(getComputedStyle(codeEditor).lineHeight) || 18;
	const visibleLines = Math.floor(codeEditor.clientHeight / lh);
	const targetTop = Math.max(0, (line - Math.floor(visibleLines / 2)) * lh);
	codeEditor.scrollTop = targetTop;
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
		onUpdate: () => { refreshVarsPanel(); syncFollow(); if (activeTab === 'graph') renderGraph(); },
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

// Hamburger menu toggle
function closeMenu() { menuDropdown.classList.add('hidden'); }
menuBtn.addEventListener('click', (e) => {
	e.stopPropagation();
	menuDropdown.classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
	if (!(e.target as HTMLElement).closest('#menu-dropdown') &&
	    !(e.target as HTMLElement).closest('#menu-btn')) {
		closeMenu();
	}
});
// Close menu after any menu item is activated
menuDropdown.addEventListener('click', (e) => {
	const target = e.target as HTMLElement;
	if (target.closest('button') || target.closest('label')) {
		// File picker labels: don't close until file actually picked (handled below)
		if (!target.closest('.file-btn')) closeMenu();
	}
});

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
	closeMenu();
	if (dirty && !confirm('В проекте несохранённые изменения. Продолжить?')) {
		openInput.value = ''; return;
	}
	await openFile(file);
	openInput.value = '';
});

saveQspsBtn.addEventListener('click', saveQsps);
saveQspBtn.addEventListener('click', saveQsp);

addLocBtn.addEventListener('click', addLoc);

codeEditor.addEventListener('input', () => {
	setDirty(true);
	saveLocal();
	scheduleValidate();
});

function showPreview(fromLoc: string | null = null) {
	document.body.classList.add('show-preview');
	startPreview(fromLoc);
}

// ─── Follow execution ───────────────────────────────────────────

const FOLLOW_KEY = 'qsp_editor_follow';
// Default ON — when the engine navigates, the sidebar follows.
const followStored = localStorage.getItem(FOLLOW_KEY);
let followExec = followStored === null ? true : followStored === '1';
function setFollow(v: boolean) {
	followExec = v;
	localStorage.setItem(FOLLOW_KEY, v ? '1' : '0');
	followBtn.classList.toggle('active', v);
}
setFollow(followExec);
followBtn.addEventListener('click', () => {
	setFollow(!followExec);
	if (followExec) syncFollow();
});

/** When the engine navigates, optionally select the same location in the sidebar. */
function syncFollow() {
	if (!followExec || !engine) return;
	const loc = engine.allLocations[engine.state.curLoc];
	if (!loc) return;
	const idx = locs.findIndex(l => l.name.toUpperCase() === loc.name.toUpperCase());
	if (idx >= 0 && idx !== curIdx) selectLoc(idx);
}

// ─── Variables panel ────────────────────────────────────────────

function refreshVarsPanel() {
	if (!engine) { varsCount.textContent = '0'; return; }
	const all = engine.state.variables.dumpAll();
	// Always keep the tab badge in sync, even when the tab isn't focused.
	const filter = varsFilter.value.trim().toLowerCase();
	if (activeBottomTab !== 'vars') {
		varsCount.textContent = String(all.length);
		return;
	}
	varsTbody.innerHTML = '';
	let shown = 0;
	for (const v of all) {
		const display = v.key !== undefined
			? `${v.name}['${v.key}']`
			: (v.index === 0 ? v.name : `${v.name}[${v.index}]`);
		if (filter && !display.toLowerCase().includes(filter)) continue;
		const tr = document.createElement('tr');
		const tdN = document.createElement('td');
		tdN.className = 'var-name';
		tdN.textContent = display;
		tdN.title = display;
		const tdV = document.createElement('td');
		// Show str as quoted if isString or non-empty; else show num
		if (v.isString || v.str !== '') {
			if (v.num !== 0 && v.str !== '') {
				tdV.className = 'var-value-both';
				tdV.textContent = `${v.num} | '${v.str}'`;
			} else {
				tdV.className = 'var-value-str';
				tdV.textContent = `'${v.str}'`;
			}
		} else {
			tdV.className = 'var-value-num';
			tdV.textContent = String(v.num);
		}
		tr.appendChild(tdN);
		tr.appendChild(tdV);
		varsTbody.appendChild(tr);
		shown++;
	}
	if (shown === 0) {
		const tr = document.createElement('tr');
		tr.innerHTML = `<td class="var-empty" colspan="2">${all.length === 0 ? '(нет переменных)' : '(ничего не найдено)'}</td>`;
		varsTbody.appendChild(tr);
	}
	varsCount.textContent = filter
		? `${shown}/${all.length}`
		: String(all.length);
}

// ─── Bottom-pane tabs (Проблемы / Переменные) ──────────────────

type BottomTab = 'problems' | 'vars';
let activeBottomTab: BottomTab = 'problems';

function setBottomTab(tab: BottomTab) {
	activeBottomTab = tab;
	tabProblems.classList.toggle('active', tab === 'problems');
	tabVars.classList.toggle('active', tab === 'vars');
	problemsList.classList.toggle('hidden', tab !== 'problems');
	varsPane.classList.toggle('hidden', tab !== 'vars');
	varsFilter.classList.toggle('hidden', tab !== 'vars');
	if (tab === 'vars') refreshVarsPanel();
}

tabProblems.addEventListener('click', () => setBottomTab('problems'));
tabVars.addEventListener('click', () => setBottomTab('vars'));

varsFilter.addEventListener('input', refreshVarsPanel);

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

// ─── Splitters (drag to resize sidebar / preview / problems) ────

interface SplitterCfg {
	cssVar: string;
	axis: 'x' | 'y';
	/** Sign convention: +1 if dragging right/down increases the size, -1 otherwise. */
	sign: 1 | -1;
	min: number;
	max: number;
	default: number;
}

const splitterCfgs: Record<string, SplitterCfg> = {
	sidebar:  { cssVar: '--sidebar-w',  axis: 'x', sign:  1, min: 120, max: 500, default: 200 },
	preview:  { cssVar: '--preview-w',  axis: 'x', sign: -1, min: 200, max: 700, default: 360 },
	problems: { cssVar: '--problems-h', axis: 'y', sign: -1, min:  60, max: 500, default: 180 },
};

const SPLITTER_KEY = 'qsp_editor_splitters';
function loadSplitters(): Record<string, number> {
	try { return JSON.parse(localStorage.getItem(SPLITTER_KEY) ?? '{}'); } catch { return {}; }
}
function saveSplitters(values: Record<string, number>) {
	try { localStorage.setItem(SPLITTER_KEY, JSON.stringify(values)); } catch {}
}

const splitterValues = loadSplitters();
for (const [key, cfg] of Object.entries(splitterCfgs)) {
	const v = splitterValues[key] ?? cfg.default;
	document.documentElement.style.setProperty(cfg.cssVar, v + 'px');
}

document.querySelectorAll<HTMLElement>('.splitter[data-resize]').forEach(el => {
	const key = el.dataset.resize!;
	const cfg = splitterCfgs[key];
	if (!cfg) return;
	el.addEventListener('mousedown', e => {
		e.preventDefault();
		el.classList.add('dragging');
		const startCoord = cfg.axis === 'x' ? e.clientX : e.clientY;
		const startSize = splitterValues[key] ?? cfg.default;
		const onMove = (ev: MouseEvent) => {
			const cur = cfg.axis === 'x' ? ev.clientX : ev.clientY;
			const delta = (cur - startCoord) * cfg.sign;
			const next = Math.max(cfg.min, Math.min(cfg.max, startSize + delta));
			splitterValues[key] = next;
			document.documentElement.style.setProperty(cfg.cssVar, next + 'px');
		};
		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			el.classList.remove('dragging');
			saveSplitters(splitterValues);
		};
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	});
});

// ─── Editor tabs (Код / Граф) ───────────────────────────────────

type EditorTab = 'code' | 'graph';
let activeTab: EditorTab = 'code';

function setActiveTab(tab: EditorTab) {
	const prev = activeTab;
	activeTab = tab;
	tabCode.classList.toggle('active', tab === 'code');
	tabGraph.classList.toggle('active', tab === 'graph');
	codeEditor.classList.toggle('hidden', tab !== 'code');
	graphView.classList.toggle('hidden', tab !== 'graph');
	graphControls.classList.toggle('hidden', tab !== 'graph');
	if (tab === 'graph') {
		// On switch INTO graph, refit so all nodes are visible regardless of
		// previous pan/zoom or window resize.
		if (prev !== 'graph' && cachedLayout) fitView(cachedLayout.nodes);
		renderGraph();
	}
}

tabCode.addEventListener('click', () => setActiveTab('code'));
tabGraph.addEventListener('click', () => setActiveTab('graph'));
graphRefreshBtn.addEventListener('click', () => renderGraph(true));
graphHideInternal.addEventListener('change', () => renderGraph(true));

// ─── Graph view ─────────────────────────────────────────────────

interface GraphEdge { from: string; to: string; kind: 'gt' | 'gs'; }
interface GraphNode { name: string; idx: number; x: number; y: number; orphan: boolean; }

/** Scan a location's code for outgoing references to other locations. */
function extractEdges(loc: Loc, validNames: Set<string>): GraphEdge[] {
	const edges: GraphEdge[] = [];
	const seen = new Set<string>();
	// gt/gs/xgt with quoted target
	const re1 = /\b(gt|gs|goto|gosub|xgt|xgoto)\s*['"]([^'"]+)['"]/gi;
	let m: RegExpExecArray | null;
	while ((m = re1.exec(loc.code)) !== null) {
		const k = m[1].toLowerCase();
		const kind: 'gt' | 'gs' = (k === 'gs' || k === 'gosub') ? 'gs' : 'gt';
		const target = m[2];
		if (!validNames.has(target.toUpperCase())) continue;
		const key = kind + '|' + target.toUpperCase();
		if (seen.has(key)) continue;
		seen.add(key);
		edges.push({ from: loc.name, to: target, kind });
	}
	// ((label|target)) and ((target)) inline links — group 1 is label-or-target,
	// group 2 (optional, after `|`) is the explicit target. Use group 2 if present.
	const re2 = /\(\(\s*([^|()]+?)\s*(?:\|\s*([^()]+?)\s*)?\)\)/g;
	while ((m = re2.exec(loc.code)) !== null) {
		const target = (m[2] ?? m[1]).trim();
		if (!validNames.has(target.toUpperCase())) continue;
		const key = 'gt|' + target.toUpperCase();
		if (seen.has(key)) continue;
		seen.add(key);
		edges.push({ from: loc.name, to: target, kind: 'gt' });
	}
	return edges;
}

function buildGraph(hideInternal: boolean): { nodes: GraphNode[]; edges: GraphEdge[] } {
	flushEditor();
	const visible = locs.filter(l => !hideInternal || !l.name.startsWith('_'));
	const validNames = new Set(visible.map(l => l.name.toUpperCase()));
	// Map node name → index in the full `locs` array (NOT the filtered visible list),
	// because selectLoc() works against `locs`.
	const nameToIdx = new Map<string, number>();
	locs.forEach((l, i) => nameToIdx.set(l.name.toUpperCase(), i));

	const allEdges: GraphEdge[] = [];
	for (const l of visible) {
		for (const e of extractEdges(l, validNames)) allEdges.push(e);
	}

	// Reachability from start (for orphan flag only — layout is force-directed)
	const reachable = new Set<string>();
	const startName = visible[0]?.name.toUpperCase();
	if (startName) {
		const adj = new Map<string, string[]>();
		for (const e of allEdges) {
			const k = e.from.toUpperCase();
			if (!adj.has(k)) adj.set(k, []);
			adj.get(k)!.push(e.to.toUpperCase());
		}
		reachable.add(startName);
		const queue: string[] = [startName];
		while (queue.length) {
			const cur = queue.shift()!;
			for (const next of adj.get(cur) ?? []) {
				if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
			}
		}
	}

	// Initial seed positions: BFS columns when reachable, golden-angle spiral for orphans.
	const levels = new Map<string, number>();
	if (startName) {
		levels.set(startName, 0);
		const adj = new Map<string, string[]>();
		for (const e of allEdges) {
			const k = e.from.toUpperCase();
			if (!adj.has(k)) adj.set(k, []);
			adj.get(k)!.push(e.to.toUpperCase());
		}
		const q: string[] = [startName];
		while (q.length) {
			const cur = q.shift()!;
			const lvl = levels.get(cur)!;
			for (const next of adj.get(cur) ?? []) {
				if (!levels.has(next)) { levels.set(next, lvl + 1); q.push(next); }
			}
		}
	}

	const nodes: GraphNode[] = [];
	let orphanI = 0;
	for (const l of visible) {
		const k = l.name.toUpperCase();
		const lvl = levels.get(k);
		const isOrphan = !reachable.has(k);
		let x: number, y: number;
		if (lvl !== undefined) {
			x = 200 + lvl * 180 + (Math.random() - 0.5) * 30;
			y = 300 + (Math.random() - 0.5) * 200;
		} else {
			// spiral so they don't all start on top of each other
			const angle = orphanI * 2.39996;
			const r = 80 + 12 * Math.sqrt(orphanI);
			x = 600 + r * Math.cos(angle);
			y = 300 + r * Math.sin(angle);
			orphanI++;
		}
		nodes.push({ name: l.name, idx: nameToIdx.get(k)!, x, y, orphan: isOrphan });
	}

	// Force-directed relaxation
	runForces(nodes, allEdges);
	return { nodes, edges: allEdges };
}

/** Simple force-directed layout: spring on edges, repulsion between all nodes,
 *  weak gravity towards the centroid so disconnected components stay near. */
function runForces(nodes: GraphNode[], edges: GraphEdge[]) {
	if (nodes.length < 2) return;
	const idx = new Map<string, number>();
	nodes.forEach((n, i) => idx.set(n.name.toUpperCase(), i));
	const links = edges
		.map(e => [idx.get(e.from.toUpperCase()), idx.get(e.to.toUpperCase())] as const)
		.filter(([a, b]) => a !== undefined && b !== undefined && a !== b) as [number, number][];

	const N = nodes.length;
	const REST = 160;       // ideal edge length
	const REPULSE = 14000;  // node-node repulsion strength
	const SPRING = 0.04;    // edge spring strength
	const GRAVITY = 0.005;
	const DAMP = 0.85;
	const ITER = Math.min(400, 200 + N * 4);

	const vx = new Float64Array(N);
	const vy = new Float64Array(N);

	let cx = 0, cy = 0;
	for (const n of nodes) { cx += n.x; cy += n.y; }
	cx /= N; cy /= N;

	for (let it = 0; it < ITER; it++) {
		const fx = new Float64Array(N);
		const fy = new Float64Array(N);

		// Repulsion (O(N²) — fine for hundreds of nodes)
		for (let i = 0; i < N; i++) {
			for (let j = i + 1; j < N; j++) {
				let dx = nodes[i].x - nodes[j].x;
				let dy = nodes[i].y - nodes[j].y;
				let d2 = dx * dx + dy * dy;
				if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx*dx + dy*dy + 0.01; }
				const f = REPULSE / d2;
				const d = Math.sqrt(d2);
				fx[i] += (dx / d) * f;  fy[i] += (dy / d) * f;
				fx[j] -= (dx / d) * f;  fy[j] -= (dy / d) * f;
			}
		}

		// Springs
		for (const [a, b] of links) {
			const dx = nodes[b].x - nodes[a].x;
			const dy = nodes[b].y - nodes[a].y;
			const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
			const f = SPRING * (d - REST);
			fx[a] += (dx / d) * f;  fy[a] += (dy / d) * f;
			fx[b] -= (dx / d) * f;  fy[b] -= (dy / d) * f;
		}

		// Gravity
		for (let i = 0; i < N; i++) {
			fx[i] += (cx - nodes[i].x) * GRAVITY;
			fy[i] += (cy - nodes[i].y) * GRAVITY;
		}

		const cool = 1 - it / ITER * 0.4;
		for (let i = 0; i < N; i++) {
			vx[i] = (vx[i] + fx[i]) * DAMP * cool;
			vy[i] = (vy[i] + fy[i]) * DAMP * cool;
			// clamp velocity
			const v = Math.sqrt(vx[i]*vx[i] + vy[i]*vy[i]);
			const VMAX = 30;
			if (v > VMAX) { vx[i] *= VMAX / v; vy[i] *= VMAX / v; }
			nodes[i].x += vx[i];
			nodes[i].y += vy[i];
		}
	}

	// Pin start (first node) doesn't matter — but normalise so min coords are 20.
	let minX = Infinity, minY = Infinity;
	for (const n of nodes) { if (n.x < minX) minX = n.x; if (n.y < minY) minY = n.y; }
	const tx = 20 - minX, ty = 20 - minY;
	for (const n of nodes) { n.x += tx; n.y += ty; }
}

/** Cached layout — survives pan/zoom and selection re-renders. Re-computed on
 *  refresh button, hide-internal toggle, location add/delete/rename, and tab switch
 *  if the loc set changed. */
let cachedLayout: { sig: string; nodes: GraphNode[]; edges: GraphEdge[]; hideInternal: boolean } | null = null;
let viewTransform = { tx: 0, ty: 0, scale: 1 };

function locsSignature(hideInternal: boolean): string {
	return (hideInternal ? '1|' : '0|') + locs.map(l => l.name + ':' + l.code.length).join('\n');
}

function renderGraph(forceRelayout = false) {
	if (graphView.classList.contains('hidden')) return;
	const hideInternal = graphHideInternal.checked;
	const sig = locsSignature(hideInternal);
	if (forceRelayout || !cachedLayout || cachedLayout.sig !== sig) {
		const { nodes, edges } = buildGraph(hideInternal);
		cachedLayout = { sig, nodes, edges, hideInternal };
		// Reset view to fit after relayout
		fitView(nodes);
	}

	const { nodes, edges } = cachedLayout;
	if (nodes.length === 0) {
		graphView.innerHTML = '<div style="padding: 20px; opacity: 0.6;">Нет локаций</div>';
		return;
	}

	const NODE_W = 140, NODE_H = 36;
	const nodeByName = new Map<string, GraphNode>();
	for (const n of nodes) nodeByName.set(n.name.toUpperCase(), n);

	const curEngineLoc = engine ? engine.allLocations[engine.state.curLoc]?.name?.toUpperCase() : null;
	const selectedName = curIdx !== null ? locs[curIdx].name.toUpperCase() : null;

	const svgNS = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(svgNS, 'svg');
	svg.setAttribute('width', '100%');
	svg.setAttribute('height', '100%');
	svg.style.display = 'block';
	svg.style.cursor = 'grab';

	// Defs: arrow markers (one per kind for distinct color), drop shadow filter
	const defs = document.createElementNS(svgNS, 'defs');
	defs.innerHTML = `
		<marker id="arrow-gt" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
			<path d="M0,0 L10,5 L0,10 z" class="arrow gt"/>
		</marker>
		<marker id="arrow-gs" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
			<path d="M0,0 L10,5 L0,10 z" class="arrow gs"/>
		</marker>
		<filter id="node-shadow" x="-20%" y="-20%" width="140%" height="140%">
			<feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.35"/>
		</filter>`;
	svg.appendChild(defs);

	// Single root <g> that we apply pan/zoom to
	const root = document.createElementNS(svgNS, 'g');
	root.setAttribute('transform', `translate(${viewTransform.tx}, ${viewTransform.ty}) scale(${viewTransform.scale})`);
	svg.appendChild(root);

	// Edges
	const edgesG = document.createElementNS(svgNS, 'g');
	for (const e of edges) {
		const a = nodeByName.get(e.from.toUpperCase());
		const b = nodeByName.get(e.to.toUpperCase());
		if (!a || !b) continue;
		// Edge endpoints from rect borders, not corners
		const ax = a.x + NODE_W / 2, ay = a.y + NODE_H / 2;
		const bx = b.x + NODE_W / 2, by = b.y + NODE_H / 2;
		const dx = bx - ax, dy = by - ay;
		const dist = Math.sqrt(dx * dx + dy * dy) || 1;
		// Trim endpoints to rectangle borders (approximate ellipse)
		const trimA = clipToRect(NODE_W / 2 + 4, NODE_H / 2 + 4, dx, dy);
		const trimB = clipToRect(NODE_W / 2 + 4, NODE_H / 2 + 4, -dx, -dy);
		const x1 = ax + dx / dist * trimA;
		const y1 = ay + dy / dist * trimA;
		const x2 = bx - dx / dist * trimB;
		const y2 = by - dy / dist * trimB;
		// Slight curve so reverse edges don't overlap
		const mx = (x1 + x2) / 2 + (-dy / dist) * 14;
		const my = (y1 + y2) / 2 + ( dx / dist) * 14;
		const line = document.createElementNS(svgNS, 'path');
		line.setAttribute('d', `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`);
		line.setAttribute('class', 'edge ' + e.kind);
		line.setAttribute('fill', 'none');
		line.setAttribute('marker-end', `url(#arrow-${e.kind})`);
		edgesG.appendChild(line);
	}
	root.appendChild(edgesG);

	// Nodes
	for (const n of nodes) {
		const g = document.createElementNS(svgNS, 'g');
		const upper = n.name.toUpperCase();
		const classes = ['node'];
		if (upper === selectedName) classes.push('selected');
		if (upper === curEngineLoc) classes.push('current');
		if (n.orphan) classes.push('orphan');
		if (n.name.startsWith('_')) classes.push('internal');
		g.setAttribute('class', classes.join(' '));
		g.setAttribute('transform', `translate(${n.x}, ${n.y})`);
		g.style.cursor = 'pointer';

		const rect = document.createElementNS(svgNS, 'rect');
		rect.setAttribute('width', String(NODE_W));
		rect.setAttribute('height', String(NODE_H));
		rect.setAttribute('rx', '8');
		rect.setAttribute('ry', '8');
		rect.setAttribute('filter', 'url(#node-shadow)');

		// Colored left accent stripe per category
		const accent = document.createElementNS(svgNS, 'rect');
		accent.setAttribute('class', 'accent');
		accent.setAttribute('x', '0');
		accent.setAttribute('y', '0');
		accent.setAttribute('width', '4');
		accent.setAttribute('height', String(NODE_H));
		accent.setAttribute('rx', '2');

		const text = document.createElementNS(svgNS, 'text');
		text.setAttribute('x', String(NODE_W / 2 + 2));
		text.setAttribute('y', String(NODE_H / 2 + 4));
		text.setAttribute('text-anchor', 'middle');
		text.textContent = n.name.length > 18 ? n.name.slice(0, 17) + '…' : n.name;

		const title = document.createElementNS(svgNS, 'title');
		title.textContent = n.name;

		// Transparent hit-target on top so the entire node is clickable
		// regardless of filters / pointer-events on children.
		// IMPORTANT: must NOT pick up `.node rect { fill: var(--surface2) }`
		// — give it a dedicated class so CSS skips it.
		const hit = document.createElementNS(svgNS, 'rect');
		hit.setAttribute('class', 'hit');
		hit.setAttribute('width', String(NODE_W));
		hit.setAttribute('height', String(NODE_H));
		hit.setAttribute('rx', '8');
		hit.setAttribute('ry', '8');
		hit.style.fill = 'transparent';
		hit.style.pointerEvents = 'all';
		hit.style.cursor = 'pointer';

		g.appendChild(rect);
		g.appendChild(accent);
		g.appendChild(text);
		g.appendChild(hit);
		g.appendChild(title);
		const onActivate = (e: Event) => {
			e.stopPropagation();
			if ((e as any)._wasDrag) return;
			setActiveTab('code');
			selectLoc(n.idx);
			codeEditor.focus();
		};
		g.addEventListener('click', onActivate);
		// Block svg-level mousedown (which starts pan) from firing when starting on a node
		g.addEventListener('mousedown', e => e.stopPropagation());

		root.appendChild(g);
	}

	graphView.innerHTML = '';
	graphView.appendChild(svg);

	// Pan / zoom wiring
	let dragging = false;
	let dragMoved = false;
	let startX = 0, startY = 0, startTx = 0, startTy = 0;
	svg.addEventListener('mousedown', (e) => {
		if ((e.target as Element).closest('.node')) return;
		dragging = true; dragMoved = false;
		startX = e.clientX; startY = e.clientY;
		startTx = viewTransform.tx; startTy = viewTransform.ty;
		svg.style.cursor = 'grabbing';
	});
	window.addEventListener('mousemove', (e) => {
		if (!dragging) return;
		const dx = e.clientX - startX, dy = e.clientY - startY;
		if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
		viewTransform.tx = startTx + dx;
		viewTransform.ty = startTy + dy;
		root.setAttribute('transform', `translate(${viewTransform.tx}, ${viewTransform.ty}) scale(${viewTransform.scale})`);
	});
	window.addEventListener('mouseup', () => {
		if (dragging) { dragging = false; svg.style.cursor = 'grab'; }
	});
	// Suppress click after drag
	svg.addEventListener('click', (e) => { if (dragMoved) { e.stopPropagation(); (e as any)._wasDrag = true; } }, true);

	svg.addEventListener('wheel', (e) => {
		e.preventDefault();
		const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
		const next = Math.max(0.2, Math.min(4, viewTransform.scale * factor));
		// Zoom around mouse position
		const rect = svg.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		// world point under mouse
		const wx = (mx - viewTransform.tx) / viewTransform.scale;
		const wy = (my - viewTransform.ty) / viewTransform.scale;
		viewTransform.scale = next;
		viewTransform.tx = mx - wx * next;
		viewTransform.ty = my - wy * next;
		root.setAttribute('transform', `translate(${viewTransform.tx}, ${viewTransform.ty}) scale(${viewTransform.scale})`);
	}, { passive: false });
}

/** Solve t such that |dx*t|≤w and |dy*t|≤h, return t * sqrt(dx²+dy²). */
function clipToRect(w: number, h: number, dx: number, dy: number): number {
	const adx = Math.abs(dx), ady = Math.abs(dy);
	const tx = adx > 0 ? w / adx : Infinity;
	const ty = ady > 0 ? h / ady : Infinity;
	const t = Math.min(tx, ty);
	return t * Math.sqrt(dx * dx + dy * dy);
}

function fitView(nodes: GraphNode[]) {
	if (nodes.length === 0) { viewTransform = { tx: 0, ty: 0, scale: 1 }; return; }
	const NODE_W = 140, NODE_H = 36;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const n of nodes) {
		if (n.x < minX) minX = n.x;
		if (n.y < minY) minY = n.y;
		if (n.x + NODE_W > maxX) maxX = n.x + NODE_W;
		if (n.y + NODE_H > maxY) maxY = n.y + NODE_H;
	}
	const pad = 40;
	const w = maxX - minX + pad * 2;
	const h = maxY - minY + pad * 2;
	const vw = graphView.clientWidth || 600;
	const vh = graphView.clientHeight || 400;
	// Don't shrink past 0.75: text becomes unreadable. User can wheel-zoom or pan
	// (drag) to navigate the rest of the graph.
	const MIN_SCALE = 0.75;
	const scale = Math.max(MIN_SCALE, Math.min(vw / w, vh / h, 1));
	viewTransform = {
		scale,
		tx: -minX * scale + pad * scale + (vw - w * scale) / 2,
		ty: -minY * scale + pad * scale + (vh - h * scale) / 2,
	};
}

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
