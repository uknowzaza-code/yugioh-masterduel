/**
 * @fileoverview Master Duel Core Constants & Enumerations
 * โครงสร้างค่าคงที่หลักของเกม Yu-Gi-Oh! Master Duel
 * ออกแบบให้เข้าใจง่าย และให้ AI ตัวอื่นสามารถอ้างอิงตอนสร้างการ์ดใหม่ได้ทันที
 */

export const INITIAL_LP = 8000;
export const INITIAL_HAND_SIZE = 5;
export const MAX_HAND_SIZE = 6;
export const MAIN_MONSTER_ZONES_COUNT = 5;
export const SPELL_TRAP_ZONES_COUNT = 5;

export const PHASES = Object.freeze({
  DP: 'DP',   // Draw Phase (ดรอว์เฟส)
  SP: 'SP',   // Standby Phase (สแตนด์บายเฟส)
  MP1: 'MP1', // Main Phase 1 (เมนเฟส 1)
  BP: 'BP',   // Battle Phase (แบทเทิลเฟส)
  MP2: 'MP2', // Main Phase 2 (เมนเฟส 2)
  EP: 'EP'    // End Phase (เอนด์เฟส)
});

export const PHASE_ORDER = [
  PHASES.DP,
  PHASES.SP,
  PHASES.MP1,
  PHASES.BP,
  PHASES.MP2,
  PHASES.EP
];

export const PHASE_METADATA = Object.freeze({
  [PHASES.DP]: {
    code: 'DP',
    nameTh: 'ดรอว์เฟส (Draw Phase)',
    hintTh: 'จั่วการ์ด 1 ใบจากเด็ค (ยกเว้นเทิร์นแรกสุดของเกม)'
  },
  [PHASES.SP]: {
    code: 'SP',
    nameTh: 'สแตนด์บายเฟส (Standby Phase)',
    hintTh: 'ช่วงทำงานของเอฟเฟคที่ระบุว่าทำงานใน Standby Phase'
  },
  [PHASES.MP1]: {
    code: 'MP1',
    nameTh: 'เมนเฟส 1 (Main Phase 1)',
    hintTh: 'อัญเชิญมอนสเตอร์, ใช้การ์ดเวทมนตร์, หมอบการ์ด, หรืออัญเชิญจาก Extra Deck'
  },
  [PHASES.BP]: {
    code: 'BP',
    nameTh: 'แบทเทิลเฟส (Battle Phase)',
    hintTh: 'คลิกมอนสเตอร์ที่ตั้งโจมตีเพื่อสั่งโจมตีมอนสเตอร์อีกฝ่ายหรือโจมตีผู้เล่นโดยตรง'
  },
  [PHASES.MP2]: {
    code: 'MP2',
    nameTh: 'เมนเฟส 2 (Main Phase 2)',
    hintTh: 'เตรียมแนวป้องกัน หมอบกับดัก หรืออัญเชิญมอนสเตอร์เพิ่มเติมหลังจบการต่อสู้'
  },
  [PHASES.EP]: {
    code: 'EP',
    nameTh: 'เอนด์เฟส (End Phase)',
    hintTh: 'จบเทิร์น และทำงานเอฟเฟคช่วงจบเทิร์น'
  }
});

export const ZONES = Object.freeze({
  DECK: 'DECK',
  EXTRA: 'EXTRA',
  HAND: 'HAND',
  MMZ: 'MMZ',       // Main Monster Zone (0..4)
  EMZ: 'EMZ',       // Extra Monster Zone (0..1)
  STZ: 'STZ',       // Spell & Trap Zone (0..4)
  FIELD: 'FIELD',   // Field Spell Zone
  GY: 'GY',         // Graveyard (สุสาน)
  BANISHED: 'BANISHED' // Banished (นอกเกม)
});

export const CARD_KINDS = Object.freeze({
  MONSTER: 'MONSTER',
  SPELL: 'SPELL',
  TRAP: 'TRAP',
  TOKEN: 'TOKEN'
});

