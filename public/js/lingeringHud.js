/**
 * @fileoverview Master Duel Active Lingering Effects & Turn Restrictions Beacon HUD.
 * Renders the Master Duel corner beacon (scanline count bar + glowing cyan-to-violet
 * broadcast emblem) and an accessible popover/bottom-sheet listing active effects.
 */

function createBeaconSvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', '28');
  svg.setAttribute('height', '28');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('lh-beacon-svg');

  // Blue perspective trapezoid base
  const baseOuter = document.createElementNS(ns, 'polygon');
  baseOuter.setAttribute('points', '13,31 35,31 40,40 8,40');
  baseOuter.setAttribute('fill', '#1d4ed8');
  baseOuter.setAttribute('stroke', '#38bdf8');
  baseOuter.setAttribute('stroke-width', '2');
  baseOuter.setAttribute('stroke-linejoin', 'round');

  const baseInner = document.createElementNS(ns, 'polygon');
  baseInner.setAttribute('points', '16,33 32,33 34,37 14,37');
  baseInner.setAttribute('fill', '#040a18');

  // Outer broadcast arcs
  const arcL2 = document.createElementNS(ns, 'path');
  arcL2.setAttribute('d', 'M12,12 A14,14 0 0,0 12,28');
  arcL2.setAttribute('fill', 'none');
  arcL2.setAttribute('stroke', '#22d3ee');
  arcL2.setAttribute('stroke-width', '2.5');
  arcL2.setAttribute('stroke-linecap', 'round');

  const arcR2 = document.createElementNS(ns, 'path');
  arcR2.setAttribute('d', 'M36,12 A14,14 0 0,1 36,28');
  arcR2.setAttribute('fill', 'none');
  arcR2.setAttribute('stroke', '#22d3ee');
  arcR2.setAttribute('stroke-width', '2.5');
  arcR2.setAttribute('stroke-linecap', 'round');

  // Inner broadcast arcs
  const arcL1 = document.createElementNS(ns, 'path');
  arcL1.setAttribute('d', 'M17,15 A9,9 0 0,0 17,25');
  arcL1.setAttribute('fill', 'none');
  arcL1.setAttribute('stroke', '#38bdf8');
  arcL1.setAttribute('stroke-width', '2.5');
  arcL1.setAttribute('stroke-linecap', 'round');

  const arcR1 = document.createElementNS(ns, 'path');
  arcR1.setAttribute('d', 'M31,15 A9,9 0 0,1 31,25');
  arcR1.setAttribute('fill', 'none');
  arcR1.setAttribute('stroke', '#38bdf8');
  arcR1.setAttribute('stroke-width', '2.5');
  arcR1.setAttribute('stroke-linecap', 'round');

  // Exclamation stem & dot
  const stem = document.createElementNS(ns, 'polygon');
  stem.setAttribute('points', '21.5,9 26.5,9 25.4,24 22.6,24');
  stem.setAttribute('fill', '#38bdf8');

  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', '24');
  dot.setAttribute('cy', '29');
  dot.setAttribute('r', '2.4');
  dot.setAttribute('fill', '#38bdf8');

  svg.append(baseOuter, baseInner, arcL2, arcR2, arcL1, arcR1, stem, dot);
  return svg;
}

function getCategoryIconPath(category) {
  switch (category) {
    case 'draw':
      return '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 10h6"/><path d="M12 7v6"/>';
    case 'banish':
      return '<circle cx="12" cy="12" r="9"/><path d="M12 3a6 6 0 0 1 0 12 4 4 0 0 1 0-8"/>';
    case 'negate':
      return '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>';
    case 'floodgate':
      return '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>';
    case 'lock':
    case 'restriction':
    default:
      return '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';
  }
}

function resolveRelativeScope(eff, viewerPlayer) {
  if (eff.affectedPlayer < 0 || eff.affectedPlayer > 1) return 'both';
  if (viewerPlayer === 0 || viewerPlayer === 1) {
    return eff.affectedPlayer === viewerPlayer ? 'self' : 'opponent';
  }
  return eff.scope === 'self' || eff.scope === 'opponent' ? eff.scope : 'both';
}

/**
 * Mount the Master Duel Lingering Effects Beacon onto `mountEl`.
 * @param {HTMLElement} mountEl
 * @param {{ t: (lang: string, key: string) => string, getLang: () => string, getCardArtUrl?: (card: any) => string }} deps
 */
