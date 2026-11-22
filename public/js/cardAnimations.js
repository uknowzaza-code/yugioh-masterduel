/**
 * @fileoverview Master Duel Card Animations & Battlefield VFX Orchestrator
 * Uses GPU-composited individual transforms (translate/scale/rotate), 3D flip stages,
 * and inline SVG summon/spell/trap rituals via WAAPI while respecting prefers-reduced-motion
 * and avoiding blur/strobe hazards.
 */

import { MONSTER_FRAMES, POSITIONS } from '/src/constants/gameConstants.js';
import { getCardArtUrl, getCardFrameClass } from '/js/cardArt.js';

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

function getVfxLayer() {
  let layer = document.getElementById('duel-vfx-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'duel-vfx-layer';
    layer.className = 'duel-vfx-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }
  return layer;
}

function getRectIfVisible(selector) {
  const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

function getFrameSummonTheme(card) {
  if (!card) return { label: 'SUMMON', color: '#facc15', glow: 'rgba(250, 204, 21, 0.58)' };
  if (card.position === POSITIONS.SET || card.position === POSITIONS.SET_DEF) {
    return { label: 'SET CARD', color: '#94a3b8', glow: 'rgba(148, 163, 184, 0.45)' };
  }
  if (card.kind === 'SPELL') {
    if (card.subtype === 'QUICK_PLAY' || card.subType === 'QUICK_PLAY') {
      return { label: 'QUICK-PLAY ⚡', color: '#34d399', glow: 'rgba(52, 211, 153, 0.7)' };
    }
    if (card.subtype === 'FIELD' || card.subType === 'FIELD') {
      return { label: 'FIELD SPELL ❖', color: '#2dd4bf', glow: 'rgba(45, 212, 191, 0.72)' };
    }
    return { label: 'SPELL ACTIVATE', color: '#10b981', glow: 'rgba(16, 185, 129, 0.65)' };
  }
  if (card.kind === 'TRAP') {
    if (card.subtype === 'COUNTER' || card.subType === 'COUNTER') {
      return { label: 'COUNTER TRAP ⮌', color: '#fb7185', glow: 'rgba(251, 113, 133, 0.78)' };
    }
    return { label: 'TRAP FLIP!', color: '#ec4899', glow: 'rgba(236, 72, 153, 0.7)' };
  }
  switch (card.frame) {
    case MONSTER_FRAMES.FUSION:
      return { label: 'FUSION SUMMON', color: '#c084fc', glow: 'rgba(192, 132, 252, 0.72)' };
    case MONSTER_FRAMES.SYNCHRO:
      return { label: 'SYNCHRO SUMMON', color: '#e2e8f0', glow: 'rgba(134, 239, 172, 0.78)' };
    case MONSTER_FRAMES.XYZ:
      return { label: 'XYZ SUMMON', color: '#fbbf24', glow: 'rgba(251, 191, 36, 0.75)' };
    case MONSTER_FRAMES.LINK:
      return { label: 'LINK SUMMON', color: '#38bdf8', glow: 'rgba(56, 189, 248, 0.78)' };
    case 'RITUAL':
      return { label: 'RITUAL SUMMON', color: '#60a5fa', glow: 'rgba(96, 165, 250, 0.75)' };
    default:
      return { label: 'SUMMON', color: '#facc15', glow: 'rgba(250, 204, 21, 0.62)' };
  }
}

function captureSlotRects() {
  const slotRects = new Map();
  const saveGrid = (gridId, controllerPrefix, zone) => {
    document.querySelectorAll(`#${gridId} .zone-slot[data-zone-index]`).forEach((slot) => {
      const idx = slot.getAttribute('data-zone-index');
      const r = slot.getBoundingClientRect();
      if (r.width > 0) {
        slotRects.set(`${controllerPrefix}:${zone}:${idx}`, r);
      }
    });
  };
  saveGrid('self-mmz-grid', 'self', 'MMZ');
  saveGrid('self-stz-grid', 'self', 'STZ');
  saveGrid('opp-mmz-grid', 'opp', 'MMZ');
  saveGrid('opp-stz-grid', 'opp', 'STZ');

  const selfField = getRectIfVisible('#self-field-spell-slot');
  const oppField = getRectIfVisible('#opp-field-spell-slot');
  const leftEmz = getRectIfVisible('#self-emz-slot');
  const rightEmz = getRectIfVisible('#opp-emz-slot');
  if (selfField) slotRects.set('self:FIELD:5', selfField);
  if (oppField) slotRects.set('opp:FIELD:5', oppField);
  if (leftEmz) slotRects.set('emz:LEFT', leftEmz);
  if (rightEmz) slotRects.set('emz:RIGHT', rightEmz);
  return slotRects;
}

/**
 * Snapshot rendered cards, zones, piles, and LP before renderDuelScreen() rebuilds DOM.
 */
export function captureBoardSnapshot(state, myIdx) {
  if (!state) return null;
  const oppIdx = 1 - myIdx;
  const me = state.players[myIdx];
  const opp = state.players[oppIdx];

  const cards = new Map();
  const zones = new Map();
  const handOrder = [];

  document.querySelectorAll('.duel-card[data-instance-id]').forEach((el) => {
    const id = el.getAttribute('data-instance-id');
    const rect = el.getBoundingClientRect();
    if (!id || rect.width === 0) return;
    const zone = el.getAttribute('data-card-zone') || '';
    const idxStr = el.getAttribute('data-card-index') || '';
    const ctrlStr = el.getAttribute('data-controller') || '';
    const passcode = el.getAttribute('data-passcode') || '';
    const img = el.querySelector('img.card-mini-art');
    const entry = {
      instanceId: id,
      rect,
      zone,
      index: idxStr !== '' ? Number(idxStr) : null,
      controller: ctrlStr !== '' ? Number(ctrlStr) : null,
      position: el.getAttribute('data-card-position') || '',
      passcode,
      className: el.className,
      artSrc: img?.getAttribute('src') || ''
    };
    cards.set(id, entry);
    if (entry.controller !== null && zone && entry.index !== null) {
      zones.set(`${entry.controller}:${zone}:${entry.index}`, entry);
    }
    if (zone === 'HAND' && entry.controller === myIdx) {
      handOrder.push(entry);
    }
  });

  handOrder.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const oppHandRects = [];
  document.querySelectorAll('#opp-hand-bar .opp-hand-card-back').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0) oppHandRects.push(r);
  });

  return {
    duelId: state.duelId,
    turnCount: state.turnCount,
    lastBattleSeq: state.battleSeq || 0,
    lastEventSeq: state.eventSeq || 0,
    selfLp: me.lp,
    oppLp: opp.lp,
    oppHandCount: opp.hand.length,
    oppHandRects,
    handOrder,
    cards,
    zones,
    slotRects: captureSlotRects(),
    piles: {
      selfDeck: getRectIfVisible('.self-deck-pile'),
      selfExtra: getRectIfVisible('#btn-self-extra'),
      selfGy: getRectIfVisible('#btn-self-gy'),
      selfBanished: getRectIfVisible('#btn-self-banished'),
      selfHandBar: getRectIfVisible('#self-hand-container'),
      oppDeck: getRectIfVisible('.opp-deck-pile'),
      oppExtra: getRectIfVisible('.opp-extra-pile'),
      oppGy: getRectIfVisible('#btn-opp-gy-mat') || getRectIfVisible('#btn-opp-gy'),
      oppBanished: getRectIfVisible('#btn-opp-banished-mat') || getRectIfVisible('#btn-opp-banished'),
      oppHandBar: getRectIfVisible('#opp-hand-bar'),
      oppHud: getRectIfVisible('.opponent-hud'),
      oppLp: getRectIfVisible('#opp-lp-value'),
      selfLp: getRectIfVisible('#self-lp-value'),
      playmat: getRectIfVisible('#playmat-container')
    }
  };
}

function getEmzSlotId(controller, sequence, myIdx) {
  const isSelf = controller === myIdx;
  const idx = Number(sequence ?? 5);
  // Sequence 5 (or 0) on self side is Left EMZ (#self-emz-slot); opp side sequence 5 (or 0) is Right EMZ (#opp-emz-slot).
  if (isSelf) {
    return (idx === 5 || idx === 0) ? 'self-emz-slot' : 'opp-emz-slot';
  }
  return (idx === 5 || idx === 0) ? 'opp-emz-slot' : 'self-emz-slot';
}

function resolveZoneSlotEl(controller, zone, index, myIdx) {
  const isSelf = controller === myIdx;
  if (zone === 'MMZ') {
    const gridId = isSelf ? 'self-mmz-grid' : 'opp-mmz-grid';
    return document.querySelector(`#${gridId} .zone-slot[data-zone-index="${index}"]`);
  }
  if (zone === 'STZ') {
    const gridId = isSelf ? 'self-stz-grid' : 'opp-stz-grid';
    return document.querySelector(`#${gridId} .zone-slot[data-zone-index="${index}"]`);
  }
  if (zone === 'FIELD') {
    return document.getElementById(isSelf ? 'self-field-spell-slot' : 'opp-field-spell-slot');
  }
  if (zone === 'EMZ') {
    return document.getElementById(getEmzSlotId(controller, index, myIdx));
  }
  if (zone === 'DECK') return document.querySelector(isSelf ? '.self-deck-pile' : '.opp-deck-pile');
  if (zone === 'EXTRA') return document.querySelector(isSelf ? '#btn-self-extra' : '.opp-extra-pile');
  if (zone === 'GY') return document.querySelector(isSelf ? '#btn-self-gy' : '#btn-opp-gy-mat') || document.getElementById('btn-opp-gy');
  if (zone === 'BANISHED') return document.querySelector(isSelf ? '#btn-self-banished' : '#btn-opp-banished-mat') || document.getElementById('btn-opp-banished');
  if (zone === 'HAND') {
    if (isSelf) {
      return document.querySelector(`#self-hand-container .duel-card[data-card-index="${index}"]`) || document.getElementById('self-hand-container');
    }
    const oppCards = document.querySelectorAll('#opp-hand-bar .opp-hand-card-back');
    return oppCards[index] || oppCards[oppCards.length - 1] || document.getElementById('opp-hand-bar');
  }
  return null;
}

