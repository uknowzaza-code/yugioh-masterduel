import { TYPE, LOC, CATEGORY, SYSTEM_STRING, EXTRA_DECK_TYPES } from './constants.js';
import { isFaceUp } from './board.js';
import { effectTags } from './knowledge.js';
import { resolveBattle, defenderUnits } from './battle.js';

const CODE_SOLEMN_JUDGMENT = 41420027;
const CODE_BARONNE_DE_FLEUR = 84815190;
const CODE_SP_LITTLE_KNIGHT = 29301450;
const CODE_EFFECT_VEILER = 97268402;
const CODE_INFINITE_IMPERM = 10045474;
const CODE_WIDOW_ANCHOR = 98338152;

/** ประเมินระดับความอันตรายของเอฟเฟกต์ล่าสุดในเชน (0..140) */
export function chainDanger(link, view, kb) {
  if (!link) return 0;
  const info = kb.info(link.code);
  const tags = effectTags(link, info);
  let score = 15;

  if (tags.has('search')) score += 40;
  if (tags.has('draw')) score += 35;
  if (tags.has('spsummon')) score += 40;
  if (tags.has('negate')) score += 45;
  if (tags.has('removal')) score += 35;
  if (tags.has('mill')) score += 25;

  if (info.roles.has('starter')) score += 30;
  if (info.roles.has('boardwipe')) score += 45;
  if (info.roles.has('boss')) score += 30;
  if (info.roles.has('floodgate') || info.roles.has('engine')) score += 30;
  if (info.roles.has('negate')) score += 25;
  if (info.type & EXTRA_DECK_TYPES) score += 15;

  // ถ้าคู่แข่งกำลังเชนขัดเอฟเฟกต์ของเรา (CL ก่อนหน้าเป็นของเรา) ความอันตรายพุ่งสูงทันที!
  if (view.chain.length >= 2) {
    const prev = view.chain[view.chain.length - 2];
    if (prev && prev.player === view.me && (tags.has('negate') || tags.has('handtrap_response') || tags.has('removal'))) {
      score += 35;
    }
  }

  // ถ้า LP เราต่ำ เพิ่มความระวัง
  if (view.self.lp <= 3000) score += 15;
  return score;
}

/** ตรวจสอบว่าการ์ดในมือ/สนามของเราเหมาะสมจะเปิดเชนตอบโต้ link ล่าสุดหรือไม่ */
export function matchCounter(cardInfo, topLink, topInfo, view) {
  // เงื่อนไข timing พิเศษ (Maxx "C", Mulcharmy, Nibiru, Mirror Force)
  if (cardInfo.timing === 'opp_turn_any') {
    // ห้ามโยน Maxx "C" ใน End Phase หรือในเทิร์นเราที่คู่แข่งไม่ได้กำลัง Special Summon
    if (view.phase === 'end') return { ok: false, specificity: 0 };
    if (view.isMyTurn) {
      if (!topLink || topLink.player === view.me) return { ok: false, specificity: 0 };
      const tags = effectTags(topLink, topInfo);
      return tags.has('spsummon') ? { ok: true, specificity: 4 } : { ok: false, specificity: 0 };
    }
    return { ok: true, specificity: 3 };
  }
  if (cardInfo.timing === 'opp_summon5') {
    const oppFieldCount = view.opp.mzone.filter(Boolean).length;
    if (view.isMyTurn || (view.opp.summonsThisTurn < 5 && oppFieldCount < 3)) {
      return { ok: false, specificity: 0 };
    }
    return { ok: true, specificity: 4 };
  }
  if (cardInfo.timing === 'opp_attack') {
    if (view.isMyTurn || view.phase !== 'battle') return { ok: false, specificity: 0 };
    return { ok: true, specificity: 4 };
  }

  // การ์ด Negate มอนสเตอร์บนสนาม (Veiler / Imperm / Widow Anchor) ต้องมีมอนสเตอร์คู่แข่งที่ยังไม่ถูก Negate
  if (
    cardInfo.code === CODE_EFFECT_VEILER ||
    cardInfo.code === CODE_INFINITE_IMPERM ||
    cardInfo.code === CODE_WIDOW_ANCHOR
  ) {
    const validTargets = view.opp.mzone.filter((m) => m && isFaceUp(m) && !m.effectsNegated);
    if (!validTargets.length) return { ok: false, specificity: 0 };
  }

  if (!topLink) {
    if (cardInfo.roles.has('handtrap') || cardInfo.roles.has('negate')) {
      return { ok: false, specificity: 0 };
    }
    return { ok: true, specificity: 1 };
  }

  const tags = effectTags(topLink, topInfo);
  if (cardInfo.counters.has('any')) {
    return { ok: true, specificity: 1 };
  }
  for (const c of cardInfo.counters) {
    if (tags.has(c)) return { ok: true, specificity: 3 };
  }
  return { ok: false, specificity: 0 };
}

