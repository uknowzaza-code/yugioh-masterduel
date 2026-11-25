/**
 * @fileoverview Tactical YGOPro Core AI Decision Engine (`Easy` / `Normal` / `Hard`)
 * Evaluates live board state, card metadata, ProjectIgnis HINT_SELECTMSG context,
 * battle math, lethal calculation, and chain/hand-trap discipline.
 */

import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction
} from 'ocgcore-wasm';
import { PHASES, POSITIONS } from '../constants/gameConstants.js';

export const AI_DIFFICULTY = Object.freeze({
  EASY: 'easy',
  NORMAL: 'normal',
  HARD: 'hard'
});

export const AI_DIFFICULTY_PROFILES = Object.freeze({
  [AI_DIFFICULTY.EASY]: Object.freeze({
    id: AI_DIFFICULTY.EASY,
    labelEn: 'Easy',
    labelTh: 'ง่าย (Easy)',
    maxActionsPerTurn: 3,
    maxChainsPerTurn: 2,
    setBackrowLimit: 1,
    setWallMonster: false,
    chainOnOppCard: false,
    smartTargeting: false,
    smartPosition: false,
    useLethalCalc: false,
    allowPosChange: false,
    holdHandTraps: false,
    preventSuicide: false,
    preferImpermSafeColumn: false
  }),
  [AI_DIFFICULTY.NORMAL]: Object.freeze({
    id: AI_DIFFICULTY.NORMAL,
    labelEn: 'Normal',
    labelTh: 'ปกติ (Normal)',
    maxActionsPerTurn: 9,
    maxChainsPerTurn: 5,
    setBackrowLimit: 2,
    setWallMonster: true,
    chainOnOppCard: true,
    smartTargeting: true,
    smartPosition: true,
    useLethalCalc: false,
    allowPosChange: true,
    holdHandTraps: true,
    preventSuicide: true,
    preferImpermSafeColumn: false
  }),
  [AI_DIFFICULTY.HARD]: Object.freeze({
    id: AI_DIFFICULTY.HARD,
    labelEn: 'Hard',
    labelTh: 'ยาก (Hard)',
    maxActionsPerTurn: 18,
    maxChainsPerTurn: 10,
    setBackrowLimit: 4,
    setWallMonster: true,
    chainOnOppCard: true,
    smartTargeting: true,
    smartPosition: true,
    useLethalCalc: true,
    allowPosChange: true,
    holdHandTraps: true,
    preventSuicide: true,
    preferImpermSafeColumn: true
  })
});

export function normalizeAiDifficulty(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === AI_DIFFICULTY.EASY) return AI_DIFFICULTY.EASY;
  if (s === AI_DIFFICULTY.HARD) return AI_DIFFICULTY.HARD;
  return AI_DIFFICULTY.NORMAL;
}

export function formatAiDisplayName(difficulty, baseName = 'YGOPro AI') {
  const norm = normalizeAiDifficulty(difficulty);
  const label = AI_DIFFICULTY_PROFILES[norm]?.labelEn || 'Normal';
  return `${baseName} (${label})`;
}

export function createAiTurnState() {
  return {
    actionCount: 0,
    activationCounts: new Map(),
    chainKeys: new Set(),
    negatedChainLinks: new Set(),
    pendingAttackTarget: null,
    posChangedKeys: new Set()
  };
}

// Known competitive hand traps & quick disruption passcodes
const HAND_TRAP_CODES = new Set([
  14558127, // Ash Blossom & Joyous Spring
  23434538, // Maxx "C"
  97268402, // Effect Veiler
  10045474, // Infinite Impermanence
  27204311, // Nibiru, the Primal Being
  59438930, // Ghost Ogre & Snow Rabbit
  73642296, // Ghost Belle & Haunted Mansion
  52038441, // Ghost Mourner & Moonlit Chill
  94145021, // Droll & Lock Bird
  38814750, // PSY-Framegear Gamma
  42141493, // Mulcharmy Fuwalos
  84192580  // Mulcharmy Purulia
]);

const QUICK_DISRUPTION_CODES = new Set([
  ...HAND_TRAP_CODES,
  24224830, // Called by the Grave
  65681983, // Crossout Designator
  41420027, // Solemn Judgment
  40605147, // Solemn Strike
  84749824  // Solemn Warning
]);

// ProjectIgnis HINT_SELECTMSG codes
const HINT_ADVERSARIAL = new Set([
  502, // Destroy
  503, // Banish
  504, // Send to GY
  505, // Return to Hand
  507, // Return to Deck
  514, // Equip
  519, // Change Position
  549, // Attack Target
  550, // Target
  551, // Target
  560, // Take Control
  562, // Attach Material (opponent)
  575  // Negate
]);

const HINT_COST_OR_TRIBUTE = new Set([
  500, // Tribute
  501, // Discard
  510, // Release/Tribute
  511, // Fusion Material
  512, // Synchro Material
  513, // Xyz Material
  526, // Send as Cost
  533  // Link Material
]);

const HINT_GAIN = new Set([
  506, // Add to Hand
  508, // Normal Summon
  509, // Special Summon
  515, // Activate
  527, // Set
  528, // Add to Extra
  573  // Add to Hand (utility.lua)
]);

function getPlayerFieldMonsters(playerState) {
  if (!playerState) return [];
  const list = [];
  for (const m of playerState.mmz || []) {
    if (m) list.push(m);
  }
  for (const m of playerState.emzSlots || []) {
    if (m) list.push(m);
  }
  return list;
}

