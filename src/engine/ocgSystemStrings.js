/**
 * ProjectIgnis / EDOPro system strings & description resolver
 * Cleanly separated from SQLite DB access for fast deterministic unit testing.
 */
import { readFileSync, existsSync } from 'node:fs';

export const OCG_SYSTEM_STRINGS = Object.freeze({
  // Core actions
  0: 'Activate Effect',
  1: 'Normal Summon',
  2: 'Special Summon',
  10: 'Set',
  11: 'Flip Summon',
  12: 'Change Position',

  // Coin toss
  60: 'Heads',
  61: 'Tails',

  // Card type declarations (e.g. SPYRAL Super Agent, Prohibition)
  70: 'Monster',
  71: 'Spell',
  72: 'Trap',

  // Phases
  80: 'Main Phase 1',
  81: 'Battle Phase',
  82: 'Main Phase 2',
  83: 'End Phase',

  // Yes / No
  90: 'Yes',
  91: 'No',

  // Battle positions & common prompts
  100: 'Face-up Attack Position',
  101: 'Face-up Defense Position',
  102: 'Face-down Defense Position',
  200: 'Apply Effect',
  201: 'Yes',
  202: 'No',

  // ProjectIgnis HINTMSG_* & option prompts (500..579)
  500: 'Select the card(s) to Tribute',
  501: 'Select the card(s) to discard',
  502: 'Select the card(s) to destroy',
  503: 'Select the card(s) to banish',
  504: 'Select the card(s) to send to the GY',
  505: 'Select the card(s) to return to the hand',
  506: 'Select the card(s) to add to your hand',
  507: 'Select the card(s) to return to the Deck',
  508: 'Select the card(s) to Normal Summon',
  509: 'Select the card(s) to Special Summon',
  510: 'Select the card(s) to Set',
  511: 'Select the Fusion Material(s)',
  512: 'Select the Synchro Material(s)',
  513: 'Select the Xyz Material(s)',
  514: 'Select face-up card(s)',
  515: 'Select face-down card(s)',
  516: 'Select Attack Position monster(s)',
  517: 'Select Defense Position monster(s)',
  518: 'Select the card(s) to equip',
  519: 'Select the material(s) to detach',
  520: 'Select the monster(s) to take control of',
  521: 'Select the card(s) to destroy instead',
  522: 'Select face-up Attack Position monster(s)',
  523: 'Select face-up Defense Position monster(s)',
  524: 'Select face-down Attack Position monster(s)',
  525: 'Select face-down Defense Position monster(s)',
  526: 'Select the card(s) to reveal',
  527: 'Select the card(s) to place on the field',
  528: 'Select the monster(s) to change position',
  529: 'Select your card(s)',
  530: "Select your opponent's card(s)",
  531: 'Select the monster(s) to Tribute for the Tribute Summon',
  532: 'Select the card to detach material from',
  533: 'Select the Link Material(s)',
  549: 'Select the attack target',
  550: 'Select the effect to activate',
  551: 'Select the target(s)',
  552: 'Call heads or tails',
  553: 'Select a die result',
  554: 'Select a card type',
  555: 'Select an option',
  556: 'Select the effect to apply',
  560: 'Select',
  561: 'Select a battle position',
  562: 'Declare an Attribute',
  563: 'Declare a Monster Type',
  564: 'Declare a card name',
  565: 'Declare a number',
  566: 'Select the effect to activate',
  567: 'Declare a Level/Rank',
  568: 'Select the card to resolve',
  569: 'Select a zone',
  570: 'Select zone(s) to make unusable',
  571: 'Select a zone to move to',
  572: 'Select the card(s) to place a counter on',
  573: 'Add to Hand', // ProjectIgnis aux.ToHandOrElse
  574: 'Send to GY',  // ProjectIgnis aux.ToHandOrElse
  575: 'Select the card(s) to negate its effects',
  576: 'Select the card(s) to change its ATK/DEF',
  577: 'Select the card(s) to apply the effect to',
  578: 'Select the card(s) to attach as material',
  579: 'Select the card(s) to return to the GY',

  // Attributes (1010..1016)
  1010: 'EARTH',
  1011: 'WATER',
  1012: 'FIRE',
  1013: 'WIND',
  1014: 'LIGHT',
  1015: 'DARK',
  1016: 'DIVINE',

  // Monster Races / Types (1020..1045)
  1020: 'Warrior',
  1021: 'Spellcaster',
  1022: 'Fairy',
  1023: 'Fiend',
  1024: 'Zombie',
  1025: 'Machine',
  1026: 'Aqua',
  1027: 'Pyro',
  1028: 'Rock',
  1029: 'Winged Beast',
  1030: 'Plant',
  1031: 'Insect',
  1032: 'Thunder',
  1033: 'Dragon',
  1034: 'Beast',
  1035: 'Beast-Warrior',
  1036: 'Dinosaur',
  1037: 'Fish',
  1038: 'Sea Serpent',
  1039: 'Reptile',
  1040: 'Psychic',
  1041: 'Divine-Beast',
  1042: 'Creator God',
  1043: 'Wyrm',
  1044: 'Cyberse',
  1045: 'Illusion',

  // Card Categories / Subtypes (1050..1076)
  1050: 'Monster',
  1051: 'Spell',
  1052: 'Trap',
  1054: 'Normal',
  1055: 'Effect',
  1056: 'Fusion',
  1057: 'Ritual',
  1058: 'Trap Monster',
  1059: 'Spirit',
  1060: 'Union',
  1061: 'Gemini',
  1062: 'Tuner',
  1063: 'Synchro',
  1064: 'Token',
  1066: 'Quick-Play',
  1067: 'Continuous',
  1068: 'Equip',
  1069: 'Field',
  1070: 'Counter',
  1071: 'Flip',
  1072: 'Toon',
  1073: 'Xyz',
  1074: 'Pendulum',
  1075: 'Special Summon',
  1076: 'Link',

  // General effect labels (1100..1115)
  1100: 'Destroy',
  1101: 'Send to GY',
  1102: 'Banish',
  1103: 'Return to Deck',
  1104: 'Return to Hand',
  1105: 'Add to Hand',
  1106: 'Draw',
  1107: 'Discard',
  1108: 'Special Summon',
  1109: 'Normal Summon',
  1110: 'Flip Summon',
  1111: 'Set',
  1112: 'Activate',
  1113: 'Equip',
  1114: 'Tribute',
  1115: 'Target',

  // ProjectIgnis Action / Summon Method / Prompt Options (1150..1214)
  1150: 'Activate',
  1151: 'Normal Summon',
  1152: 'Special Summon',
  1153: 'Set',
  1154: 'Flip Summon',
  1155: 'To Defense Position',
  1156: 'To Attack Position',
  1157: 'Attack',
  1158: 'View',
  1159: 'Set (Spell/Trap)',
  1160: 'Activate as Pendulum Spell',
  1161: 'Resolve Effect',
  1162: 'Reset Effect',
  1163: 'Pendulum Summon',
  1170: 'Fusion Summon',
  1171: 'Ritual Summon',
  1172: 'Synchro Summon',
  1173: 'Xyz Summon',
  1174: 'Link Summon',
  1190: 'Add to Hand',
  1191: 'Send to GY',
  1192: 'Banish',
  1193: 'Shuffle into Deck',
  1194: 'Place on Top of Deck',
  1195: 'Place on Bottom of Deck',
  1211: 'OK',
  1212: 'Cancel',
  1213: 'Yes',
  1214: 'No'
});

