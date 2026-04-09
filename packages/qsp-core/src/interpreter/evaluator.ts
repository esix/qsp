import type { Expr } from '../ast/nodes.js';
import type { GameState, QspValue, QspCallbacks } from './state.js';
import { numVal, strVal, mixVal } from './state.js';
import type { QspLocation } from '../types/index.js';
import { Parser } from '../ast/parser.js';
import { substituteExpressions } from './subexpr.js';

/**
 * QSP Expression Evaluator
 *
 * Evaluates AST expression nodes against the current game state.
 * In QSP, every value is dual-typed (num + str). String variables start with $.
 * Boolean true = -1 (QSP_TRUE), false = 0.
 */

const QSP_TRUE = -1;
const QSP_FALSE = 0;

function toBool(v: boolean): QspValue {
  return numVal(v ? QSP_TRUE : QSP_FALSE);
}

function isTruthy(v: QspValue): boolean {
  return v.num !== 0;
}

export class Evaluator {
  constructor(
    private state: GameState,
    private locations: QspLocation[],
    private callbacks: QspCallbacks,
    /** Called when FUNC/DYNEVAL needs to execute code and return RESULT */
    private execCode: (code: string, args: QspValue[]) => Promise<void>,
    private execLocation: (locName: string, args: QspValue[]) => Promise<void>,
  ) {}

  async eval(expr: Expr): Promise<QspValue> {
    switch (expr.kind) {
      case 'NumberLiteral':
        return numVal(expr.value);

      case 'StringLiteral':
        return strVal(await substituteExpressions(expr.value, this));

      case 'UnaryExpr': {
        const operand = await this.eval(expr.operand);
        switch (expr.op) {
          case '-': return numVal(-operand.num);
          case '+': return numVal(+operand.num);
          case 'NO': return toBool(!isTruthy(operand));
        }
        break;
      }

      case 'BinaryExpr': {
        const left = await this.eval(expr.left);
        const right = await this.eval(expr.right);

        switch (expr.op) {
          // Arithmetic
          case '+': {
            // String concat if either side is string-typed or has a non-empty string value
            if (left.isString || right.isString || left.str || right.str) {
              // Use .str directly for string-typed values (preserves empty string '');
              // fall back to String(num) for numeric values coerced into string context.
              const ls = left.isString ? left.str : (left.str || String(left.num));
              const rs = right.isString ? right.str : (right.str || String(right.num));
              return strVal(ls + rs);
            }
            return numVal(left.num + right.num);
          }
          case '-': return numVal(left.num - right.num);
          case '*': return numVal(left.num * right.num);
          case '/': return numVal(right.num !== 0 ? Math.trunc(left.num / right.num) : 0);
          case 'MOD': return numVal(right.num !== 0 ? left.num % right.num : 0);

          // Comparison (works on strings if either is string-typed)
          case '=': {
            if (left.str || right.str) return toBool(left.str.toUpperCase() === right.str.toUpperCase());
            return toBool(left.num === right.num);
          }
          case '<>': {
            if (left.str || right.str) return toBool(left.str.toUpperCase() !== right.str.toUpperCase());
            return toBool(left.num !== right.num);
          }
          case '<': {
            if (left.str || right.str) return toBool(left.str.toUpperCase() < right.str.toUpperCase());
            return toBool(left.num < right.num);
          }
          case '>': {
            if (left.str || right.str) return toBool(left.str.toUpperCase() > right.str.toUpperCase());
            return toBool(left.num > right.num);
          }
          case '<=': {
            if (left.str || right.str) return toBool(left.str.toUpperCase() <= right.str.toUpperCase());
            return toBool(left.num <= right.num);
          }
          case '>=': {
            if (left.str || right.str) return toBool(left.str.toUpperCase() >= right.str.toUpperCase());
            return toBool(left.num >= right.num);
          }

          // Logical
          case 'AND': return toBool(isTruthy(left) && isTruthy(right));
          case 'OR': return toBool(isTruthy(left) || isTruthy(right));
        }
        break;
      }

      case 'Parenthesized':
        return this.eval(expr.expr);

      case 'Variable':
        return this.evalVariable(expr.name, expr.index);

      case 'FunctionCall':
        return this.evalFunction(expr.name, expr.args);
    }

    return numVal(0);
  }