function getPlayerBackrowCount(playerState) {
  if (!playerState) return 0;
  let count = 0;
  for (const st of playerState.stz || []) {
    if (st) count++;
  }
  return count;
}

function getOpponentMaxFieldAtk(oppState) {
  let maxAtk = 0;
  for (const m of getPlayerFieldMonsters(oppState)) {
    if (m.isFaceDown) {
      maxAtk = Math.max(maxAtk, 1500);
    } else if (m.position === POSITIONS.ATK) {
      maxAtk = Math.max(maxAtk, Number(m.currentAtk ?? m.atk ?? 0));
    }
  }
  return maxAtk;
}

function lookupLiveCard(state, controller, location, sequence) {
  const p = state?.players?.[controller];
  if (!p) return null;
  if (location === OcgLocation.MZONE) {
    if (sequence >= 5) return p.emzSlots?.[sequence - 5] || null;
    return p.mmz?.[sequence] || null;
  }
  if (location === OcgLocation.SZONE) {
    if (sequence === 5) return p.fieldZone || p.fieldSpell || null;
    return p.stz?.[sequence] || null;
  }
  if (location === OcgLocation.FZONE) return p.fieldZone || p.fieldSpell || null;
  if (location === OcgLocation.HAND) return p.hand?.[sequence] || null;
  if (location === OcgLocation.GRAVE) return p.gy?.[sequence] || null;
  if (location === OcgLocation.REMOVED) return p.banished?.[sequence] || null;
  if (location === OcgLocation.EXTRA) return p.extra?.[sequence] || null;
  return null;
}

function classifyCardText(meta) {
  const desc = String(meta?.description || '').toLowerCase();
  return {
    hasNegate: /\bnegate\b/.test(desc),
    hasSearch: /\badd\b[^.]*\bfrom your deck to your hand\b/.test(desc) || /\bdraw\b/.test(desc),
    hasRemoval: /\b(destroy|banish|send.*to the gy|return.*to the hand)\b/.test(desc),
    hasSpecialSummon: /\bspecial summon\b/.test(desc),
    isQuick: /\bquick effect\b|\(quick effect\)/.test(desc) || meta?.subtype === 'QUICK_PLAY' || meta?.kind === 'TRAP'
  };
}

function evaluateMonsterThreat(cardObj, meta) {
  if (!cardObj && !meta) return 0;
  if (cardObj?.isFaceDown) return 1500;
  const atk = Number(cardObj?.currentAtk ?? meta?.atk ?? 0);
  const def = Number(cardObj?.currentDef ?? meta?.def ?? 0);
  const stat = cardObj?.position === POSITIONS.DEF ? def : atk;
  let score = stat;
  if (meta?.isExtraDeck) score += 600;
  if (!cardObj?.effectsNegated) {
    const flags = classifyCardText(meta);
    if (flags.hasNegate) score += 1100;
    if (flags.isQuick) score += 500;
    if (flags.hasRemoval) score += 400;
    if (flags.hasSearch) score += 300;
  }
  return score;
}

function evaluateCardKeepValue(entry, liveCard, meta) {
  const code = Number(entry?.code || liveCard?.passcode || meta?.passcode || 0);
  const atk = Number(liveCard?.currentAtk ?? meta?.atk ?? 0);
  const def = Number(liveCard?.currentDef ?? meta?.def ?? 0);
  let score = Math.max(atk, def * 0.65);

  if (meta?.isExtraDeck) score += 900;
  if (HAND_TRAP_CODES.has(code)) {
    // Valuable in hand, expendable on field (0 ATK body)
    score += entry?.location === OcgLocation.HAND ? 1600 : -400;
  }
  const flags = classifyCardText(meta);
  if (flags.hasNegate) score += 900;
  if (flags.hasSearch) score += 700;
  if (flags.hasSpecialSummon) score += 450;
  if (flags.hasRemoval) score += 400;
  if (liveCard?.effectsNegated) score -= 500;
  // Tokens or 0-ATK vanilla bodies on field are prime tribute/discard fodder
  if (entry?.location === OcgLocation.MZONE && atk === 0 && !meta?.isExtraDeck) {
    score -= 600;
  }
  return score;
}

function isSpellTrapInHandTrapList(code) {
  return QUICK_DISRUPTION_CODES.has(Number(code || 0));
}

