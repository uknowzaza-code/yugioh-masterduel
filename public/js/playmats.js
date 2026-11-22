/**
 * @fileoverview Playmat Theme Registry & Procedural Master Duel Field Textures
 * มีสนามให้เลือก 5 ธีม รวมถึงธีมซากวิหารโบราณ (Ancient Ruins) ตามแบบต้นฉบับใน Yu-Gi-Oh! Master Duel
 */

export const PLAYMATS = [
  {
    id: 'ruins',
    cssClass: 'playmat-ruins',
    nameTh: 'ซากวิหารโบราณ',
    nameEn: 'Ancient Forest Ruins',
    icon: '🏛️',
    swatch: 'linear-gradient(135deg, #4d6b2d, #6b6b5c)',
    borderAccent: '#eab308'
  },
  {
    id: 'cyber',
    cssClass: 'playmat-cyber',
    nameTh: 'วิหารไซเบอร์บลูอายส์',
    nameEn: 'Cyber Sanctuary',
    icon: '💠',
    swatch: 'linear-gradient(135deg, #0284c7, #0f172a)',
    borderAccent: '#38bdf8'
  },
  {
    id: 'arcane',
    cssClass: 'playmat-arcane',
    nameTh: 'วงแหวนจอมเวทดำ',
    nameEn: 'Arcane Spell Circle',
    icon: '🔮',
    swatch: 'linear-gradient(135deg, #7e22ce, #1e1b4b)',
    borderAccent: '#c084fc'
  },
  {
    id: 'swordsoul',
    cssClass: 'playmat-swordsoul',
    nameTh: 'ยอดเขาโซวซูลหยก',
    nameEn: 'Swordsoul Jade Peak',
    icon: '🏔️',
    swatch: 'linear-gradient(135deg, #0f766e, #134e4a)',
    borderAccent: '#2dd4bf'
  },
  {
    id: 'crimson',
    cssClass: 'playmat-crimson',
    nameTh: 'อเวจีตราบาปสีชาด',
    nameEn: 'Branded Crimson Abyss',
    icon: '🔥',
    swatch: 'linear-gradient(135deg, #9f1239, #2a0a18)',
    borderAccent: '#fb7185'
  }
];

const STORAGE_KEY = 'ygo_md_playmat';

export function getSavedPlaymat() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return PLAYMATS.some((p) => p.id === saved) ? saved : 'ruins';
  } catch {
    return 'ruins';
  }
}

export function savePlaymat(playmatId) {
  try {
    localStorage.setItem(STORAGE_KEY, playmatId);
  } catch {
    // Ignore storage restriction
  }
}

export function getPlaymatById(playmatId) {
  return PLAYMATS.find((p) => p.id === playmatId) || PLAYMATS[0];
}

/**
 * สร้าง SVG พื้นหลังสนามดูเอลแบบ Master Duel โดยตรง (ไม่มีการเบลอ)
 */
