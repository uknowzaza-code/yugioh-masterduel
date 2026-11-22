/**
 * @fileoverview Authoritative Rock-Paper-Scissors & Turn-Order Selection Session
 * Uses a shared state machine across Solo vs AI, Sandbox Pass & Play, WS Multiplayer, and P2P Multiplayer.
 */

export const RPS_MOVES = Object.freeze(['ROCK', 'PAPER', 'SCISSORS']);
export const RPS_TURN_ORDERS = Object.freeze(['FIRST', 'SECOND']);

const RPS_BEATS = Object.freeze({
  ROCK: 'SCISSORS',
  PAPER: 'ROCK',
  SCISSORS: 'PAPER'
});

/**
 * Normalizes a Rock-Paper-Scissors move input.
 * @param {string} move
 * @returns {'ROCK'|'PAPER'|'SCISSORS'|null}
 */
export function normalizeRpsMove(move) {
  const clean = String(move || '').trim().toUpperCase();
  return RPS_MOVES.includes(clean) ? clean : null;
}

/**
 * Normalizes a turn-order choice input.
 * @param {string} choice
 * @returns {'FIRST'|'SECOND'|null}
 */
export function normalizeTurnOrder(choice) {
  const clean = String(choice || '').trim().toUpperCase();
  return RPS_TURN_ORDERS.includes(clean) ? clean : null;
}

/**
 * Resolves a single RPS round for seat 0 vs seat 1.
 * @param {'ROCK'|'PAPER'|'SCISSORS'} move0
 * @param {'ROCK'|'PAPER'|'SCISSORS'} move1
 * @returns {'DRAW'|0|1}
 */
export function resolveRpsRound(move0, move1) {
  const m0 = normalizeRpsMove(move0);
  const m1 = normalizeRpsMove(move1);
  if (!m0 || !m1) {
    throw new Error('Both RPS moves must be valid (ROCK, PAPER, SCISSORS).');
  }
  if (m0 === m1) return 'DRAW';
  return RPS_BEATS[m0] === m1 ? 0 : 1;
}

/**
 * Picks a uniform random RPS move.
 * @returns {'ROCK'|'PAPER'|'SCISSORS'}
 */
export function pickRandomRpsMove() {
  return RPS_MOVES[Math.floor(Math.random() * RPS_MOVES.length)];
}

/**
 * Chooses AI turn order when AI wins RPS.
 * Going-second OTK decks (e.g., Tenpai/Ancient Gear) prefer SECOND; standard decks mostly pick FIRST.
 * @param {string} [aiDeckId]
 * @returns {'FIRST'|'SECOND'}
 */
export function chooseAiTurnOrder(aiDeckId = '') {
  if (/tenpai|ancient_gear|blind_second/i.test(String(aiDeckId || ''))) {
    return Math.random() < 0.85 ? 'SECOND' : 'FIRST';
  }
  return Math.random() < 0.78 ? 'FIRST' : 'SECOND';
}

export class RpsSession {
  /**
   * @param {[string, string]} playerNames
   */
  constructor(playerNames = ['Player 1', 'Player 2']) {
    this.names = [
      String(playerNames[0] || 'Player 1').trim() || 'Player 1',
      String(playerNames[1] || 'Player 2').trim() || 'Player 2'
    ];
    this.round = 1;
    this.phase = 'PICKING'; // 'PICKING' | 'CHOOSE_TURN' | 'DONE'
    this.moves = [null, null];
    this.winnerSeat = null;
    this.firstSeat = null;
    this.chosenOrder = null;
    this.lastRound = null;
  }

  /**
   * Records a seat's move for the current round and resolves when both have picked.
   * @param {0|1} seat
   * @param {string} rawMove
   */
  submitMove(seat, rawMove) {
    if (seat !== 0 && seat !== 1) {
      return { ok: false, error: 'Invalid player seat.' };
    }
    if (this.phase !== 'PICKING') {
      return { ok: false, error: 'Rock-Paper-Scissors round is not currently accepting moves.' };
    }

    const move = normalizeRpsMove(rawMove);
    if (!move) {
      return { ok: false, error: 'Invalid move. Expected ROCK, PAPER, or SCISSORS.' };
    }

    if (this.moves[seat] !== null) {
      if (this.moves[seat] === move) {
        return { ok: true, idempotent: true, roundResolved: false, waiting: true };
      }
      return { ok: false, error: 'Your move for this round is already locked.' };
    }

    this.moves[seat] = move;

    if (this.moves[0] && this.moves[1]) {
      const m0 = this.moves[0];
      const m1 = this.moves[1];
      const result = resolveRpsRound(m0, m1);

      if (result === 'DRAW') {
        this.lastRound = {
          round: this.round,
          moves: [m0, m1],
          result: 'DRAW',
          winnerSeat: null
        };
        this.round += 1;
        this.moves = [null, null];
        this.phase = 'PICKING';
        return {
          ok: true,
          roundResolved: true,
          draw: true,
          lastRound: this.lastRound
        };
      }

      this.lastRound = {
        round: this.round,
        moves: [m0, m1],
        result: 'WIN',
        winnerSeat: result
      };
      this.winnerSeat = result;
      this.moves = [null, null];
      this.phase = 'CHOOSE_TURN';
      return {
        ok: true,
        roundResolved: true,
        draw: false,
        winnerSeat: result,
        lastRound: this.lastRound
      };
    }

    return { ok: true, roundResolved: false, waiting: true };
  }

  /**
   * Records the RPS winner's choice to start FIRST or SECOND (opponent starts first).
   * @param {0|1} seat
   * @param {string} rawChoice
   */
  chooseTurnOrder(seat, rawChoice) {
    if (this.phase !== 'CHOOSE_TURN') {
      return { ok: false, error: 'Turn order selection is not active.' };
    }
    if (seat !== this.winnerSeat) {
      return { ok: false, error: 'Only the Rock-Paper-Scissors winner can choose turn order.' };
    }

    const choice = normalizeTurnOrder(rawChoice);
    if (!choice) {
      return { ok: false, error: 'Invalid turn order choice. Expected FIRST or SECOND.' };
    }

    this.chosenOrder = choice;
    this.firstSeat = choice === 'FIRST' ? this.winnerSeat : (1 - this.winnerSeat);
    this.phase = 'DONE';

    return {
      ok: true,
      complete: true,
      winnerSeat: this.winnerSeat,
      chosenOrder: this.chosenOrder,
      firstSeat: this.firstSeat
    };
  }

  /**
   * Produces a sanitized view for a specific seat without leaking an opponent's hidden move.
   * @param {0|1} seat
   */
  getPublicStateForSeat(seat) {
    const cleanSeat = seat === 1 ? 1 : 0;
    return {
      round: this.round,
      phase: this.phase,
      names: [...this.names],
      mySeat: cleanSeat,
      myMove: this.phase === 'PICKING' ? this.moves[cleanSeat] : null,
      opponentReady: this.phase === 'PICKING' ? Boolean(this.moves[1 - cleanSeat]) : true,
      winnerSeat: this.winnerSeat,
      firstSeat: this.firstSeat,
      chosenOrder: this.chosenOrder,
      lastRound: this.lastRound
        ? {
            round: this.lastRound.round,
            moves: [...this.lastRound.moves],
            result: this.lastRound.result,
            winnerSeat: this.lastRound.winnerSeat
          }
        : null
    };
  }
}