function buildRetryFallback(msg, ctx) {
  const { solveSelectSum, pickFirstAvailablePlaces, findAnnounceCardCodes } = ctx;
  switch (msg.type) {
    case OcgMessageType.SELECT_IDLECMD:
      if (msg.to_ep) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
      if (msg.to_bp) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
      if (msg.summons?.length) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 0 };
      if (msg.special_summons?.length) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, index: 0 };
      if (msg.activates?.length) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: 0 };
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
    case OcgMessageType.SELECT_BATTLECMD:
      if (msg.to_ep) return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
      if (msg.to_m2) return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_M2, index: null };
      return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
    case OcgMessageType.SELECT_CHAIN:
      if (msg.forced && msg.selects?.length > 0) return { type: OcgResponseType.SELECT_CHAIN, index: 0 };
      return { type: OcgResponseType.SELECT_CHAIN, index: null };
    case OcgMessageType.SELECT_CARD: {
      const count = Math.min(msg.min || 1, msg.selects?.length || 0);
      return { type: OcgResponseType.SELECT_CARD, indicies: Array.from({ length: count }, (_, i) => i) };
    }
    case OcgMessageType.SELECT_TRIBUTE: {
      const count = Math.min(msg.min || 1, msg.selects?.length || 0);
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies: Array.from({ length: count }, (_, i) => i) };
    }
    case OcgMessageType.SELECT_UNSELECT_CARD:
      if (msg.can_finish) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
      if (msg.select_cards?.length > 0) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: 0 };
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
    case OcgMessageType.SELECT_SUM:
      return { type: OcgResponseType.SELECT_SUM, indicies: solveSelectSum ? solveSelectSum(msg) : [0] };
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD: {
      const places = pickFirstAvailablePlaces ? pickFirstAvailablePlaces(msg.field_mask, msg.count || 1, msg.player) : [];
      return msg.type === OcgMessageType.SELECT_DISFIELD
        ? { type: OcgResponseType.SELECT_DISFIELD, places }
        : { type: OcgResponseType.SELECT_PLACE, places };
    }
    case OcgMessageType.SELECT_POSITION: {
      const pos = (msg.positions & OcgPosition.FACEUP_ATTACK)
        ? OcgPosition.FACEUP_ATTACK
        : (msg.positions & OcgPosition.FACEUP_DEFENSE)
          ? OcgPosition.FACEUP_DEFENSE
          : OcgPosition.FACEDOWN_DEFENSE;
      return { type: OcgResponseType.SELECT_POSITION, position: pos };
    }
    case OcgMessageType.SELECT_EFFECTYN:
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: false };
    case OcgMessageType.SELECT_YESNO:
      return { type: OcgResponseType.SELECT_YESNO, yes: false };
    case OcgMessageType.SELECT_OPTION:
      return { type: OcgResponseType.SELECT_OPTION, index: 0 };
    case OcgMessageType.ANNOUNCE_CARD: {
      const matches = findAnnounceCardCodes ? findAnnounceCardCodes(msg.opcodes || [], 1) : [];
      return { type: OcgResponseType.ANNOUNCE_CARD, card: matches[0] || 14558127 };
    }
    default:
      return null;
  }
}

function getOpponentBattleTargets(oppState) {
  const targets = [];
  for (const m of getPlayerFieldMonsters(oppState)) {
    const faceDown = Boolean(m.isFaceDown);
    const inDef = m.position === POSITIONS.DEF || m.position === POSITIONS.SET_DEF;
    const effectiveDefStat = faceDown ? 1500 : Number(m.currentDef ?? m.def ?? 0);
    const effectiveAtkStat = faceDown ? 1500 : Number(m.currentAtk ?? m.atk ?? 0);
    targets.push({
      card: m,
      faceDown,
      inDef,
      stat: inDef ? effectiveDefStat : effectiveAtkStat,
      atk: effectiveAtkStat,
      threat: faceDown ? 1500 : evaluateMonsterThreat(m, m)
    });
  }
  return targets;
}

function canAttackerBeatTarget(attackerAtk, target, attackerThreat, profile) {
  if (attackerAtk <= 0) return false;
  if (target.faceDown) {
    return profile.id === AI_DIFFICULTY.EASY ? attackerAtk >= 1200 : attackerAtk >= 1500;
  }
  if (target.inDef) {
    return attackerAtk > target.stat;
  }
  // Face-up Attack Position
  if (attackerAtk > target.stat) return true;
  // Equal-ATK trade: Hard/Normal only crash if opponent monster is a bigger threat
  if (attackerAtk === target.stat && target.threat > attackerThreat) return true;
  return false;
}

