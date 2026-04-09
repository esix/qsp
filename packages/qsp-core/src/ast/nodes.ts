// ─── Source Location ──────────────────────────────────────────────

export interface Loc {
  line: number;
  col: number;
}

// ─── Expressions ─────────────────────────────────────────────────

export type Expr =
  | NumberLiteral
  | StringLiteral
  | UnaryExpr
  | BinaryExpr
  | Variable
  | FunctionCall
  | Parenthesized;

export interface NumberLiteral {
  kind: 'NumberLiteral';
  value: number;
  loc: Loc;
}

export interface StringLiteral {
  kind: 'StringLiteral';
  value: string;
  loc: Loc;
}

export interface UnaryExpr {
  kind: 'UnaryExpr';
  op: 'NO' | '-' | '+';
  operand: Expr;
  loc: Loc;
}

export type BinaryOp =
  | '+' | '-' | '*' | '/' | 'MOD'
  | '=' | '<>' | '<' | '>' | '<=' | '>='
  | 'AND' | 'OR';

export interface BinaryExpr {
  kind: 'BinaryExpr';
  op: BinaryOp;
  left: Expr;
  right: Expr;
  loc: Loc;
}

/** Variable or array element: x, $name, arr[i], $arr[i] */
export interface Variable {
  kind: 'Variable';
  name: string;
  index?: Expr;
  loc: Loc;
}

/** Built-in function call or location-as-function: FUNC('loc', args), LEN($s), RAND(1,10) */
export interface FunctionCall {
  kind: 'FunctionCall';
  name: string;
  args: Expr[];
  loc: Loc;
}

export interface Parenthesized {
  kind: 'Parenthesized';
  expr: Expr;
  loc: Loc;
}

// ─── Statements ──────────────────────────────────────────────────

export type Stmt =
  | AssignStmt
  | PrintStmt
  | IfStmt
  | ActStmt
  | LoopStmt
  | GotoStmt
  | GosubStmt
  | JumpStmt
  | ExitStmt
  | LabelStmt
  | AddObjStmt
  | DelObjStmt
  | KillObjStmt
  | KillVarStmt
  | KillAllStmt
  | CopyArrStmt
  | ClearStmt
  | ClaStmt
  | ClsStmt
  | DelActStmt
  | MsgStmt
  | ViewStmt
  | WaitStmt
  | SetTimerStmt
  | ShowWindowStmt
  | PlayStmt
  | CloseStmt
  | SetVolStmt
  | MenuStmt
  | RefIntStmt
  | UnselectStmt
  | DynamicStmt
  | ExecStmt
  | CmdClearStmt
  | OpenQstStmt
  | OpenGameStmt
  | SaveGameStmt
  | IncLibStmt
  | FreeLibStmt
  | LocalStmt
  | ExprStmt
  | CommentStmt;

export interface AssignStmt {
  kind: 'AssignStmt';
  variable: Variable;
  value: Expr;
  loc: Loc;
}

export interface PrintStmt {
  kind: 'PrintStmt';
  target: 'main' | 'stat';
  mode: 'p' | 'pl' | 'nl';
  expr: Expr;
  loc: Loc;
}

export interface IfStmt {
  kind: 'IfStmt';
  branches: { condition: Expr; body: Stmt[] }[];
  elseBranch?: Stmt[];
  loc: Loc;
}

export interface ActStmt {
  kind: 'ActStmt';
  name: Expr;
  image?: Expr;
  body: Stmt[];
  loc: Loc;
}

export interface LoopStmt {
  kind: 'LoopStmt';
  init?: Stmt;
  condition: Expr;
  step?: Stmt;
  body: Stmt[];
  loc: Loc;
}

export interface GotoStmt {
  kind: 'GotoStmt';
  destination: Expr;
  args: Expr[];
  extended: boolean; // XGOTO vs GOTO
  loc: Loc;
}

export interface GosubStmt {
  kind: 'GosubStmt';
  destination: Expr;
  args: Expr[];
  loc: Loc;
}

export interface JumpStmt {
  kind: 'JumpStmt';
  label: Expr;
  loc: Loc;
}

