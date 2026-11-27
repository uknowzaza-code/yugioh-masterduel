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
  69248256: { name: 'Swordsoul Grandmaster - Chixiao', roles: ['boss', 'searcher', 'negate'], counters: ['monster_effect_field'], category: CATEGORY.SEARCH | CATEGORY.DISABLE },
  4810828: { name: 'Swordsoul Supreme Sovereign - Chengying', roles: ['boss', 'removal'], category: CATEGORY.REMOVE },
  47710198: { name: 'Swordsoul Sinister Sovereign - Qixing Longyuan', roles: ['boss', 'removal'], category: CATEGORY.REMOVE | CATEGORY.DRAW },

  // === Maliss ===
  32061192: { name: 'Maliss <P> Dormouse', roles: ['starter', 'extender'], category: CATEGORY.REMOVE | CATEGORY.SPECIAL_SUMMON },
  69272449: { name: 'Maliss <P> White Rabbit', roles: ['starter', 'searcher', 'extender'], category: CATEGORY.SEARCH | CATEGORY.SPECIAL_SUMMON },
  96676583: { name: 'Maliss <P> Chessy Cat', roles: ['extender', 'searcher'], category: CATEGORY.DRAW | CATEGORY.REMOVE | CATEGORY.SPECIAL_SUMMON },
  20938824: { name: 'Maliss <P> March Hare', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.REMOVE },
  68337209: { name: 'Maliss in Underground', roles: ['starter', 'extender'], category: CATEGORY.REMOVE | CATEGORY.SPECIAL_SUMMON },
  68059897: { name: 'Maliss <Q> Red Ransom', roles: ['extender', 'searcher'], category: CATEGORY.SEARCH | CATEGORY.SPECIAL_SUMMON },
  95454996: { name: 'Maliss <Q> White Binder', roles: ['extender', 'removal'], category: CATEGORY.REMOVE | CATEGORY.SPECIAL_SUMMON | CATEGORY.DRAW },
  21848500: { name: 'Maliss <Q> Hearts Crypter', roles: ['boss', 'removal'], category: CATEGORY.REMOVE | CATEGORY.SPECIAL_SUMMON },
  94722358: { name: 'Maliss <C> MTP-07', roles: ['searcher', 'removal'], category: CATEGORY.SEARCH | CATEGORY.REMOVE },
  20726052: { name: 'Maliss <C> GWC-06', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },

  // === Mathmech ===
  36521307: { name: 'Mathmech Circular', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.DECKDES | CATEGORY.SEARCH },
  27182739: { name: 'Mathmech Sigma', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  17946349: { name: 'Mathmech Diameter', roles: ['starter', 'extender', 'negate'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.NEGATE },
  80965043: { name: 'Mathmech Addition', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  16360142: { name: 'Mathmech Subtraction', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  53577438: { name: 'Mathmech Nabla', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  85692042: { name: 'Primathmech Alembertian', roles: ['searcher', 'extender'], category: CATEGORY.SEARCH | CATEGORY.SPECIAL_SUMMON },
  88021907: { name: 'Primathmech Laplacian', roles: ['boss', 'removal'], category: CATEGORY.TOGRAVE },
  42632209: { name: 'Geomathmech Final Sigma', roles: ['boss'] },
  14025912: { name: 'Mathmech Equation', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  87804365: { name: 'Mathmech Superfactorial', roles: ['extender', 'removal'], category: CATEGORY.SPECIAL_SUMMON },

  // === Ryzeal ===
  8633261: { name: 'Ice Ryzeal', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  34022970: { name: 'Ext Ryzeal', roles: ['starter', 'extender', 'searcher'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.SEARCH },
  35844557: { name: 'Sword Ryzeal', roles: ['starter', 'extender', 'searcher'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.SEARCH },
  84433129: { name: 'Star Ryzeal', roles: ['extender', 'searcher'], category: CATEGORY.SPECIAL_SUMMON },
  72238166: { name: 'Node Ryzeal', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  7511613: { name: 'Ryzeal Duo Drive', roles: ['searcher', 'engine'], category: CATEGORY.SEARCH },
  34909328: { name: 'Ryzeal Detonator', roles: ['boss', 'removal'], category: CATEGORY.DESTROY },
  6798031: { name: 'Ryzeal Cross', roles: ['engine', 'negate'], category: CATEGORY.DRAW | CATEGORY.DISABLE },

  // === Exosister ===
  37343995: { name: 'Exosister Martha', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  16474916: { name: 'Exosister Elis', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  43863925: { name: 'Exosister Stella', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  5352328: { name: 'Exosister Sophia', roles: ['extender', 'searcher'], category: CATEGORY.DRAW | CATEGORY.SPECIAL_SUMMON },
  77913594: { name: 'Exosister Pax', roles: ['searcher', 'starter'], category: CATEGORY.SEARCH | CATEGORY.SPECIAL_SUMMON },
  42741437: { name: 'Exosister Mikailis', roles: ['boss', 'searcher', 'removal'], category: CATEGORY.SEARCH | CATEGORY.REMOVE },
  78135071: { name: 'Exosister Kaspitell', roles: ['searcher', 'floodgate'], category: CATEGORY.SEARCH },
  59242457: { name: 'Exosisters Magnifica', roles: ['boss', 'removal'], category: CATEGORY.REMOVE | CATEGORY.SPECIAL_SUMMON },
  77675029: { name: 'Exosister Karmael', roles: ['boss', 'negate'], category: CATEGORY.DISABLE },
  197042: { name: 'Exosister Returnia', roles: ['removal'], category: CATEGORY.REMOVE },
  77891946: { name: 'Exosister Vadis', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },

  // === Mitsurugi ===
  13332685: { name: 'Ame no Habakiri no Mitsurugi', roles: ['starter', 'searcher', 'extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.SEARCH },
  19899073: { name: 'Ame no Murakumo no Mitsurugi', roles: ['boss', 'boardwipe', 'negate'], category: CATEGORY.DESTROY | CATEGORY.NEGATE },
  55397172: { name: 'Futsu no Mitama no Mitsurugi', roles: ['boss', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  18176525: { name: 'Mitsurugi no Mikoto, Saji', roles: ['starter', 'searcher'], category: CATEGORY.SEARCH },
  40543231: { name: 'Mitsurugi no Mikoto, Aramasa', roles: ['starter', 'searcher'], category: CATEGORY.SEARCH },
  82782870: { name: 'Mitsurugi no Mikoto, Kusanagi', roles: ['extender', 'searcher'], category: CATEGORY.TOHAND },
  81560239: { name: 'Mitsurugi Ritual', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  49721684: { name: 'Mitsurugi Mirror', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  45171524: { name: 'Mitsurugi Prayers', roles: ['searcher', 'extender'], category: CATEGORY.SEARCH | CATEGORY.SPECIAL_SUMMON },

  // === Tearlaments ===
  73956664: { name: 'Tearlaments Reinoheart', roles: ['starter', 'extender'], category: CATEGORY.DECKDES | CATEGORY.SPECIAL_SUMMON },
  572850: { name: 'Tearlaments Scheiren', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.DECKDES },
  37961969: { name: 'Tearlaments Havnis', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.DECKDES },
  74078255: { name: 'Tearlaments Merrli', roles: ['starter', 'extender'], category: CATEGORY.DECKDES | CATEGORY.SPECIAL_SUMMON },
  4928565: { name: 'Tearlaments Kashtira', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.DECKDES },
  92731385: { name: 'Tearlaments Kitkallos', roles: ['searcher', 'extender'], category: CATEGORY.SEARCH | CATEGORY.DECKDES | CATEGORY.SPECIAL_SUMMON },
  84330567: { name: 'Tearlaments Rulkallos', roles: ['boss', 'negate'], counters: ['spsummon'], category: CATEGORY.NEGATE | CATEGORY.SPECIAL_SUMMON },
  28226490: { name: 'Tearlaments Kaleido-Heart', roles: ['boss', 'removal'], category: CATEGORY.TODECK },
  6767771: { name: 'Tearlaments Scream', roles: ['engine', 'searcher'], category: CATEGORY.DECKDES | CATEGORY.SEARCH },
  74920585: { name: 'Tearlaments Sulliek', roles: ['negate', 'searcher'], counters: ['monster_effect_field'], category: CATEGORY.DISABLE | CATEGORY.SEARCH },

  // === Shaddoll ===
  44394295: { name: 'Shaddoll Fusion', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.DECKDES },
  6417578: { name: 'El Shaddoll Fusion', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  21011044: { name: 'Shaddoll Schism', roles: ['engine', 'extender', 'removal'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.TOGRAVE },
  20366274: { name: 'El Shaddoll Construct', roles: ['boss', 'removal'], category: CATEGORY.DECKDES | CATEGORY.DESTROY },
  50907446: { name: 'El Shaddoll Apkallone', roles: ['boss', 'negate', 'searcher'], category: CATEGORY.DISABLE | CATEGORY.SEARCH },
  51023024: { name: 'Reeshaddoll Wendi', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  30328508: { name: 'Shaddoll Squamata', roles: ['starter', 'removal'], category: CATEGORY.DECKDES | CATEGORY.DESTROY },
  4939890: { name: 'Shaddoll Hedgehog', roles: ['searcher'], category: CATEGORY.SEARCH },
  3717252: { name: 'Shaddoll Beast', roles: ['searcher'], category: CATEGORY.DRAW },

  // === Dracotail ===
  75003700: { name: 'Dracotail Lukias', roles: ['starter', 'searcher'], category: CATEGORY.SEARCH },
  1498449: { name: 'Dracotail Faimena', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  7375867: { name: 'Dracotail Mululu', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  6153210: { name: 'Ketu Dracotail', roles: ['starter', 'searcher', 'extender'], category: CATEGORY.SEARCH | CATEGORY.SPECIAL_SUMMON },
  32548318: { name: 'Rahu Dracotail', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  33760966: { name: 'Dracotail Arthalion', roles: ['boss', 'removal'], category: CATEGORY.TOHAND },
  79755671: { name: 'Dracotail Gulamel', roles: ['boss', 'removal'], category: CATEGORY.DESTROY },
  42125140: { name: 'Dracotail Shaulas', roles: ['boss', 'extender'] },

  // === Resonators & Synchrons ===
  62991792: { name: 'Soul Resonator', roles: ['starter', 'searcher'], category: CATEGORY.SEARCH },
  34761841: { name: 'Crimson Resonator', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  98396890: { name: 'Vision Resonator', roles: ['extender', 'searcher'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.SEARCH },
  77360173: { name: 'Synkron Resonator', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  25784595: { name: 'Bone Archfiend', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.DECKDES },
  23008320: { name: 'Resonator Call', roles: ['searcher', 'starter'], category: CATEGORY.SEARCH },
  9753964: { name: 'Hot Red Dragon Archfiend Abyss', roles: ['boss', 'negate'], counters: ['any'], category: CATEGORY.DISABLE },
  36857073: { name: 'Hot Red Dragon Archfiend Bane', roles: ['boss', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  99585850: { name: 'Red Supernova Dragon', roles: ['boss', 'removal'], category: CATEGORY.REMOVE },
  27572350: { name: 'Bystial Dis Pater', roles: ['boss', 'negate', 'extender'], counters: ['monster_effect'], category: CATEGORY.NEGATE | CATEGORY.SPECIAL_SUMMON },
  63436931: { name: 'Crimson Dragon', roles: ['boss', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  63977008: { name: 'Junk Synchron', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  77202120: { name: 'Assault Synchron', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  9742784: { name: 'Jet Synchron', roles: ['starter', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  37799519: { name: 'Stardust Synchron', roles: ['starter', 'extender', 'searcher'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.SEARCH },
  20932152: { name: 'Quickdraw Synchron', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  53855409: { name: 'Doppelwarrior', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.TOKEN },
  77075360: { name: 'Junk Speeder', roles: ['boss', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  37675907: { name: 'Accel Synchron', roles: ['extender'], category: CATEGORY.DECKDES },
  50091196: { name: 'Formula Synchron', roles: ['extender', 'searcher'], category: CATEGORY.DRAW },

  // === D/D/D ===
  11609969: { name: 'D/D Savant Kepler', roles: ['starter', 'searcher'], category: CATEGORY.SEARCH, lscale: 10, rscale: 10 },
  28406301: { name: 'D/D Gryphon', roles: ['starter', 'extender', 'searcher'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.SEARCH, lscale: 1, rscale: 1 },
  19580308: { name: 'D/D Lamia', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  46372010: { name: 'Dark Contract with the Gate', roles: ['starter', 'searcher', 'engine'], category: CATEGORY.SEARCH },
  10833828: { name: 'Forbidden Dark Contract with the Swamp King', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  9024198: { name: 'D/D/D Abyss King Gilgamesh', roles: ['starter', 'extender', 'engine'], category: CATEGORY.SPECIAL_SUMMON },
  44852429: { name: 'D/D/D Cursed King Siegfried', roles: ['boss', 'negate'], counters: ['spelltrap_activation'], category: CATEGORY.NEGATE },
  46593546: { name: 'D/D/D Deviser King Deus Machinex', roles: ['boss', 'removal'], category: CATEGORY.CONTROL },
  15939229: { name: 'D/D/D Duo-Dawn King Kali Yuga', roles: ['boss', 'negate', 'boardwipe'], category: CATEGORY.DISABLE | CATEGORY.DESTROY },
  16006416: { name: 'D/D/D Flame High King Genghis', roles: ['boss', 'extender', 'negate'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.NEGATE },

  // === Darklord ===
  52840267: { name: 'Darklord Ixchel', roles: ['starter', 'searcher'], category: CATEGORY.DRAW },
  82773292: { name: 'Indulged Darklord', roles: ['starter', 'searcher', 'extender'], category: CATEGORY.SEARCH | CATEGORY.SPECIAL_SUMMON },
  11260714: { name: 'Darklord Superbia', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  25339070: { name: 'Darklord Nasten', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  25451652: { name: 'Darklord Morningstar', roles: ['boss', 'extender'], category: CATEGORY.SPECIAL_SUMMON },
  14517422: { name: 'Darklord Contact', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  35306215: { name: 'Condemned Darklord', roles: ['searcher', 'engine'], category: CATEGORY.SEARCH },
  4167084: { name: 'The First Darklord', roles: ['boss', 'extender', 'boardwipe'], category: CATEGORY.SPECIAL_SUMMON | CATEGORY.DESTROY },
  48152161: { name: 'The Sanctified Darklord', roles: ['negate'], counters: ['monster_effect_field'], category: CATEGORY.DISABLE },

  // === Utility Links ===
  30342076: { name: 'Link Decoder', roles: ['extender'], category: CATEGORY.SPECIAL_SUMMON },
  24842059: { name: 'Linguriboh', roles: ['negate'], category: CATEGORY.NEGATE },
  71818935: { name: 'Moon of the Closed Heaven', roles: ['extender'] },

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
  if ((s.type & TYPE.MONSTER) && (s.type & TYPE.RITUAL) && s.atk >= 2400) r.add('boss');
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
      lscale: o.lscale ?? db.lscale ?? 0,
      rscale: o.rscale ?? db.rscale ?? 0,
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
