/**
 * @fileoverview Main Client Application Controller for Yu-Gi-Oh! Master Duel Web
 * ควบคุมการแสดงผลหน้าเลือกเด็ค, ระบบห้องออนไลน์ (WebSocket + P2P), สนามดูเอล Master Duel,
 * หน้าต่างถามเชน (Chain Prompt), และระบบ AI Card Studio สำหรับเพิ่มการ์ดใหม่
 */

import {
  PHASES,
  PHASE_METADATA,
  POSITIONS,
  CHAIN_MODE
} from '/src/constants/gameConstants.js';
import {
  PRESET_DECKS,
  getAllDecks,
  getPresetDeckById,
  getCardById,
  getAllCards,
  registerCustomCards,
  registerRuntimeCards,
  registerCustomDecks
} from '/src/cards/index.js';
import { validateCardSchema } from '/src/cards/schema.js';
import { buildYdkeUrl } from '/src/cards/ydke.js';
import { DuelEngine } from '/src/engine/DuelEngine.js';
import { EffectResolver } from '/src/engine/EffectResolver.js';
import { SummonManager } from '/src/engine/SummonManager.js';
import { AIPlayer } from '/src/engine/AIPlayer.js';
import {
  getCardArtUrl,
  generateProceduralCardSvg,
  getCardFrameClass,
  getCardSubHeaderBadge,
  getAttributeMeta,
  getCardBackSvgUrl
} from '/js/cardArt.js';
import {
  PLAYMATS,
  getSavedPlaymat,
  savePlaymat,
  getPlaymatById,
  getPlaymatBackgroundUrl
} from '/js/playmats.js';
import {
  MultiplayerManager,
  isPrivateOrLocalHost,
  readSavedTurnConfig,
  saveTurnConfig,
  testWebRtcConnectivity
} from '/js/network.js';
import {
  getSavedLanguage,
  saveLanguage,
  t,
  getLocalizedCardName,
  getLocalizedCardDesc
} from '/js/i18n.js';
import {
  captureBoardSnapshot,
  playBoardDiffAnimations,
  enqueueTurnChangeBanners,
  resetTurnChangeBannerQueue,
  clearDuelVfxLayer
} from '/js/cardAnimations.js';
import {
  enableCardDragToPlay,
  shouldSuppressCardClick,
  cancelActiveCardDrag
} from '/js/dragPlay.js';
import {
  RpsSession,
  pickRandomRpsMove,
  chooseAiTurnOrder
} from '/src/engine/RpsSession.js';
import {
  openEffectChoiceModal as openMasterDuelEffectChoiceModal,
  closeEffectChoiceModal,
  refreshEffectChoiceModalLabels
} from '/js/effectChoiceModal.js';
import { mountLingeringHud } from '/js/lingeringHud.js';

// ==================== WEB AUDIO SYNTHESIZER (SFX) ====================
class DuelSoundFX {
  constructor() {
    this.ctx = null;
  }

  ensureCtx() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
  }

  playTone(freq = 440, duration = 0.12, type = 'sine', gainVal = 0.08) {
    try {
      this.ensureCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch {
      // Ignore audio autoplay blocks
    }
  }

  playSummon() {
    this.playTone(523.25, 0.12, 'triangle', 0.1);
    setTimeout(() => this.playTone(659.25, 0.15, 'triangle', 0.1), 80);
    setTimeout(() => this.playTone(783.99, 0.22, 'triangle', 0.12), 160);
  }

  playChainAlert() {
    this.playTone(880, 0.1, 'sawtooth', 0.08);
    setTimeout(() => this.playTone(1174.66, 0.18, 'sawtooth', 0.09), 90);
  }

  playAttack() {
    this.playTone(196, 0.16, 'sawtooth', 0.12);
    setTimeout(() => this.playTone(130.81, 0.22, 'square', 0.12), 90);
  }

  playClick() {
    this.playTone(620, 0.055, 'sine', 0.06);
  }
}

const sfx = new DuelSoundFX();

const AI_DIFFICULTY_STORAGE_KEY = 'ygo_md_ai_difficulty';

function getSavedAiDifficulty() {
  try {
    const saved = localStorage.getItem(AI_DIFFICULTY_STORAGE_KEY);
    return saved === 'easy' || saved === 'hard' ? saved : 'normal';
  } catch {
    return 'normal';
  }
}

function saveAiDifficulty(level) {
  const norm = level === 'easy' || level === 'hard' ? level : 'normal';
  try {
    localStorage.setItem(AI_DIFFICULTY_STORAGE_KEY, norm);
  } catch {
    // Ignore storage restriction
  }
  return norm;
}

// ==================== APPLICATION STATE ====================
const appState = {
  lang: getSavedLanguage(),
  playmatId: getSavedPlaymat(),
  aiDifficulty: getSavedAiDifficulty(),
  selectedDeckId: PRESET_DECKS[0].id,
  deckSearch: '',
  deckCategory: 'all',
  mpConnectionType: 'ws', // 'ws' | 'p2p'
  gameMode: 'SOLO',       // 'SOLO' | 'MULTIPLAYER' | 'SANDBOX'
  localEngine: null,
  currentState: null,
  lastRenderedState: null,
  lastRenderedPlayerIndex: 0,
  myPlayerIndex: 0,
  legalActions: null,
  aiTimer: null,
  mpManager: null,
  rpsContext: null,
  lastRpsSeat: null,
  lastAutoInspectedEventKey: null,
  knownCardsById: new Map(),
  knownCardsByCode: new Map(),
  knownCardsByName: new Map(),
  lingeringHud: null
};

if (typeof document !== 'undefined' && document.documentElement) {
  document.documentElement.lang = appState.lang;
}

// ==================== INLINE SVG ICON SYSTEM & PERFORMANCE HELPERS ====================
const UI_ICON_PATHS = {
  chain: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  peek: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  inspect: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  battle: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="M5 14l4 4"/><path d="M7 17l-3 3"/>',
  sword: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/>',
  summon: '<path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4L12 3Z"/>',
  set: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  activate: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  position: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
  gy: '<path d="M6 21V10a6 6 0 0 1 12 0v11"/><path d="M4 21h16"/><path d="M12 8v6"/><path d="M9.5 11h5"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  banish: '<circle cx="12" cy="12" r="9"/><path d="M12 3a6 6 0 0 1 0 12 4 4 0 0 1 0-8 2 2 0 0 1 0 4"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/>',
  cards: '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M4 8v10a2 2 0 0 0 2 2h8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  negate: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M11 8v6"/><path d="M8 11h6"/>',
  end: '<path d="m5 5 8 7-8 7V5Z"/><path d="M19 5v14"/>',
  leave: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  flag: '<path d="M4 22V4"/><path d="M4 4h11l-1.5 4L15 12H4"/>',
  mp2: '<path d="M12 3 4 12l8 9 8-9-8-9Z"/>',
  log: '<path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>',
  trophy: '<path d="M6 9H4a2 2 0 0 1-2-2V5h4"/><path d="M18 9h2a2 2 0 0 0 2-2V5h-4"/><path d="M6 4h12v6a6 6 0 0 1-12 0V4Z"/><path d="M12 16v5"/><path d="M8 21h8"/>',
  defeat: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7 7-7Z"/><path d="m12 6-2 4 4 2-2 4"/>'
};

function iconSvg(name, extraClass = '') {
  const inner = UI_ICON_PATHS[name] || UI_ICON_PATHS.summon;
  const cls = extraClass ? `ui-icon ${extraClass}` : 'ui-icon';
  return `<svg class="${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function stripLeadingEmoji(label) {
  return String(label || '')
    .replace(/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F\u200D]+\s*/gu, '')
    .trim();
}

function setButtonLabel(el, text, fallbackIcon = null) {
  if (!el) return;
  const labelEl = el.querySelector('.btn-label');
  if (labelEl) {
    labelEl.textContent = text;
    return;
  }
  const existingSvg = el.querySelector('svg');
  if (existingSvg) {
    const span = document.createElement('span');
    span.className = 'btn-label';
    span.textContent = text;
    el.innerHTML = '';
    el.append(existingSvg, span);
    return;
  }
  if (fallbackIcon) {
    el.innerHTML = `${iconSvg(fallbackIcon)}<span class="btn-label">${escapeHtml(text)}</span>`;
    return;
  }
  el.textContent = text;
}

function isCoarseTouchPointer() {
  return Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
}

function isCompactDuelViewport() {
  return window.innerWidth < 1024 || isCoarseTouchPointer();
}

function clearSelectedHandCard() {
  document.querySelectorAll('.duel-card.is-selected').forEach((el) => {
    el.classList.remove('is-selected');
  });
}

// Zone-dirty render cache & append-only log cursor
const zoneRenderCache = {
  duelId: null,
  myIdx: -1,
  lang: '',
  zones: new Map(),
  equipSig: '',
  comboGuideSig: '',
  logCount: 0,
  lastLogSig: '',
  logDuelId: null,
  logLang: ''
};

function resetDuelRenderCaches() {
  zoneRenderCache.duelId = null;
  zoneRenderCache.myIdx = -1;
  zoneRenderCache.lang = '';
  zoneRenderCache.zones.clear();
  zoneRenderCache.equipSig = '';
  zoneRenderCache.comboGuideSig = '';
  zoneRenderCache.logCount = 0;
  zoneRenderCache.lastLogSig = '';
  zoneRenderCache.logDuelId = null;
  zoneRenderCache.logLang = '';
}

function createLightweightStateSnapshot(state) {
  if (!state) return null;
  const slimFieldCard = (c) => (c ? {
    instanceId: c.instanceId,
    position: c.position,
    isFaceDown: Boolean(c.isFaceDown),
    equipTargetInstanceId: c.equipTargetInstanceId || null
  } : null);
  const logsArr = Array.isArray(state.logs) ? state.logs : [];
  const lastLog = logsArr.length > 0 ? logsArr[logsArr.length - 1] : null;
  return {
    duelId: state.duelId,
    turnCount: state.turnCount,
    turnPlayer: state.turnPlayer,
    phase: state.phase,
    battleSeq: state.battleSeq || 0,
    eventSeq: state.eventSeq || 0,
    players: (state.players || []).map((p) => ({
      name: p.name,
      lp: p.lp,
      hand: { length: Array.isArray(p.hand) ? p.hand.length : 0 },
      mmz: (p.mmz || []).map(slimFieldCard),
      stz: (p.stz || []).map(slimFieldCard),
      emz: slimFieldCard(p.emz),
      emzSlots: Array.isArray(p.emzSlots) ? p.emzSlots.map(slimFieldCard) : null,
      fieldSpell: slimFieldCard(p.fieldSpell)
    })),
    logsLength: logsArr.length,
    lastLog: lastLog ? { id: lastLog.id, text: lastLog.text } : null
  };
}

// ==================== TOP-LAYER EXIT & DIALOG HELPERS ====================
let supportsDisplayTransition;
function canTransitionDisplay() {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit() {
  return Boolean(window.CSS?.supports?.('overlay', 'auto')) && canTransitionDisplay();
}

async function closeTopLayer(element) {
  if (!element || !element.open) return;
  if (!supportsTopLayerExit()) {
    element.setAttribute('data-closing', '');
    const animations = element.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 450))
      ]);
    }
    if (!element.hasAttribute('data-closing')) return;
    element.removeAttribute('data-closing');
  }
  if (element.open) element.close();
}
function setupDialogs() {
  // Apply mandatory fallback for browsers without native <dialog closedby="any"> support
  document.querySelectorAll('dialog[closedby="any"]').forEach((dialog) => {
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent = (
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width
        );
        if (isDialogContent) return;
        dialog.close();
      });
    }
  });

  document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-close-dialog');
      const dlg = document.getElementById(id);
      if (dlg?.open) dlg.close();
    });
  });
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  const item = document.createElement('div');
  item.className = 'toast-item';
  item.textContent = message;
  container.appendChild(item);
  setTimeout(() => item.remove(), 3500);
}

function switchScreen(screenId) {
  const isDuel = screenId === 'screen-duel';
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId)?.classList.add('active');
  document.body.classList.toggle('is-duel-active', isDuel);

  // Clean up mobile sheets/drawers and in-flight gestures across screen transitions
  document.getElementById('inspector-sidebar')?.classList.remove('is-mobile-open');
  document.getElementById('mobile-duel-menu-drawer')?.classList.remove('open');
  document.getElementById('btn-mobile-duel-menu')?.setAttribute('aria-expanded', 'false');
  document.getElementById('btn-mobile-inspector-toggle')?.setAttribute('aria-expanded', 'false');
  cancelActiveCardDrag();
  clearSelectedHandCard();

  if (!isDuel) {
    cancelStateSyncPlayback({ clearDuelId: true });
    clearDuelVfxLayer();
    resetTurnChangeBannerQueue();
    resetDuelRenderCaches();
  }
  hideActionPopup(true);
  clearZonePickMode(true);
  closeYgoproCardStrip();
  clearChainCardHighlights();
  clearPinnedCmdCards();

  // Always reset viewport scroll position when transitioning screens (fixes mobile Lobby -> Duel landing scrolled down)
  window.scrollTo(0, 0);
  if (document.documentElement) document.documentElement.scrollTop = 0;
  if (document.body) document.body.scrollTop = 0;
  if (isDuel) {
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }
}

// ==================== LOBBY & 55 TOP DECKS RENDERING ====================
function getDeckDisplayTitle(deck, lang = appState.lang) {
  if (!deck) return '';
  if (lang === 'en') {
    return `${deck.mdmRank ? `${deck.mdmRank}. ` : ''}${deck.name}`;
  }
  return deck.nameTh || deck.name;
}

function getDeckDisplaySummary(deck, lang = appState.lang) {
  if (!deck) return '';
  return lang === 'en' ? (deck.summary || deck.summaryTh || '') : (deck.summaryTh || deck.summary || '');
}

function getDeckDisplayGuide(deck, lang = appState.lang) {
  if (!deck) return [];
  return lang === 'en'
    ? (deck.comboGuide || deck.comboGuideTh || [])
    : (deck.comboGuideTh || deck.comboGuide || []);
}

function matchesDeckCategoryAndSearch(deck, category, searchQuery) {
  if (category === 'meta') {
    if (!deck.mdmTier || !deck.mdmTier.toLowerCase().startsWith('tier')) {
      return false;
    }
  } else if (category !== 'all') {
    if (!Array.isArray(deck.styles) || !deck.styles.includes(category)) {
      return false;
    }
  }

  const q = String(searchQuery || '').trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    deck.name,
    deck.nameTh,
    deck.badge,
    deck.mdmTier,
    deck.summary,
    deck.summaryTh,
    ...(deck.styles || [])
  ].filter(Boolean).join(' ').toLowerCase();

  return haystack.includes(q);
}

function populateAiDeckDropdown() {
  const aiSelect = document.getElementById('select-ai-deck');
  if (!aiSelect) return;

  const previousVal = aiSelect.value;
  const lang = appState.lang;
  aiSelect.innerHTML = '';

  const randOpt = document.createElement('option');
  randOpt.value = '__RANDOM__';
  randOpt.textContent = t(lang, 'randomAiOption');
  aiSelect.appendChild(randOpt);

  getAllDecks().forEach((deck) => {
    const opt = document.createElement('option');
    opt.value = deck.id;
    opt.textContent = getDeckDisplayTitle(deck, lang);
    aiSelect.appendChild(opt);
  });

  if (previousVal && [...aiSelect.options].some(o => o.value === previousVal)) {
    aiSelect.value = previousVal;
  } else {
    aiSelect.value = 'swordsoul_tenyi';
  }
}

function resolveOpponentDeckId() {
  const val = document.getElementById('select-ai-deck')?.value || 'swordsoul_tenyi';
  if (val === '__RANDOM__') {
    const all = getAllDecks();
    const randomDeck = all[Math.floor(Math.random() * all.length)];
    return randomDeck?.id || 'swordsoul_tenyi';
  }
  return val;
}

const HIDDEN_PRESET_DECKS_KEY = 'ygo_hidden_preset_decks';

function getHiddenPresetDeckIds() {
  try {
    const raw = localStorage.getItem(HIDDEN_PRESET_DECKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveHiddenPresetDeckIds(idSet) {
  try {
    localStorage.setItem(HIDDEN_PRESET_DECKS_KEY, JSON.stringify([...idSet]));
  } catch {
    // ignore storage errors
  }
}

function getVisibleDecks() {
  const hiddenIds = getHiddenPresetDeckIds();
  return getAllDecks().filter((d) => d.isCustomYdk || !hiddenIds.has(d.id));
}

async function deleteDeckById(deck) {
  if (!deck) return;
  const label = getDeckDisplayTitle(deck, appState.lang);
  const confirmMsg = deck.isCustomYdk
    ? `ต้องการลบเด็ค "${label}" ออกจากรายการถาวรใช่หรือไม่?`
    : `ต้องการซ่อน/ลบเด็ค "${label}" ออกจากรายการใช่หรือไม่? (สามารถกดกู้คืนได้ภายหลัง)`;
  if (!window.confirm(confirmMsg)) return;

  if (deck.isCustomYdk) {
    const res = await fetch(`/api/custom-decks?id=${encodeURIComponent(deck.id)}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast(`❌ ลบเด็ค "${label}" ไม่สำเร็จ`, 'error');
      return;
    }
    const data = await res.json();
    registerCustomDecks(data.customDecks || [], { replace: true });
  } else {
    const hidden = getHiddenPresetDeckIds();
    hidden.add(deck.id);
    saveHiddenPresetDeckIds(hidden);
  }

  const remaining = getVisibleDecks();
  if (appState.selectedDeckId === deck.id) {
    appState.selectedDeckId = remaining[0]?.id || PRESET_DECKS[0]?.id || 'blue_eyes_meta';
  }
  renderDeckSelector();
  populateAiDeckDropdown();
  showToast(`🗑️ ลบเด็ค "${label}" แล้ว`, 'info');
}

function renderDeckSelector() {
  const container = document.getElementById('deck-cards-container');
  const countBadge = document.getElementById('deck-showing-count');
  if (!container) return;

  const prevScrollTop = container.scrollTop;
  const lang = appState.lang;
  const allDecks = getVisibleDecks();
  const hiddenIds = getHiddenPresetDeckIds();
  const filteredDecks = allDecks.filter((deck) =>
    matchesDeckCategoryAndSearch(deck, appState.deckCategory, appState.deckSearch)
  );

  if (countBadge) {
    countBadge.textContent = `${filteredDecks.length} / ${allDecks.length}`;
    let restoreBtn = document.getElementById('btn-restore-hidden-decks');
    if (hiddenIds.size > 0) {
      if (!restoreBtn) {
        restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.id = 'btn-restore-hidden-decks';
        restoreBtn.className = 'btn-mini';
        restoreBtn.addEventListener('click', () => {
          saveHiddenPresetDeckIds(new Set());
          renderDeckSelector();
          populateAiDeckDropdown();
          showToast(appState.lang === 'en' ? 'Restored all hidden decks' : '♻️ กู้คืนเด็คที่ลบทั้งหมดแล้ว', 'info');
        });
        countBadge.insertAdjacentElement('afterend', restoreBtn);
      }
      restoreBtn.textContent = lang === 'en' ? `Restore (${hiddenIds.size})` : `♻️ กู้คืน (${hiddenIds.size})`;
      restoreBtn.classList.remove('hidden');
    } else if (restoreBtn) {
      restoreBtn.classList.add('hidden');
    }
  }

  container.innerHTML = '';

  if (filteredDecks.length === 0) {
    container.innerHTML = `<div class="deck-empty-notice">${t(lang, 'noMatchingDecks')}</div>`;
    renderSelectedDeckSummary();
    return;
  }

  const frag = document.createDocumentFragment();
  filteredDecks.forEach((deck) => {
    const coverCard = getCardById(deck.coverCardId);
    const cardEl = document.createElement('div');
    const title = getDeckDisplayTitle(deck, lang);
    const isSelected = deck.id === appState.selectedDeckId;
    const delTitle = lang === 'en' ? `Delete deck ${title}` : `ลบเด็ค ${title}`;
    cardEl.className = `deck-choice-card ${isSelected ? 'selected' : ''}`;
    cardEl.dataset.deckId = deck.id;
    cardEl.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    cardEl.innerHTML = `
      <button type="button" class="deck-card-delete-btn" title="${escapeHtml(delTitle)}" aria-label="${escapeHtml(delTitle)}">${iconSvg('trash')}</button>
      <div class="deck-choice-top">
        <img class="deck-choice-thumb" src="${getCardArtUrl(coverCard)}" alt="${escapeHtml(deck.name)}" loading="lazy" decoding="async" />
        <div class="deck-choice-info">
          <span class="deck-choice-badge">${escapeHtml(deck.badge)}</span>
          <div class="deck-choice-title">${escapeHtml(title)}</div>
        </div>
      </div>
      <div class="deck-choice-diff">${escapeHtml(deck.difficulty)}</div>
    `;
    const img = cardEl.querySelector('img');
    img.addEventListener('error', () => {
      img.src = generateProceduralCardSvg(coverCard);
    }, { once: true });

    cardEl.querySelector('.deck-card-delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteDeckById(deck);
    });

    cardEl.addEventListener('click', () => {
      if (appState.selectedDeckId === deck.id) return;
      appState.selectedDeckId = deck.id;
      container.querySelectorAll('.deck-choice-card.selected').forEach((prevEl) => {
        prevEl.classList.remove('selected');
        prevEl.setAttribute('aria-pressed', 'false');
      });
      cardEl.classList.add('selected');
      cardEl.setAttribute('aria-pressed', 'true');
      renderSelectedDeckSummary();
    });
    frag.appendChild(cardEl);
  });
  container.appendChild(frag);

  if (prevScrollTop > 0) {
    container.scrollTop = prevScrollTop;
  }

  renderSelectedDeckSummary();
}

function buildYdkTextFromDeck(deck) {
  if (!deck) return '';
  const lines = [`#created by Yu-Gi-Oh! Master Duel Web (${deck.name})`, '#main'];
  let mainCount = 0;
  let extraCount = 0;
  for (const item of (deck.mainDeckRecipe || [])) {
    const card = getCardById(item.id);
    const code = card?.passcode || (String(item.id).startsWith('cdb_') ? String(item.id).slice(4) : null);
    if (!code) continue;
    const qty = Math.max(1, Math.min(3, item.count || 1));
    for (let i = 0; i < qty; i++) {
      lines.push(String(Number(code) || code));
      mainCount++;
    }
  }
  lines.push('#extra');
  for (const item of (deck.extraDeckRecipe || [])) {
    const card = getCardById(item.id);
    const code = card?.passcode || (String(item.id).startsWith('cdb_') ? String(item.id).slice(4) : null);
    if (!code) continue;
    const qty = Math.max(1, Math.min(3, item.count || 1));
    for (let i = 0; i < qty; i++) {
      lines.push(String(Number(code) || code));
      extraCount++;
    }
  }
  lines.push('!side');
  return { text: lines.join('\n'), mainCount, extraCount };
}

async function copyDeckToClipboard(deck) {
  if (!deck) return;
  const { text, mainCount, extraCount } = buildYdkTextFromDeck(deck);
  await copyTextToClipboard(
    text,
    `📋 คัดลอก YDK ของ "${deck.name}" ลง Clipboard แล้ว (Main ${mainCount} / Extra ${extraCount})`
  );
}

function buildYdkeFromDeck(deck) {
  const mainCodes = [];
  const extraCodes = [];
  for (const item of (deck.mainDeckRecipe || [])) {
    const card = getCardById(item.id);
    const code = card?.passcode || (String(item.id).startsWith('cdb_') ? String(item.id).slice(4) : null);
    if (!code) continue;
    const num = Number(code);
    if (!Number.isInteger(num) || num <= 0) continue;
    const qty = Math.max(1, Math.min(3, item.count || 1));
    for (let i = 0; i < qty; i++) mainCodes.push(num);
  }
  for (const item of (deck.extraDeckRecipe || [])) {
    const card = getCardById(item.id);
    const code = card?.passcode || (String(item.id).startsWith('cdb_') ? String(item.id).slice(4) : null);
    if (!code) continue;
    const num = Number(code);
    if (!Number.isInteger(num) || num <= 0) continue;
    const qty = Math.max(1, Math.min(3, item.count || 1));
    for (let i = 0; i < qty; i++) extraCodes.push(num);
  }
  return {
    url: buildYdkeUrl(mainCodes, extraCodes, []),
    mainCount: mainCodes.length,
    extraCount: extraCodes.length
  };
}

async function copyDeckYdkeToClipboard(deck) {
  if (!deck) return;
  const { url, mainCount, extraCount } = buildYdkeFromDeck(deck);
  await copyTextToClipboard(
    url,
    `🔗 คัดลอก YDKE ของ "${deck.name}" ลง Clipboard แล้ว (Main ${mainCount} / Extra ${extraCount})`
  );
}

function renderSelectedDeckSummary() {
  const deck = getPresetDeckById(appState.selectedDeckId);
  const summaryEl = document.getElementById('selected-deck-summary');
  if (!deck || !summaryEl) return;

  const lang = appState.lang;
  const title = getDeckDisplayTitle(deck, lang);
  const summary = getDeckDisplaySummary(deck, lang);
  const guide = getDeckDisplayGuide(deck, lang);

  summaryEl.innerHTML = `
    <div class="summary-header">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p class="deck-summary-desc">${escapeHtml(summary)}</p>
      </div>
      <div class="deck-summary-actions">
        <button type="button" class="btn-outline" id="btn-copy-selected-ydk" title="${lang === 'en' ? 'Copy deck as YDK to clipboard' : 'คัดลอกเด็คนี้เป็นโค้ด YDK ลง Clipboard'}">Copy YDK</button>
        <button type="button" class="btn-outline" id="btn-copy-selected-ydke" title="${lang === 'en' ? 'Copy deck as YDKE link to clipboard' : 'คัดลอกเด็คนี้เป็นลิงก์ YDKE (ydke://...) ลง Clipboard'}">Copy YDKE</button>
        <button type="button" class="btn-outline" id="btn-inspect-selected-deck">${iconSvg('inspect')}<span class="btn-label">${escapeHtml(stripLeadingEmoji(t(lang, 'inspectDeckBtn')))}</span></button>
        <button type="button" class="btn-outline btn-danger-outline" id="btn-delete-selected-deck">${iconSvg('trash')}<span class="btn-label">${escapeHtml(t(lang, 'deleteDeckBtn'))}</span></button>
      </div>
    </div>
  `;

  document.getElementById('btn-copy-selected-ydk')?.addEventListener('click', () => {
    copyDeckToClipboard(deck);
  });
  document.getElementById('btn-copy-selected-ydke')?.addEventListener('click', () => {
    copyDeckYdkeToClipboard(deck);
  });
  document.getElementById('btn-inspect-selected-deck')?.addEventListener('click', () => {
    openDeckListModal(deck);
  });
  document.getElementById('btn-delete-selected-deck')?.addEventListener('click', () => {
    deleteDeckById(deck);
  });
}

function openDeckListModal(deck) {
  if (!deck) return;
  const lang = appState.lang;
  const dlg = document.getElementById('dialog-zone-browser');
  document.getElementById('zone-browser-title').textContent = `${t(lang, 'deckModalPrefix')} ${getDeckDisplayTitle(deck, lang)}`;
  document.getElementById('zone-browser-subtitle').textContent = `${getDeckDisplaySummary(deck, lang)} (${t(lang, 'deckModalHint')})`;
  const grid = document.getElementById('zone-browser-grid');
  grid.innerHTML = '';

  const allItems = [
    ...deck.mainDeckRecipe.map(r => ({ ...r, section: 'Main Deck' })),
    ...deck.extraDeckRecipe.map(r => ({ ...r, section: 'Extra Deck' }))
  ];

  const frag = document.createDocumentFragment();
  for (const item of allItems) {
    const card = getCardById(item.id);
    if (!card) continue;
    const cardName = getLocalizedCardName(card, lang);
    const cardDesc = getLocalizedCardDesc(card, lang);
    const box = document.createElement('div');
    box.className = 'browser-card-box';
    box.innerHTML = `
      <div class="browser-card-head">
        <img class="browser-card-thumb" src="${getCardArtUrl(card)}" alt="${escapeHtml(card.name)}" loading="lazy" decoding="async" />
        <div class="browser-card-meta">
          <div class="browser-card-section">${escapeHtml(item.section)} ×${item.count}</div>
          <div class="browser-card-name">${escapeHtml(cardName)}</div>
          <div class="browser-card-sub">${escapeHtml(getCardSubHeaderBadge(card, lang))}</div>
        </div>
      </div>
      <div class="browser-card-desc">${escapeHtml(cardDesc)}</div>
    `;
    const img = box.querySelector('img');
    img.addEventListener('error', () => {
      img.src = generateProceduralCardSvg(card);
    }, { once: true });
    frag.appendChild(box);
  }
  grid.appendChild(frag);

  dlg.showModal();
}

// ==================== NETWORK & MULTIPLAYER SETUP ====================
async function fetchNetworkAndCustomCards() {
  try {
    const [netRes, customRes, customDecksRes] = await Promise.all([
      fetch('/api/network-info'),
      fetch('/api/custom-cards'),
      fetch('/api/custom-decks')
    ]);
    if (customRes.ok) {
      const { customCards } = await customRes.json();
      if (Array.isArray(customCards) && customCards.length > 0) {
        registerCustomCards(customCards);
      }
    }
    if (customDecksRes.ok) {
      const { customDecks, customCards: deckCards } = await customDecksRes.json();
      if (Array.isArray(deckCards) && deckCards.length > 0) {
        registerRuntimeCards(deckCards);
      }
      if (Array.isArray(customDecks) && customDecks.length > 0) {
        registerCustomDecks(customDecks);
        renderDeckSelector();
        populateAiDeckDropdown();
      }
    }
    if (netRes.ok) {
      const info = await netRes.json();
      const urlListEl = document.getElementById('lan-urls-list');
      const qrBox = document.getElementById('lan-qr-container');
      const lanLabelEl = document.getElementById('lan-box-label');
      const lanHintEl = document.getElementById('lan-scope-hint');
      const isLocalOrigin = isPrivateOrLocalHost(window.location.hostname);

      if (!isLocalOrigin) {
        const publicUrl = window.location.origin;
        appState.primaryShareUrl = publicUrl;
        if (lanLabelEl) {
          lanLabelEl.textContent = appState.lang === 'en'
            ? '🌍 Public / Cross-Wi-Fi Server URL:'
            : '🌍 ลิงก์เข้าเล่นข้าม Wi-Fi / 4G (Public URL):';
        }
        if (lanHintEl) {
          lanHintEl.textContent = appState.lang === 'en'
            ? 'Anyone on any Wi-Fi or cellular network can open this URL and play via Mode 1.'
            : 'เพื่อนอยู่คนละ Wi-Fi หรือ 4G เปิดลิงก์นี้แล้วเข้า Mode 1 ได้ทันที';
        }
        if (urlListEl) {
          urlListEl.innerHTML = '';
          const row = document.createElement('div');
          const link = document.createElement('a');
          link.href = publicUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.className = 'open-room-host';
          link.textContent = publicUrl;
          row.appendChild(link);
          urlListEl.appendChild(row);
        }
        if (qrBox) {
          qrBox.innerHTML = '';
          const qrImg = document.createElement('img');
          qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(publicUrl)}`;
          qrImg.alt = 'QR Code';
          qrImg.loading = 'lazy';
          qrImg.decoding = 'async';
          qrBox.appendChild(qrImg);
        }
      } else if (info.ips && info.ips.length > 0) {
        const primaryUrl = info.ips[0].url;
        appState.primaryShareUrl = primaryUrl;
        if (lanLabelEl) {
          lanLabelEl.textContent = appState.lang === 'en'
            ? 'Same-Wi-Fi (LAN) Share Link:'
            : 'ลิงก์เล่นด้วยกันบน Wi-Fi เดียวกัน (LAN):';
        }
        if (lanHintEl) {
          lanHintEl.textContent = appState.lang === 'en'
            ? 'Same Wi-Fi / Hotspot only. For Cross-Wi-Fi, switch to Mode 2 (P2P Online) or use a public HTTPS tunnel.'
            : 'ใช้ได้เฉพาะ Wi-Fi / Hotspot เดียวกัน — หากอยู่คนละ Wi-Fi ให้ใช้ Mode 2 (P2P Online) หรือรันผ่าน Public HTTPS Tunnel';
        }
        if (urlListEl) {
          urlListEl.innerHTML = '';
          info.ips.forEach((ip) => {
            const row = document.createElement('div');
            const link = document.createElement('a');
            link.href = ip.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'open-room-host';
            const ifaceLabel = ip.interface || ip.iface;
            link.textContent = `${ip.url}${ifaceLabel ? ` (${ifaceLabel})` : ''}`;
            row.appendChild(link);
            urlListEl.appendChild(row);
          });
        }
        if (qrBox) {
          qrBox.innerHTML = '';
          const qrImg = document.createElement('img');
          qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(primaryUrl)}`;
          qrImg.alt = 'QR Code';
          qrImg.loading = 'lazy';
          qrImg.decoding = 'async';
          qrBox.appendChild(qrImg);
        }
      } else {
        const localUrl = window.location.origin;
        appState.primaryShareUrl = localUrl;
        if (urlListEl) urlListEl.textContent = localUrl;
      }
      renderOpenRoomsList(info.openRooms || []);
    }
  } catch {
    const urlListEl = document.getElementById('lan-urls-list');
    if (urlListEl) urlListEl.textContent = window.location.origin;
  }
}

function buildSelectedCustomDeckPayload(deckId = appState.selectedDeckId) {
  const deck = getPresetDeckById(deckId);
  if (!deck) return { customDeck: null, customCards: [] };

  const customCardMap = new Map();
  const recipe = [
    ...(deck.mainDeckRecipe || []),
    ...(deck.extraDeckRecipe || [])
  ];
  for (const entry of recipe) {
    const card = getCardById(entry?.id);
    if (card && (card.isCustom || String(card.id).startsWith('cdb_'))) {
      customCardMap.set(card.id, card);
    }
  }

  return {
    customDeck: deck.isCustomYdk ? deck : null,
    customCards: Array.from(customCardMap.values())
  };
}

async function copyTextToClipboard(text, successMsg) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    if (successMsg) showToast(successMsg);
    return true;
  } catch (err) {
    showToast(`⚠️ คัดลอกไม่สำเร็จ: ${err.message}`);
    return false;
  }
}

function buildRoomInviteUrl(roomCode, mode = appState.mpConnectionType) {
  const isP2P = String(mode).toLowerCase() === 'p2p';
  let baseOrigin = window.location.origin;
  if (!isP2P && isPrivateOrLocalHost(window.location.hostname) && appState.primaryShareUrl) {
    baseOrigin = appState.primaryShareUrl;
  }
  const url = new URL(baseOrigin + window.location.pathname);
  url.searchParams.set(isP2P ? 'p2p' : 'room', roomCode);
  return url.toString();
}

function updateP2PGuidanceText() {
  const guideEl = document.getElementById('p2p-guidance-text');
  if (!guideEl) return;

  const savedTurn = readSavedTurnConfig();
  const isEn = appState.lang === 'en';
  if (savedTurn.urls) {
    guideEl.textContent = isEn
      ? `🌐 Cross-Wi-Fi P2P Mode Active + TURN Relay configured (${savedTurn.urls}${savedTurn.forceRelay ? ', Force Relay ON' : ''}). Share the 6-character code with a friend on any Wi-Fi or 4G network.`
      : `🌐 โหมด P2P ข้าม Wi-Fi พร้อมใช้งาน + ตั้งค่า TURN Relay แล้ว (${savedTurn.urls}${savedTurn.forceRelay ? ' · บังคับ Relay' : ''}) — ส่งรหัสห้อง 6 หลักให้เพื่อนอยู่คนละ Wi-Fi / 4G ได้เลย`;
    return;
  }

  guideEl.textContent = isEn
    ? '🌐 Cloud Relay (TLS Port 443) Active: Automatically bypasses Wi-Fi AP Client Isolation, Campus/Enterprise Firewalls, and Symmetric NAT across any Wi-Fi or 4G network.'
    : '🌐 โหมดทะลุบล็อก Wi-Fi / ข้ามเครือข่าย (Cloud Relay Port 443): ทะลุ AP Client Isolation (หอพัก/มหาลัย/ออฟฟิศ) และ Firewall อัตโนมัติ — ส่งรหัสห้อง 6 หลักให้เพื่อนเข้าเล่นได้เลย';
}

function renderP2PLiveStatus({ stage, message } = {}) {
  const statusEl = document.getElementById('p2p-live-status');
  if (!statusEl) return;

  statusEl.classList.remove('is-error', 'is-ready');
  if (!message) {
    statusEl.classList.add('hidden');
    statusEl.textContent = '';
    return;
  }

  statusEl.classList.remove('hidden');
  if (stage === 'error' || stage === 'timeout' || stage === 'failed') {
    statusEl.classList.add('is-error');
  } else if (stage === 'connected') {
    statusEl.classList.add('is-ready');
  }
  statusEl.textContent = message;
}

function updateMpTabUI() {
  const isP2P = appState.mpConnectionType === 'p2p';
  document.getElementById('open-rooms-section')?.classList.toggle('hidden', isP2P);
  document.getElementById('lan-info-box')?.classList.toggle('hidden', isP2P);
  document.getElementById('p2p-info-box')?.classList.toggle('hidden', !isP2P);

  document.querySelectorAll('.mp-tab').forEach((tab) => {
    const tabType = tab.getAttribute('data-mp-tab');
    tab.classList.toggle('active', tabType === appState.mpConnectionType);
  });

  const codeInput = document.getElementById('input-room-code');
  if (codeInput) {
    codeInput.setAttribute(
      'placeholder',
      isP2P
        ? (appState.lang === 'en' ? 'P2P Room Code (e.g. A7K92B)' : 'รหัสห้อง P2P (เช่น 6 หลัก)')
        : (appState.lang === 'en' ? 'Room Code (e.g. 4821)' : 'รหัสห้อง (เช่น 4821)')
    );
  }

  updateP2PGuidanceText();
}

function syncTurnConfigInputs() {
  const cfg = readSavedTurnConfig();
  const urlEl = document.getElementById('input-turn-url');
  const userEl = document.getElementById('input-turn-user');
  const credEl = document.getElementById('input-turn-cred');
  const relayEl = document.getElementById('chk-turn-force-relay');
  if (urlEl) urlEl.value = cfg.urls;
  if (userEl) userEl.value = cfg.username;
  if (credEl) credEl.value = cfg.credential;
  if (relayEl) relayEl.checked = cfg.forceRelay;
}

function applyInviteQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const p2pCode = params.get('p2p');
  const wsCode = params.get('room');
  const codeInput = document.getElementById('input-room-code');
  const banner = document.getElementById('invite-join-banner');
  const titleEl = document.getElementById('invite-join-title');
  const subEl = document.getElementById('invite-join-sub');
  const joinBtn = document.getElementById('btn-invite-quick-join');
  const dismissBtn = document.getElementById('btn-invite-dismiss');

  const inviteCode = p2pCode ? p2pCode.trim().toUpperCase() : (wsCode ? wsCode.trim() : '');
  if (!inviteCode) return;

  const isP2P = Boolean(p2pCode);
  appState.mpConnectionType = isP2P ? 'p2p' : 'ws';
  updateMpTabUI();
  if (codeInput) codeInput.value = inviteCode;

  if (banner && titleEl && joinBtn) {
    const isEn = appState.lang === 'en';
    titleEl.textContent = isEn
      ? `⚔️ Invited to Duel Room #${inviteCode}`
      : `⚔️ คุณได้รับคำเชิญเข้าห้องดวล #${inviteCode}`;
    if (subEl) {
      subEl.textContent = isEn
        ? 'Pick your deck on the left, then click Join Now!'
        : 'เลือกเด็คด้านซ้าย แล้วกดเข้าร่วมได้ทันทีในคลิกเดียว';
    }
    joinBtn.textContent = isEn ? `⚔️ Join Room #${inviteCode}` : `⚔️ เข้าร่วมห้อง #${inviteCode}`;
    banner.classList.remove('hidden');

    joinBtn.onclick = () => {
      banner.classList.add('hidden');
      if (codeInput) codeInput.value = inviteCode;
      document.getElementById('btn-join-room')?.click();
    };
    if (dismissBtn) {
      dismissBtn.onclick = () => banner.classList.add('hidden');
    }
  }

  showToast(
    appState.lang === 'en'
      ? `🔗 Ready to join Room #${inviteCode} — click Join!`
      : `🔗 พร้อมเข้าห้อง #${inviteCode} — กด "เข้าร่วมห้อง" ได้เลย`
  );
}

function setupCrossWifiUiBindings() {
  syncTurnConfigInputs();

  document.getElementById('btn-save-turn')?.addEventListener('click', () => {
    const saved = saveTurnConfig({
      urls: document.getElementById('input-turn-url')?.value || '',
      username: document.getElementById('input-turn-user')?.value || '',
      credential: document.getElementById('input-turn-cred')?.value || '',
      forceRelay: Boolean(document.getElementById('chk-turn-force-relay')?.checked)
    });
    syncTurnConfigInputs();
    updateP2PGuidanceText();
    showToast(saved.urls
      ? `✅ บันทึก TURN Relay แล้ว (${saved.urls})`
      : 'ℹ️ ล้างค่า TURN Relay แล้ว (ใช้ STUN อัตโนมัติ)');
  });

  document.getElementById('btn-clear-turn')?.addEventListener('click', () => {
    saveTurnConfig({ urls: '', username: '', credential: '', forceRelay: false });
    syncTurnConfigInputs();
    updateP2PGuidanceText();
    const testEl = document.getElementById('p2p-ice-test-result');
    if (testEl) testEl.textContent = '';
    showToast('🗑️ ล้างการตั้งค่า TURN Relay แล้ว');
  });

  document.getElementById('btn-test-ice')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-test-ice');
    const out = document.getElementById('p2p-ice-test-result');
    const urls = document.getElementById('input-turn-url')?.value.trim() || '';
    const username = document.getElementById('input-turn-user')?.value.trim() || '';
    const credential = document.getElementById('input-turn-cred')?.value.trim() || '';
    const forceRelay = Boolean(document.getElementById('chk-turn-force-relay')?.checked);

    if (btn) btn.disabled = true;
    if (out) out.textContent = '⏳ กำลังทดสอบ ICE / STUN / TURN...';

    try {
      const overrideTurn = urls ? { urls, username, credential, forceRelay } : null;
      const result = await testWebRtcConnectivity(overrideTurn);
      if (!result.supported) {
        if (out) out.textContent = '❌ เบราว์เซอร์นี้ไม่รองรับ WebRTC';
        return;
      }

      const parts = [
        `Host: ${result.hasHost ? 'OK' : 'No'}`,
        `STUN(srflx): ${result.hasSrflx ? `OK (${result.publicIps.join(', ') || 'IP detected'})` : 'Blocked'}`,
        `TURN(relay): ${result.hasRelay ? 'OK ✅ (Cross-Wi-Fi guaranteed)' : (result.hasTurnConfigured ? 'Failed ❌ (check TURN URL/credentials)' : 'Not set')}`
      ];
      if (out) {
        out.textContent = parts.join(' | ');
        out.style.color = result.hasRelay
          ? '#4ade80'
          : (result.hasSrflx ? '#7dd3fc' : '#f87171');
      }
    } catch (err) {
      if (out) {
        out.textContent = `❌ ICE probe error: ${err.message}`;
        out.style.color = '#f87171';
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('btn-copy-room-code')?.addEventListener('click', () => {
    const code = appState.activeRoomCode || document.getElementById('display-room-code')?.textContent?.trim();
    if (!code || code === '----') return;
    copyTextToClipboard(code, `📋 คัดลอกรหัสห้อง "${code}" แล้ว!`);
  });

  document.getElementById('btn-copy-invite-link')?.addEventListener('click', () => {
    const code = appState.activeRoomCode || document.getElementById('display-room-code')?.textContent?.trim();
    if (!code || code === '----') return;
    const mode = appState.activeRoomMode || appState.mpConnectionType;
    const inviteUrl = buildRoomInviteUrl(code, mode);
    if (String(mode).toLowerCase() === 'p2p' && isPrivateOrLocalHost(window.location.hostname)) {
      copyTextToClipboard(
        inviteUrl,
        `🔗 คัดลอกลิงก์แล้ว (หมายเหตุ: ถ้าเพื่อนอยู่คนละเครื่อง ให้เปิดเว็บจาก URL เดียวกันหรือกรอกรหัส "${code}" ใน Mode 2)`
      );
      return;
    }
    copyTextToClipboard(inviteUrl, `🔗 คัดลอกลิงก์ชวนเล่นแล้ว! (${code})`);
  });

  document.getElementById('btn-share-invite-link')?.addEventListener('click', async () => {
    const code = appState.activeRoomCode || document.getElementById('display-room-code')?.textContent?.trim();
    if (!code || code === '----') return;
    const mode = appState.activeRoomMode || appState.mpConnectionType;
    const inviteUrl = buildRoomInviteUrl(code, mode);
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Yu-Gi-Oh! Master Duel',
          text: appState.lang === 'en'
            ? `Join my Yu-Gi-Oh! duel room #${code}`
            : `มาดวล Yu-Gi-Oh! กัน! กดลิงก์เพื่อเข้าห้อง #${code}`,
          url: inviteUrl
        });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    copyTextToClipboard(inviteUrl, `🔗 คัดลอกลิงก์ชวนเล่นแล้ว! (${code})`);
  });

  document.getElementById('btn-cancel-waiting-room')?.addEventListener('click', () => {
    appState.mpManager?.disconnectRoom();
    appState.activeRoomCode = null;
    appState.activeRoomMode = null;
    document.getElementById('waiting-room-banner')?.classList.add('hidden');
    renderP2PLiveStatus({ stage: 'idle', message: '' });
    showToast('✖️ ปิดห้องรอแล้ว');
  });
}

function renderOpenRoomsList(openRooms = []) {
  const listEl = document.getElementById('open-rooms-list');
  if (!listEl) return;
  const lang = appState.lang;
  if (!openRooms || openRooms.length === 0) {
    listEl.innerHTML = `<div class="empty-rooms-text">${escapeHtml(t(lang, 'emptyRoomsText'))}</div>`;
    return;
  }

  listEl.innerHTML = '';
  for (const r of openRooms) {
    const deck = getPresetDeckById(r.hostDeckId);
    const deckName = deck ? getDeckDisplayTitle(deck, lang) : 'Custom Deck';
    const row = document.createElement('div');
    row.className = 'open-room-item';
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(t(lang, 'roomLabel'))} #${escapeHtml(r.code)}</strong> — ${escapeHtml(t(lang, 'hostLabel'))} <span class="open-room-host">${escapeHtml(r.hostName)}</span>
        <span class="open-room-deck">(${escapeHtml(deckName)})</span>
      </div>
      <button type="button" class="btn-gold btn-mini">${escapeHtml(t(lang, 'joinNowBtn'))}</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      const playerName = document.getElementById('input-player-name').value.trim() || 'Duelist 2';
      const payload = buildSelectedCustomDeckPayload(appState.selectedDeckId);
      appState.mpManager.joinWsRoom(r.code, playerName, appState.selectedDeckId, payload);
    });
    listEl.appendChild(row);
  }
}

function initMultiplayerManager() {
  appState.mpManager = new MultiplayerManager({
    onRoomListUpdate(openRooms) {
      renderOpenRoomsList(openRooms);
    },
    onRoomCreated({ roomCode, mode }) {
      appState.activeRoomCode = roomCode;
      appState.activeRoomMode = mode;
      const banner = document.getElementById('waiting-room-banner');
      banner.classList.remove('hidden');
      document.getElementById('display-room-code').textContent = roomCode;
      const subEl = document.getElementById('waiting-room-sub');
      if (subEl) {
        subEl.textContent = mode === 'P2P'
          ? 'ส่งรหัส 6 หลักนี้ให้เพื่อนกรอกใน Mode 2 (P2P Online) หรือกดคัดลอกลิงก์'
          : (appState.lang === 'en'
              ? 'Send the invite link or room code to your friend (works across any Wi-Fi / 4G)!'
              : 'ส่งลิงก์เชิญหรือรหัสห้องนี้ให้เพื่อนได้เลย (เล่นข้าม Wi-Fi / 4G ได้ทันที)!');
      }
      // Update QR code to point directly to this room's 1-click invite URL
      const qrBox = document.getElementById('lan-qr-container');
      if (qrBox && mode !== 'P2P') {
        const inviteUrl = buildRoomInviteUrl(roomCode, mode);
        qrBox.innerHTML = '';
        const qrImg = document.createElement('img');
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(inviteUrl)}`;
        qrImg.alt = `Room #${roomCode} QR`;
        qrImg.loading = 'lazy';
        qrImg.decoding = 'async';
        qrBox.appendChild(qrImg);
      }
      showToast(`สร้างห้องสำเร็จ! รหัสห้อง: ${roomCode} (${mode})`);
    },
    onRpsState({ mode, roomCode, seat, opponentName, rematch, rpsState }) {
      document.getElementById('waiting-room-banner')?.classList.add('hidden');
      const resultDlg = document.getElementById('dialog-duel-result');
      if (resultDlg?.open) resultDlg.close();
      appState.activeRoomCode = roomCode;
      appState.activeRoomMode = mode;
      appState.lastRpsSeat = seat;
      const prevRoundKey = appState.rpsContext?.lastRenderedRoundKey || null;
      appState.rpsContext = {
        kind: 'MP',
        mode,
        roomCode,
        seat,
        opponentName,
        rematch: Boolean(rematch),
        rpsState,
        lastRenderedRoundKey: prevRoundKey,
        timers: []
      };
      openOrUpdateRpsDialog();
    },
    onMatchStarted({ roomCode, playerIndex, opponentName, rematch, rejoined, rpsSummary }) {
      document.getElementById('waiting-room-banner').classList.add('hidden');
      const resultDlg = document.getElementById('dialog-duel-result');
      if (resultDlg?.open) resultDlg.close();
      closeRpsDialogCleanly();
      appState.activeRoomCode = roomCode;
      appState.gameMode = 'MULTIPLAYER';
      appState.myPlayerIndex = playerIndex;
      appState.currentState = null;
      appState.lastRenderedState = null;
      appState.lastRenderedPlayerIndex = playerIndex;
      cancelStateSyncPlayback({ clearDuelId: true });
      clearDuelVfxLayer();
      resetTurnChangeBannerQueue();
      const orderNote = rpsSummary && typeof appState.lastRpsSeat === 'number'
        ? (rpsSummary.firstSeat === appState.lastRpsSeat
            ? (appState.lang === 'en' ? ' · ⚡ Going First (Turn 1)' : ' · ⚡ ได้เริ่มก่อน (Turn 1)')
            : (appState.lang === 'en' ? ' · 🛡️ Going Second (Turn 2)' : ' · 🛡️ เริ่มทีหลัง (Turn 2)'))
        : '';
      const prefix = rejoined ? '🔌 เชื่อมต่อห้องเดิมสำเร็จ' : (rematch ? '⚔️ เริ่ม Rematch' : '⚔️ เริ่มการดูเอลออนไลน์');
      showToast(`${prefix}กับ ${opponentName}! (ห้อง #${roomCode})${orderNote}`);
      switchScreen('screen-duel');
    },
    onStateSync(payload) {
      enqueuePacedStateSync(payload);
    },
    onP2PStatus(status) {
      renderP2PLiveStatus(status);
    },
    onWsReconnecting({ attempt }) {
      if (attempt === 1 || attempt % 3 === 0) {
        showToast(`🔌 การเชื่อมต่อขาดช่วง กำลังเชื่อมต่อใหม่อัตโนมัติ (ครั้งที่ ${attempt})...`);
      }
    },
    onError(errMsg) {
      renderP2PLiveStatus({ stage: 'error', message: `⚠️ ${errMsg}` });
      showToast(`⚠️ ${errMsg}`);
    },
    onOpponentDisconnected(msg) {
      if (appState.rpsContext?.kind === 'MP') {
        closeRpsDialogCleanly();
      }
      renderP2PLiveStatus({ stage: 'error', message: `🔌 ${msg}` });
      showToast(`🔌 ${msg}`);
    }
  });

  appState.mpManager.connectWebSocket();
}

// ==================== ROCK-PAPER-SCISSORS & TURN ORDER ====================
const RPS_MOVE_EMOJI = Object.freeze({
  ROCK: '✊',
  PAPER: '✋',
  SCISSORS: '✌️'
});

function formatRpsMoveLabel(move, lang = appState.lang) {
  if (!move) return '';
  if (lang === 'en') {
    return move === 'ROCK' ? 'Rock' : move === 'PAPER' ? 'Paper' : 'Scissors';
  }
  return move === 'ROCK' ? 'ค้อน' : move === 'PAPER' ? 'กระดาษ' : 'กรรไกร';
}

function clearRpsTimers() {
  const timers = appState.rpsContext?.timers;
  if (!Array.isArray(timers)) return;
  for (const tId of timers) clearTimeout(tId);
  timers.length = 0;
}

function closeRpsDialogCleanly() {
  clearRpsTimers();
  appState.rpsContext = null;
  const dlg = document.getElementById('dialog-rps');
  if (dlg?.open) {
    closeTopLayer(dlg);
  }
}

async function cancelRpsFlow() {
  const ctx = appState.rpsContext;
  clearRpsTimers();
  appState.rpsContext = null;
  const dlg = document.getElementById('dialog-rps');
  if (dlg?.open) {
    await closeTopLayer(dlg);
  }
  if (ctx?.kind === 'MP') {
    appState.mpManager?.disconnectRoom();
    appState.activeRoomCode = null;
    appState.activeRoomMode = null;
    document.getElementById('waiting-room-banner')?.classList.add('hidden');
    renderP2PLiveStatus({ stage: 'idle', message: '' });
    showToast(appState.lang === 'en' ? '✖️ Left Rock-Paper-Scissors room' : '✖️ ยกเลิกและออกจากห้องเป่ายิ้งฉุบแล้ว');
  }
}

function getActiveRpsViewState() {
  const ctx = appState.rpsContext;
  if (!ctx) return null;
  if (ctx.kind === 'MP') return ctx.rpsState;
  const seat = ctx.kind === 'SANDBOX' ? (ctx.activeTurnSeat ?? 0) : 0;
  return ctx.session.getPublicStateForSeat(seat);
}

function triggerRpsOrbPop(orbEl) {
  if (!orbEl) return;
  orbEl.classList.remove('is-pop');
  void orbEl.offsetWidth;
  orbEl.classList.add('is-pop');
}

function renderRpsModal() {
  const ctx = appState.rpsContext;
  const rpsState = getActiveRpsViewState();
  if (!ctx || !rpsState) return;

  const lang = appState.lang;
  const isEn = lang === 'en';
  const mySeat = ctx.kind === 'SANDBOX' ? 0 : rpsState.mySeat;
  const oppSeat = 1 - mySeat;
  const myName = rpsState.names?.[mySeat] || (isEn ? 'You' : 'คุณ');
  const oppName = rpsState.names?.[oppSeat] || (isEn ? 'Opponent' : 'คู่ต่อสู้');
  const lastRound = rpsState.lastRound;

  const roundBadge = document.getElementById('rps-round-badge');
  const p1Card = document.getElementById('rps-p1-card');
  const p2Card = document.getElementById('rps-p2-card');
  const p1NameEl = document.getElementById('rps-p1-name');
  const p2NameEl = document.getElementById('rps-p2-name');
  const p1HandEl = document.getElementById('rps-p1-hand');
  const p2HandEl = document.getElementById('rps-p2-hand');
  const p1TagEl = document.getElementById('rps-p1-tag');
  const p2TagEl = document.getElementById('rps-p2-tag');
  const vsBadgeEl = document.getElementById('rps-vs-badge');
  const resultEl = document.getElementById('rps-round-result');
  const statusEl = document.getElementById('rps-status-text');
  const pickPanel = document.getElementById('rps-pick-panel');
  const turnPanel = document.getElementById('rps-turn-panel');
  const turnPromptEl = document.getElementById('rps-turn-prompt');
  const firstBtn = document.getElementById('btn-rps-go-first');
  const secondBtn = document.getElementById('btn-rps-go-second');

  if (roundBadge) {
    roundBadge.textContent = isEn ? `Round ${rpsState.round}` : `รอบที่ ${rpsState.round}`;
  }
  if (p1NameEl) p1NameEl.textContent = myName;
  if (p2NameEl) p2NameEl.textContent = oppName;

  p1Card?.classList.remove('is-winner', 'is-draw');
  p2Card?.classList.remove('is-winner', 'is-draw');

  let leftOrb = '❔';
  let rightOrb = '❔';
  let leftTag = '';
  let rightTag = '';
  let roundBanner = '';
  let statusMsg = '';

  const showTieReveal = Boolean(
    rpsState.phase === 'PICKING' &&
    lastRound?.result === 'DRAW' &&
    !(ctx.kind !== 'SANDBOX' && rpsState.myMove) &&
    !(ctx.kind === 'SANDBOX' && ctx.activeTurnSeat === 1)
  );

  if (rpsState.phase === 'CHOOSE_TURN' || rpsState.phase === 'DONE') {
    const myLastMove = lastRound?.moves?.[mySeat];
    const oppLastMove = lastRound?.moves?.[oppSeat];
    leftOrb = RPS_MOVE_EMOJI[myLastMove] || '❔';
    rightOrb = RPS_MOVE_EMOJI[oppLastMove] || '❔';
    leftTag = formatRpsMoveLabel(myLastMove, lang);
    rightTag = formatRpsMoveLabel(oppLastMove, lang);
    const winnerIsLeft = rpsState.winnerSeat === mySeat;
    if (winnerIsLeft) p1Card?.classList.add('is-winner');
    else p2Card?.classList.add('is-winner');
    roundBanner = isEn
      ? `${rpsState.names[rpsState.winnerSeat]} wins!`
      : `${rpsState.names[rpsState.winnerSeat]} ชนะ!`;
  } else if (ctx.kind === 'SANDBOX') {
    if (ctx.activeTurnSeat === 1) {
      leftOrb = '🔒';
      rightOrb = '❔';
      leftTag = isEn ? 'Locked secretly' : 'เลือกซ่อนไว้แล้ว';
      rightTag = isEn ? 'Pick now' : 'เลือกได้เลย';
      roundBanner = 'PASS & PLAY';
      statusMsg = isEn
        ? `${oppName}: Choose Rock, Paper, or Scissors!`
        : `ตาของ ${oppName}: เลือก ค้อน / กระดาษ / กรรไกร!`;
    } else if (showTieReveal) {
      leftOrb = RPS_MOVE_EMOJI[lastRound.moves[0]] || '❔';
      rightOrb = RPS_MOVE_EMOJI[lastRound.moves[1]] || '❔';
      leftTag = formatRpsMoveLabel(lastRound.moves[0], lang);
      rightTag = formatRpsMoveLabel(lastRound.moves[1], lang);
      p1Card?.classList.add('is-draw');
      p2Card?.classList.add('is-draw');
      roundBanner = isEn ? `Draw! R${lastRound.round}` : `เสมอ! รอบ ${lastRound.round}`;
      statusMsg = isEn
        ? `🤝 Draw! ${myName}: Choose secretly for Round ${rpsState.round}!`
        : `🤝 เสมอกัน! ตาของ ${myName}: เลือกรอบที่ ${rpsState.round} (ห้ามแอบดูนะ)!`;
    } else {
      leftOrb = '❔';
      rightOrb = '⏳';
      leftTag = isEn ? 'Pick secretly' : 'เลือกก่อน';
      rightTag = isEn ? 'Next' : 'รอคิว';
      roundBanner = 'PASS & PLAY';
      statusMsg = isEn
        ? `${myName}: Choose Rock, Paper, or Scissors (keep hidden from ${oppName})!`
        : `ตาของ ${myName}: เลือก ค้อน / กระดาษ / กรรไกร (ซ่อนจาก ${oppName})!`;
    }
  } else if (showTieReveal) {
    const myTieMove = lastRound.moves[mySeat];
    const oppTieMove = lastRound.moves[oppSeat];
    leftOrb = RPS_MOVE_EMOJI[myTieMove] || '❔';
    rightOrb = RPS_MOVE_EMOJI[oppTieMove] || '❔';
    leftTag = formatRpsMoveLabel(myTieMove, lang);
    rightTag = formatRpsMoveLabel(oppTieMove, lang);
    p1Card?.classList.add('is-draw');
    p2Card?.classList.add('is-draw');
    roundBanner = isEn ? `Draw! R${lastRound.round}` : `เสมอ! รอบ ${lastRound.round}`;
    statusMsg = isEn
      ? `🤝 Draw (${leftTag} vs ${rightTag})! Throw again for Round ${rpsState.round}!`
      : `🤝 เสมอกัน (${leftTag} ชน ${rightTag})! เป่าใหม่รอบที่ ${rpsState.round}!`;
  } else {
    leftOrb = rpsState.myMove ? RPS_MOVE_EMOJI[rpsState.myMove] : '❔';
    rightOrb = rpsState.myMove
      ? (rpsState.opponentReady ? '✅' : '⏳')
      : (rpsState.opponentReady ? '✅' : '❔');
    leftTag = rpsState.myMove
      ? formatRpsMoveLabel(rpsState.myMove, lang)
      : (isEn ? 'Choose your move' : 'กดเลือกมือของคุณ');
    rightTag = rpsState.opponentReady
      ? (isEn ? 'Move locked!' : 'เลือกเสร็จแล้ว!')
      : (isEn ? 'Picking...' : 'กำลังเลือก...');
    statusMsg = rpsState.myMove
      ? (isEn ? `Waiting for ${oppName} to pick...` : `กำลังรอ ${oppName} ออกมือ...`)
      : (isEn ? 'Pick Rock, Paper, or Scissors to decide turn order!' : 'เลือก ค้อน / กระดาษ / กรรไกร เพื่อชิงสิทธิ์เลือกเริ่มก่อน-หลัง!');
  }

  const revealKey = `${rpsState.phase}:${rpsState.round}:${lastRound?.round || 0}:${rpsState.winnerSeat ?? ''}:${ctx.aiChosenOrder || ''}`;
  const isNewReveal = ctx.lastRenderedRoundKey !== revealKey;
  ctx.lastRenderedRoundKey = revealKey;

  if (p1HandEl) p1HandEl.textContent = leftOrb;
  if (p2HandEl) p2HandEl.textContent = rightOrb;
  if (p1TagEl) p1TagEl.textContent = leftTag;
  if (p2TagEl) p2TagEl.textContent = rightTag;
  if (vsBadgeEl) {
    vsBadgeEl.textContent = rpsState.phase === 'CHOOSE_TURN'
      ? (isEn ? 'WIN' : 'ชนะ')
      : 'VS';
  }
  if (resultEl) resultEl.textContent = roundBanner;

  if (isNewReveal && (rpsState.phase === 'CHOOSE_TURN' || showTieReveal)) {
    triggerRpsOrbPop(p1HandEl);
    triggerRpsOrbPop(p2HandEl);
    sfx.playClick();
  }

  const isPicking = rpsState.phase === 'PICKING';
  const isChooseTurn = rpsState.phase === 'CHOOSE_TURN';
  const activeSeatWon = isChooseTurn && (
    ctx.kind === 'SANDBOX' || rpsState.winnerSeat === mySeat
  );

  pickPanel?.classList.toggle('hidden', !isPicking);
  turnPanel?.classList.toggle('hidden', !activeSeatWon);

  document.querySelectorAll('#rps-pick-panel .rps-move-btn').forEach((btn) => {
    const mv = btn.getAttribute('data-rps-move');
    const selected = Boolean(isPicking && ctx.kind !== 'SANDBOX' && rpsState.myMove === mv);
    btn.classList.toggle('is-selected', selected);
    btn.disabled = !isPicking || (ctx.kind !== 'SANDBOX' && Boolean(rpsState.myMove));
  });

  if (isChooseTurn) {
    if (activeSeatWon) {
      const winnerName = rpsState.names[rpsState.winnerSeat];
      const loserName = rpsState.names[1 - rpsState.winnerSeat];
      statusMsg = isEn
        ? `🏆 ${winnerName} won Rock-Paper-Scissors! Choose who starts Turn 1:`
        : `🏆 ${winnerName} ชนะเป่ายิ้งฉุบ! เลือกว่าใครจะได้เริ่มเทิร์นแรก:`;
      if (turnPromptEl) {
        turnPromptEl.textContent = isEn
          ? `🏆 ${winnerName}: Choose First or Second`
          : `🏆 ${winnerName}: เลือกลำดับการเล่น`;
      }
      if (firstBtn) {
        firstBtn.disabled = false;
        const tEl = firstBtn.querySelector('.rps-turn-title');
        const sEl = firstBtn.querySelector('.rps-turn-sub');
        if (ctx.kind === 'SANDBOX') {
          if (tEl) tEl.textContent = isEn ? `⚡ ${winnerName} Starts First` : `⚡ ${winnerName} เริ่มก่อน`;
          if (sEl) sEl.textContent = isEn ? `${winnerName} takes Turn 1` : `${winnerName} เล่น Turn 1`;
        } else {
          if (tEl) tEl.textContent = t(lang, 'rpsGoFirst');
          if (sEl) sEl.textContent = t(lang, 'rpsGoFirstSub');
        }
      }
      if (secondBtn) {
        secondBtn.disabled = false;
        const tEl = secondBtn.querySelector('.rps-turn-title');
        const sEl = secondBtn.querySelector('.rps-turn-sub');
        if (ctx.kind === 'SANDBOX') {
          if (tEl) tEl.textContent = isEn ? `🛡️ ${loserName} Starts First` : `🛡️ ให้ ${loserName} เริ่มก่อน`;
          if (sEl) sEl.textContent = isEn ? `${loserName} takes Turn 1` : `${loserName} เล่น Turn 1`;
        } else {
          if (tEl) tEl.textContent = t(lang, 'rpsGoSecond');
          if (sEl) sEl.textContent = t(lang, 'rpsGoSecondSub');
        }
      }
      if (isNewReveal) {
        firstBtn?.focus();
      }
    } else if (ctx.kind === 'SOLO') {
      if (ctx.aiChosenOrder) {
        statusMsg = ctx.aiChosenOrder === 'FIRST'
          ? (isEn ? `🤖 ${oppName} chose to Go First (Turn 1)! Starting duel...` : `🤖 ${oppName} เลือกเริ่มเล่นก่อน (Turn 1)! กำลังเปิดสนาม...`)
          : (isEn ? `🤖 ${oppName} chose to Go Second — You start Turn 1!` : `🤖 ${oppName} เลือกเล่นทีหลัง — คุณได้เริ่ม Turn 1!`);
      } else {
        statusMsg = isEn
          ? `🤖 ${oppName} won Rock-Paper-Scissors! AI is choosing turn order...`
          : `🤖 ${oppName} ชนะเป่ายิ้งฉุบ! AI กำลังตัดสินใจเริ่มก่อน-หลัง...`;
      }
    } else {
      statusMsg = isEn
        ? `⏳ ${oppName} won Rock-Paper-Scissors and is choosing who starts first...`
        : `⏳ ${oppName} ชนะเป่ายิ้งฉุบ และกำลังเลือกคนเริ่มเทิร์นแรก...`;
    }
  }

  if (statusEl) statusEl.textContent = statusMsg;
}

function openOrUpdateRpsDialog() {
  const dlg = document.getElementById('dialog-rps');
  if (!dlg) return;
  dlg.removeAttribute('data-closing');
  renderRpsModal();
  if (!dlg.open) {
    dlg.showModal();
  }
}

function launchSoloAfterRps(ctx, firstPlayer = 'human') {
  if (!ctx || appState.rpsContext !== ctx) return;
  clearRpsTimers();
  appState.rpsContext = null;

  appState.gameMode = 'SOLO';
  appState.myPlayerIndex = firstPlayer === 'ai' ? 1 : 0;
  appState.localEngine = null;
  appState.currentState = null;
  appState.lastRenderedState = null;
  appState.lastRenderedPlayerIndex = appState.myPlayerIndex;
  cancelStateSyncPlayback({ clearDuelId: true });
  clearDuelVfxLayer();
  resetTurnChangeBannerQueue();

  const dlg = document.getElementById('dialog-rps');
  if (dlg?.open) closeTopLayer(dlg);

  appState.mpManager.startSoloDuel({
    playerName: ctx.playerName,
    playerDeckId: ctx.playerDeckId,
    aiDeckId: ctx.aiDeckId,
    aiDifficulty: ctx.aiDifficulty || appState.aiDifficulty,
    firstPlayer,
    customDeck: ctx.customPayload?.customDeck || null,
    customCards: ctx.customPayload?.customCards || []
  });
}

function launchSandboxAfterRps(ctx, firstSeat = 0) {
  if (!ctx || appState.rpsContext !== ctx) return;
  clearRpsTimers();
  appState.rpsContext = null;

  const dlg = document.getElementById('dialog-rps');
  if (dlg?.open) closeTopLayer(dlg);

  appState.gameMode = 'SANDBOX';
  appState.myPlayerIndex = firstSeat === 1 ? 1 : 0;
  appState.currentState = null;
  appState.lastRenderedState = null;
  appState.lastRenderedPlayerIndex = appState.myPlayerIndex;
  cancelStateSyncPlayback({ clearDuelId: true });
  clearDuelVfxLayer();
  resetTurnChangeBannerQueue();
  appState.localEngine = new DuelEngine({
    p0Name: ctx.p0Name,
    p0DeckId: ctx.p0DeckId,
    p1Name: ctx.p1Name,
    p1DeckId: ctx.p1DeckId,
    firstPlayerIndex: appState.myPlayerIndex
  });

  switchScreen('screen-duel');
  syncLocalEngineToUI();
  sfx.playSummon();
}

function handleRpsMoveAction(move) {
  const ctx = appState.rpsContext;
  if (!ctx) return;

  if (ctx.kind === 'MP') {
    appState.mpManager.sendRpsMove(move);
    return;
  }

  if (ctx.kind === 'SOLO') {
    const res = ctx.session.submitMove(0, move);
    if (!res.ok) return;
    if (res.draw) {
      // Pre-lock AI's move for the next round right away so fast human clicks never race
      ctx.session.submitMove(1, pickRandomRpsMove());
      openOrUpdateRpsDialog();
      return;
    }
    if (res.winnerSeat === 0) {
      sfx.playSummon();
      openOrUpdateRpsDialog();
      return;
    }
    // AI won RPS: choose FIRST or SECOND after a short dramatic pause
    openOrUpdateRpsDialog();
    const t1 = setTimeout(() => {
      if (appState.rpsContext !== ctx) return;
      const aiOrder = chooseAiTurnOrder(ctx.aiDeckId);
      ctx.session.chooseTurnOrder(1, aiOrder);
      ctx.aiChosenOrder = aiOrder;
      openOrUpdateRpsDialog();
      const t2 = setTimeout(() => {
        launchSoloAfterRps(ctx, aiOrder === 'FIRST' ? 'ai' : 'human');
      }, 650);
      ctx.timers.push(t2);
    }, 700);
    ctx.timers.push(t1);
    return;
  }

  if (ctx.kind === 'SANDBOX') {
    const seat = ctx.activeTurnSeat === 1 ? 1 : 0;
    const res = ctx.session.submitMove(seat, move);
    if (!res.ok) return;
    if (!res.roundResolved) {
      ctx.activeTurnSeat = 1;
      openOrUpdateRpsDialog();
      return;
    }
    if (res.draw) {
      ctx.activeTurnSeat = 0;
      openOrUpdateRpsDialog();
      return;
    }
    sfx.playSummon();
    openOrUpdateRpsDialog();
  }
}

function handleRpsTurnOrderAction(order) {
  const ctx = appState.rpsContext;
  if (!ctx) return;

  if (ctx.kind === 'MP') {
    document.getElementById('btn-rps-go-first')?.setAttribute('disabled', 'disabled');
    document.getElementById('btn-rps-go-second')?.setAttribute('disabled', 'disabled');
    appState.mpManager.sendRpsTurnChoice(order);
    return;
  }

  if (ctx.kind === 'SOLO') {
    const res = ctx.session.chooseTurnOrder(0, order);
    if (!res.ok) return;
    launchSoloAfterRps(ctx, order === 'FIRST' ? 'human' : 'ai');
    return;
  }

  if (ctx.kind === 'SANDBOX') {
    const winnerSeat = ctx.session.winnerSeat;
    const res = ctx.session.chooseTurnOrder(winnerSeat, order);
    if (!res.ok) return;
    launchSandboxAfterRps(ctx, res.firstSeat);
  }
}

function setupRpsDialogBindings() {
  const dlg = document.getElementById('dialog-rps');
  if (!dlg) return;

  dlg.addEventListener('cancel', (event) => {
    event.preventDefault();
    cancelRpsFlow();
  });

  document.getElementById('btn-rps-cancel')?.addEventListener('click', () => {
    cancelRpsFlow();
  });

  document.querySelectorAll('#rps-pick-panel .rps-move-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const move = btn.getAttribute('data-rps-move');
      if (move) handleRpsMoveAction(move);
    });
  });

  document.getElementById('btn-rps-go-first')?.addEventListener('click', () => {
    handleRpsTurnOrderAction('FIRST');
  });

  document.getElementById('btn-rps-go-second')?.addEventListener('click', () => {
    handleRpsTurnOrderAction('SECOND');
  });
}

