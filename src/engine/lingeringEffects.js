/**
 * @fileoverview Pure, deterministic lingering-effect & turn-restriction tracker.
 * Zero I/O, zero WebSocket/ocgcore imports — fully unit-testable.
 */

import { LINGERING_DURATION_LABELS, getLingeringCatalogEntry } from './lingeringCatalog.js';

export const PLAYER_HINT_DESC_ADD = 6;
export const PLAYER_HINT_DESC_REMOVE = 7;

/**
 * Decode ProjectIgnis `aux.Stringid(code, index)` / packed 64-bit hint description.
 * @param {bigint|number|string} rawDesc
 * @returns {{ code: number, descIndex: number }}
 */
export function decodeOcgHintDesc(rawDesc) {
  let d = 0n;
  try {
    d = typeof rawDesc === 'bigint' ? rawDesc : BigInt(rawDesc || 0);
  } catch {
    return { code: 0, descIndex: 0 };
  }
  if (d >= 16n) {
    return {
      code: Number(d >> 4n),
      descIndex: Number(d & 15n)
    };
  }
  return { code: 0, descIndex: Number(d) };
}

export function createLingeringTracker() {
  return {
    entries: new Map(),
    seq: 0
  };
}

export function resetTracker(tracker) {
  if (!tracker) return;
  tracker.entries.clear();
  tracker.seq = 0;
}

function inferCategoryFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/banish|removed instead/i.test(t)) return 'banish';
  if (/negate|disabled/i.test(t)) return 'negate';
  if (/draw\b/i.test(t) && !/cannot draw/i.test(t)) return 'draw';
  if (/special summon|extra deck|fusion|synchro|xyz|link/i.test(t)) return 'lock';
  return 'restriction';
}

function makeShortBadge(text, fallback = 'Restriction') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  if (clean.length <= 14) return clean;
  return `${clean.slice(0, 13).trimEnd()}…`;
}

function resolveAffectedPlayer(relativeScope, activatorPlayer) {
  const p = activatorPlayer === 1 ? 1 : 0;
  if (relativeScope === 'both') return -1;
  if (relativeScope === 'opponent') return 1 - p;
  return p;
}

function findMatchingEntryKey(tracker, code, affectedPlayer, turn) {
  if (!code) return null;
  for (const [key, entry] of tracker.entries.entries()) {
    if (
      entry.code === code &&
      entry.turnApplied === turn &&
      (entry.affectedPlayer === affectedPlayer || entry.affectedPlayer === -1 || affectedPlayer === -1)
    ) {
      return key;
    }
  }
  return null;
}

/**
 * Apply an ocgcore MSG_PLAYER_HINT (`DESC_ADD` / `DESC_REMOVE`).
 */
export function applyPlayerHint(tracker, { player, hintType, desc, turn = 1, resolveDesc, getCardMeta } = {}) {
  if (!tracker) return;
  const p = player === 1 ? 1 : 0;
  const { code, descIndex } = decodeOcgHintDesc(desc);
  const hintKey = `hint:${code}:${descIndex}:${p}`;

  if (hintType === PLAYER_HINT_DESC_REMOVE) {
    tracker.entries.delete(hintKey);
    // Also remove any catalog entry merged/matching this code + player
    for (const [k, entry] of tracker.entries.entries()) {
      if (entry.code === code && (entry.affectedPlayer === p || entry.affectedPlayer === -1)) {
        tracker.entries.delete(k);
      }
    }
    return;
  }

  if (hintType !== PLAYER_HINT_DESC_ADD) return;

  const catalog = getLingeringCatalogEntry(code);
  const meta = typeof getCardMeta === 'function' && code ? getCardMeta(code) : null;
  const resolvedText = typeof resolveDesc === 'function' ? resolveDesc(desc, code) : '';
  const cleanHintText = resolvedText && !resolvedText.startsWith('Effect #') ? resolvedText : '';

  const cardNameEn = meta?.name || (code ? `Card #${code}` : 'Lingering Effect');
  const cardNameTh = meta?.nameTh || cardNameEn;

  const existingKey = findMatchingEntryKey(tracker, code, p, turn);
  if (existingKey) {
    const existing = tracker.entries.get(existingKey);
    if (cleanHintText) {
      existing.detail = {
        en: cleanHintText,
        th: catalog?.detail?.th || cleanHintText
      };
    }
    existing.origin = 'engine-hint';
    return;
  }

  const expiry = catalog?.expiry || 'endOfTurn';
  const category = catalog?.category || inferCategoryFromText(cleanHintText || meta?.description);
  const detailEn = cleanHintText || catalog?.detail?.en || meta?.description || cardNameEn;
  const detailTh = catalog?.detail?.th || cleanHintText || meta?.descriptionTh || detailEn;
  const badgeEn = catalog?.badge?.en || makeShortBadge(cardNameEn, 'Effect');
  const badgeTh = catalog?.badge?.th || makeShortBadge(cardNameTh, badgeEn);

  tracker.entries.set(hintKey, {
    id: `engine-hint:${code}:${descIndex}:${p}:${turn}`,
    seq: ++tracker.seq,
    code: Number(code || 0),
    name: { en: cardNameEn, th: cardNameTh },
    affectedPlayer: p,
    category,
    badge: { en: badgeEn, th: badgeTh },
    detail: { en: detailEn, th: detailTh },
    durationLabel: LINGERING_DURATION_LABELS[expiry] || LINGERING_DURATION_LABELS.endOfTurn,
    expiry,
    turnApplied: Number(turn || 1),
    origin: 'engine-hint'
  });
}

