/**
 * @fileoverview Official Yu-Gi-Oh! TCG Rulebook Version 10 Compliance Test Suite
 * Tests both `DuelEngine` (JS Engine) and `YGOProEngine` (ocgcore-wasm) against Official Rulebook v10.
 * Does not abort on first failure — runs all test cases, prints ✅ PASS / ❌ FAIL per rule,
 * prints a full summary table at the end, and exits with code 1 if any test failed.
 */

import assert from 'node:assert/strict';
import { DuelEngine } from '../src/engine/DuelEngine.js';
import { SummonManager } from '../src/engine/SummonManager.js';
import { getSharedOcgCore, YGOProEngine } from '../src/engine/YGOProEngine.js';
import { getCardById, getPresetDeckById, expandDeckRecipe } from '../src/cards/index.js';
import {
  PHASES,
  POSITIONS,
  CARD_KINDS,
  MONSTER_FRAMES,
  SPELL_SUBTYPES,
  TRAP_SUBTYPES,
  SPELL_SPEED,
  CHAIN_MODE,
  TRIGGERS,
  ACTION_TYPES
} from '../src/constants/gameConstants.js';

// ============================================================================
// Test Runner Harness (collects all results, never aborts early)
// ============================================================================
const results = [];

async function runTest(category, ruleName, fn) {
  try {
    await fn();
    results.push({ category, ruleName, passed: true, error: null });
    console.log(`✅ PASS | [${category}] ${ruleName}`);
  } catch (err) {
    const reason = err?.message || String(err);
    results.push({ category, ruleName, passed: false, error: reason });
    console.log(`❌ FAIL | [${category}] ${ruleName}\n         Reason: ${reason}`);
  }
}

// ============================================================================
// Deterministic Synthetic Card Helpers (for clean, isolated rulebook testing)
// ============================================================================
function makeVanillaMonsterDef(id, name, { level = 4, atk = 1500, def = 1200, frame = MONSTER_FRAMES.NORMAL, linkRating, linkArrows, rank } = {}) {
  const defObj = {
    id,
    name,
    nameTh: name,
    kind: CARD_KINDS.MONSTER,
    frame,
    attribute: 'LIGHT',
    race: 'Warrior',
    atk,
    effects: []
  };
  if (frame === MONSTER_FRAMES.LINK) {
    defObj.linkRating = linkRating || 1;
    defObj.linkArrows = linkArrows || ['BOTTOM'];
    defObj.def = 0;
  } else if (frame === MONSTER_FRAMES.XYZ) {
    defObj.rank = rank || level;
    defObj.def = def;
    defObj.summonMaterials = { count: 2, level: rank || level };
  } else {
    defObj.level = level;
    defObj.def = def;
  }
  return defObj;
}

function makeTokenDef(id = 'test_token', name = 'Test Token', { level = 4, atk = 0, def = 0 } = {}) {
  return {
    id,
    name,
    nameTh: name,
    kind: CARD_KINDS.MONSTER,
    frame: MONSTER_FRAMES.TOKEN,
    attribute: 'EARTH',
    race: 'Warrior',
    level,
    atk,
    def,
    effects: []
  };
}

function makeSpellDef(id, name, subType, { effects = null, spellSpeed = null } = {}) {
  const defaultSpeed = subType === SPELL_SUBTYPES.QUICK_PLAY ? SPELL_SPEED.SS2 : SPELL_SPEED.SS1;
  return {
    id,
    name,
    nameTh: name,
    kind: CARD_KINDS.SPELL,
    subType,
    effects: effects ?? [
      {
        id: `${id}_eff`,
        trigger: TRIGGERS.SPELL_ACTIVATE,
        spellSpeed: spellSpeed ?? defaultSpeed,
        labelTh: `Activate ${name}`,
        actions: [{ type: ACTION_TYPES.GAIN_LP, amount: 100 }]
      }
    ]
  };
}

function makeTrapDef(id, name, subType, { effects = null, spellSpeed = null } = {}) {
  const isCounter = subType === TRAP_SUBTYPES.COUNTER;
  const defaultSpeed = isCounter ? SPELL_SPEED.SS3 : SPELL_SPEED.SS2;
  const defaultTrigger = isCounter ? TRIGGERS.COUNTER_TRAP : TRIGGERS.SPELL_ACTIVATE;
  return {
    id,
    name,
    nameTh: name,
    kind: CARD_KINDS.TRAP,
    subType,
    effects: effects ?? [
      {
        id: `${id}_eff`,
        trigger: defaultTrigger,
        spellSpeed: spellSpeed ?? defaultSpeed,
        labelTh: `Activate ${name}`,
        actions: [{ type: ACTION_TYPES.GAIN_LP, amount: 100 }]
      }
    ]
  };
}

function createCleanDuel() {
  const engine = new DuelEngine({ p0DeckId: 'blue_eyes_meta', p1DeckId: 'swordsoul_tenyi' });
  // Disable opponent hand traps by default unless explicitly set up by a test
  engine.state.players[0].hand = [];
  engine.state.players[1].hand = [];
  engine.state.players[0].chainMode = CHAIN_MODE.ON;
  engine.state.players[1].chainMode = CHAIN_MODE.ON;
  return engine;
}

function placeMonsterOnField(engine, playerIndex, cardDef, { slot = 0, zone = 'MMZ', position = POSITIONS.ATK, summonedTurn = 1 } = {}) {
  const p = engine.state.players[playerIndex];
  const card = engine.createCardInstance(cardDef, playerIndex, zone);
  card.position = position;
  card.summonedTurn = summonedTurn;
  if (zone === 'EMZ') {
    card.zoneIndex = 0;
    p.emz = card;
  } else {
    card.zoneIndex = slot;
    p.mmz[slot] = card;
  }
  return card;
}

function advanceToTurn(engine, targetTurn) {
  while (engine.state.turnCount < targetTurn && engine.state.winner === null) {
    const tp = engine.state.turnPlayer;
    const res = engine.executeAction(tp, { type: 'CHANGE_PHASE', targetPhase: PHASES.EP });
    if (!res.ok) {
      throw new Error(`Failed to advance turn at turn ${engine.state.turnCount}: ${res.errorTh}`);
    }
  }
}

console.log('========================================================================');
console.log('📜 Official Yu-Gi-Oh! TCG Rulebook Version 10 — Automated QA Test Suite');
console.log('========================================================================\n');

// ============================================================================
// 1. TURN 1 RULES
// ============================================================================
await runTest('1. Turn 1 Rules', 'Turn 1 starts with 5 cards, 8000 LP, no Turn 1 Draw Phase draw', () => {
  const deck0 = getPresetDeckById('blue_eyes_meta');
  const mainCount0 = deck0.mainDeckRecipe.reduce((s, r) => s + r.count, 0);
  const engine = new DuelEngine({ p0DeckId: 'blue_eyes_meta', p1DeckId: 'swordsoul_tenyi' });

  assert.equal(engine.state.turnCount, 1, 'Duel must start on Turn 1');
  assert.equal(engine.state.turnPlayer, 0, 'Player 0 should be Turn 1 player');
  assert.equal(engine.state.players[0].lp, 8000, 'P0 LP must start at 8000');
  assert.equal(engine.state.players[1].lp, 8000, 'P1 LP must start at 8000');
  assert.equal(engine.state.players[0].hand.length, 5, 'Turn 1 player must start with 5 cards (no Turn 1 DP draw)');
  assert.equal(engine.state.players[1].hand.length, 5, 'Turn 2 player must start with 5 cards');
  assert.equal(engine.state.players[0].deck.length, mainCount0 - 5, 'Turn 1 deck should only be missing the 5 opening cards');
});

