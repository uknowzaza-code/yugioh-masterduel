/**
 * @fileoverview Master Duel Pointer Drag-to-Play & Battle Attack Vector System
 * Supports Mouse, Touch, and Pen via unified Pointer Events while keeping
 * single-pointer click/tap popups 100% intact for accessibility.
 */

let activeSuppressClickUntil = 0;

export function shouldSuppressCardClick() {
  return Date.now() < activeSuppressClickUntil;
}

function getSvgArrowOverlay() {
  let svg = document.getElementById('duel-attack-arrow-svg');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'duel-attack-arrow-svg';
    svg.setAttribute('class', 'duel-attack-arrow-svg hidden');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `
      <defs>
        <linearGradient id="atkArrowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#86efac" />
          <stop offset="100%" stop-color="#22c55e" />
        </linearGradient>
        <marker id="atkArrowHead" markerWidth="12" markerHeight="12" refX="8" refY="6" orient="auto">
          <path d="M1,1 L11,6 L1,11 L3.5,6 Z" fill="#22c55e" stroke="#dcfce7" stroke-width="0.9" />
        </marker>
      </defs>
      <line id="atk-arrow-glow" x1="0" y1="0" x2="0" y2="0" stroke="rgba(34,197,94,0.45)" stroke-width="14" stroke-linecap="round" />
      <line id="atk-arrow-core" x1="0" y1="0" x2="0" y2="0" stroke="url(#atkArrowGrad)" stroke-width="6" stroke-dasharray="10 6" stroke-linecap="round" marker-end="url(#atkArrowHead)" />
    `;
    document.body.appendChild(svg);
  }
  return svg;
}

function getFloatingDragGhostLayer() {
  let layer = document.getElementById('duel-drag-ghost-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'duel-drag-ghost-layer';
    layer.className = 'duel-drag-ghost-layer hidden';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }
  return layer;
}

function announceLive(msg) {
  const region = document.getElementById('duel-live-region');
  if (!region) return;
  region.textContent = '';
  requestAnimationFrame(() => {
    region.textContent = msg;
  });
}

/**
 * Attach pointer drag-to-play behavior to a playable hand or field card element.
 */
