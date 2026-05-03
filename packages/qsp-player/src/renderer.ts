/**
 * QspRenderer — wires a QspEngine instance to a set of DOM elements.
 *
 * Used by qsp-player, qsp-site, and qsp-editor to share rendering callbacks
 * (main text, actions, objects, stat, message, menu, view, colors, audio).
 *
 * The host app provides DOM refs and an asset URL resolver. All DOM refs
 * except mainText and actionsList are optional — the renderer skips work
 * for missing elements (e.g. editor doesn't pass audio or view-panel).
 */

import { QspEngine } from 'qsp-core/interpreter/engine.js';
import type { QspRuntimeAction, QspObject } from 'qsp-core/interpreter/state.js';
import type { MidiAudioPlayer, SimpleAudioPlayer } from './audio.js';

export interface QspRendererConfig {
	engine: QspEngine;

	// Required DOM elements
	mainText: HTMLElement;
	actionsList: HTMLElement;

	// Optional DOM elements — renderer guards against missing
	statText?: HTMLElement | null;
	objectsList?: HTMLElement | null;
	gameEl?: HTMLElement | null;        // for --game-bg/fg/link
	mainPanel?: HTMLElement | null;     // for --game-backimage
	viewPanel?: HTMLElement | null;
	viewImg?: HTMLImageElement | null;
	statPanel?: HTMLElement | null;
	actionsPanel?: HTMLElement | null;
	objectsPanel?: HTMLElement | null;
	msgOverlay?: HTMLElement | null;
	msgText?: HTMLElement | null;
	msgOk?: HTMLElement | null;
	menuOverlay?: HTMLElement | null;
	menuList?: HTMLElement | null;
	menuCancel?: HTMLElement | null;
	inputLine?: HTMLInputElement | null;
	inputSubmit?: HTMLElement | null;
	inputPanel?: HTMLElement | null;

	// Asset URL resolution. Called for image src, audio file, library file paths.
	resolveAssetUrl(path: string): string;

	// Audio (optional — editor doesn't need)
	midiPlayer?: MidiAudioPlayer;
	simpleAudio?: SimpleAudioPlayer;
	/** Sliders to sync when the game calls SETVOL (host UI). */
	volumeSliders?: HTMLInputElement[];

	// Save/load — host provides storage strategy. If not provided, calls are no-ops.
	saveGame?(filename: string, data: string): void;
	loadGame?(filename: string): string | null;

	// Library file loading (ADDQST/INCLIB). If not provided, returns null.
	loadQst?(filename: string): Promise<Uint8Array | null>;

	// Optional: input prompt override (default: window.prompt)
	onInput?(prompt: string): string | Promise<string>;
}

export class QspRenderer {
	private cfg: QspRendererConfig;
	private engine: QspEngine;
	private menuCancelResolve: (() => void) | null = null;

	constructor(config: QspRendererConfig) {
		this.cfg = config;
		this.engine = config.engine;
		this.wireCallbacks();
		this.wireDOMEvents();
	}

	// ─── Public methods (host calls during game start/restart) ───────

	applyColors(bcolor: number, fcolor: number, lcolor: number): void {
		const el = this.cfg.gameEl;
		if (!el) return;
		el.style.setProperty('--game-bg',   bcolor >= 0 ? this.qspColorToCss(bcolor) : '');
		el.style.setProperty('--game-fg',   fcolor >= 0 ? this.qspColorToCss(fcolor) : '');
		el.style.setProperty('--game-link', lcolor >= 0 ? this.qspColorToCss(lcolor) : '');
	}

	applyBackImage(path: string): void {
		const el = this.cfg.mainPanel;
		if (!el) return;
		if (path) {
			el.style.setProperty('--game-backimage', `url('${this.cfg.resolveAssetUrl(path)}')`);
		} else {
			el.style.removeProperty('--game-backimage');
		}
	}

	resetTheme(): void {
		this.applyColors(-1, -1, -1);
		this.applyBackImage('');
	}

	// ─── Wire up engine callbacks ────────────────────────────────────

