import { TYPE, LOC, POS, EXTRA_DECK_TYPES } from './constants.js';
import { isFaceUp, isAttackPos, isLink } from './board.js';
import { ownCardValue, threatScore } from './evaluate.js';
import { resolveBattle, defenderUnits } from './battle.js';

function cardKey(c) {
  return `${c.code ?? 0}:${c.location ?? 0}:${c.sequence ?? 0}`;
}

function shouldSkipActivation(card, info, view, kb) {
  const oppMonsters = view.opp.mzone.filter(Boolean);
  const myMonsters = view.self.mzone.filter(Boolean);
  const oppSt = view.opp.szone.filter(Boolean);
  const mySt = view.self.szone.filter(Boolean);

  if (info.roles.has('boardwipe')) {
    if (info.side === 'opp') {
      return oppMonsters.length === 0;
    }
    if (info.side === 'both') {
      if (oppMonsters.length === 0) return true;
      const myVal = myMonsters.reduce((s, c) => s + ownCardValue(c, kb), 0);
      const oppVal = oppMonsters.reduce((s, c) => s + threatScore(c, kb), 0);
      return myVal >= oppVal;
    }
    if (info.side === 'opp_st') {
      return oppSt.length === 0;
    }
    if (info.side === 'both_st') {
      return oppSt.length === 0 || mySt.length >= oppSt.length;
    }
  }

  // หลีกเลี่ยงการใช้ Hand Trap เชิงรับ (เช่น Maxx "C", Veiler, Ash) ในเทิร์นตัวเองโดยไม่จำเป็น
  if (info.roles.has('handtrap') && view.isMyTurn && (card.location & LOC.HAND)) {
    if (info.timing === 'opp_turn_any' || info.timing === 'opp_summon5') return true;
    if (info.counters.has('monster_effect_field') && oppMonsters.length === 0) return true;
  }

  // หลีกเลี่ยงการทับ Field Spell ใบเดิมที่เปิดอยู่แล้ว
  if ((card.type & TYPE.FIELD) && (card.location & LOC.HAND)) {
    const activeField = view.self.szone[5];
    if (activeField && activeField.code === card.code) return true;
  }

  // หลีกเลี่ยงการเปิด Negate/Removal จากมือถ้าฝั่งตรงข้ามไม่มีเป้าหมาย
  if (info.roles.has('negate') && !info.roles.has('searcher') && !info.roles.has('starter') && !info.roles.has('extender')) {
    if (view.isMyTurn && view.chain.length === 0 && oppMonsters.length === 0 && oppSt.length === 0) {
      return true;
    }
  }

  return false;
}

function hasProfitableAttack(view, kb, profile) {
  const myAttackers = view.self.mzone.filter((c) => c && isFaceUp(c) && isAttackPos(c) && c.atk > 0);
  if (!myAttackers.length) return false;
  const defenders = defenderUnits(view, kb, profile);
  if (!defenders.length) return true;
  for (const a of myAttackers) {
    for (const d of defenders) {
      const r = resolveBattle(a.atk, d);
      if (r.killDef && (!r.killAtt || profile.battleStrategy === 'search')) return true;
      if (profile.battleStrategy === 'loose' && a.atk + profile.attackTolerance >= d.value) return true;
    }
  }
  return false;
}

function scoreActivate(card, info, strategy) {
  let score = 550;
  const isSpell = (card.type & TYPE.SPELL) !== 0;
  if (strategy === 'combo') {
    // เปิด Spell ค้นหา/จั่ว/Starter (ROTA, Emergence, Engage, Pot, Branded Fusion) ก่อน Normal Summon เสมอ!
    if (isSpell && (info.roles.has('searcher') || info.roles.has('starter'))) score += 1100;
    else {
      if (info.roles.has('searcher')) score += 520;
      if (info.roles.has('starter')) score += 480;
    }
    if (info.roles.has('boardwipe')) score += 450;
    if (info.roles.has('extender')) score += 340;
    if (info.roles.has('removal')) score += 280;
    if (info.roles.has('engine')) score += 240;
    if (info.roles.has('boss')) score += 180;
    if (card.type & TYPE.FIELD) score += 260;
  } else if (strategy === 'systematic') {
    if (isSpell && (info.roles.has('searcher') || info.roles.has('starter'))) score += 900;
    else if (info.roles.has('searcher') || info.roles.has('starter')) score += 380;
    if (info.roles.has('boardwipe')) score += 320;
    if (info.roles.has('extender')) score += 220;
    if (info.roles.has('removal')) score += 180;
    if (isSpell) score += 120;
  } else {
    score += isSpell ? 120 : 60;
  }
  return score;
}

