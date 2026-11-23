/**
 * @fileoverview Master Duel Summon Manager (Normal, Tribute, Inherent Special, Fusion, Synchro, Xyz, Link)
 * ระบบตรวจสอบเงื่อนไขและดำเนินการอัญเชิญมอนสเตอร์ทุกประเภทตามกฎ Master Rule 5 (Master Duel)
 */

import {
  CARD_KINDS,
  MONSTER_FRAMES,
  POSITIONS,
  PHASES
} from '../constants/gameConstants.js';
import { matchesCardFilter } from '../cards/schema.js';

export class SummonManager {
  /**
   * ตรวจสอบจำนวนมอนสเตอร์ที่ต้องสังเวยสำหรับการอัญเชิญปกติ (Normal Summon / Tribute Summon)
   * @param {Object} card
   * @returns {number} 0, 1, หรือ 2
   */
  static getRequiredTributes(card) {
    const level = card.currentLevel ?? card.level ?? 4;
    if (level <= 4) return 0;
    if (level <= 6) return 1;
    return 2;
  }

  /**
   * ดึงรายชื่อมอนสเตอร์หงายหน้าบนสนามของผู้เล่น
   * @param {Object} player
   * @returns {Array<Object>}
   */
  static getFaceUpFieldMonsters(player) {
    const list = [];
    for (const m of player.mmz) {
      if (m && m.position !== POSITIONS.SET_DEF) list.push(m);
    }
    if (player.emz && player.emz.position !== POSITIONS.SET_DEF) {
      list.push(player.emz);
    }
    return list;
  }

  /**
   * ดึงรายชื่อมอนสเตอร์ทั้งหมดบนสนามของผู้เล่น (ทั้งหงายและคว่ำ)
   * @param {Object} player
   * @returns {Array<Object>}
   */
  static getAllFieldMonsters(player) {
    const list = [];
    for (const m of player.mmz) {
      if (m) list.push(m);
    }
    if (player.emz) list.push(player.emz);
    return list;
  }

  /**
   * ตรวจสอบว่าการ์ดในมือสามารถอัญเชิญปกติ (Normal Summon / Set) ได้หรือไม่
   * @param {Object} engine
   * @param {number} playerIndex
   * @param {Object} card
   * @returns {{ canSummon: boolean, tributesRequired: number, reasonTh?: string }}
   */
  static canNormalSummon(engine, playerIndex, card) {
    const state = engine.state;
    const player = state.players[playerIndex];

    if (state.turnPlayer !== playerIndex) {
      return { canSummon: false, tributesRequired: 0, reasonTh: 'ไม่ใช่เทิร์นของคุณ' };
    }
    if (state.phase !== PHASES.MP1 && state.phase !== PHASES.MP2) {
      return { canSummon: false, tributesRequired: 0, reasonTh: 'อัญเชิญปกติได้เฉพาะใน Main Phase 1 หรือ 2' };
    }
    if (state.chainStack.length > 0) {
      return { canSummon: false, tributesRequired: 0, reasonTh: 'ไม่สามารถอัญเชิญปกติระหว่างเชนได้' };
    }
    if (card.kind !== CARD_KINDS.MONSTER) {
      return { canSummon: false, tributesRequired: 0, reasonTh: 'ไม่ใช่การ์ดมอนสเตอร์' };
    }
    if ([
      MONSTER_FRAMES.FUSION,
      MONSTER_FRAMES.SYNCHRO,
      MONSTER_FRAMES.XYZ,
      MONSTER_FRAMES.LINK,
      MONSTER_FRAMES.TOKEN,
      'RITUAL'
    ].includes(card.frame)) {
      return { canSummon: false, tributesRequired: 0, reasonTh: 'มอนสเตอร์ประเภทนี้ไม่สามารถอัญเชิญปกติหรือหมอบได้' };
    }
    if (player.normalSummonUsed) {
      return { canSummon: false, tributesRequired: 0, reasonTh: 'ใช้อัญเชิญปกติประจำเทิร์นนี้ไปแล้ว (1 ครั้ง/เทิร์น)' };
    }
    if (player.turnRestrictions?.noNormalSummon) {
      return { canSummon: false, tributesRequired: 0, reasonTh: 'ติดข้อจำกัดห้ามอัญเชิญปกติในเทิร์นนี้' };
    }
    if (player.turnRestrictions?.attributesAllowed && !player.turnRestrictions.attributesAllowed.includes(card.attribute)) {
      return { canSummon: false, tributesRequired: 0, reasonTh: 'ติดข้อจำกัดธาตุในการอัญเชิญเทิร์นนี้' };
    }
    if (player.turnRestrictions?.racesAllowed && !player.turnRestrictions.racesAllowed.includes(card.race)) {
      return { canSummon: false, tributesRequired: 0, reasonTh: 'ติดข้อจำกัดเผ่าในการอัญเชิญเทิร์นนี้' };
    }

    const tributesRequired = SummonManager.getRequiredTributes(card);
    const fieldMonsters = SummonManager.getAllFieldMonsters(player);
    const freeMMZ = player.mmz.filter(z => z === null).length;
    const occupiedMMZ = 5 - freeMMZ;

    if (tributesRequired === 0 && freeMMZ === 0) {
      return { canSummon: false, tributesRequired: 0, reasonTh: 'โซนมอนสเตอร์หลักเต็มแล้ว' };
    }
    if (tributesRequired > 0 && freeMMZ === 0 && occupiedMMZ === 0) {
      return { canSummon: false, tributesRequired, reasonTh: 'ไม่มีมอนสเตอร์ใน Main Monster Zone ให้สังเวยเพื่อเปิดช่องว่าง' };
    }
    if (fieldMonsters.length < tributesRequired) {
      return {
        canSummon: false,
        tributesRequired,
        reasonTh: `ต้องสังเวยมอนสเตอร์บนสนาม ${tributesRequired} ใบ`
      };
    }

    return { canSummon: true, tributesRequired };
  }

