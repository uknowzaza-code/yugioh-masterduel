/**
 * @fileoverview YGOPro Core (ocgcore-wasm) Engine Adapter
 * เชื่อมต่อ ProjectIgnis / Fluorohydride ygopro-core (ocgcore-wasm) เข้ากับ Web UI และ Multiplayer Server
 */

import { randomInt } from 'node:crypto';
import createCore, {
  OcgDuelMode,
  OcgHintTiming,
  OcgHintType,
  OcgLocation,
  OcgMessageType,
  OcgPhase,
  OcgPlayerHintType,
  OcgPosition,
  OcgProcessResult,
  OcgQueryFlags,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction
} from 'ocgcore-wasm';
import {
  getCoreInitScripts,
  getUiCardMeta,
  readOcgCardData,
  readOcgScript,
  resolveOcgDescription,
  resolveOcgOptionLabel,
  findAnnounceCardCodes
} from './OcgCardDb.js';
import {
  normalizeAiDifficulty,
  createAiTurnState,
  computeYgoProAiResponse
} from './YgoProAi.js';
import { AiPlayer } from '../ai/ai-player.js';
import { createOcgCardDbAdapter } from '../ai/card-db.js';
import {
  createLingeringTracker,
  applyPlayerHint,
  applyCatalogResolution,
  advancePhase,
  toSnapshot as toLingeringSnapshot,
  resetTracker as resetLingeringTracker
} from './lingeringEffects.js';
import { getCardById } from '../cards/index.js';
import { POSITIONS, PHASES } from '../constants/gameConstants.js';

let sharedCorePromise = null;

export async function getSharedOcgCore() {
  if (!sharedCorePromise) {
    sharedCorePromise = createCore({ sync: true });
  }
  return sharedCorePromise;
}

function mapOcgPositionToUi(pos) {
  if (pos & OcgPosition.FACEUP_ATTACK) return POSITIONS.ATK;
  if (pos & OcgPosition.FACEUP_DEFENSE) return POSITIONS.DEF;
  if (pos & OcgPosition.FACEDOWN_DEFENSE) return POSITIONS.SET_DEF;
  if (pos & OcgPosition.FACEDOWN_ATTACK) return POSITIONS.SET;
  return POSITIONS.ATK;
}

function mapOcgPhaseToUi(phase) {
  switch (phase) {
    case OcgPhase.DRAW: return PHASES.DP;
    case OcgPhase.STANDBY: return PHASES.SP;
    case OcgPhase.MAIN1: return PHASES.MP1;
    case OcgPhase.BATTLE_START:
    case OcgPhase.BATTLE_STEP:
    case OcgPhase.DAMAGE:
    case OcgPhase.DAMAGE_CAL:
    case OcgPhase.BATTLE: return PHASES.BP;
    case OcgPhase.MAIN2: return PHASES.MP2;
    case OcgPhase.END: return PHASES.EP;
    default: return PHASES.MP1;
  }
}

function makeInstanceId(controller, location, sequence) {
  return `ocg_p${controller}_loc${location}_seq${sequence}`;
}

function resolveZoneName(location, sequence) {
  if ((location & OcgLocation.OVERLAY) !== 0) return 'OVERLAY';
  if (location === OcgLocation.HAND) return 'HAND';
  if (location === OcgLocation.MZONE) return sequence >= 5 ? 'EMZ' : 'MMZ';
  if (location === OcgLocation.FZONE) return 'FIELD';
  if (location === OcgLocation.SZONE) return sequence === 5 ? 'FIELD' : 'STZ';
  if (location === OcgLocation.PZONE) return 'STZ';
  if (location === OcgLocation.GRAVE) return 'GY';
  if (location === OcgLocation.REMOVED) return 'BANISHED';
  if (location === OcgLocation.DECK) return 'DECK';
  if (location === OcgLocation.EXTRA) return 'EXTRA';
  return 'OTHER';
}

function toCompactVfxMeta(code) {
  const m = getUiCardMeta(code);
  if (!m) return null;
  return {
    id: m.id,
    passcode: m.passcode,
    name: m.name,
    nameTh: m.nameTh,
    kind: m.kind,
    frame: m.frame,
    subtype: m.subtype,
    attribute: m.attribute,
    isTuner: Boolean(m.isTuner),
    isPendulum: Boolean(m.isPendulum),
    isExtraDeck: Boolean(m.isExtraDeck),
    level: m.level,
    rank: m.rank,
    linkRating: m.linkRating
  };
}

function toLogCardSnapshot(meta) {
  if (!meta) return null;
  return {
    id: meta.id,
    passcode: meta.passcode,
    name: meta.name,
    nameTh: meta.nameTh,
    kind: meta.kind,
    frame: meta.frame,
    subtype: meta.subtype,
    subType: meta.subType || meta.subtype || null,
    attribute: meta.attribute,
    race: meta.race,
    level: meta.level,
    rank: meta.rank,
    linkRating: meta.linkRating,
    atk: meta.atk,
    def: meta.def,
    description: meta.description || '',
    descriptionTh: meta.descriptionTh || ''
  };
}

const QUERY_FLAGS_FULL =
  OcgQueryFlags.CODE |
  OcgQueryFlags.POSITION |
  OcgQueryFlags.TYPE |
  OcgQueryFlags.LEVEL |
  OcgQueryFlags.RANK |
  OcgQueryFlags.ATTRIBUTE |
  OcgQueryFlags.RACE |
  OcgQueryFlags.ATTACK |
  OcgQueryFlags.DEFENSE |
  OcgQueryFlags.OVERLAY_CARD |
  OcgQueryFlags.STATUS |
  OcgQueryFlags.IS_PUBLIC |
  OcgQueryFlags.LINK;

export class YGOProEngine {
  /**
   * @param {Object} opts
   * @param {import('ocgcore-wasm').OcgCoreSync} opts.core
   * @param {string} [opts.player1Name]
   * @param {string} [opts.player2Name]
   * @param {Array} opts.deck1Cards
   * @param {Array} opts.deck2Cards
   * @param {boolean} [opts.isSoloVsAi]
   * @param {number} [opts.aiIndex]
   */
  constructor(opts) {
    this.core = opts.core;
    this.isSoloVsAi = Boolean(opts.isSoloVsAi);
    this.aiIndex = opts.aiIndex ?? 1;
    this.aiDifficulty = normalizeAiDifficulty(opts.aiDifficulty);
    this.humanIndex = this.isSoloVsAi ? (this.aiIndex === 0 ? 1 : 0) : 0;
    this.onAiStep = typeof opts.onAiStep === 'function' ? opts.onAiStep : null;
    this.playerNames = [opts.player1Name || 'Player 1', opts.player2Name || 'Master Duel AI'];

    this.logs = [];
    this.chainStack = [];
    this.chainModes = ['AUTO', 'AUTO'];
    this.lps = [8000, 8000];
    this.turnCount = 0;
    this.turnPlayerIndex = 0;
    this.phase = PHASES.DP;
    this.winner = null;
    this.winReason = null;
    this.winReasonTh = null;
    this.battleSeq = 0;
    this.eventSeq = 0;
    this.recentEvents = [];
    this.lastBattleEvent = null;
    this.pendingMessage = null;
    this._lastResponse = null;
    this.lastRetryError = false;
    this.lastHintMsgByPlayer = [0, 0];
    this._aiState = createAiTurnState();
    this.aiPlayer = new AiPlayer({
      me: this.aiIndex,
      difficulty: this.aiDifficulty,
      seed: opts.aiSeed,
      cardDb: createOcgCardDbAdapter()
    });
    this._lingeringTracker = createLingeringTracker();
    this._aiChainKeysThisTurn = new Set();
    this._confirmedCards = new Set();
    this._pendingPreferredPlace = [null, null];
    this._pendingPreferredAttackTarget = [null, null];
    this.destroyed = false;

    const seed = [
      BigInt(Math.floor(Math.random() * 0xffffffff) + 1),
      BigInt(Math.floor(Math.random() * 0xffffffff) + 1),
      BigInt(Math.floor(Math.random() * 0xffffffff) + 1),
      BigInt(Math.floor(Math.random() * 0xffffffff) + 1)
    ];

    this.handle = this.core.createDuel({
      flags: OcgDuelMode.MODE_MR5,
      seed,
      team1: { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: 8000 },
      team2: { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: 8000 },
      cardReader: (code) => readOcgCardData(code),
      scriptReader: (script) => readOcgScript(script),
      errorHandler: (type, text) => {
        if (text && !String(text).includes('c0.lua')) {
          console.warn(`[ygopro-core ${type}]`, text);
        }
      }
    });

    if (!this.handle) {
      throw new Error('Failed to create ocgcore-wasm duel handle');
    }

    const { constant, utility } = getCoreInitScripts();
    if (constant) this.core.loadScript(this.handle, 'constant.lua', constant);
    if (utility) this.core.loadScript(this.handle, 'utility.lua', utility);

    this._loadDeckForTeam(0, opts.deck1Cards || []);
    this._loadDeckForTeam(1, opts.deck2Cards || []);

    this.core.startDuel(this.handle);
    this.log('Duel started using YGOPro Core (Master Rule 5).');
    this.processUntilWaiting();
  }

