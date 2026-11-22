/**
 * @fileoverview Universal Master Duel Staples & Hand Traps
 * การ์ดสามัญยอดฮิตประจำ Master Duel ที่ใส่ได้ในทุกเด็ค
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

export const STAPLE_CARDS = [
  {
    id: 'ash_blossom',
    passcode: '14558127',
    name: 'Ash Blossom & Joyous Spring',
    nameTh: 'ฮารุ อุราระ (Ash Blossom)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.FIRE,
    race: 'Zombie',
    level: 3,
    isTuner: true,
    atk: 0,
    def: 1800,
    archetype: 'Yo-kai Girl',
    description: 'When a card or effect is activated that includes adding a card from the Deck to the hand, Special Summoning from the Deck, or sending a card from the Deck to the GY (Quick Effect): You can discard this card; negate that effect.',
    descriptionTh: '[เอฟเฟคความเร็วสูง - Hand Trap] เมื่ออีกฝ่ายใช้เอฟเฟคที่มีการค้นหาการ์ดจากเด็คขึ้นมือ, อัญเชิญพิเศษจากเด็ค, จั่วการ์ด, หรือส่งการ์ดจากเด็คลงสุสาน: ทิ้งการ์ดใบนี้จากมือ; ยกเลิกเอฟเฟคนั้น (ใช้ได้เทิร์นละ 1 ครั้ง)',
    effects: [
      {
        id: 'ash_negate',
        labelTh: 'ทิ้งมือ: ยกเลิกเอฟเฟคค้นหา/จั่ว/อัญเชิญจากเด็ค',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['HAND'],
        opt: 'ash_blossom_opt',
        condition: {
          requiresActiveChain: true,
          opponentChainOnly: true,
          chainIncludesActionTypes: [
            ACTION_TYPES.SEARCH_DECK,
            ACTION_TYPES.DRAW,
            ACTION_TYPES.SPECIAL_SUMMON_FROM_DECK,
            ACTION_TYPES.SEND_FROM_DECK_TO_GY,
            ACTION_TYPES.FUSION_SUMMON
          ]
        },
        cost: { discardSelf: true },
        actions: [
          { type: ACTION_TYPES.NEGATE_ACTIVATION }
        ]
      }
    ]
  },
  {
    id: 'maxx_c',
    passcode: '23434538',
    name: 'Maxx "C"',
    nameTh: 'แม็กซ์ "C" (Maxx "C")',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.EARTH,
    race: 'Insect',
    level: 2,
    atk: 500,
    def: 200,
    archetype: '"C"',
    description: 'During either player\'s turn: You can send this card from your hand to the Graveyard; this turn, each time your opponent Special Summons a monster(s), immediately draw 1 card.',
    descriptionTh: '[เอฟเฟคความเร็วสูง - Hand Trap] ส่งการ์ดใบนี้จากมือลงสุสาน; จั่วการ์ด 1 ใบทันที และหากอีกฝ่ายมีมอนสเตอร์ที่อัญเชิญพิเศษอยู่บนสนาม จะได้จั่วเพิ่มอีก 1 ใบ (ใช้ได้เทิร์นละ 1 ครั้ง)',
    effects: [
      {
        id: 'maxxc_draw',
        labelTh: 'ทิ้งมือใช้ Maxx "C" (จั่วการ์ดรับการอัญเชิญพิเศษ)',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['HAND'],
        opt: 'maxx_c_opt',
        cost: { discardSelf: true },
        actions: [
          { type: ACTION_TYPES.APPLY_TURN_EFFECT, maxxC: true },
          { type: ACTION_TYPES.DRAW, count: 1 }
        ]
      }
    ]
  },
  {
    id: 'effect_veiler',
    passcode: '97268402',
    name: 'Effect Veiler',
    nameTh: 'เอฟเฟค เวเลอร์ (Effect Veiler)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Spellcaster',
    level: 1,
    isTuner: true,
    atk: 0,
    def: 0,
    archetype: 'Veiler',
    description: 'During your opponent\'s Main Phase (Quick Effect): You can send this card from your hand to the GY, then target 1 Effect Monster your opponent controls; negate the effects of that face-up monster your opponent controls, until the end of this turn.',
    descriptionTh: '[เอฟเฟคความเร็วสูง - Hand Trap] ในช่วง Main Phase ของอีกฝ่าย: ส่งการ์ดใบนี้จากมือลงสุสาน; เลือกมอนสเตอร์ที่หงายหน้าบนสนามของอีกฝ่าย 1 ใบ ทำให้เอฟเฟคไร้ผลจนจบเทิร์น',
    effects: [
      {
        id: 'veiler_negate',
        labelTh: 'ทิ้งมือ: ใบ้เอฟเฟคมอนสเตอร์อีกฝ่าย 1 ใบ',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['HAND'],
        condition: {
          opponentMainPhaseOnly: true,
          opponentControlsMonster: true
        },
        cost: { discardSelf: true },
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
    id: 'called_by_the_grave',
    passcode: '24224830',
    name: 'Called by the Grave',
    nameTh: 'ผู้ถูกเรียกจากหลุมศพ (Called by the Grave)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.QUICK_PLAY,
    archetype: 'Staple',
    description: 'Target 1 monster in your opponent\'s GY; banish it, and if you do, until the end of the next turn, its effects are negated, as well as the activated effects and effects on the field of monsters with the same original name.',
    descriptionTh: '[เวทมนตร์ความเร็วสูง] นำมอนสเตอร์ในสุสานของอีกฝ่าย 1 ใบออกนอกเกม; และหากอยู่ในเชนที่อีกฝ่ายสั่งใช้เอฟเฟคมอนสเตอร์ จะยกเลิกเอฟเฟคในเชนนั้นด้วย!',
    effects: [
      {
        id: 'cbtg_activate',
        labelTh: 'มูฟมอนสเตอร์ในสุสานอีกฝ่าย & ใบ้เอฟเฟคการ์ดชื่อเดียวกัน',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
        actions: [
          {
            type: ACTION_TYPES.BANISH_CARDS,
            sourceZone: 'GY',
            targetOwner: 'OPPONENT',
            count: 1,
            filter: { kind: CARD_KINDS.MONSTER },
            negateSameId: true
          }
        ]
      }
    ]
  },
  {
    id: 'infinite_impermanence',
    passcode: '10045474',
    name: 'Infinite Impermanence',
    nameTh: 'อนิจจังนิรันดร์ (Infinite Impermanence)',
    kind: CARD_KINDS.TRAP,
    subType: TRAP_SUBTYPES.NORMAL,
    archetype: 'Staple',
    canActivateFromHandIfEmptyField: true,
    description: 'Target 1 face-up monster your opponent controls; negate its effects (until the end of this turn). If you control no cards, you can activate this card from your hand.',
    descriptionTh: '[กับดักปกติ / Hand Trap] เลือกมอนสเตอร์ที่หงายหน้าบนสนามอีกฝ่าย 1 ใบ; ทำให้เอฟเฟคไร้ผล (หากบนสนามเราไม่มีการ์ดเลย สามารถสั่งใช้งานจากบนมือได้ทันที!)',
    effects: [
      {
        id: 'imperm_negate',
        labelTh: 'ใบ้เอฟเฟคมอนสเตอร์อีกฝ่าย (Impermanence)',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
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
    id: 'raigeki',
    passcode: '12580477',
    name: 'Raigeki',
    nameTh: 'ธันเดอร์โบลต์ (Raigeki)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.NORMAL,
    archetype: 'Staple',
    description: 'Destroy all monsters your opponent controls.',
    descriptionTh: '[เวทมนตร์ปกติ] ทำลายมอนสเตอร์บนสนามของอีกฝ่ายทั้งหมด',
    effects: [
      {
        id: 'raigeki_destroy_all',
        labelTh: 'ทำลายมอนสเตอร์ของอีกฝ่ายทั้งหมด',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        condition: { opponentControlsMonster: true },
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
    id: 'harpies_feather_duster',
    passcode: '18144506',
    name: "Harpie's Feather Duster",
    nameTh: 'ไม้ปัดขนนกฮาร์ปี้ (Feather Duster)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.NORMAL,
    archetype: 'Harpie',
    description: 'Destroy all Spells and Traps your opponent controls.',
    descriptionTh: '[เวทมนตร์ปกติ] ทำลายการ์ดเวทมนตร์และกับดักบนสนามของอีกฝ่ายทั้งหมด',
    effects: [
      {
        id: 'hfd_destroy_st',
        labelTh: 'ทำลายเวทมนตร์/กับดักของอีกฝ่ายทั้งหมด',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        condition: { opponentControlsSpellTrap: true },
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
    id: 'monster_reborn',
    passcode: '83764718',
    name: 'Monster Reborn',
    nameTh: 'ชุบชีวิตมอนสเตอร์ (Monster Reborn)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.NORMAL,
    archetype: 'Staple',
    description: 'Target 1 monster in either GY; Special Summon it.',
    descriptionTh: '[เวทมนตร์ปกติ] เลือกมอนสเตอร์ในสุสาน 1 ใบ; อัญเชิญพิเศษลงบนสนามของเรา',
    effects: [
      {
        id: 'reborn_ss',
        labelTh: 'ชุบชีวิตมอนสเตอร์จากสุสาน',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_GY,
            count: 1,
            filter: { kind: CARD_KINDS.MONSTER }
          }
        ]
      }
    ]
  },
  {
    id: 'baronne_de_fleur',
    passcode: '84815190',
    name: 'Baronne de Fleur',
    nameTh: 'บารอนเนอ เดอ เฟลอร์ (Baronne de Fleur)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.SYNCHRO,
    attribute: ATTRIBUTES.WIND,
    race: 'Warrior',
    level: 10,
    atk: 3000,
    def: 2400,
    archetype: 'Fleur',
    summonMaterials: {
      type: 'SYNCHRO',
      tunerCount: 1,
      nonTunerMin: 1,
      descriptionTh: 'จูนเนอร์ 1 ใบ + มอนสเตอร์ที่ไม่ใช่จูนเนอร์ 1 ใบขึ้นไป (ผลรวมเลเวล = 10)'
    },
    description: '1 Tuner + 1+ non-Tuner monsters. Once per turn: You can target 1 card on the field; destroy it. Once while face-up on the field, when a card or effect is activated (Quick Effect): You can negate the activation, and if you do, destroy that card.',
    descriptionTh: '[ซิงโคร Lv.10] (1) เทิร์นละครั้ง: เลือกทำลายการ์ดบนสนามของอีกฝ่าย 1 ใบ (2) [เอฟเฟคความเร็วสูง] เมื่ออีกฝ่ายสั่งใช้การ์ดหรือเอฟเฟค: ยกเลิกการใช้งานนั้นและทำลายทิ้ง',
    effects: [
      {
        id: 'baronne_pop',
        labelTh: 'ทำลายการ์ดบนสนามอีกฝ่าย 1 ใบ',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['MMZ', 'EMZ'],
        opt: 'baronne_pop_opt',
        condition: { opponentControlsAnyCard: true },
        actions: [
          {
            type: ACTION_TYPES.DESTROY_CARDS,
            targetOwner: 'OPPONENT',
            targetZone: 'ANY_FIELD',
            count: 1
          }
        ]
      },
      {
        id: 'baronne_omni_negate',
        labelTh: 'ยกเลิกการสั่งใช้งานเอฟเฟคของอีกฝ่าย (Omni-Negate)',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['MMZ', 'EMZ'],
        opt: 'baronne_negate_opt',
        condition: {
          requiresActiveChain: true,
          opponentChainOnly: true
        },
        actions: [
          { type: ACTION_TYPES.NEGATE_ACTIVATION, destroyNegated: true }
        ]
      }
    ]
  },
  {
    id: 'accesscode_talker',
    passcode: '86066372',
    name: 'Accesscode Talker',
    nameTh: 'แอคเซสโค้ด ทอล์คเกอร์ (Accesscode Talker)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.LINK,
    attribute: ATTRIBUTES.DARK,
    race: 'Cyberse',
    linkRating: 4,
    linkArrows: ['TOP', 'LEFT', 'RIGHT', 'BOTTOM'],
    atk: 2300,
    def: 0,
    archetype: 'Code Talker',
    summonMaterials: {
      type: 'LINK',
      minMonsters: 2,
      descriptionTh: 'มอนสเตอร์เอฟเฟค 2 ใบขึ้นไป (ค่า Link รวม = 4)'
    },
    description: '2+ Effect Monsters. If this card is Link Summoned: Gains 2000+ ATK. You can banish 1 Link Monster from your field or GY; destroy 1 card your opponent controls.',
    descriptionTh: '[ลิงก์-4] (1) เมื่ออัญเชิญลิงก์สำเร็จ: ได้รับพลังโจมตี +3000 ATK (เป็น 5300 ATK!) (2) มูฟมอนสเตอร์จากสุสานเรา 1 ใบ; ทำลายการ์ดบนสนามของอีกฝ่าย 1 ใบ',
    effects: [
      {
        id: 'accesscode_atk_boost',
        labelTh: 'เพิ่มพลังโจมตี +3000 ATK เมื่อลิงก์ซัมมอน',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        actions: [
          {
            type: ACTION_TYPES.MODIFY_STATS,
            targetSelf: true,
            atkDelta: 3000,
            defDelta: 0
          }
        ]
      },
      {
        id: 'accesscode_destroy',
        labelTh: 'มูฟมอนสเตอร์ในสุสาน: ทำลายการ์ดอีกฝ่าย 1 ใบ',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['MMZ', 'EMZ'],
        opt: 'accesscode_destroy_opt',
        condition: { opponentControlsAnyCard: true },
        actions: [
          {
            type: ACTION_TYPES.BANISH_CARDS,
            sourceZone: 'GY',
            targetOwner: 'SELF',
            count: 1,
            filter: { kind: CARD_KINDS.MONSTER }
          },
          {
            type: ACTION_TYPES.DESTROY_CARDS,
            targetOwner: 'OPPONENT',
            targetZone: 'ANY_FIELD',
            count: 1
          }
        ]
      }
    ]
  }
];
