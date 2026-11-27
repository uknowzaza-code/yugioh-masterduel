import { readOcgCardData, getUiCardMeta } from '../engine/OcgCardDb.js';
import { CATEGORY } from './constants.js';

/**
 * วิเคราะห์ข้อความ PSCT (description จาก Yugipedia/cards.cdb) เป็น bitmask ของ CATEGORY
 * เพื่อให้ AI รู้ว่าการ์ดทุกใบในเกม (1,073+ ใบ) ทำอะไรได้บ้าง (search, draw, spsummon, negate, removal, floodgate)
 */
export function inferCategoryFromText(desc = '') {
  const t = String(desc || '').toLowerCase();
  if (!t) return { category: 0, isFloodgate: false };

  let cat = 0;
  if (/\badd\b[^.;]*\bfrom your deck to your hand\b|\bsearch\b|\bexcavate\b[^.;]*\badd\b/.test(t)) {
    cat |= CATEGORY.SEARCH;
  }
  if (/\badd\b[^.;]*\bto your hand\b|\breturn\b[^.;]*\bto the hand\b/.test(t)) {
    cat |= CATEGORY.TOHAND;
  }
  if (/\bdraw \d+ card|\bdraw cards?\b|\bdraw 1\b|\bdraw 2\b/.test(t)) {
    cat |= CATEGORY.DRAW;
  }
  if (
    /\bspecial summon\b|\bfusion summon\b|\britual summon\b|\bsynchro summon\b|\bxyz summon\b|\blink summon\b|\bpendulum summon\b/.test(t)
  ) {
    cat |= CATEGORY.SPECIAL_SUMMON;
  }
  if (
    /\b(?:immediately after this effect resolves,?\s*)?(?:normal|tribute) summon\s+(?:1|a|that|this)\b|\badditional normal summon\b|\btribute summon\b/.test(t) &&
    !/\bcannot be normal summoned\b/.test(t)
  ) {
    cat |= CATEGORY.SUMMON;
  }
  if (/\bsend\b[^.;]*\bfrom your deck to the gy\b|\bmill\b/.test(t)) {
    cat |= CATEGORY.DECKDES;
  }
  if (/\bsend\b[^.;]*\bto the gy\b/.test(t)) {
    cat |= CATEGORY.TOGRAVE;
  }
  if (/\btribute\b/.test(t)) {
    cat |= CATEGORY.RELEASE;
  }
  if (/\bdestroy\b/.test(t)) {
    cat |= CATEGORY.DESTROY;
  }
  if (/\bbanish\b/.test(t)) {
    cat |= CATEGORY.REMOVE;
  }
  if (/\bshuffle\b[^.;]*\binto the deck\b|\breturn\b[^.;]*\bto the (?:hand|deck|extra deck)\b/.test(t)) {
    cat |= CATEGORY.TODECK;
  }
  if (/\btake control of\b/.test(t)) {
    cat |= CATEGORY.CONTROL;
  }
  if (/\bnegate the activation\b|\bnegate that activation\b|\bnegate the effect\b|\bnegate that effect\b/.test(t)) {
    cat |= CATEGORY.NEGATE;
  }
  if (/\bnegate its effects\b|\bnegate the effects of\b|\bhave their effects negated\b/.test(t)) {
    cat |= CATEGORY.DISABLE;
  }
  if (/\bnegate the summon\b|\bnegate the special summon\b/.test(t)) {
    cat |= CATEGORY.DISABLE_SUMMON;
  }
  if (/\btoken\b/.test(t)) {
    cat |= CATEGORY.TOKEN;
  }
  if (/\binflict\b[^.;]*\bdamage\b/.test(t)) {
    cat |= CATEGORY.DAMAGE;
  }

  const isTributeTrigger = /\b(?:if|when) (?:this card|it) is tributed\b/.test(t);
  const isGyTrigger = /\b(?:if|when) (?:this card|it) is (?:destroyed and )?sent to the gy\b/.test(t);
  const isBanishTrigger = /\b(?:if|when) (?:this card|it) is banished\b/.test(t);
  const isPendulumEffect = /\bpendulum summon\b|\bpendulum zone\b|\bpendulum scale\b/.test(t);

  const isFloodgate =
    /\bneither player can special summon\b|\byour opponent cannot special summon\b|\bnegate the effects of all face-up monsters\b|\bneither player can activate\b|\byour opponent cannot activate\b|\bcan only special summon .* once per turn\b|\ball monsters on the field become\b|\bany card sent to the gy is banished instead\b/.test(t);

  return {
    category: cat,
    isFloodgate,
    isTributeTrigger,
    isGyTrigger,
    isBanishTrigger,
    isPendulumEffect,
  };
}

/**
 * Adapter ฐานข้อมูลการ์ด (cards.cdb + local registry + PSCT category inference) สำหรับ CardKnowledge
 * คืนข้อมูลรูปแบบ { code, name, type, atk, def, level, category, isFloodgate, description }
 */
export function createOcgCardDbAdapter() {
  const cache = new Map();
  return {
    get(code) {
      const num = Number(code || 0);
      if (!num) return null;
      if (cache.has(num)) return cache.get(num);
      const raw = readOcgCardData(num);
      const ui = getUiCardMeta(num);
      if (!raw && !ui) {
        cache.set(num, null);
        return null;
      }
      const desc = ui?.description ?? '';
      const inferred = inferCategoryFromText(desc);
      const entry = Object.freeze({
        code: num,
        name: ui?.name ?? `#${num}`,
        type: Number(raw?.type ?? 0),
        atk: Number(raw?.attack ?? ui?.atk ?? 0),
        def: Number(raw?.defense ?? ui?.def ?? 0),
        level: Number(raw?.level ?? ui?.level ?? 0) & 0xff,
        lscale: Number(raw?.lscale ?? 0),
        rscale: Number(raw?.rscale ?? 0),
        category: inferred.category,
        isFloodgate: inferred.isFloodgate,
        description: desc,
      });
      cache.set(num, entry);
      return entry;
    },
  };
}