/**
 * Apply a curated lingering effect when a known card resolves on MSG_CHAIN_SOLVED.
 */
export function applyCatalogResolution(tracker, { code, player, turn = 1, negatedName = '', getCardMeta } = {}) {
  if (!tracker) return;
  const numCode = Number(code || 0);
  const catalog = getLingeringCatalogEntry(numCode);
  if (!catalog) return;

  const activator = player === 1 ? 1 : 0;
  const affectedPlayer = resolveAffectedPlayer(catalog.scope, activator);
  const existingKey = findMatchingEntryKey(tracker, numCode, affectedPlayer, turn);

  if (existingKey) {
    const existing = tracker.entries.get(existingKey);
    existing.badge = { ...catalog.badge };
    existing.category = catalog.category;
    existing.expiry = catalog.expiry;
    existing.durationLabel = LINGERING_DURATION_LABELS[catalog.expiry] || LINGERING_DURATION_LABELS.endOfTurn;
    existing.affectedPlayer = affectedPlayer;
    if (negatedName) existing.negatedName = negatedName;
    return;
  }

  const meta = typeof getCardMeta === 'function' ? getCardMeta(numCode) : null;
  const cardNameEn = meta?.name || `Card #${numCode}`;
  const cardNameTh = meta?.nameTh || cardNameEn;
  const key = `catalog:${numCode}:${affectedPlayer}:${turn}`;

  const badge = negatedName
    ? { en: `${catalog.badge.en}: ${makeShortBadge(negatedName, '')}`.trim(), th: `${catalog.badge.th}: ${makeShortBadge(negatedName, '')}`.trim() }
    : { ...catalog.badge };

  tracker.entries.set(key, {
    id: `catalog:${numCode}:${affectedPlayer}:${turn}`,
    seq: ++tracker.seq,
    code: numCode,
    name: { en: cardNameEn, th: cardNameTh },
    affectedPlayer,
    category: catalog.category,
    badge,
    detail: { ...catalog.detail },
    durationLabel: LINGERING_DURATION_LABELS[catalog.expiry] || LINGERING_DURATION_LABELS.endOfTurn,
    expiry: catalog.expiry,
    turnApplied: Number(turn || 1),
    origin: 'catalog',
    ...(negatedName ? { negatedName } : {})
  });
}

/**
 * Deterministically expire entries on NEW_TURN / NEW_PHASE.
 */
export function advancePhase(tracker, { turn } = {}) {
  if (!tracker) return;
  const curTurn = Number(turn || 1);
  for (const [key, entry] of tracker.entries.entries()) {
    if (entry.expiry === 'endOfTurn' && curTurn > entry.turnApplied) {
      tracker.entries.delete(key);
    } else if (
      (entry.expiry === 'endOfNextTurn' || entry.expiry === 'opponentEndPhase') &&
      curTurn > entry.turnApplied + 1
    ) {
      tracker.entries.delete(key);
    }
  }
}

export function resolveViewerScope(affectedPlayer, viewerPlayer) {
  if (affectedPlayer < 0 || affectedPlayer > 1) return 'both';
  if (viewerPlayer === 0 || viewerPlayer === 1) {
    return affectedPlayer === viewerPlayer ? 'self' : 'opponent';
  }
  return 'both';
}

/**
 * Serialize active lingering effects sorted newest-first.
 */
export function toSnapshot(tracker, viewerPlayer = -1) {
  if (!tracker || tracker.entries.size === 0) return [];
  const items = Array.from(tracker.entries.values())
    .sort((a, b) => b.seq - a.seq)
    .map((entry) => ({
      id: entry.id,
      code: entry.code,
      name: entry.name,
      scope: resolveViewerScope(entry.affectedPlayer, viewerPlayer),
      affectedPlayer: entry.affectedPlayer,
      category: entry.category,
      badge: entry.badge,
      detail: entry.detail,
      durationLabel: entry.durationLabel,
      expiry: entry.expiry,
      turnApplied: entry.turnApplied,
      origin: entry.origin,
      ...(entry.negatedName ? { negatedName: entry.negatedName } : {})
    }));
  return items;
}
