import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DuelEngine } from '../src/engine/DuelEngine.js';
import { getSharedOcgCore, YGOProEngine } from '../src/engine/YGOProEngine.js';
import { PRESET_DECKS, expandDeckRecipe } from '../src/cards/index.js';

function makeTestDecks() {
  return {
    p1: 'blue-eyes',
    p2: 'swordsoul-tenyi'
  };
}

function expandPresetDeck(id) {
  const deck = PRESET_DECKS.find(d => d.id === id) || PRESET_DECKS[0];
  return [...expandDeckRecipe(deck.mainDeckRecipe), ...expandDeckRecipe(deck.extraDeckRecipe)];
}

describe('DuelEngine SURRENDER', () => {
  test('Player 0 surrenders on own turn -> Player 1 wins immediately', () => {
    const decks = makeTestDecks();
    const engine = new DuelEngine('P1', 'P2', decks.p1, decks.p2);
    const res = engine.executeAction(0, { type: 'SURRENDER' });
    assert.equal(res.ok, true);
    assert.equal(engine.state.winner, 1);
    assert.equal(engine.state.winReason, 'surrender');
    assert.deepEqual(engine.state.chainStack, []);
    assert.equal(engine.state.pendingChainPrompt, null);
  });

  test('Player 1 surrenders during Player 0 turn -> Player 0 wins immediately', () => {
    const decks = makeTestDecks();
    const engine = new DuelEngine('P1', 'P2', decks.p1, decks.p2);
    engine.state.turnPlayer = 0;
    const res = engine.executeAction(1, { type: 'SURRENDER' });
    assert.equal(res.ok, true);
    assert.equal(engine.state.winner, 0);
    assert.equal(engine.state.winReason, 'surrender');
  });

  test('Rejects duplicate surrender and further actions after duel ends', () => {
    const decks = makeTestDecks();
    const engine = new DuelEngine('P1', 'P2', decks.p1, decks.p2);
    assert.equal(engine.executeAction(0, { type: 'SURRENDER' }).ok, true);

    const again = engine.executeAction(0, { type: 'SURRENDER' });
    assert.equal(again.ok, false);
    assert.equal(engine.state.winner, 1);

    const other = engine.executeAction(1, { type: 'SURRENDER' });
    assert.equal(other.ok, false);
    assert.equal(engine.state.winner, 1);
  });

  test('Rejects invalid player index', () => {
    const decks = makeTestDecks();
    const engine = new DuelEngine('P1', 'P2', decks.p1, decks.p2);
    assert.equal(engine.executeAction(-1, { type: 'SURRENDER' }).ok, false);
    assert.equal(engine.executeAction(2, { type: 'SURRENDER' }).ok, false);
    assert.equal(engine.state.winner, null);
  });
});

describe('YGOProEngine (ocgcore-wasm) SURRENDER', () => {
  test('Surrender works on own turn, clears pending prompt/chain, and blocks replay', async () => {
    const core = await getSharedOcgCore();
    const eng = new YGOProEngine({
      core,
      player1Name: 'Duelist 1',
      player2Name: 'Duelist 2',
      deck1Cards: expandPresetDeck('blue-eyes'),
      deck2Cards: expandPresetDeck('swordsoul-tenyi'),
      isSoloVsAi: false
    });
    try {
      const res = eng.dispatchAction(0, { type: 'SURRENDER' });
      assert.equal(res.ok, true);
      assert.equal(eng.state.winner, 1);
      assert.equal(eng.state.winReason, 'surrender');
      assert.equal(eng.state.pendingOcgPrompt, null);
      assert.equal(eng.state.pendingChainPrompt, null);
      assert.deepEqual(eng.state.chainStack, []);

      // Duplicate surrender or further moves rejected
      assert.equal(eng.dispatchAction(0, { type: 'SURRENDER' }).ok, false);
      assert.equal(eng.dispatchAction(1, { type: 'SURRENDER' }).ok, false);
      assert.equal(eng.dispatchAction(1, { type: 'END_TURN' }).ok, false);
      assert.equal(eng.state.winner, 1);
    } finally {
      eng.destroy();
    }
  });

  test('Allows surrender even during opponent turn / active opponent prompt', async () => {
    const core = await getSharedOcgCore();
    const eng = new YGOProEngine({
      core,
      player1Name: 'Alice',
      player2Name: 'Bob',
      deck1Cards: expandPresetDeck('blue-eyes'),
      deck2Cards: expandPresetDeck('swordsoul-tenyi'),
      isSoloVsAi: false
    });
    try {
      assert.ok(eng.pendingMessage);
      const actingPlayer = eng.pendingMessage.player;
      const surrenderingSeat = 1 - actingPlayer;

      const res = eng.dispatchAction(surrenderingSeat, { type: 'SURRENDER' });
      assert.equal(res.ok, true);
      assert.equal(eng.state.winner, actingPlayer);
      assert.equal(eng.state.winReason, 'surrender');
    } finally {
      eng.destroy();
    }
  });
});
