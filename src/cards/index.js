/**
 * @fileoverview Central Card & Deck Registry
 * ศูนย์รวมฐานข้อมูลการ์ดและเด็คเริ่มต้นทั้ง 5 เด็คยอดนิยม
 *
 * === วิธีที่ AI ตัวอื่นสามารถเพิ่มการ์ดหรือเด็คใหม่ ===
 * 1. สร้างไฟล์การ์ดใหม่ใน `src/cards/decks/<deck_name>.js` แล้ว import มาต่อใน `BUILT_IN_CARDS` ด้านล่าง
 * 2. หรือเพิ่ม JSON การ์ดลงใน `src/cards/custom_cards.json` (หรือผ่านปุ่ม "AI Card Studio" ในหน้าเว็บ)
 * 3. หรือเพิ่มเด็คใหม่ลงใน `PRESET_DECKS`
 */

import { STAPLE_CARDS } from './decks/staples.js';
import { BLUE_EYES_CARDS } from './decks/blue_eyes.js';
import { DARK_MAGICIAN_CARDS } from './decks/dark_magician.js';
import { SKY_STRIKER_CARDS } from './decks/sky_striker.js';
import { SWORDSOUL_CARDS } from './decks/swordsoul.js';
import { BRANDED_DESPIA_CARDS } from './decks/branded_despia.js';
import { MDM_TOP50_CARDS } from './decks/mdm_top50_cards.js';
import { MDM_TOP50_DECKS } from './decks/mdm_top50_decks.js';
import { validateCardSchema } from './schema.js';

export const BUILT_IN_CARDS = [
  ...STAPLE_CARDS,
  ...BLUE_EYES_CARDS,
  ...DARK_MAGICIAN_CARDS,
  ...SKY_STRIKER_CARDS,
  ...SWORDSOUL_CARDS,
  ...BRANDED_DESPIA_CARDS,
  ...MDM_TOP50_CARDS
];

export const CARD_REGISTRY = new Map();
export const PASSCODE_REGISTRY = new Map();

function indexCard(card) {
  CARD_REGISTRY.set(card.id, card);
  if (card.passcode) {
    const normCode = String(Number(card.passcode) || card.passcode).trim();
    if (normCode && !PASSCODE_REGISTRY.has(normCode)) {
      PASSCODE_REGISTRY.set(normCode, card);
    }
  }
}

for (const card of BUILT_IN_CARDS) {
  indexCard(card);
}

/**
 * ลงทะเบียนการ์ดเพิ่มเติมในขณะรันไทม์ (สำหรับ AI Card Studio หรือ custom_cards.json)
 * @param {Array<Object>} customCards
 * @returns {{ added: number, errors: string[] }}
 */
export function registerCustomCards(customCards = []) {
  let added = 0;
  const errors = [];
  if (!Array.isArray(customCards)) {
    return { added: 0, errors: ['Input must be an array of card objects'] };
  }

  for (const card of customCards) {
    const check = validateCardSchema(card);
    if (!check.valid) {
      errors.push(...check.errors);
      continue;
    }
    indexCard({ ...card, isCustom: true });
    added++;
  }

  return { added, errors };
}

/**
 * ลงทะเบียนการ์ดที่ดึงมาจาก cards.cdb สำหรับ YDK Import
 * @param {Array<Object>} cards
 */
export function registerRuntimeCards(cards = []) {
  if (!Array.isArray(cards)) return;
  for (const card of cards) {
    if (!card || !card.id) continue;
    if (!CARD_REGISTRY.has(card.id)) {
      indexCard(card);
    }
  }
}

/**
 * ดึงข้อมูลการ์ดจากรหัส id หรือ passcode
 * @param {string} id
 * @returns {Object|null}
 */
export function getCardById(id) {
  if (!id) return null;
  const direct = CARD_REGISTRY.get(id);
  if (direct) return direct;
  const str = String(id).trim();
  const codeMatch = str.startsWith('cdb_') ? str.slice(4) : str;
  const normCode = String(Number(codeMatch) || codeMatch);
  return PASSCODE_REGISTRY.get(normCode) || null;
}

/**
 * ดึงรายการการ์ดทั้งหมดในระบบ
 * @returns {Array<Object>}
 */
export function getAllCards() {
  return Array.from(CARD_REGISTRY.values());
}

/**
 * ช่วยขยายรายการการ์ดแบบย่อ [{ id, count }] ให้เป็น Array ของ card id
 * @param {Array<{id: string, count: number}>} recipe
 * @returns {string[]}
 */
export function expandDeckRecipe(recipe) {
  const list = [];
  for (const item of recipe) {
    const qty = Math.max(1, Math.min(3, item.count || 1));
    for (let i = 0; i < qty; i++) {
      list.push(item.id);
    }
  }
  return list;
}

/**
 * 50 เด็คท็อป Master Duel Meta (MDM Top 50)
 * แต่ละเด็คมี Main Deck + Extra Deck ครบพร้อมเล่น
 */
export const PRESET_DECKS = [
  ...MDM_TOP50_DECKS
];

export const CUSTOM_DECKS = [];

/**
 * ลงทะเบียนเด็คที่ผู้ใช้ import จาก YDK
 * @param {Array<Object>} decks
 * @param {{ replace?: boolean }} [options]
 */
export function registerCustomDecks(decks = [], { replace = false } = {}) {
  if (!Array.isArray(decks)) return;
  const byId = replace ? new Map() : new Map(CUSTOM_DECKS.map((d) => [d.id, d]));
  for (const deck of decks) {
    if (!deck || !deck.id) continue;
    byId.set(deck.id, deck);
  }
  CUSTOM_DECKS.length = 0;
  CUSTOM_DECKS.push(...byId.values());
}

export function getAllDecks() {
  return [...CUSTOM_DECKS, ...PRESET_DECKS];
}

export function getPresetDeckById(deckId) {
  return CUSTOM_DECKS.find(d => d.id === deckId)
    || PRESET_DECKS.find(d => d.id === deckId)
    || PRESET_DECKS[0];
}
