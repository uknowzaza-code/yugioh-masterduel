/**
 * @fileoverview Deck 5: Branded Despia (แบรนเด็ด เดสเปีย - เมต้าสายฟิวชั่นจากเด็ค & Mirrorjade)
 * เด็คฟิวชั่นระดับ Tier 1 ของ Master Duel ใช้ Aluber ค้นหา Branded Fusion เพื่อฟิวชั่นโดยส่งวัตถุดิบจากเด็คเรียก Albion / Lubellion ต่อยอดเป็น Mirrorjade!
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

export const BRANDED_DESPIA_CARDS = [
  {
    id: 'fallen_of_albaz',
    passcode: '68468459',
    name: 'Fallen of Albaz',
    nameTh: 'ผู้ร่วงหล่นแห่งอัลบาซ (Fallen of Albaz)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.DARK,
    race: 'Dragon',
    level: 4,
    atk: 1800,
    def: 0,
    archetype: 'Branded',
    subArchetypes: ['Albaz'],
    mentions: ['Fallen of Albaz'],
    description: 'If this card is Normal or Special Summoned (except during the Damage Step): You can discard 1 card; Fusion Summon 1 Fusion Monster from your Extra Deck using monsters on either field, including this card, but you cannot use other monsters you control as material. You can only use this effect of "Fallen of Albaz" once per turn.',
    descriptionTh: 'เมื่ออัญเชิญปกติหรือพิเศษสำเร็จ: ทิ้งการ์ดบนมือ 1 ใบ; อัญเชิญฟิวชั่นมอนสเตอร์สาย "Branded" จาก Extra Deck ทันที!',
    effects: [
      {
        id: 'albaz_on_summon_fusion',
        labelTh: 'ทิ้งการ์ด 1 ใบ: อัญเชิญฟิวชั่นมอนสเตอร์สาย Branded!',
        trigger: TRIGGERS.ON_SUMMON_ANY,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'albaz_fusion_opt',
        cost: { discardHandCount: 1 },
        actions: [
          {
            type: ACTION_TYPES.FUSION_SUMMON,
            allowGYMaterials: true,
            fusionFilter: { archetype: ['Branded', 'Despia'] }
          }
        ]
      }
    ]
  },
  {
    id: 'aluber_the_jester_of_despia',
    passcode: '62962630',
    name: 'Aluber the Jester of Despia',
    nameTh: 'ตัวตลกแห่งเดสเปีย อลูเบอร์ (Aluber)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.DARK,
    race: 'Fairy',
    level: 4,
    atk: 1800,
    def: 0,
    archetype: 'Despia',
    subArchetypes: ['Branded'],
    mentions: ['Fallen of Albaz'],
    description: 'If this card is Normal or Special Summoned: You can add 1 "Branded" Spell/Trap from your Deck to your hand. If a face-up Fusion Monster you control is destroyed by battle, or leaves the field because of an opponent\'s card effect, while this card is in your GY: You can target 1 Effect Monster your opponent controls; Special Summon this card, and if you do, negate the targeted monster\'s effects until the end of this turn. You can only use 1 "Aluber the Jester of Despia" effect per turn, and only once that turn.',
    descriptionTh: 'เมื่ออัญเชิญปกติหรือพิเศษสำเร็จ: ค้นหาเวทมนตร์หรือกับดัก "Branded" (เช่น Branded Fusion หรือ Branded Opening) 1 ใบจากเด็คขึ้นมือ! (ใช้ได้เทิร์นละ 1 ครั้ง)',
    effects: [
      {
        id: 'aluber_search_branded',
        labelTh: 'ค้นหาเวทมนตร์/กับดัก "Branded" 1 ใบจากเด็คขึ้นมือ!',
        trigger: TRIGGERS.ON_SUMMON_ANY,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'aluber_search_opt',
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: {
              archetype: 'Branded',
              kind: [CARD_KINDS.SPELL, CARD_KINDS.TRAP]
            }
          }
        ]
      }
    ]
  },
  {
    id: 'despian_tragedy',
    passcode: '36577931',
    name: 'Despian Tragedy',
    nameTh: 'โศกนาฏกรรมแห่งเดสเปีย (Despian Tragedy)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.DARK,
    race: 'Fairy',
    level: 1,
    atk: 400,
    def: 400,
    archetype: 'Despia',
    subArchetypes: ['Branded'],
    description: 'If this card is sent to the GY, or banished, by card effect: You can add 1 "Despia" monster from your Deck to your hand, except "Despian Tragedy". You can banish this card from your GY, then target 1 "Branded" Spell/Trap in your GY; Set it to your field. You can only use 1 "Despian Tragedy" effect per turn, and only once that turn.',
    descriptionTh: '(1) เมื่อถูกส่งลงสุสาน: ค้นหามอนสเตอร์ "Despia" (เช่น Aluber หรือ Dramaturge) 1 ใบจากเด็คขึ้นมือ! (2) มูฟการ์ดใบนี้จากสุสาน; เก็บเวทมนตร์/กับดัก "Branded" จากสุสานขึ้นมือ 1 ใบ',
    effects: [
      {
        id: 'tragedy_search_despia',
        labelTh: 'ค้นหามอนสเตอร์ Despia 1 ใบจากเด็คขึ้นมือ',
        trigger: TRIGGERS.ON_SEND_TO_GY,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'tragedy_search_opt',
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: { archetype: 'Despia', kind: CARD_KINDS.MONSTER, excludeId: 'despian_tragedy' }
          }
        ]
      },
      {
        id: 'tragedy_gy_recover',
        labelTh: 'มูฟจากสุสาน: เก็บเวท/กับดัก Branded จากสุสานขึ้นมือ',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['GY'],
        opt: 'tragedy_recover_opt',
        cost: { banishSelf: true },
        actions: [
          {
            type: ACTION_TYPES.RECOVER_FROM_GY_TO_HAND,
            count: 1,
            filter: { archetype: 'Branded', kind: [CARD_KINDS.SPELL, CARD_KINDS.TRAP] }
          }
        ]
      }
    ]
  },
  {
    id: 'blazing_cartesia',
    passcode: '95515789',
    name: 'Blazing Cartesia, the Virtuous',
    nameTh: 'นักบุญหญิงเพลิงแดง คาร์เทเซีย (Blazing Cartesia)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Spellcaster',
    level: 4,
    isTuner: true,
    atk: 1500,
    def: 1500,
    archetype: 'Branded',
    subArchetypes: ['Despia'],
    mentions: ['Fallen of Albaz'],
    specialSummonRule: {
      fromZone: 'HAND',
      labelTh: 'อัญเชิญพิเศษ Cartesia จากมือ',
      opt: 'cartesia_ss_opt'
    },
    description: 'If you have "Fallen of Albaz" in your field or GY: You can Special Summon this card from your hand. During the Main Phase (Quick Effect): You can Fusion Summon 1 Level 8 or higher Fusion Monster from your Extra Deck, using monsters from your hand or field. During the End Phase, if a Fusion Monster(s) was sent to your GY this turn: You can add this card from the GY to your hand. You can only use each effect of "Blazing Cartesia, the Virtuous" once per turn.',
    descriptionTh: '[จูนเนอร์ Lv.4] (1) อัญเชิญพิเศษจากมือได้ (2) [เอฟเฟคความเร็วสูง] อัญเชิญฟิวชั่นมอนสเตอร์ Lv.8 ขึ้นไปจาก Extra Deck โดยใช้วัตถุดิบจากมือหรือสนาม!',
    effects: [
      {
        id: 'cartesia_quick_fusion',
        labelTh: 'อัญเชิญฟิวชั่นมอนสเตอร์ Lv.8+ (Quick Effect)',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['MMZ', 'EMZ'],
        opt: 'cartesia_fusion_opt',
        actions: [
          {
            type: ACTION_TYPES.FUSION_SUMMON,
            fusionFilter: { levelMin: 8 }
          }
        ]
      }
    ]
  },
  {
    id: 'dramaturge_of_despia',
    passcode: '99456344',
    name: 'Dramaturge of Despia',
    nameTh: 'ผู้กำกับละครแห่งเดสเปีย (Dramaturge)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.DARK,
    race: 'Fairy',
    level: 8,
    atk: 3000,
    def: 1500,
    archetype: 'Despia',
    subArchetypes: ['Branded'],
    description: 'If a Fusion, Synchro, Xyz, or Link Monster is Special Summoned (except during the Damage Step): You can target 1 Effect Monster on the field; negate its effects until the end of this turn. If this card in your hand or field is used as Fusion Material, and sent to the GY or banished: You can Special Summon this card. You can only use each effect of "Dramaturge of Despia" once per turn.',
    descriptionTh: '(1) เมื่อถูกส่งลงสุสาน (เช่น ใช้เป็นวัตถุดิบฟิวชั่น): อัญเชิญพิเศษตัวเองกลับลงสนามทันที! (2) เทิร์นละครั้ง: ใบ้เอฟเฟคมอนสเตอร์ของอีกฝ่าย 1 ใบ!',
    effects: [
      {
        id: 'dramaturge_self_revive',
        labelTh: 'ชุบชีวิต Dramaturge จากสุสานเมื่อถูกส่งลงสุสาน!',
        trigger: TRIGGERS.ON_SEND_TO_GY,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'dramaturge_revive_opt',
        actions: [
          { type: ACTION_TYPES.SPECIAL_SUMMON_SELF_FROM_GY }
        ]
      },
      {
        id: 'dramaturge_negate',
        labelTh: 'ใบ้เอฟเฟคมอนสเตอร์ของอีกฝ่าย 1 ใบ',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['MMZ', 'EMZ'],
        opt: 'dramaturge_negate_opt',
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
    id: 'albion_the_shrouded_dragon',
    passcode: '25451383',
    name: 'Albion the Shrouded Dragon',
    nameTh: 'อัลเบี้ยน มังกรทมิฬซ่อนเร้น (Shrouded Albion)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.DARK,
    race: 'Dragon',
    level: 8,
    atk: 2500,
    def: 2000,
    archetype: 'Branded',
    mentions: ['Fallen of Albaz'],
    description: 'This card\'s name becomes "Fallen of Albaz" while on the field or in the GY. If this card is in your hand or GY: You can send 1 "Fallen of Albaz" or 1 "Branded" Spell/Trap from your hand or Deck to the GY; apply the following effect based on where you sent it from.\n● Hand: Special Summon this card.\n● Deck: Place this card on the bottom of the Deck, then if you placed this card from your hand, draw 1 card.\nYou can only use this effect of "Albion the Shrouded Dragon" once per turn.',
    descriptionTh: 'ส่งการ์ดใบนี้จากมือลงสุสาน พร้อมส่งการ์ด "Branded" 1 ใบจากเด็คลงสุสาน; จากนั้นจั่วการ์ด 1 ใบ! (ใช้ได้เทิร์นละ 1 ครั้ง)',
    effects: [
      {
        id: 'shrouded_albion_draw',
        labelTh: 'ส่งลงสุสาน: ส่งการ์ด Branded จากเด็คลงสุสาน & จั่ว 1 ใบ',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['HAND'],
        opt: 'shrouded_albion_opt',
        cost: { discardSelf: true },
        actions: [
          {
            type: ACTION_TYPES.SEND_FROM_DECK_TO_GY,
            count: 1,
            filter: { archetype: ['Branded', 'Despia'] }
          },
          { type: ACTION_TYPES.DRAW, count: 1 }
        ]
      }
    ]
  },
  {
    id: 'branded_fusion',
    passcode: '44362883',
    name: 'Branded Fusion',
    nameTh: 'แบรนเด็ด ฟิวชั่น (Branded Fusion)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.NORMAL,
    archetype: 'Branded',
    mentions: ['Fallen of Albaz'],
    description: 'Fusion Summon 1 Fusion Monster that mentions "Fallen of Albaz" as material from your Extra Deck, using 2 monsters from your hand, Deck, or field. You cannot Special Summon from the Extra Deck, except Fusion Monsters, the turn you activate this card. You can only activate 1 "Branded Fusion" per turn.',
    descriptionTh: '[เวทมนตร์ปกติ] สุดยอดเวทฟิวชั่นประจำเด็ค! ส่งมอนสเตอร์วัตถุดิบจากในเด็ค/มือลงสุสาน แล้วอัญเชิญฟิวชั่นมอนสเตอร์สาย "Branded" (เช่น Mirrorjade, Albion, Lubellion) จาก Extra Deck ทันที! (ใช้ได้เทิร์นละ 1 ครั้ง)',
    effects: [
      {
        id: 'branded_fusion_activate',
        labelTh: 'อัญเชิญฟิวชั่นจาก Extra Deck โดยส่งวัตถุดิบจากเด็คได้!',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'branded_fusion_opt',
        actions: [
          {
            type: ACTION_TYPES.SEND_FROM_DECK_TO_GY,
            count: 1,
            optional: true,
            filter: { archetype: ['Branded', 'Despia'], kind: CARD_KINDS.MONSTER }
          },
          {
            type: ACTION_TYPES.FUSION_SUMMON,
            allowDeckMaterials: true,
            allowGYMaterials: true,
            fusionFilter: { archetype: ['Branded', 'Despia'] }
          }
        ]
      }
    ]
  },
  {
    id: 'branded_opening',
    passcode: '36637374',
    name: 'Branded Opening',
    nameTh: 'เปิดม่านแบรนเด็ด (Branded Opening)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.QUICK_PLAY,
    archetype: 'Branded',
    description: 'Discard 1 card, then take 1 "Despia" monster from your Deck, and either add it to your hand or Special Summon it in Defense Position, also for the rest of this turn after this card resolves, you cannot Special Summon from the Extra Deck, except Fusion Monsters. If a Fusion Monster(s) you control would be destroyed by card effect, you can banish this card from your GY instead. You can only use each effect of "Branded Opening" once per turn.',
    descriptionTh: '[เวทมนตร์ความเร็วสูง] ทิ้งการ์ดบนมือ 1 ใบ; อัญเชิญพิเศษมอนสเตอร์ "Despia" (เช่น Aluber หรือ Dramaturge) 1 ใบจากเด็คลงสนามทันที! (ใช้ได้เทิร์นละ 1 ครั้ง)',
    effects: [
      {
        id: 'branded_opening_ss',
        labelTh: 'ทิ้งการ์ด 1 ใบ: อัญเชิญพิเศษมอนสเตอร์ Despia 1 ใบจากเด็ค!',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
        opt: 'branded_opening_opt',
        cost: { discardHandCount: 1 },
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_DECK,
            count: 1,
            filter: { archetype: 'Despia', kind: CARD_KINDS.MONSTER }
          }
        ]
      }
    ]
  },
  {
    id: 'branded_in_red',
    passcode: '82738008',
    name: 'Branded in Red',
    nameTh: 'ตราประทับสีชาด (Branded in Red)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.QUICK_PLAY,
    archetype: 'Branded',
    mentions: ['Fallen of Albaz'],
    description: 'Target 1 "Despia" monster or "Fallen of Albaz" in your GY; add it to your hand, then you can apply the following effect.\n● Fusion Summon 1 Level 8 or higher Fusion Monster from your Extra Deck, by banishing Fusion Materials mentioned on it from your hand or field, but it cannot attack directly this turn.\nYou can only activate 1 "Branded in Red" per turn.',
    descriptionTh: '[เวทมนตร์ความเร็วสูง] เก็บมอนสเตอร์ "Despia" หรือ "Fallen of Albaz" จากสุสานขึ้นมือ 1 ใบ จากนั้นสามารถอัญเชิญฟิวชั่นมอนสเตอร์ Lv.8+ จาก Extra Deck ได้ทันที!',
    effects: [
      {
        id: 'branded_in_red_activate',
        labelTh: 'เก็บ Despia/Albaz จากสุสาน & อัญเชิญฟิวชั่น Lv.8+!',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
        opt: 'branded_in_red_opt',
        actions: [
          {
            type: ACTION_TYPES.RECOVER_FROM_GY_TO_HAND,
            count: 1,
            optional: true,
            filter: { archetype: ['Despia', 'Branded'], kind: CARD_KINDS.MONSTER }
          },
          {
            type: ACTION_TYPES.FUSION_SUMMON,
            allowGYMaterials: true,
            fusionFilter: { levelMin: 8 }
          }
        ]
      }
    ]
  },
  {
    id: 'branded_banishment',
    passcode: '6763530',
    name: 'Branded Banishment',
    nameTh: 'การเนรเทศแห่งตราประทับ (Branded Banishment)',
    kind: CARD_KINDS.TRAP,
    subType: TRAP_SUBTYPES.NORMAL,
    archetype: 'Branded',
    description: 'Target 1 "Despia" monster or 1 Level 8 or higher Fusion Monster in your GY; Special Summon it, then you can apply this effect.\n● Fusion Summon 1 Level 8 or higher Fusion Monster from your Extra Deck, by banishing Fusion Materials mentioned on it from either field.\nYou can only activate 1 "Branded Banishment" per turn.',
    descriptionTh: '[กับดักปกติ] ชุบชีวิตมอนสเตอร์ "Despia" หรือมอนสเตอร์ฟิวชั่น Lv.8 ขึ้นไป 1 ใบจากสุสานของเราลงสนาม!',
    effects: [
      {
        id: 'banishment_revive',
        labelTh: 'ชุบชีวิตมอนสเตอร์ Despia / ฟิวชั่น Lv.8+ จากสุสาน',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
        opt: 'branded_banishment_opt',
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_GY,
            targetOwner: 'SELF',
            count: 1,
            filter: { archetype: ['Branded', 'Despia'], kind: CARD_KINDS.MONSTER }
          }
        ]
      }
    ]
  },
  // === EXTRA DECK ===
  {
    id: 'mirrorjade_the_iceblade_dragon',
    passcode: '44146295',
    name: 'Mirrorjade the Iceblade Dragon',
    nameTh: 'มังกรคมดาบน้ำแข็ง มิเรอร์เจด (Mirrorjade)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.FUSION,
    attribute: ATTRIBUTES.WATER,
    race: 'Wyrm',
    level: 8,
    atk: 3000,
    def: 2500,
    archetype: 'Branded',
    mentions: ['Fallen of Albaz'],
    summonMaterials: {
      type: 'FUSION',
      count: 2,
      filter: { kind: CARD_KINDS.MONSTER },
      descriptionTh: '"Fallen of Albaz" + มอนสเตอร์ฟิวชั่น/ซิงโคร/เอ็กシーズ/ลิงก์ หรือมอนสเตอร์สาย Branded/Despia'
    },
    description: '"Fallen of Albaz" + 1 Fusion, Synchro, Xyz, or Link Monster\nYou can only control 1 "Mirrorjade the Iceblade Dragon". Once per turn (Quick Effect): You can send 1 Fusion Monster from your Extra Deck to the GY that mentions "Fallen of Albaz" as material; banish 1 monster on the field, also this card cannot use this effect next turn. If this Fusion Summoned card in its owner\'s control leaves the field by an opponent\'s card: You can destroy all monsters your opponent controls during the End Phase of this turn.',
    descriptionTh: '[ฟิวชั่น Lv.8] (1) [เอฟเฟคความเร็วสูง] มูฟมอนสเตอร์บนสนามของอีกฝ่าย 1 ใบออกนอกเกมแบบไม่เล็งเป้า! (2) เมื่อถูกทำลาย: ทำลายมอนสเตอร์บนสนามของอีกฝ่ายทั้งหมด!',
    effects: [
      {
        id: 'mirrorjade_quick_banish',
        labelTh: 'มูฟมอนสเตอร์บนสนามอีกฝ่าย 1 ใบออกนอกเกม (Quick Effect)',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['MMZ', 'EMZ'],
        opt: 'mirrorjade_banish_opt',
        condition: { opponentControlsMonster: true },
        actions: [
          {
            type: ACTION_TYPES.BANISH_CARDS,
            sourceZone: 'MONSTER',
            targetOwner: 'OPPONENT',
            count: 1
          }
        ]
      },
      {
        id: 'mirrorjade_board_wipe',
        labelTh: 'ล้างบางมอนสเตอร์ของอีกฝ่ายทั้งหมดเมื่อถูกทำลาย!',
        trigger: TRIGGERS.ON_DESTROYED,
        spellSpeed: SPELL_SPEED.SS1,
        actions: [
          {
            type: ACTION_TYPES.DESTROY_CARDS,
            targetOwner: 'OPPONENT',
            targetZone: 'MONSTER',
            count: 99
          }
        ]
      }
    ]
  },
  {
    id: 'lubellion_the_searing_dragon',
    passcode: '70534340',
    name: 'Lubellion the Searing Dragon',
    nameTh: 'มังกรเพลิงผลาญ ลูเบลเลี่ยน (Lubellion)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.FUSION,
    attribute: ATTRIBUTES.DARK,
    race: 'Dragon',
    level: 8,
    atk: 2500,
    def: 3000,
    archetype: 'Branded',
    mentions: ['Fallen of Albaz'],
    summonMaterials: {
      type: 'FUSION',
      count: 2,
      filter: { kind: CARD_KINDS.MONSTER },
      descriptionTh: 'มอนสเตอร์ธาตุมืด 1 ใบ + "Fallen of Albaz"'
    },
    description: '1 DARK monster + "Fallen of Albaz"\nIf this card is Fusion Summoned: You can discard 1 card; Fusion Summon 1 Level 8 or lower Fusion Monster from your Extra Deck, except "Lubellion the Searing Dragon", by shuffling Fusion Materials mentioned on it into the Deck, from your monsters on the field, GY, and/or face-up banished cards. For the rest of this turn, this card cannot attack, also you cannot Special Summon from the Extra Deck, except Fusion Monsters. You can only use this effect of "Lubellion the Searing Dragon" once per turn.',
    descriptionTh: '[ฟิวชั่น Lv.8] เมื่อถูกอัญเชิญฟิวชั่นสำเร็จ: สามารถอัญเชิญฟิวชั่นมอนสเตอร์ Lv.8 อีกใบ (เช่น Mirrorjade) ต่อได้ทันที!',
    effects: [
      {
        id: 'lubellion_chain_fusion',
        labelTh: 'อัญเชิญฟิวชั่นต่ออีก 1 ใบ (เช่น Mirrorjade)!',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'lubellion_fusion_opt',
        actions: [
          {
            type: ACTION_TYPES.FUSION_SUMMON,
            allowGYMaterials: true,
            fusionFilter: { id: 'mirrorjade_the_iceblade_dragon' }
          }
        ]
      }
    ]
  },
  {
    id: 'albion_the_branded_dragon',
    passcode: '87746184',
    name: 'Albion the Branded Dragon',
    nameTh: 'มังกรตราประทับ อัลเบี้ยน (Albion the Branded Dragon)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.FUSION,
    attribute: ATTRIBUTES.DARK,
    race: 'Dragon',
    level: 8,
    atk: 2500,
    def: 2000,
    archetype: 'Branded',
    mentions: ['Fallen of Albaz'],
    summonMaterials: {
      type: 'FUSION',
      count: 2,
      filter: { kind: CARD_KINDS.MONSTER },
      descriptionTh: '"Fallen of Albaz" + มอนสเตอร์ธาตุแสง 1 ใบ'
    },
    description: '"Fallen of Albaz" + 1 LIGHT monster\nIf this card is Fusion Summoned: You can Fusion Summon 1 Level 8 or lower Fusion Monster from your Extra Deck, except "Albion the Branded Dragon", by banishing Fusion Materials mentioned on it from your hand, field, and/or GY. During the End Phase, if this card is in the GY because it was sent there this turn: You can add to your hand or Set 1 "Branded" Spell/Trap from your Deck. You can only use each effect of "Albion the Branded Dragon" once per turn.',
    descriptionTh: '[ฟิวชั่น Lv.8] เมื่อถูกอัญเชิญสำเร็จ (หรือเมื่อถูกส่งลงสุสาน): ค้นหาเวทมนตร์หรือกับดัก "Branded" 1 ใบจากเด็คขึ้นมือ!',
    effects: [
      {
        id: 'albion_on_summon_search',
        labelTh: 'ค้นหาเวทมนตร์/กับดัก Branded 1 ใบจากเด็คขึ้นมือ',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'albion_search_opt',
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: { archetype: 'Branded', kind: [CARD_KINDS.SPELL, CARD_KINDS.TRAP] }
          }
        ]
      }
    ]
  },
  {
    id: 'masquerade_the_blazing_dragon',
    passcode: '06855503',
    name: 'Masquerade the Blazing Dragon',
    nameTh: 'มังกรเพลิงหน้ากาก มาสเคอเรด (Masquerade)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.FUSION,
    attribute: ATTRIBUTES.DARK,
    race: 'Fiend',
    level: 8,
    atk: 2500,
    def: 2000,
    archetype: 'Despia',
    subArchetypes: ['Branded'],
    summonMaterials: {
      type: 'FUSION',
      count: 2,
      filter: { kind: CARD_KINDS.MONSTER },
      descriptionTh: 'มอนสเตอร์ "Despia" 1 ใบ + มอนสเตอร์ธาตุแสงหรือมืด 1 ใบ'
    },
    description: '1 "Despia" monster + 1 LIGHT or DARK monster\nWhile you control this Fusion Summoned card, your opponent must pay 600 LP to activate cards or effects. If your opponent controls a Ritual, Fusion, Synchro, Xyz, or Link Monster, while this card is in your GY (Quick Effect): You can Special Summon this card, but banish it when it leaves the field. You can only use this effect of "Masquerade the Blazing Dragon" once per turn.',
    descriptionTh: '[ฟิวชั่น Lv.8] (1) เมื่ออัญเชิญสำเร็จและเทิร์นละครั้ง: เผา LP ของอีกฝ่าย 600 LP! (2) หากอยู่ในสุสานและอีกฝ่ายมีมอนสเตอร์จาก Extra Deck สามารถชุบตัวเองจากสุสานได้!',
    effects: [
      {
        id: 'masquerade_tax_burn',
        labelTh: 'เผา LP ของอีกฝ่าย 600 LP (Tax Dragon)',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        actions: [
          { type: ACTION_TYPES.INFLICT_DAMAGE, amount: 600 }
        ]
      },
      {
        id: 'masquerade_ignition_burn',
        labelTh: 'ใช้เอฟเฟคเพลิงภาษี: เผา LP อีกฝ่าย 600 LP',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['MMZ', 'EMZ'],
        opt: 'masquerade_burn_opt',
        actions: [
          { type: ACTION_TYPES.INFLICT_DAMAGE, amount: 600 }
        ]
      }
    ]
  },
  {
    id: 'guardian_chimera',
    passcode: '11321089',
    name: 'Guardian Chimera',
    nameTh: 'การ์เดี้ยน คิเมร่า (Guardian Chimera)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.FUSION,
    attribute: ATTRIBUTES.DARK,
    race: 'Beast',
    level: 9,
    atk: 3300,
    def: 3300,
    archetype: 'Branded',
    summonMaterials: {
      type: 'FUSION',
      count: 2,
      filter: { kind: CARD_KINDS.MONSTER },
      descriptionTh: 'มอนสเตอร์ชื่อต่างกัน 2-3 ใบ'
    },
    description: '3 monsters with different names\nMust first be Fusion Summoned using only Fusion Materials from your hand and field, with at least 1 monster from each. If this card is Fusion Summoned by a Spell Card or effect: You can draw cards equal to the number of cards used as material from the hand, and if you do, destroy cards your opponent controls equal to the number of cards used as material from the field. You can only use this effect of "Guardian Chimera" once per turn. While "Polymerization" is in your GY, your opponent cannot target this card with card effects.',
    descriptionTh: '[ฟิวชั่น Lv.9] เมื่ออัญเชิญฟิวชั่นสำเร็จ: จั่วการ์ด 1 ใบ และทำลายการ์ดบนสนามของอีกฝ่าย 1 ใบทันที!',
    effects: [
      {
        id: 'chimera_draw_and_pop',
        labelTh: 'จั่วการ์ด 1 ใบ & ทำลายการ์ดของอีกฝ่าย 1 ใบ!',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'chimera_opt',
        actions: [
          { type: ACTION_TYPES.DRAW, count: 1 },
          {
            type: ACTION_TYPES.DESTROY_CARDS,
            targetOwner: 'OPPONENT',
            targetZone: 'ANY_FIELD',
            count: 1,
            optional: true
          }
        ]
      }
    ]
  }
];