function resolveLiveCardEl(controller, zone, index, myIdx) {
  if (zone === 'HAND' && controller === myIdx) {
    return document.querySelector(`#self-hand-container .duel-card[data-card-index="${index}"]`);
  }
  if (zone === 'MMZ' || zone === 'STZ' || zone === 'FIELD' || zone === 'EMZ') {
    const slotEl = resolveZoneSlotEl(controller, zone, index, myIdx);
    const card = slotEl?.querySelector('.duel-card');
    if (card) return card;
  }
  return null;
}

function resolvePrevRect(loc, prev, myIdx) {
  if (!loc) return null;
  if (loc.zone === 'OVERLAY' && loc.hostZone) {
    return resolvePrevRect({ controller: loc.controller, zone: loc.hostZone, index: loc.hostIndex ?? loc.index }, prev, myIdx);
  }
  const direct = prev?.zones?.get(`${loc.controller}:${loc.zone}:${loc.index}`);
  if (direct?.rect) return direct.rect;

  const isSelf = loc.controller === myIdx;
  if (loc.zone === 'HAND') {
    if (isSelf) {
      return prev?.handOrder?.[loc.index]?.rect || prev?.piles?.selfHandBar || null;
    }
    return prev?.oppHandRects?.[loc.index] || prev?.oppHandRects?.[prev.oppHandRects.length - 1] || prev?.piles?.oppHandBar || null;
  }
  if (loc.zone === 'MMZ' || loc.zone === 'STZ') {
    const key = `${isSelf ? 'self' : 'opp'}:${loc.zone}:${loc.index}`;
    return prev?.slotRects?.get(key) || getRectIfVisible(resolveZoneSlotEl(loc.controller, loc.zone, loc.index, myIdx));
  }
  if (loc.zone === 'FIELD') {
    return (isSelf ? prev?.slotRects?.get('self:FIELD:5') : prev?.slotRects?.get('opp:FIELD:5'))
      || getRectIfVisible(resolveZoneSlotEl(loc.controller, 'FIELD', loc.index, myIdx));
  }
  if (loc.zone === 'EMZ') {
    const slotId = getEmzSlotId(loc.controller, loc.index, myIdx);
    return (slotId === 'self-emz-slot' ? prev?.slotRects?.get('emz:LEFT') : prev?.slotRects?.get('emz:RIGHT'))
      || getRectIfVisible(`#${slotId}`);
  }
  if (loc.zone === 'DECK') return isSelf ? prev?.piles?.selfDeck : prev?.piles?.oppDeck;
  if (loc.zone === 'EXTRA') return isSelf ? prev?.piles?.selfExtra : prev?.piles?.oppExtra;
  if (loc.zone === 'GY') return isSelf ? prev?.piles?.selfGy : prev?.piles?.oppGy;
  if (loc.zone === 'BANISHED') return isSelf ? prev?.piles?.selfBanished : prev?.piles?.oppBanished;
  return getRectIfVisible(resolveZoneSlotEl(loc.controller, loc.zone, loc.index, myIdx));
}

function resolveLiveRect(loc, prev, myIdx) {
  if (!loc) return null;
  if (loc.zone === 'OVERLAY' && loc.hostZone) {
    return resolveLiveRect({ controller: loc.controller, zone: loc.hostZone, index: loc.hostIndex ?? loc.index }, prev, myIdx);
  }
  const el = resolveLiveCardEl(loc.controller, loc.zone, loc.index, myIdx) || resolveZoneSlotEl(loc.controller, loc.zone, loc.index, myIdx);
  return getRectIfVisible(el) || resolvePrevRect(loc, prev, myIdx);
}

function animateElementFlight(el, fromRect, toRect, options = {}) {
  if (!el || !fromRect || !toRect) return null;
  const {
    duration = 320,
    delay = 0,
    startScale = 1.06,
    midScale = 1.12,
    startRotateDeg = 0,
    flipYDeg = 0
  } = options;

  if (prefersReducedMotion()) {
    return el.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 150, delay, easing: 'ease-out', fill: 'backwards' });
  }

  const fromCx = fromRect.left + fromRect.width / 2;
  const fromCy = fromRect.top + fromRect.height / 2;
  const toCx = toRect.left + toRect.width / 2;
  const toCy = toRect.top + toRect.height / 2;
  const dx = fromCx - toCx;
  const dy = fromCy - toCy;
  const ratio = Math.max(0.45, Math.min(1.4, (fromRect.width / Math.max(1, toRect.width)) * startScale));

  const keyframes = flipYDeg
    ? [
        { transform: `perspective(680px) translate3d(${dx}px, ${dy}px, 0) scale(${ratio}) rotateY(${flipYDeg}deg)`, opacity: 0.85 },
        { transform: `perspective(680px) translate3d(${dx * 0.12}px, ${dy * 0.12}px, 24px) scale(${midScale}) rotateY(${Math.round(flipYDeg * 0.18)}deg)`, opacity: 1, offset: 0.7 },
        { transform: 'perspective(680px) translate3d(0, 0, 0) scale(1) rotateY(0deg)', opacity: 1 }
      ]
    : [
        { translate: `${dx}px ${dy}px`, scale: `${ratio}`, rotate: `${startRotateDeg}deg`, opacity: 0.86 },
        { translate: `${dx * 0.1}px ${dy * 0.1}px`, scale: `${midScale}`, rotate: `${Math.round(startRotateDeg * 0.15)}deg`, opacity: 1, offset: 0.72 },
        { translate: '0px 0px', scale: '1', rotate: '0deg', opacity: 1 }
      ];

  return el.animate(keyframes, {
    duration,
    delay,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'backwards'
  });
}

function spawnCallout(rect, label, color, delay = 0) {
  if (!rect || !label || prefersReducedMotion()) return;
  const layer = getVfxLayer();
  const el = document.createElement('div');
  el.className = 'vfx-action-callout';
  el.textContent = label;
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${Math.max(18, rect.top - 8)}px`;
  el.style.setProperty('--vfx-color', color || '#facc15');
  layer.appendChild(el);
  const anim = el.animate(
    [
      { transform: 'translate(-50%, 8px) scale(0.86)', opacity: 0 },
      { transform: 'translate(-50%, -4px) scale(1.04)', opacity: 1, offset: 0.24 },
      { transform: 'translate(-50%, -18px) scale(1)', opacity: 0 }
    ],
    { duration: 880, delay, easing: 'ease-out', fill: 'both' }
  );
  anim.finished.catch(() => {}).finally(() => el.remove());
}

function spawnPlacementRipple(rect, isSet = false, delay = 0) {
  if (!rect || prefersReducedMotion()) return;
  const layer = getVfxLayer();
  const el = document.createElement('div');
  el.className = isSet ? 'vfx-set-lock' : 'vfx-place-ripple';
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top + rect.height / 2}px`;
  el.style.width = `${Math.max(58, rect.width + 8)}px`;
  el.style.height = `${Math.max(82, rect.height + 8)}px`;
  layer.appendChild(el);

  const anim = el.animate(
    isSet
      ? [
          { transform: 'translate(-50%, -50%) scale(1.3)', opacity: 0 },
          { transform: 'translate(-50%, -50%) scale(1.02)', opacity: 0.92, offset: 0.35 },
          { transform: 'translate(-50%, -50%) scale(1.16)', opacity: 0 }
        ]
      : [
          { transform: 'translate(-50%, -50%) scale(0.88)', opacity: 0.95 },
          { transform: 'translate(-50%, -50%) scale(1.24)', opacity: 0 }
        ],
    { duration: 420, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
  );
  anim.finished.catch(() => {}).finally(() => el.remove());
}

function spawnMaterialOrbs(originRects, targetRect, color, glow, delay = 0) {
  if (!targetRect || !originRects?.length || prefersReducedMotion()) return;
  const layer = getVfxLayer();
  const toCx = targetRect.left + targetRect.width / 2;
  const toCy = targetRect.top + targetRect.height / 2;

  originRects.slice(0, 6).forEach((fromRect, idx) => {
    if (!fromRect) return;
    const fromCx = fromRect.left + fromRect.width / 2;
    const fromCy = fromRect.top + fromRect.height / 2;
    const dx = toCx - fromCx;
    const dy = toCy - fromCy;

    const orb = document.createElement('div');
    orb.className = 'vfx-material-orb';
    orb.style.left = `${fromCx}px`;
    orb.style.top = `${fromCy}px`;
    orb.style.setProperty('--vfx-color', color);
    orb.style.setProperty('--vfx-glow', glow);
    layer.appendChild(orb);

    const curveOffset = (idx % 2 === 0 ? 1 : -1) * 26;
    const anim = orb.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.65)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.45}px), calc(-50% + ${dy * 0.45 + curveOffset}px)) scale(1.35)`, opacity: 1, offset: 0.42 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.25)`, opacity: 0 }
      ],
      { duration: 420, delay: delay + idx * 35, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
    );
    anim.finished.catch(() => {}).finally(() => orb.remove());
  });
}

function spawnFusionSummonVfx(rect, cardEl, materialRects, delay = 0) {
  if (!rect) return;
  spawnCallout(rect, 'FUSION SUMMON', '#c084fc', delay + 80);
  if (prefersReducedMotion()) return;

  spawnMaterialOrbs(materialRects, rect, '#e879f9', 'rgba(232, 121, 249, 0.85)', delay);
  const layer = getVfxLayer();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const vortex = document.createElement('div');
  vortex.className = 'vfx-fusion-vortex';
  vortex.style.left = `${cx}px`;
  vortex.style.top = `${cy}px`;
  vortex.innerHTML = `
    <svg viewBox="0 0 120 120" width="124" height="124" aria-hidden="true">
      <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(192,132,252,0.85)" stroke-width="3" stroke-dasharray="20 8"/>
      <circle cx="60" cy="60" r="34" fill="none" stroke="rgba(244,114,182,0.9)" stroke-width="3.5" stroke-dasharray="14 6"/>
      <path d="M60,18 A42,42 0 0,1 102,60 A26,26 0 0,1 60,86 A16,16 0 0,1 44,60" fill="none" stroke="#f0abfc" stroke-width="3" stroke-linecap="round"/>
    </svg>
  `;
  layer.appendChild(vortex);

  const anim = vortex.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.3) rotate(0deg)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.05) rotate(190deg)', opacity: 0.96, offset: 0.45 },
      { transform: 'translate(-50%, -50%) scale(1.5) rotate(360deg)', opacity: 0 }
    ],
    { duration: 680, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
  );
  anim.finished.catch(() => {}).finally(() => vortex.remove());

  if (cardEl) {
    cardEl.animate(
      [
        { scale: '0.35', rotate: '-14deg', opacity: 0.25 },
        { scale: '1.16', rotate: '2deg', opacity: 1, offset: 0.65 },
        { scale: '1', rotate: '0deg', opacity: 1 }
      ],
      { duration: 480, delay: delay + 110, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
    );
  }
}

