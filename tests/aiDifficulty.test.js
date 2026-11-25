import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction
} from 'ocgcore-wasm';
import {
  AI_DIFFICULTY,
  normalizeAiDifficulty,
  formatAiDisplayName,
  createAiTurnState,
  computeYgoProAiResponse
} from '../src/engine/YgoProAi.js';
import { getSharedOcgCore, YGOProEngine } from '../src/engine/YGOProEngine.js';
import { PRESET_DECKS, getPresetDeckById, expandDeckRecipe } from '../src/cards/index.js';
import { PHASES, POSITIONS } from '../src/constants/gameConstants.js';

function makeMetaLookup(map) {
  return (code) => map[Number(code)] || null;
}

function makeTestState({
  aiLp = 8000,
  oppLp = 8000,
  aiMzone = [],
  oppMzone = [],
  aiStz = [],
  oppStz = [],
  aiFieldZone = null,
  oppFieldZone = null,
  aiHand = [],
  aiGy = [],
  oppGy = []
} = {}) {
  const mkMzone = (list) => {
    const arr = [null, null, null, null, null];
    list.forEach((m, i) => {
      if (m && i < 5) {
        arr[i] = {
          passcode: String(m.code || 0),
          name: m.name || `Card #${m.code}`,
          atk: m.atk ?? 0,
          def: m.def ?? 0,
          currentAtk: m.currentAtk ?? m.atk ?? 0,
          currentDef: m.currentDef ?? m.def ?? 0,
          position: m.position || POSITIONS.ATK,
          isFaceDown: Boolean(m.isFaceDown),
          isExtraDeck: Boolean(m.isExtraDeck),
          effectsNegated: Boolean(m.effectsNegated),
          description: m.description || '',
          instanceId: `ocg_p${m.controller ?? 0}_loc${OcgLocation.MZONE}_seq${m.sequence ?? i}`
        };
      }
    });
    return arr;
  };
  const mkStz = (list) => {
    const arr = [null, null, null, null, null];
    list.forEach((s, i) => {
      if (s && i < 5) arr[i] = s;
    });
    return arr;
  };
  const players = [
    { lp: oppLp, mmz: mkMzone(oppMzone), emzSlots: [null, null], stz: mkStz(oppStz), fieldZone: oppFieldZone, fieldSpell: oppFieldZone, hand: [], gy: oppGy, banished: [], extra: [] },
    { lp: aiLp, mmz: mkMzone(aiMzone), emzSlots: [null, null], stz: mkStz(aiStz), fieldZone: aiFieldZone, fieldSpell: aiFieldZone, hand: aiHand, gy: aiGy, banished: [], extra: [] }
  ];
  return { players };
}

test('normalizeAiDifficulty and formatAiDisplayName handle valid and invalid inputs', () => {
  assert.equal(normalizeAiDifficulty('easy'), AI_DIFFICULTY.EASY);
  assert.equal(normalizeAiDifficulty('HARD'), AI_DIFFICULTY.HARD);
  assert.equal(normalizeAiDifficulty('normal'), AI_DIFFICULTY.NORMAL);
  assert.equal(normalizeAiDifficulty('unknown'), AI_DIFFICULTY.NORMAL);
  assert.equal(normalizeAiDifficulty(null), AI_DIFFICULTY.NORMAL);

  assert.equal(formatAiDisplayName('easy'), 'YGOPro AI (Easy)');
  assert.equal(formatAiDisplayName('normal'), 'YGOPro AI (Normal)');
  assert.equal(formatAiDisplayName('hard'), 'YGOPro AI (Hard)');
});

