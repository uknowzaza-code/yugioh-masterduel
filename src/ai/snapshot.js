import { LOC, POS, TYPE, PHASE_NAME } from './constants.js';
import { BoardView } from './board.js';

function mapEnginePhase(phase) {
  if (typeof phase === 'number') return PHASE_NAME[phase] ?? 'main1';
  const s = String(phase ?? '').toUpperCase();
  if (s === 'DP' || s === 'DRAW') return 'draw';
  if (s === 'SP' || s === 'STANDBY') return 'standby';
  if (s === 'MP1' || s === 'MAIN1') return 'main1';
  if (s === 'BP' || s === 'BATTLE') return 'battle';
  if (s === 'MP2' || s === 'MAIN2') return 'main2';
  if (s === 'EP' || s === 'END') return 'end';
  return 'main1';
}

function mapCardPosition(card) {
  if (!card) return POS.FACEUP_ATTACK;
  if (typeof card.ocgPosition === 'number') return card.ocgPosition;
  const pos = String(card.position ?? '').toUpperCase();
  const faceDown = Boolean(card.isFaceDown || pos.includes('SET') || pos.includes('DOWN'));
  const isDef = pos.includes('DEF');
  if (faceDown) return isDef ? POS.FACEDOWN_DEFENSE : POS.FACEDOWN_ATTACK;
  return isDef ? POS.FACEUP_DEFENSE : POS.FACEUP_ATTACK;
}

function mapCardType(card, cardDb) {
  const code = Number(card?.passcode || card?.code || 0);
  const db = code ? cardDb?.get?.(code) : null;
  if (db?.type) return db.type;
  let t = 0;
  const kind = String(card?.kind ?? '').toUpperCase();
  const frame = String(card?.frame ?? '').toUpperCase();
  const sub = String(card?.subType || card?.subtype || '').toUpperCase();
  if (kind === 'MONSTER') t |= TYPE.MONSTER;
  else if (kind === 'SPELL') t |= TYPE.SPELL;
  else if (kind === 'TRAP') t |= TYPE.TRAP;
  if (frame === 'NORMAL') t |= TYPE.NORMAL;
  if (frame === 'EFFECT') t |= TYPE.EFFECT;
  if (frame === 'FUSION') t |= TYPE.FUSION | TYPE.EFFECT;
  if (frame === 'SYNCHRO') t |= TYPE.SYNCHRO | TYPE.EFFECT;
  if (frame === 'XYZ') t |= TYPE.XYZ | TYPE.EFFECT;
  if (frame === 'LINK') t |= TYPE.LINK | TYPE.EFFECT;
  if (frame === 'RITUAL') t |= TYPE.RITUAL | TYPE.EFFECT;
  if (frame === 'TOKEN') t |= TYPE.TOKEN;
  if (sub === 'QUICK_PLAY' || sub === 'QUICKPLAY') t |= TYPE.QUICKPLAY;
  if (sub === 'CONTINUOUS') t |= TYPE.CONTINUOUS;
  if (sub === 'EQUIP') t |= TYPE.EQUIP;
  if (sub === 'FIELD') t |= TYPE.FIELD;
  if (sub === 'COUNTER') t |= TYPE.COUNTER;
  return t;
}

/**
 * แปลงการ์ดจาก engine.state เป็นรูปแบบ BoardView พร้อมซ่อนข้อมูลที่ AI ไม่ควรเห็น
 * (การ์ดในมือและใบคว่ำของฝั่งตรงข้ามจะถูก redact ออก)
 */