export const OCG_SYSTEM_STRINGS_TH = Object.freeze({
  0: 'เปิดใช้เอฟเฟกต์',
  1: 'อัญเชิญปกติ',
  2: 'อัญเชิญพิเศษ',
  10: 'เซ็ตการ์ด',
  11: 'อัญเชิญแบบพลิก',
  12: 'เปลี่ยนรูปแบบต่อสู้',

  60: 'หัว (Heads)',
  61: 'ก้อย (Tails)',

  70: 'มอนสเตอร์ (Monster)',
  71: 'เวทมนตร์ (Spell)',
  72: 'กับดัก (Trap)',

  80: 'Main Phase 1',
  81: 'Battle Phase',
  82: 'Main Phase 2',
  83: 'End Phase',

  90: 'ใช่',
  91: 'ไม่',

  100: 'ตั้งโจมตีหงายหน้า',
  101: 'ตั้งป้องกันหงายหน้า',
  102: 'หมอบป้องกันคว่ำหน้า',
  200: 'ใช้ผลเอฟเฟกต์',
  201: 'ใช่',
  202: 'ไม่',

  500: 'เลือกการ์ดที่จะสังเวย',
  501: 'เลือกการ์ดที่จะทิ้ง',
  502: 'เลือกการ์ดที่จะทำลาย',
  503: 'เลือกการ์ดที่จะนำออกจากเกม',
  504: 'เลือกการ์ดที่จะส่งลงสุสาน',
  505: 'เลือกการ์ดที่จะคืนกลับขึ้นมือ',
  506: 'เลือกการ์ดที่จะนำขึ้นมือ',
  507: 'เลือกการ์ดที่จะคืนกลับเด็ค',
  508: 'เลือกการ์ดที่จะอัญเชิญปกติ',
  509: 'เลือกการ์ดที่จะอัญเชิญพิเศษ',
  510: 'เลือกการ์ดที่จะเซ็ต',
  511: 'เลือกวัตถุดิบฟิวชั่น',
  512: 'เลือกวัตถุดิบซินโคร',
  513: 'เลือกวัตถุดิบเอ็กซีซ',
  514: 'เลือกการ์ดหงายหน้า',
  515: 'เลือกการ์ดคว่ำหน้า',
  516: 'เลือกมอนสเตอร์รูปแบบโจมตี',
  517: 'เลือกมอนสเตอร์รูปแบบป้องกัน',
  518: 'เลือกการ์ดที่จะสวมใส่',
  519: 'เลือกวัตถุดิบที่จะถอดออก',
  520: 'เลือกมอนสเตอร์ที่จะควบคุม',
  521: 'เลือกการ์ดที่จะทำลายแทน',
  522: 'เลือกมอนสเตอร์หงายหน้าโจมตี',
  523: 'เลือกมอนสเตอร์หงายหน้าป้องกัน',
  524: 'เลือกมอนสเตอร์คว่ำหน้าโจมตี',
  525: 'เลือกมอนสเตอร์คว่ำหน้าป้องกัน',
  526: 'เลือกการ์ดที่จะเปิดเผย',
  527: 'เลือกการ์ดที่จะวางบนสนาม',
  528: 'เลือกมอนสเตอร์ที่จะเปลี่ยนรูปแบบ',
  529: 'เลือกการ์ดของคุณ',
  530: 'เลือกการ์ดฝ่ายตรงข้าม',
  531: 'เลือกมอนสเตอร์สำหรับอัญเชิญสังเวย',
  532: 'เลือกการ์ดที่จะถอดวัตถุดิบออก',
  533: 'เลือกวัตถุดิบลิงก์',
  549: 'เลือกเป้าหมายการโจมตี',
  550: 'เลือกเอฟเฟกต์ที่จะเปิดใช้',
  551: 'เลือกเป้าหมาย',
  552: 'ทายหัวหรือก้อย',
  553: 'เลือกผลลูกเต๋า',
  554: 'เลือกประเภทการ์ด',
  555: 'เลือกตัวเลือก',
  556: 'เลือกเอฟเฟกต์ที่จะใช้ผล',
  560: 'เลือก',
  561: 'เลือกรูปแบบการต่อสู้',
  562: 'ประกาศธาตุ',
  563: 'ประกาศเผ่ามอนสเตอร์',
  564: 'ประกาศชื่อการ์ด',
  565: 'ประกาศตัวเลข',
  566: 'เลือกเอฟเฟกต์ที่จะเปิดใช้',
  567: 'ประกาศเลเวล / แรงก์',
  568: 'เลือกการ์ดที่จะใช้ผล',
  569: 'เลือกโซน',
  570: 'เลือกโซนที่จะล็อกไม่ให้ใช้งาน',
  571: 'เลือกโซนที่จะย้ายไป',
  572: 'เลือกการ์ดที่จะวางเคาน์เตอร์',
  573: 'นำขึ้นมือ (Add to Hand)',
  574: 'ส่งลงสุสาน (Send to GY)',
  575: 'เลือกการ์ดที่จะลบล้างเอฟเฟกต์',
  576: 'เลือกการ์ดที่จะเปลี่ยน ATK/DEF',
  577: 'เลือกการ์ดที่จะใช้ผล',
  578: 'เลือกการ์ดที่จะแนบเป็นวัตถุดิบ',
  579: 'เลือกการ์ดที่จะส่งกลับสุสาน',

  1010: 'ดิน (EARTH)',
  1011: 'น้ำ (WATER)',
  1012: 'ไฟ (FIRE)',
  1013: 'ลม (WIND)',
  1014: 'แสง (LIGHT)',
  1015: 'มืด (DARK)',
  1016: 'เทพ (DIVINE)',

  1020: 'นักรบ (Warrior)',
  1021: 'จอมเวท (Spellcaster)',
  1022: 'นางฟ้า (Fairy)',
  1023: 'ปิศาจ (Fiend)',
  1024: 'ซอมบี้ (Zombie)',
  1025: 'เครื่องจักร (Machine)',
  1026: 'สัตว์น้ำ (Aqua)',
  1027: 'เพลิง (Pyro)',
  1028: 'หิน (Rock)',
  1029: 'สัตว์ปีก (Winged Beast)',
  1030: 'พืช (Plant)',
  1031: 'แมลง (Insect)',
  1032: 'สายฟ้า (Thunder)',
  1033: 'มังกร (Dragon)',
  1034: 'สัตว์ป่า (Beast)',
  1035: 'นักรบสัตว์ (Beast-Warrior)',
  1036: 'ไดโนเสาร์ (Dinosaur)',
  1037: 'ปลา (Fish)',
  1038: 'มังกรทะเล (Sea Serpent)',
  1039: 'สัตว์เลื้อยคลาน (Reptile)',
  1040: 'พลังจิต (Psychic)',
  1041: 'สัตว์เทพ (Divine-Beast)',
  1042: 'ผู้สร้าง (Creator God)',
  1043: 'มังกรสวรรค์ (Wyrm)',
  1044: 'ไซเบอร์ส (Cyberse)',
  1045: 'มายา (Illusion)',

  1050: 'มอนสเตอร์',
  1051: 'เวทมนตร์',
  1052: 'กับดัก',
  1054: 'ปกติ',
  1055: 'เอฟเฟกต์',
  1056: 'ฟิวชั่น',
  1057: 'พิธีกรรม',
  1058: 'มอนสเตอร์กับดัก',
  1059: 'สปิริต',
  1060: 'ยูเนี่ยน',
  1061: 'เจมินี่',
  1062: 'จูนเนอร์',
  1063: 'ซินโคร',
  1064: 'โทเคน',
  1066: 'ความเร็วสูง',
  1067: 'ต่อเนื่อง',
  1068: 'สวมใส่',
  1069: 'ฟิลด์',
  1070: 'เคาน์เตอร์',
  1071: 'ฟลิป',
  1072: 'ตูน',
  1073: 'เอ็กซีซ',
  1074: 'เพนดูลัม',
  1075: 'อัญเชิญพิเศษ',
  1076: 'ลิงก์',

  1100: 'ทำลาย',
  1101: 'ส่งลงสุสาน',
  1102: 'นำออกจากเกม',
  1103: 'คืนเข้าเด็ค',
  1104: 'คืนขึ้นมือ',
  1105: 'นำขึ้นมือ',
  1106: 'จั่วการ์ด',
  1107: 'ทิ้งการ์ด',
  1108: 'อัญเชิญพิเศษ',
  1109: 'อัญเชิญปกติ',
  1110: 'อัญเชิญแบบพลิก',
  1111: 'เซ็ตการ์ด',
  1112: 'เปิดใช้งาน',
  1113: 'สวมใส่',
  1114: 'สังเวย',
  1115: 'เลือกเป้าหมาย',

  1150: 'เปิดใช้งาน',
  1151: 'อัญเชิญปกติ',
  1152: 'อัญเชิญพิเศษ',
  1153: 'เซ็ตการ์ด',
  1154: 'อัญเชิญแบบพลิก',
  1155: 'เปลี่ยนเป็นตั้งป้องกัน',
  1156: 'เปลี่ยนเป็นตั้งโจมตี',
  1157: 'โจมตี',
  1158: 'ดูการ์ด',
  1159: 'เซ็ต (เวท/กับดัก)',
  1160: 'ใช้เป็นเวทเพนดูลัม',
  1161: 'ใช้ผลเอฟเฟกต์',
  1162: 'รีเซ็ตเอฟเฟกต์',
  1163: 'อัญเชิญเพนดูลัม',
  1170: 'อัญเชิญฟิวชั่น',
  1171: 'อัญเชิญพิธีกรรม',
  1172: 'อัญเชิญซินโคร',
  1173: 'อัญเชิญเอ็กซีซ',
  1174: 'อัญเชิญลิงก์',
  1190: 'นำขึ้นมือ',
  1191: 'ส่งลงสุสาน',
  1192: 'นำออกจากเกม',
  1193: 'สับกลับเข้าเด็ค',
  1194: 'วางบนสุดของเด็ค',
  1195: 'วางใต้สุดของเด็ค',
  1211: 'ตกลง',
  1212: 'ยกเลิก',
  1213: 'ใช่',
  1214: 'ไม่'
});