	private wireCallbacks(): void {
		const c = this.cfg;
		const engine = this.engine;

		engine.on({
			onMainTextChanged: (text) => {
				if (engine.state.useHtml) {
					c.mainText.innerHTML = this.resolveHtmlAssets(this.protectExecHrefs(text));
				} else {
					c.mainText.textContent = text;
				}
				const scroller = c.mainText.parentElement;
				if (scroller) scroller.scrollTop = scroller.scrollHeight;
			},

			onStatTextChanged: (text) => {
				if (!c.statText) return;
				if (engine.state.useHtml) {
					c.statText.innerHTML = this.resolveHtmlAssets(this.protectExecHrefs(text));
				} else {
					c.statText.textContent = text;
				}
				if (c.statPanel) c.statPanel.classList.toggle('hidden', !text && !engine.state.showStat);
			},

			onActionsChanged: (actions: QspRuntimeAction[]) => {
				c.actionsList.innerHTML = '';
				for (let i = 0; i < actions.length; i++) {
					const li = document.createElement('li');
					if (engine.state.useHtml) li.innerHTML = this.resolveHtmlAssets(actions[i].name);
					else li.textContent = actions[i].name;
					li.addEventListener('click', () => engine.execAction(i));
					c.actionsList.appendChild(li);
				}
				if (c.actionsPanel) c.actionsPanel.classList.toggle('hidden', !engine.state.showActs);
			},

			onObjectsChanged: (objects: QspObject[]) => {
				if (!c.objectsList) return;
				c.objectsList.innerHTML = '';
				for (let i = 0; i < objects.length; i++) {
					const li = document.createElement('li');
					if (engine.state.useHtml) li.innerHTML = this.resolveHtmlAssets(objects[i].name);
					else li.textContent = objects[i].name;
					li.addEventListener('click', () => engine.selectObject(i));
					c.objectsList.appendChild(li);
				}
				if (c.objectsPanel) {
					c.objectsPanel.classList.toggle('hidden', !engine.state.showObjs || objects.length === 0);
				}
			},

			onMessage: (text) => {
				if (!c.msgOverlay || !c.msgText) return;
				c.msgText.textContent = text;
				c.msgOverlay.classList.remove('hidden');
			},

			onInput: (prompt) => {
				if (c.onInput) return c.onInput(prompt);
				return window.prompt(prompt) ?? '';
			},

			onColorsChanged: (bcolor, fcolor, lcolor) => {
				this.applyColors(bcolor, fcolor, lcolor);
			},

			onBackImage: (path: string) => {
				this.applyBackImage(path);
			},

			onView: (path: string) => {
				if (!c.viewPanel || !c.viewImg) return;
				if (!path) {
					c.viewPanel.classList.add('hidden');
					c.viewImg.src = '';
				} else {
					c.viewImg.src = c.resolveAssetUrl(path);
					c.viewPanel.classList.remove('hidden');
				}
			},

			onMenu: (items: string[]): Promise<number> => {
				if (!c.menuOverlay || !c.menuList) {
					return Promise.resolve(-1);
				}
				return new Promise(resolve => {
					c.menuList!.innerHTML = '';
					for (let i = 0; i < items.length; i++) {
						const li = document.createElement('li');
						li.textContent = items[i];
						li.addEventListener('click', () => {
							c.menuOverlay!.classList.add('hidden');
							resolve(i);
						});
						c.menuList!.appendChild(li);
					}
					c.menuOverlay!.classList.remove('hidden');
					this.menuCancelResolve = () => {
						c.menuOverlay!.classList.add('hidden');
						resolve(-1);
					};
				});
			},

			onPlayFile: (file: string, volume: number) => {
				if (!c.midiPlayer || !c.simpleAudio) return;
				const url = c.resolveAssetUrl(file);
				if (this.isMidi(file)) c.midiPlayer.play(url, volume);
				else c.simpleAudio.play(url, volume);
			},

			onSetVolume: (volume: number) => {
				c.midiPlayer?.setGameVolume(volume);
				c.simpleAudio?.setGameVolume(volume);
				if (c.volumeSliders) {
					for (const s of c.volumeSliders) s.value = String(volume);
				}
			},

			onCloseFile: (file: string | null) => {
				if (file === null) {
					c.midiPlayer?.stop(null);
					c.simpleAudio?.stop(null);
				} else {
					if (!c.midiPlayer || !c.simpleAudio) return;
					const url = c.resolveAssetUrl(file);
					if (this.isMidi(file)) c.midiPlayer.stop(url);
					else c.simpleAudio.stop(url);
				}
			},

			onSaveGame: (filename: string, data: string) => {
				c.saveGame?.(filename, data);
			},

			onLoadGame: (filename: string): string | null => {
				return c.loadGame?.(filename) ?? null;
			},

			onLoadQst: async (filename: string): Promise<Uint8Array | null> => {
				if (!c.loadQst) return null;
				return c.loadQst(filename);
			},
		});
	}

