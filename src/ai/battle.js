import { LOC } from './constants.js';
import { isFaceUp, isAttackPos, sameRef } from './board.js';
import { ownCardValue, threatScore } from './evaluate.js';

/** ผลการต่อสู้ตามกฎ: target = { attackPos, value } */
export function resolveBattle(atk, target) {
  if (target.attackPos) {
    if (atk > target.value) return { killDef: true, killAtt: false, oppDmg: atk - target.value, myDmg: 0 };
    if (atk === target.value) {
      return atk > 0
        ? { killDef: true, killAtt: true, oppDmg: 0, myDmg: 0 }   // แลกกัน
        : { killDef: false, killAtt: false, oppDmg: 0, myDmg: 0 }; // 0 vs 0 ไม่มีใครถูกทำลาย
    }
    return { killDef: false, killAtt: true, oppDmg: 0, myDmg: target.value - atk };
  }
  if (atk > target.value) return { killDef: true, killAtt: false, oppDmg: 0, myDmg: 0 };
  if (atk === target.value) return { killDef: false, killAtt: false, oppDmg: 0, myDmg: 0 };
  return { killDef: false, killAtt: false, oppDmg: 0, myDmg: target.value - atk };
}

export function defenderUnits(view, kb, profile) {
  const oppIdx = 1 - view.me;
  return view.opp.mzone
    .map((card, seq) => {
      if (!card) return null;
      const faceUp = isFaceUp(card);
      const attackPos = faceUp && isAttackPos(card);
      const unknown = !faceUp && card.hidden;
      const value = attackPos ? card.atk : unknown ? profile.unknownDefEstimate : card.def;
      return {
        ref: { controller: oppIdx, location: LOC.MZONE, sequence: seq, code: card.code },
        card, attackPos, value, unknown, threat: threatScore(card, kb),
      };
    })
    .filter(Boolean);
}

export function attackerUnits(attacks, view, kb) {
  const oppHasMonsters = view.opp.mzone.some(Boolean);
  return attacks.map((a, index) => {
    const card = view.find({ ...a, location: a.location ?? LOC.MZONE }, kb);
    return {
      index, ref: a, card, atk: card.atk, value: ownCardValue(card, kb),
      directAbility: !!a.can_direct && oppHasMonsters, // ตีตรงได้ทั้งที่มีมอนสเตอร์ขวาง
    };
  });
}

// เป้าหมาย: ดาเมจสูงสุด (ใช้เช็ค Lethal) — ห้ามตีแพ้/ตีเด้ง/ตีตัวเองตายเปล่า
export const lethalObjective = {
  allow: (a, d, r) => r.killDef && r.myDmg === 0,
  direct: (a) => a.atk,
  battle: (a, d, r) => r.oppDmg + 0.0001 * ((r.killDef ? d.threat : 0) - (r.killAtt ? a.value : 0)),
};

// เป้าหมาย: มูลค่ากระดาน (ดาเมจ + กำจัดภัยคุกคาม − สิ่งที่เสีย) — ห้ามตีตัวเองตาย ยกเว้นแลกตัวเล็กกับภัยคุกคามที่ใหญ่กว่ามาก
export const valueObjective = {
  allow: (a, d, r) => r.killDef && r.myDmg === 0 && (!r.killAtt || d.threat > a.value + 300),
  direct: (a) => a.atk,
  battle: (a, d, r) => r.oppDmg + d.threat - (r.killAtt ? a.value : 0) - r.myDmg * 1.2,
};

/** ค้นหาลำดับการโจมตีที่ดีที่สุด (DFS + memo บน bitmask; ฝั่งละไม่เกิน 7 ใบ) */
export function searchBattlePlan(attackers, defenders, objective) {
  const nA = attackers.length;
  const nD = defenders.length;
  const memo = new Map();

  function best(used, alive) {
    const key = used * 128 + alive;
    if (memo.has(key)) return memo.get(key);
    let result = { total: 0, damage: 0, step: null }; // เลือก "หยุดตี" ได้เสมอ
    for (let i = 0; i < nA; i++) {
      if (used & (1 << i)) continue;
      const a = attackers[i];
      const options = [];
      if (alive === 0 || a.directAbility) options.push(-1);
      for (let j = 0; j < nD; j++) if (alive & (1 << j)) options.push(j);
      for (const j of options) {
        let gain;
        let dmg;
        let nextAlive = alive;
        if (j === -1) {
          dmg = a.atk;
          gain = objective.direct(a);
        } else {
          const d = defenders[j];
          const r = resolveBattle(a.atk, d);
          if (!objective.allow(a, d, r)) continue;
          if (r.killDef) nextAlive &= ~(1 << j);
          dmg = r.oppDmg;
          gain = objective.battle(a, d, r);
        }
        const sub = best(used | (1 << i), nextAlive);
        const total = gain + sub.total;
        if (total > result.total + 1e-9) {
          result = { total, damage: dmg + sub.damage, step: { attacker: i, defender: j } };
        }
      }
    }
    memo.set(key, result);
    return result;
  }
  return best(0, (1 << nD) - 1);
}

