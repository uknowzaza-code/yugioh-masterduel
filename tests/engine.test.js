/**
 * @fileoverview Automated Test Suite for Yu-Gi-Oh! Master Duel Engine
 * ทดสอบกฎ Master Duel, ระบบ Chain, การอัญเชิญทุกประเภท (Normal, Tribute, Fusion, Synchro, Xyz, Link) และ AI Bot
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { WebSocket, WebSocketServer } from 'ws';
import { DuelEngine } from '../src/engine/DuelEngine.js';
import { EffectResolver } from '../src/engine/EffectResolver.js';
import { SummonManager } from '../src/engine/SummonManager.js';
import { AIPlayer } from '../src/engine/AIPlayer.js';
import { getCardById, PRESET_DECKS, expandDeckRecipe, getPresetDeckById, registerCustomDecks, CUSTOM_DECKS } from '../src/cards/index.js';
import { getSharedOcgCore, YGOProEngine } from '../src/engine/YGOProEngine.js';
import { RpsSession, resolveRpsRound } from '../src/engine/RpsSession.js';
import { MqttWssClient, CloudRelayPeerConnection, sliceUtf16Safe } from '../src/engine/CloudRelay.js';
import { buildYdkeUrl, parseYdkeUrl } from '../src/cards/ydke.js';
import { OcgMessageType, OcgResponseType, SelectIdleCMDAction } from 'ocgcore-wasm';
import { PHASES, POSITIONS } from '../src/constants/gameConstants.js';

console.log('🧪 เริ่มการทดสอบระบบ Yu-Gi-Oh! Master Duel Engine...\n');

// Test 1: Initialize all 55 preset decks (40-60 Main Deck + Extra Deck)
assert.equal(PRESET_DECKS.length, 55, 'Should contain 55 total decks (5 starters + 50 MDM Top Decks)');
for (const deck of PRESET_DECKS) {
  const expectedMain = deck.mainDeckRecipe.reduce((sum, item) => sum + item.count, 0);
  const expectedExtra = deck.extraDeckRecipe.reduce((sum, item) => sum + item.count, 0);
  const engine = new DuelEngine({ p0DeckId: deck.id, p1DeckId: 'blue_eyes_meta' });
  assert.equal(engine.state.players[0].lp, 8000);
  assert.equal(engine.state.players[0].hand.length, 5);
  assert.ok(expectedMain >= 40 && expectedMain <= 60, `${deck.id} main size ${expectedMain} must be 40-60`);
  assert.equal(engine.state.players[0].deck.length, expectedMain - 5);
  assert.equal(engine.state.players[0].extra.length, expectedExtra);
  assert.ok(engine.state.players[0].extra.length >= 8);
}
console.log(`✅ Test 1 Passed: โหลดเด็คทั้งหมด ${PRESET_DECKS.length} เด็ค (Main 40-60 ใบ + Extra Deck, LP 8000, Hand 5) สำเร็จ`);

// Test 2: Swordsoul Mo Ye -> Token -> Synchro Summon Chixiao (Lv.4 + Lv.4 = Lv.8)
{
  const engine = new DuelEngine({ p0DeckId: 'swordsoul_tenyi', p1DeckId: 'blue_eyes_meta' });
  const p0 = engine.state.players[0];
  p0.hand = [engine.createCardInstance(getCardById('swordsoul_of_mo_ye'), 0, 'HAND')];
  engine.state.players[1].hand = [];

  const nsRes = engine.executeAction(0, {
    type: 'NORMAL_SUMMON',
    instanceId: p0.hand[0].instanceId
  });
  assert.equal(nsRes.ok, true);

  // Mo Ye should have spawned a Swordsoul Token (Tuner Lv.4) automatically via ON_SUMMON_ANY
  const fieldMons = engine.getPlayerFieldMonsters(0);
  assert.equal(fieldMons.length, 2, 'Should have Mo Ye + Swordsoul Token on field');

  // Now check Extra Deck Summon for Chixiao (Lv.8 Synchro)
  const chixiao = p0.extra.find(c => c.id === 'swordsoul_grandmaster_chixiao');
  assert.ok(chixiao, 'Chixiao should be in Extra Deck');

  const synchroRes = engine.executeAction(0, {
    type: 'EXTRA_DECK_SUMMON',
    instanceId: chixiao.instanceId,
    combinationIndex: 0
  });
  assert.equal(synchroRes.ok, true);

  const afterMons = engine.getPlayerFieldMonsters(0);
  assert.equal(afterMons.length, 1);
  assert.equal(afterMons[0].id, 'swordsoul_grandmaster_chixiao');
  // Mo Ye GY draw + Chixiao search => 2 cards in hand!
  assert.equal(p0.hand.length, 2, 'Mo Ye GY draw + Chixiao search should yield 2 cards in hand');
}
console.log('✅ Test 2 Passed: คอมโบซิงโคร Swordsoul of Mo Ye -> เสกจูนเนอร์ Token -> ซิงโคร Lv.8 Chixiao สำเร็จ');

// Test 3: Sky Striker Hornet Drones -> Token -> Link-1 Kagari -> Recover Hornet Drones
{
  const engine = new DuelEngine({ p0DeckId: 'sky_striker_ace', p1DeckId: 'dark_magician_control' });
  const p0 = engine.state.players[0];
  const drones = engine.createCardInstance(getCardById('sky_striker_mecha_hornet_drones'), 0, 'HAND');
  p0.hand = [drones];
  // Disable opponent chain for clean unit test
  engine.state.players[1].hand = [];

  const actRes = engine.executeAction(0, {
    type: 'ACTIVATE_EFFECT',
    instanceId: drones.instanceId,
    effectId: 'hornet_drones_token'
  });
  assert.equal(actRes.ok, true);
  assert.equal(engine.getPlayerFieldMonsters(0).length, 1);
  assert.equal(engine.getPlayerFieldMonsters(0)[0].id, 'sky_striker_ace_token');

  // Link Summon Kagari using the Token
  const kagari = p0.extra.find(c => c.id === 'sky_striker_ace_kagari');
  const linkRes = engine.executeAction(0, {
    type: 'EXTRA_DECK_SUMMON',
    instanceId: kagari.instanceId,
    combinationIndex: 0
  });
  assert.equal(linkRes.ok, true);
  assert.equal(p0.emz?.id, 'sky_striker_ace_kagari');
  // Kagari recovered Hornet Drones from GY to Hand!
  assert.equal(p0.hand.some(c => c.id === 'sky_striker_mecha_hornet_drones'), true);
}
console.log('✅ Test 3 Passed: คอมโบลิงก์ซัมมอน Sky Striker Hornet Drones -> Token -> Link-1 Kagari เก็บเวทจากสุสานสำเร็จ');

// Test 4: Master Duel Chain & Hand Trap Negation (Ash Blossom negating Swordsoul Emergence)
{
  const engine = new DuelEngine({ p0DeckId: 'swordsoul_tenyi', p1DeckId: 'blue_eyes_meta' });
  const p0 = engine.state.players[0];
  const p1 = engine.state.players[1];

  const emergence = engine.createCardInstance(getCardById('swordsoul_emergence'), 0, 'HAND');
  const ash = engine.createCardInstance(getCardById('ash_blossom'), 1, 'HAND');
  p0.hand = [emergence];
  p1.hand = [ash];

  const actRes = engine.executeAction(0, {
    type: 'ACTIVATE_EFFECT',
    instanceId: emergence.instanceId,
    effectId: 'emergence_search'
  });
  assert.equal(actRes.ok, true);
  assert.equal(actRes.pendingChain, true, 'Should prompt Player 1 to chain Ash Blossom');
  assert.equal(engine.state.pendingChainPrompt.responderIndex, 1);

  // Player 1 chains Ash Blossom!
  const chainRes = engine.executeAction(1, {
    type: 'CHAIN_RESPONSE',
    respond: true,
    instanceId: ash.instanceId,
    effectId: 'ash_negate'
  });
  assert.equal(chainRes.ok, true);
  // Emergence was negated, so Player 0's hand remains empty!
  assert.equal(p0.hand.length, 0, 'Emergence search should be negated by Ash Blossom');
  assert.equal(p1.gy.some(c => c.id === 'ash_blossom'), true, 'Ash Blossom was discarded to GY as cost');
}
console.log('✅ Test 4 Passed: ระบบ Master Duel Chain Link & Hand Trap (Ash Blossom ยกเลิกการค้นหาเด็ค) ทำงานถูกต้องตามกฎ LIFO');

// Test 5: Xyz Summon Rank 8 (2 Level 8 Blue-Eyes -> Number 38: Hope Harbinger)
{
  const engine = new DuelEngine({ p0DeckId: 'blue_eyes_meta', p1DeckId: 'branded_despia' });
  const p0 = engine.state.players[0];
  engine.state.players[1].hand = [];
  const bewd = engine.createCardInstance(getCardById('blue_eyes_white_dragon'), 0, 'MMZ');
  const alt = engine.createCardInstance(getCardById('blue_eyes_alternative_white_dragon'), 0, 'MMZ');
  p0.mmz[0] = bewd;
  p0.mmz[1] = alt;

  const n38 = p0.extra.find(c => c.id === 'number_38_hope_harbinger');
  const xyzRes = engine.executeAction(0, {
    type: 'EXTRA_DECK_SUMMON',
    instanceId: n38.instanceId,
    combinationIndex: 0
  });
  assert.equal(xyzRes.ok, true);
  const summonedXyz = engine.getPlayerFieldMonsters(0)[0];
  assert.equal(summonedXyz.id, 'number_38_hope_harbinger');
  assert.equal(summonedXyz.overlayUnits.length, 2, 'Should have 2 Xyz Overlay Units attached');
}
console.log('✅ Test 5 Passed: ระบบอัญเชิญเอ็กシーズ (Xyz Summon Rank 8) และการซ้อน Overlay Units ทำงานถูกต้อง');

// Test 6: Branded Fusion + AI Bot Multi-turn Simulation
{
  const engine = new DuelEngine({ p0DeckId: 'branded_despia', p1DeckId: 'swordsoul_tenyi' });
  // Advance to AI turn
  engine.executeAction(0, { type: 'CHANGE_PHASE', targetPhase: PHASES.EP });
  assert.equal(engine.state.turnPlayer, 1);

  let steps = 0;
  while (engine.state.turnPlayer === 1 && steps < 25 && engine.state.winner === null) {
    // If Player 0 is prompted to chain a Hand Trap during AI's turn, pass priority so AI continues
    if (engine.state.pendingChainPrompt && engine.state.pendingChainPrompt.responderIndex === 0) {
      const passRes = engine.executeAction(0, { type: 'CHAIN_RESPONSE', respond: false });
      assert.equal(passRes.ok, true);
      continue;
    }
    const aiMove = AIPlayer.chooseNextAction(engine, 1);
    if (!aiMove) break;
    const res = engine.executeAction(1, aiMove);
    assert.equal(res.ok, true);
    steps++;
  }
  assert.ok(
    engine.state.turnPlayer === 0 || engine.state.winner !== null,
    'AI should complete its turn and pass back to Player 0 (or win by lethal attack)'
  );
}
console.log('✅ Test 6 Passed: บอท AI (AIPlayer) สามารถคิดคอมโบ อัญเชิญมอนสเตอร์ และจบเทิร์นได้อย่างสมบูรณ์');

// Test 7: Specific Target Zone Placement (Drag Drop Slot Index) & Battle Event Tracking
{
  const engine = new DuelEngine({ p0DeckId: 'blue_eyes_meta', p1DeckId: 'swordsoul_tenyi' });
  const p0 = engine.state.players[0];
  engine.state.players[1].hand = [];
  const sage = engine.createCardInstance(getCardById('sage_with_eyes_of_blue'), 0, 'HAND');
  const imperm = engine.createCardInstance(getCardById('infinite_impermanence'), 0, 'HAND');
  p0.hand = [sage, imperm];

  const nsRes = engine.executeAction(0, {
    type: 'NORMAL_SUMMON',
    instanceId: sage.instanceId,
    targetZoneIndex: 3
  });
  assert.equal(nsRes.ok, true);
  assert.equal(p0.mmz[3]?.instanceId, sage.instanceId, 'Normal Summon should honor preferred MMZ slot 3');

  const setRes = engine.executeAction(0, {
    type: 'SET_SPELL_TRAP',
    instanceId: imperm.instanceId,
    targetZoneIndex: 4
  });
  assert.equal(setRes.ok, true);
  assert.equal(p0.stz[4]?.instanceId, imperm.instanceId, 'Set S/T should honor preferred STZ slot 4');

  // Advance to Turn 2 & Turn 3 (P0 Battle Phase) to test battle event emission
  engine.executeAction(0, { type: 'CHANGE_PHASE', targetPhase: PHASES.EP });
  engine.state.players[1].mmz = [null, null, null, null, null];
  engine.executeAction(1, { type: 'CHANGE_PHASE', targetPhase: PHASES.EP });
  engine.executeAction(0, { type: 'CHANGE_PHASE', targetPhase: PHASES.BP });

  const atkRes = engine.executeAction(0, {
    type: 'DECLARE_ATTACK',
    attackerInstanceId: sage.instanceId,
    directAttack: true
  });
  assert.equal(atkRes.ok, true);
  assert.equal(engine.state.battleSeq, 1);
  assert.equal(engine.state.lastBattleEvent?.attackerInstanceId, sage.instanceId);
  assert.equal(engine.state.lastBattleEvent?.directAttack, true);
}
console.log('✅ Test 7 Passed: ระบบลากวางช่องเจาะจง (targetZoneIndex) และ Battle Event Animation State ทำงานถูกต้อง!');

// Test 8: Master Rule 5 SEGOC Trigger Chains, Ghost Ogre, Droll & Lock Bird, Choices & 6-Card Hand Limit
{
  // 8A: Aleister ON_NORMAL_SUMMON trigger enters Chain Link 1 and can be negated by Ash Blossom (Chain Link 2)
  const engine = new DuelEngine({ p0DeckId: 'mdm_invoked', p1DeckId: 'blue_eyes_meta' });
  const p0 = engine.state.players[0];
  const p1 = engine.state.players[1];
  const aleister = engine.createCardInstance(getCardById('aleister_the_invoker'), 0, 'HAND');
  const ash = engine.createCardInstance(getCardById('ash_blossom'), 1, 'HAND');
  p0.hand = [aleister];
  p1.hand = [ash];

  const nsRes = engine.executeAction(0, {
    type: 'NORMAL_SUMMON',
    instanceId: aleister.instanceId
  });
  assert.equal(nsRes.ok, true);
  assert.equal(nsRes.pendingChain, true, 'Aleister ON_NORMAL_SUMMON trigger should go on Chain and prompt opponent Ash Blossom');
  const chainRes = engine.executeAction(1, {
    type: 'CHAIN_RESPONSE',
    respond: true,
    instanceId: ash.instanceId,
    effectId: 'ash_negate'
  });
  assert.equal(chainRes.ok, true);
  assert.equal(p0.hand.length, 0, 'Aleister search for Invocation should be negated by Ash Blossom');

  // 8B: Ghost Ogre destroys a face-up field monster that activates its effect
  const ogre = engine.createCardInstance(getCardById('ghost_ogre_snow_rabbit'), 1, 'HAND');
  const lucina = engine.createCardInstance(getCardById('elfnote_lucina'), 0, 'MMZ');
  p0.deck.push(engine.createCardInstance(getCardById('elfnote_fortuna'), 0, 'DECK'));
  p0.mmz[2] = lucina;
  p1.hand = [ogre];

  const lucinaRes = engine.executeAction(0, {
    type: 'ACTIVATE_EFFECT',
    instanceId: lucina.instanceId,
    effectId: 'elfnote_lucina_search'
  });
  assert.equal(lucinaRes.ok, true);
  assert.equal(lucinaRes.pendingChain, true, 'Ghost Ogre should be chainable to field monster effect');
  const ogreChain = engine.executeAction(1, {
    type: 'CHAIN_RESPONSE',
    respond: true,
    instanceId: ogre.instanceId,
    effectId: 'ghost_ogre_destroy'
  });
  assert.equal(ogreChain.ok, true);
  assert.equal(p0.mmz[2], null, 'Ghost Ogre should destroy Lucina on the field');

  // 8C: End Phase 6-Card Hand Size Limit
  p0.hand = Array.from({ length: 8 }, () => engine.createCardInstance(getCardById('aleister_the_invoker'), 0, 'HAND'));
  engine.executeAction(0, { type: 'CHANGE_PHASE', targetPhase: PHASES.EP });
  assert.equal(p0.hand.length, 6, 'End Phase should enforce Master Rule 6-card hand size limit');
}
console.log('✅ Test 8 Passed: กฎ Master Rule 5 (SEGOC Trigger Chain, Ghost Ogre, Ash Blossom, End Phase 6-Card Hand Size Limit) ทำงานครบถ้วน!');

// Test 9: Master Rule 5 Xyz Evolution Rules (AA-ZEUS & TY-PHON)
{
  const engine = new DuelEngine({ p0DeckId: 'mdm_rikka', p1DeckId: 'blue_eyes_meta' });
  const p0 = engine.state.players[0];
  const p1 = engine.state.players[1];
  p1.hand = [];

  const zeus = engine.createCardInstance(getCardById('divine_arsenal_aa_zeus_sky_thunder'), 0, 'EXTRA');
  const typhon = engine.createCardInstance(getCardById('super_starslayer_ty_phon_sky_crisis'), 0, 'EXTRA');
  const teardrop = engine.createCardInstance(getCardById('teardrop_the_rikka_queen'), 0, 'MMZ');
  const petal = engine.createCardInstance(getCardById('rikka_petal'), 0, 'MMZ');
  p0.extra = [zeus, typhon];
  p0.mmz[0] = teardrop;
  p0.mmz[1] = petal;

  // On Turn 1 before any Xyz battled and before opponent summoned 2+ from Extra Deck, neither Zeus nor Ty-Phon can be Xyz Summoned
  let legal = engine.getLegalActions(0);
  assert.equal(Boolean(legal.extraActions[zeus.instanceId]), false, 'AA-ZEUS must not be summonable before an Xyz Monster battled');
  assert.equal(Boolean(legal.extraActions[typhon.instanceId]), false, 'TY-PHON must not be summonable before opponent summoned 2+ from Extra Deck');

  // After an Xyz monster battled this turn, AA-ZEUS can rank up ONLY on the Xyz Monster (Teardrop), not on Rikka Petal
  p0.xyzBattledThisTurn = true;
  legal = engine.getLegalActions(0);
  assert.equal(Boolean(legal.extraActions[zeus.instanceId]), true, 'AA-ZEUS should be summonable after an Xyz Monster battled');
  assert.equal(legal.extraActions[zeus.instanceId][0].combinationsCount, 1, 'AA-ZEUS should only rank up over Teardrop (Xyz), not Rikka Petal');

  const zeusRes = engine.executeAction(0, {
    type: 'EXTRA_DECK_SUMMON',
    instanceId: zeus.instanceId,
    combinationIndex: 0
  });
  assert.equal(zeusRes.ok, true);
  assert.equal(engine.getPlayerFieldMonsters(0).some(m => m.id === 'divine_arsenal_aa_zeus_sky_thunder'), true);
  assert.equal(zeus.overlayUnits.length, 1, 'AA-ZEUS should attach Teardrop as an overlay unit');

  // Now simulate opponent having summoned 2 monsters from Extra Deck last turn -> TY-PHON can rank up over highest ATK monster and locks further summons
  p1.extraDeckSummonsLastTurn = 2;
  legal = engine.getLegalActions(0);
  assert.equal(Boolean(legal.extraActions[typhon.instanceId]), true, 'TY-PHON should be summonable when opponent summoned 2+ from Extra Deck');
  const typhonRes = engine.executeAction(0, {
    type: 'EXTRA_DECK_SUMMON',
    instanceId: typhon.instanceId,
    combinationIndex: 0
  });
  assert.equal(typhonRes.ok, true);
  assert.equal(p0.turnRestrictions.noSpecialSummon, true, 'TY-PHON should lock Player 0 from further Special Summons this turn');
  assert.equal(p0.turnRestrictions.noNormalSummon, true, 'TY-PHON should lock Player 0 from further Normal Summons this turn');
}
console.log('✅ Test 9 Passed: เงื่อนไข Xyz Rank-Up ของ AA-ZEUS และ TY-PHON (รวมถึงการล็อกอัญเชิญหลังลง TY-PHON) ถูกต้องตาม Master Rule 5!');

// Test 10: Continuous/Field Spell Must Remain Face-Up on Field to Resolve & Field Spell Activation (Magical Meltdown, Rikka Konkon)
{
  const engine = new DuelEngine({ p0DeckId: 'sky_striker_ace', p1DeckId: 'mdm_invoked' });
  const p0 = engine.state.players[0];
  const p1 = engine.state.players[1];

  // Place Area Zero in P0's Field Zone and give P1 Ghost Ogre in hand
  const areaZero = engine.createCardInstance(getCardById('sky_striker_airspace_area_zero'), 0, 'FIELD');
  areaZero.position = POSITIONS.FACE_UP;
  p0.fieldSpell = areaZero;
  p0.hand = [];
  const ogre = engine.createCardInstance(getCardById('ghost_ogre_snow_rabbit'), 1, 'HAND');
  p1.hand = [ogre];

  // P0 activates Area Zero's Ignition effect on field; P1 chains Ghost Ogre to destroy Area Zero
  const actRes = engine.executeAction(0, {
    type: 'ACTIVATE_EFFECT',
    instanceId: areaZero.instanceId,
    effectId: 'area_zero_search'
  });
  assert.equal(actRes.ok, true);
  assert.equal(actRes.pendingChain, true);

  const chainRes = engine.executeAction(1, {
    type: 'CHAIN_RESPONSE',
    respond: true,
    instanceId: ogre.instanceId,
    effectId: 'ghost_ogre_destroy'
  });
  assert.equal(chainRes.ok, true);
  assert.equal(p0.fieldSpell, null, 'Area Zero was destroyed by Ghost Ogre');
  assert.equal(p0.hand.length, 0, 'Master Rule 5: Field/Continuous Spell destroyed mid-chain must resolve without effect!');

  // Also test Magical Meltdown & Rikka Konkon activation from Hand
  const meltdown = engine.createCardInstance(getCardById('magical_meltdown'), 0, 'HAND');
  const konkon = engine.createCardInstance(getCardById('rikka_konkon'), 0, 'HAND');
  const glamour = engine.createCardInstance(getCardById('rikka_glamour'), 0, 'DECK');
  p0.hand = [meltdown, konkon];
  p0.deck.push(glamour);
  p1.hand = [];

  const meltRes = engine.executeAction(0, {
    type: 'ACTIVATE_EFFECT',
    instanceId: meltdown.instanceId,
    effectId: 'magical_meltdown_search'
  });
  assert.equal(meltRes.ok, true, 'Magical Meltdown should be activatable from Hand');
  assert.equal(p0.fieldSpell?.id, 'magical_meltdown');

  const konkonOpenRes = engine.executeAction(0, {
    type: 'ACTIVATE_EFFECT',
    instanceId: konkon.instanceId,
    effectId: 'rikka_konkon_open'
  });
  assert.equal(konkonOpenRes.ok, true, 'Rikka Konkon should be activatable from Hand and replace previous Field Spell');
  assert.equal(p0.fieldSpell?.id, 'rikka_konkon');

  const konkonSetRes = engine.executeAction(0, {
    type: 'ACTIVATE_EFFECT',
    instanceId: konkon.instanceId,
    effectId: 'rikka_konkon_set'
  });
  assert.equal(konkonSetRes.ok, true, 'Rikka Konkon Ignition effect should Set a Rikka S/T directly from Deck');
  assert.equal(p0.stz.some(st => st?.id === 'rikka_glamour'), true);
}
console.log('✅ Test 10 Passed: กฎเวทสนาม/เวทต่อเนื่องต้องอยู่บนสนามเมื่อคลี่คลายเชน + Magical Meltdown & Rikka Konkon ทำงานถูกต้อง!');

// Test 11: Called by the Grave Same-ID Negation, Super Polymerization Opponent Material, and Invocation GY Banish
{
  const engine = new DuelEngine({ p0DeckId: 'mdm_invoked', p1DeckId: 'blue_eyes_meta' });
  const p0 = engine.state.players[0];
  const p1 = engine.state.players[1];

  // Put 1 Ash Blossom in P1's GY and 1 Ash Blossom in P1's Hand, and Called by the Grave + Terraforming in P0's Hand
  const terra = engine.createCardInstance(getCardById('terraforming') || getCardById('swordsoul_emergence'), 0, 'HAND');
  const cbtg = engine.createCardInstance(getCardById('called_by_the_grave'), 0, 'HAND');
  const ashHand = engine.createCardInstance(getCardById('ash_blossom'), 1, 'HAND');
  const ashGY = engine.createCardInstance(getCardById('ash_blossom'), 1, 'GY');
  p0.hand = [terra, cbtg];
  p0.deck.push(engine.createCardInstance(getCardById('swordsoul_of_mo_ye'), 0, 'DECK'));
  p1.hand = [ashHand];
  p1.gy = [ashGY];

  // CL1: P0 activates Emergence -> CL2: P1 chains Ash Blossom -> CL3: P0 chains Called by the Grave banishing Ash in P1's GY!
  const cl1 = engine.executeAction(0, {
    type: 'ACTIVATE_EFFECT',
    instanceId: terra.instanceId,
    effectId: terra.effects[0].id
  });
  assert.equal(cl1.pendingChain, true);

  const cl2 = engine.executeAction(1, {
    type: 'CHAIN_RESPONSE',
    respond: true,
    instanceId: ashHand.instanceId,
    effectId: 'ash_negate'
  });
  assert.equal(cl2.pendingChain, true, 'P0 should be prompted to counter-chain Called by the Grave as CL3');

  const cl3 = engine.executeAction(0, {
    type: 'CHAIN_RESPONSE',
    respond: true,
    instanceId: cbtg.instanceId,
    effectId: 'cbtg_activate'
  });
  assert.equal(cl3.ok, true);
  assert.equal(p1.banished.some(c => c.id === 'ash_blossom'), true, 'Called by the Grave should banish Ash Blossom from P1 GY');
  assert.equal(p0.hand.length, 1, 'Called by the Grave negated Ash Blossom so Emergence resolved and searched a card!');

  // Test Super Polymerization using 1 P0 monster + 1 P1 monster
  const superPoly = engine.createCardInstance(getCardById('super_polymerization'), 0, 'HAND');
  const discardCard = engine.createCardInstance(getCardById('aleister_the_invoker'), 0, 'HAND');
  const p0Mon = engine.createCardInstance(getCardById('aleister_the_invoker'), 0, 'MMZ');
  const p1Mon = engine.createCardInstance(getCardById('blue_eyes_white_dragon'), 1, 'MMZ');
  const garura = engine.createCardInstance(getCardById('garura_wings_of_resonant_life'), 0, 'EXTRA');
  p0.hand = [superPoly, discardCard];
  p0.mmz[0] = p0Mon;
  p1.mmz[0] = p1Mon;
  p0.extra = [garura];
  p1.hand = [];

  const spRes = engine.executeAction(0, {
    type: 'ACTIVATE_EFFECT',
    instanceId: superPoly.instanceId,
    effectId: 'super_poly_fusion'
  });
  assert.equal(spRes.ok, true);
  assert.equal(p1.mmz[0], null, 'Super Polymerization should use Opponent monster from field as Fusion Material');
  assert.equal(engine.getPlayerFieldMonsters(0).some(m => m.id === 'garura_wings_of_resonant_life'), true);

  // Test Invocation banishing materials from GY
  const invocation = engine.createCardInstance(getCardById('invocation'), 0, 'HAND');
  const mechaba = engine.createCardInstance(getCardById('invoked_mechaba'), 0, 'EXTRA');
  p0.hand = [invocation];
  p0.extra = [mechaba];
  p0.emz = null;
  p0.mmz = [null, null, null, null, null];
  // Put Aleister + a LIGHT monster in P0's GY
  const gyMat1 = engine.createCardInstance(getCardById('aleister_the_invoker'), 0, 'GY');
  const gyMat2 = engine.createCardInstance(getCardById('blue_eyes_white_dragon'), 0, 'GY');
  p0.gy = [gyMat1, gyMat2];

  const invRes = engine.executeAction(0, {
    type: 'ACTIVATE_EFFECT',
    instanceId: invocation.instanceId,
    effectId: 'invocation_fusion'
  });
  assert.equal(invRes.ok, true);
  assert.equal(engine.getPlayerFieldMonsters(0).some(m => m.id === 'invoked_mechaba'), true);
  assert.equal(p0.banished.length, 2, 'Fusion materials used from GY by Invocation must be banished');
}
console.log('✅ Test 11 Passed: Called by the Grave (ใบ้ตามชื่อการ์ด), Super Polymerization (รวมมอนสเตอร์อีกฝ่าย), และ Invocation (มูฟวัตถุดิบจากสุสาน) ทำงานถูกต้อง!');

// Test 12: Link-1 Material Filter, Sky Striker MMZ Restriction, & Linkuriboh Opponent Attack Trigger
{
  const engine = new DuelEngine({ p0DeckId: 'sky_striker_ace', p1DeckId: 'blue_eyes_meta' });
  const p0 = engine.state.players[0];
  const p1 = engine.state.players[1];
  p1.hand = [];

  // Put a Lv.4 Raye in P0's MMZ[0] and Linkuriboh in P0's Extra Deck
  const raye = engine.createCardInstance(getCardById('sky_striker_ace_raye'), 0, 'MMZ');
  const linkuriboh = engine.createCardInstance(getCardById('linkuriboh'), 0, 'EXTRA');
  const engage = engine.createCardInstance(getCardById('sky_striker_mobilize_engage'), 0, 'HAND');
  p0.mmz[0] = raye;
  p0.extra = [linkuriboh, ...p0.extra];
  p0.hand = [engage];

  // With Raye (Lv.4) in MMZ[0]:
  // 1) Linkuriboh (requires Lv.1) CANNOT be Link Summoned
  // 2) Sky Striker Engage! (requires no monsters in MMZ) CANNOT be activated
  let legal = engine.getLegalActions(0);
  assert.equal(Boolean(legal.extraActions[linkuriboh.instanceId]), false, 'Linkuriboh must not be Link Summonable using a Lv.4 monster');
  assert.equal(
    (legal.handActions[engage.instanceId] || []).some(a => a.type === 'ACTIVATE_EFFECT'),
    false,
    'Sky Striker Engage! must not be activatable while a monster is in MMZ'
  );

  // Link Summon Kagari into EMZ using Raye -> now MMZ is empty, so Engage! CAN be activated!
  const kagari = p0.extra.find(c => c.id === 'sky_striker_ace_kagari');
  const kagariRes = engine.executeAction(0, {
    type: 'EXTRA_DECK_SUMMON',
    instanceId: kagari.instanceId,
    combinationIndex: 0
  });
  assert.equal(kagariRes.ok, true);
  assert.equal(p0.emz?.id, 'sky_striker_ace_kagari');
  legal = engine.getLegalActions(0);
  assert.equal(
    (legal.handActions[engage.instanceId] || []).some(a => a.type === 'ACTIVATE_EFFECT'),
    true,
    'Sky Striker Engage! should be activatable when only EMZ is occupied and MMZ is empty'
  );

  // Test Linkuriboh ON_ATTACK_DECLARE when opponent attacks on Turn 2
  const sageLv1 = engine.createCardInstance(getCardById('sage_with_eyes_of_blue'), 0, 'MMZ');
  p0.emz = null;
  p0.mmz[0] = sageLv1;
  const lkRes = engine.executeAction(0, {
    type: 'EXTRA_DECK_SUMMON',
    instanceId: linkuriboh.instanceId,
    combinationIndex: 0
  });
  assert.equal(lkRes.ok, true, 'Linkuriboh should be Link Summonable using a Lv.1 monster');
  assert.equal(p0.emz?.id, 'linkuriboh');

  // Advance to Turn 2 (P1's turn), summon Blue-Eyes (3000 ATK), enter BP, and attack Linkuriboh
  engine.executeAction(0, { type: 'CHANGE_PHASE', targetPhase: PHASES.EP });
  const bewd = engine.createCardInstance(getCardById('blue_eyes_white_dragon'), 1, 'MMZ');
  p1.mmz[0] = bewd;
  engine.executeAction(1, { type: 'CHANGE_PHASE', targetPhase: PHASES.BP });

  const atkRes = engine.executeAction(1, {
    type: 'DECLARE_ATTACK',
    attackerInstanceId: bewd.instanceId,
    targetInstanceId: linkuriboh.instanceId
  });
  assert.equal(atkRes.ok, true);
  assert.equal(p0.gy.some(c => c.id === 'linkuriboh'), true, 'Linkuriboh should tribute itself on opponent attack declaration');
  assert.ok(bewd.currentAtk < 3000, 'Blue-Eyes ATK should be reduced by Linkuriboh');
}
console.log('✅ Test 12 Passed: เงื่อนไขวัตถุดิบ Link-1, ข้อจำกัดโซน MMZ ของ Sky Striker, และเอฟเฟครับการโจมตีของ Linkuriboh ทำงานถูกต้อง!');

// Test 13: All-55-Deck Master Rule AI Simulation Stress Test
{
  for (let i = 0; i < PRESET_DECKS.length; i++) {
    const deckA = PRESET_DECKS[i];
    const deckB = PRESET_DECKS[(i + 1) % PRESET_DECKS.length];
    const engine = new DuelEngine({ p0DeckId: deckA.id, p1DeckId: deckB.id });

    // Simulate 2 full turns (Turn 1 P0 + Turn 2 P1) with AI making all moves and chain responses
    let safety = 0;
    while (engine.state.turnCount <= 2 && safety < 40 && engine.state.winner === null) {
      safety++;
      if (engine.state.pendingChainPrompt) {
        const respIdx = engine.state.pendingChainPrompt.responderIndex;
        const respMove = AIPlayer.chooseNextAction(engine, respIdx);
        const res = engine.executeAction(respIdx, respMove);
        assert.equal(res.ok, true, `Chain response failed in ${deckA.id} vs ${deckB.id}`);
        continue;
      }
      const activeIdx = engine.state.turnPlayer;
      const move = AIPlayer.chooseNextAction(engine, activeIdx);
      if (!move) break;
      const res = engine.executeAction(activeIdx, move);
      assert.equal(res.ok, true, `Action ${move.type} failed in ${deckA.id} vs ${deckB.id}: ${res.errorTh || ''}`);
    }
    assert.ok(engine.state.players[0].hand.length <= 7, `Hand limit invariant check for ${deckA.id}`);
  }
}
console.log(`✅ Test 13 Passed: จำลอง AI ปะทะ AI ครบทั้ง ${PRESET_DECKS.length} เด็ค (รวมทุกใบในเกม) ไม่พบบั๊กหรือ Error แม้แต่จุดเดียว!\n`);

// Test 14: Battle Phase Quick-Play/Trap/QuickEffect + Set Continuous Traps + Fallback Activation for Unscripted Spells/Traps
{
  const engine = new DuelEngine({ p0DeckId: 'blue_eyes_meta', p1DeckId: 'dark_magician_control' });
  const p0 = engine.state.players[0];
  const p1 = engine.state.players[1];
  engine.state.turnCount = 3;
  engine.state.turnPlayer = 0;
  engine.state.phase = PHASES.BP;

  const qp = engine.createCardInstance(getCardById('called_by_the_grave'), 0, 'HAND');
  const setTrap = engine.createCardInstance(getCardById('true_light'), 0, 'STZ');
  setTrap.position = POSITIONS.SET;
  setTrap.setTurn = 1;
  setTrap.zoneIndex = 0;
  p0.stz[0] = setTrap;

  const oppTarget = engine.createCardInstance(getCardById('blue_eyes_white_dragon'), 1, 'GY');
  p1.gy.push(oppTarget);
  const p0BewdGY = engine.createCardInstance(getCardById('blue_eyes_white_dragon'), 0, 'GY');
  p0.gy.push(p0BewdGY);
  p0.hand.push(qp);

  const bpLegal = engine.getLegalActions(0);
  assert.ok(
    (bpLegal.handActions[qp.instanceId] || []).some(a => a.type === 'ACTIVATE_EFFECT'),
    'Quick-Play Spell should be activatable during Battle Phase'
  );
  assert.ok(
    (bpLegal.fieldActions[setTrap.instanceId] || []).some(a => a.type === 'ACTIVATE_EFFECT'),
    'Set Continuous Trap with QUICK_EFFECT (true_light) should be flippable/activatable'
  );

  // Unscripted Field & Continuous Spell fallback activation
  engine.state.phase = PHASES.MP1;
  const fieldCard = engine.createCardInstance(getCardById('hideout_in_the_sky_coulomb'), 0, 'HAND');
  const setUnscriptedTrap = engine.createCardInstance(getCardById('gamma_summon'), 0, 'STZ');
  setUnscriptedTrap.position = POSITIONS.SET;
  setUnscriptedTrap.setTurn = 1;
  setUnscriptedTrap.zoneIndex = 1;
  p0.stz[1] = setUnscriptedTrap;
  p0.hand.push(fieldCard);

  const mpLegal = engine.getLegalActions(0);
  const fieldAct = (mpLegal.handActions[fieldCard.instanceId] || []).find(a => a.type === 'ACTIVATE_EFFECT');
  const trapAct = (mpLegal.fieldActions[setUnscriptedTrap.instanceId] || []).find(a => a.type === 'ACTIVATE_EFFECT');
  assert.ok(fieldAct && fieldAct.isManualFallback, 'Unscripted Field Spell should expose fallback ACTIVATE_EFFECT');
  assert.ok(trapAct && trapAct.isManualFallback, 'Set unscripted Trap should expose fallback ACTIVATE_EFFECT');

  const fRes = engine.executeAction(0, { type: 'ACTIVATE_EFFECT', instanceId: fieldCard.instanceId, effectId: fieldAct.effectId });
  assert.equal(fRes.ok, true);
  assert.equal(p0.fieldSpell?.id, 'hideout_in_the_sky_coulomb', 'Activated Field Spell should stay on FIELD zone');

  const tRes = engine.executeAction(0, { type: 'ACTIVATE_EFFECT', instanceId: setUnscriptedTrap.instanceId, effectId: trapAct.effectId });
  assert.equal(tRes.ok, true);
  assert.ok(p0.gy.some(c => c.instanceId === setUnscriptedTrap.instanceId), 'Resolved Normal Trap fallback should move to GY');
}
console.log('✅ Test 14 Passed: Battle Phase Quick-Play/Trap/QuickEffect + Set Continuous Trap + Unscripted Spell/Trap Fallback ทำงานถูกต้อง!');

// Test 15: Nibiru Post-5th-Summon Response Window + checkCondition Chain Guard + Super Poly cannotRespond + Fusion Choices
{
  const engine = new DuelEngine({ p0DeckId: 'blue_eyes_meta', p1DeckId: 'branded_despia' });
  const p0 = engine.state.players[0];
  const p1 = engine.state.players[1];

  // checkCondition empty-chain guard
  assert.equal(engine.checkCondition(1, { opponentChainOnly: true }), false, 'opponentChainOnly must return false on empty chain');

  const nibiru = engine.createCardInstance(getCardById('nibiru_the_primal_being'), 1, 'HAND');
  const starter = engine.createCardInstance(getCardById('the_white_stone_of_ancients'), 0, 'HAND');
  p0.hand = [starter];
  p1.hand = [nibiru];

  p0.summonsThisTurn = 4;
  p0.normalSummonUsed = false;
  const sRes = engine.executeAction(0, { type: 'NORMAL_SUMMON', instanceId: starter.instanceId });
  assert.equal(sRes.ok, true);
  assert.ok(engine.state.pendingChainPrompt, 'Post-5th-summon window should open for Nibiru');
  assert.equal(engine.state.pendingChainPrompt.responderIndex, 1);
  assert.ok(
    engine.state.pendingChainPrompt.respondableCards.some(c => c.cardId === 'nibiru_the_primal_being'),
    'Nibiru should be offered in post-summon response window'
  );

  const nibRes = engine.executeAction(1, {
    type: 'CHAIN_RESPONSE',
    respond: true,
    instanceId: nibiru.instanceId,
    effectId: 'nibiru_meteor'
  });
  assert.equal(nibRes.ok, true);
  if (engine.state.pendingChainPrompt) {
    engine.executeAction(engine.state.pendingChainPrompt.responderIndex, { type: 'CHAIN_RESPONSE', respond: false });
  }
  assert.ok(engine.getPlayerFieldMonsters(1).some(m => m.id === 'nibiru_the_primal_being'), 'Nibiru should summon itself');
  assert.ok(engine.getPlayerFieldMonsters(0).some(m => m.id === 'primal_being_token'), 'Primal Being Token should spawn on opponent field');

  // Super Polymerization cannotRespond + multi-step Choice Requirements
  const sp = engine.createCardInstance(getCardById('super_polymerization'), 0, 'HAND');
  const discardCard = engine.createCardInstance(getCardById('blue_eyes_white_dragon'), 0, 'HAND');
  const discardCard2 = engine.createCardInstance(getCardById('ash_blossom'), 0, 'HAND');
  const myMat = engine.createCardInstance(getCardById('sage_with_eyes_of_blue'), 0, 'MMZ');
  myMat.zoneIndex = 1;
  p0.mmz[1] = myMat;
  p0.hand = [sp, discardCard, discardCard2];

  const albaz = engine.createCardInstance(getCardById('fallen_of_albaz'), 1, 'MMZ');
  albaz.zoneIndex = 1;
  p1.mmz[1] = albaz;
  const fusionExtra1 = engine.createCardInstance(getCardById('mirrorjade_the_iceblade_dragon'), 0, 'EXTRA');
  const fusionExtra2 = engine.createCardInstance(getCardById('lubellion_the_searing_dragon'), 0, 'EXTRA');
  p0.extra.push(fusionExtra1, fusionExtra2);

  const ash = engine.createCardInstance(getCardById('ash_blossom'), 1, 'HAND');
  const veiler = engine.createCardInstance(getCardById('effect_veiler'), 1, 'HAND');
  p1.hand = [ash, veiler];

  const spSteps = EffectResolver.getChoiceRequirements(engine, 0, sp, sp.effects[0]);
  assert.ok(spSteps.some(s => s.key === 'discardInstanceId'), 'Super Poly should collect discard cost step');
  assert.ok(spSteps.some(s => s.key === 'fusionCardId'), 'Super Poly should collect fusionCardId step');
  assert.ok(spSteps.some(s => s.key === 'materialInstanceIds' && s.count === 2), 'Super Poly should collect 2 materialInstanceIds');

  const spActRes = engine.executeAction(0, {
    type: 'ACTIVATE_EFFECT',
    instanceId: sp.instanceId,
    effectId: 'super_poly_fusion',
    choices: {
      discardInstanceId: discardCard.instanceId,
      fusionCardId: fusionExtra1.id,
      materialInstanceIds: [myMat.instanceId, albaz.instanceId]
    }
  });
  assert.equal(spActRes.ok, true);
  assert.equal(Boolean(spActRes.pendingChain), false, 'Opponent must not be able to chain to Super Polymerization');
  assert.ok(engine.getPlayerFieldMonsters(0).some(m => m.id === 'mirrorjade_the_iceblade_dragon'));
}
console.log('✅ Test 15 Passed: Nibiru Post-5th-Summon Window, Empty-Chain Guard, Super Poly cannotRespond และ Multi-Step Choices ทำงานครบ!');

// Test 16: Multi-Discard Cost (Ravenous Crocodragon Archethys discardCount: 2)
{
  const engine = new DuelEngine({ p0DeckId: 'mdm_elfnote', p1DeckId: 'blue_eyes_meta' });
  const p0 = engine.state.players[0];
  const croc = engine.createCardInstance(getCardById('ravenous_crocodragon_archethys'), 0, 'MMZ');
  croc.zoneIndex = 0;
  p0.mmz[0] = croc;

  const targetOpp = engine.createCardInstance(getCardById('blue_eyes_white_dragon'), 1, 'MMZ');
  targetOpp.zoneIndex = 0;
  engine.state.players[1].mmz[0] = targetOpp;

  const h0 = engine.createCardInstance(getCardById('ash_blossom'), 0, 'HAND');
  const h1 = engine.createCardInstance(getCardById('effect_veiler'), 0, 'HAND');
  const h2 = engine.createCardInstance(getCardById('called_by_the_grave'), 0, 'HAND');
  p0.hand = [h0, h1, h2];

  const popEff = croc.effects.find(e => (e.cost?.discardCount || e.cost?.discardHandCount) === 2);
  assert.ok(popEff, 'Crocodragon should have a discardCount: 2 effect');
  const steps = EffectResolver.getChoiceRequirements(engine, 0, croc, popEff);
  const discardStep = steps.find(s => s.key === 'discardInstanceIds');
  assert.ok(discardStep && discardStep.count === 2 && discardStep.isArray === true, 'Multi-discard step must require count: 2');

  const res = engine.executeAction(0, {
    type: 'ACTIVATE_EFFECT',
    instanceId: croc.instanceId,
    effectId: popEff.id,
    choices: { discardInstanceIds: [h0.instanceId, h2.instanceId] }
  });
  assert.equal(res.ok, true);
  assert.equal(p0.hand.length, 1, 'Exactly 2 chosen cards should be discarded leaving 1 in hand');
  assert.equal(p0.hand[0].instanceId, h1.instanceId, 'Unpicked middle card h1 must remain in hand');
}
console.log('✅ Test 16 Passed: Multi-Discard Cost (discardCount: 2) เลือกทิ้งการ์ดหลายใบได้อย่างแม่นยำ!');

// Test 17: Fixed Link-1 Filters (Linguriboh, Sunavalon Dryas) & Yummy Link-1-as-Tuner Lv.2 Synchro
{
  const engine = new DuelEngine({ p0DeckId: 'mdm_elfnote', p1DeckId: 'blue_eyes_meta' });
  const p0 = engine.state.players[0];

  const cyb = engine.createCardInstance(getCardById('maliss_dormouse'), 0, 'MMZ');
  cyb.zoneIndex = 0;
  p0.mmz[0] = cyb;
  const lingu = engine.createCardInstance(getCardById('linguriboh'), 0, 'EXTRA');
  assert.equal(
    SummonManager.getExtraDeckSummonCombinations(engine, 0, lingu).canSummon,
    true,
    'Linguriboh should accept Level <= 4 Cyberse monster'
  );

  const plant = engine.createCardInstance(getCardById('rikka_petal'), 0, 'MMZ');
  plant.zoneIndex = 1;
  p0.mmz[1] = plant;
  const dryas = engine.createCardInstance(getCardById('sunavalon_dryas'), 0, 'EXTRA');
  assert.equal(
    SummonManager.getExtraDeckSummonCombinations(engine, 0, dryas).canSummon,
    true,
    'Sunavalon Dryas should accept Level <= 4 Plant monster'
  );

  // Yummy Lv.2 Synchro using Link-1 + Lv.1 non-Tuner
  p0.mmz[0] = null;
  p0.mmz[1] = null;
  const link1 = engine.createCardInstance(getCardById('sky_striker_ace_kagari'), 0, 'EMZ');
  link1.position = POSITIONS.ATK;
  p0.emz = link1;
  const lv1Yummy = engine.createCardInstance(getCardById('cooky_yummy'), 0, 'MMZ');
  lv1Yummy.isTuner = false;
  lv1Yummy.zoneIndex = 0;
  p0.mmz[0] = lv1Yummy;
  const cookyWay = engine.createCardInstance(getCardById('cooky_yummy_way'), 0, 'EXTRA');
  assert.equal(
    SummonManager.getExtraDeckSummonCombinations(engine, 0, cookyWay).canSummon,
    true,
    'Cooky Yummy Way should treat Link-1 as Level 1 Tuner + Lv.1 non-Tuner'
  );
}
console.log('✅ Test 17 Passed: เงื่อนไขวัตถุดิบ Linguriboh, Sunavalon Dryas และ Yummy Synchro (Link-1 แทนจูนเนอร์ Lv.1) ใช้งานได้ครบ!');

// Test 18: Scripted Fusion Spells (Polymerization, Millennium Ankh) & Deck #6 Elfnote Cards
{
  const engine = new DuelEngine({ p0DeckId: 'mdm_elfnote', p1DeckId: 'blue_eyes_meta' });
  const p0 = engine.state.players[0];
  const p1 = engine.state.players[1];

  // Even if opponent holds Ash Blossom, regular Polymerization (non-Deck fusion) must NOT trigger Ash prompt
  p1.hand = [engine.createCardInstance(getCardById('ash_blossom'), 1, 'HAND')];

  // Polymerization works cleanly
  const poly = engine.createCardInstance(getCardById('polymerization'), 0, 'HAND');
  const m1 = engine.createCardInstance(getCardById('elfnote_fortuna'), 0, 'HAND');
  const m2 = engine.createCardInstance(getCardById('elfnote_lucina'), 0, 'HAND');
  const anyFusion = engine.createCardInstance(getCardById('mirrorjade_the_iceblade_dragon'), 0, 'EXTRA');
  p0.hand = [poly, m1, m2];
  p0.extra.push(anyFusion);
  const polyRes = engine.executeAction(0, { type: 'ACTIVATE_EFFECT', instanceId: poly.instanceId, effectId: 'polymerization_fusion' });
  assert.equal(polyRes.ok, true, 'Polymerization should resolve Fusion Summon');
  assert.equal(engine.state.pendingChainPrompt, null, 'Ash Blossom must not chain to non-Deck Polymerization');
  assert.ok(engine.getPlayerFieldMonsters(0).some(m => m.id === 'mirrorjade_the_iceblade_dragon'));

  // Clear opponent hand so Elfnotes Welcome Home Deck SS resolves without Ash Blossom prompt
  p1.hand = [];

  // Elfnotes: Welcome Home + Rhapsodia of Madness + Elfnote June Pride
  const welcome = engine.createCardInstance(getCardById('elfnotes_welcome_home'), 0, 'HAND');
  const sacrifice = engine.createCardInstance(getCardById('ash_blossom'), 0, 'HAND');
  p0.hand.push(welcome, sacrifice);

  const wAct = engine.executeAction(0, { type: 'ACTIVATE_EFFECT', instanceId: welcome.instanceId, effectId: 'elfnotes_welcome_activate' });
  assert.equal(wAct.ok, true);
  assert.ok(p0.stz.some(c => c?.id === 'elfnotes_welcome_home'), 'Continuous Spell should remain face-up in STZ');

  const wEff = engine.executeAction(0, {
    type: 'ACTIVATE_EFFECT',
    instanceId: welcome.instanceId,
    effectId: 'elfnotes_welcome_ss',
    choices: { costMonsterInstanceId: sacrifice.instanceId }
  });
  assert.equal(wEff.ok, true, 'Elfnotes Welcome Home should SS 1 Elfnote from Deck');
  assert.ok(engine.getPlayerFieldMonsters(0).some(m => m.archetype === 'Elfnote'), 'Elfnote monster should be summoned from Deck');
}
console.log('✅ Test 18 Passed: Polymerization และการ์ดเด็ค #6 (Elfnote) ทำงานได้สมบูรณ์!\n');

// Test 19: YGOProEngine Chain Resolution, RETRY Recovery, SELECT_SUM / ANNOUNCE_CARD / SORT_CHAIN / SELECT_COUNTER & UI Opp Reference
{
  // 19a. Verify cardAnimations.js defines `opp` inside playEventDrivenAnimations (prevents client WS crash locking Chain 1)
  const animSrc = fs.readFileSync(new URL('../public/js/cardAnimations.js', import.meta.url), 'utf8');
  assert.ok(
    /function playEventDrivenAnimations\([\s\S]*?const opp = newState\.players\[oppIdx\];/.test(animSrc),
    'playEventDrivenAnimations must declare `const opp` before reading opp.hand.length'
  );

  // 19b. Verify YGOProEngine Chain activation + resolution + triggerPlayerIndex
  const core = await getSharedOcgCore();
  const filler = Array.from({ length: 40 }, () => ({ passcode: '89631139' })); // Vanilla non-handtrap filler so Bingo Machine isn't Ash'd
  const eChain = new YGOProEngine({
    core,
    deck1Cards: [
      ...Array.from({ length: 12 }, () => ({ passcode: '93437091' })), // Bingo Machine, Go!!!
      ...Array.from({ length: 10 }, () => ({ passcode: '89631139' })), // Blue-Eyes White Dragon
      ...Array.from({ length: 10 }, () => ({ passcode: '38517737' })), // Blue-Eyes Alternative White Dragon
      ...Array.from({ length: 8 }, () => ({ passcode: '30576089' }))   // Blue-Eyes Jet Dragon
    ],
    deck2Cards: filler,
    isSoloVsAi: false
  });
  let sawChain1 = false;
  const bingoActIdx = (eChain.pendingMessage?.activates || []).findIndex(a => a.code === 93437091);
  assert.ok(bingoActIdx >= 0, 'Bingo Machine, Go!!! (93437091) should be activatable in T1 MP1');
  const actRes = eChain.dispatchAction(0, {
    type: 'OCG_RESPONSE',
    response: { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: bingoActIdx }
  });
  assert.equal(actRes.ok, true);
  let sawBingoSelection = false;
  let guard = 0;
  while (eChain.pendingMessage && guard++ < 25) {
    const m = eChain.pendingMessage;
    if (eChain.chainStack.length === 1) sawChain1 = true;
    if (m.type === OcgMessageType.SELECT_IDLECMD && eChain.chainStack.length === 0) break;
    if (m.type === OcgMessageType.SELECT_CARD) {
      sawBingoSelection = true;
    }
    const resp = eChain._computeAiResponse(m);
    assert.ok(resp, `Should compute valid AI response for prompt type ${m.type}`);
    const r = eChain.dispatchAction(m.player, { type: 'OCG_RESPONSE', response: resp });
    assert.equal(r.ok, true);
  }
  assert.equal(sawChain1, true, 'Activating Bingo Machine should form Chain Link 1');
  assert.equal(sawBingoSelection, true, 'Bingo Machine chain prompt should reach SELECT_CARD');
  assert.equal(eChain.chainStack.length, 0, 'Chain stack must resolve back to 0 without getting stuck at Chain 1');
  eChain.destroy();

  // 19c. Verify MSG_RETRY preserves pendingMessage instead of clearing it (prevents permanent Chain 1 lock)
  const mitsDeck = getPresetDeckById('mdm_mitsurugi');
  const mitsCards = [...expandDeckRecipe(mitsDeck.mainDeckRecipe || []), ...expandDeckRecipe(mitsDeck.extraDeckRecipe || [])];
  let retryTested = false;
  for (let attempt = 0; attempt < 10 && !retryTested; attempt++) {
    const eRetry = new YGOProEngine({ core, deck1Cards: mitsCards, deck2Cards: mitsCards, isSoloVsAi: false });
    let steps = 0;
    while (eRetry.pendingMessage && eRetry.winner === null && steps++ < 150) {
      const m = eRetry.pendingMessage;
      if (m.type === OcgMessageType.ANNOUNCE_CARD && (m.opcodes?.length || 0) > 0) {
        retryTested = true;
        // Intentionally declare an invalid passcode (Token / non-matching Dark Hole 53129443)
        const badRes = eRetry.dispatchAction(m.player, {
          type: 'OCG_RESPONSE',
          response: { type: OcgResponseType.ANNOUNCE_CARD, card: 53129443 }
        });
        assert.equal(badRes.ok, false, 'Invalid ANNOUNCE_CARD should report error on RETRY');
        assert.ok(eRetry.pendingMessage, 'pendingMessage MUST be preserved across MSG_RETRY');
        assert.equal(eRetry.pendingMessage.type, OcgMessageType.ANNOUNCE_CARD);

        // Now send AI-computed valid opcode-matched card and verify recovery
        const goodResp = eRetry._computeAiResponse(eRetry.pendingMessage);
        const goodRes = eRetry.dispatchAction(eRetry.pendingMessage.player, { type: 'OCG_RESPONSE', response: goodResp });
        assert.equal(goodRes.ok, true, 'Engine should recover cleanly after valid response following RETRY');
        break;
      }
      const resp = eRetry._computeAiResponse(m);
      if (!resp) break;
      const res = eRetry.dispatchAction(m.player, { type: 'OCG_RESPONSE', response: resp });
      assert.equal(res.ok, true, `Auto step should succeed without RETRY on prompt ${m.type}`);
    }
    eRetry.destroy();
  }
  assert.equal(retryTested, true, 'Should exercise RETRY recovery on ANNOUNCE_CARD in mdm_mitsurugi');

  // 19d. Verify _solveSelectSum, SORT_CHAIN, SELECT_COUNTER, ROCK_PAPER_SCISSORS & triggerPlayerIndex
  const eHelpers = new YGOProEngine({ core, deck1Cards: filler, deck2Cards: filler, isSoloVsAi: false });
  assert.deepEqual(
    eHelpers._solveSelectSum({
      select_max: 0,
      amount: 8,
      min: 1,
      max: 3,
      selects_must: [],
      selects: [{ amount: 11 }, { amount: 4 }, { amount: 4 }]
    }),
    [1, 2],
    'select_max=0 must pick exact sum [4,4]=8 instead of 11'
  );
  assert.deepEqual(
    eHelpers._solveSelectSum({
      select_max: 1,
      amount: 12,
      min: 0,
      max: 0,
      selects_must: [],
      selects: [{ amount: 10 }, { amount: 3 }, { amount: 10 }]
    }),
    [0, 1],
    'select_max=1 must pick minimal sum>=12 [10,3]=13'
  );
  assert.deepEqual(
    eHelpers._computeAiResponse({ type: OcgMessageType.SORT_CHAIN, player: 0, cards: [{ code: 1 }, { code: 2 }] }),
    { type: OcgResponseType.SORT_CARD, order: null }
  );
  assert.deepEqual(
    eHelpers._computeAiResponse({
      type: OcgMessageType.SELECT_COUNTER,
      player: 0,
      counter_type: 1,
      count: 3,
      cards: [{ count: 1 }, { count: 4 }]
    }),
    { type: OcgResponseType.SELECT_COUNTER, counters: [1, 2] }
  );
  assert.deepEqual(
    eHelpers._computeAiResponse({ type: OcgMessageType.ROCK_PAPER_SCISSORS, player: 0 }),
    { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: 1 }
  );
  eHelpers.chainStack = [{ chainLink: 1, playerIndex: 0, card: { name: 'Test Card' }, effect: { labelEn: 'Test' } }];
  eHelpers.pendingMessage = { type: OcgMessageType.SELECT_CHAIN, player: 0, selects: [], forced: false };
  const chainPrompt = eHelpers._buildPendingChainPrompt();
  assert.equal(chainPrompt.triggerPlayerIndex, 0, 'Chain prompt should report triggerPlayerIndex accurately');
  const legalChain = eHelpers.getLegalActions(0);
  assert.equal(legalChain.canChainRespond, true, 'getLegalActions should expose canChainRespond on SELECT_CHAIN');
  assert.equal(legalChain.chainPrompt?.triggerPlayerIndex, 0, 'getLegalActions.chainPrompt must preserve triggerPlayerIndex');
  assert.ok(
    eHelpers.recentEvents.some((ev) => ev.type === 'NEW_TURN' && ev.turnCount === 1 && ev.turnPlayer === 0),
    'YGOProEngine should record Turn 1 NEW_TURN event in recentEvents'
  );
  eHelpers.destroy();
}
console.log('✅ Test 19 Passed: YGOProEngine Chain Resolution, MSG_RETRY Recovery & Prompt Handlers ทำงานสมบูรณ์!\n');

// Test 20: Turn-Transition Events (NEW_TURN) & Center Turn Banner Config
{
  const core = await getSharedOcgCore();
  const filler = Array.from({ length: 40 }, () => ({ passcode: '89631139' }));
  const eTurnTrack = new YGOProEngine({ core, deck1Cards: filler, deck2Cards: filler, isSoloVsAi: true });
  const t1State = eTurnTrack.state;
  const t1Events = (t1State.recentEvents || []).filter((ev) => ev.type === 'NEW_TURN');
  assert.equal(t1Events.length, 1, 'Solo startup should emit Turn 1 NEW_TURN event');
  assert.equal(t1Events[0].turnCount, 1);
  assert.equal(t1Events[0].turnPlayer, 0);

  const endRes = eTurnTrack.dispatchAction(0, { type: 'END_TURN' });
  assert.equal(endRes.ok, true, 'Player 0 should be able to end Turn 1 cleanly');
  const nextState = eTurnTrack.state;
  const turnEvents = (nextState.recentEvents || []).filter((ev) => ev.type === 'NEW_TURN');
  assert.ok(
    turnEvents.some((ev) => ev.turnCount === 2 && ev.turnPlayer === 1),
    'Ending Turn 1 in Solo mode must record Turn 2 opponent NEW_TURN event even when AI turn resolves synchronously'
  );
  assert.ok(
    turnEvents.some((ev) => ev.turnCount === 3 && ev.turnPlayer === 0),
    'Turn 2 completion should record Turn 3 player NEW_TURN event in sequence'
  );
  for (let i = 1; i < turnEvents.length; i++) {
    assert.ok(turnEvents[i].seq > turnEvents[i - 1].seq, 'NEW_TURN event seq must be strictly increasing');
  }
  eTurnTrack.destroy();

  const indexHtml = fs.readFileSync('public/index.html', 'utf8');
  assert.match(indexHtml, /id="turn-change-banner"[^>]*role="status"[^>]*aria-live="polite"/);

  const animJs = fs.readFileSync('public/js/cardAnimations.js', 'utf8');
  assert.match(animJs, /TURN_BANNER_DURATION_MS\s*=\s*1500/);
  assert.ok(animJs.includes("'YOUR TURN'") && animJs.includes("'YOUR OPPONENT TURN'"));
  assert.ok(animJs.includes("'is-self-turn'") && animJs.includes("'is-opp-turn'"));

  const stylesCss = fs.readFileSync('public/css/styles.css', 'utf8');
  assert.match(stylesCss, /\.turn-change-banner\s*\{[^}]*pointer-events:\s*none/s);
  assert.ok(stylesCss.includes('1500ms'));
  assert.ok(stylesCss.includes('.turn-banner-card.is-self-turn'));
  assert.ok(stylesCss.includes('.turn-banner-card.is-opp-turn'));
  assert.ok(stylesCss.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(!stylesCss.includes('backdrop-filter: blur('), 'Styles must avoid backdrop-filter: blur(...)');
}
console.log('✅ Test 20 Passed: NEW_TURN Events & 1.5s Center Turn Banner Verification ทำงานสมบูรณ์!\n');

// Test 21: Cross-Wi-Fi Networking, /api/ice-servers, WS Heartbeat/Rejoin, Distinct Names & P2P UI Contracts
{
  const getFreePort = () => new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      probe.close(() => resolve(addr.port));
    });
  });

  const startTestServer = async (extraEnv = {}) => {
    const port = await getFreePort();
    const child = spawn(process.execPath, ['server.js'], {
      env: { ...process.env, PORT: String(port), ENABLE_CLOUD_RELAY: '0', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${baseUrl}/api/ice-servers`);
        if (res.ok) return { child, port, baseUrl };
      } catch {
        // Server still booting
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    child.kill();
    throw new Error('Timed out waiting for test server startup');
  };

  const stopTestServer = async (child) => {
    if (!child || child.exitCode !== null) return;
    const closed = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await Promise.race([closed, new Promise((r) => setTimeout(r, 1500))]);
  };

  const createWsClient = (wsUrl) => new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const queue = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const idx = waiters.findIndex((w) => w.predicate(msg));
      if (idx >= 0) {
        const [waiter] = waiters.splice(idx, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      } else {
        queue.push(msg);
      }
    });
    ws.nextMsg = (predicate, timeoutMs = 4000) => {
      const qIdx = queue.findIndex(predicate);
      if (qIdx >= 0) return Promise.resolve(queue.splice(qIdx, 1)[0]);
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('Timed out waiting for WS message')), timeoutMs);
        waiters.push({ predicate, resolve: res, timer });
      });
    };
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });

  // 21A: Verify /api/ice-servers (default STUN) + network-info filtering
  {
    const srv = await startTestServer({
      TURN_URLS: '',
      TURN_USERNAME: '',
      TURN_CREDENTIAL: '',
      METERED_APP_NAME: '',
      METERED_API_KEY: ''
    });
    try {
      const iceRes = await fetch(`${srv.baseUrl}/api/ice-servers`);
      assert.equal(iceRes.status, 200);
      const iceJson = await iceRes.json();
      assert.equal(iceJson.ok, true);
      assert.equal(iceJson.hasTurn, false);
      assert.ok(Array.isArray(iceJson.iceServers) && iceJson.iceServers.some((s) => String(s.urls).includes('stun.cloudflare.com')));
      assert.ok(iceJson.iceServers.some((s) => String(s.urls).includes('stun.l.google.com')));
      assert.ok(!JSON.stringify(iceJson.iceServers).includes('openrelay.metered.ca'), 'Must not bundle blackholed openrelay.metered.ca');

      const netRes = await fetch(`${srv.baseUrl}/api/network-info`);
      assert.equal(netRes.status, 200);
      const netJson = await netRes.json();
      assert.ok(Array.isArray(netJson.ips));
      for (const ip of netJson.ips) {
        const addr = String(ip.address || ip.ip || '');
        assert.ok(!addr.startsWith('169.254.'), 'APIPA 169.254.x.x should be filtered out');
        assert.ok(String(ip.url || '').startsWith('http'), 'Network info entry must expose valid URL');
      }

      // 21B: Verify WS Room create -> duplicate player name disambiguation -> rejoin -> leave cleanup
      const hostWs = await createWsClient(`ws://127.0.0.1:${srv.port}`);
      const guestWs = await createWsClient(`ws://127.0.0.1:${srv.port}`);
      let guestWs2 = null;
      try {
        hostWs.send(JSON.stringify({ type: 'CREATE_ROOM', playerName: 'Duelist 1', deckId: 'blue_eyes_meta' }));
        const created = await hostWs.nextMsg((m) => m.type === 'ROOM_CREATED');
        assert.ok(created.roomCode && created.reconnectToken, 'CREATE_ROOM should return roomCode and reconnectToken');

        guestWs.send(JSON.stringify({
          type: 'JOIN_ROOM',
          roomCode: created.roomCode,
          playerName: 'Duelist 1',
          deckId: 'swordsoul_tenyi'
        }));
        const hostRpsInit = await hostWs.nextMsg((m) => m.type === 'RPS_STATE');
        const guestRpsInit = await guestWs.nextMsg((m) => m.type === 'RPS_STATE');
        assert.equal(hostRpsInit.seat, 0);
        assert.equal(guestRpsInit.seat, 1);
        assert.ok(guestRpsInit.reconnectToken, 'JOIN_ROOM RPS_STATE should issue guest reconnectToken');
        assert.notEqual(hostRpsInit.opponentName, 'Duelist 1', 'Duplicate player name must be disambiguated');
        assert.equal(guestRpsInit.opponentName, 'Duelist 1');
        assert.equal(hostRpsInit.rpsState.phase, 'PICKING');

        // Round 1 tie + privacy check: opponentReady true, secret move hidden
        hostWs.send(JSON.stringify({ type: 'RPS_MOVE', move: 'ROCK' }));
        const hostAfterPick = await hostWs.nextMsg((m) => m.type === 'RPS_STATE');
        const guestSawHostReady = await guestWs.nextMsg((m) => m.type === 'RPS_STATE');
        assert.equal(hostAfterPick.rpsState.myMove, 'ROCK');
        assert.equal(guestSawHostReady.rpsState.opponentReady, true);
        assert.ok(!JSON.stringify(guestSawHostReady.rpsState).includes('ROCK'), 'Opponent RPS pick must stay hidden before reveal');

        guestWs.send(JSON.stringify({ type: 'RPS_MOVE', move: 'ROCK' }));
        const guestTie = await guestWs.nextMsg((m) => m.type === 'RPS_STATE');
        await hostWs.nextMsg((m) => m.type === 'RPS_STATE');
        assert.equal(guestTie.rpsState.round, 2);
        assert.equal(guestTie.rpsState.lastRound?.result, 'DRAW');

        // Round 2: Guest wins (ROCK vs SCISSORS) -> Guest chooses FIRST
        hostWs.send(JSON.stringify({ type: 'RPS_MOVE', move: 'SCISSORS' }));
        await hostWs.nextMsg((m) => m.type === 'RPS_STATE');
        await guestWs.nextMsg((m) => m.type === 'RPS_STATE');
        guestWs.send(JSON.stringify({ type: 'RPS_MOVE', move: 'ROCK' }));
        const guestWonRps = await guestWs.nextMsg((m) => m.type === 'RPS_STATE');
        await hostWs.nextMsg((m) => m.type === 'RPS_STATE');
        assert.equal(guestWonRps.rpsState.phase, 'CHOOSE_TURN');
        assert.equal(guestWonRps.rpsState.winnerSeat, 1);

        // Unauthorized loser choosing turn order must fail cleanly
        hostWs.send(JSON.stringify({ type: 'RPS_CHOOSE_TURN', choice: 'FIRST' }));
        const unauthErr = await hostWs.nextMsg((m) => m.type === 'ROOM_ERROR');
        assert.ok(unauthErr.errorTh);

        guestWs.send(JSON.stringify({ type: 'RPS_CHOOSE_TURN', choice: 'FIRST' }));
        const hostStart = await hostWs.nextMsg((m) => m.type === 'MATCH_STARTED');
        const guestStart = await guestWs.nextMsg((m) => m.type === 'MATCH_STARTED');
        // Guest chose FIRST so Guest gets engine Turn-1 slot (playerIndex 0), Host gets playerIndex 1
        assert.equal(guestStart.playerIndex, 0);
        assert.equal(hostStart.playerIndex, 1);
        assert.equal(guestStart.rpsSummary?.firstSeat, 1);

        const guestSync = await guestWs.nextMsg((m) => m.type === 'DUEL_STATE_SYNC');
        assert.equal(guestSync.playerIndex, 0);

        // Simulate abrupt disconnect and reconnect within grace period (preserves Guest's swapped engine playerIndex 0)
        guestWs.terminate();
        await new Promise((r) => setTimeout(r, 150));

        guestWs2 = await createWsClient(`ws://127.0.0.1:${srv.port}`);
        guestWs2.send(JSON.stringify({
          type: 'REJOIN_ROOM',
          roomCode: created.roomCode,
          reconnectToken: guestRpsInit.reconnectToken
        }));
        const rejoinedMsg = await guestWs2.nextMsg((m) => m.type === 'MATCH_STARTED');
        assert.equal(rejoinedMsg.rejoined, true);
        assert.equal(rejoinedMsg.playerIndex, 0);
        const rejoinSync = await guestWs2.nextMsg((m) => m.type === 'DUEL_STATE_SYNC');
        assert.equal(rejoinSync.playerIndex, 0);

        hostWs.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
        await new Promise((r) => setTimeout(r, 150));
        const afterLeaveInfo = await (await fetch(`${srv.baseUrl}/api/network-info`)).json();
        assert.equal((afterLeaveInfo.openRooms || []).length, 0, 'Room should be cleaned up after LEAVE_ROOM');
      } finally {
        hostWs.close();
        guestWs.close();
        guestWs2?.close();
      }
    } finally {
      await stopTestServer(srv.child);
    }
  }

  // 21C: Verify TURN env config on /api/ice-servers
  {
    const srvTurn = await startTestServer({
      TURN_URLS: 'turn:turn.example.com:3478,turns:turn.example.com:443?transport=tcp',
      TURN_USERNAME: 'u1',
      TURN_CREDENTIAL: 'p1'
    });
    try {
      const turnJson = await (await fetch(`${srvTurn.baseUrl}/api/ice-servers`)).json();
      assert.equal(turnJson.hasTurn, true);
      const turnEntry = turnJson.iceServers.find((s) => Array.isArray(s.urls));
      assert.ok(turnEntry, 'Configured TURN URLs should appear in iceServers');
      assert.equal(turnEntry.username, 'u1');
      assert.equal(turnEntry.credential, 'p1');
    } finally {
      await stopTestServer(srvTurn.child);
    }
  }

  // 21D: Verify Cross-Wi-Fi UI, TURN Settings, NAT Probe & P2P Hardening Markers
  const indexHtml = fs.readFileSync('public/index.html', 'utf8');
  for (const id of [
    'lan-info-box', 'lan-scope-hint', 'p2p-info-box', 'p2p-guidance-text',
    'p2p-live-status', 'p2p-turn-details', 'input-turn-url', 'input-turn-user',
    'input-turn-cred', 'chk-turn-force-relay', 'btn-save-turn', 'btn-clear-turn',
    'btn-test-ice', 'p2p-ice-test-result', 'btn-copy-room-code',
    'btn-copy-invite-link', 'btn-cancel-waiting-room'
  ]) {
    assert.ok(indexHtml.includes(`id="${id}"`), `Missing cross-Wi-Fi UI element #${id} in index.html`);
  }

  const networkJs = fs.readFileSync('public/js/network.js', 'utf8');
  assert.ok(networkJs.includes("serialization: 'json'"), 'PeerJS DataConnection must use JSON serialization');
  assert.ok(networkJs.includes('sendPeerJson') && networkJs.includes('__ygoChunk'), 'PeerJS transport must chunk large JSON payloads');
  assert.ok(networkJs.includes('testWebRtcConnectivity'), 'network.js must export testWebRtcConnectivity');
  assert.ok(networkJs.includes('ygo-md-p2p-'), 'network.js must use namespaced P2P peer IDs');
  assert.ok(!networkJs.includes('openrelay.metered.ca'), 'network.js must not hardcode blackholed openrelay.metered.ca');

  const appJs = fs.readFileSync('public/js/app.js', 'utf8');
  assert.ok(appJs.includes('updateMpTabUI'), 'app.js must toggle LAN vs P2P boxes cleanly');
  assert.ok(appJs.includes('buildSelectedCustomDeckPayload'), 'app.js must serialize custom decks/cards for remote play');
  assert.ok(appJs.includes('applyInviteQueryParams'), 'app.js must support ?room= / ?p2p= invite URLs');
}
console.log('✅ Test 21 Passed: Cross-Wi-Fi ICE/STUN/TURN, WS Rejoin, Distinct Names & P2P UI Contracts ทำงานสมบูรณ์!\n');

// Test 22: Rock-Paper-Scissors Session, Go First / Go Second Selection & Engine Start Order
{
  assert.equal(resolveRpsRound('ROCK', 'SCISSORS'), 0);
  assert.equal(resolveRpsRound('PAPER', 'ROCK'), 0);
  assert.equal(resolveRpsRound('SCISSORS', 'PAPER'), 0);
  assert.equal(resolveRpsRound('ROCK', 'PAPER'), 1);
  assert.equal(resolveRpsRound('PAPER', 'PAPER'), 'DRAW');

  const rps = new RpsSession(['Alice', 'Bob']);
  assert.equal(rps.submitMove(0, 'PAPER').roundResolved, false);
  const bView = rps.getPublicStateForSeat(1);
  assert.equal(bView.opponentReady, true);
  assert.equal(bView.myMove, null);
  assert.ok(!JSON.stringify(bView).includes('PAPER'), 'Hidden move must not be revealed before both choose');

  const tieRes = rps.submitMove(1, 'PAPER');
  assert.equal(tieRes.draw, true);
  assert.equal(rps.round, 2);

  rps.submitMove(0, 'ROCK');
  const winRes = rps.submitMove(1, 'PAPER');
  assert.equal(winRes.winnerSeat, 1);
  assert.equal(rps.phase, 'CHOOSE_TURN');
  assert.equal(rps.chooseTurnOrder(0, 'FIRST').ok, false, 'RPS loser must not choose turn order');

  // Winner (seat 1) tells opponent (seat 0) to start first via 'SECOND'
  const orderRes = rps.chooseTurnOrder(1, 'SECOND');
  assert.equal(orderRes.ok, true);
  assert.equal(orderRes.firstSeat, 0);

  // Verify DuelEngine starts Turn 1 on specified firstPlayerIndex (for Sandbox & P2P)
  const deSecondStarts = new DuelEngine({
    p0DeckId: 'blue_eyes_meta',
    p1DeckId: 'swordsoul_tenyi',
    firstPlayerIndex: 1
  });
  assert.equal(deSecondStarts.state.turnPlayer, 1, 'DuelEngine should start Turn 1 with Player 1 when firstPlayerIndex is 1');

  // Verify YGOProEngine Solo Mode with AI going first (aiIndex: 0 -> humanIndex: 1)
  const core = await getSharedOcgCore();
  const filler = Array.from({ length: 40 }, () => ({ passcode: '89631139' }));
  const ygoAiFirst = new YGOProEngine({
    core,
    player1Name: 'YGOPro AI',
    player2Name: 'Player 1',
    deck1Cards: filler,
    deck2Cards: filler,
    isSoloVsAi: true,
    aiIndex: 0
  });
  assert.equal(ygoAiFirst.humanIndex, 1);
  assert.ok(ygoAiFirst.state.turnCount >= 1);
  assert.equal(ygoAiFirst.pendingMessage?.player, 1, 'After AI takes Turn 1, YGOProEngine should pause waiting on human (player 1)');
  ygoAiFirst.destroy();

  // Verify HTML/CSS RPS modal contracts & modern-web-guidance rules
  const indexHtml = fs.readFileSync('public/index.html', 'utf8');
  for (const id of [
    'dialog-rps', 'btn-rps-rock', 'btn-rps-paper', 'btn-rps-scissors',
    'btn-rps-go-first', 'btn-rps-go-second', 'btn-rps-cancel', 'rps-status-text'
  ]) {
    assert.ok(indexHtml.includes(`id="${id}"`), `Missing #${id} in index.html`);
  }
  const stylesCss = fs.readFileSync('public/css/styles.css', 'utf8');
  assert.ok(stylesCss.includes('transition-behavior: allow-discrete'), 'RPS modal should use discrete top-layer transition');
  assert.ok(stylesCss.includes('@starting-style'), 'RPS modal should use @starting-style');
  assert.ok(stylesCss.includes('overscroll-behavior: contain'), 'Modals should prevent scroll chaining');
  assert.ok(!stylesCss.includes('backdrop-filter: blur('), 'Styles must remain free of backdrop-filter blur');
}
console.log('✅ Test 22 Passed: Rock-Paper-Scissors, Turn Order Selection & Engine First-Player ทำงานสมบูรณ์!\n');

// Test 23: YDKE (ydke://...) Encoder/Decoder & Live API Import/Cleanup
{
  const mainSample = [89631139, 89631139, 89631139, 14558127];
  const extraSample = [23995346, 59822133];
  const sideSample = [24224830];
  const ydkeUrl = buildYdkeUrl(mainSample, extraSample, sideSample);
  assert.ok(ydkeUrl.startsWith('ydke://'), 'buildYdkeUrl must start with ydke://');

  const parsed = parseYdkeUrl(`  Check out my deck: ${ydkeUrl}  `);
  assert.equal(parsed.isYdke, true);
  assert.deepEqual(parsed.mainCodes, mainSample);
  assert.deepEqual(parsed.extraCodes, extraSample);
  assert.deepEqual(parsed.sideCodes, sideSample);

  assert.equal(parseYdkeUrl('#main\n89631139').isYdke, false);
  assert.throws(() => parseYdkeUrl('ydke://AA==!!'), 'Non-4-byte-aligned YDKE payload must throw');

  // Verify live POST /api/custom-decks/import-ydk accepts ydke:// and cleanly deletes the test deck
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      probe.close(() => resolve(addr.port));
    });
  });
  const srvChild = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), ENABLE_CLOUD_RELAY: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 8000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${baseUrl}/api/network-info`);
        if (r.ok) { ready = true; break; }
      } catch { /* booting */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(ready, true, 'Test server should start for YDKE API test');

    const importRes = await fetch(`${baseUrl}/api/custom-decks/import-ydk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '__YDKE_TEST_DECK__', ydkText: ydkeUrl })
    });
    assert.equal(importRes.status, 200);
    const importData = await importRes.json();
    assert.equal(importData.ok, true);
    assert.equal(importData.stats.mainCount, 4);
    assert.equal(importData.stats.extraCount, 2);
    assert.ok(importData.deck?.id);

    // Clean up temporary test deck from persisted custom_decks.json
    const delRes = await fetch(`${baseUrl}/api/custom-decks?id=${encodeURIComponent(importData.deck.id)}`, {
      method: 'DELETE'
    });
    assert.equal(delRes.status, 200);
  } finally {
    const closed = new Promise((resolve) => srvChild.once('exit', resolve));
    srvChild.kill();
    await Promise.race([closed, new Promise((r) => setTimeout(r, 1500))]);
  }
}
console.log('✅ Test 23 Passed: YDKE Encoder/Decoder & Live API Import/Export ทำงานสมบูรณ์!\n');

// Test 24: CloudRelay (MQTT 3.1.1 over WS) Failover, Chunking, Mode 2 P2P & Mode 1 Cross-Server AP-Isolation Bypass
{
  const getFreePort = () => new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      probe.close(() => resolve(addr.port));
    });
  });

  // Minimal compliant MQTT 3.1.1 over WebSocket test broker
  const startLocalMqttWsBroker = async () => {
    const port = await getFreePort();
    const wssBroker = new WebSocketServer({ port, host: '127.0.0.1' });
    const subs = new Map(); // topic -> Set<WebSocket>
    const dec = new TextDecoder();

    const encodeRemLen = (len) => {
      const out = [];
      let rem = len;
      do {
        let d = rem % 128;
        rem = Math.floor(rem / 128);
        if (rem > 0) d |= 0x80;
        out.push(d);
      } while (rem > 0);
      return out;
    };

    wssBroker.on('connection', (ws) => {
      let rx = new Uint8Array(0);
      ws.on('message', (data) => {
        const chunk = data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const merged = new Uint8Array(rx.length + chunk.length);
        merged.set(rx, 0);
        merged.set(chunk, rx.length);
        rx = merged;

        while (rx.length >= 2) {
          const header = rx[0];
          const pType = header >> 4;
          let mult = 1;
          let remLen = 0;
          let idx = 1;
          let b = 0;
          let incomplete = false;
          do {
            if (idx >= rx.length) { incomplete = true; break; }
            b = rx[idx++];
            remLen += (b & 127) * mult;
            mult *= 128;
          } while ((b & 128) !== 0 && idx <= 5);
          if (incomplete || rx.length < idx + remLen) break;

          const fullPacket = rx.slice(0, idx + remLen);
          const payload = rx.subarray(idx, idx + remLen);
          rx = rx.subarray(idx + remLen);

          if (pType === 1) {
            // CONNECT -> CONNACK (0x20, len 2, flags 0, rc 0)
            ws.send(new Uint8Array([0x20, 0x02, 0x00, 0x00]));
          } else if (pType === 8) {
            // SUBSCRIBE -> parse packetId + topic -> SUBACK
            const pktIdHi = payload[0];
            const pktIdLo = payload[1];
            const tLen = (payload[2] << 8) | payload[3];
            const topic = dec.decode(payload.subarray(4, 4 + tLen));
            if (!subs.has(topic)) subs.set(topic, new Set());
            subs.get(topic).add(ws);
            ws.send(new Uint8Array([0x90, 0x03, pktIdHi, pktIdLo, 0x00]));
          } else if (pType === 3) {
            // PUBLISH -> forward to all subscribers on topic
            const tLen = (payload[0] << 8) | payload[1];
            const topic = dec.decode(payload.subarray(2, 2 + tLen));
            const targets = subs.get(topic);
            if (targets) {
              for (const clientWs of targets) {
                if (clientWs.readyState === 1) {
                  const remBytes = encodeRemLen(payload.length);
                  const out = new Uint8Array(1 + remBytes.length + payload.length);
                  out[0] = 0x30;
                  out.set(remBytes, 1);
                  out.set(payload, 1 + remBytes.length);
                  clientWs.send(out);
                }
              }
            }
          } else if (pType === 12) {
            // PINGREQ -> PINGRESP
            ws.send(new Uint8Array([0xd0, 0x00]));
          }
        }
      });

      ws.on('close', () => {
        for (const set of subs.values()) set.delete(ws);
      });
    });

    return {
      url: `ws://127.0.0.1:${port}/mqtt`,
      dropAllClients: () => {
        for (const clientWs of wssBroker.clients) {
          try { clientWs.close(); } catch { /* ignore */ }
        }
      },
      close: () => new Promise((resolve) => wssBroker.close(() => resolve()))
    };
  };

  const broker = await startLocalMqttWsBroker();
  const deadPort = await getFreePort();
  const deadUrl = `ws://127.0.0.1:${deadPort}/mqtt`;

  try {
    // Verify registerCustomDecks merges Host + Guest custom decks without wiping previous entries
    registerCustomDecks([{ id: 'ydk_host_test', name: 'Host Custom', mainDeckRecipe: [], extraDeckRecipe: [] }]);
    registerCustomDecks([{ id: 'ydk_guest_test', name: 'Guest Custom', mainDeckRecipe: [], extraDeckRecipe: [] }]);
    assert.ok(CUSTOM_DECKS.some((d) => d.id === 'ydk_host_test'), 'Host custom deck must not be wiped when Guest custom deck is registered');
    assert.ok(CUSTOM_DECKS.some((d) => d.id === 'ydk_guest_test'), 'Guest custom deck must be registered alongside Host custom deck');
    registerCustomDecks([], { replace: true });

    // Verify sliceUtf16Safe never splits a UTF-16 surrogate pair across chunk boundaries
    const boundaryEmojiStr = `${'A'.repeat(7499)}🐉${'B'.repeat(200)}`;
    const emojiSlices = sliceUtf16Safe(boundaryEmojiStr, 7500);
    assert.equal(emojiSlices[0].length, 7499, 'sliceUtf16Safe must back up 1 code unit rather than splitting a surrogate pair');
    assert.ok(emojiSlices[1].startsWith('🐉'), 'Second slice must begin with intact surrogate pair');
    const reEncoded = emojiSlices
      .map((s) => new TextDecoder().decode(new TextEncoder().encode(s)))
      .join('');
    assert.equal(reEncoded, boundaryEmojiStr, 'UTF-8 round-trip of chunks must not corrupt emojis into U+FFFD');

    // 24A: Multi-broker failover + large chunked JSON publish/subscribe (>35 KB)
    const c1 = new MqttWssClient({
      WebSocketClass: WebSocket,
      brokerUrls: [deadUrl, broker.url],
      clientIdPrefix: 'test_c1'
    });
    const c2 = new MqttWssClient({
      WebSocketClass: WebSocket,
      brokerUrls: [broker.url],
      clientIdPrefix: 'test_c2'
    });

    const connectedUrl = await c1.connect(1500);
    assert.equal(connectedUrl, broker.url, 'MqttWssClient should fail over from dead broker URL to healthy broker URL');
    await c2.connect(1500);

    let receivedLarge = null;
    await c2.subscribe('ygo_test/chunked', (msg) => {
      receivedLarge = msg;
    });

    const hugePayload = {
      type: 'HUGE_STATE_TEST',
      boundaryCheck: boundaryEmojiStr,
      cards: Array.from({ length: 120 }, (_, i) => ({
        index: i,
        name: `Blue-Eyes Test Dragon 🐉 #${i}`,
        desc: 'This legendary dragon is a powerful engine of destruction 📋⚡. '.repeat(4)
      }))
    };
    assert.ok(JSON.stringify(hugePayload).length > 30000, 'Test payload must exceed 30KB to exercise multi-chunk splitting');

    const gotLarge = new Promise((resolve) => {
      c2.topicHandlers.set('ygo_test/chunked', (msg) => resolve(msg));
    });
    c1.publishChunkedJson('ygo_test/chunked', hugePayload);
    const reassembled = await gotLarge;
    assert.deepEqual(reassembled, hugePayload, 'Large chunked JSON payload (with boundary emojis) must reassemble identically');

    // 24B: CloudRelayPeerConnection Mode 2 P2P data, mid-duel broker drop auto-reconnect & close propagation
    const hostConn = new CloudRelayPeerConnection({
      client: c1,
      peerId: 'ygo-md-p2p-999999',
      sendTopic: 'ygo_test/p2p/to_guest',
      role: 'host',
      serialization: 'json'
    });
    const guestConn = new CloudRelayPeerConnection({
      client: c2,
      peerId: 'ygo-md-p2p-999999',
      sendTopic: 'ygo_test/p2p/to_host',
      role: 'guest',
      serialization: 'json'
    });

    let guestClosed = false;
    guestConn.on('close', () => { guestClosed = true; });

    await c1.subscribe('ygo_test/p2p/to_host', (pkt) => {
      if (pkt.__ygoRelayClose) hostConn.close({ notifyPeer: false });
      else hostConn._emitData(pkt);
    });
    await c2.subscribe('ygo_test/p2p/to_guest', (pkt) => {
      if (pkt.__ygoRelayClose) guestConn.close({ notifyPeer: false });
      else guestConn._emitData(pkt);
    });

    const p2pMsgPromise = new Promise((resolve) => hostConn.on('data', resolve));
    guestConn.send({ type: 'P2P_PING', ok: true });
    const p2pMsg = await p2pMsgPromise;
    assert.deepEqual(p2pMsg, { type: 'P2P_PING', ok: true });

    // Simulate mid-duel broker connection drop: kick both clients from broker and verify auto-reconnect + topic re-subscription
    const c1Reconnected = new Promise((resolve) => { c1.onReconnect = resolve; });
    const c2Reconnected = new Promise((resolve) => { c2.onReconnect = resolve; });
    broker.dropAllClients();
    await Promise.all([c1Reconnected, c2Reconnected]);
    assert.equal(hostConn.open, true, 'hostConn must stay open across transient broker socket drop');
    assert.equal(guestConn.open, true, 'guestConn must stay open across transient broker socket drop');

    const postDropMsgPromise = new Promise((resolve) => guestConn.on('data', resolve));
    hostConn.send({ type: 'P2P_AFTER_BROKER_DROP_RECOVERY', turn: 3 });
    const postDropMsg = await postDropMsgPromise;
    assert.deepEqual(postDropMsg, { type: 'P2P_AFTER_BROKER_DROP_RECOVERY', turn: 3 });

    const guestClosePromise = new Promise((resolve) => guestConn.on('close', resolve));
    hostConn.close({ notifyPeer: true });
    await guestClosePromise;
    assert.equal(guestClosed, true, 'Closing hostConn with notifyPeer:true should propagate __ygoRelayClose and close guestConn');

    // 24C: End-to-End Cross-Server Mode 1 Room Bridging (Server A <-> Broker <-> Server B)
    // Simulates two friends on the same Wi-Fi with AP Client Isolation running separate servers
    const startRelayServer = async () => {
      const port = await getFreePort();
      const child = spawn(process.execPath, ['server.js'], {
        env: {
          ...process.env,
          PORT: String(port),
          ENABLE_CLOUD_RELAY: '1',
          CLOUD_RELAY_URLS: broker.url
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const baseUrl = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        try {
          const r = await fetch(`${baseUrl}/api/network-info`);
          if (r.ok) return { child, port, baseUrl };
        } catch { /* booting */ }
        await new Promise((r) => setTimeout(r, 100));
      }
      child.kill();
      throw new Error('Timed out booting relay test server');
    };

    const stopRelayServer = async (child) => {
      if (!child || child.exitCode !== null) return;
      const closed = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await Promise.race([closed, new Promise((r) => setTimeout(r, 1500))]);
    };

    const createWsClient = (wsUrl) => new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const queue = [];
      const waiters = [];
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        const idx = waiters.findIndex((w) => w.predicate(msg));
        if (idx >= 0) {
          const [waiter] = waiters.splice(idx, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(msg);
        } else {
          queue.push(msg);
        }
      });
      ws.nextMsg = (predicate, timeoutMs = 6000, label = 'message') => {
        const qIdx = queue.findIndex(predicate);
        if (qIdx >= 0) return Promise.resolve(queue.splice(qIdx, 1)[0]);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`Timed out waiting for bridged WS ${label}`)), timeoutMs);
          waiters.push({ predicate, resolve: res, timer });
        });
      };
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });

    const srvA = await startRelayServer();
    const srvB = await startRelayServer();
    let hostWs = null;
    let guestWs = null;
    let intruderWs = null;
    let guestWsRejoin = null;
    try {
      hostWs = await createWsClient(`ws://127.0.0.1:${srvA.port}`);
      guestWs = await createWsClient(`ws://127.0.0.1:${srvB.port}`);
      intruderWs = await createWsClient(`ws://127.0.0.1:${srvB.port}`);

      const baseBlueEyes = getPresetDeckById('blue_eyes_meta');
      const baseSwordsoul = getPresetDeckById('swordsoul_tenyi');
      const hostCustomDeck = {
        ...baseBlueEyes,
        id: 'ydk_host_bridged',
        name: 'Host Bridged YDK',
        isCustomYdk: true
      };
      const guestCustomDeck = {
        ...baseSwordsoul,
        id: 'ydk_guest_bridged',
        name: 'Guest Bridged YDK',
        isCustomYdk: true
      };

      // Host creates room on Server A with a custom deck
      hostWs.send(JSON.stringify({
        type: 'CREATE_ROOM',
        playerName: 'HostOnA',
        deckId: hostCustomDeck.id,
        customDeck: hostCustomDeck
      }));
      const roomCreated = await hostWs.nextMsg((m) => m.type === 'ROOM_CREATED', 6000, 'ROOM_CREATED');
      assert.equal(roomCreated.roomCode.length, 4);

      // Guest joins that 4-char room code from Server B with a custom deck
      guestWs.send(JSON.stringify({
        type: 'JOIN_ROOM',
        roomCode: roomCreated.roomCode,
        playerName: 'GuestOnB',
        deckId: guestCustomDeck.id,
        customDeck: guestCustomDeck
      }));

      const [hostRps, guestRps] = await Promise.all([
        hostWs.nextMsg((m) => m.type === 'RPS_STATE', 6000, 'host RPS_STATE init'),
        guestWs.nextMsg((m) => m.type === 'RPS_STATE', 6000, 'guest RPS_STATE init')
      ]);
      assert.equal(hostRps.seat, 0);
      assert.equal(guestRps.seat, 1);
      assert.equal(hostRps.opponentName, 'GuestOnB');
      assert.equal(guestRps.opponentName, 'HostOnA');
      assert.equal(hostRps.opponentCustomDeck?.id, 'ydk_guest_bridged', 'Host should receive Guest customDeck in RPS_STATE');
      assert.equal(guestRps.opponentCustomDeck?.id, 'ydk_host_bridged', 'Guest should receive Host customDeck in RPS_STATE');
      assert.ok(guestRps.reconnectToken, 'Bridged guest must receive reconnectToken');

      // 3rd client (intruderWs on Server B) attempts to join the same room during RPS -> must get ROOM_ERROR without hijacking Guest 1
      intruderWs.send(JSON.stringify({
        type: 'JOIN_ROOM',
        roomCode: roomCreated.roomCode,
        playerName: 'IntruderOnB',
        deckId: 'blue_eyes_meta'
      }));
      const intruderErr = await intruderWs.nextMsg((m) => m.type === 'ROOM_ERROR', 6000, 'intruder ROOM_ERROR');
      assert.ok(intruderErr.errorTh.includes('ครบแล้ว'), '3rd client must receive room full ROOM_ERROR');
      intruderWs.close();
      await new Promise((r) => setTimeout(r, 180));

      // Guest wins RPS (PAPER beats ROCK) and chooses FIRST
      hostWs.send(JSON.stringify({ type: 'RPS_MOVE', move: 'ROCK' }));
      await Promise.all([
        hostWs.nextMsg((m) => m.type === 'RPS_STATE', 6000, 'host RPS_STATE after ROCK'),
        guestWs.nextMsg((m) => m.type === 'RPS_STATE', 6000, 'guest RPS_STATE after ROCK')
      ]);
      guestWs.send(JSON.stringify({ type: 'RPS_MOVE', move: 'PAPER' }));
      const [hostRpsDone, guestRpsDone] = await Promise.all([
        hostWs.nextMsg((m) => m.type === 'RPS_STATE' && m.rpsState.phase === 'CHOOSE_TURN', 6000, 'host CHOOSE_TURN'),
        guestWs.nextMsg((m) => m.type === 'RPS_STATE' && m.rpsState.phase === 'CHOOSE_TURN', 6000, 'guest CHOOSE_TURN')
      ]);
      assert.equal(guestRpsDone.rpsState.winnerSeat, 1);

      guestWs.send(JSON.stringify({ type: 'RPS_CHOOSE_TURN', choice: 'FIRST' }));
      const [hostStarted, guestStarted, hostSync, guestSync] = await Promise.all([
        hostWs.nextMsg((m) => m.type === 'MATCH_STARTED', 6000, 'host MATCH_STARTED'),
        guestWs.nextMsg((m) => m.type === 'MATCH_STARTED', 6000, 'guest MATCH_STARTED'),
        hostWs.nextMsg((m) => m.type === 'DUEL_STATE_SYNC', 6000, 'host initial DUEL_STATE_SYNC'),
        guestWs.nextMsg((m) => m.type === 'DUEL_STATE_SYNC', 6000, 'guest initial DUEL_STATE_SYNC')
      ]);
      assert.equal(guestStarted.playerIndex, 0, 'Guest chose FIRST so Guest has playerIndex 0');
      assert.equal(hostStarted.playerIndex, 1, 'Host goes SECOND so Host has playerIndex 1');
      assert.equal(guestSync.state.turnPlayer, 0);
      assert.equal(hostSync.state.turnPlayer, 0);

      // Verify Emotes work in both directions across Server A <-> Server B even with swapped playerIndex
      guestWs.send(JSON.stringify({ type: 'EMOTE', emote: '🔥' }));
      const hostGotEmote = await hostWs.nextMsg((m) => m.type === 'OPPONENT_EMOTE', 6000, 'host OPPONENT_EMOTE');
      assert.equal(hostGotEmote.emote, '🔥');

      hostWs.send(JSON.stringify({ type: 'EMOTE', emote: '👍' }));
      const guestGotEmote = await guestWs.nextMsg((m) => m.type === 'OPPONENT_EMOTE', 6000, 'guest OPPONENT_EMOTE');
      assert.equal(guestGotEmote.emote, '👍');

      // Guest (Turn 1 playerIndex 0) dispatches END_TURN across the Cloud Relay bridge
      guestWs.send(JSON.stringify({ type: 'DUEL_ACTION', action: { type: 'END_TURN' } }));
      const [hostActionSync, guestActionSync] = await Promise.all([
        hostWs.nextMsg((m) => m.type === 'DUEL_STATE_SYNC' && m.lastAction?.type === 'END_TURN', 6000, 'host END_TURN sync'),
        guestWs.nextMsg((m) => m.type === 'DUEL_STATE_SYNC' && m.lastAction?.type === 'END_TURN', 6000, 'guest END_TURN sync')
      ]);
      assert.ok(hostActionSync.state.turnCount >= 1);
      assert.equal(hostActionSync.state.phase, guestActionSync.state.phase);

      // Guest drops connection to Server B and rejoins via REJOIN_ROOM across the Cloud Relay bridge
      guestWs.terminate();
      const hostSawReconnecting = await hostWs.nextMsg((m) => m.type === 'OPPONENT_RECONNECTING', 6000, 'host OPPONENT_RECONNECTING');
      assert.equal(hostSawReconnecting.graceSeconds, 60);

      guestWsRejoin = await createWsClient(`ws://127.0.0.1:${srvB.port}`);
      guestWsRejoin.send(JSON.stringify({
        type: 'REJOIN_ROOM',
        roomCode: roomCreated.roomCode,
        reconnectToken: guestRps.reconnectToken
      }));
      const [hostSawReconnected, guestRejoinedMatch, guestRejoinedSync] = await Promise.all([
        hostWs.nextMsg((m) => m.type === 'OPPONENT_RECONNECTED', 6000, 'host OPPONENT_RECONNECTED'),
        guestWsRejoin.nextMsg((m) => m.type === 'MATCH_STARTED', 6000, 'guest rejoined MATCH_STARTED'),
        guestWsRejoin.nextMsg((m) => m.type === 'DUEL_STATE_SYNC', 6000, 'guest rejoined DUEL_STATE_SYNC')
      ]);
      assert.ok(hostSawReconnected.messageTh);
      assert.equal(guestRejoinedMatch.rejoined, true);
      assert.equal(guestRejoinedMatch.playerIndex, 0);
      assert.equal(guestRejoinedSync.state.phase, hostActionSync.state.phase);

      // Guest triggers REMATCH across the Cloud Relay bridge
      guestWsRejoin.send(JSON.stringify({ type: 'REMATCH', deckId: 'branded_despia' }));
      const [hostRematchRps, guestRematchRps] = await Promise.all([
        hostWs.nextMsg((m) => m.type === 'RPS_STATE' && m.rematch === true),
        guestWsRejoin.nextMsg((m) => m.type === 'RPS_STATE' && m.rematch === true)
      ]);
      assert.equal(hostRematchRps.rpsState.phase, 'PICKING');
      assert.equal(guestRematchRps.rpsState.phase, 'PICKING');

      // Guest leaves room -> Host receives OPPONENT_DISCONNECTED
      guestWsRejoin.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
      const hostSawDisconnect = await hostWs.nextMsg((m) => m.type === 'OPPONENT_DISCONNECTED');
      assert.ok(hostSawDisconnect.messageTh);
    } finally {
      hostWs?.close();
      guestWs?.close();
      intruderWs?.close();
      guestWsRejoin?.close();
      await stopRelayServer(srvA.child);
      await stopRelayServer(srvB.child);
    }

    // 24D: End-to-End Mode 2 (6-digit Room Code) MultiplayerManager P2P Duel, Intruder Busy Rejection & Mid-Duel Broker Drop Recovery
    {
      const { pathToFileURL } = await import('node:url');
      const srcBaseUrl = pathToFileURL(`${process.cwd()}/src/`).href;
      const netSrc = fs.readFileSync('public/js/network.js', 'utf8').replace(/from '\/src\//g, `from '${srcBaseUrl}`);
      const { MultiplayerManager } = await import(`data:text/javascript;base64,${Buffer.from(netSrc).toString('base64')}`);

      const prevWs = globalThis.WebSocket;
      const prevUrls = globalThis.__YGO_CLOUD_RELAY_URLS;
      globalThis.WebSocket = WebSocket;
      globalThis.__YGO_CLOUD_RELAY_URLS = [broker.url];

      let hostMgr = null;
      let guestMgr = null;
      let intruderMgr = null;
      try {
        const hostEvents = { rps: [], match: [], sync: [], emotes: [], disconnected: [] };
        const guestEvents = { rps: [], match: [], sync: [], emotes: [], disconnected: [] };
        const intruderErrors = [];

        let resolveCreated;
        const createdPromise = new Promise((r) => { resolveCreated = r; });

        hostMgr = new MultiplayerManager({
          onRoomCreated: (info) => resolveCreated(info),
          onRpsState: (s) => hostEvents.rps.push(s),
          onMatchStarted: (m) => hostEvents.match.push(m),
          onStateSync: (s) => hostEvents.sync.push(s),
          onOpponentEmote: (e) => hostEvents.emotes.push(e),
          onOpponentDisconnected: (m) => hostEvents.disconnected.push(m)
        });
        guestMgr = new MultiplayerManager({
          onRpsState: (s) => guestEvents.rps.push(s),
          onMatchStarted: (m) => guestEvents.match.push(m),
          onStateSync: (s) => guestEvents.sync.push(s),
          onOpponentEmote: (e) => guestEvents.emotes.push(e),
          onOpponentDisconnected: (m) => guestEvents.disconnected.push(m)
        });
        intruderMgr = new MultiplayerManager({
          onError: (err) => intruderErrors.push(err)
        });

        const waitFor = async (predicate, timeoutMs = 4000, label = 'condition') => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            if (predicate()) return;
            await new Promise((r) => setTimeout(r, 25));
          }
          throw new Error(`Timed out waiting for Mode 2 P2P ${label}`);
        };

        await hostMgr.createP2PRoom('Mode2Host', 'blue_eyes_meta');
        const created = await createdPromise;
        assert.match(created.roomCode, /^\d{6}$/, 'Mode 2 P2P room code must be 6 digits');

        await guestMgr.joinP2PRoom(created.roomCode, 'Mode2Guest', 'swordsoul_tenyi');
        await waitFor(() => hostEvents.rps.length >= 1 && guestEvents.rps.length >= 1, 4000, 'initial RPS_STATE');
        assert.equal(hostEvents.rps[0].seat, 0);
        assert.equal(guestEvents.rps[0].seat, 1);

        // 3rd client attempts to join the active 6-digit P2P room -> must be rejected immediately via __ygoRelayBusy
        await intruderMgr.joinP2PRoom(created.roomCode, 'Mode2Intruder', 'blue_eyes_meta');
        await waitFor(() => intruderErrors.length >= 1, 4000, 'intruder busy error');
        assert.ok(intruderErrors[0].includes('ครบแล้ว'), 'Mode 2 P2P intruder must receive room full error');

        // Guest wins RPS (ROCK beats SCISSORS) and chooses FIRST
        hostMgr.sendRpsMove('SCISSORS');
        guestMgr.sendRpsMove('ROCK');
        await waitFor(
          () => hostEvents.rps.at(-1)?.rpsState?.phase === 'CHOOSE_TURN' && guestEvents.rps.at(-1)?.rpsState?.phase === 'CHOOSE_TURN',
          4000,
          'RPS CHOOSE_TURN'
        );
        guestMgr.sendRpsTurnChoice('FIRST');
        await waitFor(() => hostEvents.sync.length >= 1 && guestEvents.sync.length >= 1, 4000, 'initial P2P duel sync');
        assert.equal(guestEvents.sync.at(-1).state.turnPlayer, 1, 'Guest chose FIRST so turnPlayer must be 1');

        // Simulate mid-duel broker socket drop during Mode 2 P2P duel
        const hostReconn = new Promise((r) => { hostMgr.relayClient.onReconnect = r; });
        const guestReconn = new Promise((r) => { guestMgr.relayClient.onReconnect = r; });
        broker.dropAllClients();
        await Promise.all([hostReconn, guestReconn]);
        assert.equal(hostEvents.disconnected.length, 0, 'Host must not see false disconnect on transient broker drop');
        assert.equal(guestEvents.disconnected.length, 0, 'Guest must not see false disconnect on transient broker drop');

        // Guest sends emote and ends turn after mid-duel broker recovery
        guestMgr.sendEmote('🐉');
        await waitFor(() => hostEvents.emotes.includes('🐉'), 4000, 'emote after broker recovery');
        const prevSyncCount = hostEvents.sync.length;
        guestMgr.sendDuelAction({ type: 'CHANGE_PHASE', targetPhase: PHASES.EP });
        await waitFor(() => hostEvents.sync.length > prevSyncCount && hostEvents.sync.at(-1).state.turnPlayer === 0, 4000, 'turn change after broker recovery');

        // Guest triggers rematch, then leaves cleanly
        const prevRpsCount = hostEvents.rps.length;
        guestMgr.sendRematch('branded_despia');
        await waitFor(() => hostEvents.rps.length > prevRpsCount && hostEvents.rps.at(-1).rematch === true, 4000, 'P2P rematch RPS');

        guestMgr.disconnectRoom();
        await waitFor(() => hostEvents.disconnected.length >= 1, 4000, 'P2P guest leave disconnect notification');
      } finally {
        hostMgr?.destroyPeer();
        guestMgr?.destroyPeer();
        intruderMgr?.destroyPeer();
        registerCustomDecks([], { replace: true });
        globalThis.WebSocket = prevWs;
        globalThis.__YGO_CLOUD_RELAY_URLS = prevUrls;
      }
    }
  } finally {
    await broker.close();
  }
}
console.log('✅ Test 24 Passed: CloudRelay (MQTT-over-WSS) Failover, Chunking, Mode 2 P2P & Mode 1 Cross-Server Bridging ทำงานสมบูรณ์!\n');

console.log('🏆 การทดสอบทั้งหมดผ่าน 100%!');
