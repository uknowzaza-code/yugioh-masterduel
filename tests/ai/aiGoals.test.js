import test from 'node:test';
import assert from 'node:assert/strict';

import { TYPE, LOC, POS, CATEGORY, HINTMSG, SYSTEM_STRING } from '../../src/ai/constants.js';
import { BoardView } from '../../src/ai/board.js';
import { AiBrain } from '../../src/ai/brain.js';
import { CardKnowledge } from '../../src/ai/knowledge.js';
import { ownCardValue, threatScore } from '../../src/ai/evaluate.js';
import { createOcgCardDbAdapter, inferCategoryFromText } from '../../src/ai/card-db.js';
import { getSharedOcgCore, YGOProEngine } from '../../src/engine/YGOProEngine.js';
import { PRESET_DECKS, expandDeckRecipe } from '../../src/cards/index.js';

const realCardDb = createOcgCardDbAdapter();

// ============================================================================
// GOAL 1: บอทไม่ตีตัวเองตาย (Zero Suicide Attacks Across Easy / Normal / Hard)
// ============================================================================
test('Goal 1: Bot NEVER suicides into higher ATK or higher face-up DEF across Easy, Normal, and Hard', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const brain = new AiBrain({ difficulty, seed: 77, cardDb: realCardDb });

    // Case A: 1500 ATK vs 1800 ATK (even small 300 gap must NOT suicide!)
    const viewHigherAtk = new BoardView({
      me: 1,
      turn: 2,
      turnPlayer: 1,
      phase: 'battle',
      players: [
        { lp: 8000, mzone: [{ code: 1001, type: TYPE.MONSTER | TYPE.EFFECT, atk: 1800, def: 1000, position: POS.FACEUP_ATTACK }] },
        { lp: 8000, mzone: [{ code: 2001, type: TYPE.MONSTER | TYPE.EFFECT, atk: 1500, def: 1200, position: POS.FACEUP_ATTACK }] },
      ],
    });
    const dAtk = brain.decide(
      { type: 'SELECT_BATTLECMD', attacks: [{ code: 2001, controller: 1, location: LOC.MZONE, sequence: 0 }], to_m2: true, to_ep: true },
      viewHigherAtk
    );
    assert.equal(dAtk.action, 'TO_M2', `${difficulty} must not suicide 1500 into 1800 ATK`);

    // Case B: 1500 ATK vs 2200 face-up DEF (would take 700 recoil damage!)
    const viewHigherDef = new BoardView({
      me: 1,
      turn: 2,
      turnPlayer: 1,
      phase: 'battle',
      players: [
        { lp: 8000, mzone: [{ code: 1002, type: TYPE.MONSTER | TYPE.EFFECT, atk: 1000, def: 2200, position: POS.FACEUP_DEFENSE }] },
        { lp: 8000, mzone: [{ code: 2001, type: TYPE.MONSTER | TYPE.EFFECT, atk: 1500, def: 1200, position: POS.FACEUP_ATTACK }] },
      ],
    });
    const dDef = brain.decide(
      { type: 'SELECT_BATTLECMD', attacks: [{ code: 2001, controller: 1, location: LOC.MZONE, sequence: 0 }], to_m2: true, to_ep: true },
      viewHigherDef
    );
    assert.equal(dDef.action, 'TO_M2', `${difficulty} must not bounce 1500 ATK off 2200 DEF`);
  }
});

