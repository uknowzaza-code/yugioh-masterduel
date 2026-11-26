import { TYPE, CATEGORY, LOC, EXTRA_DECK_TYPES } from './constants.js';

export const ROLE = Object.freeze({
  STARTER: 'starter', SEARCHER: 'searcher', EXTENDER: 'extender', BOSS: 'boss', HANDTRAP: 'handtrap',
  NEGATE: 'negate', REMOVAL: 'removal', BOARDWIPE: 'boardwipe', FLOODGATE: 'floodgate', ENGINE: 'engine',
});

// counters = ประเภทเอฟเฟกต์ที่การ์ดใบนี้ "ตอบโต้ได้"; timing = เงื่อนไขพิเศษ
const BUILTIN = {
  // === Hand Traps & Quick Disruptions ===
  14558127: { name: 'Ash Blossom & Joyous Spring', roles: ['handtrap'], counters: ['search', 'draw', 'spsummon', 'mill'] },
  23434538: { name: 'Maxx "C"', roles: ['handtrap'], timing: 'opp_turn_any', category: CATEGORY.DRAW },
  42141493: { name: 'Mulcharmy Fuwalos', roles: ['handtrap'], timing: 'opp_turn_any', category: CATEGORY.DRAW },
  84192580: { name: 'Mulcharmy Purulia', roles: ['handtrap'], timing: 'opp_turn_any', category: CATEGORY.DRAW },
  97268402: { name: 'Effect Veiler', roles: ['handtrap', 'negate'], counters: ['monster_effect_field'] },
  10045474: { name: 'Infinite Impermanence', roles: ['handtrap', 'negate'], counters: ['monster_effect_field'], columnSensitive: true },
  59438930: { name: 'Ghost Ogre & Snow Rabbit', roles: ['handtrap'], counters: ['field_effect'] },
  73642296: { name: 'Ghost Belle & Haunted Mansion', roles: ['handtrap', 'negate'], counters: ['grave_effect'] },
  94145021: { name: 'Droll & Lock Bird', roles: ['handtrap'], counters: ['search'] },
  27204311: { name: 'Nibiru, the Primal Being', roles: ['handtrap'], timing: 'opp_summon5' },
  24224830: { name: 'Called by the Grave', roles: ['negate'], counters: ['grave_effect', 'handtrap_response'] },
  65681983: { name: 'Crossout Designator', roles: ['negate'], counters: ['handtrap_response', 'negate', 'any'] },
  41420027: { name: 'Solemn Judgment', roles: ['negate'], counters: ['spelltrap_activation', 'summon', 'negate'] },
  40605147: { name: 'Solemn Strike', roles: ['negate'], counters: ['monster_effect', 'summon'] },
  44095762: { name: 'Mirror Force', roles: ['removal'], timing: 'opp_attack' },

  // === Board Wipes & Staples ===
  12580477: { name: 'Raigeki', roles: ['boardwipe'], side: 'opp', category: CATEGORY.DESTROY },
  14532163: { name: 'Lightning Storm', roles: ['boardwipe'], side: 'opp', category: CATEGORY.DESTROY },
  53129443: { name: 'Dark Hole', roles: ['boardwipe'], side: 'both', category: CATEGORY.DESTROY },
  18144506: { name: "Harpie's Feather Duster", roles: ['boardwipe'], side: 'opp_st', category: CATEGORY.DESTROY },
  19613556: { name: 'Heavy Storm', roles: ['boardwipe'], side: 'both_st', category: CATEGORY.DESTROY },
  83764718: { name: 'Monster Reborn', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  32807846: { name: 'Reinforcement of the Army', roles: ['searcher'], category: CATEGORY.SEARCH },
  81439173: { name: 'Foolish Burial', roles: ['starter'], category: CATEGORY.DECKDES },
  55144522: { name: 'Pot of Greed', roles: ['searcher'], category: CATEGORY.DRAW },
  35261759: { name: 'Pot of Desires', roles: ['searcher'], category: CATEGORY.DRAW },
  84211599: { name: 'Pot of Prosperity', roles: ['searcher'], category: CATEGORY.SEARCH },

  // === Bosses, Omni-Negates & Floodgates ===
  86066372: { name: 'Accesscode Talker', roles: ['boss', 'removal'], category: CATEGORY.DESTROY },
  4280258: { name: 'Apollousa, Bow of the Goddess', roles: ['boss', 'negate'], counters: ['monster_effect'], category: CATEGORY.NEGATE },
  84815190: { name: 'Baronne de Fleur', roles: ['boss', 'negate', 'removal'], counters: ['any'], category: CATEGORY.NEGATE | CATEGORY.DESTROY },
  29301450: { name: 'S:P Little Knight', roles: ['boss', 'removal'], category: CATEGORY.REMOVE },
  90448279: { name: 'Divine Arsenal AA-ZEUS - Sky Thunder', roles: ['boss', 'boardwipe'], category: CATEGORY.DESTROY },
  27548199: { name: 'Borreload Savage Dragon', roles: ['boss', 'negate'], counters: ['any'], category: CATEGORY.NEGATE },
  82732705: { name: 'Skill Drain', roles: ['floodgate'], category: CATEGORY.DISABLE },
  94977269: { name: 'El Shaddoll Winda', roles: ['boss', 'floodgate'] },
  42009836: { name: 'Fossil Dyna Pachycephalo', roles: ['floodgate'] },

  // === Swordsoul ===
  20001443: { name: 'Swordsoul of Mo Ye', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.TOKEN | CATEGORY.DRAW },
  56495147: { name: 'Swordsoul Emergence', roles: ['searcher', 'starter'], category: CATEGORY.SEARCH },
  55273560: { name: 'Incredible Ecclesia, the Virtuous', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  74069667: { name: 'Swordsoul Strategist Longyuan', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.TOKEN },
  69248256: { name: 'Swordsoul of Taia', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.TOKEN | CATEGORY.DECKDES },
  69272449: { name: 'Swordsoul Grandmaster - Chixiao', roles: ['boss', 'searcher', 'negate'], counters: ['monster_effect_field'], category: CATEGORY.SEARCH | CATEGORY.DISABLE },
  4810828: { name: 'Swordsoul Supreme Sovereign - Chengying', roles: ['boss', 'removal'], category: CATEGORY.REMOVE },
  47710198: { name: 'Swordsoul Sinister Sovereign - Qixing Longyuan', roles: ['boss', 'removal'], category: CATEGORY.REMOVE | CATEGORY.DRAW },

  // === Branded Despia ===
  44362883: { name: 'Branded Fusion', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.DECKDES },
  62962630: { name: 'Aluber the Jester of Despia', roles: ['starter', 'searcher'], category: CATEGORY.SEARCH },
  68468459: { name: 'Fallen of Albaz', roles: ['starter', 'removal'], category: CATEGORY.SPECIAL_SUMMON },
  36637374: { name: 'Branded Opening', roles: ['starter', 'searcher', 'extender'], category: CATEGORY.SEARCH | CATEGORY.SPECIAL_SUMMON },
  44146295: { name: 'Mirrorjade the Iceblade Dragon', roles: ['boss', 'removal'], category: CATEGORY.REMOVE },
  70534340: { name: 'Lubellion the Searing Dragon', roles: ['extender', 'boss'], category: CATEGORY.SPECIAL_SUMMON },
  87746184: { name: 'Albion the Branded Dragon', roles: ['extender', 'searcher'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.SEARCH },
  60242223: { name: 'Despian Tragedy', roles: ['searcher'], category: CATEGORY.SEARCH },

  // === Sky Striker ===
  63166095: { name: 'Sky Striker Mobilize - Engage!', roles: ['searcher', 'starter'], category: CATEGORY.SEARCH | CATEGORY.DRAW },
  52340444: { name: 'Sky Striker Mecha - Hornet Drones', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.TOKEN },
  26077387: { name: 'Sky Striker Ace - Raye', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  63288573: { name: 'Sky Striker Ace - Kagari', roles: ['extender', 'searcher'], category: CATEGORY.SEARCH },
  90673288: { name: 'Sky Striker Ace - Shizuku', roles: ['searcher', 'engine'], category: CATEGORY.SEARCH },
  8491308: { name: 'Sky Striker Ace - Hayate', roles: ['extender'], category: CATEGORY.DECKDES },
  98338152: { name: 'Sky Striker Mecha - Widow Anchor', roles: ['negate', 'removal'], counters: ['monster_effect_field'], category: CATEGORY.DISABLE | CATEGORY.CONTROL },
  99550630: { name: 'Sky Striker Maneuver - Afterburners!', roles: ['removal'], category: CATEGORY.DESTROY },
  25955749: { name: 'Sky Striker Maneuver - Jamming Waves!', roles: ['removal'], category: CATEGORY.DESTROY },

  // === Blue-Eyes & Dark Magician ===
  48800175: { name: 'The Melody of Awakening Dragon', roles: ['searcher', 'starter'], category: CATEGORY.SEARCH },
  8240199: { name: 'Sage with Eyes of Blue', roles: ['starter', 'searcher'], category: CATEGORY.SEARCH },
  38517737: { name: 'Blue-Eyes Alternative White Dragon', roles: ['extender', 'removal'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.DESTROY },
  30576089: { name: 'Blue-Eyes Jet Dragon', roles: ['boss', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  59822133: { name: 'Blue-Eyes Spirit Dragon', roles: ['boss', 'negate'], counters: ['grave_effect'], category: CATEGORY.NEGATE },
  7084129: { name: "Magician's Rod", roles: ['starter', 'searcher'], category: CATEGORY.SEARCH },
  97631303: { name: "Magicians' Souls", roles: ['starter', 'extender'], category: CATEGORY.DECKDES | CATEGORY.SPECIAL_SUMMON | CATEGORY.DRAW },
  47222536: { name: 'Dark Magical Circle', roles: ['engine', 'searcher', 'removal'], category: CATEGORY.SEARCH | CATEGORY.REMOVE },
  48680970: { name: 'Eternal Soul', roles: ['engine', 'extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.SEARCH },
  30603688: { name: 'Apprentice Illusion Magician', roles: ['extender', 'searcher'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.SEARCH },
};

function deriveRoles(s) {
  const r = new Set();
  const c = s.category ?? 0;
  if (c & (CATEGORY.SEARCH | CATEGORY.DRAW)) r.add('searcher');
  if (c & CATEGORY.SPECIAL_SUMMON) r.add('extender');
  if (c & (CATEGORY.DESTROY | CATEGORY.REMOVE | CATEGORY.TODECK | CATEGORY.CONTROL)) r.add('removal');
  if (c & (CATEGORY.NEGATE | CATEGORY.DISABLE | CATEGORY.DISABLE_SUMMON)) r.add('negate');
  if (s.isFloodgate) r.add('floodgate');
  if ((s.type & EXTRA_DECK_TYPES) && s.atk >= 2500) r.add('boss');
  return r;
}

export class CardKnowledge {
  /**
   * @param {{ cardDb?: { get(code:number): object|null }, overrides?: Record<number, object> }} opts
   */
  constructor({ cardDb = null, overrides = {} } = {}) {
    this.cardDb = cardDb;
    this.table = new Map(Object.entries({ ...BUILTIN, ...overrides }).map(([k, v]) => [Number(k), v]));
    this.cache = new Map();
  }

  stats(code) {
    const o = this.table.get(code) ?? {};
    const db = (code && this.cardDb?.get?.(code)) || {};
    const type = o.type ?? db.type ?? 0;
    const rawDef = o.def ?? db.def ?? 0;
    const isLinkCard = (type & TYPE.LINK) !== 0;
    return {
      code,
      name: o.name ?? db.name ?? `#${code}`,
      type,
      atk: o.atk ?? db.atk ?? 0,
      def: isLinkCard ? 0 : rawDef,
      level: o.level ?? db.level ?? 0,
      category: (o.category ?? 0) | (db.category ?? 0),
      isFloodgate: Boolean(o.isFloodgate || db.isFloodgate),
      linkMarkers: isLinkCard ? (o.linkMarkers ?? rawDef) : 0,
    };
  }

  info(code) {
    if (this.cache.has(code)) return this.cache.get(code);
    const o = this.table.get(code) ?? {};
    const s = this.stats(code);
    const roles = new Set(o.roles ?? []);
    // ผสาน roles จาก PSCT category ด้วย (เว้นแต่จะปิดไว้ชัดเจน)
    if (o.deriveRoles !== false) {
      for (const r of deriveRoles(s)) roles.add(r);
    }
    const info = Object.freeze({
      ...s,
      roles,
      counters: new Set(o.counters ?? ['any']),
      timing: o.timing ?? null,
      side: o.side ?? 'opp',
      columnSensitive: !!o.columnSensitive,
      avoidOptional: !!o.avoidOptional,
    });
    this.cache.set(code, info);
    return info;
  }
}

/** แปลง chain link เป็น "แท็ก" เพื่อจับคู่กับ counters ของ hand trap */
export function effectTags(link, info) {
  const tags = new Set();
  const c = (link.category ?? 0) | (info.category ?? 0);
  if (c & CATEGORY.SEARCH) tags.add('search');
  if (c & CATEGORY.DRAW) tags.add('draw');
  if (c & CATEGORY.SPECIAL_SUMMON) tags.add('spsummon');
  if (c & CATEGORY.DECKDES) tags.add('mill');
  if (c & (CATEGORY.DESTROY | CATEGORY.REMOVE | CATEGORY.TODECK | CATEGORY.CONTROL)) tags.add('removal');
  if (c & (CATEGORY.NEGATE | CATEGORY.DISABLE | CATEGORY.DISABLE_SUMMON)) tags.add('negate');
  if (info.roles.has('handtrap') || info.roles.has('negate')) tags.add('handtrap_response');
  const loc = link.location ?? 0;
  const isMonster = (info.type & TYPE.MONSTER) !== 0 || (loc & LOC.MZONE) !== 0;
  tags.add(isMonster ? 'monster_effect' : 'spelltrap_activation');
  if (loc & LOC.ONFIELD) tags.add('field_effect');
  if (isMonster && (loc & LOC.MZONE)) tags.add('monster_effect_field');
  if (loc & LOC.GRAVE) tags.add('grave_effect');
  return tags;
}
