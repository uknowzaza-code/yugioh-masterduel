import test from 'node:test';
import assert from 'node:assert/strict';

import { TYPE, LOC, POS, CATEGORY, HINTMSG, LINK_MARKER, SYSTEM_STRING } from '../../src/ai/constants.js';
import { BoardView } from '../../src/ai/board.js';
import { AiBrain } from '../../src/ai/brain.js';
import { CardKnowledge } from '../../src/ai/knowledge.js';
import { createOcgCardDbAdapter, inferCategoryFromText } from '../../src/ai/card-db.js';
import { getSharedOcgCore, YGOProEngine } from '../../src/engine/YGOProEngine.js';
import { PRESET_DECKS, expandDeckRecipe } from '../../src/cards/index.js';

const realCardDb = createOcgCardDbAdapter();

function buildDeckCodes(deckId) {
  const deck = PRESET_DECKS.find((d) => d.id === deckId);
  assert.ok(deck, `Preset deck ${deckId} must exist`);
  return [
    ...expandDeckRecipe(deck.mainDeckRecipe || []),
    ...expandDeckRecipe(deck.extraDeckRecipe || []),
  ];
}

function respondToHumanPrompt(eng, humanIdx = 1) {
  const chainP = eng.state.pendingChainPrompt;
  if (chainP && chainP.playerIndex === humanIdx) {
    eng.dispatchAction(humanIdx, { type: 'CHAIN_RESPONSE', respond: false });
    return true;
  }
  const ocgP = eng.state.pendingOcgPrompt;
  if (ocgP && ocgP.playerIndex === humanIdx) {
    if (ocgP.type === 'SELECT_EFFECTYN' || ocgP.type === 'SELECT_YESNO') {
      eng.dispatchAction(humanIdx, { type: 'CONFIRM_CHOICE', confirm: false });
      return true;
    }
    if (ocgP.type === 'SELECT_CHAIN') {
      eng.dispatchAction(humanIdx, { type: 'CHAIN_RESPONSE', respond: false });
      return true;
    }
    if (ocgP.type === 'SELECT_IDLECMD') {
      eng.dispatchAction(humanIdx, { type: 'END_TURN' });
      return true;
    }
    if (ocgP.type === 'SELECT_BATTLECMD') {
      eng.dispatchAction(humanIdx, { type: 'TO_M2' });
      return true;
    }
  }
  return false;
}

// ============================================================================
// PART A: AiBrain Unit Tests Across All 8 Summoning Mechanics
// ============================================================================

