import { AI_DIFFICULTY, normalizeDifficulty } from '../../shared/ai-difficulty.js';

export { AI_DIFFICULTY, normalizeDifficulty };

export const PROFILES = Object.freeze({
  easy: Object.freeze({
    id: 'easy',
    blunderRate: 0.15,            // โอกาสเลือกพลาดเล็กน้อย (เช่น ลำดับสังเวย)
    attackTolerance: 0,           // ห้ามตีตัวที่แรงกว่าจนตายเองเด็ดขาด
    unknownDefEstimate: 1200,
    battleStrategy: 'loose',
    idleStrategy: 'simple',
    idleJitter: 30,               // สุ่มลำดับการเล่นบ้าง
    setSpellTrapChance: 0.3,      // 30% ของเทิร์นจะยอมหมอบ
    maxSetsPerTurn: 1,
    maxActionsPerTurn: 8,
    chainStrategy: 'eager',       // เปิดเชนแบบสุ่ม ไม่เก็บไว้
    chainActivateChance: 0.35,
    chainDangerThreshold: Infinity,
    targetStrategy: 'random-opponent',
    costStrategy: 'atk',
    positionStrategy: 'basic',
    placeStrategy: 'first',
    sumStrategy: 'first',
    thinkDelayMs: 700,
  }),
  normal: Object.freeze({
    id: 'normal',
    blunderRate: 0,
    attackTolerance: 0,
    unknownDefEstimate: 1500,
    battleStrategy: 'greedy',     // ตีเฉพาะที่ชนะแน่ ไม่แลก
    idleStrategy: 'systematic',   // Spell ค้นหา → Summon → Extra → Set
    idleJitter: 0,
    setSpellTrapChance: 1,
    maxSetsPerTurn: 3,
    maxActionsPerTurn: 16,
    chainStrategy: 'threshold',
    chainActivateChance: 1,
    chainDangerThreshold: 40,
    targetStrategy: 'highest-atk',
    costStrategy: 'atk',
    positionStrategy: 'safe',
    placeStrategy: 'center',
    sumStrategy: 'min-atk',
    thinkDelayMs: 450,
  }),
  hard: Object.freeze({
    id: 'hard',
    blunderRate: 0,
    attackTolerance: 0,
    unknownDefEstimate: 1800,
    battleStrategy: 'search',     // Lethal + ค้นหาแผนโจมตีที่คุ้มที่สุด
    idleStrategy: 'combo',        // Starter → Searcher → Extender → Extra Boss
    idleJitter: 0,
    setSpellTrapChance: 1,
    maxSetsPerTurn: 5,
    maxActionsPerTurn: 32,
    chainStrategy: 'conserve',    // ถือ Hand Trap ไว้ใช้กับเอฟเฟกต์อันตรายจริง และเลือกใบที่ตรงที่สุด
    chainActivateChance: 1,
    chainDangerThreshold: 70,
    targetStrategy: 'threat',
    costStrategy: 'value',
    positionStrategy: 'tactical',
    placeStrategy: 'tactical',
    sumStrategy: 'min-value',
    thinkDelayMs: 300,
  }),
});

export function getProfile(difficulty) {
  return PROFILES[normalizeDifficulty(difficulty)];
}
