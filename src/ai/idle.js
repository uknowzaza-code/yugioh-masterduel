import { TYPE, CATEGORY, LOC, POS, EXTRA_DECK_TYPES } from './constants.js';
import { isFaceUp, isAttackPos, isLink } from './board.js';
import { ownCardValue, threatScore } from './evaluate.js';
import { resolveBattle, defenderUnits } from './battle.js';

function popCount(n) {
  let x = n >>> 0;
  let c = 0;
  while (x) {
    c += x & 1;
    x >>>= 1;
  }
  return c;
}

function getCardScales(card, kb) {
  const s = kb?.stats?.(card.code) ?? {};
  const lscale = card.lscale ?? s.lscale ?? 0;
  const rscale = card.rscale ?? s.rscale ?? lscale;
  return { lscale, rscale };
}

function analyzePendulumContext(view, kb) {
  const s0 = view.self.szone[0];
  const s4 = view.self.szone[4];
  const hasScale0 = Boolean(s0 && (s0.type & TYPE.PENDULUM));
  const hasScale4 = Boolean(s4 && (s4.type & TYPE.PENDULUM));
  const s0Val = hasScale0 ? getCardScales(s0, kb).lscale : null;
  const s4Val = hasScale4 ? getCardScales(s4, kb).rscale : null;
  const openScaleSlots = (!s0 ? 1 : 0) + (!s4 ? 1 : 0);
  const bothScalesSet = hasScale0 && hasScale4;

  const pendSummonablePool = (...exclude) => {
    const exSet = new Set(exclude.filter(Boolean).map((c) => cardKey(c)));
    const fromHand = view.self.hand.filter(
      (c) => c && (c.type & TYPE.MONSTER) && c.level >= 1 && c.level <= 12 && !exSet.has(cardKey(c)),
    );
    const fromExtra = view.self.extra.filter(
      (c) => c && isFaceUp(c) && (c.type & TYPE.PENDULUM) && c.level >= 1 && c.level <= 12 && !exSet.has(cardKey(c)),
    );
    return [...fromHand, ...fromExtra];
  };

  const countSummonableBetween = (a, b, pool) => {
    if (a === null || b === null) return 0;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi - lo <= 1) return 0;
    return pool.filter((m) => m.level > lo && m.level < hi).length;
  };

  const currentSummonable = bothScalesSet
    ? countSummonableBetween(s0Val, s4Val, pendSummonablePool())
    : 0;

  return {
    s0Val,
    s4Val,
    hasScale0,
    hasScale4,
    openScaleSlots,
    bothScalesSet,
    currentSummonable,
    hasPendulumInHand: view.self.hand.some((c) => c && (c.type & TYPE.PENDULUM)),
    pendSummonablePool,
    countSummonableBetween,
  };
}

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

  // หลีกเลี่ยงการเปิด Negate/Removal จากมือหรือสนาม (เช่น Baronne pop, Afterburners) ถ้าฝั่งตรงข้ามไม่มีเป้าหมายเลย
  if (
    (info.roles.has('negate') || info.roles.has('removal')) &&
    !info.roles.has('searcher') &&
    !info.roles.has('starter') &&
    !info.roles.has('extender')
  ) {
    if (view.isMyTurn && view.chain.length === 0 && oppMonsters.length === 0 && oppSt.length === 0) {
      return true;
    }
  }

  // Baronne de Fleur (84815190): เอฟเฟกต์ Main Phase คือทำลาย 1 ใบในสนาม — ห้ามเปิดถ้าฝั่งตรงข้ามไม่มีการ์ดบนสนาม (กันทำลายตัวเอง!)
  if (card.code === 84815190 && (card.location & LOC.MZONE) && oppMonsters.length === 0 && oppSt.length === 0) {
    return true;
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

function scorePendulumScaleActivation(card, info, strategy, view, kb, pendCtx) {
  if (pendCtx.openScaleSlots === 0) return -200;
  const myScale = getCardScales(card, kb).lscale;
  const existing = pendCtx.s0Val ?? pendCtx.s4Val;
  const pool = pendCtx.pendSummonablePool(card);

  if (existing !== null) {
    const canSummon = pendCtx.countSummonableBetween(existing, myScale, pool);
    if (canSummon >= 2) return strategy === 'combo' ? 1450 : 1200;
    if (canSummon === 1) return strategy === 'combo' ? 1120 : 920;
    if (info.roles.has('searcher') || info.roles.has('starter')) return 680;
    return -50;
  }

  let bestPairCount = 0;
  for (const other of view.self.hand) {
    if (!other || !(other.type & TYPE.PENDULUM) || cardKey(other) === cardKey(card)) continue;
    const otherScale = getCardScales(other, kb).lscale;
    const subPool = pendCtx.pendSummonablePool(card, other);
    const cnt = pendCtx.countSummonableBetween(myScale, otherScale, subPool);
    if (cnt > bestPairCount) bestPairCount = cnt;
  }
  if (bestPairCount >= 2) return strategy === 'combo' ? 1400 : 1150;
  if (bestPairCount === 1) return strategy === 'combo' ? 1080 : 880;
  if (pool.length > 0 && (myScale <= 2 || myScale >= 8)) return strategy === 'combo' ? 880 : 720;
  if (info.roles.has('searcher') || info.roles.has('starter')) return 850;
  return -50;
}

function scoreActivate(card, info, strategy, view, kb, pendCtx) {
  if ((card.type & TYPE.PENDULUM) && (card.location & LOC.HAND) && !(card.type & TYPE.SPELL) && strategy !== 'simple') {
    return scorePendulumScaleActivation(card, info, strategy, view, kb, pendCtx);
  }

  let score = 550;
  const isSpell = (card.type & TYPE.SPELL) !== 0;
  const isRitualSpell = isSpell && (card.type & TYPE.RITUAL) !== 0;
  const isFusionOrSpecialSpell = isSpell && (info.category & CATEGORY.SPECIAL_SUMMON) !== 0;
  const isHandExtender = (card.location & LOC.HAND) !== 0 && info.roles.has('extender');
  if (strategy === 'combo') {
    // เปิด Spell ค้นหา/จั่ว/Starter (ROTA, Emergence, Engage, Pot, Branded Fusion) ก่อน Normal Summon เสมอ!
    if (isSpell && (info.roles.has('searcher') || info.roles.has('starter'))) score += 1100;
    else {
      if (info.roles.has('searcher')) score += 520;
      if (info.roles.has('starter')) score += 480;
    }
    if (isRitualSpell) score += 850;
    else if (isFusionOrSpecialSpell) score += 700;
    if (info.roles.has('boardwipe')) score += 450;
    if (isHandExtender) score += 520;
    else if (info.roles.has('extender')) score += 360;
    if (info.roles.has('removal')) score += 280;
    if (info.roles.has('engine')) score += 240;
    if (info.roles.has('boss')) score += 180;
    if (card.type & TYPE.FIELD) score += 260;
  } else if (strategy === 'systematic') {
    if (isSpell && (info.roles.has('searcher') || info.roles.has('starter'))) score += 900;
    else if (info.roles.has('searcher') || info.roles.has('starter')) score += 380;
    if (isRitualSpell) score += 650;
    else if (isFusionOrSpecialSpell) score += 500;
    if (info.roles.has('boardwipe')) score += 320;
    if (isHandExtender) score += 420;
    else if (info.roles.has('extender')) score += 240;
    if (info.roles.has('removal')) score += 180;
    if (isSpell) score += 120;
  } else {
    score += isSpell ? 120 : 60;
  }
  return score;
}

function scoreNormalSummon(card, info, strategy, view, kb, msg) {
  // อย่าอัญเชิญ Hand Trap พลังต่ำ (เช่น Ash Blossom 0/1800, Maxx "C" 500/200) ลงสนามเปล่า ๆ ในโหมด Normal/Hard
  if (strategy !== 'simple' && info.roles.has('handtrap') && card.atk <= 1000 && !info.roles.has('starter')) {
    return -100;
  }
  let score = 400 + Math.min(card.atk, 3000) * 0.1;
  // Tribute Summon (Lv 5+): ลดคะแนนเฉพาะเมื่อมีทางเลือก Extra Deck / Extender ที่ดีกว่า; ถ้าไม่มีและมี fodder/Token หรือเอฟเฟกต์แรง ให้ลงได้
  if (strategy !== 'simple' && card.level >= 5) {
    const hasBetterPlay =
      (msg?.special_summons ?? []).length > 0 ||
      (msg?.activates ?? []).some((ref) => {
        const c = view.find(ref, kb);
        const i = kb.info(c.code);
        return !shouldSkipActivation(c, i, view, kb) && (i.roles.has('starter') || i.roles.has('searcher') || i.roles.has('extender'));
      });
    const hasExpendableFodder = view.self.mzone.some(
      (c) => c && ((c.type & TYPE.TOKEN) || (ownCardValue(c, kb) < 1200 && !kb.info(c.code).roles.has('boss'))),
    );
    const isStrongTributeEffect =
      (card.type & TYPE.EFFECT) !== 0 &&
      (card.atk >= 2000 || info.roles.has('boss') || info.roles.has('removal') || info.roles.has('searcher') || info.roles.has('extender'));

    if (hasBetterPlay) {
      score -= 400;
    } else if (hasExpendableFodder || isStrongTributeEffect) {
      if (hasExpendableFodder) score += 80;
      if (isStrongTributeEffect) score += 60;
    } else {
      score -= 400;
    }
  }
  const hasTunerOnField = view.self.mzone.some((c) => c && isFaceUp(c) && (c.type & TYPE.TUNER));
  const hasNonTunerAvailable =
    view.self.mzone.some((c) => c && isFaceUp(c) && !(c.type & TYPE.TUNER)) ||
    view.self.hand.some((c) => c && (c.type & TYPE.MONSTER) && !(c.type & TYPE.TUNER) && cardKey(c) !== cardKey(card));
  if (strategy === 'combo') {
    if (info.roles.has('starter')) score += 360;
    if (info.roles.has('searcher')) score += 300;
    if (info.roles.has('extender')) score += 180;
    if (card.type & TYPE.EFFECT) score += 90;
    if (card.type & TYPE.TUNER) score += hasNonTunerAvailable ? 220 : 120;
    else if (hasTunerOnField) score += 120;
  } else if (strategy === 'systematic') {
    if (info.roles.has('starter') || info.roles.has('searcher')) score += 220;
    if (card.type & TYPE.EFFECT) score += 60;
    if (card.type & TYPE.TUNER) score += hasNonTunerAvailable ? 140 : 80;
    else if (hasTunerOnField) score += 80;
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

const UTILITY_LOW_LINK_CODES = new Set([
  30342076, // Link Decoder
  24842059, // Linguriboh
  71818935, // Moon of the Closed Heaven
]);

const KEY_BOSS_CODES = new Set([
  86066372, // Accesscode Talker
  21848500, // Maliss <Q> Hearts Crypter
  4280258,  // Apollousa, Bow of the Goddess
  29301450, // S:P Little Knight
  34909328, // Ryzeal Detonator
  59242457, // Exosisters Magnifica
  27572350, // Bystial Dis Pater
  77075360, // Junk Speeder
  84815190, // Baronne de Fleur
  99585850, // Red Supernova Dragon
  9753964,  // Hot Red Dragon Archfiend Abyss
  63436931, // Crimson Dragon
  88021907, // Primathmech Laplacian
]);

function scoreSpecialSummon(card, info, strategy, kb, view, msg, pendCtx) {
  const myField = view.self.mzone.filter(Boolean);
  const oppField = view.opp.mzone.filter(Boolean);

  // Pendulum Summon (ocgcore ส่ง scale ใน SZONE เป็นตัวแทนใน msg.special_summons)
  if ((card.location & LOC.SZONE) && (card.type & TYPE.PENDULUM)) {
    const count = pendCtx?.currentSummonable ?? 0;
    if (strategy === 'simple') return 620;
    if (count >= 2) return strategy === 'combo' ? 1500 : 1250;
    if (count === 1) return strategy === 'combo' ? 1050 : 880;
    return 650;
  }

  // Sky Striker Link-1 discipline: ป้องกันการวน Link-1 ทิ้งเปล่า
  if (strategy !== 'simple') {
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

    // ป้องกันการลดเกรด Boss / High-Link ลงเป็น Utility Link-1/2 พลังต่ำ (Link Decoder, Linguriboh, Moon of the Closed Heaven)
    if (isLink(card)) {
      const targetRating = popCount(card.linkMarkers);
      const isLowUtilityLink = UTILITY_LOW_LINK_CODES.has(card.code) || (targetRating <= 2 && !info.roles.has('boss') && card.atk <= 1500);
      if (isLowUtilityLink && myField.length === 1) {
        const sole = myField[0];
        const soleInfo = kb.info(sole.code);
        const soleIsHighValue = soleInfo.roles.has('boss') || (isLink(sole) && popCount(sole.linkMarkers) >= 3) || sole.atk >= 2500;
        const needsClosedHeavenRemoval = card.code === 71818935 && oppField.some((o) => threatScore(o, kb) >= 2500);
        if (soleIsHighValue && card.atk < sole.atk && !needsClosedHeavenRemoval) {
          return -100;
        }
      }
    }
  }

  let score = 580 + Math.min(ownCardValue(card, kb), 4000) * 0.08;
  const isSynchroOrXyz = (card.type & (TYPE.SYNCHRO | TYPE.XYZ | TYPE.FUSION)) !== 0;
  const rating = isLink(card) ? popCount(card.linkMarkers) : 0;
  const isHighLinkBoss = isLink(card) && (rating >= 3 || info.roles.has('boss'));
  const isFreeHandGyExtender = (card.location & (LOC.HAND | LOC.GRAVE)) !== 0 && !(card.type & EXTRA_DECK_TYPES);

  if (strategy === 'combo') {
    if (isSynchroOrXyz) score += 480;
    if (isHighLinkBoss) score += 380;
    if (KEY_BOSS_CODES.has(card.code)) score += 220;
    if (card.code === 86066372 && oppField.length > 0) score += 180; // Accesscode Talker when opp has targets
    if (card.code === 4280258 && view.turn === 1) score += 160; // Apollousa Turn 1
    if (isFreeHandGyExtender) score += 320;
    if (info.roles.has('boss')) score += 360;
    if (info.roles.has('extender')) score += 260;
    if (info.roles.has('negate')) score += 280;
    if (card.type & EXTRA_DECK_TYPES) score += 220;
    if (card.code === CARD_SKY_STRIKER_HAYATE && msg?.to_bp && view.phase === 'main1' && view.turn > 1) score += 300;
    if (card.code === CARD_SKY_STRIKER_SHIZUKU && (!msg?.to_bp || view.phase === 'main2')) score += 300;
  } else if (strategy === 'systematic') {
    if (isSynchroOrXyz) score += 360;
    if (isHighLinkBoss) score += 260;
    if (KEY_BOSS_CODES.has(card.code)) score += 140;
    if (isFreeHandGyExtender) score += 220;
    if (card.type & EXTRA_DECK_TYPES) score += 200;
    if (info.roles.has('boss')) score += 220;
  } else if (isSynchroOrXyz) {
    score += 220;
  }
  return score;
}

function scoreSetMonster(card, info, strategy, view) {
  // อย่าหมอบ Hand Trap ลงสนาม (เช่น Ash Blossom / Ghost Ogre 0/1800) เก็บไว้ขัดบนมือ!
  if (info.roles.has('handtrap')) return -100;
  if (strategy === 'simple') return 120;
  const oppMaxAtk = Math.max(0, ...view.opp.mzone.filter((c) => c && isFaceUp(c)).map((c) => c.atk));
  const shouldWall = (card.def > card.atk && card.atk < 1500) || (view.turn === 1 && card.def >= 1800 && card.atk <= 1000) || (oppMaxAtk > card.atk && card.def >= oppMaxAtk);
  if (!shouldWall) return -100;
  return 240 + Math.min(card.def, 2500) * 0.05;
}

function scoreSetSpellTrap(card, info, strategy, brain, view, pendCtx) {
  if (brain.setsThisTurn >= brain.profile.maxSetsPerTurn) return -100;
  // หมอบเฉพาะ Trap หรือ Quick-Play Spell (ไม่หมอบ Normal Spell เปล่า ๆ ให้เสียช่อง เว้นแต่ Easy)
  const isTrap = (card.type & TYPE.TRAP) !== 0;
  const isQuick = (card.type & TYPE.QUICKPLAY) !== 0;
  if (strategy !== 'simple' && !isTrap && !isQuick) return -100;
  if (strategy === 'simple' && !brain.rng.chance(brain.profile.setSpellTrapChance)) return -100;

  // หลีกเลี่ยงการหมอบ S/T ลงช่อง Pendulum Zone (SZONE 0 หรือ 4) เมื่อมีการ์ด Pendulum บนมือและช่องกลาง (1,2,3) เต็มหมดแล้ว
  if (strategy !== 'simple' && pendCtx?.hasPendulumInHand && view) {
    const centerFree = !view.self.szone[1] || !view.self.szone[2] || !view.self.szone[3];
    if (!centerFree) return -100;
  }

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

  const pendCtx = analyzePendulumContext(view, kb);
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
    addCandidate('ACTIVATE', index, card, scoreActivate(card, info, strategy, view, kb, pendCtx), key);
  });

  (msg.summons ?? []).forEach((ref, index) => {
    const card = view.find(ref, kb);
    const info = kb.info(card.code);
    addCandidate('SUMMON', index, card, scoreNormalSummon(card, info, strategy, view, kb, msg));
  });

  (msg.special_summons ?? []).forEach((ref, index) => {
    const card = view.find(ref, kb);
    const info = kb.info(card.code);
    const key = `sp:${cardKey(ref)}`;
    if ((brain.activationCounts.get(key) ?? 0) >= 2) return;
    addCandidate('SPECIAL_SUMMON', index, card, scoreSpecialSummon(card, info, strategy, kb, view, msg, pendCtx), key);
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
    addCandidate('SET_ST', index, card, scoreSetSpellTrap(card, info, strategy, brain, view, pendCtx));
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
