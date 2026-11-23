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
  resetTurnChangeBannerQueue
} from '/js/cardAnimations.js';
import {
  enableCardDragToPlay,
  shouldSuppressCardClick
} from '/js/dragPlay.js';
import {
  RpsSession,
  pickRandomRpsMove,
  chooseAiTurnOrder
} from '/src/engine/RpsSession.js';

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

// ==================== APPLICATION STATE ====================
const appState = {
  lang: getSavedLanguage(),
  playmatId: getSavedPlaymat(),
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
  lastRpsSeat: null
};

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
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId)?.classList.add('active');
  if (screenId !== 'screen-duel') {
    resetTurnChangeBannerQueue();
  }
  hideActionPopup(true);
  clearZonePickMode(true);
  closeYgoproCardStrip();
  clearChainCardHighlights();
  clearPinnedCmdCards();
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
        restoreBtn.style.marginLeft = '0.4rem';
        restoreBtn.addEventListener('click', () => {
          saveHiddenPresetDeckIds(new Set());
          renderDeckSelector();
          populateAiDeckDropdown();
          showToast('♻️ กู้คืนเด็คที่ลบทั้งหมดแล้ว', 'info');
        });
        countBadge.insertAdjacentElement('afterend', restoreBtn);
      }
      restoreBtn.textContent = `♻️ กู้คืน (${hiddenIds.size})`;
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

  filteredDecks.forEach((deck) => {
    const coverCard = getCardById(deck.coverCardId);
    const cardEl = document.createElement('div');
    const title = getDeckDisplayTitle(deck, lang);
    cardEl.className = `deck-choice-card ${deck.id === appState.selectedDeckId ? 'selected' : ''}`;
    cardEl.dataset.deckId = deck.id;
    cardEl.innerHTML = `
      <button type="button" class="deck-card-delete-btn" title="ลบเด็คนี้" aria-label="ลบเด็ค ${title}">🗑️</button>
      <div class="deck-choice-top">
        <img class="deck-choice-thumb" src="${getCardArtUrl(coverCard)}" alt="${deck.name}" />
        <div style="min-width:0;flex:1;">
          <span class="deck-choice-badge">${deck.badge}</span>
          <div class="deck-choice-title">${title}</div>
        </div>
      </div>
      <div class="deck-choice-diff">${deck.difficulty}</div>
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
      appState.selectedDeckId = deck.id;
      renderDeckSelector();
      renderSelectedDeckSummary();
    });
    container.appendChild(cardEl);
  });

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
        <h3>${title}</h3>
        <p style="font-size:0.82rem;color:#cbd5e1;margin-top:2px;">${summary}</p>
      </div>
      <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;">
        <button type="button" class="btn-outline" id="btn-copy-selected-ydk" title="คัดลอกเด็คนี้เป็นโค้ด YDK ลง Clipboard">📋 Copy YDK</button>
        <button type="button" class="btn-outline" id="btn-copy-selected-ydke" title="คัดลอกเด็คนี้เป็นลิงก์ YDKE (ydke://...) ลง Clipboard">🔗 Copy YDKE</button>
        <button type="button" class="btn-outline" id="btn-inspect-selected-deck">${t(lang, 'inspectDeckBtn')}</button>
        <button type="button" class="btn-outline" id="btn-delete-selected-deck" style="border-color:#ef4444;color:#fca5a5;">🗑️ ลบเด็ค</button>
      </div>
    </div>
    <ul class="combo-steps-list">
      ${guide.map(step => `<li>${step}</li>`).join('')}
    </ul>
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

  for (const item of allItems) {
    const card = getCardById(item.id);
    if (!card) continue;
    const cardName = getLocalizedCardName(card, lang);
    const cardDesc = getLocalizedCardDesc(card, lang);
    const box = document.createElement('div');
    box.className = 'browser-card-box';
    box.innerHTML = `
      <div style="display:flex;gap:0.55rem;align-items:center;">
        <img src="${getCardArtUrl(card)}" alt="${card.name}" style="width:50px;height:50px;border-radius:6px;object-fit:cover;" />
        <div>
          <div style="font-size:0.7rem;color:#38bdf8;font-weight:700;">${item.section} ×${item.count}</div>
          <div style="font-size:0.84rem;font-weight:800;color:#facc15;">${cardName}</div>
          <div style="font-size:0.72rem;color:#94a3b8;">${getCardSubHeaderBadge(card, lang)}</div>
        </div>
      </div>
      <div style="font-size:0.76rem;color:#e2e8f0;line-height:1.4;">${cardDesc}</div>
    `;
    const img = box.querySelector('img');
    img.addEventListener('error', () => {
      img.src = generateProceduralCardSvg(card);
    }, { once: true });
    grid.appendChild(box);
  }

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
          link.style.color = '#38bdf8';
          link.textContent = `🔗 ${publicUrl}`;
          row.appendChild(link);
          urlListEl.appendChild(row);
        }
        if (qrBox) {
          qrBox.innerHTML = '';
          const qrImg = document.createElement('img');
          qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(publicUrl)}`;
          qrImg.alt = 'QR Code';
          qrBox.appendChild(qrImg);
        }
      } else if (info.ips && info.ips.length > 0) {
        const primaryUrl = info.ips[0].url;
        appState.primaryShareUrl = primaryUrl;
        if (lanLabelEl) {
          lanLabelEl.textContent = appState.lang === 'en'
            ? '📱 Same-Wi-Fi (LAN) Share Link:'
            : '📱 ลิงก์เล่นด้วยกันบน Wi-Fi เดียวกัน (LAN):';
        }
        if (lanHintEl) {
          lanHintEl.textContent = appState.lang === 'en'
            ? '⚠️ Same Wi-Fi / Hotspot only. For Cross-Wi-Fi, switch to Mode 2 (P2P Online) or use a public HTTPS tunnel.'
            : '⚠️ ใช้ได้เฉพาะ Wi-Fi / Hotspot เดียวกัน — หากอยู่คนละ Wi-Fi ให้ใช้ Mode 2 (P2P Online) หรือรันผ่าน Public HTTPS Tunnel';
        }
        if (urlListEl) {
          urlListEl.innerHTML = '';
          info.ips.forEach((ip) => {
            const row = document.createElement('div');
            const link = document.createElement('a');
            link.href = ip.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.style.color = '#38bdf8';
            const ifaceLabel = ip.interface || ip.iface;
            link.textContent = `🔗 ${ip.url}${ifaceLabel ? ` (${ifaceLabel})` : ''}`;
            row.appendChild(link);
            urlListEl.appendChild(row);
          });
        }
        if (qrBox) {
          qrBox.innerHTML = '';
          const qrImg = document.createElement('img');
          qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(primaryUrl)}`;
          qrImg.alt = 'QR Code';
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
  if (!openRooms || openRooms.length === 0) {
    listEl.innerHTML = `<div class="empty-rooms-text">ยังไม่มีห้องที่เปิดรอ — กด "➕ สร้างห้องดวลใหม่" เพื่อให้เพื่อนกดเข้าร่วมได้เลย!</div>`;
    return;
  }

  listEl.innerHTML = '';
  for (const r of openRooms) {
    const deck = getPresetDeckById(r.hostDeckId);
    const row = document.createElement('div');
    row.className = 'open-room-item';
    row.innerHTML = `
      <div>
        <strong>ห้อง #${r.code}</strong> — โฮสต์: <span style="color:#38bdf8">${r.hostName}</span>
        <span style="color:#94a3b8;font-size:0.75rem;">(${deck?.nameTh || 'Custom Deck'})</span>
      </div>
      <button type="button" class="btn-gold btn-mini">เข้าร่วมทันที</button>
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
      appState.lastRenderedState = null;
      appState.lastRenderedPlayerIndex = playerIndex;
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
  appState.lastRenderedState = null;
  appState.lastRenderedPlayerIndex = appState.myPlayerIndex;
  resetTurnChangeBannerQueue();

  const dlg = document.getElementById('dialog-rps');
  if (dlg?.open) closeTopLayer(dlg);

  appState.mpManager.startSoloDuel({
    playerName: ctx.playerName,
    playerDeckId: ctx.playerDeckId,
    aiDeckId: ctx.aiDeckId,
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
  appState.lastRenderedState = null;
  appState.lastRenderedPlayerIndex = appState.myPlayerIndex;
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

// ==================== STARTING DUELS (SOLO & SANDBOX VIA RPS) ====================
function startSoloDuel() {
  clearRpsTimers();
  const playerName = document.getElementById('input-player-name').value.trim() || 'Player 1';
  const aiDeckId = resolveOpponentDeckId();
  const aiName = appState.lang === 'en' ? 'YGOPro AI' : 'YGOPro AI';
  const customPayload = buildSelectedCustomDeckPayload(appState.selectedDeckId);

  const session = new RpsSession([playerName, aiName]);
  session.submitMove(1, pickRandomRpsMove());

  appState.rpsContext = {
    kind: 'SOLO',
    session,
    playerName,
    playerDeckId: appState.selectedDeckId,
    aiDeckId,
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
      const aiChainMove = AIPlayer.chooseNextAction(engine, 1);
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
      const aiMove = AIPlayer.chooseNextAction(engine, 1);
      if (aiMove) {
        engine.executeAction(1, aiMove);
        syncLocalEngineToUI();
      }
    }, 620);
  }
}

function dispatchDuelAction(actionPayload) {
  hideActionPopup(true);
  clearZonePickMode(true);

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
        <div style="display:flex;gap:0.55rem;align-items:center;">
          <img src="${getCardArtUrl(candidate)}" alt="${candidate.name}" style="width:48px;height:48px;border-radius:6px;object-fit:cover;" />
          <div>
            <div style="font-size:0.84rem;font-weight:800;color:#facc15;">${getLocalizedCardName(candidate, lang)}</div>
            <div style="font-size:0.72rem;color:#38bdf8;">${getCardSubHeaderBadge(candidate, lang)}${candidate.kind === 'MONSTER' ? ` • ATK ${candidate.currentAtk ?? candidate.atk}` : ''}</div>
          </div>
        </div>
        <div style="font-size:0.75rem;color:#cbd5e1;line-height:1.35;">${getLocalizedCardDesc(candidate, lang)}</div>
        <div class="zone-card-actions" style="display:grid;gap:4px;margin-top:auto;"></div>
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
      btn.style.padding = '0.42rem';

      const syncButtonVisual = () => {
        const isSelected = selectedVals.includes(pickedVal);
        box.style.outline = isSelected ? '2px solid #22c55e' : '';
        if (isSelected) {
          btn.textContent = lang === 'en' ? `✅ Selected (${selectedVals.length}/${targetPickCount})` : `✅ เลือกแล้ว (คลิกเพื่อยกเลิก)`;
        } else {
          btn.textContent = lang === 'en' ? `🎯 Select "${candidate.name}"` : `🎯 เลือก "${candidate.nameTh}"`;
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

const CARD_ACTION_PACE_MS = 1000;
const stateSyncPacer = {
  queue: [],
  timer: null,
  lastApplyAt: 0,
  duelId: null
};

function applyDuelStateSync({ mode, state, playerIndex, legalActions }) {
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
  appState.activeOcgPrompt =
    state?.pendingOcgPrompt && state.pendingOcgPrompt.player === playerIndex
      ? state.pendingOcgPrompt
      : null;
  renderDuelScreen();
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
  if (stateSyncPacer.timer || stateSyncPacer.queue.length === 0) return;
  const elapsed = Date.now() - stateSyncPacer.lastApplyAt;
  const waitMs = Math.max(0, CARD_ACTION_PACE_MS - elapsed);
  const runNext = () => {
    stateSyncPacer.timer = null;
    const next = stateSyncPacer.queue.shift();
    if (!next) return;
    stateSyncPacer.lastApplyAt = Date.now();
    applyDuelStateSync(next);
    if (stateSyncPacer.queue.length > 0) {
      pumpStateSyncQueue();
    }
  };
  if (waitMs === 0) {
    runNext();
  } else {
    stateSyncPacer.timer = setTimeout(runNext, waitMs);
  }
}

function enqueuePacedStateSync(payload) {
  const incomingDuelId = payload?.state?.duelId || null;
  const isNewDuel = !appState.currentState || (incomingDuelId && stateSyncPacer.duelId !== incomingDuelId);
  if (isNewDuel) {
    if (stateSyncPacer.timer) {
      clearTimeout(stateSyncPacer.timer);
      stateSyncPacer.timer = null;
    }
    stateSyncPacer.queue = [];
    stateSyncPacer.duelId = incomingDuelId;
    stateSyncPacer.lastApplyAt = Date.now();
    applyDuelStateSync(payload);
    return;
  }
  // Keep queue bounded so rapid bursts never lag behind indefinitely
  if (stateSyncPacer.queue.length >= 30) {
    stateSyncPacer.queue.splice(0, stateSyncPacer.queue.length - 29);
  }
  stateSyncPacer.queue.push(payload);
  pumpStateSyncQueue();
}

// ==================== DUEL SCREEN RENDERING ====================
function renderDuelScreen() {
  const state = appState.currentState;
  if (!state) return;

  const myIdx = appState.myPlayerIndex;
  const oppIdx = 1 - myIdx;
  const isDuelVisible = document.getElementById('screen-duel')?.classList.contains('active');
  let prevSnapshot = null;
  if (isDuelVisible) {
    if (appState.lastRenderedState && appState.lastRenderedPlayerIndex === myIdx) {
      prevSnapshot = captureBoardSnapshot(appState.lastRenderedState, myIdx);
    } else if (!appState.lastRenderedState) {
      const initialSnap = captureBoardSnapshot(state, myIdx);
      if (initialSnap) {
        prevSnapshot = {
          ...initialSnap,
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

  // 1. Update Player & Opponent HUDs
  document.getElementById('self-name').textContent = me.name;
  document.getElementById('self-lp-value').textContent = me.lp;
  document.getElementById('self-deck-count').textContent = me.deck.length;
  document.getElementById('self-gy-count').textContent = me.gy.length;
  document.getElementById('self-banished-count').textContent = me.banished.length;
  document.getElementById('self-extra-count').textContent = me.extra.length;

  document.getElementById('opp-name').textContent = opp.name;
  document.getElementById('opp-lp-value').textContent = opp.lp;
  document.getElementById('opp-deck-count').textContent = opp.deck.length;
  document.getElementById('opp-extra-count').textContent = opp.extra.length;
  renderChainStackOverlay(state.chainStack || [], myIdx);
  const oppDeckMat = document.getElementById('opp-deck-mat-count');
  const oppExtraMat = document.getElementById('opp-extra-mat-count');
  if (oppDeckMat) oppDeckMat.textContent = opp.deck.length;
  if (oppExtraMat) oppExtraMat.textContent = opp.extra.length;
  document.getElementById('opp-gy-count').textContent = opp.gy.length;
  document.getElementById('opp-banished-count').textContent = opp.banished.length;
  const oppGyMat = document.getElementById('opp-gy-mat-count');
  const oppBanMat = document.getElementById('opp-banished-mat-count');
  if (oppGyMat) oppGyMat.textContent = opp.gy.length;
  if (oppBanMat) oppBanMat.textContent = opp.banished.length;

  // Opponent Hand Backs
  const oppHandBar = document.getElementById('opp-hand-bar');
  oppHandBar.innerHTML = '';
  for (let i = 0; i < opp.hand.length; i++) {
    const back = document.createElement('div');
    back.className = 'opp-hand-card-back';
    oppHandBar.appendChild(back);
  }

  // Highlight Extra Deck, GY & Banished buttons with glowing circular ring if they have legal actions!
  const extraBtn = document.getElementById('btn-self-extra');
  if (Object.keys(legal.extraActions || {}).length > 0) {
    extraBtn.classList.add('playable-glow');
  } else {
    extraBtn.classList.remove('playable-glow');
  }

  const gyBtn = document.getElementById('btn-self-gy');
  const hasGyActs = Object.keys(legal.gyActions || {}).length > 0;
  gyBtn.classList.toggle('playable-glow', hasGyActs);
  gyBtn.classList.toggle('zone-effect-active', hasGyActs);

  const banishedBtn = document.getElementById('btn-self-banished');
  const hasBanishedActs = Object.keys(legal.banishedActions || {}).length > 0;
  banishedBtn?.classList.toggle('playable-glow', hasBanishedActs);
  banishedBtn?.classList.toggle('zone-effect-active', hasBanishedActs);

  // 2. Update Phase Orb, Turn Elapsed Indicator & Action Buttons
  const isMyTurn = state.turnPlayer === myIdx;
  const lang = appState.lang;
  const elapsedTurns = Math.max(0, state.turnCount - 1);
  const turnPill = document.getElementById('turn-indicator-pill');
  const shortPhaseNames = { DP: 'Draw', SP: 'Standby', MP1: 'Main 1', BP: 'Battle', MP2: 'Main 2', EP: 'End' };
  turnPill.innerHTML = `<span class="orb-turn-num">Turn ${state.turnCount}</span><span class="orb-phase-name">${shortPhaseNames[state.phase] || state.phase}</span><span class="orb-turn-owner">${t(lang, isMyTurn ? 'yourTurn' : 'oppTurn')}</span>`;
  turnPill.classList.toggle('opp-turn-orb', !isMyTurn);

  const phaseTurnHeader = document.getElementById('phase-turn-header');
  if (phaseTurnHeader) {
    phaseTurnHeader.textContent = `T${state.turnCount}`;
    phaseTurnHeader.title = lang === 'en'
      ? `Turn ${state.turnCount} (${elapsedTurns} turns elapsed)`
      : `เทิร์นที่ ${state.turnCount} (ผ่านมาแล้ว ${elapsedTurns} เทิร์น)`;
  }

  const turnElapsedPill = document.getElementById('turn-elapsed-pill');
  if (turnElapsedPill) {
    turnElapsedPill.textContent = lang === 'en'
      ? `⏳ Turn ${state.turnCount} (${elapsedTurns} elapsed)`
      : `⏳ เทิร์นที่ ${state.turnCount} (ผ่านมา ${elapsedTurns} เทิร์น)`;
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

  btnGoBattle.classList.toggle('hidden', !isMyTurn || !(legal.canBattlePhase ?? (state.phase === PHASES.MP1 && state.turnCount > 1)));
  btnGoMp2.classList.toggle('hidden', !isMyTurn || !(legal.canMainPhase2 ?? (state.phase === PHASES.BP)));
  btnEndTurn.disabled = !isMyTurn || legal.canEndTurn === false;

  // Chain Mode Button
  const chainToggleBtn = document.getElementById('btn-chain-toggle');
  document.getElementById('chain-mode-text').textContent = me.chainMode;
  chainToggleBtn.className = `btn-chain-toggle chain-${me.chainMode.toLowerCase()}`;

  // 3. Render Playmat Zones (Opponent & Player)
  renderFiveZonesGrid('opp-stz-grid', opp.stz, false, legal, 'STZ');
  renderFiveZonesGrid('opp-mmz-grid', opp.mmz, false, legal, 'MMZ');
  renderSingleSlot('opp-field-spell-slot', opp.fieldSpell, false, legal, lang === 'en' ? 'Field Spell' : 'เวทสนาม');
  const leftEmzEntry = me.emzSlots
    ? (me.emzSlots[0] ? { card: me.emzSlots[0], isSelf: true } : opp.emzSlots?.[1] ? { card: opp.emzSlots[1], isSelf: false } : null)
    : (me.emz ? { card: me.emz, isSelf: true } : null);
  const rightEmzEntry = me.emzSlots
    ? (me.emzSlots[1] ? { card: me.emzSlots[1], isSelf: true } : opp.emzSlots?.[0] ? { card: opp.emzSlots[0], isSelf: false } : null)
    : (opp.emz ? { card: opp.emz, isSelf: false } : null);
  renderSingleSlot('opp-emz-slot', rightEmzEntry?.card || null, Boolean(rightEmzEntry?.isSelf), legal, lang === 'en' ? 'Right EMZ' : 'EMZ ขวา');

  renderSingleSlot('self-emz-slot', leftEmzEntry?.card || null, Boolean(leftEmzEntry?.isSelf), legal, lang === 'en' ? 'Left EMZ' : 'EMZ ซ้าย');
  renderSingleSlot('self-field-spell-slot', me.fieldSpell, true, legal, lang === 'en' ? 'Field Spell' : 'เวทสนาม');
  renderFiveZonesGrid('self-mmz-grid', me.mmz, true, legal, 'MMZ');
  renderFiveZonesGrid('self-stz-grid', me.stz, true, legal, 'STZ');

  // 3b. Render Equip Card Links & Glowing Arrows
  requestAnimationFrame(() => renderEquipArrows(state));

  // 4. Render Player Hand
  const handContainer = document.getElementById('self-hand-container');
  handContainer.innerHTML = '';
  for (const card of me.hand) {
    const cardActions = legal.handActions?.[card.instanceId] || [];
    const canActivate = cardActions.some(
      a => a.type === 'ACTIVATE_EFFECT' || a.type === 'ACTIVATE_SPELL' || a.type === 'ACTIVATE_TRAP'
    );
    const el = createCardElement(card, {
      isFaceDown: false,
      isPlayable: cardActions.length > 0,
      isActivatable: canActivate,
      extraClass: 'hand-card-item'
    });
    attachYgoProCardInteraction(el, card, cardActions, {
      attackInfo: null,
      isFaceDown: false
    });
    handContainer.appendChild(el);
  }

  // 5. Render Duel Logs & Combo Guide in Sidebar
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
    chainBar?.classList.add('hidden');
  }

  // 6b. Opponent Response / Chain Priority Glowing Aura
  const isOppResponding = state.winner === null && Boolean(
    state.pendingChainPrompt && state.pendingChainPrompt.responderIndex === oppIdx
  );
  document.getElementById('playmat-container')?.classList.toggle('opp-response-aura', isOppResponding);
  document.querySelector('.opponent-hud')?.classList.toggle('opp-response-aura', isOppResponding);

  // 7. Check Win Condition Banner
  const resDlg = document.getElementById('dialog-duel-result');
  if (state.winner !== null) {
    const isWin = state.winner === myIdx;
    document.getElementById('result-badge-icon').textContent = isWin ? '🏆' : '💔';
    document.getElementById('duel-result-title').textContent = isWin ? 'VICTORY — คุณชนะการดูเอล!' : 'DEFEAT — พ่ายแพ้การดูเอล';
    document.getElementById('duel-result-reason').textContent = state.winReasonTh || '';
    if (!resDlg.open) resDlg.showModal();
  } else if (resDlg.open) {
    resDlg.close();
  }

  // 8. Play smooth Master Duel card & battle diff animations
  if (prevSnapshot) {
    try {
      playBoardDiffAnimations(prevSnapshot, state, myIdx);
    } catch (animErr) {
      console.warn('[Animation] Deferred VFX error:', animErr);
    }
  }
  if (isDuelVisible) {
    enqueueTurnChangeBanners(appState.lastRenderedState, state, myIdx);
  }
  appState.lastRenderedState = structuredClone(state);
  appState.lastRenderedPlayerIndex = myIdx;
}

function renderEquipArrows(state) {
  const playmat = document.getElementById('playmat-container');
  if (!playmat || !state?.players) return;

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

function renderFiveZonesGrid(gridId, slotsArray, isSelf, legal, zoneType) {
  const grid = document.getElementById(gridId);
  grid.innerHTML = '';
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
        isAtkReady
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
          if (!isFaceDown) inspectCard(card);
        });
      }

      slotEl.appendChild(cardEl);
    }

    grid.appendChild(slotEl);
  }
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
  if (act.type === 'DECLARE_ATTACK') return isEn ? '⚔️ Attack' : '⚔️ โจมตี';
  if (act.isPendulumScale) return isEn ? 'Scale' : 'เพนดูลัม';
  if (act.type === 'ACTIVATE_EFFECT' || act.type === 'ACTIVATE_SPELL' || act.type === 'ACTIVATE_TRAP') {
    const actCount = allActions.filter(
      a => a.type === 'ACTIVATE_EFFECT' || a.type === 'ACTIVATE_SPELL' || a.type === 'ACTIVATE_TRAP'
    ).length;
    if (actCount > 1) {
      return (isEn ? (act.label || act.labelTh) : (act.labelTh || act.label)) || (isEn ? 'Activate' : 'เปิดใช้');
    }
    return isEn ? 'Activate' : 'เปิดใช้';
  }
  return (isEn ? (act.label || act.labelTh) : (act.labelTh || act.label)) || 'Act';
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
      btn.title = lang === 'en' ? (act.label || act.labelTh || '') : (act.labelTh || act.label || '');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearPinnedCmdCards();
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
    if (actionItems.length > 0) {
      const wasPinned = el.classList.contains('cmds-pinned');
      clearPinnedCmdCards();
      if (!wasPinned) {
        el.classList.add('cmds-pinned');
      }
    } else {
      clearPinnedCmdCards();
    }
  });
}

function buildFieldCardActions(card, fieldActs, atkInfo) {
  const items = [...(fieldActs || [])];
  if (atkInfo && !Array.isArray(atkInfo)) {
    if (atkInfo.canDirectAttack) {
      items.push({
        type: 'DECLARE_ATTACK',
        attackerInstanceId: card.instanceId,
        directAttack: true,
        labelTh: '⚔️ โจมตีผู้เล่นโดยตรง (Direct Attack)!'
      });
    }
    const oppIdx = 1 - appState.myPlayerIndex;
    const oppMons = appState.currentState.players[oppIdx].mmz
      .concat(appState.currentState.players[oppIdx].emz)
      .filter(Boolean);
    for (const t of oppMons) {
      const targetTitle = t.position === POSITIONS.SET_DEF
        ? 'มอนสเตอร์ที่หมอบอยู่'
        : `${t.nameTh} (${t.position === POSITIONS.ATK ? `${t.currentAtk} ATK` : `${t.currentDef} DEF`})`;
      items.push({
        type: 'DECLARE_ATTACK',
        attackerInstanceId: card.instanceId,
        targetInstanceId: t.instanceId,
        labelTh: `⚔️ โจมตี: ${targetTitle}`
      });
    }
  }
  return items;
}

function renderSingleSlot(slotId, card, isSelf, legal, label) {
  const slotEl = document.getElementById(slotId);
  slotEl.innerHTML = '';
  slotEl.setAttribute('data-slot-label', label);

  if (!card) {
    return;
  }

  const isFaceDown = !isSelf && (card.position === POSITIONS.SET || card.position === POSITIONS.SET_DEF);
  const fieldActs = isSelf ? (legal.fieldActions?.[card.instanceId] || []) : [];
  const atkInfo = isSelf ? legal.attackTargets?.[card.instanceId] : null;

  const cardEl = createCardElement(card, {
    isFaceDown,
    isPlayable: fieldActs.length > 0,
    isAtkReady: Boolean(atkInfo)
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
      if (!isFaceDown) inspectCard(card);
    });
  }

  slotEl.appendChild(cardEl);
}

function createCardElement(card, options = {}) {
  const { isFaceDown = false, isPlayable = false, isActivatable = false, isAtkReady = false, extraClass = '' } = options;
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
  const chainEntry = (appState.currentState?.chainStack || []).find(
    item => item.card && item.card.instanceId === card.instanceId
  );
  const chainBadgeHtml = chainEntry
    ? `<div class="chain-link-badge" title="Chain Link ${chainEntry.chainLink}" aria-label="Chain Link ${chainEntry.chainLink}"><span class="chain-link-icon">⛓️</span><span class="chain-link-num">${chainEntry.chainLink}</span></div>`
    : '';

  el.className = [
    'duel-card',
    frameClass,
    extraClass,
    isDef ? 'def-position' : '',
    (isFaceDown || isSetOwn) && isFaceDown ? 'face-down' : '',
    !isFaceDown && isSetOwn ? 'set-own' : '',
    chainEntry ? 'in-chain' : '',
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
      <span class="card-mini-title">${isSetOwn ? '🂠 ' : ''}${cardName}</span>
      <span class="card-attr-orb" style="background:${attrMeta.bg};color:${attrMeta.color}" title="${appState.lang === 'en' ? attrMeta.nameEn : attrMeta.nameTh}">${attrMeta.badge}</span>
    </div>
    <div class="card-mini-art-frame">
      <img class="card-mini-art" src="${getCardArtUrl(card)}" alt="${cardName}" draggable="false" />
      ${isSetOwn ? '<span class="set-card-back-indicator" title="คว่ำ (Set)" aria-label="Face-down set card"></span>' : ''}
      ${cardKind === 'MONSTER' ? `<span class="card-lv-tag ${card.frame === 'XYZ' ? 'lv-xyz' : ''}">${rankOrLv}</span>` : ''}
    </div>
    <div class="card-mini-footer">
      <span class="card-stats-pair">${statsHtml}</span>
    </div>
    ${card.effectsNegated ? `<div class="negated-badge">${appState.lang === 'en' ? '🔇 Negated' : '🔇 ใบ้เอฟเฟค'}</div>` : ''}
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
    wrap.innerHTML = `<p style="color:#e2e8f0;font-size:0.95rem;">${prompt.description || 'Do you want to activate this effect?'}</p>`;
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
      btn.textContent = opt.label || `Option ${opt.index + 1}`;
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
        <img class="ocg-card-choice-img" src="${getCardArtUrl(cardRef)}" alt="${c.name}" />
        <span class="ocg-card-choice-zone">${prefix}${ownerTag}${c.zone}</span>
        <span class="ocg-card-choice-name">${c.name}</span>
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
        <img class="ocg-card-choice-img" src="${getCardArtUrl(cardRef)}" alt="${c.name}" />
        <span class="ocg-card-choice-zone">${prefix}${c.zone}</span>
        <span class="ocg-card-choice-name">${c.name}</span>
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
    input.placeholder = 'Search card name or passcode...';
    input.style.cssText = 'padding:8px 12px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#f8fafc;';
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

function inspectCard(card) {
  if (!card) return;
  appState.lastInspectedCard = card;
  const pane = document.getElementById('inspector-content');
  const lang = appState.lang;
  const badge = getCardSubHeaderBadge(card, lang);
  const frameClass = getCardFrameClass(card);
  const attrMeta = getAttributeMeta(card);
  const statsLine = card.kind === 'MONSTER'
    ? `<span class="stat-chip stat-atk">ATK ${card.currentAtk ?? card.atk}</span>
       ${card.frame !== 'LINK' ? `<span class="stat-chip stat-def">DEF ${card.currentDef ?? card.def}</span>` : ''}
       <span class="stat-chip">${lang === 'en' ? 'Type' : 'เผ่า'}: ${card.race}</span>
       <span class="stat-chip" style="border-color:${attrMeta.bg}">${attrMeta.badge} ${lang === 'en' ? attrMeta.nameEn : attrMeta.nameTh}</span>`
    : `<span class="stat-chip">${attrMeta.badge} ${badge}</span>`;

  const previewLevel = card.kind === 'MONSTER'
    ? (card.frame === 'XYZ' ? `R${card.rank}` : card.frame === 'LINK' ? `L${card.linkRating}` : `★${card.currentLevel ?? card.level}`)
    : (card.kind === 'SPELL' ? 'SPELL' : 'TRAP');

  pane.innerHTML = `
    <div class="inspected-card-view">
      <div class="inspected-art-wrap">
        <div class="inspector-card-frame ${frameClass}">
          <div class="insp-frame-head">
            <span class="insp-frame-name">${getLocalizedCardName(card, lang)}</span>
            <span class="card-attr-orb" style="background:${attrMeta.bg};color:${attrMeta.color}">${attrMeta.badge}</span>
          </div>
          <div class="insp-frame-sub">${previewLevel}</div>
          <div class="insp-frame-art-box">
            <img class="inspected-art" src="${getCardArtUrl(card)}" alt="${card.name}" />
          </div>
          <div class="insp-frame-foot">
            ${card.kind === 'MONSTER'
              ? `<span>ATK/${card.currentAtk ?? card.atk}</span><span>${card.frame === 'LINK' ? `LINK-${card.linkRating}` : `DEF/${card.currentDef ?? card.def}`}</span>`
              : `<span>[${badge}]</span>`}
          </div>
        </div>
        <div class="inspected-meta-col">
          <div class="inspected-title-th">${getLocalizedCardName(card, lang)}</div>
          <div class="inspected-title-en">${lang === 'en' ? card.nameTh : card.name}</div>
          <div class="inspected-sub-badge">${badge}</div>
        </div>
      </div>
      <div class="inspected-stats-badges">${statsLine}</div>
      ${(lang === 'en' ? (card.summonMaterials?.description || card.summonMaterials?.descriptionTh) : card.summonMaterials?.descriptionTh)
        ? `<div class="inspected-summon-box"><strong>${t(lang, 'summonCond')}</strong> ${lang === 'en' ? (card.summonMaterials.description || card.summonMaterials.descriptionTh) : card.summonMaterials.descriptionTh}</div>`
        : ''}
      <div class="inspected-desc-box">
        <div class="inspected-desc-head">${t(lang, 'effectHeader')}</div>
        <div id="inspected-desc-main">${getLocalizedCardDesc(card, lang)}</div>
        ${lang === 'th' && card.description ? `<hr class="inspected-hr"/><div class="inspected-desc-en">${card.description}</div>` : ''}
      </div>
    </div>
  `;

  if (lang === 'th' && card.description) {
    const descEl = document.getElementById('inspected-desc-main');
    translateTextWithGoogle(card.description).then((translated) => {
      if (translated && descEl && appState.lastInspectedCard?.id === card.id && appState.lang === 'th') {
        descEl.textContent = translated;
      }
    });
  }

  const img = pane.querySelector('img');
  img?.addEventListener('error', () => {
    img.src = generateProceduralCardSvg(card);
  }, { once: true });
}

let suppressPopupHideUntil = 0;
let activeZonePickCleanup = null;
let activeZonePickMandatory = false;

function clearZonePickMode(force = false) {
  if (!force && activeZonePickMandatory) return;
  if (activeZonePickCleanup) {
    activeZonePickCleanup();
    activeZonePickCleanup = null;
  }
  activeZonePickMandatory = false;
  const banner = document.getElementById('field-pick-banner');
  if (banner) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    delete banner.dataset.mode;
  }
}

function openInlinePickBanner({
  icon = '⚡',
  message = '',
  headerButtons = [],
  actionButtons = [],
  mandatory = true,
  mode = 'prompt',
  dismissOnOutside = false,
  dismissOnEsc = false
}) {
  clearZonePickMode(true);
  const banner = document.getElementById('field-pick-banner');
  if (!banner) return null;

  activeZonePickMandatory = Boolean(mandatory);
  banner.dataset.mode = mode;
  banner.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'chain-bar-header';
  if (actionButtons.length === 0) {
    head.style.marginBottom = '0';
  }
  const spark = document.createElement('span');
  spark.className = 'chain-spark';
  spark.textContent = icon;
  const msgEl = document.createElement('div');
  msgEl.className = 'chain-trigger-desc field-pick-msg';
  msgEl.textContent = message;
  head.append(spark, msgEl, ...headerButtons);
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
    if (!ev.target.closest('#field-pick-banner')) {
      clearZonePickMode(true);
    }
  };
  if (dismissOnEsc) document.addEventListener('keydown', onEsc);
  if (dismissOnOutside) setTimeout(() => document.addEventListener('click', onDocClick), 0);

  activeZonePickCleanup = () => {
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

function enterOcgOptionBanner(prompt) {
  const lang = appState.lang;
  const opts = prompt.options || [];
  if (opts.length === 0) return false;

  const btns = opts.map((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inline-prompt-btn primary';
    btn.textContent = opt.label || `Option ${opt.index + 1}`;
    btn.onclick = () => sendOcgPromptResponse({ type: 4, index: opt.index });
    return btn;
  });

  return Boolean(openInlinePickBanner({
    icon: '🔀',
    message: lang === 'en' ? 'Choose an option to apply:' : 'เลือกเอฟเฟกต์/ตัวเลือกที่ต้องการ:',
    actionButtons: btns,
    mandatory: true,
    mode: 'ocg-option'
  }));
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
    icon: '🔄',
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
    toggleBtn.textContent = isMin
      ? (lang === 'en' ? '👁️ Show Cards' : '👁️ แสดงการ์ด')
      : (lang === 'en' ? '👁️ View Board' : '👁️ ซ่อนดูสนาม');
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
    if (isChainSort) {
      const autoBtn = document.createElement('button');
      autoBtn.type = 'button';
      autoBtn.className = 'btn btn-secondary btn-mini';
      autoBtn.textContent = lang === 'en' ? '⚡ Auto Order' : '⚡ เรียงอัตโนมัติ';
      autoBtn.onclick = () => sendOcgPromptResponse({ type: 15, order: null });
      headerButtons.push(autoBtn);
    }

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
        ? (lang === 'en' ? 'Order Trigger Chain Links' : 'จัดลำดับเชนเอฟเฟกต์')
        : (lang === 'en' ? 'Sort Cards in Order' : 'เรียงลำดับการ์ด'),
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
    banner.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'chain-bar-header';
    const spark = document.createElement('span');
    spark.className = 'chain-spark';
    spark.textContent = '📍';
    const msgEl = document.createElement('div');
    msgEl.className = 'chain-trigger-desc field-pick-msg';
    head.append(spark, msgEl);
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

  const listeners = [];
  for (const item of candidates) {
    item.el.classList.add('drop-zone-legal', 'zone-pick-target');
    if (item.owner === 'opp') item.el.classList.add('zone-pick-opp');
    item.el.setAttribute('data-drop-hint', lang === 'en' ? '📍 Click Zone' : '📍 ลงช่องนี้');

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
    listeners.push({ el: item.el, onPick });
  }

  activeZonePickCleanup = () => {
    for (const { el, onPick } of listeners) {
      el.classList.remove('drop-zone-legal', 'zone-pick-target', 'zone-pick-opp', 'zone-pick-selected');
      el.removeAttribute('data-drop-hint');
      el.removeEventListener('click', onPick, true);
    }
  };
  return true;
}

function enterZonePickMode(card, actionPayload) {
  clearZonePickMode(true);
  document.getElementById('card-action-popup')?.classList.add('hidden');

  const cardSubtype = card.subType || card.subtype;
  if (cardSubtype === 'FIELD' && (actionPayload.type === 'ACTIVATE_EFFECT' || actionPayload.type === 'SET_SPELL_TRAP')) {
    dispatchDuelAction({ ...actionPayload, targetZoneIndex: 0, targetZoneType: 'FIELD_SPELL' });
    return;
  }

  const isPendulumScale = Boolean(actionPayload.isPendulumScale);
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
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary btn-mini';
  cancelBtn.textContent = lang === 'en' ? '✕ Cancel' : '✕ ยกเลิก';
  cancelBtn.onclick = (ev) => {
    ev.stopPropagation();
    clearZonePickMode(true);
  };

  openInlinePickBanner({
    icon: '📍',
    message: lang === 'en'
      ? `Click a highlighted slot on the field for "${card.name}"`
      : `คลิกเลือกช่องบนสนามสำหรับ "${card.nameTh}"`,
    headerButtons: [cancelBtn],
    mandatory: false,
    mode: 'zone-pick'
  });

  const listeners = [];
  for (const slot of emptySlots) {
    slot.classList.add('drop-zone-legal', 'zone-pick-target');
    slot.setAttribute('data-drop-hint', lang === 'en' ? '📍 Place Here' : '📍 ลงช่องนี้');
    const onPick = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const idx = Number(slot.getAttribute('data-zone-index'));
      clearZonePickMode(true);
      dispatchDuelAction({ ...actionPayload, targetZoneIndex: idx, targetZoneType: isStzGrid ? 'STZ' : 'MMZ' });
    };
    slot.addEventListener('click', onPick, true);
    listeners.push({ slot, onPick });
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
  setTimeout(() => document.addEventListener('click', onDocClick), 0);

  activeZonePickCleanup = () => {
    for (const { slot, onPick } of listeners) {
      slot.classList.remove('drop-zone-legal', 'zone-pick-target');
      slot.removeAttribute('data-drop-hint');
      slot.removeEventListener('click', onPick, true);
    }
    document.removeEventListener('keydown', onEsc);
    document.removeEventListener('click', onDocClick);
  };
}

function executeCardAction(card, act) {
  if (!act) return;
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

function showActionPopupForCard(card, actionItems, _anchorEl) {
  if (!actionItems || actionItems.length === 0) return;
  document.getElementById('card-action-popup')?.classList.add('hidden');

  if (actionItems.length === 1) {
    executeCardAction(card, actionItems[0]);
    return;
  }

  suppressPopupHideUntil = Date.now() + 260;
  const lang = appState.lang;
  const cardTitle = lang === 'en' ? (card.name || card.nameTh) : (card.nameTh || card.name);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-secondary btn-mini';
  closeBtn.textContent = '✕';
  closeBtn.title = lang === 'en' ? 'Close' : 'ปิด';
  closeBtn.onclick = (ev) => {
    ev.stopPropagation();
    clearZonePickMode(true);
  };

  const btns = actionItems.map((act) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inline-prompt-btn primary';
    btn.textContent = lang === 'en' ? (act.label || act.labelTh) : (act.labelTh || act.label);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      executeCardAction(card, act);
    });
    return btn;
  });

  openInlinePickBanner({
    icon: '🃏',
    message: cardTitle,
    headerButtons: [closeBtn],
    actionButtons: btns,
    mandatory: false,
    mode: 'card-actions',
    dismissOnOutside: true,
    dismissOnEsc: true
  });
}

function hideActionPopup(force = false) {
  if (!force && Date.now() < suppressPopupHideUntil) return;
  document.getElementById('card-action-popup')?.classList.add('hidden');
  const banner = document.getElementById('field-pick-banner');
  if (banner?.dataset.mode === 'card-actions') {
    clearZonePickMode(true);
  }
}

function renderDuelLogs(logs) {
  const list = document.getElementById('duel-log-list');
  list.innerHTML = '';
  for (const item of [...logs].reverse()) {
    const cardDef = (item.cardId && getCardById(item.cardId)) || item.cardSnapshot || null;
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
      img.addEventListener('error', () => {
        img.src = generateProceduralCardSvg(cardDef);
      }, { once: true });
      thumbWrap.appendChild(img);
      div.appendChild(thumbWrap);

      div.addEventListener('click', () => {
        inspectCard(cardDef);
        document.querySelector('.insp-tab[data-insp="card"]')?.click();
      });
    }

    const body = document.createElement('div');
    body.className = 'log-entry-body';
    const meta = document.createElement('span');
    meta.className = 'log-turn-tag';
    meta.textContent = `[T${item.turn}-${item.phase}]`;
    const textSpan = document.createElement('span');
    textSpan.className = 'log-entry-text';
    textSpan.textContent = ` ${item.text}`;
    body.appendChild(meta);
    body.appendChild(textSpan);
    div.appendChild(body);

    list.appendChild(div);
  }
}