  _loadDeckForTeam(team, cards) {
    const mainCodes = [];
    const extraCodes = [];
    for (const entry of cards) {
      let code = 0;
      if (typeof entry === 'object' && entry !== null) {
        code = Number(entry.passcode || entry.code || (typeof entry.id === 'number' ? entry.id : getCardById(entry.id)?.passcode));
      } else if (typeof entry === 'string') {
        code = Number(/^\d+$/.test(entry) ? entry : getCardById(entry)?.passcode);
      } else if (typeof entry === 'number') {
        code = entry;
      }
      if (!code || Number.isNaN(code)) continue;
      const meta = getUiCardMeta(code);
      if (meta?.isExtraDeck) {
        extraCodes.push(code);
      } else {
        mainCodes.push(code);
      }
    }

    // Fisher-Yates shuffle Main Deck before inserting into ocgcore
    for (let i = mainCodes.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [mainCodes[i], mainCodes[j]] = [mainCodes[j], mainCodes[i]];
    }

    for (const code of mainCodes) {
      this.core.duelNewCard(this.handle, {
        team,
        duelist: 0,
        code,
        controller: team,
        location: OcgLocation.DECK,
        sequence: 0,
        position: OcgPosition.FACEDOWN_DEFENSE
      });
    }
    for (const code of extraCodes) {
      this.core.duelNewCard(this.handle, {
        team,
        duelist: 0,
        code,
        controller: team,
        location: OcgLocation.EXTRA,
        sequence: 0,
        position: OcgPosition.FACEDOWN_DEFENSE
      });
    }
  }

  destroy() {
    resetLingeringTracker(this._lingeringTracker);
    if (!this.destroyed && this.handle) {
      this.core.destroyDuel(this.handle);
      this.destroyed = true;
      this.handle = null;
    }
  }

  log(msg, cardMeta = null, extraCardMetas = null) {
    const snap = toLogCardSnapshot(cardMeta);
    const refs = Array.isArray(extraCardMetas)
      ? extraCardMetas.map(toLogCardSnapshot).filter(Boolean)
      : null;
    this.logs.push({
      turn: this.turnCount || 1,
      phase: this.phase || PHASES.DP,
      text: msg,
      cardId: snap?.id || null,
      cardCode: snap?.passcode ? Number(snap.passcode) : null,
      cardSnapshot: snap || null,
      ...(refs && refs.length > 0 ? { cardRefs: refs } : {})
    });
    if (this.logs.length > 250) {
      this.logs = this.logs.slice(-250);
    }
  }

  processUntilWaiting(retryFallbackMessage = null) {
    if (this.destroyed || !this.handle) return;
    this.recentEvents = [];

    let prevPending = retryFallbackMessage || this.pendingMessage;
    let safety = 0;
    let consecutiveRetries = 0;
    let lastEmittedEventSeq = 0;
    let lastEmittedFingerprint = '';
    let emittedAnyAiStep = false;
    while (safety < 3000) {
      safety++;
      const status = this.core.duelProcess(this.handle);
      const msgs = this.core.duelGetMessage(this.handle) || [];
      const hadRetry = msgs.some((m) => m.type === OcgMessageType.RETRY);
      this._consumeMessages(msgs);

      if (hadRetry) {
        this.lastRetryError = true;
        if (!this.pendingMessage && prevPending && status !== OcgProcessResult.END) {
          this.pendingMessage = prevPending;
        }
        consecutiveRetries++;
        if (consecutiveRetries >= 3) {
          console.warn('[YGOProEngine] Aborting loop after repeated RETRY messages:', JSON.stringify(this._lastResponse));
          break;
        }
        // Stop immediately on human player RETRY so the preserved prompt is returned instead of hanging.
        if (this.pendingMessage && (!this.isSoloVsAi || this.pendingMessage.player !== this.aiIndex)) {
          break;
        }
      } else {
        consecutiveRetries = 0;
        prevPending = this.pendingMessage;
      }

      if (status === OcgProcessResult.END) {
        this.pendingMessage = null;
        break;
      }
      if (status === OcgProcessResult.WAITING) {
        if (this.pendingMessage) {
          const msgType = this.pendingMessage.type;
          const msgPlayer = this.pendingMessage.player;
          if (msgType === OcgMessageType.SELECT_IDLECMD || msgType === OcgMessageType.SELECT_BATTLECMD) {
            this._pendingPreferredPlace[msgPlayer] = null;
            this._pendingPreferredAttackTarget[msgPlayer] = null;
          } else if (msgType === OcgMessageType.SELECT_CARD && this._pendingPreferredAttackTarget[msgPlayer]) {
            const targetId = this._pendingPreferredAttackTarget[msgPlayer];
            this._pendingPreferredAttackTarget[msgPlayer] = null;
            const cards = this.pendingMessage.selects || [];
            const minSel = this.pendingMessage.min || 1;
            const maxSel = this.pendingMessage.max || 1;
            if (minSel === 1 && maxSel === 1) {
              const matchIdx = cards.findIndex(
                c => makeInstanceId(c.controller, c.location, c.sequence) === targetId
              );
              if (matchIdx >= 0) {
                const autoAtkResp = {
                  type: OcgResponseType.SELECT_CARD,
                  indicies: [matchIdx]
                };
                this._lastResponse = autoAtkResp;
                prevPending = this.pendingMessage;
                this.pendingMessage = null;
                this.core.duelSetResponse(this.handle, autoAtkResp);
                continue;
              }
            }
          } else if (msgType === OcgMessageType.SELECT_PLACE && this._pendingPreferredPlace[msgPlayer]) {
            const pref = this._pendingPreferredPlace[msgPlayer];
            this._pendingPreferredPlace[msgPlayer] = null;
            const mask = this.pendingMessage.field_mask || 0;
            const count = this.pendingMessage.count || 1;
            if (count === 1 && pref) {
              const usePrimary = typeof pref.bit === 'number' && (((mask >>> pref.bit) & 1) === 0);
              const useFallbackSzone = !usePrimary && typeof pref.fallbackSzoneBit === 'number' && (((mask >>> pref.fallbackSzoneBit) & 1) === 0);
              if (usePrimary || useFallbackSzone) {
                const autoPlaceResp = {
                  type: OcgResponseType.SELECT_PLACE,
                  places: [{
                    player: msgPlayer,
                    location: useFallbackSzone ? OcgLocation.SZONE : pref.location,
                    sequence: pref.sequence
                  }]
                };
                this._lastResponse = autoPlaceResp;
                prevPending = this.pendingMessage;
                this.pendingMessage = null;
                this.core.duelSetResponse(this.handle, autoPlaceResp);
                continue;
              }
            }
          }
        }
        // Auto-pass empty or Master Duel AUTO/OFF-skipped non-forced SELECT_CHAIN timing windows
        if (
          this.pendingMessage &&
          this.pendingMessage.type === OcgMessageType.SELECT_CHAIN &&
          this._shouldAutoSkipSelectChain(this.pendingMessage)
        ) {
          prevPending = this.pendingMessage;
          this.pendingMessage = null;
          this.core.duelSetResponse(this.handle, { type: OcgResponseType.SELECT_CHAIN, index: null });
          continue;
        }
        if (this.isSoloVsAi && this.pendingMessage && this.pendingMessage.player === this.aiIndex && this.winner === null) {
          const msgType = this.pendingMessage.type;
          const msgPlayer = this.pendingMessage.player;
          const needsBoardSync =
            msgType === OcgMessageType.SELECT_IDLECMD ||
            msgType === OcgMessageType.SELECT_BATTLECMD ||
            msgType === OcgMessageType.SELECT_CHAIN ||
            msgType === OcgMessageType.SELECT_CARD ||
            msgType === OcgMessageType.SELECT_TRIBUTE ||
            msgType === OcgMessageType.SELECT_UNSELECT_CARD ||
            msgType === OcgMessageType.SELECT_SUM ||
            msgType === OcgMessageType.SELECT_POSITION ||
            msgType === OcgMessageType.SELECT_PLACE ||
            msgType === OcgMessageType.SELECT_DISFIELD ||
            msgType === OcgMessageType.SELECT_EFFECTYN ||
            msgType === OcgMessageType.SELECT_YESNO;
          if (needsBoardSync) {
            this._syncStateFromCore();
          }
          const aiResp = this._computeAiResponse(this.pendingMessage, consecutiveRetries);
          if (aiResp) {
            // Clear consumed HINT_SELECTMSG after every prompt except ongoing SELECT_UNSELECT_CARD picks
            if (msgType !== OcgMessageType.SELECT_UNSELECT_CARD || aiResp.index === null) {
              this.lastHintMsgByPlayer[msgPlayer] = 0;
            }
            const isVisibleAiStep =
              msgType === OcgMessageType.SELECT_IDLECMD ||
              msgType === OcgMessageType.SELECT_BATTLECMD ||
              (msgType === OcgMessageType.SELECT_CHAIN && aiResp.index !== null && aiResp.index !== undefined);
            if (this.onAiStep && isVisibleAiStep) {
              if (!needsBoardSync) this._syncStateFromCore();
              const fingerprint = `${this.turnCount}|${this.turnPlayerIndex}|${this.phase}|${this.eventSeq}|${this.battleSeq}|${this.chainStack.length}|${this.lps[0]}|${this.lps[1]}`;
              if (!emittedAnyAiStep || fingerprint !== lastEmittedFingerprint) {
                const incEvents = this.recentEvents.filter((ev) => ev.seq > lastEmittedEventSeq).slice(-40);
                const stepSnap = structuredClone(this.state);
                stepSnap.recentEvents = incEvents;
                stepSnap.pendingChainPrompt = null;
                stepSnap.pendingOcgPrompt = null;
                this.onAiStep(stepSnap);
                lastEmittedEventSeq = this.eventSeq;
                lastEmittedFingerprint = fingerprint;
                emittedAnyAiStep = true;
              }
            }
            this._lastResponse = aiResp;
            prevPending = this.pendingMessage;
            this.pendingMessage = null;
            this.core.duelSetResponse(this.handle, aiResp);
            continue;
          } else {
            console.warn('[YGOProAI] Unhandled prompt:', this.pendingMessage.type);
          }
        }
        break;
      }
    }
    if (safety >= 3000) {
      console.warn('[YGOProEngine] processUntilWaiting hit safety limit (3000 steps); phase:', this.phase, 'turn:', this.turnCount);
    }

    this._syncStateFromCore();
    if (emittedAnyAiStep && this.state) {
      this.state.recentEvents = this.recentEvents.filter((ev) => ev.seq > lastEmittedEventSeq).slice(-40);
    }
  }

