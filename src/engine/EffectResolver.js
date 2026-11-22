/**
 * @fileoverview Master Duel Atomic Effect Resolver
 * ตัวประมวลผลเอฟเฟคการ์ดแบบโมดูลาร์ รองรับทั้ง Declarative Atomic Actions และฟังก์ชัน Custom Script
 * ออกแบบเพื่อให้ AI ตัวอื่นสามารถสร้างการ์ดใหม่ได้โดยแค่ประกอบ Action Types เข้าด้วยกัน
 */

import {
  ACTION_TYPES,
  CARD_KINDS,
  MONSTER_FRAMES,
  POSITIONS
} from '../constants/gameConstants.js';
import { matchesCardFilter } from '../cards/schema.js';

export class EffectResolver {
  /**
   * ตรวจสอบว่าการ์ดและเอฟเฟคนี้มีเป้าหมาย/วัตถุดิบเพียงพอที่จะกดสั่งใช้งานได้หรือไม่
   * @param {Object} engine
   * @param {number} playerIndex
   * @param {Object} card
   * @param {Object} effect
   * @returns {boolean}
   */
  static canExecuteEffectActions(engine, playerIndex, card, effect) {
    const player = engine.state.players[playerIndex];
    const opponent = engine.state.players[1 - playerIndex];

    // Check costs first
    if (effect.cost) {
      const discardReq = effect.cost.discardHandCount || effect.cost.discardCount || 0;
      if (discardReq > 0) {
        const otherHand = player.hand.filter(c => c.instanceId !== card.instanceId);
        if (otherHand.length < discardReq) return false;
      }
      if (effect.cost.sendControlledMonsterToGY) {
        const fieldMons = engine.getPlayerFieldMonsters(playerIndex);
        if (fieldMons.length < effect.cost.sendControlledMonsterToGY) return false;
      }
      if (effect.cost.sendHandOrFieldMonsterToGY) {
        const handMons = player.hand.filter(c => c.kind === CARD_KINDS.MONSTER && c.instanceId !== card.instanceId);
        const fieldMons = engine.getPlayerFieldMonsters(playerIndex);
        if (handMons.length + fieldMons.length < 1) return false;
      }
      if (effect.cost.banishFromGYFilter) {
        const gyMatches = player.gy.filter(
          c => c.instanceId !== card.instanceId && matchesCardFilter(c, effect.cost.banishFromGYFilter, card)
        );
        if (gyMatches.length === 0) return false;
      }
      if (effect.cost.payLP) {
        if (player.lp <= effect.cost.payLP) return false;
      }
      if (effect.cost.detachCount) {
        const overlays = card.overlayUnits || [];
        if (overlays.length < effect.cost.detachCount) return false;
      }
    }

    if (!Array.isArray(effect.actions) || effect.actions.length === 0) {
      return true;
    }

    const willFreeMMZ =
      Boolean((effect.cost?.tributeSelf || effect.cost?.sendSelfToGY || effect.cost?.returnSelfToExtra) && card.zone === 'MMZ') ||
      Boolean(effect.cost?.sendControlledMonsterToGY && player.mmz.some(m => m !== null)) ||
      Boolean(effect.cost?.sendHandOrFieldMonsterToGY && player.mmz.some(m => m !== null));

    // Check primary non-optional action requirements
    for (const action of effect.actions) {
      if (action.optional || action.bonusCondition) continue;

      switch (action.type) {
        case ACTION_TYPES.DRAW: {
          if (engine.state.drollLockActive) return false;
          if (player.deck.length < (action.count || 1)) return false;
          break;
        }
        case ACTION_TYPES.SEARCH_DECK: {
          if (engine.state.drollLockActive) return false;
          const matches = player.deck.filter(c => matchesCardFilter(c, action.filter, card));
          if (matches.length === 0) return false;
          break;
        }
        case ACTION_TYPES.EXCAVATE_AND_PICK: {
          if (engine.state.drollLockActive) return false;
          if (player.deck.length === 0) return false;
          break;
        }
        case ACTION_TYPES.SEND_FROM_DECK_TO_GY: {
          const matches = player.deck.filter(c => matchesCardFilter(c, action.filter, card));
          if (matches.length === 0) return false;
          break;
        }
        case ACTION_TYPES.SPECIAL_SUMMON_FROM_HAND: {
          if (player.turnRestrictions?.noSpecialSummon) return false;
          if (engine.getFreeMMZIndex(playerIndex) === -1 && !willFreeMMZ) return false;
          const matches = player.hand.filter(
            c => c.kind === CARD_KINDS.MONSTER &&
                 c.instanceId !== card.instanceId &&
                 matchesCardFilter(c, action.filter, card)
          );
          if (matches.length === 0) return false;
          break;
        }
        case ACTION_TYPES.SPECIAL_SUMMON_FROM_DECK: {
          if (player.turnRestrictions?.noSpecialSummon) return false;
          if (engine.getFreeMMZIndex(playerIndex) === -1 && !willFreeMMZ) return false;
          const matches = player.deck.filter(c => matchesCardFilter(c, action.filter, card));
          if (matches.length === 0) return false;
          break;
        }
        case ACTION_TYPES.SPECIAL_SUMMON_FROM_GY: {
          if (player.turnRestrictions?.noSpecialSummon) return false;
          if (engine.getFreeMMZIndex(playerIndex) === -1 && !willFreeMMZ) return false;
          const targetPool = action.targetOwner === 'OPPONENT'
            ? opponent.gy
            : action.targetOwner === 'SELF'
              ? player.gy
              : [...player.gy, ...opponent.gy];
          const matches = targetPool.filter(c => matchesCardFilter(c, action.filter, card));
          if (matches.length === 0) return false;
          break;
        }
        case ACTION_TYPES.SPECIAL_SUMMON_FROM_EXTRA: {
          if (player.turnRestrictions?.noSpecialSummon || player.turnRestrictions?.noExtraDeckSummon) return false;
          const matches = player.extra.filter(c => matchesCardFilter(c, action.filter, card));
          if (matches.length === 0) return false;
          break;
        }
        case ACTION_TYPES.SPECIAL_SUMMON_SELF_FROM_HAND:
        case ACTION_TYPES.SPECIAL_SUMMON_SELF_FROM_GY: {
          if (player.turnRestrictions?.noSpecialSummon) return false;
          if (engine.getFreeMMZIndex(playerIndex) === -1 && !action.tributeAllFieldMonsters && !willFreeMMZ) return false;
          break;
        }
        case ACTION_TYPES.SPAWN_TOKEN: {
          if (player.turnRestrictions?.noSpecialSummon) return false;
          if (engine.getFreeMMZIndex(playerIndex) === -1 && !willFreeMMZ) return false;
          break;
        }
        case ACTION_TYPES.RECOVER_FROM_GY_TO_HAND: {
          const matches = player.gy.filter(c => matchesCardFilter(c, action.filter, card));
          if (matches.length === 0) return false;
          break;
        }
        case ACTION_TYPES.SET_FROM_DECK_OR_GY: {
          if (engine.getFreeSTZIndex(playerIndex) === -1) return false;
          const sourceZone = action.sourceZone || action.source;
          const pool = sourceZone === 'GY'
            ? player.gy
            : sourceZone === 'DECK'
              ? player.deck
              : [...player.deck, ...player.gy];
          const matches = pool.filter(c => matchesCardFilter(c, action.filter, card));
          if (matches.length === 0) return false;
          break;
        }
        case ACTION_TYPES.FUSION_SUMMON: {
          if (player.turnRestrictions?.noSpecialSummon || player.turnRestrictions?.noExtraDeckSummon) return false;
          if (player.turnRestrictions?.extraDeckFramesAllowed &&
              !player.turnRestrictions.extraDeckFramesAllowed.includes(MONSTER_FRAMES.FUSION)) {
            return false;
          }
          const fusionCandidates = player.extra.filter(
            c => c.frame === MONSTER_FRAMES.FUSION && matchesCardFilter(c, action.fusionFilter, card)
          );
          if (fusionCandidates.length === 0) return false;
          const matPool = EffectResolver.getFusionMaterialPool(engine, playerIndex, action, card);
          if (matPool.length < 2) return false;
          break;
        }
        case ACTION_TYPES.DESTROY_CARDS: {
          if (action.targetChainSource) {
            if (engine.state.chainStack.length === 0) return false;
            break;
          }
          const targets = EffectResolver.getFieldTargets(engine, playerIndex, action, card);
          if (targets.length === 0) return false;
          break;
        }
        case ACTION_TYPES.SEND_TO_GY: {
          const targets = EffectResolver.getFieldTargets(engine, playerIndex, action, card);
          if (targets.length === 0) return false;
          break;
        }
        case ACTION_TYPES.BANISH_CARDS: {
          const targets = EffectResolver.getBanishTargets(engine, playerIndex, action, card);
          if (targets.length === 0) return false;
          break;
        }
        case ACTION_TYPES.RETURN_TO_HAND: {
          const targets = EffectResolver.getFieldTargets(engine, playerIndex, action, card);
          if (targets.length === 0) return false;
          break;
        }
        case ACTION_TYPES.NEGATE_FACEUP_EFFECT: {
          const oppMonsters = engine.getPlayerFieldMonsters(1 - playerIndex).filter(
            m => m.position !== POSITIONS.SET_DEF && !m.effectsNegated && !m.immuneThisTurn
          );
          if (oppMonsters.length === 0) return false;
          break;
        }
        case ACTION_TYPES.NEGATE_ACTIVATION: {
          if (!action.optionalIfNoChain && engine.state.chainStack.length === 0) {
            return false;
          }
          break;
        }
      }
    }

    return true;
  }

