/**
 * @fileoverview Card Schema, Filter Matcher & Validator for Yu-Gi-Oh! Master Duel Engine
 * โครงสร้าง Schema มาตรฐานของการ์ด สำหรับตรวจสอบความถูกต้องเมื่อ AI ตัวอื่นหรือผู้พัฒนาเพิ่มการ์ดใหม่
 */

import {
  CARD_KINDS,
  MONSTER_FRAMES,
  SPELL_SUBTYPES,
  TRAP_SUBTYPES,
  ATTRIBUTES,
  TRIGGERS,
  ACTION_TYPES
} from '../constants/gameConstants.js';

/**
 * ตรวจสอบว่าการ์ดตรงตามเงื่อนไข Filter ที่เอฟเฟคระบุหรือไม่
 * ใช้ร่วมกันทั้งการค้นหาเด็ค (SEARCH_DECK), ชุบจากสุสาน (SPECIAL_SUMMON_FROM_GY),
 * เลือกทำลาย (DESTROY_CARDS), และตรวจสอบวัตถุดิบอัญเชิญ
 *
 * @param {Object} card - ข้อมูลการ์ดหรือ CardInstance
 * @param {Object} [filter={}] - เงื่อนไขการกรอง
 * @param {Object} [sourceCard=null] - การ์ดต้นทางที่ใช้เอฟเฟค (สำหรับ excludeSelf)
 * @returns {boolean}
 */
