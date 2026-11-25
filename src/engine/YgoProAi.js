/**
 * @fileoverview Tactical YGOPro Core AI Decision Engine (`Easy` / `Normal` / `Hard`)
 * Evaluates live board state, card metadata, zone/controller-aware ProjectIgnis
 * HINT_SELECTMSG context, battle math, lethal calculation, Battle Phase chains,
 * Extra Deck discipline, and anti-self-sabotage chain/activation rules.
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
    preferImpermSafeColumn: false,
    useBattleChains: false
  }),
  [AI_DIFFICULTY.NORMAL]: Object.freeze({
    id: AI_DIFFICULTY.NORMAL,
    labelEn: 'Normal',
    labelTh: 'ปกติ (Normal)',
    maxActionsPerTurn: 10,
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
    preferImpermSafeColumn: false,
    useBattleChains: true
  }),
  [AI_DIFFICULTY.HARD]: Object.freeze({
    id: AI_DIFFICULTY.HARD,
    labelEn: 'Hard',
    labelTh: 'ยาก (Hard)',
    maxActionsPerTurn: 20,
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
    preferImpermSafeColumn: true,
    useBattleChains: true
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
    battleChainKeys: new Set(),
    chainKeys: new Set(),
    negatedChainLinks: new Set(),
    pendingAttackTarget: null,
    posChangedKeys: new Set(),
    extraSummonedCodes: new Set(),
    unselectPickCount: 0
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

// Board breakers / interaction cards that require opponent targets to avoid self-sabotage
const OPP_MONSTER_NEEDED_CODES = new Set([
  12580477, // Raigeki
  14532163, // Lightning Storm
  98338152, // Sky Striker Mecha - Widow Anchor
  24299458, // Forbidden Droplet
  54693926, // Dark Ruler No More
  14087893, // Book of Moon
  35480699, // Book of Eclipse
  37520316, // Mind Control
  4031928,  // Change of Heart
  45986603, // Snatch Steal
  99550630, // Sky Striker Maneuver - Afterburners!
  48130397, // Super Polymerization
  10045474  // Infinite Impermanence
]);

const SYMMETRICAL_MONSTER_WIPE_CODES = new Set([
  53129443  // Dark Hole
]);

const OPP_BACKROW_NEEDED_CODES = new Set([
  18144506, // Harpie's Feather Duster
  5318639,  // Mystical Space Typhoon
  8267140,  // Cosmic Cyclone
  43898403, // Twin Twisters
  25955749  // Sky Striker Maneuver - Jamming Waves!
]);

const SYMMETRICAL_BACKROW_WIPE_CODES = new Set([
  19613556  // Heavy Storm
]);

// Key archetype cards needing special tactical awareness
const CARD_BARONNE_DE_FLEUR = 84815190;
const CARD_SP_LITTLE_KNIGHT = 29301450;
const CARD_SKY_STRIKER_HAYATE = 8491308;
const CARD_SKY_STRIKER_SHIZUKU = 90673288;
const CARD_SKY_STRIKER_KAGARI = 63288573;
const CARD_SKY_STRIKER_AREA_ZERO = 50005218;
const CARD_MAXX_C = 23434538;
const CARD_ASH_BLOSSOM = 14558127;
const CARD_EFFECT_VEILER = 97268402;
const CARD_INFINITE_IMPERM = 10045474;
const CARD_CALLED_BY = 24224830;
const CARD_CROSSOUT = 65681983;
const CARD_MULCHARMY_FUWALOS = 42141493;
const CARD_MULCHARMY_PURULIA = 84192580;

// ProjectIgnis HINT_SELECTMSG codes
const HINT_DESTROY_OR_NEGATE = new Set([
  502, // Destroy
  514, // Equip
  519, // Change Position
  549, // Attack Target
  560, // Take Control
  562, // Attach Material (opponent)
  575  // Negate
]);

const HINT_TARGET_GENERIC = new Set([
  550, // Target
  551  // Target
]);

const HINT_BOUNCE_OR_SPIN = new Set([
  505, // Return to Hand
  507  // Return to Deck
]);

const HINT_SEND_TO_GY = 504;
const HINT_BANISH = 503;

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
  525, // Reveal
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

function getPlayerTotalBackrowIncludingField(playerState) {
  return getPlayerBackrowCount(playerState) + (playerState?.fieldZone || playerState?.fieldSpell ? 1 : 0);
}

function getPlayerTotalFieldCards(playerState) {
  return getPlayerFieldMonsters(playerState).length + getPlayerTotalBackrowIncludingField(playerState);
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

function classifyCardText(meta, resolvedDesc = '') {
  const desc = String(meta?.description || '').toLowerCase();
  const rDesc = String(resolvedDesc || '').toLowerCase();
  const hasNegate = /\bnegate\b/.test(desc);
  const hasSearch =
    /\badd\b[^.]*\bfrom your deck\b/.test(desc) ||
    /\badd\b[^.]*\bto your hand\b/.test(desc) ||
    /\bdraw \d|\bdraw cards?/.test(desc) ||
    /\bexcavate\b/.test(desc);
  const hasDeckDump =
    /\bsend\b[^.]*\bfrom your deck to the gy\b/.test(desc) ||
    /\bsend\b[^.]*\bfrom your hand or deck to the gy\b/.test(desc);
  const hasSetFromDeck =
    /\bset\b[^.]*\bfrom your (deck|gy)\b/.test(desc) ||
    /\bset it to your field\b/.test(desc) ||
    /\bplace\b[^.]*\bfrom your (hand|deck|gy)\b/.test(desc);
  const hasFusionOrRitual = /\bfusion summon\b|\britual summon\b/.test(desc);
  const hasTokenSummon = /\bspecial summon\b[^.]*\btoken\b/.test(desc);
  const hasSpecialSummon =
    /\bspecial summon\b/.test(desc) ||
    hasFusionOrRitual ||
    /\bsynchro summon\b|\bxyz summon\b|\blink summon\b/.test(desc);
  const hasGyTrigger =
    /if this card is sent to the gy|when this card is sent to the gy|if this card is in your gy|you can banish this card from your gy|during the end phase, if this card is in the gy/.test(desc);
  const hasBanishTrigger =
    /if this card is banished|when this card is banished|if this card is currently banished/.test(desc);
  const hasRemoval = /\b(destroy|banish|send.*to the gy|return.*to the hand|return.*to the deck)\b/.test(desc);
  const hasBackrowRemoval = /\bdestroy\b[^.]*\b(spell|trap|spells\/traps)\b/.test(desc);
  const isQuick =
    /\bquick effect\b|\(quick effect\)/.test(desc) ||
    meta?.subtype === 'QUICK_PLAY' ||
    meta?.kind === 'TRAP';
  const isFieldDestructionAction =
    (/\bdestroy\b/.test(rDesc) && !/\bsearch|add|summon|draw\b/.test(rDesc)) ||
    (/\btarget 1 card on the field;\s*destroy it\b/.test(desc) && !hasSearch && !hasSpecialSummon);
  const isPureFieldNegate =
    hasNegate && !hasSearch && !hasSpecialSummon && !hasDeckDump && !hasSetFromDeck;
  const isStandbyReturnToExtra =
    /return this card to the extra deck/.test(rDesc) ||
    (/during the standby phase/.test(desc) && /return this card to the extra deck/.test(desc));

  return {
    hasNegate,
    hasSearch,
    hasDeckDump,
    hasSetFromDeck,
    hasFusionOrRitual,
    hasTokenSummon,
    hasSpecialSummon,
    hasGyTrigger,
    hasBanishTrigger,
    hasRemoval,
    hasBackrowRemoval,
    isQuick,
    isFieldDestructionAction,
    isPureFieldNegate,
    isStandbyReturnToExtra
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

export function evaluateCardKeepValue(entry, liveCard, meta) {
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
  if (flags.hasFusionOrRitual) score += 650;
  if (flags.hasTokenSummon) score += 600;
  if (flags.hasSpecialSummon) score += 450;
  if (flags.hasSetFromDeck) score += 500;
  if (flags.hasDeckDump) score += 450;
  if (flags.hasRemoval) score += 400;
  if (liveCard?.effectsNegated) score -= 500;
  // Tokens or 0-ATK vanilla bodies on field are prime tribute/material fodder
  if (meta?.frame === 'TOKEN') {
    score -= 1200;
  } else if (entry?.location === OcgLocation.MZONE && atk === 0 && !meta?.isExtraDeck) {
    score -= 600;
  }
  return score;
}

function evaluateDeckDumpValue(entry, meta) {
  if (!meta) return 0;
  const flags = classifyCardText(meta);
  const atk = Number(meta.atk ?? 0);
  const lv = Number(meta.level ?? 0);
  let score = Math.max(atk, lv * 200);
  // Strongly prefer cards that actually trigger or extend from the GY!
  if (flags.hasGyTrigger) score += 2600;
  if (flags.hasBanishTrigger) score += 500;
  if (flags.hasSearch) score += 550;
  if (flags.hasSpecialSummon) score += 500;
  if (flags.hasFusionOrRitual) score += 400;
  if (meta.isExtraDeck) score += 700;
  if (HAND_TRAP_CODES.has(Number(entry?.code || meta.passcode || 0))) {
    // Don't waste hand traps from Deck unless forced
    score -= 1000;
  }
  return score;
}

function isSpellTrapInHandTrapList(code) {
  return QUICK_DISRUPTION_CODES.has(Number(code || 0));
}

function resolveEffectText(ctx, description, code) {
  if (typeof ctx?.resolveDescription === 'function') {
    try {
      return String(ctx.resolveDescription(description, code) || '');
    } catch {
      return '';
    }
  }
  return '';
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
      return { type: OcgResponseType.ANNOUNCE_CARD, card: matches[0] || CARD_ASH_BLOSSOM };
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

function isSelfSabotageActivation(act, ctx, aiPlayer, oppPlayer, aiMonsters, oppTargets, { respondingToOpp = false } = {}) {
  const code = Number(act?.code || 0);
  const meta = ctx.getCardMeta(code);
  const resolvedDesc = resolveEffectText(ctx, act?.description, code);
  const flags = classifyCardText(meta, resolvedDesc);
  const oppBackrowTotal = getPlayerTotalBackrowIncludingField(oppPlayer);
  const aiBackrowTotal = getPlayerTotalBackrowIncludingField(aiPlayer);
  const oppTotalField = oppTargets.length + oppBackrowTotal;
  const oppGyCount = (oppPlayer?.gy || []).length;

  // 1. Never replace active Field Spell with the exact same Field Spell
  const activeField = aiPlayer?.fieldZone || aiPlayer?.fieldSpell;
  if (
    meta?.subtype === 'FIELD' &&
    act.location === OcgLocation.HAND &&
    activeField &&
    Number(activeField.passcode) === code
  ) {
    return true;
  }

  // 2. Symmetrical monster wipes (Dark Hole): don't wipe own board when opp has nothing or less threat
  if (SYMMETRICAL_MONSTER_WIPE_CODES.has(code)) {
    if (oppTargets.length === 0) return true;
    const aiThreat = aiMonsters.reduce((s, m) => s + evaluateMonsterThreat(m, m), 0);
    const oppThreat = oppTargets.reduce((s, t) => s + t.threat, 0);
    if (aiMonsters.length > 0 && oppThreat <= aiThreat * 1.15) return true;
  }

  // 3. Symmetrical backrow wipes (Heavy Storm): don't blow up own Field/backrow when opp has 0 or less
  if (SYMMETRICAL_BACKROW_WIPE_CODES.has(code)) {
    if (oppBackrowTotal === 0) return true;
    if (aiBackrowTotal >= oppBackrowTotal) return true;
  }

  // 4. Opponent-monster-only spells/interaction (Raigeki, Widow Anchor, Book of Moon, Afterburners, etc.)
  if (OPP_MONSTER_NEEDED_CODES.has(code) && oppTargets.length === 0) {
    return true;
  }

  // 5. Opponent-backrow-only removal (HFD, MST, Cosmic Cyclone, Twin Twisters, Jamming Waves)
  if (OPP_BACKROW_NEEDED_CODES.has(code) && oppBackrowTotal === 0) {
    return true;
  }

  // 6. Baronne de Fleur: when NOT responding to opp's chain, skip destroy-1 on empty opp field
  if (!respondingToOpp && code === CARD_BARONNE_DE_FLEUR && oppTotalField === 0) {
    return true;
  }

  // 7. S:P Little Knight banish effect when opponent has 0 field & 0 GY cards
  if (!respondingToOpp && code === CARD_SP_LITTLE_KNIGHT && oppTotalField === 0 && oppGyCount === 0) {
    return true;
  }

  // 8. Generic field-destruction or pure-negate effect on empty opponent board (only outside opp-chain responses!)
  if (!respondingToOpp && flags.isFieldDestructionAction && oppTotalField === 0) {
    return true;
  }
  if (!respondingToOpp && flags.isPureFieldNegate && oppTargets.length === 0) {
    return true;
  }

  // 9. Sky Striker Airspace - Area Zero field activation: don't sacrifice our ONLY monster on field
  //    when we have no extra S/T to target (prevents blowing up own Kagari/Shizuku for nothing)
  if (
    code === CARD_SKY_STRIKER_AREA_ZERO &&
    (act.location === OcgLocation.SZONE || act.location === OcgLocation.FZONE) &&
    aiMonsters.length === 1 &&
    getPlayerBackrowCount(aiPlayer) === 0
  ) {
    return true;
  }

  return false;
}

function handleSelectIdleCmd(msg, ctx, profile) {
  const { aiIndex, state, phase, aiState, getCardMeta } = ctx;
  aiState.unselectPickCount = 0;

  const aiPlayer = state?.players?.[aiIndex];
  const oppPlayer = state?.players?.[1 - aiIndex];
  const aiMonsters = getPlayerFieldMonsters(aiPlayer);
  const oppTargets = getOpponentBattleTargets(oppPlayer);
  const oppMaxAtk = getOpponentMaxFieldAtk(oppPlayer);
  const oppBackrowTotal = getPlayerTotalBackrowIncludingField(oppPlayer);

  const endOrBattle = () => {
    // Before ending turn (MP2 or Turn 1 MP1 when Battle Phase isn't available), set protective backrow / wall
    if (msg.spell_sets?.length > 0 && (phase === PHASES.MP2 || !msg.to_bp)) {
      const currentSetCount = getPlayerBackrowCount(aiPlayer);
      if (currentSetCount < profile.setBackrowLimit) {
        let bestIdx = -1;
        let bestScore = -Infinity;
        const handCount = (aiPlayer?.hand || []).length;
        msg.spell_sets.forEach((s, idx) => {
          const code = Number(s.code || 0);
          const meta = getCardMeta(code);
          let sc = 0;
          if (meta?.kind === 'TRAP') sc += 40;
          else if (meta?.subtype === 'QUICK_PLAY') sc += 30;
          else if (profile.id !== AI_DIFFICULTY.EASY && handCount <= 6) {
            // Normal/Hard: don't blindly set useless Normal/Field/Equip Spells face-down
            sc -= 100;
          } else {
            sc += 5;
          }
          if (QUICK_DISRUPTION_CODES.has(code)) sc += 50;
          if (sc > bestScore) {
            bestScore = sc;
            bestIdx = idx;
          }
        });
        if (bestIdx >= 0 && bestScore > 0 && aiState.actionCount < profile.maxActionsPerTurn) {
          aiState.actionCount++;
          return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPELL_SET, index: bestIdx };
        }
      }
    }

    if (profile.setWallMonster && msg.monster_sets?.length > 0 && aiMonsters.length === 0 && (phase === PHASES.MP2 || !msg.to_bp)) {
      let bestIdx = -1;
      let bestDef = -1;
      msg.monster_sets.forEach((ms, idx) => {
        const code = Number(ms.code || 0);
        const meta = getCardMeta(code);
        const def = Number(meta?.def ?? 0);
        if (!HAND_TRAP_CODES.has(code) && def > bestDef) {
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
          // Direct-attack specialists like Hayate always want Battle Phase
          if (Number(m.passcode) === CARD_SKY_STRIKER_HAYATE) return true;
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

  // Easy mode: simpler, beatable decision flow (still avoids identical Field Spell loop)
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
        const key = `${act.code}:${act.location}:${act.description}`;
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
  // 1. Score activatable Spells / Searchers / Starters / GY extenders / Fusion/Ritual spells
  const scoreActivation = (act) => {
    const key = `${act.code}:${act.location}:${act.description}`;
    const used = aiState.activationCounts.get(key) || 0;
    if (used >= 2) return -9999;

    const code = Number(act.code || 0);
    if (profile.holdHandTraps && act.location === OcgLocation.HAND && isSpellTrapInHandTrapList(code)) {
      return -5000;
    }

    if (isSelfSabotageActivation(act, ctx, aiPlayer, oppPlayer, aiMonsters, oppTargets)) {
      return -5000;
    }

    const meta = getCardMeta(code);
    const resolvedDesc = resolveEffectText(ctx, act.description, code);
    const flags = classifyCardText(meta, resolvedDesc);

    // Never waste pure negate ignition/quick effects proactively on own turn
    if (flags.isPureFieldNegate) {
      return -5000;
    }

    let score = 95;

    // Field Spell from hand (when no identical Field Spell active) -> activate early to unlock search/buffs
    if (meta?.subtype === 'FIELD' && act.location === OcgLocation.HAND) {
      score += 140;
    } else if (act.location === OcgLocation.HAND || act.location === OcgLocation.SZONE || act.location === OcgLocation.FZONE) {
      if (meta?.kind === 'SPELL') score += 80;
    }

    if (act.location === OcgLocation.GRAVE) score += 130;
    if (act.location === OcgLocation.REMOVED) score += 110;
    if (flags.hasFusionOrRitual) score += 180;
    if (flags.hasSearch) score += 170;
    if (flags.hasDeckDump) score += 160;
    if (flags.hasSetFromDeck) score += 150;
    if (flags.hasTokenSummon) score += 165;
    else if (flags.hasSpecialSummon) score += 145;

    if (flags.hasRemoval) {
      if (oppTargets.length > 0 || (flags.hasBackrowRemoval && oppBackrowTotal > 0)) {
        score += 135;
      } else if (!flags.hasSearch && !flags.hasSpecialSummon && !flags.hasDeckDump && !flags.hasSetFromDeck) {
        // Pure removal with nothing on opponent's board
        score -= 400;
      }
    }

    // Pendulum Scale placement (desc 1160): lower than combo starters, still playable
    if (String(act.description || '') === '1160') {
      score = 130;
    }

    score -= used * 110;
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

  // High-priority starters (Field Spells, Searchers, Fusion/Ritual, Deck-Dump, Token/SS extenders)
  if (bestStarterActIdx >= 0 && bestStarterActScore >= 210) {
    const act = msg.activates[bestStarterActIdx];
    const key = `${act.code}:${act.location}:${act.description}`;
    aiState.activationCounts.set(key, (aiState.activationCounts.get(key) || 0) + 1);
    aiState.actionCount++;
    return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: bestStarterActIdx };
  }

  // 2. Normal Summon best combo starter BEFORE Extra Deck summons if we have a starter that generates material/search
  const scoreNormalSummon = (ns) => {
    const code = Number(ns.code || 0);
    const meta = getCardMeta(code);
    const flags = classifyCardText(meta);

    // Never waste a Hand Trap as a Normal Summon unless it's a Tuner and we have a non-Tuner body on field
    if (HAND_TRAP_CODES.has(code)) {
      const hasNonTuner = aiMonsters.some(m => !m.isTuner);
      if (!(meta?.isTuner && hasNonTuner)) return -5000;
      return -1500;
    }

    const lv = Number(meta?.level ?? 0);
    const atk = Number(meta?.atk ?? 0);
    // Guard against bad Tribute Summons (tributing stronger field monsters for a weaker/vanilla Lv5+ monster)
    if (lv >= 5 && aiMonsters.length > 0) {
      const tributesNeeded = lv >= 7 ? 2 : 1;
      const sortedField = [...aiMonsters].sort(
        (a, b) => evaluateCardKeepValue({ location: OcgLocation.MZONE }, a, a) - evaluateCardKeepValue({ location: OcgLocation.MZONE }, b, b)
      );
      const weakestSlice = sortedField.slice(0, tributesNeeded);
      const sacrificedAtk = weakestSlice.reduce((s, m) => s + Number(m.currentAtk ?? m.atk ?? 0), 0);
      const sacrificesBoss = weakestSlice.some(
        m => (m.isExtraDeck && Number(m.currentAtk ?? 0) >= 2000) || Number(m.currentAtk ?? 0) >= 2400
      );
      if (sacrificesBoss) return -5000;
      if (atk <= sacrificedAtk && !flags.hasSearch && !flags.hasSpecialSummon && !flags.hasRemoval) {
        return -3000;
      }
    }

    let sc = atk;
    if (flags.hasTokenSummon) sc += 1200;
    if (flags.hasSearch) sc += 1000;
    if (flags.hasSetFromDeck) sc += 850;
    if (flags.hasDeckDump) sc += 800;
    if (flags.hasSpecialSummon) sc += 650;
    if (flags.hasRemoval && oppTargets.length > 0) sc += 400;
    return sc;
  };

  let bestNsIdx = -1;
  let bestNsScore = -Infinity;
  (msg.summons || []).forEach((ns, idx) => {
    const sc = scoreNormalSummon(ns);
    if (sc > bestNsScore) {
      bestNsScore = sc;
      bestNsIdx = idx;
    }
  });

  // If we have a high-value combo starter Normal Summon (e.g. Mo Ye, Aluber, Sage, Rod, Arianna, Snake-Eye Ash)
  // and no huge Extra Deck boss ready yet, Normal Summon it first to generate combo pieces!
  if (bestNsIdx >= 0 && bestNsScore >= 1800 && !(msg.special_summons || []).some(ss => {
    const m = getCardMeta(ss.code);
    return m?.isExtraDeck && Number(m.atk ?? 0) >= 2500;
  })) {
    aiState.actionCount++;
    return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: bestNsIdx };
  }

  // 3. Special Summons (Extra Deck Bosses / Inherent Extenders) with Extra Deck cycling discipline
  if (msg.special_summons?.length > 0) {
    const hasHayateOnField = aiMonsters.some(m => Number(m.passcode) === CARD_SKY_STRIKER_HAYATE);
    const hasShizukuOnField = aiMonsters.some(m => Number(m.passcode) === CARD_SKY_STRIKER_SHIZUKU);
    const hasSpellInGy = (aiPlayer?.gy || []).some(c => c.kind === 'SPELL');
    const maxFieldAtk = aiMonsters.reduce((mx, m) => Math.max(mx, Number(m.currentAtk ?? m.atk ?? 0)), 0);
    const hasBigBossOnField = aiMonsters.some(m => m.isExtraDeck && Number(m.currentAtk ?? 0) >= 2500);

    let bestSsIdx = -1;
    let bestSsScore = 0;
    msg.special_summons.forEach((ss, idx) => {
      const code = Number(ss.code || 0);
      const meta = getCardMeta(code);
      const flags = classifyCardText(meta);
      const atk = Number(meta?.atk ?? 0);
      const isLink1 = meta?.frame === 'LINK' && Number(meta?.linkRating || 0) === 1;

      // Sky Striker Link-1 tactical discipline:
      // - In MP1 with Battle Phase available, don't Link away Hayate before attacking!
      if (hasHayateOnField && phase === PHASES.MP1 && msg.to_bp && isLink1 && code !== CARD_SKY_STRIKER_KAGARI) {
        return;
      }
      // - In MP2 (or Turn 1 with no BP), don't Link away Shizuku (wait for End Phase search!)
      if (hasShizukuOnField && (phase === PHASES.MP2 || !msg.to_bp) && isLink1) {
        return;
      }
      // - Don't summon Kagari if there are 0 Spells in GY and we already have a Link-1 on field
      if (code === CARD_SKY_STRIKER_KAGARI && !hasSpellInGy && aiMonsters.length > 0) {
        return;
      }
      // - Don't summon Shizuku in MP1 when we can enter Battle Phase and Hayate is available or we already have Hayate
      if (code === CARD_SKY_STRIKER_SHIZUKU && phase === PHASES.MP1 && msg.to_bp) {
        const canSummonHayate = msg.special_summons.some(x => Number(x.code) === CARD_SKY_STRIKER_HAYATE);
        if (canSummonHayate || hasHayateOnField) return;
      }

      // Generic Extra Deck cycling guard: never re-summon the same weak Link-1/Link-2 twice in one turn,
      // don't trade a 2500+ Extra Deck boss down into a <=1500 ATK Link-1,
      // and don't downgrade a sole 1500+ ATK monster into a weaker non-Sky-Striker Link-1 (e.g. Tenpai Paidra -> Striker Dragon)
      const isSkyStrikerLink1 =
        code === CARD_SKY_STRIKER_HAYATE ||
        code === CARD_SKY_STRIKER_SHIZUKU ||
        code === CARD_SKY_STRIKER_KAGARI;
      if (meta?.isExtraDeck && isLink1 && aiState.extraSummonedCodes.has(code)) {
        return;
      }
      if (meta?.isExtraDeck && isLink1 && hasBigBossOnField && aiMonsters.length === 1 && atk < maxFieldAtk) {
        return;
      }
      if (meta?.isExtraDeck && isLink1 && !isSkyStrikerLink1 && aiMonsters.length === 1 && maxFieldAtk >= 1500 && atk < maxFieldAtk) {
        return;
      }

      let sc = atk + (meta?.isExtraDeck ? 1100 : 200);
      if (flags.hasNegate) sc += 900;
      if (flags.hasRemoval && oppTargets.length > 0) sc += 550;
      if (flags.hasSearch) sc += 500;
      if (flags.hasSpecialSummon) sc += 450;
      // Prefer Hayate in MP1 when BP is available, Shizuku in MP2/Turn 1
      if (code === CARD_SKY_STRIKER_HAYATE && phase === PHASES.MP1 && msg.to_bp) sc += 700;
      if (code === CARD_SKY_STRIKER_SHIZUKU && (phase === PHASES.MP2 || !msg.to_bp)) sc += 700;
      if (code === CARD_SKY_STRIKER_KAGARI && hasSpellInGy) sc += 800;

      if (sc > bestSsScore) {
        bestSsScore = sc;
        bestSsIdx = idx;
      }
    });

    if (bestSsIdx >= 0) {
      const picked = msg.special_summons[bestSsIdx];
      const pickedMeta = getCardMeta(picked.code);
      if (pickedMeta?.isExtraDeck) {
        aiState.extraSummonedCodes.add(Number(picked.code || 0));
      }
      aiState.actionCount++;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, index: bestSsIdx };
    }
  }

  // 4. Normal Summon remaining beneficial monsters (strictly skipping hand traps & bad tributes)
  if (bestNsIdx >= 0 && bestNsScore > 0) {
    aiState.actionCount++;
    return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: bestNsIdx };
  }

  // 5. Remaining beneficial activations
  if (bestStarterActIdx >= 0) {
    const act = msg.activates[bestStarterActIdx];
    const key = `${act.code}:${act.location}:${act.description}`;
    aiState.activationCounts.set(key, (aiState.activationCounts.get(key) || 0) + 1);
    aiState.actionCount++;
    return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: bestStarterActIdx };
  }

  // 6. Smart Position Changes (MP1 -> switch to ATK if safe/can attack; MP2/Turn 1 -> switch weak ATK to DEF)
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
      if (phase === PHASES.MP1 && msg.to_bp && isDef && atk > 0) {
        const safeToAtk = oppTargets.length === 0 || oppTargets.some(t => canAttackerBeatTarget(atk, t, evaluateMonsterThreat(live, live), profile));
        if (safeToAtk && atk >= oppMaxAtk) {
          aiState.posChangedKeys.add(posKey);
          aiState.actionCount++;
          return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_POS_CHANGE, index: i };
        }
      } else if ((phase === PHASES.MP2 || !msg.to_bp) && !isDef && def > atk && (atk < oppMaxAtk || atk < 1500)) {
        aiState.posChangedKeys.add(posKey);
        aiState.actionCount++;
        return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_POS_CHANGE, index: i };
      }
    }
  }

  return endOrBattle();
}

function handleSelectBattleCmd(msg, ctx, profile) {
  const { aiIndex, state, aiState, getCardMeta } = ctx;
  aiState.unselectPickCount = 0;

  const aiPlayer = state?.players?.[aiIndex];
  const oppPlayer = state?.players?.[1 - aiIndex];
  const oppLp = Number(oppPlayer?.lp ?? 8000);
  const aiMonsters = getPlayerFieldMonsters(aiPlayer);
  const oppTargets = getOpponentBattleTargets(oppPlayer);
  const attacks = msg.attacks || [];
  const chains = msg.chains || [];

  aiState.pendingAttackTarget = null;

  // Helper to pick best Battle Phase chain (Quick Synchro, Fusion, Sangen Kaimen, stat boost, removal)
  const pickBattleChain = (onlyBreakerOrBoost = false) => {
    if (!profile.useBattleChains || chains.length === 0 || aiState.actionCount >= profile.maxActionsPerTurn) {
      return null;
    }
    let bestIdx = -1;
    let bestScore = 0;
    chains.forEach((ch, idx) => {
      const code = Number(ch.code || 0);
      const key = `${code}:${ch.location}:${ch.sequence}:${ch.description}`;
      if (aiState.battleChainKeys.has(key)) return;
      if (profile.holdHandTraps && ch.location === OcgLocation.HAND && isSpellTrapInHandTrapList(code)) return;
      if (isSelfSabotageActivation(ch, ctx, aiPlayer, oppPlayer, aiMonsters, oppTargets)) return;

      const meta = getCardMeta(code);
      const resolvedDesc = resolveEffectText(ctx, ch.description, code);
      const flags = classifyCardText(meta, resolvedDesc);
      if (flags.isPureFieldNegate) return;

      let sc = 0;
      if (flags.hasSpecialSummon) sc += 220;
      if (flags.hasSearch) sc += 180;
      if (flags.hasRemoval && oppTargets.length > 0) sc += 200;
      if (/gains?\s+\d+\s+atk|double.*atk|synchro summon|fusion summon/i.test(String(meta?.description || ''))) {
        sc += 240;
      }

      if (onlyBreakerOrBoost && !(flags.hasRemoval && oppTargets.length > 0) && !/gains?\s+\d+\s+atk|double.*atk/i.test(String(meta?.description || ''))) {
        return;
      }
      if (sc > bestScore) {
        bestScore = sc;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) {
      const picked = chains[bestIdx];
      const key = `${Number(picked.code || 0)}:${picked.location}:${picked.sequence}:${picked.description}`;
      aiState.battleChainKeys.add(key);
      aiState.actionCount++;
      return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_CHAIN, index: bestIdx };
    }
    return null;
  };

  if (attacks.length > 0) {
    const attackers = attacks.map((a, idx) => {
      const live = lookupLiveCard(state, a.controller, a.location, a.sequence);
      const atk = Number(live?.currentAtk ?? a.atk ?? 0);
      const threat = evaluateMonsterThreat(live, live);
      const code = Number(a.code || live?.passcode || 0);
      return { idx, entry: a, live, atk, threat, code };
    });

    if (oppTargets.length === 0) {
      // Open board: direct attack!
      const viable = attackers.filter(a => a.atk > 0);
      if (viable.length > 0) {
        if (profile.useLethalCalc) {
          // If a single attacker is already lethal, finish cleanly; otherwise smallest ATK first (plays around hand traps & triggers Hayate early)
          const singleLethal = viable.find(a => a.atk >= oppLp);
          if (singleLethal) {
            return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: singleLethal.idx };
          }
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
      // Normal / Hard: compute best favorable attack pair + lethal check
      let bestPair = null;
      let bestPairScore = -Infinity;

      for (const att of attackers) {
        // Direct-attack specialist (e.g. Sky Striker Ace - Hayate) can attack directly even over big walls!
        if (att.code === CARD_SKY_STRIKER_HAYATE && att.atk > 0) {
          const directScore = 1800 + (profile.useLethalCalc && att.atk >= oppLp ? 50000 : 0);
          if (directScore > bestPairScore) {
            bestPairScore = directScore;
            bestPair = { att, tgt: null };
          }
        }
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
        aiState.pendingAttackTarget = bestPair.tgt?.card?.instanceId || null;
        return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: bestPair.att.idx };
      }

      // No clean attack right now — try a Battle Phase breaker/boost/summon chain to break the wall!
      const bpChain = pickBattleChain(false);
      if (bpChain) return bpChain;
    }
  } else {
    // All current attackers have attacked (e.g. Tenpai Quick Synchro / Branded in Red in BP to keep attacking!)
    const bpChain = pickBattleChain(false);
    if (bpChain) return bpChain;
  }

  if (msg.to_m2) {
    return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_M2, index: null };
  }
  return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
}

function handleSelectChain(msg, ctx, profile) {
  const { aiIndex, state, phase, turnCount, turnPlayerIndex, chainStack, aiState, getCardMeta } = ctx;
  aiState.unselectPickCount = 0;

  const selects = msg.selects || [];
  if (selects.length === 0) return { type: OcgResponseType.SELECT_CHAIN, index: null };

  const aiPlayer = state?.players?.[aiIndex];
  const oppPlayer = state?.players?.[1 - aiIndex];
  const aiMonsters = getPlayerFieldMonsters(aiPlayer);
  const oppTargets = getOpponentBattleTargets(oppPlayer);
  const oppBackrowTotal = getPlayerTotalBackrowIncludingField(oppPlayer);

  const scoreChainOption = (sel) => {
    const code = Number(sel.code || 0);
    const meta = getCardMeta(code);
    const resolvedDesc = resolveEffectText(ctx, sel.description, code);
    const flags = classifyCardText(meta, resolvedDesc);
    let score = 10;
    if (code === CARD_MAXX_C || code === CARD_MULCHARMY_FUWALOS || code === CARD_MULCHARMY_PURULIA) score += 220;
    if (code === CARD_ASH_BLOSSOM) score += 200;
    if (code === CARD_CALLED_BY || code === CARD_CROSSOUT) score += 190;
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

  // Easy AI: never interrupts opponent proactively; only fires own free trigger effects (no self-negates)
  if (!profile.chainOnOppCard) {
    if (turnPlayerIndex === aiIndex && speCount > 0 && chainStack.length === 0) {
      for (let i = 0; i < selects.length; i++) {
        const sel = selects[i];
        const code = Number(sel.code || 0);
        if (HAND_TRAP_CODES.has(code)) continue;
        const meta = getCardMeta(code);
        const flags = classifyCardText(meta, resolveEffectText(ctx, sel.description, code));
        if (flags.isPureFieldNegate) continue;
        const key = `${turnCount}:easy_trig:${code}:${sel.description}`;
        if (!aiState.chainKeys.has(key)) {
          aiState.chainKeys.add(key);
          return { type: OcgResponseType.SELECT_CHAIN, index: i };
        }
      }
    }
    return { type: OcgResponseType.SELECT_CHAIN, index: null };
  }

  // Own Chain Link / own turn:
  // ONLY fire genuine own-turn Trigger/Search/Summon/GY effects; NEVER negate or destroy own cards!
  if (!respondingToOpp && !openOnOppTurn) {
    if (speCount > 0) {
      const chainingToSelf = chainStack.length > 0 && topChain?.playerIndex === aiIndex;
      for (let i = 0; i < selects.length; i++) {
        const sel = selects[i];
        const code = Number(sel.code || 0);
        if (profile.holdHandTraps && isSpellTrapInHandTrapList(code)) continue;
        if (isSelfSabotageActivation(sel, ctx, aiPlayer, oppPlayer, aiMonsters, oppTargets)) continue;

        const meta = getCardMeta(code);
        const resolvedDesc = resolveEffectText(ctx, sel.description, code);
        const flags = classifyCardText(meta, resolvedDesc);

        // NEVER chain Baronne negate, Widow Anchor, Solemns, or any negate onto our own Chain Link!
        if (chainingToSelf) {
          if (flags.hasNegate || code === CARD_BARONNE_DE_FLEUR || OPP_MONSTER_NEEDED_CODES.has(code)) {
            continue;
          }
          // When chaining to our own CL, avoid chaining Quick-Play Spells / Traps unless they clearly search/summon/draw
          if ((meta?.subtype === 'QUICK_PLAY' || meta?.kind === 'TRAP') && !flags.hasSearch && !flags.hasSpecialSummon && !flags.hasDeckDump) {
            continue;
          }
        }
        // Skip Baronne Standby Phase tag-out
        if (code === CARD_BARONNE_DE_FLEUR && (phase === PHASES.SP || flags.isStandbyReturnToExtra)) {
          continue;
        }
        if (flags.isPureFieldNegate) continue;

        const key = `${turnCount}:self_trig:${sel.controller}:${sel.location}:${sel.sequence}:${code}:${sel.description}`;
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
      const code = Number(c.sel.code || 0);
      if (isSelfSabotageActivation(c.sel, ctx, aiPlayer, oppPlayer, aiMonsters, oppTargets, { respondingToOpp: true })) continue;
      const flags = classifyCardText(c.meta, resolveEffectText(ctx, c.sel.description, code));
      const isNegateOption = flags.hasNegate || code === CARD_ASH_BLOSSOM;
      if (isNegateOption && aiState.negatedChainLinks.has(chainLen)) {
        continue; // Already chained a negate to this exact Chain Link
      }
      const key = `${turnCount}:cl${chainLen}:${c.sel.controller}:${c.sel.location}:${c.sel.sequence}:${code}:${c.sel.description}`;
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
    const oppFaceUpMonsters = getPlayerFieldMonsters(oppPlayer).filter(m => !m.isFaceDown && !m.effectsNegated);

    const candidates = selects
      .map((sel, idx) => ({ sel, idx, score: scoreChainOption(sel), code: Number(sel.code || 0) }))
      .sort((a, b) => b.score - a.score);

    for (const c of candidates) {
      if (isSelfSabotageActivation(c.sel, ctx, aiPlayer, oppPlayer, aiMonsters, oppTargets)) continue;
      // Skip empty open windows for targeted monster negates (Veiler / Imperm / Widow Anchor)
      if ((c.code === CARD_EFFECT_VEILER || c.code === CARD_INFINITE_IMPERM || c.code === 98338152) && oppFaceUpMonsters.length === 0) {
        continue;
      }
      // Maxx "C" / Mulcharmy in SP/MP1/BP is great; skip in End Phase
      if (
        (c.code === CARD_MAXX_C || c.code === CARD_MULCHARMY_FUWALOS || c.code === CARD_MULCHARMY_PURULIA) &&
        phase === PHASES.EP
      ) {
        continue;
      }
      // Don't fire backrow hate when opponent has 0 backrow
      if (OPP_BACKROW_NEEDED_CODES.has(c.code) && oppBackrowTotal === 0) {
        continue;
      }
      const key = `${turnCount}:open:${phase}:${c.code}:${c.sel.description}`;
      if (!aiState.chainKeys.has(key)) {
        aiState.chainKeys.add(key);
        return { type: OcgResponseType.SELECT_CHAIN, index: c.idx };
      }
    }
  }

  return { type: OcgResponseType.SELECT_CHAIN, index: null };
}

/**
 * Determine selection intent ('ADVERSARIAL' | 'COST' | 'DECK_DUMP' | 'BANISH_COST' | 'GAIN')
 * using BOTH ProjectIgnis HINT_SELECTMSG and candidate zone/controller context.
 */