  private async evalVariable(name: string, indexExpr?: Expr): Promise<QspValue> {
    const uname = name.toUpperCase();
    const isStr = uname.startsWith('$');
    const baseName = isStr ? uname : uname;

    // System variables
    switch (baseName) {
      case 'USEHTML': return numVal(this.state.useHtml ? 1 : 0);
      case '$CURLOC': {
        if (this.state.curLoc >= 0 && this.state.curLoc < this.locations.length) {
          return strVal(this.locations[this.state.curLoc].name);
        }
        return strVal('');
      }
      case '$MAINTXT': return strVal(this.state.mainText);
      case '$STATTXT': return strVal(this.state.statText);
      case 'COUNTOBJ': return numVal(this.state.objects.length);
      case '$RESULT': return this.state.result;
      case 'RESULT': return this.state.result;
      case 'MSECSCOUNT': return numVal(Date.now() - this.state.startTime);
      case '$QSPVER': return strVal('0.1.0');
      case '$SELOBJ': return this.markString(true, this.state.variables.get('$SELOBJ', 0));
      case 'SELOBJ': return this.state.variables.get('SELOBJ', 0);
      case '$SELACT': return this.markString(true, this.state.variables.get('$SELACT', 0));
    }

    // ARGS array
    if (baseName === 'ARGS' || baseName === '$ARGS') {
      const idx = indexExpr ? (await this.eval(indexExpr)).num : 0;
      return this.state.args[idx] ?? { num: 0, str: '' };
    }

    // Regular variable — handle both numeric and string keys
    if (indexExpr) {
      const v = await this.eval(indexExpr);
      if (v.str) {
        // String key — apply <<expr>> substitution and do associative lookup
        const key = await this.substitute(v.str);
        return this.markString(isStr, this.state.variables.getByKey(name, key));
      }
      return this.markString(isStr, this.state.variables.get(name, v.num));
    }
    return this.markString(isStr, this.state.variables.get(name, 0));
  }

  /** For $-prefixed variables, ensure isString is set so <<$var>> substitutes '' not '0' */
  private markString(isStr: boolean, v: QspValue): QspValue {
    return isStr && !v.isString ? { ...v, isString: true } : v;
  }

