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
 * 55 เด็คยอดนิยมใน Yu-Gi-Oh! Master Duel (5 Starter + 50 Master Duel Meta)
 * แต่ละเด็คมี Main Deck + Extra Deck ครบพร้อมเล่น
 */
export const PRESET_DECKS = [
  {
    id: 'blue_eyes_meta',
    name: 'Blue-Eyes Chaos Dragon',
    nameTh: '1. บลูอายส์ ไวท์ดราก้อน (Blue-Eyes)',
    mdmRank: 1,
    mdmTier: 'Starter',
    styles: ['SYNCHRO', 'FUSION', 'XYZ'],
    badge: 'POWER / SYNCHRO / FUSION / XYZ',
    themeColor: '#38bdf8',
    coverCardId: 'blue_eyes_white_dragon',
    difficulty: '⭐⭐ (เล่นง่าย พลังโจมตีสูงมาก)',
    summary: "Seto Kaiba's iconic Blue-Eyes dragon deck focusing on Lv.8 3000+ ATK beaters, Rank 8 Xyz (Number 38), Lv.9 Synchros, and massive 4500 ATK Fusions.",
    summaryTh: 'เด็คมังกรขาวในตำนานของไคบะ เซโตะ เน้นเรียกมังกร Lv.8 พลังโจมตี 3000+ ลงสนามรัวๆ ต่อยอดเป็นฟิวชั่น 4500 ATK, ซิงโคร Lv.9 หรือเอ็กシーズ Rank 8',
    comboGuide: [
      '1. Search Blue-Eyes White Dragon + Alternative with The Melody of Awakening Dragon.',
      '2. Special Summon Alternative from hand for free and destroy 1 opponent monster.',
      '3. Normal Summon Sage with Eyes of Blue (Lv.1 Tuner) to search White Stone or Synchro Lv.9 Blue-Eyes Spirit Dragon!',
      '4. Overlay two Lv.8 dragons for Rank 8 Number 38: Hope Harbinger to negate opponent Spells!'
    ],
    comboGuideTh: [
      '1. ใช้ The Melody of Awakening Dragon ค้นหา Blue-Eyes White Dragon + Blue-Eyes Alternative White Dragon ขึ้นมือพร้อมกัน',
      '2. อัญเชิญพิเศษ Blue-Eyes Alternative จากมือฟรี แล้วกดเอฟเฟคทำลายมอนสเตอร์อีกฝ่าย 1 ใบ',
      '3. อัญเชิญปกติ Sage with Eyes of Blue (จูนเนอร์ Lv.1) เพื่อค้นหา White Stone หรือซิงโคร Lv.9 Blue-Eyes Spirit Dragon!',
      '4. หรือหากมีมอนสเตอร์ Lv.8 บนสนาม 2 ใบ กดที่ Extra Deck เพื่ออัญเชิญเอ็กシーズ Rank 8 Number 38: Hope Harbinger ไว้ยกเลิกเวทอีกฝ่าย!'
    ],
    mainDeckRecipe: [
      { id: 'blue_eyes_white_dragon', count: 3 },
      { id: 'blue_eyes_alternative_white_dragon', count: 3 },
      { id: 'blue_eyes_jet_dragon', count: 2 },
      { id: 'blue_eyes_abyss_dragon', count: 2 },
      { id: 'sage_with_eyes_of_blue', count: 3 },
      { id: 'the_white_stone_of_ancients', count: 3 },
      { id: 'ash_blossom', count: 3 },
      { id: 'maxx_c', count: 2 },
      { id: 'effect_veiler', count: 2 },
      { id: 'the_melody_of_awakening_dragon', count: 3 },
      { id: 'return_of_the_dragon_lords', count: 3 },
      { id: 'bingo_machine_go', count: 3 },
      { id: 'ultimate_fusion', count: 2 },
      { id: 'called_by_the_grave', count: 2 },
      { id: 'monster_reborn', count: 1 },
      { id: 'raigeki', count: 1 },
      { id: 'true_light', count: 2 }
    ],
    extraDeckRecipe: [
      { id: 'blue_eyes_alternative_ultimate_dragon', count: 2 },
      { id: 'blue_eyes_tyrant_dragon', count: 2 },
      { id: 'blue_eyes_spirit_dragon', count: 2 },
      { id: 'azure_eyes_silver_dragon', count: 2 },
      { id: 'number_38_hope_harbinger', count: 2 },
      { id: 'baronne_de_fleur', count: 1 },
      { id: 'accesscode_talker', count: 1 }
    ]
  },
  {
    id: 'dark_magician_control',
    name: 'Dark Magician Spellcaster Control',
    nameTh: '2. แบล็คเมจิกเชี่ยน (Dark Magician)',
    mdmRank: 2,
    mdmTier: 'Starter',
    styles: ['CONTROL', 'FUSION', 'XYZ'],
    badge: 'CONTROL / BANISH / FUSION / XYZ',
    themeColor: '#a855f7',
    coverCardId: 'dark_magician',
    difficulty: '⭐⭐ (เข้าใจง่าย คอมโบวงเวทมูฟการ์ดรุนแรง)',
    summary: "Yugi Muto's signature Spellcaster control deck centering on the Dark Magical Circle + Eternal Soul banish loop and Fusion/Rank 7 pressure.",
    summaryTh: 'เด็คคู่หูของมุโต้ ยูกิ ใช้คอมโบอมตะ Dark Magical Circle + Eternal Soul ชุบชีวิต Dark Magician ทุกเทิร์นพร้อมมูฟการ์ดของอีกฝ่ายออกนอกเกม!',
    comboGuide: [
      "1. Normal Summon Magician's Rod to search Dark Magical Circle or Soul Servant.",
      "2. Activate Magician's Souls to send Dark Magician from Deck to GY and Special Summon it!",
      '3. With Dark Magical Circle on field, trigger a non-destruction Banish whenever Dark Magician arrives.',
      '4. Fuse via Secrets of Dark Magic or Timaeus into The Dark Magicians for free draw power!'
    ],
    comboGuideTh: [
      '1. อัญเชิญปกติ Magician\'s Rod เพื่อค้นหา Dark Magical Circle หรือ Soul Servant ขึ้นมือ',
      '2. ใช้ Magician\'s Souls ส่ง Dark Magician จากเด็คลงสุสาน แล้วชุบขึ้นสนามทันทีโดยไม่ต้องสังเวย!',
      '3. เมื่อมี Dark Magical Circle + Dark Magician บนสนาม กดเอฟเฟคของวงเวทเพื่อมูฟการ์ดอีกฝ่ายออกนอกเกม (Banish)',
      '4. ใช้ Secrets of Dark Magic หรือ Timaeus เพื่อฟิวชั่นเรียก The Dark Magicians ลงมาจั่วการ์ดฟรีทุกเทิร์น!'
    ],
    mainDeckRecipe: [
      { id: 'dark_magician', count: 3 },
      { id: 'dark_magician_girl', count: 2 },
      { id: 'magicians_rod', count: 3 },
      { id: 'magicians_souls', count: 3 },
      { id: 'apprentice_illusion_magician', count: 3 },
      { id: 'timaeus_the_united_dragon', count: 2 },
      { id: 'ash_blossom', count: 3 },
      { id: 'maxx_c', count: 2 },
      { id: 'dark_magical_circle', count: 3 },
      { id: 'soul_servant', count: 3 },
      { id: 'secrets_of_dark_magic', count: 3 },
      { id: 'dark_magic_attack', count: 2 },
      { id: 'called_by_the_grave', count: 2 },
      { id: 'harpies_feather_duster', count: 1 },
      { id: 'monster_reborn', count: 1 },
      { id: 'eternal_soul', count: 2 },
      { id: 'infinite_impermanence', count: 2 }
    ],
    extraDeckRecipe: [
      { id: 'the_dark_magicians', count: 2 },
      { id: 'dark_magician_the_dragon_knight', count: 2 },
      { id: 'ebon_illusion_magician', count: 2 },
      { id: 'baronne_de_fleur', count: 1 },
      { id: 'accesscode_talker', count: 1 }
    ]
  },
  {
    id: 'sky_striker_ace',
    name: 'Sky Striker Ace Control',
    nameTh: '3. สกายสไตรเกอร์ เอซ (Sky Striker)',
    mdmRank: 3,
    mdmTier: 'Tier 3',
    styles: ['LINK', 'CONTROL'],
    badge: 'LINK-1 / QUICK-PLAY SPELLS / META',
    themeColor: '#f43f5e',
    coverCardId: 'sky_striker_ace_raye',
    difficulty: '⭐⭐⭐ (เมต้าสายคอนโทรล สลับเกราะลิงก์และรัวเวทมนตร์)',
    summary: 'Beloved Master Duel Link-1 Spell-cycling control deck swapping Raye between Kagari, Shizuku, and Hayate while stacking Spells in GY for Engage! & Widow Anchor.',
    summaryTh: 'เด็คเมต้าขวัญใจผู้เล่น Master Duel ใช้ Raye สวมเกราะ Link-1 (Kagari, Shizuku, Hayate) สะสมเวทมนตร์ในสุสานให้ครบ 3 ใบ เพื่อทำให้ Engage! จั่วเพิ่ม และ Widow Anchor ยึดมอนสเตอร์อีกฝ่าย!',
    comboGuide: [
      '1. Search Sky Striker Ace - Raye or Hornet Drones with Engage! or ROTA.',
      '2. Summon Raye (or Hornet Token) and Link Summon Link-1 Kagari from Extra Deck.',
      '3. Kagari recovers Engage! from your GY to extend Spell count immediately!',
      '4. With 3+ Spells in GY, Widow Anchor negates AND steals an opponent monster!'
    ],
    comboGuideTh: [
      '1. ใช้ Engage! หรือ ROTA ค้นหา Sky Striker Ace - Raye หรือ Hornet Drones ขึ้นมือ',
      '2. อัญเชิญ Raye หรือเสก Token จาก Hornet Drones แล้วกดที่ Extra Deck เพื่อลิงก์ซัมมอน Link-1 Kagari',
      '3. เอฟเฟคของ Kagari จะเก็บ Engage! จากสุสานกลับมาใช้ซ้ำได้อีกรอบ!',
      '4. เมื่อในสุสานมีเวทมนตร์ 3 ใบขึ้นไป การ์ด Widow Anchor จะทั้งใบ้เอฟเฟคและยึดมอนสเตอร์ของอีกฝ่ายมาเป็นของเราทันที!'
    ],
    mainDeckRecipe: [
      { id: 'sky_striker_ace_raye', count: 3 },
      { id: 'sky_striker_ace_roze', count: 2 },
      { id: 'ash_blossom', count: 3 },
      { id: 'maxx_c', count: 2 },
      { id: 'effect_veiler', count: 2 },
      { id: 'sky_striker_mobilize_engage', count: 3 },
      { id: 'sky_striker_mecha_widow_anchor', count: 3 },
      { id: 'sky_striker_mecha_hornet_drones', count: 3 },
      { id: 'sky_striker_mecha_shark_cannon', count: 3 },
      { id: 'sky_striker_maneuver_afterburners', count: 3 },
      { id: 'sky_striker_airspace_area_zero', count: 3 },
      { id: 'reinforcement_of_the_army', count: 1 },
      { id: 'called_by_the_grave', count: 2 },
      { id: 'raigeki', count: 2 },
      { id: 'harpies_feather_duster', count: 1 },
      { id: 'monster_reborn', count: 1 },
      { id: 'infinite_impermanence', count: 3 }
    ],
    extraDeckRecipe: [
      { id: 'sky_striker_ace_kagari', count: 3 },
      { id: 'sky_striker_ace_shizuku', count: 3 },
      { id: 'sky_striker_ace_hayate', count: 2 },
      { id: 'sky_striker_ace_zeke', count: 2 },
      { id: 'accesscode_talker', count: 2 }
    ]
  },
  {
    id: 'swordsoul_tenyi',
    name: 'Swordsoul Tenyi Synchro',
    nameTh: '4. ซอร์ดโซล เทนยี่ (Swordsoul Tenyi)',
    mdmRank: 4,
    mdmTier: 'Tier 3',
    styles: ['SYNCHRO', 'LINK'],
    badge: 'SYNCHRO LV.8 & LV.10 / TOKEN / META',
    themeColor: '#f59e0b',
    coverCardId: 'swordsoul_grandmaster_chixiao',
    difficulty: '⭐⭐ (เมต้าสายซิงโครที่เสถียรที่สุด เรียกบอส 2 ตัวในเทิร์นเดียว)',
    summary: "Master Duel's premier Synchro strategy where Mo Ye, Taia, and Longyuan summon Lv.4 Tuner Tokens on entry to build instant Lv.8 Chixiao & Lv.10 Baronne / Chengying boards.",
    summaryTh: 'สุดยอดเด็คซิงโครแห่ง Master Duel มอนสเตอร์หลักอย่าง Mo Ye, Taia และ Longyuan สามารถเสก "Swordsoul Token" (จูนเนอร์ Lv.4) ออกมาข้างตัวเองเพื่อซิงโคร Lv.8 Chixiao และ Lv.10 Baronne / Chengying ได้ทันที!',
    comboGuide: [
      '1. Search Swordsoul of Mo Ye with Swordsoul Emergence and Normal Summon her.',
      '2. Mo Ye creates a Lv.4 Tuner Token — immediately Synchro Summon Lv.8 Chixiao (4+4=8).',
      '3. Chain Trigger: Mo Ye draws 1 card and Chixiao searches Longyuan!',
      '4. Special Summon Longyuan + Token and Synchro Lv.10 Baronne de Fleur or Qixing Longyuan (6+4=10)!'
    ],
    comboGuideTh: [
      '1. ใช้ Swordsoul Emergence ค้นหา Swordsoul of Mo Ye ขึ้นมือ แล้วอัญเชิญปกติ Mo Ye',
      '2. Mo Ye จะเสก Swordsoul Token (จูนเนอร์ Lv.4) ลงมา — กดที่ Extra Deck เพื่อซิงโคร Lv.8 Chixiao (4+4=8)',
      '3. เมื่อซิงโครสำเร็จ: Mo Ye ได้จั่วการ์ด 1 ใบ และ Chixiao ได้ค้นหา Longyuan จากเด็คขึ้นมือ!',
      '4. ใช้เอฟเฟคของ Longyuan บนมือเพื่อลงสนามพร้อม Token Lv.4 แล้วซิงโคร Lv.10 Baronne de Fleur หรือ Qixing Longyuan (6+4=10) พร้อมยิงดาเมจ 1200 LP!'
    ],
    mainDeckRecipe: [
      { id: 'swordsoul_of_mo_ye', count: 3 },
      { id: 'swordsoul_of_taia', count: 3 },
      { id: 'swordsoul_strategist_longyuan', count: 3 },
      { id: 'incredible_ecclesia', count: 3 },
      { id: 'tenyi_spirit_ashuna', count: 3 },
      { id: 'tenyi_spirit_vishuda', count: 3 },
      { id: 'ash_blossom', count: 3 },
      { id: 'maxx_c', count: 2 },
      { id: 'effect_veiler', count: 2 },
      { id: 'swordsoul_emergence', count: 3 },
      { id: 'swordsoul_sacred_summit', count: 3 },
      { id: 'called_by_the_grave', count: 2 },
      { id: 'raigeki', count: 1 },
      { id: 'harpies_feather_duster', count: 1 },
      { id: 'swordsoul_blackout', count: 3 },
      { id: 'infinite_impermanence', count: 2 }
    ],
    extraDeckRecipe: [
      { id: 'swordsoul_grandmaster_chixiao', count: 2 },
      { id: 'swordsoul_supreme_sovereign_chengying', count: 2 },
      { id: 'swordsoul_sinister_sovereign_qixing_longyuan', count: 2 },
      { id: 'baronne_de_fleur', count: 2 },
      { id: 'baxia_brightness_of_the_yang_zing', count: 2 },
      { id: 'accesscode_talker', count: 1 }
    ]
  },
  {
    id: 'branded_despia',
    name: 'Branded Despia Fusion',
    nameTh: '5. แบรนเด็ด เดสเปีย (Branded Despia)',
    mdmRank: 5,
    mdmTier: 'Tier 1',
    styles: ['FUSION'],
    badge: 'DECK FUSION / MIRRORJADE / TIER 1 META',
    themeColor: '#ef4444',
    coverCardId: 'mirrorjade_the_iceblade_dragon',
    difficulty: '⭐⭐⭐ (เมต้าสายฟิวชั่นสุดแกร่ง ฟิวชั่นจากเด็คด้วยการ์ดใบเดียว)',
    summary: "Top-tier Fusion powerhouse utilizing Aluber & Branded Fusion to fuse straight from the Deck into Mirrorjade the Iceblade Dragon's Quick Effect non-targeting banish.",
    summaryTh: 'เด็คฟิวชั่นระดับ Tier 1 ของ Master Duel ใช้ Aluber ค้นหา Branded Fusion เพื่อฟิวชั่นโดยส่งวัตถุดิบจากเด็ค เรียกมังกรน้ำแข็ง Mirrorjade ลงมามูฟมอนสเตอร์อีกฝ่ายแบบไม่เล็งเป้า!',
    comboGuide: [
      '1. Use Branded Opening or Aluber to search Branded Fusion from Deck.',
      '2. Activate Branded Fusion to send Fallen of Albaz + Despian Tragedy from Deck for Mirrorjade or Lubellion!',
      '3. Trigger Despian Tragedy in GY to add another Despia monster cleanly.',
      "4. Mirrorjade's Quick Effect banishes any monster on either turn and nukes opposing monsters if destroyed!"
    ],
    comboGuideTh: [
      '1. ใช้ Branded Opening หรืออัญเชิญปกติ Aluber the Jester of Despia เพื่อค้นหา Branded Fusion ขึ้นมือ',
      '2. สั่งใช้งาน Branded Fusion ส่ง Despian Tragedy จากเด็คลงสุสาน พร้อมอัญเชิญฟิวชั่น Mirrorjade the Iceblade Dragon หรือ Lubellion!',
      '3. Despian Tragedy ที่ตกสุสานจะได้ค้นหามอนสเตอร์ Despia ขึ้นมือฟรีอีก 1 ใบ',
      '4. Mirrorjade มี Quick Effect มูฟมอนสเตอร์อีกฝ่ายออกนอกเกมได้ในเทิร์นของใครก็ได้ และถ้าถูกทำลายจะระเบิดมอนสเตอร์อีกฝ่ายยกสนาม!'
    ],
    mainDeckRecipe: [
      { id: 'fallen_of_albaz', count: 3 },
      { id: 'aluber_the_jester_of_despia', count: 3 },
      { id: 'despian_tragedy', count: 3 },
      { id: 'blazing_cartesia', count: 3 },
      { id: 'dramaturge_of_despia', count: 2 },
      { id: 'albion_the_shrouded_dragon', count: 2 },
      { id: 'ash_blossom', count: 3 },
      { id: 'maxx_c', count: 2 },
      { id: 'branded_fusion', count: 3 },
      { id: 'branded_opening', count: 3 },
      { id: 'branded_in_red', count: 3 },
      { id: 'called_by_the_grave', count: 2 },
      { id: 'monster_reborn', count: 1 },
      { id: 'raigeki', count: 1 },
      { id: 'harpies_feather_duster', count: 1 },
      { id: 'branded_banishment', count: 3 },
      { id: 'infinite_impermanence', count: 2 }
    ],
    extraDeckRecipe: [
      { id: 'mirrorjade_the_iceblade_dragon', count: 2 },
      { id: 'lubellion_the_searing_dragon', count: 2 },
      { id: 'albion_the_branded_dragon', count: 2 },
      { id: 'masquerade_the_blazing_dragon', count: 2 },
      { id: 'guardian_chimera', count: 2 },
      { id: 'baronne_de_fleur', count: 1 }
    ]
  },
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