await runTest('1. Turn 1 Rules', 'Turn 1 player CANNOT enter Battle Phase', () => {
  const engine = createCleanDuel();
  assert.equal(engine.state.turnCount, 1);
  assert.equal(engine.state.phase, PHASES.MP1);

  const res = engine.executeAction(0, { type: 'CHANGE_PHASE', targetPhase: PHASES.BP });
  assert.equal(res.ok, false, 'Entering Battle Phase on Turn 1 must be rejected');
  assert.equal(engine.state.phase, PHASES.MP1, 'Phase must remain MP1 after rejected Turn 1 BP entry');
});

await runTest('1. Turn 1 Rules', 'Turn 2 player DOES draw in Turn 2 DP and CAN enter Battle Phase', () => {
  const engine = new DuelEngine({ p0DeckId: 'blue_eyes_meta', p1DeckId: 'swordsoul_tenyi' });
  const p1HandBefore = engine.state.players[1].hand.length;
  assert.equal(p1HandBefore, 5);

  const epRes = engine.executeAction(0, { type: 'CHANGE_PHASE', targetPhase: PHASES.EP });
  assert.equal(epRes.ok, true, 'P0 should be able to end Turn 1');
  assert.equal(engine.state.turnCount, 2, 'Should now be Turn 2');
  assert.equal(engine.state.turnPlayer, 1, 'Turn player should now be P1');
  assert.equal(engine.state.players[1].hand.length, 6, 'Turn 2 player must draw 1 card in Turn 2 DP (5 -> 6)');

  const bpRes = engine.executeAction(1, { type: 'CHANGE_PHASE', targetPhase: PHASES.BP });
  assert.equal(bpRes.ok, true, 'Turn 2 player must be allowed to enter Battle Phase');
  assert.equal(engine.state.phase, PHASES.BP, 'Phase must be BP');
});

// ============================================================================
// 2. NORMAL SUMMON / SET & TRIBUTE SUMMON
// ============================================================================
await runTest('2. Normal Summon/Set & Tribute', 'Once-per-turn Normal Summon limit prevents second Normal Summon or Set', () => {
  const engine = createCleanDuel();
  const p0 = engine.state.players[0];
  const m1 = engine.createCardInstance(makeVanillaMonsterDef('m_lv4_1', 'Soldier A', { level: 4 }), 0, 'HAND');
  const m2 = engine.createCardInstance(makeVanillaMonsterDef('m_lv4_2', 'Soldier B', { level: 4 }), 0, 'HAND');
  p0.hand = [m1, m2];

  const res1 = engine.executeAction(0, { type: 'NORMAL_SUMMON', instanceId: m1.instanceId });
  assert.equal(res1.ok, true, 'First Normal Summon should succeed');

  const res2 = engine.executeAction(0, { type: 'NORMAL_SUMMON', instanceId: m2.instanceId });
  assert.equal(res2.ok, false, 'Second Normal Summon in the same turn must fail');

  const res3 = engine.executeAction(0, { type: 'NORMAL_SET', instanceId: m2.instanceId });
  assert.equal(res3.ok, false, 'Normal Set after Normal Summon in the same turn must fail');
});

await runTest('2. Normal Summon/Set & Tribute', 'Normal Set places monster in face-down DEF and prevents Normal Summon same turn', () => {
  const engine = createCleanDuel();
  const p0 = engine.state.players[0];
  const m1 = engine.createCardInstance(makeVanillaMonsterDef('m_set_1', 'Defender A', { level: 4, def: 2000 }), 0, 'HAND');
  const m2 = engine.createCardInstance(makeVanillaMonsterDef('m_set_2', 'Attacker B', { level: 4, atk: 1800 }), 0, 'HAND');
  p0.hand = [m1, m2];

  const setRes = engine.executeAction(0, { type: 'NORMAL_SET', instanceId: m1.instanceId });
  assert.equal(setRes.ok, true, 'Normal Set should succeed');
  assert.equal(m1.position, POSITIONS.SET_DEF, 'Normal Set must place monster in face-down DEF (SET_DEF)');

  const nsRes = engine.executeAction(0, { type: 'NORMAL_SUMMON', instanceId: m2.instanceId });
  assert.equal(nsRes.ok, false, 'Normal Summon after Normal Set in the same turn must fail');
});

await runTest('2. Normal Summon/Set & Tribute', 'Level 1-4 = 0 tributes; Level 5-6 = 1 tribute; Level 7+ = 2 tributes', () => {
  const lv1 = makeVanillaMonsterDef('lv1', 'Lv1', { level: 1 });
  const lv4 = makeVanillaMonsterDef('lv4', 'Lv4', { level: 4 });
  const lv5 = makeVanillaMonsterDef('lv5', 'Lv5', { level: 5 });
  const lv6 = makeVanillaMonsterDef('lv6', 'Lv6', { level: 6 });
  const lv7 = makeVanillaMonsterDef('lv7', 'Lv7', { level: 7 });
  const lv8 = makeVanillaMonsterDef('lv8', 'Lv8', { level: 8 });

  assert.equal(SummonManager.getRequiredTributes(lv1), 0, 'Level 1 requires 0 tributes');
  assert.equal(SummonManager.getRequiredTributes(lv4), 0, 'Level 4 requires 0 tributes');
  assert.equal(SummonManager.getRequiredTributes(lv5), 1, 'Level 5 requires 1 tribute');
  assert.equal(SummonManager.getRequiredTributes(lv6), 1, 'Level 6 requires 1 tribute');
  assert.equal(SummonManager.getRequiredTributes(lv7), 2, 'Level 7 requires 2 tributes');
  assert.equal(SummonManager.getRequiredTributes(lv8), 2, 'Level 8 requires 2 tributes');

  // Test Level 5-6 requires 1 tribute in execution
  const e1 = createCleanDuel();
  const cLv5 = e1.createCardInstance(lv5, 0, 'HAND');
  e1.state.players[0].hand = [cLv5];
  assert.equal(e1.executeAction(0, { type: 'NORMAL_SUMMON', instanceId: cLv5.instanceId }).ok, false, 'Lv5 cannot be Normal Summoned with 0 monsters');
  const fodder1 = placeMonsterOnField(e1, 0, lv1, { slot: 0 });
  assert.equal(e1.executeAction(0, { type: 'NORMAL_SUMMON', instanceId: cLv5.instanceId, tributeInstanceIds: [fodder1.instanceId] }).ok, true, 'Lv5 should succeed with 1 tribute');
  assert.ok(e1.state.players[0].gy.some(c => c.instanceId === fodder1.instanceId), '1 tribute must be sent to GY');

  // Test Level 7+ requires 2 tributes in execution
  const e2 = createCleanDuel();
  const cLv7 = e2.createCardInstance(lv7, 0, 'HAND');
  e2.state.players[0].hand = [cLv7];
  const fA = placeMonsterOnField(e2, 0, lv1, { slot: 0 });
  assert.equal(e2.executeAction(0, { type: 'NORMAL_SUMMON', instanceId: cLv7.instanceId }).ok, false, 'Lv7 cannot be Normal Summoned with only 1 monster');
  const fB = placeMonsterOnField(e2, 0, lv4, { slot: 1 });
  assert.equal(e2.executeAction(0, { type: 'NORMAL_SUMMON', instanceId: cLv7.instanceId, tributeInstanceIds: [fA.instanceId, fB.instanceId] }).ok, true, 'Lv7 should succeed with 2 tributes');
  assert.ok(e2.state.players[0].gy.some(c => c.instanceId === fA.instanceId), 'First tribute must be sent to GY');
  assert.ok(e2.state.players[0].gy.some(c => c.instanceId === fB.instanceId), 'Second tribute must be sent to GY');
});

