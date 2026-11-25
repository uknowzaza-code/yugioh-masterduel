import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  OCG_SYSTEM_STRINGS,
  OCG_SYSTEM_STRINGS_TH,
  getLocalizedOcgSystemString,
  createDescriptionResolver,
  genericOptionLabel,
  parseStringsConf,
  clearRuntimeStrings
} from '../src/engine/ocgSystemStrings.js';
import { resolveOcgDescription, resolveOcgOptionLabel } from '../src/engine/OcgCardDb.js';

beforeEach(() => clearRuntimeStrings());

test('573 / 574 (ProjectIgnis aux.ToHandOrElse) resolve in EN and TH', () => {
  assert.equal(getLocalizedOcgSystemString(573, 'en'), 'Add to Hand');
  assert.equal(getLocalizedOcgSystemString(573, 'th'), 'นำขึ้นมือ (Add to Hand)');
  assert.equal(getLocalizedOcgSystemString(574, 'en'), 'Send to GY');
  assert.equal(getLocalizedOcgSystemString(574, 'th'), 'ส่งลงสุสาน (Send to GY)');
});

test('1213 / 1214 resolve as Yes / No in EN and TH', () => {
  assert.equal(getLocalizedOcgSystemString(1213, 'en'), 'Yes');
  assert.equal(getLocalizedOcgSystemString(1213, 'th'), 'ใช่');
  assert.equal(getLocalizedOcgSystemString(1214, 'en'), 'No');
  assert.equal(getLocalizedOcgSystemString(1214, 'th'), 'ไม่');
});

test('ProjectIgnis action & summon IDs 70..72 and 1160..1174 resolve cleanly', () => {
  assert.equal(getLocalizedOcgSystemString(70, 'en'), 'Monster');
  assert.equal(getLocalizedOcgSystemString(71, 'en'), 'Spell');
  assert.equal(getLocalizedOcgSystemString(72, 'en'), 'Trap');
  assert.equal(getLocalizedOcgSystemString(1160, 'en'), 'Activate as Pendulum Spell');
  assert.equal(getLocalizedOcgSystemString(1161, 'en'), 'Resolve Effect');
  assert.equal(getLocalizedOcgSystemString(1170, 'en'), 'Fusion Summon');
  assert.equal(getLocalizedOcgSystemString(1174, 'en'), 'Link Summon');
});

test('Every EN system string key has a TH translation', () => {
  const missing = Object.keys(OCG_SYSTEM_STRINGS).filter((k) => !(k in OCG_SYSTEM_STRINGS_TH));
  assert.deepEqual(missing, []);
});

test('Duel.SelectOption(p, 573, 574) never falls back to Option #', () => {
  for (const lang of ['en', 'th']) {
    const labels = [573, 574].map((d, i) => resolveOcgOptionLabel(d, i, lang));
    assert.ok(labels.every((l) => !/Option #/.test(l)), labels.join(' | '));
  }
  assert.equal(resolveOcgDescription(573), 'Add to Hand');
  assert.equal(resolveOcgDescription(574), 'Send to GY');
});

test('Supports BigInt and numeric string aux.Stringid values', () => {
  const db = { 89631139: ['Effect A', 'Effect B'] };
  const resolve = createDescriptionResolver((code, idx) => db[code]?.[idx] ?? null);
  assert.equal(resolve((89631139n << 20n) | 1n), 'Effect B');
  assert.equal(resolve(89631139 * 16), 'Effect A');
  assert.equal(resolve('573', 0, 'en'), 'Add to Hand');
});

test('Unknown option falls back to user-friendly Option N / ตัวเลือกที่ N', () => {
  assert.equal(resolveOcgOptionLabel(999999, 0, 'en'), 'Option 1');
  assert.equal(resolveOcgOptionLabel(999999, 1, 'th'), 'ตัวเลือกที่ 2');
});

test('parseStringsConf reads !system entries accurately', () => {
  const map = parseStringsConf('#comment\n!system 573 Add the card(s) to your hand\r\n!counter 0x1 X\n');
  assert.equal(map.get(573), 'Add the card(s) to your hand');
  assert.equal(map.size, 1);
});