export function matchesCardFilter(card, filter = {}, sourceCard = null) {
  if (!card) return false;
  if (!filter || Object.keys(filter).length === 0) return true;

  if (filter.excludeSelf && sourceCard && card.instanceId && card.instanceId === sourceCard.instanceId) {
    return false;
  }

  if (filter.excludeId) {
    const excluded = Array.isArray(filter.excludeId) ? filter.excludeId : [filter.excludeId];
    if (excluded.includes(card.id)) return false;
  }

  if (filter.id) {
    const ids = Array.isArray(filter.id) ? filter.id : [filter.id];
    if (!ids.includes(card.id)) return false;
  }

  if (filter.name) {
    const names = Array.isArray(filter.name) ? filter.name : [filter.name];
    if (!names.includes(card.name)) return false;
  }

  if (filter.nameIncludes) {
    const terms = Array.isArray(filter.nameIncludes) ? filter.nameIncludes : [filter.nameIncludes];
    const haystack = `${card.name || ''} ${card.nameTh || ''} ${card.archetype || ''} ${(card.subArchetypes || []).join(' ')}`.toLowerCase();
    const matched = terms.some(t => haystack.includes(String(t).toLowerCase()));
    if (!matched) return false;
  }

  if (filter.archetype) {
    const arcs = Array.isArray(filter.archetype) ? filter.archetype : [filter.archetype];
    const cardArcs = [card.archetype, ...(card.subArchetypes || [])].filter(Boolean).map(a => a.toLowerCase());
    const nameLower = (card.name || '').toLowerCase();
    const matched = arcs.some(targetArc => {
      const low = targetArc.toLowerCase();
      return cardArcs.includes(low) || nameLower.includes(low);
    });
    if (!matched) return false;
  }

  if (filter.mentions) {
    const mentionsTarget = Array.isArray(filter.mentions) ? filter.mentions : [filter.mentions];
    const cardMentions = (card.mentions || []).map(m => m.toLowerCase());
    const descLower = `${card.description || ''} ${card.descriptionTh || ''} ${card.name || ''}`.toLowerCase();
    const matched = mentionsTarget.some(m => {
      const low = m.toLowerCase();
      return cardMentions.includes(low) || descLower.includes(low);
    });
    if (!matched) return false;
  }

  if (filter.kind) {
    const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
    if (!kinds.includes(card.kind)) return false;
  }

  if (filter.frame) {
    const frames = Array.isArray(filter.frame) ? filter.frame : [filter.frame];
    if (!frames.includes(card.frame)) return false;
  }

  if (filter.notFrame) {
    const notFrames = Array.isArray(filter.notFrame) ? filter.notFrame : [filter.notFrame];
    if (notFrames.includes(card.frame)) return false;
  }

  if (filter.subType) {
    const subTypes = Array.isArray(filter.subType) ? filter.subType : [filter.subType];
    if (!subTypes.includes(card.subType)) return false;
  }

  if (filter.attribute) {
    const attrs = Array.isArray(filter.attribute) ? filter.attribute : [filter.attribute];
    if (!attrs.includes(card.attribute)) return false;
  }

  if (filter.notAttribute) {
    const notAttrs = Array.isArray(filter.notAttribute) ? filter.notAttribute : [filter.notAttribute];
    if (notAttrs.includes(card.attribute)) return false;
  }

  if (filter.race) {
    const races = Array.isArray(filter.race) ? filter.race : [filter.race];
    if (!races.includes(card.race)) return false;
  }

  if (filter.notRace) {
    const notRaces = Array.isArray(filter.notRace) ? filter.notRace : [filter.notRace];
    if (notRaces.includes(card.race)) return false;
  }

  if (filter.zone) {
    const zones = Array.isArray(filter.zone) ? filter.zone : [filter.zone];
    if (!zones.includes(card.zone)) return false;
  }

  if (filter.linkRating !== undefined) {
    const ratings = Array.isArray(filter.linkRating) ? filter.linkRating : [filter.linkRating];
    if (!ratings.includes(card.linkRating || 0)) return false;
  }
  if (filter.linkRatingMax !== undefined && (card.linkRating || 0) > filter.linkRatingMax) return false;

  if (typeof filter.isTuner === 'boolean') {
    if (Boolean(card.isTuner) !== filter.isTuner) return false;
  }

  if (typeof filter.isRitual === 'boolean') {
    if (Boolean(card.isRitual) !== filter.isRitual) return false;
  }

  const effectiveLevel = card.currentLevel ?? card.level ?? card.rank ?? 0;
  if (filter.level !== undefined) {
    const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
    if (!levels.includes(effectiveLevel)) return false;
  }
  if (filter.levelMin !== undefined && effectiveLevel < filter.levelMin) return false;
  if (filter.levelMax !== undefined && effectiveLevel > filter.levelMax) return false;

  const effectiveAtk = card.currentAtk ?? card.atk ?? 0;
  if (filter.atkMin !== undefined && effectiveAtk < filter.atkMin) return false;
  if (filter.atkMax !== undefined && effectiveAtk > filter.atkMax) return false;

  const effectiveDef = card.currentDef ?? card.def ?? 0;
  if (filter.defMin !== undefined && effectiveDef < filter.defMin) return false;
  if (filter.defMax !== undefined && effectiveDef > filter.defMax) return false;

  if (filter.faceUp !== undefined) {
    const isFaceUp = card.position !== 'SET' && card.position !== 'SET_DEF';
    if (isFaceUp !== filter.faceUp) return false;
  }

  if (filter.position) {
    const positions = Array.isArray(filter.position) ? filter.position : [filter.position];
    if (!positions.includes(card.position)) return false;
  }

  if (filter.canBeNegated) {
    const isFaceUp = card.position !== 'SET' && card.position !== 'SET_DEF';
    if (!isFaceUp || card.effectsNegated) return false;
  }

  return true;
}

