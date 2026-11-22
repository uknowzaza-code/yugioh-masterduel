/**
 * @fileoverview YDKE (Yu-Gi-Oh! Deck URL) Encoder & Decoder
 * Standard format: ydke://<main_base64>!<extra_base64>!<side_base64>!
 * Each section encodes card passcodes as little-endian unsigned 32-bit integers.
 */

/**
 * Encodes an array of numeric card passcodes into standard Base64 (little-endian Uint32).
 * @param {Array<number|string>} codes
 * @returns {string}
 */
export function encodePasscodesToBase64(codes = []) {
  const valid = [];
  for (const raw of codes) {
    const num = Number(raw);
    if (Number.isInteger(num) && num > 0 && num <= 0xffffffff) {
      valid.push(num >>> 0);
    }
  }
  if (valid.length === 0) return '';

  const bytes = new Uint8Array(valid.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < valid.length; i++) {
    view.setUint32(i * 4, valid[i], true);
  }

  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a Base64-encoded little-endian Uint32 section into card passcodes.
 * @param {string} b64
 * @returns {number[]}
 */
export function decodeBase64ToPasscodes(b64 = '') {
  const cleaned = String(b64 || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!cleaned) return [];

  const padLen = (4 - (cleaned.length % 4)) % 4;
  const padded = cleaned + '='.repeat(padLen);

  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('ข้อมูล Base64 ในโค้ด YDKE ไม่ถูกต้อง');
  }

  if (binary.length % 4 !== 0) {
    throw new Error('ความยาวไบต์ในโค้ด YDKE ไม่ถูกต้อง (ต้องหาร 4 ลงตัว)');
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const codes = [];
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const code = view.getUint32(offset, true);
    if (code > 0) codes.push(code);
  }
  return codes;
}

/**
 * Parses a ydke:// URL (even when surrounded by whitespace or pasted text).
 * @param {string} input
 * @returns {{ isYdke: false } | { isYdke: true, mainCodes: number[], extraCodes: number[], sideCodes: number[] }}
 */
export function parseYdkeUrl(input = '') {
  const text = String(input || '').trim();
  const match = text.match(/ydke:\/\/([^\s"'<>]+)/i);
  if (!match) {
    return { isYdke: false };
  }

  const body = match[1];
  const parts = body.split('!');
  if (parts.length < 2) {
    throw new Error('รูปแบบลิงก์ YDKE ไม่สมบูรณ์ (ควรเป็น ydke://main!extra!side!)');
  }

  return {
    isYdke: true,
    mainCodes: decodeBase64ToPasscodes(parts[0] || ''),
    extraCodes: decodeBase64ToPasscodes(parts[1] || ''),
    sideCodes: decodeBase64ToPasscodes(parts[2] || '')
  };
}

/**
 * Builds a standard ydke:// URL from Main, Extra, and optional Side passcode arrays.
 * @param {Array<number|string>} mainCodes
 * @param {Array<number|string>} [extraCodes=[]]
 * @param {Array<number|string>} [sideCodes=[]]
 * @returns {string}
 */
export function buildYdkeUrl(mainCodes = [], extraCodes = [], sideCodes = []) {
  return `ydke://${encodePasscodesToBase64(mainCodes)}!${encodePasscodesToBase64(extraCodes)}!${encodePasscodesToBase64(sideCodes)}!`;
}