// ============================================================================
// 3. FLIP SUMMON & BATTLE POSITION CHANGES
// ============================================================================
await runTest('3. Flip Summon & Position', 'Cannot Flip Summon on the same turn the monster was Set', () => {
  const engine = createCleanDuel();
  const m = engine.createCardInstance(makeVanillaMonsterDef('flip_m1', 'Set Monster', { level: 4 }), 0, 'HAND');
  engine.state.players[0].hand = [m];

  assert.equal(engine.executeAction(0, { type: 'NORMAL_SET', instanceId: m.instanceId }).ok, true);
  const legal = engine.getLegalActions(0);
  assert.equal((legal.fieldActions[m.instanceId] || []).some(a => a.type === 'CHANGE_POSITION'), false, 'Same-turn Set monster must not offer CHANGE_POSITION/Flip Summon');

  const flipRes = engine.executeAction(0, { type: 'CHANGE_POSITION', instanceId: m.instanceId });
  assert.equal(flipRes.ok, false, 'Flip Summon on the same turn it was Set must fail');
  assert.equal(m.position, POSITIONS.SET_DEF, 'Monster must remain face-down DEF');
});

await runTest('3. Flip Summon & Position', 'Flip Summon on a later turn changes face-down DEF -> face-up ATK (never face-up DEF)', () => {
  const engine = createCleanDuel();
  const m = engine.createCardInstance(makeVanillaMonsterDef('flip_m2', 'Flip Monster', { level: 4 }), 0, 'HAND');
  engine.state.players[0].hand = [m];

  assert.equal(engine.executeAction(0, { type: 'NORMAL_SET', instanceId: m.instanceId }).ok, true);
  advanceToTurn(engine, 3); // Back to P0's turn

  const flipRes = engine.executeAction(0, { type: 'CHANGE_POSITION', instanceId: m.instanceId });
  assert.equal(flipRes.ok, true, 'Flip Summon on a later turn should succeed');
  assert.equal(m.position, POSITIONS.ATK, 'Flip Summon must change SET_DEF -> face-up ATK (never face-up DEF)');
});

await runTest('3. Flip Summon & Position', 'Cannot change battle position on the same turn Summoned', () => {
  const engine = createCleanDuel();
  const m = engine.createCardInstance(makeVanillaMonsterDef('pos_m1', 'Fresh Summon', { level: 4 }), 0, 'HAND');
  engine.state.players[0].hand = [m];

  assert.equal(engine.executeAction(0, { type: 'NORMAL_SUMMON', instanceId: m.instanceId }).ok, true);
  const res = engine.executeAction(0, { type: 'CHANGE_POSITION', instanceId: m.instanceId });
  assert.equal(res.ok, false, 'Cannot change battle position on the same turn Summoned');
  assert.equal(m.position, POSITIONS.ATK);
});

await runTest('3. Flip Summon & Position', 'Cannot change battle position in MP2 if the monster attacked in BP', () => {
  const engine = createCleanDuel();
  const m = placeMonsterOnField(engine, 0, makeVanillaMonsterDef('pos_atk_mp2', 'Attacker', { level: 4, atk: 1500 }), {
    slot: 0,
    position: POSITIONS.ATK,
    summonedTurn: 1
  });
  advanceToTurn(engine, 3); // Turn 3: P0's turn, m was summoned on Turn 1

  assert.equal(engine.executeAction(0, { type: 'CHANGE_PHASE', targetPhase: PHASES.BP }).ok, true);
  const atkRes = engine.executeAction(0, { type: 'DECLARE_ATTACK', attackerInstanceId: m.instanceId, directAttack: true });
  assert.equal(atkRes.ok, true, 'Attack in BP should succeed');

  assert.equal(engine.executeAction(0, { type: 'CHANGE_PHASE', targetPhase: PHASES.MP2 }).ok, true);
  assert.equal(engine.state.phase, PHASES.MP2);

  const legal = engine.getLegalActions(0);
  const hasChangePos = (legal.fieldActions[m.instanceId] || []).some(a => a.type === 'CHANGE_POSITION');
  assert.equal(hasChangePos, false, 'Legal actions in MP2 must NOT allow CHANGE_POSITION for a monster that attacked in BP');

  const changeRes = engine.executeAction(0, { type: 'CHANGE_POSITION', instanceId: m.instanceId });
  assert.equal(changeRes.ok, false, 'CHANGE_POSITION in MP2 after attacking in BP must be rejected');
  assert.equal(m.position, POSITIONS.ATK, 'Position must remain ATK');
});

await runTest('3. Flip Summon & Position', 'Cannot change battle position twice in the same turn', () => {
  const engine = createCleanDuel();
  const m = placeMonsterOnField(engine, 0, makeVanillaMonsterDef('pos_twice', 'Shifter', { level: 4 }), {
    slot: 0,
    position: POSITIONS.ATK,
    summonedTurn: 1
  });
  advanceToTurn(engine, 3);

  const first = engine.executeAction(0, { type: 'CHANGE_POSITION', instanceId: m.instanceId });
  assert.equal(first.ok, true, 'First position change on a later turn should succeed');
  assert.equal(m.position, POSITIONS.DEF);

  const second = engine.executeAction(0, { type: 'CHANGE_POSITION', instanceId: m.instanceId });
  assert.equal(second.ok, false, 'Second position change in the same turn must fail');
  assert.equal(m.position, POSITIONS.DEF);
});

// ============================================================================
// 4. LINK MONSTERS & EMZ
// ============================================================================
await runTest('4. Link Monsters & EMZ', 'Link Monster cannot be changed to Defense Position or flipped face-down', () => {
  const engine = createCleanDuel();
  const linkDef = makeVanillaMonsterDef('test_link', 'Test Link-1', { frame: MONSTER_FRAMES.LINK, atk: 1500, linkRating: 1 });
  const linkCard = engine.createCardInstance(linkDef, 0, 'EXTRA');
  engine.state.players[0].extra = [linkCard];

  // Attempting to Special Summon a Link Monster in DEF or SET_DEF must force ATK
  engine.specialSummonCard(0, linkCard, POSITIONS.DEF, 'EXTRA');
  assert.equal(linkCard.position, POSITIONS.ATK, 'Link Monster must always be in face-up ATK even if DEF requested');

  const linkCard2 = engine.createCardInstance(linkDef, 0, 'GY');
  engine.state.players[0].gy = [linkCard2];
  engine.specialSummonCard(0, linkCard2, POSITIONS.SET_DEF, 'GY');
  assert.equal(linkCard2.position, POSITIONS.ATK, 'Link Monster cannot be placed face-down (SET_DEF)');

  // Even on a later turn, CHANGE_POSITION must be rejected
  advanceToTurn(engine, 3);
  const legal = engine.getLegalActions(0);
  assert.equal((legal.fieldActions[linkCard.instanceId] || []).some(a => a.type === 'CHANGE_POSITION'), false, 'Link Monster must not offer CHANGE_POSITION');
  const res = engine.executeAction(0, { type: 'CHANGE_POSITION', instanceId: linkCard.instanceId });
  assert.equal(res.ok, false, 'CHANGE_POSITION on Link Monster must fail');
  assert.equal(linkCard.position, POSITIONS.ATK);
});

await runTest('4. Link Monsters & EMZ', 'Opponent monster in EMZ blocks direct attacks', () => {
  const engine = createCleanDuel();
  const attacker = placeMonsterOnField(engine, 0, makeVanillaMonsterDef('atk_emz', 'Attacker', { atk: 2000 }), { slot: 0 });
  const oppEmzMon = placeMonsterOnField(engine, 1, makeVanillaMonsterDef('opp_emz', 'EMZ Link', { frame: MONSTER_FRAMES.LINK, atk: 1500 }), { zone: 'EMZ' });

  advanceToTurn(engine, 3);
  assert.equal(engine.executeAction(0, { type: 'CHANGE_PHASE', targetPhase: PHASES.BP }).ok, true);

  const legal = engine.getLegalActions(0);
  assert.equal(legal.attackTargets[attacker.instanceId]?.canDirectAttack, false, 'canDirectAttack must be false when opponent has a monster in EMZ');
  assert.ok(legal.attackTargets[attacker.instanceId]?.targets.includes(oppEmzMon.instanceId), 'EMZ monster must be a valid attack target');

  const directRes = engine.executeAction(0, {
    type: 'DECLARE_ATTACK',
    attackerInstanceId: attacker.instanceId,
    directAttack: true
  });
  assert.equal(directRes.ok, false, 'Direct attack must be rejected while opponent controls a monster in EMZ');
  assert.equal(engine.state.players[1].lp, 8000, 'Opponent LP must not decrease on blocked direct attack');
});