function resolveSelectionMode(selects, aiIndex, lastHintMsg, isTribute = false) {
  const hasOpp = selects.some(s => s.controller !== aiIndex);
  const hasSelf = selects.some(s => s.controller === aiIndex);
  const allSelfDeckOrExtra = selects.length > 0 && selects.every(
    s => s.controller === aiIndex && (s.location === OcgLocation.DECK || s.location === OcgLocation.EXTRA)
  );
  const allSelfGyOrBanished = selects.length > 0 && selects.every(
    s => s.controller === aiIndex && (s.location === OcgLocation.GRAVE || s.location === OcgLocation.REMOVED)
  );
  const allDeckGyExtra = selects.length > 0 && selects.every(
    s => s.location === OcgLocation.DECK || s.location === OcgLocation.GRAVE || s.location === OcgLocation.EXTRA
  );

  if (isTribute || HINT_COST_OR_TRIBUTE.has(lastHintMsg)) {
    // Special case: Fusion/Synchro/Ritual material from DECK (e.g. Branded Fusion) should pick high-value combo dumps!
    if (!isTribute && allSelfDeckOrExtra) return 'DECK_DUMP';
    return 'COST';
  }

  if (lastHintMsg === HINT_SEND_TO_GY) {
    // Hint 504 (Send to GY):
    // - From AI's own Deck / Extra Deck (Foolish Burial, Branded Fusion, Magicians' Souls, Hayate, Albion): HIGH value combo/GY-trigger!
    if (allSelfDeckOrExtra) return 'DECK_DUMP';
    // - Opponent cards available (Zeus / Droplet / non-destruction removal): ADVERSARIAL!
    if (hasOpp) return 'ADVERSARIAL';
    // - AI's own Hand / Field: COST (send lowest keep-value, preferring GY triggers)
    return 'COST';
  }

  if (lastHintMsg === HINT_BANISH) {
    // Hint 503 (Banish):
    // - Opponent cards available (field or GY): ADVERSARIAL (banish highest threat)!
    if (hasOpp) return 'ADVERSARIAL';
    // - From AI's own Deck (Gold Sarcophagus): prefer banish-trigger / high value
    if (allSelfDeckOrExtra) return 'DECK_DUMP';
    // - AI's own Hand / Field / GY cost: banish lowest keep-value (preferring banish-trigger cards!)
    return 'BANISH_COST';
  }

  if (HINT_BOUNCE_OR_SPIN.has(lastHintMsg)) {
    if (hasOpp) return 'ADVERSARIAL';
    if (allSelfGyOrBanished) return 'GAIN';
    return 'COST';
  }

  if (HINT_DESTROY_OR_NEGATE.has(lastHintMsg)) {
    if (hasOpp) return 'ADVERSARIAL';
    return 'COST';
  }

  if (HINT_TARGET_GENERIC.has(lastHintMsg)) {
    if (hasOpp) return 'ADVERSARIAL';
    if (allSelfGyOrBanished || allSelfDeckOrExtra) return 'GAIN';
    return 'COST';
  }

  if (HINT_GAIN.has(lastHintMsg)) {
    return 'GAIN';
  }

  // Fallback when no hint (0) or unknown hint
  if (hasOpp) return 'ADVERSARIAL';
  if (allDeckGyExtra && hasSelf) return 'GAIN';
  if (hasSelf) return 'COST';
  return 'GAIN';
}

