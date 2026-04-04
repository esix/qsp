import type { QspGame, QspLocation } from '../types/index.js';
import { GameState } from './state.js';
import type { QspCallbacks, QspRuntimeAction, QspValue } from './state.js';
import { Executor, GotoSignal, ExitSignal } from './executor.js';
import { Evaluator } from './evaluator.js';
import { Parser } from '../ast/parser.js';
import { parseQsp } from '../parser/qsp-parser.js';

/**
 * QSP Engine — the main orchestrator
 *
 * Loads a game, manages location transitions, handles actions and timer.
 * All execution methods are async to support WAIT (animated delays).
 */
export class QspEngine {
  readonly state = new GameState();
  private game: QspGame | null = null;
  private locations: QspLocation[] = [];
  private executor!: Executor;
  private evaluator!: Evaluator;
  private parser = new Parser();
  private callbacks: QspCallbacks = {};
  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private timerRunning = false;

  /** Set UI callbacks */
  on(callbacks: QspCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /** Load a game from raw .qsp file bytes */
  loadGame(data: Uint8Array): void {
    this.game = parseQsp(data);
    this.locations = this.game.locations;
    this.state.reset();
    this.executor = new Executor(this.state, this.locations, this.callbacks);
    this.evaluator = new Evaluator(
      this.state, this.locations, this.callbacks,
      (code, args) => this.executor.execDynamic(code, args),
      (loc, args) => this.executor.execLocationByName(loc, args),
    );
  }

  /** Load a game from an already-parsed QspGame object */
  loadParsedGame(game: QspGame): void {
    this.game = game;
    this.locations = game.locations;
    this.state.reset();
    this.executor = new Executor(this.state, this.locations, this.callbacks);
    this.evaluator = new Evaluator(
      this.state, this.locations, this.callbacks,
      (code, args) => this.executor.execDynamic(code, args),
      (loc, args) => this.executor.execLocationByName(loc, args),
    );
  }

  /** Start the game — execute location 0 */
  async start(): Promise<void> {
    if (!this.game || this.locations.length === 0) {
      throw new Error('No game loaded');
    }
    await this.gotoLocation(this.locations[0].name, [], false);
    this.startTimer();
  }

  /** Navigate to a location by name */
  async gotoLocation(name: string, args: QspValue[] = [], extended = false): Promise<void> {
    const locIndex = this.locations.findIndex(
      l => l.name.toUpperCase() === name.toUpperCase()
    );
    if (locIndex < 0) return;

    this.state.curLoc = locIndex;
    const loc = this.locations[locIndex];

    if (!extended) {
      this.state.mainText = '';
    }

    if (loc.description) {
      this.state.mainText += loc.description;
    }

    this.state.actions = [];
    for (const act of loc.actions) {
      this.state.actions.push({ name: act.name, image: act.image, code: act.code });
    }
    this.state.args = args;

    if (loc.code) {
      try {
        const program = this.parser.parse(loc.code);
        await this.executor.exec(program.statements);
      } catch (e) {
        if (e instanceof GotoSignal) {
          await this.gotoLocation(e.locName, e.args, e.extended);
          return;
        }
        if (e instanceof ExitSignal) {
          // EXIT — stop executing
        } else {
          throw e;
        }
      }
    }

    await this.notifyUI();

    // $ONNEWLOC runs after the location's own code — it can post-process $MAINTXT
    const onNewLoc = this.state.variables.get('$ONNEWLOC', 0).str;
    if (onNewLoc) {
      try {
        await this.executor.execLocationByName(onNewLoc, []);
      } catch (e) {
        if (e instanceof GotoSignal) {
          await this.gotoLocation(e.locName, e.args, e.extended);
          return;
        }
        if (!(e instanceof ExitSignal)) throw e;
      }
      await this.notifyUI();
    }
  }

  /** Execute an action by index */
  /** Execute a dynamic code string (used for exec: links) */
  async execDynamic(code: string, args: QspValue[] = []): Promise<void> {
    try {
      await this.executor.execDynamic(code, args);
    } catch (e) {
      if (e instanceof GotoSignal) {
        await this.gotoLocation(e.locName, e.args, e.extended);
      } else if (e instanceof ExitSignal) {
        // EXIT — stop
      } else {
        throw e;
      }
    }
    await this.notifyUI();
  }

  async execAction(index: number): Promise<void> {
    const action = this.state.actions[index];
    if (!action) return;

    // Set $SELACT / SELACT before running the action code
    this.state.variables.set('$SELACT', 0, { num: 0, str: action.name, isString: true });
    this.state.variables.set('SELACT', 0, { num: index + 1, str: '' });

    try {
      await this.executor.execActionCode(action.code);
    } catch (e) {
      if (e instanceof GotoSignal) {
        await this.gotoLocation(e.locName, e.args, e.extended);
      } else if (e instanceof ExitSignal) {
        // EXIT — stop
      } else {
        throw e;
      }
    }

    await this.notifyUI();
  }

  /** Select an object by index (triggers $ONOBJSEL) */
  async selectObject(index: number): Promise<void> {
    if (index < 0 || index >= this.state.objects.length) return;

    const obj = this.state.objects[index];
    this.state.variables.set('$SELOBJ', 0, { num: 0, str: obj.name });
    this.state.variables.set('SELOBJ', 0, { num: index + 1, str: '' });

    const handler = this.state.variables.get('$ONOBJSEL', 0).str;
    if (handler) {
      try {
        await this.executor.execLocationByName(handler, []);
      } catch (e) {
        if (e instanceof GotoSignal) {
          await this.gotoLocation(e.locName, e.args, e.extended);
          return;
        }
        if (e instanceof ExitSignal) {
          // EXIT — stop
        } else {
          throw e;
        }
      }
    }

    await this.notifyUI();
  }

  /** Handle user text input */
  submitInput(text: string): void {
    this.state.variables.set('$USER_TEXT', 0, { num: 0, str: text });
    this.state.variables.set('$USRTXT', 0, { num: 0, str: text });
  }

  /** Start the timer (calls $COUNTER location periodically) */
  private startTimer(): void {
    this.stopTimer();
    this.timerRunning = true;
    this.scheduleTimer();
  }

  private scheduleTimer(): void {
    if (!this.timerRunning) return;
    this.timerHandle = setTimeout(() => this.runTimer(), this.state.timerInterval);
  }

  private async runTimer(): Promise<void> {
    if (!this.timerRunning) return;
    const counterLoc = this.state.variables.get('$COUNTER', 0).str;
    if (counterLoc) {
      try {
        await this.executor.execLocationByName(counterLoc, []);
      } catch (e) {
        if (e instanceof GotoSignal) {
          await this.gotoLocation(e.locName, e.args, e.extended);
        }
      }
      await this.notifyUI();
    }
    this.scheduleTimer();
  }

  /** Stop the timer */
  stopTimer(): void {
    this.timerRunning = false;
    if (this.timerHandle !== null) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private async sub(text: string): Promise<string> {
    return this.evaluator.substitute(text);
  }

  private async notifyUI(): Promise<void> {
    this.callbacks.onMainTextChanged?.(await this.sub(this.state.mainText));
    this.callbacks.onStatTextChanged?.(await this.sub(this.state.statText));
    const actions = await Promise.all(
      this.state.actions.map(async a => ({ ...a, name: await this.sub(a.name) }))
    );
    this.callbacks.onActionsChanged?.(actions);
    this.callbacks.onObjectsChanged?.(this.state.objects);
  }

  get currentLocation(): QspLocation | null {
    if (this.state.curLoc < 0 || this.state.curLoc >= this.locations.length) return null;
    return this.locations[this.state.curLoc];
  }

  get allLocations(): QspLocation[] {
    return this.locations;
  }
}