function updateAiDifficultyUI() {
  const diff = appState.aiDifficulty || 'normal';
  document.querySelectorAll('#solo-difficulty-group .solo-diff-btn').forEach((btn) => {
    const btnDiff = btn.getAttribute('data-difficulty');
    const isActive = btnDiff === diff;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
  const hintEl = document.getElementById('solo-diff-hint');
  if (hintEl) {
    const descKey = diff === 'easy' ? 'diffEasyDesc' : diff === 'hard' ? 'diffHardDesc' : 'diffNormalDesc';
    hintEl.textContent = t(appState.lang, descKey);
  }
}

function setupAiDifficultySelector() {
  const group = document.getElementById('solo-difficulty-group');
  if (!group) return;
  group.addEventListener('click', (event) => {
    const btn = event.target.closest('.solo-diff-btn');
    if (!btn) return;
    const next = btn.getAttribute('data-difficulty');
    if (!next) return;
    appState.aiDifficulty = saveAiDifficulty(next);
    updateAiDifficultyUI();
    sfx.playClick();
  });
  updateAiDifficultyUI();
}

// ==================== STARTING DUELS (SOLO & SANDBOX VIA RPS) ====================
function startSoloDuel() {
  clearRpsTimers();
  const playerName = document.getElementById('input-player-name').value.trim() || 'Player 1';
  const aiDeckId = resolveOpponentDeckId();
  const aiDifficulty = appState.aiDifficulty || 'normal';
  const diffSuffix = aiDifficulty === 'easy' ? 'Easy' : aiDifficulty === 'hard' ? 'Hard' : 'Normal';
  const aiName = `YGOPro AI (${diffSuffix})`;
  const customPayload = buildSelectedCustomDeckPayload(appState.selectedDeckId);

  const session = new RpsSession([playerName, aiName]);
  session.submitMove(1, pickRandomRpsMove());

  appState.rpsContext = {
    kind: 'SOLO',
    session,
    playerName,
    playerDeckId: appState.selectedDeckId,
    aiDeckId,
    aiDifficulty,
    customPayload,
    aiChosenOrder: null,
    lastRenderedRoundKey: null,
    timers: []
  };
  openOrUpdateRpsDialog();
}

function startSandboxDuel() {
  clearRpsTimers();
  const playerName = document.getElementById('input-player-name').value.trim() || 'ผู้เล่น 1';
  const oppDeckId = resolveOpponentDeckId();
  const p0Name = `${playerName} (P1)`;
  const p1Name = appState.lang === 'en' ? 'Player 2 (Sandbox)' : 'ผู้เล่น 2 (P2 Sandbox)';

  const session = new RpsSession([p0Name, p1Name]);
  appState.rpsContext = {
    kind: 'SANDBOX',
    session,
    activeTurnSeat: 0,
    p0Name,
    p0DeckId: appState.selectedDeckId,
    p1Name,
    p1DeckId: oppDeckId,
    lastRenderedRoundKey: null,
    timers: []
  };
  openOrUpdateRpsDialog();
}

function syncLocalEngineToUI() {
  if (!appState.localEngine) return;
  const engine = appState.localEngine;
  appState.currentState = engine.state;

  // In SOLO mode, if AI is prompted for a Chain Response during Player 0's turn, let AI respond automatically!
  if (appState.gameMode === 'SOLO' &&
      engine.state.pendingChainPrompt &&
      engine.state.pendingChainPrompt.responderIndex === 1) {
    setTimeout(() => {
      const aiChainMove = AIPlayer.chooseNextAction(engine, 1, appState.aiDifficulty);
      if (aiChainMove) {
        engine.executeAction(1, aiChainMove);
        syncLocalEngineToUI();
      }
    }, 450);
    return;
  }

  // In SANDBOX mode, auto-switch perspective to whoever has priority (pending chain responder or turnPlayer)
  if (appState.gameMode === 'SANDBOX') {
    appState.myPlayerIndex = engine.state.pendingChainPrompt
      ? engine.state.pendingChainPrompt.responderIndex
      : engine.state.turnPlayer;
  }

  appState.legalActions = engine.getLegalActions(appState.myPlayerIndex);
  renderDuelScreen();

  // If SOLO mode and it's AI's turn (and no pending chain prompt for Player 0), run AI step
  if (appState.gameMode === 'SOLO' &&
      engine.state.winner === null &&
      engine.state.turnPlayer === 1 &&
      !engine.state.pendingChainPrompt) {
    clearTimeout(appState.aiTimer);
    appState.aiTimer = setTimeout(() => {
      const aiMove = AIPlayer.chooseNextAction(engine, 1, appState.aiDifficulty);
      if (aiMove) {
        engine.executeAction(1, aiMove);
        syncLocalEngineToUI();
      }
    }, 620);
  }
}

let handSuppressTimerId = null;
let activeHandSuppressCleanup = null;

function collapseHandDock() {
  const dock = document.querySelector('.player-bottom-dock');
  if (!dock) return;
  if (activeHandSuppressCleanup) {
    activeHandSuppressCleanup();
    activeHandSuppressCleanup = null;
  }
  dock.classList.remove('hand-expanded');
  clearSelectedHandCard();

  // Coarse/touch pointers use Tap-First mode and don't hover-expand the hand dock
  if (isCoarseTouchPointer()) {
    dock.classList.remove('hand-suppressed');
    return;
  }

  dock.classList.add('hand-suppressed');
  if (document.activeElement && dock.contains(document.activeElement)) {
    document.activeElement.blur?.();
  }
  const clearSuppressed = () => {
    if (handSuppressTimerId !== null) {
      clearTimeout(handSuppressTimerId);
      handSuppressTimerId = null;
    }
    dock.classList.remove('hand-suppressed');
    dock.removeEventListener('pointerleave', clearSuppressed);
    dock.removeEventListener('pointerdown', clearSuppressed, true);
    if (activeHandSuppressCleanup === clearSuppressed) {
      activeHandSuppressCleanup = null;
    }
  };
  activeHandSuppressCleanup = clearSuppressed;
  dock.addEventListener('pointerleave', clearSuppressed, { once: true });
  handSuppressTimerId = setTimeout(() => {
    handSuppressTimerId = null;
    if (activeHandSuppressCleanup === clearSuppressed) {
      dock.addEventListener('pointerdown', clearSuppressed, { once: true, capture: true });
    }
  }, 120);
}

function dispatchDuelAction(actionPayload) {
  hideActionPopup(true);
  clearZonePickMode(true);
  collapseHandDock();

  // Interactive Master Rule target/cost/search selection before activating effect
  if (!actionPayload.choices &&
      appState.localEngine &&
      (actionPayload.type === 'ACTIVATE_EFFECT' || (actionPayload.type === 'CHAIN_RESPONSE' && actionPayload.respond))) {
    const actorIndex = actionPayload.forcePlayerIndex ?? appState.myPlayerIndex;
    const found = appState.localEngine.findCardInstance(actionPayload.instanceId);
    const card = found?.card;
    const effect = card
      ? (appState.localEngine.resolveCardEffect
          ? appState.localEngine.resolveCardEffect(card, actionPayload.effectId)
          : card.effects?.find(e => e.id === actionPayload.effectId))
      : null;
    if (card && effect) {
      const steps = EffectResolver.getChoiceRequirements(appState.localEngine, actorIndex, card, effect);
      if (steps.length > 0) {
        openEffectChoiceModal(card, effect, steps, actionPayload);
        return;
      }
    }
  }

  if (actionPayload.type === 'NORMAL_SUMMON' || actionPayload.type === 'INHERENT_SPECIAL_SUMMON' || actionPayload.type === 'EXTRA_DECK_SUMMON') {
    sfx.playSummon();
  } else if (actionPayload.type === 'DECLARE_ATTACK') {
    sfx.playAttack();
  }

  if (actionPayload?.type === 'SURRENDER') {
    cancelStateSyncPlayback();
    clearDuelVfxLayer();
  }

  if (appState.gameMode === 'MULTIPLAYER' || (appState.gameMode === 'SOLO' && !appState.localEngine)) {
    appState.mpManager.sendDuelAction(actionPayload);
  } else if (appState.localEngine) {
    const actorIndex = actionPayload.forcePlayerIndex ?? appState.myPlayerIndex;
    const res = appState.localEngine.executeAction(actorIndex, actionPayload);
    if (!res.ok) {
      showToast(`⚠️ ${res.errorTh}`);
      return;
    }
    syncLocalEngineToUI();
  }
}

function openEffectChoiceModal(sourceCard, effect, steps, baseActionPayload) {
  const dlg = document.getElementById('dialog-zone-browser');
  if (!dlg) return;

  const collectedChoices = {};
  let currentStepIdx = 0;

  const renderStep = () => {
    const step = steps[currentStepIdx];
    const lang = appState.lang;
    const candidates = step.candidates || [];
    const targetPickCount = Math.max(1, Math.min(step.count || 1, candidates.length || 1));
    const selectedVals = [];
    const stepTitle = lang === 'en' ? (step.titleEn || step.titleTh) : step.titleTh;
    document.getElementById('zone-browser-title').textContent =
      `🎯 ${getLocalizedCardName(sourceCard, lang)} — ${stepTitle}`;

    const updateSubtitle = () => {
      const countText = targetPickCount > 1
        ? (lang === 'en'
            ? ` (Selected ${selectedVals.length}/${targetPickCount})`
            : ` (เลือกแล้ว ${selectedVals.length}/${targetPickCount})`)
        : '';
      document.getElementById('zone-browser-subtitle').textContent =
        lang === 'en'
          ? `Step ${currentStepIdx + 1}/${steps.length}: Select ${targetPickCount} card(s) for "${effect.labelTh}"${countText}`
          : `ขั้นตอนที่ ${currentStepIdx + 1}/${steps.length}: กดเลือก ${targetPickCount} ใบสำหรับ "${effect.labelTh}"${countText}`;
    };
    updateSubtitle();

    const grid = document.getElementById('zone-browser-grid');
    grid.innerHTML = '';

    for (const candidate of candidates) {
      const box = document.createElement('div');
      box.className = 'browser-card-box playable-glow';
      box.innerHTML = `
        <div class="browser-card-head">
          <img class="browser-card-thumb" src="${getCardArtUrl(candidate)}" alt="${escapeHtml(candidate.name)}" loading="lazy" decoding="async" />
          <div class="browser-card-meta">
            <div class="browser-card-name">${escapeHtml(getLocalizedCardName(candidate, lang))}</div>
            <div class="browser-card-sub">${escapeHtml(getCardSubHeaderBadge(candidate, lang))}${candidate.kind === 'MONSTER' ? ` • ATK ${candidate.currentAtk ?? candidate.atk}` : ''}</div>
          </div>
        </div>
        <div class="browser-card-desc">${escapeHtml(getLocalizedCardDesc(candidate, lang))}</div>
        <div class="zone-card-actions browser-card-actions"></div>
      `;
      const img = box.querySelector('img');
      img?.addEventListener('error', () => {
        img.src = generateProceduralCardSvg(candidate);
      }, { once: true });
      box.addEventListener('mouseenter', () => inspectCard(candidate));

      const pickedVal = candidate[step.valueProp];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-gold btn-mini';

      const syncButtonVisual = () => {
        const isSelected = selectedVals.includes(pickedVal);
        box.classList.toggle('is-picked', isSelected);
        if (isSelected) {
          btn.textContent = lang === 'en' ? `Selected (${selectedVals.length}/${targetPickCount})` : `เลือกแล้ว (คลิกเพื่อยกเลิก)`;
        } else {
          btn.textContent = lang === 'en' ? `Select "${candidate.name}"` : `เลือก "${candidate.nameTh}"`;
        }
      };
      syncButtonVisual();

      btn.addEventListener('click', () => {
        if (targetPickCount === 1) {
          collectedChoices[step.key] = step.isArray ? [pickedVal] : pickedVal;
          currentStepIdx++;
          if (currentStepIdx < steps.length) {
            renderStep();
          } else {
            dlg.close();
            dispatchDuelAction({
              ...baseActionPayload,
              choices: collectedChoices
            });
          }
          return;
        }

        const existingIdx = selectedVals.indexOf(pickedVal);
        if (existingIdx !== -1) {
          selectedVals.splice(existingIdx, 1);
          syncButtonVisual();
          updateSubtitle();
          return;
        }

        selectedVals.push(pickedVal);
        syncButtonVisual();
        updateSubtitle();

        if (selectedVals.length >= targetPickCount) {
          collectedChoices[step.key] = step.isArray ? [...selectedVals] : selectedVals[0];
          currentStepIdx++;
          if (currentStepIdx < steps.length) {
            renderStep();
          } else {
            dlg.close();
            dispatchDuelAction({
              ...baseActionPayload,
              choices: collectedChoices
            });
          }
        }
      });
      box.querySelector('.zone-card-actions')?.appendChild(btn);
      grid.appendChild(box);
    }
  };

  renderStep();
  if (!dlg.open) {
    dlg.showModal();
  }
}

const AI_STEP_IMPACT_PACE_MS = 440;
const AI_STEP_MINOR_PACE_MS = 380;
const AI_STEP_PHASE_ONLY_PACE_MS = 250;
const AI_STEP_FAST_PACE_MS = 320;
const AI_STEP_TURBO_PACE_MS = 240;
const AI_STEP_REDUCED_MOTION_PACE_MS = 180;
const MAX_STATE_SYNC_QUEUE = 40;

const stateSyncPacer = {
  queue: [],
  timer: null,
  lastApplyAt: 0,
  duelId: null,
  epoch: 0,
  isPlayingAiSteps: false,
  lastAppliedWasAiStep: false
};

function cancelStateSyncPlayback({ clearDuelId = false } = {}) {
  stateSyncPacer.epoch++;
  if (stateSyncPacer.timer) {
    clearTimeout(stateSyncPacer.timer);
    stateSyncPacer.timer = null;
  }
  stateSyncPacer.queue = [];
  stateSyncPacer.isPlayingAiSteps = false;
  stateSyncPacer.lastAppliedWasAiStep = false;
  if (clearDuelId) {
    stateSyncPacer.duelId = null;
  }
}

function buildClientStateSyncSig(state) {
  if (!state) return '';
  const p0 = state.players?.[0];
  const p1 = state.players?.[1];
  return [
    state.duelId ?? '',
    state.turnCount ?? 0,
    state.turnPlayer ?? 0,
    state.phase ?? '',
    state.eventSeq ?? 0,
    state.battleSeq ?? 0,
    p0?.lp ?? 0,
    p1?.lp ?? 0,
    p0?.hand?.length ?? 0,
    p1?.hand?.length ?? 0,
    state.chainStack?.length ?? 0,
    state.winner ?? ''
  ].join('|');
}

function computeStepPaceMs(prevState, nextPayload, remainingQueueLen) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    return AI_STEP_REDUCED_MOTION_PACE_MS;
  }
  const nextState = nextPayload?.state;
  const prevSeq = Number(prevState?.eventSeq || 0);
  const prevBattleSeq = Number(prevState?.battleSeq || 0);
  const hasBattle = Number(nextState?.battleSeq || 0) > prevBattleSeq;
  const hasLpDelta = Boolean(
    prevState?.players && nextState?.players && (
      prevState.players[0]?.lp !== nextState.players[0]?.lp ||
      prevState.players[1]?.lp !== nextState.players[1]?.lp
    )
  );
  const freshEvents = Array.isArray(nextState?.recentEvents)
    ? nextState.recentEvents.filter((ev) => ev && (typeof ev.seq !== 'number' || ev.seq > prevSeq))
    : [];
  const hasHighImpactEvent = hasBattle || hasLpDelta || freshEvents.some((ev) => (
    ev.type === 'SUMMON' || ev.type === 'CHAINING' || ev.type === 'SET' || ev.type === 'POS_CHANGE'
  ));
  const hasMinorCardEvent = freshEvents.some((ev) => ev.type === 'DRAW' || ev.type === 'MOVE');

  let baseMs = AI_STEP_PHASE_ONLY_PACE_MS;
  if (hasHighImpactEvent) {
    baseMs = AI_STEP_IMPACT_PACE_MS;
  } else if (hasMinorCardEvent) {
    baseMs = AI_STEP_MINOR_PACE_MS;
  }

  if (remainingQueueLen > 12) {
    return Math.min(baseMs, AI_STEP_TURBO_PACE_MS);
  }
  if (remainingQueueLen > 6) {
    return Math.min(baseMs, AI_STEP_FAST_PACE_MS);
  }
  return baseMs;
}

function applyDuelStateSync(payload) {
  const { mode, state, playerIndex, legalActions, isAiStep = false } = payload || {};
  appState.currentState = state;
  appState.myPlayerIndex = playerIndex;
  appState.legalActions = legalActions;
  if (mode === 'SOLO') {
    appState.gameMode = 'SOLO';
    closeRpsDialogCleanly();
    if (!document.getElementById('screen-duel')?.classList.contains('active')) {
      switchScreen('screen-duel');
      sfx.playSummon();
    }
  }
  // Never pop an interactive OCG prompt modal during intermediate AI step playback
  appState.activeOcgPrompt =
    !isAiStep && state?.pendingOcgPrompt && state.pendingOcgPrompt.player === playerIndex
      ? state.pendingOcgPrompt
      : null;
  renderDuelScreen({ isAiStep: Boolean(isAiStep) });
  if (appState.activeOcgPrompt) {
    renderOcgPromptModal(appState.activeOcgPrompt);
  } else {
    clearZonePickMode(true);
    closeYgoproCardStrip('ocg-strip');
    const dlg = document.getElementById('dialog-zone-browser');
    if (dlg?.open && dlg.dataset.ocgPrompt === '1') {
      dlg.dataset.ocgPrompt = '';
      dlg.close();
    }
  }
}

function pumpStateSyncQueue() {
  if (stateSyncPacer.timer || stateSyncPacer.queue.length === 0) {
    if (stateSyncPacer.queue.length === 0 && !stateSyncPacer.timer) {
      stateSyncPacer.isPlayingAiSteps = false;
    }
    return;
  }
  const peek = stateSyncPacer.queue[0];
  const shouldPace = Boolean(stateSyncPacer.lastAppliedWasAiStep || peek?.isAiStep);
  const paceMs = shouldPace
    ? computeStepPaceMs(appState.lastRenderedState, peek, stateSyncPacer.queue.length)
    : 0;
  const elapsed = Date.now() - stateSyncPacer.lastApplyAt;
  const waitMs = Math.max(0, paceMs - elapsed);
  const expectedEpoch = stateSyncPacer.epoch;

  const runNext = () => {
    stateSyncPacer.timer = null;
    if (stateSyncPacer.epoch !== expectedEpoch) return;
    const next = stateSyncPacer.queue.shift();
    if (!next) {
      stateSyncPacer.isPlayingAiSteps = false;
      return;
    }
    stateSyncPacer.lastApplyAt = Date.now();
    stateSyncPacer.lastAppliedWasAiStep = Boolean(next.isAiStep);
    stateSyncPacer.isPlayingAiSteps = Boolean(next.isAiStep || stateSyncPacer.queue.some((item) => item?.isAiStep));
    applyDuelStateSync(next);
    if (stateSyncPacer.queue.length > 0) {
      pumpStateSyncQueue();
    } else {
      stateSyncPacer.isPlayingAiSteps = false;
    }
  };

  if (waitMs === 0) {
    runNext();
  } else {
    stateSyncPacer.isPlayingAiSteps = Boolean(stateSyncPacer.lastAppliedWasAiStep || peek?.isAiStep);
    stateSyncPacer.timer = setTimeout(runNext, waitMs);
  }
}

function enqueuePacedStateSync(payload) {
  if (!payload?.state) return;
  const incomingDuelId = payload.state.duelId || null;
  const isNewDuel = !appState.currentState || (incomingDuelId && stateSyncPacer.duelId !== incomingDuelId);

  if (isNewDuel) {
    cancelStateSyncPlayback();
    stateSyncPacer.duelId = incomingDuelId;
    stateSyncPacer.lastApplyAt = Date.now();
    stateSyncPacer.lastAppliedWasAiStep = Boolean(payload.isAiStep);
    stateSyncPacer.isPlayingAiSteps = Boolean(payload.isAiStep);
    appState.lastAutoInspectedEventKey = null;
    appState.lastRenderedState = null;
    clearDuelVfxLayer();
    resetTurnChangeBannerQueue();
    resetDuelRenderCaches();
    appState.knownCardsById.clear();
    appState.knownCardsByCode.clear();
    appState.knownCardsByName.clear();
    closeMobileCardDetail();
    applyDuelStateSync(payload);
    return;
  }

  // Immediate flush on surrender so player never waits behind queued AI steps
  if (!payload.isAiStep && payload.state.winReason === 'surrender') {
    cancelStateSyncPlayback();
    stateSyncPacer.lastApplyAt = Date.now();
    applyDuelStateSync(payload);
    return;
  }

  // Human / non-AI sync with no AI playback ahead applies immediately (0ms lag)
  if (!payload.isAiStep && !stateSyncPacer.isPlayingAiSteps && stateSyncPacer.queue.length === 0 && !stateSyncPacer.timer) {
    stateSyncPacer.lastApplyAt = Date.now();
    stateSyncPacer.lastAppliedWasAiStep = false;
    applyDuelStateSync(payload);
    return;
  }

  // Skip exact no-op intermediate AI step duplicates
  if (payload.isAiStep) {
    const prevQueued = stateSyncPacer.queue.length > 0
      ? stateSyncPacer.queue[stateSyncPacer.queue.length - 1]?.state
      : appState.currentState;
    if (prevQueued && buildClientStateSyncSig(prevQueued) === buildClientStateSyncSig(payload.state)) {
      return;
    }
  }

  // Keep queue bounded so rapid bursts never lag behind indefinitely while preserving final non-AI frame
  if (stateSyncPacer.queue.length >= MAX_STATE_SYNC_QUEUE) {
    const dropIdx = stateSyncPacer.queue.findIndex((item) => item?.isAiStep);
    stateSyncPacer.queue.splice(dropIdx >= 0 ? dropIdx : 0, 1);
  }
  stateSyncPacer.queue.push(payload);
  pumpStateSyncQueue();
}

// ==================== DUEL SCREEN RENDERING (ZONE-DIRTY DIFFING) ====================
function serializeActionsSig(acts) {
  if (!Array.isArray(acts) || acts.length === 0) return '';
  let out = '';
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    if (i > 0) out += ',';
    out += `${a.type}:${a.effectId || ''}:${a.position || ''}:${a.ocgAction ?? ''}:${a.ocgIndex ?? ''}:${a.isPendulumScale ? 1 : 0}:${a.label || a.labelTh || ''}`;
  }
  return out;
}

function serializeAttackSig(atkInfo, oppTargetsSig) {
  if (!atkInfo) return '';
  if (Array.isArray(atkInfo)) {
    return `A:${atkInfo.map(item => (item.isDirect ? 'D' : item.instanceId || '')).join(',')}`;
  }
  return `O:${atkInfo.canDirectAttack ? 1 : 0}:${(atkInfo.targets || []).join(',')}|${oppTargetsSig}`;
}

function computeCardRenderSig(card, isSelf, legal, chainLinkMap, oppTargetsSig, isHand = false) {
  if (!card) return '_';
  const isFaceDown = !isSelf && (card.position === POSITIONS.SET || card.position === POSITIONS.SET_DEF);
  const cl = chainLinkMap.get(card.instanceId) || 0;
  if (isFaceDown) {
    return `FD:${card.instanceId}:${card.position}:${card.zone || ''}:${card.zoneIndex ?? ''}:${cl}`;
  }
  const acts = isSelf
    ? (isHand ? (legal.handActions?.[card.instanceId] || []) : (legal.fieldActions?.[card.instanceId] || []))
    : [];
  const atkInfo = (isSelf && !isHand) ? legal.attackTargets?.[card.instanceId] : null;
  const ovlLen = Array.isArray(card.overlayUnits) ? card.overlayUnits.length : 0;
  const counterSig = card.counters
    ? (typeof card.counters === 'object' ? JSON.stringify(card.counters) : String(card.counters))
    : (card.counterCount || 0);
  return [
    card.instanceId,
    card.passcode || card.code || card.id || '',
    card.position || '',
    card.zone || '',
    card.zoneIndex ?? '',
    card.controller ?? '',
    card.currentAtk ?? card.atk ?? '',
    card.currentDef ?? card.def ?? '',
    card.currentLevel ?? card.level ?? card.rank ?? card.linkRating ?? '',
    card.effectsNegated ? 1 : 0,
    ovlLen,
    counterSig,
    cl,
    card.equipTargetInstanceId || '',
    serializeActionsSig(acts),
    serializeAttackSig(atkInfo, oppTargetsSig)
  ].join('~');
}

function ensureLingeringHud() {
  if (!appState.lingeringHud) {
    const mountEl = document.getElementById('lingering-hud-mount');
    if (mountEl) {
      appState.lingeringHud = mountLingeringHud(mountEl, {
        t,
        getLang: () => appState.lang,
        getCardArtUrl
      });
    }
  }
  return appState.lingeringHud;
}

function renderDuelScreen(renderOpts = {}) {
  const state = appState.currentState;
  if (!state) return;
  const isAiStep = Boolean(renderOpts?.isAiStep);

  const myIdx = appState.myPlayerIndex;
  const oppIdx = 1 - myIdx;
  const lang = appState.lang;
  const isDuelVisible = document.getElementById('screen-duel')?.classList.contains('active');

  if (
    !appState.lastRenderedState ||
    zoneRenderCache.duelId !== state.duelId ||
    zoneRenderCache.myIdx !== myIdx ||
    zoneRenderCache.lang !== lang
  ) {
    resetDuelRenderCaches();
    zoneRenderCache.duelId = state.duelId;
    zoneRenderCache.myIdx = myIdx;
    zoneRenderCache.lang = lang;
  }

  let prevSnapshot = null;
  if (isDuelVisible) {
    if (appState.lastRenderedState && appState.lastRenderedPlayerIndex === myIdx) {
      prevSnapshot = captureBoardSnapshot(appState.lastRenderedState, myIdx);
    } else if (!appState.lastRenderedState) {
      const initialSnap = captureBoardSnapshot(state, myIdx);
      if (initialSnap) {
        prevSnapshot = {
          ...initialSnap,
          isInitialRender: true,
          cards: new Map(),
          zones: new Map(),
          handOrder: [],
          oppHandCount: 0,
          lastBattleSeq: state.battleSeq || 0,
          lastEventSeq: state.eventSeq || 0
        };
      }
    }
  }

  const me = state.players[myIdx];
  const opp = state.players[oppIdx];
  const legal = appState.legalActions || {
    handActions: {},
    fieldActions: {},
    gyActions: {},
    banishedActions: {},
    extraActions: {},
    attackTargets: {}
  };

  // Harvest visible/public card metadata for fast chain & duel-log inspection
  harvestKnownCardsFromState(state, myIdx, legal);

  // Precompute shared render context for zone-dirty signatures
  const chainLinkMap = new Map();
  for (const item of (state.chainStack || [])) {
    if (item?.card?.instanceId) {
      chainLinkMap.set(item.card.instanceId, item.chainLink);
    }
  }
  const oppAttackTargetsSig = [...(opp.mmz || []), opp.emz, ...(opp.emzSlots || [])]
    .filter(Boolean)
    .map((c) => `${c.instanceId}:${c.position}:${c.currentAtk ?? c.atk ?? 0}:${c.currentDef ?? c.def ?? 0}`)
    .join(';');
  const isZonePickingActive = document.body.classList.contains('is-zone-picking') ? 1 : 0;
  const renderCtx = { chainLinkMap, oppAttackTargetsSig, isZonePickingActive };

  // 1. Update Player & Opponent HUDs
  const setTextIfChanged = (id, val) => {
    const el = document.getElementById(id);
    const next = String(val);
    if (el && el.textContent !== next) el.textContent = next;
  };
  setTextIfChanged('self-name', me.name);
  setTextIfChanged('self-lp-value', me.lp);
  setTextIfChanged('self-deck-count', me.deck.length);
  setTextIfChanged('self-gy-count', me.gy.length);
  setTextIfChanged('self-banished-count', me.banished.length);
  setTextIfChanged('self-extra-count', me.extra.length);

  setTextIfChanged('opp-name', opp.name);
  setTextIfChanged('opp-lp-value', opp.lp);
  setTextIfChanged('opp-deck-count', opp.deck.length);
  setTextIfChanged('opp-extra-count', opp.extra.length);
  renderChainStackOverlay(state.chainStack || [], myIdx);
  setTextIfChanged('opp-deck-mat-count', opp.deck.length);
  setTextIfChanged('opp-extra-mat-count', opp.extra.length);
  setTextIfChanged('opp-gy-count', opp.gy.length);
  setTextIfChanged('opp-banished-count', opp.banished.length);
  setTextIfChanged('opp-gy-mat-count', opp.gy.length);
  setTextIfChanged('opp-banished-mat-count', opp.banished.length);

  // Opponent Hand Backs (delta update — only append/remove changed count)
  const oppHandBar = document.getElementById('opp-hand-bar');
  if (oppHandBar) {
    const targetOppHandLen = opp.hand.length;
    const oppHandSig = `OH:${targetOppHandLen}`;
    if (zoneRenderCache.zones.get('opp-hand') !== oppHandSig || oppHandBar.children.length !== targetOppHandLen) {
      while (oppHandBar.children.length > targetOppHandLen) {
        oppHandBar.lastElementChild?.remove();
      }
      if (oppHandBar.children.length < targetOppHandLen) {
        const frag = document.createDocumentFragment();
        for (let i = oppHandBar.children.length; i < targetOppHandLen; i++) {
          const back = document.createElement('div');
          back.className = 'opp-hand-card-back';
          frag.appendChild(back);
        }
        oppHandBar.appendChild(frag);
      }
      zoneRenderCache.zones.set('opp-hand', oppHandSig);
    }
  }

  // Highlight Extra Deck, GY & Banished buttons with glowing circular ring if they have legal actions!
  const extraBtn = document.getElementById('btn-self-extra');
  extraBtn?.classList.toggle('playable-glow', Object.keys(legal.extraActions || {}).length > 0);

  const gyBtn = document.getElementById('btn-self-gy');
  const hasGyActs = Object.keys(legal.gyActions || {}).length > 0;
  gyBtn?.classList.toggle('playable-glow', hasGyActs);
  gyBtn?.classList.toggle('zone-effect-active', hasGyActs);

  const banishedBtn = document.getElementById('btn-self-banished');
  const hasBanishedActs = Object.keys(legal.banishedActions || {}).length > 0;
  banishedBtn?.classList.toggle('playable-glow', hasBanishedActs);
  banishedBtn?.classList.toggle('zone-effect-active', hasBanishedActs);

  // 2. Update Phase Orb, Turn Elapsed Indicator & Action Buttons
  const isMyTurn = state.turnPlayer === myIdx;
  const elapsedTurns = Math.max(0, state.turnCount - 1);
  const turnPill = document.getElementById('turn-indicator-pill');
  const shortPhaseNames = { DP: 'Draw', SP: 'Standby', MP1: 'Main 1', BP: 'Battle', MP2: 'Main 2', EP: 'End' };
  const turnPillSig = `${state.turnCount}:${state.phase}:${isMyTurn ? 1 : 0}:${lang}`;
  if (turnPill && zoneRenderCache.zones.get('turn-pill') !== turnPillSig) {
    turnPill.innerHTML = `<span class="orb-turn-num">Turn ${state.turnCount}</span><span class="orb-phase-name">${shortPhaseNames[state.phase] || state.phase}</span><span class="orb-turn-owner">${t(lang, isMyTurn ? 'yourTurn' : 'oppTurn')}</span>`;
    turnPill.classList.toggle('opp-turn-orb', !isMyTurn);
    zoneRenderCache.zones.set('turn-pill', turnPillSig);
  }

  const phaseTurnHeader = document.getElementById('phase-turn-header');
  if (phaseTurnHeader) {
    const nextHdr = `T${state.turnCount}`;
    if (phaseTurnHeader.textContent !== nextHdr) phaseTurnHeader.textContent = nextHdr;
    phaseTurnHeader.title = lang === 'en'
      ? `Turn ${state.turnCount} (${elapsedTurns} turns elapsed)`
      : `เทิร์นที่ ${state.turnCount} (ผ่านมาแล้ว ${elapsedTurns} เทิร์น)`;
  }

  const turnElapsedPill = document.getElementById('turn-elapsed-pill');
  if (turnElapsedPill) {
    const elapsedText = lang === 'en'
      ? `Turn ${state.turnCount} (${elapsedTurns} elapsed)`
      : `เทิร์นที่ ${state.turnCount} (ผ่านมา ${elapsedTurns} เทิร์น)`;
    const elapsedSig = `TE:${elapsedText}`;
    if (zoneRenderCache.zones.get('turn-elapsed') !== elapsedSig) {
      turnElapsedPill.innerHTML = `${iconSvg('clock')}<span>${escapeHtml(elapsedText)}</span>`;
      zoneRenderCache.zones.set('turn-elapsed', elapsedSig);
    }
  }

  document.querySelectorAll('#phase-steps-bar .phase-badge').forEach((badge) => {
    const p = badge.getAttribute('data-phase');
    const isActive = p === state.phase;
    const canJumpToBp = isMyTurn && p === PHASES.BP && Boolean(legal.canBattlePhase ?? (state.phase === PHASES.MP1 && state.turnCount > 1));
    const canJumpToMp2 = isMyTurn && p === PHASES.MP2 && Boolean(legal.canMainPhase2 ?? (state.phase === PHASES.BP));
    const canJumpToEp = isMyTurn && p === PHASES.EP && state.phase !== PHASES.EP && (legal.canEndTurn !== false);
    badge.classList.toggle('active', isActive);
    badge.classList.toggle('phase-ep-ready', canJumpToEp);
    badge.classList.toggle('phase-clickable', canJumpToBp || canJumpToMp2 || canJumpToEp);
  });

  const btnGoBattle = document.getElementById('btn-go-battle');
  const btnGoMp2 = document.getElementById('btn-go-mp2');
  const btnEndTurn = document.getElementById('btn-end-turn');

  const canShowEndTurn = isMyTurn && state.winner === null;
  btnGoBattle?.classList.toggle('hidden', !canShowEndTurn || !(legal.canBattlePhase ?? (state.phase === PHASES.MP1 && state.turnCount > 1)));
  btnGoMp2?.classList.toggle('hidden', !canShowEndTurn || !(legal.canMainPhase2 ?? (state.phase === PHASES.BP)));
  if (btnEndTurn) {
    btnEndTurn.hidden = !canShowEndTurn;
    btnEndTurn.classList.toggle('hidden', !canShowEndTurn);
    btnEndTurn.disabled = !canShowEndTurn || legal.canEndTurn === false;
  }

  // Chain Mode Button
  const chainToggleBtn = document.getElementById('btn-chain-toggle');
  const chainModeTextEl = document.getElementById('chain-mode-text');
  if (chainModeTextEl && chainModeTextEl.textContent !== me.chainMode) {
    chainModeTextEl.textContent = me.chainMode;
  }
  if (chainToggleBtn) {
    chainToggleBtn.className = `btn-chain-toggle chain-${me.chainMode.toLowerCase()}`;
  }

  // 3. Render Playmat Zones (Opponent & Player) with Zone-Dirty Diffing
  let anyFieldZoneDirty = false;
  if (renderFiveZonesGrid('opp-stz-grid', opp.stz, false, legal, 'STZ', renderCtx)) anyFieldZoneDirty = true;
  if (renderFiveZonesGrid('opp-mmz-grid', opp.mmz, false, legal, 'MMZ', renderCtx)) anyFieldZoneDirty = true;
  if (renderSingleSlot('opp-field-spell-slot', opp.fieldSpell, false, legal, lang === 'en' ? 'Field Spell' : 'เวทสนาม', renderCtx)) anyFieldZoneDirty = true;
  const leftEmzEntry = me.emzSlots
    ? (me.emzSlots[0] ? { card: me.emzSlots[0], isSelf: true } : opp.emzSlots?.[1] ? { card: opp.emzSlots[1], isSelf: false } : null)
    : (me.emz ? { card: me.emz, isSelf: true } : null);
  const rightEmzEntry = me.emzSlots
    ? (me.emzSlots[1] ? { card: me.emzSlots[1], isSelf: true } : opp.emzSlots?.[0] ? { card: opp.emzSlots[0], isSelf: false } : null)
    : (opp.emz ? { card: opp.emz, isSelf: false } : null);
  if (renderSingleSlot('opp-emz-slot', rightEmzEntry?.card || null, Boolean(rightEmzEntry?.isSelf), legal, lang === 'en' ? 'Right EMZ' : 'EMZ ขวา', renderCtx)) anyFieldZoneDirty = true;

  if (renderSingleSlot('self-emz-slot', leftEmzEntry?.card || null, Boolean(leftEmzEntry?.isSelf), legal, lang === 'en' ? 'Left EMZ' : 'EMZ ซ้าย', renderCtx)) anyFieldZoneDirty = true;
  if (renderSingleSlot('self-field-spell-slot', me.fieldSpell, true, legal, lang === 'en' ? 'Field Spell' : 'เวทสนาม', renderCtx)) anyFieldZoneDirty = true;
  if (renderFiveZonesGrid('self-mmz-grid', me.mmz, true, legal, 'MMZ', renderCtx)) anyFieldZoneDirty = true;
  if (renderFiveZonesGrid('self-stz-grid', me.stz, true, legal, 'STZ', renderCtx)) anyFieldZoneDirty = true;

  // 3b. Render Equip Card Links & Glowing Arrows (skip if unchanged)
  requestAnimationFrame(() => renderEquipArrows(state, anyFieldZoneDirty));

  // 4. Render Player Hand (zone-dirty diffed — skips rebuild if hand cards & actions unchanged!)
  const handContainer = document.getElementById('self-hand-container');
  if (handContainer) {
    const handCount = me.hand.length;
    const handCardSigs = new Array(handCount);
    for (let idx = 0; idx < handCount; idx++) {
      handCardSigs[idx] = computeCardRenderSig(me.hand[idx], true, legal, chainLinkMap, '', true);
    }
    const handSig = `SH:${lang}:${handCount}:${handCardSigs.join('|')}`;
    if (zoneRenderCache.zones.get('self-hand') !== handSig) {
      const prevHandScrollLeft = handContainer.scrollLeft;
      handContainer.innerHTML = '';
      const handFrag = document.createDocumentFragment();
      const handMid = (handCount - 1) / 2;
      const maxFanSpread = Math.min(20, Math.max(0, (handCount - 1) * 3.5));
      const estCardW = 74;
      const maxCollapsedW = 390;
      const maxExpandedW = 760;
      const collapsedOverlap = handCount <= 5
        ? 4
        : Math.max(-52, Math.min(-6, -Math.ceil((handCount * estCardW - maxCollapsedW) / Math.max(1, handCount - 1))));
      const expandedOverlap = handCount <= 8
        ? 6
        : Math.max(-34, Math.min(2, -Math.ceil((handCount * estCardW - maxExpandedW) / Math.max(1, handCount - 1))));
      handContainer.style.setProperty('--hand-overlap-collapsed', `${collapsedOverlap}px`);
      handContainer.style.setProperty('--hand-overlap-expanded', `${expandedOverlap}px`);
      handContainer.dataset.handDense = handCount >= 6 ? '1' : '0';
      me.hand.forEach((card, idx) => {
        const cardActions = legal.handActions?.[card.instanceId] || [];
        const canActivate = cardActions.some(
          a => a.type === 'ACTIVATE_EFFECT' || a.type === 'ACTIVATE_SPELL' || a.type === 'ACTIVATE_TRAP'
        );
        const el = createCardElement(card, {
          isFaceDown: false,
          isPlayable: cardActions.length > 0,
          isActivatable: canActivate,
          extraClass: 'hand-card-item',
          chainLink: chainLinkMap.get(card.instanceId) || 0
        });
        const norm = handCount > 1 ? (idx - handMid) / (handCount - 1) : 0;
        const t = handCount > 1 ? norm * 2 : 0; // -1 .. +1
        const fanAngle = norm * maxFanSpread;
        // Center cards rise slightly; edge cards rest at 0px so bottoms never clip viewport on PC
        const fanY = -Math.round((1 - t * t) * Math.min(10, handCount * 1.8));
        el.style.setProperty('--fan-angle', `${fanAngle.toFixed(2)}deg`);
        el.style.setProperty('--fan-y', `${fanY}px`);
        attachYgoProCardInteraction(el, card, cardActions, {
          attackInfo: null,
          isFaceDown: false
        });
        handFrag.appendChild(el);
      });
      handContainer.appendChild(handFrag);
      if (prevHandScrollLeft > 0) handContainer.scrollLeft = prevHandScrollLeft;
      zoneRenderCache.zones.set('self-hand', handSig);
    }
  }

  // 5. Render Duel Logs (Append-Only) & Combo Guide (Cached) in Sidebar
  renderDuelLogs(state.logs || []);
  renderInDuelComboGuide(me.deckId);

  // 6. Check if Bottom Chain Selection Bar should open for this player (No blur!)
  const chainBar = document.getElementById('chain-prompt-bar');
  if (legal.canChainRespond && legal.chainPrompt) {
    appState.activeChainPrompt = legal.chainPrompt;
    openChainPromptBar(legal.chainPrompt);
  } else {
    appState.activeChainPrompt = null;
    clearChainCardHighlights();
    if (chainBar) {
      chainBar.classList.add('hidden');
      chainBar.classList.remove('is-peeking');
      syncChainPeekButton(chainBar, document.getElementById('btn-chain-peek'));
    }
  }

  // 6b. Opponent Response / Chain Priority Glowing Aura
  const isOppResponding = state.winner === null && Boolean(
    state.pendingChainPrompt && state.pendingChainPrompt.responderIndex === oppIdx
  );
  document.getElementById('playmat-container')?.classList.toggle('opp-response-aura', isOppResponding);
  document.querySelector('.opponent-hud')?.classList.toggle('opp-response-aura', isOppResponding);

  // 7. Check Win Condition Banner
  const resDlg = document.getElementById('dialog-duel-result');
  const isEnded = state.winner !== null;
  document.querySelectorAll('[data-action="surrender"]').forEach((btn) => {
    btn.disabled = isEnded;
  });

  ensureLingeringHud()?.update(state.winner !== null ? [] : (state.lingeringEffects || []), myIdx);

  if (state.winner !== null) {
    closeEffectChoiceModal();
    appState.lingeringHud?.hide?.();
    const surrenderDlg = document.getElementById('dialog-surrender-confirm');
    if (surrenderDlg?.open) surrenderDlg.close();
    const isWin = state.winner === myIdx;
    const badgeEl = document.getElementById('result-badge-icon');
    if (badgeEl) badgeEl.innerHTML = iconSvg(isWin ? 'trophy' : 'defeat', 'result-badge-svg');
    document.getElementById('duel-result-title').textContent = t(lang, isWin ? 'victoryTitle' : 'defeatTitle');
    const reasonText = state.winReason === 'surrender'
      ? t(lang, isWin ? 'surrenderOppReason' : 'surrenderSelfReason')
      : (state.winReasonTh || state.winReason || '');
    document.getElementById('duel-result-reason').textContent = reasonText;
    if (!resDlg.open) resDlg.showModal();
  } else if (resDlg?.open) {
    resDlg.close();
  }

  // 8. Auto-focus Card Inspector on latest activated or played card (without overriding manual clicks on re-render)
  autoFocusLatestPlayedOrActivatedCard(state, appState.lastRenderedState, myIdx);

  // 9. Play smooth Master Duel card & battle diff animations
  if (prevSnapshot) {
    try {
      playBoardDiffAnimations(prevSnapshot, state, myIdx);
    } catch (animErr) {
      console.warn('[Animation] Deferred VFX error:', animErr);
    }
  }
  if (isDuelVisible) {
    enqueueTurnChangeBanners(appState.lastRenderedState, state, myIdx, { isAiStep });
  }
  appState.lastRenderedState = createLightweightStateSnapshot(state);
  appState.lastRenderedPlayerIndex = myIdx;
}

