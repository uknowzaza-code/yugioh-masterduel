import { getProfile } from './profiles.js';
import { createRng } from './rng.js';
import { CardKnowledge } from './knowledge.js';
import { decideBattle } from './battle.js';
import { decideIdle } from './idle.js';
import { decideChain, decideEffectYn, decideYesNo } from './chain.js';
import {
  decideSelectCard,
  decideSelectTribute,
  decideSelectUnselectCard,
  decidePosition,
  decideOption,
} from './select.js';
import { decideSelectSum } from './sum.js';
import { decidePlace } from './placement.js';

/**
 * AiBrain — ชั้นตัดสินใจล้วน (Pure JS, ไม่ผูกกับ ocgcore-wasm)
 * รับข้อความแบบ canonical + BoardView แล้วคืนคำตัดสินใจพร้อมเหตุผล (reason)
 */
export class AiBrain {
  /**
   * @param {{ difficulty?: string, seed?: number, cardDb?: object, overrides?: object }} opts
   */
  constructor({ difficulty = 'normal', seed = Date.now(), cardDb = null, overrides = {} } = {}) {
    this.profile = getProfile(difficulty);
    this.rng = createRng(seed);
    this.kb = new CardKnowledge({ cardDb, overrides });
    this.reset();
  }

  reset() {
    this.plannedAttack = null;
    this.actionsThisTurn = 0;
    this.setsThisTurn = 0;
    this.posChangedKeys = new Set();
    this.activationCounts = new Map();
    this.negatedChainLinks = new Set();
  }

  onNewTurn() {
    this.plannedAttack = null;
    this.actionsThisTurn = 0;
    this.setsThisTurn = 0;
    this.posChangedKeys.clear();
    this.activationCounts.clear();
    this.negatedChainLinks.clear();
  }

  decide(msg, view, hintMsg = 0) {
    switch (msg?.type) {
      case 'SELECT_IDLECMD':
        return decideIdle(this, msg, view);
      case 'SELECT_BATTLECMD':
        return decideBattle(this, msg, view);
      case 'SELECT_CHAIN':
        return decideChain(this, msg, view);
      case 'SELECT_EFFECTYN':
        return decideEffectYn(this, msg, view);
      case 'SELECT_YESNO':
        return decideYesNo(this, msg, view);
      case 'SELECT_CARD':
        return decideSelectCard(this, msg, view, hintMsg);
      case 'SELECT_TRIBUTE':
        return decideSelectTribute(this, msg, view);
      case 'SELECT_UNSELECT_CARD':
        return decideSelectUnselectCard(this, msg, view, hintMsg);
      case 'SELECT_SUM':
        return decideSelectSum(this, msg, view);
      case 'SELECT_POSITION':
        return decidePosition(this, msg, view);
      case 'SELECT_OPTION':
        return decideOption(this, msg);
      case 'SELECT_PLACE':
      case 'SELECT_DISFIELD':
        return decidePlace(this, msg, view);
      case 'SELECT_COUNTER': {
        const count = Number(msg.count ?? 1);
        const cards = msg.cards ?? [];
        const counters = cards.map(() => 0);
        let rem = count;
        for (let i = 0; i < cards.length && rem > 0; i++) {
          const take = Math.min(rem, Number(cards[i].count ?? rem));
          counters[i] = take;
          rem -= take;
        }
        return { type: 'SELECT_COUNTER', counters, reason: 'distribute-counters' };
      }
      case 'SORT_CARD':
      case 'SORT_CHAIN':
        return { type: msg.type, order: null, reason: 'default-order' };
      case 'ANNOUNCE_RACE':
      case 'ANNOUNCE_ATTRIB': {
        const avail = Number(msg.available ?? 1);
        const count = Math.max(1, Number(msg.count ?? 1));
        let mask = 0;
        let picked = 0;
        for (let b = 0; b < 32 && picked < count; b++) {
          if (avail & (1 << b)) {
            mask |= (1 << b);
            picked++;
          }
        }
        return { type: msg.type, value: mask || 1, reason: 'first-available-mask' };
      }
      case 'ANNOUNCE_NUMBER':
        return { type: 'ANNOUNCE_NUMBER', index: 0, reason: 'first-number' };
      case 'ANNOUNCE_CARD':
        return { type: 'ANNOUNCE_CARD', code: msg.suggestedCode ?? 89631139, reason: 'announce-card' };
      case 'ROCK_PAPER_SCISSORS':
        return { type: 'ROCK_PAPER_SCISSORS', hand: this.rng.int(3) + 1, reason: 'rps-rng' };
      default:
        return null;
    }
  }
}
