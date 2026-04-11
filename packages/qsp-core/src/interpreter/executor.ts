import type { Stmt, Expr } from '../ast/nodes.js';
import type { QspLocation } from '../types/index.js';
import type { GameState, QspValue, QspCallbacks, QspRuntimeAction } from './state.js';
import { numVal, strVal } from './state.js';
import { Evaluator } from './evaluator.js';
import { Parser } from '../ast/parser.js';
import { parseQsp } from '../parser/qsp-parser.js';

/** Signals for non-local control flow */
export class GotoSignal {
  constructor(public locName: string, public args: QspValue[], public extended: boolean) {}
}
export class ExitSignal {}
export class JumpSignal {
  constructor(public label: string) {}
}

/**
 * QSP Statement Executor
 *
 * Executes a list of AST statements against the game state.
 * All public exec methods are async to support WAIT (animated delays).
 */
export class Executor {
  private evaluator: Evaluator;
  private parser = new Parser();
  /** Stack tracking loaded libraries for FREELIB support */
  private libStack: { startIdx: number; count: number }[] = [];

  constructor(
    private state: GameState,
    private locations: QspLocation[],
    private callbacks: QspCallbacks,
  ) {
    this.evaluator = new Evaluator(
      state,
      locations,
      callbacks,
      (code, args) => this.execDynamic(code, args),
      (loc, args) => this.execLocationByName(loc, args),
    );
  }

  /** Execute a list of statements. Throws GotoSignal/ExitSignal for non-local flow. */
  async exec(stmts: Stmt[]): Promise<void> {
    let i = 0;
    while (i < stmts.length) {
      try {
        await this.execStmt(stmts[i]);
        i++;
      } catch (e) {
        if (e instanceof JumpSignal) {
          const target = stmts.findIndex(
            s => s.kind === 'LabelStmt' && s.name.toUpperCase() === e.label.toUpperCase()
          );
          if (target >= 0) {
            i = target + 1;
            continue;
          }
        }
        throw e; // Re-throw GotoSignal, ExitSignal, or unresolved JumpSignal
      }
    }
  }

