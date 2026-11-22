import { getSharedOcgCore, YGOProEngine } from '../src/engine/YGOProEngine.js';
import { getPresetDeckById, expandDeckRecipe } from '../src/cards/index.js';

const core = await getSharedOcgCore();
const d1 = getPresetDeckById('blue_eyes_meta');
const d2 = getPresetDeckById('swordsoul_tenyi');
const deck1 = expandDeckRecipe(d1.mainDeckRecipe);
const extra1 = expandDeckRecipe(d1.extraDeckRecipe);
const deck2 = expandDeckRecipe(d2.mainDeckRecipe);
const extra2 = expandDeckRecipe(d2.extraDeckRecipe);

const engine = new YGOProEngine({
  core,
  player1Name: 'Tester',
  player2Name: 'YGOPro AI',
  deck1Cards: [...deck1, ...extra1],
  deck2Cards: [...deck2, ...extra2],
  isSoloVsAi: true,
  aiIndex: 1
});

console.log('Initial turn:', engine.state.turnCount, 'phase:', engine.state.phase);
console.log('P1 hand count:', engine.core.duelQueryCount(engine.handle, 0, 2));
console.log('P1 extra count:', engine.core.duelQueryCount(engine.handle, 0, 64));
for (let i = 0; i < 5; i++) {
  console.log('hand', i, engine.core.duelQuery(engine.handle, { controller: 0, location: 2, sequence: i, flags: 1, overlaySequence: 0 }));
}
for (let i = 0; i < 3; i++) {
  console.log('extra', i, engine.core.duelQuery(engine.handle, { controller: 0, location: 64, sequence: i, flags: 1, overlaySequence: 0 }));
}
console.log('P1 hand:', engine.state.players[0].hand.map(c => c.name));
console.log('P1 deck:', engine.state.players[0].deck.length, 'extra:', engine.state.players[0].extra.length);
const legal = engine.getLegalActions(0);
console.log('P1 legal handActions:', Object.keys(legal.handActions).length, 'canEndTurn:', legal.canEndTurn);

const res = engine.dispatchAction(0, { type: 'END_TURN' });
console.log('After END_TURN -> ok:', res.ok, 'turn:', engine.state.turnCount, 'phase:', engine.state.phase, 'turnPlayer:', engine.state.turnPlayerIndex, 'pending:', engine.pendingMessage?.type, 'pendingPlayer:', engine.pendingMessage?.player);
console.log('Logs tail:', engine.state.logs.slice(-6));
engine.destroy();
