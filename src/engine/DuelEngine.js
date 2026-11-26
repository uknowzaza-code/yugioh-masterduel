/**
 * @fileoverview Yu-Gi-Oh! Master Duel Core State Machine (`DuelEngine`)
 * ระบบควบคุมเกมหลักตามกฎ Master Rule 5 (Master Duel):
 * - โซนสนามครบ (MMZ 5, STZ 5, EMZ 2, Field, GY, Banished, Hand, Deck, Extra Deck)
 * - ลำดับเฟส DP -> SP -> MP1 -> BP -> MP2 -> EP
 * - ระบบ Chain Link (LIFO Resolution) & Spell Speed 1/2/3 พร้อมปุ่มสลับ Chain (AUTO / ON / OFF)
 * - ระบบคำนวณการต่อสู้ (Battle Step / Damage Step) และการตรวจสอบผู้ชนะ
 */

import {
  INITIAL_LP,
  INITIAL_HAND_SIZE,
  MAX_HAND_SIZE,
  PHASES,
  CARD_KINDS,
  MONSTER_FRAMES,
  SPELL_SUBTYPES,
  TRAP_SUBTYPES,
  POSITIONS,
  SPELL_SPEED,
  CHAIN_MODE,
  TRIGGERS,
  ACTION_TYPES
} from '../constants/gameConstants.js';
import { CARD_REGISTRY, getCardById, getPresetDeckById, expandDeckRecipe } from '../cards/index.js';
import {
  createLingeringTracker,
  advancePhase as advanceLingeringPhase,
  toSnapshot as toLingeringSnapshot,
  resetTracker as resetLingeringTracker
} from './lingeringEffects.js';
import { matchesCardFilter } from '../cards/schema.js';
import { SummonManager } from './SummonManager.js';
import { EffectResolver } from './EffectResolver.js';