  private async execStmt(stmt: Stmt): Promise<void> {
    switch (stmt.kind) {
      case 'CommentStmt':
        return;

      case 'LabelStmt':
        return; // Labels are resolved by exec() for JUMP

      case 'AssignStmt': {
        const val = await this.evaluator.eval(stmt.value);
        await this.setVariable(stmt.variable.name, stmt.variable.index, val);
        return;
      }

      case 'LocalStmt': {
        if (stmt.value) {
          const val = await this.evaluator.eval(stmt.value);
          await this.setVariable(stmt.variable.name, stmt.variable.index, val);
        }
        return;
      }

      case 'PrintStmt': {
        const text = (await this.evaluator.eval(stmt.expr)).str;
        if (stmt.target === 'main') {
          await this.appendMainText(text, stmt.mode);
        } else {
          await this.appendStatText(text, stmt.mode);
        }
        return;
      }

      case 'ExprStmt': {
        const val = await this.evaluator.eval(stmt.expr);
        if (hasString(stmt.expr)) {
          await this.appendMainText(val.str, 'pl');
        }
        return;
      }

      case 'IfStmt': {
        for (const branch of stmt.branches) {
          if ((await this.evaluator.eval(branch.condition)).num !== 0) {
            await this.exec(branch.body);
            return;
          }
        }
        if (stmt.elseBranch) {
          await this.exec(stmt.elseBranch);
        }
        return;
      }

      case 'LoopStmt': {
        if (stmt.init) await this.execStmt(stmt.init);
        let iterations = 0;
        const MAX_ITERATIONS = 100000;
        while ((await this.evaluator.eval(stmt.condition)).num !== 0) {
          await this.exec(stmt.body);
          if (stmt.step) await this.execStmt(stmt.step);
          if (++iterations > MAX_ITERATIONS) {
            throw new Error('Loop iteration limit exceeded');
          }
        }
        return;
      }

      case 'ActStmt': {
        const name = await this.sub((await this.evaluator.eval(stmt.name)).str);
        const image = !stmt.image ? '' : stmt.image.kind === 'StringLiteral'
          ? stmt.image.value
          : (await this.evaluator.eval(stmt.image)).str;
        const codeStr = this.stmtsToCode(stmt.body);
        this.state.actions.push({ name, image, code: codeStr });
        this.state.displayVersion++;
        return;
      }

      case 'GotoStmt': {
        const dest = (await this.evaluator.eval(stmt.destination)).str;
        const args = await Promise.all(stmt.args.map(a => this.evaluator.eval(a)));
        throw new GotoSignal(dest, args, stmt.extended);
      }

      case 'GosubStmt': {
        const dest = (await this.evaluator.eval(stmt.destination)).str;
        const args = await Promise.all(stmt.args.map(a => this.evaluator.eval(a)));
        await this.execLocationByName(dest, args);
        return;
      }

      case 'JumpStmt': {
        const label = (await this.evaluator.eval(stmt.label)).str;
        throw new JumpSignal(label);
      }

      case 'ExitStmt':
        throw new ExitSignal();

      case 'KillAllStmt':
        this.state.variables.clear();
        this.state.objects = [];
        this.state.displayVersion++;
        this.callbacks.onObjectsChanged?.(this.state.objects);
        return;

      case 'KillVarStmt': {
        if (stmt.name) {
          const name = (await this.evaluator.eval(stmt.name)).str;
          const idx = stmt.index ? (await this.evaluator.eval(stmt.index)).num : undefined;
          this.state.variables.kill(name, idx);
        } else {
          this.state.variables.clear();
        }
        return;
      }

      case 'CopyArrStmt': {
        const dst = (await this.evaluator.eval(stmt.dst)).str;
        const src = (await this.evaluator.eval(stmt.src)).str;
        this.state.variables.copyArray(dst, src);
        return;
      }

      case 'AddObjStmt': {
        const name = await this.sub((await this.evaluator.eval(stmt.name)).str);
        const image = stmt.image ? await this.sub((await this.evaluator.eval(stmt.image)).str) : '';
        this.state.objects.push({ name, image });
        this.state.displayVersion++;
        this.callbacks.onObjectsChanged?.(this.state.objects);
        return;
      }

      case 'DelObjStmt': {
        const name = await this.sub((await this.evaluator.eval(stmt.name)).str);
        const idx = this.state.objects.findIndex(
          o => o.name.toUpperCase() === name.toUpperCase()
        );
        if (idx >= 0) {
          this.state.objects.splice(idx, 1);
          this.state.displayVersion++;
          this.callbacks.onObjectsChanged?.(this.state.objects);
        }
        return;
      }

      case 'KillObjStmt': {
        if (stmt.index) {
          const idx = (await this.evaluator.eval(stmt.index)).num - 1; // 1-based
          if (idx >= 0 && idx < this.state.objects.length) {
            this.state.objects.splice(idx, 1);
          }
        } else {
          this.state.objects = [];
        }
        this.state.displayVersion++;
        this.callbacks.onObjectsChanged?.(this.state.objects);
        return;
      }

      case 'ClearStmt': {
        if (stmt.target === 'main') {
          this.state.mainText = '';
          this.state.displayVersion++;
          this.callbacks.onMainTextChanged?.('');
        } else {
          this.state.statText = '';
          this.state.displayVersion++;
          this.callbacks.onStatTextChanged?.('');
        }
        return;
      }

      case 'ClaStmt':
        this.state.actions = [];
        this.state.displayVersion++;
        this.callbacks.onActionsChanged?.([]);
        return;

      case 'DelActStmt': {
        const name = await this.sub((await this.evaluator.eval(stmt.name)).str);
        const idx = this.state.actions.findIndex(
          a => a.name.toUpperCase() === name.toUpperCase()
        );
        if (idx >= 0) {
          this.state.actions.splice(idx, 1);
          this.state.displayVersion++;
          this.callbacks.onActionsChanged?.(this.state.actions);
        }
        return;
      }

      case 'ClsStmt':
        this.state.mainText = '';
        this.state.statText = '';
        this.state.actions = [];
        this.state.displayVersion++;
        this.callbacks.onMainTextChanged?.('');
        this.callbacks.onStatTextChanged?.('');
        this.callbacks.onActionsChanged?.([]);
        return;

      case 'MsgStmt': {
        const text = (await this.evaluator.eval(stmt.expr)).str;
        this.callbacks.onMessage?.(text);
        return;
      }

      case 'ViewStmt': {
        const path = (await this.evaluator.eval(stmt.path)).str;
        this.callbacks.onView?.(path);
        return;
      }

      case 'WaitStmt': {
        const ms = (await this.evaluator.eval(stmt.ms)).num;
        if (ms > 0) {
          await new Promise<void>(resolve => setTimeout(resolve, ms));
        }
        return;
      }

      case 'SetTimerStmt': {
        this.state.timerInterval = (await this.evaluator.eval(stmt.ms)).num;
        return;
      }

      case 'ShowWindowStmt': {
        const val = (await this.evaluator.eval(stmt.value)).num !== 0;
        switch (stmt.window) {
          case 'acts': this.state.showActs = val; break;
          case 'objs': this.state.showObjs = val; break;
          case 'stat': this.state.showStat = val; break;
          case 'input': this.state.showInput = val; break;
        }
        return;
      }

      case 'PlayStmt': {
        const file = (await this.evaluator.eval(stmt.file)).str;
        if (!file) return; // ignore PLAY with empty filename
        const volume = stmt.volume ? (await this.evaluator.eval(stmt.volume)).num : 100;
        this.state.playingFiles.add(file.toUpperCase());
        this.callbacks.onPlayFile?.(file, volume);
        return;
      }

      case 'CloseStmt': {
        if (stmt.all) {
          this.state.playingFiles.clear();
          this.callbacks.onCloseFile?.(null);
        } else if (stmt.file) {
          const file = (await this.evaluator.eval(stmt.file)).str;
          this.state.playingFiles.delete(file.toUpperCase());
          this.callbacks.onCloseFile?.(file);
        }
        return;
      }

      case 'SetVolStmt': {
        const volume = (await this.evaluator.eval(stmt.volume)).num;
        this.callbacks.onSetVolume?.(Math.max(0, Math.min(100, volume)));
        return;
      }

      case 'MenuStmt': {
        // MENU reads from a string array: 'arrname' -> look up '$arrname'
        const rawName = (await this.evaluator.eval(stmt.name)).str;
        const arrayName = rawName.startsWith('$') ? rawName : '$' + rawName;
        const size = this.state.variables.arraySize(arrayName);
        if (size === 0) return;
        const items: { text: string; location: string }[] = [];
        for (let i = 0; i < size; i++) {
          const raw = this.state.variables.get(arrayName, i).str;
          const colonIdx = raw.indexOf(':');
          items.push(colonIdx >= 0
            ? { text: raw.slice(0, colonIdx), location: raw.slice(colonIdx + 1) }
            : { text: raw, location: '' });
        }
        if (!this.callbacks.onMenu) return;
        const selected = await this.callbacks.onMenu(items.map(it => it.text));
        if (selected >= 0 && items[selected]?.location) {
          await this.execLocationByName(items[selected].location, []);
        }
        return;
      }

      case 'RefIntStmt':
        this.callbacks.onMainTextChanged?.(this.state.mainText);
        this.callbacks.onStatTextChanged?.(this.state.statText);
        this.callbacks.onActionsChanged?.(this.state.actions);
        this.callbacks.onObjectsChanged?.(this.state.objects);
        return;

      case 'UnselectStmt':
        return;

      case 'DynamicStmt': {
        const code = (await this.evaluator.eval(stmt.code)).str;
        const args = await Promise.all(stmt.args.map(a => this.evaluator.eval(a)));
        await this.execDynamic(code, args);
        return;
      }

      case 'ExecStmt':
        return;

      case 'CmdClearStmt':
        return;

      case 'OpenQstStmt':
      case 'IncLibStmt': {
        const file = (await this.evaluator.eval(stmt.file)).str;
        if (!file || !this.callbacks.onLoadQst) return;
        const data = await this.callbacks.onLoadQst(file);
        if (!data) return;
        try {
          const lib = parseQsp(data);
          const startIdx = this.locations.length;
          let count = 0;
          for (const loc of lib.locations) {
            if (!this.locations.some(l => l.name.toUpperCase() === loc.name.toUpperCase())) {
              this.locations.push(loc);
              count++;
            }
          }
          if (count > 0) {
            this.libStack.push({ startIdx, count });
          }
        } catch (e) {
          console.warn('INCLIB/ADDQST failed for', file, e);
        }
        return;
      }

      case 'FreeLibStmt': {
        const entry = this.libStack.pop();
        if (entry) {
          this.locations.splice(entry.startIdx, entry.count);
        }
        return;
      }

      case 'SaveGameStmt': {
        const filename = stmt.file ? (await this.evaluator.eval(stmt.file)).str : 'autosave.sav';
        this.callbacks.onSaveGame?.(filename, this.buildSaveData());
        return;
      }

      case 'OpenGameStmt': {
        const filename = stmt.file ? (await this.evaluator.eval(stmt.file)).str : 'autosave.sav';
        const saveData = this.callbacks.onLoadGame?.(filename) ?? null;
        if (!saveData) return;
        await this.restoreSave(saveData);
        return;
      }

      default:
        return;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────

  /** Restore game state from a save JSON string. Throws GotoSignal to navigate to saved location. */
  async restoreSave(saveData: string): Promise<void> {
    try {
      const d = JSON.parse(saveData);
      if (d.v !== 1) throw new Error('Incompatible save version');
      if (d.variables) this.state.variables.deserialize(d.variables);
      this.state.useHtml = d.useHtml ?? false;
      this.state.timerInterval = d.timerInterval ?? 500;
      this.state.showActs = d.showActs ?? true;
      this.state.showObjs = d.showObjs ?? true;
      this.state.showStat = d.showStat ?? true;
      this.state.showInput = d.showInput ?? true;
      this.state.bcolor = d.bcolor ?? -1;
      this.state.fcolor = d.fcolor ?? -1;
      this.state.lcolor = d.lcolor ?? -1;
      const onLoad = this.state.variables.get('$ONGLOAD', 0).str;
      if (onLoad) await this.execLocationByName(onLoad, []);
      if (d.curLocName) throw new GotoSignal(d.curLocName, [], false);
    } catch (e) {
      if (e instanceof GotoSignal) throw e;
      throw e; // Re-throw parse/version errors
    }
  }

  buildSaveData(): string {
    const curLoc = this.locations[this.state.curLoc];
    return JSON.stringify({
      v: 1,
      curLocName: curLoc?.name ?? '',
      mainText: this.state.mainText,
      statText: this.state.statText,
      objects: this.state.objects,
      actions: this.state.actions,
      variables: this.state.variables.serialize(),
      useHtml: this.state.useHtml,
      timerInterval: this.state.timerInterval,
      showActs: this.state.showActs,
      showObjs: this.state.showObjs,
      showStat: this.state.showStat,
      showInput: this.state.showInput,
      bcolor: this.state.bcolor,
      fcolor: this.state.fcolor,
      lcolor: this.state.lcolor,
    });
  }

  private async setVariable(name: string, indexExpr: Expr | undefined, value: QspValue): Promise<void> {
    const uname = name.toUpperCase();

    switch (uname) {
      case 'USEHTML': this.state.useHtml = value.num !== 0; return;
      case 'BCOLOR':
        this.state.bcolor = value.num;
        this.callbacks.onColorsChanged?.(this.state.bcolor, this.state.fcolor, this.state.lcolor);
        return;
      case 'FCOLOR':
        this.state.fcolor = value.num;
        this.callbacks.onColorsChanged?.(this.state.bcolor, this.state.fcolor, this.state.lcolor);
        return;
      case 'LCOLOR':
        this.state.lcolor = value.num;
        this.callbacks.onColorsChanged?.(this.state.bcolor, this.state.fcolor, this.state.lcolor);
        return;
      case '$BACKIMAGE': {
        const path = value.str || (value.num === 0 ? '' : String(value.num));
        this.callbacks.onBackImage?.(path);
        this.state.variables.set(uname, 0, value);
        return;
      }
      case '$COUNTER': this.state.variables.set(uname, 0, value); return;
      case '$ONNEWLOC': this.state.variables.set(uname, 0, value); return;
      case '$ONACTSEL': this.state.variables.set(uname, 0, value); return;
      case '$ONOBJSEL': this.state.variables.set(uname, 0, value); return;
      case '$ONGSAVE': this.state.variables.set(uname, 0, value); return;
      case '$ONGLOAD': this.state.variables.set(uname, 0, value); return;
      case '$USERCOM': this.state.variables.set(uname, 0, value); return;
      case 'RESULT': case '$RESULT': this.state.result = value; return;
    }

    if (uname === 'ARGS' || uname === '$ARGS') {
      const idx = indexExpr ? (await this.evaluator.eval(indexExpr)).num : 0;
      while (this.state.args.length <= idx) this.state.args.push({ num: 0, str: '' });
      this.state.args[idx] = value;
      return;
    }

    // In QSP, $var and var share a slot but store string and number independently.
    // Use setStr/setNum to only update the relevant component.
    const isStr = name.startsWith('$');
    const setter = isStr ? 'setStr' : 'setNum';

    if (indexExpr) {
      const v = await this.evaluator.eval(indexExpr);
      if (v.str) {
        const key = await this.evaluator.substitute(v.str);
        this.state.variables.setByKey(name, key, value, setter);
        return;
      }
      this.state.variables[setter](name, v.num, value);
    } else {
      this.state.variables[setter](name, 0, value);
    }
  }

  private async sub(text: string): Promise<string> {
    return this.evaluator.substitute(text);
  }

  private async appendMainText(text: string, mode: 'p' | 'pl' | 'nl'): Promise<void> {
    const substituted = await this.sub(text);
    switch (mode) {
      case 'p': this.state.mainText += substituted; break;
      case 'pl': this.state.mainText += substituted + '\n'; break;
      case 'nl': this.state.mainText += '\n' + substituted; break;
    }
    this.state.displayVersion++;
    this.callbacks.onMainTextChanged?.(this.state.mainText);
  }

  private async appendStatText(text: string, mode: 'p' | 'pl' | 'nl'): Promise<void> {
    const substituted = await this.sub(text);
    switch (mode) {
      case 'p': this.state.statText += substituted; break;
      case 'pl': this.state.statText += substituted + '\n'; break;
      case 'nl': this.state.statText += '\n' + substituted; break;
    }
    this.state.displayVersion++;
    this.callbacks.onStatTextChanged?.(this.state.statText);
  }

  /** Execute a location's code by name (for GOSUB) */
  async execLocationByName(locName: string, args: QspValue[]): Promise<void> {
    const loc = this.locations.find(
      l => l.name.toUpperCase() === locName.toUpperCase()
    );
    if (!loc) return;

    const savedArgs = this.state.args;
    this.state.args = args;

    try {
      const program = this.parser.parse(loc.code);
      await this.exec(program.statements);
    } catch (e) {
      if (e instanceof ExitSignal || e instanceof JumpSignal) {
        // EXIT/JUMP from gosub — contained within the call
      } else {
        throw e;
      }
    } finally {
      this.state.args = savedArgs;
    }
  }

  /** Execute a dynamic code string */
  async execDynamic(code: string, args: QspValue[]): Promise<void> {
    const savedArgs = this.state.args;
    this.state.args = args;

    try {
      const program = this.parser.parse(code);
      await this.exec(program.statements);
    } catch (e) {
      if (e instanceof ExitSignal || e instanceof JumpSignal) {
        // EXIT/JUMP from dynamic — contained within the call
      } else {
        throw e;
      }
    } finally {
      this.state.args = savedArgs;
    }
  }

  private stmtsToCode(stmts: Stmt[]): string {
    return '__ACT_BODY__' + JSON.stringify(stmts);
  }

  /** Execute an action's stored code */
  async execActionCode(code: string): Promise<void> {
    if (code.startsWith('__ACT_BODY__')) {
      const stmts: Stmt[] = JSON.parse(code.slice('__ACT_BODY__'.length));
      await this.exec(stmts);
    } else {
      const program = this.parser.parse(code);
      await this.exec(program.statements);
    }
  }
}

/** Check if an expression tree contains any string nodes */
function hasString(expr: Expr): boolean {
  if (expr.kind === 'StringLiteral') return true;
  if (expr.kind === 'BinaryExpr') return hasString(expr.left) || hasString(expr.right);
  if (expr.kind === 'Variable') return expr.name.startsWith('$');
  if (expr.kind === 'FunctionCall') return expr.name.startsWith('$');
  return false;
}