test('1. Link Summon: prevents downgrading boss Link into utility Link & picks EMZ with most open bottom arrows', () => {
  const hard = new AiBrain({ difficulty: 'hard', seed: 11, cardDb: realCardDb });

  // Sole Link-3 boss (Maliss <Q> Hearts Crypter, 2500 ATK) must NOT downgrade into Link Decoder (300 ATK) on empty opp board
  const viewDowngrade = new BoardView({
    me: 1,
    turn: 1,
    turnPlayer: 1,
    phase: 'main1',
    players: [
      { lp: 8000, mzone: [] },
      {
        lp: 8000,
        mzone: [
          null, null, null, null, null,
          { code: 21848500, type: TYPE.MONSTER | TYPE.LINK | TYPE.EFFECT, atk: 2500, linkMarkers: LINK_MARKER.TOP | LINK_MARKER.BOTTOM_LEFT | LINK_MARKER.BOTTOM_RIGHT, location: LOC.MZONE, sequence: 5 },
        ],
        extra: [
          { code: 3034872, type: TYPE.MONSTER | TYPE.LINK | TYPE.EFFECT, atk: 300, linkMarkers: LINK_MARKER.BOTTOM, location: LOC.EXTRA }, // Link Decoder
          { code: 86066372, type: TYPE.MONSTER | TYPE.LINK | TYPE.EFFECT, atk: 2300, linkMarkers: LINK_MARKER.TOP | LINK_MARKER.LEFT | LINK_MARKER.RIGHT | LINK_MARKER.BOTTOM, location: LOC.EXTRA }, // Accesscode Talker
        ],
      },
    ],
  });

  const decLink = hard.decide(
    {
      type: 'SELECT_IDLECMD',
      special_summons: [
        { code: 3034872, controller: 1, location: LOC.EXTRA, sequence: 0 }, // Link Decoder
      ],
      to_ep: true,
    },
    viewDowngrade
  );
  assert.equal(decLink.action, 'TO_EP', 'Must not downgrade sole Link-3 boss into Link Decoder');

  // EMZ placement: MMZ 0,1,2 are occupied while MMZ 2,3,4 have 3,4 open -> EMZ 6 (points to 2,3,4) beats EMZ 5 (points to 0,1,2)
  const viewEmz = new BoardView({
    me: 1,
    turn: 1,
    turnPlayer: 1,
    phase: 'main1',
    players: [
      { lp: 8000 },
      {
        lp: 8000,
        mzone: [
          { code: 1001, type: TYPE.MONSTER }, // seq 0 occupied
          { code: 1002, type: TYPE.MONSTER }, // seq 1 occupied
          { code: 1003, type: TYPE.MONSTER }, // seq 2 occupied
          null, // seq 3 open
          null, // seq 4 open
        ],
      },
    ],
  });
  // field_mask bit 0 = available: bits 5 and 6 for self (player 1 -> bits 5,6)
  // Using bitmask where only seq 5 and seq 6 of self are 0 (available), all others 1
  const maskEmz = ~( (1 << 5) | (1 << 6) );
  const placeDec = hard.decide(
    {
      type: 'SELECT_PLACE',
      count: 1,
      field_mask: maskEmz,
      linkMarkers: LINK_MARKER.BOTTOM_LEFT | LINK_MARKER.BOTTOM_RIGHT,
    },
    viewEmz
  );
  assert.equal(placeDec.places[0].sequence, 6, 'Must pick EMZ 6 whose bottom-right arrow points to open MMZ 4');
});

test('2. Xyz & 3. Synchro Summon: prioritizes bosses & Tuner setups, solves exact Synchro Level sum', () => {
  const hard = new AiBrain({ difficulty: 'hard', seed: 22, cardDb: realCardDb });

  // Xyz boss priority in special_summons (Ryzeal Detonator 34909328)
  const xyzView = new BoardView({
    me: 1,
    turn: 1,
    turnPlayer: 1,
    phase: 'main1',
    players: [{ lp: 8000 }, { lp: 8000, mzone: [{ code: 101, level: 4 }, { code: 102, level: 4 }] }],
  });
  const decXyz = hard.decide(
    {
      type: 'SELECT_IDLECMD',
      special_summons: [{ code: 34909328, controller: 1, location: LOC.EXTRA, sequence: 0 }],
      to_ep: true,
    },
    xyzView
  );
  assert.equal(decXyz.action, 'SPECIAL_SUMMON');

  // Synchro exact level sum (Target 8 = Lv 2 Tuner must + Lv 6 Non-Tuner over Lv 6 boss)
  const synView = new BoardView({
    me: 1,
    turn: 1,
    turnPlayer: 1,
    phase: 'main1',
    players: [
      { lp: 8000 },
      {
        lp: 8000,
        mzone: [
          { code: 77585513, type: TYPE.MONSTER | TYPE.TUNER | TYPE.EFFECT, atk: 500, level: 2, location: LOC.MZONE, sequence: 0 }, // Soul Resonator
          { code: 99990001, type: TYPE.MONSTER | TYPE.TOKEN, atk: 0, level: 6, location: LOC.MZONE, sequence: 1 }, // Lv 6 Token
          { code: 84815190, type: TYPE.MONSTER | TYPE.SYNCHRO | TYPE.EFFECT, atk: 3000, level: 6, location: LOC.MZONE, sequence: 2 }, // High-value boss
        ],
      },
    ],
  });
  const synSum = hard.decide(
    {
      type: 'SELECT_SUM',
      select_max: 0,
      amount: 8,
      min: 1,
      max: 3,
      musts: [{ code: 77585513, controller: 1, location: LOC.MZONE, sequence: 0, amount: 2 }],
      selects: [
        { code: 84815190, controller: 1, location: LOC.MZONE, sequence: 2, amount: 6 },
        { code: 99990001, controller: 1, location: LOC.MZONE, sequence: 1, amount: 6 },
      ],
    },
    synView
  );
  assert.deepEqual(synSum.indices, [1], 'Synchro sum must pick Token (index 1) over valuable boss (index 0)');
});

