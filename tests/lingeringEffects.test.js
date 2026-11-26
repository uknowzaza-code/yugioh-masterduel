import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PLAYER_HINT_DESC_ADD,
  PLAYER_HINT_DESC_REMOVE,
  decodeOcgHintDesc,
  createLingeringTracker,
  applyPlayerHint,
  applyCatalogResolution,
  advancePhase,
  toSnapshot,
  resetTracker
} from '../src/engine/lingeringEffects.js';
import { LINGERING_CATALOG } from '../src/engine/lingeringCatalog.js';
import { getUiCardMeta } from '../src/engine/OcgCardDb.js';
import { OcgMessageType } from 'ocgcore-wasm';
import { getSharedOcgCore, YGOProEngine } from '../src/engine/YGOProEngine.js';
import { DuelEngine } from '../src/engine/DuelEngine.js';
import { PRESET_DECKS, expandDeckRecipe } from '../src/cards/index.js';
import { I18N_STRINGS } from '../public/js/i18n.js';

test('decodeOcgHintDesc decodes packed ProjectIgnis aux.Stringid values', () => {
  const packed = (94145021n << 4n) | 2n;
  const res = decodeOcgHintDesc(packed);
  assert.equal(res.code, 94145021);
  assert.equal(res.descIndex, 2);
});

test('applyPlayerHint add followed by remove leaves empty list', () => {
  const tracker = createLingeringTracker();
  const desc = (94145021n << 4n) | 1n;
  applyPlayerHint(tracker, {
    player: 0,
    hintType: PLAYER_HINT_DESC_ADD,
    desc,
    turn: 1,
    resolveDesc: () => 'Cannot add cards from Deck to hand',
    getCardMeta: getUiCardMeta
  });
  assert.equal(toSnapshot(tracker, 0).length, 1);

  applyPlayerHint(tracker, {
    player: 0,
    hintType: PLAYER_HINT_DESC_REMOVE,
    desc,
    turn: 1
  });
  assert.equal(toSnapshot(tracker, 0).length, 0);
});

test('engine-hint and catalog duplicates collapse into a single enriched entry', () => {
  const tracker = createLingeringTracker();
  const desc = (44362883n << 4n) | 1n;
  applyCatalogResolution(tracker, {
    code: 44362883,
    player: 0,
    turn: 1,
    getCardMeta: getUiCardMeta
  });
  applyPlayerHint(tracker, {
    player: 0,
    hintType: PLAYER_HINT_DESC_ADD,
    desc,
    turn: 1,
    resolveDesc: () => 'Cannot Special Summon from Extra Deck, except Fusion Monsters',
    getCardMeta: getUiCardMeta
  });

  const snap = toSnapshot(tracker, 0);
  assert.equal(snap.length, 1);
  assert.equal(snap[0].badge.en, 'Fusion Lock');
  assert.equal(snap[0].origin, 'engine-hint');
  assert.match(snap[0].detail.en, /Fusion Monsters/);
});

test('expiry rules: endOfTurn expires on turn N+1, endOfNextTurn survives N+1 and expires on N+2', () => {
  const tracker = createLingeringTracker();
  // Turn 1: Droll (endOfTurn) and Dimension Shifter (endOfNextTurn)
  applyCatalogResolution(tracker, { code: 94145021, player: 0, turn: 1, getCardMeta: getUiCardMeta });
  applyCatalogResolution(tracker, { code: 91800273, player: 0, turn: 1, getCardMeta: getUiCardMeta });
  assert.equal(toSnapshot(tracker, 0).length, 2);

  // Advance to Turn 2: Droll expires, Dimension Shifter remains!
  advancePhase(tracker, { turn: 2, phase: 'DP', turnPlayer: 1 });
  const t2 = toSnapshot(tracker, 0);
  assert.equal(t2.length, 1);
  assert.equal(t2[0].code, 91800273);

  // Advance to Turn 3: Dimension Shifter expires!
  advancePhase(tracker, { turn: 3, phase: 'DP', turnPlayer: 0 });
  assert.equal(toSnapshot(tracker, 0).length, 0);
});