test('SELECT_BATTLECMD prevents suicide on Normal/Hard and orders direct attacks smallest-first on Hard', () => {
  // Weak 500 ATK monster facing 3000 ATK Blue-Eyes
  const stateWithBoss = makeTestState({
    aiMzone: [{ code: 1001, atk: 500, controller: 1, sequence: 0 }],
    oppMzone: [{ code: 89631139, name: 'Blue-Eyes White Dragon', atk: 3000, def: 2500, controller: 0, sequence: 0 }]
  });
  const battleMsg = {
    type: OcgMessageType.SELECT_BATTLECMD,
    player: 1,
    chains: [],
    attacks: [{ code: 1001, controller: 1, location: OcgLocation.MZONE, sequence: 0, atk: 500 }],
    to_m2: true,
    to_ep: true
  };

  const hardResp = computeYgoProAiResponse(battleMsg, {
    aiIndex: 1,
    difficulty: 'hard',
    state: stateWithBoss,
    phase: PHASES.BP,
    turnCount: 2,
    turnPlayerIndex: 1,
    chainStack: [],
    lastHintMsg: 0,
    aiState: createAiTurnState(),
    getCardMeta: makeMetaLookup({})
  });
  assert.equal(hardResp.action, SelectBattleCMDAction.TO_M2, 'Hard AI must NOT suicide 500 ATK into 3000 ATK');

  const normalResp = computeYgoProAiResponse(battleMsg, {
    aiIndex: 1,
    difficulty: 'normal',
    state: stateWithBoss,
    phase: PHASES.BP,
    turnCount: 2,
    turnPlayerIndex: 1,
    chainStack: [],
    lastHintMsg: 0,
    aiState: createAiTurnState(),
    getCardMeta: makeMetaLookup({})
  });
  assert.equal(normalResp.action, SelectBattleCMDAction.TO_M2, 'Normal AI must NOT suicide 500 ATK into 3000 ATK');

  // Open board with 3000 ATK (index 0) and 1200 ATK (index 1): Hard attacks smallest first (index 1)
  const openBoard = makeTestState({
    aiMzone: [
      { code: 89631139, atk: 3000, controller: 1, sequence: 0 },
      { code: 2002, atk: 1200, controller: 1, sequence: 1 }
    ],
    oppMzone: []
  });
  const openBattleMsg = {
    type: OcgMessageType.SELECT_BATTLECMD,
    player: 1,
    chains: [],
    attacks: [
      { code: 89631139, controller: 1, location: OcgLocation.MZONE, sequence: 0, atk: 3000 },
      { code: 2002, controller: 1, location: OcgLocation.MZONE, sequence: 1, atk: 1200 }
    ],
    to_m2: true,
    to_ep: true
  };
  const hardOpen = computeYgoProAiResponse(openBattleMsg, {
    aiIndex: 1,
    difficulty: 'hard',
    state: openBoard,
    phase: PHASES.BP,
    turnCount: 2,
    turnPlayerIndex: 1,
    chainStack: [],
    lastHintMsg: 0,
    aiState: createAiTurnState(),
    getCardMeta: makeMetaLookup({})
  });
  assert.equal(hardOpen.action, SelectBattleCMDAction.SELECT_BATTLE);
  assert.equal(hardOpen.index, 1, 'Hard AI should attack with lowest ATK direct attacker first');
});