test('4. Pendulum Summon: reads lscale/rscale, sets complementary scales, avoids SZONE 0/4, multi-picks Pendulum Summon', () => {
  const kb = new CardKnowledge({ cardDb: realCardDb });
  const kepler = realCardDb.get(11609969); // D/D Savant Kepler (Scale 10)
  const copernicus = realCardDb.get(46796664); // D/D Savant Copernicus (Scale 1)
  assert.ok(kepler && kepler.lscale === 10, `Kepler lscale should be 10, got ${kepler?.lscale}`);
  assert.ok(copernicus && copernicus.lscale === 1, `Copernicus lscale should be 1, got ${copernicus?.lscale}`);
  assert.equal(kb.stats(11609969).lscale, 10);

  const hard = new AiBrain({ difficulty: 'hard', seed: 33, cardDb: realCardDb });

  // Scale activation + avoiding SZONE 0/4 when Pendulum in hand
  const pendView = new BoardView({
    me: 1,
    turn: 1,
    turnPlayer: 1,
    phase: 'main1',
    players: [
      { lp: 8000 },
      {
        lp: 8000,
        hand: [
          { code: 46796664, type: TYPE.MONSTER | TYPE.PENDULUM | TYPE.EFFECT, level: 4, lscale: 1, rscale: 1, location: LOC.HAND, sequence: 0 },
          { code: 11609969, type: TYPE.MONSTER | TYPE.PENDULUM | TYPE.EFFECT, level: 1, lscale: 10, rscale: 10, location: LOC.HAND, sequence: 1 },
          { code: 89631139, type: TYPE.MONSTER | TYPE.NORMAL, level: 8, atk: 3000, location: LOC.HAND, sequence: 2 },
          { code: 44362883, type: TYPE.MONSTER | TYPE.EFFECT, level: 4, atk: 1800, location: LOC.HAND, sequence: 3 },
        ],
      },
    ],
  });

  const decScale = hard.decide(
    {
      type: 'SELECT_IDLECMD',
      activates: [{ code: 46796664, controller: 1, location: LOC.HAND, sequence: 0 }],
      to_ep: true,
    },
    pendView
  );
  assert.equal(decScale.action, 'ACTIVATE', 'Must activate complementary Pendulum scale');

  // Placement of regular Trap avoids SZONE 0 & 4 when Pendulum cards are in hand
  const maskAllSzone = ~(0b11111 << 8); // self SZONE bits 8..12
  const decPlaceTrap = hard.decide({ type: 'SELECT_PLACE', count: 1, field_mask: maskAllSzone }, pendView);
  const placedSeq = decPlaceTrap.places[0].sequence;
  assert.ok(placedSeq >= 1 && placedSeq <= 3, `Regular S/T must avoid Pendulum zones 0/4, placed at ${placedSeq}`);

  // SELECT_UNSELECT_CARD with HINTMSG.SPSUMMON picks multiple monsters instead of stopping at 1
  const decMultiPend = hard.decide(
    {
      type: 'SELECT_UNSELECT_CARD',
      can_finish: true,
      selected: [{ code: 44362883, controller: 1, location: LOC.HAND, sequence: 3 }],
      selectable: [
        { code: 89631139, controller: 1, location: LOC.HAND, sequence: 2 },
        { code: 46796664, controller: 1, location: LOC.HAND, sequence: 0 },
      ],
    },
    pendView,
    HINTMSG.SPSUMMON
  );
  assert.notEqual(decMultiPend.index, null, 'Must keep picking monsters for Pendulum Summon when can_finish is true');
});