const runtimeStrings = { en: new Map(), th: new Map() };

export function normalizeLang(lang) {
  return String(lang ?? 'en').toLowerCase().startsWith('th') ? 'th' : 'en';
}

export function parseStringsConf(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^!system\s+(\d+)\s+(.*\S)\s*$/.exec(line);
    if (m) map.set(Number(m[1]), m[2]);
  }
  return map;
}

export function loadStringsConf(filePath, lang = 'en', preserveExisting = true) {
  if (!filePath || !existsSync(filePath)) return 0;
  const parsed = parseStringsConf(readFileSync(filePath, 'utf8'));
  const norm = normalizeLang(lang);
  const builtin = norm === 'th' ? OCG_SYSTEM_STRINGS_TH : OCG_SYSTEM_STRINGS;
  const target = runtimeStrings[norm];
  for (const [id, text] of parsed) {
    if (preserveExisting && id in builtin) continue;
    target.set(id, text);
  }
  return parsed.size;
}

export function clearRuntimeStrings() {
  runtimeStrings.en.clear();
  runtimeStrings.th.clear();
}

export function getLocalizedOcgSystemString(id, lang = 'en') {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  const en = runtimeStrings.en.get(n) ?? OCG_SYSTEM_STRINGS[n] ?? null;
  if (normalizeLang(lang) === 'th') {
    return runtimeStrings.th.get(n) ?? OCG_SYSTEM_STRINGS_TH[n] ?? en;
  }
  return en;
}

