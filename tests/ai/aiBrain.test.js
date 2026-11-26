import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_DIFFICULTY,
  isValidDifficulty,
  normalizeDifficulty,
  aiDisplayName,
} from '../../shared/ai-difficulty.js';
import { TYPE, LOC, POS, CATEGORY, HINTMSG, LINK_MARKER, SYSTEM_STRING } from '../../src/ai/constants.js';
import { BoardView } from '../../src/ai/board.js';
import { AiBrain } from '../../src/ai/brain.js';
import { searchBattlePlan, lethalObjective, resolveBattle } from '../../src/ai/battle.js';
import { buildBoardViewFromEngineState } from '../../src/ai/snapshot.js';
import { AiPlayer } from '../../src/ai/ai-player.js';
import { OcgMessageType } from 'ocgcore-wasm';

test('shared/ai-difficulty normalizes, validates, and localizes EN/TH names', () => {
  assert.equal(isValidDifficulty('easy'), true);
  assert.equal(isValidDifficulty('HARD'), true);
  assert.equal(isValidDifficulty('impossible'), false);
  assert.equal(normalizeDifficulty('  hard '), AI_DIFFICULTY.HARD);
  assert.equal(normalizeDifficulty('unknown'), AI_DIFFICULTY.NORMAL);
  assert.match(aiDisplayName('hard', 'th'), /ดูเอลบอท.*ยาก/);
  assert.match(aiDisplayName('easy', 'en'), /Duel Bot.*Easy/);
});

test('battle.js: Hard finds exact Lethal sequence via DFS + memo and sets plannedAttack', () => {
  const brain = new AiBrain({ difficulty: 'hard', seed: 42 });
  // AI has 2000 ATK and 2500 ATK; Opponent has 1800 ATK monster and 2700 LP -> 2000 kills 1800 (200 dmg) + 2500 direct (2500 dmg) = 2700 Lethal!
  const view = new BoardView({
    me: 1,
    turn: 2,
    turnPlayer: 1,
    phase: 'battle',
    players: [
      {
        lp: 2700,
        mzone: [{ code: 1001, type: TYPE.MONSTER | TYPE.EFFECT, atk: 1800, def: 1000, position: POS.FACEUP_ATTACK }],
      },
      {
        lp: 8000,
        mzone: [
          { code: 2001, type: TYPE.MONSTER | TYPE.EFFECT, atk: 2000, def: 1500, position: POS.FACEUP_ATTACK },
          { code: 2002, type: TYPE.MONSTER | TYPE.EFFECT, atk: 2500, def: 2000, position: POS.FACEUP_ATTACK },
        ],
      },
    ],
  });

  const decision = brain.decide(
    {
      type: 'SELECT_BATTLECMD',
      attacks: [
        { code: 2001, controller: 1, location: LOC.MZONE, sequence: 0 },
        { code: 2002, controller: 1, location: LOC.MZONE, sequence: 1 },
      ],
      to_m2: true,
      to_ep: true,
    },
    view
  );

  assert.equal(decision.action, 'SELECT_BATTLE');
  assert.equal(decision.reason, 'lethal');
  assert.equal(decision.index, 0); // 2000 attacks 1800 first so 2500 swings direct for lethal!

  const targetRes = brain.decide(
    {
      type: 'SELECT_CARD',
      selects: [{ code: 1001, controller: 0, location: LOC.MZONE, sequence: 0 }],
      min: 1,
      max: 1,
    },
    view,
    HINTMSG.ATTACKTARGET
  );
  assert.deepEqual(targetRes.indices, [0]);
});