export const MONSTER_FRAMES = Object.freeze({
  NORMAL: 'NORMAL',     // มอนสเตอร์ปกติ (กรอบเหลือง)
  EFFECT: 'EFFECT',     // มอนสเตอร์เอฟเฟค (กรอบส้ม)
  FUSION: 'FUSION',     // มอนสเตอร์ฟิวชั่น (กรอบม่วง)
  SYNCHRO: 'SYNCHRO',   // มอนสเตอร์ซิงโคร (กรอบขาว)
  XYZ: 'XYZ',           // มอนสเตอร์เอ็กシーズ (กรอบดำ)
  LINK: 'LINK',         // มอนสเตอร์ลิงก์ (กรอบน้ำเงินเข้ม)
  TOKEN: 'TOKEN'        // มอนสเตอร์โทเค็น (กรอบเทา)
});

export const SPELL_SUBTYPES = Object.freeze({
  NORMAL: 'NORMAL',         // เวทมนตร์ปกติ
  QUICK_PLAY: 'QUICK_PLAY', // เวทมนตร์ความเร็วสูง (Spell Speed 2)
  CONTINUOUS: 'CONTINUOUS', // เวทมนตร์ต่อเนื่อง
  EQUIP: 'EQUIP',           // เวทมนตร์สวมใส่
  FIELD: 'FIELD',           // เวทมนตร์สนาม
  RITUAL: 'RITUAL'          // เวทมนตร์พิธีกรรม
});

export const TRAP_SUBTYPES = Object.freeze({
  NORMAL: 'NORMAL',         // กับดักปกติ (Spell Speed 2)
  CONTINUOUS: 'CONTINUOUS', // กับดักต่อเนื่อง (Spell Speed 2)
  COUNTER: 'COUNTER'        // กับดักเคาน์เตอร์ (Spell Speed 3)
});

export const ATTRIBUTES = Object.freeze({
  LIGHT: 'LIGHT',
  DARK: 'DARK',
  WATER: 'WATER',
  FIRE: 'FIRE',
  EARTH: 'EARTH',
  WIND: 'WIND',
  DIVINE: 'DIVINE'
});

export const ATTRIBUTE_LABELS_TH = Object.freeze({
  LIGHT: 'แสง (LIGHT)',
  DARK: 'มืด (DARK)',
  WATER: 'น้ำ (WATER)',
  FIRE: 'ไฟ (FIRE)',
  EARTH: 'ดิน (EARTH)',
  WIND: 'ลม (WIND)',
  DIVINE: 'เทพ (DIVINE)'
});

export const POSITIONS = Object.freeze({
  ATK: 'ATK',         // หงายหน้าตั้งโจมตี
  DEF: 'DEF',         // หงายหน้าตั้งป้องกัน
  SET_DEF: 'SET_DEF', // คว่ำหน้าตั้งป้องกัน
  FACE_UP: 'FACE_UP', // เวท/กับดักหงายหน้า
  SET: 'SET'          // เวท/กับดักหมอบคว่ำ
});

export const SPELL_SPEED = Object.freeze({
  SS1: 1, // Normal Spells, Ignition Effects, Trigger Effects
  SS2: 2, // Quick-Play Spells, Normal/Continuous Traps, Monster Quick Effects
  SS3: 3  // Counter Traps
});

export const CHAIN_MODE = Object.freeze({
  AUTO: 'AUTO', // ถามเฉพาะจังหวะสำคัญเมื่ออีกฝ่ายทำแอคชั่น (แบบ Master Duel)
  ON: 'ON',     // ถามทุกจังหวะที่สามารถเชนได้
  OFF: 'OFF'    // ปิดการถามเชนชั่วคราว (ผ่านอัตโนมัติ)
});