function renderEquipArrows(state, force = false) {
  const playmat = document.getElementById('playmat-container');
  if (!playmat || !state?.players) return;

  const pairs = [];
  for (const p of state.players) {
    const fieldCards = [
      ...(p.stz || []),
      ...(p.mmz || []),
      ...(p.emzSlots || []),
      p.emz,
      p.fieldSpell
    ];
    const seen = new Set();
    for (const card of fieldCards) {
      if (!card?.equipTargetInstanceId || seen.has(card.instanceId)) continue;
      seen.add(card.instanceId);
      pairs.push({ fromId: card.instanceId, toId: card.equipTargetInstanceId });
    }
  }

  const equipSig = pairs.map((pr) => `${pr.fromId}>${pr.toId}`).join('|');
  if (!force && equipSig === zoneRenderCache.equipSig) {
    return;
  }
  zoneRenderCache.equipSig = equipSig;

  playmat.querySelectorAll('.is-equip-card, .is-equipped-target').forEach((el) => {
    el.classList.remove('is-equip-card', 'is-equipped-target');
  });

  let svg = document.getElementById('equip-arrows-svg');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'equip-arrows-svg';
    svg.classList.add('equip-arrows-svg');
    svg.setAttribute('aria-hidden', 'true');
    playmat.appendChild(svg);
  }
  svg.innerHTML = '';

  if (pairs.length === 0) return;

  const svgRect = svg.getBoundingClientRect();
  if (svgRect.width <= 0 || svgRect.height <= 0) return;

  svg.setAttribute('viewBox', `0 0 ${svgRect.width} ${svgRect.height}`);
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <marker id="equip-arrowhead" markerWidth="10" markerHeight="10" refX="7" refY="3.5" orient="auto">
      <polygon points="0 0, 8 3.5, 0 7" fill="#38bdf8" />
    </marker>
  `;
  svg.appendChild(defs);

  for (const { fromId, toId } of pairs) {
    const fromEl = playmat.querySelector(`.duel-card[data-instance-id="${CSS.escape(fromId)}"]`);
    const toEl = playmat.querySelector(`.duel-card[data-instance-id="${CSS.escape(toId)}"]`);
    if (!fromEl || !toEl) continue;

    fromEl.classList.add('is-equip-card');
    toEl.classList.add('is-equipped-target');

    // Measure parent .zone-slot rather than .duel-card so mid-flight animations
    // (e.g. equipping from Extra Deck / GY / Hand) or DEF rotation never offset the arrow.
    const fromAnchor = fromEl.closest('.zone-slot') || fromEl;
    const toAnchor = toEl.closest('.zone-slot') || toEl;
    const r1 = fromAnchor.getBoundingClientRect();
    const r2 = toAnchor.getBoundingClientRect();
    const x1 = r1.left + r1.width / 2 - svgRect.left;
    const y1 = r1.top + r1.height / 2 - svgRect.top;
    const x2 = r2.left + r2.width / 2 - svgRect.left;
    const y2 = r2.top + r2.height / 2 - svgRect.top;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2 - Math.min(48, Math.hypot(x2 - x1, y2 - y1) * 0.25);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`);
    path.setAttribute('class', 'equip-arrow-path');
    path.setAttribute('marker-end', 'url(#equip-arrowhead)');
    svg.appendChild(path);
  }
}

function renderFiveZonesGrid(gridId, slotsArray, isSelf, legal, zoneType, renderCtx) {
  const grid = document.getElementById(gridId);
  if (!grid) return false;

  const { chainLinkMap = new Map(), oppAttackTargetsSig = '', isZonePickingActive = 0 } = renderCtx || {};
  const slotSigs = new Array(5);
  for (let i = 0; i < 5; i++) {
    slotSigs[i] = computeCardRenderSig(slotsArray[i], isSelf, legal, chainLinkMap, oppAttackTargetsSig, false);
  }
  const hasTransientTarget = grid.querySelector('.zone-pick-target, .card-pick-target') ? 1 : 0;
  const gridSig = `G:${gridId}:${appState.lang}:${isSelf ? 1 : 0}:${isZonePickingActive}:${hasTransientTarget}:${slotSigs.join('|')}`;
  if (zoneRenderCache.zones.get(gridId) === gridSig && grid.children.length === 5) {
    return false;
  }

  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 5; i++) {
    const card = slotsArray[i];
    const slotEl = document.createElement('div');
    const isOuterSTZ = zoneType === 'STZ' && (i === 0 || i === 4);
    slotEl.className = `zone-slot ${isOuterSTZ ? 'stz-outer-slot' : ''}`;
    slotEl.setAttribute('data-zone-index', String(i));
    const labelStr = appState.lang === 'en'
      ? (zoneType === 'MMZ' ? `Monster ${i + 1}` : (isOuterSTZ ? 'S/T • Pendulum' : `Spell/Trap ${i + 1}`))
      : (zoneType === 'MMZ' ? `มอนสเตอร์ ${i + 1}` : (isOuterSTZ ? 'เวท/เพนดูลัม' : `เวท/กับดัก ${i + 1}`));
    slotEl.setAttribute('data-slot-label', labelStr);

    if (card) {
      const isFaceDown = !isSelf && (card.position === POSITIONS.SET || card.position === POSITIONS.SET_DEF);
      const fieldActs = isSelf ? (legal.fieldActions?.[card.instanceId] || []) : [];
      const atkInfo = isSelf ? legal.attackTargets?.[card.instanceId] : null;
      const isPlayable = fieldActs.length > 0;
      const isAtkReady = Boolean(atkInfo);

      const cardEl = createCardElement(card, {
        isFaceDown,
        isPlayable,
        isAtkReady,
        chainLink: chainLinkMap.get(card.instanceId) || 0
      });

      if (isSelf) {
        const actionItems = buildFieldCardActions(card, fieldActs, atkInfo);
        attachYgoProCardInteraction(cardEl, card, actionItems, {
          attackInfo: atkInfo,
          dragActions: fieldActs,
          isFaceDown: false
        });
      } else {
        cardEl.addEventListener('click', (e) => {
          if (shouldSuppressCardClick()) return;
          e.stopPropagation();
          if (!isFaceDown) {
            inspectCardAndFocus(card, { openMobilePreview: true });
          }
        });
      }

      slotEl.appendChild(cardEl);
    }

    frag.appendChild(slotEl);
  }
  grid.appendChild(frag);
  zoneRenderCache.zones.set(gridId, gridSig);
  return true;
}

function clearPinnedCmdCards() {
  document.querySelectorAll('.duel-card.cmds-pinned').forEach(el => el.classList.remove('cmds-pinned'));
}

function getShortYgoProCmdLabel(act, lang, allActions = []) {
  const isEn = lang === 'en';
  if (act.type === 'NORMAL_SUMMON') return isEn ? 'Summon' : 'อัญเชิญ';
  if (act.type === 'NORMAL_SET' || act.type === 'SET_MONSTER') return isEn ? 'Set' : 'หมอบ';
  if (act.type === 'SPECIAL_SUMMON' || act.type === 'INHERENT_SPECIAL_SUMMON') return isEn ? 'Sp.Summon' : 'อัญ.พิเศษ';
  if (act.type === 'SET_SPELL_TRAP') return isEn ? 'Set' : 'หมอบ';
  if (act.type === 'CHANGE_POSITION') return isEn ? 'Position' : 'สลับสภาพ';
  if (act.type === 'ATTACK') return isEn ? 'Attack' : 'โจมตี';
  if (act.type === 'DECLARE_ATTACK') return isEn ? 'Attack' : 'โจมตี';
  if (act.isPendulumScale) return isEn ? 'Scale' : 'เพนดูลัม';
  if (act.type === 'ACTIVATE_EFFECT' || act.type === 'ACTIVATE_SPELL' || act.type === 'ACTIVATE_TRAP') {
    const actCount = allActions.filter(
      a => a.type === 'ACTIVATE_EFFECT' || a.type === 'ACTIVATE_SPELL' || a.type === 'ACTIVATE_TRAP'
    ).length;
    if (actCount > 1) {
      return stripLeadingEmoji((isEn ? (act.label || act.labelTh) : (act.labelTh || act.label)) || (isEn ? 'Activate' : 'เปิดใช้'));
    }
    return isEn ? 'Activate' : 'เปิดใช้';
  }
  return stripLeadingEmoji((isEn ? (act.label || act.labelTh) : (act.labelTh || act.label)) || 'Act');
}

function attachYgoProCardInteraction(el, card, actionItems = [], opts = {}) {
  const { attackInfo = null, dragActions = actionItems, isFaceDown = false } = opts;
  const lang = appState.lang;

  enableCardDragToPlay(el, {
    card,
    actions: dragActions,
    attackInfo,
    lang,
    onInspect: inspectCard,
    onHidePopup: hideActionPopup,
    onShowChoicePopup: showActionPopupForCard,
    onExecuteAction: dispatchDuelAction
  });

  if (actionItems.length > 0) {
    const cmdsEl = document.createElement('div');
    cmdsEl.className = 'ygopro-card-cmds';
    for (const act of actionItems) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ygopro-cmd-btn';
      btn.textContent = getShortYgoProCmdLabel(act, lang, actionItems);
      btn.title = stripLeadingEmoji(lang === 'en' ? (act.label || act.labelTh || '') : (act.labelTh || act.label || ''));
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearPinnedCmdCards();
        clearSelectedHandCard();
        document.querySelector('.player-bottom-dock')?.classList.remove('hand-expanded');
        executeCardAction(card, act);
      });
      cmdsEl.appendChild(btn);
    }
    el.appendChild(cmdsEl);
  }

  el.addEventListener('click', (e) => {
    if (shouldSuppressCardClick()) return;
    e.stopPropagation();
    if (!isFaceDown) inspectCard(card);
    const isMobileOrTouch = isCompactDuelViewport();
    if (actionItems.length > 0) {
      if (isMobileOrTouch) {
        clearPinnedCmdCards();
        clearSelectedHandCard();
        el.classList.add('is-selected');
        showActionPopupForCard(card, actionItems, el, { allowSingleActionMenu: true });
      } else {
        const wasPinned = el.classList.contains('cmds-pinned');
        clearPinnedCmdCards();
        if (!wasPinned) {
          el.classList.add('cmds-pinned');
        }
      }
    } else {
      clearPinnedCmdCards();
      clearSelectedHandCard();
      if (isMobileOrTouch && !isFaceDown) {
        showMobileCardDetail(card);
      }
    }
  });
}

function buildFieldCardActions(card, fieldActs, atkInfo) {
  const items = [...(fieldActs || [])];
  const isEn = appState.lang === 'en';
  if (atkInfo && !Array.isArray(atkInfo)) {
    if (atkInfo.canDirectAttack) {
      items.push({
        type: 'DECLARE_ATTACK',
        attackerInstanceId: card.instanceId,
        directAttack: true,
        label: 'Direct Attack!',
        labelTh: 'โจมตีผู้เล่นโดยตรง (Direct Attack)!'
      });
    }
    const oppIdx = 1 - appState.myPlayerIndex;
    const oppMons = appState.currentState.players[oppIdx].mmz
      .concat(appState.currentState.players[oppIdx].emz)
      .filter(Boolean);
    for (const targetCard of oppMons) {
      const targetTitleEn = targetCard.position === POSITIONS.SET_DEF
        ? 'Face-down Monster'
        : `${targetCard.name || targetCard.nameTh} (${targetCard.position === POSITIONS.ATK ? `${targetCard.currentAtk} ATK` : `${targetCard.currentDef} DEF`})`;
      const targetTitleTh = targetCard.position === POSITIONS.SET_DEF
        ? 'มอนสเตอร์ที่หมอบอยู่'
        : `${targetCard.nameTh || targetCard.name} (${targetCard.position === POSITIONS.ATK ? `${targetCard.currentAtk} ATK` : `${targetCard.currentDef} DEF`})`;
      items.push({
        type: 'DECLARE_ATTACK',
        attackerInstanceId: card.instanceId,
        targetInstanceId: targetCard.instanceId,
        label: `Attack: ${targetTitleEn}`,
        labelTh: isEn ? `Attack: ${targetTitleEn}` : `โจมตี: ${targetTitleTh}`
      });
    }
  }
  return items;
}

function renderSingleSlot(slotId, card, isSelf, legal, label, renderCtx) {
  const slotEl = document.getElementById(slotId);
  if (!slotEl) return false;

  const { chainLinkMap = new Map(), oppAttackTargetsSig = '', isZonePickingActive = 0 } = renderCtx || {};
  const cardSig = computeCardRenderSig(card, isSelf, legal, chainLinkMap, oppAttackTargetsSig, false);
  const hasTransientTarget = slotEl.classList.contains('zone-pick-target') || slotEl.querySelector('.zone-pick-target, .card-pick-target') ? 1 : 0;
  const slotSig = `S:${slotId}:${appState.lang}:${isSelf ? 1 : 0}:${label}:${isZonePickingActive}:${hasTransientTarget}:${cardSig}`;
  if (zoneRenderCache.zones.get(slotId) === slotSig) {
    return false;
  }

  slotEl.innerHTML = '';
  slotEl.setAttribute('data-slot-label', label);

  if (!card) {
    zoneRenderCache.zones.set(slotId, slotSig);
    return true;
  }

  const isFaceDown = !isSelf && (card.position === POSITIONS.SET || card.position === POSITIONS.SET_DEF);
  const fieldActs = isSelf ? (legal.fieldActions?.[card.instanceId] || []) : [];
  const atkInfo = isSelf ? legal.attackTargets?.[card.instanceId] : null;

  const cardEl = createCardElement(card, {
    isFaceDown,
    isPlayable: fieldActs.length > 0,
    isAtkReady: Boolean(atkInfo),
    chainLink: chainLinkMap.get(card.instanceId) || 0
  });

  if (isSelf) {
    const actionItems = buildFieldCardActions(card, fieldActs, atkInfo);
    attachYgoProCardInteraction(cardEl, card, actionItems, {
      attackInfo: atkInfo,
      dragActions: fieldActs,
      isFaceDown: false
    });
  } else {
    cardEl.addEventListener('click', (e) => {
      if (shouldSuppressCardClick()) return;
      e.stopPropagation();
      if (!isFaceDown) {
        inspectCardAndFocus(card, { openMobilePreview: true });
      }
    });
  }

  slotEl.appendChild(cardEl);
  zoneRenderCache.zones.set(slotId, slotSig);
  return true;
}

function createCardElement(card, options = {}) {
  const { isFaceDown = false, isPlayable = false, isActivatable = false, isAtkReady = false, extraClass = '', chainLink = null } = options;
  const el = document.createElement('div');
  const frameClass = getCardFrameClass(card);
  const isDef = card.zone === 'MMZ' && (card.position === POSITIONS.DEF || card.position === POSITIONS.SET_DEF);

  el.setAttribute('data-instance-id', card.instanceId);
  el.setAttribute('data-card-zone', card.zone || '');
  el.setAttribute('data-card-index', String(card.zoneIndex ?? ''));
  el.setAttribute('data-controller', String(card.controller ?? ''));
  el.setAttribute('data-card-position', card.position || '');
  if (!isFaceDown && (card.passcode || card.id)) {
    el.setAttribute('data-passcode', String(card.passcode || card.id));
  }

  const isOnFieldZone = card.zone === 'MMZ' || card.zone === 'STZ' || card.zone === 'EMZ' || card.zone === 'FIELD';
  const isSetOwn = isOnFieldZone && (card.position === POSITIONS.SET || card.position === POSITIONS.SET_DEF);
  const resolvedChainLink = chainLink !== null
    ? chainLink
    : ((appState.currentState?.chainStack || []).find(item => item.card && item.card.instanceId === card.instanceId)?.chainLink || 0);
  const chainBadgeHtml = resolvedChainLink
    ? `<div class="chain-link-badge" title="Chain Link ${resolvedChainLink}" aria-label="Chain Link ${resolvedChainLink}">${iconSvg('chain', 'chain-link-icon')}<span class="chain-link-num">${resolvedChainLink}</span></div>`
    : '';

  el.className = [
    'duel-card',
    frameClass,
    extraClass,
    isDef ? 'def-position' : '',
    (isFaceDown || isSetOwn) && isFaceDown ? 'face-down' : '',
    !isFaceDown && isSetOwn ? 'set-own' : '',
    resolvedChainLink ? 'in-chain' : '',
    isPlayable ? 'playable-glow' : '',
    isActivatable ? 'activatable-aura' : '',
    isAtkReady ? 'attack-ready-glow' : ''
  ].filter(Boolean).join(' ');

  if (isFaceDown) {
    el.style.backgroundImage = getCardBackSvgUrl(false);
    el.innerHTML = `<span class="face-down-badge" aria-label="Face-down card"></span>${chainBadgeHtml}`;
    return el;
  }
  const attrMeta = getAttributeMeta(card);
  const cardName = getLocalizedCardName(card, appState.lang) || card.name || card.nameTh || card.id || 'Card';
  const cardKind = card.kind || 'CARD';
  const rankOrLv = cardKind === 'MONSTER'
    ? (card.frame === 'XYZ' ? `R${card.rank ?? '?'}` : card.frame === 'LINK' ? `L${card.linkRating ?? '?'}` : `★${card.currentLevel ?? card.level ?? '?'}`)
    : (cardKind === 'SPELL' ? '魔' : '罠');
  const statsHtml = cardKind === 'MONSTER'
    ? `<span class="atk-stat">${card.currentAtk ?? card.atk ?? 0}</span><span class="stat-sep">/</span><span class="def-stat">${card.frame === 'LINK' ? `L-${card.linkRating ?? 1}` : (card.currentDef ?? card.def ?? 0)}</span>`
    : `<span class="spell-trap-tag">${cardKind}</span>`;

  el.innerHTML = `
    <div class="card-mini-header-row">
      <span class="card-mini-title">${escapeHtml(cardName)}</span>
      <span class="card-attr-orb" style="background:${attrMeta.bg};color:${attrMeta.color}" title="${escapeHtml(appState.lang === 'en' ? attrMeta.nameEn : attrMeta.nameTh)}">${escapeHtml(attrMeta.badge)}</span>
    </div>
    <div class="card-mini-art-frame">
      <img class="card-mini-art" src="${getCardArtUrl(card)}" alt="${escapeHtml(cardName)}" draggable="false" loading="eager" decoding="async" />
      ${isSetOwn ? `<span class="set-card-back-indicator" title="${appState.lang === 'en' ? 'Set (Face-down)' : 'คว่ำ (Set)'}" aria-label="Face-down set card"></span>` : ''}
      ${cardKind === 'MONSTER' ? `<span class="card-lv-tag ${card.frame === 'XYZ' ? 'lv-xyz' : ''}">${escapeHtml(rankOrLv)}</span>` : ''}
    </div>
    <div class="card-mini-footer">
      <span class="card-stats-pair">${statsHtml}</span>
    </div>
    ${card.effectsNegated ? `<div class="negated-badge">${iconSvg('negate')}<span>${appState.lang === 'en' ? 'Negated' : 'ใบ้เอฟเฟค'}</span></div>` : ''}
    ${Array.isArray(card.overlayUnits) && card.overlayUnits.length > 0 ? `<div class="xyz-overlay-badge">OVL ${card.overlayUnits.length}</div>` : ''}
    ${chainBadgeHtml}
  `;

  const img = el.querySelector('img');
  img.addEventListener('error', () => {
    img.src = generateProceduralCardSvg(card);
  }, { once: true });

  el.addEventListener('mouseenter', () => inspectCard(card));
  return el;
}

// ==================== CARD INSPECTOR & ACTION POPUP ====================
const googleTranslateClientCache = new Map();

async function translateTextWithGoogle(text) {
  if (!text) return '';
  if (googleTranslateClientCache.has(text)) {
    return googleTranslateClientCache.get(text);
  }
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target: 'th' })
    });
    const data = await res.json();
    if (data?.ok && data.translatedText) {
      googleTranslateClientCache.set(text, data.translatedText);
      return data.translatedText;
    }
  } catch {
    // Fallback to existing descriptionTh if offline
  }
  return '';
}

function closeOcgPromptDialogIfOpen() {
  closeEffectChoiceModal();
  const dlg = document.getElementById('dialog-zone-browser');
  if (dlg?.open && dlg.dataset.ocgPrompt === '1') {
    dlg.dataset.ocgPrompt = '';
    dlg.close();
  }
}

function evaluateOcgSelectSum(prompt, selectedIndices) {
  const cards = prompt.cards || [];
  const mustCards = prompt.mustCards || [];
  const unpackVals = (rawVal) => {
    const n = Number(rawVal || 0);
    const v1 = n & 0xffff;
    const v2 = (n >>> 16) & 0xffff;
    return v2 > 0 && v2 !== v1 ? [v1, v2] : [v1];
  };

  let mustSums = new Set([0]);
  for (const mc of mustCards) {
    const vals = unpackVals(mc.value);
    const next = new Set();
    for (const s of mustSums) {
      for (const v of vals) next.add(s + v);
    }
    mustSums = next;
  }

  const byIdx = new Map(cards.map((c, i) => [c.index ?? i, c]));
  const getSums = (indices) => {
    let sums = mustSums;
    for (const idx of indices) {
      const c = byIdx.get(idx);
      if (!c) continue;
      const vals = unpackVals(c.value);
      const next = new Set();
      for (const s of sums) {
        for (const v of vals) next.add(s + v);
      }
      sums = next;
    }
    return sums;
  };

  const chosenArr = Array.from(selectedIndices || []);
  const target = Number(prompt.amount || 0);
  const selectMax = Number(prompt.selectMax || 0);
  const minPicks = selectMax
    ? (mustCards.length > 0 ? 0 : 1)
    : Math.max(mustCards.length > 0 ? 0 : 1, Number(prompt.min ?? 1));
  const maxPicks = (prompt.max && prompt.max > 0) ? Math.min(cards.length, Number(prompt.max)) : cards.length;
  const sums = getSums(chosenArr);
  const sumText = Array.from(sums).sort((a, b) => a - b).join('/');

  if (chosenArr.length < minPicks || chosenArr.length > maxPicks || (mustCards.length + chosenArr.length) === 0) {
    return { valid: false, minPicks, maxPicks, sumText, sums };
  }
  // ocgcore SELECT_SUM: selectMax === 0 => exact sum === target; selectMax === 1 => sum >= target without superfluous cards
  if (selectMax === 0) {
    return { valid: sums.has(target), minPicks, maxPicks, sumText, sums };
  }

  let meetsTarget = false;
  for (const s of sums) {
    if (s >= target) { meetsTarget = true; break; }
  }
  if (!meetsTarget) {
    return { valid: false, minPicks, maxPicks, sumText, sums };
  }

  if (chosenArr.length > minPicks && chosenArr.length > 1) {
    for (let r = 0; r < chosenArr.length; r++) {
      const reduced = chosenArr.filter((_, k) => k !== r);
      for (const s of getSums(reduced)) {
        if (s >= target) {
          return { valid: false, minPicks, maxPicks, sumText, sums };
        }
      }
    }
  }
  return { valid: true, minPicks, maxPicks, sumText, sums };
}

function sendOcgPromptResponse(response) {
  closeOcgPromptDialogIfOpen();
  clearZonePickMode(true);
  closeYgoproCardStrip();
  appState.activeOcgPrompt = null;
  dispatchDuelAction({ type: 'OCG_RESPONSE', response });
}

function renderOcgPromptModal(prompt) {
  closeOcgPromptDialogIfOpen();
  appState.activeOcgPrompt = prompt || null;

  if (prompt.promptType === 'SELECT_PLACE' || prompt.promptType === 'SELECT_DISFIELD') {
    if (enterOcgFieldPlaceMode(prompt)) return;
  } else if (prompt.promptType === 'SELECT_EFFECTYN' || prompt.promptType === 'SELECT_YESNO') {
    if (enterOcgYesNoBanner(prompt)) return;
  } else if (prompt.promptType === 'SELECT_OPTION') {
    if (enterOcgOptionBanner(prompt)) return;
  } else if (prompt.promptType === 'SELECT_POSITION') {
    if (enterOcgPositionBanner(prompt)) return;
  } else if (
    prompt.promptType === 'ANNOUNCE_NUMBER' ||
    prompt.promptType === 'ANNOUNCE_RACE' ||
    prompt.promptType === 'ANNOUNCE_ATTRIB' ||
    prompt.promptType === 'ROCK_PAPER_SCISSORS'
  ) {
    if (enterOcgAnnounceBanner(prompt)) return;
  } else if (
    prompt.promptType === 'SELECT_CARD' ||
    prompt.promptType === 'SELECT_TRIBUTE' ||
    prompt.promptType === 'SELECT_SUM' ||
    prompt.promptType === 'SELECT_UNSELECT_CARD'
  ) {
    if (enterOcgCardPickMode(prompt)) return;
    if (enterOcgCardStripMode(prompt)) return;
  } else if (
    prompt.promptType === 'SORT_CARD' ||
    prompt.promptType === 'SORT_CHAIN' ||
    prompt.promptType === 'SELECT_COUNTER' ||
    prompt.promptType === 'ANNOUNCE_CARD'
  ) {
    if (enterOcgCardStripMode(prompt)) return;
  } else {
    clearZonePickMode(true);
  }

  const dlg = document.getElementById('dialog-zone-browser');
  const titleEl = document.getElementById('zone-browser-title');
  const subtitleEl = document.getElementById('zone-browser-subtitle');
  const bodyEl = document.getElementById('zone-browser-grid');
  if (!dlg || !titleEl || !bodyEl) return;

  dlg.dataset.ocgPrompt = '1';
  if (subtitleEl) subtitleEl.textContent = 'YGOPro Core Prompt';
  bodyEl.innerHTML = '';

  const pIdx = prompt.player ?? 0;

  if (prompt.promptType === 'SELECT_EFFECTYN' || prompt.promptType === 'SELECT_YESNO') {
    const typeVal = prompt.promptType === 'SELECT_EFFECTYN' ? 2 : 3;
    titleEl.textContent = prompt.cardName ? `Activate ${prompt.cardName}?` : 'Confirm Effect';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'grid-column:1/-1;display:flex;flex-direction:column;gap:12px;width:100%;';
    wrap.innerHTML = `<p class="browser-card-desc">${escapeHtml(prompt.description || 'Do you want to activate this effect?')}</p>`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;';
    const yesBtn = document.createElement('button');
    yesBtn.type = 'button';
    yesBtn.className = 'btn btn-primary';
    yesBtn.textContent = 'Yes (Activate)';
    yesBtn.onclick = () => sendOcgPromptResponse({ type: typeVal, yes: true });
    const noBtn = document.createElement('button');
    noBtn.type = 'button';
    noBtn.className = 'btn btn-secondary';
    noBtn.textContent = 'No';
    noBtn.onclick = () => sendOcgPromptResponse({ type: typeVal, yes: false });
    row.append(yesBtn, noBtn);
    wrap.appendChild(row);
    bodyEl.appendChild(wrap);
  } else if (prompt.promptType === 'SELECT_OPTION') {
    titleEl.textContent = 'Select Effect Option';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'grid-column:1/-1;display:flex;flex-direction:column;gap:8px;width:100%;';
    (prompt.options || []).forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = (appState.lang === 'th' ? (opt.labelTh || opt.label) : (opt.labelEn || opt.label)) || `Option ${opt.index + 1}`;
      btn.onclick = () => sendOcgPromptResponse({ type: 4, index: opt.index });
      wrap.appendChild(btn);
    });
    bodyEl.appendChild(wrap);
  } else if (prompt.promptType === 'SELECT_POSITION') {
    titleEl.textContent = `Choose Position (${prompt.cardName || 'Monster'})`;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'grid-column:1/-1;display:flex;gap:10px;flex-wrap:wrap;width:100%;';
    const posOpts = [
      { mask: 1, label: '⚔️ Face-Up Attack' },
      { mask: 4, label: '🛡️ Face-Up Defense' },
      { mask: 8, label: '🂠 Face-Down Defense' },
      { mask: 2, label: '🂠 Face-Down Attack' }
    ];
    posOpts.forEach((p) => {
      if ((prompt.positionsMask & p.mask) !== 0) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-primary';
        btn.textContent = p.label;
        btn.onclick = () => sendOcgPromptResponse({ type: 11, position: p.mask });
        wrap.appendChild(btn);
      }
    });
    bodyEl.appendChild(wrap);
  } else if (prompt.promptType === 'SELECT_PLACE' || prompt.promptType === 'SELECT_DISFIELD') {
    const respType = prompt.promptType === 'SELECT_DISFIELD' ? 9 : 10;
    const reqCount = Math.max(1, Number(prompt.count || 1));
    const oppIdx = 1 - pIdx;
    const mask = prompt.fieldMask || 0;
    const zones = [];
    for (let seq = 0; seq <= 6; seq++) {
      if (((mask >>> seq) & 1) === 0) {
        const label = seq < 5 ? `Your Monster ${seq + 1}` : `Your EMZ ${seq - 4}`;
        zones.push({ player: pIdx, location: 4, sequence: seq, label, owner: 'self' });
      }
    }
    for (let seq = 0; seq <= 5; seq++) {
      if (((mask >>> (8 + seq)) & 1) === 0) {
        const label = seq < 5 ? `Your Spell/Trap ${seq + 1}` : 'Your Field Zone';
        zones.push({ player: pIdx, location: 8, sequence: seq, label, owner: 'self' });
      }
    }
    for (let seq = 0; seq <= 6; seq++) {
      if (((mask >>> (16 + seq)) & 1) === 0) {
        const label = seq < 5 ? `Opp Monster ${seq + 1}` : `Opp EMZ ${seq - 4}`;
        zones.push({ player: oppIdx, location: 4, sequence: seq, label, owner: 'opp' });
      }
    }
    for (let seq = 0; seq <= 5; seq++) {
      if (((mask >>> (24 + seq)) & 1) === 0) {
        const label = seq < 5 ? `Opp Spell/Trap ${seq + 1}` : 'Opp Field Zone';
        zones.push({ player: oppIdx, location: 8, sequence: seq, label, owner: 'opp' });
      }
    }
    const onlyOpp = zones.length > 0 && zones.every(z => z.owner === 'opp');
    const actionWord = prompt.promptType === 'SELECT_DISFIELD' ? 'Choose Zone to Lock/Target' : (onlyOpp ? 'Choose Opponent Field Zone' : 'Choose Field Zone');
    titleEl.textContent = reqCount > 1 ? `${actionWord} (${reqCount})` : actionWord;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'grid-column:1/-1;display:flex;flex-direction:column;gap:12px;width:100%;';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;width:100%;';
    const picked = [];
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.textContent = `Confirm (0/${reqCount})`;
    confirmBtn.disabled = true;

    zones.forEach((z) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = z.owner === 'opp' ? 'btn btn-secondary' : 'btn btn-primary';
      btn.textContent = z.label;
      btn.onclick = () => {
        if (reqCount === 1) {
          sendOcgPromptResponse({
            type: respType,
            places: [{ player: z.player, location: z.location, sequence: z.sequence }]
          });
          return;
        }
        const existing = picked.findIndex(p => p.player === z.player && p.location === z.location && p.sequence === z.sequence);
        if (existing >= 0) {
          picked.splice(existing, 1);
          btn.style.outline = '';
        } else if (picked.length < reqCount) {
          picked.push({ player: z.player, location: z.location, sequence: z.sequence });
          btn.style.outline = '2px solid #facc15';
        }
        confirmBtn.textContent = `Confirm (${picked.length}/${reqCount})`;
        confirmBtn.disabled = picked.length < reqCount;
      };
      grid.appendChild(btn);
    });
    wrap.appendChild(grid);
    if (reqCount > 1) {
      confirmBtn.onclick = () => sendOcgPromptResponse({ type: respType, places: picked });
      wrap.appendChild(confirmBtn);
    }
    bodyEl.appendChild(wrap);
  } else if (prompt.promptType === 'SELECT_CARD' || prompt.promptType === 'SELECT_TRIBUTE' || prompt.promptType === 'SELECT_SUM') {
    const isSum = prompt.promptType === 'SELECT_SUM';
    const respType = prompt.promptType === 'SELECT_TRIBUTE' ? 12 : isSum ? 14 : 5;
    const min = isSum ? Math.max((prompt.mustCards?.length ? 0 : 1), Number(prompt.min ?? 1)) : (prompt.min || 1);
    const max = isSum ? ((prompt.max && prompt.max > 0) ? prompt.max : (prompt.cards?.length || 1)) : (prompt.max || min);
    titleEl.textContent = isSum
      ? `Select Sum (${prompt.amount || 0})`
      : `${prompt.promptType.replace('SELECT_', 'Select ')} (${min}${max !== min ? `-${max}` : ''})`;
    const selected = new Set();
    const wrap = document.createElement('div');
    wrap.style.cssText = 'grid-column:1/-1;display:flex;flex-direction:column;gap:12px;width:100%;';
    const grid = document.createElement('div');
    grid.className = 'ocg-card-choice-grid';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary';
    const syncModalConfirm = () => {
      if (isSum) {
        const evalSum = evaluateOcgSelectSum(prompt, selected);
        confirmBtn.textContent = `Confirm (Sum: ${evalSum.sumText || 0} / ${prompt.amount || 0})`;
        confirmBtn.disabled = !evalSum.valid;
      } else {
        confirmBtn.textContent = `Confirm (${selected.size}/${min})`;
        confirmBtn.disabled = selected.size < min;
      }
    };
    syncModalConfirm();

    const buildCardThumb = (c, prefix = '') => {
      const ownerTag = typeof c.controller === 'number' ? (c.controller === pIdx ? 'Your ' : 'Opp ') : '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ocg-card-choice-btn';
      if (c.isHiddenFaceDown) {
        btn.innerHTML = `
          <div class="ocg-card-choice-img" style="${getCardBackSvgUrl(false)}background-size:cover;border-radius:6px;"></div>
          <span class="ocg-card-choice-zone">${prefix}${ownerTag}${c.zone}</span>
          <span class="ocg-card-choice-name">Face-down Card</span>
        `;
        return btn;
      }
      const cardRef = getCardById(String(c.passcode || c.code)) || { passcode: c.passcode || String(c.code || ''), name: c.name };
      btn.innerHTML = `
        <img class="ocg-card-choice-img" src="${getCardArtUrl(cardRef)}" alt="${escapeHtml(c.name)}" loading="lazy" decoding="async" />
        <span class="ocg-card-choice-zone">${escapeHtml(prefix + ownerTag + c.zone)}</span>
        <span class="ocg-card-choice-name">${escapeHtml(c.name)}</span>
      `;
      const img = btn.querySelector('img');
      img?.addEventListener('error', () => {
        img.src = generateProceduralCardSvg(cardRef);
      }, { once: true });
      btn.addEventListener('mouseenter', () => {
        if (cardRef?.id) inspectCard(cardRef);
      });
      return btn;
    };

    (prompt.cards || []).forEach((c) => {
      const btn = buildCardThumb(c);
      btn.onclick = () => {
        if (selected.has(c.index)) {
          selected.delete(c.index);
          btn.classList.remove('selected');
        } else if (selected.size < max) {
          selected.add(c.index);
          btn.classList.add('selected');
        }
        syncModalConfirm();
      };
      grid.appendChild(btn);
    });

    confirmBtn.onclick = () => sendOcgPromptResponse({ type: respType, indicies: Array.from(selected) });
    wrap.append(grid, confirmBtn);
    if (prompt.canCancel) {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = () => sendOcgPromptResponse({ type: respType, indicies: null });
      wrap.appendChild(cancelBtn);
    }
    bodyEl.appendChild(wrap);
  } else if (prompt.promptType === 'SELECT_UNSELECT_CARD') {
    titleEl.textContent = 'Select / Unselect Card';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'grid-column:1/-1;display:flex;flex-direction:column;gap:12px;width:100%;';
    const grid = document.createElement('div');
    grid.className = 'ocg-card-choice-grid';

    const makeChoice = (c, idx, prefix) => {
      const cardRef = getCardById(String(c.passcode || c.code)) || { passcode: c.passcode || String(c.code || ''), name: c.name };
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ocg-card-choice-btn';
      btn.innerHTML = `
        <img class="ocg-card-choice-img" src="${getCardArtUrl(cardRef)}" alt="${escapeHtml(c.name)}" loading="lazy" decoding="async" />
        <span class="ocg-card-choice-zone">${escapeHtml(prefix + c.zone)}</span>
        <span class="ocg-card-choice-name">${escapeHtml(c.name)}</span>
      `;
      const img = btn.querySelector('img');
      img?.addEventListener('error', () => {
        img.src = generateProceduralCardSvg(cardRef);
      }, { once: true });
      btn.onclick = () => sendOcgPromptResponse({ type: 7, index: idx });
      return btn;
    };

    (prompt.selectCards || []).forEach((c, idx) => {
      grid.appendChild(makeChoice(c, idx, '+ '));
    });
    (prompt.unselectCards || []).forEach((c, idx) => {
      const btn = makeChoice(c, (prompt.selectCards?.length || 0) + idx, '✓ ');
      btn.classList.add('selected');
      grid.appendChild(btn);
    });
    wrap.appendChild(grid);
    if (prompt.canFinish || prompt.canCancel) {
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'btn btn-secondary';
      doneBtn.textContent = prompt.canFinish ? 'Finish' : 'Cancel';
      doneBtn.onclick = () => sendOcgPromptResponse({ type: 7, index: null });
      wrap.appendChild(doneBtn);
    }
    bodyEl.appendChild(wrap);
  } else if (prompt.promptType === 'ANNOUNCE_NUMBER') {
    titleEl.textContent = 'Declare Number';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;width:100%;';
    (prompt.values || []).forEach((v) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = String(v);
      btn.onclick = () => sendOcgPromptResponse({ type: 19, value: v });
      wrap.appendChild(btn);
    });
    bodyEl.appendChild(wrap);
  } else if (prompt.promptType === 'ANNOUNCE_RACE') {
    titleEl.textContent = `Declare Monster Type (${prompt.count || 1})`;
    const races = [
      [0x1, 'Warrior'], [0x2, 'Spellcaster'], [0x4, 'Fairy'], [0x8, 'Fiend'],
      [0x10, 'Zombie'], [0x20, 'Machine'], [0x40, 'Aqua'], [0x80, 'Pyro'],
      [0x100, 'Rock'], [0x200, 'Winged Beast'], [0x400, 'Plant'], [0x800, 'Insect'],
      [0x1000, 'Thunder'], [0x2000, 'Dragon'], [0x4000, 'Beast'], [0x8000, 'Beast-Warrior'],
      [0x10000, 'Dinosaur'], [0x20000, 'Fish'], [0x40000, 'Sea Serpent'], [0x80000, 'Reptile'],
      [0x100000, 'Psychic'], [0x200000, 'Divine-Beast'], [0x800000, 'Wyrm'],
      [0x1000000, 'Cyberse'], [0x2000000, 'Illusion']
    ];
    const wrap = document.createElement('div');
    wrap.style.cssText = 'grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;width:100%;';
    const avail = Number(prompt.available || 0);
    races.forEach(([bit, label]) => {
      if (avail && (avail & bit) === 0) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = label;
      btn.onclick = () => sendOcgPromptResponse({ type: 16, races: [bit] });
      wrap.appendChild(btn);
    });
    bodyEl.appendChild(wrap);
  } else if (prompt.promptType === 'ANNOUNCE_ATTRIB') {
    titleEl.textContent = `Declare Attribute (${prompt.count || 1})`;
    const attrs = [
      [0x01, 'EARTH'], [0x02, 'WATER'], [0x04, 'FIRE'], [0x08, 'WIND'],
      [0x10, 'LIGHT'], [0x20, 'DARK'], [0x40, 'DIVINE']
    ];
    const wrap = document.createElement('div');
    wrap.style.cssText = 'grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;width:100%;';
    const avail = Number(prompt.available || 0);
    attrs.forEach(([bit, label]) => {
      if (avail && (avail & bit) === 0) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = label;
      btn.onclick = () => sendOcgPromptResponse({ type: 17, attributes: [bit] });
      wrap.appendChild(btn);
    });
    bodyEl.appendChild(wrap);
  } else if (prompt.promptType === 'ANNOUNCE_CARD') {
    titleEl.textContent = 'Declare Card Name';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'grid-column:1/-1;display:flex;flex-direction:column;gap:10px;width:100%;';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'deck-search-input';
    input.placeholder = 'Search card name or passcode...';
    const results = document.createElement('div');
    results.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;max-height:240px;overflow:auto;';
    const renderMatches = () => {
      const q = input.value.trim().toLowerCase();
      results.innerHTML = '';
      if (/^\d{5,9}$/.test(q)) {
        const directBtn = document.createElement('button');
        directBtn.type = 'button';
        directBtn.className = 'btn btn-primary';
        directBtn.textContent = `Declare #${q}`;
        directBtn.onclick = () => sendOcgPromptResponse({ type: 18, card: Number(q) });
        results.appendChild(directBtn);
      }
      const matches = (getAllCards() || [])
        .filter(c => c.passcode && /^\d+$/.test(String(c.passcode)) && (!q || c.name.toLowerCase().includes(q) || String(c.passcode).includes(q)))
        .slice(0, 24);
      matches.forEach((c) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary';
        btn.textContent = c.name;
        btn.onclick = () => sendOcgPromptResponse({ type: 18, card: Number(c.passcode) });
        results.appendChild(btn);
      });
    };
    input.addEventListener('input', renderMatches);
    renderMatches();
    wrap.append(input, results);
    bodyEl.appendChild(wrap);
  }

  if (!dlg.open) dlg.showModal();
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCardRichnessScore(card) {
  if (!card || typeof card !== 'object') return 0;
  let score = 0;
  if (card.description || card.descriptionTh || card.descEn || card.descTh) score += 4;
  if (card.kind) score += 2;
  if (card.frame) score += 1;
  if (card.atk !== undefined || card.currentAtk !== undefined) score += 1;
  if (card.race) score += 1;
  if (card.nameTh && card.nameTh !== card.name) score += 1;
  return score;
}

