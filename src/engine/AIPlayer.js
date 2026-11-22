/**
 * @fileoverview Master Duel Tactical AI Bot (`AIPlayer`)
 * บอท AI อัจฉริยะที่สามารถเล่นได้ทุกเด็คในระบบ (รวมถึงการ์ดใหม่ที่ AI ตัวอื่นจะเพิ่มเข้ามาในอนาคต)
 * เพราะประเมินจาก `engine.getLegalActions(aiIndex)` โดยตรง!
 */

import { PHASES, POSITIONS } from '../constants/gameConstants.js';

export class AIPlayer {
  /**
   * คำนวณแอคชั่นถัดไปที่ดีที่สุดสำหรับ AI (1 ก้าวต่อการเรียก เพื่อให้ UI แสดงแอนิเมชันทีละจังหวะอย่างเป็นธรรมชาติ)
   * @param {Object} engine - DuelEngine instance
   * @param {number} aiIndex - 0 หรือ 1 (ปกติคือ 1)
   * @returns {Object|null} payload สำหรับส่งเข้า `engine.executeAction(aiIndex, payload)`
   */
  static chooseNextAction(engine, aiIndex = 1) {
    if (!engine.state || engine.state.winner !== null) return null;

    const legal = engine.getLegalActions(aiIndex);
    const aiPlayer = engine.state.players[aiIndex];
    const oppPlayer = engine.state.players[1 - aiIndex];

    // 1. Handle Chain Response Window (if AI is prompted to chain)
    if (legal.canChainRespond && legal.chainPrompt) {
      const options = (legal.chainPrompt.respondableCards || []).filter(o => !o.isManualFallback);
      if (options.length > 0) {
        const picked = options[0];
        return {
          type: 'CHAIN_RESPONSE',
          respond: true,
          instanceId: picked.instanceId,
          effectId: picked.effectId
        };
      }
      return {
        type: 'CHAIN_RESPONSE',
        respond: false
      };
    }

    if (engine.state.turnPlayer !== aiIndex) return null;

    // 2. Main Phase 1 & Main Phase 2 Decisions
    if (engine.state.phase === PHASES.MP1 || engine.state.phase === PHASES.MP2) {
      // 2a. Activate Graveyard effects first (free value)
      for (const [instanceId, actList] of Object.entries(legal.gyActions)) {
        const effAct = actList.find(a => a.type === 'ACTIVATE_EFFECT' && !a.isManualFallback);
        if (effAct) {
          return {
            type: 'ACTIVATE_EFFECT',
            instanceId,
            effectId: effAct.effectId
          };
        }
      }

      // 2b. Activate Spells & Hand Ignition effects (Searchers, Fusions, Reborns)
      for (const [instanceId, actList] of Object.entries(legal.handActions)) {
        const card = aiPlayer.hand.find(c => c.instanceId === instanceId);
        if (!card) continue;
        // Don't waste hand traps (Ash / Veiler / Impermanence) proactively on own turn
        if (['ash_blossom', 'effect_veiler', 'infinite_impermanence', 'called_by_the_grave'].includes(card.id)) {
          continue;
        }
        const effAct = actList.find(a => a.type === 'ACTIVATE_EFFECT' && !a.isManualFallback);
        if (effAct) {
          return {
            type: 'ACTIVATE_EFFECT',
            instanceId,
            effectId: effAct.effectId
          };
        }
      }

      // 2c. Inherent Special Summons from Hand
      for (const [instanceId, actList] of Object.entries(legal.handActions)) {
        const ssAct = actList.find(a => a.type === 'INHERENT_SPECIAL_SUMMON');
        if (ssAct) {
          return {
            type: 'INHERENT_SPECIAL_SUMMON',
            instanceId
          };
        }
      }

      // 2d. Normal Summon strongest or combo-starter monster from Hand
      const nsCandidates = [];
      for (const [instanceId, actList] of Object.entries(legal.handActions)) {
        const nsAct = actList.find(a => a.type === 'NORMAL_SUMMON');
        if (nsAct) {
          const card = aiPlayer.hand.find(c => c.instanceId === instanceId);
          if (card && !['ash_blossom', 'maxx_c', 'effect_veiler'].includes(card.id)) {
            // Avoid tributing a monster that already has >= ATK than the tribute monster
            if (nsAct.tributesRequired > 0) {
              const fieldMons = engine.getPlayerFieldMonsters(aiIndex);
              const weakestFieldAtk = Math.min(...fieldMons.map(m => m.currentAtk ?? 0));
              if (weakestFieldAtk >= (card.atk ?? 0)) continue;
            }
            nsCandidates.push({ card, nsAct });
          }
        }
      }
      if (nsCandidates.length > 0) {
        // Prefer monsters with ON_NORMAL_SUMMON / ON_SUMMON_ANY effects, then highest ATK
        nsCandidates.sort((a, b) => {
          const aHasEff = (a.card.effects || []).length > 0 ? 1000 : 0;
          const bHasEff = (b.card.effects || []).length > 0 ? 1000 : 0;
          return (bHasEff + (b.card.atk || 0)) - (aHasEff + (a.card.atk || 0));
        });
        return {
          type: 'NORMAL_SUMMON',
          instanceId: nsCandidates[0].card.instanceId
        };
      }

      // 2e. Activate Field Monster & Continuous Spell/Trap Effects
      for (const [instanceId, actList] of Object.entries(legal.fieldActions)) {
        const mon = engine.findCardInstance(instanceId)?.card;
        // Don't tribute Blue-Eyes Spirit Dragon immediately unless needed
        if (mon?.id === 'blue_eyes_spirit_dragon') continue;
        // Don't tribute Raye if she already attacked or if we want to Link summon normally
        if (mon?.id === 'sky_striker_ace_raye' && Object.keys(legal.extraActions).length > 0) continue;

        const effAct = actList.find(a => a.type === 'ACTIVATE_EFFECT' && !a.isManualFallback);
        if (effAct) {
          return {
            type: 'ACTIVATE_EFFECT',
            instanceId,
            effectId: effAct.effectId
          };
        }
      }

      // 2f. Extra Deck Summon (Synchro, Xyz, Link) if it improves board or triggers effects
      const extraCandidates = [];
      for (const [instanceId, actList] of Object.entries(legal.extraActions)) {
        const exAct = actList.find(a => a.type === 'EXTRA_DECK_SUMMON');
        if (exAct) {
          const exCard = aiPlayer.extra.find(c => c.instanceId === instanceId);
          if (exCard) {
            // Avoid Link-1 loop if we already summoned a Link-1 with same ATK and no more OPT
            const anyOptUsed = (exCard.effects || []).some(e => e.opt && aiPlayer.optUsed.includes(e.opt));
            if (!anyOptUsed) {
              extraCandidates.push(exCard);
            }
          }
        }
      }
      if (extraCandidates.length > 0) {
        extraCandidates.sort((a, b) => (b.atk || 0) - (a.atk || 0));
        return {
          type: 'EXTRA_DECK_SUMMON',
          instanceId: extraCandidates[0].instanceId,
          combinationIndex: 0
        };
      }

      // 2g. Set Traps or Quick-Play Spells in Main Phase before ending
      for (const [instanceId, actList] of Object.entries(legal.handActions)) {
        const card = aiPlayer.hand.find(c => c.instanceId === instanceId);
        if (!card) continue;
        if (card.kind === 'TRAP' || card.subType === 'QUICK_PLAY') {
          const setAct = actList.find(a => a.type === 'SET_SPELL_TRAP');
          if (setAct) {
            return {
              type: 'SET_SPELL_TRAP',
              instanceId
            };
          }
        }
      }

      // Move to Battle Phase (if MP1 and turn > 1 and AI controls ATK monsters) or End Phase
      if (engine.state.phase === PHASES.MP1 && engine.state.turnCount > 1) {
        const atkMons = engine.getPlayerFieldMonsters(aiIndex).filter(m => m.position === POSITIONS.ATK && (m.currentAtk ?? 0) > 0);
        if (atkMons.length > 0) {
          return { type: 'CHANGE_PHASE', targetPhase: PHASES.BP };
        }
      }

      return { type: 'CHANGE_PHASE', targetPhase: PHASES.EP };
    }

    // 3. Battle Phase Decisions
    if (engine.state.phase === PHASES.BP) {
      const oppMonsters = engine.getPlayerFieldMonsters(1 - aiIndex);

      for (const [attackerId, info] of Object.entries(legal.attackTargets)) {
        const attacker = engine.findCardInstance(attackerId)?.card;
        if (!attacker) continue;
        const myAtk = attacker.currentAtk ?? attacker.atk ?? 0;
        if (myAtk <= 0) continue;

        if (info.canDirectAttack && oppMonsters.length === 0) {
          return {
            type: 'DECLARE_ATTACK',
            attackerInstanceId: attackerId,
            directAttack: true
          };
        }

        // Find an opponent monster we can beat or tie if beneficial
        const beatableTargets = oppMonsters.filter(m => {
          if (m.position === POSITIONS.ATK) {
            return myAtk >= (m.currentAtk ?? 0);
          }
          if (m.position === POSITIONS.DEF) {
            return myAtk > (m.currentDef ?? 0);
          }
          // Face-down defense: attack if myAtk >= 1500
          return myAtk >= 1500;
        });

        if (beatableTargets.length > 0) {
          // Attack highest value target we can beat
          beatableTargets.sort((a, b) => (b.currentAtk ?? 0) - (a.currentAtk ?? 0));
          return {
            type: 'DECLARE_ATTACK',
            attackerInstanceId: attackerId,
            targetInstanceId: beatableTargets[0].instanceId
          };
        }

        if (info.canDirectAttack) {
          return {
            type: 'DECLARE_ATTACK',
            attackerInstanceId: attackerId,
            directAttack: true
          };
        }
      }

      // No more profitable attacks -> go to MP2 or EP
      return { type: 'CHANGE_PHASE', targetPhase: PHASES.MP2 };
    }

    return { type: 'CHANGE_PHASE', targetPhase: PHASES.EP };
  }
}