  /**
   * Authentic Yu-Gi-Oh! Master Duel Chain Toggle filter (AUTO / ON / OFF).
   * - OFF: skips all non-forced SELECT_CHAIN prompts.
   * - ON: prompts at every legal fast-effect timing window (Draw/Standby/Self-Chain/etc.).
   * - AUTO: prompts only when truly needed:
   *   1) Mandatory / Trigger effects or cards whose scripted SetHintTiming matches (spe_count > 0)
   *   2) Responding to an opponent's Chain Link (chainStack top is opponent's card)
   *   3) Combat windows (Attack Declaration / Damage Step / Damage Calculation)
   *   4) Opponent's End Phase / Battle Start when you have an on-field Spell/Trap or Monster Quick Effect
   *   Skips self-turn free-chain spam, Draw/Standby Phase open windows, Set/Pos-Change micro-windows,
   *   and free-chain self-chaining (use Chain: ON if you want Standby Maxx "C" or self-chaining).
   */
  _shouldAutoSkipSelectChain(msg) {
    if (!msg || msg.forced) return false;
    const selects = msg.selects || [];
    if (selects.length === 0) return true;

    const pMode = this.chainModes?.[msg.player] || 'AUTO';
    if (pMode === 'OFF') return true;
    if (pMode === 'ON') return false;

    const speCount = Number(msg.spe_count || 0);
    const chainLen = this.chainStack.length;

    // 1. Active Chain response window
    if (chainLen > 0) {
      const topChain = this.chainStack[chainLen - 1];
      // Always prompt when responding to opponent's card/effect
      if (topChain && topChain.controller !== msg.player) return false;
      // On your own Chain Link, only prompt in AUTO if an event-triggered effect (SEGOC / spe_count > 0) matched
      return speCount === 0;
    }

    // 2. Open / Event window (no active Chain yet)
    // Prompt if ocgcore flagged Trigger effects or scripted SetHintTiming matches (e.g. Maxx "C"/Imperm on opp Summon, Veiler on Main End, Torrential, Mirror Force)
    if (speCount > 0) return false;

    const timingSelf = Number(msg.hint_timing || 0);
    const timingOther = Number(msg.hint_timing_other || 0);
    const timingAny = timingSelf | timingOther;

    // Always prompt on Attack Declaration / Damage Step / Damage Calculation
    const combatMask = OcgHintTiming.ATTACK | OcgHintTiming.DAMAGE_STEP | OcgHintTiming.DAMAGE_CAL;
    if ((timingAny & combatMask) !== 0) return false;

    // On opponent's turn, prompt at End Phase or Battle Start only if an on-field card (e.g. Set MST/Trap/Quick Monster) can activate
    const isOpponentTurn = msg.player !== this.turnPlayerIndex;
    if (isOpponentTurn) {
      const oppCheckpointMask = OcgHintTiming.END_PHASE | OcgHintTiming.BATTLE_START;
      if ((timingOther & oppCheckpointMask) !== 0) {
        const hasFieldCard = selects.some(
          (s) => s.location === OcgLocation.SZONE || s.location === OcgLocation.MZONE
        );
        if (hasFieldCard) return false;
      }
    }

    // Otherwise auto-pass (Master Duel AUTO skips Draw/Standby, own-turn free-chain micro-windows, Set/Pos-Change, etc.)
    return true;
  }

