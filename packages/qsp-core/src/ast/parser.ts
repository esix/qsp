import { Token, TokenType } from '../lexer/tokens.js';
import { Lexer } from '../lexer/lexer.js';
import type {
  Expr, Stmt, Program, Variable, BinaryOp, Loc,
  IfStmt, ActStmt, LoopStmt,
} from './nodes.js';

/**
 * QSP Recursive Descent Parser
 *
 * Operator precedence (low to high):
 *   OR
 *   AND
 *   NO (unary)
 *   = <> < > <= >=
 *   + - (binary, string concat with +)
 *   * / MOD
 *   - + (unary)
 *   atoms: literals, variables, function calls, parenthesized
 */
export class Parser {
  private tokens: Token[] = [];
  private pos = 0;

  parse(source: string): Program {
    const lexer = new Lexer(source);
    this.tokens = lexer.tokenize();
    this.pos = 0;

    const statements: Stmt[] = [];
    this.skipLineBreaks();

    while (!this.isAtEnd()) {
      const stmts = this.parseStatementLine();
      statements.push(...stmts);
      this.skipLineBreaks();
    }

    return { statements };
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private current(): Token {
    return this.tokens[this.pos];
  }

  private peek(offset = 0): Token {
    return this.tokens[this.pos + offset] ?? this.tokens[this.tokens.length - 1];
  }

  private isAtEnd(): boolean {
    return this.current().type === TokenType.EOF;
  }

  private advance(): Token {
    const t = this.current();
    if (!this.isAtEnd()) this.pos++;
    return t;
  }

  private expect(type: TokenType): Token {
    const t = this.current();
    if (t.type !== type) {
      throw this.error(`Expected ${type}, got ${t.type} ("${t.value}")`);
    }
    return this.advance();
  }

  private match(type: TokenType, value?: string): boolean {
    const t = this.current();
    if (t.type === type && (value === undefined || t.value === value)) {
      return true;
    }
    return false;
  }

  private matchKeyword(value: string): boolean {
    return this.match(TokenType.Keyword, value);
  }

  private consumeIf(type: TokenType, value?: string): Token | null {
    if (this.match(type, value)) return this.advance();
    return null;
  }

  private consumeKeyword(value: string): Token | null {
    if (this.matchKeyword(value)) return this.advance();
    return null;
  }

  private loc(): Loc {
    const t = this.current();
    return { line: t.line, col: t.col };
  }

  private error(msg: string): Error {
    const t = this.current();
    return new Error(`Parse error at line ${t.line}, col ${t.col}: ${msg}`);
  }

  private skipLineBreaks(): void {
    while (this.match(TokenType.LineBreak)) this.advance();
  }

  /** Check if current token is at a statement boundary (line end, &, EOF, or block-ending keyword) */
  private isStatementEnd(): boolean {
    const t = this.current();
    return t.type === TokenType.LineBreak ||
           t.type === TokenType.EOF ||
           t.type === TokenType.Ampersand;
  }

  private isBlockEnd(): boolean {
    if (this.isAtEnd()) return true;
    const t = this.current();
    if (t.type === TokenType.Keyword) {
      const v = t.value;
      return v === 'END' || v === 'ELSE' || v === 'ELSEIF';
    }
    return false;
  }

  // ─── Statement parsing ───────────────────────────────────────

  /**
   * Parse one logical line of statements (separated by &).
   * A logical line ends at a LineBreak or EOF.
   */
  private parseStatementLine(): Stmt[] {
    const stmts: Stmt[] = [];

    while (!this.isAtEnd() && !this.match(TokenType.LineBreak)) {
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);

      // Consume & separator
      if (this.consumeIf(TokenType.Ampersand)) {
        continue;
      }
      break;
    }

    return stmts;
  }