// ============================================================================
// 5. BATTLE & DAMAGE RULES
// ============================================================================
function setupBattle(atkMonStats, defMonStats, defPos = POSITIONS.ATK) {
  const engine = createCleanDuel();
  const attacker = placeMonsterOnField(engine, 0, makeVanillaMonsterDef('b_atk', 'Attacker', atkMonStats), { slot: 0, position: POSITIONS.ATK });
  const defender = defMonStats
    ? placeMonsterOnField(engine, 1, makeVanillaMonsterDef('b_def', 'Defender', defMonStats), { slot: 0, position: defPos })
    : null;
  advanceToTurn(engine, 3);
  assert.equal(engine.executeAction(0, { type: 'CHANGE_PHASE', targetPhase: PHASES.BP }).ok, true);
  return { engine, attacker, defender };
}

await runTest('5. Battle & Damage', 'ATK > ATK: destroys weaker monster, inflicts difference to opponent LP', () => {
  const { engine, attacker, defender } = setupBattle({ atk: 2500 }, { atk: 1500 }, POSITIONS.ATK);
  const res = engine.executeAction(0, { type: 'DECLARE_ATTACK', attackerInstanceId: attacker.instanceId, targetInstanceId: defender.instanceId });
  assert.equal(res.ok, true);
  assert.equal(engine.state.players[1].mmz[0], null, 'Weaker defender must be destroyed');
  assert.ok(engine.state.players[1].gy.some(c => c.instanceId === defender.instanceId), 'Destroyed defender must be in GY');
  assert.equal(engine.state.players[0].mmz[0]?.instanceId, attacker.instanceId, 'Attacker must survive');
  assert.equal(engine.state.players[1].lp, 7000, 'Opponent must take 2500 - 1500 = 1000 LP damage');
  assert.equal(engine.state.players[0].lp, 8000, 'Attacker controller takes 0 LP damage');
});

await runTest('5. Battle & Damage', 'ATK == ATK (both > 0): destroys BOTH monsters, 0 battle damage', () => {
  const { engine, attacker, defender } = setupBattle({ atk: 2000 }, { atk: 2000 }, POSITIONS.ATK);
  const res = engine.executeAction(0, { type: 'DECLARE_ATTACK', attackerInstanceId: attacker.instanceId, targetInstanceId: defender.instanceId });
  assert.equal(res.ok, true);
  assert.equal(engine.state.players[0].mmz[0], null, 'Attacker must be destroyed');
  assert.equal(engine.state.players[1].mmz[0], null, 'Defender must be destroyed');
  assert.ok(engine.state.players[0].gy.some(c => c.instanceId === attacker.instanceId));
  assert.ok(engine.state.players[1].gy.some(c => c.instanceId === defender.instanceId));
  assert.equal(engine.state.players[0].lp, 8000, '0 battle damage to P0');
  assert.equal(engine.state.players[1].lp, 8000, '0 battle damage to P1');
});

await runTest('5. Battle & Damage', '0 ATK vs 0 ATK: NEITHER monster is destroyed, 0 battle damage', () => {
  const { engine, attacker, defender } = setupBattle({ atk: 0 }, { atk: 0 }, POSITIONS.ATK);
  const res = engine.executeAction(0, { type: 'DECLARE_ATTACK', attackerInstanceId: attacker.instanceId, targetInstanceId: defender.instanceId });
  assert.equal(res.ok, true);
  assert.equal(engine.state.players[0].mmz[0]?.instanceId, attacker.instanceId, '0 ATK attacker must NOT be destroyed');
  assert.equal(engine.state.players[1].mmz[0]?.instanceId, defender.instanceId, '0 ATK defender must NOT be destroyed');
  assert.equal(engine.state.players[0].lp, 8000);
  assert.equal(engine.state.players[1].lp, 8000);
});

await runTest('5. Battle & Damage', 'ATK > DEF: destroys defender, 0 battle damage (non-piercing)', () => {
  const { engine, attacker, defender } = setupBattle({ atk: 2500 }, { atk: 1000, def: 1800 }, POSITIONS.DEF);
  const res = engine.executeAction(0, { type: 'DECLARE_ATTACK', attackerInstanceId: attacker.instanceId, targetInstanceId: defender.instanceId });
  assert.equal(res.ok, true);
  assert.equal(engine.state.players[1].mmz[0], null, 'Defender with lower DEF must be destroyed');
  assert.equal(engine.state.players[0].mmz[0]?.instanceId, attacker.instanceId, 'Attacker survives');
  assert.equal(engine.state.players[0].lp, 8000);
  assert.equal(engine.state.players[1].lp, 8000, 'Non-piercing ATK > DEF must inflict 0 battle damage');
});

await runTest('5. Battle & Damage', 'ATK == DEF: neither monster destroyed, 0 battle damage', () => {
  const { engine, attacker, defender } = setupBattle({ atk: 2000 }, { atk: 1000, def: 2000 }, POSITIONS.DEF);
  const res = engine.executeAction(0, { type: 'DECLARE_ATTACK', attackerInstanceId: attacker.instanceId, targetInstanceId: defender.instanceId });
  assert.equal(res.ok, true);
  assert.equal(engine.state.players[0].mmz[0]?.instanceId, attacker.instanceId, 'Attacker survives');
  assert.equal(engine.state.players[1].mmz[0]?.instanceId, defender.instanceId, 'Defender survives');
  assert.equal(engine.state.players[0].lp, 8000);
  assert.equal(engine.state.players[1].lp, 8000);
});

await runTest('5. Battle & Damage', 'ATK < DEF: neither destroyed, attacker controller takes DEF - ATK damage', () => {
  const { engine, attacker, defender } = setupBattle({ atk: 1500 }, { atk: 1000, def: 2200 }, POSITIONS.DEF);
  const res = engine.executeAction(0, { type: 'DECLARE_ATTACK', attackerInstanceId: attacker.instanceId, targetInstanceId: defender.instanceId });
  assert.equal(res.ok, true);
  assert.equal(engine.state.players[0].mmz[0]?.instanceId, attacker.instanceId, 'Attacker must NOT be destroyed');
  assert.equal(engine.state.players[1].mmz[0]?.instanceId, defender.instanceId, 'Defender must NOT be destroyed');
  assert.equal(engine.state.players[0].lp, 7300, 'Attacker controller must take 2200 - 1500 = 700 battle damage');
  assert.equal(engine.state.players[1].lp, 8000);
});

await runTest('5. Battle & Damage', 'Direct attack with 0 opponent monsters (MMZ + EMZ): full ATK damage', () => {
  const { engine, attacker } = setupBattle({ atk: 2400 }, null);
  const res = engine.executeAction(0, { type: 'DECLARE_ATTACK', attackerInstanceId: attacker.instanceId, directAttack: true });
  assert.equal(res.ok, true);
  assert.equal(engine.state.players[1].lp, 5600, 'Direct attack must inflict full 2400 ATK damage (8000 -> 5600)');
});