  _consumeMessages(msgs) {
    for (const m of msgs) {
      this.aiPlayer?.onMessage(m);
      switch (m.type) {
        case OcgMessageType.RETRY:
          console.warn('[ygopro-core RETRY] invalid response was sent:', JSON.stringify(this._lastResponse));
          break;
        case OcgMessageType.HINT:
          if (m.hint_type === OcgHintType.SELECTMSG && typeof m.player === 'number') {
            this.lastHintMsgByPlayer[m.player] = Number(m.hint || 0);
          }
          break;
        case OcgMessageType.PLAYER_HINT:
          applyPlayerHint(this._lingeringTracker, {
            player: m.player,
            hintType: m.player_hint ?? OcgPlayerHintType.DESC_ADD,
            desc: m.description,
            turn: this.turnCount || 1,
            resolveDesc: resolveOcgDescription,
            getCardMeta: getUiCardMeta
          });
          break;
        case OcgMessageType.NEW_TURN:
          this.turnCount++;
          this.turnPlayerIndex = m.player;
          advancePhase(this._lingeringTracker, {
            turn: this.turnCount,
            phase: PHASES.DP,
            turnPlayer: this.turnPlayerIndex
          });
          this._aiState = createAiTurnState();
          this._aiChainKeysThisTurn.clear();
          this._aiActionCount = 0;
          this.lastHintMsgByPlayer = [0, 0];
          this._pendingPreferredPlace = [null, null];
          this.recentEvents.push({
            seq: ++this.eventSeq,
            type: 'NEW_TURN',
            turnCount: this.turnCount,
            turnPlayer: m.player,
            turnPlayerName: this.playerNames[m.player] || `Player ${m.player + 1}`
          });
          this.log(`--- Turn ${this.turnCount}: ${this.playerNames[m.player]}'s Turn ---`);
          break;
        case OcgMessageType.NEW_PHASE:
          this.phase = mapOcgPhaseToUi(m.phase);
          this.lastHintMsgByPlayer = [0, 0];
          advancePhase(this._lingeringTracker, {
            turn: this.turnCount || 1,
            phase: this.phase,
            turnPlayer: this.turnPlayerIndex
          });
          this.log(`Phase changed to ${this.phase}`);
          break;
        case OcgMessageType.DRAW: {
          const drawCount = m.drawn?.length || m.cards?.length || m.count || 1;
          this.log(`${this.playerNames[m.player]} drew ${drawCount} card(s).`);
          this.recentEvents.push({
            seq: ++this.eventSeq,
            type: 'DRAW',
            controller: m.player,
            count: drawCount
          });
          break;
        }
        case OcgMessageType.SUMMONING: {
          const meta = getUiCardMeta(m.code);
          this.log(`${this.playerNames[m.controller]} Normal Summoned ${meta?.name || m.code}.`, meta);
          this.recentEvents.push({
            seq: ++this.eventSeq,
            type: 'SUMMON',
            summonKind: 'NORMAL',
            code: m.code,
            meta: toCompactVfxMeta(m.code),
            controller: m.controller,
            zone: resolveZoneName(m.location, m.sequence),
            index: m.sequence,
            position: mapOcgPositionToUi(m.position)
          });
          break;
        }
        case OcgMessageType.SPSUMMONING: {
          const meta = getUiCardMeta(m.code);
          this.log(`${this.playerNames[m.controller]} Special Summoned ${meta?.name || m.code}.`, meta);
          this.recentEvents.push({
            seq: ++this.eventSeq,
            type: 'SUMMON',
            summonKind: 'SPECIAL',
            code: m.code,
            meta: toCompactVfxMeta(m.code),
            controller: m.controller,
            zone: resolveZoneName(m.location, m.sequence),
            index: m.sequence,
            position: mapOcgPositionToUi(m.position)
          });
          break;
        }
        case OcgMessageType.FLIPSUMMONING: {
          const meta = getUiCardMeta(m.code);
          this.log(`${this.playerNames[m.controller]} Flip Summoned ${meta?.name || m.code}.`, meta);
          this.recentEvents.push({
            seq: ++this.eventSeq,
            type: 'SUMMON',
            summonKind: 'FLIP',
            code: m.code,
            meta: toCompactVfxMeta(m.code),
            controller: m.controller,
            zone: resolveZoneName(m.location, m.sequence),
            index: m.sequence,
            position: mapOcgPositionToUi(m.position)
          });
          break;
        }
        case OcgMessageType.MOVE: {
          const from = m.from || {};
          const to = m.to || {};
          const fromIsOvl = Boolean((from.location || 0) & OcgLocation.OVERLAY);
          const toIsOvl = Boolean((to.location || 0) & OcgLocation.OVERLAY);
          const fromBaseLoc = fromIsOvl ? (from.location & ~OcgLocation.OVERLAY) : from.location;
          const toBaseLoc = toIsOvl ? (to.location & ~OcgLocation.OVERLAY) : to.location;
          const fromZone = resolveZoneName(from.location, from.sequence);
          const toZone = resolveZoneName(to.location, to.sequence);
          const fromFaceDown = Boolean((from.position || 0) & (OcgPosition.FACEDOWN_ATTACK | OcgPosition.FACEDOWN_DEFENSE));
          const toFaceDown = Boolean((to.position || 0) & (OcgPosition.FACEDOWN_ATTACK | OcgPosition.FACEDOWN_DEFENSE));
          const isPublicMove = !fromFaceDown || !toFaceDown || toZone === 'GY' || toZone === 'BANISHED' || fromZone === 'GY' || fromZone === 'BANISHED';
          this.recentEvents.push({
            seq: ++this.eventSeq,
            type: 'MOVE',
            code: isPublicMove ? m.card : 0,
            meta: isPublicMove ? toCompactVfxMeta(m.card) : null,
            from: {
              controller: from.controller,
              zone: fromZone,
              index: from.sequence,
              position: mapOcgPositionToUi(from.position || 0),
              isFaceDown: fromFaceDown,
              hostZone: fromIsOvl ? resolveZoneName(fromBaseLoc, from.sequence) : null,
              hostIndex: fromIsOvl ? from.sequence : null
            },
            to: {
              controller: to.controller,
              zone: toZone,
              index: to.sequence,
              position: mapOcgPositionToUi(to.position || 0),
              isFaceDown: toFaceDown,
              hostZone: toIsOvl ? resolveZoneName(toBaseLoc, to.sequence) : null,
              hostIndex: toIsOvl ? to.sequence : null
            }
          });
          break;
        }
        case OcgMessageType.POS_CHANGE: {
          const prevFaceDown = Boolean((m.prev_position || 0) & (OcgPosition.FACEDOWN_ATTACK | OcgPosition.FACEDOWN_DEFENSE));
          const nowFaceDown = Boolean((m.position || 0) & (OcgPosition.FACEDOWN_ATTACK | OcgPosition.FACEDOWN_DEFENSE));
          this.recentEvents.push({
            seq: ++this.eventSeq,
            type: 'POS_CHANGE',
            code: nowFaceDown ? 0 : m.code,
            meta: nowFaceDown ? null : toCompactVfxMeta(m.code),
            controller: m.controller,
            zone: resolveZoneName(m.location, m.sequence),
            index: m.sequence,
            prevPosition: mapOcgPositionToUi(m.prev_position || 0),
            position: mapOcgPositionToUi(m.position || 0),
            prevFaceDown,
            nowFaceDown
          });
          break;
        }
        case OcgMessageType.SET: {
          this.log(`${this.playerNames[m.controller]} Set a card.`);
          this.recentEvents.push({
            seq: ++this.eventSeq,
            type: 'SET',
            controller: m.controller,
            zone: resolveZoneName(m.location, m.sequence),
            index: m.sequence,
            position: mapOcgPositionToUi(m.position || 0)
          });
          break;
        }
        case OcgMessageType.CHAINING: {
          const meta = getUiCardMeta(m.code);
          const chainLink = this.chainStack.length + 1;
          const cardObj = this._buildCardObjectFromLoc(m.controller, m.location, m.sequence, m.code);
          this.chainStack.push({
            chainLink,
            playerIndex: m.controller,
            card: cardObj,
            effect: { labelEn: resolveOcgDescription(m.description, m.code), labelTh: resolveOcgDescription(m.description, m.code) },
            negated: false
          });
          this.recentEvents.push({
            seq: ++this.eventSeq,
            type: 'CHAINING',
            chainLink,
            code: m.code,
            meta: toCompactVfxMeta(m.code),
            controller: m.controller,
            zone: resolveZoneName(m.location, m.sequence),
            index: m.sequence,
            position: mapOcgPositionToUi(m.position || 0)
          });
          this.log(`⛓️ [Chain Link ${chainLink}] ${this.playerNames[m.controller]} activated ${meta?.name || m.code}.`, meta);
          break;
        }
        case OcgMessageType.CHAIN_NEGATED:
        case OcgMessageType.CHAIN_DISABLED: {
          const linkIdx = Number(m.chain_size || 0) - 1;
          if (linkIdx >= 0 && this.chainStack[linkIdx]) {
            this.chainStack[linkIdx].negated = true;
          }
          break;
        }
        case OcgMessageType.CHAIN_SOLVED:
          if (this.chainStack.length > 0) {
            const solved = this.chainStack.pop();
            if (solved && !solved.negated) {
              applyCatalogResolution(this._lingeringTracker, {
                code: Number(solved.card?.passcode || 0),
                player: solved.playerIndex,
                turn: this.turnCount || 1,
                getCardMeta: getUiCardMeta
              });
            }
          }
          break;
        case OcgMessageType.CHAIN_END:
          this.chainStack = [];
          break;
        case OcgMessageType.CONFIRM_CARDS: {
          const confirmedNames = [];
          const confirmedMetas = [];
          for (const c of m.cards || []) {
            this._confirmedCards.add(`${m.player}:${c.controller}:${c.location}:${c.sequence}:${c.code}`);
            const meta = getUiCardMeta(c.code);
            if (meta?.name) {
              confirmedNames.push(meta.name);
              confirmedMetas.push(meta);
            }
          }
          if (confirmedNames.length > 0) {
            this.log(`👁️ ${this.playerNames[m.player]} confirmed: ${confirmedNames.join(', ')}.`, confirmedMetas[0] || null, confirmedMetas);
          }
          break;
        }
        case OcgMessageType.DAMAGE: {
          const amount = Number(m.amount ?? m.value ?? 0);
          if (typeof m.player === 'number') {
            this.lps[m.player] = Math.max(0, (this.lps[m.player] ?? 8000) - amount);
          }
          if (this.lastBattleEvent && this.lastBattleEvent.seq === this.battleSeq) {
            this.lastBattleEvent.damage = (this.lastBattleEvent.damage || 0) + amount;
          }
          this.log(`${this.playerNames[m.player]} took ${amount} damage.`);
          break;
        }
        case OcgMessageType.RECOVER: {
          const amount = Number(m.amount ?? m.value ?? 0);
          if (typeof m.player === 'number') {
            this.lps[m.player] = (this.lps[m.player] ?? 8000) + amount;
          }
          this.log(`${this.playerNames[m.player]} gained ${amount} LP.`);
          break;
        }
        case OcgMessageType.PAY_LPCOST: {
          const amount = Number(m.amount ?? m.value ?? 0);
          if (typeof m.player === 'number') {
            this.lps[m.player] = Math.max(0, (this.lps[m.player] ?? 8000) - amount);
          }
          this.log(`${this.playerNames[m.player]} paid ${amount} LP.`);
          break;
        }
        case OcgMessageType.LPUPDATE: {
          if (typeof m.player === 'number' && typeof m.lp === 'number') {
            this.lps[m.player] = m.lp;
          }
          break;
        }
        case OcgMessageType.ATTACK: {
          this.battleSeq++;
          let atkCode = m.card?.code || 0;
          if (!atkCode && m.card) {
            try {
              const q = this.core.duelQuery(this.handle, {
                controller: m.card.controller,
                location: m.card.location,
                sequence: m.card.sequence,
                flags: OcgQueryFlags.CODE,
                overlaySequence: 0
              });
              atkCode = q?.code || 0;
            } catch {
              atkCode = 0;
            }
          }
          const atkMeta = getUiCardMeta(atkCode);
          this.lastBattleEvent = {
            seq: this.battleSeq,
            attackerPlayerIndex: m.card?.controller ?? 0,
            attackerInstanceId: m.card ? makeInstanceId(m.card.controller, m.card.location, m.card.sequence) : null,
            attackerZone: m.card ? resolveZoneName(m.card.location, m.card.sequence) : 'MMZ',
            attackerIndex: m.card?.sequence ?? 0,
            targetPlayerIndex: m.target?.controller ?? null,
            targetInstanceId: m.target ? makeInstanceId(m.target.controller, m.target.location, m.target.sequence) : null,
            targetZone: m.target ? resolveZoneName(m.target.location, m.target.sequence) : null,
            targetIndex: m.target?.sequence ?? 0,
            directAttack: !m.target,
            damage: 0
          };
          this.log(`${this.playerNames[m.card?.controller ?? 0]} attacks with ${atkMeta?.name || 'Monster'}!`, atkMeta);
          break;
        }
        case OcgMessageType.WIN:
          this.winner = m.player;
          this.winReason = `Player ${m.player + 1} won (reason #${m.reason})`;
          this.log(`🏆 ${this.playerNames[m.player] || 'Draw'} wins!`);
          break;
        case OcgMessageType.SELECT_IDLECMD:
        case OcgMessageType.SELECT_BATTLECMD:
        case OcgMessageType.SELECT_CHAIN:
        case OcgMessageType.SELECT_CARD:
        case OcgMessageType.SELECT_TRIBUTE:
        case OcgMessageType.SELECT_SUM:
        case OcgMessageType.SELECT_UNSELECT_CARD:
        case OcgMessageType.SELECT_PLACE:
        case OcgMessageType.SELECT_DISFIELD:
        case OcgMessageType.SELECT_POSITION:
        case OcgMessageType.SELECT_EFFECTYN:
        case OcgMessageType.SELECT_YESNO:
        case OcgMessageType.SELECT_OPTION:
        case OcgMessageType.SORT_CARD:
        case OcgMessageType.SORT_CHAIN:
        case OcgMessageType.SELECT_COUNTER:
        case OcgMessageType.ROCK_PAPER_SCISSORS:
        case OcgMessageType.ANNOUNCE_RACE:
        case OcgMessageType.ANNOUNCE_ATTRIB:
        case OcgMessageType.ANNOUNCE_CARD:
        case OcgMessageType.ANNOUNCE_NUMBER:
          this.pendingMessage = m;
          break;
        default:
          break;
      }
    }
  }