  private parseStatement(): Stmt | null {
    const t = this.current();

    // Comment
    if (t.type === TokenType.Comment) {
      this.advance();
      return { kind: 'CommentStmt', text: t.value, loc: { line: t.line, col: t.col } };
    }

    // Label
    if (t.type === TokenType.Label) {
      this.advance();
      return { kind: 'LabelStmt', name: t.value, loc: { line: t.line, col: t.col } };
    }

    // Keyword-led statements
    if (t.type === TokenType.Keyword) {
      return this.parseKeywordStatement();
    }

    // Identifier — could be assignment or expression statement
    if (t.type === TokenType.Identifier) {
      return this.parseIdentifierStatement();
    }

    // String literal at statement start = implicit print
    if (t.type === TokenType.String || t.type === TokenType.Number) {
      return this.parseExpressionStatement();
    }

    // Parenthesized expression as statement
    if (t.type === TokenType.LeftParen) {
      return this.parseExpressionStatement();
    }

    // Skip unknown
    this.advance();
    return null;
  }

  private parseKeywordStatement(): Stmt {
    const kw = this.current().value;
    const l = this.loc();

    switch (kw) {
      case 'IF': return this.parseIf();
      case 'ACT': return this.parseAct();
      case 'LOOP': return this.parseLoop();

      case 'SET':
      case 'LET': {
        this.advance();
        return this.parseAssignment();
      }

      case 'LOCAL': return this.parseLocal();

      case 'GOTO':
      case 'GT': {
        this.advance();
        const dest = this.parseExpression();
        const args = this.parseCommaArgs();
        return { kind: 'GotoStmt', destination: dest, args, extended: false, loc: l };
      }
      case 'XGOTO':
      case 'XGT': {
        this.advance();
        const dest = this.parseExpression();
        const args = this.parseCommaArgs();
        return { kind: 'GotoStmt', destination: dest, args, extended: true, loc: l };
      }

      case 'GOSUB':
      case 'GS': {
        this.advance();
        const dest = this.parseExpression();
        const args = this.parseCommaArgs();
        return { kind: 'GosubStmt', destination: dest, args, loc: l };
      }

      case 'JUMP': {
        this.advance();
        return { kind: 'JumpStmt', label: this.parseExpression(), loc: l };
      }

      case 'EXIT': {
        this.advance();
        return { kind: 'ExitStmt', loc: l };
      }

      // Print statements — expression is optional (bare *NL inserts a newline with empty string)
      case 'P':     { this.advance(); return { kind: 'PrintStmt', target: 'stat', mode: 'p',  expr: this.isStatementEnd() ? { kind: 'StringLiteral', value: '', loc: l } : this.parseExpression(), loc: l }; }
      case 'PL':    { this.advance(); return { kind: 'PrintStmt', target: 'stat', mode: 'pl', expr: this.isStatementEnd() ? { kind: 'StringLiteral', value: '', loc: l } : this.parseExpression(), loc: l }; }
      case 'NL':    { this.advance(); return { kind: 'PrintStmt', target: 'stat', mode: 'nl', expr: this.isStatementEnd() ? { kind: 'StringLiteral', value: '', loc: l } : this.parseExpression(), loc: l }; }
      case '*P':    { this.advance(); return { kind: 'PrintStmt', target: 'main', mode: 'p',  expr: this.isStatementEnd() ? { kind: 'StringLiteral', value: '', loc: l } : this.parseExpression(), loc: l }; }
      case '*PL':   { this.advance(); return { kind: 'PrintStmt', target: 'main', mode: 'pl', expr: this.isStatementEnd() ? { kind: 'StringLiteral', value: '', loc: l } : this.parseExpression(), loc: l }; }
      case '*NL':   { this.advance(); return { kind: 'PrintStmt', target: 'main', mode: 'nl', expr: this.isStatementEnd() ? { kind: 'StringLiteral', value: '', loc: l } : this.parseExpression(), loc: l }; }

      // Clear
      case 'CLEAR':
      case 'CLR':    { this.advance(); return { kind: 'ClearStmt', target: 'stat', loc: l }; }
      case '*CLEAR':
      case '*CLR':   { this.advance(); return { kind: 'ClearStmt', target: 'main', loc: l }; }
      case 'CLA':    { this.advance(); return { kind: 'ClaStmt', loc: l }; }
      case 'CLS':    { this.advance(); return { kind: 'ClsStmt', loc: l }; }
      case 'DEL ACT':
      case 'DELACT': {
        this.advance();
        return { kind: 'DelActStmt', name: this.parseExpression(), loc: l };
      }

      // Objects
      case 'ADD OBJ':
      case 'ADDOBJ': {
        this.advance();
        const name = this.parseExpression();
        let image: Expr | undefined;
        if (this.consumeIf(TokenType.Comma)) image = this.parseExpression();
        return { kind: 'AddObjStmt', name, image, loc: l };
      }
      case 'DEL OBJ':
      case 'DELOBJ': {
        this.advance();
        return { kind: 'DelObjStmt', name: this.parseExpression(), loc: l };
      }
      case 'KILLOBJ': {
        this.advance();
        let index: Expr | undefined;
        if (!this.isStatementEnd()) index = this.parseExpression();
        return { kind: 'KillObjStmt', index, loc: l };
      }

      // Variables
      case 'KILLVAR': {
        this.advance();
        let name: Expr | undefined;
        let index: Expr | undefined;
        if (!this.isStatementEnd()) {
          name = this.parseExpression();
          if (this.consumeIf(TokenType.Comma)) index = this.parseExpression();
        }
        return { kind: 'KillVarStmt', name, index, loc: l };
      }
      case 'KILLALL': { this.advance(); return { kind: 'KillAllStmt', loc: l }; }
      case 'COPYARR': {
        this.advance();
        const dst = this.parseExpression();
        this.expect(TokenType.Comma);
        const src = this.parseExpression();
        return { kind: 'CopyArrStmt', dst, src, loc: l };
      }

      // Display
      case 'MSG':     { this.advance(); return { kind: 'MsgStmt', expr: this.parseExpression(), loc: l }; }
      case 'VIEW':    { this.advance(); return { kind: 'ViewStmt', path: this.parseExpression(), loc: l }; }
      case 'WAIT':    { this.advance(); return { kind: 'WaitStmt', ms: this.parseExpression(), loc: l }; }
      case 'SETTIMER': { this.advance(); return { kind: 'SetTimerStmt', ms: this.parseExpression(), loc: l }; }
      case 'REFINT':  { this.advance(); return { kind: 'RefIntStmt', loc: l }; }
      case 'UNSELECT':
      case 'UNSEL':   { this.advance(); return { kind: 'UnselectStmt', loc: l }; }
      case 'MENU':    { this.advance(); return { kind: 'MenuStmt', name: this.parseExpression(), loc: l }; }

      // Show/hide windows
      case 'SHOWACTS':  { this.advance(); return { kind: 'ShowWindowStmt', window: 'acts', value: this.parseExpression(), loc: l }; }
      case 'SHOWOBJS':  { this.advance(); return { kind: 'ShowWindowStmt', window: 'objs', value: this.parseExpression(), loc: l }; }
      case 'SHOWSTAT':  { this.advance(); return { kind: 'ShowWindowStmt', window: 'stat', value: this.parseExpression(), loc: l }; }
      case 'SHOWINPUT': { this.advance(); return { kind: 'ShowWindowStmt', window: 'input', value: this.parseExpression(), loc: l }; }

      // Audio
      case 'PLAY': {
        this.advance();
        const file = this.parseExpression();
        let volume: Expr | undefined;
        if (this.consumeIf(TokenType.Comma)) volume = this.parseExpression();
        return { kind: 'PlayStmt', file, volume, loc: l };
      }
      case 'CLOSE': {
        this.advance();
        // CLOSE ALL was already tokenized as one keyword
        return { kind: 'CloseStmt', all: false, file: this.isStatementEnd() ? undefined : this.parseExpression(), loc: l };
      }
      case 'CLOSE ALL': {
        this.advance();
        return { kind: 'CloseStmt', all: true, loc: l };
      }
      case 'SETVOL': {
        this.advance();
        return { kind: 'SetVolStmt', volume: this.parseExpression(), loc: l };
      }

      // Execution
      case 'DYNAMIC': {
        this.advance();
        const code = this.parseExpression();
        const args = this.parseCommaArgs();
        return { kind: 'DynamicStmt', code, args, loc: l };
      }
      case 'EXEC': {
        this.advance();
        return { kind: 'ExecStmt', command: this.parseExpression(), loc: l };
      }

      // Input
      case 'CMDCLEAR':
      case 'CMDCLR': { this.advance(); return { kind: 'CmdClearStmt', loc: l }; }

      // File operations
      case 'OPENQST':  { this.advance(); return { kind: 'OpenQstStmt', file: this.parseExpression(), loc: l }; }
      case 'OPENGAME': {
        this.advance();
        let file: Expr | undefined;
        if (!this.isStatementEnd()) file = this.parseExpression();
        return { kind: 'OpenGameStmt', file, loc: l };
      }
      case 'SAVEGAME': {
        this.advance();
        let file: Expr | undefined;
        if (!this.isStatementEnd()) file = this.parseExpression();
        return { kind: 'SaveGameStmt', file, loc: l };
      }
      case 'INCLIB':
      case 'ADDQST':  { this.advance(); return { kind: 'IncLibStmt', file: this.parseExpression(), loc: l }; }
      case 'FREELIB': { this.advance(); return { kind: 'FreeLibStmt', loc: l }; }

      default: {
        // Keyword used as identifier (e.g. USEHTML = 1, FSIZE = 14)
        // or as a function call expression
        return this.parseIdentifierStatement();
      }
    }
  }

