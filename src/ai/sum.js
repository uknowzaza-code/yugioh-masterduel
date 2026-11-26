import { ownCardValue } from './evaluate.js';

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

  // จัดลำดับใบที่ค่าน้อยที่สุดขึ้นก่อน เพื่อให้ชุดที่เลือกประหยัดทรัพยากรที่สุด
  const order = selects.map((_, i) => i);
  if (strategy === 'min-value') {
    const costs = selects.map((ref) => ownCardValue(view.find(ref, brain.kb), brain.kb));
    order.sort((a, b) => costs[a] - costs[b]);
  } else if (strategy === 'min-atk') {
    const atks = selects.map((ref) => view.find(ref, brain.kb).atk);
    order.sort((a, b) => atks[a] - atks[b]);
  }

  const minPicks = selectMax ? (musts.length > 0 ? 0 : 1) : Math.max(musts.length > 0 ? 0 : 1, Number(msg.min ?? 0));
  const maxPicks = msg.max && msg.max > 0 ? Math.min(selects.length, Number(msg.max)) : selects.length;

  const sumsOf = (indices) => {
    let s = mustSums;
    for (const idx of indices) s = addSets(s, cardVals[idx]);
    return s;
  };

  const isValid = (indices) => {
    if (indices.length + musts.length === 0) return false;
    const sums = sumsOf(indices);
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
      let subGe = false;
      for (const v of subSums) {
        if (v >= target) {
          subGe = true;
          break;
        }
      }
      if (subGe) return false;
    }
    return true;
  };

  let bestSolution = null;
  const chosen = [];
  let steps = 0;
  const MAX_STEPS = 8000;

  function dfs(pos) {
    if (bestSolution || ++steps > MAX_STEPS) return;
    if (chosen.length >= minPicks && isValid(chosen)) {
      bestSolution = [...chosen];
      return;
    }
    if (chosen.length >= maxPicks || pos >= order.length) return;
    chosen.push(order[pos]);
    dfs(pos + 1);
    chosen.pop();
    if (!bestSolution) dfs(pos + 1);
  }

  dfs(0);

  return {
    type: 'SELECT_SUM',
    indices: bestSolution ?? order.slice(0, Math.max(1, minPicks)),
    reason: bestSolution ? `sum-${strategy}` : 'sum-fallback',
  };
}