  _buildCardObjectFromLoc(controller, location, sequence, fallbackCode = 0, queryInfo = null) {
    const code = Number(queryInfo?.code || fallbackCode || 0);
    const meta = getUiCardMeta(code) || {
      id: `cdb_${code}`,
      passcode: String(code),
      name: code ? `Card #${code}` : 'Face-down Card',
      nameTh: code ? `Card #${code}` : 'การ์ดคว่ำ',
      description: '',
      descriptionTh: '',
      kind: 'MONSTER',
      frame: 'EFFECT',
      attribute: 'DARK',
      race: 'Unknown',
      level: 0,
      atk: 0,
      def: 0
    };

    const pos = queryInfo?.position ?? OcgPosition.FACEUP_ATTACK;
    const isFaceDown = Boolean(pos & (OcgPosition.FACEDOWN_ATTACK | OcgPosition.FACEDOWN_DEFENSE));
    const eqTarget = queryInfo?.equipTarget || queryInfo?.equip_target || queryInfo?.equipCard || queryInfo?.equip_card || null;
    const equipTargetInstanceId = (
      eqTarget &&
      typeof eqTarget.controller === 'number' &&
      typeof eqTarget.location === 'number' &&
      eqTarget.location > 0 &&
      typeof eqTarget.sequence === 'number'
    ) ? makeInstanceId(eqTarget.controller, eqTarget.location, eqTarget.sequence) : null;

    return {
      ...meta,
      instanceId: makeInstanceId(controller, location, sequence),
      owner: controller,
      controller,
      zone: resolveZoneName(location, sequence),
      zoneIndex: sequence,
      ocgLocation: location,
      ocgSequence: sequence,
      position: mapOcgPositionToUi(pos),
      isFaceDown,
      equipTargetInstanceId,
      currentAtk: queryInfo?.attack ?? meta.atk ?? 0,
      currentDef: queryInfo?.defense ?? meta.def ?? 0,
      currentLevel: queryInfo?.level ?? meta.level ?? 0,
      effectsNegated: Boolean(queryInfo?.isDisabled),
      overlayUnits: (queryInfo?.overlays || []).map((ovlCode, idx) => ({
        ...(getUiCardMeta(ovlCode) || {}),
        instanceId: `${makeInstanceId(controller, location, sequence)}_ovl${idx}`
      }))
    };
  }

  _queryPlayerState(pIdx, fieldState) {
    const lp = this.lps?.[pIdx] ?? 8000;

    const queryZone = (loc) => {
      const count = this.core.duelQueryCount(this.handle, pIdx, loc);
      const isFieldMonster = loc === OcgLocation.MZONE;
      const isFieldSpellTrap = loc === OcgLocation.SZONE;
      const flags = isFieldMonster
        ? (OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.LEVEL | OcgQueryFlags.RANK | OcgQueryFlags.ATTACK | OcgQueryFlags.DEFENSE | OcgQueryFlags.OVERLAY_CARD | OcgQueryFlags.STATUS)
        : isFieldSpellTrap
          ? (OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.EQUIP_CARD)
          : (OcgQueryFlags.CODE | OcgQueryFlags.POSITION);

      const results = [];
      // For MZONE (0..6) and SZONE (0..5), slots are fixed indices; for other zones, 0..count-1
      const maxSeq = (loc === OcgLocation.MZONE) ? 7 : (loc === OcgLocation.SZONE) ? 6 : count;
      for (let seq = 0; seq < maxSeq; seq++) {
        let q = null;
        try {
          q = this.core.duelQuery(this.handle, {
            controller: pIdx,
            location: loc,
            sequence: seq,
            flags,
            overlaySequence: 0
          });
        } catch {
          q = null;
        }
        if (!q) {
          try {
            q = this.core.duelQuery(this.handle, {
              controller: pIdx,
              location: loc,
              sequence: seq,
              flags: OcgQueryFlags.CODE | OcgQueryFlags.POSITION,
              overlaySequence: 0
            });
          } catch {
            q = null;
          }
        }
        if (!q) {
          try {
            q = this.core.duelQuery(this.handle, {
              controller: pIdx,
              location: loc,
              sequence: seq,
              flags: OcgQueryFlags.CODE,
              overlaySequence: 0
            });
          } catch {
            q = null;
          }
        }
        results.push(q);
      }
      return results;
    };

    const handList = queryZone(OcgLocation.HAND)
      .map((q, seq) => (q && q.code ? this._buildCardObjectFromLoc(pIdx, OcgLocation.HAND, seq, q.code, q) : null))
      .filter(Boolean);

    const mmz = [null, null, null, null, null];
    let emz = null;
    const emzSlots = [null, null];
    const mzoneList = queryZone(OcgLocation.MZONE);
    mzoneList.forEach((q, seq) => {
      if (!q || !q.code) return;
      const cardObj = this._buildCardObjectFromLoc(pIdx, OcgLocation.MZONE, seq, q.code, q);
      if (seq < 5) mmz[seq] = cardObj;
      else if (seq === 5 || seq === 6) {
        emz = cardObj;
        emzSlots[seq - 5] = cardObj;
      }
    });

    const stz = [null, null, null, null, null];
    let fieldZone = null;
    const szoneList = queryZone(OcgLocation.SZONE);
    szoneList.forEach((q, seq) => {
      if (!q || !q.code) return;
      const cardObj = this._buildCardObjectFromLoc(pIdx, OcgLocation.SZONE, seq, q.code, q);
      if (seq < 5) stz[seq] = cardObj;
      else if (seq === 5) fieldZone = cardObj;
    });

    const gy = queryZone(OcgLocation.GRAVE)
      .filter(q => q && q.code)
      .map((q, seq) => this._buildCardObjectFromLoc(pIdx, OcgLocation.GRAVE, seq, q.code, q));

    const banished = queryZone(OcgLocation.REMOVED)
      .filter(q => q && q.code)
      .map((q, seq) => this._buildCardObjectFromLoc(pIdx, OcgLocation.REMOVED, seq, q.code, q));

    const deckCount = this.core.duelQueryCount(this.handle, pIdx, OcgLocation.DECK);
    const deck = Array.from({ length: deckCount }, (_, i) => ({
      id: 'deck_hidden',
      instanceId: `deck_${pIdx}_${i}`,
      name: 'Deck Card',
      nameTh: 'การ์ดในเด็ค',
      isFaceDown: true
    }));

    const extra = queryZone(OcgLocation.EXTRA)
      .filter(q => q && q.code)
      .map((q, seq) => this._buildCardObjectFromLoc(pIdx, OcgLocation.EXTRA, seq, q.code, q));

    return {
      name: this.playerNames[pIdx],
      lp,
      hand: handList,
      mmz,
      stz,
      emz,
      emzSlots,
      fieldZone,
      fieldSpell: fieldZone,
      gy,
      banished,
      deck,
      extra,
      chainMode: this.chainModes?.[pIdx] || 'AUTO'
    };
  }

  _syncStateFromCore() {
    if (this.destroyed || !this.handle) return;
    let fieldState = null;
    try {
      fieldState = this.core.duelQueryField(this.handle);
    } catch {
      fieldState = null;
    }

    const players = [
      this._queryPlayerState(0, fieldState),
      this._queryPlayerState(1, fieldState)
    ];

    this.state = {
      players,
      turnCount: this.turnCount,
      turnPlayer: this.turnPlayerIndex,
      turnPlayerIndex: this.turnPlayerIndex,
      phase: this.phase,
      winner: this.winner,
      winReason: this.winReason,
      winReasonTh: this.winReasonTh,
      battleSeq: this.battleSeq,
      eventSeq: this.eventSeq,
      recentEvents: this.recentEvents.slice(-40),
      lastBattleEvent: this.lastBattleEvent,
      chainStack: this.chainStack,
      logs: this.logs,
      pendingChainPrompt: this._buildPendingChainPrompt(),
      pendingOcgPrompt: this._buildPendingOcgPrompt(),
      lingeringEffects: toLingeringSnapshot(this._lingeringTracker),
      aiDifficulty: this.aiDifficulty,
      isYgoProCore: true
    };
  }

  _buildPendingChainPrompt() {
    const m = this.pendingMessage;
    if (!m || m.type !== OcgMessageType.SELECT_CHAIN) return null;
    const respondableCards = (m.selects || []).map((sel, index) => {
      const meta = getUiCardMeta(sel.code);
      const desc = resolveOcgDescription(sel.description, sel.code);
      return {
        index,
        instanceId: makeInstanceId(sel.controller, sel.location, sel.sequence),
        cardId: meta?.id || `cdb_${sel.code}`,
        passcode: String(sel.code),
        cardName: meta?.name || `Card #${sel.code}`,
        cardNameTh: meta?.name || meta?.nameTh || `Card #${sel.code}`,
        labelTh: desc,
        effectId: `ocg_${index}`,
        code: sel.code,
        card: toLogCardSnapshot(meta)
      };
    });
    const topChain = this.chainStack[this.chainStack.length - 1];
    const isOpenWindow = this.chainStack.length === 0;
    return {
      responderIndex: m.player,
      chainLinkNumber: this.chainStack.length + 1,
      isOpenWindow,
      triggerPlayerIndex: topChain ? topChain.playerIndex : null,
      triggerCardNameTh: topChain?.card?.name || 'Open Timing Window',
      triggerEffectLabelTh: topChain?.effect?.labelEn || 'Summon / Phase Opportunity',
      forced: Boolean(m.forced),
      respondableCards
    };
  }