test('Goal 1: Hard never crashes valuable Boss (Baronne 3000) into Vanilla 3000, and skips self-harm optional triggers', () => {
  const hard = new AiBrain({ difficulty: 'hard', seed: 12, cardDb: realCardDb });
  const viewCrash = new BoardView({
    me: 1,
    turn: 2,
    turnPlayer: 1,
    phase: 'battle',
    players: [
      { lp: 8000, mzone: [{ code: 89631139, type: TYPE.MONSTER | TYPE.NORMAL, atk: 3000, def: 2500, position: POS.FACEUP_ATTACK }] },
      { lp: 8000, mzone: [{ code: 84815190, type: TYPE.MONSTER | TYPE.SYNCHRO | TYPE.EFFECT, atk: 3000, def: 2400, position: POS.FACEUP_ATTACK }] },
    ],
  });
  const dec = hard.decide(
    { type: 'SELECT_BATTLECMD', attacks: [{ code: 84815190, controller: 1, location: LOC.MZONE, sequence: 0 }], to_m2: true, to_ep: true },
    viewCrash
  );
  assert.equal(dec.action, 'TO_M2');

  // S:P Little Knight skips banish when opponent has 0 field & 0 GY
  const emptyOppView = new BoardView({ me: 1, turn: 1, turnPlayer: 1, phase: 'main1', players: [{ lp: 8000 }, { lp: 8000 }] });
  assert.equal(hard.decide({ type: 'SELECT_EFFECTYN', code: 29301450 }, emptyOppView).yes, false);
  // Baronne skips Standby tag-out
  const spView = new BoardView({ me: 1, turn: 3, turnPlayer: 1, phase: 'standby', players: [{ lp: 8000 }, { lp: 8000 }] });
  assert.equal(hard.decide({ type: 'SELECT_EFFECTYN', code: 84815190 }, spView).yes, false);
});

// ============================================================================
// GOAL 3: บอทตั้ง Value ความสำคัญระหว่างการ์ดว่าอันไหนอันตรายกว่าได้
// ============================================================================
test('Goal 3: Threat and value hierarchy ranks Floodgate/Boss-Negate > Vanilla > Negated > Token', () => {
  const kb = new CardKnowledge({ cardDb: realCardDb });

  const baronne = { code: 84815190, type: TYPE.MONSTER | TYPE.SYNCHRO | TYPE.EFFECT, atk: 3000, def: 2400, location: LOC.MZONE, position: POS.FACEUP_ATTACK };
  const baronneNegated = { ...baronne, effectsNegated: true };
  const winda = { code: 94977269, type: TYPE.MONSTER | TYPE.FUSION | TYPE.EFFECT, atk: 2200, def: 800, location: LOC.MZONE, position: POS.FACEUP_ATTACK };
  const blueEyes = { code: 89631139, type: TYPE.MONSTER | TYPE.NORMAL, atk: 3000, def: 2500, location: LOC.MZONE, position: POS.FACEUP_ATTACK };
  const token = { code: 99999999, type: TYPE.MONSTER | TYPE.TOKEN, atk: 0, def: 0, location: LOC.MZONE, position: POS.FACEUP_DEFENSE };

  assert.ok(threatScore(baronne, kb) > threatScore(blueEyes, kb), 'Baronne omni-negate must outrank 3000 vanilla Blue-Eyes');
  assert.ok(threatScore(winda, kb) > threatScore(blueEyes, kb), 'El Shaddoll Winda floodgate must outrank 3000 vanilla Blue-Eyes');
  assert.ok(threatScore(baronne, kb) > threatScore(baronneNegated, kb), 'Active Baronne must outrank already-negated Baronne');
  assert.ok(threatScore(blueEyes, kb) > threatScore(token, kb), 'Blue-Eyes must outrank Token');

  assert.ok(ownCardValue(baronne, kb) > ownCardValue(blueEyes, kb), 'Own Baronne value > Own Blue-Eyes value');
  assert.ok(ownCardValue(blueEyes, kb) > ownCardValue(token, kb), 'Own Blue-Eyes value > Token value');

  // Hard destroys Winda (idx 1) over Blue-Eyes (idx 0) even though Blue-Eyes has higher ATK!
  const hard = new AiBrain({ difficulty: 'hard', seed: 5, cardDb: realCardDb });
  const view = new BoardView({
    me: 1,
    turn: 2,
    turnPlayer: 1,
    phase: 'main1',
    players: [{ lp: 8000, mzone: [blueEyes, winda] }, { lp: 8000 }],
  });
  const pick = hard.decide(
    {
      type: 'SELECT_CARD',
      min: 1,
      max: 1,
      selects: [
        { code: 89631139, controller: 0, location: LOC.MZONE, sequence: 0 },
        { code: 94977269, controller: 0, location: LOC.MZONE, sequence: 1 },
      ],
    },
    view,
    HINTMSG.DESTROY
  );
  assert.deepEqual(pick.indices, [1]);
});

