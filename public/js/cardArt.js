/**
 * @fileoverview Card Visual Renderer, Frame Styling & Artwork Resolver
 * รองรับการดึงภาพการ์ดจริงจากฐานข้อมูล YGOPRODeck ด้วยรหัส Passcode
 * และมีระบบสร้างภาพ SVG แบบ Procedural อัตโนมัติเมื่อเล่นแบบออฟไลน์หรือเป็นการ์ดใหม่ที่ AI สร้างขึ้น!
 */

const ATTRIBUTE_THEMES = {
  LIGHT: { bg1: '#facc15', bg2: '#38bdf8', badge: '光', color: '#fef08a' },
  DARK: { bg1: '#7e22ce', bg2: '#1e1b4b', badge: '闇', color: '#e9d5ff' },
  FIRE: { bg1: '#ef4444', bg2: '#9a3412', badge: '炎', color: '#fecaca' },
  WATER: { bg1: '#0284c7', bg2: '#0f172a', badge: '水', color: '#bae6fd' },
  WIND: { bg1: '#10b981', bg2: '#064e3b', badge: '風', color: '#a7f3d0' },
  EARTH: { bg1: '#d97706', bg2: '#451a03', badge: '地', color: '#fde68a' },
  DIVINE: { bg1: '#fbbf24', bg2: '#78350f', badge: '神', color: '#fef3c7' }
};

/**
 * สร้าง SVG Data URI สำหรับเป็นภาพประกอบการ์ด (Fallback & Custom AI Cards)
 */
