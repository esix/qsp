import { TokenType, Token, KEYWORDS } from './tokens.js';

/**
 * QSP Lexer / Tokenizer
 *
 * Handles:
 * - String literals with ', ", and {} (with nesting)
 * - Numeric literals
 * - Case-insensitive keyword recognition
 * - Multi-character operators (<>, <=, >=, *P, *PL, *NL, *CLR, *CLEAR)
 * - & as statement separator
 * - _ as line continuation
 * - ! as line comment
 * - :label at start of statement
 */
export class Lexer {
  private source: string;
  private pos = 0;
  private line = 1;
  private col = 1;
  private tokens: Token[] = [];
  private atStatementStart = true;

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    while (this.pos < this.source.length) {
      this.skipSpaces();
      if (this.pos >= this.source.length) break;

      const ch = this.source[this.pos];

      // Line break
      if (ch === '\n') {
        this.addToken(TokenType.LineBreak, '\n');
        this.advance();
        this.atStatementStart = true;
        continue;
      }

      // Carriage return (skip, \n handles line counting)
      if (ch === '\r') {
        this.advance();
        continue;
      }

      // Line continuation: _ at end of line (before optional spaces and newline)
      if (ch === '_' && this.isLineContinuation()) {
        this.skipLineContinuation();
        continue;
      }

      // Label at start of statement: :name
      if (ch === ':' && this.atStatementStart) {
        this.readLabel();
        continue;
      }

      // Comment: ! at start of statement
      // If immediately followed by a quote, the comment spans the entire string literal
      // (block comment: !' ... multiline ... ')
      if (ch === '!' && this.atStatementStart) {
        const next = this.pos + 1 < this.source.length ? this.source[this.pos + 1] : '';
        if (next === "'" || next === '"') {
          this.advance(); // skip !
          this.skipQuotedString(next); // consume the string literal as comment body
        } else if (next === '{') {
          this.advance(); // skip !
          this.skipBraceString(); // consume brace string as comment body
        } else {
          this.readComment(); // single-line comment to \n
        }
        continue;
      }

      // String literals
      if (ch === "'" || ch === '"') {
        this.readQuotedString(ch);
        this.atStatementStart = false;
        continue;
      }
      if (ch === '{') {
        this.readBraceString();
        this.atStatementStart = false;
        continue;
      }

      // Numbers
      if (this.isDigit(ch)) {
        this.readNumber();
        this.atStatementStart = false;
        continue;
      }

      // Star-prefixed keywords: *P, *PL, *NL, *CLR, *CLEAR
      if (ch === '*' && this.pos + 1 < this.source.length && this.isAlpha(this.source[this.pos + 1])) {
        const word = this.peekStarKeyword();
        if (word) {
          this.addToken(TokenType.Keyword, word);
          this.pos += word.length;
          this.col += word.length;
          this.atStatementStart = false;
          continue;
        }
      }

      // Identifiers and keywords (including $ prefix for string vars)
      if (this.isAlpha(ch) || ch === '$' || ch === '_') {
        this.readIdentifierOrKeyword();
        this.atStatementStart = false;
        continue;
      }

      // Operators and punctuation
      this.atStatementStart = false;
      switch (ch) {
        case '+':
          if (this.peek(1) === '=') {
            this.addToken(TokenType.PlusEqual, '+=');
            this.advance(); this.advance();
          } else {
            this.addToken(TokenType.Plus, '+'); this.advance();
          }
          break;
        case '-':
          if (this.peek(1) === '=') {
            this.addToken(TokenType.MinusEqual, '-=');
            this.advance(); this.advance();
          } else {
            this.addToken(TokenType.Minus, '-'); this.advance();
          }
          break;
        case '*': this.addToken(TokenType.Star, '*'); this.advance(); break;
        case '/': this.addToken(TokenType.Slash, '/'); this.advance(); break;
        case '(': this.addToken(TokenType.LeftParen, '('); this.advance(); break;
        case ')': this.addToken(TokenType.RightParen, ')'); this.advance(); break;
        case '[': this.addToken(TokenType.LeftBracket, '['); this.advance(); break;
        case ']': this.addToken(TokenType.RightBracket, ']'); this.advance(); break;
        case ',': this.addToken(TokenType.Comma, ','); this.advance(); break;
        case '.': this.addToken(TokenType.Dot, '.'); this.advance(); break;
        case ':': this.addToken(TokenType.Colon, ':'); this.advance(); break;
        case '&':
          this.addToken(TokenType.Ampersand, '&');
          this.advance();
          this.atStatementStart = true;
          break;
        case '=':
          if (this.peek(1) === '>') {
            this.addToken(TokenType.GreaterEqual, '=>');
            this.advance(); this.advance();
          } else if (this.peek(1) === '<') {
            this.addToken(TokenType.LessEqual, '=<');
            this.advance(); this.advance();
          } else {
            this.addToken(TokenType.Equal, '=');
            this.advance();
          }
          break;
        case '<':
          if (this.peek(1) === '>') {
            this.addToken(TokenType.NotEqual, '<>');
            this.advance(); this.advance();
          } else if (this.peek(1) === '=') {
            this.addToken(TokenType.LessEqual, '<=');
            this.advance(); this.advance();
          } else {
            this.addToken(TokenType.Less, '<');
            this.advance();
          }
          break;
        case '>':
          if (this.peek(1) === '=') {
            this.addToken(TokenType.GreaterEqual, '>=');
            this.advance(); this.advance();
          } else {
            this.addToken(TokenType.Greater, '>');
            this.advance();
          }
          break;
        case '!':
          // ! can be not-equal operator when followed by an identifier/value
          // or a comment when followed by space/end-of-line
          if (this.pos + 1 < this.source.length) {
            const next = this.source[this.pos + 1];
            if (this.isAlpha(next) || next === '$' || next === '(' || next === "'" || next === '"' || next === '{' || this.isDigit(next)) {
              this.addToken(TokenType.NotEqual, '!');
              this.advance();
              break;
            }
          }
          this.readComment();
          break;
        default:
          // Skip unknown characters
          this.advance();
          break;
      }
    }

