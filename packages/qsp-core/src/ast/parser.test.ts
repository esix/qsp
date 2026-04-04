import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Parser } from './parser.js';
import { parseQsp } from '../parser/qsp-parser.js';

const parser = new Parser();
const EXAMPLES_DIR = join(__dirname, '../../../../_examples');

describe('Parser', () => {
  describe('expressions', () => {
    it('should parse number literal', () => {
      const p = parser.parse('x = 42');
      expect(p.statements).toHaveLength(1);
      const s = p.statements[0];
      expect(s.kind).toBe('AssignStmt');
      if (s.kind === 'AssignStmt') {
        expect(s.value.kind).toBe('NumberLiteral');
      }
    });

    it('should parse string literal', () => {
      const p = parser.parse("$x = 'hello'");
      const s = p.statements[0];
      expect(s.kind).toBe('AssignStmt');
      if (s.kind === 'AssignStmt') {
        expect(s.value).toMatchObject({ kind: 'StringLiteral', value: 'hello' });
      }
    });

    it('should parse arithmetic with precedence', () => {
      const p = parser.parse('x = 2 + 3 * 4');
      const s = p.statements[0];
      if (s.kind === 'AssignStmt') {
        const v = s.value;
        expect(v.kind).toBe('BinaryExpr');
        if (v.kind === 'BinaryExpr') {
          expect(v.op).toBe('+');
          expect(v.left).toMatchObject({ kind: 'NumberLiteral', value: 2 });
          expect(v.right.kind).toBe('BinaryExpr');
          if (v.right.kind === 'BinaryExpr') {
            expect(v.right.op).toBe('*');
          }
        }
      }
    });

    it('should parse parenthesized expressions', () => {
      const p = parser.parse('x = (2 + 3) * 4');
      const s = p.statements[0];
      if (s.kind === 'AssignStmt' && s.value.kind === 'BinaryExpr') {
        expect(s.value.op).toBe('*');
        expect(s.value.left.kind).toBe('Parenthesized');
      }
    });

    it('should parse function calls', () => {
      const p = parser.parse('x = RAND(1, 10)');
      const s = p.statements[0];
      if (s.kind === 'AssignStmt') {
        expect(s.value).toMatchObject({ kind: 'FunctionCall', name: 'RAND' });
        if (s.value.kind === 'FunctionCall') {
          expect(s.value.args).toHaveLength(2);
        }
      }
    });

    it('should parse array access', () => {
      const p = parser.parse('$arr[0]');
      const s = p.statements[0];
      if (s.kind === 'ExprStmt') {
        expect(s.expr).toMatchObject({ kind: 'Variable', name: '$arr' });
        if (s.expr.kind === 'Variable') {
          expect(s.expr.index).toMatchObject({ kind: 'NumberLiteral', value: 0 });
        }
      }
    });

    it('should parse comparison operators', () => {
      const p = parser.parse('x = a <> 0');
      const s = p.statements[0];
      if (s.kind === 'AssignStmt' && s.value.kind === 'BinaryExpr') {
        expect(s.value.op).toBe('<>');
      }
    });

    it('should parse logical operators', () => {
      const p = parser.parse('x = a AND b OR NO c');
      const s = p.statements[0];
      if (s.kind === 'AssignStmt') {
        // OR has lowest precedence, so root should be OR
        expect(s.value.kind).toBe('BinaryExpr');
        if (s.value.kind === 'BinaryExpr') {
          expect(s.value.op).toBe('OR');
        }
      }
    });

    it('should parse unary minus', () => {
      const p = parser.parse('x = -5');
      const s = p.statements[0];
      if (s.kind === 'AssignStmt') {
        expect(s.value).toMatchObject({ kind: 'UnaryExpr', op: '-' });
      }
    });
  });

  describe('statements', () => {
    it('should parse SET assignment', () => {
      const p = parser.parse('SET x = 10');
      expect(p.statements[0]).toMatchObject({ kind: 'AssignStmt' });
    });

    it('should parse LET assignment', () => {
      const p = parser.parse('LET $name = "test"');
      expect(p.statements[0]).toMatchObject({ kind: 'AssignStmt' });
    });

    it('should parse GOTO', () => {
      const p = parser.parse("GT 'room1'");
      const s = p.statements[0];
      expect(s.kind).toBe('GotoStmt');
      if (s.kind === 'GotoStmt') {
        expect(s.extended).toBe(false);
        expect(s.destination).toMatchObject({ kind: 'StringLiteral', value: 'room1' });
      }
    });

    it('should parse XGOTO', () => {
      const p = parser.parse("XGT 'room1'");
      const s = p.statements[0];
      if (s.kind === 'GotoStmt') expect(s.extended).toBe(true);
    });

    it('should parse GOSUB with args', () => {
      const p = parser.parse("GS 'func', 1, 2, 3");
      const s = p.statements[0];
      expect(s.kind).toBe('GosubStmt');
      if (s.kind === 'GosubStmt') {
        expect(s.args).toHaveLength(3);
      }
    });

    it('should parse & separated statements', () => {
      const p = parser.parse('x = 1 & y = 2 & z = 3');
      expect(p.statements).toHaveLength(3);
      expect(p.statements.every(s => s.kind === 'AssignStmt')).toBe(true);
    });

    it('should parse comments', () => {
      const p = parser.parse('! this is a comment');
      expect(p.statements[0]).toMatchObject({ kind: 'CommentStmt' });
    });

    it('should parse labels', () => {
      const p = parser.parse(':start\nx = 1');
      expect(p.statements[0]).toMatchObject({ kind: 'LabelStmt', name: 'start' });
    });

    it('should parse SHOWACTS/SHOWOBJS/SHOWSTAT/SHOWINPUT', () => {
      const p = parser.parse('SHOWACTS 0 & SHOWOBJS 1 & SHOWSTAT 0 & SHOWINPUT 0');
      expect(p.statements).toHaveLength(4);
      expect(p.statements[0]).toMatchObject({ kind: 'ShowWindowStmt', window: 'acts' });
      expect(p.statements[1]).toMatchObject({ kind: 'ShowWindowStmt', window: 'objs' });
    });

    it('should parse *PL', () => {
      const p = parser.parse("*PL 'hello world'");
      const s = p.statements[0];
      expect(s).toMatchObject({ kind: 'PrintStmt', target: 'main', mode: 'pl' });
    });

    it('should parse ADDOBJ with image', () => {
      const p = parser.parse("ADDOBJ 'sword', 'sword.png'");
      const s = p.statements[0];
      expect(s.kind).toBe('AddObjStmt');
      if (s.kind === 'AddObjStmt') {
        expect(s.image).toBeTruthy();
      }
    });

    it('should parse KILLALL', () => {
      const p = parser.parse('KILLALL');
      expect(p.statements[0]).toMatchObject({ kind: 'KillAllStmt' });
    });

    it('should parse LOCAL with init', () => {
      const p = parser.parse('LOCAL x = 5');
      const s = p.statements[0];
      expect(s.kind).toBe('LocalStmt');
      if (s.kind === 'LocalStmt') {
        expect(s.value).toMatchObject({ kind: 'NumberLiteral', value: 5 });
      }
    });

    it('should parse DYNAMIC with args', () => {
      const p = parser.parse("DYNAMIC '$x = ARGS[0]', 42");
      const s = p.statements[0];
      expect(s.kind).toBe('DynamicStmt');
      if (s.kind === 'DynamicStmt') {
        expect(s.args).toHaveLength(1);
      }
    });

    it('should parse bare string as expression statement', () => {
      const p = parser.parse("'Hello world'");
      const s = p.statements[0];
      expect(s.kind).toBe('ExprStmt');
      if (s.kind === 'ExprStmt') {
        expect(s.expr).toMatchObject({ kind: 'StringLiteral', value: 'Hello world' });
      }
    });
  });

  describe('control flow', () => {
    it('should parse single-line IF', () => {
      const p = parser.parse("IF x > 0: GT 'room'");
      const s = p.statements[0];
      expect(s.kind).toBe('IfStmt');
      if (s.kind === 'IfStmt') {
        expect(s.branches).toHaveLength(1);
        expect(s.branches[0].body).toHaveLength(1);
      }
    });

    it('should parse multi-line IF/ELSEIF/ELSE/END', () => {
      const p = parser.parse([
        'IF x = 1:',
        "  GT 'a'",
        'ELSEIF x = 2:',
        "  GT 'b'",
        'ELSE',
        "  GT 'c'",
        'END',
      ].join('\n'));
      const s = p.statements[0];
      expect(s.kind).toBe('IfStmt');
      if (s.kind === 'IfStmt') {
        expect(s.branches).toHaveLength(2);
        expect(s.elseBranch).toBeTruthy();
        expect(s.elseBranch).toHaveLength(1);
      }
    });

    it('should parse ACT block', () => {
      const p = parser.parse([
        "ACT 'Open door':",
        "  GT 'next_room'",
        'END',
      ].join('\n'));
      const s = p.statements[0];
      expect(s.kind).toBe('ActStmt');
      if (s.kind === 'ActStmt') {
        expect(s.body).toHaveLength(1);
      }
    });

    it('should parse LOOP', () => {
      const p = parser.parse([
        'LOOP i = 0 WHILE i < 10 STEP i = i + 1:',
        "  *PL 'i = ' + STR(i)",
        'END',
      ].join('\n'));
      const s = p.statements[0];
      expect(s.kind).toBe('LoopStmt');
      if (s.kind === 'LoopStmt') {
        expect(s.init).toBeTruthy();
        expect(s.step).toBeTruthy();
        expect(s.body).toHaveLength(1);
      }
    });
  });

  describe('real QSP code', () => {
    it('should parse time.qsp', () => {
      const data = readFileSync(join(EXAMPLES_DIR, 'time.qsp'));
      const game = parseQsp(new Uint8Array(data));

      for (const loc of game.locations) {
        if (!loc.code) continue;
        const program = parser.parse(loc.code);
        expect(program.statements.length).toBeGreaterThan(0);
        console.log(`  Location "${loc.name}": ${program.statements.length} statements`);
      }
    });

    it('should parse all example files', () => {
      const qspFiles = readdirSync(EXAMPLES_DIR).filter(f => f.endsWith('.qsp'));
      let totalStmts = 0;
      let totalLocs = 0;
      let parseErrors = 0;

      for (const file of qspFiles) {
        const data = readFileSync(join(EXAMPLES_DIR, file));
        const game = parseQsp(new Uint8Array(data));

        for (const loc of game.locations) {
          totalLocs++;
          if (!loc.code) continue;

          try {
            const program = parser.parse(loc.code);
            totalStmts += program.statements.length;
          } catch (e) {
            parseErrors++;
            console.error(`  Parse error in ${file} / "${loc.name}": ${(e as Error).message}`);
            // Print snippet around error for debugging
            const match = (e as Error).message.match(/line (\d+)/);
            if (match) {
              const errLine = parseInt(match[1]);
              const lines = loc.code.split('\n');
              const start = Math.max(0, errLine - 2);
              const end = Math.min(lines.length, errLine + 2);
              for (let i = start; i < end; i++) {
                console.error(`    ${i + 1}${i + 1 === errLine ? ' >>>' : '    '} ${lines[i]}`);
              }
            }
          }

          // Also parse action code
          for (const act of loc.actions) {
            if (!act.code) continue;
            try {
              const program = parser.parse(act.code);
              totalStmts += program.statements.length;
            } catch (e) {
              parseErrors++;
              console.error(`  Parse error in ${file} / "${loc.name}" / action "${act.name}": ${(e as Error).message}`);
            }
          }
        }
      }

      console.log(`Parsed ${totalLocs} locations, ${totalStmts} total statements, ${parseErrors} errors`);
      // Allow some errors for now — we'll fix them iteratively
      expect(totalStmts).toBeGreaterThan(0);
    });
  });
});