  /**
   * รวบรวมวัตถุดิบที่สามารถใช้ฟิวชั่นได้ตามเงื่อนไขของ Action
   */
  static getFusionMaterialPool(engine, playerIndex, action, sourceCard) {
    const player = engine.state.players[playerIndex];
    const pool = [];
    if (!action.fieldOnlyMaterials) {
      pool.push(
        ...player.hand.filter(c => c.kind === CARD_KINDS.MONSTER && (!sourceCard || c.instanceId !== sourceCard.instanceId))
      );
    }
    pool.push(...engine.getPlayerFieldMonsters(playerIndex));
    if (action.allowOpponentFieldMaterials) {
      pool.push(
        ...engine.getPlayerFieldMonsters(1 - playerIndex).filter(
          m => m.position !== POSITIONS.SET_DEF && !m.immuneThisTurn
        )
      );
    }
    if (action.allowGYMaterials) {
      pool.push(...player.gy.filter(c => c.kind === CARD_KINDS.MONSTER));
    }
    if (action.allowDeckMaterials) {
      pool.push(...player.deck.filter(c => c.kind === CARD_KINDS.MONSTER));
    }
    return pool;
  }

  /**
   * รวบรวมเป้าหมายบนสนามตามที่ Action ระบุ
   */
  static getFieldTargets(engine, playerIndex, action, sourceCard) {
    const targetOwnerIdx = action.targetOwner === 'SELF' ? playerIndex : 1 - playerIndex;
    const zoneType = action.targetZone || 'ANY_FIELD';
    const list = [];

    if (zoneType === 'MONSTER' || zoneType === 'ANY_FIELD') {
      list.push(...engine.getPlayerFieldMonsters(targetOwnerIdx));
    }
    if (zoneType === 'SPELL_TRAP' || zoneType === 'ANY_FIELD') {
      list.push(...engine.getPlayerFieldSpellsTraps(targetOwnerIdx));
    }

    return list.filter(c => {
      if (targetOwnerIdx !== playerIndex && c.immuneThisTurn) return false;
      return matchesCardFilter(c, action.filter, sourceCard);
    });
  }