	// ─── DOM event listeners ─────────────────────────────────────────

	private wireDOMEvents(): void {
		const c = this.cfg;

		// Click handler for QSP links inside main/stat text
		const clickHandler = (e: MouseEvent) => this.handleQspLink(e);
		c.mainText.addEventListener('click', clickHandler);
		if (c.statText) c.statText.addEventListener('click', clickHandler);

		// View-image expand toggle (full-screen overlay)
		if (c.viewImg) {
			c.viewImg.addEventListener('click', () => c.viewImg!.classList.toggle('expanded'));
		}

		// Message dialog dismissal
		if (c.msgOverlay && c.msgOk) {
			c.msgOk.addEventListener('click', () => c.msgOverlay!.classList.add('hidden'));
			document.addEventListener('keydown', (e) => {
				if (!c.msgOverlay!.classList.contains('hidden') && (e.key === 'Enter' || e.key === 'Escape')) {
					c.msgOverlay!.classList.add('hidden');
				}
			});
		}

		// Menu dialog dismissal
		if (c.menuOverlay && c.menuCancel) {
			c.menuCancel.addEventListener('click', () => {
				this.menuCancelResolve?.();
				this.menuCancelResolve = null;
			});
			document.addEventListener('keydown', (e) => {
				if (!c.menuOverlay!.classList.contains('hidden') && e.key === 'Escape') {
					this.menuCancelResolve?.();
					this.menuCancelResolve = null;
				}
			});
		}

		// Input bar: submit on Enter / submit-button click
		if (c.inputLine && c.inputSubmit) {
			const submit = () => {
				this.engine.submitInput(c.inputLine!.value);
				c.inputLine!.value = '';
			};
			c.inputSubmit.addEventListener('click', submit);
			c.inputLine.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
		}
	}

	// ─── Helpers ─────────────────────────────────────────────────────

	private isMidi(file: string): boolean {
		return /\.(mid|midi)$/i.test(file);
	}

	private qspColorToCss(color: number): string {
		const r = (color & 0xFF).toString(16).padStart(2, '0');
		const g = ((color >> 8) & 0xFF).toString(16).padStart(2, '0');
		const b = ((color >> 16) & 0xFF).toString(16).padStart(2, '0');
		return `#${r}${g}${b}`;
	}

	private protectExecHrefs(html: string): string {
		return html.replace(/href="exec:([^"]*)"/gi, (_, cmd) =>
			`href="exec:${cmd.replace(/&/g, '&amp;')}"`
		);
	}

	/** Rewrite src="..." attributes in HTML. Handles quoted and unquoted attribute values. */
	private resolveHtmlAssets(html: string): string {
		return html.replace(/\b(src=)(["']?)([^"' >]+)\2/gi, (match, pre, quote, path) => {
			if (/^(https?:|data:|blob:)/i.test(path)) return match;
			const resolved = this.cfg.resolveAssetUrl(path);
			return pre + (quote || '"') + resolved + (quote || '"');
		});
	}

	/** Click handler for QSP <a> links inside main/stat text. */
	private handleQspLink(e: MouseEvent): void {
		const anchor = (e.target as HTMLElement).closest('a');
		if (!anchor) return;
		const href = anchor.getAttribute('href') ?? '';
		if (href.toLowerCase().startsWith('exec:')) {
			e.preventDefault();
			this.engine.execDynamic(href.slice('exec:'.length).trim(), []);
			return;
		}
		const idx = parseInt(href, 10);
		if (!isNaN(idx) && String(idx) === href.trim()) {
			e.preventDefault();
			this.engine.execAction(idx - 1);
		}
	}

}