/**
 * ตรวจสอบความถูกต้องของข้อมูลการ์ด 1 ใบ (Schema Validator)
 * คืนค่า { valid: boolean, errors: string[] }
 *
 * @param {Object} card
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCardSchema(card) {
  const errors = [];

  if (!card || typeof card !== 'object') {
    return { valid: false, errors: ['Card definition must be an object'] };
  }

  if (!card.id || typeof card.id !== 'string') {
    errors.push('Missing or invalid `id` (string required, e.g. "blue_eyes_white_dragon")');
  }
  if (!card.name || typeof card.name !== 'string') {
    errors.push(`Card "${card.id || '?'}" is missing \`name\` (English official card name)`);
  }
  if (!card.nameTh || typeof card.nameTh !== 'string') {
    errors.push(`Card "${card.id || '?'}" is missing \`nameTh\` (Thai card name)`);
  }
  if (!card.kind || !Object.values(CARD_KINDS).includes(card.kind)) {
    errors.push(`Card "${card.id || '?'}" has invalid \`kind\`: "${card.kind}". Must be one of: ${Object.values(CARD_KINDS).join(', ')}`);
  }

  if (card.kind === CARD_KINDS.MONSTER || card.kind === CARD_KINDS.TOKEN) {
    if (!card.frame || !Object.values(MONSTER_FRAMES).includes(card.frame)) {
      errors.push(`Monster "${card.id}" has invalid \`frame\`: "${card.frame}". Must be one of: ${Object.values(MONSTER_FRAMES).join(', ')}`);
    }
    if (!card.attribute || !Object.values(ATTRIBUTES).includes(card.attribute)) {
      errors.push(`Monster "${card.id}" has invalid \`attribute\`: "${card.attribute}". Must be one of: ${Object.values(ATTRIBUTES).join(', ')}`);
    }
    if (!card.race || typeof card.race !== 'string') {
      errors.push(`Monster "${card.id}" is missing \`race\` (e.g. "Dragon", "Spellcaster", "Warrior")`);
    }
    if (typeof card.atk !== 'number' || card.atk < 0) {
      errors.push(`Monster "${card.id}" must have numeric \`atk\` >= 0`);
    }
    if (card.frame !== MONSTER_FRAMES.LINK && (typeof card.def !== 'number' || card.def < 0)) {
      errors.push(`Non-Link Monster "${card.id}" must have numeric \`def\` >= 0`);
    }
    if (card.frame === MONSTER_FRAMES.XYZ) {
      if (typeof card.rank !== 'number' || card.rank < 1 || card.rank > 13) {
        errors.push(`Xyz Monster "${card.id}" must have numeric \`rank\` (1-13)`);
      }
    } else if (card.frame === MONSTER_FRAMES.LINK) {
      if (typeof card.linkRating !== 'number' || card.linkRating < 1 || card.linkRating > 6) {
        errors.push(`Link Monster "${card.id}" must have numeric \`linkRating\` (1-6)`);
      }
    } else {
      if (typeof card.level !== 'number' || card.level < 1 || card.level > 12) {
        errors.push(`Monster "${card.id}" must have numeric \`level\` (1-12)`);
      }
    }
  } else if (card.kind === CARD_KINDS.SPELL) {
    if (!card.subType || !Object.values(SPELL_SUBTYPES).includes(card.subType)) {
      errors.push(`Spell "${card.id}" has invalid \`subType\`: "${card.subType}". Must be one of: ${Object.values(SPELL_SUBTYPES).join(', ')}`);
    }
  } else if (card.kind === CARD_KINDS.TRAP) {
    if (!card.subType || !Object.values(TRAP_SUBTYPES).includes(card.subType)) {
      errors.push(`Trap "${card.id}" has invalid \`subType\`: "${card.subType}". Must be one of: ${Object.values(TRAP_SUBTYPES).join(', ')}`);
    }
  }

  if (!card.descriptionTh || typeof card.descriptionTh !== 'string') {
    errors.push(`Card "${card.id}" is missing \`descriptionTh\` (Thai effect explanation)`);
  }

  if (Array.isArray(card.effects)) {
    card.effects.forEach((eff, idx) => {
      if (!eff.id) {
        errors.push(`Card "${card.id}" effect[${idx}] is missing \`id\``);
      }
      if (!eff.trigger || !Object.values(TRIGGERS).includes(eff.trigger)) {
        errors.push(`Card "${card.id}" effect[${idx}] has invalid \`trigger\`: "${eff.trigger}"`);
      }
      if (Array.isArray(eff.actions)) {
        eff.actions.forEach((act, aIdx) => {
          if (!act.type || !Object.values(ACTION_TYPES).includes(act.type)) {
            errors.push(`Card "${card.id}" effect[${idx}] action[${aIdx}] has invalid \`type\`: "${act.type}"`);
          }
        });
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