  /**
   * คำนวณรายการตัวเลือกการ์ด (Cost / Target / Search / Summon / Fusion) สำหรับให้ผู้เล่นเลือกใน UI Modal
   * จะคืนค่าเฉพาะขั้นตอนที่มีตัวเลือกมากกว่า 1 ใบ เพื่อให้ไม่ต้องกดป๊อปอัปซ้ำซ้อนเมื่อมีตัวเลือกเดียว
   */
  static getChoiceRequirements(engine, playerIndex, card, effect) {
    if (!effect) return [];
    const player = engine.state.players[playerIndex];
    const opponent = engine.state.players[1 - playerIndex];
    const steps = [];

    // 1. Cost choices
    const discardCostReq = effect.cost?.discardHandCount || effect.cost?.discardCount || 0;
    if (discardCostReq > 0) {
      const otherHand = player.hand.filter(c => c.instanceId !== card.instanceId);
      if (otherHand.length > discardCostReq) {
        if (discardCostReq === 1) {
          steps.push({
            key: 'discardInstanceId',
            valueProp: 'instanceId',
            isArray: false,
            count: 1,
            titleTh: 'เลือกการ์ดในมือเพื่อทิ้งเป็น Cost',
            titleEn: 'Select a card in your hand to discard as Cost',
            candidates: otherHand
          });
        } else {
          steps.push({
            key: 'discardInstanceIds',
            valueProp: 'instanceId',
            isArray: true,
            count: discardCostReq,
            titleTh: `เลือกการ์ดในมือ ${discardCostReq} ใบเพื่อทิ้งเป็น Cost`,
            titleEn: `Select ${discardCostReq} cards in your hand to discard as Cost`,
            candidates: otherHand
          });
        }
      }
    }
    if (effect.cost?.sendControlledMonsterToGY) {
      const fieldMons = engine.getPlayerFieldMonsters(playerIndex);
      if (fieldMons.length > 1) {
        steps.push({
          key: 'costMonsterInstanceId',
          valueProp: 'instanceId',
          isArray: false,
          count: 1,
          titleTh: 'เลือกมอนสเตอร์บนสนามเพื่อส่งลงสุสานเป็น Cost',
          titleEn: 'Select a controlled monster to send to the GY as Cost',
          candidates: fieldMons
        });
      }
    }
    if (effect.cost?.sendHandOrFieldMonsterToGY) {
      const pool = [
        ...player.hand.filter(c => c.kind === CARD_KINDS.MONSTER && c.instanceId !== card.instanceId),
        ...engine.getPlayerFieldMonsters(playerIndex)
      ];
      if (pool.length > 1) {
        steps.push({
          key: 'costMonsterInstanceId',
          valueProp: 'instanceId',
          isArray: false,
          count: 1,
          titleTh: 'เลือกมอนสเตอร์ในมือหรือบนสนามเพื่อส่งลงสุสานเป็น Cost',
          titleEn: 'Select a monster in your hand or field to send to the GY as Cost',
          candidates: pool
        });
      }
    }

    const pushStepUnique = (step) => {
      if (!steps.some(s => s.key === step.key)) {
        steps.push(step);
      }
    };

    // 2. Action choices
    for (const action of effect.actions || []) {
      if (action.optional || action.bonusCondition) continue;

      if (action.type === ACTION_TYPES.SEARCH_DECK ||
          action.type === ACTION_TYPES.SEND_FROM_DECK_TO_GY ||
          action.type === ACTION_TYPES.SPECIAL_SUMMON_FROM_DECK) {
        const matches = player.deck.filter(c => matchesCardFilter(c, action.filter, card));
        const uniqueById = [];
        const seenIds = new Set();
        for (const m of matches) {
          if (!seenIds.has(m.id)) {
            seenIds.add(m.id);
            uniqueById.push(m);
          }
        }
        if (uniqueById.length > 1) {
          const titleTh = action.type === ACTION_TYPES.SEARCH_DECK
            ? 'เลือกการ์ดจากเด็คเพื่อนำขึ้นมือ'
            : action.type === ACTION_TYPES.SEND_FROM_DECK_TO_GY
              ? 'เลือกการ์ดจากเด็คเพื่อส่งลงสุสาน'
              : 'เลือกมอนสเตอร์จากเด็คเพื่ออัญเชิญพิเศษ';
          const titleEn = action.type === ACTION_TYPES.SEARCH_DECK
            ? 'Select a card from your Deck to add to your hand'
            : action.type === ACTION_TYPES.SEND_FROM_DECK_TO_GY
              ? 'Select a card from your Deck to send to the GY'
              : 'Select a monster from your Deck to Special Summon';
          pushStepUnique({
            key: 'selectedCardIds',
            valueProp: 'id',
            isArray: true,
            count: action.count || 1,
            titleTh,
            titleEn,
            candidates: uniqueById
          });
        }
      } else if (action.type === ACTION_TYPES.SPECIAL_SUMMON_FROM_HAND) {
        const matches = player.hand.filter(
          c => c.kind === CARD_KINDS.MONSTER &&
               c.instanceId !== card.instanceId &&
               matchesCardFilter(c, action.filter, card)
        );
        if (matches.length > 1) {
          pushStepUnique({
            key: 'selectedInstanceId',
            valueProp: 'instanceId',
            isArray: false,
            count: 1,
            titleTh: 'เลือกมอนสเตอร์บนมือเพื่ออัญเชิญพิเศษ',
            titleEn: 'Select a monster in your hand to Special Summon',
            candidates: matches
          });
        }
      } else if (action.type === ACTION_TYPES.SPECIAL_SUMMON_FROM_GY) {
        const targetPool = action.targetOwner === 'OPPONENT'
          ? opponent.gy
          : action.targetOwner === 'SELF'
            ? player.gy
            : [...player.gy, ...opponent.gy];
        const matches = targetPool.filter(c => matchesCardFilter(c, action.filter, card));
        if (matches.length > 1) {
          pushStepUnique({
            key: 'selectedInstanceId',
            valueProp: 'instanceId',
            isArray: false,
            count: 1,
            titleTh: 'เลือกมอนสเตอร์ในสุสานเพื่ออัญเชิญพิเศษ',
            titleEn: 'Select a monster in the GY to Special Summon',
            candidates: matches
          });
        }
      } else if (action.type === ACTION_TYPES.SPECIAL_SUMMON_FROM_EXTRA) {
        const matches = player.extra.filter(c => matchesCardFilter(c, action.filter, card));
        const uniqueById = [];
        const seenIds = new Set();
        for (const m of matches) {
          if (!seenIds.has(m.id)) {
            seenIds.add(m.id);
            uniqueById.push(m);
          }
        }
        if (uniqueById.length > 1) {
          pushStepUnique({
            key: 'selectedCardIds',
            valueProp: 'id',
            isArray: true,
            count: 1,
            titleTh: 'เลือกมอนสเตอร์จาก Extra Deck เพื่ออัญเชิญพิเศษ',
            titleEn: 'Select a monster from your Extra Deck to Special Summon',
            candidates: uniqueById
          });
        }
      } else if (action.type === ACTION_TYPES.RECOVER_FROM_GY_TO_HAND) {
        const matches = player.gy.filter(c => matchesCardFilter(c, action.filter, card));
        if (matches.length > 1) {
          pushStepUnique({
            key: 'selectedCardIds',
            valueProp: 'id',
            isArray: true,
            count: 1,
            titleTh: 'เลือกการ์ดในสุสานเพื่อนำกลับขึ้นมือ',
            titleEn: 'Select a card in your GY to return to your hand',
            candidates: matches
          });
        }
      } else if (action.type === ACTION_TYPES.SET_FROM_DECK_OR_GY) {
        const sourceZone = action.sourceZone || action.source;
        const pool = sourceZone === 'GY'
          ? player.gy
          : sourceZone === 'DECK'
            ? player.deck
            : [...player.deck, ...player.gy];
        const matches = pool.filter(c => matchesCardFilter(c, action.filter, card));
        const uniqueById = [];
        const seenIds = new Set();
        for (const m of matches) {
          if (!seenIds.has(m.id)) {
            seenIds.add(m.id);
            uniqueById.push(m);
          }
        }
        if (uniqueById.length > 1) {
          pushStepUnique({
            key: 'selectedCardIds',
            valueProp: 'id',
            isArray: true,
            count: 1,
            titleTh: 'เลือกการ์ดเวทมนตร์/กับดักเพื่อนำมาหมอบบนสนาม',
            titleEn: 'Select a Spell/Trap to Set on your field',
            candidates: uniqueById
          });
        }
      } else if (action.type === ACTION_TYPES.FUSION_SUMMON) {
        const candidates = player.extra.filter(
          c => c.frame === MONSTER_FRAMES.FUSION && matchesCardFilter(c, action.fusionFilter, card)
        );
        const uniqueById = [];
        const seenIds = new Set();
        for (const m of candidates) {
          if (!seenIds.has(m.id)) {
            seenIds.add(m.id);
            uniqueById.push(m);
          }
        }
        if (uniqueById.length > 1) {
          pushStepUnique({
            key: 'fusionCardId',
            valueProp: 'id',
            isArray: false,
            count: 1,
            titleTh: 'เลือกมอนสเตอร์ฟิวชั่นที่จะอัญเชิญจาก Extra Deck',
            titleEn: 'Select a Fusion Monster to Summon from your Extra Deck',
            candidates: uniqueById
          });
        }
        if (!action.allowDeckMaterials) {
          const matPool = EffectResolver.getFusionMaterialPool(engine, playerIndex, action, card);
          if (matPool.length > 2) {
            pushStepUnique({
              key: 'materialInstanceIds',
              valueProp: 'instanceId',
              isArray: true,
              count: 2,
              titleTh: 'เลือกวัตถุดิบฟิวชั่น 2 ใบ',
              titleEn: 'Select 2 Fusion Material monsters',
              candidates: matPool
            });
          }
        }
      } else if (
        (action.type === ACTION_TYPES.DESTROY_CARDS ||
         action.type === ACTION_TYPES.SEND_TO_GY ||
         action.type === ACTION_TYPES.RETURN_TO_HAND) &&
        !action.targetChainSource &&
        (action.count || 1) < 10
      ) {
        const targets = EffectResolver.getFieldTargets(engine, playerIndex, action, card);
        if (targets.length > (action.count || 1)) {
          pushStepUnique({
            key: 'targetInstanceIds',
            valueProp: 'instanceId',
            isArray: true,
            count: action.count || 1,
            titleTh: 'เลือกการ์ดเป้าหมายบนสนาม',
            titleEn: 'Select target card on the field',
            candidates: targets
          });
        }
      } else if (action.type === ACTION_TYPES.BANISH_CARDS && (action.count || 1) < 10) {
        const targets = EffectResolver.getBanishTargets(engine, playerIndex, action, card);
        if (targets.length > (action.count || 1)) {
          pushStepUnique({
            key: 'targetInstanceIds',
            valueProp: 'instanceId',
            isArray: true,
            count: action.count || 1,
            titleTh: 'เลือกการ์ดที่จะนำออกนอกเกม (Banish)',
            titleEn: 'Select a card to Banish',
            candidates: targets
          });
        }
      } else if (action.type === ACTION_TYPES.NEGATE_FACEUP_EFFECT) {
        const oppMonsters = engine.getPlayerFieldMonsters(1 - playerIndex).filter(
          m => m.position !== POSITIONS.SET_DEF && !m.effectsNegated && !m.immuneThisTurn
        );
        if (oppMonsters.length > 1) {
          pushStepUnique({
            key: 'targetInstanceIds',
            valueProp: 'instanceId',
            isArray: true,
            count: 1,
            titleTh: 'เลือกมอนสเตอร์ที่หงายหน้าของอีกฝ่ายเพื่อใบ้เอฟเฟค',
            titleEn: 'Select a face-up monster your opponent controls to negate its effects',
            candidates: oppMonsters
          });
        }
      }
    }

    return steps;
  }