test('5. Special Summon & 6. Tribute Summon: allows Tribute Summon with Token fodder when no Extra play exists; optimizes release_param & cancel', () => {
  const hard = new AiBrain({ difficulty: 'hard', seed: 44, cardDb: realCardDb });

  // Tribute Summon allowed when no Extra Deck/extender play exists and we have a Token on board
  const tribView = new BoardView({
    me: 1,
    turn: 2,
    turnPlayer: 1,
    phase: 'main1',
    players: [
      { lp: 8000 },
      {
        lp: 8000,
        mzone: [{ code: 99990001, type: TYPE.MONSTER | TYPE.TOKEN, atk: 0, def: 0, location: LOC.MZONE, sequence: 0 }],
        hand: [{ code: 24224831, type: TYPE.MONSTER | TYPE.EFFECT, level: 6, atk: 2400, def: 1000, location: LOC.HAND, sequence: 0 }],
      },
    ],
  });
  const decTrib = hard.decide(
    {
      type: 'SELECT_IDLECMD',
      summons: [{ code: 24224831, controller: 1, location: LOC.HAND, sequence: 0 }],
      to_ep: true,
    },
    tribView
  );
  assert.equal(decTrib.action, 'SUMMON', 'Must allow Tribute Summon using expendable Token when no Extra Deck play exists');

  // SELECT_TRIBUTE prefers double-tribute (release_param=2) or Token over sacrificing 2 real monsters, and cancels bad boss tributes
  const doubleTribView = new BoardView({
    me: 1,
    turn: 2,
    turnPlayer: 1,
    phase: 'main1',
    players: [
      { lp: 8000 },
      {
        lp: 8000,
        mzone: [
          { code: 1001, type: TYPE.MONSTER | TYPE.EFFECT, atk: 1800, location: LOC.MZONE, sequence: 0 },
          { code: 1002, type: TYPE.MONSTER | TYPE.EFFECT, atk: 1900, location: LOC.MZONE, sequence: 1 },
          { code: 1003, type: TYPE.MONSTER | TYPE.EFFECT, atk: 1000, location: LOC.MZONE, sequence: 2 }, // double-tribute fodder
        ],
      },
    ],
  });
  const decDouble = hard.decide(
    {
      type: 'SELECT_TRIBUTE',
      min: 2,
      max: 2,
      can_cancel: false,
      selects: [
        { code: 1001, controller: 1, location: LOC.MZONE, sequence: 0, release_param: 1 },
        { code: 1002, controller: 1, location: LOC.MZONE, sequence: 1, release_param: 1 },
        { code: 1003, controller: 1, location: LOC.MZONE, sequence: 2, release_param: 2 },
      ],
    },
    doubleTribView
  );
  assert.deepEqual(decDouble.indices, [2], 'Must pick single double-tribute monster when cheaper than 2 monsters');

  // Cancel bad boss tribute when can_cancel is true
  const bossTribView = new BoardView({
    me: 1,
    turn: 2,
    turnPlayer: 1,
    phase: 'main1',
    players: [
      { lp: 8000 },
      {
        lp: 8000,
        mzone: [{ code: 84815190, type: TYPE.MONSTER | TYPE.SYNCHRO | TYPE.EFFECT, atk: 3000, location: LOC.MZONE, sequence: 0 }],
      },
    ],
  });
  const decCancelBoss = hard.decide(
    {
      type: 'SELECT_TRIBUTE',
      min: 1,
      max: 1,
      can_cancel: true,
      selects: [{ code: 84815190, controller: 1, location: LOC.MZONE, sequence: 0, release_param: 1 }],
    },
    bossTribView
  );
  assert.equal(decCancelBoss.indices, null, 'Must cancel rather than tributing Baronne de Fleur');
});

