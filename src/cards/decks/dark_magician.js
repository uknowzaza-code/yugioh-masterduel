/**
 * @fileoverview Deck 2: Dark Magician Spellcaster Control (แบล็คเมจิกเชี่ยน)
 * เด็คจอมเวทมนตร์ดำ เน้นคอมโบ Dark Magical Circle + Eternal Soul มูฟการ์ดอีกฝ่ายและชุบชีวิตต่อเนื่อง
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

export const DARK_MAGICIAN_CARDS = [
  {
    id: 'dark_magician',
    passcode: '46986414',
    name: 'Dark Magician',
    nameTh: 'แบล็คเมจิกเชี่ยน (Dark Magician)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.NORMAL,
    attribute: ATTRIBUTES.DARK,
    race: 'Spellcaster',
    level: 7,
    atk: 2500,
    def: 2100,
    archetype: 'Dark Magician',
    mentions: ['Dark Magician'],
    description: 'The ultimate wizard in terms of attack and defense.',
    descriptionTh: 'จอมเวทมนตร์ดำผู้มีพลังโจมตีและป้องกันระดับสูงสุดในหมู่จอมเวท',
    effects: []
  },
  {
    id: 'dark_magician_girl',
    passcode: '38033121',
    name: 'Dark Magician Girl',
    nameTh: 'แบล็คเมจิกเชี่ยนเกิร์ล (Dark Magician Girl)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.DARK,
    race: 'Spellcaster',
    level: 6,
    atk: 2000,
    def: 1700,
    archetype: 'Dark Magician',
    mentions: ['Dark Magician'],
    description: 'Gains 300 ATK for every "Dark Magician" in the GY.',
    descriptionTh: 'เมื่ออัญเชิญลงสนาม: ได้รับพลังโจมตี +600 ATK ทันทีหากมีจอมเวทมนตร์ดำช่วยเสริมพลัง',
    effects: [
      {
        id: 'dmg_boost',
        labelTh: 'เพิ่มพลังโจมตี +600 ATK',
        trigger: TRIGGERS.ON_SUMMON_ANY,
        spellSpeed: SPELL_SPEED.SS1,
        actions: [
          {
            type: ACTION_TYPES.MODIFY_STATS,
            targetSelf: true,
            atkDelta: 600,
            defDelta: 0
          }
        ]
      }
    ]
  },
  {
    id: 'magicians_rod',
    passcode: '7084129',
    name: "Magician's Rod",
    nameTh: "คทาจอมเวท (Magician's Rod)",
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.DARK,
    race: 'Spellcaster',
    level: 3,
    atk: 1600,
    def: 100,
    archetype: 'Dark Magician',
    mentions: ['Dark Magician'],
    description: 'When this card is Normal Summoned: You can add 1 Spell/Trap from your Deck to your hand, that specifically lists "Dark Magician" in its text.',
    descriptionTh: 'เมื่ออัญเชิญปกติสำเร็จ: ค้นหาการ์ดเวทมนตร์หรือกับดักที่ระบุชื่อ "Dark Magician" 1 ใบจากเด็คขึ้นมือ (ใช้ได้เทิร์นละ 1 ครั้ง)',
    effects: [
      {
        id: 'rod_search_st',
        labelTh: 'ค้นหาเวทมนตร์/กับดักสาย Dark Magician จากเด็ค',
        trigger: TRIGGERS.ON_NORMAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'magicians_rod_opt',
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: {
              archetype: 'Dark Magician',
              kind: [CARD_KINDS.SPELL, CARD_KINDS.TRAP]
            }
          }
        ]
      }
    ]
  },
  {
    id: 'magicians_souls',
    passcode: '97631303',
    name: "Magicians' Souls",
    nameTh: "ดวงวิญญาณแห่งจอมเวท (Magicians' Souls)",
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.DARK,
    race: 'Spellcaster',
    level: 1,
    atk: 0,
    def: 0,
    archetype: 'Dark Magician',
    mentions: ['Dark Magician', 'Dark Magician Girl'],
    description: 'If this card is in your hand: You can send 1 Level 6 or higher Spellcaster monster from your Deck to the GY, then activate 1 of these effects; Special Summon this card, OR send this card to the GY, and if you do, Special Summon 1 "Dark Magician" or 1 "Dark Magician Girl" from your GY.',
    descriptionTh: 'ทิ้งการ์ดใบนี้จากมือ และส่งมอนสเตอร์จอมเวท Lv.6 ขึ้นไปจากเด็คลงสุสาน; จากนั้นอัญเชิญพิเศษ "Dark Magician" หรือ "Dark Magician Girl" จากสุสานลงสนามทันที! (ใช้ได้เทิร์นละ 1 ครั้ง)',
    effects: [
      {
        id: 'souls_dump_and_revive',
        labelTh: 'ส่ง Dark Magician จากเด็คลงสุสาน & ชุบขึ้นสนามทันที!',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['HAND'],
        opt: 'magicians_souls_opt',
        cost: { discardSelf: true },
        actions: [
          {
            type: ACTION_TYPES.SEND_FROM_DECK_TO_GY,
            count: 1,
            filter: { id: ['dark_magician', 'dark_magician_girl'] }
          },
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_GY,
            targetOwner: 'SELF',
            count: 1,
            filter: { id: ['dark_magician', 'dark_magician_girl'] }
          }
        ]
      }
    ]
  },
  {
    id: 'apprentice_illusion_magician',
    passcode: '30603688',
    name: 'Apprentice Illusion Magician',
    nameTh: 'จอมเวทมายาฝึกหัด (Apprentice Illusion)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.DARK,
    race: 'Spellcaster',
    level: 6,
    atk: 2000,
    def: 1700,
    archetype: 'Dark Magician',
    mentions: ['Dark Magician'],
    specialSummonRule: {
      fromZone: 'HAND',
      labelTh: 'อัญเชิญพิเศษ (ทิ้งการ์ดบนมือ 1 ใบ)',
      cost: { discardHandCount: 1 }
    },
    description: 'You can Special Summon this card (from your hand) by discarding 1 card. If this card is Normal or Special Summoned: You can add 1 "Dark Magician" from your Deck to your hand.',
    descriptionTh: '(1) อัญเชิญพิเศษจากมือได้โดยทิ้งการ์ดบนมือ 1 ใบ (2) เมื่ออัญเชิญปกติหรือพิเศษสำเร็จ: ค้นหา "Dark Magician" 1 ใบจากเด็คขึ้นมือ!',
    effects: [
      {
        id: 'apprentice_search_dm',
        labelTh: 'ค้นหา "Dark Magician" จากเด็คขึ้นมือ',
        trigger: TRIGGERS.ON_SUMMON_ANY,
        spellSpeed: SPELL_SPEED.SS1,
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: { id: 'dark_magician' }
          }
        ]
      }
    ]
  },
  {
    id: 'timaeus_the_united_dragon',
    passcode: '3078380',
    name: 'Timaeus the United Dragon',
    nameTh: 'มังกรแห่งสายสัมพันธ์ ทีไมออส (Timaeus)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Dragon',
    level: 8,
    atk: 2800,
    def: 1800,
    archetype: 'Dark Magician',
    mentions: ['Dark Magician'],
    specialSummonRule: {
      fromZone: 'HAND',
      labelTh: 'อัญเชิญพิเศษ (เมื่อมีจอมเวทบนสนาม/สุสาน)',
      condition: {
        hasCardInFieldOrGY: { race: 'Spellcaster' }
      },
      opt: 'timaeus_ss_opt'
    },
    description: 'During your Main Phase: You can Fusion Summon 1 Fusion Monster from your Extra Deck, using monsters from your hand or field as Fusion Material, including a Spellcaster monster.',
    descriptionTh: '(1) อัญเชิญพิเศษจากมือได้หากมีจอมเวทบนสนามหรือสุสาน (2) เทิร์นละครั้งใน Main Phase: สั่งอัญเชิญฟิวชั่นมอนสเตอร์สาย Dark Magician ได้โดยไม่ต้องใช้เวทฟิวชั่น!',
    effects: [
      {
        id: 'timaeus_fusion',
        labelTh: 'อัญเชิญฟิวชั่นมอนสเตอร์สาย Dark Magician',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['MMZ', 'EMZ'],
        opt: 'timaeus_fusion_opt',
        actions: [
          {
            type: ACTION_TYPES.FUSION_SUMMON,
            fusionFilter: { archetype: 'Dark Magician' }
          }
        ]
      }
    ]
  },
  {
    id: 'dark_magical_circle',
    passcode: '47222536',
    name: 'Dark Magical Circle',
    nameTh: 'วงเวทมนตร์ดำ (Dark Magical Circle)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.CONTINUOUS,
    archetype: 'Dark Magician',
    mentions: ['Dark Magician'],
    description: 'When this card is activated: Look at the top 3 cards of your Deck, then you can reveal 1 of them that is "Dark Magician" or a Spell/Trap that mentions "Dark Magician", and add it to your hand. If "Dark Magician" is Normal or Special Summoned to your field: You can target 1 card your opponent controls; banish it.',
    descriptionTh: '[เวทมนตร์ต่อเนื่อง] (1) เมื่อเปิดใช้งาน: ค้นหาการ์ดสาย "Dark Magician" 1 ใบจากเด็คขึ้นมือ (2) เทิร์นละครั้ง หากเรามี "Dark Magician" บนสนาม: เลือกการ์ดบนสนามของอีกฝ่าย 1 ใบ นำออกนอกเกม (Banish)!',
    effects: [
      {
        id: 'circle_on_activate',
        labelTh: 'เปิดวงเวทมนตร์ดำ: ค้นหาการ์ดสาย Dark Magician 1 ใบ',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'dm_circle_activate_opt',
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: { archetype: 'Dark Magician', excludeId: 'dark_magical_circle' }
          }
        ]
      },
      {
        id: 'circle_banish_opp',
        labelTh: 'มูฟการ์ดบนสนามอีกฝ่าย 1 ใบออกนอกเกม (เมื่อมี Dark Magician)',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['STZ'],
        opt: 'dm_circle_banish_opt',
        condition: {
          selfControlsCard: { archetype: 'Dark Magician', kind: CARD_KINDS.MONSTER },
          opponentControlsAnyCard: true
        },
        actions: [
          {
            type: ACTION_TYPES.BANISH_CARDS,
            sourceZone: 'ANY_FIELD',
            targetOwner: 'OPPONENT',
            count: 1
          }
        ]
      }
    ]
  },
  {
    id: 'soul_servant',
    passcode: '23020408',
    name: 'Soul Servant',
    nameTh: 'ข้ารับใช้แห่งดวงวิญญาณ (Soul Servant)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.QUICK_PLAY,
    archetype: 'Dark Magician',
    mentions: ['Dark Magician'],
    description: 'Place 1 card on top of the Deck (or add to hand) that mentions "Dark Magician". During your Main Phase: You can banish this card from your GY; draw cards equal to the number of "Dark Magician" and "Dark Magician Girl" on the field and in the GYs.',
    descriptionTh: '[เวทมนตร์ความเร็วสูง] (1) ค้นหาการ์ดสาย "Dark Magician" 1 ใบจากเด็คขึ้นมือ (2) มูฟการ์ดใบนี้จากสุสาน; จั่วการ์ด 1 ใบ!',
    effects: [
      {
        id: 'soul_servant_activate',
        labelTh: 'ค้นหาการ์ดสาย Dark Magician 1 ใบจากเด็ค',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: { archetype: 'Dark Magician', excludeId: 'soul_servant' }
          }
        ]
      },
      {
        id: 'soul_servant_gy_draw',
        labelTh: 'มูฟจากสุสาน: จั่วการ์ด 1 ใบ',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['GY'],
        opt: 'soul_servant_gy_opt',
        cost: { banishSelf: true },
        actions: [
          { type: ACTION_TYPES.DRAW, count: 1 }
        ]
      }
    ]
  },
  {
    id: 'secrets_of_dark_magic',
    passcode: '59514116',
    name: 'Secrets of Dark Magic',
    nameTh: 'ศาสตร์ลับแห่งมนตร์ดำ (Secrets of Dark Magic)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.QUICK_PLAY,
    archetype: 'Dark Magician',
    mentions: ['Dark Magician'],
    description: 'Fusion Summon 1 Fusion Monster from your Extra Deck, using monsters from your hand or field, including "Dark Magician" or "Dark Magician Girl", as Fusion Material.',
    descriptionTh: '[เวทมนตร์ความเร็วสูง] อัญเชิญฟิวชั่นมอนสเตอร์สาย "Dark Magician" จาก Extra Deck โดยใช้วัตถุดิบจากมือหรือบนสนาม!',
    effects: [
      {
        id: 'secrets_fusion',
        labelTh: 'อัญเชิญฟิวชั่นมอนสเตอร์สาย Dark Magician',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
        actions: [
          {
            type: ACTION_TYPES.FUSION_SUMMON,
            fusionFilter: { archetype: 'Dark Magician' }
          }
        ]
      }
    ]
  },
  {
    id: 'dark_magic_attack',
    passcode: '02314238',
    name: 'Dark Magic Attack',
    nameTh: 'กระสุนมนตร์ดำ (Dark Magic Attack)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.NORMAL,
    archetype: 'Dark Magician',
    mentions: ['Dark Magician'],
    description: 'If you control "Dark Magician": Destroy all Spells and Traps your opponent controls.',
    descriptionTh: '[เวทมนตร์ปกติ] เมื่อเรามี "Dark Magician" บนสนาม: ทำลายเวทมนตร์และกับดักบนสนามของอีกฝ่ายทั้งหมด!',
    effects: [
      {
        id: 'dma_destroy_st',
        labelTh: 'ทำลายเวทมนตร์/กับดักของอีกฝ่ายทั้งหมด',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        condition: {
          selfControlsCard: { archetype: 'Dark Magician', kind: CARD_KINDS.MONSTER },
          opponentControlsSpellTrap: true
        },
        actions: [
          {
            type: ACTION_TYPES.DESTROY_CARDS,
            targetOwner: 'OPPONENT',
            targetZone: 'SPELL_TRAP',
            count: 99
          }
        ]
      }
    ]
  },
  {
    id: 'eternal_soul',
    passcode: '48680970',
    name: 'Eternal Soul',
    nameTh: 'ดวงวิญญาณนิรันดร์ (Eternal Soul)',
    kind: CARD_KINDS.TRAP,
    subType: TRAP_SUBTYPES.CONTINUOUS,
    archetype: 'Dark Magician',
    mentions: ['Dark Magician'],
    description: 'Every "Dark Magician" in your Monster Zone is unaffected by your opponent\'s card effects. You can activate 1 of these effects: Special Summon 1 "Dark Magician" from your hand or GY; OR Add 1 "Dark Magic Attack" from your Deck to your hand.',
    descriptionTh: '[กับดักต่อเนื่อง] เทิร์นละครั้ง: อัญเชิญพิเศษ "Dark Magician" 1 ใบจากมือหรือสุสานลงสนาม!',
    effects: [
      {
        id: 'eternal_soul_open',
        labelTh: 'เปิด Eternal Soul & ชุบ Dark Magician จากสุสาน/มือ',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
        opt: 'eternal_soul_opt',
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_GY,
            targetOwner: 'SELF',
            count: 1,
            optional: true,
            filter: { archetype: 'Dark Magician', kind: CARD_KINDS.MONSTER }
          }
        ]
      },
      {
        id: 'eternal_soul_use',
        labelTh: 'ใช้เอฟเฟค Eternal Soul: ชุบชีวิต Dark Magician จากสุสาน',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['STZ'],
        opt: 'eternal_soul_opt',
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_GY,
            targetOwner: 'SELF',
            count: 1,
            filter: { archetype: 'Dark Magician', kind: CARD_KINDS.MONSTER }
          }
        ]
      }
    ]
  },
  // === EXTRA DECK ===
  {
    id: 'the_dark_magicians',
    passcode: '50237654',
    name: 'The Dark Magicians',
    nameTh: 'เหล่าจอมเวทมนตร์ดำผู้ยิ่งใหญ่ (The Dark Magicians)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.FUSION,
    attribute: ATTRIBUTES.DARK,
    race: 'Spellcaster',
    level: 8,
    atk: 2800,
    def: 2300,
    archetype: 'Dark Magician',
    mentions: ['Dark Magician', 'Dark Magician Girl'],
    summonMaterials: {
      type: 'FUSION',
      count: 2,
      filter: { race: ['Spellcaster', 'Dragon'], kind: CARD_KINDS.MONSTER },
      descriptionTh: '"Dark Magician" หรือ "Dark Magician Girl" + มอนสเตอร์เผ่าจอมเวท/มังกร 1 ใบ'
    },
    description: '"Dark Magician" or "Dark Magician Girl" + 1 Spellcaster monster. Once per turn, if a Spell/Trap Card or effect is activated: You can draw 1 card.',
    descriptionTh: '[ฟิวชั่น Lv.8] (1) เมื่อถูกอัญเชิญสำเร็จ: จั่วการ์ด 1 ใบ (2) เทิร์นละครั้งใน Main Phase: จั่วการ์ดเพิ่ม 1 ใบ!',
    effects: [
      {
        id: 'the_dm_on_summon_draw',
        labelTh: 'จั่วการ์ด 1 ใบเมื่ออัญเชิญสำเร็จ',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        actions: [
          { type: ACTION_TYPES.DRAW, count: 1 }
        ]
      },
      {
        id: 'the_dm_ignition_draw',
        labelTh: 'ใช้เอฟเฟคจอมเวทคู่: จั่วการ์ด 1 ใบ',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['MMZ', 'EMZ'],
        opt: 'the_dm_draw_opt',
        actions: [
          { type: ACTION_TYPES.DRAW, count: 1 }
        ]
      }
    ]
  },
  {
    id: 'dark_magician_the_dragon_knight',
    passcode: '41721210',
    name: 'Dark Magician the Dragon Knight',
    nameTh: 'อัศวินมังกร แบล็คเมจิกเชี่ยน (Dragon Knight)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.FUSION,
    attribute: ATTRIBUTES.DARK,
    race: 'Dragon',
    level: 8,
    atk: 3000,
    def: 2500,
    archetype: 'Dark Magician',
    mentions: ['Dark Magician'],
    summonMaterials: {
      type: 'FUSION',
      count: 2,
      filter: { kind: CARD_KINDS.MONSTER },
      descriptionTh: '"Dark Magician" + มอนสเตอร์เผ่ามังกร/จอมเวท 1 ใบ'
    },
    description: '"Dark Magician" + 1 Dragon monster. This card\'s name becomes "Dark Magician" while on the field or in the GY. Your opponent cannot target Spells/Traps you control with card effects, also they cannot be destroyed by your opponent\'s card effects.',
    descriptionTh: '[ฟิวชั่น Lv.8] นับชื่อเป็น "Dark Magician" บนสนาม/สุสาน และเมื่ออัญเชิญสำเร็จสามารถทำลายการ์ดบนสนามอีกฝ่าย 1 ใบ!',
    effects: [
      {
        id: 'dmdk_pop_on_summon',
        labelTh: 'ทำลายการ์ดบนสนามอีกฝ่าย 1 ใบ',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        condition: { opponentControlsAnyCard: true },
        actions: [
          {
            type: ACTION_TYPES.DESTROY_CARDS,
            targetOwner: 'OPPONENT',
            targetZone: 'ANY_FIELD',
            count: 1
          }
        ]
      }
    ]
  },
  {
    id: 'ebon_illusion_magician',
    passcode: '96471335',
    name: 'Ebon Illusion Magician',
    nameTh: 'จอมเวทมายาทมิฬ (Ebon Illusion Magician)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.XYZ,
    attribute: ATTRIBUTES.DARK,
    race: 'Spellcaster',
    rank: 7,
    atk: 2500,
    def: 2100,
    archetype: 'Dark Magician',
    summonMaterials: {
      type: 'XYZ',
      level: 7,
      count: 2,
      descriptionTh: 'มอนสเตอร์เลเวล 7 จำนวน 2 ใบ'
    },
    description: '2 Level 7 monsters. Once per turn: You can detach 1 material from this card; Special Summon 1 Spellcaster Normal Monster from your hand or Deck, and banish 1 card your opponent controls.',
    descriptionTh: '[เอ็กシーズ Rank 7] เทิร์นละครั้ง: ถอดโอเวอร์เลย์ยูนิต 1 ใบ; อัญเชิญพิเศษ "Dark Magician" จากเด็คลงสนาม และมูฟการ์ดบนสนามอีกฝ่าย 1 ใบออกนอกเกม!',
    effects: [
      {
        id: 'ebon_ss_and_banish',
        labelTh: 'ถอดโอเวอร์เลย์ 1: อัญเชิญ Dark Magician จากเด็ค & มูฟการ์ดอีกฝ่าย 1 ใบ',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['MMZ', 'EMZ'],
        opt: 'ebon_illusion_opt',
        cost: { detachCount: 1 },
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_DECK,
            count: 1,
            optional: true,
            filter: { id: 'dark_magician' }
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
  }
];
