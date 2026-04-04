/**
 * CP1251 to Unicode lookup table for bytes 0x80-0xFF.
 * Matches the qspCP1251ToUnicodeTable from the original C source.
 */
const CP1251_TO_UNICODE: number[] = [
  0x0402, 0x0403, 0x201A, 0x0453, 0x201E, 0x2026, 0x2020, 0x2021,
  0x20AC, 0x2030, 0x0409, 0x2039, 0x040A, 0x040C, 0x040B, 0x040F,
  0x0452, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
  0x0020, 0x2122, 0x0459, 0x203A, 0x045A, 0x045C, 0x045B, 0x045F,
  0x00A0, 0x040E, 0x045E, 0x0408, 0x00A4, 0x0490, 0x00A6, 0x00A7,
  0x0401, 0x00A9, 0x0404, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x0407,
  0x00B0, 0x00B1, 0x0406, 0x0456, 0x0491, 0x00B5, 0x00B6, 0x00B7,
  0x0451, 0x2116, 0x0454, 0x00BB, 0x0458, 0x0405, 0x0455, 0x0457,
  0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417,
  0x0418, 0x0419, 0x041A, 0x041B, 0x041C, 0x041D, 0x041E, 0x041F,
  0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427,
  0x0428, 0x0429, 0x042A, 0x042B, 0x042C, 0x042D, 0x042E, 0x042F,
  0x0430, 0x0431, 0x0432, 0x0433, 0x0434, 0x0435, 0x0436, 0x0437,
  0x0438, 0x0439, 0x043A, 0x043B, 0x043C, 0x043D, 0x043E, 0x043F,
  0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447,
  0x0448, 0x0449, 0x044A, 0x044B, 0x044C, 0x044D, 0x044E, 0x044F,
];

/** Decode a single CP1251 byte to a Unicode code point */
export function cp1251ToUnicode(byte: number): number {
  if (byte < 0x80) return byte;
  return CP1251_TO_UNICODE[byte - 0x80];
}

/**
 * Detect whether the QSP file data is UCS-2 LE encoded.
 * Per the C source: `isUCS2 = !gameData[1]`
 */
export function isUcs2(data: Uint8Array): boolean {
  return data.length >= 2 && data[1] === 0;
}

/**
 * Read the raw binary data as an array of raw character codes.
 * For UCS-2 LE: reads 2 bytes per character (little-endian uint16) — already Unicode.
 * For ANSI: reads 1 byte per character — raw CP1251 byte values (NOT converted yet).
 *
 * Caesar cipher must be applied to these raw values before Unicode conversion.
 */
export function decodeRawChars(data: Uint8Array, ucs2: boolean): number[] {
  const chars: number[] = [];
  if (ucs2) {
    for (let i = 0; i + 1 < data.length; i += 2) {
      chars.push(data[i] | (data[i + 1] << 8));
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      chars.push(data[i]);
    }
  }
  return chars;
}

/**
 * Convert raw character codes to a JS string.
 * For UCS-2: codes are already Unicode.
 * For ANSI: codes are CP1251 bytes that need conversion.
 */
export function charsToString(chars: number[], ucs2: boolean): string {
  if (ucs2) {
    const chunks: string[] = [];
    for (let i = 0; i < chars.length; i += 4096) {
      chunks.push(String.fromCharCode(...chars.slice(i, i + 4096)));
    }
    return chunks.join('');
  } else {
    const chunks: string[] = [];
    for (let i = 0; i < chars.length; i += 4096) {
      const slice = chars.slice(i, i + 4096);
      chunks.push(String.fromCharCode(...slice.map(c => cp1251ToUnicode(c))));
    }
    return chunks.join('');
  }
}

const QSP_CODREMOV = 5;

/**
 * Decode a QSP-encoded string (Caesar cipher with shift of 5).
 * Operates on raw char codes (CP1251 bytes for ANSI, uint16 for UCS-2).
 * Each character code has 5 added to it.
 * Special case: -5 (0xFFFB for 16-bit, 0xFB for 8-bit) maps to 5.
 */
export function qspDecode(chars: number[], ucs2: boolean): number[] {
  const mask = ucs2 ? 0xFFFF : 0xFF;
  const negFive = (-QSP_CODREMOV) & mask;
  return chars.map(c => {
    if (c === negFive) return QSP_CODREMOV;
    return (c + QSP_CODREMOV) & mask;
  });
}