    this.addToken(TokenType.EOF, '');
    return this.tokens;
  }

  private skipSpaces(): void {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === ' ' || ch === '\t') {
        this.advance();
      } else {
        break;
      }
    }
  }

  private advance(): void {
    if (this.pos < this.source.length) {
      if (this.source[this.pos] === '\n') {
        this.line++;
        this.col = 1;
      } else {
        this.col++;
      }
      this.pos++;
    }
  }

  private peek(offset: number): string | undefined {
    const idx = this.pos + offset;
    return idx < this.source.length ? this.source[idx] : undefined;
  }

  private addToken(type: TokenType, value: string): void {
    this.tokens.push({ type, value, line: this.line, col: this.col });
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isAlpha(ch: string): boolean {
    const code = ch.charCodeAt(0);
    return (ch >= 'a' && ch <= 'z') ||
           (ch >= 'A' && ch <= 'Z') ||
           ch === '_' ||
           code >= 0x0400; // Cyrillic block and beyond — QSP supports Cyrillic identifiers
  }

  private isAlphaNum(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }

  private isLineContinuation(): boolean {
    // _ followed by optional spaces then newline or EOF
    let i = this.pos + 1;
    while (i < this.source.length && (this.source[i] === ' ' || this.source[i] === '\t')) i++;
    return i >= this.source.length || this.source[i] === '\n' || this.source[i] === '\r';
  }

  private skipLineContinuation(): void {
    this.advance(); // skip _
    while (this.pos < this.source.length && (this.source[this.pos] === ' ' || this.source[this.pos] === '\t')) {
      this.advance();
    }
    if (this.pos < this.source.length && this.source[this.pos] === '\r') this.advance();
    if (this.pos < this.source.length && this.source[this.pos] === '\n') this.advance();
  }

  private readLabel(): void {
    this.advance(); // skip :
    const start = this.pos;
    // Label names may start with ! (e.g. :!loop) — read until non-alphanumeric/non-!
    while (this.pos < this.source.length) {
      const c = this.source[this.pos];
      if (c === '!' || this.isAlphaNum(c)) {
        this.advance();
      } else {
        break;
      }
    }
    const name = this.source.slice(start, this.pos);
    this.addToken(TokenType.Label, name);
    this.atStatementStart = false;
  }

  private readComment(): void {
    const start = this.pos;
    while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
      this.advance();
    }
    this.addToken(TokenType.Comment, this.source.slice(start, this.pos));
  }

  private readQuotedString(quote: string): void {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // skip opening quote
    let value = '';
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === quote) {
        // Doubled quote = escaped
        if (this.peek(1) === quote) {
          value += quote;
          this.advance();
          this.advance();
        } else {
          this.advance(); // skip closing quote
          break;
        }
      } else {
        value += ch;
        this.advance();
      }
    }
    this.tokens.push({ type: TokenType.String, value, line: startLine, col: startCol });
  }

  private readBraceString(): void {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // skip {
    let value = '';
    let depth = 1;
    while (this.pos < this.source.length && depth > 0) {
      const ch = this.source[this.pos];
      if (ch === '{') {
        depth++;
        value += ch;
      } else if (ch === '}') {
        depth--;
        if (depth > 0) value += ch;
      } else {
        value += ch;
      }
      this.advance();
    }
    this.tokens.push({ type: TokenType.String, value, line: startLine, col: startCol });
  }

  private readNumber(): void {
    const start = this.pos;
    while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
      this.advance();
    }
    // Check for decimal point
    if (this.pos < this.source.length && this.source[this.pos] === '.' &&
        this.pos + 1 < this.source.length && this.isDigit(this.source[this.pos + 1])) {
      this.advance(); // skip .
      while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
        this.advance();
      }
    }
    this.addToken(TokenType.Number, this.source.slice(start, this.pos));
  }

  private peekStarKeyword(): string | null {
    // Try to match *P, *PL, *NL, *CLR, *CLEAR
    const rest = this.source.slice(this.pos + 1);
    const match = rest.match(/^(CLEAR|CLR|PL|NL|P)\b/i);
    if (match) {
      return '*' + match[1].toUpperCase();
    }
    return null;
  }

  private readIdentifierOrKeyword(): void {
    const start = this.pos;

    // Handle $ prefix for string variables/functions
    if (this.source[this.pos] === '$') {
      this.advance();
    }

    while (this.pos < this.source.length && this.isAlphaNum(this.source[this.pos])) {
      this.advance();
    }

    const raw = this.source.slice(start, this.pos);
    const upper = raw.toUpperCase();

    // Check for two-word keywords: ADD OBJ, DEL OBJ
    if (upper === 'ADD' || upper === 'DEL') {
      const saved = this.pos;
      this.skipSpaces();
      if (this.pos < this.source.length) {
        const nextStart = this.pos;
        while (this.pos < this.source.length && this.isAlphaNum(this.source[this.pos])) {
          this.advance();
        }
        const nextWord = this.source.slice(nextStart, this.pos).toUpperCase();
        if (nextWord === 'OBJ') {
          this.addToken(TokenType.Keyword, upper + ' OBJ');
          return;
        }
      }
      // Not "ADD OBJ" / "DEL OBJ", restore position
      this.pos = saved;
    }

    // Check for CLOSE ALL
    if (upper === 'CLOSE') {
      const saved = this.pos;
      this.skipSpaces();
      if (this.pos < this.source.length) {
        const nextStart = this.pos;
        while (this.pos < this.source.length && this.isAlphaNum(this.source[this.pos])) {
          this.advance();
        }
        const nextWord = this.source.slice(nextStart, this.pos).toUpperCase();
        if (nextWord === 'ALL') {
          this.addToken(TokenType.Keyword, 'CLOSE ALL');
          return;
        }
      }
      this.pos = saved;
    }

    if (KEYWORDS.has(upper)) {
      this.addToken(TokenType.Keyword, upper);
    } else {
      this.addToken(TokenType.Identifier, raw);
    }
  }

  /** Consume a quoted string literal without emitting a token (used for block comments) */
  private skipQuotedString(quote: string): void {
    this.advance(); // skip opening quote
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === quote) {
        if (this.peek(1) === quote) {
          this.advance(); this.advance(); // doubled quote — skip both
        } else {
          this.advance(); // skip closing quote
          break;
        }
      } else {
        this.advance();
      }
    }
  }

  /** Consume a brace string literal without emitting a token (used for block comments) */
  private skipBraceString(): void {
    this.advance(); // skip {
    let depth = 1;
    while (this.pos < this.source.length && depth > 0) {
      const ch = this.source[this.pos];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      this.advance();
    }
  }
}
