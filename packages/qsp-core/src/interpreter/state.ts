/**
 * QSP Game State
 *
 * Manages all mutable state: variables, objects, text buffers,
 * current location, actions, and system settings.
 */

/** A QSP value — dual type: every value has both a numeric and string representation */
export interface QspValue {
  num: number;
  str: string;
  /** True when this value originates from a string expression ($var, string literal, $func).
   *  Used to distinguish strVal('') from numVal(0) in string concatenation. */
  isString?: boolean;
}

export function numVal(n: number): QspValue {
  return { num: n, str: '' };
}

export function strVal(s: string): QspValue {
  return { num: 0, str: s, isString: true };
}

export function mixVal(n: number, s: string): QspValue {
  return { num: n, str: s };
}

/** An active action in the current location */
export interface QspRuntimeAction {
  name: string;
  image: string;
  code: string;
}

/** An inventory object */
export interface QspObject {
  name: string;
  image: string;
}

/** Variable storage — supports indexed arrays and string-keyed maps */
export class QspVariableStore {
  /** name -> indexed values. Index 0 is the default scalar slot. */
  private vars = new Map<string, Map<number, QspValue>>();
  /** name -> string-key to numeric-index mapping */
  private indices = new Map<string, Map<string, number>>();

  /** Get the canonical (uppercase) name.
   *  In QSP, $VAR and VAR share the same storage slot — $ is only a type sigil,
   *  not part of the variable name. Strip it before canonicalising. */
  private canonical(name: string): string {
    const base = name.startsWith('$') ? name.slice(1) : name;
    return base.toUpperCase();
  }

  get(name: string, index = 0): QspValue {
    const cn = this.canonical(name);
    const arr = this.vars.get(cn);
    if (!arr) return { num: 0, str: '' };
    return arr.get(index) ?? { num: 0, str: '' };
  }

  set(name: string, index: number, value: QspValue): void {
    const cn = this.canonical(name);
    let arr = this.vars.get(cn);
    if (!arr) {
      arr = new Map();
      this.vars.set(cn, arr);
    }
    arr.set(index, value);
  }

  /** Get value by string key (for associative arrays) */
  getByKey(name: string, key: string): QspValue {
    const cn = this.canonical(name);
    const idxMap = this.indices.get(cn);
    if (!idxMap) return { num: 0, str: '' };
    const idx = idxMap.get(key.toUpperCase());
    if (idx === undefined) return { num: 0, str: '' };
    return this.get(name, idx);
  }

  /** Set value by string key */
  setByKey(name: string, key: string, value: QspValue): void {
    const cn = this.canonical(name);
    let idxMap = this.indices.get(cn);
    if (!idxMap) {
      idxMap = new Map();
      this.indices.set(cn, idxMap);
    }
    const uk = key.toUpperCase();
    let idx = idxMap.get(uk);
    if (idx === undefined) {
      idx = this.arraySize(name);
      idxMap.set(uk, idx);
    }
    this.set(name, idx, value);
  }

  /** Get the size of an array */
  arraySize(name: string): number {
    const cn = this.canonical(name);
    const arr = this.vars.get(cn);
    if (!arr || arr.size === 0) return 0;
    let max = -1;
    for (const k of arr.keys()) {
      if (k > max) max = k;
    }
    return max + 1;
  }

  /** Kill a variable entirely, or remove one element (compacting the array) */
  kill(name: string, index?: number): void {
    const cn = this.canonical(name);
    if (index === undefined) {
      this.vars.delete(cn);
      this.indices.delete(cn);
    } else {
      const arr = this.vars.get(cn);
      if (!arr) return;
      // Compact: shift all elements with index > deleted down by one
      const size = this.arraySize(name);
      arr.delete(index);
      for (let i = index + 1; i < size; i++) {
        const v = arr.get(i);
        if (v !== undefined) {
          arr.set(i - 1, v);
          arr.delete(i);
        } else {
          arr.delete(i - 1);
        }
      }
      // Update string-key index map: shift all entries pointing above deleted index
      const idxMap = this.indices.get(cn);
      if (idxMap) {
        for (const [k, v] of idxMap) {
          if (v === index) idxMap.delete(k);
          else if (v > index) idxMap.set(k, v - 1);
        }
      }
    }
  }

  /** Clear all variables */
  clear(): void {
    this.vars.clear();
    this.indices.clear();
  }