function handleSelectIdleCmd(msg, ctx, profile) {
  const { aiIndex, state, phase, aiState, getCardMeta } = ctx;
  const aiPlayer = state?.players?.[aiIndex];
  const oppPlayer = state?.players?.[1 - aiIndex];
  const aiMonsters = getPlayerFieldMonsters(aiPlayer);
  const oppTargets = getOpponentBattleTargets(oppPlayer);
  const oppMaxAtk = getOpponentMaxFieldAtk(oppPlayer);

  const endOrBattle = () => {
    // Before ending turn (MP2 or Turn 1 MP1 when Battle Phase isn't available), set protective backrow / wall
    if (msg.spell_sets?.length > 0 && (phase === PHASES.MP2 || !msg.to_bp)) {
      const currentSetCount = getPlayerBackrowCount(aiPlayer);
      if (currentSetCount < profile.setBackrowLimit) {
        let bestIdx = 0;
        let bestScore = -Infinity;
        msg.spell_sets.forEach((s, idx) => {
          const meta = getCardMeta(s.code);
          let sc = 10;
          if (meta?.kind === 'TRAP') sc += 30;
          if (meta?.subtype === 'QUICK_PLAY') sc += 20;
          if (QUICK_DISRUPTION_CODES.has(Number(s.code))) sc += 40;
          if (sc > bestScore) {
            bestScore = sc;
            bestIdx = idx;
          }
        });
        if (aiState.actionCount < profile.maxActionsPerTurn) {
          aiState.actionCount++;
          return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPELL_SET, index: bestIdx };
        }
      }
    }

    if (profile.setWallMonster && msg.monster_sets?.length > 0 && aiMonsters.length === 0 && (phase === PHASES.MP2 || !msg.to_bp)) {
      let bestIdx = -1;
      let bestDef = -1;
      msg.monster_sets.forEach((ms, idx) => {
        const meta = getCardMeta(ms.code);
        const def = Number(meta?.def ?? 0);
        if (!HAND_TRAP_CODES.has(Number(ms.code)) && def > bestDef) {
          bestDef = def;
          bestIdx = idx;
        }
      });
      if (bestIdx >= 0 && aiState.actionCount < profile.maxActionsPerTurn) {
        aiState.actionCount++;
        return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_MONSTER_SET, index: bestIdx };
      }
    }

    if (msg.to_bp && phase === PHASES.MP1) {
      if (!profile.preventSuicide) {
        const hasAnyAttacker = aiMonsters.some(m => m.position === POSITIONS.ATK && Number(m.currentAtk ?? 0) > 0);
        if (hasAnyAttacker) {
          return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
        }
      } else {
        const hasGoodAttack = aiMonsters.some((m) => {
          if (m.position !== POSITIONS.ATK) return false;
          const myAtk = Number(m.currentAtk ?? m.atk ?? 0);
          if (myAtk <= 0) return false;
          if (oppTargets.length === 0) return true;
          const myThreat = evaluateMonsterThreat(m, m);
          return oppTargets.some(t => canAttackerBeatTarget(myAtk, t, myThreat, profile));
        });
        if (hasGoodAttack) {
          return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
        }
      }
    }

    return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
  };

  if (aiState.actionCount >= profile.maxActionsPerTurn) {
    return endOrBattle();
  }

  // Easy mode: simpler decision flow
  if (profile.id === AI_DIFFICULTY.EASY) {
    if (msg.summons?.length > 0) {
      aiState.actionCount++;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 0 };
    }
    if (msg.special_summons?.length > 0) {
      aiState.actionCount++;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, index: 0 };
    }
    if (msg.activates?.length > 0) {
      for (let i = 0; i < msg.activates.length; i++) {
        const act = msg.activates[i];
        const key = `${act.code}:${act.description}`;
        if ((aiState.activationCounts.get(key) || 0) < 1) {
          aiState.activationCounts.set(key, 1);
          aiState.actionCount++;
          return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: i };
        }
      }
    }
    return endOrBattle();
  }

  // Normal / Hard tactical priority:
  // 1. Score activatable Spells / Searchers / Starters / GY extenders
  const scoreActivation = (act) => {
    const key = `${act.code}:${act.description}`;
    const used = aiState.activationCounts.get(key) || 0;
    if (used >= 2) return -9999;

    const code = Number(act.code || 0);
    if (profile.holdHandTraps && act.location === OcgLocation.HAND && isSpellTrapInHandTrapList(code)) {
      return -5000;
    }

    const meta = getCardMeta(code);
    const flags = classifyCardText(meta);
    let score = 0;

    if (act.location === OcgLocation.HAND || act.location === OcgLocation.SZONE || act.location === OcgLocation.FZONE) {
      if (meta?.kind === 'SPELL') score += 120;
    }
    if (act.location === OcgLocation.GRAVE) score += 110;
    if (flags.hasSearch) score += 180;
    if (flags.hasSpecialSummon) score += 140;
    if (flags.hasRemoval && oppTargets.length > 0) score += 130;
    if (flags.hasNegate && !flags.hasSearch && !flags.hasSpecialSummon) {
      // Avoid wasting pure negate ignition/quick effects with nothing to negate
      score -= 80;
    }
    score -= used * 90;
    return score;
  };

  let bestStarterActIdx = -1;
  let bestStarterActScore = 80;
  (msg.activates || []).forEach((act, idx) => {
    const sc = scoreActivation(act);
    if (sc > bestStarterActScore) {
      bestStarterActScore = sc;
      bestStarterActIdx = idx;
    }
  });

  if (bestStarterActIdx >= 0 && bestStarterActScore >= 200) {
    const act = msg.activates[bestStarterActIdx];
    const key = `${act.code}:${act.description}`;
    aiState.activationCounts.set(key, (aiState.activationCounts.get(key) || 0) + 1);
    aiState.actionCount++;
    return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: bestStarterActIdx };
  }

  // 2. Special Summons (Extra Deck Bosses / Extenders)
  if (msg.special_summons?.length > 0) {
    let bestSsIdx = 0;
    let bestSsScore = -Infinity;
    msg.special_summons.forEach((ss, idx) => {
      const meta = getCardMeta(ss.code);
      const flags = classifyCardText(meta);
      let sc = Number(meta?.atk ?? 0) + (meta?.isExtraDeck ? 1000 : 0);
      if (flags.hasNegate) sc += 800;
      if (flags.hasRemoval) sc += 500;
      if (flags.hasSearch) sc += 450;
      if (sc > bestSsScore) {
        bestSsScore = sc;
        bestSsIdx = idx;
      }
    });
    aiState.actionCount++;
    return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, index: bestSsIdx };
  }

  // 3. Normal Summon best starter / beater (avoid wasting hand traps as normal summon)
  if (msg.summons?.length > 0) {
    let bestNsIdx = -1;
    let bestNsScore = -Infinity;
    msg.summons.forEach((ns, idx) => {
      const code = Number(ns.code || 0);
      const meta = getCardMeta(code);
      const flags = classifyCardText(meta);
      let sc = Number(meta?.atk ?? 0);
      if (flags.hasSearch) sc += 900;
      if (flags.hasSpecialSummon) sc += 600;
      if (HAND_TRAP_CODES.has(code)) sc -= 2500;
      if (sc > bestNsScore) {
        bestNsScore = sc;
        bestNsIdx = idx;
      }
    });
    if (bestNsIdx >= 0 && (bestNsScore > -1000 || aiMonsters.length === 0)) {
      aiState.actionCount++;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: bestNsIdx };
    }
  }

  // 4. Remaining beneficial activations
  if (bestStarterActIdx >= 0) {
    const act = msg.activates[bestStarterActIdx];
    const key = `${act.code}:${act.description}`;
    aiState.activationCounts.set(key, (aiState.activationCounts.get(key) || 0) + 1);
    aiState.actionCount++;
    return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: bestStarterActIdx };
  }

  // 5. Smart Position Changes (MP1 -> switch to ATK if safe/can attack; MP2 -> switch weak ATK to DEF)
  if (profile.allowPosChange && msg.pos_changes?.length > 0) {
    for (let i = 0; i < msg.pos_changes.length; i++) {
      const pc = msg.pos_changes[i];
      const posKey = `${pc.controller}:${pc.location}:${pc.sequence}`;
      if (aiState.posChangedKeys.has(posKey)) continue;
      const live = lookupLiveCard(state, pc.controller, pc.location, pc.sequence);
      if (!live) continue;
      const atk = Number(live.currentAtk ?? live.atk ?? 0);
      const def = Number(live.currentDef ?? live.def ?? 0);
      const isDef = live.position === POSITIONS.DEF || live.position === POSITIONS.SET_DEF;
      if (phase === PHASES.MP1 && isDef && atk > 0) {
        const safeToAtk = oppTargets.length === 0 || oppTargets.some(t => canAttackerBeatTarget(atk, t, evaluateMonsterThreat(live, live), profile));
        if (safeToAtk && atk >= oppMaxAtk) {
          aiState.posChangedKeys.add(posKey);
          aiState.actionCount++;
          return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_POS_CHANGE, index: i };
        }
      } else if (phase === PHASES.MP2 && !isDef && def > atk && (atk < oppMaxAtk || atk < 1200)) {
        aiState.posChangedKeys.add(posKey);
        aiState.actionCount++;
        return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_POS_CHANGE, index: i };
      }
    }
  }

  return endOrBattle();
}