function scoreSelectionCandidate(s, mode, aiIndex, state, getCardMeta) {
  const live = lookupLiveCard(state, s.controller, s.location, s.sequence);
  const meta = getCardMeta(s.code);
  const isOpp = s.controller !== aiIndex;
  const flags = classifyCardText(meta);

  if (mode === 'ADVERSARIAL') {
    const threat = evaluateMonsterThreat(live, meta);
    const keep = evaluateCardKeepValue(s, live, meta);
    // Strongly prefer opponent's highest-threat cards; if forced to pick own, pick lowest keep-value (prefer GY triggers)
    return isOpp ? (100000 + threat) : (10000 - keep + (flags.hasGyTrigger ? 500 : 0));
  }

  if (mode === 'DECK_DUMP') {
    return evaluateDeckDumpValue(s, meta);
  }

  if (mode === 'BANISH_COST') {
    const keep = evaluateCardKeepValue(s, live, meta);
    const threat = evaluateMonsterThreat(live, meta);
    // If opponent card is somehow present, banish opponent's highest threat;
    // otherwise pick lowest keep-value own card with a big bonus for cards that trigger when banished!
    return isOpp ? (100000 + threat) : (10000 - keep + (flags.hasBanishTrigger ? 2500 : 0));
  }

  if (mode === 'COST') {
    // If allowed to tribute/use opponent monster (Kaiju / Super Poly / Albaz), pick opp highest threat first!
    const keep = evaluateCardKeepValue(s, live, meta);
    const threat = evaluateMonsterThreat(live, meta);
    return isOpp ? (100000 + threat) : (10000 - keep + (flags.hasGyTrigger ? 450 : 0));
  }

  // GAIN: Search / Add / Special Summon / Revive highest-value card
  let value = evaluateCardKeepValue(s, live, meta);
  if (s.location === OcgLocation.DECK && (flags.hasSearch || flags.hasTokenSummon || flags.hasFusionOrRitual)) {
    value += 500;
  }
  return value;
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

  const mode = resolveSelectionMode(selects, aiIndex, lastHintMsg, isTribute);
  const scored = selects.map((s, idx) => ({
    idx,
    score: scoreSelectionCandidate(s, mode, aiIndex, state, getCardMeta)
  }));

  scored.sort((a, b) => b.score - a.score);

  // If max > min and mode is GAIN or ADVERSARIAL (with additional opponent targets), pick extra beneficial targets!
  let pickCount = count;
  const maxSel = Math.min(selects.length, Number(msg.max || count));
  if (maxSel > count && (mode === 'GAIN' || mode === 'ADVERSARIAL')) {
    while (pickCount < maxSel) {
      const nextCand = scored[pickCount];
      if (!nextCand) break;
      if (mode === 'ADVERSARIAL') {
        // Only pick extra cards if they belong to opponent (never extra-destroy own cards!)
        if (selects[nextCand.idx]?.controller === aiIndex) break;
      }
      pickCount++;
    }
  }

  return {
    type: respType,
    indicies: scored.slice(0, pickCount).map(r => r.idx)
  };
}