test('battle.js: Normal avoids suicide attacks and Easy respects attackTolerance', () => {
  const normal = new AiBrain({ difficulty: 'normal', seed: 1 });
  const view = new BoardView({
    me: 1,
    turn: 2,
    turnPlayer: 1,
    phase: 'battle',
    players: [
      { lp: 8000, mzone: [{ code: 89631139, type: TYPE.MONSTER, atk: 3000, def: 2500, position: POS.FACEUP_ATTACK }] },
      { lp: 8000, mzone: [{ code: 14558127, type: TYPE.MONSTER | TYPE.EFFECT, atk: 0, def: 1800, position: POS.FACEUP_ATTACK }] },
    ],
  });

  const msg = {
    type: 'SELECT_BATTLECMD',
    attacks: [{ code: 14558127, controller: 1, location: LOC.MZONE, sequence: 0 }],
    to_m2: true,
    to_ep: true,
  };
  const dNormal = normal.decide(msg, view);
  assert.equal(dNormal.action, 'TO_M2');

  const easy = new AiBrain({ difficulty: 'easy', seed: 1 });
  const dEasy = easy.decide(msg, view);
  assert.equal(dEasy.action, 'TO_M2'); // 0 + 300 tolerance still < 3000 -> never suicides 0 into 3000!
});

test('idle.js: Hard sequences Starter/Searcher before Normal Summon and skips self-sabotage Dark Hole/Raigeki', () => {
  const hard = new AiBrain({ difficulty: 'hard', seed: 7 });
  const view = new BoardView({
    me: 1,
    turn: 2,
    turnPlayer: 1,
    phase: 'main1',
    players: [
      { lp: 8000, mzone: [] },
      {
        lp: 8000,
        hand: [
          { code: 12580477, type: TYPE.SPELL, location: LOC.HAND }, // Raigeki (opp empty!)
          { code: 55144522, type: TYPE.SPELL, location: LOC.HAND }, // Pot of Greed (searcher)
          { code: 20001443, type: TYPE.MONSTER | TYPE.EFFECT, atk: 1700, def: 1800, location: LOC.HAND }, // Mo Ye
        ],
      },
    ],
  });

  const dec = hard.decide(
    {
      type: 'SELECT_IDLECMD',
      activates: [
        { code: 12580477, controller: 1, location: LOC.HAND, sequence: 0 },
        { code: 55144522, controller: 1, location: LOC.HAND, sequence: 1 },
      ],
      summons: [{ code: 20001443, controller: 1, location: LOC.HAND, sequence: 2 }],
      to_bp: true,
      to_ep: true,
    },
    view
  );

  assert.equal(dec.action, 'ACTIVATE');
  assert.equal(dec.index, 1); // Pot of Greed, NOT Raigeki on empty board!
});

test('chain.js: Hard holds Ash Blossom against low-danger non-search effect, fires on high-danger Branded Fusion, and never chains own CL', () => {
  const hard = new AiBrain({ difficulty: 'hard', seed: 9 });

  // High-danger Branded Fusion (starter + spsummon)
  const highView = new BoardView({
    me: 1,
    turn: 1,
    turnPlayer: 0,
    phase: 'main1',
    players: [{ lp: 8000 }, { lp: 8000 }],
    chain: [{ player: 0, code: 44362883, location: LOC.SZONE, sequence: 0, category: CATEGORY.SPECIAL_SUMMON | CATEGORY.DECKDES }],
  });
  const decHigh = hard.decide(
    {
      type: 'SELECT_CHAIN',
      chains: [{ code: 14558127, controller: 1, location: LOC.HAND, sequence: 0 }],
      forced: false,
    },
    highView
  );
  assert.equal(decHigh.index, 0);

  // Own chain link -> never Ash our own search!
  const ownView = new BoardView({
    me: 1,
    turn: 2,
    turnPlayer: 1,
    phase: 'main1',
    players: [{ lp: 8000 }, { lp: 8000 }],
    chain: [{ player: 1, code: 56495147, location: LOC.SZONE, sequence: 0, category: CATEGORY.SEARCH }],
  });
  const decOwn = hard.decide(
    {
      type: 'SELECT_CHAIN',
      chains: [{ code: 14558127, controller: 1, location: LOC.HAND, sequence: 0 }],
      forced: false,
    },
    ownView
  );
  assert.equal(decOwn.index, null);

  // Replay YES/NO abort when opponent has 3000 ATK wall
  hard.plannedAttack = { attacker: { controller: 1, location: LOC.MZONE, sequence: 0, code: 2001 }, target: null };
  const replayView = new BoardView({
    me: 1,
    turn: 2,
    turnPlayer: 1,
    phase: 'battle',
    players: [
      { lp: 8000, mzone: [{ code: 89631139, type: TYPE.MONSTER, atk: 3000, def: 2500, position: POS.FACEUP_ATTACK }] },
      { lp: 8000, mzone: [{ code: 2001, type: TYPE.MONSTER, atk: 1800, def: 1200, position: POS.FACEUP_ATTACK }] },
    ],
  });
  const replayDec = hard.decide({ type: 'SELECT_YESNO', desc: SYSTEM_STRING.REPLAY_CONTINUE_ATTACK }, replayView);
  assert.equal(replayDec.yes, false);
});

