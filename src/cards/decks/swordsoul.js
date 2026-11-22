/**
 * @fileoverview Deck 4: Swordsoul Tenyi (ซอร์ดโซล เทนยี่ - เมต้าสายซิงโคร & โทเค็นจูนเนอร์)
 * สุดยอดเด็คซิงโครยอดฮิตใน Master Duel เสก Swordsoul Token (จูนเนอร์ Lv.4) จากตัวเองเพื่อซิงโคร Lv.8 Chixiao และ Lv.10 Chengying / Baronne ทันที!
 */

import {
  CARD_KINDS,
  MONSTER_FRAMES,
  SPELL_SUBTYPES,
  TRAP_SUBTYPES,
  ATTRIBUTES,
  TRIGGERS,
  ACTION_TYPES,
  SPELL_SPEED
} from '../../constants/gameConstants.js';

const SWORDSOUL_TOKEN_DEF = {
  id: 'swordsoul_token',
  name: 'Swordsoul Token',
  nameTh: 'ซอร์ดโซล โทเค็น (จูนเนอร์ Lv.4)',
  kind: CARD_KINDS.MONSTER,
  frame: MONSTER_FRAMES.TOKEN,
  attribute: ATTRIBUTES.WATER,
  race: 'Wyrm',
  level: 4,
  isTuner: true,
  atk: 0,
  def: 0,
  archetype: 'Swordsoul',
  descriptionTh: '[จูนเนอร์ Lv.4] โทเค็นมังกรมายาธาตุน้ำ ใช้เป็นวัตถุดิบซิงโครซัมมอนมอนสเตอร์ Lv.8 หรือ Lv.10 ได้ทันที!'
};

