/**
 * @fileoverview Deck 3: Sky Striker Ace (สกายสไตรเกอร์ - เมต้าสายลิงก์ & เวทความเร็วสูง)
 * เด็คยอดฮิตอันดับต้นๆ ใน Master Duel เน้นการสลับร่าง Link-1 (Kagari, Shizuku, Hayate) และสะสมเวทมนตร์ในสุสานครบ 3 ใบเพื่อปลดล็อกเอฟเฟคเสริม!
 */

import {
  CARD_KINDS,
  MONSTER_FRAMES,
  SPELL_SUBTYPES,
  ATTRIBUTES,
  TRIGGERS,
  ACTION_TYPES,
  SPELL_SPEED
} from '../../constants/gameConstants.js';

export const SKY_STRIKER_CARDS = [
  {
    id: 'sky_striker_ace_raye',
    passcode: '26077387',
    name: 'Sky Striker Ace - Raye',
    nameTh: 'สกายสไตรเกอร์ เอซ - เรย์ (Raye)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.DARK,
    race: 'Warrior',
    level: 4,
    atk: 1500,
    def: 1500,
    archetype: 'Sky Striker',
    subArchetypes: ['Sky Striker Ace'],
    description: '(Quick Effect): You can Tribute this card; Special Summon 1 "Sky Striker Ace" monster from your Extra Deck. While this card is in your GY, if a face-up "Sky Striker Ace" Link Monster you control is destroyed: You can Special Summon this card.',
    descriptionTh: '(1) [เอฟเฟคความเร็วสูง] สังเวยการ์ดใบนี้; อัญเชิญพิเศษมอนสเตอร์ลิงก์ "Sky Striker Ace" 1 ใบจาก Extra Deck ทันที! (2) หากอยู่ในสุสาน สามารถชุบชีวิตตัวเองกลับลงสนามได้เทิร์นละครั้ง',
    effects: [
      {
        id: 'raye_quick_link',
        labelTh: 'สังเวยตัวเอง: สวมเกราะอัญเชิญ Sky Striker Ace จาก Extra Deck!',
        trigger: TRIGGERS.QUICK_EFFECT,
        spellSpeed: SPELL_SPEED.SS2,
        zones: ['MMZ', 'EMZ'],
        opt: 'raye_quick_opt',
        cost: { tributeSelf: true },
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_EXTRA,
            count: 1,
            filter: { archetype: 'Sky Striker', frame: MONSTER_FRAMES.LINK }
          }
        ]
      },
      {
        id: 'raye_gy_revive',
        labelTh: 'ชุบชีวิต Raye จากสุสานลงสนาม',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['GY'],
        opt: 'raye_gy_opt',
        condition: { emptyMonsterZonesCountMin: 4 },
        actions: [
          { type: ACTION_TYPES.SPECIAL_SUMMON_SELF_FROM_GY }
        ]
      }
    ]
  },
  {
    id: 'sky_striker_ace_roze',
    passcode: '37351133',
    name: 'Sky Striker Ace - Roze',
    nameTh: 'สกายสไตรเกอร์ เอซ - โรเซ่ (Roze)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.EFFECT,
    attribute: ATTRIBUTES.LIGHT,
    race: 'Warrior',
    level: 4,
    atk: 1500,
    def: 1500,
    archetype: 'Sky Striker',
    subArchetypes: ['Sky Striker Ace'],
    specialSummonRule: {
      fromZone: 'HAND',
      labelTh: 'อัญเชิญพิเศษ (เมื่อมี Sky Striker Ace บนสนาม)',
      condition: {
        selfControlsCard: { archetype: 'Sky Striker', kind: CARD_KINDS.MONSTER }
      },
      opt: 'roze_ss_opt'
    },
    description: 'If a "Sky Striker Ace" monster is Normal or Special Summoned: You can Special Summon this card from your hand. If an opponent\'s monster is destroyed: You can negate the effects of 1 face-up monster your opponent controls.',
    descriptionTh: '(1) หากเรามีมอนสเตอร์ "Sky Striker" บนสนาม สามารถอัญเชิญพิเศษการ์ดใบนี้จากมือได้ (2) เมื่ออัญเชิญสำเร็จ: ใบ้เอฟเฟคมอนสเตอร์อีกฝ่าย 1 ใบ',
    effects: [
      {
        id: 'roze_on_summon_negate',
        labelTh: 'ใบ้เอฟเฟคมอนสเตอร์ของอีกฝ่าย 1 ใบ',
        trigger: TRIGGERS.ON_SUMMON_ANY,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'roze_negate_opt',
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
    id: 'sky_striker_mobilize_engage',
    passcode: '63166095',
    name: 'Sky Striker Mobilize - Engage!',
    nameTh: 'สกายสไตรเกอร์ โมบิไลซ์ - เอนเกจ! (Engage!)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.NORMAL,
    archetype: 'Sky Striker',
    description: 'If you control no monsters in your Main Monster Zone: Add 1 "Sky Striker" card from your Deck to your hand, except "Sky Striker Mobilize - Engage!", then, if you have 3 or more Spells in your GY, you can draw 1 card.',
    descriptionTh: '[เวทมนตร์ปกติ] ค้นหาการ์ด "Sky Striker" 1 ใบจากเด็คขึ้นมือ และหากในสุสานเรามีการ์ดเวทมนตร์ 3 ใบขึ้นไป จะได้จั่วการ์ดเพิ่มอีก 1 ใบฟรี!',
    effects: [
      {
        id: 'engage_search_and_draw',
        labelTh: 'ค้นหาการ์ด Sky Striker 1 ใบ (+ จั่ว 1 หากมีเวทในสุสาน 3+ ใบ)',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        condition: { emptyMonsterZonesCountMin: 5 },
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: { archetype: 'Sky Striker', excludeId: 'sky_striker_mobilize_engage' }
          },
          {
            type: ACTION_TYPES.DRAW,
            count: 1,
            bonusCondition: { minSpellsInGY: 3 }
          }
        ]
      }
    ]
  },
  {
    id: 'sky_striker_mecha_widow_anchor',
    passcode: '98338152',
    name: 'Sky Striker Mecha - Widow Anchor',
    nameTh: 'สกายสไตรเกอร์ เมก้า - วิโดว์ แองเคอร์ (Widow Anchor)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.QUICK_PLAY,
    archetype: 'Sky Striker',
    description: 'If you control no monsters in your Main Monster Zone: Target 1 face-up Effect Monster on the field; negate that face-up monster\'s effects until the end of this turn, then, if you have 3 or more Spells in your GY, you can take control of that monster until the End Phase.',
    descriptionTh: '[เวทมนตร์ความเร็วสูง] ใบ้เอฟเฟคมอนสเตอร์อีกฝ่าย 1 ใบ (หรือยกเลิกเอฟเฟคในเชน) และหากในสุสานเรามีเวทมนตร์ 3 ใบขึ้นไป ยึดการควบคุมมอนสเตอร์ใบนั้นมาเป็นของเราทันที!',
    effects: [
      {
        id: 'widow_anchor_activate',
        labelTh: 'ใบ้เอฟเฟคมอนสเตอร์อีกฝ่าย (+ ยึดมอนสเตอร์หากมีเวทในสุสาน 3+ ใบ)',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
        condition: { emptyMonsterZonesCountMin: 5, opponentControlsMonster: true },
        actions: [
          {
            type: ACTION_TYPES.NEGATE_FACEUP_EFFECT,
            targetOwner: 'OPPONENT',
            count: 1,
            filter: { kind: CARD_KINDS.MONSTER, faceUp: true }
          },
          {
            type: ACTION_TYPES.TAKE_CONTROL,
            targetOwner: 'OPPONENT',
            count: 1,
            bonusCondition: { minSpellsInGY: 3 }
          }
        ]
      }
    ]
  },
  {
    id: 'sky_striker_mecha_hornet_drones',
    passcode: '52340444',
    name: 'Sky Striker Mecha - Hornet Drones',
    nameTh: 'สกายสไตรเกอร์ เมก้า - ฮอร์เน็ต โดรนส์ (Hornet Drones)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.QUICK_PLAY,
    archetype: 'Sky Striker',
    description: 'If you control no monsters in your Main Monster Zone: Special Summon 1 "Sky Striker Ace Token" (Warrior/DARK/Level 1/ATK 0/DEF 0) in Defense Position.',
    descriptionTh: '[เวทมนตร์ความเร็วสูง] อัญเชิญพิเศษ "Sky Striker Ace Token" (นักรบ/มืด/Lv.1/ATK 0/DEF 0) ลงสนาม 1 ตัว (ใช้เป็นวัตถุดิบลิงก์ Kagari/Shizuku/Hayate ได้ทันที!)',
    effects: [
      {
        id: 'hornet_drones_token',
        labelTh: 'สร้าง Sky Striker Ace Token ลงสนาม 1 ตัว',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
        condition: { emptyMonsterZonesCountMin: 5 },
        actions: [
          {
            type: ACTION_TYPES.SPAWN_TOKEN,
            token: {
              id: 'sky_striker_ace_token',
              name: 'Sky Striker Ace Token',
              nameTh: 'สกายสไตรเกอร์ เอซ โทเค็น',
              kind: CARD_KINDS.MONSTER,
              frame: MONSTER_FRAMES.TOKEN,
              attribute: ATTRIBUTES.DARK,
              race: 'Warrior',
              level: 1,
              atk: 0,
              def: 0,
              archetype: 'Sky Striker',
              subArchetypes: ['Sky Striker Ace'],
              descriptionTh: 'โทเค็นสกายสไตรเกอร์ ใช้เป็นวัตถุดิบลิงก์ซัมมอน Sky Striker Ace ได้'
            }
          }
        ]
      }
    ]
  },
  {
    id: 'sky_striker_mecha_shark_cannon',
    passcode: '51227866',
    name: 'Sky Striker Mecha - Shark Cannon',
    nameTh: 'สกายสไตรเกอร์ เมก้า - ชาร์ค แคนนอน (Shark Cannon)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.QUICK_PLAY,
    archetype: 'Sky Striker',
    description: 'Target 1 monster in your opponent\'s GY; banish that monster, or, if you have 3 or more Spells in your GY, you can Special Summon that monster to your field instead.',
    descriptionTh: '[เวทมนตร์ความเร็วสูง] ชุบชีวิตมอนสเตอร์จากสุสานของอีกฝ่ายมาลงสนามเรา หรือมูฟมอนสเตอร์ในสุสานอีกฝ่ายออกนอกเกม 1 ใบ',
    effects: [
      {
        id: 'shark_cannon_steal',
        labelTh: 'ชุบมอนสเตอร์จากสุสานอีกฝ่ายมาลงสนามเรา',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS2,
        condition: { emptyMonsterZonesCountMin: 5 },
        actions: [
          {
            type: ACTION_TYPES.SPECIAL_SUMMON_FROM_GY,
            targetOwner: 'OPPONENT',
            count: 1,
            filter: { kind: CARD_KINDS.MONSTER }
          }
        ]
      }
    ]
  },
  {
    id: 'sky_striker_maneuver_afterburners',
    passcode: '99550630',
    name: 'Sky Striker Maneuver - Afterburners!',
    nameTh: 'สกายสไตรเกอร์ แมนูเวอร์ - อาฟเตอร์เบิร์นเนอร์! (Afterburners!)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.NORMAL,
    archetype: 'Sky Striker',
    description: 'Target 1 face-up monster on the field; destroy it, then, if you have 3 or more Spells in your GY, you can destroy 1 Spell/Trap on the field.',
    descriptionTh: '[เวทมนตร์ปกติ] ทำลายมอนสเตอร์บนสนามของอีกฝ่าย 1 ใบ และหากมีเวทในสุสาน 3 ใบขึ้นไป ทำลายเวท/กับดักของอีกฝ่ายเพิ่มอีก 1 ใบ!',
    effects: [
      {
        id: 'afterburners_pop',
        labelTh: 'ทำลายมอนสเตอร์อีกฝ่าย 1 ใบ (+ ทำลายเวท/กับดักหากมีเวทในสุสาน 3+ ใบ)',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        condition: { emptyMonsterZonesCountMin: 5, opponentControlsMonster: true },
        actions: [
          {
            type: ACTION_TYPES.DESTROY_CARDS,
            targetOwner: 'OPPONENT',
            targetZone: 'MONSTER',
            count: 1
          },
          {
            type: ACTION_TYPES.DESTROY_CARDS,
            targetOwner: 'OPPONENT',
            targetZone: 'SPELL_TRAP',
            count: 1,
            optional: true,
            bonusCondition: { minSpellsInGY: 3 }
          }
        ]
      }
    ]
  },
  {
    id: 'sky_striker_airspace_area_zero',
    passcode: '50005218',
    name: 'Sky Striker Airspace - Area Zero',
    nameTh: 'สกายสไตรเกอร์ แอร์สเปซ - แอเรีย ซีโร่ (Area Zero)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.FIELD,
    archetype: 'Sky Striker',
    description: 'You can target 1 other card you control; excavate the top 3 cards of your Deck, and if you do, you can add 1 excavated "Sky Striker" card to your hand.',
    descriptionTh: '[เวทมนตร์สนาม] เทิร์นละครั้ง: ค้นหาการ์ด "Sky Striker" 1 ใบจากเด็คขึ้นมือ',
    effects: [
      {
        id: 'area_zero_open',
        labelTh: 'เปิดใช้งานสนาม Area Zero',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        actions: []
      },
      {
        id: 'area_zero_search',
        labelTh: 'ใช้เอฟเฟค Area Zero: ค้นหาการ์ด Sky Striker 1 ใบ',
        trigger: TRIGGERS.IGNITION,
        spellSpeed: SPELL_SPEED.SS1,
        zones: ['FIELD'],
        opt: 'area_zero_opt',
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: { archetype: 'Sky Striker' }
          }
        ]
      }
    ]
  },
  {
    id: 'reinforcement_of_the_army',
    passcode: '32807846',
    name: 'Reinforcement of the Army',
    nameTh: 'กำลังเสริมแห่งกองทัพ (ROTA)',
    kind: CARD_KINDS.SPELL,
    subType: SPELL_SUBTYPES.NORMAL,
    archetype: 'Staple',
    description: 'Add 1 Level 4 or lower Warrior monster from your Deck to your hand.',
    descriptionTh: '[เวทมนตร์ปกติ] ค้นหามอนสเตอร์เผ่านักรบ (Warrior) เลเวล 4 หรือต่ำกว่า 1 ใบจากเด็คขึ้นมือ',
    effects: [
      {
        id: 'rota_search',
        labelTh: 'ค้นหามอนสเตอร์เผ่านักรบ Lv.1-4 จากเด็คขึ้นมือ',
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: SPELL_SPEED.SS1,
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: { kind: CARD_KINDS.MONSTER, race: 'Warrior', levelMax: 4 }
          }
        ]
      }
    ]
  },
  // === EXTRA DECK ===
  {
    id: 'sky_striker_ace_kagari',
    passcode: '63288573',
    name: 'Sky Striker Ace - Kagari',
    nameTh: 'สกายสไตรเกอร์ เอซ - คางาริ (Kagari)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.LINK,
    attribute: ATTRIBUTES.FIRE,
    race: 'Machine',
    linkRating: 1,
    linkArrows: ['TOP_LEFT'],
    atk: 1500,
    def: 0,
    archetype: 'Sky Striker',
    subArchetypes: ['Sky Striker Ace'],
    summonMaterials: {
      type: 'LINK',
      minMonsters: 1,
      maxMonsters: 1,
      filter: { archetype: 'Sky Striker', notAttribute: ATTRIBUTES.FIRE },
      descriptionTh: 'มอนสเตอร์ "Sky Striker Ace" ที่ไม่ใช่ธาตุไฟ 1 ใบ'
    },
    description: '1 non-FIRE "Sky Striker Ace" monster. If this card is Special Summoned: You can target 1 "Sky Striker" Spell in your GY; add it to your hand. Gains 100 ATK for each Spell in your GY.',
    descriptionTh: '[ลิงก์-1] เมื่อถูกอัญเชิญพิเศษสำเร็จ: เก็บการ์ดเวทมนตร์ "Sky Striker" 1 ใบจากสุสานกลับขึ้นมือ และได้รับพลังโจมตี +500 ATK!',
    effects: [
      {
        id: 'kagari_recover_spell',
        labelTh: 'เก็บเวทมนตร์ Sky Striker 1 ใบจากสุสานขึ้นมือ & เพิ่ม ATK',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'kagari_ss_opt',
        actions: [
          {
            type: ACTION_TYPES.MODIFY_STATS,
            targetSelf: true,
            atkDelta: 500,
            defDelta: 0
          },
          {
            type: ACTION_TYPES.RECOVER_FROM_GY_TO_HAND,
            count: 1,
            optional: true,
            filter: { archetype: 'Sky Striker', kind: CARD_KINDS.SPELL }
          }
        ]
      }
    ]
  },
  {
    id: 'sky_striker_ace_shizuku',
    passcode: '90673288',
    name: 'Sky Striker Ace - Shizuku',
    nameTh: 'สกายสไตรเกอร์ เอซ - ชิซึกุ (Shizuku)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.LINK,
    attribute: ATTRIBUTES.WATER,
    race: 'Machine',
    linkRating: 1,
    linkArrows: ['TOP_RIGHT'],
    atk: 1500,
    def: 0,
    archetype: 'Sky Striker',
    subArchetypes: ['Sky Striker Ace'],
    summonMaterials: {
      type: 'LINK',
      minMonsters: 1,
      maxMonsters: 1,
      filter: { archetype: 'Sky Striker', notAttribute: ATTRIBUTES.WATER },
      descriptionTh: 'มอนสเตอร์ "Sky Striker Ace" ที่ไม่ใช่ธาตุน้ำ 1 ใบ'
    },
    description: '1 non-WATER "Sky Striker Ace" monster. Once per turn, during the End Phase, if this card was Special Summoned this turn: You can add 1 "Sky Striker" Spell from your Deck to your hand.',
    descriptionTh: '[ลิงก์-1] เมื่ออัญเชิญพิเศษสำเร็จ (หรือกดใช้เทิร์นละครั้ง): ค้นหาการ์ดเวทมนตร์ "Sky Striker" 1 ใบจากเด็คขึ้นมือ!',
    effects: [
      {
        id: 'shizuku_search_spell',
        labelTh: 'ค้นหาเวทมนตร์ Sky Striker 1 ใบจากเด็คขึ้นมือ',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'shizuku_ss_opt',
        actions: [
          {
            type: ACTION_TYPES.SEARCH_DECK,
            count: 1,
            filter: { archetype: 'Sky Striker', kind: CARD_KINDS.SPELL }
          }
        ]
      }
    ]
  },
  {
    id: 'sky_striker_ace_hayate',
    passcode: '08491308',
    name: 'Sky Striker Ace - Hayate',
    nameTh: 'สกายสไตรเกอร์ เอซ - ฮายาเตะ (Hayate)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.LINK,
    attribute: ATTRIBUTES.WIND,
    race: 'Machine',
    linkRating: 1,
    linkArrows: ['BOTTOM_LEFT'],
    atk: 1500,
    def: 0,
    archetype: 'Sky Striker',
    subArchetypes: ['Sky Striker Ace'],
    canAttackDirectly: true,
    summonMaterials: {
      type: 'LINK',
      minMonsters: 1,
      maxMonsters: 1,
      filter: { archetype: 'Sky Striker', notAttribute: ATTRIBUTES.WIND },
      descriptionTh: 'มอนสเตอร์ "Sky Striker Ace" ที่ไม่ใช่ธาตุลม 1 ใบ'
    },
    description: '1 non-WIND "Sky Striker Ace" monster. Can attack directly. After damage calculation, if this card battled: You can send 1 "Sky Striker" card from your Deck to the GY.',
    descriptionTh: '[ลิงก์-1] สามารถโจมตีผู้เล่นโดยตรงได้! และเมื่อประกาศโจมตี สามารถส่งการ์ด "Sky Striker" 1 ใบจากเด็คลงสุสานเพื่อปั๊มจำนวนเวทในสุสาน',
    effects: [
      {
        id: 'hayate_dump_spell',
        labelTh: 'ส่งการ์ด Sky Striker 1 ใบจากเด็คลงสุสาน',
        trigger: TRIGGERS.ON_ATTACK_DECLARE,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'hayate_dump_opt',
        actions: [
          {
            type: ACTION_TYPES.SEND_FROM_DECK_TO_GY,
            count: 1,
            filter: { archetype: 'Sky Striker' }
          }
        ]
      }
    ]
  },
  {
    id: 'sky_striker_ace_zeke',
    passcode: '75147529',
    name: 'Sky Striker Ace - Zeke',
    nameTh: 'สกายสไตรเกอร์ เอซ - ซีค (Zeke)',
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.LINK,
    attribute: ATTRIBUTES.DARK,
    race: 'Machine',
    linkRating: 2,
    linkArrows: ['TOP', 'BOTTOM'],
    atk: 1500,
    def: 0,
    archetype: 'Sky Striker',
    subArchetypes: ['Sky Striker Ace'],
    summonMaterials: {
      type: 'LINK',
      minMonsters: 2,
      descriptionTh: 'มอนสเตอร์ 2 ใบ โดยต้องมีมอนสเตอร์ "Sky Striker Ace" อย่างน้อย 1 ใบ'
    },
    description: '2 monsters, including a "Sky Striker Ace" monster. If this card is Link Summoned: You can target 1 face-up monster on the field; banish it. Gains 1000 ATK.',
    descriptionTh: '[ลิงก์-2] เมื่อถูกอัญเชิญลิงก์สำเร็จ: มูฟมอนสเตอร์ของอีกฝ่าย 1 ใบออกนอกเกม และได้รับพลังโจมตี +1000 ATK!',
    effects: [
      {
        id: 'zeke_banish_and_boost',
        labelTh: 'มูฟมอนสเตอร์อีกฝ่าย 1 ใบ & เพิ่ม +1000 ATK',
        trigger: TRIGGERS.ON_SPECIAL_SUMMON,
        spellSpeed: SPELL_SPEED.SS1,
        opt: 'zeke_ss_opt',
        actions: [
          {
            type: ACTION_TYPES.MODIFY_STATS,
            targetSelf: true,
            atkDelta: 1000,
            defDelta: 0
          },
          {
            type: ACTION_TYPES.BANISH_CARDS,
            sourceZone: 'MONSTER',
            targetOwner: 'OPPONENT',
            count: 1,
            optional: true
          }
        ]
      }
    ]
  }
];