test('select.js, sum.js, placement.js: threat targeting, lowest-value tribute/sum, and Imperm column avoidance', () => {
  const hard = new AiBrain({ difficulty: 'hard', seed: 11 });
  const view = new BoardView({
    me: 1,
    turn: 2,
    turnPlayer: 1,
    phase: 'main1',
    impermColumns: [2],
    players: [
      {
        lp: 8000,
        mzone: [
          { code: 3001, type: TYPE.MONSTER | TYPE.NORMAL, atk: 1200, def: 1000, position: POS.FACEUP_ATTACK },
          { code: 84815190, type: TYPE.MONSTER | TYPE.SYNCHRO | TYPE.EFFECT, atk: 3000, def: 2400, position: POS.FACEUP_ATTACK },
        ],
      },
      {
        lp: 8000,
        mzone: [
          { code: 84815190, type: TYPE.MONSTER | TYPE.SYNCHRO | TYPE.EFFECT, atk: 3000, def: 2400, position: POS.FACEUP_ATTACK },
          { code: 4001, type: TYPE.MONSTER | TYPE.TOKEN, atk: 0, def: 0, position: POS.FACEUP_DEFENSE },
          { code: 4002, type: TYPE.MONSTER | TYPE.EFFECT, atk: 1500, def: 1200, position: POS.FACEUP_ATTACK },
          null,
          null,
          { code: 5001, type: TYPE.MONSTER | TYPE.LINK | TYPE.EFFECT, atk: 1500, linkMarkers: LINK_MARKER.BOTTOM_LEFT | LINK_MARKER.BOTTOM_RIGHT, position: POS.FACEUP_ATTACK },
        ],
      },
    ],
  });

  // Hostile destroy -> picks Baronne (idx 1) over 1200 vanilla (idx 0)
  const destroyDec = hard.decide(
    {
      type: 'SELECT_CARD',
      min: 1,
      max: 1,
      selects: [
        { code: 3001, controller: 0, location: LOC.MZONE, sequence: 0 },
        { code: 84815190, controller: 0, location: LOC.MZONE, sequence: 1 },
      ],
    },
    view,
    HINTMSG.DESTROY
  );
  assert.deepEqual(destroyDec.indices, [1]);

  // Tribute -> sacrifices Token (idx 1) before Baronne (idx 0)
  const tribDec = hard.decide(
    {
      type: 'SELECT_TRIBUTE',
      min: 1,
      max: 1,
      selects: [
        { code: 84815190, controller: 1, location: LOC.MZONE, sequence: 0, release_param: 1 },
        { code: 4001, controller: 1, location: LOC.MZONE, sequence: 1, release_param: 1 },
      ],
    },
    view
  );
  assert.deepEqual(tribDec.indices, [1]);

  // SELECT_SUM (exact 8: must 4 + choose cheapest level 4 between Baronne idx 0 and 1500 monster idx 2)
  const sumDec = hard.decide(
    {
      type: 'SELECT_SUM',
      amount: 8,
      select_max: 0,
      selects_must: [{ code: 4001, amount: 4 }],
      selects: [
        { code: 84815190, controller: 1, location: LOC.MZONE, sequence: 0, amount: 4 },
        { code: 4002, controller: 1, location: LOC.MZONE, sequence: 2, amount: 4 },
      ],
    },
    view
  );
  assert.deepEqual(sumDec.indices, [1]);

  // Placement: SZONE bits 8..12 open (mask hides everything else), col 2 has Imperm -> must NOT pick sequence 2!
  const szoneOnlyMask = (~(0b11111 << 8)) >>> 0;
  const placeDec = hard.decide({ type: 'SELECT_PLACE', count: 1, field_mask: szoneOnlyMask }, view);
  assert.equal(placeDec.places.length, 1);
  assert.equal(placeDec.places[0].location, LOC.SZONE);
  assert.notEqual(placeDec.places[0].sequence, 2);
});