function handleSelectBattleCmd(msg, ctx, profile) {
  const { aiIndex, state, aiState } = ctx;
  const oppPlayer = state?.players?.[1 - aiIndex];
  const oppLp = Number(oppPlayer?.lp ?? 8000);
  const oppTargets = getOpponentBattleTargets(oppPlayer);
  const attacks = msg.attacks || [];

  aiState.pendingAttackTarget = null;

  if (attacks.length > 0) {
    const attackers = attacks.map((a, idx) => {
      const live = lookupLiveCard(state, a.controller, a.location, a.sequence);
      const atk = Number(live?.currentAtk ?? a.atk ?? 0);
      const threat = evaluateMonsterThreat(live, live);
      return { idx, entry: a, live, atk, threat };
    });

    if (oppTargets.length === 0) {
      // Open board: direct attack!
      const viable = attackers.filter(a => a.atk > 0);
      if (viable.length > 0) {
        if (profile.useLethalCalc) {
          // Master Duel best practice: attack with lowest ATK first to play around Gorz/hand traps
          viable.sort((a, b) => a.atk - b.atk);
        } else {
          viable.sort((a, b) => b.atk - a.atk);
        }
        return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: viable[0].idx };
      }
    } else if (!profile.preventSuicide) {
      // Easy mode: avoid blatant 0-ATK suicide, otherwise attack casually
      const viable = attackers.filter(a => a.atk > 0);
      if (viable.length > 0) {
        return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: viable[0].idx };
      }
    } else {
      // Normal / Hard: compute best favorable attack pair
      let bestPair = null;
      let bestPairScore = -Infinity;

      for (const att of attackers) {
        for (const tgt of oppTargets) {
          if (!canAttackerBeatTarget(att.atk, tgt, att.threat, profile)) continue;
          const damage = tgt.inDef ? 0 : Math.max(0, att.atk - tgt.atk);
          // Prefer clearing highest-threat target using the smallest attacker that cleanly wins
          let pairScore = tgt.threat * 2 + damage - att.atk * 0.15;
          if (profile.useLethalCalc && !tgt.inDef && damage >= oppLp) {
            pairScore += 50000;
          }
          if (pairScore > bestPairScore) {
            bestPairScore = pairScore;
            bestPair = { att, tgt };
          }
        }
      }

      if (bestPair) {
        aiState.pendingAttackTarget = bestPair.tgt.card?.instanceId || null;
        return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: bestPair.att.idx };
      }
    }
  }

  if (msg.to_m2) {
    return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_M2, index: null };
  }
  return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
}