  /**
   * รวบรวมเป้าหมายสำหรับการมูฟออกนอกเกม (Banish)
   */
  static getBanishTargets(engine, playerIndex, action, sourceCard) {
    const targetOwnerIdx = action.targetOwner === 'SELF' ? playerIndex : 1 - playerIndex;
    const targetPlayer = engine.state.players[targetOwnerIdx];

    if (action.sourceZone === 'GY') {
      return targetPlayer.gy.filter(c => matchesCardFilter(c, action.filter, sourceCard));
    }
    return EffectResolver.getFieldTargets(
      engine,
      playerIndex,
      { ...action, targetZone: action.sourceZone || 'ANY_FIELD' },
      sourceCard
    );
  }

  /**
   * จ่าย Cost ของเอฟเฟคเมื่อเริ่มสั่งใช้งาน (ก่อนเข้าเชน ตามกฎ Master Duel!)
   */
  static payEffectCost(engine, playerIndex, card, effect, choices = {}) {
    const player = engine.state.players[playerIndex];
    const cost = effect.cost;
    if (!cost) return;

    if (cost.discardSelf) {
      engine.moveCardToZone(playerIndex, card.instanceId, 'GY', { reason: 'COST' });
      engine.log(`💨 ${player.name} ทิ้ง "${card.nameTh}" จากมือเป็น Cost`);
    }

    if (cost.banishSelf) {
      engine.moveCardToZone(playerIndex, card.instanceId, 'BANISHED', { reason: 'COST' });
      engine.log(`🌀 ${player.name} มูฟ "${card.nameTh}" ออกนอกเกมเป็น Cost`);
    }

    if (cost.tributeSelf || cost.sendSelfToGY) {
      engine.moveCardToZone(playerIndex, card.instanceId, 'GY', { reason: 'TRIBUTE_COST' });
      engine.log(`⚡ ${player.name} สังเวย "${card.nameTh}" บนสนามเป็น Cost`);
    }

    const discardCount = cost.discardHandCount || cost.discardCount || 0;
    if (discardCount > 0) {
      const pickedIds = Array.isArray(choices.discardInstanceIds)
        ? [...choices.discardInstanceIds]
        : (choices.discardInstanceId ? [choices.discardInstanceId] : []);
      for (let i = 0; i < discardCount; i++) {
        const pickedId = pickedIds[i];
        const matched = pickedId
          ? player.hand.find(c => c.instanceId === pickedId && c.instanceId !== card.instanceId)
          : null;
        const candidate = matched || player.hand.find(c => c.instanceId !== card.instanceId);
        if (candidate) {
          engine.moveCardToZone(playerIndex, candidate.instanceId, 'GY', { reason: 'DISCARD_COST' });
          engine.log(`💨 ${player.name} ทิ้ง "${candidate.nameTh}" จากมือเป็น Cost`);
        }
      }
    }

    if (cost.payLP) {
      player.lp = Math.max(1, player.lp - cost.payLP);
      engine.log(`💔 ${player.name} จ่าย ${cost.payLP} LP เป็น Cost (เหลือ ${player.lp} LP)`);
    }

    if (cost.returnSelfToExtra) {
      engine.moveCardToZone(playerIndex, card.instanceId, 'EXTRA', { reason: 'COST' });
      engine.log(`🌀 ${player.name} นำ "${card.nameTh}" กลับเข้า Extra Deck เป็น Cost`);
    }

    if (cost.banishFromGYFilter) {
      const gyTarget = player.gy.find(
        c => c.instanceId !== card.instanceId && matchesCardFilter(c, cost.banishFromGYFilter, card)
      );
      if (gyTarget) {
        engine.moveCardToZone(playerIndex, gyTarget.instanceId, 'BANISHED', { reason: 'COST' });
        engine.log(`🌌 ${player.name} มูฟ "${gyTarget.nameTh}" จากสุสานเป็น Cost`);
      }
    }

    if (cost.sendControlledMonsterToGY || cost.sendHandOrFieldMonsterToGY) {
      const fieldMons = engine.getPlayerFieldMonsters(playerIndex);
      const handMons = cost.sendHandOrFieldMonsterToGY
        ? player.hand.filter(c => c.kind === CARD_KINDS.MONSTER && c.instanceId !== card.instanceId)
        : [];
      const pool = cost.sendHandOrFieldMonsterToGY ? [...handMons, ...fieldMons] : fieldMons;
      const target = choices.costMonsterInstanceId
        ? pool.find(m => m.instanceId === choices.costMonsterInstanceId)
        : pool[0];
      if (target) {
        engine.moveCardToZone(playerIndex, target.instanceId, 'GY', { reason: 'COST' });
        engine.log(`⬇️ ${player.name} ส่ง "${target.nameTh}" ลงสุสานเป็น Cost`);
      }
    }

    if (cost.detachCount && Array.isArray(card.overlayUnits)) {
      const detached = card.overlayUnits.splice(0, cost.detachCount);
      for (const unit of detached) {
        unit.zone = 'GY';
        player.gy.push(unit);
        engine.log(`🟡 ${player.name} ถอดโอเวอร์เลย์ยูนิต "${unit.nameTh}" ลงสุสาน`);
        engine.queueTriggerEffects(playerIndex, unit, 'ON_SEND_TO_GY');
      }
    }
  }