function spawnSynchroSummonVfx(rect, cardEl, materialRects, delay = 0) {
  if (!rect) return;
  spawnCallout(rect, 'SYNCHRO SUMMON', '#86efac', delay + 90);
  if (prefersReducedMotion()) return;

  spawnMaterialOrbs(materialRects, rect, '#4ade80', 'rgba(74, 222, 128, 0.88)', delay);
  const layer = getVfxLayer();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const pillar = document.createElement('div');
  pillar.className = 'vfx-synchro-pillar';
  pillar.style.left = `${cx}px`;
  pillar.style.top = `${cy}px`;
  layer.appendChild(pillar);
  const pillarAnim = pillar.animate(
    [
      { transform: 'translate(-50%, -50%) scaleY(0.15) scaleX(0.6)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scaleY(1) scaleX(1.05)', opacity: 0.95, offset: 0.35 },
      { transform: 'translate(-50%, -50%) scaleY(1.2) scaleX(1.4)', opacity: 0 }
    ],
    { duration: 600, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
  );
  pillarAnim.finished.catch(() => {}).finally(() => pillar.remove());

  [0, 1, 2].forEach((idx) => {
    const ring = document.createElement('div');
    ring.className = 'vfx-synchro-ring';
    ring.style.left = `${cx}px`;
    ring.style.top = `${cy - 18 + idx * 18}px`;
    layer.appendChild(ring);
    const rAnim = ring.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.35)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(1.1)', opacity: 1, offset: 0.4 },
        { transform: 'translate(-50%, -50%) scale(1.45)', opacity: 0 }
      ],
      { duration: 540, delay: delay + idx * 55, easing: 'ease-out', fill: 'both' }
    );
    rAnim.finished.catch(() => {}).finally(() => ring.remove());
  });

  if (cardEl) {
    cardEl.animate(
      [
        { translate: '0px -36px', scale: '0.78', opacity: 0.15 },
        { translate: '0px 3px', scale: '1.12', opacity: 1, offset: 0.7 },
        { translate: '0px 0px', scale: '1', opacity: 1 }
      ],
      { duration: 430, delay: delay + 140, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
    );
  }
}

function spawnXyzSummonVfx(rect, cardEl, materialRects, delay = 0) {
  if (!rect) return;
  spawnCallout(rect, 'XYZ SUMMON', '#fbbf24', delay + 90);
  if (prefersReducedMotion()) return;

  spawnMaterialOrbs(materialRects, rect, '#fbbf24', 'rgba(251, 191, 36, 0.9)', delay);
  const layer = getVfxLayer();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const galaxy = document.createElement('div');
  galaxy.className = 'vfx-xyz-vortex';
  galaxy.style.left = `${cx}px`;
  galaxy.style.top = `${cy}px`;
  galaxy.innerHTML = `
    <svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true">
      <circle cx="60" cy="60" r="46" fill="rgba(15,23,42,0.55)" stroke="#fbbf24" stroke-width="2.8" stroke-dasharray="10 6"/>
      <polygon points="60,8 68,52 112,60 68,68 60,112 52,68 8,60 52,52" fill="rgba(251,191,36,0.35)" stroke="#fef08a" stroke-width="2"/>
      <circle cx="60" cy="60" r="14" fill="#020617" stroke="#f59e0b" stroke-width="3"/>
    </svg>
  `;
  layer.appendChild(galaxy);

  const anim = galaxy.animate(
    [
      { transform: 'translate(-50%, -50%) scale(1.25) rotate(0deg)', opacity: 0.2 },
      { transform: 'translate(-50%, -50%) scale(0.45) rotate(-140deg)', opacity: 1, offset: 0.42 },
      { transform: 'translate(-50%, -50%) scale(1.55) rotate(-240deg)', opacity: 0 }
    ],
    { duration: 660, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
  );
  anim.finished.catch(() => {}).finally(() => galaxy.remove());

  if (cardEl) {
    cardEl.animate(
      [
        { scale: '0.32', opacity: 0.15 },
        { scale: '1.18', opacity: 1, offset: 0.68 },
        { scale: '1', opacity: 1 }
      ],
      { duration: 460, delay: delay + 140, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
    );
  }
}

function spawnLinkSummonVfx(rect, cardEl, materialRects, delay = 0) {
  if (!rect) return;
  spawnCallout(rect, 'LINK SUMMON', '#38bdf8', delay + 80);
  if (prefersReducedMotion()) return;

  spawnMaterialOrbs(materialRects, rect, '#38bdf8', 'rgba(56, 189, 248, 0.9)', delay);
  const layer = getVfxLayer();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const circuit = document.createElement('div');
  circuit.className = 'vfx-link-circuit';
  circuit.style.left = `${cx}px`;
  circuit.style.top = `${cy}px`;
  circuit.innerHTML = `
    <svg viewBox="0 0 120 120" width="128" height="128" aria-hidden="true">
      <polygon points="60,10 103,35 103,85 60,110 17,85 17,35" fill="rgba(14,165,233,0.14)" stroke="#38bdf8" stroke-width="3" stroke-linejoin="round"/>
      <polygon points="60,24 91,42 91,78 60,96 29,78 29,42" fill="none" stroke="#93c5fd" stroke-width="2" stroke-dasharray="14 6"/>
      <polygon points="60,3 65,13 55,13" fill="#facc15"/>
      <polygon points="60,117 65,107 55,107" fill="#facc15"/>
      <polygon points="3,60 13,55 13,65" fill="#38bdf8"/>
      <polygon points="117,60 107,55 107,65" fill="#38bdf8"/>
    </svg>
  `;
  layer.appendChild(circuit);

  const anim = circuit.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.42) rotate(-25deg)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.06) rotate(0deg)', opacity: 1, offset: 0.42 },
      { transform: 'translate(-50%, -50%) scale(1.38) rotate(12deg)', opacity: 0 }
    ],
    { duration: 600, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
  );
  anim.finished.catch(() => {}).finally(() => circuit.remove());

  if (cardEl) {
    cardEl.animate(
      [
        { clipPath: 'inset(0 0 100% 0)', scale: '1.08', opacity: 0.4 },
        { clipPath: 'inset(0 0 0% 0)', scale: '1', opacity: 1 }
      ],
      { duration: 360, delay: delay + 90, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
    );
  }
}

function spawnRitualSummonVfx(rect, cardEl, materialRects, delay = 0) {
  if (!rect) return;
  spawnCallout(rect, 'RITUAL SUMMON', '#60a5fa', delay + 80);
  if (prefersReducedMotion()) return;

  spawnMaterialOrbs(materialRects, rect, '#60a5fa', 'rgba(96, 165, 250, 0.88)', delay);
  const layer = getVfxLayer();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const altar = document.createElement('div');
  altar.className = 'vfx-ritual-altar';
  altar.style.left = `${cx}px`;
  altar.style.top = `${cy}px`;
  altar.innerHTML = `
    <svg viewBox="0 0 120 120" width="126" height="126" aria-hidden="true">
      <circle cx="60" cy="60" r="50" fill="rgba(37,99,235,0.16)" stroke="#60a5fa" stroke-width="2.5" stroke-dasharray="8 6"/>
      <polygon points="60,14 100,84 20,84" fill="none" stroke="#93c5fd" stroke-width="2.2"/>
      <polygon points="60,106 100,36 20,36" fill="none" stroke="#38bdf8" stroke-width="2.2"/>
    </svg>
  `;
  layer.appendChild(altar);

  const anim = altar.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.4) rotate(0deg)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.08) rotate(90deg)', opacity: 1, offset: 0.45 },
      { transform: 'translate(-50%, -50%) scale(1.42) rotate(180deg)', opacity: 0 }
    ],
    { duration: 640, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
  );
  anim.finished.catch(() => {}).finally(() => altar.remove());

  if (cardEl) {
    cardEl.animate(
      [
        { translate: '0px -28px', scale: '0.82', opacity: 0.25 },
        { translate: '0px 0px', scale: '1.1', opacity: 1, offset: 0.65 },
        { translate: '0px 0px', scale: '1', opacity: 1 }
      ],
      { duration: 440, delay: delay + 110, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
    );
  }
}

function spawnPendulumBeamVfx(targetRect, controller, myIdx, delay = 0) {
  if (!targetRect || prefersReducedMotion()) return;
  const leftScaleEl = resolveZoneSlotEl(controller, 'STZ', 0, myIdx);
  const rightScaleEl = resolveZoneSlotEl(controller, 'STZ', 4, myIdx);
  const layer = getVfxLayer();

  [leftScaleEl, rightScaleEl].forEach((scaleEl) => {
    const sr = getRectIfVisible(scaleEl);
    if (!sr) return;
    const x1 = sr.left + sr.width / 2;
    const y1 = sr.top + sr.height / 2;
    const x2 = targetRect.left + targetRect.width / 2;
    const y2 = targetRect.top + targetRect.height / 2;
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);

    const beam = document.createElement('div');
    beam.className = 'vfx-pendulum-beam';
    beam.style.left = `${x1}px`;
    beam.style.top = `${y1}px`;
    beam.style.width = `${Math.max(24, dist)}px`;
    beam.style.transformOrigin = '0 50%';
    layer.appendChild(beam);

    const anim = beam.animate(
      [
        { transform: `rotate(${angle}deg) scaleX(0)`, opacity: 0 },
        { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 0.95, offset: 0.45 },
        { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 0 }
      ],
      { duration: 480, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
    );
    anim.finished.catch(() => {}).finally(() => beam.remove());
  });
}