export function mountLingeringHud(mountEl, { t, getLang, getCardArtUrl } = {}) {
  if (!mountEl) {
    return { update() {}, refreshLanguage() {}, destroy() {} };
  }

  const controller = new AbortController();
  const { signal } = controller;

  let currentEffects = [];
  let currentViewer = 0;
  let isOpen = false;
  let lastSeenIds = new Set();

  // Beacon button (scanline count bar + glowing (( ! )) orb)
  const beaconBtn = document.createElement('button');
  beaconBtn.type = 'button';
  beaconBtn.id = 'btn-lingering-beacon';
  beaconBtn.className = 'lh-beacon-btn hidden';
  beaconBtn.setAttribute('aria-expanded', 'false');
  beaconBtn.setAttribute('aria-controls', 'lh-popover');

  const countBar = document.createElement('span');
  countBar.className = 'lh-count-bar';
  countBar.textContent = '0';

  const orb = document.createElement('span');
  orb.className = 'lh-beacon-orb';
  orb.appendChild(createBeaconSvg());

  beaconBtn.append(countBar, orb);

  // Screen-reader announcement region
  const liveRegion = document.createElement('div');
  liveRegion.className = 'lh-sr-only';
  liveRegion.setAttribute('aria-live', 'polite');

  mountEl.innerHTML = '';
  mountEl.append(beaconBtn, liveRegion);

  // Popover / Bottom-sheet dialog mounted on body to avoid playmat clipping
  const popover = document.createElement('section');
  popover.id = 'lh-popover';
  popover.className = 'lh-popover hidden';
  popover.setAttribute('role', 'dialog');

  const popHead = document.createElement('header');
  popHead.className = 'lh-pop-header';
  const popTitleWrap = document.createElement('div');
  popTitleWrap.className = 'lh-pop-title-wrap';
  const popTitle = document.createElement('h3');
  popTitle.className = 'lh-pop-title';
  const popCount = document.createElement('span');
  popCount.className = 'lh-pop-count';
  popTitleWrap.append(popTitle, popCount);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'lh-pop-close';
  closeBtn.textContent = '✕';
  popHead.append(popTitleWrap, closeBtn);

  const listEl = document.createElement('ul');
  listEl.className = 'lh-list';
  popover.append(popHead, listEl);
  document.body.appendChild(popover);

  const getLabel = (key, fallback) => {
    const lang = typeof getLang === 'function' ? getLang() : 'en';
    const val = typeof t === 'function' ? t(lang, key) : '';
    return val && val !== key ? val : fallback;
  };

  const closePopover = ({ restoreFocus = false } = {}) => {
    if (!isOpen) return;
    isOpen = false;
    popover.classList.add('hidden');
    beaconBtn.setAttribute('aria-expanded', 'false');
    if (restoreFocus && beaconBtn.isConnected && !beaconBtn.classList.contains('hidden')) {
      beaconBtn.focus({ preventScroll: true });
    }
  };

  const renderPopover = () => {
    const lang = typeof getLang === 'function' ? getLang() : 'en';
    const titleText = getLabel('lingeringTitle', lang === 'th' ? 'เอฟเฟคที่มีผลอยู่' : 'Active Effects');
    popTitle.textContent = titleText;
    popCount.textContent = String(currentEffects.length);
    popover.setAttribute('aria-label', titleText);
    closeBtn.setAttribute('aria-label', getLabel('lingeringClose', lang === 'th' ? 'ปิด' : 'Close'));

    listEl.innerHTML = '';
    for (const eff of currentEffects) {
      const li = document.createElement('li');
      li.className = `lh-item lh-cat-${eff.category || 'restriction'}`;

      const thumb = document.createElement('div');
      thumb.className = 'lh-thumb';
      if (typeof getCardArtUrl === 'function' && eff.code) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = '';
        img.src = getCardArtUrl({ passcode: String(eff.code), id: `cdb_${eff.code}` });
        img.addEventListener('error', () => { img.remove(); }, { once: true });
        thumb.appendChild(img);
      }

      const content = document.createElement('div');
      content.className = 'lh-item-body';

      const topRow = document.createElement('div');
      topRow.className = 'lh-item-top';

      const nameEl = document.createElement('span');
      nameEl.className = 'lh-item-name';
      nameEl.textContent = lang === 'th' ? (eff.name?.th || eff.name?.en || '') : (eff.name?.en || eff.name?.th || '');

      const scope = resolveRelativeScope(eff, currentViewer);
      const scopePill = document.createElement('span');
      scopePill.className = `lh-scope-pill scope-${scope}`;
      scopePill.textContent =
        scope === 'self'
          ? getLabel('lingeringScopeSelf', lang === 'th' ? 'คุณ' : 'You')
          : scope === 'opponent'
            ? getLabel('lingeringScopeOpp', lang === 'th' ? 'คู่ต่อสู้' : 'Opp')
            : getLabel('lingeringScopeBoth', lang === 'th' ? 'ทั้งคู่' : 'Both');

      topRow.append(nameEl, scopePill);

      const metaRow = document.createElement('div');
      metaRow.className = 'lh-item-meta';

      const catBadge = document.createElement('span');
      catBadge.className = `lh-cat-badge lh-cat-${eff.category || 'restriction'}`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '12');
      svg.setAttribute('height', '12');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2.2');
      svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = getCategoryIconPath(eff.category);
      const badgeTxt = document.createElement('span');
      badgeTxt.textContent = lang === 'th' ? (eff.badge?.th || eff.badge?.en || '') : (eff.badge?.en || eff.badge?.th || '');
      catBadge.append(svg, badgeTxt);

      const durEl = document.createElement('span');
      durEl.className = 'lh-duration';
      durEl.textContent = lang === 'th' ? (eff.durationLabel?.th || eff.durationLabel?.en || '') : (eff.durationLabel?.en || eff.durationLabel?.th || '');

      metaRow.append(catBadge, durEl);

      const detailEl = document.createElement('p');
      detailEl.className = 'lh-item-detail';
      detailEl.textContent = lang === 'th' ? (eff.detail?.th || eff.detail?.en || '') : (eff.detail?.en || eff.detail?.th || '');

      content.append(topRow, metaRow, detailEl);
      li.append(thumb, content);
      listEl.appendChild(li);
    }
  };

  const renderBeacon = () => {
    const count = currentEffects.length;
    if (count === 0) {
      beaconBtn.classList.add('hidden');
      closePopover({ restoreFocus: false });
      return;
    }
    const lang = typeof getLang === 'function' ? getLang() : 'en';
    countBar.textContent = String(count);
    beaconBtn.classList.remove('hidden');
    const ariaTemplate = getLabel(
      'lingeringAriaLabel',
      lang === 'th' ? 'ดูเอฟเฟคที่มีผลทั้งเทิร์น ({n} รายการ)' : 'View active lingering effects ({n})'
    );
    const aria = ariaTemplate.replace('{n}', String(count));
    beaconBtn.setAttribute('aria-label', aria);
    beaconBtn.title = aria;
    if (isOpen) {
      renderPopover();
    }
  };

  beaconBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (currentEffects.length === 0) return;
    isOpen = !isOpen;
    if (isOpen) {
      renderPopover();
      popover.classList.remove('hidden');
      beaconBtn.setAttribute('aria-expanded', 'true');
      closeBtn.focus({ preventScroll: true });
    } else {
      popover.classList.add('hidden');
      beaconBtn.setAttribute('aria-expanded', 'false');
    }
  }, { signal });

  closeBtn.addEventListener('click', () => {
    closePopover({ restoreFocus: true });
  }, { signal });

  document.addEventListener('click', (ev) => {
    if (!isOpen) return;
    if (!popover.contains(ev.target) && !beaconBtn.contains(ev.target)) {
      closePopover({ restoreFocus: false });
    }
  }, { signal });

  document.addEventListener('keydown', (ev) => {
    if (isOpen && ev.key === 'Escape') {
      ev.preventDefault();
      closePopover({ restoreFocus: true });
    }
  }, { signal });

  return {
    update(effects = [], viewerPlayer = 0) {
      currentEffects = Array.isArray(effects) ? effects : [];
      currentViewer = viewerPlayer === 1 ? 1 : 0;

      const nextIds = new Set(currentEffects.map(e => e.id));
      for (const eff of currentEffects) {
        if (!lastSeenIds.has(eff.id)) {
          const lang = typeof getLang === 'function' ? getLang() : 'en';
          const name = lang === 'th' ? (eff.name?.th || eff.name?.en) : (eff.name?.en || eff.name?.th);
          const tpl = getLabel('lingeringAnnounce', 'Lingering effect active: {name}');
          liveRegion.textContent = tpl.replace('{name}', name || '');
          break;
        }
      }
      lastSeenIds = nextIds;
      renderBeacon();
    },
    refreshLanguage() {
      renderBeacon();
    },
    destroy() {
      controller.abort();
      closePopover({ restoreFocus: false });
      popover.remove();
      mountEl.innerHTML = '';
      currentEffects = [];
      lastSeenIds.clear();
    }
  };
}