  /**
   * ประมวลผลรายการ Actions ทั้งหมดใน Chain Item เมื่อเชนคลี่คลาย (Chain Resolution)
   */
  static resolveChainItem(engine, chainItem) {
    const { playerIndex, card, effect, choices = {} } = chainItem;
    const player = engine.state.players[playerIndex];

    if (chainItem.negated) {
      engine.log(`🚫 เอฟเฟคของ "${card.nameTh}" ถูกยกเลิก (Negated)!`);
      return;
    }

    if (engine.state.negatedCardIdsThisTurn?.includes(card.id)) {
      engine.log(`🚫 เอฟเฟคของ "${card.nameTh}" ถูกใบ้ตามชื่อการ์ดในเทิร์นนี้!`);
      return;
    }

    // If the monster on field had its effects negated by Veiler / Impermanence / Chixiao
    if ((card.zone === 'MMZ' || card.zone === 'EMZ') && card.effectsNegated) {
      engine.log(`🚫 "${card.nameTh}" ติดสถานะใบ้เอฟเฟค เอฟเฟคจึงไร้ผล!`);
      return;
    }

    // Master Rule 5: Continuous Spells/Traps, Field Spells, and Equip Spells must remain face-up on the field to resolve
    if ((card.kind === CARD_KINDS.SPELL || card.kind === CARD_KINDS.TRAP) &&
        ['FIELD', 'CONTINUOUS', 'EQUIP'].includes(card.subType)) {
      const isStillFaceUpOnField = (card.zone === 'STZ' || card.zone === 'FIELD') && card.position !== POSITIONS.SET;
      if (!isStillFaceUpOnField) {
        engine.log(`🚫 "${card.nameTh}" ไม่อยู่บนสนามในสภาพหงายหน้าเมื่อคลี่คลายเชน เอฟเฟคจึงไร้ผล!`);
        return;
      }
    }

    if (effect.turnRestriction) {
      player.turnRestrictions = {
        ...(player.turnRestrictions || {}),
        ...effect.turnRestriction
      };
    }

    // Support customExecute hook if an AI developer wrote custom JS logic
    if (typeof effect.customExecute === 'function') {
      effect.customExecute(engine, { playerIndex, card, effect, choices });
      return;
    }

    for (const action of effect.actions || []) {
      // Check bonusCondition (e.g. Sky Striker 3+ Spells in GY)
      if (action.bonusCondition) {
        if (!engine.checkCondition(playerIndex, action.bonusCondition, card)) {
          continue;
        }
      }

      EffectResolver.executeSingleAction(engine, playerIndex, card, action, choices);
      if (engine.state.winner !== null) break;
    }
  }