await runTest('5. Battle & Damage', 'Attacking a face-down DEF monster flips it face-up DEF for damage calc', () => {
  const { engine, attacker, defender } = setupBattle({ atk: 1500 }, { atk: 500, def: 2000 }, POSITIONS.SET_DEF);
  assert.equal(defender.position, POSITIONS.SET_DEF);

  const res = engine.executeAction(0, { type: 'DECLARE_ATTACK', attackerInstanceId: attacker.instanceId, targetInstanceId: defender.instanceId });
  assert.equal(res.ok, true);
  assert.equal(defender.position, POSITIONS.DEF, 'Face-down DEF monster must be flipped to face-up DEF');
  assert.equal(engine.state.players[0].lp, 7500, 'Damage calc must use flipped defender DEF (2000 - 1500 = 500 to attacker)');
});

// ============================================================================
// 6. SPELL & TRAP RULES
// ============================================================================
await runTest('6. Spell & Trap Rules', 'Normal Spell Set face-down CAN be activated during Main Phase of the SAME turn', () => {
  const engine = createCleanDuel();
  const spell = engine.createCardInstance(makeSpellDef('norm_spell_set', 'Normal Spell', SPELL_SUBTYPES.NORMAL), 0, 'HAND');
  engine.state.players[0].hand = [spell];

  assert.equal(engine.executeAction(0, { type: 'SET_SPELL_TRAP', instanceId: spell.instanceId }).ok, true);
  assert.equal(spell.position, POSITIONS.SET);

  const legal = engine.getLegalActions(0);
  assert.ok((legal.fieldActions[spell.instanceId] || []).some(a => a.type === 'ACTIVATE_EFFECT'), 'Set Normal Spell must be activatable same turn in Main Phase');

  const actRes = engine.executeAction(0, { type: 'ACTIVATE_EFFECT', instanceId: spell.instanceId, effectId: 'norm_spell_set_eff' });
  assert.equal(actRes.ok, true, 'Activating a Normal Spell Set on the same turn must succeed');
  assert.equal(engine.state.players[0].lp, 8100, 'Effect should have resolved');
});

await runTest('6. Spell & Trap Rules', 'Quick-Play Spell Set face-down CANNOT be activated same turn, CAN be activated next turn', () => {
  const engine = createCleanDuel();
  const qp = engine.createCardInstance(makeSpellDef('qp_spell_set', 'Quick-Play Spell', SPELL_SUBTYPES.QUICK_PLAY), 0, 'HAND');
  engine.state.players[0].hand = [qp];

  assert.equal(engine.executeAction(0, { type: 'SET_SPELL_TRAP', instanceId: qp.instanceId }).ok, true);
  assert.equal(qp.position, POSITIONS.SET);

  // Same turn (Turn 1): must NOT be activatable
  const legalT1 = engine.getLegalActions(0);
  assert.equal((legalT1.fieldActions[qp.instanceId] || []).some(a => a.type === 'ACTIVATE_EFFECT'), false, 'Set Quick-Play must not be in legalActions same turn');
  const actT1 = engine.executeAction(0, { type: 'ACTIVATE_EFFECT', instanceId: qp.instanceId, effectId: 'qp_spell_set_eff' });
  assert.equal(actT1.ok, false, 'Set Quick-Play Spell must NOT be activatable on the same turn it was Set');

  // Next turn (Turn 2): CAN be activated (as a chainable SS2 card on Turn 2, or directly on P0's next turn Turn 3)
  advanceToTurn(engine, 2);
  const chainableT2 = engine.getChainableEffectsForPlayer(0);
  assert.ok(chainableT2.some(c => c.instanceId === qp.instanceId), 'Set Quick-Play Spell must be activatable/chainable on the next turn (Turn 2)');

  advanceToTurn(engine, 3);
  const actT3 = engine.executeAction(0, { type: 'ACTIVATE_EFFECT', instanceId: qp.instanceId, effectId: 'qp_spell_set_eff' });
  assert.equal(actT3.ok, true, 'Set Quick-Play Spell must be activatable on a subsequent turn');
});

await runTest('6. Spell & Trap Rules', 'Normal Trap Set face-down CANNOT be activated same turn, CAN be activated next turn', () => {
  const engine = createCleanDuel();
  const trap = engine.createCardInstance(makeTrapDef('norm_trap_set', 'Normal Trap', TRAP_SUBTYPES.NORMAL), 0, 'HAND');
  engine.state.players[0].hand = [trap];

  assert.equal(engine.executeAction(0, { type: 'SET_SPELL_TRAP', instanceId: trap.instanceId }).ok, true);
  assert.equal(trap.position, POSITIONS.SET);

  // Same turn (Turn 1): must NOT be activatable
  const legalT1 = engine.getLegalActions(0);
  assert.equal((legalT1.fieldActions[trap.instanceId] || []).some(a => a.type === 'ACTIVATE_EFFECT'), false, 'Set Normal Trap must not be in legalActions same turn');
  const actT1 = engine.executeAction(0, { type: 'ACTIVATE_EFFECT', instanceId: trap.instanceId, effectId: 'norm_trap_set_eff' });
  assert.equal(actT1.ok, false, 'Set Normal Trap must NOT be activatable on the same turn it was Set');

  // Next turn (Turn 2): CAN be activated
  advanceToTurn(engine, 2);
  const chainableT2 = engine.getChainableEffectsForPlayer(0);
  assert.ok(chainableT2.some(c => c.instanceId === trap.instanceId), 'Set Normal Trap must be activatable/chainable on the next turn (Turn 2)');

  advanceToTurn(engine, 3);
  const actT3 = engine.executeAction(0, { type: 'ACTIVATE_EFFECT', instanceId: trap.instanceId, effectId: 'norm_trap_set_eff' });
  assert.equal(actT3.ok, true, 'Set Normal Trap must be activatable on a subsequent turn');
});

await runTest('6. Spell & Trap Rules', 'Field Spell goes into Field Zone (not STZ); new Field Spell sends old one to GY', () => {
  const engine = createCleanDuel();
  const p0 = engine.state.players[0];
  const field1 = engine.createCardInstance(makeSpellDef('field_1', 'Field One', SPELL_SUBTYPES.FIELD), 0, 'HAND');
  const field2 = engine.createCardInstance(makeSpellDef('field_2', 'Field Two', SPELL_SUBTYPES.FIELD), 0, 'HAND');
  p0.hand = [field1, field2];

  assert.equal(engine.executeAction(0, { type: 'ACTIVATE_EFFECT', instanceId: field1.instanceId, effectId: 'field_1_eff' }).ok, true);
  assert.equal(p0.fieldSpell?.instanceId, field1.instanceId, 'First Field Spell must be in fieldSpell zone');
  assert.equal(field1.zone, 'FIELD', 'First Field Spell zone must be FIELD');
  assert.equal(p0.stz.every(z => z === null), true, 'Field Spell must NOT occupy STZ');

  assert.equal(engine.executeAction(0, { type: 'ACTIVATE_EFFECT', instanceId: field2.instanceId, effectId: 'field_2_eff' }).ok, true);
  assert.equal(p0.fieldSpell?.instanceId, field2.instanceId, 'Second Field Spell must replace fieldSpell');
  assert.ok(p0.gy.some(c => c.instanceId === field1.instanceId), 'Old Field Spell must be sent to GY');
  assert.equal(p0.stz.every(z => z === null), true, 'STZ must remain empty');
});