  private async evalFunction(name: string, argExprs: Expr[]): Promise<QspValue> {
    const uname = name.toUpperCase();
    const isStr = uname.startsWith('$');

    const arg = async (i: number) => this.eval(argExprs[i]);
    const allArgs = async () => Promise.all(argExprs.map(e => this.eval(e)));

    switch (uname) {
      // ─── Math ──────────────────────
      case 'RAND': {
        const a = (await arg(0)).num;
        if (argExprs.length === 1) {
          return numVal(Math.floor(Math.random() * a) + 1); // 1..a
        }
        const b = (await arg(1)).num;
        const min = Math.min(a, b);
        const max = Math.max(a, b);
        return numVal(Math.floor(Math.random() * (max - min + 1)) + min);
      }
      case 'RND': return numVal(Math.floor(Math.random() * 1000) + 1);
      case 'MAX': {
        const vals = (await allArgs()).map(v => v.num);
        return numVal(Math.max(...vals));
      }
      case 'MIN': {
        const vals = (await allArgs()).map(v => v.num);
        return numVal(Math.min(...vals));
      }
      case 'IIF':
      case '$IIF': {
        return isTruthy(await arg(0)) ? arg(1) : arg(2);
      }
      case 'RGB': {
        const r = (await arg(0)).num & 0xFF;
        const g = (await arg(1)).num & 0xFF;
        const b = (await arg(2)).num & 0xFF;
        return numVal(r | (g << 8) | (b << 16));
      }

      // ─── String functions ──────────
      case 'LEN': return numVal((await arg(0)).str.length);
      case 'LCASE': case '$LCASE': return strVal((await arg(0)).str.toLowerCase());
      case 'UCASE': case '$UCASE': return strVal((await arg(0)).str.toUpperCase());
      case 'TRIM': case '$TRIM': return strVal((await arg(0)).str.trim());
      case 'ISNUM': {
        const s = (await arg(0)).str;
        return toBool(s !== '' && !isNaN(Number(s)));
      }
      case 'STR': case '$STR': return strVal(String((await arg(0)).num));
      case 'VAL': {
        const n = parseInt((await arg(0)).str, 10);
        return numVal(isNaN(n) ? 0 : n);
      }
      case 'MID': case '$MID': {
        const s = (await arg(0)).str;
        const start = (await arg(1)).num - 1; // QSP is 1-based
        const len = argExprs.length > 2 ? (await arg(2)).num : s.length;
        return strVal(s.substring(start, start + len));
      }
      case 'INSTR': {
        // INSTR(start, str, substr) or INSTR(str, substr)
        let start: number, str: string, sub: string;
        if (argExprs.length >= 3) {
          start = (await arg(0)).num;
          str = (await arg(1)).str;
          sub = (await arg(2)).str;
        } else {
          start = 1;
          str = (await arg(0)).str;
          sub = (await arg(1)).str;
        }
        const idx = str.toUpperCase().indexOf(sub.toUpperCase(), start - 1);
        return numVal(idx >= 0 ? idx + 1 : 0);
      }
      case 'REPLACE': case '$REPLACE': {
        const str = (await arg(0)).str;
        const from = (await arg(1)).str;
        const to = argExprs.length > 2 ? (await arg(2)).str : '';
        if (!from) return strVal(str);
        // Replace all occurrences (case-sensitive in QSP)
        return strVal(str.split(from).join(to));
      }
      case 'STRPOS': {
        const str = (await arg(0)).str;
        const pattern = (await arg(1)).str;
        try {
          const re = new RegExp(pattern, 'i');
          const m = str.match(re);
          return numVal(m ? (m.index ?? 0) + 1 : 0);
        } catch { return numVal(0); }
      }
      case 'STRCOMP': {
        const str = (await arg(0)).str;
        const pattern = (await arg(1)).str;
        try {
          const re = new RegExp(pattern, 'i');
          return toBool(re.test(str));
        } catch { return toBool(false); }
      }
      case 'STRFIND': case '$STRFIND': {
        const str = (await arg(0)).str;
        const pattern = (await arg(1)).str;
        const group = argExprs.length > 2 ? (await arg(2)).num : 0;
        try {
          const re = new RegExp(pattern, 'i');
          const m = str.match(re);
          if (m && group < m.length) return strVal(m[group]);
        } catch {}
        return strVal('');
      }

      // ─── Array functions ───────────
      case 'ARRSIZE': {
        const name = (await arg(0)).str;
        let size = this.state.variables.arraySize(name);
        if (size === 0) {
          // In QSP, $varname and varname share the same array — check alternate prefix
          const alt = name.startsWith('$') ? name.slice(1) : '$' + name;
          size = this.state.variables.arraySize(alt);
        }
        return numVal(size);
      }
      case 'ARRPOS': {
        const name = (await arg(0)).str;
        const val = await arg(1);
        const start = argExprs.length > 2 ? (await arg(2)).num : 0;
        let pos = this.state.variables.arrayPos(name, val, start);
        if (pos < 0) {
          const alt = name.startsWith('$') ? name.slice(1) : '$' + name;
          pos = this.state.variables.arrayPos(alt, val, start);
        }
        return numVal(pos);
      }

      // ─── Location/object checks ────
      case 'LOC': {
        const locName = (await arg(0)).str;
        return toBool(this.locations.some(l => l.name.toUpperCase() === locName.toUpperCase()));
      }
      case 'OBJ': {
        const objName = (await arg(0)).str;
        return toBool(this.state.objects.some(o => o.name.toUpperCase() === objName.toUpperCase()));
      }
      case '$GETOBJ': {
        const idx = (await arg(0)).num - 1; // 1-based
        if (idx >= 0 && idx < this.state.objects.length) {
          return strVal(this.state.objects[idx].name);
        }
        return strVal('');
      }
      case '$DESC': {
        const locName = (await arg(0)).str;
        const loc = this.locations.find(l => l.name.toUpperCase() === locName.toUpperCase());
        return strVal(loc?.description ?? '');
      }

      // ─── Input ─────────────────────
      case '$INPUT': {
        // Synchronous fallback — real UI would be async
        const prompt = (await arg(0)).str;
        if (this.callbacks.onInput) {
          const result = this.callbacks.onInput(prompt);
          if (typeof result === 'string') return strVal(result);
        }
        return strVal('');
      }

      // ─── Audio ─────────────────────
      case 'ISPLAY': {
        const filename = (await arg(0)).str;
        return toBool(this.state.playingFiles.has(filename.toUpperCase()));
      }

      // ─── Execution ─────────────────
      case 'FUNC': {
        const locName = (await arg(0)).str;
        const fArgs = await Promise.all(argExprs.slice(1).map(e => this.eval(e)));
        await this.execLocation(locName, fArgs);
        return this.state.result;
      }
      case 'DYNEVAL': {
        const code = (await arg(0)).str;
        const fArgs = await Promise.all(argExprs.slice(1).map(e => this.eval(e)));
        await this.execCode(code, fArgs);
        return this.state.result;
      }

      default:
        // Unknown function — return 0/empty
        return isStr ? strVal('') : numVal(0);
    }
  }

  /** Apply <<expr>> substitution to a text string */
  async substitute(text: string): Promise<string> {
    return substituteExpressions(text, this);
  }

  /** Parse a string as an expression and evaluate it (used for <<expr>> substitution) */
  async evalExprString(exprStr: string): Promise<QspValue> {
    const parser = new Parser();
    // Wrap in an assignment to extract the expression: we parse "_ = expr" and take the value
    const program = parser.parse('__subexpr__ = ' + exprStr);
    if (program.statements.length > 0 && program.statements[0].kind === 'AssignStmt') {
      return this.eval(program.statements[0].value);
    }
    return numVal(0);
  }
}
