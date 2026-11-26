import { OcgMessageType } from 'ocgcore-wasm';
import { HINT_SELECTMSG, PHASE_NAME } from './constants.js';
import { AiBrain } from './brain.js';
import { fromOcgMessage, toOcgResponse, buildSafeRetryFallback } from './ocg-adapter.js';
import { buildBoardViewFromEngineState } from './snapshot.js';

const CODE_INFINITE_IMPERMANENCE = 10045474;

/**
 * AiPlayer — ชั้นเก็บสถานะการดูเอล (chain, hint, summon count, Imperm columns, turn/phase)
 * และเชื่อม AiBrain เข้ากับลูปข้อความของ ocgcore-wasm / YGOProEngine
 */
export class AiPlayer {
  /**
   * @param {{ me?: number, difficulty?: string, seed?: number, cardDb?: object, overrides?: object }} opts
   */
  constructor({ me = 1, difficulty = 'normal', seed = Date.now(), cardDb = null, overrides = {} } = {}) {
    this.me = me;
    this.cardDb = cardDb;
    this.brain = new AiBrain({ difficulty, seed, cardDb, overrides });
    this.reset();
  }

  reset() {
    this.turn = 0;
    this.turnPlayer = 0;
    this.phase = 'draw';
    this.chain = [];
    this.lastHintMsg = [0, 0];
    this.summonsThisTurn = [0, 0];
    this.impermColumns = new Set();
    this.lastEvent = null;
    this.brain.reset();
  }

  /** รับข้อความ event จาก ocgcore-wasm เพื่ออัปเดตสถานะภายใน */
  onMessage(msg) {
    if (!msg) return;
    switch (msg.type) {
      case OcgMessageType.NEW_TURN:
        this.turn += 1;
        this.turnPlayer = Number(msg.player ?? 0);
        this.summonsThisTurn = [0, 0];
        this.impermColumns.clear();
        this.lastHintMsg = [0, 0];
        this.brain.onNewTurn();
        break;
      case OcgMessageType.NEW_PHASE:
        this.phase = PHASE_NAME[msg.phase] ?? this.phase;
        break;
      case OcgMessageType.HINT:
        if (msg.hint_type === HINT_SELECTMSG && typeof msg.player === 'number') {
          this.lastHintMsg[msg.player] = Number(msg.hint ?? 0);
        }
        break;
      case OcgMessageType.CHAINING: {
        const code = Number(msg.code ?? 0);
        const player = Number(msg.player ?? msg.controller ?? 0);
        const location = Number(msg.location ?? 0);
        const sequence = Number(msg.sequence ?? 0);
        this.chain.push({ player, code, location, sequence, category: 0 });
        // ถ้า Infinite Impermanence ถูกเปิดจากช่อง S/T (location 0x08) เก็บคอลัมน์ไว้หลบในเทิร์นนี้
        if (code === CODE_INFINITE_IMPERMANENCE && (location & 0x08) && sequence < 5) {
          const colFromMyPerspective = player === this.me ? sequence : 4 - sequence;
          this.impermColumns.add(colFromMyPerspective);
        }
        break;
      }
      case OcgMessageType.CHAIN_SOLVED:
        if (this.chain.length) this.chain.pop();
        break;
      case OcgMessageType.CHAIN_END:
        this.chain = [];
        break;
      case OcgMessageType.SUMMONING:
      case OcgMessageType.SPSUMMONING: {
        const p = Number(msg.controller ?? this.turnPlayer);
        if (p === 0 || p === 1) this.summonsThisTurn[p] += 1;
        this.lastEvent = { type: 'summon', player: p, code: Number(msg.code ?? 0) };
        break;
      }
      case OcgMessageType.ATTACK:
        this.lastEvent = {
          type: 'attack',
          attacker: msg.card ?? null,
          target: msg.target ?? null,
        };
        break;
      default:
        break;
    }
  }

  /** ตัดสินใจจากข้อความ ocgcore-wasm + BoardView พร้อมแปลงกลับเป็น ocgcore response */
  decide(rawMsg, view, retryAttempt = 0, extras = {}) {
    if (!rawMsg) return null;
    if (retryAttempt > 0) {
      return buildSafeRetryFallback(rawMsg, retryAttempt, extras);
    }
    const canonical = fromOcgMessage(rawMsg, extras);
    if (!canonical) return null;
    const hint = this.lastHintMsg[this.me] ?? 0;
    const decision = this.brain.decide(canonical, view, hint);
    if (!decision) return null;

    if (
      rawMsg.type === OcgMessageType.SELECT_CARD ||
      rawMsg.type === OcgMessageType.SELECT_TRIBUTE ||
      (rawMsg.type === OcgMessageType.SELECT_UNSELECT_CARD && decision.index === null)
    ) {
      this.lastHintMsg[this.me] = 0;
    }

    return toOcgResponse(decision, rawMsg, extras);
  }

  /** ตัดสินใจโดยสร้าง BoardView แบบ redacted จาก YGOProEngine โดยตรง */
  decideFromEngine(rawMsg, engine, retryAttempt = 0, extras = {}) {
    const view = buildBoardViewFromEngineState(engine, this.me, this, this.cardDb);
    return this.decide(rawMsg, view, retryAttempt, extras);
  }
}