// ============================================================================
// 7. SPELL SPEED & CHAIN RULES
// ============================================================================
await runTest('7. Spell Speed & Chain', 'SS1 cannot respond to SS1, SS2, or SS3', () => {
  const engine = createCleanDuel();
  const p0 = engine.state.players[0];
  const p1 = engine.state.players[1];

  // Give P1 an SS1 Normal Spell in hand and an SS1 Ignition monster on field
  const p1SS1Spell = engine.createCardInstance(makeSpellDef('p1_ss1', 'P1 Normal Spell', SPELL_SUBTYPES.NORMAL), 1, 'HAND');
  const p1IgnMon = placeMonsterOnField(engine, 1, {
    ...makeVanillaMonsterDef('p1_ign', 'P1 Ignition', { frame: MONSTER_FRAMES.EFFECT }),
    effects: [{
      id: 'p1_ign_eff',
      trigger: TRIGGERS.IGNITION,
      spellSpeed: SPELL_SPEED.SS1,
      labelTh: 'Ignition Gain',
      actions: [{ type: ACTION_TYPES.GAIN_LP, amount: 100 }]
    }]
  }, { slot: 0 });
  p1.hand = [p1SS1Spell];

  // Check against SS1, SS2, and SS3 on chainStack
  for (const speed of [SPELL_SPEED.SS1, SPELL_SPEED.SS2, SPELL_SPEED.SS3]) {
    engine.state.chainStack = [{
      chainLink: 1,
      playerIndex: 0,
      card: engine.createCardInstance(makeSpellDef(`dummy_${speed}`, 'Dummy', SPELL_SUBTYPES.NORMAL), 0, 'STZ'),
      effect: { id: 'dummy', spellSpeed: speed, actions: [] },
      spellSpeed: speed
    }];
    const respondable = engine.getChainableEffectsForPlayer(1);
    assert.equal(respondable.some(r => r.instanceId === p1SS1Spell.instanceId), false, `SS1 Spell must NOT respond to SS${speed}`);
    assert.equal(respondable.some(r => r.instanceId === p1IgnMon.instanceId), false, `SS1 Ignition must NOT respond to SS${speed}`);
  }
});

await runTest('7. Spell Speed & Chain', 'SS2 can respond to SS1/SS2, CANNOT respond to SS3 (Counter Trap)', () => {
  const engine = createCleanDuel();
  const p1 = engine.state.players[1];
  const p1TrapSS2 = engine.createCardInstance(makeTrapDef('p1_ss2_trap', 'SS2 Trap', TRAP_SUBTYPES.NORMAL), 1, 'STZ');
  p1TrapSS2.position = POSITIONS.SET;
  p1TrapSS2.setTurn = 1;
  p1TrapSS2.zoneIndex = 0;
  p1.stz[0] = p1TrapSS2;

  advanceToTurn(engine, 3); // Turn 3 so Set Trap is live

  // Against SS1 -> SS2 CAN respond
  engine.state.chainStack = [{ chainLink: 1, playerIndex: 0, card: { nameTh: 'SS1' }, effect: { spellSpeed: SPELL_SPEED.SS1 }, spellSpeed: SPELL_SPEED.SS1 }];
  assert.equal(engine.getChainableEffectsForPlayer(1).some(r => r.instanceId === p1TrapSS2.instanceId), true, 'SS2 must be able to respond to SS1');

  // Against SS2 -> SS2 CAN respond
  engine.state.chainStack = [{ chainLink: 1, playerIndex: 0, card: { nameTh: 'SS2' }, effect: { spellSpeed: SPELL_SPEED.SS2 }, spellSpeed: SPELL_SPEED.SS2 }];
  assert.equal(engine.getChainableEffectsForPlayer(1).some(r => r.instanceId === p1TrapSS2.instanceId), true, 'SS2 must be able to respond to SS2');

  // Against SS3 (Counter Trap) -> SS2 CANNOT respond
  engine.state.chainStack = [{ chainLink: 1, playerIndex: 0, card: { nameTh: 'SS3' }, effect: { spellSpeed: SPELL_SPEED.SS3 }, spellSpeed: SPELL_SPEED.SS3 }];
  assert.equal(engine.getChainableEffectsForPlayer(1).some(r => r.instanceId === p1TrapSS2.instanceId), false, 'SS2 must NOT be able to respond to SS3 (Counter Trap)');
});

await runTest('7. Spell Speed & Chain', 'SS3 (Counter Trap) can respond to SS1, SS2, and SS3', () => {
  const engine = createCleanDuel();
  const p1 = engine.state.players[1];
  const p1CounterSS3 = engine.createCardInstance(makeTrapDef('p1_ss3_counter', 'SS3 Counter Trap', TRAP_SUBTYPES.COUNTER), 1, 'STZ');
  p1CounterSS3.position = POSITIONS.SET;
  p1CounterSS3.setTurn = 1;
  p1CounterSS3.zoneIndex = 0;
  p1.stz[0] = p1CounterSS3;

  advanceToTurn(engine, 3);

  for (const speed of [SPELL_SPEED.SS1, SPELL_SPEED.SS2, SPELL_SPEED.SS3]) {
    engine.state.chainStack = [{ chainLink: 1, playerIndex: 0, card: { nameTh: `SS${speed}` }, effect: { spellSpeed: speed }, spellSpeed: speed }];
    assert.equal(
      engine.getChainableEffectsForPlayer(1).some(r => r.instanceId === p1CounterSS3.instanceId),
      true,
      `SS3 Counter Trap must be able to respond to SS${speed}`
    );
  }
});

await runTest('7. Spell Speed & Chain', 'Chain resolves in LIFO order (CL3 -> CL2 -> CL1)', () => {
  const engine = createCleanDuel();
  const p0 = engine.state.players[0];
  const p1 = engine.state.players[1];

  // CL1 (P0 Normal Spell, SS1): Gain 500 LP
  const cl1Card = engine.createCardInstance(makeSpellDef('lifo_cl1', 'CL1 Spell', SPELL_SUBTYPES.NORMAL, {
    effects: [{
      id: 'lifo_cl1_eff',
      trigger: TRIGGERS.SPELL_ACTIVATE,
      spellSpeed: SPELL_SPEED.SS1,
      labelTh: 'CL1 Gain 500',
      actions: [{ type: ACTION_TYPES.GAIN_LP, amount: 500 }]
    }]
  }), 0, 'HAND');
  p0.hand = [cl1Card];

  // CL2 (P1 Set Normal Trap, SS2): Negate activation of CL1
  const cl2Card = engine.createCardInstance(makeTrapDef('lifo_cl2', 'CL2 Trap', TRAP_SUBTYPES.NORMAL, {
    effects: [{
      id: 'lifo_cl2_eff',
      trigger: TRIGGERS.SPELL_ACTIVATE,
      spellSpeed: SPELL_SPEED.SS2,
      labelTh: 'CL2 Negate',
      actions: [{ type: ACTION_TYPES.NEGATE_ACTIVATION }]
    }]
  }), 1, 'STZ');
  cl2Card.position = POSITIONS.SET;
  cl2Card.setTurn = 1;
  cl2Card.zoneIndex = 0;
  p1.stz[0] = cl2Card;

  // CL3 (P0 Set Counter Trap, SS3): Negate activation of CL2
  const cl3Card = engine.createCardInstance(makeTrapDef('lifo_cl3', 'CL3 Counter', TRAP_SUBTYPES.COUNTER, {
    effects: [{
      id: 'lifo_cl3_eff',
      trigger: TRIGGERS.COUNTER_TRAP,
      spellSpeed: SPELL_SPEED.SS3,
      labelTh: 'CL3 Counter Negate',
      actions: [{ type: ACTION_TYPES.NEGATE_ACTIVATION }]
    }]
  }), 0, 'STZ');
  cl3Card.position = POSITIONS.SET;
  cl3Card.setTurn = 1;
  cl3Card.zoneIndex = 0;
  p0.stz[0] = cl3Card;

  advanceToTurn(engine, 3);
  p0.hand = [cl1Card];
  p1.hand = [];

  const r1 = engine.executeAction(0, { type: 'ACTIVATE_EFFECT', instanceId: cl1Card.instanceId, effectId: 'lifo_cl1_eff' });
  assert.equal(r1.ok, true);
  assert.equal(r1.pendingChain, true, 'CL1 should prompt P1 for CL2');

  const r2 = engine.executeAction(1, { type: 'CHAIN_RESPONSE', respond: true, instanceId: cl2Card.instanceId, effectId: 'lifo_cl2_eff' });
  assert.equal(r2.ok, true);
  assert.equal(r2.pendingChain, true, 'CL2 should prompt P0 for CL3 Counter Trap');

  const logStart = engine.state.logs.length;
  const r3 = engine.executeAction(0, { type: 'CHAIN_RESPONSE', respond: true, instanceId: cl3Card.instanceId, effectId: 'lifo_cl3_eff' });
  assert.equal(r3.ok, true);

  // Verify LIFO resolution logs: CL3 resolves before CL2, CL2 before CL1
  const resolveLogs = engine.state.logs.slice(logStart).filter(l => l.text.includes('คลี่คลาย [Chain Link'));
  assert.equal(resolveLogs.length, 3, 'All 3 chain links should resolve');
  assert.ok(resolveLogs[0].text.includes('Chain Link 3'), `Expected CL3 first, got: ${resolveLogs[0].text}`);
  assert.ok(resolveLogs[1].text.includes('Chain Link 2'), `Expected CL2 second, got: ${resolveLogs[1].text}`);
  assert.ok(resolveLogs[2].text.includes('Chain Link 1'), `Expected CL1 third, got: ${resolveLogs[2].text}`);

  // Because CL3 negated CL2 in LIFO order, CL1 must NOT be negated -> P0 gains 500 LP (8000 -> 8500)
  assert.equal(p0.lp, 8500, 'CL3 negated CL2 in LIFO order so CL1 must resolve and grant +500 LP');
});