function renderInDuelComboGuide(deckId) {
  const deck = getPresetDeckById(deckId);
  const pane = document.getElementById('in-duel-combo-guide');
  if (!deck || !pane) return;
  const lang = appState.lang;
  pane.innerHTML = `
    <h4 style="color:#facc15;margin-bottom:6px;">${getDeckDisplayTitle(deck, lang)}</h4>
    <p style="font-size:0.78rem;color:#cbd5e1;margin-bottom:8px;">${getDeckDisplaySummary(deck, lang)}</p>
    <ul class="combo-steps-list">
      ${getDeckDisplayGuide(deck, lang).map(s => `<li>${s}</li>`).join('')}
    </ul>
  `;
}

function renderChainStackOverlay(chainStack, myIdx) {
  const container = document.getElementById('chain-stack-overlay');
  if (!container) return;
  if (!Array.isArray(chainStack) || chainStack.length === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  // Render top-to-bottom in reverse (highest Chain Link on top, CL1 at bottom) or sequential
  const items = [...chainStack].sort((a, b) => b.chainLink - a.chainLink);
  container.innerHTML = `
    <div class="chain-stack-header">⛓️ CHAIN (${chainStack.length})</div>
    <div class="chain-stack-list">
      ${items.map(item => {
        const isYou = item.playerIndex === myIdx;
        const ownerLabel = isYou ? 'You' : 'Opp';
        const card = item.card || {};
        const cardName = getLocalizedCardName(card, appState.lang);
        const effLabel = item.effect?.labelTh || item.effect?.labelEn || '';
        return `
          <div class="chain-stack-item ${isYou ? 'is-you' : 'is-opp'}" title="${cardName}${effLabel ? ` — ${effLabel}` : ''}">
            <div class="chain-stack-owner ${isYou ? 'you' : 'opp'}">${ownerLabel}</div>
            <img class="chain-stack-thumb" src="${getCardArtUrl(card)}" alt="${cardName}" />
            <div class="chain-stack-cl-badge">⛓️ ${item.chainLink}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
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
  const bar = document.getElementById('chain-prompt-bar');
  const descEl = document.getElementById('chain-trigger-desc');
  const passHint = appState.lang === 'en' ? ' (Right-Click to Pass)' : ' (คลิกขวาเพื่อข้าม)';
  if (chainPrompt.isOpenWindow) {
    descEl.innerHTML = appState.lang === 'en'
      ? `⚡ <strong>Open Timing Window</strong> (${chainPrompt.triggerEffectLabelTh}) — Click glowing card or choose below (Chain Link ${chainPrompt.chainLinkNumber})${passHint}:`
      : `⚡ <strong>จังหวะเปิด (Open Timing)</strong> (${chainPrompt.triggerEffectLabelTh}) — คลิกการ์ดที่เรืองแสงหรือเลือกด้านล่าง (<strong>Chain Link ${chainPrompt.chainLinkNumber}</strong>)${passHint}:`;
  } else {
    const isSelfTrigger = chainPrompt.triggerPlayerIndex === appState.myPlayerIndex;
    descEl.innerHTML = appState.lang === 'en'
      ? `${isSelfTrigger ? 'You activated' : 'Opponent activated'} <strong>"${chainPrompt.triggerCardNameTh}"</strong> (${chainPrompt.triggerEffectLabelTh}) — Click glowing card or choose below for <strong>Chain Link ${chainPrompt.chainLinkNumber}</strong>${passHint}:`
      : `${isSelfTrigger ? 'คุณสั่งใช้งาน' : 'อีกฝ่ายสั่งใช้งาน'} <strong>"${chainPrompt.triggerCardNameTh}"</strong> (${chainPrompt.triggerEffectLabelTh}) — คลิกการ์ดที่เรืองแสงหรือเลือกด้านล่างเพื่อเชน <strong>Chain Link ${chainPrompt.chainLinkNumber}</strong>${passHint}:`;
  }

  const list = document.getElementById('chain-options-list');
  list.innerHTML = '';

  const triggerChainItem = (item) => {
    clearChainCardHighlights();
    appState.activeChainPrompt = null;
    bar?.classList.add('hidden');
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

    const cardDef = getCardById(item.cardId) || {
      id: item.cardId,
      passcode: item.passcode,
      name: item.cardName,
      nameTh: item.cardNameTh
    };
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chain-option-btn';
    btn.innerHTML = `
      <img src="${getCardArtUrl(cardDef)}" alt="" style="width:40px;height:40px;border-radius:5px;object-fit:cover;flex-shrink:0;" />
      <div>
        <div style="color:#facc15;font-weight:800;font-size:0.82rem;">⚡ ${item.cardNameTh}</div>
        <div style="font-size:0.72rem;color:#cbd5e1;">${item.labelTh}</div>
      </div>
    `;
    const img = btn.querySelector('img');
    img?.addEventListener('error', () => {
      img.src = generateProceduralCardSvg(cardDef);
    }, { once: true });
    btn.addEventListener('mouseenter', () => inspectCard(cardDef));
    btn.addEventListener('click', () => triggerChainItem(item));
    list.appendChild(btn);
  }

  // Highlight & wire live hand/field cards directly like YGOPro
  const listeners = [];
  for (const [instId, items] of byInstance.entries()) {
    const el = document.querySelector(`.duel-card[data-instance-id="${instId}"]`);
    if (!el) continue;
    el.classList.add('chain-pick-target');
    el.setAttribute('data-pick-badge', '⛓️');
    const onPick = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      if (items.length === 1) {
        triggerChainItem(items[0]);
      } else {
        bar?.scrollIntoView({ block: 'nearest' });
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
  closeBtn.textContent = lang === 'en' ? '✕ Close' : '✕ ปิด';
  closeBtn.onclick = (ev) => {
    ev.stopPropagation();
    closeYgoproCardStrip();
  };

  const track = document.createElement('div');
  track.className = 'ygopro-strip-track';

  if (!cardsList || cardsList.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'color:#94a3b8;font-size:0.84rem;padding:0.75rem 0.4rem;';
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
      <div style="display:flex;align-items:center;gap:0.4rem;">
        <img src="${getCardArtUrl(m)}" alt="${m.name}" style="width:36px;height:36px;border-radius:4px;object-fit:cover;" />
        <div style="font-size:0.75rem;color:#e2e8f0;">
          <div style="font-weight:700;color:#facc15;">${getLocalizedCardName(m, lang)}</div>
          <div style="font-size:0.68rem;color:#38bdf8;">${getCardSubHeaderBadge(m, lang)} • ${m.zone}${m.zone === 'MMZ' ? `#${(m.zoneIndex ?? 0) + 1}` : ''}</div>
        </div>
      </div>
    `).join('');
    box.innerHTML = `
      <div style="font-size:0.78rem;font-weight:800;color:#38bdf8;margin-bottom:0.35rem;">${lang === 'en' ? `Combination #${idx + 1}` : `รูปแบบที่ ${idx + 1}`}: ${matNames}</div>
      <div style="display:grid;gap:0.35rem;margin-bottom:0.5rem;">${thumbsHtml}</div>
      <div class="zone-card-actions" style="display:grid;gap:4px;margin-top:auto;"></div>
    `;
    box.querySelectorAll('img').forEach((img, mIdx) => {
      img.addEventListener('error', () => {
        img.src = generateProceduralCardSvg(combo[mIdx]);
      }, { once: true });
    });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-gold btn-mini';
    btn.style.padding = '0.42rem';
    btn.textContent = lang === 'en' ? `⚡ Summon using Combo #${idx + 1}` : `⚡ อัญเชิญด้วยวัตถุดิบชุดนี้`;
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

function applyLanguage() {
  const lang = appState.lang;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(lang, key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(lang, key));
  });
  const langBtn = document.getElementById('btn-toggle-lang');
  if (langBtn) langBtn.textContent = t(lang, 'langBtn');

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
  updateMpTabUI();
  const lanLabelEl = document.getElementById('lan-box-label');
  const lanHintEl = document.getElementById('lan-scope-hint');
  const wsTabEl = document.getElementById('tab-mp-ws');
  const p2pTabEl = document.getElementById('tab-mp-p2p');
  const isLocalOrigin = isPrivateOrLocalHost(window.location.hostname);
  if (!isLocalOrigin) {
    if (wsTabEl) {
      wsTabEl.textContent = lang === 'en'
        ? '🌍 Cloud Online — Cross-Wi-Fi / 4G (Recommended)'
        : '🌍 ออนไลน์ข้าม Wi-Fi / 4G (Cloud Server — แนะนำ)';
    }
    if (p2pTabEl) {
      p2pTabEl.textContent = lang === 'en'
        ? '⚡ Direct P2P (Fallback)'
        : '⚡ โหมด P2P สำรอง';
    }
  }
  if (lanLabelEl && lanHintEl) {
    if (!isLocalOrigin) {
      lanLabelEl.textContent = lang === 'en'
        ? '🌍 Public / Cross-Wi-Fi Server URL:'
        : '🌍 ลิงก์เข้าเล่นข้าม Wi-Fi / 4G (Public URL):';
      lanHintEl.textContent = lang === 'en'
        ? 'Anyone on any Wi-Fi or cellular network can open this URL and play via Mode 1.'
        : 'เพื่อนอยู่คนละ Wi-Fi หรือ 4G เปิดลิงก์นี้แล้วเข้า Mode 1 ได้ทันที';
    } else {
      lanLabelEl.textContent = lang === 'en'
        ? '📱 Same-Wi-Fi (LAN) Share Link:'
        : '📱 ลิงก์เล่นด้วยกันบน Wi-Fi เดียวกัน (LAN):';
      lanHintEl.textContent = lang === 'en'
        ? '⚠️ Same Wi-Fi / Hotspot only. For Cross-Wi-Fi, switch to Mode 2 (P2P Online) or use a public HTTPS tunnel.'
        : '⚠️ ใช้ได้เฉพาะ Wi-Fi / Hotspot เดียวกัน — หากอยู่คนละ Wi-Fi ให้ใช้ Mode 2 (P2P Online) หรือรันผ่าน Public HTTPS Tunnel';
    }
  }
  if (appState.rpsContext) {
    renderRpsModal();
  }
}

function setupMobileFieldZoom() {
  const zoomBtn = document.getElementById('btn-mobile-field-zoom');
  const playmat = document.getElementById('playmat-container');
  if (!zoomBtn || !playmat) return;

  const scales = ['auto', '85', '75'];
  const applyScale = (scale) => {
    const clean = scales.includes(scale) ? scale : 'auto';
    if (clean === 'auto') {
      playmat.removeAttribute('data-field-scale');
      zoomBtn.textContent = '🔍 Auto';
    } else {
      playmat.setAttribute('data-field-scale', clean);
      zoomBtn.textContent = `🔍 ${clean}%`;
    }
    try {
      localStorage.setItem('ygo_md_mobile_zoom', clean);
    } catch {
      // ignore storage failure
    }
  };

  let saved = 'auto';
  try {
    saved = localStorage.getItem('ygo_md_mobile_zoom') || 'auto';
  } catch {
    saved = 'auto';
  }
  applyScale(saved);

  zoomBtn.addEventListener('click', () => {
    const current = playmat.getAttribute('data-field-scale') || 'auto';
    const nextIdx = (scales.indexOf(current) + 1) % scales.length;
    applyScale(scales[nextIdx]);
    if (appState.lastRenderedState) {
      requestAnimationFrame(() => renderEquipArrows(appState.lastRenderedState));
    }
  });

  window.addEventListener('resize', () => {
    if (appState.lastRenderedState) {
      requestAnimationFrame(() => renderEquipArrows(appState.lastRenderedState));
    }
  });
}

// ==================== INITIALIZATION & EVENT BINDINGS ====================
window.addEventListener('DOMContentLoaded', () => {
  setupDialogs();
  setupRpsDialogBindings();
  setupMobileFieldZoom();
  populateAiDeckDropdown();
  renderDeckSelector();
  applyLanguage();
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
  document.getElementById('btn-toggle-lang')?.addEventListener('click', () => {
    appState.lang = appState.lang === 'th' ? 'en' : 'th';
    saveLanguage(appState.lang);
    applyLanguage();
    showToast(appState.lang === 'en' ? '🌐 Language switched to English' : '🌐 เปลี่ยนภาษาเป็นภาษาไทยแล้ว');
  });

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
  document.getElementById('btn-leave-duel')?.addEventListener('click', () => {
    clearTimeout(appState.aiTimer);
    if (appState.gameMode === 'MULTIPLAYER') {
      appState.mpManager?.disconnectRoom();
      appState.activeRoomCode = null;
      appState.activeRoomMode = null;
      document.getElementById('waiting-room-banner')?.classList.add('hidden');
      renderP2PLiveStatus({ stage: 'idle', message: '' });
    }
    appState.lastRenderedState = null;
    switchScreen('screen-lobby');
  });

  // Chain Pass Button
  document.getElementById('btn-chain-pass')?.addEventListener('click', () => {
    clearChainCardHighlights();
    appState.activeChainPrompt = null;
    document.getElementById('chain-prompt-bar')?.classList.add('hidden');
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
    openPlayerZoneModal('🌌 Extra Deck ของคุณ (กดปุ่มสีทองเพื่ออัญเชิญ Synchro / Xyz / Link)', me.extra, appState.legalActions?.extraActions || {}, true);
  });

  document.getElementById('btn-self-gy')?.addEventListener('click', () => {
    if (!appState.currentState) return;
    const me = appState.currentState.players[appState.myPlayerIndex];
    openPlayerZoneModal('🪦 สุสานของคุณ (Graveyard)', me.gy, appState.legalActions?.gyActions || {});
  });

  document.getElementById('btn-self-banished')?.addEventListener('click', () => {
    if (!appState.currentState) return;
    const me = appState.currentState.players[appState.myPlayerIndex];
    openPlayerZoneModal('🌀 การ์ดนอกเกมของคุณ (Banished)', me.banished, appState.legalActions?.banishedActions || {});
  });

  const openOppGy = () => {
    if (!appState.currentState) return;
    const opp = appState.currentState.players[1 - appState.myPlayerIndex];
    openPlayerZoneModal(`🪦 สุสานของ ${opp.name}`, opp.gy, {});
  };
  const openOppBanished = () => {
    if (!appState.currentState) return;
    const opp = appState.currentState.players[1 - appState.myPlayerIndex];
    openPlayerZoneModal(`🌀 การ์ดนอกเกมของ ${opp.name}`, opp.banished, {});
  };

  document.getElementById('btn-opp-gy')?.addEventListener('click', openOppGy);
  document.getElementById('btn-opp-gy-mat')?.addEventListener('click', openOppGy);
  document.getElementById('btn-opp-banished')?.addEventListener('click', openOppBanished);
  document.getElementById('btn-opp-banished-mat')?.addEventListener('click', openOppBanished);

  // Result Dialog Buttons
  document.getElementById('btn-duel-rematch')?.addEventListener('click', () => {
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
    if (appState.gameMode === 'MULTIPLAYER') {
      appState.mpManager?.disconnectRoom();
      appState.activeRoomCode = null;
      appState.activeRoomMode = null;
      document.getElementById('waiting-room-banner')?.classList.add('hidden');
      renderP2PLiveStatus({ stage: 'idle', message: '' });
    }
    switchScreen('screen-lobby');
  });
});