  _buildPendingOcgPrompt() {
    const m = this.pendingMessage;
    if (!m) return null;
    if (
      m.type === OcgMessageType.SELECT_IDLECMD ||
      m.type === OcgMessageType.SELECT_BATTLECMD ||
      m.type === OcgMessageType.SELECT_CHAIN
    ) {
      return null;
    }

    const mapLocCard = (c, idx) => {
      const isFaceDownPos = ((c.position || 0) & (OcgPosition.FACEDOWN_ATTACK | OcgPosition.FACEDOWN_DEFENSE)) !== 0;
      const isUnrevealedOppField =
        c.controller !== m.player &&
        c.location !== OcgLocation.HAND &&
        isFaceDownPos &&
        !this._confirmedCards.has(`${m.player}:${c.controller}:${c.location}:${c.sequence}:${c.code}`);
      if (isUnrevealedOppField) {
        return {
          index: idx,
          code: 0,
          name: 'Face-down Card',
          nameTh: 'การ์ดคว่ำหน้า',
          passcode: '0',
          controller: c.controller,
          location: c.location,
          zone: resolveZoneName(c.location, c.sequence),
          sequence: c.sequence,
          position: c.position,
          value: c.value ?? c.amount ?? 0,
          isHiddenFaceDown: true
        };
      }
      const meta = getUiCardMeta(c.code);
      return {
        index: idx,
        code: c.code,
        name: meta?.name || `Card #${c.code}`,
        nameTh: meta?.nameTh || meta?.name || `Card #${c.code}`,
        passcode: String(c.code),
        controller: c.controller,
        location: c.location,
        zone: resolveZoneName(c.location, c.sequence),
        sequence: c.sequence,
        position: c.position,
        value: c.value ?? c.amount ?? 0
      };
    };

    switch (m.type) {
      case OcgMessageType.SELECT_CARD:
      case OcgMessageType.SELECT_TRIBUTE:
        return {
          promptType: m.type === OcgMessageType.SELECT_TRIBUTE ? 'SELECT_TRIBUTE' : 'SELECT_CARD',
          player: m.player,
          min: m.min,
          max: m.max,
          canCancel: Boolean(m.can_cancel),
          cards: (m.selects || []).map(mapLocCard)
        };
      case OcgMessageType.SELECT_SUM:
        return {
          promptType: 'SELECT_SUM',
          player: m.player,
          selectMax: Number(m.select_max ?? 0),
          amount: m.amount,
          min: m.min,
          max: m.max,
          mustCards: (m.selects_must || []).map(mapLocCard),
          cards: (m.selects || []).map(mapLocCard)
        };
      case OcgMessageType.SELECT_UNSELECT_CARD:
        return {
          promptType: 'SELECT_UNSELECT_CARD',
          player: m.player,
          canFinish: Boolean(m.can_finish),
          canCancel: Boolean(m.can_cancel),
          min: m.min,
          max: m.max,
          selectCards: (m.select_cards || []).map(mapLocCard),
          unselectCards: (m.unselect_cards || []).map(mapLocCard)
        };
      case OcgMessageType.SELECT_PLACE:
      case OcgMessageType.SELECT_DISFIELD:
        return {
          promptType: m.type === OcgMessageType.SELECT_DISFIELD ? 'SELECT_DISFIELD' : 'SELECT_PLACE',
          player: m.player,
          count: m.count || 1,
          fieldMask: m.field_mask || 0
        };
      case OcgMessageType.SELECT_POSITION:
        return {
          promptType: 'SELECT_POSITION',
          player: m.player,
          code: m.code,
          cardName: getUiCardMeta(m.code)?.name || `Card #${m.code}`,
          positionsMask: m.positions
        };
      case OcgMessageType.SELECT_EFFECTYN:
        return {
          promptType: 'SELECT_EFFECTYN',
          player: m.player,
          code: m.code,
          cardName: getUiCardMeta(m.code)?.name || `Card #${m.code}`,
          description: resolveOcgDescription(m.description, m.code)
        };
      case OcgMessageType.SELECT_YESNO:
        return {
          promptType: 'SELECT_YESNO',
          player: m.player,
          description: resolveOcgDescription(m.description)
        };
      case OcgMessageType.SELECT_OPTION:
        return {
          promptType: 'SELECT_OPTION',
          player: m.player,
          options: (m.options || []).map((opt, idx) => ({
            index: idx,
            label: resolveOcgOptionLabel(opt, idx, 'en'),
            labelEn: resolveOcgOptionLabel(opt, idx, 'en'),
            labelTh: resolveOcgOptionLabel(opt, idx, 'th')
          }))
        };
      case OcgMessageType.SORT_CARD:
      case OcgMessageType.SORT_CHAIN:
        return {
          promptType: m.type === OcgMessageType.SORT_CHAIN ? 'SORT_CHAIN' : 'SORT_CARD',
          player: m.player,
          cards: (m.cards || []).map(mapLocCard)
        };
      case OcgMessageType.SELECT_COUNTER:
        return {
          promptType: 'SELECT_COUNTER',
          player: m.player,
          counterType: m.counter_type,
          count: m.count || 1,
          cards: (m.cards || []).map((c, idx) => ({
            ...mapLocCard(c, idx),
            counterCount: c.count || 0
          }))
        };
      case OcgMessageType.ROCK_PAPER_SCISSORS:
        return {
          promptType: 'ROCK_PAPER_SCISSORS',
          player: m.player
        };
      case OcgMessageType.ANNOUNCE_NUMBER:
        return {
          promptType: 'ANNOUNCE_NUMBER',
          player: m.player,
          values: m.values || []
        };
      case OcgMessageType.ANNOUNCE_RACE:
        return {
          promptType: 'ANNOUNCE_RACE',
          player: m.player,
          count: m.count || 1,
          available: Number(m.available || 0)
        };
      case OcgMessageType.ANNOUNCE_ATTRIB:
        return {
          promptType: 'ANNOUNCE_ATTRIB',
          player: m.player,
          count: m.count || 1,
          available: Number(m.available || 0)
        };
      case OcgMessageType.ANNOUNCE_CARD: {
        const isHumanTurn = !this.isSoloVsAi || m.player !== this.aiIndex;
        return {
          promptType: 'ANNOUNCE_CARD',
          player: m.player,
          opcodes: (m.opcodes || []).map(op => String(op)),
          validCodes: isHumanTurn && m.opcodes?.length ? findAnnounceCardCodes(m.opcodes, 40) : null
        };
      }
      default:
        return { promptType: 'UNKNOWN', rawType: m.type, player: m.player };
    }
  }

