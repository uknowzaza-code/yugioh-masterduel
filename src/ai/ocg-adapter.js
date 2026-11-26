import {
  OcgMessageType,
  OcgResponseType,
  SelectIdleCMDAction,
  SelectBattleCMDAction,
  OcgPosition,
} from 'ocgcore-wasm';

const IDLE_ACTION_TO_OCG = Object.freeze({
  SUMMON: SelectIdleCMDAction.SELECT_SUMMON,
  SPECIAL_SUMMON: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON,
  REPOS: SelectIdleCMDAction.SELECT_POS_CHANGE,
  SET_MONSTER: SelectIdleCMDAction.SELECT_MONSTER_SET,
  SET_ST: SelectIdleCMDAction.SELECT_SPELL_SET,
  ACTIVATE: SelectIdleCMDAction.SELECT_ACTIVATE,
  TO_BP: SelectIdleCMDAction.TO_BP,
  TO_EP: SelectIdleCMDAction.TO_EP,
});

const BATTLE_ACTION_TO_OCG = Object.freeze({
  SELECT_BATTLE: SelectBattleCMDAction.SELECT_BATTLE,
  SELECT_CHAIN: SelectBattleCMDAction.SELECT_CHAIN,
  TO_M2: SelectBattleCMDAction.TO_M2,
  TO_EP: SelectBattleCMDAction.TO_EP,
});

/** แปลงข้อความดิบจาก ocgcore-wasm ให้เป็นรูปแบบ canonical สำหรับ AiBrain */
export function fromOcgMessage(raw, extras = {}) {
  if (!raw) return null;
  switch (raw.type) {
    case OcgMessageType.SELECT_IDLECMD:
      return {
        type: 'SELECT_IDLECMD',
        summons: raw.summons ?? [],
        special_summons: raw.special_summons ?? [],
        repos: raw.pos_changes ?? raw.repos ?? [],
        set_monsters: raw.monster_sets ?? raw.set_monsters ?? [],
        set_st: raw.spell_sets ?? raw.set_st ?? [],
        activates: raw.activates ?? [],
        to_bp: Boolean(raw.to_bp),
        to_ep: Boolean(raw.to_ep),
      };
    case OcgMessageType.SELECT_BATTLECMD:
      return {
        type: 'SELECT_BATTLECMD',
        attacks: raw.attacks ?? [],
        chains: raw.chains ?? [],
        to_m2: Boolean(raw.to_m2),
        to_ep: Boolean(raw.to_ep),
      };
    case OcgMessageType.SELECT_CHAIN:
      return {
        type: 'SELECT_CHAIN',
        chains: raw.selects ?? raw.chains ?? [],
        forced: Boolean(raw.forced),
        spe_count: Number(raw.spe_count ?? 0),
      };
    case OcgMessageType.SELECT_EFFECTYN:
      return {
        type: 'SELECT_EFFECTYN',
        code: Number(raw.code ?? 0),
        desc: Number(raw.description ?? raw.desc ?? 0),
      };
    case OcgMessageType.SELECT_YESNO:
      return {
        type: 'SELECT_YESNO',
        desc: Number(raw.description ?? raw.desc ?? 0),
      };
    case OcgMessageType.SELECT_CARD:
      return {
        type: 'SELECT_CARD',
        selects: raw.selects ?? [],
        min: Number(raw.min ?? 1),
        max: Number(raw.max ?? raw.min ?? 1),
        can_cancel: Boolean(raw.can_cancel),
      };
    case OcgMessageType.SELECT_TRIBUTE:
      return {
        type: 'SELECT_TRIBUTE',
        selects: raw.selects ?? [],
        min: Number(raw.min ?? 1),
        max: Number(raw.max ?? raw.min ?? 1),
        can_cancel: Boolean(raw.can_cancel),
      };
    case OcgMessageType.SELECT_UNSELECT_CARD:
      return {
        type: 'SELECT_UNSELECT_CARD',
        selectable: raw.select_cards ?? raw.selectable ?? [],
        selected: raw.unselect_cards ?? raw.selected ?? [],
        can_finish: Boolean(raw.can_finish),
        can_cancel: Boolean(raw.can_cancel),
      };
    case OcgMessageType.SELECT_SUM:
      return {
        type: 'SELECT_SUM',
        selects: raw.selects ?? [],
        selects_must: raw.selects_must ?? [],
        amount: Number(raw.amount ?? 0),
        select_max: Number(raw.select_max ?? 0),
        min: Number(raw.min ?? 0),
        max: Number(raw.max ?? 0),
      };
    case OcgMessageType.SELECT_POSITION:
      return {
        type: 'SELECT_POSITION',
        code: Number(raw.code ?? 0),
        positions: Number(raw.positions ?? OcgPosition.FACEUP_ATTACK),
      };
    case OcgMessageType.SELECT_OPTION:
      return {
        type: 'SELECT_OPTION',
        options: (raw.options ?? []).map((o) => Number(o)),
      };
    case OcgMessageType.SELECT_PLACE:
      return {
        type: 'SELECT_PLACE',
        player: Number(raw.player ?? 0),
        count: Number(raw.count ?? 1),
        field_mask: Number(raw.field_mask ?? 0),
      };
    case OcgMessageType.SELECT_DISFIELD:
      return {
        type: 'SELECT_DISFIELD',
        player: Number(raw.player ?? 0),
        count: Number(raw.count ?? 1),
        field_mask: Number(raw.field_mask ?? 0),
      };
    case OcgMessageType.SELECT_COUNTER:
      return {
        type: 'SELECT_COUNTER',
        count: Number(raw.count ?? 0),
        cards: raw.cards ?? [],
      };
    case OcgMessageType.SORT_CARD:
      return { type: 'SORT_CARD', cards: raw.cards ?? [] };
    case OcgMessageType.SORT_CHAIN:
      return { type: 'SORT_CHAIN', cards: raw.cards ?? [] };
    case OcgMessageType.ANNOUNCE_RACE:
      return { type: 'ANNOUNCE_RACE', count: Number(raw.count ?? 1), available: Number(raw.available ?? 1) };
    case OcgMessageType.ANNOUNCE_ATTRIB:
      return { type: 'ANNOUNCE_ATTRIB', count: Number(raw.count ?? 1), available: Number(raw.available ?? 1) };
    case OcgMessageType.ANNOUNCE_NUMBER:
      return { type: 'ANNOUNCE_NUMBER', values: raw.values ?? [] };
    case OcgMessageType.ANNOUNCE_CARD: {
      const matches = extras.findAnnounceCardCodes ? extras.findAnnounceCardCodes(raw.opcodes || [], 1) : [];
      return { type: 'ANNOUNCE_CARD', suggestedCode: matches[0] ?? 14558127 };
    }
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return { type: 'ROCK_PAPER_SCISSORS' };
    default:
      return null;
  }
}

