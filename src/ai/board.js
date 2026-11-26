import { LOC, POS, TYPE, EXTRA_DECK_TYPES } from './constants.js';

export const isFaceUp = (c) => !!c && (c.position & POS.FACEUP) !== 0;
export const isAttackPos = (c) => !!c && (c.position & POS.ATTACK) !== 0;
export const isLink = (c) => !!c && (c.type & TYPE.LINK) !== 0;
export const isExtraDeckType = (c) => !!c && (c.type & EXTRA_DECK_TYPES) !== 0;
export const sameRef = (a, b) =>
  !!a && !!b && a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;

export function makeCard(p = {}) {
  return {
    code: p.code ?? 0,
    name: p.name ?? '',
    controller: p.controller ?? 0,
    location: p.location ?? LOC.HAND,
    sequence: p.sequence ?? 0,
    position: p.position ?? POS.FACEUP_ATTACK,
    type: p.type ?? 0,
    atk: p.atk ?? 0,
    def: p.def ?? 0,
    level: p.level ?? 0,
    linkMarkers: p.linkMarkers ?? 0,
    category: p.category ?? 0,
    overlays: p.overlays ?? 0,
    effectsNegated: !!p.effectsNegated,
    hidden: !!p.hidden,
  };
}

function normalizePlayer(p = {}, idx) {
  const zone = (arr, n, location) =>
    Array.from({ length: n }, (_, i) =>
      arr?.[i] ? makeCard({ controller: idx, location, ...arr[i], sequence: i }) : null);
  const list = (arr, location) =>
    (arr ?? []).filter(Boolean).map((c, i) => makeCard({ controller: idx, location, ...c, sequence: i }));
  return {
    lp: p.lp ?? 8000,
    hand: list(p.hand, LOC.HAND),
    mzone: zone(p.mzone, 7, LOC.MZONE),
    szone: zone(p.szone, 8, LOC.SZONE),
    grave: list(p.grave, LOC.GRAVE),
    banished: list(p.banished, LOC.REMOVED),
    extra: list(p.extra, LOC.EXTRA),
    summonsThisTurn: p.summonsThisTurn ?? 0,
  };
}

/** มุมมองกระดานที่ AI "ควรรู้" เท่านั้น (ข้อมูลที่ซ่อนอยู่ต้องถูก redact ก่อน) */
export class BoardView {
  constructor({ me = 0, turn = 1, turnPlayer = 0, phase = 'main1', players = [], chain = [], event = null, impermColumns = [] } = {}) {
    this.me = me;
    this.turn = turn;
    this.turnPlayer = turnPlayer;
    this.phase = phase;
    this.players = [0, 1].map((i) => normalizePlayer(players[i], i));
    this.chain = chain;
    this.event = event;
    this.impermColumns = new Set(impermColumns);
  }
  get self() { return this.players[this.me]; }
  get opp() { return this.players[1 - this.me]; }
  get isMyTurn() { return this.turnPlayer === this.me; }

  zoneArray(controller, location) {
    const p = this.players[controller];
    if (!p) return null;
    switch (location & ~LOC.OVERLAY) {
      case LOC.HAND: return p.hand;
      case LOC.MZONE: return p.mzone;
      case LOC.SZONE: return p.szone;
      case LOC.GRAVE: return p.grave;
      case LOC.REMOVED: return p.banished;
      case LOC.EXTRA: return p.extra;
      default: return null;
    }
  }

  /** หาการ์ดจาก ref ของ ocgcore ({code, controller, location, sequence}); ถ้าไม่เจอให้ใช้ข้อมูลจาก DB */
  find(ref, kb) {
    if (!ref) return makeCard();
    const c = this.zoneArray(ref.controller, ref.location)?.[ref.sequence];
    if (c && (!ref.code || !c.code || c.code === ref.code)) return c;
    const s = kb?.stats(ref.code) ?? {};
    return makeCard({
      ...s, code: ref.code, controller: ref.controller, location: ref.location,
      sequence: ref.sequence, position: ref.position ?? POS.FACEUP_ATTACK,
    });
  }
}