test('SELECT_CARD and SELECT_TRIBUTE use HINT_SELECTMSG for threat targeting vs lowest-value tribute', () => {
  const state = makeTestState({
    aiMzone: [
      { code: 3001, name: 'Token', atk: 0, def: 0, controller: 1, sequence: 0 },
      { code: 84815190, name: 'Baronne de Fleur', atk: 3000, def: 2400, isExtraDeck: true, description: 'Once per turn: negate the activation.', controller: 1, sequence: 1 }
    ],
    oppMzone: [
      { code: 4001, name: 'Vanilla 1000', atk: 1000, def: 1000, controller: 0, sequence: 0 },
      { code: 84815190, name: 'Baronne de Fleur', atk: 3000, def: 2400, isExtraDeck: true, description: 'Once per turn: negate the activation.', controller: 0, sequence: 1 }
    ]
  });
  const metaMap = {
    3001: { passcode: '3001', atk: 0, def: 0, description: '' },
    4001: { passcode: '4001', atk: 1000, def: 1000, description: '' },
    84815190: { passcode: '84815190', atk: 3000, def: 2400, isExtraDeck: true, description: 'Once per turn: negate the activation.' }
  };

  // Destroy hint (502): pick opponent's Baronne (index 3), NOT own Token or weak 1000 vanilla
  const destroyMsg = {
    type: OcgMessageType.SELECT_CARD,
    player: 1,
    can_cancel: false,
    min: 1,
    max: 1,
    selects: [
      { code: 3001, controller: 1, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
      { code: 84815190, controller: 1, location: OcgLocation.MZONE, sequence: 1, position: OcgPosition.FACEUP_ATTACK },
      { code: 4001, controller: 0, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
      { code: 84815190, controller: 0, location: OcgLocation.MZONE, sequence: 1, position: OcgPosition.FACEUP_ATTACK }
    ]
  };
  const hardDestroy = computeYgoProAiResponse(destroyMsg, {
    aiIndex: 1,
    difficulty: 'hard',
    state,
    phase: PHASES.MP1,
    turnCount: 2,
    turnPlayerIndex: 1,
    chainStack: [],
    lastHintMsg: 502,
    aiState: createAiTurnState(),
    getCardMeta: makeMetaLookup(metaMap)
  });
  assert.deepEqual(hardDestroy.indicies, [3]);

  // Tribute hint (500): tribute own 0 ATK Token (index 0), NOT Baronne (index 1)
  const tributeMsg = {
    type: OcgMessageType.SELECT_TRIBUTE,
    player: 1,
    can_cancel: false,
    min: 1,
    max: 1,
    selects: [
      { code: 84815190, controller: 1, location: OcgLocation.MZONE, sequence: 1, release_param: 1 },
      { code: 3001, controller: 1, location: OcgLocation.MZONE, sequence: 0, release_param: 1 }
    ]
  };
  const hardTribute = computeYgoProAiResponse(tributeMsg, {
    aiIndex: 1,
    difficulty: 'hard',
    state,
    phase: PHASES.MP1,
    turnCount: 2,
    turnPlayerIndex: 1,
    chainStack: [],
    lastHintMsg: 500,
    aiState: createAiTurnState(),
    getCardMeta: makeMetaLookup(metaMap)
  });
  assert.deepEqual(hardTribute.indicies, [1]);
});

test('SELECT_POSITION picks FACEUP_DEFENSE for low-ATK wall on Normal/Hard vs FACEUP_ATTACK on Easy', () => {
  const state = makeTestState({
    oppMzone: [{ code: 89631139, atk: 3000, def: 2500, controller: 0, sequence: 0 }]
  });
  const metaMap = {
    14558127: { passcode: '14558127', atk: 0, def: 1800 },
    89631139: { passcode: '89631139', atk: 3000, def: 2500 }
  };
  const posMsg = {
    type: OcgMessageType.SELECT_POSITION,
    player: 1,
    code: 14558127,
    positions: OcgPosition.FACEUP_ATTACK | OcgPosition.FACEUP_DEFENSE
  };

  const easyPos = computeYgoProAiResponse(posMsg, {
    aiIndex: 1,
    difficulty: 'easy',
    state,
    phase: PHASES.MP1,
    turnCount: 2,
    turnPlayerIndex: 1,
    chainStack: [],
    lastHintMsg: 0,
    aiState: createAiTurnState(),
    getCardMeta: makeMetaLookup(metaMap)
  });
  assert.equal(easyPos.position, OcgPosition.FACEUP_ATTACK);

  const hardPos = computeYgoProAiResponse(posMsg, {
    aiIndex: 1,
    difficulty: 'hard',
    state,
    phase: PHASES.MP1,
    turnCount: 2,
    turnPlayerIndex: 1,
    chainStack: [],
    lastHintMsg: 0,
    aiState: createAiTurnState(),
    getCardMeta: makeMetaLookup(metaMap)
  });
  assert.equal(hardPos.position, OcgPosition.FACEUP_DEFENSE);

  const beaterMsg = { ...posMsg, code: 89631139 };
  const hardBeaterPos = computeYgoProAiResponse(beaterMsg, {
    aiIndex: 1,
    difficulty: 'hard',
    state,
    phase: PHASES.MP1,
    turnCount: 2,
    turnPlayerIndex: 1,
    chainStack: [],
    lastHintMsg: 0,
    aiState: createAiTurnState(),
    getCardMeta: makeMetaLookup(metaMap)
  });
  assert.equal(hardBeaterPos.position, OcgPosition.FACEUP_ATTACK);
});

test('SELECT_CHAIN enforces Easy restraint and Hard Ash Blossom / no-double-negate discipline', () => {
  const state = makeTestState();
  const metaMap = {
    14558127: { passcode: '14558127', description: 'When a card or effect is activated: negate that effect.' },
    97268402: { passcode: '97268402', description: 'Negate the effects of 1 face-up monster.' }
  };
  const chainMsg = {
    type: OcgMessageType.SELECT_CHAIN,
    player: 1,
    spe_count: 1,
    forced: false,
    selects: [
      { code: 14558127, controller: 1, location: OcgLocation.HAND, sequence: 0, description: 0n }
    ]
  };

  // Easy skips optional opponent chain interruption
  const easyResp = computeYgoProAiResponse(chainMsg, {
    aiIndex: 1,
    difficulty: 'easy',
    state,
    phase: PHASES.MP1,
    turnCount: 1,
    turnPlayerIndex: 0,
    chainStack: [{ chainLink: 1, playerIndex: 0 }],
    lastHintMsg: 0,
    aiState: createAiTurnState(),
    getCardMeta: makeMetaLookup(metaMap)
  });
  assert.equal(easyResp.index, null);

  // Hard chains Ash Blossom to opponent's Chain Link 1, then does NOT double-negate same Chain Link 1
  const aiState = createAiTurnState();
  const hardFirst = computeYgoProAiResponse(chainMsg, {
    aiIndex: 1,
    difficulty: 'hard',
    state,
    phase: PHASES.MP1,
    turnCount: 1,
    turnPlayerIndex: 0,
    chainStack: [{ chainLink: 1, playerIndex: 0 }],
    lastHintMsg: 0,
    aiState,
    getCardMeta: makeMetaLookup(metaMap)
  });
  assert.equal(hardFirst.index, 0);

  const secondNegateMsg = {
    ...chainMsg,
    selects: [{ code: 97268402, controller: 1, location: OcgLocation.HAND, sequence: 1, description: 0n }]
  };
  const hardSecond = computeYgoProAiResponse(secondNegateMsg, {
    aiIndex: 1,
    difficulty: 'hard',
    state,
    phase: PHASES.MP1,
    turnCount: 1,
    turnPlayerIndex: 0,
    chainStack: [{ chainLink: 1, playerIndex: 0 }],
    lastHintMsg: 0,
    aiState,
    getCardMeta: makeMetaLookup(metaMap)
  });
  assert.equal(hardSecond.index, null, 'Hard AI must not double-negate the same Chain Link');
});

test('SELECT_OPTION prefers Add to Hand (573) over Send to GY (574) and retryAttempt > 0 falls back safely', () => {
  const optMsg = {
    type: OcgMessageType.SELECT_OPTION,
    player: 1,
    options: [574n, 573n]
  };
  const hardOpt = computeYgoProAiResponse(optMsg, {
    aiIndex: 1,
    difficulty: 'hard',
    state: makeTestState(),
    phase: PHASES.MP1,
    turnCount: 1,
    turnPlayerIndex: 1,
    chainStack: [],
    lastHintMsg: 0,
    aiState: createAiTurnState(),
    getCardMeta: makeMetaLookup({})
  });
  assert.equal(hardOpt.index, 1);

  const retryFallback = computeYgoProAiResponse(
    { type: OcgMessageType.SELECT_IDLECMD, player: 1, to_ep: true, to_bp: false },
    {
      aiIndex: 1,
      difficulty: 'hard',
      retryAttempt: 1,
      state: makeTestState(),
      phase: PHASES.MP1,
      turnCount: 1,
      turnPlayerIndex: 1,
      chainStack: [],
      lastHintMsg: 0,
      aiState: createAiTurnState(),
      getCardMeta: makeMetaLookup({})
    }
  );
  assert.equal(retryFallback.action, SelectIdleCMDAction.TO_EP);
});

test('Real YGOProEngine (ocgcore-wasm) runs multi-turn duels across Easy, Normal, and Hard without crashes or RETRY loops', async () => {
  const core = await getSharedOcgCore();
  const d0 = PRESET_DECKS[0];
  const d1 = PRESET_DECKS[1] || PRESET_DECKS[0];
  const deck1Cards = [...expandDeckRecipe(d0.mainDeckRecipe || []), ...expandDeckRecipe(d0.extraDeckRecipe || [])];
  const deck2Cards = [...expandDeckRecipe(d1.mainDeckRecipe || []), ...expandDeckRecipe(d1.extraDeckRecipe || [])];

  for (const difficulty of ['easy', 'normal', 'hard']) {
    const engine = new YGOProEngine({
      core,
      player1Name: 'Human Tester',
      player2Name: formatAiDisplayName(difficulty),
      deck1Cards,
      deck2Cards,
      isSoloVsAi: true,
      aiIndex: 1,
      aiDifficulty: difficulty
    });

    assert.equal(engine.state.aiDifficulty, difficulty);
    assert.equal(engine.lastRetryError, false);

    // Advance human's Turn 1 directly to End Phase so AI executes its full Turn 2
    if (engine.state.winner === null && engine.pendingMessage?.player === 0) {
      const res = engine.dispatchAction(0, { type: 'END_TURN' });
      assert.equal(res.ok, true, `Human END_TURN should succeed in ${difficulty} duel`);
    }

    assert.equal(engine.lastRetryError, false, `AI (${difficulty}) must not trigger RETRY error`);
    assert.ok(engine.state.turnCount >= 2, `Turn should advance to at least Turn 2 in ${difficulty} duel`);
    engine.destroy();
  }
});

test('Context-aware HINT_SELECTMSG: 504 from DECK picks high-value GY trigger, 503 differentiates opp vs own cost, 550 own GY picks best', () => {
  const metaMap = {
    101: { passcode: '101', name: 'Weak Vanilla', atk: 500, def: 500, description: '' },
    102: { passcode: '102', name: 'Despian Tragedy', atk: 400, def: 400, description: 'If this card is sent to the GY, or banished, by a card effect: You can add 1 "Despia" monster from your Deck to your hand.' },
    103: { passcode: '103', name: 'Baronne de Fleur', atk: 3000, def: 2400, isExtraDeck: true, description: 'Once per turn: negate activation.' },
    104: { passcode: '104', name: 'Swordsoul Token', atk: 0, def: 0, frame: 'TOKEN', description: '' }
  };

  // Hint 504 (Send to GY) from AI's DECK -> MUST pick Despian Tragedy (index 1), NOT Weak Vanilla (index 0)
  const deckDumpResp = computeYgoProAiResponse(
    {
      type: OcgMessageType.SELECT_CARD,
      player: 1,
      min: 1,
      max: 1,
      selects: [
        { code: 101, controller: 1, location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE },
        { code: 102, controller: 1, location: OcgLocation.DECK, sequence: 1, position: OcgPosition.FACEDOWN_DEFENSE }
      ]
    },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: makeTestState(),
      phase: PHASES.MP1,
      turnCount: 1,
      turnPlayerIndex: 1,
      chainStack: [],
      lastHintMsg: 504,
      aiState: createAiTurnState(),
      getCardMeta: makeMetaLookup(metaMap)
    }
  );
  assert.deepEqual(deckDumpResp.indicies, [1], 'Hint 504 from DECK must pick GY-trigger combo card');

  // Hint 503 (Banish) with opponent card -> picks opponent's Baronne (index 1)
  const banishOppResp = computeYgoProAiResponse(
    {
      type: OcgMessageType.SELECT_CARD,
      player: 1,
      min: 1,
      max: 1,
      selects: [
        { code: 101, controller: 1, location: OcgLocation.GRAVE, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
        { code: 103, controller: 0, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK }
      ]
    },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: makeTestState({ oppMzone: [{ code: 103, atk: 3000, def: 2400, isExtraDeck: true, controller: 0, sequence: 0 }] }),
      phase: PHASES.MP1,
      turnCount: 2,
      turnPlayerIndex: 1,
      chainStack: [],
      lastHintMsg: 503,
      aiState: createAiTurnState(),
      getCardMeta: makeMetaLookup(metaMap)
    }
  );
  assert.deepEqual(banishOppResp.indicies, [1], 'Hint 503 with opp target must pick opp highest threat');

  // Hint 503 (Banish) on AI's OWN GY as cost -> prefers Despian Tragedy (banish trigger) over Baronne!
  const banishOwnCostResp = computeYgoProAiResponse(
    {
      type: OcgMessageType.SELECT_CARD,
      player: 1,
      min: 1,
      max: 1,
      selects: [
        { code: 103, controller: 1, location: OcgLocation.GRAVE, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
        { code: 102, controller: 1, location: OcgLocation.GRAVE, sequence: 1, position: OcgPosition.FACEUP_ATTACK }
      ]
    },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: makeTestState(),
      phase: PHASES.MP1,
      turnCount: 2,
      turnPlayerIndex: 1,
      chainStack: [],
      lastHintMsg: 503,
      aiState: createAiTurnState(),
      getCardMeta: makeMetaLookup(metaMap)
    }
  );
  assert.deepEqual(banishOwnCostResp.indicies, [1], 'Hint 503 on own GY cost should banish banish-trigger / lower keep-value card');

  // Hint 550 (Target) on AI's OWN GY (e.g. Monster Reborn) -> picks Baronne (index 1), NOT Weak Vanilla!
  const rebornTargetResp = computeYgoProAiResponse(
    {
      type: OcgMessageType.SELECT_CARD,
      player: 1,
      min: 1,
      max: 1,
      selects: [
        { code: 101, controller: 1, location: OcgLocation.GRAVE, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
        { code: 103, controller: 1, location: OcgLocation.GRAVE, sequence: 1, position: OcgPosition.FACEUP_ATTACK }
      ]
    },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: makeTestState(),
      phase: PHASES.MP1,
      turnCount: 2,
      turnPlayerIndex: 1,
      chainStack: [],
      lastHintMsg: 550,
      aiState: createAiTurnState(),
      getCardMeta: makeMetaLookup(metaMap)
    }
  );
  assert.deepEqual(rebornTargetResp.indicies, [1], 'Hint 550 on own GY must pick highest-value revive/recycle target');
});

test('SELECT_IDLECMD prevents self-sabotage (Dark Hole, Heavy Storm, Field replace, Ash NS) while activating real starters', () => {
  const metaMap = {
    53129443: { passcode: '53129443', kind: 'SPELL', subtype: 'NORMAL', description: 'Destroy all monsters on the field.' },
    19613556: { passcode: '19613556', kind: 'SPELL', subtype: 'NORMAL', description: 'Destroy all Spell and Trap Cards on the field.' },
    84815190: { passcode: '84815190', kind: 'MONSTER', frame: 'SYNCHRO', isExtraDeck: true, atk: 3000, def: 2400, description: 'Once per turn: You can target 1 card on the field; destroy it. Once while face-up on the field, when a card or effect is activated (Quick Effect): Negate the activation.' },
    50005218: { passcode: '50005218', kind: 'SPELL', subtype: 'FIELD', description: 'Target 1 other card you control; excavate the top 3 cards of your Deck.' },
    14558127: { passcode: '14558127', kind: 'MONSTER', frame: 'EFFECT', atk: 0, def: 1800, isTuner: true, description: 'Negate that effect.' },
    44362883: { passcode: '44362883', kind: 'SPELL', subtype: 'NORMAL', description: 'Fusion Summon 1 Fusion Monster that mentions "Fallen of Albaz" from your Extra Deck.' }
  };

  // Empty opponent board: AI must NOT activate Dark Hole, Heavy Storm, Baronne pop, or replace its active Field Spell, or NS Ash Blossom!
  const selfSabotageState = makeTestState({
    aiMzone: [{ code: 84815190, atk: 3000, def: 2400, isExtraDeck: true, controller: 1, sequence: 0 }],
    aiFieldZone: { passcode: '50005218', name: 'Area Zero' },
    oppMzone: [],
    oppStz: []
  });
  const idleSelfSabotage = computeYgoProAiResponse(
    {
      type: OcgMessageType.SELECT_IDLECMD,
      player: 1,
      summons: [{ code: 14558127, controller: 1, location: OcgLocation.HAND, sequence: 0 }],
      special_summons: [],
      pos_changes: [],
      monster_sets: [],
      spell_sets: [],
      activates: [
        { code: 53129443, controller: 1, location: OcgLocation.HAND, sequence: 1, description: 0n },
        { code: 19613556, controller: 1, location: OcgLocation.HAND, sequence: 2, description: 0n },
        { code: 84815190, controller: 1, location: OcgLocation.MZONE, sequence: 0, description: 0n },
        { code: 50005218, controller: 1, location: OcgLocation.HAND, sequence: 3, description: 0n }
      ],
      to_bp: true,
      to_ep: true
    },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: selfSabotageState,
      phase: PHASES.MP1,
      turnCount: 2,
      turnPlayerIndex: 1,
      chainStack: [],
      lastHintMsg: 0,
      aiState: createAiTurnState(),
      getCardMeta: makeMetaLookup(metaMap)
    }
  );
  assert.equal(idleSelfSabotage.action, SelectIdleCMDAction.TO_BP, 'Hard AI must skip Dark Hole/Heavy Storm/Baronne pop/Field replace/Ash NS and proceed to Battle Phase');

  // With Branded Fusion available, Hard AI immediately activates it
  const idleStarter = computeYgoProAiResponse(
    {
      type: OcgMessageType.SELECT_IDLECMD,
      player: 1,
      summons: [],
      special_summons: [],
      pos_changes: [],
      monster_sets: [],
      spell_sets: [],
      activates: [
        { code: 53129443, controller: 1, location: OcgLocation.HAND, sequence: 0, description: 0n },
        { code: 44362883, controller: 1, location: OcgLocation.HAND, sequence: 1, description: 0n }
      ],
      to_bp: true,
      to_ep: true
    },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: selfSabotageState,
      phase: PHASES.MP1,
      turnCount: 2,
      turnPlayerIndex: 1,
      chainStack: [],
      lastHintMsg: 0,
      aiState: createAiTurnState(),
      getCardMeta: makeMetaLookup(metaMap)
    }
  );
  assert.equal(idleStarter.action, SelectIdleCMDAction.SELECT_ACTIVATE);
  assert.equal(idleStarter.index, 1, 'Hard AI must activate Branded Fusion starter');
});