function handleSelectUnselectCard(msg, ctx, profile) {
  const { aiIndex, state, lastHintMsg, aiState, getCardMeta } = ctx;
  const selectCards = msg.select_cards || [];
  const maxPicksCap = Math.max(1, Number(msg.max || 5));

  // Hard anti-loop guard: never select endlessly or unselect previously selected cards
  if (msg.can_finish && (aiState.unselectPickCount >= maxPicksCap || selectCards.length === 0)) {
    aiState.unselectPickCount = 0;
    return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
  }

  if (msg.can_finish) {
    if (!profile.smartTargeting) {
      aiState.unselectPickCount = 0;
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
    }

    const mode = resolveSelectionMode(selectCards, aiIndex, lastHintMsg, false);
    const scored = selectCards
      .map((s, idx) => ({ idx, card: s, score: scoreSelectionCandidate(s, mode, aiIndex, state, getCardMeta) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    // Pick additional targets ONLY when strictly beneficial:
    // - GAIN: always worth picking more cards up to max
    // - ADVERSARIAL: only if an OPPONENT card is available (never pick own cards when we can finish!)
    // - DECK_DUMP: only if another strong GY-trigger card exists in Deck
    // - COST / BANISH_COST: stop once can_finish is true so we never over-pay cost!
    const shouldPickMore =
      best && (
        mode === 'GAIN' ||
        (mode === 'ADVERSARIAL' && best.card.controller !== aiIndex) ||
        (mode === 'DECK_DUMP' && best.score >= 2200)
      );

    if (shouldPickMore) {
      aiState.unselectPickCount++;
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: best.idx };
    }

    aiState.unselectPickCount = 0;
    return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
  }

  if (selectCards.length > 0) {
    aiState.unselectPickCount++;
    if (profile.smartTargeting) {
      const mode = resolveSelectionMode(selectCards, aiIndex, lastHintMsg, false);
      const scored = selectCards
        .map((s, idx) => ({ idx, score: scoreSelectionCandidate(s, mode, aiIndex, state, getCardMeta) }))
        .sort((a, b) => b.score - a.score);
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: scored[0]?.idx ?? 0 };
    }
    return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: 0 };
  }

  aiState.unselectPickCount = 0;
  return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
}