export function getPlaymatBackgroundUrl(playmatId) {
  const id = getPlaymatById(playmatId).id;
  let svg = '';

  if (id === 'ruins') {
    // Iconic Master Duel Forest Ruins stone temple ground + moss + stone divider beam
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 680" preserveAspectRatio="none">
      <defs>
        <linearGradient id="mossGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#3b5323"/>
          <stop offset="50%" stop-color="#4e5d38"/>
          <stop offset="100%" stop-color="#2f3f1e"/>
        </linearGradient>
        <radialGradient id="sunGlow" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stop-color="rgba(163, 184, 98, 0.34)"/>
          <stop offset="100%" stop-color="rgba(18, 24, 14, 0.72)"/>
        </radialGradient>
        <linearGradient id="stoneWall" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#6b6e5e"/>
          <stop offset="50%" stop-color="#8b8c79"/>
          <stop offset="100%" stop-color="#5d6051"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="680" fill="url(#mossGrad)"/>
      <rect width="1200" height="680" fill="url(#sunGlow)"/>
      <!-- Moss clusters -->
      <ellipse cx="140" cy="180" rx="190" ry="120" fill="rgba(77,124,15,0.28)"/>
      <ellipse cx="1040" cy="490" rx="220" ry="140" fill="rgba(77,124,15,0.26)"/>
      <ellipse cx="260" cy="540" rx="160" ry="90" fill="rgba(101,163,13,0.20)"/>
      <ellipse cx="960" cy="140" rx="170" ry="100" fill="rgba(101,163,13,0.22)"/>
      <!-- Side temple pillars -->
      <rect x="0" y="0" width="24" height="680" fill="url(#stoneWall)"/>
      <rect x="1176" y="0" width="24" height="680" fill="url(#stoneWall)"/>
      <!-- Stone divider beam aligned behind EMZ row -->
      <rect x="24" y="330" width="1152" height="20" fill="#8f8d7b" opacity="0.65"/>
      <line x1="24" y1="330" x2="1176" y2="330" stroke="#e5e0c5" stroke-width="1.5" opacity="0.4"/>
      <line x1="24" y1="350" x2="1176" y2="350" stroke="#292524" stroke-width="2" opacity="0.5"/>
      <!-- Carved temple stone floor cracks -->
      <g stroke="rgba(28, 25, 23, 0.42)" stroke-width="2" fill="none">
        <path d="M180,100 L180,580 M390,100 L390,580 M600,100 L600,580 M810,100 L810,580 M1020,100 L1020,580"/>
        <path d="M100,220 L1100,220 M100,460 L1100,460"/>
      </g>
    </svg>`;
  } else if (id === 'cyber') {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 680" preserveAspectRatio="none">
      <defs>
        <radialGradient id="cbg" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stop-color="#0c4a6e"/>
          <stop offset="65%" stop-color="#09152b"/>
          <stop offset="100%" stop-color="#020617"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="680" fill="url(#cbg)"/>
      <g stroke="rgba(56, 189, 248, 0.18)" stroke-width="1.5" fill="none">
        <circle cx="600" cy="340" r="240"/>
        <circle cx="600" cy="340" r="165" stroke-dasharray="12 8"/>
        <line x1="0" y1="340" x2="1200" y2="340" stroke="rgba(56, 189, 248, 0.38)" stroke-width="2"/>
        <path d="M60,80 L220,80 L260,120 M1140,80 L980,80 L940,120 M60,600 L220,600 L260,560 M1140,600 L980,600 L940,560"/>
      </g>
    </svg>`;
  } else if (id === 'arcane') {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 680" preserveAspectRatio="none">
      <defs>
        <radialGradient id="abg" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stop-color="#4c1d95"/>
          <stop offset="60%" stop-color="#1e1b4b"/>
          <stop offset="100%" stop-color="#09061a"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="680" fill="url(#abg)"/>
      <g stroke="rgba(250, 204, 21, 0.24)" stroke-width="2" fill="none">
        <circle cx="600" cy="340" r="230"/>
        <circle cx="600" cy="340" r="195" stroke-dasharray="6 10"/>
        <polygon points="600,120 790,450 410,450" stroke="rgba(192,132,252,0.22)"/>
        <polygon points="600,560 790,230 410,230" stroke="rgba(192,132,252,0.22)"/>
        <line x1="20" y1="340" x2="1180" y2="340" stroke="rgba(250, 204, 21, 0.35)"/>
      </g>
    </svg>`;
  } else if (id === 'swordsoul') {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 680" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sbg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#042f2e"/>
          <stop offset="50%" stop-color="#0f3d3e"/>
          <stop offset="100%" stop-color="#062020"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="680" fill="url(#sbg)"/>
      <path d="M0,500 L180,320 L340,460 L540,260 L720,440 L920,290 L1200,500 L1200,680 L0,680 Z" fill="rgba(45, 212, 191, 0.08)"/>
      <circle cx="600" cy="340" r="190" fill="none" stroke="rgba(45, 212, 191, 0.24)" stroke-width="2"/>
      <line x1="20" y1="340" x2="1180" y2="340" stroke="rgba(250, 204, 21, 0.32)" stroke-width="2"/>
    </svg>`;
  } else {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 680" preserveAspectRatio="none">
      <defs>
        <radialGradient id="rbg" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stop-color="#7f1d1d"/>
          <stop offset="58%" stop-color="#2a0914"/>
          <stop offset="100%" stop-color="#0c0409"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="680" fill="url(#rbg)"/>
      <g stroke="rgba(251, 113, 133, 0.25)" stroke-width="2" fill="none">
        <circle cx="600" cy="340" r="220"/>
        <circle cx="600" cy="340" r="145"/>
        <path d="M120,120 L420,340 L120,560 M1080,120 L780,340 L1080,560"/>
        <line x1="20" y1="340" x2="1180" y2="340" stroke="rgba(251, 191, 36, 0.32)"/>
      </g>
    </svg>`;
  }

  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}