test('SELECT_CHAIN never negates own Chain Link and SELECT_BATTLECMD fires beneficial Battle Phase chains', () => {
  const metaMap = {
    84815190: { passcode: '84815190', kind: 'MONSTER', frame: 'SYNCHRO', isExtraDeck: true, atk: 3000, def: 2400, description: 'Once while face-up on the field, when a card or effect is activated (Quick Effect): Negate the activation.' },
    98338152: { passcode: '98338152', kind: 'SPELL', subtype: 'QUICK_PLAY', description: 'Target 1 face-up Effect Monster on the field; negate that face-up monster effects.' },
    777001: { passcode: '777001', kind: 'SPELL', subtype: 'QUICK_PLAY', description: 'During the Battle Phase: Special Summon 1 Dragon monster from your Deck.' }
  };

  // Own CL1 active + spe_count: 1 -> MUST NOT chain Baronne or Widow Anchor to own Chain Link!
  const selfChainResp = computeYgoProAiResponse(
    {
      type: OcgMessageType.SELECT_CHAIN,
      player: 1,
      spe_count: 1,
      forced: false,
      selects: [
        { code: 84815190, controller: 1, location: OcgLocation.MZONE, sequence: 0, description: 0n },
        { code: 98338152, controller: 1, location: OcgLocation.HAND, sequence: 0, description: 0n }
      ]
    },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: makeTestState({ aiMzone: [{ code: 84815190, atk: 3000, controller: 1, sequence: 0 }] }),
      phase: PHASES.MP1,
      turnCount: 2,
      turnPlayerIndex: 1,
      chainStack: [{ chainLink: 1, playerIndex: 1 }],
      lastHintMsg: 0,
      aiState: createAiTurnState(),
      getCardMeta: makeMetaLookup(metaMap)
    }
  );
  assert.equal(selfChainResp.index, null, 'Hard AI must NEVER chain Baronne or Widow Anchor to its own Chain Link');

  // Battle Phase: no remaining attacks, beneficial Special Summon chain available -> activate it!
  const bpChainResp = computeYgoProAiResponse(
    {
      type: OcgMessageType.SELECT_BATTLECMD,
      player: 1,
      attacks: [],
      chains: [
        { code: 98338152, controller: 1, location: OcgLocation.HAND, sequence: 0, description: 0n },
        { code: 777001, controller: 1, location: OcgLocation.HAND, sequence: 1, description: 0n }
      ],
      to_m2: true,
      to_ep: true
    },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: makeTestState(),
      phase: PHASES.BP,
      turnCount: 2,
      turnPlayerIndex: 1,
      chainStack: [],
      lastHintMsg: 0,
      aiState: createAiTurnState(),
      getCardMeta: makeMetaLookup(metaMap)
    }
  );
  assert.equal(bpChainResp.action, SelectBattleCMDAction.SELECT_CHAIN);
  assert.equal(bpChainResp.index, 1, 'Hard AI should activate beneficial Battle Phase Quick-Play/Synchro chain');
});

