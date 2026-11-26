/**
 * @fileoverview Pure, DOM-free state machine for the Master Duel Effect-Choice modal.
 */

export const CANCEL_SENTINEL = Symbol('EFFECT_CHOICE_CANCEL');

/**
 * Create an isolated state controller for a single effect-choice prompt.
 * @param {Array} options
 * @param {{ canCancel?: boolean, initialIndex?: number }} [config]
 */
export function createEffectChoiceState(options, { canCancel = false, initialIndex = 0 } = {}) {
  const list = Array.isArray(options) ? options.slice() : [];
  const maxIndex = Math.max(0, list.length - 1);
  const clamp = (i) => {
    if (list.length === 0) return 0;
    const n = Number.isFinite(i) ? Math.trunc(i) : 0;
    return Math.max(0, Math.min(maxIndex, n));
  };

  let selectedIndex = clamp(initialIndex);
  let peeked = false;
  let settled = false;
  let result = null;
  const allowCancel = Boolean(canCancel);

  return {
    getState() {
      return {
        options: list,
        selectedIndex,
        canCancel: allowCancel,
        peeked,
        settled,
        result
      };
    },
    select(index) {
      if (settled || list.length === 0) return selectedIndex;
      selectedIndex = clamp(index);
      return selectedIndex;
    },
    next() {
      if (settled || list.length === 0) return selectedIndex;
      selectedIndex = clamp(selectedIndex + 1);
      return selectedIndex;
    },
    prev() {
      if (settled || list.length === 0) return selectedIndex;
      selectedIndex = clamp(selectedIndex - 1);
      return selectedIndex;
    },
    first() {
      if (settled || list.length === 0) return selectedIndex;
      selectedIndex = 0;
      return selectedIndex;
    },
    last() {
      if (settled || list.length === 0) return selectedIndex;
      selectedIndex = maxIndex;
      return selectedIndex;
    },
    togglePeek() {
      if (settled) return peeked;
      peeked = !peeked;
      return peeked;
    },
    confirm() {
      if (settled || list.length === 0) {
        return { committed: false, value: null };
      }
      settled = true;
      result = list[selectedIndex];
      return { committed: true, value: result };
    },
    cancel() {
      if (settled || !allowCancel) {
        return { committed: false, value: null };
      }
      settled = true;
      result = CANCEL_SENTINEL;
      return { committed: true, value: CANCEL_SENTINEL };
    }
  };
}