function toBigIntSafe(v) {
  try {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'string' && v.trim() !== '') return BigInt(v.trim());
    const n = Number(v);
    return Number.isFinite(n) ? BigInt(Math.trunc(n)) : null;
  } catch {
    return null;
  }
}

export function genericOptionLabel(index, lang = 'en') {
  return normalizeLang(lang) === 'th' ? `ตัวเลือกที่ ${index + 1}` : `Option ${index + 1}`;
}

/**
 * Create a description resolver backed by card string lookup `(code, idx, lang) => string|null`.
 */
export function createDescriptionResolver(getCardString = () => null) {
  const lookup = (code, idx, lang) => {
    if (!Number.isSafeInteger(code) || code <= 0 || idx < 0 || idx > 15) return null;
    const s = getCardString(code, idx, lang);
    return typeof s === 'string' && s.trim() ? s : null;
  };

  return function resolveRawDescription(descId, fallbackCardCode = 0, lang = 'en') {
    const L = normalizeLang(lang);
    const big = toBigIntSafe(descId);
    if (big === null || big <= 0n) return null;

    // 1) ProjectIgnis system string IDs (0..65535) checked before classic 4-bit shift
    if (big < 0x10000n) {
      const sys = getLocalizedOcgSystemString(Number(big), L);
      if (sys) return sys;
    }

    // 2) EDOPro 64-bit aux.Stringid: (code << 20) + strIdx
    if (big >= 0x100000n) {
      const code20 = Number(big >> 20n);
      const idx20 = Number(big & 0xfffffn);
      const s20 = lookup(code20, idx20, L);
      if (s20) return s20;
    }

    // 3) Classic YGOPro Stringid: (code << 4) + strIdx
    if (big >= 16n && big < 0x100000000n) {
      const code4 = Number(big >> 4n);
      const idx4 = Number(big & 0xfn);
      const s4 = lookup(code4, idx4, L);
      if (s4) return s4;
    }

    // 4) Small string index relative to source card
    if (fallbackCardCode && big < 16n) {
      const sf = lookup(Number(fallbackCardCode), Number(big), L);
      if (sf) return sf;
    }

    return null;
  };
}