test('SELECT_UNSELECT_CARD picks additional beneficial opp targets, SELECT_SUM preserves bosses, SELECT_EFFECTYN skips self-banish/Baronne tag-out, SELECT_POSITION defends Turn 1 walls', () => {
  const metaMap = {
    3001: { passcode: '3001', name: 'Token', atk: 0, def: 0, frame: 'TOKEN', description: '' },
    84815190: { passcode: '84815190', name: 'Baronne de Fleur', atk: 3000, def: 2400, isExtraDeck: true, description: 'Once per turn: negate activation.' },
    29301450: { passcode: '29301450', name: 'S:P Little Knight', atk: 1600, def: 0, isExtraDeck: true, description: 'Target 1 card on the field or in either GY; banish it.' },
    93490856: { passcode: '93490856', name: 'Swordsoul Strategist Longyuan', atk: 1200, def: 2300, description: '' }
  };

  // SELECT_UNSELECT_CARD with can_finish: true + opponent card remaining on hint 502 (Destroy) -> picks opponent card!
  const aiState = createAiTurnState();
  const unselOpp = computeYgoProAiResponse(
    {
      type: OcgMessageType.SELECT_UNSELECT_CARD,
      player: 1,
      can_finish: true,
      can_cancel: false,
      min: 1,
      max: 2,
      select_cards: [
        { code: 84815190, controller: 0, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK }
      ],
      unselect_cards: []
    },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: makeTestState({ oppMzone: [{ code: 84815190, atk: 3000, isExtraDeck: true, controller: 0, sequence: 0 }] }),
      phase: PHASES.MP1,
      turnCount: 2,
      turnPlayerIndex: 1,
      chainStack: [],
      lastHintMsg: 502,
      aiState,
      getCardMeta: makeMetaLookup(metaMap)
    }
  );
  assert.equal(unselOpp.index, 0, 'SELECT_UNSELECT_CARD should pick additional opponent target when can_finish is true');

  // SELECT_UNSELECT_CARD with can_finish: true + only own card left on hint 502 -> finishes cleanly (index: null)!
  const unselSelf = computeYgoProAiResponse(
    {
      type: OcgMessageType.SELECT_UNSELECT_CARD,
      player: 1,
      can_finish: true,
      can_cancel: false,
      min: 1,
      max: 2,
      select_cards: [
        { code: 84815190, controller: 1, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK }
      ],
      unselect_cards: []
    },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: makeTestState({ aiMzone: [{ code: 84815190, atk: 3000, isExtraDeck: true, controller: 1, sequence: 0 }] }),
      phase: PHASES.MP1,
      turnCount: 2,
      turnPlayerIndex: 1,
      chainStack: [],
      lastHintMsg: 502,
      aiState,
      getCardMeta: makeMetaLookup(metaMap)
    }
  );
  assert.equal(unselSelf.index, null, 'SELECT_UNSELECT_CARD must finish rather than destroy own card');

  // SELECT_EFFECTYN: Baronne in SP -> No; S:P Little Knight on empty opp field/GY -> No
  const baronneSp = computeYgoProAiResponse(
    { type: OcgMessageType.SELECT_EFFECTYN, player: 1, code: 84815190, description: 0n },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: makeTestState(),
      phase: PHASES.SP,
      turnCount: 3,
      turnPlayerIndex: 0,
      chainStack: [],
      lastHintMsg: 0,
      aiState: createAiTurnState(),
      getCardMeta: makeMetaLookup(metaMap)
    }
  );
  assert.equal(baronneSp.yes, false, 'Hard AI must decline Baronne Standby Phase tag-out');

  const spEmpty = computeYgoProAiResponse(
    { type: OcgMessageType.SELECT_EFFECTYN, player: 1, code: 29301450, description: 0n },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: makeTestState({ oppMzone: [], oppGy: [] }),
      phase: PHASES.MP1,
      turnCount: 2,
      turnPlayerIndex: 1,
      chainStack: [],
      lastHintMsg: 0,
      aiState: createAiTurnState(),
      getCardMeta: makeMetaLookup(metaMap)
    }
  );
  assert.equal(spEmpty.yes, false, 'Hard AI must decline S:P Little Knight banish when opponent has 0 field & GY cards');

  // SELECT_POSITION: Longyuan (1200/2300) on Turn 1 -> FACEUP_DEFENSE
  const longyuanT1 = computeYgoProAiResponse(
    { type: OcgMessageType.SELECT_POSITION, player: 1, code: 93490856, positions: OcgPosition.FACEUP_ATTACK | OcgPosition.FACEUP_DEFENSE },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: makeTestState(),
      phase: PHASES.MP1,
      turnCount: 1,
      turnPlayerIndex: 1,
      chainStack: [],
      lastHintMsg: 0,
      aiState: createAiTurnState(),
      getCardMeta: makeMetaLookup(metaMap)
    }
  );
  assert.equal(longyuanT1.position, OcgPosition.FACEUP_DEFENSE, 'Turn 1 Longyuan (1200/2300) should summon in FACEUP_DEFENSE');

  // SELECT_SUM: two level-4 materials (Baronne vs Token) -> solver prefers keeping Baronne and using Token!
  const fakeEngineSolve = YGOProEngine.prototype._solveSelectSum;
  const sumResp = computeYgoProAiResponse(
    {
      type: OcgMessageType.SELECT_SUM,
      player: 1,
      select_max: 0,
      amount: 8,
      min: 1,
      max: 2,
      selects_must: [{ code: 9999, amount: 4 }],
      selects: [
        { code: 84815190, controller: 1, location: OcgLocation.MZONE, sequence: 0, amount: 4 },
        { code: 3001, controller: 1, location: OcgLocation.MZONE, sequence: 1, amount: 4 }
      ]
    },
    {
      aiIndex: 1,
      difficulty: 'hard',
      state: makeTestState({
        aiMzone: [
          { code: 84815190, atk: 3000, def: 2400, isExtraDeck: true, controller: 1, sequence: 0 },
          { code: 3001, atk: 0, def: 0, controller: 1, sequence: 1 }
        ]
      }),
      phase: PHASES.MP1,
      turnCount: 2,
      turnPlayerIndex: 1,
      chainStack: [],
      lastHintMsg: 0,
      aiState: createAiTurnState(),
      getCardMeta: makeMetaLookup(metaMap),
      solveSelectSum: (m, scoreFn) => fakeEngineSolve.call({}, m, scoreFn)
    }
  );
  assert.deepEqual(sumResp.indicies, [1], 'SELECT_SUM should consume Token (index 1) and preserve Baronne (index 0)');
});