function spawnSpellActivationVfx(rect, cardMeta, cardEl, destPileRect, delay = 0) {
  if (!rect) return;
  const isField = cardMeta?.subtype === 'FIELD' || cardMeta?.subType === 'FIELD';
  const isQuick = cardMeta?.subtype === 'QUICK_PLAY' || cardMeta?.subType === 'QUICK_PLAY';
  const label = isField ? 'FIELD SPELL ❖' : isQuick ? 'QUICK-PLAY ⚡' : 'SPELL ACTIVATE';
  spawnCallout(rect, label, isField ? '#2dd4bf' : '#10b981', delay + 40);
  if (prefersReducedMotion()) return;

  const layer = getVfxLayer();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const circle = document.createElement('div');
  circle.className = 'vfx-spell-circle';
  circle.style.left = `${cx}px`;
  circle.style.top = `${cy}px`;
  circle.innerHTML = `
    <svg viewBox="0 0 120 120" width="122" height="122" aria-hidden="true">
      <circle cx="60" cy="60" r="49" fill="rgba(16,185,129,0.14)" stroke="#34d399" stroke-width="2.6" stroke-dasharray="12 5"/>
      <circle cx="60" cy="60" r="35" fill="none" stroke="#6ee7b7" stroke-width="2"/>
      <polygon points="60,15 99,83 21,83" fill="none" stroke="#10b981" stroke-width="2"/>
      <polygon points="60,105 99,37 21,37" fill="none" stroke="#34d399" stroke-width="2"/>
    </svg>
  `;
  layer.appendChild(circle);

  const circleAnim = circle.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.35) rotate(0deg)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.06) rotate(75deg)', opacity: 1, offset: 0.35 },
      { transform: 'translate(-50%, -50%) scale(1.34) rotate(135deg)', opacity: 0 }
    ],
    { duration: 600, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
  );
  circleAnim.finished.catch(() => {}).finally(() => circle.remove());

  if (cardEl) {
    cardEl.animate(
      [
        { translate: '0px 0px', scale: '0.94', opacity: 0.7 },
        { translate: '0px -6px', scale: '1.14', opacity: 1, offset: 0.38 },
        { translate: '0px 0px', scale: '1', opacity: 1 }
      ],
      { duration: 360, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
    );
  } else if (cardMeta) {
    // Card already moved off-field (resolved to GY) in same tick -> brief on-slot preview ghost!
    const ghost = document.createElement('div');
    ghost.className = `vfx-card-ghost frame-spell`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    const img = document.createElement('img');
    img.src = getCardArtUrl(cardMeta);
    img.alt = '';
    img.className = 'vfx-ghost-img';
    ghost.appendChild(img);
    layer.appendChild(ghost);

    const endDx = destPileRect ? ((destPileRect.left + destPileRect.width / 2) - cx) : 0;
    const endDy = destPileRect ? ((destPileRect.top + destPileRect.height / 2) - cy) : -24;

    const gAnim = ghost.animate(
      [
        { transform: 'scale(0.86)', opacity: 0.2 },
        { transform: 'translateY(-6px) scale(1.16)', opacity: 1, offset: 0.35 },
        { transform: 'translateY(-6px) scale(1.14)', opacity: 1, offset: 0.65 },
        { transform: `translate3d(${endDx}px, ${endDy}px, 0) scale(0.32) rotate(12deg)`, opacity: 0 }
      ],
      { duration: 540, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
    );
    gAnim.finished.catch(() => {}).finally(() => ghost.remove());
  }

  if (isField) {
    const playmat = document.getElementById('playmat-container');
    playmat?.animate(
      [
        { boxShadow: '0 0 0 rgba(45,212,191,0)' },
        { boxShadow: '0 0 28px rgba(45,212,191,0.75), inset 0 0 28px rgba(16,185,129,0.35)', offset: 0.4 },
        { boxShadow: '0 0 0 rgba(45,212,191,0)' }
      ],
      { duration: 640, delay, easing: 'ease-out' }
    );
  }
}

function spawn3dFlipStage(rect, cardMeta, destPileRect, themeColor, delay = 0) {
  if (!rect || prefersReducedMotion()) return;
  const layer = getVfxLayer();
  const stage = document.createElement('div');
  stage.className = 'vfx-3d-flip-stage';
  stage.style.left = `${rect.left}px`;
  stage.style.top = `${rect.top}px`;
  stage.style.width = `${rect.width}px`;
  stage.style.height = `${rect.height}px`;

  const cardInner = document.createElement('div');
  cardInner.className = 'vfx-3d-flip-card';

  const front = document.createElement('div');
  front.className = `vfx-3d-face ${getCardFrameClass(cardMeta)}`;
  const img = document.createElement('img');
  img.src = getCardArtUrl(cardMeta);
  img.alt = '';
  img.className = 'vfx-ghost-img';
  front.appendChild(img);

  const back = document.createElement('div');
  back.className = 'vfx-3d-back';

  cardInner.appendChild(front);
  cardInner.appendChild(back);
  stage.appendChild(cardInner);
  layer.appendChild(stage);

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const endDx = destPileRect ? ((destPileRect.left + destPileRect.width / 2) - cx) : 0;
  const endDy = destPileRect ? ((destPileRect.top + destPileRect.height / 2) - cy) : 0;

  const flipAnim = cardInner.animate(
    destPileRect
      ? [
          { transform: 'rotateY(180deg) scale(0.92)', opacity: 0.9 },
          { transform: 'rotateY(0deg) scale(1.22)', opacity: 1, offset: 0.42 },
          { transform: 'rotateY(0deg) scale(1.16)', opacity: 1, offset: 0.68 },
          { transform: `translate3d(${endDx}px, ${endDy}px, 0) scale(0.32) rotate(10deg)`, opacity: 0 }
        ]
      : [
          { transform: 'rotateY(180deg) scale(0.92)', opacity: 0.9 },
          { transform: 'rotateY(0deg) scale(1.22)', opacity: 1, offset: 0.55 },
          { transform: 'rotateY(0deg) scale(1)', opacity: 0 }
        ],
    { duration: destPileRect ? 620 : 420, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
  );
  flipAnim.finished.catch(() => {}).finally(() => stage.remove());
}

function spawnTrapFlipVfx(rect, cardMeta, cardEl, destPileRect, delay = 0) {
  if (!rect) return;
  const isCounter = cardMeta?.subtype === 'COUNTER' || cardMeta?.subType === 'COUNTER';
  const color = isCounter ? '#fb7185' : '#ec4899';
  spawnCallout(rect, isCounter ? 'COUNTER TRAP ⮌' : 'TRAP FLIP!', color, delay + 60);
  if (prefersReducedMotion()) return;

  const layer = getVfxLayer();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const burst = document.createElement('div');
  burst.className = 'vfx-trap-burst';
  burst.style.left = `${cx}px`;
  burst.style.top = `${cy}px`;
  burst.innerHTML = `
    <svg viewBox="0 0 120 120" width="118" height="118" aria-hidden="true">
      <rect x="20" y="20" width="80" height="80" rx="10" fill="rgba(236,72,153,0.16)" stroke="${color}" stroke-width="3" transform="rotate(45 60 60)"/>
      <circle cx="60" cy="60" r="44" fill="none" stroke="#fbcfe8" stroke-width="2.5" stroke-dasharray="14 8"/>
    </svg>
  `;
  layer.appendChild(burst);

  const bAnim = burst.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.35) rotate(0deg)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.12) rotate(35deg)', opacity: 1, offset: 0.35 },
      { transform: 'translate(-50%, -50%) scale(1.42) rotate(60deg)', opacity: 0 }
    ],
    { duration: 540, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
  );
  bAnim.finished.catch(() => {}).finally(() => burst.remove());

  if (cardEl) {
    cardEl.animate(
      [
        { transform: 'perspective(680px) rotateY(180deg) scale(0.92)', opacity: 0.8 },
        { transform: 'perspective(680px) rotateY(-8deg) scale(1.2)', opacity: 1, offset: 0.55 },
        { transform: 'perspective(680px) rotateY(0deg) scale(1)', opacity: 1 }
      ],
      { duration: 420, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
    );
  } else if (cardMeta) {
    spawn3dFlipStage(rect, cardMeta, destPileRect, color, delay);
  }
}

function spawnMonsterFlipVfx(rect, cardEl, label = 'FLIP!', delay = 0) {
  if (!rect) return;
  spawnCallout(rect, label, '#fbbf24', delay + 60);
  if (prefersReducedMotion()) return;

  const layer = getVfxLayer();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const burst = document.createElement('div');
  burst.className = 'vfx-flip-burst';
  burst.style.left = `${cx}px`;
  burst.style.top = `${cy}px`;
  burst.innerHTML = `
    <svg viewBox="0 0 120 120" width="110" height="110" aria-hidden="true">
      <circle cx="60" cy="60" r="44" fill="rgba(251,191,36,0.16)" stroke="#fbbf24" stroke-width="3"/>
      <polygon points="60,10 69,48 108,60 69,72 60,110 51,72 12,60 51,48" fill="none" stroke="#fef08a" stroke-width="2.5"/>
    </svg>
  `;
  layer.appendChild(burst);

  const bAnim = burst.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.4) rotate(-25deg)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.1) rotate(12deg)', opacity: 1, offset: 0.38 },
      { transform: 'translate(-50%, -50%) scale(1.4) rotate(35deg)', opacity: 0 }
    ],
    { duration: 520, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
  );
  bAnim.finished.catch(() => {}).finally(() => burst.remove());

  if (cardEl) {
    // Use individual rotate/scale properties so .def-position CSS transform stays intact!
    cardEl.animate(
      [
        { scale: '0.82', rotate: '-180deg', opacity: 0.72 },
        { scale: '1.22', rotate: '10deg', opacity: 1, offset: 0.6 },
        { scale: '1', rotate: '0deg', opacity: 1 }
      ],
      { duration: 420, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
    );
  }
}