function normalizeCardForInspector(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const codeKey = raw.passcode || (raw.code ? String(raw.code) : '');
  const base =
    (raw.id ? getCardById(raw.id) : null) ||
    (codeKey ? getCardById(codeKey) : null) ||
    null;

  const merged = base ? { ...base, ...raw } : { ...raw };
  merged.id = raw.id || base?.id || (codeKey ? `cdb_${codeKey}` : '');
  merged.passcode = codeKey || base?.passcode || '';
  merged.name = raw.name || base?.name || raw.nameTh || base?.nameTh || (codeKey ? `Card #${codeKey}` : 'Card');
  merged.nameTh = raw.nameTh || base?.nameTh || merged.name;
  merged.kind = raw.kind || base?.kind || 'MONSTER';
  merged.frame = raw.frame || base?.frame || (merged.kind === 'SPELL' ? 'SPELL' : merged.kind === 'TRAP' ? 'TRAP' : 'EFFECT');
  merged.subtype = raw.subtype || raw.subType || base?.subtype || base?.subType || null;
  merged.subType = merged.subtype;
  merged.attribute = raw.attribute || base?.attribute || (merged.kind === 'MONSTER' ? 'DARK' : merged.kind);
  merged.race = raw.race || base?.race || 'Unknown';
  merged.level = raw.level ?? base?.level ?? 0;
  merged.rank = raw.rank ?? base?.rank ?? 0;
  merged.linkRating = raw.linkRating ?? base?.linkRating ?? 0;
  merged.atk = raw.atk ?? base?.atk ?? 0;
  merged.def = raw.def ?? base?.def ?? 0;
  merged.description = raw.description || raw.descEn || base?.description || base?.descEn || '';
  merged.descriptionTh = raw.descriptionTh || raw.descTh || base?.descriptionTh || base?.descTh || merged.description;
  merged.summonMaterials = raw.summonMaterials || base?.summonMaterials || null;
  return merged;
}

function registerKnownCard(card) {
  if (!card || typeof card !== 'object') return;
  if (card.isHiddenFaceDown || card.id === 'facedown' || card.id === 'deck_hidden') return;
  const norm = normalizeCardForInspector(card);
  if (!norm || (!norm.name && !norm.nameTh)) return;
  const newScore = getCardRichnessScore(norm);

  if (norm.id) {
    const prev = appState.knownCardsById.get(norm.id);
    if (!prev || newScore >= getCardRichnessScore(prev)) {
      appState.knownCardsById.set(norm.id, norm);
    }
  }
  const codeStr = norm.passcode ? String(Number(norm.passcode) || norm.passcode).trim() : '';
  if (codeStr && codeStr !== '0') {
    const prev = appState.knownCardsByCode.get(codeStr);
    if (!prev || newScore >= getCardRichnessScore(prev)) {
      appState.knownCardsByCode.set(codeStr, norm);
    }
  }
  for (const nm of [norm.name, norm.nameTh]) {
    const key = String(nm || '').trim().toLowerCase();
    if (key.length >= 3 && !/^card #\d+$/.test(key) && key !== 'face-down card' && key !== 'deck card') {
      const prev = appState.knownCardsByName.get(key);
      if (!prev || newScore >= getCardRichnessScore(prev)) {
        appState.knownCardsByName.set(key, norm);
      }
    }
  }
}

function isCardHiddenFromMe(card, myIdx) {
  if (!card) return true;
  if (card.isHiddenFaceDown || card.id === 'facedown' || card.id === 'deck_hidden') return true;
  if (typeof card.controller === 'number' && card.controller !== myIdx) {
    const onField = card.zone === 'MMZ' || card.zone === 'STZ' || card.zone === 'EMZ' || card.zone === 'FIELD';
    const isSetPos = card.position === POSITIONS.SET || card.position === POSITIONS.SET_DEF || Boolean(card.isFaceDown);
    if ((onField && isSetPos) || card.zone === 'HAND' || card.zone === 'DECK') {
      return true;
    }
  }
  return false;
}

function harvestKnownCardsFromState(state, myIdx, legal) {
  if (!state?.players) return;
  const me = state.players[myIdx];
  const opp = state.players[1 - myIdx];

  if (me) {
    const ownCards = [
      ...(me.hand || []),
      ...(me.mmz || []),
      ...(me.stz || []),
      me.emz,
      ...(me.emzSlots || []),
      me.fieldSpell,
      ...(me.gy || []),
      ...(me.banished || []),
      ...(me.extra || [])
    ];
    for (const c of ownCards) {
      if (c) registerKnownCard(c);
    }
  }

  if (opp) {
    const oppFieldCards = [
      ...(opp.mmz || []),
      ...(opp.stz || []),
      opp.emz,
      ...(opp.emzSlots || []),
      opp.fieldSpell
    ];
    for (const c of oppFieldCards) {
      if (!c) continue;
      const isSetPos = c.position === POSITIONS.SET || c.position === POSITIONS.SET_DEF || Boolean(c.isFaceDown);
      if (!isSetPos) registerKnownCard(c);
    }
    for (const c of [...(opp.gy || []), ...(opp.banished || [])]) {
      if (c && !c.isFaceDown && !c.isHiddenFaceDown) registerKnownCard(c);
    }
  }

  for (const item of state.chainStack || []) {
    if (item?.card) registerKnownCard(item.card);
  }
  for (const ev of state.recentEvents || []) {
    if (ev?.meta && !ev.nowFaceDown && !ev.to?.isFaceDown) {
      registerKnownCard(ev.meta);
    }
  }
  for (const entry of state.logs || []) {
    if (entry?.cardSnapshot) registerKnownCard(entry.cardSnapshot);
    if (Array.isArray(entry?.cardRefs)) {
      for (const ref of entry.cardRefs) registerKnownCard(ref);
    }
  }
  for (const item of legal?.chainPrompt?.respondableCards || []) {
    if (item?.card) registerKnownCard(item.card);
  }
}

function findVisibleCardInState(state, myIdx, { instanceId, id, code }) {
  if (!state?.players) return null;
  const normCode = code ? String(Number(code) || code).trim() : '';
  const matches = (c) => {
    if (!c || isCardHiddenFromMe(c, myIdx)) return false;
    if (instanceId && c.instanceId === instanceId) return true;
    if (id && c.id === id) return true;
    if (normCode && c.passcode && String(Number(c.passcode) || c.passcode).trim() === normCode) return true;
    return false;
  };

  for (const item of state.chainStack || []) {
    if (item?.card && matches(item.card)) return item.card;
  }

  for (let pIdx = 0; pIdx < state.players.length; pIdx++) {
    const p = state.players[pIdx];
    if (!p) continue;
    const zones = pIdx === myIdx
      ? [
          ...(p.mmz || []),
          ...(p.stz || []),
          p.emz,
          ...(p.emzSlots || []),
          p.fieldSpell,
          ...(p.hand || []),
          ...(p.gy || []),
          ...(p.banished || []),
          ...(p.extra || [])
        ]
      : [
          ...(p.mmz || []),
          ...(p.stz || []),
          p.emz,
          ...(p.emzSlots || []),
          p.fieldSpell,
          ...(p.gy || []),
          ...(p.banished || [])
        ];
    for (const c of zones) {
      if (matches(c)) return c;
    }
  }
  return null;
}

function resolveFullCardMeta(ref, state = appState.currentState) {
  if (!ref) return null;
  const myIdx = appState.myPlayerIndex ?? 0;

  if (typeof ref === 'string') {
    const fromKnown = appState.knownCardsById.get(ref) || appState.knownCardsByCode.get(ref) || appState.knownCardsByName.get(ref.toLowerCase());
    if (fromKnown) return normalizeCardForInspector(fromKnown);
    const fromReg = getCardById(ref);
    if (fromReg) return normalizeCardForInspector(fromReg);
    return null;
  }

  const instanceId = ref.instanceId || ref.card?.instanceId || null;
  const id = ref.id || ref.cardId || ref.card?.id || null;
  const rawCode = ref.passcode || ref.code || ref.cardCode || ref.card?.passcode || ref.card?.code || '';
  const code = rawCode ? String(Number(rawCode) || rawCode).trim() : '';
  const nameKey = String(ref.name || ref.cardName || ref.nameTh || ref.cardNameTh || '').trim().toLowerCase();

  const liveMatch = findVisibleCardInState(state, myIdx, { instanceId, id, code });
  const knownMatch =
    (id && appState.knownCardsById.get(id)) ||
    (code && code !== '0' && appState.knownCardsByCode.get(code)) ||
    (nameKey && appState.knownCardsByName.get(nameKey)) ||
    null;
  const regMatch = (id && getCardById(id)) || (code && code !== '0' && getCardById(code)) || null;

  // Prefer the richest metadata source while preserving live board stats if present
  const candidates = [regMatch, knownMatch, ref.card, ref, liveMatch].filter(Boolean);
  if (candidates.length === 0) return null;

  const combined = {};
  for (const src of candidates) {
    for (const [k, v] of Object.entries(src)) {
      if (v !== undefined && v !== null && v !== '') {
        combined[k] = v;
      }
    }
  }
  return normalizeCardForInspector(combined);
}

function switchInspectorTab(tabName = 'card') {
  document.querySelectorAll('.insp-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-insp') === tabName);
  });
  document.querySelectorAll('.inspector-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `inspector-${tabName}-pane`);
  });
}

function inspectCardAndFocus(card, opts = {}) {
  const resolved = resolveFullCardMeta(card, appState.currentState);
  if (!resolved) return;
  inspectCard(resolved);
  switchInspectorTab('card');
  if (opts.openMobilePreview && window.innerWidth < 1024) {
    showMobileCardDetail(resolved);
  }
}

function autoFocusLatestPlayedOrActivatedCard(state, prevState, myIdx) {
  if (!state) return;
  let candidate = null;

  // 1. Inspect recentEvents (YGOProEngine structured events) newest-first
  const events = Array.isArray(state.recentEvents) ? state.recentEvents : [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!ev) continue;

    if (ev.type === 'CHAINING' || ev.type === 'ACTIVATE' || ev.type === 'CHAIN_ADD') {
      const chainMatch = (state.chainStack || []).find(
        item => item.chainLink === ev.chainLink && item.card
      );
      const cardRef = chainMatch?.card || ev.meta || (ev.code ? { code: ev.code } : null);
      if (cardRef) {
        candidate = { key: `ev:${ev.seq}:${ev.type}:${ev.code || ''}`, cardRef };
        break;
      }
    } else if (ev.type === 'SUMMON' || ev.type === 'FLIP') {
      const isHiddenOpp = ev.controller !== myIdx && (ev.position === POSITIONS.SET || ev.position === POSITIONS.SET_DEF);
      if (!isHiddenOpp && (ev.meta || ev.code)) {
        candidate = { key: `ev:${ev.seq}:${ev.type}:${ev.code || ''}`, cardRef: ev.meta || { code: ev.code } };
        break;
      }
    } else if (ev.type === 'POS_CHANGE') {
      if (!ev.nowFaceDown && (ev.meta || ev.code)) {
        candidate = { key: `ev:${ev.seq}:POS_CHANGE:${ev.code || ''}`, cardRef: ev.meta || { code: ev.code } };
        break;
      }
    } else if (ev.type === 'MOVE') {
      const toZone = ev.to?.zone;
      const onField = toZone === 'MMZ' || toZone === 'EMZ' || toZone === 'STZ' || toZone === 'FIELD';
      if (onField && !ev.to?.isFaceDown && (ev.meta || ev.code)) {
        candidate = { key: `ev:${ev.seq}:MOVE:${ev.code || ''}`, cardRef: ev.meta || { code: ev.code } };
        break;
      }
    }
  }

  // 2. Fallback to top of active chainStack (covers DuelEngine & mid-chain states)
  if (!candidate && Array.isArray(state.chainStack) && state.chainStack.length > 0) {
    const top = state.chainStack[state.chainStack.length - 1];
    if (top?.card) {
      candidate = {
        key: `chain:${state.turnCount}:${state.phase}:${top.chainLink}:${top.card.instanceId || top.card.id || top.card.passcode || ''}`,
        cardRef: top.card
      };
    }
  }

  // 3. Fallback for DuelEngine (when recentEvents is empty): diff visible field cards or latest card log
  if (!candidate && events.length === 0 && prevState?.players) {
    const collectFieldMap = (s) => {
      const map = new Map();
      for (let pIdx = 0; pIdx < (s.players?.length || 0); pIdx++) {
        const p = s.players[pIdx];
        if (!p) continue;
        const fieldCards = [
          ...(p.mmz || []),
          ...(p.stz || []),
          p.emz,
          ...(p.emzSlots || []),
          p.fieldSpell
        ].filter(Boolean);
        for (const c of fieldCards) {
          map.set(c.instanceId, { card: c, pIdx });
        }
      }
      return map;
    };

    const prevMap = collectFieldMap(prevState);
    const curMap = collectFieldMap(state);
    for (const [instId, entry] of curMap.entries()) {
      const { card, pIdx } = entry;
      const isSetPos = card.position === POSITIONS.SET || card.position === POSITIONS.SET_DEF || Boolean(card.isFaceDown);
      if (pIdx !== myIdx && isSetPos) continue;
      const prevEntry = prevMap.get(instId);
      const prevWasSet = prevEntry && (prevEntry.card.position === POSITIONS.SET || prevEntry.card.position === POSITIONS.SET_DEF || Boolean(prevEntry.card.isFaceDown));
      if (!prevEntry || (prevWasSet && !isSetPos)) {
        candidate = {
          key: `diff:${state.turnCount}:${instId}:${card.zone}:${card.position}`,
          cardRef: card
        };
      }
    }

    if (!candidate && Array.isArray(state.logs) && state.logs.length > 0) {
      const latestLog = state.logs[state.logs.length - 1];
      const prevLogsLen = typeof prevState.logsLength === 'number' ? prevState.logsLength : (prevState.logs?.length || 0);
      const prevLastLog = prevState.lastLog || prevState.logs?.[prevLogsLen - 1];
      const logChanged = !prevLastLog || latestLog.id !== prevLastLog.id || latestLog.text !== prevLastLog.text || state.logs.length !== prevLogsLen;
      if (logChanged && (latestLog.cardSnapshot || latestLog.cardId || latestLog.cardCode)) {
        candidate = {
          key: `log:${latestLog.id || state.logs.length}:${latestLog.cardId || latestLog.cardCode || ''}`,
          cardRef: latestLog.cardSnapshot || { id: latestLog.cardId, code: latestLog.cardCode }
        };
      }
    }
  }

  if (!candidate || !candidate.key || candidate.key === appState.lastAutoInspectedEventKey) {
    return;
  }

  const resolved = resolveFullCardMeta(candidate.cardRef, state);
  if (!resolved || isCardHiddenFromMe(resolved, myIdx)) {
    return;
  }

  appState.lastAutoInspectedEventKey = candidate.key;
  inspectCard(resolved);
}

function closeMobileCardDetail() {
  const el = document.getElementById('mobile-card-preview');
  if (!el) return;
  el.classList.add('hidden');
  el.innerHTML = '';
}

function showMobileCardDetail(card) {
  const resolved = resolveFullCardMeta(card, appState.currentState);
  if (!resolved) return;

  let overlay = document.getElementById('mobile-card-preview');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'mobile-card-preview';
    overlay.className = 'mobile-card-preview hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Card Details');
    document.getElementById('screen-duel')?.appendChild(overlay);
  }

  const lang = appState.lang;
  const badge = getCardSubHeaderBadge(resolved, lang);
  const frameClass = getCardFrameClass(resolved);
  const attrMeta = getAttributeMeta(resolved);
  const titleMain = getLocalizedCardName(resolved, lang) || resolved.name || 'Card';
  const titleSub = lang === 'th' && resolved.name && resolved.name !== titleMain ? resolved.name : '';
  const previewLevel = resolved.kind === 'MONSTER'
    ? (resolved.frame === 'XYZ' ? `R${resolved.rank}` : resolved.frame === 'LINK' ? `L${resolved.linkRating}` : `★${resolved.currentLevel ?? resolved.level}`)
    : (resolved.kind === 'SPELL' ? 'SPELL' : 'TRAP');
  const statsLine = resolved.kind === 'MONSTER'
    ? `<span class="stat-chip stat-atk">ATK ${escapeHtml(resolved.currentAtk ?? resolved.atk)}</span>
       ${resolved.frame !== 'LINK' ? `<span class="stat-chip stat-def">DEF ${escapeHtml(resolved.currentDef ?? resolved.def)}</span>` : ''}
       <span class="stat-chip">${escapeHtml(previewLevel)}</span>
       <span class="stat-chip">${escapeHtml(lang === 'en' ? 'Type' : 'เผ่า')}: ${escapeHtml(resolved.race)}</span>
       <span class="stat-chip" style="border-color:${escapeHtml(attrMeta.bg)}">${escapeHtml(attrMeta.badge)} ${escapeHtml(lang === 'en' ? attrMeta.nameEn : attrMeta.nameTh)}</span>`
    : `<span class="stat-chip">${escapeHtml(attrMeta.badge)} ${escapeHtml(badge)}</span>`;
  const summonText = lang === 'en'
    ? (resolved.summonMaterials?.description || resolved.summonMaterials?.descriptionTh || '')
    : (resolved.summonMaterials?.descriptionTh || resolved.summonMaterials?.description || '');
  const descMain = getLocalizedCardDesc(resolved, lang) || '';

  overlay.innerHTML = `
    <div class="mobile-card-preview-card">
      <div class="mobile-card-preview-header">
        <div class="mobile-card-preview-titles">
          <div class="mobile-card-preview-name">${escapeHtml(titleMain)}</div>
          ${titleSub ? `<div class="mobile-card-preview-subname">${escapeHtml(titleSub)}</div>` : ''}
        </div>
        <button type="button" class="btn-mini mobile-card-preview-close" aria-label="${escapeHtml(t(lang, 'closeBtn'))}">${iconSvg('close')}</button>
      </div>
      <div class="mobile-card-preview-body">
        <div class="mobile-card-preview-top">
          <div class="inspector-card-frame ${escapeHtml(frameClass)} mobile-preview-frame">
            <div class="insp-frame-art-box">
              <img class="inspected-art" src="${escapeHtml(getCardArtUrl(resolved))}" alt="${escapeHtml(titleMain)}" decoding="async" />
            </div>
          </div>
          <div class="mobile-card-preview-meta">
            <div class="inspected-sub-badge">${escapeHtml(badge)}</div>
            <div class="inspected-stats-badges">${statsLine}</div>
          </div>
        </div>
        ${summonText ? `<div class="inspected-summon-box"><strong>${escapeHtml(t(lang, 'summonCond'))}</strong> ${escapeHtml(summonText)}</div>` : ''}
        <div class="inspected-desc-box">
          <div class="inspected-desc-head">${escapeHtml(t(lang, 'effectHeader'))}</div>
          <div class="mobile-card-preview-desc">${escapeHtml(descMain)}</div>
          ${lang === 'th' && resolved.description && resolved.description !== descMain ? `<hr class="inspected-hr"/><div class="inspected-desc-en">${escapeHtml(resolved.description)}</div>` : ''}
        </div>
      </div>
    </div>
  `;

  overlay.querySelector('.mobile-card-preview-close')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeMobileCardDetail();
  });
  overlay.onclick = (ev) => {
    if (ev.target === overlay) {
      closeMobileCardDetail();
    }
  };

  const img = overlay.querySelector('img');
  img?.addEventListener('error', () => {
    img.src = generateProceduralCardSvg(resolved);
  }, { once: true });

  if (lang === 'th' && resolved.description) {
    const descEl = overlay.querySelector('.mobile-card-preview-desc');
    translateTextWithGoogle(resolved.description).then((translated) => {
      if (translated && descEl && !overlay.classList.contains('hidden') && appState.lang === 'th') {
        descEl.textContent = translated;
      }
    });
  }

  overlay.classList.remove('hidden');
}

function getChainPeekButtonLabel(isPeeking, lang = appState.lang) {
  return t(lang, isPeeking ? 'backToPromptBtn' : 'viewBoardBtn');
}

function syncChainPeekButton(bar, btn) {
  if (!bar || !btn) return;
  const isPeeking = bar.classList.contains('is-peeking');
  const label = getChainPeekButtonLabel(isPeeking);
  btn.innerHTML = `${iconSvg(isPeeking ? 'back' : 'peek')}<span class="btn-label">${escapeHtml(label)}</span>`;
  btn.setAttribute('aria-pressed', isPeeking ? 'true' : 'false');
  btn.title = appState.lang === 'en'
    ? (isPeeking ? 'Back to prompt' : 'Temporarily hide bar to view the board')
    : (isPeeking ? 'กลับไปเลือกเชน/คำสั่ง' : 'ซ่อนแถบชั่วคราวเพื่อดูสนาม');
}

function createFieldPeekButton(banner) {
  const peekBtn = document.createElement('button');
  peekBtn.type = 'button';
  peekBtn.className = 'btn-mini btn-chain-peek';
  syncChainPeekButton(banner, peekBtn);
  peekBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    banner.classList.toggle('is-peeking');
    syncChainPeekButton(banner, peekBtn);
  });
  return peekBtn;
}

function syncAllPeekButtons() {
  const chainBar = document.getElementById('chain-prompt-bar');
  const chainPeekBtn = document.getElementById('btn-chain-peek');
  if (chainBar && chainPeekBtn) syncChainPeekButton(chainBar, chainPeekBtn);

  const fieldBanner = document.getElementById('field-pick-banner');
  const fieldPeekBtn = fieldBanner?.querySelector('.btn-chain-peek');
  if (fieldBanner && fieldPeekBtn) syncChainPeekButton(fieldBanner, fieldPeekBtn);
}

function inspectCard(card) {
  if (!card) return;
  const resolved = normalizeCardForInspector(card) || card;
  appState.lastInspectedCard = resolved;
  const pane = document.getElementById('inspector-content');
  if (!pane) return;
  const lang = appState.lang;
  const badge = getCardSubHeaderBadge(resolved, lang);
  const frameClass = getCardFrameClass(resolved);
  const attrMeta = getAttributeMeta(resolved);
  const titleMain = getLocalizedCardName(resolved, lang) || resolved.name || 'Card';
  const statsLine = resolved.kind === 'MONSTER'
    ? `<span class="stat-chip stat-atk">ATK ${escapeHtml(resolved.currentAtk ?? resolved.atk)}</span>
       ${resolved.frame !== 'LINK' ? `<span class="stat-chip stat-def">DEF ${escapeHtml(resolved.currentDef ?? resolved.def)}</span>` : ''}
       <span class="stat-chip">${escapeHtml(lang === 'en' ? 'Type' : 'เผ่า')}: ${escapeHtml(resolved.race)}</span>
       <span class="stat-chip" style="border-color:${escapeHtml(attrMeta.bg)}">${escapeHtml(attrMeta.badge)} ${escapeHtml(lang === 'en' ? attrMeta.nameEn : attrMeta.nameTh)}</span>`
    : `<span class="stat-chip">${escapeHtml(attrMeta.badge)} ${escapeHtml(badge)}</span>`;

  const previewLevel = resolved.kind === 'MONSTER'
    ? (resolved.frame === 'XYZ' ? `R${resolved.rank}` : resolved.frame === 'LINK' ? `L${resolved.linkRating}` : `★${resolved.currentLevel ?? resolved.level}`)
    : (resolved.kind === 'SPELL' ? 'SPELL' : 'TRAP');

  pane.innerHTML = `
    <div class="inspected-card-view">
      <div class="inspected-art-wrap">
        <div class="inspector-card-frame ${escapeHtml(frameClass)}">
          <div class="insp-frame-head">
            <span class="insp-frame-name">${escapeHtml(getLocalizedCardName(resolved, lang))}</span>
            <span class="card-attr-orb" style="background:${escapeHtml(attrMeta.bg)};color:${escapeHtml(attrMeta.color)}">${escapeHtml(attrMeta.badge)}</span>
          </div>
          <div class="insp-frame-sub">${escapeHtml(previewLevel)}</div>
          <div class="insp-frame-art-box">
            <img class="inspected-art" src="${escapeHtml(getCardArtUrl(resolved))}" alt="${escapeHtml(resolved.name)}" decoding="async" />
          </div>
          <div class="insp-frame-foot">
            ${resolved.kind === 'MONSTER'
              ? `<span>ATK/${escapeHtml(resolved.currentAtk ?? resolved.atk)}</span><span>${resolved.frame === 'LINK' ? `LINK-${escapeHtml(resolved.linkRating)}` : `DEF/${escapeHtml(resolved.currentDef ?? resolved.def)}`}</span>`
              : `<span>[${escapeHtml(badge)}]</span>`}
          </div>
        </div>
        <div class="inspected-meta-col">
          <div class="inspected-title-th">${escapeHtml(titleMain)}</div>
          ${lang === 'th' && resolved.name && resolved.name !== titleMain ? `<div class="inspected-title-en" lang="en">${escapeHtml(resolved.name)}</div>` : ''}
          <div class="inspected-sub-badge">${escapeHtml(badge)}</div>
        </div>
      </div>
      <div class="inspected-stats-badges">${statsLine}</div>
      ${(lang === 'en' ? (resolved.summonMaterials?.description || resolved.summonMaterials?.descriptionTh) : resolved.summonMaterials?.descriptionTh)
        ? `<div class="inspected-summon-box"><strong>${escapeHtml(t(lang, 'summonCond'))}</strong> ${escapeHtml(lang === 'en' ? (resolved.summonMaterials.description || resolved.summonMaterials.descriptionTh) : resolved.summonMaterials.descriptionTh)}</div>`
        : ''}
      <div class="inspected-desc-box">
        <div class="inspected-desc-head">${escapeHtml(t(lang, 'effectHeader'))}</div>
        <div id="inspected-desc-main">${escapeHtml(getLocalizedCardDesc(resolved, lang))}</div>
        ${lang === 'th' && resolved.description ? `<hr class="inspected-hr"/><div class="inspected-desc-en">${escapeHtml(resolved.description)}</div>` : ''}
      </div>
    </div>
  `;

  if (lang === 'th' && resolved.description) {
    const descEl = document.getElementById('inspected-desc-main');
    translateTextWithGoogle(resolved.description).then((translated) => {
      if (translated && descEl && appState.lastInspectedCard?.id === resolved.id && appState.lang === 'th') {
        descEl.textContent = translated;
      }
    });
  }

  const img = pane.querySelector('img');
  img?.addEventListener('error', () => {
    img.src = generateProceduralCardSvg(resolved);
  }, { once: true });
}

let suppressPopupHideUntil = 0;
let activeZonePickCleanup = null;
let activeZonePickMandatory = false;

function clearZonePickMode(force = false) {
  if (!force && activeZonePickMandatory) return;
  closeEffectChoiceModal();
  if (activeZonePickCleanup) {
    activeZonePickCleanup();
    activeZonePickCleanup = null;
  }
  activeZonePickMandatory = false;
  document.body.classList.remove('is-zone-picking');
  clearSelectedHandCard();
  const banner = document.getElementById('field-pick-banner');
  if (banner) {
    banner.classList.add('hidden');
    banner.classList.remove('is-peeking');
    banner.innerHTML = '';
    delete banner.dataset.mode;
  }
}

function openInlinePickBanner({
  icon = 'activate',
  message = '',
  headerButtons = [],
  actionButtons = [],
  mandatory = true,
  mode = 'prompt',
  showPeekBtn = true,
  dismissOnOutside = false,
  dismissOnEsc = false
}) {
  clearZonePickMode(true);
  const banner = document.getElementById('field-pick-banner');
  if (!banner) return null;

  activeZonePickMandatory = Boolean(mandatory);
  banner.dataset.mode = mode;
  if (mode === 'zone-pick') {
    document.body.classList.add('is-zone-picking');
  }
  banner.classList.remove('is-peeking');
  banner.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'chain-bar-header';
  if (actionButtons.length === 0) {
    head.classList.add('chain-bar-header-compact');
  }
  const spark = document.createElement('span');
  spark.className = 'chain-spark';
  if (UI_ICON_PATHS[icon]) {
    spark.innerHTML = iconSvg(icon);
  } else {
    spark.textContent = icon;
  }
  const msgEl = document.createElement('div');
  msgEl.className = 'chain-trigger-desc field-pick-msg';
  msgEl.textContent = message;
  head.append(spark, msgEl);
  if (showPeekBtn) {
    head.appendChild(createFieldPeekButton(banner));
  }
  if (headerButtons.length > 0) {
    head.append(...headerButtons);
  }
  banner.appendChild(head);

  if (actionButtons.length > 0) {
    const actionsRow = document.createElement('div');
    actionsRow.className = 'inline-prompt-actions';
    for (const btn of actionButtons) {
      actionsRow.appendChild(btn);
    }
    banner.appendChild(actionsRow);
  }

  banner.classList.remove('hidden');

  const onEsc = (ev) => {
    if (ev.key === 'Escape') clearZonePickMode(true);
  };
  const onDocClick = (ev) => {
    if (Date.now() < suppressPopupHideUntil) return;
    if (!ev.target.closest('#field-pick-banner, #mobile-card-preview')) {
      clearZonePickMode(true);
    }
  };
  let outsideClickTimer = null;
  if (dismissOnEsc) document.addEventListener('keydown', onEsc);
  if (dismissOnOutside) {
    outsideClickTimer = setTimeout(() => {
      outsideClickTimer = null;
      document.addEventListener('click', onDocClick);
    }, 0);
  }

  activeZonePickCleanup = () => {
    if (outsideClickTimer !== null) {
      clearTimeout(outsideClickTimer);
      outsideClickTimer = null;
    }
    if (dismissOnEsc) document.removeEventListener('keydown', onEsc);
    if (dismissOnOutside) document.removeEventListener('click', onDocClick);
  };

  return { banner, msgEl };
}

function enterOcgYesNoBanner(prompt) {
  const lang = appState.lang;
  const typeVal = prompt.promptType === 'SELECT_EFFECTYN' ? 2 : 3;
  const cardPart = prompt.cardName
    ? (lang === 'en' ? `Activate "${prompt.cardName}"?` : `ใช้งานเอฟเฟกต์ "${prompt.cardName}"?`)
    : (lang === 'en' ? 'Confirm Action' : 'ยืนยันการทำงาน');
  const desc = prompt.description && prompt.description !== prompt.cardName
    ? ` — ${prompt.description}`
    : '';

  const yesBtn = document.createElement('button');
  yesBtn.type = 'button';
  yesBtn.className = 'btn btn-primary btn-mini';
  yesBtn.textContent = lang === 'en' ? '✓ Yes (Activate)' : '✓ ใช่ (เปิดใช้)';
  yesBtn.onclick = () => sendOcgPromptResponse({ type: typeVal, yes: true });

  const noBtn = document.createElement('button');
  noBtn.type = 'button';
  noBtn.className = 'btn btn-secondary btn-mini';
  noBtn.textContent = lang === 'en' ? '✗ No' : '✗ ไม่';
  noBtn.onclick = () => sendOcgPromptResponse({ type: typeVal, yes: false });

  if (prompt.code) {
    const cardRef = getCardById(String(prompt.code));
    if (cardRef) inspectCard(cardRef);
  }

  return Boolean(openInlinePickBanner({
    icon: '⚡',
    message: `${cardPart}${desc}`,
    headerButtons: [yesBtn, noBtn],
    mandatory: true,
    mode: 'ocg-yesno'
  }));
}

function getEffectChoiceLabels() {
  const lang = appState.lang;
  return {
    title: t(lang, 'effectChoiceTitle'),
    ok: t(lang, 'effectChoiceOk'),
    cancel: t(lang, 'effectChoiceCancel'),
    viewBoard: t(lang, 'effectChoiceViewBoard'),
    showPrompt: t(lang, 'effectChoiceShowPrompt'),
    tabLabel: t(lang, 'effectChoiceTabLabel')
  };
}

function enterOcgOptionBanner(prompt) {
  const opts = prompt.options || [];
  if (opts.length === 0) return false;

  return openMasterDuelEffectChoiceModal({
    options: opts,
    canCancel: Boolean(prompt.canCancel),
    getLabels: getEffectChoiceLabels,
    getOptionText: (opt) => {
      const lang = appState.lang;
      return (lang === 'th' ? (opt.labelTh || opt.label) : (opt.labelEn || opt.label)) || `Option ${opt.index + 1}`;
    },
    onConfirm: (opt) => {
      sendOcgPromptResponse({ type: 4, index: opt.index });
    }
  });
}