const toStep = (s, A, D, reason) => ({ attacker: A[s.attacker], defender: s.defender >= 0 ? D[s.defender] : null, reason });

function hardBattle(A, D, view) {
  const lethal = searchBattlePlan(A, D, lethalObjective);
  if (lethal.step && lethal.damage >= view.opp.lp) return toStep(lethal.step, A, D, 'lethal');
  const plan = searchBattlePlan(A, D, valueObjective);
  if (plan.step && plan.total > 0) return toStep(plan.step, A, D, 'value');
  return null;
}

function greedyBattle(A, D) {
  const sorted = [...A].sort((x, y) => y.atk - x.atk);
  if (!D.length) {
    // โจมตีตรง: ใช้ตัวเล็กก่อนเพื่อลดความเสี่ยงจาก Gorz/Tragoedia/Mirror Force ที่เล็งตัวใหญ่
    const asc = [...A].filter((x) => x.atk > 0).sort((x, y) => x.atk - y.atk);
    return asc.length ? { attacker: asc[0], defender: null, reason: 'direct' } : null;
  }
  for (const a of sorted) {
    const wins = D.filter((d) => {
      const r = resolveBattle(a.atk, d);
      return r.killDef && !r.killAtt; // ชนะแน่เท่านั้น ไม่แลก
    }).sort((x, y) => y.value - x.value);
    if (wins.length) return { attacker: a, defender: wins[0], reason: 'greedy-win' };
  }
  const direct = sorted.find((a) => a.directAbility && a.atk > 0);
  return direct ? { attacker: direct, defender: null, reason: 'direct-ability' } : null;
}

function looseBattle(A, D, profile, rng) {
  for (const a of rng.shuffle(A).filter((x) => x.atk > 0)) {
    if (!D.length || a.directAbility) return { attacker: a, defender: null, reason: 'easy-direct' };
    // ห้ามตีตัวเองตายหรือตีเด้งรับดาเมจเด็ดขาด แม้ในโหมด Easy
    const ok = D.filter((d) => {
      const r = resolveBattle(a.atk, d);
      return r.killDef && !r.killAtt && r.myDmg === 0;
    });
    if (ok.length) return { attacker: a, defender: rng.pick(ok), reason: 'easy' };
  }
  return null;
}

export function decideBattle(brain, msg, view) {
  const { profile, kb, rng } = brain;
  const end = () => {
    brain.plannedAttack = null;
    return { type: 'SELECT_BATTLECMD', action: msg.to_m2 ? 'TO_M2' : 'TO_EP', index: null, reason: 'end-battle' };
  };
  const attacks = msg.attacks ?? [];
  if (!attacks.length) return end();
  const A = attackerUnits(attacks, view, kb);
  const D = defenderUnits(view, kb, profile);
  const step =
    profile.battleStrategy === 'search' ? hardBattle(A, D, view)
      : profile.battleStrategy === 'greedy' ? greedyBattle(A, D)
        : looseBattle(A, D, profile, rng);
  if (!step) return end();
  brain.plannedAttack = { attacker: step.attacker.ref, target: step.defender?.ref ?? null };
  return { type: 'SELECT_BATTLECMD', action: 'SELECT_BATTLE', index: step.attacker.index, reason: step.reason };
}

/** ตอบ SELECT_CARD ที่ hint = เลือกเป้าโจมตี */
export function decideAttackTarget(brain, msg, view) {
  const sels = msg.selects ?? [];
  if (!sels.length) return 0;
  const plan = brain.plannedAttack;
  if (plan?.target) {
    const i = sels.findIndex((s) => sameRef(s, plan.target));
    if (i >= 0) return i;
  }
  const D = defenderUnits(view, brain.kb, brain.profile);
  const atk = plan?.attacker ? view.find(plan.attacker, brain.kb).atk : 0;
  let best = 0;
  let bestScore = -Infinity;
  sels.forEach((s, i) => {
    const d = D.find((x) => sameRef(x.ref, s));
    if (!d) return;
    const r = resolveBattle(atk, d);
    const sc = (r.killDef ? 10000 : 0) + d.threat - (r.killAtt && !r.killDef ? 5000 : 0) - r.myDmg;
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
    }
  });
  return best;
}