function spawnPileActivationCutin(pileRect, cardMeta, chainLink, delay = 0) {
  if (!pileRect || !cardMeta || prefersReducedMotion()) return;
  const layer = getVfxLayer();
  const theme = getFrameSummonTheme(cardMeta);
  const cx = pileRect.left + pileRect.width / 2;
  const cy = pileRect.top + pileRect.height / 2;

  const cutin = document.createElement('div');
  cutin.className = `vfx-pile-cutin ${getCardFrameClass(cardMeta)}`;
  cutin.style.left = `${cx}px`;
  cutin.style.top = `${cy}px`;
  cutin.style.setProperty('--vfx-color', '#38bdf8');
  cutin.style.setProperty('--vfx-glow', 'rgba(56, 189, 248, 0.75)');

  const img = document.createElement('img');
  img.src = getCardArtUrl(cardMeta);
  img.alt = '';
  img.className = 'vfx-ghost-img';
  cutin.appendChild(img);
  layer.appendChild(cutin);

  const label = chainLink ? `CL${chainLink} • ${cardMeta.name || 'ACTIVATE'}` : (cardMeta.name || theme.label);
  spawnCallout(pileRect, label, '#38bdf8', delay + 40);

  const anim = cutin.animate(
    [
      { transform: 'translate(-50%, -20%) scale(0.45)', opacity: 0 },
      { transform: 'translate(-50%, -85%) scale(1.18)', opacity: 1, offset: 0.35 },
      { transform: 'translate(-50%, -92%) scale(1.12)', opacity: 1, offset: 0.72 },
      { transform: 'translate(-50%, -125%) scale(0.75)', opacity: 0 }
    ],
    { duration: 720, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
  );
  anim.finished.catch(() => {}).finally(() => cutin.remove());
}

function spawnSummonBurst(rect, card, delay = 0) {
  if (!rect || prefersReducedMotion()) return;
  const layer = getVfxLayer();
  const theme = getFrameSummonTheme(card);

  const ring = document.createElement('div');
  ring.className = 'vfx-summon-ring';
  ring.style.left = `${rect.left + rect.width / 2}px`;
  ring.style.top = `${rect.top + rect.height / 2}px`;
  ring.style.setProperty('--vfx-color', theme.color);
  ring.style.setProperty('--vfx-glow', theme.glow);
  layer.appendChild(ring);

  const anim = ring.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.45)', opacity: 0.95 },
      { transform: 'translate(-50%, -50%) scale(1.65)', opacity: 0 }
    ],
    { duration: 520, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
  );
  anim.finished.catch(() => {}).finally(() => ring.remove());

  if (card?.zone === 'MMZ' || card?.zone === 'EMZ' || card?.zone === 'FIELD' || !card?.zone) {
    spawnCallout(rect, theme.label, theme.color, delay + 30);
  }
}

