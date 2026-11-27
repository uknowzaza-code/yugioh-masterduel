import { TYPE } from './constants.js';
import { ownCardValue, threatScore } from './evaluate.js';

function unpackValues(amount) {
  const n = Number(amount ?? 0);
  const v1 = n & 0xffff;
  const v2 = (n >>> 16) & 0xffff;
  return v2 > 0 && v2 !== v1 ? [v1, v2] : [v1];
}

function addSets(baseSet, vals) {
  const next = new Set();
  for (const s of baseSet) {
    for (const v of vals) next.add(s + v);
  }
  return next;
}

function sumMaterialScore(ref, card, strategy, kb) {
  const isToken = (card.type & TYPE.TOKEN) !== 0;
  if (isToken) return -10000;
  if (strategy === 'min-atk') return card.atk;
  if (strategy === 'min-value') return ownCardValue(card, kb);
  return 0;
}

/**
 * แก้โจทย์ SELECT_SUM ของ ocgcore (Synchro / Ritual / Xyz / Level sum)
 * - select_max === 0: ผลรวมต้องเท่ากับ amount พอดี
 * - select_max === 1: ผลรวม >= amount และห้ามมีใบเกิน (ตัดใบไหนออกต้อง < amount)
 */
export function decideSelectSum(brain, msg, view) {
  const selects = msg.selects ?? [];
  const musts = msg.selects_must ?? [];
  const target = Number(msg.amount ?? 0);
  const selectMax = Number(msg.select_max ?? 0);

  if (!selects.length) {
    return { type: 'SELECT_SUM', indices: [], reason: 'must-only' };
  }

  let mustSums = new Set([0]);
  for (const m of musts) {
    mustSums = addSets(mustSums, unpackValues(m.amount));
  }

  const cardVals = selects.map((c) => unpackValues(c.amount));
  const strategy = brain.profile.sumStrategy;

  // จัดลำดับ: มอนสเตอร์ฝั่งตรงข้าม (ถ้าใช้ได้) -> Token -> ใบที่ค่าน้อยที่สุด
  const items = selects.map((ref, i) => {
    const card = view.find(ref, brain.kb);
    const isOpp = ref.controller !== view.me;
    return {
      index: i,
      isOpp,
      threat: isOpp ? threatScore(card, brain.kb) : 0,
      cost: isOpp ? 0 : sumMaterialScore(ref, card, strategy, brain.kb),
    };
  });
  const order = items
    .sort((a, b) => {
      if (a.isOpp !== b.isOpp) return a.isOpp ? -1 : 1;
      if (a.isOpp) return b.threat - a.threat;
      return a.cost - b.cost;
    })
    .map((x) => x.index);

  const minPicks = Math.max(musts.length > 0 ? 0 : 1, Number(msg.min ?? 0));
  const maxPicks = msg.max && msg.max > 0 ? Math.min(selects.length, Number(msg.max)) : selects.length;

  const n = order.length;
  const suffixMax = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    suffixMax[i] = suffixMax[i + 1] + Math.max(...cardVals[order[i]]);
  }

  const sumsOf = (indices) => {
    let s = mustSums;
    for (const idx of indices) s = addSets(s, cardVals[idx]);
    return s;
  };

  const isValid = (indices, precomputedSums = null) => {
    if (indices.length + musts.length === 0) return false;
    const sums = precomputedSums ?? sumsOf(indices);
    if (selectMax === 0) return sums.has(target);
    let hasGe = false;
    for (const v of sums) {
      if (v >= target) {
        hasGe = true;
        break;
      }
    }
    if (!hasGe) return false;
    // ตรวจเงื่อนไข no superfluous card ของ CheckWithSumGreater
    for (let k = 0; k < indices.length; k++) {
      const sub = indices.filter((_, i) => i !== k);
      const subSums = sumsOf(sub);
      for (const v of subSums) {
        if (v >= target) return false;
      }
    }
    return true;
  };

  let bestSolution = null;
  const chosen = [];
  let steps = 0;
  const MAX_STEPS = 8000;

  function dfs(pos, curSums) {
    if (bestSolution || ++steps > MAX_STEPS) return;
    if (chosen.length >= minPicks && isValid(chosen, curSums)) {
      bestSolution = [...chosen];
      return;
    }
    if (chosen.length >= maxPicks || pos >= n) return;
    if (chosen.length + (n - pos) < minPicks) return;

    let minCur = Infinity;
    let maxCur = -Infinity;
    for (const v of curSums) {
      if (v < minCur) minCur = v;
      if (v > maxCur) maxCur = v;
    }
    if (maxCur + suffixMax[pos] < target) return;
    if (selectMax === 0 && minCur > target) return;
    if (selectMax === 1 && minCur >= target && chosen.length >= minPicks) return;

    const idx = order[pos];
    chosen.push(idx);
    dfs(pos + 1, addSets(curSums, cardVals[idx]));
    chosen.pop();
    if (!bestSolution) dfs(pos + 1, curSums);
  }

  dfs(0, mustSums);

  return {
    type: 'SELECT_SUM',
    indices: bestSolution ?? order.slice(0, Math.max(1, minPicks)),
    reason: bestSolution ? `sum-${strategy}` : 'sum-fallback',
  };
}
