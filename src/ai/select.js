import { LOC, POS, TYPE, HINTMSG, SYSTEM_STRING } from './constants.js';
import { isFaceUp } from './board.js';
import { ownCardValue, threatScore } from './evaluate.js';
import { decideAttackTarget } from './battle.js';

const HOSTILE_HINTS = new Set([
  HINTMSG.DESTROY, HINTMSG.REMOVE, HINTMSG.RTOHAND, HINTMSG.TODECK,
  HINTMSG.CONTROL, HINTMSG.NEGATE, HINTMSG.TARGET, HINTMSG.TARGET_GENERIC,
]);

const COST_HINTS = new Set([
  HINTMSG.RELEASE, HINTMSG.DISCARD, HINTMSG.FMATERIAL, HINTMSG.SMATERIAL,
  HINTMSG.XMATERIAL, HINTMSG.LMATERIAL, HINTMSG.REMOVEXYZ,
]);

const GAIN_HINTS = new Set([
  HINTMSG.ATOHAND, HINTMSG.SUMMON, HINTMSG.SPSUMMON, HINTMSG.SET, HINTMSG.EQUIP,
]);

const MULTI_PICK_HINTS = new Set([
  HINTMSG.SPSUMMON, HINTMSG.ATOHAND, HINTMSG.FMATERIAL, HINTMSG.SMATERIAL, HINTMSG.LMATERIAL,
]);

function classifySelection(hintMsg, selects, me) {
  if (hintMsg === HINTMSG.ATTACKTARGET) return 'attack-target';
  const hasOpp = selects.some((s) => s.controller !== me);
  const hasOwn = selects.some((s) => s.controller === me);
  const allFromDeckOrExtra = selects.length > 0 && selects.every((s) => (s.location & (LOC.DECK | LOC.EXTRA)) !== 0);

  if (hintMsg === HINTMSG.TOGRAVE || hintMsg === HINTMSG.FMATERIAL || hintMsg === HINTMSG.SMATERIAL) {
    // Foolish Burial / Branded Fusion (ส่งจากเด็ค/เอ็กซ์ตร้าลงสุสาน) = เลือกใบที่มีค่าที่สุด; จากมือ/สนาม = จ่ายคอสต์
    if (allFromDeckOrExtra) return 'gain';
    if (hintMsg === HINTMSG.TOGRAVE && hasOpp && !hasOwn) return 'hostile';
    return 'cost';
  }
  if (hintMsg === HINTMSG.REMOVE) {
    if (hasOpp) return 'hostile';
    return 'cost';
  }
  if (HOSTILE_HINTS.has(hintMsg)) {
    return hasOpp ? 'hostile' : 'cost';
  }
  if (COST_HINTS.has(hintMsg)) return 'cost';
  if (GAIN_HINTS.has(hintMsg)) return 'gain';
  return hasOpp ? 'hostile' : 'gain';
}

function rankSelectIndices(brain, selects, mode, view) {
  const { profile, kb, rng } = brain;
  const items = selects.map((ref, index) => {
    const card = view.find(ref, kb);
    const isOpp = ref.controller !== view.me;
    return { index, ref, card, isOpp };
  });

  if (mode === 'hostile') {
    const oppItems = items.filter((x) => x.isOpp);
    const ownItems = items.filter((x) => !x.isOpp);
    const sortOpp = (arr) => {
      if (profile.targetStrategy === 'random-opponent') return rng.shuffle(arr);
      if (profile.targetStrategy === 'highest-atk') return [...arr].sort((a, b) => b.card.atk - a.card.atk);
      return [...arr].sort((a, b) => threatScore(b.card, kb) - threatScore(a.card, kb));
    };
    const sortOwn = (arr) => [...arr].sort((a, b) => ownCardValue(a.card, kb) - ownCardValue(b.card, kb));
    return [...sortOpp(oppItems), ...sortOwn(ownItems)].map((x) => x.index);
  }

  if (mode === 'cost') {
    const sorted = [...items].sort((a, b) => {
      // ถ้าเลือกสังเวย/ส่งการ์ดฝั่งตรงข้ามได้ (เช่น Kaiju / Super Poly / Monarchs Stormforth) เอาของฝั่งตรงข้ามก่อน!
      if (a.isOpp !== b.isOpp) return a.isOpp ? -1 : 1;
      if (a.isOpp) return threatScore(b.card, kb) - threatScore(a.card, kb);
      // เลือก Token ก่อนการ์ดจริงเสมอ
      const aTok = (a.card.type & TYPE.TOKEN) !== 0;
      const bTok = (b.card.type & TYPE.TOKEN) !== 0;
      if (aTok !== bTok) return aTok ? -1 : 1;
      if (profile.costStrategy === 'value') return ownCardValue(a.card, kb) - ownCardValue(b.card, kb);
      return a.card.atk - b.card.atk;
    });
    if (profile.blunderRate > 0 && sorted.length > 1 && rng.chance(profile.blunderRate)) {
      [sorted[0], sorted[1]] = [sorted[1], sorted[0]];
    }
    return sorted.map((x) => x.index);
  }

  // mode === 'gain'
  const sorted = [...items].sort((a, b) => {
    if (profile.costStrategy === 'value') return ownCardValue(b.card, kb) - ownCardValue(a.card, kb);
    return b.card.atk - a.card.atk;
  });
  return sorted.map((x) => x.index);
}