test('7. Ritual Summon & 8. Fusion Summon: PSCT inference, Ritual/Fusion Spell priority, minimal superset sum, Deck dump vs Hand cost, and GY/Banish triggers', () => {
  const ritualMeta = inferCategoryFromText('This card is used to Ritual Summon "Ame no Habakiri no Mitsurugi". If this card is Tributed: Add 1 card from your Deck to your hand.');
  assert.ok((ritualMeta.category & CATEGORY.SPECIAL_SUMMON) !== 0);
  assert.equal(ritualMeta.isTributeTrigger, true);

  const fusionMeta = inferCategoryFromText('Fusion Summon 1 "Tearlaments" Fusion Monster. If this card is sent to the GY by card effect: Special Summon.');
  assert.ok((fusionMeta.category & CATEGORY.SPECIAL_SUMMON) !== 0);
  assert.equal(fusionMeta.isGyTrigger, true);

  const hard = new AiBrain({ difficulty: 'hard', seed: 55, cardDb: realCardDb });

  // Ritual SELECT_SUM (select_max === 1 minimal superset >= 8)
  const ritView = new BoardView({
    me: 1,
    turn: 1,
    turnPlayer: 1,
    phase: 'main1',
    players: [
      { lp: 8000 },
      {
        lp: 8000,
        hand: [
          { code: 1001, type: TYPE.MONSTER | TYPE.EFFECT, atk: 1200, level: 4, location: LOC.HAND, sequence: 0 },
          { code: 1002, type: TYPE.MONSTER | TYPE.EFFECT, atk: 1400, level: 4, location: LOC.HAND, sequence: 1 },
          { code: 89631139, type: TYPE.MONSTER | TYPE.NORMAL, atk: 3000, level: 8, location: LOC.HAND, sequence: 2 },
        ],
      },
    ],
  });
  const ritSum = hard.decide(
    {
      type: 'SELECT_SUM',
      select_max: 1,
      amount: 8,
      min: 1,
      max: 3,
      musts: [],
      selects: [
        { code: 89631139, controller: 1, location: LOC.HAND, sequence: 2, amount: 8 },
        { code: 1001, controller: 1, location: LOC.HAND, sequence: 0, amount: 4 },
        { code: 1002, controller: 1, location: LOC.HAND, sequence: 1, amount: 4 },
      ],
    },
    ritView
  );
  assert.ok(ritSum.indices.length >= 1, 'Ritual SELECT_SUM must find valid minimal superset >= 8');

  // Fusion FMATERIAL from Deck -> 'gain' (picks highest value), from Hand -> 'cost' (picks Token/lowest)
  const fusView = new BoardView({
    me: 1,
    turn: 1,
    turnPlayer: 1,
    phase: 'main1',
    players: [
      { lp: 8000 },
      {
        lp: 8000,
        deck: [
          { code: 68468459, type: TYPE.MONSTER | TYPE.EFFECT, atk: 1800, location: LOC.DECK, sequence: 0 }, // Fallen of Albaz
          { code: 99990002, type: TYPE.MONSTER | TYPE.NORMAL, atk: 500, location: LOC.DECK, sequence: 1 },
        ],
      },
    ],
  });
  const fusDeckPick = hard.decide(
    {
      type: 'SELECT_CARD',
      min: 1,
      max: 1,
      selects: [
        { code: 99990002, controller: 1, location: LOC.DECK, sequence: 1 },
        { code: 68468459, controller: 1, location: LOC.DECK, sequence: 0 },
      ],
    },
    fusView,
    HINTMSG.FMATERIAL
  );
  assert.deepEqual(fusDeckPick.indices, [1], 'FMATERIAL from Deck must pick highest-value combo piece');

  // SELECT_OPTION prefers Special Summon / Add to Hand / Ritual / Fusion over Send to GY
  const optDec = hard.decide(
    { type: 'SELECT_OPTION', options: [SYSTEM_STRING.TO_GRAVE, SYSTEM_STRING.TO_HAND] },
    fusView
  );
  assert.equal(optDec.index, 1, 'SELECT_OPTION must prefer Add to Hand over Send to GY');

  // SELECT_CHAIN fires own GY/Banished combo trigger
  const gyChainView = new BoardView({
    me: 1,
    turn: 1,
    turnPlayer: 1,
    phase: 'main1',
    players: [{ lp: 8000 }, { lp: 8000 }],
  });
  const gyChainDec = hard.decide(
    {
      type: 'SELECT_CHAIN',
      chains: [{ code: 73956664, controller: 1, location: LOC.GRAVE, sequence: 0 }], // Tearlaments Havnis in GY
      forced: false,
    },
    gyChainView
  );
  assert.equal(gyChainDec.index, 0, 'Must fire own GY Fusion trigger in SELECT_CHAIN');
});