  /**
   * ตรวจสอบว่ามอนสเตอร์ในมือมีเงื่อนไข Inherent Special Summon (`specialSummonRule`) ที่ผ่านเกณฑ์หรือไม่
   * @param {Object} engine
   * @param {number} playerIndex
   * @param {Object} card
   * @returns {boolean}
   */
  static canInherentSpecialSummon(engine, playerIndex, card) {
    const state = engine.state;
    const player = state.players[playerIndex];
    const rule = card.specialSummonRule;
    if (!rule) return false;

    if (state.turnPlayer !== playerIndex) return false;
    if (state.phase !== PHASES.MP1 && state.phase !== PHASES.MP2) return false;
    if (state.chainStack.length > 0) return false;
    if (player.turnRestrictions?.noSpecialSummon) return false;
    if (player.turnRestrictions?.attributesAllowed && !player.turnRestrictions.attributesAllowed.includes(card.attribute)) return false;
    if (player.turnRestrictions?.racesAllowed && !player.turnRestrictions.racesAllowed.includes(card.race)) return false;

    const freeMMZ = player.mmz.filter(z => z === null).length;
    if (freeMMZ === 0) return false;

    if (rule.opt && player.optUsed.includes(rule.opt)) return false;

    if (rule.cost?.discardHandCount) {
      const otherHandCards = player.hand.filter(c => c.instanceId !== card.instanceId);
      if (otherHandCards.length < rule.cost.discardHandCount) return false;
    }

    if (rule.condition) {
      if (!engine.checkCondition(playerIndex, rule.condition, card)) return false;
    }

    return true;
  }