/** แปลงคำตัดสินใจของ AiBrain กลับเป็น response object ของ ocgcore-wasm */
export function toOcgResponse(decision, rawMsg, extras = {}) {
  if (!decision || !rawMsg) return null;
  switch (decision.type) {
    case 'SELECT_IDLECMD':
      return {
        type: OcgResponseType.SELECT_IDLECMD,
        action: IDLE_ACTION_TO_OCG[decision.action] ?? SelectIdleCMDAction.TO_EP,
        index: decision.index ?? null,
      };
    case 'SELECT_BATTLECMD':
      return {
        type: OcgResponseType.SELECT_BATTLECMD,
        action: BATTLE_ACTION_TO_OCG[decision.action] ?? SelectBattleCMDAction.TO_EP,
        index: decision.index ?? null,
      };
    case 'SELECT_CHAIN':
      return { type: OcgResponseType.SELECT_CHAIN, index: decision.index ?? null };
    case 'SELECT_EFFECTYN':
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: Boolean(decision.yes) };
    case 'SELECT_YESNO':
      return { type: OcgResponseType.SELECT_YESNO, yes: Boolean(decision.yes) };
    case 'SELECT_CARD':
      return { type: OcgResponseType.SELECT_CARD, indicies: decision.indices ?? null };
    case 'SELECT_TRIBUTE':
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies: decision.indices ?? null };
    case 'SELECT_UNSELECT_CARD':
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: decision.index ?? null };
    case 'SELECT_SUM':
      return { type: OcgResponseType.SELECT_SUM, indicies: decision.indices ?? [0] };
    case 'SELECT_POSITION':
      return { type: OcgResponseType.SELECT_POSITION, position: decision.position };
    case 'SELECT_OPTION':
      return { type: OcgResponseType.SELECT_OPTION, index: decision.index ?? 0 };
    case 'SELECT_PLACE':
    case 'SELECT_DISFIELD': {
      const respType = rawMsg.type === OcgMessageType.SELECT_DISFIELD
        ? OcgResponseType.SELECT_DISFIELD
        : OcgResponseType.SELECT_PLACE;
      const places = decision.places?.length
        ? decision.places
        : (extras.pickFirstAvailablePlaces
          ? extras.pickFirstAvailablePlaces(rawMsg.field_mask || 0, rawMsg.count || 1, rawMsg.player)
          : []);
      return { type: respType, places };
    }
    case 'SELECT_COUNTER':
      return { type: OcgResponseType.SELECT_COUNTER, counters: decision.counters ?? [] };
    case 'SORT_CARD':
    case 'SORT_CHAIN':
      return { type: OcgResponseType.SORT_CARD, order: decision.order ?? null };
    case 'ANNOUNCE_RACE': {
      const avail = BigInt(rawMsg.available || 1n);
      let chosen = 1n;
      for (let b = 0n; b < 32n; b++) {
        const bit = 1n << b;
        if ((avail & bit) !== 0n) { chosen = bit; break; }
      }
      return { type: OcgResponseType.ANNOUNCE_RACE, races: [chosen] };
    }
    case 'ANNOUNCE_ATTRIB': {
      const avail = Number(rawMsg.available || 1);
      let chosen = 1;
      for (let b = 0; b < 16; b++) {
        const bit = 1 << b;
        if ((avail & bit) !== 0) { chosen = bit; break; }
      }
      return { type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: [chosen] };
    }
    case 'ANNOUNCE_NUMBER':
      return { type: OcgResponseType.ANNOUNCE_NUMBER, value: rawMsg.values?.[decision.index ?? 0] ?? 1 };
    case 'ANNOUNCE_CARD':
      return { type: OcgResponseType.ANNOUNCE_CARD, card: decision.code ?? 14558127 };
    case 'ROCK_PAPER_SCISSORS':
      return { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: decision.hand ?? 1 };
    default:
      return null;
  }
}

