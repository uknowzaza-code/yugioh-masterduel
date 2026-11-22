/**
 * @fileoverview Deck 1: Blue-Eyes Chaos / Spirit Dragon (บลูอายส์ ไวท์ดราก้อน)
 * เด็คยอดนิยมตลอดกาลของ Yu-Gi-Oh! ผสานทั้งการอัญเชิญพิเศษ, ฟิวชั่น, ซิงโคร Lv.9, และเอ็กシーズ Rank 8
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

export const BLUE_EYES_CARDS = [
  {
    id: 'blue_eyes_white_dragon',
    passcode: '89631139',
    name: 'Blue-Eyes White Dragon',
    nameTh: 'บลูอายส์ ไวท์ดราก้อน',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.NORMAL,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Dragon',
    level: 8,
    atk: 3000,
    def: 2500,
    archetype: 'Blue-Eyes',
    mentions: ['Blue-Eyes White Dragon'],
    description: 'This legendary dragon is a powerful engine of destruction. Virtually invincible, very few have faced this awesome creature and lived to tell the tale.',
    descriptionTh: 'มังกรในตำนานผู้มีพลังทำลายล้างสูงสุด แทบไม่มีผู้ใดที่เคยเผชิญหน้ากับมันแล้วรอดชีวิตกลับไปได้',
    effects: []
  },
  {
    id: 'blue_eyes_alternative_white_dragon',
    passcode: '38517737',
    name: 'Blue-Eyes Alternative White Dragon',
    nameTh: 'บลูอายส์ อัลเทอร์เนทีฟ ไวท์ดราก้อน',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Dragon',
    level: 8,
    atk: 3000,
    def: 2500,
    archetype: 'Blue-Eyes',
    mentions: ['Blue-Eyes White Dragon'],
    specialSummonRule: {
      fromZone: 'HAND',
      labelTh: 'อัญเชิญพิเศษ (แสดง Blue-Eyes White Dragon ในมือ/สนาม)',
      condition: {
        hasCardInHandOrField: { id: 'blue_eyes_white_dragon' }
      },
      opt: 'alternative_ss_opt'
    },
    description: 'Can be Special Summoned by revealing "Blue-Eyes White Dragon" in your hand. Once per turn: You can target 1 monster your opponent controls; destroy it.',
    descriptionTh: '(1) อัญเชิญพิเศษจากมือได้โดยแสดง "Blue-Eyes White Dragon" บนมือหรือสนาม (2) เทิร์นละครั้ง: เลือกทำลายมอนสเตอร์บนสนามอีกฝ่าย 1 ใบ',
    effects: [
      {
        id: 'alt_blue_eyes_pop',
        labelTh: 'ทำลายมอนสเตอร์ของอีกฝ่าย 1 ใบ (Dragon Burst)',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['MMZ', 'EMZ'],
        opt: 'alt_blue_eyes_pop_opt',
        condition: { opponentControlsMonster: true },
        actions: [
          {
            type: ACTION_TYPES.DESTROY_CARDS,
            targetOwner: 'OPPONENT',
            targetZone: 'MONSTER',
            count: 1
          }
        ]
      }
    ]
  },
  {
    id: 'blue_eyes_jet_dragon',
    passcode: '30576089',
    name: 'Blue-Eyes Jet Dragon',
    nameTh: 'บลูอายส์ เจ็ท ดราก้อน',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Dragon',
    level: 8,
    atk: 3000,
    def: 0,
    archetype: 'Blue-Eyes',
    mentions: ['Blue-Eyes White Dragon'],
    description: 'Other cards you control cannot be destroyed by your opponent\'s card effects. If a card on the field is destroyed or you control/have Blue-Eyes White Dragon in GY: You can Special Summon this card from your GY or hand. At the start of the Damage Step: You can return 1 card your opponent controls to the hand.',
    descriptionTh: '(1) หากมี "Blue-Eyes White Dragon" บนสนามหรือในสุสาน สามารถอัญเชิญพิเศษการ์ดใบนี้จากมือหรือสุสานได้ (2) เมื่อประกาศโจมตี: ดีดการ์ดบนสนามอีกฝ่าย 1 ใบกลับขึ้นมือ',
    effects: [
      {
        id: 'jet_dragon_ss',
        labelTh: 'อัญเชิญพิเศษ Blue-Eyes Jet Dragon (จากมือ/สุสาน)',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['HAND', 'GY'],
        opt: 'jet_dragon_ss_opt',
        condition: {
          hasCardInFieldOrGY: { id: 'blue_eyes_white_dragon' }
        },
        actions: [
          { type: ACTION_TYPES.SPECIAL_SUMMON_SELF_FROM_HAND }
        ]
      },
      {
        id: 'jet_dragon_bounce',
        labelTh: 'ดีดการ์ดอีกฝ่าย 1 ใบกลับขึ้นมือเมื่อโจมตี',
        trigger: TRIGGERS.ON_ATTACK_DECLARE,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'jet_dragon_bounce_opt',
        condition: { opponentControlsAnyCard: true },
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
    id: 'blue_eyes_abyss_dragon',
    passcode: '64202399',
    name: 'Blue-Eyes Abyss Dragon',
    nameTh: 'บลูอายส์ อะบิส ดราก้อน',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Dragon',
    level: 8,
    atk: 2500,
    def: 2500,
    archetype: 'Blue-Eyes',
    mentions: ['Blue-Eyes White Dragon'],
    description: 'If this card is Special Summoned: You can add 1 Ritual/Fusion Spell or 1 Level 8+ Dragon monster from your Deck to your hand.',
    descriptionTh: 'เมื่อการ์ดใบนี้ถูกอัญเชิญพิเศษสำเร็จ: ค้นหาเวทฟิวชั่น "Ultimate Fusion" หรือมอนสเตอร์เผ่ามังกร เลเวล 8 ขึ้นไป 1 ใบจากเด็คขึ้นมือ',
    effects: [
      {
        id: 'abyss_search',
        labelTh: 'ค้นหามังกร Lv.8 หรือ Ultimate Fusion จากเด็ค',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'abyss_search_opt',
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: {
              archetype: 'Blue-Eyes'
            }
          }
        ]
      }
    ]
  },
  {
    id: 'sage_with_eyes_of_blue',
    passcode: '08240199',
    name: 'Sage with Eyes of Blue',
    nameTh: 'นักปราชญ์แห่งดวงตาสีคราม (Sage)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Spellcaster',
    level: 1,
    isTuner: true,
    atk: 0,
    def: 1500,
    archetype: 'Eyes of Blue',
    mentions: ['Blue-Eyes White Dragon'],
    description: 'When this card is Normal Summoned: You can add 1 Level 1 LIGHT Tuner from your Deck to your hand. You can discard this card, then target 1 Effect Monster you control; send it to the GY, and if you do, Special Summon 1 "Blue-Eyes" monster from your Deck.',
    descriptionTh: '[จูนเนอร์ Lv.1] (1) เมื่ออัญเชิญปกติสำเร็จ: ค้นหาจูนเนอร์ธาตุแสง Lv.1 จากเด็คขึ้นมือ 1 ใบ (2) ทิ้งการ์ดใบนี้จากมือและส่งมอนสเตอร์บนสนามเรา 1 ใบลงสุสาน; อัญเชิญพิเศษมอนสเตอร์ "Blue-Eyes" 1 ใบจากเด็ค!',
    effects: [
      {
        id: 'sage_on_ns',
        labelTh: 'ค้นหาจูนเนอร์ธาตุแสง Lv.1 จากเด็คขึ้นมือ',
        trigger: TRIGGERS.ON_NORMAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: {
              kind: CARD_KINDS.MONSTER,
              attribute: ATTRIBUTES.LIGHT,
              level: 1,
              isTuner: true,
              excludeId: 'sage_with_eyes_of_blue'
            }
          }
        ]
      },
      {
        id: 'sage_hand_ss_blue_eyes',
        labelTh: 'ทิ้งการ์ดนี้ + ส่งมอนสเตอร์บนสนามลงสุสาน: อัญเชิญ Blue-Eyes จากเด็ค',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['HAND'],
        opt: 'sage_hand_opt',
        condition: { selfControlsMonster: true },
        cost: { discardSelf: true, sendControlledMonsterToGY: 1 },
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_DECK,
            count: 1,
            filter: { archetype: 'Blue-Eyes', kind: CARD_KINDS.MONSTER }
          }
        ]
      }
    ]
  },
  {
    id: 'the_white_stone_of_ancients',
    passcode: '71039903',
    name: 'The White Stone of Ancients',
    nameTh: 'ศิลาขาวแห่งบรรพกาล (White Stone)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Dragon',
    level: 1,
    isTuner: true,
    atk: 600,
    def: 500,
    archetype: 'Blue-Eyes',
    mentions: ['Blue-Eyes White Dragon'],
    description: 'Once per turn, during the End Phase, if this card is in the GY because it was sent there this turn: You can Special Summon 1 "Blue-Eyes" monster from your Deck. You can banish this card from your GY, then target 1 "Blue-Eyes" monster in your GY; add it to your hand.',
    descriptionTh: '[จูนเนอร์ Lv.1] (1) เมื่อถูกส่งลงสุสาน: สามารถอัญเชิญพิเศษมอนสเตอร์ "Blue-Eyes" 1 ใบจากเด็คได้ (2) มูฟการ์ดใบนี้จากสุสาน; เก็บมอนสเตอร์ "Blue-Eyes" จากสุสานขึ้นมือ 1 ใบ',
    effects: [
      {
        id: 'white_stone_gy_summon',
        labelTh: 'อัญเชิญพิเศษมอนสเตอร์ "Blue-Eyes" 1 ใบจากเด็ค',
        trigger: TRIGGERS.ON_SEND_TO_GY,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'white_stone_summon_opt',
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_DECK,
            count: 1,
            filter: { archetype: 'Blue-Eyes', kind: CARD_KINDS.MONSTER }
          }
        ]
      },
      {
        id: 'white_stone_recover',
        labelTh: 'มูฟจากสุสาน: เก็บมอนสเตอร์ Blue-Eyes จากสุสานขึ้นมือ',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['GY'],
        opt: 'white_stone_recover_opt',
        cost: { banishSelf: true },
        actions: [
          {
            type: ACTION_TYPES.RECOVER_FROM_GY_TO_HAND,
            count: 1,
            filter: { archetype: 'Blue-Eyes', kind: CARD_KINDS.MONSTER }
          }
        ]
      }
    ]
  },
  {
    id: 'the_melody_of_awakening_dragon',
    passcode: '48800175',
    name: 'The Melody of Awakening Dragon',
    nameTh: 'ท่วงทำนองแห่งมังกรตื่นรู้ (Melody)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.NORMAL,
    archetype: 'Blue-Eyes',
    description: 'Discard 1 card; add up to 2 Dragon monsters with 3000 or more ATK and 2500 or less DEF from your Deck to your hand.',
    descriptionTh: '[เวทมนตร์ปกติ] ทิ้งการ์ดบนมือ 1 ใบ; ค้นหามอนสเตอร์เผ่ามังกรที่มี ATK 3000 ขึ้นไป และ DEF ไม่เกิน 2500 สูงสุด 2 ใบจากเด็คขึ้นมือ!',
    effects: [
      {
        id: 'melody_search_2',
        labelTh: 'ทิ้งการ์ด 1 ใบ: ค้นหามังกร ATK 3000+ สูงสุด 2 ใบจากเด็ค',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        cost: { discardHandCount: 1 },
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 2,
            filter: { kind: CARD_KINDS.MONSTER, race: 'Dragon', atkMin: 3000, defMax: 2500 }
          }
        ]
      }
    ]
  },
  {
    id: 'return_of_the_dragon_lords',
    passcode: '06853254',
    name: 'Return of the Dragon Lords',
    nameTh: 'การกลับมาของราชันย์มังกร (Return of the Dragon Lords)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.NORMAL,
    archetype: 'Dragon Lords',
    description: 'Target 1 Level 7 or 8 Dragon monster in your GY; Special Summon it.',
    descriptionTh: '[เวทมนตร์ปกติ] เลือกมอนสเตอร์เผ่ามังกร เลเวล 7 หรือ 8 ในสุสานของเรา 1 ใบ; อัญเชิญพิเศษลงสนาม',
    effects: [
      {
        id: 'dragon_lords_revive',
        labelTh: 'ชุบชีวิตมังกร Lv.7-8 จากสุสานเรา',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_GY,
            targetOwner: 'SELF',
            count: 1,
            filter: { kind: CARD_KINDS.MONSTER, race: 'Dragon', levelMin: 7, levelMax: 8 }
          }
        ]
      }
    ]
  },
  {
    id: 'bingo_machine_go',
    passcode: '93437091',
    name: 'Bingo Machine, Go!!!',
    nameTh: 'บิงโกแมชชีน โก!!!',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.NORMAL,
    archetype: 'Blue-Eyes',
    mentions: ['Blue-Eyes White Dragon'],
    description: 'Add 1 "Blue-Eyes" monster or 1 Spell/Trap that mentions "Blue-Eyes White Dragon" from your Deck to your hand.',
    descriptionTh: '[เวทมนตร์ปกติ] ค้นหาการ์ด "Blue-Eyes" หรือเวทมนตร์/กับดักที่ระบุชื่อ "Blue-Eyes White Dragon" 1 ใบจากเด็คขึ้นมือ (ใช้ได้เทิร์นละ 1 ครั้ง)',
    effects: [
      {
        id: 'bingo_search',
        labelTh: 'ค้นหาการ์ด Blue-Eyes จากเด็คขึ้นมือ',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'bingo_machine_opt',
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: { archetype: 'Blue-Eyes', excludeId: 'bingo_machine_go' }
          }
        ]
      }
    ]
  },
  {
    id: 'ultimate_fusion',
    passcode: '71143015',
    name: 'Ultimate Fusion',
    nameTh: 'อัลติเมท ฟิวชั่น (Ultimate Fusion)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.QUICK_PLAY,
    archetype: 'Blue-Eyes',
    mentions: ['Blue-Eyes White Dragon'],
    description: 'During the Main Phase: Fusion Summon 1 Fusion Monster from your Extra Deck that mentions "Blue-Eyes White Dragon" by shuffling the Fusion Materials listed on it from your hand, field, and/or GY into the Deck, then you can destroy face-up cards your opponent controls.',
    descriptionTh: '[เวทมนตร์ความเร็วสูง] อัญเชิญฟิวชั่นมอนสเตอร์ "Blue-Eyes" จาก Extra Deck โดยใช้วัตถุดิบจากมือ/สนาม/สุสาน จากนั้นทำลายการ์ดบนสนามอีกฝ่าย 1 ใบ!',
    effects: [
      {
        id: 'ultimate_fusion_activate',
        labelTh: 'อัญเชิญฟิวชั่นมอนสเตอร์สาย Blue-Eyes & ทำลายการ์ด',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
        opt: 'ultimate_fusion_opt',
        actions: [
          {
            type: ACTION_TYPES.FUSION_SUMMON,
            allowGYMaterials: true,
            fusionFilter: { archetype: 'Blue-Eyes' }
          },
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
  },
  {
    id: 'true_light',
    passcode: '62089826',
    name: 'True Light',
    nameTh: 'แสงที่แท้จริง (True Light)',
    kind: CARD_KINDS.TRAP,
    subType: TRAP_SUBTYPES.CONTINUOUS,
    archetype: 'Blue-Eyes',
    mentions: ['Blue-Eyes White Dragon'],
    description: 'You can activate 1 of these effects: Special Summon 1 "Blue-Eyes White Dragon" from your hand or GY; OR Set 1 Spell/Trap from your Deck that specifically lists "Blue-Eyes White Dragon" in its text.',
    descriptionTh: '[กับดักต่อเนื่อง] เทิร์นละครั้ง: อัญเชิญพิเศษ "Blue-Eyes White Dragon" จากมือหรือสุสาน หรือค้นหาการ์ดที่ระบุชื่อ "Blue-Eyes White Dragon" จากเด็คขึ้นมือ',
    effects: [
      {
        id: 'true_light_activate',
        labelTh: 'เปิดใช้งาน True Light & ชุบ Blue-Eyes',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
        opt: 'true_light_opt',
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_GY,
            targetOwner: 'SELF',
            count: 1,
            optional: true,
            filter: { archetype: 'Blue-Eyes', kind: CARD_KINDS.MONSTER }
          }
        ]
      },
      {
        id: 'true_light_continuous_use',
        labelTh: 'ใช้เอฟเฟค True Light: ค้นหาเวท/กับดัก Blue-Eyes หรือชุบจากสุสาน',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['STZ'],
        opt: 'true_light_opt',
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: { archetype: 'Blue-Eyes' }
          }
        ]
      }
    ]
  },
  // === EXTRA DECK ===
  {
    id: 'blue_eyes_alternative_ultimate_dragon',
    passcode: '43228023',
    name: 'Blue-Eyes Alternative Ultimate Dragon',
    nameTh: 'บลูอายส์ อัลเทอร์เนทีฟ อัลติเมทดราก้อน',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.FUSION,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Dragon',
    level: 12,
    atk: 4500,
    def: 3800,
    archetype: 'Blue-Eyes',
    mentions: ['Blue-Eyes White Dragon'],
    summonMaterials: {
      type: 'FUSION',
      count: 2,
      filter: { archetype: 'Blue-Eyes', kind: CARD_KINDS.MONSTER },
      descriptionTh: 'มอนสเตอร์ "Blue-Eyes" 2 ใบขึ้นไป'
    },
    description: '"Blue-Eyes White Dragon" + "Blue-Eyes White Dragon" + "Blue-Eyes White Dragon". Your opponent cannot target or destroy this card with card effects. Once per turn: You can target up to 2 cards your opponent controls; destroy them.',
    descriptionTh: '[ฟิวชั่น Lv.12] เทิร์นละครั้ง: เลือกทำลายการ์ดบนสนามของอีกฝ่ายสูงสุด 2 ใบ!',
    effects: [
      {
        id: 'alt_ultimate_destroy_2',
        labelTh: 'ทำลายการ์ดบนสนามอีกฝ่ายสูงสุด 2 ใบ (Ultimate Burst)',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['MMZ', 'EMZ'],
        opt: 'alt_ultimate_opt',
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
  {
    id: 'blue_eyes_tyrant_dragon',
    passcode: '11443677',
    name: 'Blue-Eyes Tyrant Dragon',
    nameTh: 'บลูอายส์ ไทแรนท์ ดราก้อน',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.FUSION,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Dragon',
    level: 8,
    atk: 3400,
    def: 2900,
    archetype: 'Blue-Eyes',
    mentions: ['Blue-Eyes White Dragon'],
    summonMaterials: {
      type: 'FUSION',
      count: 2,
      filter: { race: 'Dragon', kind: CARD_KINDS.MONSTER },
      descriptionTh: '"Blue-Eyes White Dragon" + มอนสเตอร์เผ่ามังกร 1 ใบ'
    },
    description: '"Blue-Eyes White Dragon" + 1 Dragon monster. Unaffected by Trap Cards or effects. This card can attack all monsters your opponent controls, once each.',
    descriptionTh: '[ฟิวชั่น Lv.8] เมื่ออัญเชิญสำเร็จ: สามารถโจมตีได้ 2 ครั้งในแต่ละ Battle Phase และเก็บกับดักจากสุสานขึ้นมือได้ 1 ใบ!',
    effects: [
      {
        id: 'tyrant_multi_attack',
        labelTh: 'รับความสามารถโจมตี 2 ครั้ง & เก็บกับดักจากสุสาน',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        actions: [
          { type: ACTION_TYPES.GRANT_MULTI_ATTACK, attacks: 2 },
          {
            type: ACTION_TYPES.RECOVER_FROM_GY_TO_HAND,
            count: 1,
            optional: true,
            filter: { kind: CARD_KINDS.TRAP }
          }
        ]
      }
    ]
  },
  {
    id: 'blue_eyes_spirit_dragon',
    passcode: '59822133',
    name: 'Blue-Eyes Spirit Dragon',
    nameTh: 'บลูอายส์ สปิริต ดราก้อน',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.SYNCHRO,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Dragon',
    level: 9,
    atk: 2500,
    def: 3000,
    archetype: 'Blue-Eyes',
    mentions: ['Blue-Eyes White Dragon'],
    summonMaterials: {
      type: 'SYNCHRO',
      tunerCount: 1,
      nonTunerMin: 1,
      descriptionTh: 'จูนเนอร์ 1 ใบ + มอนสเตอร์ "Blue-Eyes" ที่ไม่ใช่จูนเนอร์ 1 ใบขึ้นไป (ผลรวมเลเวล = 9)'
    },
    description: '1 Tuner + 1+ non-Tuner "Blue-Eyes" monsters. Once per turn, when an effect is activated in the GY (Quick Effect): You can negate the activation. (Quick Effect): You can Tribute this Synchro Summoned card; Special Summon 1 LIGHT Dragon Synchro Monster from your Extra Deck in Defense Position.',
    descriptionTh: '[ซิงโคร Lv.9] [เอฟเฟคความเร็วสูง] สังเวยการ์ดใบนี้; อัญเชิญพิเศษมอนสเตอร์ซิงโครเผ่ามังกรธาตุแสง (เช่น Azure-Eyes Silver Dragon) จาก Extra Deck!',
    effects: [
      {
        id: 'spirit_dragon_tag_out',
        labelTh: 'สังเวยตัวเอง: อัญเชิญ Azure-Eyes Silver Dragon จาก Extra Deck',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['MMZ', 'EMZ'],
        opt: 'spirit_tag_opt',
        cost: { tributeSelf: true },
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_EXTRA,
            count: 1,
            filter: { frame: MONSTER_FRAMES.SYNCHRO, race: 'Dragon', attribute: ATTRIBUTES.LIGHT, excludeId: 'blue_eyes_spirit_dragon' }
          }
        ]
      }
    ]
  },
  {
    id: 'azure_eyes_silver_dragon',
    passcode: '40908371',
    name: 'Azure-Eyes Silver Dragon',
    nameTh: 'มังกรเงินเนตรคราม (Azure-Eyes Silver Dragon)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.SYNCHRO,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Dragon',
    level: 9,
    atk: 2500,
    def: 3000,
    archetype: 'Eyes of Blue',
    summonMaterials: {
      type: 'SYNCHRO',
      tunerCount: 1,
      nonTunerMin: 1,
      descriptionTh: 'จูนเนอร์ 1 ใบ + มอนสเตอร์ที่ไม่ใช่จูนเนอร์ 1 ใบขึ้นไป (ผลรวมเลเวล = 9)'
    },
    description: '1 Tuner + 1+ non-Tuner Normal Monsters. If this card is Special Summoned: Dragon monsters you currently control cannot be targeted or destroyed. Once per turn: You can target 1 Normal Monster in your GY; Special Summon that target.',
    descriptionTh: '[ซิงโคร Lv.9] เทิร์นละครั้ง (หรือเมื่อถูกอัญเชิญพิเศษ): ชุบชีวิตมอนสเตอร์ปกติ (เช่น Blue-Eyes White Dragon) 1 ใบจากสุสานของเราลงสนาม!',
    effects: [
      {
        id: 'azure_eyes_revive',
        labelTh: 'ชุบชีวิต Blue-Eyes White Dragon จากสุสาน',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['MMZ', 'EMZ'],
        opt: 'azure_eyes_opt',
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_GY,
            targetOwner: 'SELF',
            count: 1,
            filter: { frame: MONSTER_FRAMES.NORMAL, kind: CARD_KINDS.MONSTER }
          }
        ]
      }
    ]
  },
  {
    id: 'number_38_hope_harbinger',
    passcode: '63767246',
    name: 'Number 38: Hope Harbinger Dragon Titanic Galaxy',
    nameTh: 'นัมเบอร์ 38: โฮป ฮาร์บิงเกอร์ ดราก้อน ไททานิค กาแล็กซี่',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.XYZ,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Dragon',
    rank: 8,
    atk: 3000,
    def: 2500,
    archetype: 'Number',
    summonMaterials: {
      type: 'XYZ',
      level: 8,
      count: 2,
      descriptionTh: 'มอนสเตอร์เลเวล 8 จำนวน 2 ใบ'
    },
    description: '2 Level 8 monsters. Once per turn, when a Spell Card or effect is activated on the field (Quick Effect): You can negate that effect, and if you do, attach that card to this card as material.',
    descriptionTh: '[เอ็กシーズ Rank 8] [เอฟเฟคความเร็วสูง] ถอดโอเวอร์เลย์ยูนิต 1 ใบ (หรือใช้เอฟเฟคเฉยๆ เทิร์นละครั้ง) เมื่ออีกฝ่ายใช้เวทมนตร์หรือเอฟเฟค: ยกเลิกเอฟเฟคนั้นทันที!',
    effects: [
      {
        id: 'n38_negate',
        labelTh: 'ยกเลิกเวทมนตร์/เอฟเฟคของอีกฝ่าย (Hope Harbinger)',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['MMZ', 'EMZ'],
        opt: 'n38_negate_opt',
        condition: {
          requiresActiveChain: true,
          opponentChainOnly: true
        },
        cost: { detachCount: 1 },
        actions: [
          { type: ACTION_TYPES.NEGATE_ACTIVATION }
        ]
      }
    ]
  }
];