  /**
   * คำนวณช่อง Main Monster Zone (0..4) ที่หัวลูกศรของมอนสเตอร์ลิงก์ชี้ไปหาตามกฎ Master Rule 5
   * @param {Object} player
   * @param {Array<Object>} [materialsLeaving=[]]
   * @returns {Set<number>}
   */
  static getLinkPointedMMZIndices(player, materialsLeaving = []) {
    const leavingIds = new Set(materialsLeaving.map(m => m.instanceId));
    const pointed = new Set();

    const emzMon = player.emz && !leavingIds.has(player.emz.instanceId) ? player.emz : null;
    if (emzMon && emzMon.frame === MONSTER_FRAMES.LINK && emzMon.position !== POSITIONS.SET_DEF) {
      const arrows = emzMon.linkArrows || ['BOTTOM'];
      if (arrows.includes('BOTTOM_LEFT')) pointed.add(0);
      if (arrows.includes('BOTTOM')) {
        pointed.add(1);
        pointed.add(2);
      }
      if (arrows.includes('BOTTOM_RIGHT')) {
        pointed.add(2);
        pointed.add(3);
      }
    }

    for (let idx = 0; idx < 5; idx++) {
      const m = player.mmz[idx];
      if (!m || leavingIds.has(m.instanceId) || m.frame !== MONSTER_FRAMES.LINK || m.position === POSITIONS.SET_DEF) continue;
      const arrows = m.linkArrows || [];
      if (arrows.includes('LEFT') && idx > 0) pointed.add(idx - 1);
      if (arrows.includes('RIGHT') && idx < 4) pointed.add(idx + 1);
    }

    return pointed;
  }

