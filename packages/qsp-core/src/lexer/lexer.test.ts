import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Lexer } from './lexer.js';
import { TokenType } from './tokens.js';
import { parseQsp } from '../parser/qsp-parser.js';

describe('Lexer', () => {
  it('should tokenize a simple assignment', () => {
    const lexer = new Lexer("x = 5");
    const tokens = lexer.tokenize();
    expect(tokens.map(t => t.type)).toEqual([
      TokenType.Identifier, TokenType.Equal, TokenType.Number, TokenType.EOF,
    ]);
    expect(tokens[0].value).toBe('x');
    expect(tokens[2].value).toBe('5');
  });

  it('should tokenize string variables with $ prefix', () => {
    const lexer = new Lexer("$name = 'hello'");
    const tokens = lexer.tokenize();
    expect(tokens[0].type).toBe(TokenType.Identifier);
    expect(tokens[0].value).toBe('$name');
    expect(tokens[2].type).toBe(TokenType.String);
    expect(tokens[2].value).toBe('hello');
  });

  it('should handle single-quoted strings with escaping', () => {
    const lexer = new Lexer("$s = 'it''s ok'");
    const tokens = lexer.tokenize();
    const str = tokens.find(t => t.type === TokenType.String)!;
    expect(str.value).toBe("it's ok");
  });

  it('should handle double-quoted strings', () => {
    const lexer = new Lexer('$s = "hello ""world"""');
    const tokens = lexer.tokenize();
    const str = tokens.find(t => t.type === TokenType.String)!;
    expect(str.value).toBe('hello "world"');
  });

  it('should handle brace strings with nesting', () => {
    const lexer = new Lexer('$s = {outer {inner} end}');
    const tokens = lexer.tokenize();
    const str = tokens.find(t => t.type === TokenType.String)!;
    expect(str.value).toBe('outer {inner} end');
  });

  it('should tokenize & as statement separator', () => {
    const lexer = new Lexer('x = 1 & y = 2');
    const tokens = lexer.tokenize();
    const types = tokens.map(t => t.type);
    expect(types).toEqual([
      TokenType.Identifier, TokenType.Equal, TokenType.Number,
      TokenType.Ampersand,
      TokenType.Identifier, TokenType.Equal, TokenType.Number,
      TokenType.EOF,
    ]);
  });

  it('should recognize keywords case-insensitively', () => {
    const lexer = new Lexer("IF x > 0: goto 'room'");
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.Keyword, value: 'IF' });
    expect(tokens[5]).toMatchObject({ type: TokenType.Keyword, value: 'GOTO' });
  });

  it('should recognize *P, *PL, *NL, *CLR, *CLEAR keywords', () => {
    const lexer = new Lexer("*pl 'hello'");
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.Keyword, value: '*PL' });
  });

  it('should handle labels', () => {
    const lexer = new Lexer(":myLabel\nx = 1");
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.Label, value: 'myLabel' });
  });

  it('should handle comments with !', () => {
    const lexer = new Lexer("! this is a comment\nx = 1");
    const tokens = lexer.tokenize();
    expect(tokens[0].type).toBe(TokenType.Comment);
    expect(tokens[0].value).toBe('! this is a comment');
  });

  it('should handle inline comments after &', () => {
    const lexer = new Lexer("x = 1 & ! comment");
    const tokens = lexer.tokenize();
    const types = tokens.map(t => t.type);
    expect(types).toContain(TokenType.Comment);
  });

  it('should handle comparison operators', () => {
    const lexer = new Lexer("x <> 0 & y <= 10 & z >= 5");
    const tokens = lexer.tokenize();
    expect(tokens[1].type).toBe(TokenType.NotEqual);
    expect(tokens[5].type).toBe(TokenType.LessEqual);
    expect(tokens[9].type).toBe(TokenType.GreaterEqual);
  });

  it('should recognize ADD OBJ as two-word keyword', () => {
    const lexer = new Lexer("ADD OBJ 'sword'");
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.Keyword, value: 'ADD OBJ' });
  });

  it('should handle Cyrillic identifiers', () => {
    const lexer = new Lexer("дни = время / 60");
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.Identifier, value: 'дни' });
    expect(tokens[2]).toMatchObject({ type: TokenType.Identifier, value: 'время' });
  });

  it('should handle line continuation with _', () => {
    const lexer = new Lexer("x = 1 + _\n  2");
    const tokens = lexer.tokenize();
    // _ continuation should be invisible — no LineBreak between + and 2
    const types = tokens.map(t => t.type);
    expect(types).toEqual([
      TokenType.Identifier, TokenType.Equal, TokenType.Number,
      TokenType.Plus, TokenType.Number, TokenType.EOF,
    ]);
  });

  it('should handle array indexing', () => {
    const lexer = new Lexer("$arr[0] = 'test'");
    const tokens = lexer.tokenize();
    expect(tokens[0].value).toBe('$arr');
    expect(tokens[1].type).toBe(TokenType.LeftBracket);
    expect(tokens[2].value).toBe('0');
    expect(tokens[3].type).toBe(TokenType.RightBracket);
  });

  describe('real QSP code from examples', () => {
    const EXAMPLES_DIR = join(__dirname, '../../../../_examples');

    it('should tokenize primer1.qsp location code', () => {
      const data = readFileSync(join(EXAMPLES_DIR, 'primer1.qsp'));
      const game = parseQsp(new Uint8Array(data));

      // Tokenize each location's code
      for (const loc of game.locations) {
        if (!loc.code) continue;
        const lexer = new Lexer(loc.code);
        const tokens = lexer.tokenize();

        // Should always end with EOF
        expect(tokens[tokens.length - 1].type).toBe(TokenType.EOF);
        // Should have produced some tokens
        expect(tokens.length).toBeGreaterThan(1);
      }
    });

    it('should tokenize all example files without errors', () => {
      const fs = require('fs');
      const qspFiles = fs.readdirSync(EXAMPLES_DIR).filter((f: string) => f.endsWith('.qsp'));

      let totalTokens = 0;
      let totalLocations = 0;

      for (const file of qspFiles) {
        const data = readFileSync(join(EXAMPLES_DIR, file));
        const game = parseQsp(new Uint8Array(data));

        for (const loc of game.locations) {
          totalLocations++;
          if (!loc.code) continue;
          const lexer = new Lexer(loc.code);
          const tokens = lexer.tokenize();
          totalTokens += tokens.length;

          // Also tokenize action code
          for (const act of loc.actions) {
            if (!act.code) continue;
            const actLexer = new Lexer(act.code);
            const actTokens = actLexer.tokenize();
            totalTokens += actTokens.length;
          }
        }
      }

      console.log(`Tokenized ${totalLocations} locations, ${totalTokens} total tokens`);
      expect(totalTokens).toBeGreaterThan(0);
    });
  });
});