export interface ExitStmt {
  kind: 'ExitStmt';
  loc: Loc;
}

export interface LabelStmt {
  kind: 'LabelStmt';
  name: string;
  loc: Loc;
}

export interface AddObjStmt {
  kind: 'AddObjStmt';
  name: Expr;
  image?: Expr;
  loc: Loc;
}

export interface DelObjStmt {
  kind: 'DelObjStmt';
  name: Expr;
  loc: Loc;
}

export interface KillObjStmt {
  kind: 'KillObjStmt';
  index?: Expr;
  loc: Loc;
}

export interface KillVarStmt {
  kind: 'KillVarStmt';
  name?: Expr;
  index?: Expr;
  loc: Loc;
}

export interface KillAllStmt {
  kind: 'KillAllStmt';
  loc: Loc;
}

export interface CopyArrStmt {
  kind: 'CopyArrStmt';
  dst: Expr;
  src: Expr;
  loc: Loc;
}

export interface ClearStmt {
  kind: 'ClearStmt';
  target: 'main' | 'stat';
  loc: Loc;
}

export interface ClaStmt {
  kind: 'ClaStmt';
  loc: Loc;
}

export interface ClsStmt {
  kind: 'ClsStmt';
  loc: Loc;
}

export interface DelActStmt {
  kind: 'DelActStmt';
  name: Expr;
  loc: Loc;
}

export interface MsgStmt {
  kind: 'MsgStmt';
  expr: Expr;
  loc: Loc;
}

export interface ViewStmt {
  kind: 'ViewStmt';
  path: Expr;
  loc: Loc;
}

export interface WaitStmt {
  kind: 'WaitStmt';
  ms: Expr;
  loc: Loc;
}

export interface SetTimerStmt {
  kind: 'SetTimerStmt';
  ms: Expr;
  loc: Loc;
}

export interface ShowWindowStmt {
  kind: 'ShowWindowStmt';
  window: 'acts' | 'objs' | 'stat' | 'input';
  value: Expr;
  loc: Loc;
}

export interface PlayStmt {
  kind: 'PlayStmt';
  file: Expr;
  volume?: Expr;
  loc: Loc;
}

export interface CloseStmt {
  kind: 'CloseStmt';
  file?: Expr;
  all: boolean;
  loc: Loc;
}

export interface SetVolStmt {
  kind: 'SetVolStmt';
  volume: Expr;
  loc: Loc;
}

export interface MenuStmt {
  kind: 'MenuStmt';
  name: Expr;
  loc: Loc;
}

export interface RefIntStmt {
  kind: 'RefIntStmt';
  loc: Loc;
}

export interface UnselectStmt {
  kind: 'UnselectStmt';
  loc: Loc;
}

export interface DynamicStmt {
  kind: 'DynamicStmt';
  code: Expr;
  args: Expr[];
  loc: Loc;
}

export interface ExecStmt {
  kind: 'ExecStmt';
  command: Expr;
  loc: Loc;
}

export interface CmdClearStmt {
  kind: 'CmdClearStmt';
  loc: Loc;
}

export interface OpenQstStmt {
  kind: 'OpenQstStmt';
  file: Expr;
  loc: Loc;
}

export interface OpenGameStmt {
  kind: 'OpenGameStmt';
  file?: Expr;
  loc: Loc;
}

export interface SaveGameStmt {
  kind: 'SaveGameStmt';
  file?: Expr;
  loc: Loc;
}

export interface IncLibStmt {
  kind: 'IncLibStmt';
  file: Expr;
  loc: Loc;
}

export interface FreeLibStmt {
  kind: 'FreeLibStmt';
  loc: Loc;
}

export interface LocalStmt {
  kind: 'LocalStmt';
  variable: Variable;
  value?: Expr;
  loc: Loc;
}

/** An expression used as a statement (e.g. bare string literal for printing, or function call) */
export interface ExprStmt {
  kind: 'ExprStmt';
  expr: Expr;
  loc: Loc;
}

export interface CommentStmt {
  kind: 'CommentStmt';
  text: string;
  loc: Loc;
}

// ─── Program ─────────────────────────────────────────────────────

export interface Program {
  statements: Stmt[];
}