export const SWORDSOUL_CARDS = [
  {
    id: 'swordsoul_of_mo_ye',
    passcode: '20001443',
    name: 'Swordsoul of Mo Ye',
    nameTh: 'ซอร์ดโซล โม่เย่ (Mo Ye)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.WATER,
    race: 'Wyrm',
    level: 4,
    atk: 1700,
    def: 1800,
    archetype: 'Swordsoul',
    description: 'If this card is Normal or Special Summoned: You can reveal 1 "Swordsoul" card or 1 Wyrm monster in your hand; Special Summon 1 "Swordsoul Token" (Wyrm/Tuner/WATER/Level 4/ATK 0/DEF 0). If this card is sent to the GY as Synchro Material: You can draw 1 card.',
    descriptionTh: '(1) เมื่ออัญเชิญปกติหรือพิเศษสำเร็จ: เสก "Swordsoul Token" (จูนเนอร์ Lv.4) ลงสนาม 1 ตัวทันที! (2) เมื่อถูกส่งลงสุสาน (เช่น ใช้เป็นวัตถุดิบซิงโคร): จั่วการ์ด 1 ใบ!',
    effects: [
      {
        id: 'moye_spawn_token',
        labelTh: 'เสก Swordsoul Token (จูนเนอร์ Lv.4) ลงสนาม!',
        trigger: TRIGGERS.ON_SUMMON_ANY,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'moye_token_opt',
        actions: [
          {
            type: ACTION_TYPES.SPAWN_TOKEN,
            token: SWORDSOUL_TOKEN_DEF
          }
        ]
      },
      {
        id: 'moye_gy_draw',
        labelTh: 'จั่วการ์ด 1 ใบเมื่อถูกส่งลงสุสาน',
        trigger: TRIGGERS.ON_SEND_TO_GY,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'moye_draw_opt',
        actions: [
          { type: ACTION_TYPES.DRAW, count: 1 }
        ]
      }
    ]
  },
  {
    id: 'swordsoul_of_taia',
    passcode: '56495147',
    name: 'Swordsoul of Taia',
    nameTh: 'ซอร์ดโซล ไท่อา (Taia)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.WIND,
    race: 'Wyrm',
    level: 4,
    atk: 1800,
    def: 1500,
    archetype: 'Swordsoul',
    description: 'You can banish 1 "Swordsoul" card or 1 Wyrm monster from your GY; Special Summon 1 "Swordsoul Token" (Wyrm/Tuner/WATER/Level 4/ATK 0/DEF 0). If this card is sent to the GY as Synchro Material: You can send 1 "Swordsoul" card or 1 Wyrm monster from your Deck to the GY.',
    descriptionTh: '(1) เทิร์นละครั้ง: เสก "Swordsoul Token" (จูนเนอร์ Lv.4) ลงสนาม 1 ตัว (2) เมื่อถูกส่งลงสุสาน: ส่งการ์ด "Swordsoul" หรือเผ่า Wyrm 1 ใบจากเด็คลงสุสาน',
    effects: [
      {
        id: 'taia_spawn_token',
        labelTh: 'เสก Swordsoul Token (จูนเนอร์ Lv.4) ลงสนาม!',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['MMZ', 'EMZ'],
        opt: 'taia_token_opt',
        actions: [
          {
            type: ACTION_TYPES.SPAWN_TOKEN,
            token: SWORDSOUL_TOKEN_DEF
          }
        ]
      },
      {
        id: 'taia_gy_dump',
        labelTh: 'ส่งการ์ด Swordsoul/Wyrm 1 ใบจากเด็คลงสุสาน',
        trigger: TRIGGERS.ON_SEND_TO_GY,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'taia_dump_opt',
        actions: [
          {
            type: ACTION_TYPES.SEND_FROM_DECK_TO_GY,
            count: 1,
            filter: { archetype: ['Swordsoul', 'Tenyi'] }
          }
        ]
      }
    ]
  },
  {
    id: 'swordsoul_strategist_longyuan',
    passcode: '93490856',
    name: 'Swordsoul Strategist Longyuan',
    nameTh: 'กุนซือซอร์ดโซล หลงหยวน (Longyuan)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.FIRE,
    race: 'Wyrm',
    level: 6,
    atk: 1200,
    def: 2300,
    archetype: 'Swordsoul',
    description: 'You can discard 1 other "Swordsoul" card or 1 Wyrm monster; Special Summon this card from your hand, then you can Special Summon 1 "Swordsoul Token" (Wyrm/Tuner/WATER/Level 4/ATK 0/DEF 0). If this card is sent to the GY as Synchro Material: You can inflict 1200 damage to your opponent.',
    descriptionTh: '(1) ทิ้งการ์ดบนมือ 1 ใบ; อัญเชิญพิเศษการ์ดใบนี้จากมือ พร้อมเสก "Swordsoul Token" (จูนเนอร์ Lv.4) ลงสนามทันที! (รวมเลเวล 6+4 = ซิงโคร Lv.10 ได้เลย!) (2) เมื่อถูกส่งลงสุสาน: ยิงดาเมจ 1200 ใส่ LP อีกฝ่าย!',
    effects: [
      {
        id: 'longyuan_ss_and_token',
        labelTh: 'ทิ้งการ์ด 1 ใบ: อัญเชิญพิเศษ Longyuan + เสกจูนเนอร์ Lv.4!',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['HAND'],
        opt: 'longyuan_ss_opt',
        cost: { discardHandCount: 1 },
        actions: [
          { type: ACTION_TYPES.SPECIAL_SUMMON_SELF_FROM_HAND },
          {
            type: ACTION_TYPES.SPAWN_TOKEN,
            token: SWORDSOUL_TOKEN_DEF
          }
        ]
      },
      {
        id: 'longyuan_burn_1200',
        labelTh: 'สร้างความเสียหาย 1200 LP ใส่อีกฝ่าย',
        trigger: TRIGGERS.ON_SEND_TO_GY,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'longyuan_burn_opt',
        actions: [
          { type: ACTION_TYPES.INFLICT_DAMAGE, amount: 1200 }
        ]
      }
    ]
  },
  {
    id: 'incredible_ecclesia',
    passcode: '55273560',
    name: 'Incredible Ecclesia, the Virtuous',
    nameTh: 'นักบุญหญิงผู้บริสุทธิ์ เอคเคลเซีย (Ecclesia)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Spellcaster',
    level: 4,
    isTuner: true,
    atk: 1500,
    def: 1500,
    archetype: 'Swordsoul',
    mentions: ['Fallen of Albaz'],
    specialSummonRule: {
      fromZone: 'HAND',
      labelTh: 'อัญเชิญพิเศษ Ecclesia จากมือ',
      opt: 'ecclesia_ss_opt'
    },
    description: 'During the Main Phase (Quick Effect): You can Tribute this card; Special Summon 1 "Swordsoul" monster or 1 "Fallen of Albaz" from your hand or Deck.',
    descriptionTh: '[จูนเนอร์ Lv.4] (1) อัญเชิญพิเศษจากมือได้ (2) [เอฟเฟคความเร็วสูง] สังเวยการ์ดใบนี้; อัญเชิญพิเศษมอนสเตอร์ "Swordsoul" (เช่น Mo Ye หรือ Taia) 1 ใบจากเด็คลงสนามทันที!',
    effects: [
      {
        id: 'ecclesia_tag_swordsoul',
        labelTh: 'สังเวยตัวเอง: อัญเชิญพิเศษมอนสเตอร์ Swordsoul จากเด็ค!',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['MMZ', 'EMZ'],
        opt: 'ecclesia_tag_opt',
        cost: { tributeSelf: true },
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_DECK,
            count: 1,
            filter: { archetype: 'Swordsoul', kind: CARD_KINDS.MONSTER, excludeId: 'incredible_ecclesia' }
          }
        ]
      }
    ]
  },
  {
    id: 'tenyi_spirit_ashuna',
    passcode: '87052196',
    name: 'Tenyi Spirit - Ashuna',
    nameTh: 'มังกรสวรรค์เทนยี่ - อาชูน่า (Ashuna)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Wyrm',
    level: 7,
    atk: 1600,
    def: 2600,
    archetype: 'Tenyi',
    specialSummonRule: {
      fromZone: 'HAND',
      labelTh: 'อัญเชิญพิเศษ Ashuna จากมือ',
      opt: 'ashuna_ss_opt'
    },
    description: 'If you control no Effect Monsters: You can Special Summon this card from your hand. You can banish this card from your GY; Special Summon 1 "Tenyi" monster from your Deck.',
    descriptionTh: '(1) อัญเชิญพิเศษการ์ดใบนี้จากมือได้ (2) มูฟการ์ดใบนี้จากสุสาน; อัญเชิญพิเศษมอนสเตอร์เผ่ามังกรมายา (Wyrm) 1 ใบจากเด็คลงสนาม!',
    effects: [
      {
        id: 'ashuna_gy_summon',
        labelTh: 'มูฟจากสุสาน: อัญเชิญพิเศษมอนสเตอร์เผ่า Wyrm จากเด็ค',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['GY'],
        opt: 'ashuna_gy_opt',
        cost: { banishSelf: true },
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_DECK,
            count: 1,
            filter: { race: 'Wyrm', kind: CARD_KINDS.MONSTER, excludeId: 'tenyi_spirit_ashuna' }
          }
        ]
      }
    ]
  },
  {
    id: 'tenyi_spirit_vishuda',
    passcode: '23431858',
    name: 'Tenyi Spirit - Vishuda',
    nameTh: 'มังกรสวรรค์เทนยี่ - วิชูด้า (Vishuda)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.DARK,
    race: 'Wyrm',
    level: 7,
    atk: 1500,
    def: 2500,
    archetype: 'Tenyi',
    specialSummonRule: {
      fromZone: 'HAND',
      labelTh: 'อัญเชิญพิเศษ Vishuda จากมือ',
      opt: 'vishuda_ss_opt'
    },
    description: 'If you control no Effect Monsters: You can Special Summon this card from your hand. You can banish this card from your GY, then target 1 card your opponent controls; return it to the hand.',
    descriptionTh: '(1) อัญเชิญพิเศษจากมือได้ (2) มูฟการ์ดใบนี้จากสุสานหรือบนมือ; ดีดการ์ดบนสนามของอีกฝ่าย 1 ใบกลับขึ้นมือ!',
    effects: [
      {
        id: 'vishuda_bounce',
        labelTh: 'มูฟจากสุสาน: ดีดการ์ดบนสนามอีกฝ่าย 1 ใบกลับขึ้นมือ!',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['GY'],
        opt: 'vishuda_bounce_opt',
        condition: { opponentControlsAnyCard: true },
        cost: { banishSelf: true },
        actions: [
          {
            type: ACTION_TYPES.RETURN_TO_HAND,
            targetOwner: 'OPPONENT',
            targetZone: 'ANY_FIELD',
            count: 1
          }
        ]
      }
    ]
  },
  {
    id: 'swordsoul_emergence',
    passcode: '56465981',
    name: 'Swordsoul Emergence',
    nameTh: 'การปรากฏกายของคมดาบซอร์ดโซล (Emergence)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.NORMAL,
    archetype: 'Swordsoul',
    description: 'Add 1 "Swordsoul" monster from your Deck to your hand, or, if you control a Synchro Monster, you can add 1 Wyrm monster instead.',
    descriptionTh: '[เวทมนตร์ปกติ] ค้นหามอนสเตอร์ "Swordsoul" หรือเผ่ามังกรมายา (Wyrm) 1 ใบจากเด็คขึ้นมือ (ใช้ได้เทิร์นละ 1 ครั้ง)',
    effects: [
      {
        id: 'emergence_search',
        labelTh: 'ค้นหามอนสเตอร์ Swordsoul / Wyrm 1 ใบจากเด็คขึ้นมือ',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'emergence_opt',
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: { kind: CARD_KINDS.MONSTER, race: 'Wyrm' }
          }
        ]
      }
    ]
  },
  {
    id: 'swordsoul_sacred_summit',
    passcode: '93850690',
    name: 'Swordsoul Sacred Summit',
    nameTh: 'ยอดเขาศักดิ์สิทธิ์แห่งซอร์ดโซล (Sacred Summit)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.NORMAL,
    archetype: 'Swordsoul',
    description: 'Target 1 "Swordsoul" monster in your GY, or, if you control a Synchro Monster, you can target 1 Wyrm monster instead; Special Summon it.',
    descriptionTh: '[เวทมนตร์ปกติ] ชุบชีวิตมอนสเตอร์ "Swordsoul" หรือเผ่า Wyrm 1 ใบจากสุสานของเราลงสนาม!',
    effects: [
      {
        id: 'summit_revive',
        labelTh: 'ชุบชีวิตมอนสเตอร์ Swordsoul / Wyrm จากสุสาน',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'summit_opt',
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_GY,
            targetOwner: 'SELF',
            count: 1,
            filter: { kind: CARD_KINDS.MONSTER, race: 'Wyrm' }
          }
        ]
      }
    ]
  },
  {
    id: 'swordsoul_blackout',
    passcode: '14821890',
    name: 'Swordsoul Blackout',
    nameTh: 'ค่ายกลดับสูญซอร์ดโซล (Swordsoul Blackout)',
    kind: CARD_KINDS.TRAP,
    subType: TRAP_SUBTYPES.NORMAL,
    archetype: 'Swordsoul',
    description: 'Target 1 Wyrm monster you control and 2 cards your opponent controls; destroy them.',
    descriptionTh: '[กับดักปกติ] ทำลายการ์ดบนสนามของอีกฝ่ายสูงสุด 2 ใบ!',
    effects: [
      {
        id: 'blackout_destroy_2',
        labelTh: 'ทำลายการ์ดของอีกฝ่ายสูงสุด 2 ใบ (Blackout)',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
        condition: { opponentControlsAnyCard: true },
        actions: [
          {
            type: ACTION_TYPES.DESTROY_CARDS,
            targetOwner: 'OPPONENT',
            targetZone: 'ANY_FIELD',
            count: 2
          }
        ]
      }
    ]
  },
  // === EXTRA DECK ===
  {
    id: 'swordsoul_grandmaster_chixiao',
    passcode: '69248256',
    name: 'Swordsoul Grandmaster - Chixiao',
    nameTh: 'ปรมาจารย์ซอร์ดโซล - ชื่อเซียว (Chixiao)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.SYNCHRO,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Wyrm',
    level: 8,
    atk: 2800,
    def: 1000,
    archetype: 'Swordsoul',
    summonMaterials: {
      type: 'SYNCHRO',
      tunerCount: 1,
      nonTunerMin: 1,
      descriptionTh: 'จูนเนอร์ 1 ใบ + มอนสเตอร์เผ่า Wyrm ที่ไม่ใช่จูนเนอร์ 1 ใบขึ้นไป (ผลรวมเลเวล = 8)'
    },
    description: '1 Tuner + 1+ non-Tuner Wyrm monsters. If this card is Synchro Summoned: You can add to your hand or banish 1 "Swordsoul" card from your Deck. (Quick Effect): You can banish 1 "Swordsoul" card or 1 Wyrm monster from your hand or GY, then target 1 other Effect Monster on the field; negate its effects until the end of this turn.',
    descriptionTh: '[ซิงโคร Lv.8] (1) เมื่ออัญเชิญซิงโครสำเร็จ: ค้นหาการ์ด "Swordsoul" 1 ใบจากเด็คขึ้นมือ! (2) [เอฟเฟคความเร็วสูง] ใบ้เอฟเฟคมอนสเตอร์ของอีกฝ่าย 1 ใบจนจบเทิร์น!',
    effects: [
      {
        id: 'chixiao_search',
        labelTh: 'ค้นหาการ์ด Swordsoul 1 ใบจากเด็คขึ้นมือ',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'chixiao_search_opt',
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: { archetype: 'Swordsoul' }
          }
        ]
      },
      {
        id: 'chixiao_quick_negate',
        labelTh: 'ใบ้เอฟเฟคมอนสเตอร์ของอีกฝ่าย 1 ใบ (Quick Effect)',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['MMZ', 'EMZ'],
        opt: 'chixiao_negate_opt',
        condition: { opponentControlsMonster: true },
        actions: [
          {
            type: ACTION_TYPES.NEGATE_FACEUP_EFFECT,
            targetOwner: 'OPPONENT',
            count: 1,
            filter: { kind: CARD_KINDS.MONSTER, faceUp: true }
          }
        ]
      }
    ]
  },
  {
    id: 'swordsoul_supreme_sovereign_chengying',
    passcode: '96633955',
    name: 'Swordsoul Supreme Sovereign - Chengying',
    nameTh: 'จอมราชันย์ซอร์ดโซล - เฉิงอิ่ง (Chengying)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.SYNCHRO,
    attribute: ATTRIBUTES.WATER,
    race: 'Wyrm',
    level: 10,
    atk: 3000,
    def: 3000,
    archetype: 'Swordsoul',
    summonMaterials: {
      type: 'SYNCHRO',
      tunerCount: 1,
      nonTunerMin: 1,
      descriptionTh: 'จูนเนอร์ 1 ใบ + มอนสเตอร์ที่ไม่ใช่จูนเนอร์ 1 ใบขึ้นไป (ผลรวมเลเวล = 10)'
    },
    description: '1 Tuner + 1+ non-Tuner monsters. For each banished card, this card gains 100 ATK/DEF. If a card(s) is banished: You can banish 1 card each from your opponent\'s field and GY.',
    descriptionTh: '[ซิงโคร Lv.10] เทิร์นละครั้ง: เพิ่มพลังโจมตี +500 ATK และมูฟการ์ดบนสนามของอีกฝ่าย 1 ใบออกนอกเกม!',
    effects: [
      {
        id: 'chengying_banish',
        labelTh: 'เพิ่ม +500 ATK & มูฟการ์ดบนสนามอีกฝ่าย 1 ใบออกนอกเกม',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['MMZ', 'EMZ'],
        opt: 'chengying_opt',
        actions: [
          {
            type: ACTION_TYPES.MODIFY_STATS,
            targetSelf: true,
            atkDelta: 500,
            defDelta: 500
          },
          {
            type: ACTION_TYPES.BANISH_CARDS,
            sourceZone: 'ANY_FIELD',
            targetOwner: 'OPPONENT',
            count: 1,
            optional: true
          }
        ]
      }
    ]
  },
  {
    id: 'swordsoul_sinister_sovereign_qixing_longyuan',
    passcode: '47710198',
    name: 'Swordsoul Sinister Sovereign - Qixing Longyuan',
    nameTh: 'มารราชันย์ซอร์ดโซล - ชีซิง หลงหยวน (Qixing Longyuan)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.SYNCHRO,
    attribute: ATTRIBUTES.FIRE,
    race: 'Wyrm',
    level: 10,
    atk: 2900,
    def: 2300,
    archetype: 'Swordsoul',
    summonMaterials: {
      type: 'SYNCHRO',
      tunerCount: 1,
      nonTunerMin: 1,
      descriptionTh: 'จูนเนอร์ 1 ใบ + มอนสเตอร์เผ่า Wyrm ที่ไม่ใช่จูนเนอร์ 1 ใบขึ้นไป (ผลรวมเลเวล = 10)'
    },
    description: '1 Tuner + 1+ non-Tuner Wyrm monsters. If you Synchro Summon: You can draw 1 card. If your opponent Special Summons a monster(s) or activates a Spell/Trap (Quick Effect): Banish that card, and if you do, inflict 1200 damage to your opponent.',
    descriptionTh: '[ซิงโคร Lv.10] (1) เมื่ออัญเชิญสำเร็จ: จั่วการ์ด 1 ใบ (2) [เอฟเฟคความเร็วสูง] มูฟการ์ดบนสนามอีกฝ่าย 1 ใบออกนอกเกม และยิงดาเมจ 1200 LP!',
    effects: [
      {
        id: 'qixing_on_summon_draw',
        labelTh: 'จั่วการ์ด 1 ใบเมื่อซิงโครสำเร็จ',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        actions: [
          { type: ACTION_TYPES.DRAW, count: 1 }
        ]
      },
      {
        id: 'qixing_banish_burn',
        labelTh: 'มูฟการ์ดอีกฝ่าย 1 ใบ & ยิงดาเมจ 1200 LP (Quick Effect)',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['MMZ', 'EMZ'],
        opt: 'qixing_banish_opt',
        condition: { opponentControlsAnyCard: true },
        actions: [
          {
            type: ACTION_TYPES.BANISH_CARDS,
            sourceZone: 'ANY_FIELD',
            targetOwner: 'OPPONENT',
            count: 1
          },
          {
            type: ACTION_TYPES.INFLICT_DAMAGE,
            amount: 1200
          }
        ]
      }
    ]
  },
  {
    id: 'baxia_brightness_of_the_yang_zing',
    passcode: '83755611',
    name: 'Baxia, Brightness of the Yang Zing',
    nameTh: 'มังกรสวรรค์หยางซิง - ป้าเซี่ย (Baxia)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.SYNCHRO,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Wyrm',
    level: 8,
    atk: 2300,
    def: 2600,
    archetype: 'Yang Zing',
    summonMaterials: {
      type: 'SYNCHRO',
      tunerCount: 1,
      nonTunerMin: 1,
      descriptionTh: 'จูนเนอร์ 1 ใบ + มอนสเตอร์ที่ไม่ใช่จูนเนอร์ 1 ใบขึ้นไป (ผลรวมเลเวล = 8)'
    },
    description: '1 Tuner + 1+ non-Tuner monsters. When this card is Synchro Summoned: You can target cards on the field, up to the number of different original Attributes of the Wyrm monsters used for the Synchro Summon of this card; shuffle them into the Deck.',
    descriptionTh: '[ซิงโคร Lv.8] เมื่อถูกอัญเชิญซิงโครสำเร็จ: ดีดการ์ดบนสนามของอีกฝ่ายสูงสุด 2 ใบกลับขึ้นมือ/เด็ค!',
    effects: [
      {
        id: 'baxia_spin_2',
        labelTh: 'ดีดการ์ดบนสนามอีกฝ่ายสูงสุด 2 ใบกลับขึ้นมือ',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        condition: { opponentControlsAnyCard: true },
        actions: [
          {
            type: ACTION_TYPES.RETURN_TO_HAND,
            targetOwner: 'OPPONENT',
            targetZone: 'ANY_FIELD',
            count: 2
          }
        ]
      }
    ]
  }
];