export function decideChain(brain, msg, view) {
  const { profile, kb, rng } = brain;
  const chains = msg.chains ?? [];
  const forced = !!msg.forced;
  if (!chains.length) {
    return { type: 'SELECT_CHAIN', index: null, reason: 'no-chains' };
  }
  if (forced) {
    return { type: 'SELECT_CHAIN', index: 0, reason: 'forced-chain' };
  }

  const topLink = view.chain.length ? view.chain[view.chain.length - 1] : null;
  const topIsMine = topLink ? topLink.player === view.me : false;
  const topLinkKey = topLink ? `${view.turn}:${view.chain.length}:${topLink.code}` : null;

  // โหมด Easy: เปิดแบบสุ่มเล็กน้อย แต่ยังคงห้ามขัดเชนของตัวเอง
  if (profile.chainStrategy === 'eager') {
    if (topIsMine) return { type: 'SELECT_CHAIN', index: null, reason: 'easy-skip-own-chain' };
    if (!rng.chance(profile.chainActivateChance)) {
      return { type: 'SELECT_CHAIN', index: null, reason: 'easy-pass' };
    }
    return { type: 'SELECT_CHAIN', index: rng.int(chains.length), reason: 'easy-activate' };
  }

  const topInfo = topLink ? kb.info(topLink.code) : null;
  const danger = topLink && !topIsMine ? chainDanger(topLink, view, kb) : 0;

  let bestIdx = null;
  let bestScore = 0;

  chains.forEach((opt, idx) => {
    const info = kb.info(opt.code);
    const isPureDisruption =
      (info.roles.has('handtrap') || info.roles.has('negate')) &&
      !(topIsMine && (info.roles.has('searcher') || info.roles.has('starter') || info.roles.has('extender')) && (opt.location & LOC.ONFIELD) && !(opt.location & LOC.HAND));

    // ห้ามใช้ Hand Trap / Negate ขัดเชนของตัวเอง หรือขัดเชนเดิมซ้ำสองรอบ
    if (isPureDisruption && topIsMine) return;
    if (isPureDisruption && topLinkKey && brain.negatedChainLinks.has(topLinkKey)) return;

    // อนุญาตให้ Trigger Combo ของเราเอง (เช่น Chixiao + Mo Ye, Albion, Despian Tragedy) เชนต่อจาก CL ของเราเองได้
    // แต่ห้ามเด็ดขาดที่จะเชน Omni-Negate (เช่น Baronne, Apollousa, Savage) หรือ Hand Trap ใส่ CL ของตัวเอง!
    if (topIsMine) {
      if (
        info.roles.has('handtrap') ||
        opt.code === CODE_BARONNE_DE_FLEUR ||
        opt.code === CODE_SOLEMN_JUDGMENT ||
        (info.category & CATEGORY.NEGATE) !== 0 ||
        (info.roles.has('negate') && !info.roles.has('searcher'))
      ) {
        return;
      }
      const isComboTrigger =
        info.roles.has('searcher') ||
        info.roles.has('starter') ||
        info.roles.has('extender') ||
        (info.category & (CATEGORY.SEARCH | CATEGORY.DRAW | CATEGORY.SPECIAL_SUMMON | CATEGORY.TOKEN));
      if (!isComboTrigger) return;
      const score = 70;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
      return;
    }

    const match = matchCounter(info, topLink, topInfo, view);
    if (!match.ok) return;

    if (info.roles.has('handtrap') || info.roles.has('negate')) {
      // โหมด Normal / Hard: ตรวจ threshold ความอันตราย (ยกเว้น Maxx "C" / Nibiru ที่มี timing เฉพาะ)
      if (!info.timing && danger < profile.chainDangerThreshold) return;
      // เลือกใบที่ตรงจุดและประหยัดที่สุดก่อน (Hand Trap เฉพาะทาง > Called By > Omni-Negate บนสนาม > Solemn Judgment ที่เสียครึ่ง LP)
      let score = danger + match.specificity * 22;
      if (info.roles.has('handtrap')) score += 18;
      if (opt.code === CODE_BARONNE_DE_FLEUR) score -= 8; // เก็บ Omni-Negate ไว้ถ้า Ash/Veiler ครอบคลุมแล้ว
      if (opt.code === CODE_SOLEMN_JUDGMENT) score -= 22; // เก็บ Solemn Judgment ไว้ท้ายสุดเพราะเสียครึ่ง LP
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
      return;
    }

    // การ์ดที่ไม่ใช่ disruption (เช่น Trigger/Quick effect ฝั่งเรา)
    const beneficial =
      info.roles.has('searcher') ||
      info.roles.has('extender') ||
      info.roles.has('starter') ||
      info.roles.has('removal') ||
      (info.category & (CATEGORY.SEARCH | CATEGORY.DRAW | CATEGORY.SPECIAL_SUMMON | CATEGORY.DESTROY | CATEGORY.REMOVE));

    if (beneficial) {
      if (info.roles.has('removal') && !info.roles.has('searcher') && !info.roles.has('extender') && !view.opp.mzone.some(Boolean) && !view.opp.szone.some(Boolean)) {
        return;
      }
      const score = 50 + match.specificity * 10;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }
  });

  if (bestIdx !== null && topLinkKey) {
    const chosenInfo = kb.info(chains[bestIdx].code);
    if (chosenInfo.roles.has('handtrap') || chosenInfo.roles.has('negate')) {
      brain.negatedChainLinks.add(topLinkKey);
    }
  }

  return {
    type: 'SELECT_CHAIN',
    index: bestIdx,
    reason: bestIdx !== null ? `${profile.chainStrategy}-activate` : `${profile.chainStrategy}-hold`,
  };
}