  // ─── IF ──────────────────────────────────────────────────────

  private parseIf(): IfStmt {
    const l = this.loc();
    this.advance(); // consume IF

    const condition = this.parseExpression();
    this.expect(TokenType.Colon);

    // Determine: single-line IF or multi-line IF..END
    // Single-line: rest of statements on same line (no LineBreak before END)
    // Multi-line: has LineBreak, ends with END

    const isMultiLine = this.isMultiLineBlock();

    if (!isMultiLine) {
      // Single-line IF: collect statements until end of line / ELSE
      const body = this.parseSingleLineBodyUntilElse();
      const branches: IfStmt['branches'] = [{ condition, body }];
      let elseBranch: Stmt[] | undefined;
      if (this.consumeKeyword('ELSE')) {
        elseBranch = this.parseSingleLineBody();
      }
      return { kind: 'IfStmt', branches, elseBranch, loc: l };
    }

    // Multi-line IF
    const branches: IfStmt['branches'] = [];
    const body = this.parseBlockBody(['ELSEIF', 'ELSE', 'END']);
    branches.push({ condition, body });

    while (this.consumeKeyword('ELSEIF')) {
      const elseifCond = this.parseExpression();
      this.expect(TokenType.Colon);
      const elseifBody = this.parseBlockBody(['ELSEIF', 'ELSE', 'END']);
      branches.push({ condition: elseifCond, body: elseifBody });
    }

    let elseBranch: Stmt[] | undefined;
    if (this.consumeKeyword('ELSE')) {
      elseBranch = this.parseBlockBody(['END']);
    }

    this.consumeKeyword('END');
    return { kind: 'IfStmt', branches, elseBranch, loc: l };
  }