/** Fallback ปลอดภัยเมื่อ ocgcore ส่ง MSG_RETRY (ป้องกันลูปค้าง) */
export function buildSafeRetryFallback(rawMsg, retryAttempt = 1, extras = {}) {
  switch (rawMsg.type) {
    case OcgMessageType.SELECT_IDLECMD:
      if (rawMsg.to_ep) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
      if (rawMsg.to_bp) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
      if (rawMsg.summons?.length) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 0 };
      if (rawMsg.special_summons?.length) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, index: 0 };
      if (rawMsg.activates?.length) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: 0 };
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
    case OcgMessageType.SELECT_BATTLECMD:
      if (rawMsg.to_m2) return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_M2, index: null };
      return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
    case OcgMessageType.SELECT_CHAIN:
      if (rawMsg.forced && rawMsg.selects?.length) return { type: OcgResponseType.SELECT_CHAIN, index: 0 };
      return { type: OcgResponseType.SELECT_CHAIN, index: null };
    case OcgMessageType.SELECT_CARD: {
      const count = Math.min(rawMsg.min || 1, rawMsg.selects?.length || 0);
      return { type: OcgResponseType.SELECT_CARD, indicies: Array.from({ length: count }, (_, i) => i) };
    }
    case OcgMessageType.SELECT_TRIBUTE: {
      const count = Math.min(rawMsg.min || 1, rawMsg.selects?.length || 0);
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies: Array.from({ length: count }, (_, i) => i) };
    }
    case OcgMessageType.SELECT_UNSELECT_CARD:
      if (rawMsg.can_finish) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
      if (rawMsg.select_cards?.length) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: 0 };
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
    case OcgMessageType.SELECT_OPTION: {
      const len = rawMsg.options?.length || 1;
      return { type: OcgResponseType.SELECT_OPTION, index: retryAttempt % len };
    }
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD: {
      const respType = rawMsg.type === OcgMessageType.SELECT_DISFIELD
        ? OcgResponseType.SELECT_DISFIELD
        : OcgResponseType.SELECT_PLACE;
      const places = extras.pickFirstAvailablePlaces
        ? extras.pickFirstAvailablePlaces(rawMsg.field_mask || 0, rawMsg.count || 1, rawMsg.player)
        : [];
      return { type: respType, places };
    }
    case OcgMessageType.SELECT_EFFECTYN:
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: false };
    case OcgMessageType.SELECT_YESNO:
      return { type: OcgResponseType.SELECT_YESNO, yes: false };
    default:
      return null;
  }
}