  getLegalActions(playerIndex) {
    const empty = {
      handActions: {},
      fieldActions: {},
      gyActions: {},
      banishedActions: {},
      extraActions: {},
      attackTargets: {},
      canBattlePhase: false,
      canMainPhase2: false,
      canEndTurn: false,
      canChainRespond: false
    };

    const m = this.pendingMessage;
    if (!m || m.player !== playerIndex) return empty;

    const pushAction = (bucket, locObj, actionObj) => {
      const id = makeInstanceId(locObj.controller, locObj.location, locObj.sequence);
      if (!bucket[id]) bucket[id] = [];
      bucket[id].push(actionObj);
    };

    const bucketForLoc = (loc) => {
      if (loc === OcgLocation.HAND) return empty.handActions;
      if (loc === OcgLocation.MZONE || loc === OcgLocation.SZONE) return empty.fieldActions;
      if (loc === OcgLocation.GRAVE) return empty.gyActions;
      if (loc === OcgLocation.REMOVED) return empty.banishedActions;
      if (loc === OcgLocation.EXTRA) return empty.extraActions;
      return empty.fieldActions;
    };

    if (m.type === OcgMessageType.SELECT_IDLECMD) {
      (m.summons || []).forEach((c, idx) => {
        pushAction(bucketForLoc(c.location), c, {
          type: 'NORMAL_SUMMON',
          label: 'Normal Summon',
          labelTh: 'อัญเชิญปกติ (ATK)',
          ocgAction: SelectIdleCMDAction.SELECT_SUMMON,
          ocgIndex: idx
        });
      });
      (m.monster_sets || []).forEach((c, idx) => {
        pushAction(bucketForLoc(c.location), c, {
          type: 'SET_MONSTER',
          label: 'Set Monster',
          labelTh: 'หมอบป้องกัน (Set)',
          ocgAction: SelectIdleCMDAction.SELECT_MONSTER_SET,
          ocgIndex: idx
        });
      });
      (m.special_summons || []).forEach((c, idx) => {
        pushAction(bucketForLoc(c.location), c, {
          type: 'SPECIAL_SUMMON',
          label: 'Special Summon',
          labelTh: 'อัญเชิญพิเศษ',
          ocgAction: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON,
          ocgIndex: idx
        });
      });
      (m.spell_sets || []).forEach((c, idx) => {
        pushAction(bucketForLoc(c.location), c, {
          type: 'SET_SPELL_TRAP',
          label: 'Set Spell/Trap',
          labelTh: 'หมอบเวท/กับดัก',
          ocgAction: SelectIdleCMDAction.SELECT_SPELL_SET,
          ocgIndex: idx
        });
      });
      (m.pos_changes || []).forEach((c, idx) => {
        pushAction(bucketForLoc(c.location), c, {
          type: 'CHANGE_POSITION',
          label: 'Change Position',
          labelTh: 'เปลี่ยนสภาพ (ATK/DEF)',
          ocgAction: SelectIdleCMDAction.SELECT_POS_CHANGE,
          ocgIndex: idx
        });
      });
      (m.activates || []).forEach((c, idx) => {
        const isPendulumScale = String(c.description || '') === '1160';
        const desc = isPendulumScale ? 'วางในโซนเพนดูลัม / Pendulum Scale' : resolveOcgDescription(c.description, c.code);
        pushAction(bucketForLoc(c.location), c, {
          type: 'ACTIVATE_EFFECT',
          label: isPendulumScale ? 'Activate Pendulum Scale' : desc,
          labelTh: desc,
          isPendulumScale,
          ocgAction: SelectIdleCMDAction.SELECT_ACTIVATE,
          ocgIndex: idx
        });
      });
      empty.canBattlePhase = Boolean(m.to_bp);
      empty.canEndTurn = Boolean(m.to_ep);
    } else if (m.type === OcgMessageType.SELECT_BATTLECMD) {
      const oppPlayer = this.state?.players?.[1 - playerIndex];
      const oppMonsters = (oppPlayer?.mmz || []).filter(Boolean);
      const oppEmz = Array.isArray(oppPlayer?.emzSlots)
        ? oppPlayer.emzSlots.filter(Boolean)
        : (oppPlayer?.emz ? [oppPlayer.emz] : []);
      const allOppTargets = [...oppMonsters, ...oppEmz];

      (m.attacks || []).forEach((c, idx) => {
        const id = makeInstanceId(c.controller, c.location, c.sequence);
        pushAction(empty.fieldActions, c, {
          type: 'ATTACK',
          label: 'Attack',
          labelTh: 'โจมตี',
          ocgAction: SelectBattleCMDAction.SELECT_BATTLE,
          ocgIndex: idx
        });
        if (allOppTargets.length === 0) {
          empty.attackTargets[id] = [{ isDirect: true, ocgIndex: idx, label: 'Direct Attack' }];
        } else {
          empty.attackTargets[id] = allOppTargets.map(t => ({
            instanceId: t.instanceId,
            ocgIndex: idx,
            label: t.name
          }));
        }
      });

      (m.chains || []).forEach((c, idx) => {
        const desc = resolveOcgDescription(c.description, c.code);
        pushAction(bucketForLoc(c.location), c, {
          type: 'ACTIVATE_EFFECT',
          label: desc,
          labelTh: desc,
          ocgAction: SelectBattleCMDAction.SELECT_CHAIN,
          ocgIndex: idx
        });
      });
      empty.canMainPhase2 = Boolean(m.to_m2);
      empty.canEndTurn = Boolean(m.to_ep);
    } else if (m.type === OcgMessageType.SELECT_CHAIN) {
      empty.canChainRespond = true;
      empty.chainPrompt = this._buildPendingChainPrompt();
    }

    return empty;
  }