  // ─── ACT ─────────────────────────────────────────────────────

  private parseAct(): ActStmt {
    const l = this.loc();
    this.advance(); // consume ACT

    const name = this.parseExpression();
    let image: Expr | undefined;
    if (this.consumeIf(TokenType.Comma)) {
      image = this.parseExpression();
    }
    this.expect(TokenType.Colon);

    const isMultiLine = this.isMultiLineBlock();
    if (!isMultiLine) {
      const body = this.parseSingleLineBody();
      return { kind: 'ActStmt', name, image, body, loc: l };
    }

    const body = this.parseBlockBody(['END']);
    this.consumeKeyword('END');
    return { kind: 'ActStmt', name, image, body, loc: l };
  }

  // ─── LOOP ────────────────────────────────────────────────────

  private parseLoop(): LoopStmt {
    const l = this.loc();
    this.advance(); // consume LOOP

    // LOOP [init] WHILE cond [STEP step]: body END
    let init: Stmt | undefined;

    if (!this.matchKeyword('WHILE')) {
      init = this.parseStatement() ?? undefined;
    }

    this.consumeKeyword('WHILE');
    const condition = this.parseExpression();

    let step: Stmt | undefined;
    if (this.consumeKeyword('STEP')) {
      step = this.parseStatement() ?? undefined;
    }

    this.expect(TokenType.Colon);

    const isMultiLine = this.isMultiLineBlock();
    if (!isMultiLine) {
      const body = this.parseSingleLineBody();
      return { kind: 'LoopStmt', init, condition, step, body, loc: l };
    }

    const body = this.parseBlockBody(['END']);
    this.consumeKeyword('END');
    return { kind: 'LoopStmt', init, condition, step, body, loc: l };
  }