function inferCardIdFromLogText(message) {
  if (!message || typeof message !== 'string') return null;
  const allCards = Array.from(CARD_REGISTRY.values());

  // 1. Check quoted card names first (e.g. "บลูอายส์ ไวท์ดราก้อน")
  const quoted = [...message.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  if (quoted.length > 0) {
    const orderedQuotes = message.includes('เพื่ออัญเชิญ') && quoted.length > 1
      ? [quoted[quoted.length - 1], ...quoted.slice(0, -1)]
      : quoted;
    for (const q of orderedQuotes) {
      const exact = allCards.find(c => c.nameTh === q || c.name === q);
      if (exact) return exact.id;
    }
  }

  // 2. Fallback: match longest card name appearing in message
  const sorted = [...allCards].sort(
    (a, b) => Math.max(b.nameTh?.length || 0, b.name?.length || 0) - Math.max(a.nameTh?.length || 0, a.name?.length || 0)
  );
  for (const c of sorted) {
    if ((c.nameTh && message.includes(c.nameTh)) || (c.name && message.includes(c.name))) {
      return c.id;
    }
  }
  return null;
}

export class DuelEngine {
  constructor(options = {}) {
    this.instanceSeq = 1;
    this.triggerQueue = [];
    this.isResolvingChain = false;
    this.state = null;
    if (options.autoStart !== false) {
      this.initDuel(options);
    }
  }

  /**
   * เริ่มต้นดูเอลใหม่ระหว่างผู้เล่น 2 คน
   * @param {Object} config
   */
  initDuel(config = {}) {
    this.instanceSeq = 1;
    this.triggerQueue = [];
    this.isResolvingChain = false;
    const p0DeckDef = getPresetDeckById(config.p0DeckId || 'blue_eyes_meta');
    const p1DeckDef = getPresetDeckById(config.p1DeckId || 'swordsoul_tenyi');

    const p0 = this.createPlayerState(0, config.p0Name || 'ผู้เล่น 1 (คุณ)', p0DeckDef);
    const p1 = this.createPlayerState(1, config.p1Name || 'ผู้เล่น 2', p1DeckDef);
    const firstPlayerIndex = config.firstPlayerIndex === 1 ? 1 : 0;

    this._lingeringTracker = createLingeringTracker();
    this.state = {
      duelId: config.duelId || `duel_${Date.now()}`,
      turnCount: 1,
      turnPlayer: firstPlayerIndex,
      phase: PHASES.MP1,
      players: [p0, p1],
      chainStack: [],
      pendingChainPrompt: null, // { responderIndex, triggerDescriptionTh, respondableCards: [...] }
      drollLockActive: false,
      macroCosmosTurnsRemaining: 0,
      lingeringEffects: [],
      winner: null,
      winReasonTh: null,
      logs: [],
      lastEvent: null,
      battleSeq: 0,
      lastBattleEvent: null
    };

    this.shuffleDeck(0);
    this.shuffleDeck(1);

    this.drawCards(0, INITIAL_HAND_SIZE, 'INITIAL');
    this.drawCards(1, INITIAL_HAND_SIZE, 'INITIAL');

    const startingName = firstPlayerIndex === 0 ? p0.name : p1.name;
    this.log(`⚔️ เริ่มการดูเอล! ${p0.name} ปะทะ ${p1.name}`);
    this.log(`▶️ เทิร์นที่ 1: เทิร์นของ ${startingName} — เข้าสู่ Main Phase 1`);
    return this.state;
  }

  /**
   * สร้างโครงสร้างข้อมูลผู้เล่น 1 ฝั่ง
   */
  createPlayerState(playerIndex, name, deckDef) {
    const mainIds = expandDeckRecipe(deckDef.mainDeckRecipe || []);
    const extraIds = expandDeckRecipe(deckDef.extraDeckRecipe || []);

    const deck = mainIds
      .map(id => getCardById(id))
      .filter(Boolean)
      .map(def => this.createCardInstance(def, playerIndex, 'DECK'));

    const extra = extraIds
      .map(id => getCardById(id))
      .filter(Boolean)
      .map(def => this.createCardInstance(def, playerIndex, 'EXTRA'));

    return {
      index: playerIndex,
      name,
      deckId: deckDef.id,
      deckNameTh: deckDef.nameTh,
      lp: INITIAL_LP,
      deck,
      extra,
      hand: [],
      mmz: [null, null, null, null, null],
      stz: [null, null, null, null, null],
      emz: null,
      fieldSpell: null,
      gy: [],
      banished: [],
      normalSummonUsed: false,
      summonsThisTurn: 0,
      extraDeckSummonsThisTurn: 0,
      extraDeckSummonsLastTurn: 0,
      addedFromDeckToHandThisTurn: false,
      xyzBattledThisTurn: false,
      turnRestrictions: {},
      optUsed: [],
      maxxCActive: false,
      chainMode: CHAIN_MODE.AUTO
    };
  }

  /**
   * สร้างอินสแตนซ์ของการ์ดสำหรับใช้ในสนามจริง
   */
  createCardInstance(cardDef, ownerIndex, zone = 'DECK') {
    const instanceId = `c_${ownerIndex}_${this.instanceSeq++}_${cardDef.id}`;
    return {
      ...structuredClone(cardDef),
      instanceId,
      owner: ownerIndex,
      controller: ownerIndex,
      zone,
      zoneIndex: -1,
      position: POSITIONS.ATK,
      currentAtk: cardDef.atk ?? 0,
      currentDef: cardDef.def ?? 0,
      currentLevel: cardDef.level ?? cardDef.rank ?? 0,
      summonedTurn: 0,
      setTurn: 0,
      attacksUsed: 0,
      maxAttacks: 1,
      positionChangedThisTurn: false,
      effectsNegated: false,
      immuneThisTurn: false,
      properlySummoned: false,
      equippedTo: null,
      equipTargetInstanceId: null,
      overlayUnits: []
    };
  }

  /**
   * บันทึกประวัติการเล่นลง Duel Log พร้อมแนบข้อมูลการ์ดที่ทำงาน
   */
  log(message, cardOrId = null) {
    if (!this.state) return;
    let cardId = null;
    let cardSnapshot = null;

    if (typeof cardOrId === 'string') {
      cardId = cardOrId;
    } else if (cardOrId && typeof cardOrId === 'object') {
      cardId = cardOrId.id || null;
      if (cardId && !CARD_REGISTRY.has(cardId)) {
        cardSnapshot = {
          id: cardOrId.id,
          passcode: cardOrId.passcode || null,
          name: cardOrId.name,
          nameTh: cardOrId.nameTh,
          kind: cardOrId.kind,
          frame: cardOrId.frame,
          subtype: cardOrId.subtype || cardOrId.subType || null,
          subType: cardOrId.subType || cardOrId.subtype || null,
          attribute: cardOrId.attribute,
          race: cardOrId.race,
          level: cardOrId.level,
          rank: cardOrId.rank,
          linkRating: cardOrId.linkRating,
          atk: cardOrId.atk,
          def: cardOrId.def,
          description: cardOrId.description || cardOrId.descEn || '',
          descriptionTh: cardOrId.descriptionTh || cardOrId.descTh || '',
          descTh: cardOrId.descTh || cardOrId.descriptionTh || '',
          descEn: cardOrId.descEn || cardOrId.description || ''
        };
      }
    }

    if (!cardId) {
      cardId = inferCardIdFromLogText(message);
    }

    this.state.logs.push({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      turn: this.state.turnCount,
      phase: this.state.phase,
      text: message,
      cardId: cardId || null,
      cardSnapshot,
      timestamp: Date.now()
    });
    if (this.state.logs.length > 80) {
      this.state.logs.shift();
    }
  }

  /**
   * สับเด็คของผู้เล่น
   */
  shuffleDeck(playerIndex) {
    const deck = this.state.players[playerIndex].deck;
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }

  /**
   * จั่วการ์ดจากเด็คขึ้นมือ
   */
  drawCards(playerIndex, count = 1, reason = 'DRAW') {
    const player = this.state.players[playerIndex];
    if (reason !== 'INITIAL' && reason !== 'DRAW_PHASE' && this.state.drollLockActive) {
      this.log(`🔒 ติดเอฟเฟค Droll & Lock Bird — ไม่สามารถจั่วการ์ดด้วยเอฟเฟคได้ในเทิร์นนี้!`);
      return;
    }
    for (let i = 0; i < count; i++) {
      if (player.deck.length === 0) {
        if (reason !== 'INITIAL') {
          this.state.winner = 1 - playerIndex;
          this.state.winReasonTh = `${player.name} ไม่มีการ์ดเหลือในเด็คให้จั่ว (Deck Out)!`;
          this.log(`🏆 จบเกม! ${this.state.winReasonTh}`);
        }
        return;
      }
      const card = player.deck.shift();
      card.zone = 'HAND';
      card.position = POSITIONS.FACE_UP;
      player.hand.push(card);
    }
    if (reason !== 'INITIAL') {
      if (reason !== 'DRAW_PHASE') {
        player.addedFromDeckToHandThisTurn = true;
      }
      this.log(`🃏 ${player.name} จั่วการ์ด ${count} ใบ`);
    }
  }

  /**
   * ค้นหาการ์ดจาก instanceId ในทุกโซนของผู้เล่น
   */
  findCardInstance(instanceId) {
    for (let pIdx = 0; pIdx <= 1; pIdx++) {
      const p = this.state.players[pIdx];
      for (const zoneName of ['hand', 'deck', 'extra', 'gy', 'banished']) {
        const found = p[zoneName].find(c => c && c.instanceId === instanceId);
        if (found) return { card: found, playerIndex: pIdx, zone: zoneName.toUpperCase() };
      }
      for (let i = 0; i < 5; i++) {
        if (p.mmz[i]?.instanceId === instanceId) {
          return { card: p.mmz[i], playerIndex: pIdx, zone: 'MMZ', zoneIndex: i };
        }
        if (p.stz[i]?.instanceId === instanceId) {
          return { card: p.stz[i], playerIndex: pIdx, zone: 'STZ', zoneIndex: i };
        }
      }
      if (p.emz?.instanceId === instanceId) {
        return { card: p.emz, playerIndex: pIdx, zone: 'EMZ', zoneIndex: 0 };
      }
      if (p.fieldSpell?.instanceId === instanceId) {
        return { card: p.fieldSpell, playerIndex: pIdx, zone: 'FIELD', zoneIndex: 0 };
      }
    }
    return null;
  }

  /**
   * ดึงรายชื่อมอนสเตอร์บนสนามของผู้เล่น
   */
  getPlayerFieldMonsters(playerIndex) {
    const p = this.state.players[playerIndex];
    const list = [];
    for (const m of p.mmz) {
      if (m) list.push(m);
    }
    if (p.emz) list.push(p.emz);
    return list;
  }

  /**
   * ดึงรายชื่อการ์ดเวทมนตร์และกับดักบนสนามของผู้เล่น
   */
  getPlayerFieldSpellsTraps(playerIndex) {
    const p = this.state.players[playerIndex];
    const list = [];
    for (const st of p.stz) {
      if (st) list.push(st);
    }
    if (p.fieldSpell) list.push(p.fieldSpell);
    return list;
  }

  /**
   * หาช่องว่างใน Main Monster Zone (0..4) โดยรองรับช่องที่ผู้เล่นลากวางเจาะจง
   */
  getFreeMMZIndex(playerIndex, preferredIndex = null) {
    const mmz = this.state.players[playerIndex].mmz;
    if (Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex < 5 && mmz[preferredIndex] === null) {
      return preferredIndex;
    }
    return mmz.findIndex(slot => slot === null);
  }

  /**
   * หาช่องว่างใน Spell/Trap Zone (0..4) โดยรองรับช่องที่ผู้เล่นลากวางเจาะจง
   */
  getFreeSTZIndex(playerIndex, preferredIndex = null) {
    const stz = this.state.players[playerIndex].stz;
    if (Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex < 5 && stz[preferredIndex] === null) {
      return preferredIndex;
    }
    return stz.findIndex(slot => slot === null);
  }

  /**
   * ตรวจสอบว่าการ์ดในสุสาน/นอกเกมสามารถถูกชุบชีวิตด้วยเอฟเฟคได้หรือไม่ (Proper Special Summon Rule)
   */
  canBeRevivedFromGYOrBanished(card) {
    if (!card) return false;
    const requiresProperSummon = [
      MONSTER_FRAMES.FUSION,
      MONSTER_FRAMES.SYNCHRO,
      MONSTER_FRAMES.XYZ,
      MONSTER_FRAMES.LINK,
      'RITUAL'
    ].includes(card.frame) || Boolean(card.mustBeSpecialSummoned);
    if (!requiresProperSummon) return true;
    return Boolean(card.properlySummoned);
  }

  /**
   * ทำลายการ์ด Equip ทั้งหมดที่สวมใส่มอนสเตอร์เป้าหมาย (เมื่อมอนสเตอร์ออกจากสนามหรือถูกคว่ำหน้า)
   */
  destroyEquipCardsForMonster(monsterInstanceId) {
    if (!monsterInstanceId || !this.state) return;
    const toDestroy = [];
    for (const pIdx of [0, 1]) {
      const p = this.state.players[pIdx];
      for (const st of p.stz) {
        if (st && (st.equippedTo === monsterInstanceId || st.equipTargetInstanceId === monsterInstanceId)) {
          toDestroy.push(st);
        }
      }
    }
    for (const eq of toDestroy) {
      eq.equippedTo = null;
      eq.equipTargetInstanceId = null;
      this.destroyCard(eq.owner, eq.instanceId, 'EQUIP_TARGET_LOST');
    }
  }

  /**
   * พลิกมอนสเตอร์บนสนามเป็นคว่ำหน้าตั้งป้องกัน (ทำลาย Equip ที่สวมอยู่ แต่คง Xyz Materials ไว้)
   */
  flipMonsterFaceDown(instanceId) {
    const loc = this.findCardInstance(instanceId);
    if (!loc || (loc.zone !== 'MMZ' && loc.zone !== 'EMZ')) return false;
    const { card } = loc;
    if (card.frame === MONSTER_FRAMES.LINK || card.frame === MONSTER_FRAMES.TOKEN) {
      return false;
    }
    card.position = POSITIONS.SET_DEF;
    this.destroyEquipCardsForMonster(card.instanceId);
    return true;
  }

  /**
   * นำการ์ดออกจากโซนปัจจุบัน
   */
  removeFromCurrentZone(instanceId, options = {}) {
    const loc = this.findCardInstance(instanceId);
    if (!loc) return null;
    const { card, playerIndex, zone, zoneIndex } = loc;
    const p = this.state.players[playerIndex];

    if (zone === 'MMZ') p.mmz[zoneIndex] = null;
    else if (zone === 'STZ') p.stz[zoneIndex] = null;
    else if (zone === 'EMZ') p.emz = null;
    else if (zone === 'FIELD') p.fieldSpell = null;
    else if (zone === 'HAND') p.hand = p.hand.filter(c => c.instanceId !== instanceId);
    else if (zone === 'DECK') p.deck = p.deck.filter(c => c.instanceId !== instanceId);
    else if (zone === 'EXTRA') p.extra = p.extra.filter(c => c.instanceId !== instanceId);
    else if (zone === 'GY') p.gy = p.gy.filter(c => c.instanceId !== instanceId);
    else if (zone === 'BANISHED') p.banished = p.banished.filter(c => c.instanceId !== instanceId);

    // Clear equip reference if an Equip card leaves the field
    if (zone === 'STZ' && !options.isControlChange) {
      card.equippedTo = null;
      card.equipTargetInstanceId = null;
    }

    // If a monster actually leaves the field (not a control change):
    // 1. Send Xyz overlay units to GY (or Banished under Macro Cosmos)
    // 2. Destroy any Equip cards equipped to it
    if ((zone === 'MMZ' || zone === 'EMZ') && !options.isControlChange) {
      if (Array.isArray(card.overlayUnits) && card.overlayUnits.length > 0) {
        const units = card.overlayUnits.splice(0, card.overlayUnits.length);
        for (const u of units) {
          const unitOwner = this.state.players[u.owner];
          if (this.state.macroCosmosTurnsRemaining > 0) {
            u.zone = 'BANISHED';
            unitOwner.banished.push(u);
          } else {
            u.zone = 'GY';
            unitOwner.gy.push(u);
          }
        }
      }
      this.destroyEquipCardsForMonster(card.instanceId);
    }

    return card;
  }

  removeFromFieldZone(playerIndex, instanceId, options = {}) {
    return this.removeFromCurrentZone(instanceId, options);
  }

  /**
   * ย้ายการ์ดไปยังโซนปลายทาง (HAND, GY, BANISHED, EXTRA, DECK)
   */
  moveCardToZone(playerIndex, instanceId, targetZone, options = {}) {
    const loc = this.findCardInstance(instanceId);
    if (!loc) return null;
    const prevZone = loc.zone;
    const card = this.removeFromCurrentZone(instanceId);
    if (!card) return null;

    // Tokens disappear when leaving the field
    if (card.frame === MONSTER_FRAMES.TOKEN) {
      return card;
    }

    const ownerPlayer = this.state.players[card.owner];
    card.controller = card.owner;
    card.zoneIndex = -1;
    card.effectsNegated = false;
    card.currentAtk = card.atk ?? 0;
    card.currentDef = card.def ?? 0;

    const isExtraMonster = [
      MONSTER_FRAMES.FUSION,
      MONSTER_FRAMES.SYNCHRO,
      MONSTER_FRAMES.XYZ,
      MONSTER_FRAMES.LINK
    ].includes(card.frame);

    if (targetZone === 'HAND') {
      if (isExtraMonster) {
        card.zone = 'EXTRA';
        card.properlySummoned = false;
        ownerPlayer.extra.push(card);
      } else {
        card.zone = 'HAND';
        ownerPlayer.hand.push(card);
      }
    } else if (targetZone === 'GY') {
      const isPendulumFromField = (card.isPendulum || card.frame === 'PENDULUM') && ['MMZ', 'EMZ', 'STZ'].includes(prevZone);
      if (this.state.macroCosmosTurnsRemaining > 0) {
        card.zone = 'BANISHED';
        ownerPlayer.banished.push(card);
        if (prevZone !== 'BANISHED') {
          this.queueTriggerEffects(card.owner, card, TRIGGERS.ON_BANISHED);
        }
      } else if (isPendulumFromField) {
        card.zone = 'EXTRA';
        card.position = POSITIONS.FACE_UP;
        card.isFaceUpInExtra = true;
        ownerPlayer.extra.push(card);
      } else {
        card.zone = 'GY';
        ownerPlayer.gy.push(card);
        if (prevZone !== 'GY') {
          this.queueTriggerEffects(card.owner, card, TRIGGERS.ON_SEND_TO_GY);
        }
      }
    } else if (targetZone === 'BANISHED') {
      card.zone = 'BANISHED';
      ownerPlayer.banished.push(card);
      if (prevZone !== 'BANISHED') {
        this.queueTriggerEffects(card.owner, card, TRIGGERS.ON_BANISHED);
      }
    } else if (targetZone === 'DECK') {
      if (isExtraMonster) {
        card.zone = 'EXTRA';
        card.properlySummoned = false;
        ownerPlayer.extra.push(card);
      } else {
        card.zone = 'DECK';
        card.properlySummoned = false;
        ownerPlayer.deck.push(card);
      }
    } else if (targetZone === 'EXTRA') {
      card.zone = 'EXTRA';
      card.properlySummoned = false;
      ownerPlayer.extra.push(card);
    }

    return card;
  }

  /**
   * ทำลายการ์ดบนสนามและส่งลงสุสาน
   */
  destroyCard(ownerIndex, instanceId, reason = 'EFFECT') {
    const loc = this.findCardInstance(instanceId);
    if (!loc) return;
    const { card } = loc;
    this.log(`💥 "${card.nameTh}" ถูกทำลาย!`);
    this.moveCardToZone(card.owner, instanceId, 'GY', { reason });
    this.queueTriggerEffects(card.owner, card, TRIGGERS.ON_DESTROYED);
  }

  /**
   * ดีดการ์ดกลับขึ้นมือ (หรือกลับ Extra Deck ถ้าเป็นมอนสเตอร์ Extra Deck)
   */
  bounceCardToHand(ownerIndex, instanceId) {
    const loc = this.findCardInstance(instanceId);
    if (!loc) return;
    const { card } = loc;
    this.log(`🌪️ "${card.nameTh}" ถูกดีดกลับขึ้นมือ/Extra Deck!`);
    this.moveCardToZone(card.owner, instanceId, 'HAND', { reason: 'BOUNCE' });
  }

  /**
   * อัญเชิญพิเศษการ์ดลงบนสนามของผู้เล่น
   */
  specialSummonCard(playerIndex, card, position = POSITIONS.ATK, fromZone = null, preferredSlotIndex = null) {
    const player = this.state.players[playerIndex];
    this.removeFromCurrentZone(card.instanceId);

    const isExtra = [
      MONSTER_FRAMES.FUSION,
      MONSTER_FRAMES.SYNCHRO,
      MONSTER_FRAMES.XYZ,
      MONSTER_FRAMES.LINK
    ].includes(card.frame);

    // Link monsters are always in ATK position
    const finalPos = card.frame === MONSTER_FRAMES.LINK ? POSITIONS.ATK : position;

    // Master Rule 5 Placement: Link Monsters from Extra Deck go to EMZ or a Link-pointed MMZ
    const hasPreferredMMZ = Number.isInteger(preferredSlotIndex) && preferredSlotIndex >= 0 && preferredSlotIndex < 5 && player.mmz[preferredSlotIndex] === null;
    if (fromZone === 'EXTRA' && card.frame === MONSTER_FRAMES.LINK) {
      const pointedSlots = SummonManager.getLinkPointedMMZIndices(player);
      if (hasPreferredMMZ && pointedSlots.has(preferredSlotIndex)) {
        player.mmz[preferredSlotIndex] = card;
        card.zone = 'MMZ';
        card.zoneIndex = preferredSlotIndex;
      } else if (player.emz === null) {
        player.emz = card;
        card.zone = 'EMZ';
        card.zoneIndex = 0;
      } else {
        const validPointed = [...pointedSlots].find(idx => player.mmz[idx] === null);
        const slot = validPointed !== undefined ? validPointed : this.getFreeMMZIndex(playerIndex, preferredSlotIndex);
        if (slot === -1) {
          this.moveCardToZone(playerIndex, card.instanceId, 'GY');
          return null;
        }
        player.mmz[slot] = card;
        card.zone = 'MMZ';
        card.zoneIndex = slot;
      }
    } else if (hasPreferredMMZ && preferredSlotIndex !== null) {
      player.mmz[preferredSlotIndex] = card;
      card.zone = 'MMZ';
      card.zoneIndex = preferredSlotIndex;
    } else if (isExtra && player.emz === null && (card.frame === MONSTER_FRAMES.LINK || this.getFreeMMZIndex(playerIndex) === -1)) {
      player.emz = card;
      card.zone = 'EMZ';
      card.zoneIndex = 0;
    } else {
      const slot = this.getFreeMMZIndex(playerIndex, preferredSlotIndex);
      if (slot === -1) {
        if (player.emz === null) {
          player.emz = card;
          card.zone = 'EMZ';
          card.zoneIndex = 0;
        } else {
          this.moveCardToZone(playerIndex, card.instanceId, 'GY');
          return null;
        }
      } else {
        player.mmz[slot] = card;
        card.zone = 'MMZ';
        card.zoneIndex = slot;
      }
    }

    card.controller = playerIndex;
    card.position = finalPos;
    card.currentAtk = card.atk ?? 0;
    card.currentDef = card.def ?? 0;
    card.currentLevel = card.level ?? card.rank ?? 0;
    card.summonedTurn = this.state.turnCount;
    card.attacksUsed = 0;
    card.maxAttacks = 1;
    card.positionChangedThisTurn = false;
    card.effectsNegated = false;
    card.immuneThisTurn = false;

    player.summonsThisTurn = (player.summonsThisTurn || 0) + 1;
    if (fromZone === 'EXTRA') {
      player.extraDeckSummonsThisTurn = (player.extraDeckSummonsThisTurn || 0) + 1;
    }

    this.log(`✨ ${player.name} อัญเชิญพิเศษ "${card.nameTh}" (${card.currentAtk} ATK)!`);

    // Maxx "C" draw trigger if opponent has Maxx "C" active this turn
    const oppIndex = 1 - playerIndex;
    if (this.state.players[oppIndex]?.maxxCActive) {
      this.drawCards(oppIndex, 1, 'MAXX_C');
    }

    // Trigger ON_SPECIAL_SUMMON and ON_SUMMON_ANY
    this.queueTriggerEffects(playerIndex, card, TRIGGERS.ON_SPECIAL_SUMMON);
    this.queueTriggerEffects(playerIndex, card, TRIGGERS.ON_SUMMON_ANY);
    for (const oppMon of this.getPlayerFieldMonsters(oppIndex)) {
      if (oppMon.position !== POSITIONS.SET_DEF && !oppMon.effectsNegated) {
        this.queueTriggerEffects(oppIndex, oppMon, TRIGGERS.ON_OPPONENT_SPECIAL_SUMMON);
      }
    }
    this._pendingSummonForResponse = { summonerIndex: playerIndex, card };

    return card;
  }

  /**
   * เสกมอนสเตอร์โทเค็นลงบนสนาม
   */
  spawnToken(playerIndex, tokenDef, position = POSITIONS.ATK) {
    const slot = this.getFreeMMZIndex(playerIndex);
    if (slot === -1) return null;
    const player = this.state.players[playerIndex];
    const token = this.createCardInstance(tokenDef, playerIndex, 'MMZ');
    token.zoneIndex = slot;
    // Rulebook v10: Tokens can NEVER be face-down (always face-up ATK or face-up DEF)
    token.position = (position === POSITIONS.SET_DEF || position === POSITIONS.SET) ? POSITIONS.DEF : position;
    token.summonedTurn = this.state.turnCount;
    player.mmz[slot] = token;
    player.summonsThisTurn = (player.summonsThisTurn || 0) + 1;
    this.log(`🪙 ${player.name} อัญเชิญพิเศษโทเค็น "${token.nameTh}" ลงสนาม!`, token);
    return token;
  }

  /**
   * ตรวจสอบและจัดคิว Trigger Effects ตามกฎ SEGOC (Simultaneous Effects Go On Chain)
   * (เช่น ON_NORMAL_SUMMON, ON_SPECIAL_SUMMON, ON_SEND_TO_GY, ON_BANISHED, ON_DESTROYED)
   */
  queueTriggerEffects(playerIndex, card, triggerType, options = {}) {
    if (!card || !Array.isArray(card.effects)) return;
    if (card.effectsNegated && (card.zone === 'MMZ' || card.zone === 'EMZ')) return;

    const player = this.state.players[playerIndex];
    for (const eff of card.effects) {
      if (eff.trigger !== triggerType) continue;
      if (eff.opt && player.optUsed.includes(eff.opt)) continue;
      if (eff.condition && !this.checkCondition(playerIndex, eff.condition, card)) continue;
      if (!EffectResolver.canExecuteEffectActions(this, playerIndex, card, eff)) continue;

      if (eff.opt) player.optUsed.push(eff.opt);

      if (options.immediate) {
        this.log(`⚡ เอฟเฟคทำงาน: "${card.nameTh}" — ${eff.labelTh}`);
        EffectResolver.resolveChainItem(this, {
          playerIndex,
          card,
          effect: eff,
          negated: false,
          choices: {}
        });
      } else {
        this.triggerQueue.push({
          playerIndex,
          card,
          effect: eff
        });
      }
    }
  }

  /**
   * นำ Trigger Effects ที่รออยู่ในคิวขึ้นสู่ Chain Stack ตามลำดับ SEGOC
   * และเปิดหน้าต่างให้คู่ต่อสู้เชนตอบโต้ (เช่น Ash Blossom / Effect Veiler / Ghost Ogre) ก่อนคลี่คลายเชน
   */
  flushTriggerQueue() {
    if (this.isResolvingChain) {
      return { pendingChain: false };
    }
    if (!this.triggerQueue || this.triggerQueue.length === 0) {
      return this.checkPostSummonResponseWindow();
    }

    // SEGOC ordering (Rulebook v10):
    // 0: Turn Player Mandatory -> 1: Opponent Mandatory -> 2: Turn Player Optional -> 3: Opponent Optional
    const turnPlayer = this.state.turnPlayer;
    const batch = this.triggerQueue.splice(0, this.triggerQueue.length);
    const getSegocPriority = (item) => {
      const isMandatory = Boolean(item.effect?.mandatory);
      const isTurnP = item.playerIndex === turnPlayer;
      if (isMandatory) return isTurnP ? 0 : 1;
      return isTurnP ? 2 : 3;
    };
    batch.sort((a, b) => getSegocPriority(a) - getSegocPriority(b));

    for (const item of batch) {
      const { playerIndex, card, effect } = item;
      if (card.effectsNegated && (card.zone === 'MMZ' || card.zone === 'EMZ')) continue;
      if (effect.condition && !this.checkCondition(playerIndex, effect.condition, card)) continue;
      if (!EffectResolver.canExecuteEffectActions(this, playerIndex, card, effect)) continue;

      EffectResolver.payEffectCost(this, playerIndex, card, effect, {});

      const chainLinkNumber = this.state.chainStack.length + 1;
      this.state.chainStack.push({
        chainLink: chainLinkNumber,
        playerIndex,
        card,
        effect,
        spellSpeed: effect.spellSpeed || SPELL_SPEED.SS1,
        choices: {},
        negated: false,
        isTrigger: true
      });
      this.log(`⚡ [Chain Link ${chainLinkNumber} • Trigger] "${card.nameTh}" — ${effect.labelTh}`);
    }

    if (this.state.chainStack.length === 0) {
      return this.checkPostSummonResponseWindow();
    }
    this._pendingSummonForResponse = null;

    const topLink = this.state.chainStack[this.state.chainStack.length - 1];
    const oppIndex = 1 - topLink.playerIndex;
    const oppRespondable = this.getChainableEffectsForPlayer(oppIndex);
    if (oppRespondable.length > 0) {
      this.state.pendingChainPrompt = {
        responderIndex: oppIndex,
        triggerPlayerIndex: topLink.playerIndex,
        triggerCardNameTh: topLink.card.nameTh,
        triggerEffectLabelTh: topLink.effect.labelTh,
        chainLinkNumber: topLink.chainLink + 1,
        respondableCards: oppRespondable
      };
      return { pendingChain: true };
    }

    this.resolveFullChain();
    return { pendingChain: Boolean(this.state.pendingChainPrompt) };
  }

  /**
   * ตรวจสอบเงื่อนไข Condition ของเอฟเฟคหรือการอัญเชิญ
   */
  checkCondition(playerIndex, condition = {}, sourceCard = null) {
    if (!condition) return true;
    const player = this.state.players[playerIndex];
    const oppIndex = 1 - playerIndex;
    const opponent = this.state.players[oppIndex];

    if (condition.isMainPhase) {
      if (this.state.phase !== PHASES.MP1 && this.state.phase !== PHASES.MP2) return false;
    }
    if (condition.opponentMainPhaseOnly) {
      if (this.state.turnPlayer === playerIndex) return false;
      if (this.state.phase !== PHASES.MP1 && this.state.phase !== PHASES.MP2) return false;
    }
    if (condition.isOwnTurn && this.state.turnPlayer !== playerIndex) return false;
    if (condition.isOpponentTurn && this.state.turnPlayer === playerIndex) return false;

    if (condition.opponentSummonsThisTurnMin !== undefined) {
      if ((opponent.summonsThisTurn || 0) < condition.opponentSummonsThisTurnMin) return false;
    }
    if (condition.opponentExtraSummonsThisTurnMin !== undefined) {
      if ((opponent.extraDeckSummonsThisTurn || 0) < condition.opponentExtraSummonsThisTurnMin) return false;
    }
    if (condition.opponentExtraSummonsThisTurnOrLastMin !== undefined) {
      const maxRecent = Math.max(opponent.extraDeckSummonsThisTurn || 0, opponent.extraDeckSummonsLastTurn || 0);
      if (maxRecent < condition.opponentExtraSummonsThisTurnOrLastMin) return false;
    }
    if (condition.opponentAddedFromDeckToHandThisTurn) {
      if (!opponent.addedFromDeckToHandThisTurn) return false;
    }
    if (condition.xyzBattledThisTurn) {
      if (!player.xyzBattledThisTurn && !opponent.xyzBattledThisTurn) return false;
    }
    if (condition.emptyFieldRequired) {
      const ownCards = this.getPlayerFieldMonsters(playerIndex).length + this.getPlayerFieldSpellsTraps(playerIndex).length;
      if (ownCards > 0) return false;
    }

    if (condition.opponentControlsMonster) {
      if (this.getPlayerFieldMonsters(oppIndex).length === 0) return false;
    }
    if (condition.opponentControlsSpellTrap) {
      if (this.getPlayerFieldSpellsTraps(oppIndex).length === 0) return false;
    }
    if (condition.opponentControlsAnyCard) {
      const total = this.getPlayerFieldMonsters(oppIndex).length + this.getPlayerFieldSpellsTraps(oppIndex).length;
      if (total === 0) return false;
    }
    if (condition.selfControlsMonster) {
      if (this.getPlayerFieldMonsters(playerIndex).length === 0) return false;
    }
    if (condition.selfMonstersEmpty) {
      if (this.getPlayerFieldMonsters(playerIndex).length > 0) return false;
    }
    if (condition.selfControlsCard) {
      const allSelf = [...this.getPlayerFieldMonsters(playerIndex), ...this.getPlayerFieldSpellsTraps(playerIndex)];
      if (!allSelf.some(c => matchesCardFilter(c, condition.selfControlsCard, sourceCard))) return false;
    }
    if (condition.hasCardInHand) {
      if (!player.hand.some(c => matchesCardFilter(c, condition.hasCardInHand, sourceCard))) return false;
    }
    if (condition.hasCardInDeck) {
      if (!player.deck.some(c => matchesCardFilter(c, condition.hasCardInDeck, sourceCard))) return false;
    }
    if (condition.hasCardInGY) {
      if (!player.gy.some(c => matchesCardFilter(c, condition.hasCardInGY, sourceCard))) return false;
    }
    if (condition.hasCardInAnyGY) {
      const pool = [...player.gy, ...opponent.gy];
      if (!pool.some(c => matchesCardFilter(c, condition.hasCardInAnyGY, sourceCard))) return false;
    }
    if (condition.hasCardInHandOrField) {
      const pool = [...player.hand, ...this.getPlayerFieldMonsters(playerIndex)];
      if (!pool.some(c => matchesCardFilter(c, condition.hasCardInHandOrField, sourceCard))) return false;
    }
    if (condition.hasCardInFieldOrGY) {
      const pool = [...this.getPlayerFieldMonsters(playerIndex), ...player.gy];
      if (!pool.some(c => matchesCardFilter(c, condition.hasCardInFieldOrGY, sourceCard))) return false;
    }
    if (condition.minSpellsInGY !== undefined) {
      const spellsInGY = player.gy.filter(c => c.kind === CARD_KINDS.SPELL).length;
      if (spellsInGY < condition.minSpellsInGY) return false;
    }
    if (condition.minCardsInSelfGY !== undefined) {
      if (player.gy.length < condition.minCardsInSelfGY) return false;
    }
    if (condition.maxCardsInSelfGY !== undefined) {
      if (player.gy.length > condition.maxCardsInSelfGY) return false;
    }
    if (condition.emptyMonsterZonesCountMin !== undefined) {
      const emptyCount = player.mmz.filter(z => z === null).length;
      if (emptyCount < condition.emptyMonsterZonesCountMin) return false;
    }
    const hasChainCondition = Boolean(
      condition.requiresActiveChain ||
      condition.opponentChainOnly ||
      condition.chainSourceOnField ||
      condition.chainSourceKind ||
      Array.isArray(condition.chainIncludesActionTypes) ||
      condition.chainIncludesGYInteraction
    );
    if (hasChainCondition) {
      if (this.state.chainStack.length === 0) return false;
      const lastItem = this.state.chainStack[this.state.chainStack.length - 1];
      if (condition.opponentChainOnly && lastItem.playerIndex === playerIndex) return false;
      if (condition.chainSourceOnField) {
        if (!['MMZ', 'EMZ', 'STZ', 'FIELD'].includes(lastItem.card?.zone)) return false;
      }
      if (condition.chainSourceKind) {
        const kinds = Array.isArray(condition.chainSourceKind) ? condition.chainSourceKind : [condition.chainSourceKind];
        if (!kinds.includes(lastItem.card?.kind)) return false;
      }
      if (Array.isArray(condition.chainIncludesActionTypes)) {
        const actions = lastItem.effect?.actions || [];
        const hasMatch = actions.some(a => {
          if (!condition.chainIncludesActionTypes.includes(a.type)) return false;
          if (a.type === ACTION_TYPES.FUSION_SUMMON && !a.allowDeckMaterials) return false;
          return true;
        });
        if (!hasMatch) return false;
      }
      if (condition.chainIncludesGYInteraction) {
        const actions = lastItem.effect?.actions || [];
        const touchesGY = actions.some(a =>
          a.type === ACTION_TYPES.SPECIAL_SUMMON_FROM_GY ||
          a.type === ACTION_TYPES.SPECIAL_SUMMON_SELF_FROM_GY ||
          a.type === ACTION_TYPES.RECOVER_FROM_GY_TO_HAND ||
          (a.type === ACTION_TYPES.BANISH_CARDS && a.sourceZone === 'GY') ||
          (a.type === ACTION_TYPES.FUSION_SUMMON && a.allowGYMaterials)
        );
        if (!touchesGY) return false;
      }
    }

    return true;
  }

  /**
   * คำนวณ Spell Speed จริงของเอฟเฟคตามชนิดการ์ดและ trigger
   */
  getEffectiveSpellSpeed(card, eff) {
    if (eff?.spellSpeed) return eff.spellSpeed;
    if (card?.kind === CARD_KINDS.TRAP) {
      return card.subType === TRAP_SUBTYPES.COUNTER ? SPELL_SPEED.SS3 : SPELL_SPEED.SS2;
    }
    if (card?.kind === CARD_KINDS.SPELL && card.subType === SPELL_SUBTYPES.QUICK_PLAY) {
      return SPELL_SPEED.SS2;
    }
    if (eff?.trigger === TRIGGERS.QUICK_EFFECT) {
      return SPELL_SPEED.SS2;
    }
    if (eff?.trigger === TRIGGERS.COUNTER_TRAP) {
      return SPELL_SPEED.SS3;
    }
    return SPELL_SPEED.SS1;
  }

  /**
   * สร้างเอฟเฟคเปิดใช้งานพื้นฐานสำหรับการ์ดเวท/กับดักที่ยังไม่ได้สคริปต์เอฟเฟคหลัก
   */
  getCardFallbackActivationEffect(card) {
    if (!card || (card.kind !== CARD_KINDS.SPELL && card.kind !== CARD_KINDS.TRAP)) return null;
    const effects = Array.isArray(card.effects) ? card.effects : [];
    const hasPrimaryActivation = effects.some(eff =>
      eff.trigger === TRIGGERS.SPELL_ACTIVATE ||
      eff.trigger === TRIGGERS.COUNTER_TRAP ||
      (eff.trigger === TRIGGERS.QUICK_EFFECT && (!eff.zones || eff.zones.includes('STZ') || eff.zones.includes('FIELD') || eff.zones.includes('HAND')))
    );
    if (hasPrimaryActivation) return null;

    const isTrap = card.kind === CARD_KINDS.TRAP;
    const isQuickPlay = card.kind === CARD_KINDS.SPELL && card.subType === SPELL_SUBTYPES.QUICK_PLAY;
    const isCounterTrap = isTrap && card.subType === TRAP_SUBTYPES.COUNTER;
    const spellSpeed = isCounterTrap ? SPELL_SPEED.SS3 : (isTrap || isQuickPlay ? SPELL_SPEED.SS2 : SPELL_SPEED.SS1);
    const isContinuous =
      card.subType === SPELL_SUBTYPES.FIELD ||
      card.subType === SPELL_SUBTYPES.CONTINUOUS ||
      card.subType === SPELL_SUBTYPES.EQUIP ||
      card.subType === TRAP_SUBTYPES.CONTINUOUS;

    return {
      id: `__manual_activate_${card.id}`,
      trigger: TRIGGERS.SPELL_ACTIVATE,
      spellSpeed,
      isManualFallback: true,
      labelTh: isContinuous
        ? `เปิดใช้งาน${isTrap ? 'กับดัก' : 'เวทมนตร์'}ต่อเนื่องบนสนาม`
        : `เปิดใช้งานการ์ด${isTrap ? 'กับดัก' : 'เวทมนตร์'}`,
      labelEn: isContinuous ? 'Activate / Place face-up on field' : 'Activate Spell/Trap',
      actions: []
    };
  }

  /**
   * ค้นหาเอฟเฟคจริงของการ์ด (รวมถึง Fallback สำหรับเวท/กับดักที่ยังไม่มีเอฟเฟคหลัก)
   */
  resolveCardEffect(card, effectId) {
    if (!card) return null;
    const explicit = (card.effects || []).find(e => e.id === effectId);
    if (explicit) return explicit;
    const fallback = this.getCardFallbackActivationEffect(card);
    if (fallback && (!effectId || effectId === fallback.id)) return fallback;
    return (card.effects || [])[0] || null;
  }

  /**
   * เปิดหน้าต่างเชนหลังการอัญเชิญ (Summon Response Window) เมื่อไม่มี Trigger Effect ทำงาน
   * เช่น เปิดโอกาสให้ฝ่ายตรงข้ามตอบโต้ด้วย Nibiru, the Primal Being หลังอัญเชิญครบ 5+ ครั้ง
   */
  checkPostSummonResponseWindow() {
    const summonInfo = this._pendingSummonForResponse;
    this._pendingSummonForResponse = null;
    if (!summonInfo || this.isResolvingChain || this.state.winner !== null) {
      return { pendingChain: false };
    }
    if (this.state.pendingChainPrompt || this.state.chainStack.length > 0) {
      return { pendingChain: false };
    }

    const oppIndex = 1 - summonInfo.summonerIndex;
    const opp = this.state.players[oppIndex];
    if (!opp || opp.chainMode === CHAIN_MODE.OFF) {
      return { pendingChain: false };
    }

    const allChainable = this.getChainableEffectsForPlayer(oppIndex).filter(item => !item.isManualFallback);
    if (allChainable.length === 0) {
      return { pendingChain: false };
    }

    const candidates = opp.chainMode === CHAIN_MODE.ON
      ? allChainable
      : allChainable.filter(item => {
          const found = this.findCardInstance(item.instanceId);
          const c = found?.card;
          const eff = c ? this.resolveCardEffect(c, item.effectId) : null;
          if (!c || !eff) return false;
          if (c.id === 'nibiru_the_primal_being') return true;
          if (eff.condition?.opponentSummonsThisTurnMin !== undefined) return true;
          if (eff.condition?.onOpponentSummon) return true;
          if (c.kind === CARD_KINDS.TRAP && eff.condition?.requiresSummonResponse) return true;
          return false;
        });

    if (candidates.length === 0) {
      return { pendingChain: false };
    }

    this.state.pendingChainPrompt = {
      responderIndex: oppIndex,
      triggerPlayerIndex: summonInfo.summonerIndex,
      triggerCardNameTh: summonInfo.card?.nameTh || 'การอัญเชิญมอนสเตอร์',
      triggerEffectLabelTh: 'จังหวะหลังการอัญเชิญ (Summon Response Window)',
      chainLinkNumber: 1,
      isSummonResponse: true,
      respondableCards: candidates
    };
    return { pendingChain: true };
  }

  /**
   * ตรวจสอบการ์ดทั้งหมดของผู้เล่น `responderIndex` ที่สามารถกดเชนตอบโต้ (Spell Speed 2+) ได้ในขณะนี้
   */
  getChainableEffectsForPlayer(responderIndex) {
    const responder = this.state.players[responderIndex];
    if (responder.chainMode === CHAIN_MODE.OFF) return [];

    const topChain = this.state.chainStack[this.state.chainStack.length - 1];
    if (topChain?.effect?.cannotRespond) return [];

    const minSpellSpeed = topChain ? Math.max(SPELL_SPEED.SS2, topChain.spellSpeed || SPELL_SPEED.SS1) : SPELL_SPEED.SS2;

    const respondable = [];

    // 1. Hand Traps & Quick-Play Spells in hand
    for (const card of responder.hand) {
      const fallback = this.getCardFallbackActivationEffect(card);
      const cardEffs = [...(card.effects || []), ...(fallback ? [fallback] : [])];

      // Quick-Play Spells from hand on own turn
      if (card.kind === CARD_KINDS.SPELL && card.subType === SPELL_SUBTYPES.QUICK_PLAY && this.state.turnPlayer === responderIndex) {
        if (this.getFreeSTZIndex(responderIndex) !== -1) {
          for (const eff of cardEffs) {
            if ((eff.trigger === TRIGGERS.SPELL_ACTIVATE || eff.trigger === TRIGGERS.QUICK_EFFECT) &&
                this.canActivateEffectNow(responderIndex, card, eff, true, minSpellSpeed)) {
              respondable.push({
                instanceId: card.instanceId,
                cardId: card.id,
                cardNameTh: card.nameTh,
                effectId: eff.id,
                labelTh: eff.labelTh,
                isManualFallback: Boolean(eff.isManualFallback)
              });
            }
          }
        }
      }
      // Traps that can activate from hand if empty field (Infinite Impermanence)
      if (card.kind === CARD_KINDS.TRAP && card.canActivateFromHandIfEmptyField) {
        const ownFieldCount = this.getPlayerFieldMonsters(responderIndex).length + this.getPlayerFieldSpellsTraps(responderIndex).length;
        if (ownFieldCount === 0 && this.getFreeSTZIndex(responderIndex) !== -1) {
          for (const eff of cardEffs) {
            if (this.canActivateEffectNow(responderIndex, card, eff, true, minSpellSpeed)) {
              respondable.push({
                instanceId: card.instanceId,
                cardId: card.id,
                cardNameTh: card.nameTh,
                effectId: eff.id,
                labelTh: eff.labelTh,
                isManualFallback: Boolean(eff.isManualFallback)
              });
            }
          }
        }
      }
      // Monster Hand Traps (Ash Blossom, Maxx "C", Effect Veiler, Nibiru, Harmonia)
      if (card.kind === CARD_KINDS.MONSTER) {
        for (const eff of card.effects || []) {
          if (eff.trigger === TRIGGERS.QUICK_EFFECT && (eff.zones || []).includes('HAND')) {
            if (this.canActivateEffectNow(responderIndex, card, eff, true, minSpellSpeed)) {
              respondable.push({
                instanceId: card.instanceId,
                cardId: card.id,
                cardNameTh: card.nameTh,
                effectId: eff.id,
                labelTh: eff.labelTh
              });
            }
          }
        }
      }
    }

    // 2. Monster Quick Effects on Field
    for (const mon of this.getPlayerFieldMonsters(responderIndex)) {
      if (mon.position === POSITIONS.SET_DEF || mon.effectsNegated) continue;
      for (const eff of mon.effects || []) {
        if (eff.trigger === TRIGGERS.QUICK_EFFECT && (!eff.zones || eff.zones.includes(mon.zone))) {
          if (this.canActivateEffectNow(responderIndex, mon, eff, true, minSpellSpeed)) {
            respondable.push({
              instanceId: mon.instanceId,
              cardId: mon.id,
              cardNameTh: mon.nameTh,
              effectId: eff.id,
              labelTh: eff.labelTh
            });
          }
        }
      }
    }

    // 3. Set Spells/Traps & Face-Up Continuous/Field S/T Quick Effects
    for (const st of this.getPlayerFieldSpellsTraps(responderIndex)) {
      const wasSetPreviousTurn = st.setTurn < this.state.turnCount;
      if (st.position === POSITIONS.SET && !wasSetPreviousTurn) continue;

      const fallback = st.position === POSITIONS.SET ? this.getCardFallbackActivationEffect(st) : null;
      const stEffs = [...(st.effects || []), ...(fallback ? [fallback] : [])];

      for (const eff of stEffs) {
        const isActivatableTrapOrQP =
          (st.position === POSITIONS.SET && (st.kind === CARD_KINDS.TRAP || st.subType === SPELL_SUBTYPES.QUICK_PLAY) &&
            (eff.trigger === TRIGGERS.SPELL_ACTIVATE || eff.trigger === TRIGGERS.QUICK_EFFECT || eff.trigger === TRIGGERS.COUNTER_TRAP)) ||
          (st.position === POSITIONS.FACE_UP && (eff.trigger === TRIGGERS.QUICK_EFFECT || eff.trigger === TRIGGERS.COUNTER_TRAP) &&
            (!eff.zones || eff.zones.includes(st.zone)));

        if (isActivatableTrapOrQP && this.canActivateEffectNow(responderIndex, st, eff, true, minSpellSpeed)) {
          respondable.push({
            instanceId: st.instanceId,
            cardId: st.id,
            cardNameTh: st.nameTh,
            effectId: eff.id,
            labelTh: eff.labelTh,
            isManualFallback: Boolean(eff.isManualFallback)
          });
        }
      }
    }

    // 4. GY & Banished Quick Effects
    for (const gyCard of responder.gy) {
      for (const eff of gyCard.effects || []) {
        if (eff.trigger === TRIGGERS.QUICK_EFFECT && (eff.zones || []).includes('GY')) {
          if (this.canActivateEffectNow(responderIndex, gyCard, eff, true, minSpellSpeed)) {
            respondable.push({ instanceId: gyCard.instanceId, cardId: gyCard.id, cardNameTh: gyCard.nameTh, effectId: eff.id, labelTh: eff.labelTh });
          }
        }
      }
    }
    for (const banCard of responder.banished) {
      for (const eff of banCard.effects || []) {
        if (eff.trigger === TRIGGERS.QUICK_EFFECT && (eff.zones || []).includes('BANISHED')) {
          if (this.canActivateEffectNow(responderIndex, banCard, eff, true, minSpellSpeed)) {
            respondable.push({ instanceId: banCard.instanceId, cardId: banCard.id, cardNameTh: banCard.nameTh, effectId: eff.id, labelTh: eff.labelTh });
          }
        }
      }
    }

    return respondable;
  }

  /**
   * ตรวจสอบว่าเอฟเฟคหนึ่งสามารถสั่งใช้งานได้ในขณะนี้หรือไม่
   */
  canActivateEffectNow(playerIndex, card, eff, isChainResponse = false, minSpellSpeed = SPELL_SPEED.SS1) {
    const player = this.state.players[playerIndex];
    const effSpeed = this.getEffectiveSpellSpeed(card, eff);
    if (effSpeed < minSpellSpeed) return false;
    if (eff.opt && player.optUsed.includes(eff.opt)) return false;

    if (eff.zones && !eff.zones.includes(card.zone)) {
      return false;
    }

    // Rulebook v10: Traps must be Set first (cannot activate directly from hand unless card text allows)
    if (card.kind === CARD_KINDS.TRAP && card.zone === 'HAND') {
      if (!card.canActivateFromHandIfEmptyField) return false;
      const ownFieldCount = this.getPlayerFieldMonsters(playerIndex).length + this.getPlayerFieldSpellsTraps(playerIndex).length;
      if (ownFieldCount > 0) return false;
    }

    // Rulebook v10: Quick-Play Spells in hand can only be activated during your own turn
    if (card.kind === CARD_KINDS.SPELL && card.subType === SPELL_SUBTYPES.QUICK_PLAY && card.zone === 'HAND') {
      if (this.state.turnPlayer !== playerIndex) return false;
    }

    // Master Rule: Set Traps and Set Quick-Play Spells cannot be activated the same turn they were Set
    if (card.zone === 'STZ' && card.position === POSITIONS.SET) {
      if (card.kind === CARD_KINDS.TRAP && card.setTurn >= this.state.turnCount) {
        return false;
      }
      if (card.kind === CARD_KINDS.SPELL && card.subType === SPELL_SUBTYPES.QUICK_PLAY && card.setTurn >= this.state.turnCount) {
        return false;
      }
    }

    // Master Rule: Ignition effects and Spell Speed 1 Spell activations require own Main Phase 1/2 in an open game state
    if (!isChainResponse) {
      if (eff.condition?.requiresActiveChain) return false;
      if (eff.trigger === TRIGGERS.IGNITION ||
          (eff.trigger === TRIGGERS.SPELL_ACTIVATE && effSpeed === SPELL_SPEED.SS1 && card.kind === CARD_KINDS.SPELL)) {
        if (this.state.turnPlayer !== playerIndex) return false;
        if (this.state.phase !== PHASES.MP1 && this.state.phase !== PHASES.MP2) return false;
        if (this.state.chainStack.length > 0) return false;
      }
    }

    if (eff.condition && !this.checkCondition(playerIndex, eff.condition, card)) {
      return false;
    }

    if (!EffectResolver.canExecuteEffectActions(this, playerIndex, card, eff)) {
      return false;
    }

    return true;
  }

  /**
   * ดึงรายการแอคชั่นที่ถูกกฎหมายทั้งหมดที่ผู้เล่น `playerIndex` สามารถทำได้ในขณะนี้
   * ใช้ทั้งสำหรับแสดงแสง Highlight บนการ์ดใน UI และให้ AI Bot ตัดสินใจ
   */
  getLegalActions(playerIndex) {
    const actions = {
      canChainRespond: false,
      chainPrompt: null,
      handActions: {},     // { [instanceId]: [{ type, labelTh, ... }] }
      fieldActions: {},    // { [instanceId]: [{ type, labelTh, ... }] }
      gyActions: {},       // { [instanceId]: [{ type, labelTh, ... }] }
      banishedActions: {}, // { [instanceId]: [{ type, labelTh, ... }] }
      extraActions: {},    // { [instanceId]: [{ type, labelTh, ... }] }
      attackTargets: {},   // { [attackerInstanceId]: { canDirectAttack, targets: [instanceId] } }
      canChangePhase: false
    };

    if (!this.state || this.state.winner !== null) return actions;

    // If waiting on a Chain Prompt for this player
    if (this.state.pendingChainPrompt && this.state.pendingChainPrompt.responderIndex === playerIndex) {
      actions.canChainRespond = true;
      actions.chainPrompt = this.state.pendingChainPrompt;
      return actions;
    }

    // If waiting on the OTHER player's Chain Prompt, this player waits
    if (this.state.pendingChainPrompt) {
      return actions;
    }

    const isTurnPlayer = this.state.turnPlayer === playerIndex;
    const isMainPhase = isTurnPlayer && (this.state.phase === PHASES.MP1 || this.state.phase === PHASES.MP2);
    const isBattlePhase = isTurnPlayer && this.state.phase === PHASES.BP;
    const player = this.state.players[playerIndex];

    if (isTurnPlayer) {
      actions.canChangePhase = true;
    }

    const pushAction = (map, instanceId, item) => {
      if (!map[instanceId]) map[instanceId] = [];
      map[instanceId].push(item);
    };

    // 1. Hand Actions (Main Phase 1/2 + Any phase on own turn for Quick-Play Spells / Quick Effects / Hand Traps)
    if (isTurnPlayer) {
      for (const card of player.hand) {
        if (card.kind === CARD_KINDS.MONSTER) {
          if (isMainPhase) {
            // Normal Summon / Set
            const nsCheck = SummonManager.canNormalSummon(this, playerIndex, card);
            if (nsCheck.canSummon) {
              pushAction(actions.handActions, card.instanceId, {
                type: 'NORMAL_SUMMON',
                position: POSITIONS.ATK,
                tributesRequired: nsCheck.tributesRequired,
                labelTh: nsCheck.tributesRequired > 0
                  ? `อัญเชิญแบบสังเวย ${nsCheck.tributesRequired} ใบ (ตั้งโจมตี)`
                  : 'อัญเชิญปกติ (ตั้งโจมตี)'
              });
              pushAction(actions.handActions, card.instanceId, {
                type: 'NORMAL_SET',
                position: POSITIONS.SET_DEF,
                tributesRequired: nsCheck.tributesRequired,
                labelTh: nsCheck.tributesRequired > 0
                  ? `หมอบแบบสังเวย ${nsCheck.tributesRequired} ใบ (ป้องกัน)`
                  : 'หมอบมอนสเตอร์ (ตั้งป้องกัน)'
              });
            }

            // Inherent Special Summon
            if (SummonManager.canInherentSpecialSummon(this, playerIndex, card)) {
              pushAction(actions.handActions, card.instanceId, {
                type: 'INHERENT_SPECIAL_SUMMON',
                labelTh: card.specialSummonRule?.labelTh || 'อัญเชิญพิเศษจากมือ'
              });
            }

            // Pendulum Scale Activation (leftmost STZ 0 or rightmost STZ 4)
            if ((card.isPendulum || card.frame === 'PENDULUM') && (player.stz[0] === null || player.stz[4] === null)) {
              pushAction(actions.handActions, card.instanceId, {
                type: 'ACTIVATE_PENDULUM',
                isPendulumScale: true,
                labelTh: 'วางในโซนเพนดูลัม (Pendulum Scale)'
              });
            }
          }

          // Hand Ignition (Main Phase) & Quick Effects (Main Phase or Battle Phase)
          for (const eff of card.effects || []) {
            const triggerAllowed =
              eff.trigger === TRIGGERS.QUICK_EFFECT ||
              (isMainPhase && eff.trigger === TRIGGERS.IGNITION);
            if ((eff.zones || []).includes('HAND') && triggerAllowed) {
              if (this.canActivateEffectNow(playerIndex, card, eff, false)) {
                pushAction(actions.handActions, card.instanceId, {
                  type: 'ACTIVATE_EFFECT',
                  effectId: eff.id,
                  labelTh: `ใช้เอฟเฟค: ${eff.labelTh}`
                });
              }
            }
          }
        } else if (card.kind === CARD_KINDS.SPELL) {
          const isQuickPlay = card.subType === SPELL_SUBTYPES.QUICK_PLAY;
          const canPlaceSpell = card.subType === SPELL_SUBTYPES.FIELD || this.getFreeSTZIndex(playerIndex) !== -1;
          if (canPlaceSpell && (isMainPhase || isQuickPlay)) {
            const fallback = this.getCardFallbackActivationEffect(card);
            const spellEffs = [...(card.effects || []), ...(fallback ? [fallback] : [])];
            for (const eff of spellEffs) {
              const isHandSpellTrigger =
                eff.trigger === TRIGGERS.SPELL_ACTIVATE ||
                (isQuickPlay && eff.trigger === TRIGGERS.QUICK_EFFECT && (!eff.zones || eff.zones.includes('HAND')));
              if (isHandSpellTrigger && this.canActivateEffectNow(playerIndex, card, eff, false)) {
                pushAction(actions.handActions, card.instanceId, {
                  type: 'ACTIVATE_EFFECT',
                  effectId: eff.id,
                  isManualFallback: Boolean(eff.isManualFallback),
                  labelTh: `สั่งใช้งาน: ${eff.labelTh}`
                });
              }
            }
          }
          if (isMainPhase && (card.subType === SPELL_SUBTYPES.FIELD || this.getFreeSTZIndex(playerIndex) !== -1)) {
            pushAction(actions.handActions, card.instanceId, {
              type: 'SET_SPELL_TRAP',
              labelTh: card.subType === SPELL_SUBTYPES.FIELD ? 'หมอบการ์ดเวทมนตร์สนาม' : 'หมอบการ์ดเวทมนตร์'
            });
          }
        } else if (card.kind === CARD_KINDS.TRAP) {
          if (card.canActivateFromHandIfEmptyField) {
            const ownCards = this.getPlayerFieldMonsters(playerIndex).length + this.getPlayerFieldSpellsTraps(playerIndex).length;
            if (ownCards === 0 && this.getFreeSTZIndex(playerIndex) !== -1) {
              for (const eff of card.effects || []) {
                if (this.canActivateEffectNow(playerIndex, card, eff, false)) {
                  pushAction(actions.handActions, card.instanceId, {
                    type: 'ACTIVATE_EFFECT',
                    effectId: eff.id,
                    labelTh: `สั่งใช้งานจากมือ: ${eff.labelTh}`
                  });
                }
              }
            }
          }
          if (isMainPhase && this.getFreeSTZIndex(playerIndex) !== -1) {
            pushAction(actions.handActions, card.instanceId, {
              type: 'SET_SPELL_TRAP',
              labelTh: 'หมอบการ์ดกับดัก'
            });
          }
        }
      }

      // 2. Field Monster & Spell/Trap Actions
      for (const mon of this.getPlayerFieldMonsters(playerIndex)) {
        if (mon.position !== POSITIONS.SET_DEF && !mon.effectsNegated) {
          for (const eff of mon.effects || []) {
            const triggerAllowed =
              eff.trigger === TRIGGERS.QUICK_EFFECT ||
              (isMainPhase && eff.trigger === TRIGGERS.IGNITION);
            if (triggerAllowed && (!eff.zones || eff.zones.includes(mon.zone))) {
              if (this.canActivateEffectNow(playerIndex, mon, eff, false)) {
                pushAction(actions.fieldActions, mon.instanceId, {
                  type: 'ACTIVATE_EFFECT',
                  effectId: eff.id,
                  labelTh: `ใช้เอฟเฟค: ${eff.labelTh}`
                });
              }
            }
          }
        }
        if (
          isMainPhase &&
          mon.frame !== MONSTER_FRAMES.LINK &&
          mon.summonedTurn < this.state.turnCount &&
          (mon.setTurn || 0) < this.state.turnCount &&
          !mon.positionChangedThisTurn &&
          (mon.attacksUsed || 0) === 0
        ) {
          pushAction(actions.fieldActions, mon.instanceId, {
            type: 'CHANGE_POSITION',
            labelTh: mon.position === POSITIONS.ATK ? 'เปลี่ยนเป็นตั้งป้องกัน (DEF)' : 'เปลี่ยนเป็นตั้งโจมตี (ATK)'
          });
        }
      }

      for (const st of this.getPlayerFieldSpellsTraps(playerIndex)) {
        if (st.position === POSITIONS.SET) {
          const canFlip = st.kind === CARD_KINDS.SPELL
            ? ((st.subType !== SPELL_SUBTYPES.QUICK_PLAY || st.setTurn < this.state.turnCount) && (isMainPhase || st.subType === SPELL_SUBTYPES.QUICK_PLAY))
            : st.setTurn < this.state.turnCount;
          if (canFlip) {
            const fallback = this.getCardFallbackActivationEffect(st);
            const stEffs = [...(st.effects || []), ...(fallback ? [fallback] : [])];
            for (const eff of stEffs) {
              const flipTriggerOk =
                eff.trigger === TRIGGERS.SPELL_ACTIVATE ||
                eff.trigger === TRIGGERS.QUICK_EFFECT ||
                eff.trigger === TRIGGERS.COUNTER_TRAP;
              if (flipTriggerOk && this.canActivateEffectNow(playerIndex, st, eff, false)) {
                pushAction(actions.fieldActions, st.instanceId, {
                  type: 'ACTIVATE_EFFECT',
                  effectId: eff.id,
                  isManualFallback: Boolean(eff.isManualFallback),
                  labelTh: `เปิดใช้งานการ์ดที่หมอบ: ${eff.labelTh}`
                });
              }
            }
          }
        } else {
          for (const eff of st.effects || []) {
            const triggerAllowed =
              eff.trigger === TRIGGERS.QUICK_EFFECT ||
              (isMainPhase && eff.trigger === TRIGGERS.IGNITION);
            if (triggerAllowed &&
                (!eff.zones || eff.zones.includes(st.zone)) &&
                this.canActivateEffectNow(playerIndex, st, eff, false)) {
              pushAction(actions.fieldActions, st.instanceId, {
                type: 'ACTIVATE_EFFECT',
                effectId: eff.id,
                labelTh: `ใช้เอฟเฟคต่อเนื่อง: ${eff.labelTh}`
              });
            }
          }
        }
      }

      // 3. Graveyard & Banished Ignition (MP) & Quick Effects (MP/BP)
      for (const gyCard of player.gy) {
        for (const eff of gyCard.effects || []) {
          const triggerAllowed =
            eff.trigger === TRIGGERS.QUICK_EFFECT ||
            (isMainPhase && eff.trigger === TRIGGERS.IGNITION);
          if (triggerAllowed && (eff.zones || []).includes('GY')) {
            if (this.canActivateEffectNow(playerIndex, gyCard, eff, false)) {
              pushAction(actions.gyActions, gyCard.instanceId, {
                type: 'ACTIVATE_EFFECT',
                effectId: eff.id,
                labelTh: `ใช้เอฟเฟคในสุสาน: ${eff.labelTh}`
              });
            }
          }
        }
      }

      for (const banCard of player.banished) {
        for (const eff of banCard.effects || []) {
          const triggerAllowed =
            eff.trigger === TRIGGERS.QUICK_EFFECT ||
            (isMainPhase && eff.trigger === TRIGGERS.IGNITION);
          if (triggerAllowed && (eff.zones || []).includes('BANISHED')) {
            if (this.canActivateEffectNow(playerIndex, banCard, eff, false)) {
              pushAction(actions.banishedActions, banCard.instanceId, {
                type: 'ACTIVATE_EFFECT',
                effectId: eff.id,
                labelTh: `ใช้เอฟเฟคนอกเกม: ${eff.labelTh}`
              });
            }
          }
        }
      }

      // 4. Extra Deck Summons (Synchro, Xyz, Link) - Main Phase only
      if (isMainPhase) {
        for (const exCard of player.extra) {
          const check = SummonManager.getExtraDeckSummonCombinations(this, playerIndex, exCard);
          if (check.canSummon) {
            const typeLabel =
              exCard.frame === MONSTER_FRAMES.SYNCHRO ? 'อัญเชิญซิงโคร (Synchro Summon)' :
              exCard.frame === MONSTER_FRAMES.XYZ ? 'อัญเชิญเอ็กシーズ (Xyz Summon)' :
              'อัญเชิญลิงก์ (Link Summon)';
            pushAction(actions.extraActions, exCard.instanceId, {
              type: 'EXTRA_DECK_SUMMON',
              frame: exCard.frame,
              combinationsCount: check.validCombinations.length,
              labelTh: `${typeLabel}: ${exCard.nameTh}`
            });
          }
        }
      }
    }

    // 5. Battle Phase Attack Declarations
    if (isBattlePhase && this.state.turnCount > 1) {
      const oppMonsters = this.getPlayerFieldMonsters(1 - playerIndex);
      for (const mon of this.getPlayerFieldMonsters(playerIndex)) {
        if (mon.position === POSITIONS.ATK && mon.attacksUsed < (mon.maxAttacks || 1)) {
          actions.attackTargets[mon.instanceId] = {
            canDirectAttack: oppMonsters.length === 0 || Boolean(mon.canAttackDirectly),
            targets: oppMonsters.map(m => m.instanceId)
          };
        }
      }
    }

    return actions;
  }

  /**
   * ดำเนินการตามคำสั่งของผู้เล่น (Main Entry Point สำหรับทุก Action)
   */
  executeAction(playerIndex, payload) {
    if (this.state.winner !== null) {
      return { ok: false, errorTh: 'การดูเอลจบลงแล้ว' };
    }

    const { type } = payload;

    if (type === 'SET_CHAIN_MODE') {
      this.state.players[playerIndex].chainMode = payload.mode || CHAIN_MODE.AUTO;
      return { ok: true };
    }

    if (type === 'SURRENDER') {
      if (playerIndex !== 0 && playerIndex !== 1) {
        return { ok: false, errorTh: 'รหัสผู้เล่นไม่ถูกต้อง' };
      }
      this.state.pendingChainPrompt = null;
      this.state.chainStack = [];
      this.state.winner = 1 - playerIndex;
      this.state.winReason = 'surrender';
      resetLingeringTracker(this._lingeringTracker);
      this.state.lingeringEffects = [];
      this.state.winReasonTh = `${this.state.players[playerIndex].name} ขอยอมแพ้ (Surrender)`;
      this.log(`🏳️ ${this.state.winReasonTh}`);
      return { ok: true };
    }

    if (type === 'CHAIN_RESPONSE') {
      return this.handleChainResponse(playerIndex, payload);
    }

    if (this.state.pendingChainPrompt) {
      return { ok: false, errorTh: 'กำลังรอการตอบสนอง Chain จากผู้เล่น' };
    }

    if (this.state.turnPlayer !== playerIndex) {
      return { ok: false, errorTh: 'ไม่ใช่เทิร์นของคุณ' };
    }

    switch (type) {
      case 'NORMAL_SUMMON':
      case 'NORMAL_SET':
        return this.handleNormalSummon(playerIndex, payload);

      case 'INHERENT_SPECIAL_SUMMON':
        return this.handleInherentSpecialSummon(playerIndex, payload);

      case 'EXTRA_DECK_SUMMON':
        return this.handleExtraDeckSummon(playerIndex, payload);

      case 'SET_SPELL_TRAP':
        return this.handleSetSpellTrap(playerIndex, payload);

      case 'ACTIVATE_PENDULUM':
        return this.handleActivatePendulum(playerIndex, payload);

      case 'ACTIVATE_EFFECT':
        return this.handleActivateEffect(playerIndex, payload);

      case 'CHANGE_POSITION':
        return this.handleChangePosition(playerIndex, payload);

      case 'DECLARE_ATTACK':
        return this.handleDeclareAttack(playerIndex, payload);

      case 'CHANGE_PHASE':
        return this.handleChangePhase(playerIndex, payload);

      default:
        return { ok: false, errorTh: `ไม่รู้จักคำสั่ง: ${type}` };
    }
  }

  /**
   * อัญเชิญปกติ หรือ หมอบมอนสเตอร์ (รวมการสังเวยสำหรับ Lv.5+)
   */
  handleNormalSummon(playerIndex, payload) {
    const player = this.state.players[playerIndex];
    const card = player.hand.find(c => c.instanceId === payload.instanceId);
    if (!card) return { ok: false, errorTh: 'ไม่พบการ์ดในมือ' };

    const check = SummonManager.canNormalSummon(this, playerIndex, card);
    if (!check.canSummon) return { ok: false, errorTh: check.reasonTh };

    // Rulebook v10: Cannot Normal Summon in face-up Defense Position
    if (payload.type === 'NORMAL_SUMMON' && (payload.position === POSITIONS.DEF || payload.position === POSITIONS.SET_DEF)) {
      return { ok: false, errorTh: 'ไม่สามารถอัญเชิญปกติในสภาพตั้งป้องกันได้ (ต้องตั้งโจมตี หรือหมอบตั้งป้องกัน)' };
    }

    if (check.tributesRequired > 0) {
      const fieldMons = SummonManager.getAllFieldMonsters(player);
      const mmzInitiallyFull = this.getFreeMMZIndex(playerIndex) === -1;
      let tributes = [];
      if (Array.isArray(payload.tributeInstanceIds) && payload.tributeInstanceIds.length === check.tributesRequired) {
        const uniqueIds = new Set(payload.tributeInstanceIds);
        tributes = fieldMons.filter(m => uniqueIds.has(m.instanceId));
        if (tributes.length !== check.tributesRequired) {
          return { ok: false, errorTh: `ต้องเลือกมอนสเตอร์บนสนามที่ถูกต้องครบ ${check.tributesRequired} ใบเพื่อสังเวย` };
        }
      } else {
        // Auto-select lowest ATK monsters as tribute (prefer MMZ first if MMZ is full)
        tributes = [...fieldMons]
          .sort((a, b) => {
            if (mmzInitiallyFull && a.zone !== b.zone) {
              return a.zone === 'MMZ' ? -1 : 1;
            }
            return (a.currentAtk ?? 0) - (b.currentAtk ?? 0);
          })
          .slice(0, check.tributesRequired);
      }
      if (mmzInitiallyFull && !tributes.some(t => t.zone === 'MMZ')) {
        return { ok: false, errorTh: 'ต้องสังเวยมอนสเตอร์ใน Main Monster Zone อย่างน้อย 1 ใบเพื่อเปิดช่องว่าง' };
      }
      for (const trib of tributes) {
        this.moveCardToZone(playerIndex, trib.instanceId, 'GY', { reason: 'TRIBUTE' });
      }
      this.log(`🕯️ ${player.name} สังเวย ${tributes.map(t => `"${t.nameTh}"`).join(', ')}`);
    }

    this.removeFromCurrentZone(card.instanceId);
    const slot = this.getFreeMMZIndex(playerIndex, payload.targetZoneIndex ?? null);
    player.mmz[slot] = card;
    card.zone = 'MMZ';
    card.zoneIndex = slot;
    card.controller = playerIndex;
    card.position = payload.type === 'NORMAL_SET' ? POSITIONS.SET_DEF : POSITIONS.ATK;
    card.summonedTurn = this.state.turnCount;
    if (payload.type === 'NORMAL_SET') {
      card.setTurn = this.state.turnCount;
    }
    card.attacksUsed = 0;
    card.positionChangedThisTurn = false;
    player.normalSummonUsed = true;

    if (payload.type === 'NORMAL_SET') {
      this.log(`🛡️ ${player.name} หมอบมอนสเตอร์ 1 ใบในโซนมอนสเตอร์`);
    } else {
      player.summonsThisTurn = (player.summonsThisTurn || 0) + 1;
      this.log(`🌟 ${player.name} อัญเชิญปกติ "${card.nameTh}" (${card.currentAtk} ATK)!`);
      this.queueTriggerEffects(playerIndex, card, TRIGGERS.ON_NORMAL_SUMMON);
      this.queueTriggerEffects(playerIndex, card, TRIGGERS.ON_SUMMON_ANY);
      this._pendingSummonForResponse = { summonerIndex: playerIndex, card };
    }

    const trigRes = this.flushTriggerQueue();
    return { ok: true, pendingChain: trigRes.pendingChain };
  }

  /**
   * อัญเชิญพิเศษจากมือตามเงื่อนไขของการ์ด (`specialSummonRule`)
   */
  handleInherentSpecialSummon(playerIndex, payload) {
    const player = this.state.players[playerIndex];
    const card = player.hand.find(c => c.instanceId === payload.instanceId);
    if (!card) return { ok: false, errorTh: 'ไม่พบการ์ดในมือ' };

    if (!SummonManager.canInherentSpecialSummon(this, playerIndex, card)) {
      return { ok: false, errorTh: 'ยังไม่ผ่านเงื่อนไขการอัญเชิญพิเศษของการ์ดใบนี้' };
    }

    const rule = card.specialSummonRule;
    if (rule.opt) player.optUsed.push(rule.opt);
    if (rule.cost?.discardHandCount) {
      const otherHand = player.hand.filter(c => c.instanceId !== card.instanceId);
      const discarded = payload.discardInstanceId
        ? otherHand.find(c => c.instanceId === payload.discardInstanceId)
        : otherHand[0];
      if (discarded) {
        this.moveCardToZone(playerIndex, discarded.instanceId, 'GY', { reason: 'COST' });
        this.log(`💨 ${player.name} ทิ้ง "${discarded.nameTh}" จากมือเป็นเงื่อนไขอัญเชิญพิเศษ`);
      }
    }

    this.specialSummonCard(playerIndex, card, POSITIONS.ATK, 'HAND', payload.targetZoneIndex ?? null);
    const trigRes = this.flushTriggerQueue();
    return { ok: true, pendingChain: trigRes.pendingChain };
  }

  /**
   * อัญเชิญมอนสเตอร์จาก Extra Deck (Synchro, Xyz, Link)
   */
  handleExtraDeckSummon(playerIndex, payload) {
    const player = this.state.players[playerIndex];
    const exCard = player.extra.find(c => c.instanceId === payload.instanceId);
    if (!exCard) return { ok: false, errorTh: 'ไม่พบการ์ดใน Extra Deck' };

    const check = SummonManager.getExtraDeckSummonCombinations(this, playerIndex, exCard);
    if (!check.canSummon || check.validCombinations.length === 0) {
      return { ok: false, errorTh: 'วัตถุดิบบนสนามไม่ตรงตามเงื่อนไขการอัญเชิญ' };
    }

    const materials = check.validCombinations[payload.combinationIndex || 0] || check.validCombinations[0];

    if (exCard.frame === MONSTER_FRAMES.XYZ) {
      const altRule = exCard.summonMaterials?.altRankUp;
      const isAltRankUp = Boolean(altRule && materials.length === 1 && (exCard.summonMaterials?.count ?? 2) > 1);
      if (isAltRankUp) {
        if (altRule.opt && !player.optUsed.includes(altRule.opt)) {
          player.optUsed.push(altRule.opt);
        }
        if (altRule.applyRestriction) {
          player.turnRestrictions = {
            ...(player.turnRestrictions || {}),
            ...altRule.applyRestriction
          };
        }
      }
      // Attach materials as overlayUnits (including any existing overlayUnits if Xyz Evolution like Zeus!)
      const attached = [];
      for (const mat of materials) {
        const subUnits = Array.isArray(mat.overlayUnits) ? mat.overlayUnits.splice(0, mat.overlayUnits.length) : [];
        this.removeFromCurrentZone(mat.instanceId);
        mat.zone = 'OVERLAY';
        attached.push(mat, ...subUnits);
      }
      exCard.overlayUnits = attached;
      exCard.properlySummoned = true;
      this.log(`🌌 ${player.name} โอเวอร์เลย์ ${materials.map(m => `"${m.nameTh}"`).join(' + ')} เพื่ออัญเชิญเอ็กシーズ "${exCard.nameTh}"!`);
      this.specialSummonCard(playerIndex, exCard, POSITIONS.ATK, 'EXTRA', payload.targetZoneIndex ?? null);
    } else if (exCard.frame === MONSTER_FRAMES.SYNCHRO) {
      for (const mat of materials) {
        this.moveCardToZone(playerIndex, mat.instanceId, 'GY', { reason: 'SYNCHRO_MATERIAL' });
      }
      exCard.properlySummoned = true;
      this.log(`⚡ ${player.name} ซิงโครซัมมอน "${exCard.nameTh}" (ใช้วัตถุดิบ: ${materials.map(m => m.nameTh).join(' + ')})!`);
      this.specialSummonCard(playerIndex, exCard, POSITIONS.ATK, 'EXTRA', payload.targetZoneIndex ?? null);
    } else if (exCard.frame === MONSTER_FRAMES.LINK) {
      for (const mat of materials) {
        this.moveCardToZone(playerIndex, mat.instanceId, 'GY', { reason: 'LINK_MATERIAL' });
      }
      exCard.properlySummoned = true;
      this.log(`🔗 ${player.name} ลิงก์ซัมมอน "${exCard.nameTh}" (Link-${exCard.linkRating})!`);
      this.specialSummonCard(playerIndex, exCard, POSITIONS.ATK, 'EXTRA', payload.targetZoneIndex ?? null);
    }

    const trigRes = this.flushTriggerQueue();
    return { ok: true, pendingChain: trigRes.pendingChain };
  }

  /**
   * หมอบการ์ดเวทมนตร์หรือกับดักลงบนสนาม (รองรับการหมอบเวทสนามใน Field Zone ตามกฎ Rulebook v10)
   */
  handleSetSpellTrap(playerIndex, payload) {
    if (this.state.phase !== PHASES.MP1 && this.state.phase !== PHASES.MP2) {
      return { ok: false, errorTh: 'หมอบการ์ดเวทมนตร์/กับดักได้เฉพาะใน Main Phase เท่านั้น' };
    }
    const player = this.state.players[playerIndex];
    const card = player.hand.find(c => c.instanceId === payload.instanceId);
    if (!card) return { ok: false, errorTh: 'ไม่พบการ์ดในมือ' };
    if (card.kind !== CARD_KINDS.SPELL && card.kind !== CARD_KINDS.TRAP) {
      return { ok: false, errorTh: 'การ์ดใบนี้ไม่ใช่เวทมนตร์หรือกับดัก' };
    }

    if (card.kind === CARD_KINDS.SPELL && card.subType === SPELL_SUBTYPES.FIELD) {
      if (player.fieldSpell) {
        this.moveCardToZone(playerIndex, player.fieldSpell.instanceId, 'GY', { reason: 'REPLACE_FIELD' });
      }
      this.removeFromCurrentZone(card.instanceId);
      player.fieldSpell = card;
      card.zone = 'FIELD';
      card.zoneIndex = 0;
      card.position = POSITIONS.SET;
      card.setTurn = this.state.turnCount;
      this.log(`🂠 ${player.name} หมอบการ์ดเวทมนตร์สนาม 1 ใบใน Field Zone`);
      return { ok: true };
    }

    const slot = this.getFreeSTZIndex(playerIndex, payload.targetZoneIndex ?? null);
    if (slot === -1) return { ok: false, errorTh: 'โซนเวทมนตร์/กับดักเต็มแล้ว' };

    this.removeFromCurrentZone(card.instanceId);
    player.stz[slot] = card;
    card.zone = 'STZ';
    card.zoneIndex = slot;
    card.position = POSITIONS.SET;
    card.setTurn = this.state.turnCount;

    this.log(`🂠 ${player.name} หมอบการ์ด 1 ใบในโซนเวทมนตร์/กับดัก`);
    return { ok: true };
  }

  /**
   * วางมอนสเตอร์เพนดูลัมเป็นเวทมนตร์ในโซนเพนดูลัม (STZ ซ้ายสุด 0 หรือ ขวาสุด 4)
   */
  handleActivatePendulum(playerIndex, payload) {
    if (this.state.phase !== PHASES.MP1 && this.state.phase !== PHASES.MP2) {
      return { ok: false, errorTh: 'วาง Pendulum Scale ได้เฉพาะใน Main Phase เท่านั้น' };
    }
    const player = this.state.players[playerIndex];
    const card = player.hand.find(c => c.instanceId === payload.instanceId);
    if (!card || !(card.isPendulum || card.frame === 'PENDULUM')) {
      return { ok: false, errorTh: 'การ์ดใบนี้ไม่ใช่มอนสเตอร์เพนดูลัมในมือ' };
    }
    const preferred = payload.targetZoneIndex;
    let slot = -1;
    if ((preferred === 0 || preferred === 4) && player.stz[preferred] === null) {
      slot = preferred;
    } else if (player.stz[0] === null) {
      slot = 0;
    } else if (player.stz[4] === null) {
      slot = 4;
    }
    if (slot === -1) {
      return { ok: false, errorTh: 'โซนเพนดูลัม (ช่องซ้ายสุดและขวาสุดของ STZ) เต็มแล้ว' };
    }

    this.removeFromCurrentZone(card.instanceId);
    player.stz[slot] = card;
    card.zone = 'STZ';
    card.zoneIndex = slot;
    card.controller = playerIndex;
    card.position = POSITIONS.FACE_UP;
    this.log(`🔷 ${player.name} วาง "${card.nameTh}" ในโซนเพนดูลัม (STZ ช่องที่ ${slot + 1})`);
    return { ok: true };
  }

  /**
   * สั่งใช้งานการ์ดเวทมนตร์/กับดัก หรือเอฟเฟคมอนสเตอร์ (เริ่มต้น Chain Link 1)
   */
  handleActivateEffect(playerIndex, payload) {
    const loc = this.findCardInstance(payload.instanceId);
    if (!loc) return { ok: false, errorTh: 'ไม่พบการ์ดที่เลือก' };

    const { card, zone } = loc;
    const player = this.state.players[playerIndex];
    const eff = this.resolveCardEffect(card, payload.effectId);
    if (!eff) return { ok: false, errorTh: 'ไม่พบเอฟเฟคของการ์ดใบนี้' };

    if (!this.canActivateEffectNow(playerIndex, card, eff, false)) {
      return { ok: false, errorTh: 'ยังไม่สามารถสั่งใช้งานเอฟเฟคนี้ได้ในขณะนี้' };
    }

    // If activating a Spell/Trap from hand or flipping a Set Spell/Trap face-up
    if (card.kind === CARD_KINDS.SPELL || card.kind === CARD_KINDS.TRAP) {
      if (zone === 'HAND') {
        if (card.subType === SPELL_SUBTYPES.FIELD) {
          if (player.fieldSpell) {
            this.moveCardToZone(playerIndex, player.fieldSpell.instanceId, 'GY', { reason: 'REPLACE_FIELD' });
          }
          this.removeFromCurrentZone(card.instanceId);
          player.fieldSpell = card;
          card.zone = 'FIELD';
          card.position = POSITIONS.FACE_UP;
        } else {
          const slot = this.getFreeSTZIndex(playerIndex, payload.targetZoneIndex ?? null);
          if (slot === -1) return { ok: false, errorTh: 'โซนเวทมนตร์/กับดักเต็มแล้ว' };
          this.removeFromCurrentZone(card.instanceId);
          player.stz[slot] = card;
          card.zone = 'STZ';
          card.zoneIndex = slot;
          card.position = POSITIONS.FACE_UP;
        }
      } else if ((zone === 'STZ' || zone === 'FIELD') && card.position === POSITIONS.SET) {
        card.position = POSITIONS.FACE_UP;
      }

      // Attach Equip Spell to target face-up monster on field
      if (card.kind === CARD_KINDS.SPELL && card.subType === SPELL_SUBTYPES.EQUIP && (card.zone === 'STZ')) {
        const requestedTargetId = payload.choices?.equipTargetInstanceId || payload.targetInstanceId;
        const allFaceUpMons = [
          ...this.getPlayerFieldMonsters(playerIndex),
          ...this.getPlayerFieldMonsters(1 - playerIndex)
        ].filter(m => m.position !== POSITIONS.SET_DEF);
        const eqTarget = (requestedTargetId && allFaceUpMons.find(m => m.instanceId === requestedTargetId)) || allFaceUpMons[0] || null;
        if (eqTarget) {
          card.equippedTo = eqTarget.instanceId;
          card.equipTargetInstanceId = eqTarget.instanceId;
        }
      }
    }

    if (eff.opt) player.optUsed.push(eff.opt);

    // Pay Costs immediately at activation
    EffectResolver.payEffectCost(this, playerIndex, card, eff, payload.choices || {});

    const chainLinkNumber = this.state.chainStack.length + 1;
    const effSpeed = this.getEffectiveSpellSpeed(card, eff);
    this.state.chainStack.push({
      chainLink: chainLinkNumber,
      playerIndex,
      card,
      effect: eff,
      spellSpeed: effSpeed,
      choices: payload.choices || {},
      negated: false
    });

    this.log(`⛓️ [Chain Link ${chainLinkNumber}] ${player.name} สั่งใช้งาน "${card.nameTh}" (${eff.labelTh})`);

    // Check if the opponent has any Spell Speed 2+ response (Master Duel Chain Window!)
    const oppIndex = 1 - playerIndex;
    const oppRespondable = eff.cannotRespond ? [] : this.getChainableEffectsForPlayer(oppIndex);
    if (oppRespondable.length > 0) {
      this.state.pendingChainPrompt = {
        responderIndex: oppIndex,
        triggerPlayerIndex: playerIndex,
        triggerCardNameTh: card.nameTh,
        triggerEffectLabelTh: eff.labelTh,
        chainLinkNumber: chainLinkNumber + 1,
        respondableCards: oppRespondable
      };
      return { ok: true, pendingChain: true };
    }

    // No opponent chain response -> resolve the chain stack now!
    this.resolveFullChain();
    return { ok: true };
  }

  /**
   * จัดการเมื่อผู้เล่นตอบสนองต่อหน้าต่างถาม Chain (กดเชนต่อ หรือ กดผ่าน Pass)
   */
  handleChainResponse(playerIndex, payload) {
    const prompt = this.state.pendingChainPrompt;
    if (!prompt || prompt.responderIndex !== playerIndex) {
      return { ok: false, errorTh: 'ไม่มีหน้าต่างถามเชนสำหรับคุณในขณะนี้' };
    }

    // Player chose to PASS (ไม่เชน)
    if (!payload.respond) {
      this.state.pendingChainPrompt = null;
      if (this.state.chainStack.length > 0) {
        this.resolveFullChain();
      }
      return { ok: true };
    }

    // Player chose to activate a Quick Effect / Trap / Hand Trap as the next Chain Link!
    const loc = this.findCardInstance(payload.instanceId);
    if (!loc) {
      this.state.pendingChainPrompt = null;
      if (this.state.chainStack.length > 0) {
        this.resolveFullChain();
      }
      return { ok: false, errorTh: 'ไม่พบการ์ดที่จะใช้เชน' };
    }

    const { card, zone } = loc;
    const player = this.state.players[playerIndex];
    const eff = this.resolveCardEffect(card, payload.effectId);
    if (!eff) {
      this.state.pendingChainPrompt = null;
      if (this.state.chainStack.length > 0) {
        this.resolveFullChain();
      }
      return { ok: false, errorTh: 'ไม่พบเอฟเฟคของการ์ดใบนี้' };
    }

    // Rulebook v10: Validate Spell Speed & chainability (SS2 vs SS1/SS2, SS3 only vs SS3, no response to cannotRespond)
    const topChain = this.state.chainStack[this.state.chainStack.length - 1];
    if (topChain?.effect?.cannotRespond) {
      return { ok: false, errorTh: 'ไม่สามารถเชนตอบโต้เอฟเฟคนี้ได้' };
    }
    const minSpellSpeed = topChain ? Math.max(SPELL_SPEED.SS2, topChain.spellSpeed || SPELL_SPEED.SS1) : SPELL_SPEED.SS2;
    const effSpeed = this.getEffectiveSpellSpeed(card, eff);
    if (effSpeed < minSpellSpeed) {
      return { ok: false, errorTh: `Spell Speed ไม่เพียงพอ (ต้องใช้ Spell Speed ${minSpellSpeed} ขึ้นไป)` };
    }
    if (!this.canActivateEffectNow(playerIndex, card, eff, true, minSpellSpeed)) {
      return { ok: false, errorTh: 'ไม่สามารถเชนตอบโต้ด้วยการ์ดใบนี้ได้ในขณะนี้' };
    }

    if (card.kind === CARD_KINDS.SPELL || card.kind === CARD_KINDS.TRAP) {
      if (zone === 'HAND') {
        const slot = this.getFreeSTZIndex(playerIndex);
        if (slot !== -1) {
          this.removeFromCurrentZone(card.instanceId);
          player.stz[slot] = card;
          card.zone = 'STZ';
          card.zoneIndex = slot;
          card.position = POSITIONS.FACE_UP;
        }
      } else if (zone === 'STZ' && card.position === POSITIONS.SET) {
        card.position = POSITIONS.FACE_UP;
      }
    }

    if (eff.opt) player.optUsed.push(eff.opt);
    EffectResolver.payEffectCost(this, playerIndex, card, eff, payload.choices || {});

    const chainLinkNumber = this.state.chainStack.length + 1;
    this.state.chainStack.push({
      chainLink: chainLinkNumber,
      playerIndex,
      card,
      effect: eff,
      spellSpeed: effSpeed,
      choices: payload.choices || {},
      negated: false
    });

    this.log(`⚡ [Chain Link ${chainLinkNumber}] ${player.name} เชนตอบโต้ด้วย "${card.nameTh}" (${eff.labelTh})!`);
    this.state.pendingChainPrompt = null;

    // Check if the other player can counter-chain!
    const otherIndex = 1 - playerIndex;
    const otherRespondable = eff.cannotRespond ? [] : this.getChainableEffectsForPlayer(otherIndex);
    if (otherRespondable.length > 0 && this.state.chainStack.length < 6) {
      this.state.pendingChainPrompt = {
        responderIndex: otherIndex,
        triggerPlayerIndex: playerIndex,
        triggerCardNameTh: card.nameTh,
        triggerEffectLabelTh: eff.labelTh,
        chainLinkNumber: chainLinkNumber + 1,
        respondableCards: otherRespondable
      };
      return { ok: true, pendingChain: true };
    }

    this.resolveFullChain();
    return { ok: true };
  }

  /**
   * คลี่คลาย Chain Stack ตามลำดับ LIFO (Chain Link สุดท้ายทำงานก่อน -> ย้อนกลับมาจนถึง Chain Link 1)
   */
  resolveFullChain() {
    this.isResolvingChain = true;
    try {
      while (this.state.chainStack.length > 0) {
        const item = this.state.chainStack.pop();
        this.log(`🔄 คลี่คลาย [Chain Link ${item.chainLink}]: "${item.card.nameTh}"`);
        EffectResolver.resolveChainItem(this, item);

        // Send non-continuous Spells/Traps (or negated initial Spell/Trap activations) on field to GY after resolving
        const { card, playerIndex } = item;
        if ((card.kind === CARD_KINDS.SPELL || card.kind === CARD_KINDS.TRAP) && (card.zone === 'STZ' || card.zone === 'FIELD')) {
          const isInitialActivationNegated = Boolean(item.negated && item.effect?.trigger === TRIGGERS.SPELL_ACTIVATE);
          const staysOnField =
            !isInitialActivationNegated && (
              card.subType === SPELL_SUBTYPES.CONTINUOUS ||
              card.subType === SPELL_SUBTYPES.EQUIP ||
              card.subType === SPELL_SUBTYPES.FIELD ||
              card.subType === TRAP_SUBTYPES.CONTINUOUS
            );

          if (!staysOnField) {
            this.moveCardToZone(playerIndex, card.instanceId, 'GY', { reason: 'RESOLVED_SPELL_TRAP' });
          }
        }

        if (this.state.winner !== null) {
          this.state.chainStack = [];
          this.triggerQueue = [];
          break;
        }
      }
    } finally {
      this.isResolvingChain = false;
    }

    // SEGOC: Any trigger effects met during the chain resolution now form a new Chain!
    if (this.state.winner === null) {
      if (this.triggerQueue.length > 0) {
        this.flushTriggerQueue();
      } else if (this._pendingSummonForResponse) {
        this.checkPostSummonResponseWindow();
      }
    }
  }

  /**
   * เปลี่ยนรูปแบบการวางของมอนสเตอร์บนสนาม (ATK <-> DEF)
   */
  handleChangePosition(playerIndex, payload) {
    if (this.state.phase !== PHASES.MP1 && this.state.phase !== PHASES.MP2) {
      return { ok: false, errorTh: 'เปลี่ยนรูปแบบมอนสเตอร์ได้เฉพาะใน Main Phase 1 หรือ 2 เท่านั้น' };
    }
    const loc = this.findCardInstance(payload.instanceId);
    if (!loc || loc.playerIndex !== playerIndex || (loc.zone !== 'MMZ' && loc.zone !== 'EMZ')) {
      return { ok: false, errorTh: 'ไม่พบมอนสเตอร์บนสนาม' };
    }
    const { card } = loc;
    if (card.frame === MONSTER_FRAMES.LINK) {
      return { ok: false, errorTh: 'มอนสเตอร์ลิงก์ไม่สามารถตั้งป้องกันได้' };
    }
    if (card.summonedTurn >= this.state.turnCount || (card.setTurn || 0) >= this.state.turnCount || card.positionChangedThisTurn) {
      return { ok: false, errorTh: 'ไม่สามารถเปลี่ยนรูปแบบมอนสเตอร์ที่เพิ่งอัญเชิญ/หมอบ หรือเปลี่ยนไปแล้วในเทิร์นนี้' };
    }
    if ((card.attacksUsed || 0) > 0) {
      return { ok: false, errorTh: 'ไม่สามารถเปลี่ยนรูปแบบมอนสเตอร์ที่ประกาศโจมตีไปแล้วในเทิร์นนี้ (Rulebook v10)' };
    }

    const wasSet = card.position === POSITIONS.SET_DEF;
    if (wasSet && payload.position && payload.position !== POSITIONS.ATK) {
      return { ok: false, errorTh: 'การ Flip Summon ต้องเปิดเป็นหงายหน้าตั้งโจมตี (Face-up ATK) เท่านั้น' };
    }

    card.position = card.position === POSITIONS.ATK ? POSITIONS.DEF : POSITIONS.ATK;
    card.positionChangedThisTurn = true;

    this.log(`🔄 "${card.nameTh}" เปลี่ยนเป็นรูปแบบ ${card.position === POSITIONS.ATK ? 'ตั้งโจมตี (ATK)' : 'ตั้งป้องกัน (DEF)'}`);
    if (wasSet && card.position === POSITIONS.ATK) {
      const player = this.state.players[playerIndex];
      player.summonsThisTurn = (player.summonsThisTurn || 0) + 1;
      this.queueTriggerEffects(playerIndex, card, TRIGGERS.ON_FLIP);
      this.queueTriggerEffects(playerIndex, card, TRIGGERS.ON_SUMMON_ANY);
      this._pendingSummonForResponse = { summonerIndex: playerIndex, card };
      const trigRes = this.flushTriggerQueue();
      return { ok: true, pendingChain: trigRes.pendingChain };
    }
    return { ok: true };
  }

  /**
   * ประกาศโจมตีใน Battle Phase และคำนวณความเสียหายตามกฎ Master Duel
   */
  handleDeclareAttack(playerIndex, payload) {
    if (this.state.phase !== PHASES.BP) {
      return { ok: false, errorTh: 'สั่งโจมตีได้เฉพาะใน Battle Phase เท่านั้น' };
    }
    if (this.state.turnCount === 1) {
      return { ok: false, errorTh: 'เทิร์นแรกสุดของเกมไม่สามารถสั่งโจมตีได้' };
    }

    const loc = this.findCardInstance(payload.attackerInstanceId);
    if (!loc || loc.playerIndex !== playerIndex) {
      return { ok: false, errorTh: 'ไม่พบมอนสเตอร์ที่สั่งโจมตี' };
    }

    const attacker = loc.card;
    if (attacker.position !== POSITIONS.ATK) {
      return { ok: false, errorTh: 'มอนสเตอร์ต้องอยู่ในรูปแบบตั้งโจมตี (ATK)' };
    }
    if (attacker.attacksUsed >= (attacker.maxAttacks || 1)) {
      return { ok: false, errorTh: 'มอนสเตอร์ใบนี้โจมตีครบจำนวนครั้งในเทิร์นนี้แล้ว' };
    }

    const player = this.state.players[playerIndex];
    const oppIndex = 1 - playerIndex;
    const opponent = this.state.players[oppIndex];

    // Validate direct attack legality BEFORE consuming attack count or firing ON_ATTACK_DECLARE
    const initialOppMonsters = this.getPlayerFieldMonsters(oppIndex);
    if (payload.directAttack && initialOppMonsters.length > 0 && !attacker.canAttackDirectly) {
      return { ok: false, errorTh: 'อีกฝ่ายยังมีมอนสเตอร์อยู่บนสนาม ไม่สามารถโจมตีผู้เล่นโดยตรงได้' };
    }

    attacker.attacksUsed++;
    if (attacker.frame === MONSTER_FRAMES.XYZ) {
      player.xyzBattledThisTurn = true;
    }

    // Trigger ON_ATTACK_DECLARE effects (e.g. Blue-Eyes Jet Dragon, Sky Striker Hayate, Linkuriboh)
    this.queueTriggerEffects(playerIndex, attacker, TRIGGERS.ON_ATTACK_DECLARE, { immediate: true });
    for (const oppMon of this.getPlayerFieldMonsters(oppIndex)) {
      if (oppMon.position !== POSITIONS.SET_DEF) {
        this.queueTriggerEffects(oppIndex, oppMon, TRIGGERS.ON_ATTACK_DECLARE, { immediate: true });
      }
    }
    if (this.state.winner !== null) return { ok: true };
    if (attacker.zone !== 'MMZ' && attacker.zone !== 'EMZ') {
      this.flushTriggerQueue();
      return { ok: true };
    }

    // Refresh opponent monsters in case ON_ATTACK_DECLARE bounced/destroyed the target
    const remainingOppMonsters = this.getPlayerFieldMonsters(oppIndex);

    // Direct Attack
    if (payload.directAttack || remainingOppMonsters.length === 0) {
      if (remainingOppMonsters.length > 0 && !attacker.canAttackDirectly) {
        return { ok: false, errorTh: 'อีกฝ่ายยังมีมอนสเตอร์อยู่บนสนาม ไม่สามารถโจมตีผู้เล่นโดยตรงได้' };
      }
      const dmg = Math.max(0, attacker.currentAtk ?? attacker.atk ?? 0);
      opponent.lp = Math.max(0, opponent.lp - dmg);
      this.state.lastBattleEvent = {
        seq: ++this.state.battleSeq,
        attackerPlayerIndex: playerIndex,
        attackerInstanceId: attacker.instanceId,
        targetInstanceId: null,
        directAttack: true,
        damage: dmg
      };
      this.log(`⚔️ "${attacker.nameTh}" โจมตีผู้เล่นโดยตรง (Direct Attack)! สร้างความเสียหาย -${dmg} LP (${opponent.name} เหลือ ${opponent.lp} LP)`);
      this.checkWinCondition();
      this.flushTriggerQueue();
      return { ok: true };
    }

    // Attack a Monster
    const target = remainingOppMonsters.find(m => m.instanceId === payload.targetInstanceId) || remainingOppMonsters[0];
    if (!target) return { ok: false, errorTh: 'ไม่พบเป้าหมายการโจมตี' };

    if (target.frame === MONSTER_FRAMES.XYZ) {
      opponent.xyzBattledThisTurn = true;
    }

    const wasTargetFaceDown = target.position === POSITIONS.SET_DEF;
    if (wasTargetFaceDown) {
      target.position = POSITIONS.DEF;
      this.log(`👁️ มอนสเตอร์ที่คว่ำอยู่ถูกเปิดหงายหน้า: "${target.nameTh}" (${target.currentDef} DEF)!`);
    }

    const atkVal = attacker.currentAtk ?? attacker.atk ?? 0;
    let battleDamage = 0;

    if (target.position === POSITIONS.ATK) {
      const defAtkVal = target.currentAtk ?? target.atk ?? 0;
      this.log(`⚔️ "${attacker.nameTh}" (${atkVal} ATK) โจมตี "${target.nameTh}" (${defAtkVal} ATK)!`);

      if (atkVal > defAtkVal) {
        const diff = atkVal - defAtkVal;
        battleDamage = diff;
        opponent.lp = Math.max(0, opponent.lp - diff);
        this.log(`💥 ทำลาย "${target.nameTh}" และสร้างความเสียหาย -${diff} LP แก่ ${opponent.name}!`);
        this.destroyCard(oppIndex, target.instanceId, 'BATTLE');
      } else if (atkVal < defAtkVal) {
        const diff = defAtkVal - atkVal;
        battleDamage = diff;
        player.lp = Math.max(0, player.lp - diff);
        this.log(`💥 "${attacker.nameTh}" ถูกทำลายจากการสวนกลับ! ${player.name} เสีย -${diff} LP`);
        this.destroyCard(playerIndex, attacker.instanceId, 'BATTLE');
      } else {
        if (atkVal > 0) {
          this.log(`💥 พลังโจมตีเท่ากัน (${atkVal} ATK)! มอนสเตอร์ทั้งสองฝ่ายถูกทำลายพร้อมกัน!`);
          this.destroyCard(oppIndex, target.instanceId, 'BATTLE');
          this.destroyCard(playerIndex, attacker.instanceId, 'BATTLE');
        } else {
          this.log(`🛡️ มอนสเตอร์ที่มี 0 ATK ปะทะกัน ไม่มีการ์ดถูกทำลาย`);
        }
      }
    } else {
      // Target is in DEF position
      const defVal = target.currentDef ?? target.def ?? 0;
      this.log(`⚔️ "${attacker.nameTh}" (${atkVal} ATK) โจมตี "${target.nameTh}" (${defVal} DEF)!`);

      if (atkVal > defVal) {
        if (attacker.piercing) {
          const diff = atkVal - defVal;
          battleDamage = diff;
          opponent.lp = Math.max(0, opponent.lp - diff);
          this.log(`💥 ทำลาย "${target.nameTh}" ที่ตั้งป้องกันอยู่ และทะลุเกราะ (Piercing) สร้างความเสียหาย -${diff} LP!`);
        } else {
          this.log(`💥 ทำลาย "${target.nameTh}" ที่ตั้งป้องกันอยู่!`);
        }
        this.destroyCard(oppIndex, target.instanceId, 'BATTLE');
      } else if (atkVal < defVal) {
        const diff = defVal - atkVal;
        battleDamage = diff;
        player.lp = Math.max(0, player.lp - diff);
        this.log(`🛡️ ป้องกันสำเร็จ! ${player.name} ได้รับความเสียหายสะท้อนกลับ -${diff} LP`);
      } else {
        this.log(`🛡️ พลังโจมตีเท่ากับพลังป้องกัน (${defVal}) ไม่มีการ์ดถูกทำลาย`);
      }
    }

    if (wasTargetFaceDown) {
      this.queueTriggerEffects(oppIndex, target, TRIGGERS.ON_FLIP);
    }

    this.state.lastBattleEvent = {
      seq: ++this.state.battleSeq,
      attackerPlayerIndex: playerIndex,
      attackerInstanceId: attacker.instanceId,
      targetInstanceId: target.instanceId,
      directAttack: false,
      damage: battleDamage
    };

    this.checkWinCondition();
    if (this.state.winner === null) {
      this.flushTriggerQueue();
    }
    return { ok: true };
  }

  /**
   * เปลี่ยนเฟสหรือจบเทิร์นตามลำดับ Master Duel
   */
  handleChangePhase(playerIndex, payload = {}) {
    const targetPhase = payload.targetPhase;
    const currentPhase = this.state.phase;

    if (targetPhase === PHASES.BP && currentPhase === PHASES.MP1) {
      if (this.state.turnCount === 1) {
        return { ok: false, errorTh: 'เทิร์นแรกสุดของเกมไม่สามารถเข้าสู่ Battle Phase ได้' };
      }
      this.state.phase = PHASES.BP;
      this.log(`⚔️ เข้าสู่ Battle Phase!`);
      return { ok: true };
    }

    if (targetPhase === PHASES.MP2 && currentPhase === PHASES.BP) {
      this.state.phase = PHASES.MP2;
      this.log(`🔮 เข้าสู่ Main Phase 2`);
      return { ok: true };
    }

    if (targetPhase === PHASES.EP || currentPhase === PHASES.MP2 || (currentPhase === PHASES.MP1 && targetPhase !== PHASES.BP)) {
      this.endTurn();
      return { ok: true };
    }

    // Default sequential advance
    if (currentPhase === PHASES.MP1) {
      if (this.state.turnCount === 1) {
        this.endTurn();
      } else {
        this.state.phase = PHASES.BP;
        this.log(`⚔️ เข้าสู่ Battle Phase!`);
      }
    } else if (currentPhase === PHASES.BP) {
      this.state.phase = PHASES.MP2;
      this.log(`🔮 เข้าสู่ Main Phase 2`);
    } else {
      this.endTurn();
    }

    return { ok: true };
  }

  /**
   * จบเทิร์นปัจจุบัน รีเซ็ตสถานะรายเทิร์น บังคับ Hand Size Limit (6 ใบ) และส่งเทิร์นให้ผู้เล่นอีกฝ่ายพร้อมจั่วการ์ด
   */
  endTurn() {
    this.state.phase = PHASES.EP;
    const currentTurnPlayerIdx = this.state.turnPlayer;
    const currentPlayer = this.state.players[currentTurnPlayerIdx];

    // Trigger ON_END_PHASE effects for current turn player
    for (const mon of this.getPlayerFieldMonsters(currentTurnPlayerIdx)) {
      this.queueTriggerEffects(currentTurnPlayerIdx, mon, TRIGGERS.ON_END_PHASE, { immediate: true });
    }
    for (const st of this.getPlayerFieldSpellsTraps(currentTurnPlayerIdx)) {
      this.queueTriggerEffects(currentTurnPlayerIdx, st, TRIGGERS.ON_END_PHASE, { immediate: true });
    }

    // Master Rule: End Phase Hand Size Limit (6 cards max for turn player)
    while (currentPlayer.hand.length > MAX_HAND_SIZE) {
      const discarded = currentPlayer.hand[currentPlayer.hand.length - 1];
      this.moveCardToZone(currentTurnPlayerIdx, discarded.instanceId, 'GY', { reason: 'HAND_SIZE_LIMIT' });
      this.log(`📏 [Hand Limit 6 ใบ] ${currentPlayer.name} ทิ้ง "${discarded.nameTh}" ลงสุสานช่วงจบเทิร์น`);
    }

    // Flush any triggers without opening chain prompts across turn boundary
    while (this.triggerQueue.length > 0) {
      const item = this.triggerQueue.shift();
      EffectResolver.resolveChainItem(this, {
        playerIndex: item.playerIndex,
        card: item.card,
        effect: item.effect,
        negated: false,
        choices: {}
      });
    }

    // Re-enforce Hand Size Limit (6 cards max) in case an End Phase trigger added cards to hand
    while (currentPlayer.hand.length > MAX_HAND_SIZE) {
      const discarded = currentPlayer.hand[currentPlayer.hand.length - 1];
      this.moveCardToZone(currentTurnPlayerIdx, discarded.instanceId, 'GY', { reason: 'HAND_SIZE_LIMIT' });
      this.log(`📏 [Hand Limit 6 ใบ] ${currentPlayer.name} ทิ้ง "${discarded.nameTh}" ลงสุสานช่วงจบเทิร์น`);
    }

    // Clear temporary turn statuses on both players' monsters
    for (const pIdx of [0, 1]) {
      for (const mon of this.getPlayerFieldMonsters(pIdx)) {
        mon.effectsNegated = false;
        mon.immuneThisTurn = false;
        mon.attacksUsed = 0;
        mon.positionChangedThisTurn = false;
      }
      this.state.players[pIdx].optUsed = [];
      this.state.players[pIdx].normalSummonUsed = false;
      this.state.players[pIdx].summonsThisTurn = 0;
      this.state.players[pIdx].extraDeckSummonsLastTurn = this.state.players[pIdx].extraDeckSummonsThisTurn || 0;
      this.state.players[pIdx].extraDeckSummonsThisTurn = 0;
      this.state.players[pIdx].addedFromDeckToHandThisTurn = false;
      this.state.players[pIdx].xyzBattledThisTurn = false;
      this.state.players[pIdx].turnRestrictions = {};
      this.state.players[pIdx].maxxCActive = false;
    }

    this.state.drollLockActive = false;
    this.state.negatedCardIdsThisTurn = [];
    if (this.state.macroCosmosTurnsRemaining > 0) {
      this.state.macroCosmosTurnsRemaining--;
    }

    // Switch turn
    const nextPlayerIdx = 1 - currentTurnPlayerIdx;
    const nextPlayer = this.state.players[nextPlayerIdx];
    this.state.turnCount++;
    this.state.turnPlayer = nextPlayerIdx;
    advanceLingeringPhase(this._lingeringTracker, {
      turn: this.state.turnCount,
      phase: PHASES.DP,
      turnPlayer: nextPlayerIdx
    });
    this.state.lingeringEffects = toLingeringSnapshot(this._lingeringTracker);

    this.state.phase = PHASES.DP;
    this.log(`🔄 เทิร์นที่ ${this.state.turnCount}: เทิร์นของ ${nextPlayer.name} — Draw Phase!`);
    this.drawCards(nextPlayerIdx, 1, 'DRAW_PHASE');

    if (this.state.winner === null) {
      this.state.phase = PHASES.MP1;
    }
  }

  /**
   * ตรวจสอบเงื่อนไขแพ้-ชนะ (LP เหลือ 0)
   */
  checkWinCondition() {
    const p0 = this.state.players[0];
    const p1 = this.state.players[1];

    if (p0.lp <= 0 && p1.lp <= 0) {
      this.state.winner = 'DRAW';
      this.state.winReasonTh = 'LP ของผู้เล่นทั้งสองฝ่ายเหลือ 0 พร้อมกัน (เสมอกัน)!';
      this.log(`⚖️ ${this.state.winReasonTh}`);
    } else if (p0.lp <= 0) {
      this.state.winner = 1;
      this.state.winReasonTh = `${p1.name} ชนะการดูเอล! (LP ของ ${p0.name} เหลือ 0)`;
      this.log(`🏆 ${this.state.winReasonTh}`);
    } else if (p1.lp <= 0) {
      this.state.winner = 0;
      this.state.winReasonTh = `${p0.name} ชนะการดูเอล! (LP ของ ${p1.name} เหลือ 0)`;
      this.log(`🏆 ${this.state.winReasonTh}`);
    }
  }
}