function scoreNormalSummon(card, info, strategy, view) {
  // อย่าอัญเชิญ Hand Trap พลังต่ำ (เช่น Ash Blossom 0/1800, Maxx "C" 500/200) ลงสนามเปล่า ๆ ในโหมด Normal/Hard
  if (strategy !== 'simple' && info.roles.has('handtrap') && card.atk <= 1000 && !info.roles.has('starter')) {
    return -100;
  }
  let score = 400 + Math.min(card.atk, 3000) * 0.1;
  if (strategy === 'combo') {
    if (info.roles.has('starter')) score += 360;
    if (info.roles.has('searcher')) score += 300;
    if (info.roles.has('extender')) score += 180;
    if (card.type & TYPE.EFFECT) score += 90;
  } else if (strategy === 'systematic') {
    if (info.roles.has('starter') || info.roles.has('searcher')) score += 220;
    if (card.type & TYPE.EFFECT) score += 60;
  }
  // ใน Main 2 ไม่จำเป็นต้องรีบ Normal Summon มอนสเตอร์ธรรมดาพลังต่ำ
  if (view.phase === 'main2' && !(card.type & TYPE.EFFECT) && card.atk < 1500) {
    score -= 200;
  }
  return score;
}

const CARD_SKY_STRIKER_HAYATE = 8491308;
const CARD_SKY_STRIKER_SHIZUKU = 90673288;
const CARD_SKY_STRIKER_KAGARI = 63288573;

function scoreSpecialSummon(card, info, strategy, kb, view, msg) {
  // Sky Striker Link-1 discipline: ป้องกันการวน Link-1 ทิ้งเปล่า
  if (strategy !== 'simple') {
    const myField = view.self.mzone.filter(Boolean);
    const hasShizuku = myField.some((c) => c.code === CARD_SKY_STRIKER_SHIZUKU);
    const hasHayate = myField.some((c) => c.code === CARD_SKY_STRIKER_HAYATE);
    const spellsInGy = view.self.grave.filter((c) => (c.type & TYPE.SPELL) !== 0).length;
    const canBattle = Boolean(msg?.to_bp) && view.phase === 'main1' && view.turn > 1;

    // อย่าทับ Shizuku ด้วย Hayate ในเทิร์นที่โจมตีไม่ได้ (Turn 1 หรือ Main 2)
    if (card.code === CARD_SKY_STRIKER_HAYATE && !canBattle) {
      return -100;
    }
    // ถ้ามี Shizuku อยู่แล้วในเทิร์นที่โจมตีไม่ได้ ไม่ต้องเปลี่ยนเป็น Link-1 ตัวอื่น
    if (hasShizuku && !canBattle && (card.code === CARD_SKY_STRIKER_KAGARI || card.code === CARD_SKY_STRIKER_HAYATE)) {
      return -100;
    }
    // อย่าลง Kagari เมื่อสุสานยังไม่มี Spell ให้เก็บกลับมือ
    if (card.code === CARD_SKY_STRIKER_KAGARI && spellsInGy === 0) {
      return -100;
    }
    // ถ้ามี Hayate อยู่แล้วใน MP1 ที่กำลังจะตีตรง อย่าเพิ่งทับด้วย Shizuku จนกว่าจะจบ BP (MP2)
    if (hasHayate && canBattle && card.code === CARD_SKY_STRIKER_SHIZUKU) {
      return -100;
    }
  }

  let score = 520 + Math.min(ownCardValue(card, kb), 4000) * 0.08;
  if (strategy === 'combo') {
    if (info.roles.has('boss')) score += 320;
    if (info.roles.has('extender')) score += 260;
    if (info.roles.has('negate')) score += 250;
    if (card.type & EXTRA_DECK_TYPES) score += 180;
    if (card.code === CARD_SKY_STRIKER_HAYATE && msg?.to_bp && view.phase === 'main1' && view.turn > 1) score += 300;
    if (card.code === CARD_SKY_STRIKER_SHIZUKU && (!msg?.to_bp || view.phase === 'main2')) score += 300;
  } else if (strategy === 'systematic') {
    if (card.type & EXTRA_DECK_TYPES) score += 160;
    if (info.roles.has('boss')) score += 180;
  }
  return score;
}

function scoreSetMonster(card, info, strategy, view) {
  if (strategy === 'simple') return 120;
  const oppMaxAtk = Math.max(0, ...view.opp.mzone.filter((c) => c && isFaceUp(c)).map((c) => c.atk));
  const shouldWall = (card.def > card.atk && card.atk < 1500) || (view.turn === 1 && card.def >= 1800 && card.atk <= 1000) || (oppMaxAtk > card.atk && card.def >= oppMaxAtk);
  if (!shouldWall) return -100;
  if (info.roles.has('handtrap') && card.def < 1800) return -100;
  return 240 + Math.min(card.def, 2500) * 0.05;
}

function scoreSetSpellTrap(card, info, strategy, brain) {
  if (brain.setsThisTurn >= brain.profile.maxSetsPerTurn) return -100;
  // หมอบเฉพาะ Trap หรือ Quick-Play Spell (ไม่หมอบ Normal Spell เปล่า ๆ ให้เสียช่อง เว้นแต่ Easy)
  const isTrap = (card.type & TYPE.TRAP) !== 0;
  const isQuick = (card.type & TYPE.QUICKPLAY) !== 0;
  if (strategy !== 'simple' && !isTrap && !isQuick) return -100;
  if (strategy === 'simple' && !brain.rng.chance(brain.profile.setSpellTrapChance)) return -100;

  let score = 180;
  if (info.roles.has('negate') || info.roles.has('removal') || info.roles.has('floodgate')) score += 120;
  if (isTrap) score += 40;
  if (isQuick) score += 20;
  return score;
}