function handleSelectPosition(msg, ctx, profile) {
  const { aiIndex, state, phase, turnCount, turnPlayerIndex, getCardMeta } = ctx;
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

  const cannotAttackThisTurn =
    Number(turnCount || 0) === 1 ||
    phase === PHASES.MP2 ||
    phase === PHASES.EP ||
    (typeof turnPlayerIndex === 'number' && turnPlayerIndex !== aiIndex);

  const shouldDefend =
    (cannotAttackThisTurn && def > atk) ||
    (cannotAttackThisTurn && atk <= 1800 && def >= atk && def >= 1000) ||
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

function handleSelectEffectYn(msg, ctx, profile) {
  if (!profile.smartTargeting) {
    return { type: OcgResponseType.SELECT_EFFECTYN, yes: true };
  }
  const { aiIndex, state, phase, getCardMeta } = ctx;
  const code = Number(msg.code || 0);
  const meta = getCardMeta(code);
  const resolvedDesc = resolveEffectText(ctx, msg.description, code);
  const flags = classifyCardText(meta, resolvedDesc);
  const oppPlayer = state?.players?.[1 - aiIndex];
  const oppTotalField = getPlayerTotalFieldCards(oppPlayer);
  const oppGyCount = (oppPlayer?.gy || []).length;

  // Baronne de Fleur Standby Phase tag-out: keep 3000 ATK boss on board
  if (code === CARD_BARONNE_DE_FLEUR && (phase === PHASES.SP || flags.isStandbyReturnToExtra)) {
    return { type: OcgResponseType.SELECT_EFFECTYN, yes: false };
  }

  // S:P Little Knight on-summon banish: skip if opponent has 0 field & 0 GY cards (avoid self-banish!)
  if (code === CARD_SP_LITTLE_KNIGHT && oppTotalField === 0 && oppGyCount === 0) {
    return { type: OcgResponseType.SELECT_EFFECTYN, yes: false };
  }

  // Pure field destruction or pure negate optional trigger when opponent controls 0 cards
  if ((flags.isFieldDestructionAction || flags.isPureFieldNegate) && oppTotalField === 0) {
    return { type: OcgResponseType.SELECT_EFFECTYN, yes: false };
  }

  // Optional self-return-to-Extra-Deck prompts during Standby Phase
  if (phase === PHASES.SP && flags.isStandbyReturnToExtra) {
    return { type: OcgResponseType.SELECT_EFFECTYN, yes: false };
  }

  return { type: OcgResponseType.SELECT_EFFECTYN, yes: true };
}

function handleSelectYesNo(msg, ctx, profile) {
  if (!profile.smartTargeting) {
    return { type: OcgResponseType.SELECT_YESNO, yes: true };
  }
  const { aiIndex, state } = ctx;
  const resolvedDesc = resolveEffectText(ctx, msg.description, 0).toLowerCase();
  const oppPlayer = state?.players?.[1 - aiIndex];
  const oppTotalField = getPlayerTotalFieldCards(oppPlayer);
  const oppGyCount = (oppPlayer?.gy || []).length;

  // If the prompt explicitly asks to destroy/banish a card on field when opponent has nothing
  if (
    (/\bdestroy\b/.test(resolvedDesc) && !/\badd|draw|summon|search\b/.test(resolvedDesc) && oppTotalField === 0) ||
    (/\bbanish\b/.test(resolvedDesc) && !/\badd|draw|summon|search\b/.test(resolvedDesc) && oppTotalField === 0 && oppGyCount === 0)
  ) {
    return { type: OcgResponseType.SELECT_YESNO, yes: false };
  }

  return { type: OcgResponseType.SELECT_YESNO, yes: true };
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
    case OcgMessageType.SELECT_UNSELECT_CARD:
      return handleSelectUnselectCard(msg, ctx, profile);
    case OcgMessageType.SELECT_POSITION:
      return handleSelectPosition(msg, ctx, profile);
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD:
      return handleSelectPlace(msg, ctx, profile);
    case OcgMessageType.SELECT_EFFECTYN:
      return handleSelectEffectYn(msg, ctx, profile);
    case OcgMessageType.SELECT_YESNO:
      return handleSelectYesNo(msg, ctx, profile);
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
    case OcgMessageType.SELECT_SUM: {
      if (ctx.solveSelectSum) {
        const scoreMaterial = profile.smartTargeting
          ? (entry) => {
              const live = lookupLiveCard(ctx.state, entry.controller, entry.location, entry.sequence);
              const meta = ctx.getCardMeta ? ctx.getCardMeta(entry.code) : null;
              // Opponent materials (if legal) get huge negative cost (prefer consuming opponent's monster!)
              if (entry.controller !== ctx.aiIndex) return -100000 - evaluateMonsterThreat(live, meta);
              return evaluateCardKeepValue(entry, live, meta);
            }
          : null;
        return {
          type: OcgResponseType.SELECT_SUM,
          indicies: ctx.solveSelectSum(msg, scoreMaterial)
        };
      }
      return { type: OcgResponseType.SELECT_SUM, indicies: [0] };
    }
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
      return { type: OcgResponseType.ANNOUNCE_CARD, card: matches[0] || CARD_ASH_BLOSSOM };
    }
    default:
      return null;
  }
}
