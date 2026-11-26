/**
 * @fileoverview Curated catalog of Yu-Gi-Oh! lingering effects and turn restrictions.
 * All passcodes verified against data/ygopro/cards.cdb via getUiCardMeta().
 */

export const LINGERING_DURATION_LABELS = Object.freeze({
  endOfTurn: Object.freeze({ en: 'This Turn', th: 'จนจบเทิร์นนี้' }),
  endOfNextTurn: Object.freeze({ en: 'Until Next Turn End', th: 'จนจบเทิร์นถัดไป' }),
  opponentEndPhase: Object.freeze({ en: "Until Opp's End Phase", th: 'จนจบ End Phase คู่แข่ง' }),
  permanentWhileFaceUp: Object.freeze({ en: 'While Active', th: 'ตราบใดที่ยังมีผล' })
});

/**
 * Scope values here are relative to the ACTIVATING player:
 * - 'both': affects both players (-1)
 * - 'self': affects activating player only
 * - 'opponent': affects opponent of activating player (or opponent actions benefiting activator)
 */
export const LINGERING_CATALOG = Object.freeze({
  94145021: Object.freeze({
    code: 94145021,
    scope: 'both',
    category: 'restriction',
    expiry: 'endOfTurn',
    badge: { en: 'No Search', th: 'ห้ามค้นการ์ด' },
    detail: {
      en: 'Neither player can add cards from the Main Deck to the hand for the rest of this turn.',
      th: 'ทั้งสองฝ่ายไม่สามารถนำการ์ดจากเด็คขึ้นมือได้จนจบเทิร์นนี้'
    }
  }),
  23434538: Object.freeze({
    code: 23434538,
    scope: 'opponent',
    category: 'draw',
    expiry: 'endOfTurn',
    badge: { en: 'Maxx "C"', th: 'Maxx "C"' },
    detail: {
      en: 'Each time the opponent Special Summons a monster(s) this turn, the activator draws 1 card.',
      th: 'ทุกครั้งที่ฝ่ายตรงข้ามอัญเชิญพิเศษในเทิร์นนี้ ผู้ใช้เอฟเฟคจั่วการ์ด 1 ใบ'
    }
  }),
  42141493: Object.freeze({
    code: 42141493,
    scope: 'opponent',
    category: 'draw',
    expiry: 'endOfTurn',
    badge: { en: 'Fuwalos', th: 'Fuwalos' },
    detail: {
      en: 'Each time the opponent Special Summons from the Deck or Extra Deck this turn, draw 1 card.',
      th: 'ทุกครั้งที่ฝ่ายตรงข้ามอัญเชิญพิเศษจากเด็คหรือ Extra Deck ในเทิร์นนี้ จั่วการ์ด 1 ใบ'
    }
  }),
  84192580: Object.freeze({
    code: 84192580,
    scope: 'opponent',
    category: 'draw',
    expiry: 'endOfTurn',
    badge: { en: 'Purulia', th: 'Purulia' },
    detail: {
      en: 'Each time the opponent Normal or Special Summons from the hand this turn, draw 1 card.',
      th: 'ทุกครั้งที่ฝ่ายตรงข้ามอัญเชิญปกติหรือพิเศษจากมือในเทิร์นนี้ จั่วการ์ด 1 ใบ'
    }
  }),
  87126721: Object.freeze({
    code: 87126721,
    scope: 'opponent',
    category: 'draw',
    expiry: 'endOfTurn',
    badge: { en: 'Meowls', th: 'Meowls' },
    detail: {
      en: 'Each time the opponent Special Summons from the GY or banishment this turn, draw 1 card.',
      th: 'ทุกครั้งที่ฝ่ายตรงข้ามอัญเชิญพิเศษจากสุสานหรือนอกเกมในเทิร์นนี้ จั่วการ์ด 1 ใบ'
    }
  }),
  91800273: Object.freeze({
    code: 91800273,
    scope: 'both',
    category: 'banish',
    expiry: 'endOfNextTurn',
    badge: { en: 'Banish All', th: 'เนรเทศทั้งหมด' },
    detail: {
      en: 'Any card sent to the GY is banished instead until the end of the next turn.',
      th: 'การ์ดทุกใบที่จะถูกส่งลงสุสานจะถูกนำออกนอกเกมแทน จนกว่าจะจบเทิร์นถัดไป'
    }
  }),
  24224830: Object.freeze({
    code: 24224830,
    scope: 'both',
    category: 'negate',
    expiry: 'endOfNextTurn',
    requiresTarget: true,
    badge: { en: 'Called By', th: 'ยกเลิกผล' },
    detail: {
      en: 'Activated effects and effects on the field of monsters with the banished card\'s original name are negated until the end of the next turn.',
      th: 'เอฟเฟคของมอนสเตอร์ที่มีชื่อเดียวกับใบที่ถูกเนรเทศจะถูกทำให้ไร้ผลจนจบเทิร์นถัดไป'
    }
  }),
  65681983: Object.freeze({
    code: 65681983,
    scope: 'both',
    category: 'negate',
    expiry: 'endOfTurn',
    requiresTarget: true,
    badge: { en: 'Crossout', th: 'Crossout' },
    detail: {
      en: 'Activated effects and effects on the field of cards with the banished card\'s original name are negated for this turn.',
      th: 'เอฟเฟคของการ์ดที่มีชื่อเดียวกับใบที่ประกาศจะถูกทำให้ไร้ผลจนจบเทิร์นนี้'
    }
  }),
  44362883: Object.freeze({
    code: 44362883,
    scope: 'self',
    category: 'lock',
    expiry: 'endOfTurn',
    badge: { en: 'Fusion Lock', th: 'ล็อกฟิวชัน' },
    detail: {
      en: 'You cannot Special Summon monsters from the Extra Deck, except Fusion Monsters, the turn you activate this card.',
      th: 'เทิร์นนี้คุณไม่สามารถอัญเชิญพิเศษจาก Extra Deck ได้ ยกเว้นมอนสเตอร์ฟิวชัน'
    }
  }),
  84211599: Object.freeze({
    code: 84211599,
    scope: 'self',
    category: 'restriction',
    expiry: 'endOfTurn',
    badge: { en: 'No Draw/½DMG', th: 'ห้ามจั่ว/ครึ่งDMG' },
    detail: {
      en: 'You cannot draw cards by card effects this turn, and any damage your opponent takes is halved.',
      th: 'เทิร์นนี้คุณไม่สามารถจั่วการ์ดด้วยเอฟเฟคได้ และความเสียหายที่คู่ต่อสู้ได้รับจะลดลงครึ่งหนึ่ง'
    }
  }),
  49238328: Object.freeze({
    code: 49238328,
    scope: 'self',
    category: 'restriction',
    expiry: 'endOfTurn',
    badge: { en: 'No Draw', th: 'ห้ามจั่วเพิ่ม' },
    detail: {
      en: 'For the rest of this turn after this card resolves, you cannot draw any cards by card effects.',
      th: 'ตลอดเทิร์นนี้หลังจากใบนี้ทำงาน คุณไม่สามารถจั่วการ์ดด้วยเอฟเฟคได้'
    }
  }),
  6172122: Object.freeze({
    code: 6172122,
    scope: 'self',
    category: 'lock',
    expiry: 'endOfTurn',
    badge: { en: 'No Summons', th: 'ห้ามอัญเชิญเพิ่ม' },
    detail: {
      en: 'You cannot Normal or Special Summon other monsters the turn you activate this card.',
      th: 'เทิร์นนี้คุณไม่สามารถอัญเชิญปกติหรืออัญเชิญพิเศษมอนสเตอร์ตัวอื่นได้'
    }
  }),
  20001443: Object.freeze({
    code: 20001443,
    scope: 'self',
    category: 'lock',
    expiry: 'endOfTurn',
    badge: { en: 'Synchro Lock', th: 'ล็อกซิงโคร' },
    detail: {
      en: 'While the Swordsoul Token is in the Monster Zone, you cannot Special Summon from the Extra Deck, except Synchro Monsters.',
      th: 'ตราบใดที่ Swordsoul Token อยู่บนสนาม ไม่สามารถอัญเชิญพิเศษจาก Extra Deck ได้ ยกเว้นซิงโคร'
    }
  }),
  56495147: Object.freeze({
    code: 56495147,
    scope: 'self',
    category: 'lock',
    expiry: 'endOfTurn',
    badge: { en: 'Synchro Lock', th: 'ล็อกซิงโคร' },
    detail: {
      en: 'While the Swordsoul Token is in the Monster Zone, you cannot Special Summon from the Extra Deck, except Synchro Monsters.',
      th: 'ตราบใดที่ Swordsoul Token อยู่บนสนาม ไม่สามารถอัญเชิญพิเศษจาก Extra Deck ได้ ยกเว้นซิงโคร'
    }
  }),
  34267821: Object.freeze({
    code: 34267821,
    scope: 'both',
    category: 'floodgate',
    expiry: 'endOfTurn',
    badge: { en: 'No Banish', th: 'ห้ามเนรเทศ' },
    detail: {
      en: 'Neither player can banish cards for the rest of this turn.',
      th: 'ทั้งสองฝ่ายไม่สามารถนำการ์ดออกนอกเกมได้จนจบเทิร์นนี้'
    }
  }),
  83326048: Object.freeze({
    code: 83326048,
    scope: 'both',
    category: 'floodgate',
    expiry: 'endOfTurn',
    badge: { en: 'D-Barrier', th: 'แบนประเภท' },
    detail: {
      en: 'Neither player can Special Summon monsters of the declared type, and their effects on the field are negated until the end of this turn.',
      th: 'ทั้งสองฝ่ายไม่สามารถอัญเชิญพิเศษมอนสเตอร์ประเภทที่ประกาศ และเอฟเฟคบนสนามจะไร้ผลจนจบเทิร์นนี้'
    }
  })
});

export function getLingeringCatalogEntry(code) {
  return LINGERING_CATALOG[Number(code || 0)] || null;
}
