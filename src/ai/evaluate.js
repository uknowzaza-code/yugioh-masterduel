import { TYPE, LOC, EXTRA_DECK_TYPES } from './constants.js';
import { isFaceUp } from './board.js';

export const ROLE_BONUS = Object.freeze({
  floodgate: 2600,
  negate: 2200,
  engine: 2000,
  boss: 1700,
  starter: 1500,
  handtrap: 1500,
  boardwipe: 1200,
  searcher: 900,
  extender: 850,
  removal: 800,
});

const roleBonus = (roles) => {
  let b = 0;
  for (const r of roles) b += ROLE_BONUS[r] ?? 0;
  return b;
};

/** มูลค่าการ์ดฝั่งเรา (หน่วยเทียบ LP) — ใช้ตอนเลือกสังเวย/ทิ้ง/แลก */
export function ownCardValue(card, kb) {
  if (!card) return 0;
  if (card.type & TYPE.TOKEN) return 200;
  const info = kb.info(card.code);
  let v;
  if (card.type & TYPE.MONSTER) {
    v = Math.max(card.atk, card.def * 0.6);
    if (card.type & TYPE.EFFECT) v += 450;
    else v *= 0.75; // มอนสเตอร์ธรรมดา
    if (card.type & EXTRA_DECK_TYPES) v += 700;
    v += 250 * (card.overlays ?? 0);
  } else {
    v = (card.type & (TYPE.CONTINUOUS | TYPE.FIELD)) ? 1000 : 800;
  }
  return Math.round(v + roleBonus(info.roles));
}

/** คะแนนภัยคุกคามของการ์ดฝั่งตรงข้าม (Floodgate / Omni-Negate / Boss > Engine > Effect > Vanilla) */
export function threatScore(card, kb) {
  if (!card) return 0;
  if (!isFaceUp(card) || card.hidden) return (card.location & LOC.MZONE) ? 1100 : 1000; // คว่ำ = ไม่รู้
  const info = kb.info(card.code);
  let t;
  if (card.type & TYPE.MONSTER) {
    t = Math.max(card.atk, card.def * 0.5);
    if (card.type & TYPE.EFFECT) t += 800;
    else t *= 0.8; // มอนสเตอร์ธรรมดาอันตรายน้อยกว่าเอฟเฟกต์
    if (card.type & EXTRA_DECK_TYPES) t += 600;
    t += 350 * (card.overlays ?? 0);
    if (card.type & TYPE.TOKEN) t = Math.min(t, 400);
  } else {
    t = (card.type & (TYPE.CONTINUOUS | TYPE.FIELD | TYPE.EQUIP)) ? 1100 : 350;
  }
  let bonus = roleBonus(info.roles);
  // ถ้ามอนสเตอร์ถูก Negate เอฟเฟกต์อยู่แล้ว ลดความอันตรายด้านเอฟเฟกต์ลง
  if (card.effectsNegated) {
    bonus = Math.round(bonus * 0.25);
  }
  return Math.round(t + bonus);
}