function handleSelectChain(msg, ctx, profile) {
  const { aiIndex, state, phase, turnCount, turnPlayerIndex, chainStack, aiState, getCardMeta } = ctx;
  const selects = msg.selects || [];
  if (selects.length === 0) return { type: OcgResponseType.SELECT_CHAIN, index: null };

  const scoreChainOption = (sel) => {
    const code = Number(sel.code || 0);
    const meta = getCardMeta(code);
    const flags = classifyCardText(meta);
    let score = 10;
    if (code === 23434538) score += 220; // Maxx "C"
    if (code === 14558127) score += 200; // Ash Blossom
    if (code === 24224830 || code === 65681983) score += 190; // Called By / Crossout
    if (flags.hasNegate) score += 170;
    if (flags.hasRemoval) score += 130;
    if (flags.hasSearch) score += 110;
    if (flags.hasSpecialSummon) score += 90;
    return score;
  };

  if (msg.forced) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    selects.forEach((s, idx) => {
      const sc = scoreChainOption(s);
      if (sc > bestScore) { bestScore = sc; bestIdx = idx; }
    });
    return { type: OcgResponseType.SELECT_CHAIN, index: bestIdx };
  }

  if (aiState.chainKeys.size >= profile.maxChainsPerTurn) {
    return { type: OcgResponseType.SELECT_CHAIN, index: null };
  }

  const topChain = chainStack[chainStack.length - 1];
  const respondingToOpp = Boolean(topChain && topChain.playerIndex !== aiIndex);
  const openOnOppTurn = chainStack.length === 0 && turnPlayerIndex !== aiIndex;
  const speCount = Number(msg.spe_count || 0);

  // Easy AI: never interrupts opponent proactively; only fires own free mandatory/trigger effects
  if (!profile.chainOnOppCard) {
    if (turnPlayerIndex === aiIndex && speCount > 0) {
      const key = `${turnCount}:easy_trig:${selects[0].code}:${selects[0].description}`;
      if (!aiState.chainKeys.has(key)) {
        aiState.chainKeys.add(key);
        return { type: OcgResponseType.SELECT_CHAIN, index: 0 };
      }
    }
    return { type: OcgResponseType.SELECT_CHAIN, index: null };
  }

  // Own Chain Link / own turn: only trigger event-triggered effects (spe_count > 0), never negate self
  if (!respondingToOpp && !openOnOppTurn) {
    if (speCount > 0) {
      for (let i = 0; i < selects.length; i++) {
        const sel = selects[i];
        if (profile.holdHandTraps && HAND_TRAP_CODES.has(Number(sel.code))) continue;
        const key = `${turnCount}:self_trig:${sel.code}:${sel.description}`;
        if (!aiState.chainKeys.has(key)) {
          aiState.chainKeys.add(key);
          return { type: OcgResponseType.SELECT_CHAIN, index: i };
        }
      }
    }
    return { type: OcgResponseType.SELECT_CHAIN, index: null };
  }

  // Responding to Opponent's Chain Link
  if (respondingToOpp) {
    const chainLen = chainStack.length;
    const candidates = selects
      .map((sel, idx) => ({ sel, idx, score: scoreChainOption(sel), meta: getCardMeta(sel.code) }))
      .sort((a, b) => b.score - a.score);

    for (const c of candidates) {
      const flags = classifyCardText(c.meta);
      const isNegateOption = flags.hasNegate || Number(c.sel.code) === 14558127;
      if (isNegateOption && aiState.negatedChainLinks.has(chainLen)) {
        continue; // Already chained a negate to this exact Chain Link
      }
      const key = `${turnCount}:cl${chainLen}:${c.sel.controller}:${c.sel.location}:${c.sel.sequence}:${c.sel.code}:${c.sel.description}`;
      if (!aiState.chainKeys.has(key)) {
        aiState.chainKeys.add(key);
        if (isNegateOption) aiState.negatedChainLinks.add(chainLen);
        return { type: OcgResponseType.SELECT_CHAIN, index: c.idx };
      }
    }
    return { type: OcgResponseType.SELECT_CHAIN, index: null };
  }

  // Open window on opponent's turn
  if (openOnOppTurn) {
    const oppPlayer = state?.players?.[1 - aiIndex];
    const oppMonsters = getPlayerFieldMonsters(oppPlayer).filter(m => !m.isFaceDown && !m.effectsNegated);

    const candidates = selects
      .map((sel, idx) => ({ sel, idx, score: scoreChainOption(sel), code: Number(sel.code || 0) }))
      .sort((a, b) => b.score - a.score);

    for (const c of candidates) {
      // Skip empty Draw/Standby Phase open windows for targeted negates like Veiler/Imperm
      if ((c.code === 97268402 || c.code === 10045474) && oppMonsters.length === 0) {
        continue;
      }
      // Maxx "C" in SP/MP1/BP is great; skip in End Phase
      if (c.code === 23434538 && phase === PHASES.EP) {
        continue;
      }
      const key = `${turnCount}:open:${phase}:${c.sel.code}:${c.sel.description}`;
      if (!aiState.chainKeys.has(key)) {
        aiState.chainKeys.add(key);
        return { type: OcgResponseType.SELECT_CHAIN, index: c.idx };
      }
    }
  }

  return { type: OcgResponseType.SELECT_CHAIN, index: null };
}