export function enableCardDragToPlay(cardEl, config) {
  const {
    card,
    actions = [],
    attackInfo = null,
    lang = 'th',
    onInspect,
    onHidePopup,
    onShowChoicePopup,
    onExecuteAction
  } = config;

  const hasHandOrFieldActions = actions.length > 0;
  const normalizedAttackInfo = Array.isArray(attackInfo)
    ? {
        canDirectAttack: attackInfo.some(t => t.isDirect),
        targets: attackInfo.filter(t => !t.isDirect && t.instanceId).map(t => t.instanceId)
      }
    : attackInfo;
  const hasAttack = Boolean(normalizedAttackInfo);
  if (!hasHandOrFieldActions && !hasAttack) return;

  cardEl.classList.add('draggable-card');
  cardEl.setAttribute('draggable', 'false');
  cardEl.addEventListener('dragstart', (e) => e.preventDefault());

  cardEl.addEventListener('pointerdown', (downEvent) => {
    // Only start drag for primary pointer button (drag guide requirement)
    if (downEvent.button !== 0) return;
    if (downEvent.target.closest('button, a, input, select, .card-pick-target, .card-pick-selected, .card-pick-locked, .zone-pick-target')) return;
    if (downEvent.pointerType === 'mouse') {
      downEvent.preventDefault();
    }

    const startX = downEvent.clientX;
    const startY = downEvent.clientY;
    const startRect = cardEl.getBoundingClientRect();
    const offsetX = startX - startRect.left;
    const offsetY = startY - startRect.top;
    const originCx = startRect.left + startRect.width / 2;
    const originCy = startRect.top + startRect.height / 2;

    const isTouchHandCard = downEvent.pointerType !== 'mouse' && card.zone === 'HAND';
    let isDragging = false;
    let gestureAborted = false;
    let dragMode = null; // 'ATTACK' | 'CARD_MOVE'
    let ghostEl = null;
    let currentHoverEl = null;
    let markedElements = [];

    const markTarget = (el, className, attrs = {}) => {
      if (!el) return;
      el.classList.add(className);
      for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, String(v));
      }
      markedElements.push({ el, className, attrs: Object.keys(attrs) });
    };

    const prepareLegalDropTargets = () => {
      if (hasAttack && (!hasHandOrFieldActions || card.zone === 'MMZ' || card.zone === 'EMZ')) {
        dragMode = 'ATTACK';
        // Mark the attacker's own slot so dragging back to origin clearly cancels the attack
        const originSlot = cardEl.closest('.zone-slot, .emz-slot') || cardEl;
        markTarget(originSlot, 'drop-target-attack-cancel', {
          'data-drop-kind': 'ATTACK_CANCEL',
          'data-drop-hint': lang === 'en' ? '✕ Drop here to Cancel' : '✕ ลากกลับตรงนี้เพื่อยกเลิก'
        });
        // Highlight opponent monsters
        for (const targetId of normalizedAttackInfo.targets || []) {
          const oppCard = document.querySelector(`.duel-card[data-instance-id="${targetId}"]`);
          const oppSlot = oppCard?.closest('.zone-slot, .emz-slot');
          if (oppSlot) {
            markTarget(oppSlot, 'drop-target-attack', {
              'data-drop-kind': 'ATTACK_MONSTER',
              'data-drop-target-id': targetId,
              'data-drop-hint': lang === 'en' ? '⚔️ Attack' : '⚔️ โจมตี'
            });
          }
        }
        if (normalizedAttackInfo.canDirectAttack) {
          const oppHud = document.querySelector('.opponent-hud');
          const oppGrid = document.getElementById('opp-mmz-grid');
          markTarget(oppHud, 'drop-target-attack-direct', {
            'data-drop-kind': 'ATTACK_DIRECT',
            'data-drop-hint': lang === 'en' ? '⚔️ Direct Attack!' : '⚔️ โจมตีโดยตรง!'
          });
          markTarget(oppGrid, 'drop-target-attack-direct', {
            'data-drop-kind': 'ATTACK_DIRECT',
            'data-drop-hint': lang === 'en' ? '⚔️ Direct Attack!' : '⚔️ โจมตีโดยตรง!'
          });
        }
        return;
      }

      dragMode = 'CARD_MOVE';

      if (card.zone === 'HAND') {
        const summonActs = actions.filter(a =>
          a.type === 'NORMAL_SUMMON' || a.type === 'NORMAL_SET' || a.type === 'SET_MONSTER' || a.type === 'INHERENT_SPECIAL_SUMMON' || a.type === 'SPECIAL_SUMMON'
        );
        const setStActs = actions.filter(a => a.type === 'SET_SPELL_TRAP');
        const handActivateActs = actions.filter(a => a.type === 'ACTIVATE_EFFECT');
        const isFieldSpell = card.kind === 'SPELL' && (card.subType === 'FIELD' || card.subtype === 'FIELD');

        // 1. Empty MMZ Slots for Monster Summon / Set
        if (summonActs.length > 0) {
          const hint = summonActs.length > 1
            ? (lang === 'en' ? '⚔️ Summon / 🛡️ Set' : '⚔️ อัญเชิญ / 🛡️ หมอบ')
            : ((summonActs[0].type === 'NORMAL_SET' || summonActs[0].type === 'SET_MONSTER')
              ? (lang === 'en' ? '🛡️ Set' : '🛡️ หมอบ')
              : (lang === 'en' ? '⚔️ Summon' : '⚔️ อัญเชิญ'));
          document.querySelectorAll('#self-mmz-grid .zone-slot').forEach((slotEl) => {
            if (slotEl.querySelector('.duel-card')) return;
            markTarget(slotEl, 'drop-zone-legal', {
              'data-drop-kind': 'SELF_MMZ',
              'data-drop-hint': hint
            });
          });
        }

        // 2. Field Spell Slot
        if (isFieldSpell && (handActivateActs.length > 0 || setStActs.length > 0)) {
          const fSlot = document.getElementById('self-field-spell-slot');
          markTarget(fSlot, 'drop-zone-legal', {
            'data-drop-kind': 'SELF_FIELD',
            'data-drop-hint': lang === 'en' ? '❖ Field Spell' : '❖ เวทสนาม'
          });
        }

        // 3. Empty Spell/Trap Slots for non-Field Spells, Traps & Pendulum Scales
        const pendulumScaleActs = handActivateActs.filter(a => a.isPendulumScale);
        const spellActivateActs = handActivateActs.filter(a => !a.isPendulumScale && card.kind !== 'MONSTER');
        if (!isFieldSpell && (setStActs.length > 0 || spellActivateActs.length > 0 || pendulumScaleActs.length > 0)) {
          const hasAct = spellActivateActs.length > 0 || pendulumScaleActs.length > 0;
          const hasSet = setStActs.length > 0;
          const hint = pendulumScaleActs.length > 0 && !hasSet && spellActivateActs.length === 0
            ? (lang === 'en' ? '🔶 Pendulum Scale' : '🔶 วางโซนเพนดูลัม')
            : hasAct && hasSet
              ? (lang === 'en' ? '✨ Use / 🂠 Set' : '✨ ใช้ / 🂠 หมอบ')
              : (hasAct
                ? (lang === 'en' ? '✨ Activate' : '✨ สั่งใช้')
                : (lang === 'en' ? '🂠 Set' : '🂠 หมอบ'));
          document.querySelectorAll('#self-stz-grid .zone-slot').forEach((slotEl) => {
            if (slotEl.querySelector('.duel-card')) return;
            const zIdx = Number(slotEl.getAttribute('data-zone-index'));
            if (pendulumScaleActs.length > 0 && !hasSet && spellActivateActs.length === 0 && zIdx !== 0 && zIdx !== 4) return;
            markTarget(slotEl, 'drop-zone-legal', {
              'data-drop-kind': 'SELF_STZ',
              'data-drop-hint': hint
            });
          });
        }

        // 4. Center Arena quick-activate drop target (for Hand Monsters like Maxx "C" / Spells / Impermanence)
        if (handActivateActs.length > 0 && !isFieldSpell) {
          const playmat = document.getElementById('playmat-container');
          markTarget(playmat, 'drop-arena-activate', {
            'data-drop-kind': 'ARENA_ACTIVATE',
            'data-drop-hint': lang === 'en' ? '⚡ Activate Effect' : '⚡ สั่งใช้งานเอฟเฟค'
          });
        }
      } else if (hasHandOrFieldActions) {
        // Field Ignition / Change Position / Flip Spell-Trap
        const playmat = document.getElementById('playmat-container');
        markTarget(playmat, 'drop-arena-activate', {
          'data-drop-kind': 'ARENA_ACTIVATE',
          'data-drop-hint': lang === 'en' ? '⚡ Activate / Position' : '⚡ ใช้เอฟเฟค / เปลี่ยนท่า'
        });
      }
    };

    const startVisualDrag = (clientX, clientY) => {
      isDragging = true;
      onHidePopup?.();
      onInspect?.(card);
      document.body.classList.add('is-card-dragging');
      if (isTouchHandCard) {
        document.querySelector('.player-bottom-dock')?.classList.remove('hand-expanded');
      }
      cardEl.classList.add('drag-source-dim');

      prepareLegalDropTargets();

      if (dragMode === 'ATTACK') {
        cardEl.classList.add('drag-attacking-source');
        const svg = getSvgArrowOverlay();
        svg.classList.remove('hidden');
        updateAttackArrow(originCx, originCy, clientX, clientY);
      } else {
        const layer = getFloatingDragGhostLayer();
        layer.innerHTML = '';
        ghostEl = cardEl.cloneNode(true);
        ghostEl.classList.remove('drag-source-dim', 'playable-glow', 'hand-card-item', 'def-position');
        ghostEl.classList.add('dragging-card-ghost');
        ghostEl.style.width = `${startRect.width}px`;
        ghostEl.style.height = `${startRect.height}px`;
        layer.appendChild(ghostEl);
        layer.classList.remove('hidden');
        moveGhost(clientX - offsetX, clientY - offsetY);
      }
    };

    const moveGhost = (left, top) => {
      if (!ghostEl) return;
      ghostEl.style.transform = `translate3d(${left}px, ${top}px, 0) scale(1.09)`;
    };

    const updateAttackArrow = (x1, y1, x2, y2) => {
      const glowLine = document.getElementById('atk-arrow-glow');
      const coreLine = document.getElementById('atk-arrow-core');
      if (glowLine) {
        glowLine.setAttribute('x1', x1);
        glowLine.setAttribute('y1', y1);
        glowLine.setAttribute('x2', x2);
        glowLine.setAttribute('y2', y2);
      }
      if (coreLine) {
        coreLine.setAttribute('x1', x1);
        coreLine.setAttribute('y1', y1);
        coreLine.setAttribute('x2', x2);
        coreLine.setAttribute('y2', y2);
      }
    };

    const findBestDropElement = (clientX, clientY) => {
      const stack = document.elementsFromPoint(clientX, clientY);
      // Priority 1: Specific zone slot or attack target
      for (const el of stack) {
        const candidate = el.closest('[data-drop-kind]');
        if (candidate && candidate.getAttribute('data-drop-kind') !== 'ARENA_ACTIVATE') {
          return candidate;
        }
      }
      // Priority 2: Center arena / playmat quick activate
      for (const el of stack) {
        const arena = el.closest('[data-drop-kind="ARENA_ACTIVATE"]');
        if (arena) return arena;
      }
      return null;
    };

    const updateHoverHighlight = (clientX, clientY) => {
      const target = findBestDropElement(clientX, clientY);
      if (currentHoverEl && currentHoverEl !== target) {
        currentHoverEl.classList.remove('drop-zone-hovered');
      }
      if (target) {
        target.classList.add('drop-zone-hovered');
      }
      currentHoverEl = target;

      if (dragMode === 'ATTACK') {
        const svg = document.getElementById('duel-attack-arrow-svg');
        const isCancelHover = target?.getAttribute('data-drop-kind') === 'ATTACK_CANCEL';
        svg?.classList.toggle('is-cancel-hover', Boolean(isCancelHover));
      }
    };

    const handleTouchMoveGuard = (touchEvent) => {
      if (isDragging && touchEvent.cancelable) {
        touchEvent.preventDefault();
      }
    };

    const cleanup = () => {
      isDragging = false;
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('pointercancel', handleCancel);
      document.removeEventListener('touchmove', handleTouchMoveGuard);
      document.removeEventListener('keydown', handleKeyDown);

      document.body.classList.remove('is-card-dragging');
      cardEl.classList.remove('drag-source-dim', 'drag-attacking-source');

      if (currentHoverEl) {
        currentHoverEl.classList.remove('drop-zone-hovered');
        currentHoverEl = null;
      }

      for (const m of markedElements) {
        m.el.classList.remove(m.className);
        for (const attr of m.attrs) m.el.removeAttribute(attr);
      }
      markedElements = [];

      const layer = document.getElementById('duel-drag-ghost-layer');
      if (layer) {
        layer.classList.add('hidden');
        layer.innerHTML = '';
      }

      const svg = document.getElementById('duel-attack-arrow-svg');
      svg?.classList.add('hidden');
      svg?.classList.remove('is-cancel-hover');
      ghostEl = null;
    };

    const resolveDrop = (clientX, clientY) => {
      const dropEl = findBestDropElement(clientX, clientY);
      if (!dropEl || dropEl.getAttribute('data-drop-kind') === 'ATTACK_CANCEL') {
        announceLive(lang === 'en' ? `${card.name} attack cancelled` : `ยกเลิกการโจมตีของ ${card.nameTh}`);
        return;
      }

      const dropKind = dropEl.getAttribute('data-drop-kind');
      const slotIndexAttr = dropEl.getAttribute('data-zone-index');
      const targetZoneIndex = slotIndexAttr !== null ? Number(slotIndexAttr) : undefined;

      if (dropKind === 'ATTACK_MONSTER') {
        const targetInstanceId = dropEl.getAttribute('data-drop-target-id');
        onExecuteAction?.({
          type: 'DECLARE_ATTACK',
          attackerInstanceId: card.instanceId,
          targetInstanceId
        });
        announceLive(lang === 'en' ? `${card.name} attacks!` : `${card.nameTh} โจมตี!`);
        return;
      }

      if (dropKind === 'ATTACK_DIRECT') {
        onExecuteAction?.({
          type: 'DECLARE_ATTACK',
          attackerInstanceId: card.instanceId,
          directAttack: true
        });
        announceLive(lang === 'en' ? `${card.name} attacks directly!` : `${card.nameTh} โจมตีโดยตรง!`);
        return;
      }

      if (dropKind === 'SELF_FIELD') {
        const fieldActs = actions
          .filter(a => a.type === 'ACTIVATE_EFFECT' || a.type === 'SET_SPELL_TRAP')
          .map(a => ({ ...a, targetZoneIndex: 0, targetZoneType: 'FIELD_SPELL' }));
        if (fieldActs.length === 1) {
          const act = fieldActs[0];
          onExecuteAction?.({
            type: act.type,
            instanceId: card.instanceId,
            effectId: act.effectId,
            targetZoneIndex: 0,
            targetZoneType: 'FIELD_SPELL',
            ocgAction: act.ocgAction,
            ocgIndex: act.ocgIndex
          });
          announceLive(lang === 'en' ? `Activated ${card.name}` : `ใช้งาน ${card.nameTh}`);
        } else if (fieldActs.length > 1) {
          onShowChoicePopup?.(card, fieldActs, dropEl);
        }
        return;
      }

      if (dropKind === 'SELF_MMZ') {
        const mmzActs = actions.filter(a =>
          a.type === 'NORMAL_SUMMON' || a.type === 'NORMAL_SET' || a.type === 'INHERENT_SPECIAL_SUMMON' || a.type === 'SPECIAL_SUMMON' || a.type === 'SET_MONSTER'
        ).map(a => ({ ...a, targetZoneIndex, targetZoneType: 'MMZ' }));

        if (mmzActs.length === 1) {
          const only = mmzActs[0];
          onExecuteAction?.({
            type: only.type,
            instanceId: card.instanceId,
            position: only.position,
            targetZoneIndex,
            targetZoneType: 'MMZ',
            ocgAction: only.ocgAction,
            ocgIndex: only.ocgIndex
          });
          announceLive(lang === 'en' ? `${card.name} placed in Monster Zone` : `วาง ${card.nameTh} ในโซนมอนสเตอร์`);
        } else if (mmzActs.length > 1) {
          onShowChoicePopup?.(card, mmzActs, dropEl);
        }
        return;
      }

      if (dropKind === 'SELF_STZ') {
        const stzActs = actions
          .filter(a => a.type === 'ACTIVATE_EFFECT' || a.type === 'SET_SPELL_TRAP')
          .filter(a => !a.isPendulumScale || targetZoneIndex === 0 || targetZoneIndex === 4)
          .map(a => ({ ...a, targetZoneIndex, targetZoneType: 'STZ' }));

        if (stzActs.length === 1) {
          const only = stzActs[0];
          onExecuteAction?.({
            type: only.type,
            instanceId: card.instanceId,
            effectId: only.effectId,
            targetZoneIndex,
            targetZoneType: 'STZ',
            ocgAction: only.ocgAction,
            ocgIndex: only.ocgIndex
          });
          announceLive(lang === 'en' ? `${card.name} placed in Spell/Trap Zone` : `วาง ${card.nameTh} ในโซนเวท/กับดัก`);
        } else if (stzActs.length > 1) {
          onShowChoicePopup?.(card, stzActs, dropEl);
        }
        return;
      }

      if (dropKind === 'ARENA_ACTIVATE') {
        const arenaActs = card.zone === 'HAND'
          ? actions.filter(a => a.type === 'ACTIVATE_EFFECT')
          : actions;

        if (arenaActs.length === 1) {
          const only = arenaActs[0];
          onExecuteAction?.({
            type: only.type,
            instanceId: card.instanceId,
            effectId: only.effectId,
            position: only.position,
            ocgAction: only.ocgAction,
            ocgIndex: only.ocgIndex
          });
          announceLive(lang === 'en' ? `Activated ${card.name}` : `สั่งใช้งาน ${card.nameTh}`);
        } else if (arenaActs.length > 1) {
          onShowChoicePopup?.(card, arenaActs, dropEl);
        }
      }
    };

    const handleMove = (moveEvent) => {
      if (gestureAborted) return;
      if (!isDragging) {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (isTouchHandCard) {
          const upward = -dy;
          const absX = Math.abs(dx);
          // Yield to native horizontal hand scroll if swiping sideways or downward
          if ((absX >= 10 && absX >= upward * 1.1) || dy >= 10) {
            gestureAborted = true;
            cleanup();
            return;
          }
          // Only trigger drag-to-play on mobile hand cards when dragged clearly UPWARD (forward)
          if (upward < 18 || upward <= absX * 1.35) return;
        } else {
          const dist = Math.hypot(dx, dy);
          if (dist < 6) return;
        }
        startVisualDrag(moveEvent.clientX, moveEvent.clientY);
      }

      if (dragMode === 'ATTACK') {
        updateAttackArrow(originCx, originCy, moveEvent.clientX, moveEvent.clientY);
      } else {
        moveGhost(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
      }
      updateHoverHighlight(moveEvent.clientX, moveEvent.clientY);
    };

    const handleUp = (upEvent) => {
      const wasDragging = isDragging;
      if (wasDragging) {
        activeSuppressClickUntil = Date.now() + 200;
        resolveDrop(upEvent.clientX, upEvent.clientY);
      }
      cleanup();
    };

    const handleCancel = () => {
      if (isDragging) activeSuppressClickUntil = Date.now() + 200;
      cleanup();
    };

    const handleKeyDown = (keyEvent) => {
      if (keyEvent.key === 'Escape') {
        cleanup();
      }
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('pointercancel', handleCancel);
    if (isTouchHandCard) {
      document.addEventListener('touchmove', handleTouchMoveGuard, { passive: false });
    }
    document.addEventListener('keydown', handleKeyDown);
  });
}
