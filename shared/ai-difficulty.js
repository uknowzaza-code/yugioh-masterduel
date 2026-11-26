export const AI_DIFFICULTY = Object.freeze({ EASY: 'easy', NORMAL: 'normal', HARD: 'hard' });
export const AI_DIFFICULTY_LIST = Object.freeze([AI_DIFFICULTY.EASY, AI_DIFFICULTY.NORMAL, AI_DIFFICULTY.HARD]);
export const DEFAULT_AI_DIFFICULTY = AI_DIFFICULTY.NORMAL;

export function isValidDifficulty(value) {
  return AI_DIFFICULTY_LIST.includes(String(value ?? '').trim().toLowerCase());
}

export function normalizeDifficulty(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return AI_DIFFICULTY_LIST.includes(key) ? key : DEFAULT_AI_DIFFICULTY;
}

export const AI_I18N = Object.freeze({
  th: {
    panelTitle: 'ดวลเดี่ยวกับ AI',
    pickDifficulty: 'เลือกระดับความยากของ AI',
    start: 'เริ่มดูเอล',
    starting: 'กำลังเตรียมดูเอล…',
    botName: 'ดูเอลบอท',
    levelPrefix: 'ระดับ',
    errors: {
      NO_DECK: 'กรุณาเลือกเด็คก่อนเริ่มเกม',
      BAD_DIFFICULTY: 'ระดับความยากไม่ถูกต้อง',
      SERVER: 'เริ่มดูเอลไม่สำเร็จ กรุณาลองใหม่',
    },
    levels: {
      easy: { label: 'ง่าย', desc: 'เล่นสบาย ๆ เหมาะกับมือใหม่ หมอบการ์ดน้อย ไม่ค่อยขัดจังหวะ' },
      normal: { label: 'ปานกลาง', desc: 'เล่นเป็นระบบ ไม่โจมตีแบบเสียเปรียบ ตั้งรับและหมอบการ์ดสำรอง' },
      hard: { label: 'ยาก', desc: 'ระดับแข่งขัน: คำนวณ Lethal เล่นคอมโบเป็นลำดับ ถือ Hand Trap รอจังหวะสำคัญ' },
    },
  },
  en: {
    panelTitle: 'Solo Duel vs AI',
    pickDifficulty: 'Choose AI difficulty',
    start: 'Start Duel',
    starting: 'Preparing duel…',
    botName: 'Duel Bot',
    levelPrefix: 'Level',
    errors: {
      NO_DECK: 'Please select a deck first',
      BAD_DIFFICULTY: 'Invalid difficulty',
      SERVER: 'Could not start the duel. Please try again.',
    },
    levels: {
      easy: { label: 'Easy', desc: 'Relaxed play for beginners. Sets few cards and rarely interrupts.' },
      normal: { label: 'Normal', desc: 'Plays systematically, avoids bad attacks, defends and sets backrow.' },
      hard: { label: 'Hard', desc: 'Competitive: checks lethal, sequences combos, holds hand traps for key moments.' },
    },
  },
});

export const i18n = (lang) => AI_I18N[lang] ?? AI_I18N.en;

export function aiDisplayName(difficulty, lang = 'en') {
  const s = i18n(lang);
  return `${s.botName} · ${s.levels[normalizeDifficulty(difficulty)].label}`;
}