function handleSelectCardOrTribute(msg, ctx, profile, isTribute = false) {
  const { aiIndex, state, phase, lastHintMsg, aiState, getCardMeta } = ctx;
  const selects = msg.selects || [];
  const count = Math.max(0, Math.min(msg.min || 1, selects.length));
  const respType = isTribute ? OcgResponseType.SELECT_TRIBUTE : OcgResponseType.SELECT_CARD;

  if (count === 0) {
    return { type: respType, indicies: [] };
  }

  // 1. Attack target selection (Battle Phase or hint 549)
  const allOppMonsters = selects.length > 0 && selects.every(s => s.controller !== aiIndex && s.location === OcgLocation.MZONE);
  if (!isTribute && (lastHintMsg === 549 || (phase === PHASES.BP && allOppMonsters))) {
    if (aiState.pendingAttackTarget && count === 1) {
      const targetId = aiState.pendingAttackTarget;
      aiState.pendingAttackTarget = null;
      const matchIdx = selects.findIndex(
        s => `ocg_p${s.controller}_loc${s.location}_seq${s.sequence}` === targetId
      );
      if (matchIdx >= 0) {
        return { type: respType, indicies: [matchIdx] };
      }
    }
    if (profile.smartTargeting) {
      const ranked = selects
        .map((s, idx) => {
          const live = lookupLiveCard(state, s.controller, s.location, s.sequence);
          const meta = getCardMeta(s.code);
          return { idx, threat: evaluateMonsterThreat(live, meta) };
        })
        .sort((a, b) => b.threat - a.threat);
      return { type: respType, indicies: ranked.slice(0, count).map(r => r.idx) };
    }
  }

  if (!profile.smartTargeting) {
    return { type: respType, indicies: Array.from({ length: count }, (_, i) => i) };
  }

  // 2. Determine intent: adversarial (destroy/banish/negate), cost/tribute, or gain (search/summon)
  const hasOpp = selects.some(s => s.controller !== aiIndex);
  const hasSelf = selects.some(s => s.controller === aiIndex);
  const allDeckGyExtra = selects.every(
    s => s.location === OcgLocation.DECK || s.location === OcgLocation.GRAVE || s.location === OcgLocation.EXTRA
  );

  let mode = 'GAIN';
  if (isTribute || HINT_COST_OR_TRIBUTE.has(lastHintMsg)) {
    mode = 'COST';
  } else if (HINT_ADVERSARIAL.has(lastHintMsg)) {
    mode = 'ADVERSARIAL';
  } else if (HINT_GAIN.has(lastHintMsg)) {
    mode = 'GAIN';
  } else if (hasOpp && !allDeckGyExtra) {
    mode = 'ADVERSARIAL';
  } else if (hasSelf && !hasOpp && !allDeckGyExtra) {
    mode = 'COST';
  }

  const scored = selects.map((s, idx) => {
    const live = lookupLiveCard(state, s.controller, s.location, s.sequence);
    const meta = getCardMeta(s.code);
    const isOpp = s.controller !== aiIndex;

    if (mode === 'ADVERSARIAL') {
      // Strongly prefer opponent's highest-threat cards; if forced to pick own, pick lowest keep-value
      const threat = evaluateMonsterThreat(live, meta);
      const keep = evaluateCardKeepValue(s, live, meta);
      const score = isOpp ? (100000 + threat) : (10000 - keep);
      return { idx, score };
    }

    if (mode === 'COST') {
      // If allowed to tribute opponent monster (Kaiju / Lair / Super Poly), pick opp highest threat first!
      const keep = evaluateCardKeepValue(s, live, meta);
      const threat = evaluateMonsterThreat(live, meta);
      const score = isOpp ? (100000 + threat) : (10000 - keep);
      return { idx, score };
    }

    // GAIN: Search / Add / Special Summon highest-value card
    const value = evaluateCardKeepValue(s, live, meta);
    return { idx, score: value };
  });

  scored.sort((a, b) => b.score - a.score);
  return {
    type: respType,
    indicies: scored.slice(0, count).map(r => r.idx)
  };
}

function handleSelectPosition(msg, ctx, profile) {
  const { aiIndex, state, getCardMeta } = ctx;
  const mask = msg.positions;

  if (!profile.smartPosition) {
    const pos = (mask & OcgPosition.FACEUP_ATTACK)
      ? OcgPosition.FACEUP_ATTACK
      : (mask & OcgPosition.FACEUP_DEFENSE)
        ? OcgPosition.FACEUP_DEFENSE
        : OcgPosition.FACEDOWN_DEFENSE;
    return { type: OcgResponseType.SELECT_POSITION, position: pos };
  }

  const meta = getCardMeta(msg.code);
  const atk = Number(meta?.atk ?? 0);
  const def = Number(meta?.def ?? 0);
  const oppPlayer = state?.players?.[1 - aiIndex];
  const oppMaxAtk = getOpponentMaxFieldAtk(oppPlayer);

  const canAtk = Boolean(mask & OcgPosition.FACEUP_ATTACK);
  const canDef = Boolean(mask & OcgPosition.FACEUP_DEFENSE);
  const canSetDef = Boolean(mask & OcgPosition.FACEDOWN_DEFENSE);

  const shouldDefend =
    (atk < def && (atk < 1800 || oppMaxAtk > atk)) ||
    (atk <= 1000 && def >= 1500 && oppMaxAtk >= atk);

  if (shouldDefend) {
    if (canDef) return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEUP_DEFENSE };
    if (canSetDef) return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEDOWN_DEFENSE };
  }
  if (canAtk) return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEUP_ATTACK };
  if (canDef) return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEUP_DEFENSE };
  if (canSetDef) return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEDOWN_DEFENSE };
  return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEUP_ATTACK };
}

function handleSelectPlace(msg, ctx, profile) {
  const { aiIndex, state, pickFirstAvailablePlaces } = ctx;
  const mask = msg.field_mask || 0;
  const count = msg.count || 1;
  const isDisfield = msg.type === OcgMessageType.SELECT_DISFIELD;
  const respType = isDisfield ? OcgResponseType.SELECT_DISFIELD : OcgResponseType.SELECT_PLACE;

  if (!profile.preferImpermSafeColumn) {
    const places = pickFirstAvailablePlaces(mask, count, msg.player);
    return { type: respType, places };
  }

  const opp = 1 - aiIndex;
  const oppStz = state?.players?.[opp]?.stz || [];
  const places = [];
  const tryOrder = (player, location, seqOrder, bitBase, baseSeq = 0) => {
    for (const seq of seqOrder) {
      const bit = bitBase + (seq - baseSeq);
      if (((mask >>> bit) & 1) === 0) {
        places.push({ player, location, sequence: seq });
        if (places.length >= count) return true;
      }
    }
    return false;
  };

  // Prefer center/non-Imperm columns for SZONE & MZONE
  const safeSzoneOrder = [2, 1, 3, 0, 4].sort((a, b) => {
    const aHasOppSet = oppStz[4 - a]?.isFaceDown ? 1 : 0;
    const bHasOppSet = oppStz[4 - b]?.isFaceDown ? 1 : 0;
    return aHasOppSet - bHasOppSet;
  });

  if (tryOrder(msg.player, OcgLocation.MZONE, [2, 1, 3, 0, 4], 0, 0)) return { type: respType, places };
  if (tryOrder(msg.player, OcgLocation.MZONE, [5, 6], 5, 5)) return { type: respType, places };
  if (tryOrder(msg.player, OcgLocation.SZONE, safeSzoneOrder, 8, 0)) return { type: respType, places };
  if (tryOrder(msg.player, OcgLocation.SZONE, [5], 13, 5)) return { type: respType, places };

  const fallback = pickFirstAvailablePlaces(mask, count, msg.player);
  return { type: respType, places: fallback };
}

