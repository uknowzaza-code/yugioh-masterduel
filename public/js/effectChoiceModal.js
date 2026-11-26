/**
 * @fileoverview Authentic Yu-Gi-Oh! Master Duel centered "Use which effect?" modal.
 * Uses pure state from effectChoiceState.js, single AbortController teardown,
 * strict textContent rendering (no innerHTML for card/option strings), and full ARIA.
 */

import { createEffectChoiceState } from './effectChoiceState.js';

let activeInstance = null;

function formatTabLabel(template, n, total) {
  return String(template || 'Effect {n} of {total}')
    .replace('{n}', String(n))
    .replace('{total}', String(total));
}

function getFocusableElements(container) {
  if (!container) return [];
  const candidates = container.querySelectorAll(
    'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  return Array.from(candidates).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
}

/**
 * Close and tear down any currently open effect-choice modal.
 * Safe to call multiple times or when no modal is open.
 */
export function closeEffectChoiceModal() {
  if (!activeInstance) return;
  const inst = activeInstance;
  activeInstance = null;
  inst.destroy();
}

/**
 * Refresh localized labels when the user switches EN/TH while the modal is open.
 * @param {() => Object} getLabels
 */
export function refreshEffectChoiceModalLabels(getLabels) {
  if (!activeInstance || typeof getLabels !== 'function') return;
  activeInstance.updateLabels(getLabels);
}

/**
 * Open the Master Duel centered effect-choice popup modal.
 * @param {Object} params
 * @param {Array} params.options
 * @param {boolean} [params.canCancel=false]
 * @param {number} [params.initialIndex=0]
 * @param {() => Object} [params.getLabels]
 * @param {(opt: any, index: number) => string} [params.getOptionText]
 * @param {(opt: any, index: number) => void} [params.onConfirm]
 * @param {() => void} [params.onCancel]
 * @returns {boolean}
 */
export function openEffectChoiceModal({
  options,
  canCancel = false,
  initialIndex = 0,
  getLabels,
  getOptionText,
  onConfirm,
  onCancel
} = {}) {
  const list = Array.isArray(options) ? options : [];
  if (list.length === 0) return false;

  // Enforce singleton: tear down any previous modal before creating a new one
  if (activeInstance) {
    closeEffectChoiceModal();
  }

  const controller = new AbortController();
  const { signal } = controller;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const stateApi = createEffectChoiceState(list, { canCancel, initialIndex });

  const resolveLabels = () => {
    const custom = typeof getLabels === 'function' ? (getLabels() || {}) : {};
    return {
      title: custom.title || 'Use which effect?',
      ok: custom.ok || 'OK',
      cancel: custom.cancel || 'Cancel',
      viewBoard: custom.viewBoard || 'View Board',
      showPrompt: custom.showPrompt || 'Show Prompt',
      tabLabel: custom.tabLabel || 'Effect {n} of {total}'
    };
  };

  const resolveOptionText = (idx) => {
    const opt = list[idx];
    if (typeof getOptionText === 'function') {
      return String(getOptionText(opt, idx) || `Option ${idx + 1}`);
    }
    return String(opt?.label || opt?.name || `Option ${idx + 1}`);
  };

  // Build DOM safely using createElement + textContent
  const layer = document.createElement('div');
  layer.className = 'ec-layer';
  layer.dataset.state = 'open';

  const scrim = document.createElement('div');
  scrim.className = 'ec-scrim';
  scrim.setAttribute('aria-hidden', 'true');

  const modal = document.createElement('section');
  modal.className = 'ec-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'ec-title');

  const peekBtn = document.createElement('button');
  peekBtn.type = 'button';
  peekBtn.className = 'ec-peek';
  peekBtn.setAttribute('aria-expanded', 'true');
  peekBtn.setAttribute('aria-controls', 'ec-body');

  const chevronSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevronSvg.setAttribute('viewBox', '0 0 24 24');
  chevronSvg.setAttribute('width', '20');
  chevronSvg.setAttribute('height', '20');
  chevronSvg.setAttribute('fill', 'none');
  chevronSvg.setAttribute('stroke', 'currentColor');
  chevronSvg.setAttribute('stroke-width', '2.8');
  chevronSvg.setAttribute('stroke-linecap', 'round');
  chevronSvg.setAttribute('stroke-linejoin', 'round');
  chevronSvg.setAttribute('aria-hidden', 'true');
  const poly1 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly1.setAttribute('points', '6 7 12 13 18 7');
  const poly2 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly2.setAttribute('points', '6 13 12 19 18 13');
  chevronSvg.append(poly1, poly2);
  peekBtn.appendChild(chevronSvg);

  const frame = document.createElement('div');
  frame.className = 'ec-frame';

  const header = document.createElement('header');
  header.className = 'ec-header';
  const titleEl = document.createElement('h2');
  titleEl.id = 'ec-title';
  titleEl.className = 'ec-title';
  const divider = document.createElement('div');
  divider.className = 'ec-divider';
  divider.setAttribute('aria-hidden', 'true');
  header.append(titleEl, divider);

  const body = document.createElement('div');
  body.id = 'ec-body';
  body.className = 'ec-body';

  const tablist = document.createElement('div');
  tablist.className = 'ec-tabs';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-labelledby', 'ec-title');

  const tabButtons = list.map((_, idx) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'ec-tab';
    tab.id = `ec-tab-${idx}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'ec-panel');
    tab.textContent = String(idx + 1);
    tab.addEventListener('click', () => {
      stateApi.select(idx);
      syncView();
    }, { signal });
    tablist.appendChild(tab);
    return tab;
  });

  const panel = document.createElement('div');
  panel.id = 'ec-panel';
  panel.className = 'ec-panel';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('tabindex', '0');

  for (const pos of ['tl', 'tr', 'bl', 'br']) {
    const corner = document.createElement('span');
    corner.className = `ec-corner ${pos}`;
    corner.setAttribute('aria-hidden', 'true');
    panel.appendChild(corner);
  }

  const descP = document.createElement('p');
  descP.className = 'ec-desc';
  const bulletSpan = document.createElement('span');
  bulletSpan.className = 'ec-bullet';
  bulletSpan.setAttribute('aria-hidden', 'true');
  bulletSpan.textContent = '● ';
  const textSpan = document.createElement('span');
  textSpan.className = 'ec-text';
  descP.append(bulletSpan, textSpan);
  panel.appendChild(descP);

  const footer = document.createElement('footer');
  footer.className = 'ec-actions';

  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'ec-ok';
  footer.appendChild(okBtn);

  let cancelBtn = null;
  if (canCancel) {
    cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ec-cancel';
    footer.appendChild(cancelBtn);
  }

  body.append(tablist, panel, footer);
  frame.append(header, body);
  modal.append(peekBtn, frame);
  layer.append(scrim, modal);

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    controller.abort();
    if (layer.parentNode) {
      layer.parentNode.removeChild(layer);
    }
    if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
      try {
        previousFocus.focus({ preventScroll: true });
      } catch {
        // Ignore focus errors if element is no longer focusable
      }
    }
  };

  const syncView = (customLabelGetter = null) => {
    const s = stateApi.getState();
    const labels = customLabelGetter ? (() => {
      const custom = customLabelGetter() || {};
      return {
        title: custom.title || 'Use which effect?',
        ok: custom.ok || 'OK',
        cancel: custom.cancel || 'Cancel',
        viewBoard: custom.viewBoard || 'View Board',
        showPrompt: custom.showPrompt || 'Show Prompt',
        tabLabel: custom.tabLabel || 'Effect {n} of {total}'
      };
    })() : resolveLabels();

    layer.dataset.state = s.peeked ? 'peek' : 'open';
    modal.setAttribute('aria-modal', s.peeked ? 'false' : 'true');
    peekBtn.setAttribute('aria-expanded', s.peeked ? 'false' : 'true');
    const peekText = s.peeked ? labels.showPrompt : labels.viewBoard;
    peekBtn.setAttribute('aria-label', peekText);
    peekBtn.title = peekText;

    titleEl.textContent = labels.title;
    okBtn.textContent = labels.ok;
    if (cancelBtn) cancelBtn.textContent = labels.cancel;

    tabButtons.forEach((tab, idx) => {
      const selected = idx === s.selectedIndex;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.setAttribute('tabindex', selected ? '0' : '-1');
      tab.setAttribute('aria-label', formatTabLabel(labels.tabLabel, idx + 1, list.length));
    });

    panel.setAttribute('aria-labelledby', `ec-tab-${s.selectedIndex}`);
    textSpan.textContent = resolveOptionText(s.selectedIndex);
  };

  const handleConfirm = () => {
    const res = stateApi.confirm();
    if (!res.committed) return;
    const idx = stateApi.getState().selectedIndex;
    closeEffectChoiceModal();
    if (typeof onConfirm === 'function') {
      onConfirm(res.value, idx);
    }
  };

  const handleCancel = () => {
    const res = stateApi.cancel();
    if (!res.committed) return;
    closeEffectChoiceModal();
    if (typeof onCancel === 'function') {
      onCancel();
    }
  };

  okBtn.addEventListener('click', handleConfirm, { signal });
  if (cancelBtn) {
    cancelBtn.addEventListener('click', handleCancel, { signal });
  }
  peekBtn.addEventListener('click', () => {
    stateApi.togglePeek();
    syncView();
  }, { signal });

  document.addEventListener('keydown', (ev) => {
    const s = stateApi.getState();
    if (s.settled) return;

    if (ev.key === 'Escape') {
      if (s.canCancel && !s.peeked) {
        ev.preventDefault();
        handleCancel();
      }
      return;
    }

    if (s.peeked) return;

    if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      const nextIdx = stateApi.next();
      syncView();
      tabButtons[nextIdx]?.focus();
      tabButtons[nextIdx]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      return;
    }
    if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      const prevIdx = stateApi.prev();
      syncView();
      tabButtons[prevIdx]?.focus();
      tabButtons[prevIdx]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      return;
    }
    if (ev.key === 'Home') {
      ev.preventDefault();
      const firstIdx = stateApi.first();
      syncView();
      tabButtons[firstIdx]?.focus();
      return;
    }
    if (ev.key === 'End') {
      ev.preventDefault();
      const lastIdx = stateApi.last();
      syncView();
      tabButtons[lastIdx]?.focus();
      return;
    }
    if (ev.key === 'Enter') {
      const activeEl = document.activeElement;
      if (activeEl === cancelBtn || activeEl === peekBtn) {
        return; // Let native button activation handle Cancel or Peek
      }
      ev.preventDefault();
      handleConfirm();
      return;
    }
    if (ev.key === 'Tab') {
      const focusables = getFocusableElements(modal);
      if (focusables.length === 0) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (ev.shiftKey && (document.activeElement === firstEl || !modal.contains(document.activeElement))) {
        ev.preventDefault();
        lastEl.focus();
      } else if (!ev.shiftKey && (document.activeElement === lastEl || !modal.contains(document.activeElement))) {
        ev.preventDefault();
        firstEl.focus();
      }
    }
  }, { signal });

  activeInstance = {
    destroy,
    updateLabels(getter) {
      if (!destroyed) syncView(getter);
    }
  };

  syncView();
  document.body.appendChild(layer);
  tabButtons[stateApi.getState().selectedIndex]?.focus({ preventScroll: true });
  return true;
}