function convertUiCard(card, controller, location, sequence, isOpponent, cardDb) {
  if (!card) return null;
  const position = mapCardPosition(card);
  const isFaceDown = (position & POS.FACEDOWN) !== 0;
  const shouldHide = isOpponent && (location === LOC.HAND || location === LOC.EXTRA || isFaceDown);

  if (shouldHide) {
    return {
      code: 0,
      name: '',
      controller,
      location,
      sequence,
      position,
      type: 0,
      atk: 0,
      def: 0,
      level: 0,
      linkMarkers: 0,
      overlays: Array.isArray(card.xyzMaterials) ? card.xyzMaterials.length : 0,
      hidden: true,
    };
  }

  const code = Number(card.passcode || card.code || 0);
  const db = code ? cardDb?.get?.(code) : null;
  const type = mapCardType(card, cardDb);
  const isLinkCard = (type & TYPE.LINK) !== 0;
  return {
    code,
    name: card.name ?? db?.name ?? '',
    controller,
    location,
    sequence,
    position,
    type,
    atk: Number(card.atk ?? db?.atk ?? 0),
    def: isLinkCard ? 0 : Number(card.def ?? db?.def ?? 0),
    level: Number(card.level ?? card.rank ?? db?.level ?? 0),
    linkMarkers: isLinkCard ? Number(db?.def ?? card.linkMarkers ?? 0) : 0,
    overlays: Array.isArray(card.xyzMaterials) ? card.xyzMaterials.length : 0,
    effectsNegated: Boolean(card.effectsNegated),
    hidden: false,
  };
}

/**
 * สร้าง BoardView ที่ redact ข้อมูลลับของคู่แข่งแล้ว จาก state ของ YGOProEngine
 */
export function buildBoardViewFromEngineState(engine, me, tracker = null, cardDb = null) {
  const st = engine?.state;
  const players = [0, 1].map((idx) => {
    const p = st?.players?.[idx];
    const isOpp = idx !== me;
    const mzone = new Array(7).fill(null);
    const szone = new Array(8).fill(null);

    if (p) {
      (p.mmz || []).forEach((c, i) => {
        if (i < 5 && c) mzone[i] = convertUiCard(c, idx, LOC.MZONE, i, isOpp, cardDb);
      });
      (p.emzSlots || []).forEach((c, i) => {
        if (i < 2 && c) mzone[5 + i] = convertUiCard(c, idx, LOC.MZONE, 5 + i, isOpp, cardDb);
      });
      (p.stz || []).forEach((c, i) => {
        if (i < 5 && c) szone[i] = convertUiCard(c, idx, LOC.SZONE, i, isOpp, cardDb);
      });
      const fieldCard = p.fieldSpell || p.fieldZone;
      if (fieldCard) {
        szone[5] = convertUiCard(fieldCard, idx, LOC.SZONE, 5, isOpp, cardDb);
      }
    }

    return {
      lp: Number(p?.lp ?? engine?.lps?.[idx] ?? 8000),
      hand: (p?.hand || []).map((c, i) => convertUiCard(c, idx, LOC.HAND, i, isOpp, cardDb)),
      mzone,
      szone,
      grave: (p?.gy || []).map((c, i) => convertUiCard(c, idx, LOC.GRAVE, i, false, cardDb)),
      banished: (p?.banished || []).map((c, i) => convertUiCard(c, idx, LOC.REMOVED, i, isOpp, cardDb)),
      extra: (p?.extra || []).map((c, i) => convertUiCard(c, idx, LOC.EXTRA, i, isOpp, cardDb)),
      summonsThisTurn: tracker?.summonsThisTurn?.[idx] ?? 0,
    };
  });

  const chain = (tracker?.chain?.length ? tracker.chain : (engine?.chainStack || [])).map((cl) => ({
    player: Number(cl.player ?? cl.playerIndex ?? 0),
    code: Number(cl.code ?? cl.card?.passcode ?? 0),
    location: Number(cl.location ?? 0),
    sequence: Number(cl.sequence ?? 0),
    category: Number(cl.category ?? 0),
  }));

  return new BoardView({
    me,
    turn: Number(engine?.turnCount ?? tracker?.turn ?? 1),
    turnPlayer: Number(engine?.turnPlayerIndex ?? tracker?.turnPlayer ?? 0),
    phase: mapEnginePhase(engine?.phase ?? tracker?.phase),
    players,
    chain,
    event: tracker?.lastEvent ?? null,
    impermColumns: tracker?.impermColumns ? [...tracker.impermColumns] : [],
  });
}