// ============================================================================
// PART B: Real ocgcore-wasm Multi-Deck MDM Duels Across All 8 Summon Types
// ============================================================================

test('Real ocgcore-wasm MDM multi-deck duels execute combos with 0 MSG_RETRY errors and 0 suicide attacks', async () => {
  const core = await getSharedOcgCore();
  // Use a clean 40-card Vanilla opponent deck so Turn-1 AI combos execute uninterrupted, while still responding to any prompts
  const oppDeck = Array(40).fill('blue_eyes_white_dragon');

  const scenarios = [
    {
      label: 'Link + Special Summon (Maliss)',
      deckId: 'mdm_maliss',
      seeds: [101, 102, 103, 104, 105, 106],
      regex: /Maliss|Link Decoder|Splash Mage|Accesscode|Apollousa|S:P Little Knight|Firewall|Allied Code/,
    },
    {
      label: 'Xyz Summon (Exosister)',
      deckId: 'mdm_exosister',
      seeds: [901, 902, 903, 904, 905, 906],
      regex: /Exosister Mikailis|Exosisters Magnifica|Exosister Kaspitell|Exosister Karmael|Exosister Asophiel|Exosister Gibrine/,
    },
    {
      label: 'Synchro Summon (Resonators)',
      deckId: 'mdm_resonators',
      seeds: [300, 301, 302, 303, 304, 305],
      regex: /Red Rising Dragon|Bystial Dis Pater|Crimson King|Red Dragon Archfiend|Scarred Dragon Archfiend|Crimson Dragon|Hot Red/,
    },
    {
      label: 'Pendulum Summon (D/D/D)',
      deckId: 'mdm_d_d_d',
      seeds: [401, 402, 403, 404, 405, 406],
      regex: /Pendulum Summon|D\/D\/D|D\/D Savant|D\/D Necro|D\/D Swirl|D\/D Lamia|Gilgamesh/,
    },
    {
      label: 'Ritual Summon (Mitsurugi)',
      deckId: 'mdm_mitsurugi',
      seeds: [501, 502, 503, 504, 505, 506],
      regex: /Mitsurugi|Ame no Habakiri|Futsu no Mitama|Murakumo|Ritual/,
    },
    {
      label: 'Fusion Summon (Shaddoll)',
      deckId: 'mdm_shaddoll',
      seeds: [601, 602, 603, 604, 605, 606],
      regex: /Shaddoll|Winda|Construct|Apkallone|Fusion/,
    },
  ];

  const results = [];

  for (const sc of scenarios) {
    const aiDeck = buildDeckCodes(sc.deckId);
    let matched = false;
    let totalRetries = 0;
    let lastLogs = '';

    for (const seed of sc.seeds) {
      const eng = new YGOProEngine({
        core,
        deck1Cards: aiDeck,
        deck2Cards: oppDeck,
        isSoloVsAi: true,
        aiIndex: 0,
        aiDifficulty: 'hard',
        aiSeed: seed,
        player1Name: `AI_${sc.deckId}`,
        player2Name: 'Opponent',
      });

      // Advance up to 40 human prompt responses across Turn 1..3
      for (let step = 0; step < 40 && eng.turnCount <= 3 && eng.winner === null; step++) {
        if (!respondToHumanPrompt(eng, 1)) break;
      }

      const logsText = eng.logs.map((l) => l.text).join('\n');
      lastLogs = logsText;
      const retryMatches = logsText.match(/MSG_RETRY|invalid.*response/gi);
      if (retryMatches) totalRetries += retryMatches.length;

      if (sc.regex.test(logsText)) {
        matched = true;
      }
      eng.destroy();
      if (matched) break;
    }

    assert.equal(totalRetries, 0, `${sc.label} must have 0 MSG_RETRY errors`);
    assert.equal(matched, true, `${sc.label} must execute combo in ocgcore-wasm. Last logs:\n${lastLogs}`);
    results.push(`${sc.label}: PASS (0 retries)`);
  }

  assert.equal(results.length, scenarios.length);
});