test('Real YGOProEngine multi-deck (6 preset decks) verification & clean incremental onAiStep snapshots', async () => {
  const core = await getSharedOcgCore();
  const deckIds = [
    'blue_eyes_meta',
    'swordsoul_tenyi',
    'branded_despia',
    'sky_striker_ace',
    'mdm_snake_eye_yummy',
    'mdm_labrynth'
  ];
  const oppDeck = getPresetDeckById('blue_eyes_meta') || PRESET_DECKS[0];
  const oppCards = [...expandDeckRecipe(oppDeck.mainDeckRecipe || []), ...expandDeckRecipe(oppDeck.extraDeckRecipe || [])];

  for (const deckId of deckIds) {
    const deck = getPresetDeckById(deckId);
    assert.ok(deck, `Preset deck ${deckId} must exist`);
    const deckCards = [...expandDeckRecipe(deck.mainDeckRecipe || []), ...expandDeckRecipe(deck.extraDeckRecipe || [])];

    for (const difficulty of ['easy', 'normal', 'hard']) {
      const snapshots = [];
      const engine = new YGOProEngine({
        core,
        player1Name: 'Human Tester',
        player2Name: formatAiDisplayName(difficulty),
        deck1Cards: oppCards,
        deck2Cards: deckCards,
        isSoloVsAi: true,
        aiIndex: 1,
        aiDifficulty: difficulty,
        onAiStep: (snap) => snapshots.push(snap)
      });

      // Advance Human T1 -> AI T2
      let guard = 0;
      while (guard++ < 15 && engine.state.winner === null && engine.pendingMessage?.player === 0) {
        if (engine.pendingMessage.type === OcgMessageType.SELECT_IDLECMD) {
          engine.dispatchAction(0, { type: 'END_TURN' });
        } else if (engine.pendingMessage.type === OcgMessageType.SELECT_CHAIN) {
          engine.dispatchAction(0, { type: 'CHAIN_RESPONSE', respond: false });
        } else {
          break;
        }
      }

      assert.equal(engine.lastRetryError, false, `${deckId} (${difficulty}) must have zero RETRY errors`);
      assert.equal(engine.lastHintMsgByPlayer[1], 0, `${deckId} (${difficulty}) must clear consumed AI HINT_SELECTMSG`);
      assert.ok(engine.state.turnCount >= 2, `${deckId} (${difficulty}) must advance to Turn 2+`);

      // Verify clean incremental onAiStep contract: zero overlapping recentEvents seqs across steps & final state, no leaked AI prompts
      const seenSeqs = new Set();
      for (const snap of [...snapshots, engine.state]) {
        for (const ev of snap.recentEvents || []) {
          assert.equal(seenSeqs.has(ev.seq), false, `${deckId} (${difficulty}) leaked duplicate event seq ${ev.seq}`);
          seenSeqs.add(ev.seq);
        }
      }
      for (const snap of snapshots) {
        assert.equal(snap.pendingChainPrompt, null, 'Intermediate onAiStep must not leak AI pendingChainPrompt');
        assert.equal(snap.pendingOcgPrompt, null, 'Intermediate onAiStep must not leak AI pendingOcgPrompt');
      }

      engine.destroy();
    }
  }

  // Also verify AI going Turn 1 emits clean onAiStep snapshots during constructor
  const turn1Deck = getPresetDeckById('swordsoul_tenyi');
  const turn1Cards = [...expandDeckRecipe(turn1Deck.mainDeckRecipe || []), ...expandDeckRecipe(turn1Deck.extraDeckRecipe || [])];
  const turn1Snaps = [];
  const t1Engine = new YGOProEngine({
    core,
    player1Name: formatAiDisplayName('hard'),
    player2Name: 'Human',
    deck1Cards: turn1Cards,
    deck2Cards: oppCards,
    isSoloVsAi: true,
    aiIndex: 0,
    aiDifficulty: 'hard',
    onAiStep: (snap) => turn1Snaps.push(snap)
  });
  // If human had a hand trap prompt during AI's Turn 1, decline it so AI completes Turn 1 cleanly
  let t1Guard = 0;
  while (
    t1Guard++ < 15 &&
    t1Engine.state.winner === null &&
    t1Engine.state.turnCount === 1 &&
    t1Engine.pendingMessage?.player === 1 &&
    t1Engine.pendingMessage.type === OcgMessageType.SELECT_CHAIN
  ) {
    t1Engine.dispatchAction(1, { type: 'CHAIN_RESPONSE', respond: false });
  }
  assert.equal(t1Engine.lastRetryError, false, 'AI Turn 1 must have zero RETRY errors');
  assert.ok(turn1Snaps.length >= 1, 'AI Turn 1 must emit at least one onAiStep snapshot');
  assert.ok(t1Engine.state.turnCount >= 2 || t1Engine.state.winner !== null, 'AI Turn 1 must pass turn to Human Turn 2');
  t1Engine.destroy();
});