function enterOcgPositionBanner(prompt) {
  const lang = appState.lang;
  const cardRef = prompt.code ? (getCardById(String(prompt.code)) || { passcode: String(prompt.code), name: prompt.cardName }) : null;
  if (cardRef) inspectCard(cardRef);

  const posOpts = [
    { mask: 1, faceDown: false, isDef: false, labelEn: 'Face-Up ATK', labelTh: 'ตั้งโจมตี (ATK)' },
    { mask: 4, faceDown: false, isDef: true, labelEn: 'Face-Up DEF', labelTh: 'ตั้งป้องกัน (DEF)' },
    { mask: 8, faceDown: true, isDef: true, labelEn: 'Face-Down DEF', labelTh: 'หมอบป้องกัน (Set)' },
    { mask: 2, faceDown: true, isDef: false, labelEn: 'Face-Down ATK', labelTh: 'หมอบโจมตี' }
  ];

  const btns = [];
  for (const p of posOpts) {
    if ((prompt.positionsMask & p.mask) === 0) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ygopro-pos-btn';

    const box = document.createElement('div');
    box.className = 'ygopro-pos-preview-box';
    if (p.faceDown || !cardRef) {
      const back = document.createElement('div');
      back.className = `ygopro-pos-thumb ${p.isDef ? 'is-def' : ''}`;
      back.style.backgroundImage = getCardBackSvgUrl(false);
      back.style.backgroundSize = 'cover';
      back.style.backgroundPosition = 'center';
      box.appendChild(back);
    } else {
      const img = document.createElement('img');
      img.className = `ygopro-pos-thumb ${p.isDef ? 'is-def' : ''}`;
      img.src = getCardArtUrl(cardRef);
      img.alt = p.labelEn;
      img.decoding = 'async';
      img.addEventListener('error', () => {
        img.src = generateProceduralCardSvg(cardRef);
      }, { once: true });
      box.appendChild(img);
    }

    const lbl = document.createElement('span');
    lbl.className = 'ygopro-pos-label';
    lbl.textContent = lang === 'en' ? p.labelEn : p.labelTh;
    btn.append(box, lbl);
    btn.onclick = () => sendOcgPromptResponse({ type: 11, position: p.mask });
    btns.push(btn);
  }
  if (btns.length === 0) return false;

  return Boolean(openInlinePickBanner({
    icon: 'position',
    message: lang === 'en'
      ? `Choose Battle Position (${prompt.cardName || 'Monster'}):`
      : `เลือกสภาพวางการ์ด (${prompt.cardName || 'มอนสเตอร์'}):`,
    actionButtons: btns,
    mandatory: true,
    mode: 'ocg-position'
  }));
}

function closeYgoproCardStrip(onlyMode = null) {
  const strip = document.getElementById('ygopro-card-strip');
  if (!strip) return;
  if (onlyMode && strip.dataset.mode !== onlyMode) return;
  if (strip._cleanup) {
    strip._cleanup();
    strip._cleanup = null;
  }
  strip.classList.add('hidden');
  strip.classList.remove('minimized');
  strip.innerHTML = '';
  delete strip.dataset.mode;
}

function openYgoproCardStrip({ mode = 'ocg-strip', title = '', headerButtons = [], bodyEl, dismissOnEsc = false }) {
  closeYgoproCardStrip();
  const strip = document.getElementById('ygopro-card-strip');
  if (!strip) return null;

  const lang = appState.lang;
  strip.dataset.mode = mode;
  strip.classList.remove('hidden', 'minimized');
  strip.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'ygopro-strip-header';

  const titleEl = document.createElement('div');
  titleEl.className = 'ygopro-strip-title';
  titleEl.textContent = title;

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn btn-secondary btn-mini';
  const syncToggleText = () => {
    const isMin = strip.classList.contains('minimized');
    const lbl = isMin ? t(lang, 'showCardsBtn') : t(lang, 'viewBoardBtn');
    toggleBtn.innerHTML = `${iconSvg(isMin ? 'cards' : 'peek')}<span class="btn-label">${escapeHtml(lbl)}</span>`;
  };
  syncToggleText();
  toggleBtn.onclick = (ev) => {
    ev.stopPropagation();
    strip.classList.toggle('minimized');
    syncToggleText();
  };

  header.append(titleEl, toggleBtn, ...headerButtons);

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'ygopro-strip-body';
  if (bodyEl) bodyWrap.appendChild(bodyEl);

  strip.append(header, bodyWrap);

  const onEsc = (ev) => {
    if (dismissOnEsc && ev.key === 'Escape') {
      closeYgoproCardStrip();
    }
  };
  if (dismissOnEsc) {
    document.addEventListener('keydown', onEsc);
  }
  strip._cleanup = () => {
    if (dismissOnEsc) document.removeEventListener('keydown', onEsc);
  };

  return strip;
}

function buildYgoproStripCardNode(c, badgeText = '', pIdx = 0) {
  const isFaceDown = Boolean(c.isHiddenFaceDown);
  const cardRef = isFaceDown
    ? { id: 'facedown', name: 'Face-down Card', nameTh: 'การ์ดคว่ำหน้า', kind: 'CARD' }
    : (getCardById(String(c.passcode || c.code || c.id || '')) || {
        id: c.id || String(c.code || ''),
        passcode: c.passcode || String(c.code || ''),
        name: c.name || `Card #${c.code}`,
        nameTh: c.nameTh || c.name || `Card #${c.code}`,
        kind: c.kind || 'MONSTER'
      });

  const col = document.createElement('div');
  col.className = 'ygopro-strip-card-col';

  const cardEl = createCardElement(cardRef, { isFaceDown });
  if (!isFaceDown) {
    cardEl.addEventListener('mouseenter', () => inspectCard(cardRef));
  }
  col.appendChild(cardEl);

  const ownerTag = typeof c.controller === 'number' ? (c.controller === pIdx ? 'Your ' : 'Opp ') : '';
  const zoneLabel = badgeText || `${ownerTag}${c.zone || ''}`.trim();
  if (zoneLabel) {
    const tag = document.createElement('span');
    tag.className = 'ygopro-strip-tag';
    tag.textContent = zoneLabel;
    col.appendChild(tag);
  }

  const nameSpan = document.createElement('span');
  nameSpan.className = 'ygopro-strip-name';
  nameSpan.textContent = isFaceDown ? (appState.lang === 'en' ? 'Face-down' : 'คว่ำหน้า') : getLocalizedCardName(cardRef, appState.lang);
  col.appendChild(nameSpan);

  return { col, cardEl, cardRef };
}

function enterOcgCardStripMode(prompt) {
  clearZonePickMode(true);
  const lang = appState.lang;
  const pIdx = prompt.player ?? appState.myPlayerIndex ?? 0;

  if (prompt.promptType === 'SELECT_CARD' || prompt.promptType === 'SELECT_TRIBUTE' || prompt.promptType === 'SELECT_SUM') {
    const cards = prompt.cards || [];
    const isSum = prompt.promptType === 'SELECT_SUM';
    const respType = prompt.promptType === 'SELECT_TRIBUTE' ? 12 : isSum ? 14 : 5;
    const min = isSum ? Math.max((prompt.mustCards?.length ? 0 : 1), Number(prompt.min ?? 1)) : Math.max(1, Number(prompt.min ?? 1));
    const max = isSum ? ((prompt.max && prompt.max > 0) ? prompt.max : cards.length) : Math.max(min, Number(prompt.max ?? min));
    const instantSingle = !isSum && min === 1 && max === 1;
    const selected = new Set();

    const track = document.createElement('div');
    track.className = 'ygopro-strip-track';
    const headerButtons = [];
    let confirmBtn = null;

    const syncStripConfirm = () => {
      if (!confirmBtn) return;
      if (isSum) {
        const evalSum = evaluateOcgSelectSum(prompt, selected);
        confirmBtn.textContent = lang === 'en'
          ? `✓ Confirm (Sum: ${evalSum.sumText || 0}/${prompt.amount || 0})`
          : `✓ ยืนยัน (รวม: ${evalSum.sumText || 0}/${prompt.amount || 0})`;
        confirmBtn.disabled = !evalSum.valid;
      } else {
        confirmBtn.textContent = lang === 'en'
          ? `✓ Confirm (${selected.size}/${min})`
          : `✓ ยืนยัน (${selected.size}/${min})`;
        confirmBtn.disabled = selected.size < min;
      }
    };

    if (!instantSingle) {
      confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'btn btn-primary btn-mini';
      syncStripConfirm();
      confirmBtn.onclick = () => sendOcgPromptResponse({ type: respType, indicies: Array.from(selected) });
      headerButtons.push(confirmBtn);
    }

    if (prompt.canCancel) {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary btn-mini';
      cancelBtn.textContent = lang === 'en' ? '✗ Cancel' : '✗ ยกเลิก';
      cancelBtn.onclick = () => sendOcgPromptResponse({ type: respType, indicies: null });
      headerButtons.push(cancelBtn);
    }

    const rangeTxt = min === max ? `${min}` : `${min}-${max}`;
    const verbTxt = prompt.promptType === 'SELECT_TRIBUTE'
      ? (lang === 'en' ? 'Select Tribute' : 'เลือกการ์ดสังเวย')
      : isSum
        ? (lang === 'en' ? `Select Sum ${prompt.amount}` : `เลือกผลรวม ${prompt.amount}`)
        : (lang === 'en' ? 'Select Card' : 'เลือกการ์ด');

    const title = isSum ? verbTxt : `${verbTxt} (${rangeTxt})`;

    cards.forEach((c, idx) => {
      const choiceIdx = c.index ?? idx;
      const valBadge = isSum && c.value ? `Lv/Val ${Number(c.value) & 0xffff}` : '';
      const { col, cardEl, cardRef } = buildYgoproStripCardNode(c, valBadge, pIdx);
      cardEl.classList.add('card-pick-target');
      cardEl.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!c.isHiddenFaceDown) inspectCard(cardRef);
        if (instantSingle) {
          sendOcgPromptResponse({ type: respType, indicies: [choiceIdx] });
          return;
        }
        if (selected.has(choiceIdx)) {
          selected.delete(choiceIdx);
          cardEl.classList.remove('card-pick-selected');
          cardEl.removeAttribute('data-pick-badge');
        } else if (selected.size < max) {
          selected.add(choiceIdx);
          cardEl.classList.add('card-pick-selected');
          cardEl.setAttribute('data-pick-badge', '✓');
        }
        syncStripConfirm();
      });
      track.appendChild(col);
    });

    return Boolean(openYgoproCardStrip({ mode: 'ocg-strip', title, headerButtons, bodyEl: track }));
  }

  if (prompt.promptType === 'SELECT_UNSELECT_CARD') {
    const track = document.createElement('div');
    track.className = 'ygopro-strip-track';
    const selectCards = prompt.selectCards || [];
    const unselectCards = prompt.unselectCards || [];

    const headerButtons = [];
    if (prompt.canFinish || prompt.canCancel) {
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = prompt.canFinish ? 'btn btn-primary btn-mini' : 'btn btn-secondary btn-mini';
      doneBtn.textContent = prompt.canFinish
        ? (lang === 'en' ? '✓ Finish' : '✓ เสร็จสิ้น')
        : (lang === 'en' ? '✗ Cancel' : '✗ ยกเลิก');
      doneBtn.onclick = () => sendOcgPromptResponse({ type: 7, index: null });
      headerButtons.push(doneBtn);
    }

    selectCards.forEach((c, idx) => {
      const { col, cardEl } = buildYgoproStripCardNode(c, `+ ${c.zone || ''}`, pIdx);
      cardEl.classList.add('card-pick-target');
      cardEl.setAttribute('data-pick-badge', '+');
      cardEl.addEventListener('click', () => sendOcgPromptResponse({ type: 7, index: idx }));
      track.appendChild(col);
    });

    unselectCards.forEach((c, idx) => {
      const choiceIdx = selectCards.length + idx;
      const { col, cardEl } = buildYgoproStripCardNode(c, `✓ ${c.zone || ''}`, pIdx);
      cardEl.classList.add('card-pick-target', 'card-pick-selected');
      cardEl.setAttribute('data-pick-badge', '✓');
      cardEl.addEventListener('click', () => sendOcgPromptResponse({ type: 7, index: choiceIdx }));
      track.appendChild(col);
    });

    return Boolean(openYgoproCardStrip({
      mode: 'ocg-strip',
      title: lang === 'en' ? 'Select / Unselect Card' : 'เลือกการ์ด',
      headerButtons,
      bodyEl: track
    }));
  }

  if (prompt.promptType === 'SORT_CARD' || prompt.promptType === 'SORT_CHAIN') {
    const isChainSort = prompt.promptType === 'SORT_CHAIN';
    const cards = prompt.cards || [];
    const order = [];
    const track = document.createElement('div');
    track.className = 'ygopro-strip-track';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary btn-mini';
    confirmBtn.textContent = lang === 'en' ? `✓ Confirm (0/${cards.length})` : `✓ ยืนยัน (0/${cards.length})`;
    confirmBtn.disabled = cards.length > 0;
    confirmBtn.onclick = () => sendOcgPromptResponse({ type: 15, order });

    const headerButtons = [confirmBtn];
    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = 'btn btn-secondary btn-mini';
    autoBtn.textContent = lang === 'en' ? '⚡ Auto Order' : '⚡ เรียงอัตโนมัติ';
    autoBtn.onclick = () => sendOcgPromptResponse({ type: 15, order: null });
    headerButtons.push(autoBtn);

    cards.forEach((c, idx) => {
      const { col, cardEl } = buildYgoproStripCardNode(c, c.zone || 'DECK', pIdx);
      cardEl.classList.add('card-pick-target');
      cardEl.addEventListener('click', () => {
        const pos = order.indexOf(idx);
        if (pos >= 0) {
          order.splice(pos, 1);
        } else {
          order.push(idx);
        }
        track.querySelectorAll('.duel-card').forEach((el, i) => {
          const rank = order.indexOf(i);
          if (rank >= 0) {
            el.classList.add('card-pick-selected');
            el.setAttribute('data-pick-badge', `#${rank + 1}`);
          } else {
            el.classList.remove('card-pick-selected');
            el.removeAttribute('data-pick-badge');
          }
        });
        confirmBtn.textContent = lang === 'en'
          ? `✓ Confirm (${order.length}/${cards.length})`
          : `✓ ยืนยัน (${order.length}/${cards.length})`;
        confirmBtn.disabled = order.length < cards.length;
      });
      track.appendChild(col);
    });

    return Boolean(openYgoproCardStrip({
      mode: 'ocg-strip',
      title: isChainSort
        ? (lang === 'en' ? 'Order Trigger Chain Links (#1 = CL1)' : 'จัดลำดับเชนเอฟเฟกต์ (#1 = CL1)')
        : (lang === 'en' ? 'Sort Cards in Order (#1 = Top / First)' : 'เรียงลำดับการ์ด (#1 = ใบบนสุด / ใบแรก)'),
      headerButtons,
      bodyEl: track
    }));
  }

  if (prompt.promptType === 'SELECT_COUNTER') {
    const cards = prompt.cards || [];
    const targetCount = Math.max(1, Number(prompt.count || 1));
    const counts = cards.map(() => 0);
    const track = document.createElement('div');
    track.className = 'ygopro-strip-track';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary btn-mini';
    confirmBtn.onclick = () => sendOcgPromptResponse({ type: 13, counters: counts });

    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = 'btn btn-secondary btn-mini';
    autoBtn.textContent = lang === 'en' ? '⚡ Auto Pick' : '⚡ เลือกอัตโนมัติ';
    autoBtn.onclick = () => {
      let rem = targetCount;
      const autoCounts = cards.map((c) => {
        const take = Math.min(rem, c.counterCount || 0);
        rem -= take;
        return take;
      });
      sendOcgPromptResponse({ type: 13, counters: autoCounts });
    };

    const totalPicked = () => counts.reduce((sum, n) => sum + n, 0);
    const syncCounterUi = () => {
      const picked = totalPicked();
      confirmBtn.textContent = lang === 'en'
        ? `✓ Remove Counters (${picked}/${targetCount})`
        : `✓ ยืนยันเคาน์เตอร์ (${picked}/${targetCount})`;
      confirmBtn.disabled = picked !== targetCount;
    };
    syncCounterUi();

    cards.forEach((c, idx) => {
      const maxAvail = c.counterCount || 0;
      const { col, cardEl } = buildYgoproStripCardNode(c, `Cnt: ${maxAvail}`, pIdx);
      const ctrlRow = document.createElement('div');
      ctrlRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:6px;margin-top:4px;';
      const minusBtn = document.createElement('button');
      minusBtn.type = 'button';
      minusBtn.className = 'btn btn-secondary btn-mini';
      minusBtn.textContent = '-';
      const valSpan = document.createElement('span');
      valSpan.style.cssText = 'font-weight:700;min-width:22px;text-align:center;';
      valSpan.textContent = '0';
      const plusBtn = document.createElement('button');
      plusBtn.type = 'button';
      plusBtn.className = 'btn btn-primary btn-mini';
      plusBtn.textContent = '+';

      const refresh = () => {
        valSpan.textContent = String(counts[idx]);
        cardEl.classList.toggle('card-pick-selected', counts[idx] > 0);
        if (counts[idx] > 0) cardEl.setAttribute('data-pick-badge', `-${counts[idx]}`);
        else cardEl.removeAttribute('data-pick-badge');
        syncCounterUi();
      };
      plusBtn.onclick = (ev) => {
        ev.stopPropagation();
        if (totalPicked() < targetCount && counts[idx] < maxAvail) {
          counts[idx]++;
          refresh();
        }
      };
      minusBtn.onclick = (ev) => {
        ev.stopPropagation();
        if (counts[idx] > 0) {
          counts[idx]--;
          refresh();
        }
      };
      cardEl.addEventListener('click', () => plusBtn.click());
      ctrlRow.append(minusBtn, valSpan, plusBtn);
      col.appendChild(ctrlRow);
      track.appendChild(col);
    });

    return Boolean(openYgoproCardStrip({
      mode: 'ocg-strip',
      title: lang === 'en' ? `Remove ${targetCount} Counter(s)` : `เลือกถอดเคาน์เตอร์ ${targetCount} อัน`,
      headerButtons: [confirmBtn, autoBtn],
      bodyEl: track
    }));
  }

  if (prompt.promptType === 'ANNOUNCE_CARD') {
    const bodyWrap = document.createElement('div');
    bodyWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ygopro-strip-search';
    input.placeholder = lang === 'en' ? 'Type card name or passcode to declare...' : 'พิมพ์ชื่อการ์ดหรือรหัสเพื่อประกาศ...';

    const track = document.createElement('div');
    track.className = 'ygopro-strip-track';

    const validPool = Array.isArray(prompt.validCodes) && prompt.validCodes.length > 0
      ? prompt.validCodes.map(code => getCardById(String(code)) || { id: `cdb_${code}`, passcode: String(code), name: `Card #${code}`, kind: 'MONSTER' })
      : null;

    const renderMatches = () => {
      const q = input.value.trim().toLowerCase();
      track.innerHTML = '';
      if (/^\d{5,9}$/.test(q) && (!validPool || prompt.validCodes.includes(Number(q)))) {
        const directBtn = document.createElement('button');
        directBtn.type = 'button';
        directBtn.className = 'btn btn-primary btn-mini';
        directBtn.textContent = `Declare #${q}`;
        directBtn.onclick = () => sendOcgPromptResponse({ type: 18, card: Number(q) });
        track.appendChild(directBtn);
      }
      const sourcePool = validPool || (getAllCards() || []);
      const matches = sourcePool
        .filter(c => c.passcode && /^\d+$/.test(String(c.passcode)) && (!q || (c.name || '').toLowerCase().includes(q) || String(c.passcode).includes(q)))
        .slice(0, 24);
      matches.forEach((c) => {
        const { col, cardEl } = buildYgoproStripCardNode(c, `#${c.passcode}`, pIdx);
        cardEl.classList.add('card-pick-target');
        cardEl.addEventListener('click', () => sendOcgPromptResponse({ type: 18, card: Number(c.passcode) }));
        track.appendChild(col);
      });
    };
    input.addEventListener('input', renderMatches);
    renderMatches();
    bodyWrap.append(input, track);

    const opened = openYgoproCardStrip({
      mode: 'ocg-strip',
      title: lang === 'en' ? 'Declare Card Name' : 'ประกาศชื่อการ์ด',
      headerButtons: [],
      bodyEl: bodyWrap
    });
    setTimeout(() => input.focus(), 0);
    return Boolean(opened);
  }

  return false;
}

function enterOcgAnnounceBanner(prompt) {
  const lang = appState.lang;
  if (prompt.promptType === 'ROCK_PAPER_SCISSORS') {
    const rpsChoices = [
      { value: 1, label: lang === 'en' ? '✌️ Scissors' : '✌️ กรรไกร' },
      { value: 2, label: lang === 'en' ? '✊ Rock' : '✊ ค้อน' },
      { value: 3, label: lang === 'en' ? '🖐️ Paper' : '🖐️ กระดาษ' }
    ];
    const btns = rpsChoices.map((ch) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inline-prompt-btn primary';
      btn.textContent = ch.label;
      btn.onclick = () => sendOcgPromptResponse({ type: 20, value: ch.value });
      return btn;
    });
    return Boolean(openInlinePickBanner({
      icon: '✊',
      message: lang === 'en' ? 'Rock-Paper-Scissors:' : 'เป่ายิงฉุบ:',
      actionButtons: btns,
      mandatory: true,
      mode: 'ocg-rps'
    }));
  }
  if (prompt.promptType === 'ANNOUNCE_NUMBER') {
    const vals = prompt.values || [];
    if (vals.length === 0) return false;
    const btns = vals.map((v) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inline-prompt-btn primary';
      btn.textContent = String(v);
      btn.onclick = () => sendOcgPromptResponse({ type: 19, value: v });
      return btn;
    });
    return Boolean(openInlinePickBanner({
      icon: '🔢',
      message: lang === 'en' ? 'Declare a number:' : 'ประกาศตัวเลข:',
      actionButtons: btns,
      mandatory: true,
      mode: 'ocg-announce-num'
    }));
  }

  const isRace = prompt.promptType === 'ANNOUNCE_RACE';
  const reqCount = Math.max(1, Number(prompt.count || 1));
  const avail = Number(prompt.available || 0);
  const items = isRace
    ? [
        [0x1, 'Warrior'], [0x2, 'Spellcaster'], [0x4, 'Fairy'], [0x8, 'Fiend'],
        [0x10, 'Zombie'], [0x20, 'Machine'], [0x40, 'Aqua'], [0x80, 'Pyro'],
        [0x100, 'Rock'], [0x200, 'Winged Beast'], [0x400, 'Plant'], [0x800, 'Insect'],
        [0x1000, 'Thunder'], [0x2000, 'Dragon'], [0x4000, 'Beast'], [0x8000, 'Beast-Warrior'],
        [0x10000, 'Dinosaur'], [0x20000, 'Fish'], [0x40000, 'Sea Serpent'], [0x80000, 'Reptile'],
        [0x100000, 'Psychic'], [0x200000, 'Divine-Beast'], [0x800000, 'Wyrm'],
        [0x1000000, 'Cyberse'], [0x2000000, 'Illusion']
      ]
    : [
        [0x01, 'EARTH'], [0x02, 'WATER'], [0x04, 'FIRE'], [0x08, 'WIND'],
        [0x10, 'LIGHT'], [0x20, 'DARK'], [0x40, 'DIVINE']
      ];

  const filtered = items.filter(([bit]) => !avail || (avail & bit) !== 0);
  if (filtered.length === 0) return false;

  const chosen = [];
  const respType = isRace ? 16 : 17;
  const payloadKey = isRace ? 'races' : 'attributes';
  let confirmBtn = null;
  if (reqCount > 1) {
    confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary btn-mini';
    confirmBtn.textContent = lang === 'en' ? `Confirm (0/${reqCount})` : `ยืนยัน (0/${reqCount})`;
    confirmBtn.disabled = true;
    confirmBtn.onclick = () => sendOcgPromptResponse({ type: respType, [payloadKey]: [...chosen] });
  }

  const btns = filtered.map(([bit, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inline-prompt-btn';
    btn.textContent = label;
    btn.onclick = () => {
      if (reqCount === 1) {
        sendOcgPromptResponse({ type: respType, [payloadKey]: [bit] });
        return;
      }
      const existing = chosen.indexOf(bit);
      if (existing >= 0) {
        chosen.splice(existing, 1);
        btn.classList.remove('selected');
      } else if (chosen.length < reqCount) {
        chosen.push(bit);
        btn.classList.add('selected');
      }
      if (confirmBtn) {
        confirmBtn.textContent = lang === 'en' ? `Confirm (${chosen.length}/${reqCount})` : `ยืนยัน (${chosen.length}/${reqCount})`;
        confirmBtn.disabled = chosen.length < reqCount;
      }
    };
    return btn;
  });

  return Boolean(openInlinePickBanner({
    icon: isRace ? '🧬' : '✨',
    message: lang === 'en'
      ? `Declare ${isRace ? 'Type' : 'Attribute'}${reqCount > 1 ? ` (${reqCount})` : ''}:`
      : `ประกาศ${isRace ? 'เผ่า' : 'ธาตุ'}${reqCount > 1 ? ` (${reqCount})` : ''}:`,
    headerButtons: confirmBtn ? [confirmBtn] : [],
    actionButtons: btns,
    mandatory: true,
    mode: isRace ? 'ocg-announce-race' : 'ocg-announce-attr'
  }));
}

function resolvePromptCardDomEl(c) {
  if (!c || typeof c.location !== 'number' || typeof c.sequence !== 'number') return null;
  if ((c.location & 128) !== 0) return null; // Overlay materials are hidden inside card OVL badge
  const isSelfHand = c.location === 2 && c.controller === appState.myPlayerIndex;
  const isOnField = c.location === 4 || c.location === 8;
  if (!isSelfHand && !isOnField) return null;
  const id = `ocg_p${c.controller}_loc${c.location}_seq${c.sequence}`;
  return document.querySelector(`.duel-card[data-instance-id="${id}"]`);
}

function enterOcgCardPickMode(prompt) {
  const lang = appState.lang;
  const seenEls = new Set();
  const resolveUniqueEntries = (list, startChoiceIdx = 0) => {
    const entries = [];
    for (let i = 0; i < (list || []).length; i++) {
      const card = list[i];
      const el = resolvePromptCardDomEl(card);
      if (!el || seenEls.has(el)) return null;
      seenEls.add(el);
      entries.push({ card, el, choiceIndex: card.index ?? (startChoiceIdx + i) });
    }
    return entries;
  };

  if (prompt.promptType === 'SELECT_UNSELECT_CARD') {
    const selectEntries = resolveUniqueEntries(prompt.selectCards || [], 0);
    if (!selectEntries) return false;
    const unselectEntries = resolveUniqueEntries(prompt.unselectCards || [], selectEntries.length);
    if (!unselectEntries) return false;
    if (selectEntries.length === 0 && unselectEntries.length === 0) return false;

    const headerButtons = [];
    if (prompt.canFinish || prompt.canCancel) {
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = prompt.canFinish ? 'btn btn-primary btn-mini' : 'btn btn-secondary btn-mini';
      doneBtn.textContent = prompt.canFinish
        ? (lang === 'en' ? '✓ Finish' : '✓ เสร็จสิ้น')
        : (lang === 'en' ? '✗ Cancel' : '✗ ยกเลิก');
      doneBtn.onclick = () => sendOcgPromptResponse({ type: 7, index: null });
      headerButtons.push(doneBtn);
    }

    openInlinePickBanner({
      icon: '👆',
      message: lang === 'en'
        ? 'Click a highlighted card on the field/hand directly:'
        : 'คลิกเลือกการ์ดที่ไฮไลต์บนสนามหรือบนมือได้เลย:',
      headerButtons,
      mandatory: true,
      mode: 'ocg-unselect-card'
    });

    const listeners = [];
    const bindEntry = (entry, isSelected) => {
      entry.el.classList.add('card-pick-target');
      if (isSelected) entry.el.classList.add('card-pick-selected');
      entry.el.setAttribute('data-pick-badge', isSelected ? '✓' : '+');
      const onPick = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        sendOcgPromptResponse({ type: 7, index: entry.choiceIndex });
      };
      entry.el.addEventListener('click', onPick, true);
      listeners.push({ el: entry.el, onPick });
    };

    selectEntries.forEach(e => bindEntry(e, false));
    unselectEntries.forEach(e => bindEntry(e, true));

    activeZonePickCleanup = () => {
      for (const { el, onPick } of listeners) {
        el.classList.remove('card-pick-target', 'card-pick-selected');
        el.removeAttribute('data-pick-badge');
        el.removeEventListener('click', onPick, true);
      }
    };
    return true;
  }

  // SELECT_CARD | SELECT_TRIBUTE | SELECT_SUM
  const cards = prompt.cards || [];
  if (cards.length === 0) return false;

  const mustEntries = resolveUniqueEntries(prompt.mustCards || [], 0);
  if (!mustEntries) return false;
  const candidateEntries = resolveUniqueEntries(cards, 0);
  if (!candidateEntries) return false;

  const isSum = prompt.promptType === 'SELECT_SUM';
  const respType = prompt.promptType === 'SELECT_TRIBUTE' ? 12 : isSum ? 14 : 5;
  const min = isSum ? Math.max((prompt.mustCards?.length ? 0 : 1), Number(prompt.min ?? 1)) : Math.max(1, Number(prompt.min ?? 1));
  const max = isSum ? ((prompt.max && prompt.max > 0) ? prompt.max : cards.length) : Math.max(min, Number(prompt.max ?? min));
  const instantSingle = !isSum && min === 1 && max === 1;
  const selected = new Set();

  let confirmBtn = null;
  const headerButtons = [];
  if (!instantSingle) {
    confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary btn-mini';
    confirmBtn.disabled = true;
    confirmBtn.onclick = () => sendOcgPromptResponse({ type: respType, indicies: Array.from(selected) });
    headerButtons.push(confirmBtn);
  }
  if (prompt.canCancel) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary btn-mini';
    cancelBtn.textContent = lang === 'en' ? '✗ Cancel' : '✗ ยกเลิก';
    cancelBtn.onclick = () => sendOcgPromptResponse({ type: respType, indicies: null });
    headerButtons.push(cancelBtn);
  }

  const rangeLabel = min === max ? `${min}` : `${min}-${max}`;
  const kindLabel = prompt.promptType === 'SELECT_TRIBUTE'
    ? (lang === 'en' ? 'to Tribute' : 'เพื่อสังเวย')
    : isSum
      ? (lang === 'en' ? `(target sum ${prompt.amount})` : `(ผลรวม ${prompt.amount})`)
      : '';

  const ui = openInlinePickBanner({
    icon: '🎯',
    message: '',
    headerButtons,
    mandatory: true,
    mode: 'ocg-card-pick'
  });

  const updateStatus = () => {
    if (isSum) {
      const evalSum = evaluateOcgSelectSum(prompt, selected);
      if (ui?.msgEl) {
        ui.msgEl.textContent = lang === 'en'
          ? `Select highlighted card(s) ${kindLabel} — Sum: ${evalSum.sumText || 0} / ${prompt.amount}`
          : `คลิกเลือกการ์ดที่ไฮไลต์ ${kindLabel} — ผลรวม: ${evalSum.sumText || 0} / ${prompt.amount}`;
      }
      if (confirmBtn) {
        confirmBtn.textContent = lang === 'en'
          ? `✓ Confirm (${evalSum.sumText || 0}/${prompt.amount})`
          : `✓ ยืนยัน (${evalSum.sumText || 0}/${prompt.amount})`;
        confirmBtn.disabled = !evalSum.valid;
      }
      return;
    }
    if (ui?.msgEl) {
      ui.msgEl.textContent = instantSingle
        ? (lang === 'en'
            ? `Click 1 highlighted card on field/hand ${kindLabel}`
            : `คลิกเลือกการ์ด 1 ใบที่ไฮไลต์บนสนาม/มือ ${kindLabel}`)
        : (lang === 'en'
            ? `Select ${rangeLabel} highlighted card(s) on field/hand ${kindLabel} (${selected.size}/${min})`
            : `คลิกเลือกการ์ดที่ไฮไลต์ ${rangeLabel} ใบ ${kindLabel} (${selected.size}/${min})`);
    }
    if (confirmBtn) {
      confirmBtn.textContent = lang === 'en' ? `✓ Confirm (${selected.size}/${min})` : `✓ ยืนยัน (${selected.size}/${min})`;
      confirmBtn.disabled = selected.size < min;
    }
  };
  updateStatus();

  const lockedEls = [];
  for (const m of mustEntries) {
    m.el.classList.add('card-pick-locked');
    m.el.setAttribute('data-pick-badge', '🔒');
    lockedEls.push(m.el);
  }

  const listeners = [];
  for (const entry of candidateEntries) {
    entry.el.classList.add('card-pick-target');
    entry.el.setAttribute('data-pick-badge', '👆');
    const onPick = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      if (!entry.card.isHiddenFaceDown) {
        const ref = getCardById(String(entry.card.passcode || entry.card.code));
        if (ref) inspectCard(ref);
      }
      if (instantSingle) {
        sendOcgPromptResponse({ type: respType, indicies: [entry.choiceIndex] });
        return;
      }
      if (selected.has(entry.choiceIndex)) {
        selected.delete(entry.choiceIndex);
        entry.el.classList.remove('card-pick-selected');
        entry.el.setAttribute('data-pick-badge', '👆');
      } else if (selected.size < max) {
        selected.add(entry.choiceIndex);
        entry.el.classList.add('card-pick-selected');
        entry.el.setAttribute('data-pick-badge', '✓');
      }
      updateStatus();
    };
    entry.el.addEventListener('click', onPick, true);
    listeners.push({ el: entry.el, onPick });
  }

  activeZonePickCleanup = () => {
    for (const el of lockedEls) {
      el.classList.remove('card-pick-locked');
      el.removeAttribute('data-pick-badge');
    }
    for (const { el, onPick } of listeners) {
      el.classList.remove('card-pick-target', 'card-pick-selected');
      el.removeAttribute('data-pick-badge');
      el.removeEventListener('click', onPick, true);
    }
  };
  return true;
}

function enterOcgFieldPlaceMode(prompt) {
  const pIdx = prompt.player ?? 0;
  const oppIdx = 1 - pIdx;
  const mask = prompt.fieldMask || 0;
  const respType = prompt.promptType === 'SELECT_DISFIELD' ? 9 : 10;
  const reqCount = Math.max(1, Number(prompt.count || 1));
  const lang = appState.lang;

  const resolveSlotEl = (selector) => document.querySelector(selector);
  const candidates = [];
  const pushIfOpen = (bit, el, player, location, sequence, owner, label) => {
    if (((mask >>> bit) & 1) === 0 && el) {
      candidates.push({ el, player, location, sequence, owner, label });
    }
  };

  for (let seq = 0; seq < 5; seq++) {
    pushIfOpen(seq, resolveSlotEl(`#self-mmz-grid .zone-slot[data-zone-index="${seq}"]`), pIdx, 4, seq, 'self', `Monster ${seq + 1}`);
  }
  pushIfOpen(5, document.getElementById('self-emz-slot'), pIdx, 4, 5, 'self', 'EMZ 1');
  pushIfOpen(6, document.getElementById('opp-emz-slot'), pIdx, 4, 6, 'self', 'EMZ 2');
  for (let seq = 0; seq < 5; seq++) {
    pushIfOpen(8 + seq, resolveSlotEl(`#self-stz-grid .zone-slot[data-zone-index="${seq}"]`), pIdx, 8, seq, 'self', `S/T ${seq + 1}`);
  }
  pushIfOpen(13, document.getElementById('self-field-spell-slot'), pIdx, 8, 5, 'self', 'Field Zone');
  for (let seq = 0; seq < 5; seq++) {
    pushIfOpen(16 + seq, resolveSlotEl(`#opp-mmz-grid .zone-slot[data-zone-index="${seq}"]`), oppIdx, 4, seq, 'opp', `Opp Monster ${seq + 1}`);
  }
  pushIfOpen(21, document.getElementById('opp-emz-slot'), oppIdx, 4, 5, 'opp', 'Opp EMZ 1');
  pushIfOpen(22, document.getElementById('self-emz-slot'), oppIdx, 4, 6, 'opp', 'Opp EMZ 2');
  for (let seq = 0; seq < 5; seq++) {
    pushIfOpen(24 + seq, resolveSlotEl(`#opp-stz-grid .zone-slot[data-zone-index="${seq}"]`), oppIdx, 8, seq, 'opp', `Opp S/T ${seq + 1}`);
  }
  pushIfOpen(29, document.getElementById('opp-field-spell-slot'), oppIdx, 8, 5, 'opp', 'Opp Field Zone');

  if (candidates.length === 0) {
    return false;
  }

  // Close popup dialog cleanly so user clicks directly on the live duel field!
  const dlg = document.getElementById('dialog-zone-browser');
  if (dlg?.open) {
    dlg.dataset.ocgPrompt = '';
    dlg.close();
  }

  clearZonePickMode(true);
  collapseHandDock();
  document.body.classList.add('is-zone-picking');
  activeZonePickMandatory = true;

  const onlyOpp = candidates.every(c => c.owner === 'opp');
  const cardLabel = prompt.cardName ? ` (${prompt.cardName})` : '';
  const banner = document.getElementById('field-pick-banner');
  const picked = [];
  let confirmBtn = null;

  const updateBannerText = () => {
    if (!banner) return;
    const msgEl = banner.querySelector('.field-pick-msg');
    if (msgEl) {
      if (reqCount > 1) {
        msgEl.textContent = lang === 'en'
          ? `Select ${reqCount} highlighted zone(s) on the field${cardLabel} (${picked.length}/${reqCount})`
          : `คลิกเลือก ${reqCount} ช่องบนสนามที่ไฮไลต์${cardLabel} (${picked.length}/${reqCount})`;
      } else if (prompt.promptType === 'SELECT_DISFIELD') {
        msgEl.textContent = lang === 'en'
          ? `Click a highlighted zone on the field to select/lock${cardLabel}`
          : `คลิกเลือกช่องบนสนามที่ไฮไลต์${cardLabel}`;
      } else if (onlyOpp) {
        msgEl.textContent = lang === 'en'
          ? `Click an Opponent zone on the field to place${cardLabel}`
          : `คลิกเลือกช่องฝั่งคู่ต่อสู้บนสนาม${cardLabel}`;
      } else {
        msgEl.textContent = lang === 'en'
          ? `Click a highlighted zone on the field to place/summon${cardLabel}`
          : `คลิกเลือกช่องบนสนามเพื่อวาง/อัญเชิญการ์ด${cardLabel}`;
      }
    }
    if (confirmBtn) {
      confirmBtn.textContent = lang === 'en' ? `Confirm (${picked.length}/${reqCount})` : `ยืนยัน (${picked.length}/${reqCount})`;
      confirmBtn.disabled = picked.length < reqCount;
    }
  };

  if (banner) {
    banner.dataset.mode = 'zone-pick';
    banner.classList.remove('is-peeking');
    banner.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'chain-bar-header chain-bar-header-compact';
    const spark = document.createElement('span');
    spark.className = 'chain-spark';
    spark.innerHTML = iconSvg('target');
    const msgEl = document.createElement('div');
    msgEl.className = 'chain-trigger-desc field-pick-msg';
    const peekBtn = createFieldPeekButton(banner);
    head.append(spark, msgEl, peekBtn);
    if (reqCount > 1) {
      confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'btn btn-primary btn-mini';
      confirmBtn.onclick = () => {
        if (picked.length < reqCount) return;
        const result = [...picked];
        clearZonePickMode(true);
        sendOcgPromptResponse({ type: respType, places: result });
      };
      head.appendChild(confirmBtn);
    }
    banner.appendChild(head);
    banner.classList.remove('hidden');
    updateBannerText();
  }

  const isCompact = isCompactDuelViewport();
  const listeners = [];
  for (const item of candidates) {
    item.el.classList.add('drop-zone-legal', 'zone-pick-target');
    if (item.owner === 'opp') item.el.classList.add('zone-pick-opp');
    if (!isCompact) {
      item.el.setAttribute('data-drop-hint', lang === 'en' ? 'Place' : 'วาง');
    } else {
      item.el.removeAttribute('data-drop-hint');
    }

    let pinEl = null;
    if (!item.el.querySelector('.zone-pick-pin')) {
      pinEl = document.createElement('span');
      pinEl.className = 'zone-pick-pin';
      pinEl.setAttribute('aria-hidden', 'true');
      pinEl.innerHTML = iconSvg('target');
      item.el.appendChild(pinEl);
    }

    const onPick = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      if (reqCount === 1) {
        clearZonePickMode(true);
        sendOcgPromptResponse({
          type: respType,
          places: [{ player: item.player, location: item.location, sequence: item.sequence }]
        });
        return;
      }
      const existing = picked.findIndex(
        p => p.player === item.player && p.location === item.location && p.sequence === item.sequence
      );
      if (existing >= 0) {
        picked.splice(existing, 1);
        item.el.classList.remove('zone-pick-selected');
      } else if (picked.length < reqCount) {
        picked.push({ player: item.player, location: item.location, sequence: item.sequence });
        item.el.classList.add('zone-pick-selected');
      }
      updateBannerText();
    };
    item.el.addEventListener('click', onPick, true);
    listeners.push({ el: item.el, onPick, pinEl });
  }

  activeZonePickCleanup = () => {
    for (const { el, onPick, pinEl } of listeners) {
      el.classList.remove('drop-zone-legal', 'zone-pick-target', 'zone-pick-opp', 'zone-pick-selected');
      el.removeAttribute('data-drop-hint');
      el.removeEventListener('click', onPick, true);
      pinEl?.remove();
    }
  };
  return true;
}