// ============================================================================
// 8. XYZ MATERIALS, TOKENS, END PHASE & VICTORY CONDITIONS
// ============================================================================
await runTest('8. Xyz, Tokens, EP & Victory', 'Tokens cannot be used as Xyz Material', () => {
  const engine = createCleanDuel();
  const p0 = engine.state.players[0];
  const rank4Xyz = engine.createCardInstance(makeVanillaMonsterDef('test_r4_xyz', 'Rank 4 Xyz', { frame: MONSTER_FRAMES.XYZ, rank: 4, atk: 2400 }), 0, 'EXTRA');
  p0.extra = [rank4Xyz];

  // Case A: 2 Level 4 Tokens on field
  const tok1 = engine.spawnToken(0, makeTokenDef('tok_1', 'Token 1', { level: 4 }));
  const tok2 = engine.spawnToken(0, makeTokenDef('tok_2', 'Token 2', { level: 4 }));
  assert.ok(tok1 && tok2);
  let check = SummonManager.getExtraDeckSummonCombinations(engine, 0, rank4Xyz);
  assert.equal(check.canSummon, false, '2 Tokens must NOT be usable as Xyz Material');

  // Case B: 1 Real Lv.4 + 1 Lv.4 Token on field
  engine.removeFromCurrentZone(tok2.instanceId);
  placeMonsterOnField(engine, 0, makeVanillaMonsterDef('real_lv4', 'Real Lv4', { level: 4 }), { slot: 1 });
  check = SummonManager.getExtraDeckSummonCombinations(engine, 0, rank4Xyz);
  assert.equal(check.canSummon, false, '1 Real Monster + 1 Token must NOT be usable as Xyz Material');
});

await runTest('8. Xyz, Tokens, EP & Victory', 'When destroyed or removed from field, Tokens do NOT go to GY', () => {
  const engine = createCleanDuel();
  const p0 = engine.state.players[0];
  const tok = engine.spawnToken(0, makeTokenDef('tok_destroy', 'Doomed Token', { level: 4 }));
  assert.ok(tok);

  engine.destroyCard(0, tok.instanceId, 'BATTLE');
  assert.equal(p0.mmz[tok.zoneIndex], null, 'Token must be removed from field');
  assert.equal(p0.gy.some(c => c.instanceId === tok.instanceId), false, 'Destroyed Token must NOT go to GY');
  assert.equal(p0.banished.some(c => c.instanceId === tok.instanceId), false, 'Destroyed Token must NOT go to Banished');
});

await runTest('8. Xyz, Tokens, EP & Victory', 'Xyz Monster leaving field sends attached Xyz Materials to GY', () => {
  const engine = createCleanDuel();
  const p0 = engine.state.players[0];
  const mat1 = placeMonsterOnField(engine, 0, makeVanillaMonsterDef('xyz_mat1', 'Mat 1', { level: 4 }), { slot: 0 });
  const mat2 = placeMonsterOnField(engine, 0, makeVanillaMonsterDef('xyz_mat2', 'Mat 2', { level: 4 }), { slot: 1 });
  const rank4 = engine.createCardInstance(makeVanillaMonsterDef('xyz_boss', 'Rank 4 Boss', { frame: MONSTER_FRAMES.XYZ, rank: 4, atk: 2500 }), 0, 'EXTRA');
  p0.extra = [rank4];

  const xyzRes = engine.executeAction(0, { type: 'EXTRA_DECK_SUMMON', instanceId: rank4.instanceId, combinationIndex: 0 });
  assert.equal(xyzRes.ok, true, 'Xyz Summon should succeed');
  assert.equal(rank4.overlayUnits.length, 2, 'Xyz Monster should have 2 attached Xyz Materials');

  // Destroy the Xyz Monster -> materials must go to GY
  engine.destroyCard(0, rank4.instanceId, 'EFFECT');
  assert.ok(p0.gy.some(c => c.instanceId === mat1.instanceId), 'Attached Xyz Material 1 must be sent to GY');
  assert.ok(p0.gy.some(c => c.instanceId === mat2.instanceId), 'Attached Xyz Material 2 must be sent to GY');
  assert.equal(rank4.overlayUnits.length, 0, 'Xyz Monster overlayUnits should be empty after leaving field');
});

await runTest('8. Xyz, Tokens, EP & Victory', 'End Phase hand size limit: >6 cards forces discard down to 6', () => {
  const engine = createCleanDuel();
  const p0 = engine.state.players[0];
  p0.hand = Array.from({ length: 8 }, (_, i) =>
    engine.createCardInstance(makeVanillaMonsterDef(`hand_lim_${i}`, `Card ${i}`, { level: 4 }), 0, 'HAND')
  );
  assert.equal(p0.hand.length, 8);

  const epRes = engine.executeAction(0, { type: 'CHANGE_PHASE', targetPhase: PHASES.EP });
  assert.equal(epRes.ok, true);
  assert.equal(p0.hand.length, 6, 'Turn player hand must be reduced to 6 cards at End Phase');
  assert.equal(p0.gy.length, 2, 'The 2 excess cards must be sent to GY');
});

await runTest('8. Xyz, Tokens, EP & Victory', 'Victory when LP hits 0', () => {
  const { engine, attacker } = setupBattle({ atk: 3000 }, null);
  engine.state.players[1].lp = 2500;

  const res = engine.executeAction(0, { type: 'DECLARE_ATTACK', attackerInstanceId: attacker.instanceId, directAttack: true });
  assert.equal(res.ok, true);
  assert.equal(engine.state.players[1].lp, 0, 'Opponent LP should hit 0');
  assert.equal(engine.state.winner, 0, 'Player 0 must be declared winner when Player 1 LP hits 0');
});

await runTest('8. Xyz, Tokens, EP & Victory', 'Victory when unable to draw from empty Deck (Deck Out)', () => {
  const engine = createCleanDuel();
  // Empty P1's deck so P1 loses on Turn 2 Draw Phase
  engine.state.players[1].deck = [];

  const res = engine.executeAction(0, { type: 'CHANGE_PHASE', targetPhase: PHASES.EP });
  assert.equal(res.ok, true);
  assert.equal(engine.state.winner, 0, 'Player 0 must win by Deck Out when Player 1 cannot draw in Draw Phase');
});