  dispatchAction(playerIndex, action) {
    if (this.destroyed || !this.handle) {
      return { ok: false, error: 'Duel engine is not active.' };
    }
    if (action?.type === 'SET_CHAIN_MODE') {
      const mode = ['AUTO', 'ON', 'OFF'].includes(action.mode) ? action.mode : 'AUTO';
      this.chainModes[playerIndex] = mode;
      this._syncStateFromCore();
      return { ok: true, state: this.state };
    }
    if (action?.type === 'SURRENDER') {
      if (playerIndex !== 0 && playerIndex !== 1) {
        return { ok: false, error: 'Invalid player index.' };
      }
      if (this.winner !== null) {
        return { ok: false, error: 'Duel already finished.' };
      }
      const loserName = this.playerNames?.[playerIndex] || `Player ${playerIndex + 1}`;
      const winnerIdx = 1 - playerIndex;
      const winnerName = this.playerNames?.[winnerIdx] || `Player ${winnerIdx + 1}`;
      if (this.chainStack.length > 0) {
        this.log(`⛓️ Chain (${this.chainStack.length}) cancelled by surrender.`);
      }
      this.chainStack = [];
      this.pendingMessage = null;
      resetLingeringTracker(this._lingeringTracker);
      this.winner = winnerIdx;
      this.winReason = 'surrender';
      this.winReasonTh = `${loserName} ขอยอมแพ้ (Surrender)`;
      this.log(`🏳️ ${loserName} surrendered! ${winnerName} wins.`);
      this._syncStateFromCore();
      return { ok: true, state: this.state };
    }
    if (this.winner !== null) {
      return { ok: false, error: 'Duel already finished.' };
    }
    if (!this.pendingMessage) {
      return { ok: false, error: 'No pending prompt in duel engine.' };
    }
    const m = this.pendingMessage;
    if (m.player !== playerIndex) {
      return { ok: false, error: 'Not your turn / prompt.' };
    }

    let response = null;

    if (action.type === 'OCG_RESPONSE' && action.response) {
      response = action.response;
      if (response.type === OcgResponseType.ANNOUNCE_RACE && Array.isArray(response.races)) {
        response = { ...response, races: response.races.map(r => BigInt(r)) };
      } else if (
        response.type === OcgResponseType.SORT_CARD &&
        Array.isArray(response.order) &&
        response.order.length > 0
      ) {
        // Workaround for ocgcore-wasm@0.1.6 bug: case 15 (SORT_CARD) erroneously prepends a length byte
        // before the int8 rank array, causing ygopro-core MSG_RETRY on every manual sort (e.g. SPYRAL, Pot of Prosperity).
        // Also convert UI click-order (order[rank] = cardIdx) to ygopro-core's bvalue[cardIdx] = rank.
        const count = m.cards?.length || response.order.length;
        const bvalues = new Array(count).fill(0);
        for (let rank = 0; rank < response.order.length; rank++) {
          const cardIdx = Number(response.order[rank]);
          if (cardIdx >= 0 && cardIdx < count) {
            bvalues[cardIdx] = rank;
          }
        }
        // Pack raw int8 bytes into int16 little-endian pairs via SELECT_COUNTER (no length prefix)
        const counters = [];
        for (let i = 0; i < bvalues.length; i += 2) {
          const lo = bvalues[i] & 0xff;
          const hi = (i + 1 < bvalues.length ? bvalues[i + 1] : 0) & 0xff;
          let val = lo | (hi << 8);
          if (val >= 0x8000) val -= 0x10000;
          counters.push(val);
        }
        response = { type: OcgResponseType.SELECT_COUNTER, counters };
      }
    } else if (m.type === OcgMessageType.SELECT_IDLECMD) {
      const isEnterBattle = action.type === 'ENTER_BATTLE' || (action.type === 'CHANGE_PHASE' && action.targetPhase === PHASES.BP);
      const isEndTurn = action.type === 'END_TURN' || (action.type === 'CHANGE_PHASE' && action.targetPhase === PHASES.EP);
      if (isEnterBattle && m.to_bp) {
        response = { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
      } else if (isEndTurn && m.to_ep) {
        response = { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
      } else if (typeof action.ocgAction === 'number' && typeof action.ocgIndex === 'number') {
        response = { type: OcgResponseType.SELECT_IDLECMD, action: action.ocgAction, index: action.ocgIndex };
      } else {
        // Fallback match by instanceId + action type
        const legal = this.getLegalActions(playerIndex);
        const allBuckets = [legal.handActions, legal.fieldActions, legal.gyActions, legal.banishedActions, legal.extraActions];
        for (const b of allBuckets) {
          const list = b[action.instanceId] || [];
          const found = list.find(a => a.type === action.type || (action.type === 'INHERENT_SPECIAL_SUMMON' && a.type === 'SPECIAL_SUMMON'));
          if (found) {
            response = { type: OcgResponseType.SELECT_IDLECMD, action: found.ocgAction, index: found.ocgIndex };
            break;
          }
        }
      }
    } else if (m.type === OcgMessageType.SELECT_BATTLECMD) {
      const isMain2 = action.type === 'ENTER_MAIN2' || (action.type === 'CHANGE_PHASE' && action.targetPhase === PHASES.MP2);
      const isEndTurn = action.type === 'END_TURN' || (action.type === 'CHANGE_PHASE' && action.targetPhase === PHASES.EP);
      if (isMain2 && m.to_m2) {
        response = { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_M2, index: null };
      } else if (isEndTurn && m.to_ep) {
        response = { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
      } else if (action.type === 'ATTACK' || action.type === 'DECLARE_ATTACK') {
        const atkIdx = (m.attacks || []).findIndex(
          c => makeInstanceId(c.controller, c.location, c.sequence) === (action.attackerInstanceId || action.instanceId)
        );
        if (atkIdx >= 0) {
          this._pendingPreferredAttackTarget[playerIndex] = action.targetInstanceId || null;
          response = { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: atkIdx };
        }
      } else if (typeof action.ocgAction === 'number' && typeof action.ocgIndex === 'number') {
        response = { type: OcgResponseType.SELECT_BATTLECMD, action: action.ocgAction, index: action.ocgIndex };
      }
    } else if (m.type === OcgMessageType.SELECT_CHAIN) {
      if (action.type === 'CHAIN_RESPONSE') {
        if (!action.respond) {
          response = { type: OcgResponseType.SELECT_CHAIN, index: null };
        } else {
          response = { type: OcgResponseType.SELECT_CHAIN, index: Number(action.optionIndex ?? 0) };
        }
      }
    }

    if (!response) {
      return { ok: false, error: `Unsupported action "${action.type}" for prompt ${m.type}` };
    }

    if (typeof action.targetZoneIndex === 'number' && !Number.isNaN(action.targetZoneIndex)) {
      const zt = action.targetZoneType;
      const idx = action.targetZoneIndex;
      if (zt === 'FIELD_SPELL') {
        this._pendingPreferredPlace[playerIndex] = { location: OcgLocation.SZONE, sequence: 5, bit: 13 };
      } else if (zt === 'EMZ') {
        const seq = idx >= 5 ? idx : 5 + idx;
        this._pendingPreferredPlace[playerIndex] = { location: OcgLocation.MZONE, sequence: seq, bit: seq };
      } else if (zt === 'STZ' || action.type === 'SET_SPELL_TRAP') {
        const seq = idx >= 5 ? 5 : idx;
        this._pendingPreferredPlace[playerIndex] = { location: OcgLocation.SZONE, sequence: seq, bit: 8 + seq };
      } else if (zt === 'MMZ') {
        this._pendingPreferredPlace[playerIndex] = { location: OcgLocation.MZONE, sequence: idx, bit: idx };
      } else {
        // Untyped zone index fallback: prefer SZONE when activating/setting a Spell/Trap, else MZONE
        this._pendingPreferredPlace[playerIndex] = { location: OcgLocation.MZONE, sequence: idx, bit: idx, fallbackSzoneBit: idx < 5 ? 8 + idx : null };
      }
    }

    const prevPending = m;
    if (
      m.type === OcgMessageType.SELECT_CARD ||
      m.type === OcgMessageType.SELECT_TRIBUTE ||
      (m.type === OcgMessageType.SELECT_UNSELECT_CARD && response.index === null)
    ) {
      this.lastHintMsgByPlayer[playerIndex] = 0;
    }
    this._lastResponse = response;
    this.lastRetryError = false;
    this.pendingMessage = null;
    this.core.duelSetResponse(this.handle, response);
    this.processUntilWaiting(prevPending);

    if (this.lastRetryError) {
      return {
        ok: false,
        error: 'Invalid card selection for this effect. Please choose a valid selection.',
        state: this.state
      };
    }

    return { ok: true, state: this.state };
  }

  _computeAiResponse(m, retryAttempt = 0) {
    if (this.aiPlayer) {
      const resp = this.aiPlayer.decideFromEngine(m, this, retryAttempt, {
        pickFirstAvailablePlaces: (mask, count, player) => this._pickFirstAvailablePlaces(mask, count, player),
        findAnnounceCardCodes
      });
      if (resp) return resp;
    }
    return computeYgoProAiResponse(m, {
      aiIndex: this.aiIndex,
      difficulty: this.aiDifficulty,
      state: this.state,
      phase: this.phase,
      turnCount: this.turnCount,
      turnPlayerIndex: this.turnPlayerIndex,
      chainStack: this.chainStack,
      lastHintMsg: this.lastHintMsgByPlayer?.[this.aiIndex] || 0,
      retryAttempt,
      aiState: this._aiState,
      getCardMeta: getUiCardMeta,
      resolveDescription: resolveOcgDescription,
      solveSelectSum: (msg, scoreCardFn) => this._solveSelectSum(msg, scoreCardFn),
      pickFirstAvailablePlaces: (mask, count, player) => this._pickFirstAvailablePlaces(mask, count, player),
      findAnnounceCardCodes
    });
  }

  _solveSelectSum(m, scoreCardFn = null) {
    const selects = m.selects || [];
    const musts = m.selects_must || [];
    if (selects.length === 0) return [];

    const unpackVals = (amt) => {
      const n = Number(amt || 0);
      const v1 = n & 0xffff;
      const v2 = (n >>> 16) & 0xffff;
      return v2 > 0 && v2 !== v1 ? [v1, v2] : [v1];
    };

    let mustSums = new Set([0]);
    for (const mc of musts) {
      const vals = unpackVals(mc.amount);
      const next = new Set();
      for (const s of mustSums) {
        for (const v of vals) next.add(s + v);
      }
      mustSums = next;
    }

    const cardVals = selects.map(c => unpackVals(c.amount));
    const cardCosts = typeof scoreCardFn === 'function'
      ? selects.map(c => Number(scoreCardFn(c) || 0))
      : null;
    // Order candidate indices by ascending keep-value so lowest-value fodder is tried first
    const orderedOrigIndices = selects.map((_, i) => i);
    if (cardCosts) {
      orderedOrigIndices.sort((a, b) => cardCosts[a] - cardCosts[b]);
    }

    const target = Number(m.amount || 0);
    const selectMax = Number(m.select_max ?? 0);
    const minPicks = selectMax ? (musts.length > 0 ? 0 : 1) : Math.max(musts.length > 0 ? 0 : 1, Number(m.min || 0));
    const maxPicks = (m.max && m.max > 0) ? Math.min(selects.length, Number(m.max)) : selects.length;

    const getSumsForIndices = (indices) => {
      let sums = mustSums;
      for (const idx of indices) {
        const vals = cardVals[idx];
        const next = new Set();
        for (const s of sums) {
          for (const v of vals) next.add(s + v);
        }
        sums = next;
      }
      return sums;
    };

    const isValidSubset = (indices) => {
      if (indices.length + musts.length === 0) return false;
      const sums = getSumsForIndices(indices);
      // In ocgcore MSG_SELECT_SUM:
      // - select_max === 0 means CheckWithSumEqual (exact sum === target)
      // - select_max === 1 means CheckWithSumGreater (sum >= target, no superfluous cards)
      if (selectMax === 0) {
        return sums.has(target);
      }
      let meetsTarget = false;
      for (const s of sums) {
        if (s >= target) { meetsTarget = true; break; }
      }
      if (!meetsTarget) return false;
      if (indices.length > minPicks && indices.length > 1) {
        for (let r = 0; r < indices.length; r++) {
          const reduced = indices.filter((_, k) => k !== r);
          for (const s of getSumsForIndices(reduced)) {
            if (s >= target) return false;
          }
        }
      }
      return true;
    };

    let bestSolution = null;
    let bestCost = Infinity;
    let solutionsChecked = 0;
    const MAX_SOLUTIONS = cardCosts ? 64 : 1;

    const chosen = [];
    const dfs = (startPos, targetLen) => {
      if (solutionsChecked >= MAX_SOLUTIONS) return true;
      if (chosen.length === targetLen) {
        if (isValidSubset(chosen)) {
          solutionsChecked++;
          if (!cardCosts) {
            bestSolution = [...chosen].sort((a, b) => a - b);
            return true;
          }
          const cost = chosen.reduce((acc, idx) => acc + cardCosts[idx], 0);
          if (cost < bestCost) {
            bestCost = cost;
            bestSolution = [...chosen].sort((a, b) => a - b);
          }
        }
        return false;
      }
      const needed = targetLen - chosen.length;
      for (let pos = startPos; pos <= orderedOrigIndices.length - needed; pos++) {
        chosen.push(orderedOrigIndices[pos]);
        if (dfs(pos + 1, targetLen)) return true;
        chosen.pop();
      }
      return false;
    };

    for (let len = minPicks; len <= maxPicks; len++) {
      dfs(0, len);
      if (solutionsChecked >= MAX_SOLUTIONS) break;
    }

    if (bestSolution) return bestSolution;

    const fallbackCount = Math.max(1, Math.min(minPicks || 1, selects.length));
    return orderedOrigIndices.slice(0, fallbackCount).sort((a, b) => a - b);
  }

  _pickFirstAvailablePlaces(fieldMask, count, responderPlayer = 0) {
    const places = [];
    const opp = 1 - responderPlayer;
    // ocgcore field_mask: bit = 0 means available, bit = 1 means disabled/occupied.
    // Bits 0..15 belong to responderPlayer, bits 16..31 belong to opp.
    const tryAdd = (player, location, seqStart, seqEnd, bitOffset) => {
      for (let seq = seqStart; seq <= seqEnd; seq++) {
        const bit = bitOffset + (seq - seqStart);
        if (((fieldMask >>> bit) & 1) === 0) {
          places.push({ player, location, sequence: seq });
          if (places.length >= count) return true;
        }
      }
      return false;
    };
    if (tryAdd(responderPlayer, OcgLocation.MZONE, 0, 6, 0)) return places;
    if (tryAdd(responderPlayer, OcgLocation.SZONE, 0, 5, 8)) return places;
    if (tryAdd(opp, OcgLocation.MZONE, 0, 6, 16)) return places;
    if (tryAdd(opp, OcgLocation.SZONE, 0, 5, 24)) return places;
    return places;
  }
}