function enterZonePickMode(card, actionPayload) {
  clearZonePickMode(true);
  document.getElementById('card-action-popup')?.classList.add('hidden');
  collapseHandDock();
  document.body.classList.add('is-zone-picking');

  const cardSubtype = card.subType || card.subtype;
  if (cardSubtype === 'FIELD' && (actionPayload.type === 'ACTIVATE_EFFECT' || actionPayload.type === 'SET_SPELL_TRAP')) {
    dispatchDuelAction({ ...actionPayload, targetZoneIndex: 0, targetZoneType: 'FIELD_SPELL' });
    return;
  }

  const isPendulumScale = Boolean(actionPayload.isPendulumScale || actionPayload.type === 'ACTIVATE_PENDULUM');
  const isMonsterGrid =
    actionPayload.type === 'NORMAL_SUMMON' ||
    actionPayload.type === 'NORMAL_SET' ||
    actionPayload.type === 'SET_MONSTER' ||
    actionPayload.type === 'INHERENT_SPECIAL_SUMMON' ||
    actionPayload.type === 'SPECIAL_SUMMON';

  const isStzGrid =
    isPendulumScale ||
    actionPayload.type === 'SET_SPELL_TRAP' ||
    (actionPayload.type === 'ACTIVATE_EFFECT' &&
      card.zone === 'HAND' &&
      card.kind !== 'MONSTER' &&
      cardSubtype !== 'FIELD');

  if (!isMonsterGrid && !isStzGrid) {
    dispatchDuelAction(actionPayload);
    return;
  }

  const gridSelector = isMonsterGrid ? '#self-mmz-grid .zone-slot' : '#self-stz-grid .zone-slot';
  let emptySlots = Array.from(document.querySelectorAll(gridSelector)).filter(
    slot => !slot.querySelector('.duel-card')
  );
  if (isPendulumScale) {
    emptySlots = emptySlots.filter((slot) => {
      const idx = Number(slot.getAttribute('data-zone-index'));
      return idx === 0 || idx === 4;
    });
  }

  // If 0 or 1 empty slot, execute directly without extra click
  if (emptySlots.length <= 1) {
    const onlyIdx = emptySlots[0] ? Number(emptySlots[0].getAttribute('data-zone-index')) : undefined;
    dispatchDuelAction({ ...actionPayload, targetZoneIndex: onlyIdx, targetZoneType: isStzGrid ? 'STZ' : 'MMZ' });
    return;
  }

  const lang = appState.lang;
  const isCompact = isCompactDuelViewport();
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary btn-mini';
  cancelBtn.innerHTML = `${iconSvg('close')}<span class="btn-label">${escapeHtml(t(lang, 'cancelBtn'))}</span>`;
  cancelBtn.onclick = (ev) => {
    ev.stopPropagation();
    clearZonePickMode(true);
  };

  openInlinePickBanner({
    icon: 'target',
    message: lang === 'en'
      ? `${isCompact ? 'Tap' : 'Click'} a glowing zone for "${card.name}"`
      : `${isCompact ? 'แตะ' : 'คลิก'}เลือกช่องที่เรืองแสงสำหรับ "${card.nameTh}"`,
    headerButtons: [cancelBtn],
    mandatory: false,
    mode: 'zone-pick'
  });

  const listeners = [];
  for (const slot of emptySlots) {
    slot.classList.add('drop-zone-legal', 'zone-pick-target');
    if (!isCompact) {
      slot.setAttribute('data-drop-hint', lang === 'en' ? 'Place' : 'วาง');
    } else {
      slot.removeAttribute('data-drop-hint');
    }
    const pinEl = document.createElement('span');
    pinEl.className = 'zone-pick-pin';
    pinEl.setAttribute('aria-hidden', 'true');
    pinEl.innerHTML = iconSvg('target');
    slot.appendChild(pinEl);

    const onPick = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const idx = Number(slot.getAttribute('data-zone-index'));
      clearZonePickMode(true);
      dispatchDuelAction({ ...actionPayload, targetZoneIndex: idx, targetZoneType: isStzGrid ? 'STZ' : 'MMZ' });
    };
    slot.addEventListener('click', onPick, true);
    listeners.push({ slot, onPick, pinEl });
  }

  const onEsc = (ev) => {
    if (ev.key === 'Escape') clearZonePickMode(true);
  };
  const onDocClick = (ev) => {
    if (!ev.target.closest('.zone-pick-target, #field-pick-banner')) {
      clearZonePickMode(true);
    }
  };

  document.addEventListener('keydown', onEsc);
  const docClickTimer = setTimeout(() => document.addEventListener('click', onDocClick), 0);

  activeZonePickCleanup = () => {
    clearTimeout(docClickTimer);
    for (const { slot, onPick, pinEl } of listeners) {
      slot.classList.remove('drop-zone-legal', 'zone-pick-target');
      slot.removeAttribute('data-drop-hint');
      slot.removeEventListener('click', onPick, true);
      pinEl.remove();
    }
    document.removeEventListener('keydown', onEsc);
    document.removeEventListener('click', onDocClick);
  };
}

function executeCardAction(card, act) {
  if (!act) return;
  clearSelectedHandCard();
  if (act.type === 'DECLARE_ATTACK') {
    clearZonePickMode(true);
    dispatchDuelAction({
      type: 'DECLARE_ATTACK',
      attackerInstanceId: act.attackerInstanceId,
      targetInstanceId: act.targetInstanceId,
      directAttack: act.directAttack
    });
    return;
  }
  const basePayload = {
    type: act.type,
    instanceId: card.instanceId,
    effectId: act.effectId,
    position: act.position,
    targetZoneIndex: act.targetZoneIndex,
    targetZoneType: act.targetZoneType,
    isPendulumScale: act.isPendulumScale,
    ocgAction: act.ocgAction,
    ocgIndex: act.ocgIndex
  };
  if (basePayload.targetZoneIndex === undefined && card.zone === 'HAND') {
    enterZonePickMode(card, basePayload);
  } else {
    clearZonePickMode(true);
    dispatchDuelAction(basePayload);
  }
}