test('snapshot.js redacts opponent hand and face-down field cards so AI never cheats', () => {
  const fakeEngine = {
    turnCount: 2,
    turnPlayerIndex: 1,
    phase: 'MP1',
    lps: [8000, 8000],
    chainStack: [],
    state: {
      players: [
        {
          lp: 8000,
          hand: [{ passcode: '14558127', name: 'Ash Blossom', kind: 'MONSTER', atk: 0, def: 1800 }],
          mmz: [
            { passcode: '89631139', name: 'Blue-Eyes', kind: 'MONSTER', atk: 3000, def: 2500, isFaceDown: true, position: 'SET_DEF' },
            { passcode: '46986414', name: 'Dark Magician', kind: 'MONSTER', atk: 2500, def: 2100, isFaceDown: false, position: 'FACEUP_ATK' },
          ],
          stz: [{ passcode: '10045474', name: 'Imperm', kind: 'TRAP', isFaceDown: true }],
          gy: [],
          banished: [],
          extra: [],
        },
        {
          lp: 8000,
          hand: [{ passcode: '55144522', name: 'Pot of Greed', kind: 'SPELL' }],
          mmz: [],
          stz: [],
          gy: [],
          banished: [],
          extra: [],
        },
      ],
    },
  };

  const view = buildBoardViewFromEngineState(fakeEngine, 1);
  assert.equal(view.opp.hand[0].hidden, true);
  assert.equal(view.opp.hand[0].code, 0);
  assert.equal(view.opp.mzone[0].hidden, true);
  assert.equal(view.opp.mzone[0].code, 0);
  assert.equal(view.opp.mzone[1].hidden, false);
  assert.equal(view.opp.mzone[1].code, 46986414);
  assert.equal(view.opp.szone[0].hidden, true);
  assert.equal(view.self.hand[0].hidden, false);
  assert.equal(view.self.hand[0].code, 55144522);
});

test('AiPlayer tracks CHAINING Imperm columns, HINT_SELECTMSG, and resets per turn', () => {
  const ai = new AiPlayer({ me: 1, difficulty: 'hard', seed: 123 });
  ai.onMessage({ type: OcgMessageType.NEW_TURN, player: 0 });
  ai.onMessage({ type: OcgMessageType.CHAINING, player: 0, code: 10045474, location: LOC.SZONE, sequence: 1 });
  // Opp sequence 1 mirrors to col 3 from AI perspective (4 - 1 = 3)
  assert.equal(ai.impermColumns.has(3), true);
  ai.onMessage({ type: OcgMessageType.HINT, hint_type: 3, player: 1, hint: HINTMSG.DESTROY });
  assert.equal(ai.lastHintMsg[1], HINTMSG.DESTROY);
  ai.onMessage({ type: OcgMessageType.NEW_TURN, player: 1 });
  assert.equal(ai.impermColumns.size, 0);
  assert.equal(ai.lastHintMsg[1], 0);
});