export function generateProceduralCardSvg(card) {
  let bg1 = '#334155';
  let bg2 = '#0f172a';
  let symbol = '✦';

  const st = card.subType || card.subtype;
  if (card.kind === 'SPELL') {
    bg1 = '#0d9488';
    bg2 = '#042f2e';
    symbol = st === 'QUICK_PLAY' ? '⚡' : st === 'CONTINUOUS' ? '∞' : st === 'FIELD' ? '❖' : '✦';
  } else if (card.kind === 'TRAP') {
    bg1 = '#be185d';
    bg2 = '#4c0519';
    symbol = st === 'COUNTER' ? '⮌' : st === 'CONTINUOUS' ? '∞' : '⚠';
  } else {
    const theme = ATTRIBUTE_THEMES[card.attribute] || ATTRIBUTE_THEMES.DARK;
    bg1 = theme.bg1;
    bg2 = theme.bg2;
    symbol = card.race === 'Dragon' ? '🐉'
      : card.race === 'Spellcaster' ? '🪄'
      : card.race === 'Warrior' ? '⚔️'
      : card.race === 'Wyrm' ? '🐲'
      : card.race === 'Machine' ? '🤖'
      : '★';
  }

  const shortTitle = (card.nameTh || card.name || 'Card').slice(0, 14).replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <defs>
      <radialGradient id="g" cx="50%" cy="40%" r="65%">
        <stop offset="0%" stop-color="${bg1}"/>
        <stop offset="100%" stop-color="${bg2}"/>
      </radialGradient>
    </defs>
    <rect width="200" height="200" fill="url(#g)"/>
    <circle cx="100" cy="95" r="64" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="3" stroke-dasharray="8 5"/>
    <circle cx="100" cy="95" r="46" fill="rgba(0,0,0,0.28)" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>
    <text x="100" y="112" text-anchor="middle" font-size="48" fill="#ffffff">${symbol}</text>
    <text x="100" y="182" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="13" fill="rgba(255,255,255,0.85)">${shortTitle}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * คืนค่า URL ภาพการ์ดจริง (YGOPRODeck cropped art) หรือ Procedural SVG
 */
export function getCardArtUrl(card) {
  if (!card) return '';
  if (card.artUrl) return card.artUrl;
  if (card.passcode) {
    const normalizedPasscode = /^\d+$/.test(String(card.passcode))
      ? String(Number(card.passcode))
      : String(card.passcode);
    return `https://images.ygoprodeck.com/images/cards_cropped/${normalizedPasscode}.jpg`;
  }
  return generateProceduralCardSvg(card);
}

/**
 * คืนค่า CSS Class ของกรอบการ์ดตามชนิดของการ์ดจริงใน Yu-Gi-Oh!
 */
export function getCardFrameClass(card) {
  if (!card) return 'frame-effect';
  if (card.kind === 'SPELL') return 'frame-spell';
  if (card.kind === 'TRAP') return 'frame-trap';
  switch (card.frame) {
    case 'NORMAL': return 'frame-normal';
    case 'RITUAL': return 'frame-ritual';
    case 'FUSION': return 'frame-fusion';
    case 'SYNCHRO': return 'frame-synchro';
    case 'XYZ': return 'frame-xyz';
    case 'LINK': return 'frame-link';
    case 'TOKEN': return 'frame-token';
    default: return 'frame-effect';
  }
}

/**
 * คืนค่าป้ายแสดง Level / Rank / Link หรือชนิดเวท/กับดัก
 */
export function getCardSubHeaderBadge(card, lang = 'th') {
  if (!card) return '';
  if (card.kind === 'SPELL') {
    const subMap = lang === 'en'
      ? {
          NORMAL: 'Normal Spell',
          QUICK_PLAY: 'Quick-Play ⚡',
          CONTINUOUS: 'Continuous ∞',
          EQUIP: 'Equip ✚',
          FIELD: 'Field Spell ❖',
          RITUAL: 'Ritual 🕯️'
        }
      : {
          NORMAL: 'เวทมนตร์ปกติ',
          QUICK_PLAY: 'เวทความเร็วสูง ⚡',
          CONTINUOUS: 'เวทต่อเนื่อง ∞',
          EQUIP: 'เวทสวมใส่ ✚',
          FIELD: 'เวทสนาม ❖',
          RITUAL: 'เวทพิธีกรรม 🕯️'
        };
    return subMap[card.subType || card.subtype] || 'SPELL CARD';
  }
  if (card.kind === 'TRAP') {
    const subMap = lang === 'en'
      ? {
          NORMAL: 'Normal Trap',
          CONTINUOUS: 'Continuous Trap ∞',
          COUNTER: 'Counter Trap ⮌'
        }
      : {
          NORMAL: 'กับดักปกติ',
          CONTINUOUS: 'กับดักต่อเนื่อง ∞',
          COUNTER: 'กับดักเคาน์เตอร์ ⮌'
        };
    return subMap[card.subType || card.subtype] || 'TRAP CARD';
  }
  if (card.frame === 'XYZ') {
    return `★ Rank ${card.rank}`;
  }
  if (card.frame === 'LINK') {
    return `LINK-${card.linkRating}`;
  }
  const lv = card.currentLevel ?? card.level ?? 4;
  return `${card.isTuner ? (lang === 'en' ? '🎵 Tuner ' : '🎵 จูนเนอร์ ') : ''}★ Lv.${lv}`;
}

/**
 * คืนค่าธาตุการ์ด (Attribute Kanji, สี, ชื่อ) สำหรับแสดงบนการ์ดและหน้า Inspector
 */
export function getAttributeMeta(card) {
  if (!card) return { badge: '?', color: '#cbd5e1', bg: '#334155', nameTh: '-', nameEn: '-' };
  if (card.kind === 'SPELL') {
    return { badge: '魔', color: '#a7f3d0', bg: '#047857', nameTh: 'เวทมนตร์', nameEn: 'SPELL' };
  }
  if (card.kind === 'TRAP') {
    return { badge: '罠', color: '#fbcfe8', bg: '#be185d', nameTh: 'กับดัก', nameEn: 'TRAP' };
  }
  const attrMap = {
    LIGHT: { badge: '光', color: '#fef08a', bg: '#ca8a04', nameTh: 'แสง', nameEn: 'LIGHT' },
    DARK: { badge: '闇', color: '#e9d5ff', bg: '#6b21a8', nameTh: 'มืด', nameEn: 'DARK' },
    FIRE: { badge: '炎', color: '#fecaca', bg: '#b91c1c', nameTh: 'ไฟ', nameEn: 'FIRE' },
    WATER: { badge: '水', color: '#bae6fd', bg: '#0369a1', nameTh: 'น้ำ', nameEn: 'WATER' },
    WIND: { badge: '風', color: '#a7f3d0', bg: '#059669', nameTh: 'ลม', nameEn: 'WIND' },
    EARTH: { badge: '地', color: '#fde68a', bg: '#92400e', nameTh: 'ดิน', nameEn: 'EARTH' },
    DIVINE: { badge: '神', color: '#fef3c7', bg: '#d97706', nameTh: 'เทพ', nameEn: 'DIVINE' }
  };
  return attrMap[card.attribute] || attrMap.DARK;
}

/**
 * สร้าง SVG หลังการ์ด Yu-Gi-Oh! (ซุ้มวงรีสีดำ-น้ำตาลทอง หรือม่วงสำหรับ Extra Deck)
 */
export function getCardBackSvgUrl(isExtraDeck = false) {
  const outer1 = isExtraDeck ? '#3b0764' : '#5b2b15';
  const outer2 = isExtraDeck ? '#1e1b4b' : '#2d1208';
  const rim = isExtraDeck ? '#c084fc' : '#d97706';
  const vortex = isExtraDeck ? '#4c1d95' : '#451a03';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 118 172">
    <defs>
      <radialGradient id="cbGrad" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stop-color="${outer1}"/>
        <stop offset="100%" stop-color="${outer2}"/>
      </radialGradient>
      <radialGradient id="vortexGrad" cx="50%" cy="50%" r="55%">
        <stop offset="0%" stop-color="#020617"/>
        <stop offset="68%" stop-color="#090d16"/>
        <stop offset="100%" stop-color="${vortex}"/>
      </radialGradient>
    </defs>
    <rect width="118" height="172" rx="7" fill="url(#cbGrad)" stroke="${rim}" stroke-width="4"/>
    <rect x="9" y="9" width="100" height="154" rx="4" fill="none" stroke="rgba(250,204,21,0.42)" stroke-width="1.5"/>
    <ellipse cx="59" cy="86" rx="34" ry="54" fill="url(#vortexGrad)" stroke="${rim}" stroke-width="2.5"/>
    <ellipse cx="59" cy="86" rx="26" ry="44" fill="none" stroke="rgba(250,204,21,0.22)" stroke-width="1"/>
  </svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}
