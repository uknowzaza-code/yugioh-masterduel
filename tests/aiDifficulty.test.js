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
import { PRESET_DECKS, expandDeckRecipe } from '../src/cards/index.js';
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
  aiHand = []
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
    { lp: oppLp, mmz: mkMzone(oppMzone), emzSlots: [null, null], stz: mkStz(oppStz), hand: [], gy: [], banished: [], extra: [] },
    { lp: aiLp, mmz: mkMzone(aiMzone), emzSlots: [null, null], stz: mkStz(aiStz), hand: aiHand, gy: [], banished: [], extra: [] }
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