  // ─── LOCAL ───────────────────────────────────────────────────

  private parseLocal(): Stmt {
    const l = this.loc();
    this.advance(); // consume LOCAL

    const variable = this.parseVariable();
    let value: Expr | undefined;
    if (this.consumeIf(TokenType.Equal)) {
      value = this.parseExpression();
    }
    return { kind: 'LocalStmt', variable, value, loc: l };
  }

  // ─── Block helpers ───────────────────────────────────────────

  /**
   * Check if the current position starts a multi-line block.
   * A multi-line block has a LineBreak before any END/ELSE/ELSEIF.
   */
  private isMultiLineBlock(): boolean {
    // Multi-line: the colon is immediately followed by a LineBreak (body starts on next line)
    // Single-line: there are statement tokens on the same line after the colon
    return this.match(TokenType.LineBreak);
  }

  /** Parse statements until a line break or EOF (single-line block body) */
  private parseSingleLineBody(): Stmt[] {
    const stmts: Stmt[] = [];
    while (!this.isAtEnd() && !this.match(TokenType.LineBreak)) {
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
      if (!this.consumeIf(TokenType.Ampersand)) break;
    }
    return stmts;
  }

  /** Like parseSingleLineBody but also stops before ELSE keyword */
  private parseSingleLineBodyUntilElse(): Stmt[] {
    const stmts: Stmt[] = [];
    while (!this.isAtEnd() && !this.match(TokenType.LineBreak) && !this.matchKeyword('ELSE')) {
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
      if (!this.consumeIf(TokenType.Ampersand)) break;
    }
    return stmts;
  }

  /** Parse statements until one of the ending keywords is found */
  private parseBlockBody(endKeywords: string[]): Stmt[] {
    this.skipLineBreaks();
    const stmts: Stmt[] = [];

    while (!this.isAtEnd()) {
      // Check for ending keyword
      if (this.current().type === TokenType.Keyword && endKeywords.includes(this.current().value)) {
        break;
      }

      const lineStmts = this.parseStatementLine();
      stmts.push(...lineStmts);
      this.skipLineBreaks();
    }

    return stmts;
  }

  // ─── Assignment / identifier statements ──────────────────────

  private parseIdentifierStatement(): Stmt {
    // Could be:
    //   variable = expr         (assignment)
    //   variable[idx] = expr    (array assignment)
    //   KEYWORD expr            (keyword used as identifier, e.g. USEHTML = 1)
    //   expr                    (expression statement)

    const l = this.loc();

    // Try to parse as assignment: look ahead for = after identifier/array
    if (this.isAssignment()) {
      return this.parseAssignment();
    }

    // Expression statement (bare string = implicit print, function call, etc.)
    return this.parseExpressionStatement();
  }

  private isAssignment(): boolean {
    // Peek ahead: identifier (or keyword-as-identifier) optionally followed by [expr], then =
    let i = this.pos;
    const t = this.tokens[i];
    if (t.type !== TokenType.Identifier && t.type !== TokenType.Keyword) return false;
    i++;

    // Skip array index
    if (i < this.tokens.length && this.tokens[i].type === TokenType.LeftBracket) {
      let depth = 1;
      i++;
      while (i < this.tokens.length && depth > 0) {
        if (this.tokens[i].type === TokenType.LeftBracket) depth++;
        else if (this.tokens[i].type === TokenType.RightBracket) depth--;
        i++;
      }
    }

    // Check for = , +=, -=
    if (i < this.tokens.length) {
      const tt = this.tokens[i].type;
      if (tt === TokenType.Equal || tt === TokenType.PlusEqual || tt === TokenType.MinusEqual) {
        return true;
      }
    }

    return false;
  }