export function decideEffectYn(brain, msg, view) {
  const info = brain.kb.info(msg.code ?? 0);
  if (info.avoidOptional) {
    return { type: 'SELECT_EFFECTYN', yes: false, reason: 'avoid-optional' };
  }
  if (info.roles.has('boardwipe') && !view.opp.mzone.some(Boolean) && !view.opp.szone.some(Boolean)) {
    return { type: 'SELECT_EFFECTYN', yes: false, reason: 'empty-opp-board' };
  }
  // S:P Little Knight on-summon banish: ข้ามถ้าคู่แข่งไม่มีการ์ดทั้งบนสนามและสุสาน (ป้องกันเผลอ banish ตัวเอง)
  if (msg.code === CODE_SP_LITTLE_KNIGHT) {
    const oppHasTarget = view.opp.mzone.some(Boolean) || view.opp.szone.some(Boolean) || view.opp.grave.length > 0;
    if (!oppHasTarget) {
      return { type: 'SELECT_EFFECTYN', yes: false, reason: 'skip-sp-self-banish' };
    }
  }
  // Baronne de Fleur Standby Tag-out — เก็บ 3000 ATK Omni-Negate ไว้บนสนาม
  if (msg.code === CODE_BARONNE_DE_FLEUR && view.phase === 'standby') {
    return { type: 'SELECT_EFFECTYN', yes: false, reason: 'keep-baronne' };
  }
  return { type: 'SELECT_EFFECTYN', yes: true, reason: 'beneficial-effect' };
}

export function decideYesNo(brain, msg, view) {
  // Replay: ถามว่าจะโจมตีต่อหรือไม่ (SYSTEM_STRING 30) — ห้ามตีต่อถ้าจะตายหรือเด้งรับดาเมจ
  if (msg.desc === SYSTEM_STRING.REPLAY_CONTINUE_ATTACK) {
    const attacker = brain.plannedAttack?.attacker ? view.find(brain.plannedAttack.attacker, brain.kb) : null;
    const defenders = defenderUnits(view, brain.kb, brain.profile);
    if (!defenders.length) return { type: 'SELECT_YESNO', yes: true, reason: 'replay-direct' };
    if (attacker && defenders.some((d) => {
      const r = resolveBattle(attacker.atk, d);
      return r.killDef && !r.killAtt && r.myDmg === 0;
    })) {
      return { type: 'SELECT_YESNO', yes: true, reason: 'replay-win' };
    }
    return { type: 'SELECT_YESNO', yes: false, reason: 'replay-abort' };
  }
  return { type: 'SELECT_YESNO', yes: true, reason: 'default-yes' };
}