  /**
   * ตรวจสอบว่าหลังจากส่งวัตถุดิบ `materials` ออกจากสนามแล้ว มีโซนว่างสำหรับวางมอนสเตอร์ลิงก์ตามกฎ Master Rule 5 หรือไม่
   */
  static hasValidLinkDestinationZone(player, materials = []) {
    const leavingIds = new Set(materials.map(m => m.instanceId));
    // 1. EMZ is empty or freed by one of the materials
    if (!player.emz || leavingIds.has(player.emz.instanceId)) {
      return true;
    }
    // 2. Or any Link-pointed MMZ is empty or freed by one of the materials
    const pointed = SummonManager.getLinkPointedMMZIndices(player, materials);
    for (const slotIdx of pointed) {
      if (!player.mmz[slotIdx] || leavingIds.has(player.mmz[slotIdx].instanceId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * ตรวจสอบว่าชุดวัตถุดิบ `materials` มีผลรวม Link Rating เท่ากับ `targetLinkRating` พอดีตามกฎ Master Rule 5 หรือไม่
   * (มอนสเตอร์ลิงก์สามารถนับเป็น Link Rating ของตัวเอง หรือนับเป็น 1 ได้)
   */
  static doesComboMatchLinkRating(materials, targetLinkRating, minMonsters = 1) {
    if (!Array.isArray(materials) || materials.length < minMonsters || materials.length > targetLinkRating) {
      return false;
    }
    let possibleSums = new Set([0]);
    for (const m of materials) {
      const nextSums = new Set();
      const isLinkMulti = m.frame === MONSTER_FRAMES.LINK && (m.linkRating || 1) > 1;
      for (const s of possibleSums) {
        nextSums.add(s + 1);
        if (isLinkMulti) {
          nextSums.add(s + m.linkRating);
        }
      }
      possibleSums = nextSums;
    }
    return possibleSums.has(targetLinkRating);
  }

  /**
   * ค้นหาชุดวัตถุดิบที่ถูกต้องสำหรับการอัญเชิญจาก Extra Deck (Synchro, Xyz, Link)
   * @param {Object} engine
   * @param {number} playerIndex
   * @param {Object} extraCard
   * @returns {{ canSummon: boolean, validCombinations: Array<Array<Object>> }}
   */
  static getExtraDeckSummonCombinations(engine, playerIndex, extraCard) {
    const state = engine.state;
    const player = state.players[playerIndex];

    if (state.turnPlayer !== playerIndex && !extraCard._allowQuickExtraSummon) {
      return { canSummon: false, validCombinations: [] };
    }
    if (state.phase !== PHASES.MP1 && state.phase !== PHASES.MP2 && !extraCard._allowQuickExtraSummon) {
      return { canSummon: false, validCombinations: [] };
    }
    if (state.chainStack.length > 0 && !extraCard._allowQuickExtraSummon) {
      return { canSummon: false, validCombinations: [] };
    }

    if (player.turnRestrictions?.noSpecialSummon || player.turnRestrictions?.noExtraDeckSummon) {
      return { canSummon: false, validCombinations: [] };
    }
    if (player.turnRestrictions?.extraDeckFramesAllowed &&
        !player.turnRestrictions.extraDeckFramesAllowed.includes(extraCard.frame)) {
      return { canSummon: false, validCombinations: [] };
    }
    if (player.turnRestrictions?.attributesAllowed &&
        !player.turnRestrictions.attributesAllowed.includes(extraCard.attribute)) {
      return { canSummon: false, validCombinations: [] };
    }
    if (player.turnRestrictions?.racesAllowed &&
        !player.turnRestrictions.racesAllowed.includes(extraCard.race)) {
      return { canSummon: false, validCombinations: [] };
    }

    const faceUpMonsters = SummonManager.getFaceUpFieldMonsters(player);
    if (faceUpMonsters.length === 0) {
      return { canSummon: false, validCombinations: [] };
    }

    // SYNCHRO SUMMON: 1 Tuner + 1+ non-Tuner whose total Levels == extraCard.level
    if (extraCard.frame === MONSTER_FRAMES.SYNCHRO) {
      const targetLevel = extraCard.level;
      const matRule = extraCard.summonMaterials || {};
      const allowLink1AsTuner = Boolean(
        matRule.allowLink1AsLevel1Tuner ||
        (extraCard.description || '').toLowerCase().includes('treat 1 link-1 monster')
      );
      const levelMonsters = faceUpMonsters.filter(
        m => m.frame !== MONSTER_FRAMES.XYZ && (m.frame !== MONSTER_FRAMES.LINK || (allowLink1AsTuner && m.linkRating === 1))
      );
      const canActAsTuner = (m) => {
        if (m.frame === MONSTER_FRAMES.LINK) {
          return allowLink1AsTuner && m.linkRating === 1;
        }
        if (matRule.tunerFilter && !matchesCardFilter(m, matRule.tunerFilter, extraCard)) return false;
        if (m.isTuner) return true;
        if (matRule.allowNonTunerLightOrDarkAsTuner && (m.attribute === 'LIGHT' || m.attribute === 'DARK')) return true;
        return false;
      };
      const canActAsNonTuner = (m) => {
        if (m.frame === MONSTER_FRAMES.XYZ || m.frame === MONSTER_FRAMES.LINK) return false;
        if (matRule.nonTunerFilter && !matchesCardFilter(m, matRule.nonTunerFilter, extraCard)) return false;
        return !m.isTuner;
      };

      const tuners = levelMonsters.filter(canActAsTuner);
      const minNonTuners = matRule.minNonTuners || 1;
      const combinations = [];
      const seenKeys = new Set();

      for (const tuner of tuners) {
        const tunerLv = (tuner.frame === MONSTER_FRAMES.LINK && allowLink1AsTuner)
          ? 1
          : (tuner.currentLevel ?? tuner.level ?? 0);
        const nonTuners = levelMonsters.filter(
          m => m.instanceId !== tuner.instanceId && canActAsNonTuner(m)
        );
        // 1 non-tuner
        for (let i = 0; i < nonTuners.length; i++) {
          const nt1 = nonTuners[i];
          const lv1 = nt1.currentLevel ?? nt1.level ?? 0;
          if (minNonTuners <= 1 && tunerLv + lv1 === targetLevel) {
            const combo = [tuner, nt1];
            const key = combo.map(c => c.instanceId).sort().join('|');
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              combinations.push(combo);
            }
          }
          // 2 non-tuners
          for (let j = i + 1; j < nonTuners.length; j++) {
            const nt2 = nonTuners[j];
            const lv2 = nt2.currentLevel ?? nt2.level ?? 0;
            if (tunerLv + lv1 + lv2 === targetLevel) {
              const combo = [tuner, nt1, nt2];
              const key = combo.map(c => c.instanceId).sort().join('|');
              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                combinations.push(combo);
              }
            }
          }
        }
      }

      return {
        canSummon: combinations.length > 0,
        validCombinations: combinations
      };
    }

    // XYZ SUMMON: N face-up monsters with Level == extraCard.rank (or altRankUp Xyz Evolution)
    if (extraCard.frame === MONSTER_FRAMES.XYZ) {
      const reqLevel = extraCard.summonMaterials?.level ?? extraCard.rank;
      const reqCount = extraCard.summonMaterials?.count ?? 2;
      const matching = faceUpMonsters.filter(
        m => m.frame !== MONSTER_FRAMES.XYZ &&
             m.frame !== MONSTER_FRAMES.LINK &&
             m.frame !== MONSTER_FRAMES.TOKEN &&
             (m.currentLevel ?? m.level) === reqLevel &&
             (!extraCard.summonMaterials?.filter || matchesCardFilter(m, extraCard.summonMaterials.filter, extraCard))
      );

      const combinations = [];
      if (matching.length >= reqCount) {
        if (reqCount === 2) {
          for (let i = 0; i < matching.length; i++) {
            for (let j = i + 1; j < matching.length; j++) {
              combinations.push([matching[i], matching[j]]);
            }
          }
        } else {
          combinations.push(matching.slice(0, reqCount));
        }
      }

      // Alternate Xyz Evolution (e.g., Zeus on an Xyz Monster if an Xyz battled, or Ty-Phon on highest ATK monster)
      const altRule = extraCard.summonMaterials?.altRankUp;
      if (altRule) {
        const opponent = state.players[1 - playerIndex];
        const optOk = !altRule.opt || !player.optUsed.includes(altRule.opt);
        let condOk = optOk && (!altRule.condition || engine.checkCondition(playerIndex, altRule.condition, extraCard));
        if (altRule.requiresXyzBattledThisTurn && !(
          player.xyzBattledThisTurn ||
          player.turnFlags?.xyzBattledThisTurn ||
          opponent?.xyzBattledThisTurn ||
          opponent?.turnFlags?.xyzBattledThisTurn
        )) {
          condOk = false;
        }
        if (condOk) {
          let altMatches = faceUpMonsters.filter(
            m => m.id !== extraCard.id &&
                 m.frame !== MONSTER_FRAMES.TOKEN &&
                 matchesCardFilter(m, altRule.filter || {}, extraCard)
          );
          if ((altRule.highestAtkOnly || altRule.onlyOneMonsterWithHighestAtk) && faceUpMonsters.length > 0) {
            const maxAtk = Math.max(...faceUpMonsters.map(m => m.currentAtk ?? m.atk ?? 0));
            altMatches = altMatches.filter(m => (m.currentAtk ?? m.atk ?? 0) === maxAtk);
          }
          for (const am of altMatches) {
            combinations.push([am]);
          }
        }
      }

      return {
        canSummon: combinations.length > 0,
        validCombinations: combinations
      };
    }

    // LINK SUMMON
    if (extraCard.frame === MONSTER_FRAMES.LINK) {
      const linkRating = extraCard.linkRating || 1;
      const matRule = extraCard.summonMaterials || {};
      const minMonsters = matRule.minMonsters || (linkRating === 1 ? 1 : 2);
      const combinations = [];

      if (linkRating === 1) {
        for (const m of faceUpMonsters) {
          // Cannot Link-1 using the exact same Link-1 monster
          if (m.id === extraCard.id) continue;
          if (matRule.filter && !matchesCardFilter(m, matRule.filter, extraCard)) continue;
          if (SummonManager.doesComboMatchLinkRating([m], 1, minMonsters) &&
              SummonManager.hasValidLinkDestinationZone(player, [m])) {
            combinations.push([m]);
          }
        }
      } else {
        const eligiblePool = faceUpMonsters.filter(
          m => !matRule.filter || matchesCardFilter(m, matRule.filter, extraCard)
        );
        const n = eligiblePool.length;
        for (let mask = 1; mask < (1 << n); mask++) {
          const picked = [];
          for (let b = 0; b < n; b++) {
            if (mask & (1 << b)) {
              picked.push(eligiblePool[b]);
            }
          }
          if (SummonManager.doesComboMatchLinkRating(picked, linkRating, minMonsters) &&
              SummonManager.hasValidLinkDestinationZone(player, picked)) {
            combinations.push(picked);
          }
        }
      }

      return {
        canSummon: combinations.length > 0,
        validCombinations: combinations
      };
    }

    return { canSummon: false, validCombinations: [] };
  }
}
