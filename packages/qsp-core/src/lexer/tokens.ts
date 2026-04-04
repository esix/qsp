export enum TokenType {
  // Literals
  Number = 'Number',
  String = 'String',

  // Identifiers and keywords
  Identifier = 'Identifier',
  Keyword = 'Keyword',

  // Variable prefix
  Dollar = 'Dollar',             // $ (string variable prefix, but also part of identifier)

  // Operators
  Plus = 'Plus',                 // +
  Minus = 'Minus',               // -
  Star = 'Star',                 // *
  Slash = 'Slash',               // /
  Equal = 'Equal',               // =
  NotEqual = 'NotEqual',         // <> or !
  Less = 'Less',                 // <
  Greater = 'Greater',           // >
  LessEqual = 'LessEqual',      // <=
  GreaterEqual = 'GreaterEqual', // >=
  PlusEqual = 'PlusEqual',        // +=
  MinusEqual = 'MinusEqual',      // -=
  Ampersand = 'Ampersand',      // & (statement separator)

  // Punctuation
  LeftParen = 'LeftParen',       // (
  RightParen = 'RightParen',    // )
  LeftBracket = 'LeftBracket',   // [
  RightBracket = 'RightBracket', // ]
  Comma = 'Comma',               // ,
  Colon = 'Colon',               // :
  Dot = 'Dot',                   // .

  // Special
  Label = 'Label',               // :labelname (at start of statement)
  Comment = 'Comment',           // ! comment text
  LineBreak = 'LineBreak',       // \n (end of line)
  Underscore = 'Underscore',     // _ (line continuation at end of line)

  // End of input
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

/** QSP keywords (case-insensitive) */
export const KEYWORDS = new Set([
  // Control flow
  'IF', 'ELSEIF', 'ELSE', 'END',
  'ACT', 'LOOP', 'WHILE', 'STEP',
  'GOTO', 'GT', 'XGOTO', 'XGT',
  'GOSUB', 'GS',
  'JUMP',
  'EXIT',

  // Assignment
  'SET', 'LET', 'LOCAL',

  // Print
  'P', 'PL', 'NL',
  '*P', '*PL', '*NL',

  // Clear
  'CLEAR', 'CLR', '*CLEAR', '*CLR',
  'CLS', 'CLA',

  // Objects
  'ADDOBJ', 'ADD OBJ',
  'DELOBJ', 'DEL OBJ',
  'KILLOBJ',

  // Variables
  'KILLVAR', 'KILLALL', 'COPYARR',

  // Logical
  'AND', 'OR', 'NO', 'MOD',

  // Display
  'MSG', 'VIEW',
  'SHOWACTS', 'SHOWOBJS', 'SHOWSTAT', 'SHOWINPUT',
  'REFINT',
  'MENU', 'UNSELECT', 'UNSEL',

  // Audio
  'PLAY', 'CLOSE',

  // Execution
  'DYNAMIC', 'EXEC',

  // Timer
  'WAIT', 'SETTIMER',

  // Input
  'CMDCLEAR', 'CMDCLR',

  // Files
  'OPENQST', 'OPENGAME', 'SAVEGAME', 'INCLIB', 'FREELIB',

  // Functions (built-in, treated as keywords in function call context)
  'LOC', 'OBJ', 'MIN', 'MAX', 'RAND', 'RND',
  'IIF', 'RGB',
  'LEN', 'ISNUM', 'LCASE', 'UCASE',
  'INPUT', 'STR', 'VAL',
  'ARRSIZE', 'ARRPOS', 'ARRCOMP',
  'ISPLAY',
  'DESC', 'TRIM',
  'GETOBJ',
  'STRCOMP', 'STRFIND', 'STRPOS',
  'MID', 'INSTR', 'REPLACE',
  'FUNC', 'DYNEVAL',
  'COUNTOBJ', 'MSECSCOUNT',
  'QSPVER', 'CURLOC', 'SELOBJ', 'SELACT',
  'MAINTXT', 'STATTXT', 'CURACTS',
  'USER_TEXT', 'USRTXT',

  // Special system variables used as identifiers
  'USEHTML', 'BCOLOR', 'FCOLOR', 'LCOLOR',
  'FSIZE', 'FNAME',
  'ONNEWLOC', 'ONACTSEL', 'ONOBJSEL',
  'ONGSAVE', 'ONGLOAD',
  'COUNTER',
  'NOSAVE', 'DISABLESCROLL', 'DISABLESUBEX',
  'DEBUG',
]);