  private parseAssignment(): Stmt {
    const l = this.loc();
    const variable = this.parseVariable();

    // Handle +=, -= (desugar to var = var +/- expr)
    const op = this.current();
    if (op.type === TokenType.PlusEqual || op.type === TokenType.MinusEqual) {
      this.advance();
      const rhs = this.parseExpression();
      const binOp: BinaryOp = op.type === TokenType.PlusEqual ? '+' : '-';
      const varRef: Expr = { kind: 'Variable', name: variable.name, index: variable.index, loc: l };
      const value: Expr = { kind: 'BinaryExpr', op: binOp, left: varRef, right: rhs, loc: l };
      return { kind: 'AssignStmt', variable, value, loc: l };
    }

    this.expect(TokenType.Equal);
    const value = this.parseExpression();
    return { kind: 'AssignStmt', variable, value, loc: l };
  }

  private parseVariable(): Variable {
    const l = this.loc();
    const t = this.advance();
    const name = t.value;

    let index: Expr | undefined;
    if (this.consumeIf(TokenType.LeftBracket)) {
      if (this.match(TokenType.RightBracket)) {
        // Empty brackets: var[] = value → append to next free index
        // Desugar to var[ARRSIZE('name')] = value
        index = { kind: 'FunctionCall', name: 'ARRSIZE', args: [
          { kind: 'StringLiteral', value: name, loc: l }
        ], loc: l };
      } else {
        index = this.parseExpression();
      }
      this.expect(TokenType.RightBracket);
    }

    return { kind: 'Variable', name, index, loc: l };
  }

  private parseExpressionStatement(): Stmt {
    const l = this.loc();
    const expr = this.parseExpression();
    return { kind: 'ExprStmt', expr, loc: l };
  }

  /** Parse remaining comma-separated args (after the first arg is already parsed) */
  private parseCommaArgs(): Expr[] {
    const args: Expr[] = [];
    while (this.consumeIf(TokenType.Comma)) {
      args.push(this.parseExpression());
    }
    return args;
  }

  // ─── Expression parsing (precedence climbing) ────────────────

  private parseExpression(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.matchKeyword('OR')) {
      this.advance();
      const right = this.parseAnd();
      left = { kind: 'BinaryExpr', op: 'OR', left, right, loc: left.loc };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.matchKeyword('AND')) {
      this.advance();
      const right = this.parseNot();
      left = { kind: 'BinaryExpr', op: 'AND', left, right, loc: left.loc };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.matchKeyword('NO')) {
      const l = this.loc();
      this.advance();
      const operand = this.parseNot();
      return { kind: 'UnaryExpr', op: 'NO', operand, loc: l };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    let left = this.parseAddition();

    while (true) {
      let op: BinaryOp | null = null;
      const t = this.current();

      if (t.type === TokenType.Equal) op = '=';
      else if (t.type === TokenType.NotEqual) op = '<>';
      else if (t.type === TokenType.Less) op = '<';
      else if (t.type === TokenType.Greater) op = '>';
      else if (t.type === TokenType.LessEqual) op = '<=';
      else if (t.type === TokenType.GreaterEqual) op = '>=';
      else break;

      this.advance();
      const right = this.parseAddition();
      left = { kind: 'BinaryExpr', op, left, right, loc: left.loc };
    }

    return left;
  }

  private parseAddition(): Expr {
    let left = this.parseMultiplication();

    while (true) {
      const t = this.current();
      let op: BinaryOp | null = null;

      if (t.type === TokenType.Plus) op = '+';
      else if (t.type === TokenType.Minus) op = '-';
      else break;

      this.advance();
      const right = this.parseMultiplication();
      left = { kind: 'BinaryExpr', op, left, right, loc: left.loc };
    }

    return left;
  }

  private parseMultiplication(): Expr {
    let left = this.parseUnary();

    while (true) {
      const t = this.current();
      let op: BinaryOp | null = null;

      if (t.type === TokenType.Star) op = '*';
      else if (t.type === TokenType.Slash) op = '/';
      else if (t.type === TokenType.Keyword && t.value === 'MOD') op = 'MOD';
      else break;

      this.advance();
      const right = this.parseUnary();
      left = { kind: 'BinaryExpr', op, left, right, loc: left.loc };
    }

    return left;
  }

  private parseUnary(): Expr {
    const t = this.current();
    if (t.type === TokenType.Minus) {
      const l = this.loc();
      this.advance();
      return { kind: 'UnaryExpr', op: '-', operand: this.parseUnary(), loc: l };
    }
    if (t.type === TokenType.Plus) {
      const l = this.loc();
      this.advance();
      return { kind: 'UnaryExpr', op: '+', operand: this.parseUnary(), loc: l };
    }
    return this.parseAtom();
  }

