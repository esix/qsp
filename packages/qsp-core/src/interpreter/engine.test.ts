import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { QspEngine } from './engine.js';
import { parseQsp } from '../parser/qsp-parser.js';

const EXAMPLES_DIR = join(__dirname, '../../../../_examples');

function loadEngine(file: string): QspEngine {
  const data = readFileSync(join(EXAMPLES_DIR, file));
  const engine = new QspEngine();
  engine.loadGame(new Uint8Array(data));
  return engine;
}

describe('QspEngine', () => {
  describe('basic engine lifecycle', () => {
    it('should load and start time.qsp', async () => {
      const engine = loadEngine('time.qsp');

      let mainText = '';
      let actions: string[] = [];

      engine.on({
        onMainTextChanged: (t) => { mainText = t; },
        onActionsChanged: (a) => { actions = a.map(x => x.name); },
      });

      await engine.start();
      engine.stopTimer();

      expect(engine.currentLocation).toBeTruthy();
      expect(engine.currentLocation!.name).toBe('1');

      // time.qsp shows time display and has actions "Гулять" and "Спать"
      expect(actions).toContain('Гулять');
      expect(actions).toContain('Спать');

      console.log('time.qsp main text:', mainText.substring(0, 200));
      console.log('time.qsp actions:', actions);
    });

    it('should execute actions in time.qsp', async () => {
      const engine = loadEngine('time.qsp');

      let mainText = '';
      engine.on({
        onMainTextChanged: (t) => { mainText = t; },
      });

      await engine.start();
      engine.stopTimer();

      const initialText = mainText;

      // Execute "Гулять" (Walk) action - should change time
      const walkIdx = engine.state.actions.findIndex(a => a.name === 'Гулять');
      expect(walkIdx).toBeGreaterThanOrEqual(0);

      await engine.execAction(walkIdx);

      console.log('After walk:', mainText.substring(0, 200));
      // Text should have changed (time advanced)
      // The game recalculates time display on each action
    });
  });

  describe('pullcard.qsp', () => {
    it('should load and run card drawing', async () => {
      const engine = loadEngine('pullcard.qsp');

      let mainText = '';
      let actions: string[] = [];

      engine.on({
        onMainTextChanged: (t) => { mainText = t; },
        onActionsChanged: (a) => { actions = a.map(x => x.name); },
      });

      await engine.start();
      engine.stopTimer();

      console.log('pullcard main text:', mainText.substring(0, 300));
      console.log('pullcard actions:', actions);

      // Should have "Еще раз" (Again) action
      expect(actions).toContain('Еще раз');
    });
  });

  describe('Les1.Coloring.qsp', () => {
    it('should load and show color actions', async () => {
      const engine = loadEngine('Les1.Coloring.qsp');

      let actions: string[] = [];
      engine.on({
        onActionsChanged: (a) => { actions = a.map(x => x.name); },
      });

      await engine.start();
      engine.stopTimer();

      console.log('coloring actions:', actions);
      // Should have color-related actions
      expect(actions.length).toBeGreaterThan(0);
    });
  });

  describe('primer1.qsp', () => {
    it('should start and show initial text', async () => {
      const engine = loadEngine('primer1.qsp');

      let mainText = '';
      let actions: string[] = [];

      engine.on({
        onMainTextChanged: (t) => { mainText = t; },
        onActionsChanged: (a) => { actions = a.map(x => x.name); },
      });

      await engine.start();
      engine.stopTimer();

      console.log('primer1 main text:', mainText.substring(0, 300));
      console.log('primer1 actions:', actions);

      expect(mainText.length).toBeGreaterThan(0);
    });
  });

  describe('BJ_lite.qsp (Blackjack)', () => {
    it('should start and show initial text with actions', async () => {
      const engine = loadEngine('BJ_lite.qsp');

      let mainText = '';
      let actions: string[] = [];

      engine.on({
        onMainTextChanged: (t) => { mainText = t; },
        onActionsChanged: (a) => { actions = a.map(x => x.name); },
      });

      await engine.start();
      engine.stopTimer();

      console.log('BJ_lite main text:', mainText.substring(0, 300));
      console.log('BJ_lite actions:', actions);

      // Start location should have "Начать игру" (Start game) action
      expect(actions).toContain('Начать игру');
    });
  });

  describe('interpreter correctness', () => {
    it('should evaluate arithmetic correctly', async () => {
      const engine = new QspEngine();
      engine.loadParsedGame({
        version: 'test',
        password: '',
        isOldFormat: false,
        locations: [{
          name: 'start',
          description: '',
          code: 'x = 2 + 3 * 4\ny = (10 - 2) / 4\nz = 15 MOD 4',
          actions: [],
        }],
      });

      await engine.start();
      engine.stopTimer();

      expect(engine.state.variables.get('x').num).toBe(14);
      expect(engine.state.variables.get('y').num).toBe(2);
      expect(engine.state.variables.get('z').num).toBe(3);
    });

    it('should handle string operations', async () => {
      const engine = new QspEngine();
      engine.loadParsedGame({
        version: 'test',
        password: '',
        isOldFormat: false,
        locations: [{
          name: 'start',
          description: '',
          code: [
            "$name = 'World'",
            "$greeting = 'Hello, ' + $name + '!'",
            "length = LEN($greeting)",
            "$upper = $UCASE($greeting)",
            "$mid = $MID($greeting, 8, 5)",
          ].join('\n'),
          actions: [],
        }],
      });

      await engine.start();
      engine.stopTimer();

      expect(engine.state.variables.get('$greeting').str).toBe('Hello, World!');
      expect(engine.state.variables.get('length').num).toBe(13);
      expect(engine.state.variables.get('$upper').str).toBe('HELLO, WORLD!');
      expect(engine.state.variables.get('$mid').str).toBe('World');
    });

    it('should handle arrays', async () => {
      const engine = new QspEngine();
      engine.loadParsedGame({
        version: 'test',
        password: '',
        isOldFormat: false,
        locations: [{
          name: 'start',
          description: '',
          code: [
            "$items[0] = 'sword'",
            "$items[1] = 'shield'",
            "$items[2] = 'potion'",
            "count = ARRSIZE('$items')",
            "found = ARRPOS('$items', 'shield')",
          ].join('\n'),
          actions: [],
        }],
      });

      await engine.start();
      engine.stopTimer();

      expect(engine.state.variables.get('$items', 0).str).toBe('sword');
      expect(engine.state.variables.get('$items', 1).str).toBe('shield');
      expect(engine.state.variables.get('$items', 2).str).toBe('potion');
      expect(engine.state.variables.get('count').num).toBe(3);
      expect(engine.state.variables.get('found').num).toBe(1);
    });

    it('should handle IF/ELSE', async () => {
      const engine = new QspEngine();
      engine.loadParsedGame({
        version: 'test',
        password: '',
        isOldFormat: false,
        locations: [{
          name: 'start',
          description: '',
          code: [
            'x = 10',
            'IF x > 5:',
            '  answer = 1',
            'ELSE',
            '  answer = 0',
            'END',
          ].join('\n'),
          actions: [],
        }],
      });

      await engine.start();
      engine.stopTimer();

      expect(engine.state.variables.get('answer').num).toBe(1);
    });

    it('should handle LOOP', async () => {
      const engine = new QspEngine();
      engine.loadParsedGame({
        version: 'test',
        password: '',
        isOldFormat: false,
        locations: [{
          name: 'start',
          description: '',
          code: [
            'sum = 0',
            'LOOP i = 1 WHILE i <= 10 STEP i = i + 1:',
            '  sum = sum + i',
            'END',
          ].join('\n'),
          actions: [],
        }],
      });

      await engine.start();
      engine.stopTimer();

      expect(engine.state.variables.get('sum').num).toBe(55);
    });

    it('should handle GOSUB and FUNC', async () => {
      const engine = new QspEngine();
      engine.loadParsedGame({
        version: 'test',
        password: '',
        isOldFormat: false,
        locations: [
          {
            name: 'start',
            description: '',
            code: [
              "gs 'double', 21",
              "x = RESULT",
            ].join('\n'),
            actions: [],
          },
          {
            name: 'double',
            description: '',
            code: "RESULT = ARGS[0] * 2",
            actions: [],
          },
        ],
      });

      await engine.start();
      engine.stopTimer();

      expect(engine.state.variables.get('x').num).toBe(42);
    });

    it('should handle ADDOBJ / DELOBJ', async () => {
      const engine = new QspEngine();
      engine.loadParsedGame({
        version: 'test',
        password: '',
        isOldFormat: false,
        locations: [{
          name: 'start',
          description: '',
          code: [
            "ADDOBJ 'sword'",
            "ADDOBJ 'shield'",
            "ADDOBJ 'potion'",
            "has_shield = OBJ('shield')",
            "DELOBJ 'shield'",
            "has_shield_after = OBJ('shield')",
            "obj_count = COUNTOBJ",
          ].join('\n'),
          actions: [],
        }],
      });

      await engine.start();
      engine.stopTimer();

      expect(engine.state.variables.get('has_shield').num).toBe(-1); // true
      expect(engine.state.variables.get('has_shield_after').num).toBe(0); // false
      expect(engine.state.variables.get('obj_count').num).toBe(2);
      expect(engine.state.objects).toHaveLength(2);
      expect(engine.state.objects.map(o => o.name)).toEqual(['sword', 'potion']);
    });

    it('should handle DYNAMIC code execution', async () => {
      const engine = new QspEngine();
      engine.loadParsedGame({
        version: 'test',
        password: '',
        isOldFormat: false,
        locations: [{
          name: 'start',
          description: '',
          code: [
            "DYNAMIC 'x = ARGS[0] + ARGS[1]', 10, 32",
          ].join('\n'),
          actions: [],
        }],
      });

      await engine.start();
      engine.stopTimer();

      expect(engine.state.variables.get('x').num).toBe(42);
    });

    it('should handle ACT and execute actions', async () => {
      const engine = new QspEngine();
      let mainText = '';
      engine.on({
        onMainTextChanged: (t) => { mainText = t; },
      });

      engine.loadParsedGame({
        version: 'test',
        password: '',
        isOldFormat: false,
        locations: [{
          name: 'start',
          description: '',
          code: [
            "ACT 'Press me':",
            "  x = 42",
            "  *PL 'Button pressed!'",
            "END",
          ].join('\n'),
          actions: [],
        }],
      });

      await engine.start();
      engine.stopTimer();

      expect(engine.state.actions).toHaveLength(1);
      expect(engine.state.actions[0].name).toBe('Press me');

      await engine.execAction(0);
      expect(engine.state.variables.get('x').num).toBe(42);
      expect(mainText).toContain('Button pressed!');
    });

    it('should handle GOTO between locations', async () => {
      const engine = new QspEngine();
      engine.loadParsedGame({
        version: 'test',
        password: '',
        isOldFormat: false,
        locations: [
          {
            name: 'room1',
            description: 'Room 1',
            code: "GT 'room2'",
            actions: [],
          },
          {
            name: 'room2',
            description: 'Room 2',
            code: "arrived = 1",
            actions: [],
          },
        ],
      });

      await engine.start();
      engine.stopTimer();

      expect(engine.currentLocation!.name).toBe('room2');
      expect(engine.state.variables.get('arrived').num).toBe(1);
    });
  });
});