export function decideSelectCard(brain, msg, view, hintMsg = 0) {
  const selects = msg.selects ?? [];
  const min = Math.max(1, msg.min ?? 1);
  if (!selects.length) return { type: 'SELECT_CARD', indices: [], reason: 'empty' };

  if (hintMsg === HINTMSG.ATTACKTARGET) {
    const idx = decideAttackTarget(brain, msg, view);
    return { type: 'SELECT_CARD', indices: [idx], reason: 'attack-target' };
  }

  const mode = classifySelection(hintMsg, selects, view.me);
  const ranked = rankSelectIndices(brain, selects, mode, view);

  // ถ้าสามารถยกเลิกได้ และโหมด hostile แต่มีแต่การ์ดเราเอง (จะทำลายการ์ดตัวเอง) -> ยกเลิก!
  if (msg.can_cancel && mode === 'hostile' && selects.every((s) => s.controller === view.me)) {
    return { type: 'SELECT_CARD', indices: null, reason: 'cancel-self-harm' };
  }

  return {
    type: 'SELECT_CARD',
    indices: ranked.slice(0, Math.min(min, ranked.length)),
    reason: `select-${mode}`,
  };
}

export function decideSelectTribute(brain, msg, view) {
  const selects = msg.selects ?? [];
  const min = Math.max(1, msg.min ?? 1);
  if (!selects.length) return { type: 'SELECT_TRIBUTE', indices: [], reason: 'empty' };

  const ranked = rankSelectIndices(brain, selects, 'cost', view);
  const picked = [];
  let sum = 0;
  for (const idx of ranked) {
    picked.push(idx);
    sum += Math.max(1, selects[idx].release_param ?? 1);
    if (sum >= min) break;
  }

  // ถ้ามีมอนสเตอร์ Double-Tribute (release_param >= min) ที่คุ้มกว่าการสังเวยหลายใบ ให้เลือกใบนั้นแทน
  if (picked.length > 1) {
    const costOf = (idxs) => idxs.reduce((acc, idx) => {
      const ref = selects[idx];
      if (ref.controller !== view.me) return acc - 10000; // ของฝั่งตรงข้ามคุ้มมาก
      return acc + ownCardValue(view.find(ref, brain.kb), brain.kb);
    }, 0);
    const singleCandidates = ranked.filter((idx) => Math.max(1, selects[idx].release_param ?? 1) >= min);
    if (singleCandidates.length > 0) {
      const bestSingle = singleCandidates[0];
      if (costOf([bestSingle]) <= costOf(picked)) {
        picked.splice(0, picked.length, bestSingle);
      }
    }
  }

  // ถ้ายกเลิกได้และไม่มีการ์ดฝั่งตรงข้ามให้สังเวย อย่าสังเวยบอสที่มีค่ามากกว่าตัวที่จะอัญเชิญ
  if (msg.can_cancel && picked.every((idx) => selects[idx].controller === view.me)) {
    const tributeCost = picked.reduce((acc, idx) => acc + ownCardValue(view.find(selects[idx], brain.kb), brain.kb), 0);
    if (msg.code) {
      const summonVal = ownCardValue(view.find({ code: msg.code, controller: view.me }, brain.kb), brain.kb);
      if (tributeCost > summonVal) {
        return { type: 'SELECT_TRIBUTE', indices: null, reason: 'cancel-bad-tribute' };
      }
    } else {
      const sacrificesBoss = picked.some((idx) => {
        const roles = brain.kb.info(selects[idx].code ?? 0).roles;
        return roles.has('boss') || roles.has('negate') || roles.has('floodgate');
      });
      if (sacrificesBoss) {
        return { type: 'SELECT_TRIBUTE', indices: null, reason: 'cancel-boss-tribute' };
      }
    }
  }

  return { type: 'SELECT_TRIBUTE', indices: picked, reason: 'tribute-lowest' };
}