function spawnCardSendGhost(cardInfo, prevRect, targetRect, cardDef, delay = 0) {
  if (!prevRect || !targetRect || prefersReducedMotion()) return;
  const layer = getVfxLayer();

  const ghost = document.createElement('div');
  ghost.className = `vfx-card-ghost ${getCardFrameClass(cardDef)}`;
  ghost.style.left = `${prevRect.left}px`;
  ghost.style.top = `${prevRect.top}px`;
  ghost.style.width = `${prevRect.width}px`;
  ghost.style.height = `${prevRect.height}px`;

  if (cardInfo?.artSrc || cardDef) {
    const img = document.createElement('img');
    img.src = cardInfo?.artSrc || getCardArtUrl(cardDef);
    img.alt = '';
    img.className = 'vfx-ghost-img';
    ghost.appendChild(img);
  }
  layer.appendChild(ghost);

  const dx = (targetRect.left + targetRect.width / 2) - (prevRect.left + prevRect.width / 2);
  const dy = (targetRect.top + targetRect.height / 2) - (prevRect.top + prevRect.height / 2);

  const anim = ghost.animate(
    [
      { transform: 'translate3d(0, 0, 0) scale(1) rotate(0deg)', opacity: 0.92 },
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.32) rotate(12deg)`, opacity: 0.08 }
    ],
    { duration: 360, delay, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' }
  );

  anim.finished.catch(() => {}).finally(() => ghost.remove());
}

function spawnBattleSlashVfx(targetRect, isDirect = false) {
  if (!targetRect || prefersReducedMotion()) return;
  const layer = getVfxLayer();
  const slash = document.createElement('div');
  slash.className = `vfx-battle-slash ${isDirect ? 'direct-hit' : ''}`;
  slash.style.left = `${targetRect.left + targetRect.width / 2}px`;
  slash.style.top = `${targetRect.top + targetRect.height / 2}px`;
  slash.innerHTML = `
    <svg viewBox="0 0 120 120" width="110" height="110" aria-hidden="true">
      <line x1="16" y1="104" x2="104" y2="16" stroke="#fde047" stroke-width="8" stroke-linecap="round" />
      <line x1="22" y1="98" x2="98" y2="22" stroke="#ef4444" stroke-width="3.5" stroke-linecap="round" />
      <circle cx="60" cy="60" r="24" fill="none" stroke="rgba(250, 204, 21, 0.7)" stroke-width="3" />
    </svg>
  `;
  layer.appendChild(slash);

  const anim = slash.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.4) rotate(-18deg)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.18) rotate(4deg)', opacity: 1, offset: 0.32 },
      { transform: 'translate(-50%, -50%) scale(1.42) rotate(8deg)', opacity: 0 }
    ],
    { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
  );
  anim.finished.catch(() => {}).finally(() => slash.remove());
}

function spawnLpDeltaPopup(lpValueEl, delta) {
  if (!lpValueEl || delta === 0) return;
  const rect = lpValueEl.getBoundingClientRect();
  if (rect.width === 0) return;

  const layer = getVfxLayer();
  const pop = document.createElement('div');
  pop.className = `vfx-lp-delta ${delta < 0 ? 'lp-loss' : 'lp-gain'}`;
  pop.textContent = `${delta > 0 ? '+' : ''}${delta} LP`;
  pop.style.left = `${rect.left + rect.width / 2}px`;
  pop.style.top = `${rect.top}px`;
  layer.appendChild(pop);

  const startY = prefersReducedMotion() ? '-6px' : '0px';
  const endY = prefersReducedMotion() ? '-8px' : '-34px';
  const anim = pop.animate(
    [
      { transform: `translate(-50%, ${startY}) scale(0.9)`, opacity: 0 },
      { transform: `translate(-50%, -14px) scale(1.12)`, opacity: 1, offset: 0.25 },
      { transform: `translate(-50%, ${endY}) scale(1)`, opacity: 0 }
    ],
    { duration: 920, easing: 'ease-out' }
  );
  anim.finished.catch(() => {}).finally(() => pop.remove());
}

function animatePositionPivot(cardEl, prevPos, newPos, delay = 0) {
  if (!cardEl || prefersReducedMotion()) return;
  const wasDef = prevPos === POSITIONS.DEF || prevPos === POSITIONS.SET_DEF;
  const nowDef = newPos === POSITIONS.DEF || newPos === POSITIONS.SET_DEF;
  if (wasDef === nowDef) return;

  // Individual `rotate` composes additively with `.def-position`'s `-90deg` CSS transform.
  const startRotate = !wasDef && nowDef ? '90deg' : '-90deg';
  const startScale = !wasDef && nowDef ? '1.35' : '0.74';
  cardEl.animate(
    [
      { rotate: startRotate, scale: startScale },
      { rotate: '0deg', scale: '1.12', offset: 0.65 },
      { rotate: '0deg', scale: '1' }
    ],
    { duration: 280, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
  );
}

function animateHandRearrangeFlip(prev, me, myIdx, consumedPrevHandIndices) {
  if (!prev?.handOrder?.length || prefersReducedMotion()) return;
  const survivingOld = prev.handOrder.filter((entry) => !consumedPrevHandIndices.has(entry.index));
  if (survivingOld.length === 0) return;

  let oldCursor = 0;
  for (let newIdx = 0; newIdx < me.hand.length; newIdx++) {
    if (oldCursor >= survivingOld.length) break;
    const card = me.hand[newIdx];
    const oldEntry = survivingOld[oldCursor];
    const cardPasscode = String(card.passcode || card.id || '');
    if (oldEntry.passcode && cardPasscode && oldEntry.passcode !== cardPasscode) {
      continue;
    }
    oldCursor++;
    const newEl = resolveLiveCardEl(myIdx, 'HAND', newIdx, myIdx);
    if (!newEl) continue;
    const newRect = newEl.getBoundingClientRect();
    const dx = oldEntry.rect.left - newRect.left;
    if (Math.abs(dx) > 6 && newEl.getAnimations().length === 0) {
      newEl.animate(
        [
          { translate: `${dx}px 0px` },
          { translate: '0px 0px' }
        ],
        { duration: 230, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
    }
  }
}

function playEventDrivenAnimations(prev, newState, myIdx) {
  const events = newState.recentEvents || [];
  const me = newState.players[myIdx];
  const oppIdx = 1 - myIdx;
  const opp = newState.players[oppIdx];

  // Pair material exits cleanly with their resulting SUMMON event
  const summonMaterialMap = new Map();
  const consumedMoveIndices = new Set();
  const fieldActivatedZones = new Set();
  const consumedPrevHandIndices = new Set();

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === 'MOVE' && ev.from?.controller === myIdx && ev.from?.zone === 'HAND') {
      consumedPrevHandIndices.add(ev.from.index);
    }
    if (ev.type !== 'SUMMON') continue;
    const mats = [];
    for (let j = i - 1; j >= 0 && j >= i - 7; j--) {
      const candidate = events[j];
      if (candidate.type === 'SUMMON' || candidate.type === 'ATTACK') break;
      if (candidate.type !== 'MOVE') continue;
      const toZ = candidate.to?.zone;
      const fromZ = candidate.from?.zone;
      const isMaterialExit = (
        toZ === 'GY' || toZ === 'BANISHED' || toZ === 'EXTRA' || toZ === 'OVERLAY'
      ) && (
        fromZ === 'MMZ' || fromZ === 'EMZ' || fromZ === 'HAND' || fromZ === 'STZ' || fromZ === 'GY'
      );
      if (isMaterialExit) {
        const r = resolvePrevRect(candidate.from, prev, myIdx);
        if (r) mats.push(r);
        consumedMoveIndices.add(j);
      }
    }
    // Also grab immediate post-summon OVERLAY attaches (e.g. Xyz Summon material absorption)
    for (let k = i + 1; k < events.length && k <= i + 6; k++) {
      const candidate = events[k];
      if (candidate.type === 'SUMMON') break;
      if (candidate.type === 'MOVE' && candidate.to?.zone === 'OVERLAY' && candidate.to?.controller === ev.controller) {
        const r = resolvePrevRect(candidate.from, prev, myIdx);
        if (r) mats.push(r);
        consumedMoveIndices.add(k);
      }
    }
    summonMaterialMap.set(i, mats);
  }

  let specialSummonCountThisBatch = 0;
  events.forEach((e) => {
    if (e.type === 'SUMMON' && e.summonKind === 'SPECIAL') specialSummonCountThisBatch++;
  });

  let drawStagger = 0;
  let stepOrder = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const delay = Math.min(stepOrder * 75, 480);

    if (ev.type === 'DRAW') {
      const isSelfDraw = ev.controller === myIdx;
      const drawCount = Math.max(1, ev.count || 1);
      if (isSelfDraw) {
        const deckOrigin = prev.piles.selfDeck;
        const startIdx = Math.max(0, me.hand.length - drawCount);
        for (let hIdx = startIdx; hIdx < me.hand.length; hIdx++) {
          const cardEl = resolveLiveCardEl(myIdx, 'HAND', hIdx, myIdx);
          if (cardEl && deckOrigin && cardEl.getAnimations().length === 0) {
            animateElementFlight(cardEl, deckOrigin, cardEl.getBoundingClientRect(), {
              duration: 300,
              delay: drawStagger * 55,
              startScale: 0.72,
              startRotateDeg: -10
            });
            drawStagger++;
          }
        }
      } else if (prev.piles.oppDeck) {
        const backs = document.querySelectorAll('#opp-hand-bar .opp-hand-card-back');
        const startIdx = Math.max(0, backs.length - drawCount);
        for (let bIdx = startIdx; bIdx < backs.length; bIdx++) {
          const b = backs[bIdx];
          if (b && b.getAnimations().length === 0) {
            animateElementFlight(b, prev.piles.oppDeck, b.getBoundingClientRect(), {
              duration: 280,
              delay: (bIdx - startIdx) * 55,
              startScale: 0.85,
              startRotateDeg: 10
            });
          }
        }
      }
      stepOrder++;
      continue;
    }

    if (ev.type === 'SUMMON') {
      const cardEl = resolveLiveCardEl(ev.controller, ev.zone, ev.index, myIdx);
      const toRect = resolveLiveRect({ controller: ev.controller, zone: ev.zone, index: ev.index }, prev, myIdx);
      const mats = summonMaterialMap.get(i) || [];
      const frame = ev.meta?.frame;
      const zoneKey = `${ev.controller}:${ev.zone}:${ev.index}`;
      fieldActivatedZones.add(zoneKey);

      if (ev.summonKind === 'FLIP') {
        spawnMonsterFlipVfx(toRect, cardEl, 'FLIP SUMMON!', delay);
      } else if (frame === MONSTER_FRAMES.FUSION) {
        spawnFusionSummonVfx(toRect, cardEl, mats, delay);
      } else if (frame === MONSTER_FRAMES.SYNCHRO) {
        spawnSynchroSummonVfx(toRect, cardEl, mats, delay);
      } else if (frame === MONSTER_FRAMES.XYZ) {
        spawnXyzSummonVfx(toRect, cardEl, mats, delay);
      } else if (frame === MONSTER_FRAMES.LINK) {
        spawnLinkSummonVfx(toRect, cardEl, mats, delay);
      } else if (frame === 'RITUAL') {
        spawnRitualSummonVfx(toRect, cardEl, mats, delay);
      } else {
        // Check preceding MOVE origin to fly card smoothly from Hand/Deck/GY/Extra to zone
        let originRect = null;
        for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
          const m = events[j];
          if (m.type === 'MOVE' && m.to?.controller === ev.controller && m.to?.zone === ev.zone && m.to?.index === ev.index) {
            originRect = resolvePrevRect(m.from, prev, myIdx);
            consumedMoveIndices.add(j);
            break;
          }
        }
        if (originRect && cardEl && toRect) {
          animateElementFlight(cardEl, originRect, toRect, { duration: 310, delay, startScale: 1.12, midScale: 1.16 });
        }
        if (mats.length > 0 && ev.summonKind === 'NORMAL') {
          spawnMaterialOrbs(mats, toRect, '#facc15', 'rgba(250, 204, 21, 0.85)', delay);
          spawnCallout(toRect, 'TRIBUTE SUMMON', '#facc15', delay + 60);
        } else if (ev.summonKind === 'SPECIAL') {
          if (specialSummonCountThisBatch >= 2 || ev.meta?.isPendulum) {
            spawnPendulumBeamVfx(toRect, ev.controller, myIdx, delay);
            spawnCallout(toRect, ev.meta?.isPendulum ? 'PENDULUM SUMMON' : 'SPECIAL SUMMON', '#2dd4bf', delay + 40);
          } else {
            spawnSummonBurst(toRect, { ...ev.meta, zone: ev.zone }, delay);
          }
        } else {
          spawnPlacementRipple(toRect, false, delay);
          spawnSummonBurst(toRect, { ...ev.meta, zone: ev.zone }, delay);
        }
      }
      stepOrder++;
      continue;
    }

    if (ev.type === 'SET') {
      const zoneKey = `${ev.controller}:${ev.zone}:${ev.index}`;
      fieldActivatedZones.add(zoneKey);
      const cardEl = resolveLiveCardEl(ev.controller, ev.zone, ev.index, myIdx);
      const toRect = resolveLiveRect({ controller: ev.controller, zone: ev.zone, index: ev.index }, prev, myIdx);
      let originRect = null;
      for (let j = i - 1; j >= 0 && j >= i - 2; j--) {
        const m = events[j];
        if (m.type === 'MOVE' && m.to?.controller === ev.controller && m.to?.zone === ev.zone && m.to?.index === ev.index) {
          originRect = resolvePrevRect(m.from, prev, myIdx);
          consumedMoveIndices.add(j);
          break;
        }
      }
      if (cardEl && originRect && toRect) {
        animateElementFlight(cardEl, originRect, toRect, { duration: 320, delay, startScale: 1.08, midScale: 1.14, flipYDeg: 180 });
      }
      spawnPlacementRipple(toRect, true, delay + 90);
      stepOrder++;
      continue;
    }

    if (ev.type === 'POS_CHANGE') {
      const zoneKey = `${ev.controller}:${ev.zone}:${ev.index}`;
      if (fieldActivatedZones.has(zoneKey)) continue;
      fieldActivatedZones.add(zoneKey);
      const cardEl = resolveLiveCardEl(ev.controller, ev.zone, ev.index, myIdx);
      const rect = resolveLiveRect({ controller: ev.controller, zone: ev.zone, index: ev.index }, prev, myIdx);

      if (ev.prevFaceDown && !ev.nowFaceDown) {
        const isSelf = ev.controller === myIdx;
        const destGy = isSelf ? prev.piles.selfGy : prev.piles.oppGy;
        if (ev.meta?.kind === 'TRAP') {
          spawnTrapFlipVfx(rect, ev.meta, cardEl, cardEl ? null : destGy, delay);
        } else if (ev.meta?.kind === 'SPELL') {
          spawnSpellActivationVfx(rect, ev.meta, cardEl, cardEl ? null : destGy, delay);
        } else {
          spawnMonsterFlipVfx(rect, cardEl, 'FLIP!', delay);
        }
      } else if (!ev.prevFaceDown && ev.nowFaceDown) {
        if (cardEl && !prefersReducedMotion()) {
          cardEl.animate(
            [
              { transform: 'perspective(680px) rotateY(-180deg) scale(1.08)' },
              { transform: 'perspective(680px) rotateY(0deg) scale(1)' }
            ],
            { duration: 300, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
          );
        }
        spawnPlacementRipple(rect, true, delay + 80);
      } else {
        animatePositionPivot(cardEl, ev.prevPosition, ev.position, delay);
      }
      stepOrder++;
      continue;
    }

    if (ev.type === 'CHAINING') {
      const zoneKey = `${ev.controller}:${ev.zone}:${ev.index}`;
      const isFieldSlot = ev.zone === 'MMZ' || ev.zone === 'STZ' || ev.zone === 'FIELD' || ev.zone === 'EMZ';
      const isSelf = ev.controller === myIdx;
      const destGy = isSelf ? prev.piles.selfGy : prev.piles.oppGy;

      if (isFieldSlot) {
        const cardEl = resolveLiveCardEl(ev.controller, ev.zone, ev.index, myIdx);
        const rect = resolveLiveRect({ controller: ev.controller, zone: ev.zone, index: ev.index }, prev, myIdx);
        if (ev.meta?.kind === 'SPELL') {
          if (!fieldActivatedZones.has(zoneKey)) {
            fieldActivatedZones.add(zoneKey);
            spawnSpellActivationVfx(rect, ev.meta, cardEl, cardEl ? null : destGy, delay);
          }
        } else if (ev.meta?.kind === 'TRAP') {
          if (!fieldActivatedZones.has(zoneKey)) {
            fieldActivatedZones.add(zoneKey);
            spawnTrapFlipVfx(rect, ev.meta, cardEl, cardEl ? null : destGy, delay);
          }
        } else {
          spawnSummonBurst(rect, { ...ev.meta, zone: ev.zone }, delay);
          if (cardEl && !prefersReducedMotion()) {
            cardEl.animate(
              [
                { translate: '0px 0px', scale: '1' },
                { translate: '0px -6px', scale: '1.15', offset: 0.42 },
                { translate: '0px 0px', scale: '1' }
              ],
              { duration: 360, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
            );
          }
        }
      } else {
        // Activated in Hand, GY, Banished, Extra, or Deck -> crisp Cut-In ghost above that zone
        const pileRect = resolveLiveRect({ controller: ev.controller, zone: ev.zone, index: ev.index }, prev, myIdx)
          || resolvePrevRect({ controller: ev.controller, zone: ev.zone, index: ev.index }, prev, myIdx);
        spawnPileActivationCutin(pileRect, ev.meta, ev.chainLink, delay);
      }
      stepOrder++;
      continue;
    }

    if (ev.type === 'MOVE' && !consumedMoveIndices.has(i)) {
      const from = ev.from;
      const to = ev.to;
      if (!from || !to) continue;
      if (from.zone === 'HAND' && to.zone === 'HAND' && from.controller === to.controller) continue;

      const fromRect = resolvePrevRect(from, prev, myIdx);
      const toIsField = to.zone === 'MMZ' || to.zone === 'STZ' || to.zone === 'FIELD' || to.zone === 'EMZ';

      if (to.zone === 'HAND') {
        const cardEl = resolveLiveCardEl(to.controller, 'HAND', to.index, myIdx);
        const toRect = resolveLiveRect(to, prev, myIdx);
        if (cardEl && fromRect && toRect) {
          animateElementFlight(cardEl, fromRect, toRect, {
            duration: 300,
            delay: drawStagger * 50,
            startScale: 0.72,
            startRotateDeg: to.controller === myIdx ? -10 : 10
          });
          drawStagger++;
        }
      } else if (toIsField) {
        const cardEl = resolveLiveCardEl(to.controller, to.zone, to.index, myIdx);
        const toRect = resolveLiveRect(to, prev, myIdx);
        const zoneKey = `${to.controller}:${to.zone}:${to.index}`;
        const isPendulumScalePlace = ev.meta?.isPendulum && to.zone === 'STZ' && (to.index === 0 || to.index === 4) && !to.isFaceDown;

        if (cardEl && fromRect && toRect) {
          animateElementFlight(cardEl, fromRect, toRect, {
            duration: 310,
            delay,
            startScale: 1.08,
            midScale: 1.15,
            flipYDeg: to.isFaceDown ? 180 : 0
          });
        }
        if (isPendulumScalePlace && !fieldActivatedZones.has(zoneKey)) {
          fieldActivatedZones.add(zoneKey);
          spawnCallout(toRect, 'PENDULUM SCALE', '#2dd4bf', delay + 50);
          spawnPlacementRipple(toRect, false, delay);
        } else if (ev.meta?.kind === 'SPELL' && !to.isFaceDown && !fieldActivatedZones.has(zoneKey)) {
          fieldActivatedZones.add(zoneKey);
          const isSelf = to.controller === myIdx;
          spawnSpellActivationVfx(toRect, ev.meta, cardEl, cardEl ? null : (isSelf ? prev.piles.selfGy : prev.piles.oppGy), delay);
        } else if (!fieldActivatedZones.has(zoneKey)) {
          spawnPlacementRipple(toRect, to.isFaceDown, delay + 70);
        }
      } else if (to.zone === 'GY' || to.zone === 'BANISHED' || to.zone === 'EXTRA' || to.zone === 'DECK') {
        const isFromVisibleOrSelf = from.zone !== 'DECK' && from.zone !== 'EXTRA';
        const toRect = resolveLiveRect(to, prev, myIdx);
        if (isFromVisibleOrSelf && fromRect && toRect) {
          const prevZoneEntry = prev.zones.get(`${from.controller}:${from.zone}:${from.index}`);
          spawnCardSendGhost(prevZoneEntry, fromRect, toRect, ev.meta, delay);
        }
      }
      stepOrder++;
    }
  }

  // Smoothly slide surviving cards in player hand after draws/plays/discards
  animateHandRearrangeFlip(prev, me, myIdx, consumedPrevHandIndices);

  // Also ensure any opponent draws animate from deck when no explicit HAND cardEl existed
  const oppDraws = (opp?.hand?.length ?? 0) - prev.oppHandCount;
  if (oppDraws > 0 && prev.piles.oppDeck) {
    const backs = document.querySelectorAll('#opp-hand-bar .opp-hand-card-back');
    for (let i = Math.max(0, backs.length - oppDraws); i < backs.length; i++) {
      const b = backs[i];
      if (b.getAnimations().length === 0) {
        animateElementFlight(b, prev.piles.oppDeck, b.getBoundingClientRect(), {
          duration: 280,
          delay: (i - (backs.length - oppDraws)) * 55,
          startScale: 0.85
        });
      }
    }
  }
}

function playLegacyBoardDiffAnimations(prev, newState, myIdx) {
  const oppIdx = 1 - myIdx;
  const me = newState.players[myIdx];
  const opp = newState.players[oppIdx];

  // Hand Draws (Deck -> Hand)
  let drawStagger = 0;
  for (const card of me.hand) {
    if (!prev.cards.has(card.instanceId)) {
      const cardEl = document.querySelector(`.duel-card[data-instance-id="${card.instanceId}"]`);
      const origin = prev.piles.selfDeck;
      if (cardEl && origin) {
        animateElementFlight(cardEl, origin, cardEl.getBoundingClientRect(), {
          duration: 300,
          delay: drawStagger * 55,
          startScale: 0.72
        });
        drawStagger++;
      }
    }
  }

  // Opponent Hand Draws
  const newOppDraws = opp.hand.length - prev.oppHandCount;
  if (newOppDraws > 0 && prev.piles.oppDeck) {
    const backs = document.querySelectorAll('#opp-hand-bar .opp-hand-card-back');
    for (let i = Math.max(0, backs.length - newOppDraws); i < backs.length; i++) {
      const b = backs[i];
      animateElementFlight(b, prev.piles.oppDeck, b.getBoundingClientRect(), {
        duration: 280,
        delay: (i - (backs.length - newOppDraws)) * 55,
        startScale: 0.85
      });
    }
  }

  // Field Placement / Summon / Flip / Position Swap
  const fieldSets = [
    ...me.mmz, me.emz, ...me.stz, me.fieldSpell,
    ...opp.mmz, opp.emz, ...opp.stz, opp.fieldSpell
  ].filter(Boolean);

  for (const card of fieldSets) {
    const prevEntry = prev.cards.get(card.instanceId);
    const cardEl = document.querySelector(`.duel-card[data-instance-id="${card.instanceId}"]`);
    if (!cardEl) continue;
    const toRect = cardEl.getBoundingClientRect();

    if (!prevEntry || (prevEntry.zone !== card.zone && prevEntry.zone !== 'MMZ' && prevEntry.zone !== 'EMZ' && prevEntry.zone !== 'STZ' && prevEntry.zone !== 'FIELD')) {
      const isSelfOwned = card.controller === myIdx;
      const isExtra = [
        MONSTER_FRAMES.FUSION,
        MONSTER_FRAMES.SYNCHRO,
        MONSTER_FRAMES.XYZ,
        MONSTER_FRAMES.LINK
      ].includes(card.frame);

      let originRect = prevEntry?.rect || null;
      if (!originRect) {
        originRect = isExtra
          ? (isSelfOwned ? prev.piles.selfExtra : prev.piles.oppExtra)
          : (isSelfOwned ? prev.piles.selfDeck : prev.piles.oppDeck);
      }
      if (originRect) {
        animateElementFlight(cardEl, originRect, toRect, { duration: 310, startScale: 1.15 });
      }
      if (card.frame === MONSTER_FRAMES.FUSION) spawnFusionSummonVfx(toRect, cardEl, []);
      else if (card.frame === MONSTER_FRAMES.SYNCHRO) spawnSynchroSummonVfx(toRect, cardEl, []);
      else if (card.frame === MONSTER_FRAMES.XYZ) spawnXyzSummonVfx(toRect, cardEl, []);
      else if (card.frame === MONSTER_FRAMES.LINK) spawnLinkSummonVfx(toRect, cardEl, []);
      else if (card.kind === 'SPELL' && card.position !== POSITIONS.SET) spawnSpellActivationVfx(toRect, card, cardEl, null);
      else spawnSummonBurst(toRect, card);
    } else if (prevEntry.position !== card.position) {
      const wasFaceDown = prevEntry.position === POSITIONS.SET || prevEntry.position === POSITIONS.SET_DEF;
      const nowFaceUp = card.position !== POSITIONS.SET && card.position !== POSITIONS.SET_DEF;
      if (wasFaceDown && nowFaceUp) {
        if (card.kind === 'TRAP') spawnTrapFlipVfx(toRect, card, cardEl, null);
        else if (card.kind === 'SPELL') spawnSpellActivationVfx(toRect, card, cardEl, null);
        else spawnMonsterFlipVfx(toRect, cardEl, 'FLIP!');
      } else {
        animatePositionPivot(cardEl, prevEntry.position, card.position);
      }
    }
  }

  // Sent to GY / Banished
  const inspectPileFlights = (pileCards, destRect) => {
    if (!destRect) return;
    for (const c of pileCards) {
      const prevEntry = prev.cards.get(c.instanceId);
      if (prevEntry && (prevEntry.zone === 'MMZ' || prevEntry.zone === 'EMZ' || prevEntry.zone === 'STZ' || prevEntry.zone === 'FIELD' || prevEntry.zone === 'HAND')) {
        spawnCardSendGhost(prevEntry, prevEntry.rect, destRect, c);
      }
    }
  };
  inspectPileFlights(me.gy.slice(-6), prev.piles.selfGy);
  inspectPileFlights(opp.gy.slice(-6), prev.piles.oppGy);
  inspectPileFlights(me.banished.slice(-4), prev.piles.selfBanished);
  inspectPileFlights(opp.banished.slice(-4), prev.piles.oppBanished);
}

/**
 * Diff previous board snapshot against new state & newly rendered DOM, playing smooth animations.
 */
const TURN_BANNER_DURATION_MS = 1500;
const PHASE_BANNER_DURATION_MS = 1100;
const TURN_BANNER_GAP_MS = 60;

const PHASE_BANNER_LABELS = {
  DP: 'DRAW PHASE',
  SP: 'STANDBY PHASE',
  MP1: 'MAIN PHASE 1',
  BP: 'BATTLE PHASE',
  MP2: 'MAIN PHASE 2',
  EP: 'END PHASE'
};

const turnBannerState = {
  duelId: null,
  seenKeys: new Set(),
  queue: [],
  active: false,
  hideTimer: null,
  nextTimer: null
};

export function collectTurnTransitions(prevState, newState) {
  if (!newState || typeof newState.turnCount !== 'number') return [];
  const isNewDuel = !prevState || prevState.duelId !== newState.duelId;
  const prevSeq = !isNewDuel ? Number(prevState.eventSeq || 0) : -1;

  if (Array.isArray(newState.recentEvents)) {
    const newTurnEvents = newState.recentEvents
      .filter((ev) => ev && ev.type === 'NEW_TURN' && (isNewDuel || Number(ev.seq) > prevSeq))
      .sort((a, b) => Number(a.seq) - Number(b.seq));
    if (newTurnEvents.length > 0) {
      return newTurnEvents.map((ev) => ({
        turnCount: Number(ev.turnCount ?? newState.turnCount),
        turnPlayer: Number(ev.turnPlayer ?? newState.turnPlayer),
        turnPlayerName: ev.turnPlayerName || ''
      }));
    }
  }

  if (isNewDuel || prevState.turnCount !== newState.turnCount || prevState.turnPlayer !== newState.turnPlayer) {
    return [{
      turnCount: newState.turnCount,
      turnPlayer: newState.turnPlayer,
      turnPlayerName: newState.players?.[newState.turnPlayer]?.name || ''
    }];
  }

  return [];
}

export function getTurnBannerDisplay(transition, myIdx) {
  const isSelfTurn = transition.turnPlayer === myIdx;
  return {
    isSelfTurn,
    text: isSelfTurn ? 'YOUR TURN' : 'YOUR OPPONENT TURN',
    themeClass: isSelfTurn ? 'is-self-turn' : 'is-opp-turn',
    subText: `TURN ${transition.turnCount}`,
    durationMs: TURN_BANNER_DURATION_MS
  };
}

export function getPhaseBannerDisplay(phase, turnCount, turnPlayer, myIdx) {
  const isSelfTurn = turnPlayer === myIdx;
  const label = PHASE_BANNER_LABELS[phase] || String(phase || '').toUpperCase();
  const battleClass = phase === 'BP' ? ' is-battle-phase' : '';
  return {
    isSelfTurn,
    text: label,
    themeClass: `is-phase-change ${isSelfTurn ? 'is-self-turn' : 'is-opp-turn'}${battleClass}`,
    subText: `TURN ${turnCount} • ${isSelfTurn ? 'YOUR TURN' : 'OPPONENT TURN'}`,
    durationMs: PHASE_BANNER_DURATION_MS
  };
}

export function resetTurnChangeBannerQueue() {
  if (turnBannerState.hideTimer) {
    clearTimeout(turnBannerState.hideTimer);
    turnBannerState.hideTimer = null;
  }
  if (turnBannerState.nextTimer) {
    clearTimeout(turnBannerState.nextTimer);
    turnBannerState.nextTimer = null;
  }
  turnBannerState.queue = [];
  turnBannerState.active = false;
  turnBannerState.duelId = null;
  turnBannerState.seenKeys.clear();

  if (typeof document !== 'undefined') {
    const banner = document.getElementById('turn-change-banner');
    if (banner) {
      banner.innerHTML = '';
    }
  }
}

function pumpTurnBannerQueue() {
  if (turnBannerState.active || turnBannerState.queue.length === 0) return;
  if (typeof document === 'undefined') return;

  const duelScreen = document.getElementById('screen-duel');
  const banner = document.getElementById('turn-change-banner');
  if (!banner || (duelScreen && !duelScreen.classList.contains('active'))) {
    resetTurnChangeBannerQueue();
    return;
  }

  turnBannerState.active = true;
  const item = turnBannerState.queue.shift();

  banner.innerHTML = '';
  const card = document.createElement('div');
  card.className = `turn-banner-card ${item.themeClass}`;
  card.dataset.turnText = item.text;

  const sweep = document.createElement('div');
  sweep.className = 'turn-banner-sweep';
  sweep.setAttribute('aria-hidden', 'true');

  const sub = document.createElement('div');
  sub.className = 'turn-banner-sub';
  sub.textContent = item.subText;

  const title = document.createElement('div');
  title.className = 'turn-banner-title';
  title.textContent = item.text;

  card.append(sweep, sub, title);
  banner.appendChild(card);

  turnBannerState.hideTimer = setTimeout(() => {
    turnBannerState.hideTimer = null;
    if (banner.contains(card)) {
      banner.innerHTML = '';
    }
    turnBannerState.active = false;
    if (turnBannerState.queue.length > 0) {
      turnBannerState.nextTimer = setTimeout(() => {
        turnBannerState.nextTimer = null;
        pumpTurnBannerQueue();
      }, TURN_BANNER_GAP_MS);
    }
  }, item.durationMs || TURN_BANNER_DURATION_MS);
}

export function enqueueTurnChangeBanners(prevState, newState, myIdx) {
  if (!newState) return;
  if (newState.duelId && turnBannerState.duelId !== newState.duelId) {
    resetTurnChangeBannerQueue();
    turnBannerState.duelId = newState.duelId;
  }

  const transitions = collectTurnTransitions(prevState, newState);
  for (const tr of transitions) {
    const key = `${newState.duelId || 'duel'}:${tr.turnCount}:${tr.turnPlayer}`;
    if (turnBannerState.seenKeys.has(key)) continue;
    turnBannerState.seenKeys.add(key);
    turnBannerState.queue.push(getTurnBannerDisplay(tr, myIdx));
  }

  // Enqueue phase change banner when phase changes within an active duel
  if (
    prevState &&
    prevState.duelId === newState.duelId &&
    newState.phase &&
    prevState.phase !== newState.phase &&
    PHASE_BANNER_LABELS[newState.phase]
  ) {
    const phaseKey = `phase:${newState.duelId || 'duel'}:${newState.turnCount}:${newState.turnPlayer}:${newState.phase}`;
    if (!turnBannerState.seenKeys.has(phaseKey)) {
      turnBannerState.seenKeys.add(phaseKey);
      turnBannerState.queue.push(
        getPhaseBannerDisplay(newState.phase, newState.turnCount, newState.turnPlayer, myIdx)
      );
    }
  }

  pumpTurnBannerQueue();
}

export function playBoardDiffAnimations(prev, newState, myIdx) {
  if (!prev || !newState || prev.duelId !== newState.duelId) return;
  const oppIdx = 1 - myIdx;
  const me = newState.players[myIdx];
  const opp = newState.players[oppIdx];

  // 1. Floating LP Delta Popups
  if (me.lp !== prev.selfLp) {
    spawnLpDeltaPopup(document.getElementById('self-lp-value'), me.lp - prev.selfLp);
  }
  if (opp.lp !== prev.oppLp) {
    spawnLpDeltaPopup(document.getElementById('opp-lp-value'), opp.lp - prev.oppLp);
  }

  // 2. Card Placing, Summon Mechanics (Fusion/Synchro/Xyz/Link/Ritual), Spell Activation, Trap & Monster Flips
  const hasNewOcgEvents = Array.isArray(newState.recentEvents) && newState.recentEvents.length > 0 && newState.eventSeq !== prev.lastEventSeq;
  if (hasNewOcgEvents) {
    playEventDrivenAnimations(prev, newState, myIdx);
  } else {
    playLegacyBoardDiffAnimations(prev, newState, myIdx);
  }

  // 3. Battle Attack Lunge & Slash VFX
  const battle = newState.lastBattleEvent;
  if (battle && battle.seq !== prev.lastBattleSeq) {
    const attackerEl = document.querySelector(`.duel-card[data-instance-id="${battle.attackerInstanceId}"]`)
      || resolveLiveCardEl(battle.attackerPlayerIndex, battle.attackerZone || 'MMZ', battle.attackerIndex ?? 0, myIdx);
    const attackerRect = attackerEl?.getBoundingClientRect()
      || prev.cards.get(battle.attackerInstanceId)?.rect
      || resolvePrevRect({ controller: battle.attackerPlayerIndex, zone: battle.attackerZone || 'MMZ', index: battle.attackerIndex ?? 0 }, prev, myIdx);

    let targetRect = null;
    if (battle.directAttack) {
      const isPlayerAttacking = battle.attackerPlayerIndex === myIdx;
      targetRect = isPlayerAttacking
        ? getRectIfVisible('#opp-lp-value') || prev.piles.oppHud
        : getRectIfVisible('#self-lp-value') || prev.piles.selfLp;
    } else if (battle.targetInstanceId || typeof battle.targetIndex === 'number') {
      const targetEl = (battle.targetInstanceId && document.querySelector(`.duel-card[data-instance-id="${battle.targetInstanceId}"]`))
        || resolveLiveCardEl(battle.targetPlayerIndex, battle.targetZone || 'MMZ', battle.targetIndex ?? 0, myIdx);
      targetRect = targetEl?.getBoundingClientRect()
        || (battle.targetInstanceId && prev.cards.get(battle.targetInstanceId)?.rect)
        || resolvePrevRect({ controller: battle.targetPlayerIndex, zone: battle.targetZone || 'MMZ', index: battle.targetIndex ?? 0 }, prev, myIdx);
    }

    if (attackerEl && attackerRect && targetRect && !prefersReducedMotion()) {
      const dx = ((targetRect.left + targetRect.width / 2) - (attackerRect.left + attackerRect.width / 2)) * 0.72;
      const dy = ((targetRect.top + targetRect.height / 2) - (attackerRect.top + attackerRect.height / 2)) * 0.72;
      attackerEl.animate(
        [
          { translate: '0px 0px', scale: '1', zIndex: 30 },
          { translate: `${dx}px ${dy}px`, scale: '1.16', zIndex: 30, offset: 0.42 },
          { translate: '0px 0px', scale: '1', zIndex: 30 }
        ],
        { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
    }

    if (targetRect) {
      setTimeout(() => {
        spawnBattleSlashVfx(targetRect, battle.directAttack);
        const playmatEl = document.getElementById('playmat-container');
        if (playmatEl && battle.damage > 0 && !prefersReducedMotion()) {
          playmatEl.animate(
            [
              { translate: '0px 0px' },
              { translate: '0px 5px', offset: 0.3 },
              { translate: '0px -3px', offset: 0.65 },
              { translate: '0px 0px' }
            ],
            { duration: 220, easing: 'ease-out' }
          );
        }
      }, prefersReducedMotion() ? 0 : 120);
    }
  }
}