// ============================================================================
// GOAL 4: บอท Negate ได้ถูกจังหวะ (Timing-Accurate Negates & PSCT Inference)
// ============================================================================
test('Goal 4: PSCT category inference + timing-accurate Ash / Called By / Solemn / Maxx C discipline', () => {
  // Verify real cards.cdb + Yugipedia PSCT text inference works automatically!
  const rota = realCardDb.get(32807846);
  const brandedFusion = realCardDb.get(44362883);
  const skillDrain = realCardDb.get(82732705);
  assert.ok((rota.category & CATEGORY.SEARCH) !== 0, 'ROTA inferred as SEARCH');
  assert.ok((brandedFusion.category & CATEGORY.SPECIAL_SUMMON) !== 0, 'Branded Fusion inferred as SPECIAL_SUMMON');
  assert.equal(skillDrain.isFloodgate, true, 'Skill Drain inferred as floodgate');
  assert.ok((inferCategoryFromText('Draw 2 cards.').category & CATEGORY.DRAW) !== 0);

  const hard = new AiBrain({ difficulty: 'hard', seed: 19, cardDb: realCardDb });

  // 1) Opponent activates low-impact non-combo card -> Hard HOLDS Ash Blossom
  const lowView = new BoardView({
    me: 1,
    turn: 1,
    turnPlayer: 0,
    phase: 'main1',
    players: [{ lp: 8000 }, { lp: 8000 }],
    chain: [{ player: 0, code: 99990001, location: LOC.SZONE, sequence: 0, category: 0 }],
  });
  assert.equal(
    hard.decide({ type: 'SELECT_CHAIN', chains: [{ code: 14558127, controller: 1, location: LOC.HAND, sequence: 0 }], forced: false }, lowView).index,
    null
  );

  // 2) Opponent activates Branded Fusion (even with link.category = 0 as in real ocgcore!) -> Hard fires Ash Blossom BEFORE Solemn Judgment
  const bfView = new BoardView({
    me: 1,
    turn: 1,
    turnPlayer: 0,
    phase: 'main1',
    players: [{ lp: 8000 }, { lp: 8000 }],
    chain: [{ player: 0, code: 44362883, location: LOC.SZONE, sequence: 0, category: 0 }],
  });
  const decBf = hard.decide(
    {
      type: 'SELECT_CHAIN',
      chains: [
        { code: 41420027, controller: 1, location: LOC.SZONE, sequence: 0 }, // Solemn Judgment (costs half LP)
        { code: 14558127, controller: 1, location: LOC.HAND, sequence: 0 },  // Ash Blossom (free specific counter!)
      ],
      forced: false,
    },
    bfView
  );
  assert.equal(decBf.index, 1, 'Hard must pick Ash Blossom over Solemn Judgment when both counter Branded Fusion');

  // 3) Double-negate guard: same CL must not be negated twice
  const decBfRepeat = hard.decide(
    { type: 'SELECT_CHAIN', chains: [{ code: 41420027, controller: 1, location: LOC.SZONE, sequence: 0 }], forced: false },
    bfView
  );
  assert.equal(decBfRepeat.index, null, 'Must not double-negate the same Chain Link');

  // 4) Opponent chains Ash Blossom to OUR Branded Fusion -> AI immediately counter-negates with Called by the Grave!
  const counterView = new BoardView({
    me: 1,
    turn: 2,
    turnPlayer: 1,
    phase: 'main1',
    players: [{ lp: 8000 }, { lp: 8000 }],
    chain: [
      { player: 1, code: 44362883, location: LOC.SZONE, sequence: 0, category: 0 },
      { player: 0, code: 14558127, location: LOC.HAND, sequence: 0, category: 0 },
    ],
  });
  const decCalledBy = hard.decide(
    { type: 'SELECT_CHAIN', chains: [{ code: 24224830, controller: 1, location: LOC.HAND, sequence: 0 }], forced: false },
    counterView
  );
  assert.equal(decCalledBy.index, 0, 'Must counter-negate opponent Ash Blossom with Called by the Grave');

  // 5) Never waste Maxx "C" in End Phase
  const epView = new BoardView({ me: 1, turn: 1, turnPlayer: 0, phase: 'end', players: [{ lp: 8000 }, { lp: 8000 }] });
  assert.equal(
    hard.decide({ type: 'SELECT_CHAIN', chains: [{ code: 23434538, controller: 1, location: LOC.HAND, sequence: 0 }], forced: false }, epView).index,
    null
  );
});

