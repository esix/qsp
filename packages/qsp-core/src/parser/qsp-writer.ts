import type { QspGame, QspLocation, QspAction } from '../types/index.js';

const QSP_GAMEID = 'QSPGAME';
const QSP_CODREMOV = 5;

/**
 * Encode a string with QSP's Caesar cipher (subtract 5 from each char code).
 * Inverse of qspDecode in encoding.ts.
 */
function qspEncode(text: string): number[] {
  const codes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    codes.push((text.charCodeAt(i) - QSP_CODREMOV) & 0xFFFF);
  }
  return codes;
}

/** Convert a plain string to char codes (no encoding) */
function plainChars(s: string): number[] {
  const codes: number[] = [];
  for (let i = 0; i < s.length; i++) codes.push(s.charCodeAt(i));
  return codes;
}

/**
 * Build a QSP binary game file (.qsp) as Uint8Array.
 * Always emits the modern UCS-2 LE format with QSPGAME header.
 */
export function writeQsp(game: { version?: string; password?: string; locations: QspLocation[] }): Uint8Array {
  const version = game.version ?? 'QSP 5.7.0';
  const password = game.password ?? '';

  // Build lines as arrays of uint16 codes
  const lines: number[][] = [];

  // Header
  lines.push(plainChars(QSP_GAMEID));      // line 0: "QSPGAME" plain
  lines.push(plainChars(version));         // line 1: version plain
  lines.push(qspEncode(password));         // line 2: password encoded
  lines.push(qspEncode(String(game.locations.length))); // line 3: location count encoded

  for (const loc of game.locations) {
    lines.push(qspEncode(loc.name));
    lines.push(qspEncode(loc.description));
    lines.push(qspEncode(loc.code));
    lines.push(qspEncode(String(loc.actions.length)));
    for (const act of loc.actions) {
      lines.push(qspEncode(act.image));
      lines.push(qspEncode(act.name));
      lines.push(qspEncode(act.code));
    }
  }

  // Concatenate lines with raw \r\n delimiters between them
  // The parser splits on uint16 0x0D followed by uint16 0x0A.
  const allChars: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      allChars.push(0x0D, 0x0A);
    }
    allChars.push(...lines[i]);
  }

  // Write as UCS-2 LE bytes
  const bytes = new Uint8Array(allChars.length * 2);
  for (let i = 0; i < allChars.length; i++) {
    bytes[i * 2] = allChars[i] & 0xFF;
    bytes[i * 2 + 1] = (allChars[i] >> 8) & 0xFF;
  }
  return bytes;
}