// ============================================================================
// 9. YGOPROENGINE (ocgcore-wasm) SMOKE VERIFICATION
// ============================================================================
await runTest('9. YGOProEngine (ocgcore-wasm)', 'Starts duel with Turn 1 no-draw/no-BP, 8000 LP, 5-card hand, and legal actions', async () => {
  const core = await getSharedOcgCore();
  const d1 = getPresetDeckById('blue_eyes_meta');
  const d2 = getPresetDeckById('swordsoul_tenyi');
  const deck1 = [...expandDeckRecipe(d1.mainDeckRecipe), ...expandDeckRecipe(d1.extraDeckRecipe)];
  const deck2 = [...expandDeckRecipe(d2.mainDeckRecipe), ...expandDeckRecipe(d2.extraDeckRecipe)];

  const engine = new YGOProEngine({
    core,
    player1Name: 'P1 Tester',
    player2Name: 'P2 Tester',
    deck1Cards: deck1,
    deck2Cards: deck2,
    isSoloVsAi: false
  });

  try {
    assert.equal(engine.state.turnCount, 1, 'YGOProEngine must start on Turn 1');
    for (let guard = 0; guard < 10 && engine.state.phase !== PHASES.MP1 && engine.state.pendingChainPrompt; guard++) {
      const resp = engine.state.pendingChainPrompt.responderIndex;
      engine.dispatchAction(resp, { type: 'CHAIN_RESPONSE', respond: false });
    }
    assert.equal(engine.state.phase, PHASES.MP1, 'YGOProEngine Turn 1 should advance to MP1');
    assert.equal(engine.state.players[0].lp, 8000, 'P0 LP must be 8000');
    assert.equal(engine.state.players[1].lp, 8000, 'P1 LP must be 8000');
    assert.equal(engine.state.players[0].hand.length, 5, 'Turn 1 player must have 5 cards (no Turn 1 draw)');
    assert.equal(engine.state.players[1].hand.length, 5, 'Turn 2 player must have 5 cards');

    const legalT1 = engine.getLegalActions(0);
    assert.equal(legalT1.canBattlePhase, false, 'Turn 1 must NOT allow entering Battle Phase');
    assert.equal(legalT1.canEndTurn, true, 'Turn 1 must allow ending turn');

    // End Turn 1 -> Turn 2 player draws to 6 cards and can enter Battle Phase
    const endRes = engine.dispatchAction(0, { type: 'END_TURN' });
    assert.equal(endRes.ok, true, 'END_TURN on Turn 1 should succeed');
    // Pass any optional End Phase / Draw Phase chain prompts (e.g., Quick Effects in shuffled hand)
    for (let guard = 0; guard < 10 && engine.state.pendingChainPrompt; guard++) {
      const resp = engine.state.pendingChainPrompt.responderIndex;
      engine.dispatchAction(resp, { type: 'CHAIN_RESPONSE', respond: false });
    }
    assert.equal(engine.state.turnCount, 2, 'Should advance to Turn 2');
    assert.equal(engine.state.turnPlayer, 1, 'Turn 2 player should be P1');
    assert.equal(engine.state.players[1].hand.length, 6, 'Turn 2 player must draw to 6 cards');

    const legalT2 = engine.getLegalActions(1);
    assert.equal(legalT2.canBattlePhase, true, 'Turn 2 player must be allowed to enter Battle Phase');
  } finally {
    engine.destroy();
  }
});

await runTest('9. YGOProEngine (ocgcore-wasm)', 'Field Spell activates into fieldSpell zone (not stz)', async () => {
  const core = await getSharedOcgCore();
  // Use 40 copies of Sky Striker Airspace - Area Zero (passcode 50005218) so Turn 1 hand is guaranteed to contain a Field Spell
  const areaZeroPasscode = Number(getCardById('sky_striker_airspace_area_zero')?.passcode || 50005218);
  const fillerPasscode = Number(getCardById('blue_eyes_white_dragon')?.passcode || 89631139);
  const fieldDeck = Array.from({ length: 40 }, () => areaZeroPasscode);
  const oppDeck = Array.from({ length: 40 }, () => fillerPasscode);

  const engine = new YGOProEngine({
    core,
    player1Name: 'Field Tester',
    player2Name: 'Opp Tester',
    deck1Cards: fieldDeck,
    deck2Cards: oppDeck,
    isSoloVsAi: false
  });

  try {
    const legal = engine.getLegalActions(0);
    const p0Hand = engine.state.players[0].hand;
    assert.equal(p0Hand.length, 5, 'Should start with 5 Field Spells in hand');

    const cardToActivate = p0Hand.find(c => (legal.handActions[c.instanceId] || []).some(a => a.type === 'ACTIVATE_EFFECT'));
    assert.ok(cardToActivate, 'Field Spell in hand must have an ACTIVATE_EFFECT legal action');

    const actAction = legal.handActions[cardToActivate.instanceId].find(a => a.type === 'ACTIVATE_EFFECT');
    const actRes = engine.dispatchAction(0, {
      type: 'ACTIVATE_EFFECT',
      instanceId: cardToActivate.instanceId,
      ocgAction: actAction.ocgAction,
      ocgIndex: actAction.ocgIndex
    });
    assert.equal(actRes.ok, true, 'Activating Field Spell in YGOProEngine should succeed');

    // If opponent gets a chain prompt, pass it
    if (engine.state.pendingChainPrompt) {
      engine.dispatchAction(engine.state.pendingChainPrompt.responderIndex, { type: 'CHAIN_RESPONSE', respond: false });
    }

    assert.ok(engine.state.players[0].fieldSpell, 'Activated Field Spell must appear in players[0].fieldSpell');
    assert.equal(
      String(engine.state.players[0].fieldSpell.passcode),
      String(areaZeroPasscode),
      'fieldSpell must be the activated Field Spell'
    );
    assert.equal(
      engine.state.players[0].stz.every(slot => slot === null),
      true,
      'Field Spell must NOT be placed in stz[0..4]'
    );
  } finally {
    engine.destroy();
  }
});

// ============================================================================
// Summary Table
// ============================================================================
const passedCount = results.filter(r => r.passed).length;
const failedList = results.filter(r => !r.passed);

console.log('\n========================================================================');
console.log('📊 RULEBOOK V10 COMPLIANCE TEST SUMMARY');
console.log('========================================================================');
console.log(`Total Tests : ${results.length}`);
console.log(`Passed      : ${passedCount}`);
console.log(`Failed      : ${failedList.length}`);
console.log('------------------------------------------------------------------------');

const byCategory = new Map();
for (const r of results) {
  if (!byCategory.has(r.category)) byCategory.set(r.category, { pass: 0, fail: 0 });
  const entry = byCategory.get(r.category);
  if (r.passed) entry.pass++;
  else entry.fail++;
}
for (const [cat, counts] of byCategory.entries()) {
  const icon = counts.fail === 0 ? '✅' : '❌';
  console.log(`${icon} ${cat.padEnd(32)} | Pass: ${String(counts.pass).padStart(2)} | Fail: ${String(counts.fail).padStart(2)}`);
}

if (failedList.length > 0) {
  console.log('\n🚨 DISCOVERED RULEBOOK VIOLATIONS:');
  for (const f of failedList) {
    console.log(`  - [${f.category}] ${f.ruleName}: ${f.error}`);
  }
  console.log('========================================================================\n');
  process.exit(1);
} else {
  console.log('\n🎉 ALL OFFICIAL RULEBOOK VERSION 10 TESTS PASSED!');
  console.log('========================================================================\n');
  process.exit(0);
}