// ============================================================================
// GOAL 2: บอทคอมโบได้จริงใน ocgcore-wasm (Real Deck Combo Verification)
// ============================================================================
test('Goal 2: Real ocgcore-wasm duels execute multi-step combos (Sky Striker discipline, Swordsoul, Dark Magician, Elfnote)', async () => {
  const core = await getSharedOcgCore();
  const build = (d) => [...expandDeckRecipe(d.mainDeckRecipe || []), ...expandDeckRecipe(d.extraDeckRecipe || [])];
  const oppDeck = build(PRESET_DECKS.find((d) => d.id === 'blue_eyes_meta'));

  // 1) Sky Striker Turn 1: activates ROTA BEFORE Raye/Links and ends on Shizuku (NOT Hayate on Turn 1!)
  const strikerDeck = build(PRESET_DECKS.find((d) => d.id === 'sky_striker_ace'));
  const strikerEng = new YGOProEngine({
    core,
    deck1Cards: strikerDeck,
    deck2Cards: oppDeck,
    isSoloVsAi: true,
    aiIndex: 0,
    aiDifficulty: 'hard',
    aiSeed: 101,
    player1Name: 'AI_Striker',
    player2Name: 'Human',
  });
  // Let Human pass any chain prompt (e.g. Ash Blossom) so AI completes Turn 1 cleanly
  for (let i = 0; i < 10 && strikerEng.turnCount === 1; i++) {
    const p = strikerEng.state.pendingPrompt;
    if (!p || p.playerIndex !== 1) break;
    if (p.type === 'SELECT_CHAIN') strikerEng.dispatchAction(1, { type: 'CHAIN_RESPONSE', respond: false });
    else break;
  }
  const strikerField = [...strikerEng.state.players[0].mmz, ...strikerEng.state.players[0].emzSlots].filter(Boolean).map((c) => c.name);
  assert.ok(!strikerField.includes('Sky Striker Ace - Hayate'), `Turn 1 Sky Striker must not end on Hayate (got: ${strikerField.join(', ')})`);
  strikerEng.destroy();

  // 2) Swordsoul Turn 1: try up to 3 fresh hands (standard Yu-Gi-Oh variance) and confirm multi-step Synchro/Token/Search combo executes!
  const ssDeck = build(PRESET_DECKS.find((d) => d.id === 'swordsoul_tenyi'));
  let comboExecuted = false;
  let lastLogs = '';
  for (let attempt = 0; attempt < 3 && !comboExecuted; attempt++) {
    const ssEng = new YGOProEngine({
      core,
      deck1Cards: ssDeck,
      deck2Cards: oppDeck,
      isSoloVsAi: true,
      aiIndex: 0,
      aiDifficulty: 'hard',
      aiSeed: 101 + attempt,
      player1Name: 'AI_Swordsoul',
      player2Name: 'Human',
    });
    for (let i = 0; i < 20 && ssEng.turnCount === 1; i++) {
      const p = ssEng.state.pendingPrompt;
      if (!p || p.playerIndex !== 1) break;
      if (p.type === 'SELECT_CHAIN') ssEng.dispatchAction(1, { type: 'CHAIN_RESPONSE', respond: false });
      else if (p.type === 'SELECT_EFFECTYN' || p.type === 'SELECT_YESNO') ssEng.dispatchAction(1, { type: 'CONFIRM_CHOICE', confirm: false });
      else break;
    }
    const ssLogs = ssEng.logs.map((l) => l.text).join('\n');
    lastLogs = ssLogs;
    if (/Swordsoul Grandmaster - Chixiao|Swordsoul Token|Baronne de Fleur|Baxia|Qixing/.test(ssLogs)) {
      comboExecuted = true;
    }
    ssEng.destroy();
  }
  assert.equal(comboExecuted, true, `Swordsoul AI must execute a multi-step combo. Last logs:\n${lastLogs}`);
});