export const TRIGGERS = Object.freeze({
  IGNITION: 'IGNITION',                         // กดใช้เองใน Main Phase (SS1)
  QUICK_EFFECT: 'QUICK_EFFECT',                 // เอฟเฟคความเร็วสูง ใช้เชนได้ (SS2)
  SPELL_ACTIVATE: 'SPELL_ACTIVATE',             // สั่งใช้งานการ์ดเวทมนตร์/กับดัก
  COUNTER_TRAP: 'COUNTER_TRAP',                 // เคาน์เตอร์แทร็ป (SS3)
  ON_NORMAL_SUMMON: 'ON_NORMAL_SUMMON',         // เมื่ออัญเชิญปกติสำเร็จ
  ON_SPECIAL_SUMMON: 'ON_SPECIAL_SUMMON',       // เมื่ออัญเชิญพิเศษสำเร็จ
  ON_SUMMON_ANY: 'ON_SUMMON_ANY',               // เมื่ออัญเชิญปกติหรือพิเศษสำเร็จ
  ON_SEND_TO_GY: 'ON_SEND_TO_GY',               // เมื่อถูกส่งลงสุสาน
  ON_BANISHED: 'ON_BANISHED',                   // เมื่อถูกมูฟออกนอกเกม
  ON_DESTROYED: 'ON_DESTROYED',                 // เมื่อถูกทำลาย
  ON_ATTACK_DECLARE: 'ON_ATTACK_DECLARE',       // เมื่อประกาศโจมตี
  ON_FLIP: 'ON_FLIP',                           // เมื่อถูกเปิดหงายหน้า (Flip)
  ON_OPPONENT_SPECIAL_SUMMON: 'ON_OPPONENT_SPECIAL_SUMMON', // เมื่ออีกฝ่ายอัญเชิญพิเศษสำเร็จ
  ON_END_PHASE: 'ON_END_PHASE',                 // ในช่วง End Phase
  CONTINUOUS_AURA: 'CONTINUOUS_AURA'            // เอฟเฟคติดตัวต่อเนื่องบนสนาม
});

export const ACTION_TYPES = Object.freeze({
  DRAW: 'DRAW',
  SEARCH_DECK: 'SEARCH_DECK',
  SEND_FROM_DECK_TO_GY: 'SEND_FROM_DECK_TO_GY',
  SPECIAL_SUMMON_FROM_HAND: 'SPECIAL_SUMMON_FROM_HAND',
  SPECIAL_SUMMON_FROM_GY: 'SPECIAL_SUMMON_FROM_GY',
  SPECIAL_SUMMON_FROM_DECK: 'SPECIAL_SUMMON_FROM_DECK',
  SPECIAL_SUMMON_FROM_EXTRA: 'SPECIAL_SUMMON_FROM_EXTRA',
  SPECIAL_SUMMON_SELF_FROM_HAND: 'SPECIAL_SUMMON_SELF_FROM_HAND',
  SPECIAL_SUMMON_SELF_FROM_GY: 'SPECIAL_SUMMON_SELF_FROM_GY',
  FUSION_SUMMON: 'FUSION_SUMMON',
  SPAWN_TOKEN: 'SPAWN_TOKEN',
  DESTROY_CARDS: 'DESTROY_CARDS',
  BANISH_CARDS: 'BANISH_CARDS',
  RETURN_TO_HAND: 'RETURN_TO_HAND',
  SEND_TO_GY: 'SEND_TO_GY',
  NEGATE_ACTIVATION: 'NEGATE_ACTIVATION',
  NEGATE_FACEUP_EFFECT: 'NEGATE_FACEUP_EFFECT',
  TAKE_CONTROL: 'TAKE_CONTROL',
  MODIFY_STATS: 'MODIFY_STATS',
  GAIN_LP: 'GAIN_LP',
  INFLICT_DAMAGE: 'INFLICT_DAMAGE',
  RECOVER_FROM_GY_TO_HAND: 'RECOVER_FROM_GY_TO_HAND',
  SET_FROM_DECK_OR_GY: 'SET_FROM_DECK_OR_GY',
  DETACH_MATERIAL: 'DETACH_MATERIAL',
  TRIBUTE_SELF: 'TRIBUTE_SELF',
  DISCARD_HAND: 'DISCARD_HAND',
  GRANT_IMMUNITY: 'GRANT_IMMUNITY',
  GRANT_MULTI_ATTACK: 'GRANT_MULTI_ATTACK',
  EXCAVATE_AND_PICK: 'EXCAVATE_AND_PICK',
  APPLY_TURN_EFFECT: 'APPLY_TURN_EFFECT',
  QUICK_LINK_OR_SYNCHRO: 'QUICK_LINK_OR_SYNCHRO'
});
