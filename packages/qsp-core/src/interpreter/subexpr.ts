import type { Evaluator } from './evaluator.js';

/**
 * Process QSP subexpression substitution: <<expr>> → evaluated value.
 *
 * In QSP, any text displayed to the user can contain <<expression>>
 * markers. These are evaluated and replaced with the result.
 * The expression can be a variable name, arithmetic, function call, etc.
 *
 * Nested << >> are not supported — the first >> closes the substitution.
 */
export async function substituteExpressions(text: string, evaluator: Evaluator): Promise<string> {
  if (!text.includes('<<')) return text;

  let result = '';
  let i = 0;

  while (i < text.length) {
    if (i + 1 < text.length && text[i] === '<' && text[i + 1] === '<') {
      // Find closing >>
      const end = text.indexOf('>>', i + 2);
      if (end < 0) {
        // No closing >> — treat as literal
        result += text[i];
        i++;
        continue;
      }

      const exprStr = text.substring(i + 2, end).trim();
      if (exprStr) {
        try {
          // Parse and evaluate the expression
          const val = await evaluator.evalExprString(exprStr);
          result += val.str || String(val.num);
        } catch {
          // On error, output the original text
          result += '<<' + exprStr + '>>';
        }
      }
      i = end + 2;
    } else {
      result += text[i];
      i++;
    }
  }

  return result;
}