  private parseAtom(): Expr {
    const t = this.current();
    const l = this.loc();

    // Number literal
    if (t.type === TokenType.Number) {
      this.advance();
      return { kind: 'NumberLiteral', value: parseFloat(t.value), loc: l };
    }

    // String literal
    if (t.type === TokenType.String) {
      this.advance();
      return { kind: 'StringLiteral', value: t.value, loc: l };
    }

    // Parenthesized expression
    if (t.type === TokenType.LeftParen) {
      this.advance();
      const expr = this.parseExpression();
      this.expect(TokenType.RightParen);
      return { kind: 'Parenthesized', expr, loc: l };
    }

    // Identifier or keyword-as-identifier: variable, array, or function call
    if (t.type === TokenType.Identifier || t.type === TokenType.Keyword) {
      return this.parseIdentifierExpr();
    }

    throw this.error(`Unexpected token: ${t.type} ("${t.value}")`);
  }

  /** Parse identifier expression: variable, array access, or function call */
  private parseIdentifierExpr(): Expr {
    const l = this.loc();
    const t = this.advance();
    const name = t.value;

    // Function call: name(args)
    if (this.match(TokenType.LeftParen)) {
      this.advance();
      const args: Expr[] = [];
      if (!this.match(TokenType.RightParen)) {
        args.push(this.parseExpression());
        while (this.consumeIf(TokenType.Comma)) {
          args.push(this.parseExpression());
        }
      }
      this.expect(TokenType.RightParen);
      return { kind: 'FunctionCall', name, args, loc: l };
    }

    // Array access: name[expr]
    if (this.match(TokenType.LeftBracket)) {
      this.advance();
      const index = this.parseExpression();
      this.expect(TokenType.RightBracket);
      return { kind: 'Variable', name, index, loc: l };
    }

    // Function call without parentheses: keyword followed by an expression starter.
    // e.g. obj 'name', loc 'name', len 'str', rand 1,6
    // Only applies to Keyword tokens (not plain identifiers which could be variables).
    // IMPORTANT: parse args at comparison level (not full expression) so that
    // `obj 'x' and cond` doesn't swallow `and cond` as part of the OBJ argument.
    if (t.type === TokenType.Keyword && this.canStartExpression()) {
      const args: Expr[] = [];
      args.push(this.parseComparison());
      while (this.consumeIf(TokenType.Comma)) {
        args.push(this.parseComparison());
      }
      return { kind: 'FunctionCall', name, args, loc: l };
    }

    // Plain variable
    return { kind: 'Variable', name, loc: l };
  }

  /** True when the current token can begin an expression (used for paren-less function calls) */
  private canStartExpression(): boolean {
    const t = this.current();
    if (t.type === TokenType.String) return true;
    if (t.type === TokenType.Number) return true;
    if (t.type === TokenType.LeftParen) return true;
    if (t.type === TokenType.Identifier) return true;
    // Unary minus/plus
    if (t.type === TokenType.Minus || t.type === TokenType.Plus) return true;
    // Keyword that is itself a function or unary operator (NOT/NO, $-prefixed functions)
    if (t.type === TokenType.Keyword) {
      const u = t.value.toUpperCase();
      return u === 'NO' || u === 'NOT' || FUNCTION_KEYWORDS.has(u);
    }
    return false;
  }
}

/** Keywords that can appear as function names in paren-less calls */
const FUNCTION_KEYWORDS = new Set([
  'OBJ', 'LOC', 'LEN', 'RAND', 'RND', 'MAX', 'MIN', 'VAL', 'RGB',
  'INSTR', 'ISNUM', 'ISPLAY', 'STRPOS', 'STRCOMP', 'ARRSIZE', 'ARRPOS',
  'IIF', '$IIF', 'FUNC', '$FUNC', 'DYNEVAL', '$DYNEVAL',
  'STR', '$STR', 'LCASE', '$LCASE', 'UCASE', '$UCASE', 'TRIM', '$TRIM',
  'MID', '$MID', 'REPLACE', '$REPLACE', 'STRFIND', '$STRFIND',
  '$INPUT', '$GETOBJ', '$DESC',
]);