  serialize(): { vars: Record<string, Array<[number, QspValue]>>; indices: Record<string, Array<[string, number]>> } {
    const vars: Record<string, Array<[number, QspValue]>> = {};
    for (const [name, map] of this.vars) {
      vars[name] = Array.from(map.entries());
    }
    const indices: Record<string, Array<[string, number]>> = {};
    for (const [name, map] of this.indices) {
      indices[name] = Array.from(map.entries());
    }
    return { vars, indices };
  }

  deserialize(data: { vars: Record<string, Array<[number, QspValue]>>; indices: Record<string, Array<[string, number]>> }): void {
    this.vars.clear();
    this.indices.clear();
    for (const [name, entries] of Object.entries(data.vars)) {
      this.vars.set(name, new Map(entries));
    }
    for (const [name, entries] of Object.entries(data.indices)) {
      this.indices.set(name, new Map(entries));
    }
  }

  /** Copy one array to another */
  copyArray(dst: string, src: string): void {
    const cs = this.canonical(src);
    const cd = this.canonical(dst);
    const srcArr = this.vars.get(cs);
    if (!srcArr) {
      this.vars.delete(cd);
      return;
    }
    this.vars.set(cd, new Map(srcArr));
    const srcIdx = this.indices.get(cs);
    if (srcIdx) {
      this.indices.set(cd, new Map(srcIdx));
    }
  }

  /** Search array for a value, return index or -1 */
  arrayPos(name: string, value: QspValue, start: number): number {
    const cn = this.canonical(name);
    const isStr = name.startsWith('$'); // use original name — $ stripped from canonical
    const arr = this.vars.get(cn);
    if (!arr) return -1;
    const size = this.arraySize(name);
    for (let i = start; i < size; i++) {
      const v = arr.get(i);
      if (!v) continue;
      if (isStr) {
        if (v.str.toUpperCase() === value.str.toUpperCase()) return i;
      } else {
        if (v.num === value.num) return i;
      }
    }
    return -1;
  }
}

/** Callbacks the engine uses to communicate with the UI */
export interface QspCallbacks {
  onMainTextChanged?(text: string): void;
  onStatTextChanged?(text: string): void;
  onActionsChanged?(actions: QspRuntimeAction[]): void;
  onObjectsChanged?(objects: QspObject[]): void;
  onMessage?(text: string): void;
  onInput?(prompt: string): Promise<string> | string;
  onView?(path: string): void;
  onMenu?(items: string[]): Promise<number> | number;
  onSaveGame?(filename: string, data: string): void;
  onLoadGame?(filename: string): string | null;
  onWait?(ms: number): Promise<void> | void;
  onPlayFile?(file: string, volume: number): void;
  onCloseFile?(file: string | null): void;
  onSetVolume?(volume: number): void;
  onColorsChanged?(bcolor: number, fcolor: number, lcolor: number): void;
  onBackImage?(path: string): void;
  onLoadQst?(filename: string): Promise<Uint8Array | null>;
}

/** The complete mutable game state */
export class GameState {
  // Text buffers
  mainText = '';
  statText = '';

  // Current location index
  curLoc = -1;

  // Actions in current location
  actions: QspRuntimeAction[] = [];

  // Inventory
  objects: QspObject[] = [];

  // Variables
  variables = new QspVariableStore();

  // Window visibility
  showActs = true;
  showObjs = true;
  showStat = true;
  showInput = true;

  // System
  useHtml = false;
  timerInterval = 500;
  startTime = Date.now();

  // Colors (-1 = use default)
  bcolor = -1;
  fcolor = -1;
  lcolor = -1;

  // Incremented whenever display-relevant state (mainText/statText/actions/objects) changes
  displayVersion = 0;

  // Currently "playing" audio files (tracked for ISPLAY)
  playingFiles = new Set<string>();

  // Call stack for GOSUB
  callStack: { locIndex: number; returnAfter: boolean }[] = [];

  // GOSUB/FUNC args
  args: QspValue[] = [];

  // Last result from FUNC
  result: QspValue = { num: 0, str: '' };

  /** Reset all state for a new game */
  reset(): void {
    this.mainText = '';
    this.statText = '';
    this.curLoc = -1;
    this.actions = [];
    this.objects = [];
    this.variables.clear();
    this.showActs = true;
    this.showObjs = true;
    this.showStat = true;
    this.showInput = true;
    this.useHtml = false;
    this.timerInterval = 500;
    this.startTime = Date.now();
    this.bcolor = -1;
    this.fcolor = -1;
    this.lcolor = -1;
    this.displayVersion = 0;
    this.playingFiles.clear();
    this.callStack = [];
    this.args = [];
    this.result = { num: 0, str: '' };
  }
}