export function decideSelectUnselectCard(brain, msg, view, hintMsg = 0) {
  const selectable = msg.selectable ?? [];
  const selected = msg.selected ?? [];
  if (!selectable.length) {
    return { type: 'SELECT_UNSELECT_CARD', index: null, reason: 'empty-unselect' };
  }

  const mode = classifySelection(hintMsg, selectable, view.me);
  const ranked = rankSelectIndices(brain, selectable, mode, view);

  if (msg.can_finish && selected.length > 0) {
    if (selected.length >= 5) {
      return { type: 'SELECT_UNSELECT_CARD', index: null, reason: 'finish-unselect-cap' };
    }
    const oppRemaining = selectable.filter((s) => s.controller !== view.me);
    if (mode === 'hostile') {
      if (oppRemaining.length === 0) {
        return { type: 'SELECT_UNSELECT_CARD', index: null, reason: 'finish-unselect' };
      }
    } else if (MULTI_PICK_HINTS.has(hintMsg)) {
      // Pendulum Summon / Multi-Add / Material: เลือกต่อจนกว่าจะครบหรือเหลือแต่การ์ดที่ไม่คุ้ม
      if (mode === 'cost' && selected.length >= 2) {
        const bestRef = selectable[ranked[0]];
        const bestIsOpp = bestRef.controller !== view.me;
        const bestCard = view.find(bestRef, brain.kb);
        const bestIsFodder = (bestCard.type & TYPE.TOKEN) !== 0 || ownCardValue(bestCard, brain.kb) <= 1200;
        if (!bestIsOpp && !bestIsFodder) {
          return { type: 'SELECT_UNSELECT_CARD', index: null, reason: 'finish-unselect-material' };
        }
      }
    } else {
      return { type: 'SELECT_UNSELECT_CARD', index: null, reason: 'finish-unselect' };
    }
  }

  return { type: 'SELECT_UNSELECT_CARD', index: ranked[0], reason: `pick-unselect-${mode}` };
}

export function decidePosition(brain, msg, view) {
  const allowed = msg.positions ?? POS.FACEUP_ATTACK;
  const has = (p) => (allowed & p) !== 0;
  const s = brain.kb.stats(msg.code ?? 0);

  if (brain.profile.positionStrategy === 'basic') {
    const pos = has(POS.FACEUP_ATTACK) ? POS.FACEUP_ATTACK
      : has(POS.FACEUP_DEFENSE) ? POS.FACEUP_DEFENSE
        : has(POS.FACEDOWN_DEFENSE) ? POS.FACEDOWN_DEFENSE
          : POS.FACEDOWN_ATTACK;
    return { type: 'SELECT_POSITION', position: pos, reason: 'basic-pos' };
  }

  const oppMaxAtk = Math.max(0, ...view.opp.mzone.filter((c) => c && isFaceUp(c)).map((c) => c.atk));
  const preferDef =
    (s.def > s.atk && s.atk < 1500) ||
    (view.turn === 1 && s.def >= s.atk && s.atk <= 1800) ||
    (oppMaxAtk > s.atk && s.def >= s.atk);

  if (preferDef) {
    if (has(POS.FACEUP_DEFENSE)) return { type: 'SELECT_POSITION', position: POS.FACEUP_DEFENSE, reason: 'safe-def' };
    if (has(POS.FACEDOWN_DEFENSE)) return { type: 'SELECT_POSITION', position: POS.FACEDOWN_DEFENSE, reason: 'safe-set-def' };
  }
  if (has(POS.FACEUP_ATTACK)) return { type: 'SELECT_POSITION', position: POS.FACEUP_ATTACK, reason: 'attack-pos' };
  if (has(POS.FACEUP_DEFENSE)) return { type: 'SELECT_POSITION', position: POS.FACEUP_DEFENSE, reason: 'fallback-def' };
  if (has(POS.FACEDOWN_DEFENSE)) return { type: 'SELECT_POSITION', position: POS.FACEDOWN_DEFENSE, reason: 'fallback-fd-def' };
  return { type: 'SELECT_POSITION', position: POS.FACEDOWN_ATTACK, reason: 'fallback-fd-atk' };
}

function scoreOption(opt) {
  if (typeof opt === 'string') {
    const s = opt.toLowerCase();
    if (s.includes('special summon')) return 100;
    if (s.includes('add to hand')) return 90;
    if (s.includes('ritual') || s.includes('fusion')) return 80;
    if (s.includes('send to gy')) return -50;
    if (/^(no|pass|cancel|skip)$/.test(s.trim())) return -100;
    return 10;
  }
  const id = Number(opt);
  if (id === 2 || id === HINTMSG.SPSUMMON) return 100;
  if (id === SYSTEM_STRING.TO_HAND || id === HINTMSG.ATOHAND) return 90;
  if (id === 1057 || id === 1056 || id === HINTMSG.FMATERIAL) return 80;
  if (id === 1 || id === 0) return 50;
  if (id === SYSTEM_STRING.TO_GRAVE || id === HINTMSG.TOGRAVE) return -50;
  if (id === 91 || id === 202) return -100;
  return 10;
}

export function decideOption(brain, msg) {
  const options = msg.options ?? [];
  if (!options.length) return { type: 'SELECT_OPTION', index: 0, reason: 'empty' };
  let bestIdx = 0;
  let bestScore = scoreOption(options[0]);
  for (let i = 1; i < options.length; i++) {
    const sc = scoreOption(options[i]);
    if (sc > bestScore) {
      bestScore = sc;
      bestIdx = i;
    }
  }
  const reason = bestScore >= 90 ? 'prefer-summon-or-hand' : bestScore >= 80 ? 'prefer-ritual-fusion' : 'best-option';
  return { type: 'SELECT_OPTION', index: bestIdx, reason };
}
