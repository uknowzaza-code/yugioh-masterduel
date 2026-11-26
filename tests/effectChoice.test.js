import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEffectChoiceState, CANCEL_SENTINEL } from '../public/js/effectChoiceState.js';
import { I18N_STRINGS } from '../public/js/i18n.js';

test('createEffectChoiceState handles bounds, clamping, arrow nav, and idempotent confirm', () => {
  const opts = [
    { index: 0, label: 'Add to Hand' },
    { index: 1, label: 'Send to GY' },
    { index: 2, label: 'Special Summon' }
  ];
  const st = createEffectChoiceState(opts, { canCancel: false, initialIndex: 5 });
  assert.equal(st.getState().selectedIndex, 2, 'initialIndex clamps to maxIndex');

  assert.equal(st.next(), 2, 'next clamps at last index without wrapping');
  assert.equal(st.prev(), 1);
  assert.equal(st.first(), 0);
  assert.equal(st.prev(), 0, 'prev clamps at 0 without wrapping');
  assert.equal(st.last(), 2);
  assert.equal(st.select(-10), 0);
  assert.equal(st.select(1), 1);

  assert.equal(st.togglePeek(), true);
  assert.equal(st.getState().settled, false, 'peek must never commit');
  assert.equal(st.togglePeek(), false);

  // Cancel disallowed when canCancel === false
  const badCancel = st.cancel();
  assert.equal(badCancel.committed, false);
  assert.equal(st.getState().settled, false);

  // Confirm returns selected option and is idempotent
  const c1 = st.confirm();
  assert.equal(c1.committed, true);
  assert.equal(c1.value.index, 1);

  const c2 = st.confirm();
  assert.equal(c2.committed, false);
  assert.equal(st.select(0), 1, 'select is no-op after settled');
});

test('createEffectChoiceState supports cancel when allowed, single-option, and 6-option sets', () => {
  const single = createEffectChoiceState([{ index: 0, label: 'Only' }], { canCancel: true });
  assert.equal(single.next(), 0);
  assert.equal(single.cancel().value, CANCEL_SENTINEL);
  assert.equal(single.confirm().committed, false, 'confirm blocked after cancel');

  const six = Array.from({ length: 6 }, (_, i) => ({ index: i, label: `Effect ${i + 1}` }));
  const many = createEffectChoiceState(six, { canCancel: false });
  assert.equal(many.last(), 5);
  assert.equal(many.prev(), 4);
  assert.equal(many.confirm().value.index, 4);
});

test('effectChoice i18n keys exist and are non-empty in both EN and TH', () => {
  const keys = [
    'effectChoiceTitle',
    'effectChoiceOk',
    'effectChoiceCancel',
    'effectChoiceViewBoard',
    'effectChoiceShowPrompt',
    'effectChoiceTabLabel'
  ];
  for (const lang of ['en', 'th']) {
    for (const k of keys) {
      assert.ok(typeof I18N_STRINGS[lang][k] === 'string' && I18N_STRINGS[lang][k].trim().length > 0, `Missing ${lang}.${k}`);
    }
  }
});

test('styles.css preserves no-backdrop-filter and no-transition-all invariants', () => {
  const css = fs.readFileSync('public/css/styles.css', 'utf8');
  assert.equal(/backdrop-filter\s*:/i.test(css), false, 'backdrop-filter is forbidden');
  assert.equal(/transition\s*:\s*all\b/i.test(css), false, 'transition: all is forbidden');
  assert.ok(css.includes('.ec-layer') && css.includes('.ec-modal') && css.includes('.ec-ok'));
});
