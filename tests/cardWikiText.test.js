import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllCards, getCardById } from '../src/cards/index.js';
import { getUiCardMeta } from '../src/engine/OcgCardDb.js';

test('All 1,072 registry cards have clean Wiki text with zero raw markup or unofficial footnotes', () => {
  const cards = getAllCards();
  assert.ok(cards.length >= 1072);

  for (const c of cards) {
    assert.ok(typeof c.description === 'string' && c.description.trim().length > 0, `Empty description for ${c.id}`);
    assert.equal(/\*\s*The above text is unofficial/i.test(c.description), false, `Unofficial OCG note in ${c.id}`);
    assert.equal(/\[\[|\]\]|<br\s*\/?>|&quot;|&#39;/i.test(c.description), false, `Raw wiki markup in ${c.id}: ${c.description}`);
    if (c.passcode) {
      const cdb = getUiCardMeta(Number(c.passcode));
      assert.ok(cdb, `Missing OcgCardDb meta for ${c.id} (${c.passcode})`);
      assert.equal(cdb.description, c.description.trim(), `OcgCardDb and JS registry mismatch for ${c.id}`);
      assert.equal(cdb.name, c.name, `OcgCardDb and JS name mismatch for ${c.id}`);
    }
  }
});

test('Spot-check exact Yugipedia Wiki text across iconic cards, Pendulums, Normal Monsters, and new cards', () => {
  // 1. Normal Monster flavor text (no ''...'' wrappers)
  const bewd = getCardById('89631139');
  assert.equal(
    bewd.description,
    'This legendary dragon is a powerful engine of destruction. Virtually invincible, very few have faced this awesome creature and lived to tell the tale.'
  );

  // 2. Dark Magician Girl (latest PSCT: GYs)
  const dmg = getUiCardMeta(38033121);
  assert.equal(dmg.description, 'Gains 300 ATK for every "Dark Magician" or "Magician of Black Chaos" in the GYs.');

  // 3. Maxx "C" (exact PSCT wording)
  const maxx = getUiCardMeta(23434538);
  assert.equal(
    maxx.description,
    '(Quick Effect): You can send this card from your hand to the GY; this turn, each time your opponent Special Summons a monster(s), immediately draw 1 card. You can only use this effect of "Maxx "C"" once per turn.'
  );

  // 4. S:P Little Knight (no unofficial OCG disclaimer)
  const sp = getUiCardMeta(29301450);
  assert.equal(
    sp.description,
    '2 Effect Monsters\nIf this card is Link Summoned using a Fusion, Synchro, Xyz, or Link Monster as material: You can target 1 card on the field or in either GY; banish it, also your monsters cannot attack directly this turn. When your opponent activates a card or effect (Quick Effect): You can target 2 face-up monsters on the field, including a monster you control; banish both until the End Phase. You can only use each effect of "S:P Little Knight" once per turn.'
  );

  // 5. Return of the Dragon Lords (full 2-sentence text)
  const rotl = getCardById('return_of_the_dragon_lords');
  assert.match(rotl.description, /you can banish this card from your GY instead/);
});
