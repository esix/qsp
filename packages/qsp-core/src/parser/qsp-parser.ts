import { isUcs2, decodeRawChars, qspDecode, charsToString } from './encoding.js';
import type { QspGame, QspLocation, QspAction } from '../types/index.js';

const QSP_GAMEID = 'QSPGAME';
const DELIMITER_CR = 0x0D;
const DELIMITER_LF = 0x0A;

/**
 * Split an array of char codes by \r\n delimiter.
 * Returns arrays of char codes for each line.
 */
function splitLines(chars: number[]): number[][] {
  const lines: number[][] = [];
  let start = 0;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === DELIMITER_CR && i + 1 < chars.length && chars[i + 1] === DELIMITER_LF) {
      lines.push(chars.slice(start, i));
      i++; // skip LF
      start = i + 1;
    }
  }
  if (start < chars.length) {
    lines.push(chars.slice(start));
  }
  return lines;
}

/** Read a line as a plain (unencoded) string */
function plainString(line: number[], ucs2: boolean): string {
  return charsToString(line, ucs2);
}

/** Read a line as an encoded string (decode Caesar cipher first, then convert to Unicode) */
function encodedString(line: number[], ucs2: boolean): string {
  return charsToString(qspDecode(line, ucs2), ucs2);
}

/** Read a line as an encoded integer */
function encodedInt(line: number[], ucs2: boolean): number {
  const s = encodedString(line, ucs2);
  return parseInt(s, 10) || 0;
}

/**
 * Parse a QSP binary game file (.qsp) from raw bytes.
 */
export function parseQsp(data: Uint8Array): QspGame {
  const ucs2 = isUcs2(data);
  const chars = decodeRawChars(data, ucs2);
  const lines = splitLines(chars);

  if (lines.length === 0) {
    throw new Error('Empty QSP file');
  }

  const firstLine = plainString(lines[0], ucs2);
  const isOldFormat = firstLine !== QSP_GAMEID;

  let idx: number;
  let version: string;
  let password: string;
  let locsCount: number;

  if (isOldFormat) {
    locsCount = parseInt(plainString(lines[0], ucs2), 10) || 0;
    password = encodedString(lines[1], ucs2);
    version = plainString(lines[2], ucs2);
    idx = 30;
  } else {
    version = plainString(lines[1], ucs2);
    password = encodedString(lines[2], ucs2);
    locsCount = encodedInt(lines[3], ucs2);
    idx = 4;
  }

  const locations: QspLocation[] = [];

  for (let i = 0; i < locsCount; i++) {
    if (idx >= lines.length) {
      throw new Error(`Unexpected end of file at location ${i}`);
    }

    const name = encodedString(lines[idx++], ucs2);
    const description = encodedString(lines[idx++], ucs2);
    const code = encodedString(lines[idx++], ucs2);

    let actsCount: number;
    if (isOldFormat) {
      actsCount = 20;
    } else {
      actsCount = encodedInt(lines[idx++], ucs2);
    }

    const actions: QspAction[] = [];
    for (let j = 0; j < actsCount; j++) {
      let image: string;
      if (isOldFormat) {
        image = '';
      } else {
        image = encodedString(lines[idx++], ucs2);
      }
      const actionName = encodedString(lines[idx++], ucs2);
      const actionCode = encodedString(lines[idx++], ucs2);

      // In old format, all 20 action slots exist but empty ones have no name
      if (isOldFormat && !actionName) continue;

      actions.push({ image, name: actionName, code: actionCode });
    }

    locations.push({ name, description, code, actions });
  }

  return { version, password, locations, isOldFormat };
}