function scoreRepos(card, strategy, view, msg) {
  if (strategy === 'simple' || isLink(card)) return -100;
  const oppMaxAtk = Math.max(0, ...view.opp.mzone.filter((c) => c && isFaceUp(c)).map((c) => c.atk));
  if (isAttackPos(card)) {
    // อยู่ในท่าโจมตี -> เปลี่ยนเป็นป้องกันถ้าพลังโจมตีต่ำและป้องกันสูงกว่า (โดยเฉพาะ Turn 1 หรือ Main 2 หรือสู้ศัตรูไม่ได้)
    const danger = view.turn === 1 || view.phase === 'main2' || oppMaxAtk > card.atk;
    if (danger && card.def > card.atk && card.atk < 1500) {
      return 220;
    }
    return -100;
  }
  // อยู่ในท่าป้องกัน -> เปลี่ยนเป็นโจมตีถ้าเข้า Battle Phase ได้และตีชนะ/ตีตรงได้
  if (msg.to_bp && card.atk >= 1500 && (oppMaxAtk === 0 || card.atk > oppMaxAtk)) {
    return 260;
  }
  return -100;
}

export function decideIdle(brain, msg, view) {
  const { profile, kb, rng } = brain;
  const strategy = profile.idleStrategy;

  const endPhaseOrBattle = () => {
    if (msg.to_bp && hasProfitableAttack(view, kb, profile)) {
      return { type: 'SELECT_IDLECMD', action: 'TO_BP', index: null, reason: 'enter-battle' };
    }
    return { type: 'SELECT_IDLECMD', action: 'TO_EP', index: null, reason: 'end-main' };
  };

  if (brain.actionsThisTurn >= profile.maxActionsPerTurn) {
    return endPhaseOrBattle();
  }

  const candidates = [];
  const addCandidate = (action, index, rawCard, score, metaKey = null) => {
    if (score <= 0) return;
    const jitter = profile.idleJitter > 0 ? (rng.next() - 0.5) * 2 * profile.idleJitter : 0;
    candidates.push({ action, index, card: rawCard, score: score + jitter, metaKey });
  };

  (msg.activates ?? []).forEach((ref, index) => {
    const card = view.find(ref, kb);
    const info = kb.info(card.code);
    const key = `act:${cardKey(ref)}:${ref.desc ?? 0}`;
    if ((brain.activationCounts.get(key) ?? 0) >= 2) return;
    if (shouldSkipActivation(card, info, view, kb)) return;
    addCandidate('ACTIVATE', index, card, scoreActivate(card, info, strategy), key);
  });

  (msg.summons ?? []).forEach((ref, index) => {
    const card = view.find(ref, kb);
    const info = kb.info(card.code);
    addCandidate('SUMMON', index, card, scoreNormalSummon(card, info, strategy, view));
  });

  (msg.special_summons ?? []).forEach((ref, index) => {
    const card = view.find(ref, kb);
    const info = kb.info(card.code);
    const key = `sp:${cardKey(ref)}`;
    if ((brain.activationCounts.get(key) ?? 0) >= 2) return;
    addCandidate('SPECIAL_SUMMON', index, card, scoreSpecialSummon(card, info, strategy, kb, view, msg), key);
  });

  (msg.repos ?? []).forEach((ref, index) => {
    const card = view.find(ref, kb);
    const key = `pos:${cardKey(ref)}`;
    if (brain.posChangedKeys.has(key)) return;
    addCandidate('REPOS', index, card, scoreRepos(card, strategy, view, msg), key);
  });

  (msg.set_monsters ?? []).forEach((ref, index) => {
    const card = view.find(ref, kb);
    const info = kb.info(card.code);
    addCandidate('SET_MONSTER', index, card, scoreSetMonster(card, info, strategy, view));
  });

  (msg.set_st ?? []).forEach((ref, index) => {
    const card = view.find(ref, kb);
    const info = kb.info(card.code);
    addCandidate('SET_ST', index, card, scoreSetSpellTrap(card, info, strategy, brain));
  });

  if (!candidates.length) {
    return endPhaseOrBattle();
  }

  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates[0];

  brain.actionsThisTurn += 1;
  if (chosen.action === 'SET_ST') brain.setsThisTurn += 1;
  if (chosen.action === 'REPOS' && chosen.metaKey) brain.posChangedKeys.add(chosen.metaKey);
  if ((chosen.action === 'ACTIVATE' || chosen.action === 'SPECIAL_SUMMON') && chosen.metaKey) {
    brain.activationCounts.set(chosen.metaKey, (brain.activationCounts.get(chosen.metaKey) ?? 0) + 1);
  }

  return {
    type: 'SELECT_IDLECMD',
    action: chosen.action,
    index: chosen.index,
    reason: `${strategy}:${chosen.action.toLowerCase()}`,
  };
}