function showActionPopupForCard(card, actionItems, anchorEl, opts = {}) {
  if (!actionItems || actionItems.length === 0) return;
  document.getElementById('card-action-popup')?.classList.add('hidden');

  const { allowSingleActionMenu = false } = opts;
  if (actionItems.length === 1 && !allowSingleActionMenu) {
    executeCardAction(card, actionItems[0]);
    return;
  }

  suppressPopupHideUntil = Date.now() + 260;
  const lang = appState.lang;
  const cardTitle = lang === 'en' ? (card.name || card.nameTh) : (card.nameTh || card.name);

  const inspectBtn = document.createElement('button');
  inspectBtn.type = 'button';
  inspectBtn.className = 'btn-mini chain-option-inspect-btn';
  inspectBtn.innerHTML = iconSvg('inspect');
  inspectBtn.title = lang === 'en' ? 'View Card Info' : 'ดูรายละเอียดการ์ด';
  inspectBtn.setAttribute('aria-label', inspectBtn.title);
  inspectBtn.onclick = (ev) => {
    ev.stopPropagation();
    inspectCardAndFocus(card, { openMobilePreview: true });
  };

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-secondary btn-mini card-actions-close-btn';
  closeBtn.innerHTML = iconSvg('close');
  closeBtn.title = t(lang, 'closeBtn');
  closeBtn.setAttribute('aria-label', closeBtn.title);
  closeBtn.onclick = (ev) => {
    ev.stopPropagation();
    clearZonePickMode(true);
  };

  const getActionVisualMeta = (act) => {
    const typeStr = String(act?.type || '');
    if (typeStr === 'ACTIVATE_EFFECT' || typeStr === 'ACTIVATE_SPELL' || typeStr === 'ACTIVATE_TRAP') {
      return { kind: 'activate', icon: 'activate' };
    }
    if (typeStr === 'NORMAL_SUMMON' || typeStr === 'SPECIAL_SUMMON' || typeStr === 'INHERENT_SPECIAL_SUMMON') {
      return { kind: 'summon', icon: 'summon' };
    }
    if (typeStr === 'NORMAL_SET' || typeStr === 'SET_MONSTER' || typeStr === 'SET_SPELL_TRAP') {
      return { kind: 'set', icon: 'set' };
    }
    if (typeStr === 'DECLARE_ATTACK') {
      return { kind: 'attack', icon: 'battle' };
    }
    if (typeStr === 'CHANGE_POSITION') {
      return { kind: 'position', icon: 'position' };
    }
    return { kind: 'default', icon: 'summon' };
  };

  const btns = actionItems.map((act) => {
    const btn = document.createElement('button');
    const { kind, icon } = getActionVisualMeta(act);
    btn.type = 'button';
    btn.className = `inline-prompt-btn action-${kind}`;
    btn.setAttribute('data-action-kind', kind);
    const rawLabel = (lang === 'en' ? (act.label || act.labelTh) : (act.labelTh || act.label)) || '';
    const cleanLabel = stripLeadingEmoji(rawLabel) || getShortYgoProCmdLabel(act, lang, actionItems);
    btn.innerHTML = `${iconSvg(icon)}<span>${escapeHtml(cleanLabel)}</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelector('.player-bottom-dock')?.classList.remove('hand-expanded');
      executeCardAction(card, act);
    });
    return btn;
  });

  openInlinePickBanner({
    icon: 'cards',
    message: cardTitle,
    headerButtons: [inspectBtn, closeBtn],
    actionButtons: btns,
    mandatory: false,
    mode: 'card-actions',
    showPeekBtn: false,
    dismissOnOutside: true,
    dismissOnEsc: true
  });

  if (anchorEl?.classList?.contains('duel-card')) {
    anchorEl.classList.add('is-selected');
  }
}

function hideActionPopup(force = false) {
  if (!force && Date.now() < suppressPopupHideUntil) return;
  document.getElementById('card-action-popup')?.classList.add('hidden');
  const banner = document.getElementById('field-pick-banner');
  if (banner?.dataset.mode === 'card-actions') {
    clearZonePickMode(true);
  } else {
    clearSelectedHandCard();
  }
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const logCardMatcherCache = {
  knownCount: -1,
  registryCount: -1,
  nameMap: new Map(),
  regex: null
};

function getLogCardNameMatcher() {
  const allCards = getAllCards();
  const knownSize = appState.knownCardsByName.size;
  if (
    logCardMatcherCache.knownCount === knownSize &&
    logCardMatcherCache.registryCount === allCards.length &&
    logCardMatcherCache.regex !== undefined
  ) {
    return logCardMatcherCache;
  }

  const nameMap = new Map();
  const addName = (rawName, card) => {
    const clean = String(rawName || '').trim();
    if (clean.length < 3) return;
    const key = clean.toLowerCase();
    if (/^card #\d+$/.test(key) || key === 'face-down card' || key === 'deck card') return;
    if (!nameMap.has(key)) {
      nameMap.set(key, { name: clean, card });
    }
  };

  // Prefer cards actually seen in this duel first (richer live/cdb metadata)
  for (const [key, card] of appState.knownCardsByName.entries()) {
    if (card?.name) addName(card.name, card);
    if (card?.nameTh) addName(card.nameTh, card);
    if (!nameMap.has(key) && key.length >= 3) {
      nameMap.set(key, { name: key, card });
    }
  }
  for (const card of allCards) {
    if (card?.name) addName(card.name, card);
    if (card?.nameTh) addName(card.nameTh, card);
  }

  const sortedNames = Array.from(nameMap.values())
    .map(v => v.name)
    .sort((a, b) => b.length - a.length);

  let regex = null;
  if (sortedNames.length > 0) {
    try {
      regex = new RegExp(sortedNames.map(escapeRegExp).join('|'), 'gi');
    } catch {
      regex = null;
    }
  }

  logCardMatcherCache.knownCount = knownSize;
  logCardMatcherCache.registryCount = allCards.length;
  logCardMatcherCache.nameMap = nameMap;
  logCardMatcherCache.regex = regex;
  return logCardMatcherCache;
}

function isWordBoundarySafe(text, startIdx, endIdx) {
  const firstChar = text[startIdx] || '';
  const lastChar = text[endIdx - 1] || '';
  const beforeChar = startIdx > 0 ? text[startIdx - 1] : '';
  const afterChar = endIdx < text.length ? text[endIdx] : '';
  const isAsciiWord = (ch) => /[A-Za-z0-9]/.test(ch);
  if (isAsciiWord(firstChar) && isAsciiWord(beforeChar)) return false;
  if (isAsciiWord(lastChar) && isAsciiWord(afterChar)) return false;
  return true;
}

function appendLinkedLogText(container, text, itemCardDef, extraRefs = []) {
  const rawText = String(text || '');
  if (!rawText) return;

  // Register any newly seen card refs so getLogCardNameMatcher() compiles once per registry size change
  if (itemCardDef) registerKnownCard(itemCardDef);
  for (const ref of extraRefs) {
    if (ref) registerKnownCard(ref);
  }

  const matcher = getLogCardNameMatcher();
  const entryLookup = new Map();
  const registerEntryRef = (c) => {
    if (!c) return;
    for (const nm of [c.name, c.nameTh]) {
      const clean = String(nm || '').trim();
      if (clean.length < 3) continue;
      const key = clean.toLowerCase();
      if (!entryLookup.has(key)) {
        entryLookup.set(key, c);
      }
    }
  };
  registerEntryRef(itemCardDef);
  for (const ref of extraRefs) registerEntryRef(ref);

  // Never recompile the full alternation regex per log item — always reuse cached matcher.regex
  const activeRegex = matcher.regex;
  if (!activeRegex) {
    container.appendChild(document.createTextNode(` ${rawText}`));
    return;
  }

  container.appendChild(document.createTextNode(' '));
  activeRegex.lastIndex = 0;
  let lastIndex = 0;
  let match;
  while ((match = activeRegex.exec(rawText)) !== null) {
    const matchedStr = match[0];
    const startIdx = match.index;
    const endIdx = startIdx + matchedStr.length;
    if (!isWordBoundarySafe(rawText, startIdx, endIdx)) {
      continue;
    }
    const key = matchedStr.toLowerCase();
    const cardRef = entryLookup.get(key) || matcher.nameMap.get(key)?.card || null;
    if (!cardRef) continue;

    if (startIdx > lastIndex) {
      container.appendChild(document.createTextNode(rawText.slice(lastIndex, startIdx)));
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'log-card-link';
    btn.textContent = matchedStr;
    btn.title = appState.lang === 'en' ? `View ${matchedStr}` : `ดูข้อมูลการ์ด ${matchedStr}`;
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      inspectCardAndFocus(cardRef, { openMobilePreview: true });
    });
    container.appendChild(btn);
    lastIndex = endIdx;
  }

  if (lastIndex < rawText.length) {
    container.appendChild(document.createTextNode(rawText.slice(lastIndex)));
  }
}

function getDuelLogItemSig(item, idx) {
  if (!item) return `${idx}:_`;
  return `${idx}:${item.id ?? ''}:${item.turn ?? ''}:${item.phase ?? ''}:${item.text ?? ''}`;
}

function buildDuelLogEntryNode(item) {
  const rawCard =
    item.card ||
    item.cardSnapshot ||
    (item.cardId && getCardById(item.cardId)) ||
    (item.cardCode && resolveFullCardMeta({ code: item.cardCode })) ||
    (item.meta || null);
  const cardDef = rawCard ? resolveFullCardMeta(rawCard, appState.currentState) : null;
  const extraRefs = Array.isArray(item.cardRefs)
    ? item.cardRefs.map(r => resolveFullCardMeta(r, appState.currentState)).filter(Boolean)
    : [];

  const div = document.createElement('div');
  div.className = `log-entry ${cardDef ? 'log-entry-with-card' : ''}`;

  if (cardDef) {
    const thumbWrap = document.createElement('div');
    thumbWrap.className = `log-card-thumb ${getCardFrameClass(cardDef)}`;
    thumbWrap.title = cardDef.nameTh || cardDef.name || '';
    const img = document.createElement('img');
    img.className = 'log-card-thumb-img';
    img.src = getCardArtUrl(cardDef);
    img.alt = cardDef.nameTh || cardDef.name || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      img.src = generateProceduralCardSvg(cardDef);
    }, { once: true });
    thumbWrap.appendChild(img);
    div.appendChild(thumbWrap);

    div.addEventListener('click', () => {
      inspectCardAndFocus(cardDef, { openMobilePreview: true });
    });
  }

  const body = document.createElement('div');
  body.className = 'log-entry-body';
  const meta = document.createElement('span');
  meta.className = 'log-turn-tag';
  meta.textContent = `[T${item.turn}-${item.phase}]`;
  const textSpan = document.createElement('span');
  textSpan.className = 'log-entry-text';
  appendLinkedLogText(textSpan, item.text, cardDef, extraRefs);
  body.appendChild(meta);
  body.appendChild(textSpan);
  div.appendChild(body);
  return div;
}

function renderDuelLogs(logs) {
  const list = document.getElementById('duel-log-list');
  if (!list) return;
  const arr = Array.isArray(logs) ? logs : [];
  const duelId = appState.currentState?.duelId || '';
  const lang = appState.lang;

  if (arr.length === 0) {
    if (zoneRenderCache.logCount !== 0 || list.childElementCount > 0) {
      list.innerHTML = '';
    }
    zoneRenderCache.logCount = 0;
    zoneRenderCache.lastLogSig = '';
    zoneRenderCache.logDuelId = duelId;
    zoneRenderCache.logLang = lang;
    return;
  }

  const sameContext = zoneRenderCache.logDuelId === duelId && zoneRenderCache.logLang === lang;
  const prevCount = zoneRenderCache.logCount;
  const latestSig = getDuelLogItemSig(arr[arr.length - 1], arr.length - 1);

  // Skip completely when nothing changed
  if (sameContext && prevCount === arr.length && zoneRenderCache.lastLogSig === latestSig) {
    return;
  }

  // Append-only fast path: prepend ONLY newly arrived log entries (newest-first display)
  if (
    sameContext &&
    prevCount > 0 &&
    arr.length > prevCount &&
    getDuelLogItemSig(arr[prevCount - 1], prevCount - 1) === zoneRenderCache.lastLogSig
  ) {
    const newItems = arr.slice(prevCount);
    // Pre-register any new card references once before building fragment so regex compiles at most once
    for (const item of newItems) {
      if (item.card) registerKnownCard(item.card);
      if (item.cardSnapshot) registerKnownCard(item.cardSnapshot);
      if (item.meta) registerKnownCard(item.meta);
    }
    const frag = document.createDocumentFragment();
    for (let i = newItems.length - 1; i >= 0; i--) {
      frag.appendChild(buildDuelLogEntryNode(newItems[i]));
    }
    list.prepend(frag);
    zoneRenderCache.logCount = arr.length;
    zoneRenderCache.lastLogSig = latestSig;
    return;
  }

  // Full rebuild (new duel, language switch, or initial load)
  for (const item of arr) {
    if (item.card) registerKnownCard(item.card);
    if (item.cardSnapshot) registerKnownCard(item.cardSnapshot);
    if (item.meta) registerKnownCard(item.meta);
  }
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = arr.length - 1; i >= 0; i--) {
    frag.appendChild(buildDuelLogEntryNode(arr[i]));
  }
  list.appendChild(frag);
  zoneRenderCache.logCount = arr.length;
  zoneRenderCache.lastLogSig = latestSig;
  zoneRenderCache.logDuelId = duelId;
  zoneRenderCache.logLang = lang;
}

function renderInDuelComboGuide(deckId) {
  const deck = getPresetDeckById(deckId);
  const pane = document.getElementById('in-duel-combo-guide');
  if (!deck || !pane) return;
  const lang = appState.lang;
  const sig = `${deckId}:${lang}`;
  if (zoneRenderCache.comboGuideSig === sig) return;
  zoneRenderCache.comboGuideSig = sig;
  pane.innerHTML = `
    <h4 class="combo-guide-title">${escapeHtml(getDeckDisplayTitle(deck, lang))}</h4>
    <p class="combo-guide-summary">${escapeHtml(getDeckDisplaySummary(deck, lang))}</p>
    <ul class="combo-steps-list">
      ${getDeckDisplayGuide(deck, lang).map(s => `<li>${escapeHtml(s)}</li>`).join('')}
    </ul>
  `;
}

function renderChainStackOverlay(chainStack, myIdx) {
  const container = document.getElementById('chain-stack-overlay');
  if (!container) return;
  const hasStack = Array.isArray(chainStack) && chainStack.length > 0;
  const stackSig = hasStack
    ? `CS:${appState.lang}:${myIdx}:${chainStack.map(item => `${item.chainLink}:${item.playerIndex}:${item.card?.instanceId || item.card?.id || item.card?.passcode || ''}:${item.effect?.id || item.effect?.labelTh || ''}`).join('|')}`
    : 'CS:EMPTY';
  if (zoneRenderCache.zones.get('chain-stack') === stackSig) {
    return;
  }
  zoneRenderCache.zones.set('chain-stack', stackSig);

  if (!hasStack) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'chain-stack-header';
  header.innerHTML = `${iconSvg('chain')}<span>CHAIN (${chainStack.length})</span>`;
  container.appendChild(header);

  const listEl = document.createElement('div');
  listEl.className = 'chain-stack-list';

  // Render top-to-bottom in reverse (highest Chain Link on top, CL1 at bottom)
  const items = [...chainStack].sort((a, b) => b.chainLink - a.chainLink);
  for (const item of items) {
    const isYou = item.playerIndex === myIdx;
    const ownerLabel = isYou ? 'You' : 'Opp';
    const resolvedCard = resolveFullCardMeta(item.card || item, appState.currentState) || item.card || {};
    const cardName = getLocalizedCardName(resolvedCard, appState.lang) || resolvedCard.name || 'Card';
    const effLabel = appState.lang === 'en'
      ? (item.effect?.labelEn || item.effect?.labelTh || '')
      : (item.effect?.labelTh || item.effect?.labelEn || '');
    const hintSuffix = appState.lang === 'en' ? 'Click to view card details' : 'คลิกเพื่อดูรายละเอียดการ์ด';

    const row = document.createElement('div');
    row.className = `chain-stack-item ${isYou ? 'is-you' : 'is-opp'} is-inspectable`;
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.title = `${cardName}${effLabel ? ` — ${effLabel}` : ''} (${hintSuffix})`;
    row.setAttribute('aria-label', `Chain Link ${item.chainLink}: ${cardName}`);

    const ownerEl = document.createElement('div');
    ownerEl.className = `chain-stack-owner ${isYou ? 'you' : 'opp'}`;
    ownerEl.textContent = ownerLabel;

    const img = document.createElement('img');
    img.className = 'chain-stack-thumb';
    img.src = getCardArtUrl(resolvedCard);
    img.alt = cardName;
    img.decoding = 'async';
    img.addEventListener('error', () => {
      img.src = generateProceduralCardSvg(resolvedCard);
    }, { once: true });

    const badge = document.createElement('div');
    badge.className = 'chain-stack-cl-badge';
    badge.innerHTML = `${iconSvg('chain')}<span>${item.chainLink}</span>`;

    const openChainCardDetail = (ev) => {
      ev.stopPropagation();
      inspectCardAndFocus(resolvedCard, { openMobilePreview: true });
    };
    row.addEventListener('click', openChainCardDetail);
    row.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openChainCardDetail(ev);
      }
    });

    row.append(ownerEl, img, badge);
    listEl.appendChild(row);
  }

  container.appendChild(listEl);
}

// ==================== BOTTOM CHAIN SELECTION BAR (NO BLUR) ====================
let activeChainCardCleanup = null;

function clearChainCardHighlights() {
  if (activeChainCardCleanup) {
    activeChainCardCleanup();
    activeChainCardCleanup = null;
  }
}

function openChainPromptBar(chainPrompt) {
  sfx.playChainAlert();
  clearChainCardHighlights();
  hideActionPopup(true);
  clearSelectedHandCard();
  document.querySelector('.player-bottom-dock')?.classList.remove('hand-expanded');

  const bar = document.getElementById('chain-prompt-bar');
  const peekBtn = document.getElementById('btn-chain-peek');
  if (bar) {
    bar.classList.remove('is-peeking');
    syncChainPeekButton(bar, peekBtn);
  }

  const descEl = document.getElementById('chain-trigger-desc');
  const isTouchLike = isCoarseTouchPointer() || Boolean(window.matchMedia?.('(hover: none)')?.matches);
  const passHint = t(appState.lang, isTouchLike ? 'chainTouchHint' : 'chainDesktopHint');
  const pickVerbEn = isTouchLike ? 'Tap' : 'Click';
  const pickVerbTh = isTouchLike ? 'แตะ' : 'คลิก';
  if (chainPrompt.isOpenWindow) {
    descEl.innerHTML = appState.lang === 'en'
      ? `<strong>Open Timing Window</strong> (${escapeHtml(chainPrompt.triggerEffectLabelTh)}) — ${pickVerbEn} glowing card or choose below (Chain Link ${escapeHtml(chainPrompt.chainLinkNumber)})${escapeHtml(passHint)}:`
      : `<strong>จังหวะเปิด (Open Timing)</strong> (${escapeHtml(chainPrompt.triggerEffectLabelTh)}) — ${pickVerbTh}การ์ดที่เรืองแสงหรือเลือกด้านล่าง (<strong>Chain Link ${escapeHtml(chainPrompt.chainLinkNumber)}</strong>)${escapeHtml(passHint)}:`;
  } else {
    const isSelfTrigger = chainPrompt.triggerPlayerIndex === appState.myPlayerIndex;
    descEl.innerHTML = appState.lang === 'en'
      ? `${isSelfTrigger ? 'You activated' : 'Opponent activated'} <strong>"${escapeHtml(chainPrompt.triggerCardNameTh)}"</strong> (${escapeHtml(chainPrompt.triggerEffectLabelTh)}) — ${pickVerbEn} glowing card or choose below for <strong>Chain Link ${escapeHtml(chainPrompt.chainLinkNumber)}</strong>${escapeHtml(passHint)}:`
      : `${isSelfTrigger ? 'คุณสั่งใช้งาน' : 'อีกฝ่ายสั่งใช้งาน'} <strong>"${escapeHtml(chainPrompt.triggerCardNameTh)}"</strong> (${escapeHtml(chainPrompt.triggerEffectLabelTh)}) — ${pickVerbTh}การ์ดที่เรืองแสงหรือเลือกด้านล่างเพื่อเชน <strong>Chain Link ${escapeHtml(chainPrompt.chainLinkNumber)}</strong>${escapeHtml(passHint)}:`;
  }

  const list = document.getElementById('chain-options-list');
  list.innerHTML = '';

  const triggerChainItem = (item) => {
    clearChainCardHighlights();
    appState.activeChainPrompt = null;
    if (bar) {
      bar.classList.add('hidden');
      bar.classList.remove('is-peeking');
      syncChainPeekButton(bar, peekBtn);
    }
    dispatchDuelAction({
      type: 'CHAIN_RESPONSE',
      respond: true,
      optionIndex: item.index,
      instanceId: item.instanceId,
      effectId: item.effectId
    });
  };

  const byInstance = new Map();
  for (const item of chainPrompt.respondableCards || []) {
    if (item.instanceId) {
      if (!byInstance.has(item.instanceId)) byInstance.set(item.instanceId, []);
      byInstance.get(item.instanceId).push(item);
    }

    const cardDef = resolveFullCardMeta(
      item.card || {
        id: item.cardId,
        passcode: item.passcode || (item.code ? String(item.code) : ''),
        name: item.cardName,
        nameTh: item.cardNameTh
      },
      appState.currentState
    ) || {
      id: item.cardId,
      passcode: item.passcode,
      name: item.cardName,
      nameTh: item.cardNameTh
    };

    const optEl = document.createElement('div');
    optEl.className = 'chain-option-btn';
    optEl.setAttribute('role', 'button');
    optEl.setAttribute('tabindex', '0');

    const img = document.createElement('img');
    img.className = 'chain-option-thumb';
    img.src = getCardArtUrl(cardDef);
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      img.src = generateProceduralCardSvg(cardDef);
    }, { once: true });

    const textWrap = document.createElement('div');
    textWrap.className = 'chain-option-body';
    const titleLine = document.createElement('div');
    titleLine.className = 'chain-option-title';
    const displayCardName = appState.lang === 'en'
      ? (item.cardName || item.cardNameTh || '')
      : (item.cardNameTh || item.cardName || '');
    titleLine.innerHTML = `${iconSvg('activate')}<span>${escapeHtml(displayCardName)}</span>`;
    const subLine = document.createElement('div');
    subLine.className = 'chain-option-sub';
    subLine.textContent = stripLeadingEmoji(item.labelTh || '');
    textWrap.append(titleLine, subLine);

    const inspectBtn = document.createElement('button');
    inspectBtn.type = 'button';
    inspectBtn.className = 'chain-option-inspect-btn';
    inspectBtn.innerHTML = iconSvg('inspect');
    inspectBtn.title = appState.lang === 'en' ? 'View Card Info' : 'ดูรายละเอียดการ์ด';
    inspectBtn.setAttribute('aria-label', inspectBtn.title);
    inspectBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      inspectCardAndFocus(cardDef, { openMobilePreview: true });
    });

    optEl.append(img, textWrap, inspectBtn);
    optEl.addEventListener('mouseenter', () => inspectCard(cardDef));
    optEl.addEventListener('click', (ev) => {
      if (ev.target.closest('.chain-option-inspect-btn')) return;
      triggerChainItem(item);
    });
    optEl.addEventListener('keydown', (ev) => {
      if (ev.target.closest('.chain-option-inspect-btn')) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        triggerChainItem(item);
      }
    });
    list.appendChild(optEl);
  }

  // Highlight & wire live hand/field cards directly like YGOPro
  const listeners = [];
  for (const [instId, items] of byInstance.entries()) {
    const el = document.querySelector(`.duel-card[data-instance-id="${instId}"]`);
    if (!el) continue;
    el.classList.add('chain-pick-target');
    el.setAttribute('data-pick-badge', 'CL');
    const onPick = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      if (items.length === 1) {
        triggerChainItem(items[0]);
      } else if (bar) {
        bar.classList.remove('hidden', 'is-peeking');
        syncChainPeekButton(bar, peekBtn);
      }
    };
    el.addEventListener('click', onPick, true);
    listeners.push({ el, onPick });
  }
  activeChainCardCleanup = () => {
    for (const { el, onPick } of listeners) {
      el.classList.remove('chain-pick-target');
      el.removeAttribute('data-pick-badge');
      el.removeEventListener('click', onPick, true);
    }
  };

  bar?.classList.remove('hidden');
}

// ==================== ZONE BROWSER (YGOPRO NON-MODAL HORIZONTAL STRIP) ====================
function openPlayerZoneModal(zoneTitle, cardsList, actionMap = {}, isExtraDeck = false) {
  const lang = appState.lang;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-secondary btn-mini';
  closeBtn.innerHTML = `${iconSvg('close')}<span class="btn-label">${escapeHtml(t(lang, 'closeBtn'))}</span>`;
  closeBtn.onclick = (ev) => {
    ev.stopPropagation();
    closeYgoproCardStrip();
  };

  const track = document.createElement('div');
  track.className = 'ygopro-strip-track';

  if (!cardsList || cardsList.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'strip-empty-msg';
    emptyMsg.textContent = lang === 'en' ? 'No cards in this zone.' : 'ยังไม่มีการ์ดในโซนนี้';
    track.appendChild(emptyMsg);
    openYgoproCardStrip({ mode: 'browse', title: zoneTitle, headerButtons: [closeBtn], bodyEl: track, dismissOnEsc: true });
    return;
  }

  const sortedCards = [...cardsList].sort((a, b) => {
    const aHas = (actionMap[a.instanceId]?.length || 0) > 0 ? 1 : 0;
    const bHas = (actionMap[b.instanceId]?.length || 0) > 0 ? 1 : 0;
    return bHas - aHas;
  });

  const runZoneAction = (card, act) => {
    if (act.type === 'EXTRA_DECK_SUMMON' && act.combinationsCount > 1 && appState.localEngine) {
      const dlg = document.getElementById('dialog-zone-browser');
      const check = SummonManager.getExtraDeckSummonCombinations(appState.localEngine, appState.myPlayerIndex, card);
      if (check.validCombinations && check.validCombinations.length > 1) {
        closeYgoproCardStrip();
        openExtraMaterialComboPicker(card, check.validCombinations, dlg);
        dlg?.showModal();
        return;
      }
    }
    closeYgoproCardStrip();
    dispatchDuelAction({
      type: act.type,
      instanceId: card.instanceId,
      effectId: act.effectId,
      ocgAction: act.ocgAction,
      ocgIndex: act.ocgIndex,
      combinationIndex: 0
    });
  };

  for (const card of sortedCards) {
    const acts = actionMap[card.instanceId] || [];
    const hasActs = acts.length > 0;

    const col = document.createElement('div');
    col.className = 'ygopro-strip-card-col';

    const cardEl = createCardElement(card, { isPlayable: hasActs });
    cardEl.addEventListener('mouseenter', () => inspectCard(card));
    cardEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      inspectCard(card);
    });
    col.appendChild(cardEl);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'ygopro-strip-name';
    nameSpan.textContent = getLocalizedCardName(card, lang);
    col.appendChild(nameSpan);

    if (hasActs) {
      const actWrap = document.createElement('div');
      actWrap.className = 'ygopro-strip-actions';
      for (const act of acts) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ygopro-cmd-btn';
        btn.style.pointerEvents = 'auto';
        btn.textContent = getShortYgoProCmdLabel(act, lang, acts);
        btn.title = lang === 'en' ? (act.label || act.labelTh || '') : (act.labelTh || act.label || '');
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          runZoneAction(card, act);
        });
        actWrap.appendChild(btn);
      }
      col.appendChild(actWrap);
    }

    track.appendChild(col);
  }

  openYgoproCardStrip({ mode: 'browse', title: zoneTitle, headerButtons: [closeBtn], bodyEl: track, dismissOnEsc: true });
}

function openExtraMaterialComboPicker(extraCard, combinations, dlg) {
  const lang = appState.lang;
  document.getElementById('zone-browser-title').textContent =
    `⚡ ${getLocalizedCardName(extraCard, lang)} — ${lang === 'en' ? 'Choose Materials' : 'เลือกชุดวัตถุดิบบนสนาม'}`;
  document.getElementById('zone-browser-subtitle').textContent =
    lang === 'en'
      ? `There are ${combinations.length} valid material combinations. Select which monsters to use:`
      : `พบชุดวัตถุดิบที่สามารถใช้อัญเชิญได้ ${combinations.length} รูปแบบ — เลือกชุดที่ต้องการใช้งาน:`;

  const grid = document.getElementById('zone-browser-grid');
  grid.innerHTML = '';

  combinations.forEach((combo, idx) => {
    const box = document.createElement('div');
    box.className = 'browser-card-box playable-glow';
    const matNames = combo.map(m => getLocalizedCardName(m, lang)).join(' + ');
    const thumbsHtml = combo.map(m => `
      <div class="browser-card-head">
        <img class="browser-card-thumb" src="${getCardArtUrl(m)}" alt="${escapeHtml(m.name)}" loading="lazy" decoding="async" />
        <div class="browser-card-meta">
          <div class="browser-card-name">${escapeHtml(getLocalizedCardName(m, lang))}</div>
          <div class="browser-card-sub">${escapeHtml(getCardSubHeaderBadge(m, lang))} • ${escapeHtml(m.zone)}${m.zone === 'MMZ' ? `#${(m.zoneIndex ?? 0) + 1}` : ''}</div>
        </div>
      </div>
    `).join('');
    box.innerHTML = `
      <div class="browser-card-section">${escapeHtml(lang === 'en' ? `Combination #${idx + 1}` : `รูปแบบที่ ${idx + 1}`)}: ${escapeHtml(matNames)}</div>
      <div class="browser-card-actions">${thumbsHtml}</div>
      <div class="zone-card-actions browser-card-actions"></div>
    `;
    box.querySelectorAll('img').forEach((img, mIdx) => {
      img.addEventListener('error', () => {
        img.src = generateProceduralCardSvg(combo[mIdx]);
      }, { once: true });
    });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-gold btn-mini';
    btn.innerHTML = `${iconSvg('summon')}<span>${escapeHtml(lang === 'en' ? `Summon using Combo #${idx + 1}` : `อัญเชิญด้วยวัตถุดิบชุดนี้`)}</span>`;
    btn.addEventListener('click', () => {
      dlg.close();
      dispatchDuelAction({
        type: 'EXTRA_DECK_SUMMON',
        instanceId: extraCard.instanceId,
        combinationIndex: idx
      });
    });
    box.querySelector('.zone-card-actions')?.appendChild(btn);
    grid.appendChild(box);
  });
}

// ==================== AI CARD STUDIO ====================
const SAMPLE_AI_MONSTER_JSON = {
  id: 'dark_armed_dragon_custom',
  passcode: '65192027',
  name: 'Dark Armed Dragon',
  nameTh: 'ดาร์ค อาร์ม ดราก้อน (การ์ดตัวอย่างจาก AI)',
  kind: 'MONSTER',
  frame: 'EFFECT',
  attribute: 'DARK',
  race: 'Dragon',
  level: 7,
  atk: 2800,
  def: 1000,
  archetype: 'Dark Magician',
  specialSummonRule: {
    fromZone: 'HAND',
    labelTh: 'อัญเชิญพิเศษ Dark Armed Dragon จากมือ'
  },
  descriptionTh: '(1) อัญเชิญพิเศษจากมือได้ (2) เทิร์นละครั้ง: มูฟการ์ดจากสุสานเรา 1 ใบ; ทำลายการ์ดบนสนามของอีกฝ่าย 1 ใบ!',
  effects: [
    {
      id: 'dad_pop',
      labelTh: 'ทำลายการ์ดบนสนามอีกฝ่าย 1 ใบ',
      trigger: 'IGNITION',
      spellSpeed: 1,
      zones: ['MMZ', 'EMZ'],
      opt: 'dad_pop_opt',
      condition: { opponentControlsAnyCard: true },
      actions: [
        {
          type: 'DESTROY_CARDS',
          targetOwner: 'OPPONENT',
          targetZone: 'ANY_FIELD',
          count: 1
        }
      ]
    }
  ]
};

const SAMPLE_AI_SPELL_JSON = {
  id: 'pot_of_greed_custom',
  passcode: '55144522',
  name: 'Pot of Greed',
  nameTh: 'ไหแห่งความโลภ (Pot of Greed)',
  kind: 'SPELL',
  subType: 'NORMAL',
  archetype: 'Staple',
  descriptionTh: '[เวทมนตร์ปกติ] จั่วการ์ด 2 ใบจากเด็คของคุณทันที!',
  effects: [
    {
      id: 'pot_draw_2',
      labelTh: 'จั่วการ์ด 2 ใบจากเด็ค',
      trigger: 'SPELL_ACTIVATE',
      spellSpeed: 1,
      actions: [
        { type: 'DRAW', count: 2 }
      ]
    }
  ]
};

function setupAIStudioEvents() {
  const textarea = document.getElementById('textarea-custom-card-json');
  const statusEl = document.getElementById('studio-status-msg');
  textarea.value = JSON.stringify(SAMPLE_AI_MONSTER_JSON, null, 2);

  document.getElementById('btn-load-sample-monster')?.addEventListener('click', () => {
    textarea.value = JSON.stringify(SAMPLE_AI_MONSTER_JSON, null, 2);
    statusEl.textContent = '';
  });

  document.getElementById('btn-load-sample-spell')?.addEventListener('click', () => {
    textarea.value = JSON.stringify(SAMPLE_AI_SPELL_JSON, null, 2);
    statusEl.textContent = '';
  });

  document.getElementById('btn-validate-and-save-card')?.addEventListener('click', async () => {
    try {
      const parsed = JSON.parse(textarea.value);
      const cards = Array.isArray(parsed) ? parsed : [parsed];
      for (const c of cards) {
        const check = validateCardSchema(c);
        if (!check.valid) {
          statusEl.style.color = '#f43f5e';
          statusEl.textContent = `❌ Schema Error: ${check.errors.join(' | ')}`;
          return;
        }
      }

      const res = await fetch('/api/custom-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards })
      });
      const data = await res.json();
      if (!data.ok) {
        statusEl.style.color = '#f43f5e';
        statusEl.textContent = `❌ ${(data.errors || []).join(', ')}`;
        return;
      }

      registerCustomCards(cards);
      statusEl.style.color = '#10b981';
      statusEl.textContent = `✅ บันทึกการ์ดใหม่ ${cards.length} ใบลงไฟล์ src/cards/custom_cards.json สำเร็จ! (รวมการ์ดในระบบ ${getAllCards().length} ใบ)`;
      showToast(`🤖 เพิ่มการ์ดใหม่เข้าสู่ระบบสำเร็จ!`);
    } catch (err) {
      statusEl.style.color = '#f43f5e';
      statusEl.textContent = `❌ JSON ไม่ถูกต้อง: ${err.message}`;
    }
  });
}

// ==================== PLAYMAT & LANGUAGE CONTROLLER ====================
function renderPlaymatPicker() {
  const container = document.getElementById('lobby-playmat-picker');
  if (!container) return;
  container.innerHTML = '';

  for (const pm of PLAYMATS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `playmat-chip ${pm.id === appState.playmatId ? 'active' : ''}`;
    btn.setAttribute('data-playmat-id', pm.id);
    btn.innerHTML = `
      <span class="playmat-swatch" style="background:${pm.swatch};border-color:${pm.borderAccent}"></span>
      <span>${pm.icon} ${appState.lang === 'en' ? pm.nameEn : pm.nameTh}</span>
    `;
    btn.addEventListener('click', () => {
      appState.playmatId = pm.id;
      savePlaymat(pm.id);
      applyPlaymatTheme();
      const label = appState.lang === 'en' ? pm.nameEn : pm.nameTh;
      showToast(`${pm.icon} ${appState.lang === 'en' ? 'Playmat:' : 'เปลี่ยนสนามเป็น:'} ${label}`);
    });
    container.appendChild(btn);
  }
}

function applyPlaymatTheme() {
  const pm = getPlaymatById(appState.playmatId);
  const root = document.documentElement;
  root.style.setProperty('--playmat-art', getPlaymatBackgroundUrl(pm.id));
  root.style.setProperty('--card-back-main', getCardBackSvgUrl(false));
  root.style.setProperty('--card-back-extra', getCardBackSvgUrl(true));

  const playmatEl = document.getElementById('playmat-container');
  if (playmatEl) {
    for (const item of PLAYMATS) {
      playmatEl.classList.remove(item.cssClass);
    }
    playmatEl.classList.add(pm.cssClass);
  }

  document.querySelectorAll('.playmat-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-playmat-id') === pm.id);
  });
}

const MOBILE_ZOOM_SCALES = ['auto', '85', '75'];
let currentMobileZoomScale = 'auto';

function syncMobileFieldZoomUI(scale = currentMobileZoomScale) {
  const clean = MOBILE_ZOOM_SCALES.includes(scale) ? scale : 'auto';
  currentMobileZoomScale = clean;
  const playmat = document.getElementById('playmat-container');
  const duelScreen = document.getElementById('screen-duel');
  const zoomBtn = document.getElementById('btn-mobile-field-zoom');
  const menuZoomBtn = document.getElementById('btn-menu-zoom');
  const shortText = clean === 'auto' ? 'Auto' : `${clean}%`;

  if (clean === 'auto') {
    playmat?.removeAttribute('data-field-scale');
    duelScreen?.removeAttribute('data-field-scale');
  } else {
    playmat?.setAttribute('data-field-scale', clean);
    duelScreen?.setAttribute('data-field-scale', clean);
  }
  if (zoomBtn) {
    setButtonLabel(zoomBtn, shortText, 'zoom');
  }
  if (menuZoomBtn) {
    setButtonLabel(menuZoomBtn, `${t(appState.lang, 'menuZoom')}: ${shortText}`, 'zoom');
  }
}

function cycleMobileFieldZoom() {
  const nextIdx = (MOBILE_ZOOM_SCALES.indexOf(currentMobileZoomScale) + 1) % MOBILE_ZOOM_SCALES.length;
  const nextScale = MOBILE_ZOOM_SCALES[nextIdx];
  syncMobileFieldZoomUI(nextScale);
  try {
    localStorage.setItem('ygo_md_mobile_zoom', nextScale);
  } catch {
    // ignore storage failure
  }
  const st = appState.currentState || appState.lastRenderedState;
  if (st) {
    requestAnimationFrame(() => renderEquipArrows(st, true));
  }
}

function updatePillWithCount(btnEl, labelText, countId, iconName) {
  if (!btnEl) return;
  const existingLabel = btnEl.querySelector('.btn-label');
  if (existingLabel) {
    existingLabel.textContent = `${labelText}:`;
    return;
  }
  const countEl = document.getElementById(countId);
  const countText = countEl ? countEl.textContent : '0';
  btnEl.innerHTML = `${iconSvg(iconName)}<span class="btn-label">${escapeHtml(labelText)}:</span> <span id="${countId}">${escapeHtml(countText)}</span>`;
}

function applyI18n() {
  const lang = appState.lang;
  document.documentElement.lang = lang;
  resetDuelRenderCaches();

  const duelIconMap = {
    btnBattle: 'battle',
    btnMp2: 'mp2',
    btnEndTurn: 'end',
    btnLeave: 'leave',
    btnPassChain: 'end',
    inspTabCard: 'inspect',
    inspTabLog: 'log',
    inspTabGuide: 'cards'
  };

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const translated = t(lang, key);
    if (el.querySelector('.btn-label') || el.querySelector('svg')) {
      setButtonLabel(el, translated);
    } else if (duelIconMap[key] && (el.tagName === 'BUTTON' || el.classList.contains('insp-tab'))) {
      setButtonLabel(el, translated, duelIconMap[key]);
    } else {
      el.textContent = translated;
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(lang, key));
  });

  const langBtn = document.getElementById('btn-toggle-lang');
  if (langBtn) {
    setButtonLabel(langBtn, langBtn.querySelector('svg, .btn-label') ? stripLeadingEmoji(t(lang, 'langBtn')) : t(lang, 'langBtn'));
  }

  // Fix Thai-in-EN i18n leaks in Lobby Open Rooms & Opponent HUD & Mobile Drawer
  const openRoomsTitle = document.querySelector('#open-rooms-section .open-rooms-header > span:not([data-i18n])');
  if (openRoomsTitle) {
    openRoomsTitle.textContent = t(lang, 'openRoomsTitle');
  }
  const refreshRoomsBtn = document.getElementById('btn-refresh-rooms');
  if (refreshRoomsBtn) {
    setButtonLabel(refreshRoomsBtn, t(lang, 'refreshRoomsBtn'), 'position');
  }
  const emptyRoomsEl = document.querySelector('#open-rooms-list .empty-rooms-text');
  if (emptyRoomsEl) {
    emptyRoomsEl.textContent = t(lang, 'emptyRoomsText');
  }
  const roomCodeInput = document.getElementById('input-room-code');
  if (roomCodeInput) {
    roomCodeInput.setAttribute('placeholder', t(lang, 'roomCodePlaceholder'));
  }

  // Opponent HUD zone pills (preserving child count spans!)
  updatePillWithCount(document.getElementById('btn-opp-gy'), t(lang, 'oppGyLabel'), 'opp-gy-count', 'gy');
  updatePillWithCount(document.getElementById('btn-opp-banished'), t(lang, 'oppBanishedLabel'), 'opp-banished-count', 'banish');
  const oppStaticPill = document.querySelector('.opponent-hud .zone-pill-static');
  if (oppStaticPill && !oppStaticPill.querySelector('[data-i18n]')) {
    const deckVal = document.getElementById('opp-deck-count')?.textContent ?? '35';
    const extraVal = document.getElementById('opp-extra-count')?.textContent ?? '10';
    oppStaticPill.innerHTML = `${iconSvg('cards')}<span>${escapeHtml(t(lang, 'oppDeckLabel'))}:</span> <span id="opp-deck-count">${escapeHtml(deckVal)}</span> <span aria-hidden="true">|</span> <span>${escapeHtml(t(lang, 'oppExtraLabel'))}:</span> <span id="opp-extra-count">${escapeHtml(extraVal)}</span>`;
  }

  // Waiting room & Mobile Duel Menu Drawer labels
  const copyCodeBtn = document.getElementById('btn-copy-room-code');
  if (copyCodeBtn && !copyCodeBtn.hasAttribute('data-i18n')) setButtonLabel(copyCodeBtn, t(lang, 'copyCodeBtn'));
  const copyInviteBtn = document.getElementById('btn-copy-invite-link');
  if (copyInviteBtn && !copyInviteBtn.hasAttribute('data-i18n')) setButtonLabel(copyInviteBtn, t(lang, 'copyInviteBtn'));
  const shareInviteBtn = document.getElementById('btn-share-invite-link');
  if (shareInviteBtn && !shareInviteBtn.hasAttribute('data-i18n')) setButtonLabel(shareInviteBtn, t(lang, 'shareInviteBtn'));
  const cancelRoomBtn = document.getElementById('btn-cancel-waiting-room');
  if (cancelRoomBtn && !cancelRoomBtn.hasAttribute('data-i18n')) setButtonLabel(cancelRoomBtn, t(lang, 'closeRoomBtn'), 'close');

  const menuLangBtn = document.getElementById('btn-menu-lang');
  if (menuLangBtn) setButtonLabel(menuLangBtn, t(lang, 'menuLang'));
  const menuGuideBtn = document.getElementById('btn-menu-guide');
  if (menuGuideBtn) setButtonLabel(menuGuideBtn, t(lang, 'menuGuide'));
  const menuSurrenderBtn = document.getElementById('btn-menu-surrender');
  if (menuSurrenderBtn) setButtonLabel(menuSurrenderBtn, t(lang, 'menuSurrender'), 'flag');
  const menuLeaveBtn = document.getElementById('btn-menu-leave');
  if (menuLeaveBtn) setButtonLabel(menuLeaveBtn, t(lang, 'menuLeave'), 'leave');
  const railSurrenderBtn = document.getElementById('btn-surrender-duel');
  if (railSurrenderBtn) setButtonLabel(railSurrenderBtn, t(lang, 'btnSurrender'), 'flag');

  const rematchBtn = document.getElementById('btn-duel-rematch');
  if (rematchBtn) setButtonLabel(rematchBtn, stripLeadingEmoji(t(lang, 'rematchBtn')), 'position');
  const backLobbyBtn = document.getElementById('btn-result-back-lobby');
  if (backLobbyBtn) setButtonLabel(backLobbyBtn, stripLeadingEmoji(t(lang, 'backLobbyBtn')), 'leave');

  syncMobileFieldZoomUI(currentMobileZoomScale);
  updateAiDifficultyUI();
  refreshEffectChoiceModalLabels(getEffectChoiceLabels);
  appState.lingeringHud?.refreshLanguage();

  populateAiDeckDropdown();
  renderDeckSelector();
  renderPlaymatPicker();
  applyPlaymatTheme();

  if (appState.currentState) {
    renderDuelScreen();
  }
  if (appState.lastInspectedCard) {
    inspectCard(appState.lastInspectedCard);
  }
  syncAllPeekButtons();
  updateMpTabUI();
  const lanLabelEl = document.getElementById('lan-box-label');
  const lanHintEl = document.getElementById('lan-scope-hint');
  const wsTabEl = document.getElementById('tab-mp-ws');
  const p2pTabEl = document.getElementById('tab-mp-p2p');
  const isLocalOrigin = isPrivateOrLocalHost(window.location.hostname);
  if (!isLocalOrigin) {
    if (wsTabEl) {
      wsTabEl.textContent = lang === 'en'
        ? 'Cloud Online — Cross-Wi-Fi / 4G (Recommended)'
        : 'ออนไลน์ข้าม Wi-Fi / 4G (Cloud Server — แนะนำ)';
    }
    if (p2pTabEl) {
      p2pTabEl.textContent = lang === 'en'
        ? 'Direct P2P (Fallback)'
        : 'โหมด P2P สำรอง';
    }
  }
  if (lanLabelEl && lanHintEl) {
    if (!isLocalOrigin) {
      lanLabelEl.textContent = lang === 'en'
        ? 'Public / Cross-Wi-Fi Server URL:'
        : 'ลิงก์เข้าเล่นข้าม Wi-Fi / 4G (Public URL):';
      lanHintEl.textContent = lang === 'en'
        ? 'Anyone on any Wi-Fi or cellular network can open this URL and play via Mode 1.'
        : 'เพื่อนอยู่คนละ Wi-Fi หรือ 4G เปิดลิงก์นี้แล้วเข้า Mode 1 ได้ทันที';
    } else {
      lanLabelEl.textContent = lang === 'en'
        ? 'Same-Wi-Fi (LAN) Share Link:'
        : 'ลิงก์เล่นด้วยกันบน Wi-Fi เดียวกัน (LAN):';
      lanHintEl.textContent = lang === 'en'
        ? 'Same Wi-Fi / Hotspot only. For Cross-Wi-Fi, switch to Mode 2 (P2P Online) or use a public HTTPS tunnel.'
        : 'ใช้ได้เฉพาะ Wi-Fi / Hotspot เดียวกัน — หากอยู่คนละ Wi-Fi ให้ใช้ Mode 2 (P2P Online) หรือรันผ่าน Public HTTPS Tunnel';
    }
  }
  if (appState.rpsContext) {
    renderRpsModal();
  }
}

function applyLanguage() {
  applyI18n();
}

function toggleLanguage() {
  appState.lang = appState.lang === 'th' ? 'en' : 'th';
  saveLanguage(appState.lang);
  applyI18n();
  showToast(appState.lang === 'en' ? 'Language switched to English' : 'เปลี่ยนภาษาเป็นภาษาไทยแล้ว');
}

function setupSurrenderControls() {
  const dlg = document.getElementById('dialog-surrender-confirm');
  const cancelBtn = document.getElementById('btn-surrender-cancel');
  const confirmBtn = document.getElementById('btn-surrender-confirm');
  if (!dlg || !cancelBtn || !confirmBtn) return;

  let armTimer = null;

  const closeConfirm = () => {
    clearTimeout(armTimer);
    armTimer = null;
    if (dlg.open) dlg.close();
  };

  const openConfirm = () => {
    const state = appState.currentState;
    if (!state || state.winner !== null || dlg.open) return;
    document.getElementById('mobile-duel-menu-drawer')?.classList.remove('open');
    document.getElementById('btn-mobile-duel-menu')?.setAttribute('aria-expanded', 'false');
    confirmBtn.disabled = true;
    dlg.showModal();
    cancelBtn.focus();
    clearTimeout(armTimer);
    // 400ms ghost-tap protection prevents accidental double-tap surrender on mobile
    armTimer = setTimeout(() => {
      if (appState.currentState?.winner == null) {
        confirmBtn.disabled = false;
      }
    }, 400);
  };

  document.addEventListener('click', (ev) => {
    const btn = ev.target?.closest?.('[data-action="surrender"]');
    if (!btn || btn.disabled) return;
    ev.stopPropagation();
    openConfirm();
  });

  cancelBtn.addEventListener('click', closeConfirm);
  dlg.addEventListener('cancel', () => clearTimeout(armTimer));
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg) closeConfirm();
  });

  confirmBtn.addEventListener('click', () => {
    if (confirmBtn.disabled) return;
    closeConfirm();
    dispatchDuelAction({ type: 'SURRENDER' });
  });
}

function leaveCurrentDuel() {
  clearTimeout(appState.aiTimer);
  closeEffectChoiceModal();
  appState.lingeringHud?.hide?.();
  cancelStateSyncPlayback({ clearDuelId: true });
  clearDuelVfxLayer();
  if (appState.gameMode === 'MULTIPLAYER') {
    appState.mpManager?.disconnectRoom();
    appState.activeRoomCode = null;
    appState.activeRoomMode = null;
    document.getElementById('waiting-room-banner')?.classList.add('hidden');
    renderP2PLiveStatus({ stage: 'idle', message: '' });
  }
  appState.currentState = null;
  appState.lastRenderedState = null;
  appState.lastAutoInspectedEventKey = null;
  resetDuelRenderCaches();
  closeMobileCardDetail();
  switchScreen('screen-lobby');
}

function setupMobileFieldZoom() {
  const zoomBtn = document.getElementById('btn-mobile-field-zoom');
  const playmat = document.getElementById('playmat-container');

  let saved = 'auto';
  try {
    saved = localStorage.getItem('ygo_md_mobile_zoom') || 'auto';
  } catch {
    saved = 'auto';
  }
  syncMobileFieldZoomUI(saved);

  if (zoomBtn && playmat) {
    zoomBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      cycleMobileFieldZoom();
    });
  }

  let resizeEquipRafId = null;
  window.addEventListener('resize', () => {
    const st = appState.currentState || appState.lastRenderedState;
    if (!st || resizeEquipRafId !== null) return;
    resizeEquipRafId = requestAnimationFrame(() => {
      resizeEquipRafId = null;
      const latest = appState.currentState || appState.lastRenderedState;
      if (latest) renderEquipArrows(latest, true);
    });
  }, { passive: true });
}

function setupMobileHandToggle() {
  const dock = document.querySelector('.player-bottom-dock');
  if (!dock) return;

  // Tap-First Mobile Hand: on coarse/touch pointers we NEVER hijack the first tap to expand
  // the hand dock — tapping any hand card immediately selects it (.is-selected) and opens
  // #field-pick-banner[data-mode="card-actions"]. Keep only outside-tap cleanup for legacy expanded state.
  document.addEventListener('pointerdown', (ev) => {
    if (!dock.classList.contains('hand-expanded')) return;
    if (ev.target.closest('.player-bottom-dock, #card-action-popup, #field-pick-banner, #mobile-card-preview, #chain-prompt-bar')) return;
    dock.classList.remove('hand-expanded');
  }, true);
}

function setupMobileDuelControls() {
  const menuBtn = document.getElementById('btn-mobile-duel-menu');
  const menuDrawer = document.getElementById('mobile-duel-menu-drawer');
  const inspectorToggleBtn = document.getElementById('btn-mobile-inspector-toggle');
  const inspectorCloseBtn = document.getElementById('btn-close-mobile-inspector');
  const inspectorSidebar = document.getElementById('inspector-sidebar');

  const closeMenuDrawer = () => {
    if (!menuDrawer) return;
    menuDrawer.classList.remove('open');
    menuBtn?.setAttribute('aria-expanded', 'false');
  };

  const closeInspectorSheet = () => {
    if (!inspectorSidebar) return;
    inspectorSidebar.classList.remove('is-mobile-open');
    inspectorToggleBtn?.setAttribute('aria-expanded', 'false');
  };

  menuBtn?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!menuDrawer) return;
    const willOpen = !menuDrawer.classList.contains('open');
    if (willOpen) closeInspectorSheet();
    menuDrawer.classList.toggle('open', willOpen);
    menuBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  document.getElementById('btn-menu-lang')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleLanguage();
    closeMenuDrawer();
  });

  document.getElementById('btn-menu-zoom')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    cycleMobileFieldZoom();
  });

  document.getElementById('btn-menu-guide')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeMenuDrawer();
    document.getElementById('dialog-howto')?.showModal();
  });

  document.getElementById('btn-menu-leave')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeMenuDrawer();
    leaveCurrentDuel();
  });

  inspectorToggleBtn?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!inspectorSidebar) return;
    const willOpen = !inspectorSidebar.classList.contains('is-mobile-open');
    if (willOpen) closeMenuDrawer();
    inspectorSidebar.classList.toggle('is-mobile-open', willOpen);
    inspectorToggleBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  inspectorCloseBtn?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeInspectorSheet();
  });

  document.addEventListener('pointerdown', (ev) => {
    if (menuDrawer?.classList.contains('open') && !ev.target.closest('#mobile-duel-menu-drawer, #btn-mobile-duel-menu')) {
      closeMenuDrawer();
    }
    if (inspectorSidebar?.classList.contains('is-mobile-open') && !ev.target.closest('#inspector-sidebar, #btn-mobile-inspector-toggle, #mobile-card-preview')) {
      closeInspectorSheet();
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (menuDrawer?.classList.contains('open')) closeMenuDrawer();
    if (inspectorSidebar?.classList.contains('is-mobile-open')) closeInspectorSheet();
  });
}

// ==================== INITIALIZATION & EVENT BINDINGS ====================
window.addEventListener('DOMContentLoaded', () => {
  setupDialogs();
  setupRpsDialogBindings();
  setupMobileFieldZoom();
  setupMobileHandToggle();
  setupMobileDuelControls();
  populateAiDeckDropdown();
  renderDeckSelector();
  applyI18n();
  initMultiplayerManager();
  setupCrossWifiUiBindings();
  applyInviteQueryParams();
  fetchNetworkAndCustomCards();
  setupAIStudioEvents();

  // Deck Search & Style Filter Controls (55 Decks)
  document.getElementById('input-deck-search')?.addEventListener('input', (e) => {
    appState.deckSearch = e.target.value || '';
    renderDeckSelector();
  });

  document.querySelectorAll('.deck-filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.deck-filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      appState.deckCategory = chip.getAttribute('data-deck-filter') || 'all';
      renderDeckSelector();
    });
  });

  // Language Toggle Button
  document.getElementById('btn-toggle-lang')?.addEventListener('click', toggleLanguage);

  // Close floating action popup when clicking anywhere else
  document.addEventListener('click', () => {
    if (shouldSuppressCardClick()) return;
    hideActionPopup();
  });

  // Header Navigation
  document.getElementById('btn-home-logo')?.addEventListener('click', () => switchScreen('screen-lobby'));
  document.getElementById('btn-open-deck-viewer')?.addEventListener('click', () => {
    openDeckListModal(getPresetDeckById(appState.selectedDeckId));
  });
  document.getElementById('btn-open-ai-studio')?.addEventListener('click', () => {
    document.getElementById('dialog-ai-studio')?.showModal();
  });
  document.getElementById('btn-open-ydk-import')?.addEventListener('click', () => {
    const statusEl = document.getElementById('ydk-import-status');
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.className = 'studio-status-msg';
    }
    document.getElementById('dialog-ydk-import')?.showModal();
  });
  document.getElementById('btn-paste-ydk-clipboard')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('ydk-import-status');
    const ta = document.getElementById('textarea-ydk-input');
    try {
      const clipText = await navigator.clipboard.readText();
      if (!clipText || !clipText.trim()) {
        if (statusEl) {
          statusEl.textContent = '⚠️ Clipboard ว่างเปล่า กรุณาคัดลอกโค้ด YDK ก่อน';
          statusEl.className = 'studio-status-msg error';
        }
        return;
      }
      if (ta) ta.value = clipText;
      if (statusEl) {
        statusEl.textContent = '📋 วางข้อความจาก Clipboard แล้ว กด "✅ นำเข้าเด็คนี้" ได้เลย';
        statusEl.className = 'studio-status-msg success';
      }
    } catch {
      if (statusEl) {
        statusEl.textContent = '⚠️ เบราว์เซอร์ไม่อนุญาตให้อ่าน Clipboard อัตโนมัติ กรุณากด Ctrl+V วางในช่องด้านล่างแทน';
        statusEl.className = 'studio-status-msg error';
      }
      ta?.focus();
    }
  });
  document.getElementById('input-ydk-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const ta = document.getElementById('textarea-ydk-input');
    const nameInput = document.getElementById('input-ydk-deck-name');
    if (ta) ta.value = text;
    if (nameInput && !nameInput.value.trim()) {
      nameInput.value = file.name.replace(/\.(ydk|txt)$/i, '');
    }
  });
  document.getElementById('btn-confirm-ydk-import')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('ydk-import-status');
    const ydkText = document.getElementById('textarea-ydk-input')?.value || '';
    const name = document.getElementById('input-ydk-deck-name')?.value || '';
    try {
      const res = await fetch('/api/custom-decks/import-ydk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ydkText })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (statusEl) {
          statusEl.textContent = `❌ ${data.error || 'นำเข้า YDK ไม่สำเร็จ'}`;
          statusEl.className = 'studio-status-msg error';
        }
        return;
      }
      if (Array.isArray(data.cards)) registerRuntimeCards(data.cards);
      if (Array.isArray(data.customDecks)) registerCustomDecks(data.customDecks);
      appState.selectedDeckId = data.deck.id;
      appState.deckCategory = 'all';
      appState.deckSearch = '';
      const searchEl = document.getElementById('input-deck-search');
      if (searchEl) searchEl.value = '';
      renderDeckSelector();
      populateAiDeckDropdown();
      document.getElementById('dialog-ydk-import')?.close();
      const warnMissing = data.stats?.missingPasscodes?.length
        ? ` (ไม่พบใน cards.cdb ${data.stats.missingPasscodes.length} ใบ)`
        : '';
      showToast(`✅ นำเข้าเด็ค "${data.deck.name}" สำเร็จ! (Main ${data.stats.mainCount} / Extra ${data.stats.extraCount})${warnMissing}`, 'success');
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `❌ เกิดข้อผิดพลาด: ${err.message}`;
        statusEl.className = 'studio-status-msg error';
      }
    }
  });
  document.getElementById('btn-open-howto')?.addEventListener('click', () => {
    document.getElementById('dialog-howto')?.showModal();
  });

  // Multiplayer Tabs (WS vs P2P)
  document.querySelectorAll('.mp-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      appState.mpConnectionType = tab.getAttribute('data-mp-tab') || 'ws';
      updateMpTabUI();
    });
  });

  // Lobby Start Buttons
  setupAiDifficultySelector();
  document.getElementById('btn-start-solo')?.addEventListener('click', startSoloDuel);
  document.getElementById('btn-start-sandbox')?.addEventListener('click', startSandboxDuel);

  document.getElementById('btn-create-room')?.addEventListener('click', () => {
    const playerName = document.getElementById('input-player-name').value.trim() || 'Duelist 1';
    const customPayload = buildSelectedCustomDeckPayload(appState.selectedDeckId);
    if (appState.mpConnectionType === 'p2p') {
      appState.mpManager.createP2PRoom(playerName, appState.selectedDeckId, customPayload);
    } else {
      appState.mpManager.createWsRoom(playerName, appState.selectedDeckId, customPayload);
    }
  });

  document.getElementById('btn-join-room')?.addEventListener('click', () => {
    const code = document.getElementById('input-room-code').value.trim().replace(/^#/, '').toUpperCase();
    if (!code) {
      showToast('⚠️ กรุณากรอกรหัสห้อง');
      return;
    }
    const playerName = document.getElementById('input-player-name').value.trim() || 'Duelist 2';
    const customPayload = buildSelectedCustomDeckPayload(appState.selectedDeckId);
    if (/^\d{6}$/.test(code) && appState.mpConnectionType !== 'p2p') {
      appState.mpConnectionType = 'p2p';
      updateMpTabUI();
    } else if (code.length === 4 && appState.mpConnectionType === 'p2p') {
      appState.mpConnectionType = 'ws';
      updateMpTabUI();
    }
    if (appState.mpConnectionType === 'p2p') {
      appState.mpManager.joinP2PRoom(code, playerName, appState.selectedDeckId, customPayload);
    } else {
      appState.mpManager.joinWsRoom(code, playerName, appState.selectedDeckId, customPayload);
    }
  });

  document.getElementById('btn-refresh-rooms')?.addEventListener('click', fetchNetworkAndCustomCards);

  // Inspector Sidebar Tabs
  document.querySelectorAll('.insp-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.insp-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.inspector-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.getAttribute('data-insp');
      document.getElementById(`inspector-${target}-pane`)?.classList.add('active');
    });
  });

  // Duel Phase Controls
  document.getElementById('btn-go-battle')?.addEventListener('click', () => {
    dispatchDuelAction({ type: 'CHANGE_PHASE', targetPhase: PHASES.BP });
  });
  document.getElementById('btn-go-mp2')?.addEventListener('click', () => {
    dispatchDuelAction({ type: 'CHANGE_PHASE', targetPhase: PHASES.MP2 });
  });
  document.getElementById('btn-end-turn')?.addEventListener('click', () => {
    dispatchDuelAction({ type: 'CHANGE_PHASE', targetPhase: PHASES.EP });
  });
  document.querySelectorAll('#phase-steps-bar .phase-badge').forEach((badge) => {
    badge.addEventListener('click', () => {
      if (!badge.classList.contains('phase-clickable')) return;
      const targetPhase = badge.getAttribute('data-phase');
      if (targetPhase) {
        dispatchDuelAction({ type: 'CHANGE_PHASE', targetPhase });
      }
    });
  });

  // Chain Mode Toggle (AUTO -> ON -> OFF)
  document.getElementById('btn-chain-toggle')?.addEventListener('click', () => {
    if (!appState.currentState) return;
    const cur = appState.currentState.players[appState.myPlayerIndex].chainMode;
    const next = cur === CHAIN_MODE.AUTO ? CHAIN_MODE.ON : cur === CHAIN_MODE.ON ? CHAIN_MODE.OFF : CHAIN_MODE.AUTO;
    dispatchDuelAction({ type: 'SET_CHAIN_MODE', mode: next });
  });

  // Leave / Surrender
  document.getElementById('btn-leave-duel')?.addEventListener('click', leaveCurrentDuel);
  setupSurrenderControls();

  // Chain Peek Board Button (temporarily minimize chain bar to inspect field)
  const chainPeekBtn = document.getElementById('btn-chain-peek');
  if (chainPeekBtn) {
    const chainBar = document.getElementById('chain-prompt-bar');
    syncChainPeekButton(chainBar, chainPeekBtn);
    chainPeekBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!chainBar) return;
      chainBar.classList.toggle('is-peeking');
      syncChainPeekButton(chainBar, chainPeekBtn);
    });
  }

  // Close mobile card detail quick-view on Escape
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      const preview = document.getElementById('mobile-card-preview');
      if (preview && !preview.classList.contains('hidden')) {
        closeMobileCardDetail();
      }
    }
  });

  // Chain Pass Button
  document.getElementById('btn-chain-pass')?.addEventListener('click', () => {
    clearChainCardHighlights();
    appState.activeChainPrompt = null;
    const chainBar = document.getElementById('chain-prompt-bar');
    if (chainBar) {
      chainBar.classList.add('hidden');
      chainBar.classList.remove('is-peeking');
      syncChainPeekButton(chainBar, document.getElementById('btn-chain-peek'));
    }
    dispatchDuelAction({ type: 'CHAIN_RESPONSE', respond: false });
  });

  // YGOPro Muscle Memory: Click outside unpins card command pills; Right-Click declines / cancels / passes chain!
  document.addEventListener('click', clearPinnedCmdCards);
  document.getElementById('screen-duel')?.addEventListener('contextmenu', (ev) => {
    if (ev.target.closest('input, textarea')) return;
    ev.preventDefault();
    clearPinnedCmdCards();

    const strip = document.getElementById('ygopro-card-strip');
    if (strip && !strip.classList.contains('hidden') && strip.dataset.mode === 'browse') {
      closeYgoproCardStrip();
      return;
    }

    const chainBar = document.getElementById('chain-prompt-bar');
    if (chainBar && !chainBar.classList.contains('hidden')) {
      document.getElementById('btn-chain-pass')?.click();
      return;
    }

    const prompt = appState.activeOcgPrompt;
    if (prompt) {
      if (prompt.promptType === 'SELECT_EFFECTYN' || prompt.promptType === 'SELECT_YESNO') {
        sendOcgPromptResponse({ type: prompt.promptType === 'SELECT_EFFECTYN' ? 2 : 3, yes: false });
        return;
      }
      if (
        (prompt.promptType === 'SELECT_CARD' || prompt.promptType === 'SELECT_TRIBUTE' || prompt.promptType === 'SELECT_SUM') &&
        prompt.canCancel
      ) {
        const rType = prompt.promptType === 'SELECT_TRIBUTE' ? 12 : prompt.promptType === 'SELECT_SUM' ? 14 : 5;
        sendOcgPromptResponse({ type: rType, indicies: null });
        return;
      }
      if (prompt.promptType === 'SELECT_UNSELECT_CARD' && (prompt.canFinish || prompt.canCancel)) {
        sendOcgPromptResponse({ type: 7, index: null });
        return;
      }
    }

    if (!activeZonePickMandatory) {
      clearZonePickMode(true);
    }
  });

  // Zone Browser Buttons (Extra Deck, GY, Banished)
  document.getElementById('btn-self-extra')?.addEventListener('click', () => {
    if (!appState.currentState) return;
    const me = appState.currentState.players[appState.myPlayerIndex];
    openPlayerZoneModal(t(appState.lang, 'zoneSelfExtra'), me.extra, appState.legalActions?.extraActions || {}, true);
  });

  document.getElementById('btn-self-gy')?.addEventListener('click', () => {
    if (!appState.currentState) return;
    const me = appState.currentState.players[appState.myPlayerIndex];
    openPlayerZoneModal(t(appState.lang, 'zoneSelfGy'), me.gy, appState.legalActions?.gyActions || {});
  });

  document.getElementById('btn-self-banished')?.addEventListener('click', () => {
    if (!appState.currentState) return;
    const me = appState.currentState.players[appState.myPlayerIndex];
    openPlayerZoneModal(t(appState.lang, 'zoneSelfBanished'), me.banished, appState.legalActions?.banishedActions || {});
  });

  const openOppGy = () => {
    if (!appState.currentState) return;
    const opp = appState.currentState.players[1 - appState.myPlayerIndex];
    openPlayerZoneModal(`${t(appState.lang, 'zoneOppGyPrefix')} ${opp.name}`, opp.gy, {});
  };
  const openOppBanished = () => {
    if (!appState.currentState) return;
    const opp = appState.currentState.players[1 - appState.myPlayerIndex];
    openPlayerZoneModal(`${t(appState.lang, 'zoneOppBanishedPrefix')} ${opp.name}`, opp.banished, {});
  };

  document.getElementById('btn-opp-gy')?.addEventListener('click', openOppGy);
  document.getElementById('btn-opp-gy-mat')?.addEventListener('click', openOppGy);
  document.getElementById('btn-opp-banished')?.addEventListener('click', openOppBanished);
  document.getElementById('btn-opp-banished-mat')?.addEventListener('click', openOppBanished);

  // Result Dialog Buttons
  document.getElementById('btn-duel-rematch')?.addEventListener('click', () => {
    cancelStateSyncPlayback({ clearDuelId: true });
    clearDuelVfxLayer();
    document.getElementById('dialog-duel-result')?.close();
    if (appState.gameMode === 'MULTIPLAYER') {
      const customPayload = buildSelectedCustomDeckPayload(appState.selectedDeckId);
      appState.mpManager.sendRematch(appState.selectedDeckId, customPayload);
    } else if (appState.gameMode === 'SANDBOX') {
      startSandboxDuel();
    } else {
      startSoloDuel();
    }
  });

  document.getElementById('btn-result-back-lobby')?.addEventListener('click', () => {
    document.getElementById('dialog-duel-result')?.close();
    leaveCurrentDuel();
  });
});