test('viewer-relative scope maps accurately for player 0, player 1, and both', () => {
  const tracker = createLingeringTracker();
  applyCatalogResolution(tracker, { code: 44362883, player: 0, turn: 1, getCardMeta: getUiCardMeta }); // self for p0
  applyCatalogResolution(tracker, { code: 94145021, player: 0, turn: 1, getCardMeta: getUiCardMeta }); // both

  const p0View = toSnapshot(tracker, 0);
  const p1View = toSnapshot(tracker, 1);

  assert.equal(p0View.find(e => e.code === 44362883).scope, 'self');
  assert.equal(p1View.find(e => e.code === 44362883).scope, 'opponent');
  assert.equal(p0View.find(e => e.code === 94145021).scope, 'both');
  assert.equal(p1View.find(e => e.code === 94145021).scope, 'both');

  resetTracker(tracker);
  assert.equal(toSnapshot(tracker, 0).length, 0);
});

test('every catalog entry resolves in cards.cdb and has non-empty EN and TH labels', () => {
  for (const [codeStr, entry] of Object.entries(LINGERING_CATALOG)) {
    const meta = getUiCardMeta(Number(codeStr));
    assert.ok(meta && meta.name, `Catalog card ${codeStr} must exist in cards.cdb`);
    assert.ok(entry.badge.en && entry.badge.th, `Missing badge for ${codeStr}`);
    assert.ok(entry.detail.en && entry.detail.th, `Missing detail for ${codeStr}`);
  }
  for (const lang of ['en', 'th']) {
    for (const k of ['lingeringTitle', 'lingeringScopeSelf', 'lingeringScopeOpp', 'lingeringScopeBoth', 'lingeringClose']) {
      assert.ok(I18N_STRINGS[lang][k]?.length > 0, `Missing i18n ${lang}.${k}`);
    }
  }
});

test('DuelEngine exposes lingeringEffects and resets cleanly on surrender', () => {
  const eng = new DuelEngine({ p0Name: 'P0', p1Name: 'P1' });
  assert.ok(Array.isArray(eng.state.lingeringEffects));
  eng.executeAction(0, { type: 'SURRENDER' });
  assert.deepEqual(eng.state.lingeringEffects, []);
});

test('Real YGOProEngine (ocgcore-wasm) tracks Branded Fusion / Maxx C / Droll lingering effects and expires on NEW_TURN', async () => {
  const core = await getSharedOcgCore();
  const brandedDeck = PRESET_DECKS.find(d => d.id === 'branded_despia') || PRESET_DECKS[0];
  const filler = expandDeckRecipe(brandedDeck.mainDeckRecipe || []);
  const extra = expandDeckRecipe(brandedDeck.extraDeckRecipe || []);

  // Deterministic deck starting with Branded Fusion (44362883) + Maxx "C" (23434538) + Dimension Shifter (91800273)
  const customMain = [
    44362883, 23434538, 91800273, 68468459, 89631139,
    ...filler.slice(0, 35)
  ];
  const engine = new YGOProEngine({
    core,
    player1Name: 'Tester',
    player2Name: 'Opp',
    deck1Cards: [...customMain, ...extra],
    deck2Cards: [...filler, ...extra],
    isSoloVsAi: false
  });

  assert.ok(Array.isArray(engine.state.lingeringEffects));
  // Verify JSON round-trip
  const roundTrip = JSON.parse(JSON.stringify(engine.state));
  assert.ok(Array.isArray(roundTrip.lingeringEffects));

  // Simulate chain solved without negation -> catalog tracks Branded Fusion lock & Dimension Shifter
  engine.chainStack.push({
    chainLink: 1,
    playerIndex: 0,
    card: { passcode: '44362883' },
    negated: false
  });
  engine._consumeMessages([{ type: OcgMessageType.CHAIN_SOLVED, chain_size: 1 }]);
  engine._syncStateFromCore();
  assert.ok(engine.state.lingeringEffects.some(e => e.code === 44362883 && e.badge.en === 'Fusion Lock'));

  // Negated chain must NOT add an effect
  engine.chainStack.push({
    chainLink: 1,
    playerIndex: 0,
    card: { passcode: '94145021' },
    negated: true
  });
  engine._consumeMessages([{ type: OcgMessageType.CHAIN_SOLVED, chain_size: 1 }]);
  engine._syncStateFromCore();
  assert.equal(engine.state.lingeringEffects.some(e => e.code === 94145021), false);

  // Advancing to Turn 2 clears Branded Fusion's endOfTurn lock
  engine.dispatchAction(0, { type: 'END_TURN' });
  assert.equal(engine.state.lingeringEffects.some(e => e.code === 44362883), false);

  engine.destroy();
});