  /**
   * ประมวลผล Atomic Action 1 รายการ
   */
  static executeSingleAction(engine, playerIndex, sourceCard, action, choices = {}) {
    const player = engine.state.players[playerIndex];
    const oppIndex = 1 - playerIndex;
    const opponent = engine.state.players[oppIndex];

    switch (action.type) {
      case ACTION_TYPES.DRAW: {
        if (engine.state.drollLockActive) {
          engine.log(`🔒 ติดเอฟเฟค Droll & Lock Bird — ไม่สามารถจั่วการ์ดด้วยเอฟเฟคได้ในเทิร์นนี้!`);
          break;
        }
        const count = action.count || 1;
        engine.drawCards(playerIndex, count, 'EFFECT');
        break;
      }

      case ACTION_TYPES.SEARCH_DECK: {
        if (engine.state.drollLockActive) {
          engine.log(`🔒 ติดเอฟเฟค Droll & Lock Bird — ไม่สามารถนำการ์ดจากเด็คขึ้นมือได้ในเทิร์นนี้!`);
          break;
        }
        const count = action.count || 1;
        for (let i = 0; i < count; i++) {
          const matches = player.deck.filter(c => matchesCardFilter(c, action.filter, sourceCard));
          if (matches.length === 0) break;

          let chosen = null;
          if (choices.selectedCardIds && choices.selectedCardIds[i]) {
            chosen = matches.find(c => c.id === choices.selectedCardIds[i] || c.instanceId === choices.selectedCardIds[i]);
          }
          if (!chosen) {
            chosen = matches[0];
          }

          engine.moveCardToZone(playerIndex, chosen.instanceId, 'HAND', { reason: 'SEARCH' });
          player.addedFromDeckToHandThisTurn = true;
          engine.log(`🔍 ${player.name} ค้นหา "${chosen.nameTh}" จากเด็คขึ้นมือ!`);
        }
        engine.shuffleDeck(playerIndex);
        break;
      }

      case ACTION_TYPES.EXCAVATE_AND_PICK: {
        if (engine.state.drollLockActive) {
          engine.log(`🔒 ติดเอฟเฟค Droll & Lock Bird — ไม่สามารถเปิดเด็คเลือกการ์ดขึ้นมือได้ในเทิร์นนี้!`);
          break;
        }
        const excavateCount = Math.min(player.deck.length, action.excavateCount || 3);
        if (excavateCount === 0) break;
        const excavated = player.deck.slice(0, excavateCount);
        const matches = action.filter
          ? excavated.filter(c => matchesCardFilter(c, action.filter, sourceCard))
          : excavated;
        if (matches.length > 0) {
          const chosen = (choices.selectedCardIds && matches.find(c => c.id === choices.selectedCardIds[0])) || matches[0];
          engine.moveCardToZone(playerIndex, chosen.instanceId, 'HAND', { reason: 'EXCAVATE' });
          player.addedFromDeckToHandThisTurn = true;
          engine.log(`🔍 ${player.name} เปิดดูการ์ดบนสุดของเด็ค ${excavateCount} ใบ และเลือก "${chosen.nameTh}" ขึ้นมือ!`);
        }
        engine.shuffleDeck(playerIndex);
        break;
      }

      case ACTION_TYPES.SEND_FROM_DECK_TO_GY: {
        const count = action.count || 1;
        for (let i = 0; i < count; i++) {
          const matches = player.deck.filter(c => matchesCardFilter(c, action.filter, sourceCard));
          if (matches.length === 0) break;

          const chosen = (choices.selectedCardIds && matches.find(c => c.id === choices.selectedCardIds[i] || c.instanceId === choices.selectedCardIds[i])) || matches[0];
          engine.moveCardToZone(playerIndex, chosen.instanceId, 'GY', { reason: 'EFFECT_DUMP' });
          engine.log(`⬇️ ${player.name} ส่ง "${chosen.nameTh}" จากเด็คลงสุสาน`);
        }
        engine.shuffleDeck(playerIndex);
        break;
      }

      case ACTION_TYPES.SPECIAL_SUMMON_FROM_HAND: {
        const count = action.count || 1;
        for (let i = 0; i < count; i++) {
          if (engine.getFreeMMZIndex(playerIndex) === -1) break;
          const matches = player.hand.filter(
            c => c.kind === CARD_KINDS.MONSTER &&
                 c.instanceId !== sourceCard.instanceId &&
                 matchesCardFilter(c, action.filter, sourceCard)
          );
          if (matches.length === 0) break;

          let chosen = null;
          if (choices.selectedInstanceId) {
            chosen = matches.find(c => c.instanceId === choices.selectedInstanceId);
          } else if (choices.selectedCardIds && choices.selectedCardIds[i]) {
            chosen = matches.find(c => c.id === choices.selectedCardIds[i] || c.instanceId === choices.selectedCardIds[i]);
          }
          if (!chosen) {
            chosen = [...matches].sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
          }

          engine.specialSummonCard(playerIndex, chosen, action.position || POSITIONS.ATK, 'HAND');
        }
        break;
      }

      case ACTION_TYPES.SPECIAL_SUMMON_FROM_DECK: {
        const count = action.count || 1;
        for (let i = 0; i < count; i++) {
          if (engine.getFreeMMZIndex(playerIndex) === -1) break;
          const matches = player.deck.filter(c => matchesCardFilter(c, action.filter, sourceCard));
          if (matches.length === 0) break;

          let chosen = null;
          if (choices.selectedCardIds && choices.selectedCardIds[i]) {
            chosen = matches.find(c => c.id === choices.selectedCardIds[i] || c.instanceId === choices.selectedCardIds[i]);
          }
          if (!chosen) {
            // Sort by highest ATK by default for smart UX
            chosen = [...matches].sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
          }

          engine.specialSummonCard(playerIndex, chosen, action.position || POSITIONS.ATK, 'DECK');
        }
        engine.shuffleDeck(playerIndex);
        break;
      }

      case ACTION_TYPES.SPECIAL_SUMMON_FROM_GY: {
        const count = action.count || 1;
        for (let i = 0; i < count; i++) {
          if (engine.getFreeMMZIndex(playerIndex) === -1) break;
          const targetOwnerIdx = action.targetOwner === 'OPPONENT' ? oppIndex : playerIndex;
          const pool = action.targetOwner
            ? engine.state.players[targetOwnerIdx].gy
            : [...player.gy, ...opponent.gy];

          const matches = pool.filter(c => matchesCardFilter(c, action.filter, sourceCard));
          if (matches.length === 0) break;

          let chosen = null;
          if (choices.selectedInstanceId) {
            chosen = matches.find(c => c.instanceId === choices.selectedInstanceId);
          } else if (choices.selectedCardIds && choices.selectedCardIds[i]) {
            chosen = matches.find(c => c.id === choices.selectedCardIds[i] || c.instanceId === choices.selectedCardIds[i]);
          }
          if (!chosen) {
            chosen = [...matches].sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
          }

          engine.specialSummonCard(playerIndex, chosen, action.position || POSITIONS.ATK, 'GY');
        }
        break;
      }

      case ACTION_TYPES.SPECIAL_SUMMON_FROM_EXTRA: {
        const matches = player.extra.filter(c => matchesCardFilter(c, action.filter, sourceCard));
        if (matches.length === 0) break;

        let chosen = null;
        if (choices.selectedCardIds && choices.selectedCardIds[0]) {
          chosen = matches.find(c => c.id === choices.selectedCardIds[0] || c.instanceId === choices.selectedCardIds[0]);
        }
        if (!chosen) {
          chosen = matches[0];
        }

        engine.specialSummonCard(playerIndex, chosen, POSITIONS.ATK, 'EXTRA');
        break;
      }

      case ACTION_TYPES.SPECIAL_SUMMON_SELF_FROM_HAND:
      case ACTION_TYPES.SPECIAL_SUMMON_SELF_FROM_GY: {
        if (action.tributeAllFieldMonsters) {
          let totalAtk = 0;
          let totalDef = 0;
          const allMons = [
            ...engine.getPlayerFieldMonsters(playerIndex),
            ...engine.getPlayerFieldMonsters(oppIndex)
          ];
          for (const m of allMons) {
            totalAtk += m.atk || 0;
            totalDef += m.def || 0;
            engine.moveCardToZone(m.owner, m.instanceId, 'GY', { reason: 'NIBIRU_TRIBUTE' });
          }
          engine.log(`☄️ "${sourceCard.nameTh}" สังเวยมอนสเตอร์บนสนามทั้งหมด (${allMons.length} ใบ, รวม ${totalAtk} ATK)!`);
          engine.specialSummonCard(playerIndex, sourceCard, POSITIONS.ATK, sourceCard.zone);
          if (action.spawnPrimalTokenOnOpponent) {
            engine.spawnToken(oppIndex, {
              id: 'primal_being_token',
              name: 'Primal Being Token',
              nameTh: 'โทเค็นสิ่งมีชีวิตบรรพกาล (Primal Being Token)',
              kind: CARD_KINDS.TOKEN,
              frame: MONSTER_FRAMES.TOKEN,
              attribute: 'LIGHT',
              race: 'Rock',
              level: 11,
              atk: totalAtk,
              def: totalDef,
              descriptionTh: 'โทเค็นที่อัญเชิญพิเศษด้วยเอฟเฟคของ Nibiru, the Primal Being'
            }, POSITIONS.DEF);
          }
          break;
        }
        if (engine.getFreeMMZIndex(playerIndex) !== -1) {
          engine.specialSummonCard(playerIndex, sourceCard, action.position || POSITIONS.ATK, sourceCard.zone);
        }
        break;
      }

      case ACTION_TYPES.SPAWN_TOKEN: {
        if (action.token && engine.getFreeMMZIndex(playerIndex) !== -1) {
          engine.spawnToken(playerIndex, action.token, action.position || POSITIONS.ATK);
        }
        break;
      }

      case ACTION_TYPES.FUSION_SUMMON: {
        const candidates = player.extra.filter(
          c => c.frame === MONSTER_FRAMES.FUSION && matchesCardFilter(c, action.fusionFilter, sourceCard)
        );
        if (candidates.length === 0) break;

        let fusionMonster = null;
        if (choices.fusionCardId) {
          fusionMonster = candidates.find(c => c.id === choices.fusionCardId || c.instanceId === choices.fusionCardId);
        }
        if (!fusionMonster) {
          // Prefer highest ATK fusion monster not already on field
          fusionMonster = [...candidates].sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
        }

        const matPool = EffectResolver.getFusionMaterialPool(engine, playerIndex, action, sourceCard);
        if (matPool.length < 2) break;

        let materialsUsed = [];
        if (Array.isArray(choices.materialInstanceIds) && choices.materialInstanceIds.length >= 2) {
          materialsUsed = matPool.filter(m => choices.materialInstanceIds.includes(m.instanceId)).slice(0, 2);
        }
        if (materialsUsed.length < 2) {
          // Smart material picking: if Super Poly or Fallen of Albaz, prefer opponent field monsters or matching archetype
          const preferredFirst = matPool.find(m =>
            (action.allowOpponentFieldMaterials && m.controller === 1 - playerIndex) ||
            m.id === 'fallen_of_albaz' ||
            (fusionMonster.archetype && matchesCardFilter(m, { archetype: fusionMonster.archetype }))
          );
          if (preferredFirst) {
            const second = matPool.find(m => m.instanceId !== preferredFirst.instanceId);
            if (second) materialsUsed = [preferredFirst, second];
          }
          if (materialsUsed.length < 2) {
            materialsUsed = matPool.slice(0, 2);
          }
        }

        for (const mat of materialsUsed) {
          const matOwner = mat.owner ?? playerIndex;
          const destZone = mat.zone === 'GY' ? 'BANISHED' : 'GY';
          engine.moveCardToZone(matOwner, mat.instanceId, destZone, { reason: 'FUSION_MATERIAL' });
        }
        engine.log(`🌀 ใช้วัตถุดิบฟิวชั่น: ${materialsUsed.map(m => m.nameTh).join(' + ')}`);
        engine.specialSummonCard(playerIndex, fusionMonster, POSITIONS.ATK, 'EXTRA');
        break;
      }

      case ACTION_TYPES.DESTROY_CARDS: {
        if (action.targetChainSource) {
          const stack = engine.state.chainStack;
          for (let i = stack.length - 1; i >= 0; i--) {
            const item = stack[i];
            if (item.playerIndex !== playerIndex && ['MMZ', 'EMZ', 'STZ', 'FIELD'].includes(item.card?.zone)) {
              engine.destroyCard(item.card.owner, item.card.instanceId, 'EFFECT');
              break;
            }
          }
          break;
        }

        const targets = EffectResolver.getFieldTargets(engine, playerIndex, action, sourceCard);
        if (targets.length === 0) break;

        const maxCount = action.count || 1;
        let selected = [];
        if (choices.targetInstanceIds && choices.targetInstanceIds.length > 0) {
          selected = targets.filter(t => choices.targetInstanceIds.includes(t.instanceId)).slice(0, maxCount);
        }
        if (selected.length === 0) {
          // Pick strongest monsters first, then spells/traps
          selected = [...targets]
            .sort((a, b) => (b.currentAtk ?? b.atk ?? 0) - (a.currentAtk ?? a.atk ?? 0))
            .slice(0, maxCount);
        }

        for (const t of selected) {
          engine.destroyCard(t.owner, t.instanceId, 'EFFECT');
        }
        break;
      }

      case ACTION_TYPES.SEND_TO_GY: {
        const targets = EffectResolver.getFieldTargets(engine, playerIndex, action, sourceCard);
        if (targets.length === 0) break;

        const maxCount = action.count || 1;
        let selected = [];
        if (choices.targetInstanceIds && choices.targetInstanceIds.length > 0) {
          selected = targets.filter(t => choices.targetInstanceIds.includes(t.instanceId)).slice(0, maxCount);
        }
        if (selected.length === 0) {
          selected = [...targets]
            .sort((a, b) => (b.currentAtk ?? b.atk ?? 0) - (a.currentAtk ?? a.atk ?? 0))
            .slice(0, maxCount);
        }

        for (const t of selected) {
          engine.moveCardToZone(t.owner, t.instanceId, 'GY', { reason: 'EFFECT_SEND' });
          engine.log(`⬇️ "${t.nameTh}" ถูกส่งลงสุสานด้วยเอฟเฟค!`);
        }
        break;
      }

      case ACTION_TYPES.BANISH_CARDS: {
        const targets = EffectResolver.getBanishTargets(engine, playerIndex, action, sourceCard);
        if (targets.length === 0) break;

        const maxCount = action.count || 1;
        let selected = [];
        if (choices.targetInstanceIds && choices.targetInstanceIds.length > 0) {
          selected = targets.filter(t => choices.targetInstanceIds.includes(t.instanceId)).slice(0, maxCount);
        }
        if (selected.length === 0) {
          selected = [...targets]
            .sort((a, b) => (b.currentAtk ?? b.atk ?? 0) - (a.currentAtk ?? a.atk ?? 0))
            .slice(0, maxCount);
        }

        for (const t of selected) {
          engine.moveCardToZone(t.owner, t.instanceId, 'BANISHED', { reason: 'EFFECT_BANISH' });
          engine.log(`🌌 "${t.nameTh}" ถูกนำออกนอกเกม (Banished)!`);
          if (action.negateSameId && t.id) {
            if (!Array.isArray(engine.state.negatedCardIdsThisTurn)) {
              engine.state.negatedCardIdsThisTurn = [];
            }
            if (!engine.state.negatedCardIdsThisTurn.includes(t.id)) {
              engine.state.negatedCardIdsThisTurn.push(t.id);
            }
            // Negate any face-up monsters with the same original ID on either field
            for (const pIdx of [0, 1]) {
              for (const m of engine.getPlayerFieldMonsters(pIdx)) {
                if (m.id === t.id) m.effectsNegated = true;
              }
            }
            // Negate any active chain items with the same original ID
            for (const item of engine.state.chainStack) {
              if (item.card?.id === t.id && !item.negated) {
                item.negated = true;
                engine.log(`🛡️ "${sourceCard.nameTh}" ยกเลิกเอฟเฟคของการ์ดชื่อเดียวกับ "${t.nameTh}" ในเชน!`);
              }
            }
          }
        }
        break;
      }

      case ACTION_TYPES.RETURN_TO_HAND: {
        const targets = EffectResolver.getFieldTargets(engine, playerIndex, action, sourceCard);
        if (targets.length === 0) break;

        const maxCount = action.count || 1;
        let selected = [];
        if (choices.targetInstanceIds && choices.targetInstanceIds.length > 0) {
          selected = targets.filter(t => choices.targetInstanceIds.includes(t.instanceId)).slice(0, maxCount);
        }
        if (selected.length === 0) {
          selected = [...targets]
            .sort((a, b) => (b.currentAtk ?? b.atk ?? 0) - (a.currentAtk ?? a.atk ?? 0))
            .slice(0, maxCount);
        }

        for (const t of selected) {
          engine.bounceCardToHand(t.owner, t.instanceId);
        }
        break;
      }

      case ACTION_TYPES.NEGATE_ACTIVATION: {
        // Find the most recent opponent chain item in chainStack that is not yet negated
        const stack = engine.state.chainStack;
        for (let i = stack.length - 1; i >= 0; i--) {
          const item = stack[i];
          if (item.playerIndex !== playerIndex && !item.negated) {
            item.negated = true;
            engine.log(`🛡️ "${sourceCard.nameTh}" ยกเลิกการสั่งใช้งานเอฟเฟคของ "${item.card.nameTh}"!`);
            if (action.destroyNegated || action.destroySource) {
              engine.destroyCard(item.playerIndex, item.card.instanceId, 'NEGATE_DESTROY');
            }
            break;
          }
        }
        break;
      }

      case ACTION_TYPES.NEGATE_FACEUP_EFFECT: {
        const oppMonsters = engine.getPlayerFieldMonsters(oppIndex).filter(
          m => m.position !== POSITIONS.SET_DEF && !m.effectsNegated && !m.immuneThisTurn
        );
        if (oppMonsters.length === 0) break;

        let target = null;
        if (choices.targetInstanceIds && choices.targetInstanceIds[0]) {
          target = oppMonsters.find(m => m.instanceId === choices.targetInstanceIds[0]);
        }
        if (!target) {
          target = [...oppMonsters].sort((a, b) => (b.currentAtk ?? 0) - (a.currentAtk ?? 0))[0];
        }

        target.effectsNegated = true;
        engine.log(`🔇 "${target.nameTh}" ถูกใบ้เอฟเฟคจนจบเทิร์น!`);

        // Also negate any active chain link from that monster
        for (const item of engine.state.chainStack) {
          if (item.card.instanceId === target.instanceId) {
            item.negated = true;
          }
        }
        break;
      }

      case ACTION_TYPES.TAKE_CONTROL: {
        const freeSlot = engine.getFreeMMZIndex(playerIndex);
        if (freeSlot === -1) break;
        const oppMonsters = engine.getPlayerFieldMonsters(oppIndex).filter(m => !m.immuneThisTurn);
        if (oppMonsters.length === 0) break;

        let target = null;
        if (choices.targetInstanceIds && choices.targetInstanceIds[0]) {
          target = oppMonsters.find(m => m.instanceId === choices.targetInstanceIds[0]);
        }
        if (!target) {
          target = [...oppMonsters].sort((a, b) => (b.currentAtk ?? 0) - (a.currentAtk ?? 0))[0];
        }
        // Remove from opponent field
        engine.removeFromFieldZone(oppIndex, target.instanceId);
        target.controller = playerIndex;
        target.zone = 'MMZ';
        target.zoneIndex = freeSlot;
        player.mmz[freeSlot] = target;
        engine.log(`⛓️ ${player.name} ยึดการควบคุม "${target.nameTh}" มาเป็นของตัวเอง!`);
        break;
      }

      case ACTION_TYPES.MODIFY_STATS: {
        const target = action.targetSelf
          ? sourceCard
          : action.targetOwner === 'OPPONENT'
            ? engine.getPlayerFieldMonsters(oppIndex)[0]
            : engine.getPlayerFieldMonsters(playerIndex)[0];
        if (target) {
          target.currentAtk = Math.max(0, (target.currentAtk ?? target.atk ?? 0) + (action.atkDelta || 0));
          target.currentDef = Math.max(0, (target.currentDef ?? target.def ?? 0) + (action.defDelta || 0));
          const sign = (action.atkDelta || 0) >= 0 ? `+${action.atkDelta || 0}` : `${action.atkDelta}`;
          engine.log(`⬆️ "${target.nameTh}" ปรับพลังโจมตี ${sign} ATK (ปัจจุบัน ${target.currentAtk} ATK)!`);
        }
        break;
      }

      case ACTION_TYPES.GAIN_LP: {
        const amount = action.amount || 500;
        player.lp += amount;
        engine.log(`💚 ${player.name} ฟื้นฟู +${amount} LP (ปัจจุบัน ${player.lp} LP)`);
        break;
      }

      case ACTION_TYPES.INFLICT_DAMAGE: {
        const amount = action.amount || 500;
        opponent.lp = Math.max(0, opponent.lp - amount);
        engine.log(`🔥 ${opponent.name} ได้รับความเสียหายเอฟเฟค -${amount} LP! (เหลือ ${opponent.lp} LP)`);
        engine.checkWinCondition();
        break;
      }

      case ACTION_TYPES.RECOVER_FROM_GY_TO_HAND: {
        const matches = player.gy.filter(c => matchesCardFilter(c, action.filter, sourceCard));
        if (matches.length === 0) break;

        const chosen = (choices.selectedCardIds && matches.find(c => c.id === choices.selectedCardIds[0] || c.instanceId === choices.selectedCardIds[0])) || matches[0];
        engine.moveCardToZone(playerIndex, chosen.instanceId, 'HAND', { reason: 'RECOVER' });
        engine.log(`♻️ ${player.name} เก็บ "${chosen.nameTh}" จากสุสานกลับขึ้นมือ!`);
        break;
      }

      case ACTION_TYPES.SET_FROM_DECK_OR_GY: {
        const slot = engine.getFreeSTZIndex(playerIndex);
        if (slot === -1) break;
        const sourceZone = action.sourceZone || action.source;
        const pool = sourceZone === 'GY'
          ? player.gy
          : sourceZone === 'DECK'
            ? player.deck
            : [...player.deck, ...player.gy];
        const matches = pool.filter(c => matchesCardFilter(c, action.filter, sourceCard));
        if (matches.length === 0) break;

        const chosen = (choices.selectedCardIds && matches.find(c => c.id === choices.selectedCardIds[0] || c.instanceId === choices.selectedCardIds[0])) || matches[0];
        const wasDeck = chosen.zone === 'DECK';
        engine.removeFromCurrentZone(chosen.instanceId);
        player.stz[slot] = chosen;
        chosen.zone = 'STZ';
        chosen.zoneIndex = slot;
        chosen.controller = playerIndex;
        chosen.position = POSITIONS.SET;
        chosen.setTurn = action.canActivateThisTurn ? engine.state.turnCount - 1 : engine.state.turnCount;
        if (wasDeck) engine.shuffleDeck(playerIndex);
        engine.log(`🂠 ${player.name} นำ "${chosen.nameTh}" มาหมอบในโซนเวทมนตร์/กับดัก!`);
        break;
      }

      case ACTION_TYPES.DISCARD_HAND: {
        const targetPlayerIdx = action.targetOwner === 'OPPONENT' ? oppIndex : playerIndex;
        const targetP = engine.state.players[targetPlayerIdx];
        const count = action.count || 1;
        for (let i = 0; i < count; i++) {
          if (targetP.hand.length === 0) break;
          const cardToDiscard = targetP.hand[0];
          engine.moveCardToZone(targetPlayerIdx, cardToDiscard.instanceId, 'GY', { reason: 'EFFECT_DISCARD' });
          engine.log(`💨 ${targetP.name} ทิ้ง "${cardToDiscard.nameTh}" จากมือลงสุสาน`);
        }
        break;
      }

      case ACTION_TYPES.GRANT_IMMUNITY: {
        const target = action.targetSelf ? sourceCard : engine.getPlayerFieldMonsters(playerIndex)[0];
        if (target) {
          target.immuneThisTurn = true;
          engine.log(`🛡️ "${target.nameTh}" ได้รับภูมิคุ้มกันเอฟเฟคของอีกฝ่ายจนจบเทิร์น!`);
        }
        break;
      }

      case ACTION_TYPES.GRANT_MULTI_ATTACK: {
        sourceCard.maxAttacks = action.attacks || 2;
        engine.log(`⚔️ "${sourceCard.nameTh}" สามารถโจมตีได้ ${sourceCard.maxAttacks} ครั้งในแต่ละ Battle Phase!`);
        break;
      }

      case ACTION_TYPES.APPLY_TURN_EFFECT: {
        if (action.maxxC) {
          player.maxxCActive = true;
          engine.log(`🐝 [Maxx "C" Active] ทุกครั้งที่ ${opponent.name} อัญเชิญพิเศษในเทิร์นนี้ ${player.name} จะได้จั่วการ์ด 1 ใบทันที!`);
        }
        if (action.drollLock) {
          engine.state.drollLockActive = true;
          engine.log(`🔒 [Droll & Lock Bird] จนจบเทิร์นนี้ ผู้เล่นทั้งสองฝ่ายไม่สามารถเพิ่มการ์ดจากเด็คขึ้นมือได้อีก!`);
        }
        if (action.dimensionShifter) {
          engine.state.macroCosmosTurnsRemaining = 2;
          engine.log(`🌌 [Dimension Shifter] การ์ดทุกใบที่ถูกส่งลงสุสานจะถูกนำออกนอกเกม (Banished) แทนจนจบเทิร์นหน้า!`);
        }
        break;
      }
    }
  }
}