/**
 * Compute AI response for any `ocgcore-wasm` prompt.
 * Guarantees a legal response and falls back safely if `retryAttempt > 0`.
 */
export function computeYgoProAiResponse(msg, ctx) {
  if (!msg) return null;
  const difficulty = normalizeAiDifficulty(ctx?.difficulty);
  const profile = AI_DIFFICULTY_PROFILES[difficulty];
  const retryAttempt = Number(ctx?.retryAttempt || 0);

  if (retryAttempt > 0) {
    return buildRetryFallback(msg, ctx);
  }

  switch (msg.type) {
    case OcgMessageType.SELECT_IDLECMD:
      return handleSelectIdleCmd(msg, ctx, profile);
    case OcgMessageType.SELECT_BATTLECMD:
      return handleSelectBattleCmd(msg, ctx, profile);
    case OcgMessageType.SELECT_CHAIN:
      return handleSelectChain(msg, ctx, profile);
    case OcgMessageType.SELECT_CARD:
      return handleSelectCardOrTribute(msg, ctx, profile, false);
    case OcgMessageType.SELECT_TRIBUTE:
      return handleSelectCardOrTribute(msg, ctx, profile, true);
    case OcgMessageType.SELECT_UNSELECT_CARD: {
      if (msg.can_finish) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
      if (msg.select_cards?.length > 0) {
        if (profile.smartTargeting) {
          const fakeSelect = {
            ...msg,
            min: 1,
            selects: msg.select_cards
          };
          const picked = handleSelectCardOrTribute(fakeSelect, ctx, profile, false);
          return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: picked.indicies?.[0] ?? 0 };
        }
        return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: 0 };
      }
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
    }
    case OcgMessageType.SELECT_POSITION:
      return handleSelectPosition(msg, ctx, profile);
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD:
      return handleSelectPlace(msg, ctx, profile);
    case OcgMessageType.SELECT_EFFECTYN:
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: true };
    case OcgMessageType.SELECT_YESNO:
      return { type: OcgResponseType.SELECT_YESNO, yes: true };
    case OcgMessageType.SELECT_OPTION: {
      const opts = msg.options || [];
      if (profile.smartTargeting && opts.length > 1) {
        // Prefer 573 (Add to Hand) / 1152 (Special Summon) / 1190 (Add to Hand) over 574 (Send to GY)
        const preferred = opts.findIndex((o) => {
          const n = Number(o);
          return n === 573 || n === 1152 || n === 1190;
        });
        if (preferred >= 0) return { type: OcgResponseType.SELECT_OPTION, index: preferred };
      }
      return { type: OcgResponseType.SELECT_OPTION, index: 0 };
    }
    case OcgMessageType.SELECT_SUM:
      return {
        type: OcgResponseType.SELECT_SUM,
        indicies: ctx.solveSelectSum ? ctx.solveSelectSum(msg) : [0]
      };
    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN:
      return { type: OcgResponseType.SORT_CARD, order: null };
    case OcgMessageType.SELECT_COUNTER: {
      let remaining = msg.count || 0;
      const counters = (msg.cards || []).map((c) => {
        const take = Math.min(remaining, c.count || 0);
        remaining -= take;
        return take;
      });
      return { type: OcgResponseType.SELECT_COUNTER, counters };
    }
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: 1 };
    case OcgMessageType.ANNOUNCE_NUMBER:
      return { type: OcgResponseType.ANNOUNCE_NUMBER, value: msg.values?.[0] ?? 1 };
    case OcgMessageType.ANNOUNCE_RACE: {
      const avail = BigInt(msg.available || 1n);
      let chosen = 1n;
      for (let b = 0n; b < 32n; b++) {
        const bit = 1n << b;
        if ((avail & bit) !== 0n) { chosen = bit; break; }
      }
      return { type: OcgResponseType.ANNOUNCE_RACE, races: [chosen] };
    }
    case OcgMessageType.ANNOUNCE_ATTRIB: {
      const avail = Number(msg.available || 1);
      let chosen = 1;
      for (let b = 0; b < 16; b++) {
        const bit = 1 << b;
        if ((avail & bit) !== 0) { chosen = bit; break; }
      }
      return { type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: [chosen] };
    }
    case OcgMessageType.ANNOUNCE_CARD: {
      const matches = ctx.findAnnounceCardCodes ? ctx.findAnnounceCardCodes(msg.opcodes || [], 1) : [];
      return { type: OcgResponseType.ANNOUNCE_CARD, card: matches[0] || 14558127 };
    }
    default:
      return null;
  }
}
