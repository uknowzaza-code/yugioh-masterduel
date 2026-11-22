/**
 * @fileoverview CLI Card & Deck Validator
 * รันด้วยคำสั่ง `npm run validate-cards` เพื่อตรวจสอบความถูกต้องของการ์ดทุกใบและเด็คทั้ง 5 เด็ค
 * เมื่อ AI ตัวอื่นเพิ่มการ์ดเข้ามาในระบบ ให้รันสคริปต์นี้เพื่อตรวจสอบความถูกต้องได้ทันที
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllCards, PRESET_DECKS, registerCustomCards, getCardById } from '../src/cards/index.js';
import { validateCardSchema } from '../src/cards/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const customCardsPath = path.join(__dirname, '..', 'src', 'cards', 'custom_cards.json');

if (fs.existsSync(customCardsPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(customCardsPath, 'utf8'));
    const res = registerCustomCards(raw);
    if (res.errors.length > 0) {
      console.error('❌ พบข้อผิดพลาดใน custom_cards.json:', res.errors);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ ไม่สามารถอ่านไฟล์ custom_cards.json:', err.message);
    process.exit(1);
  }
}

const allCards = getAllCards();
let totalErrors = 0;

console.log(`🔍 กำลังตรวจสอบฐานข้อมูลการ์ดทั้งหมด ${allCards.length} ใบ...`);
for (const card of allCards) {
  const result = validateCardSchema(card);
  if (!result.valid) {
    console.error(`❌ การ์ด "${card.id}" ไม่ผ่านเกณฑ์:`, result.errors);
    totalErrors += result.errors.length;
  }
}

console.log(`🔍 กำลังตรวจสอบโครงสร้างเด็คยอดนิยมทั้ง ${PRESET_DECKS.length} เด็ค...`);
for (const deck of PRESET_DECKS) {
  let mainCount = 0;
  for (const item of deck.mainDeckRecipe) {
    if (!getCardById(item.id)) {
      console.error(`❌ เด็ค "${deck.id}" อ้างอิงการ์ดที่ไม่มีในระบบ: "${item.id}"`);
      totalErrors++;
    }
    mainCount += item.count;
  }
  let extraCount = 0;
  for (const item of deck.extraDeckRecipe) {
    if (!getCardById(item.id)) {
      console.error(`❌ เด็ค "${deck.id}" (Extra Deck) อ้างอิงการ์ดที่ไม่มีในระบบ: "${item.id}"`);
      totalErrors++;
    }
    extraCount += item.count;
  }
  console.log(`   ✅ ${deck.nameTh} — Main Deck: ${mainCount} ใบ, Extra Deck: ${extraCount} ใบ`);
}

if (totalErrors > 0) {
  console.error(`\n❌ พบข้อผิดพลาดรวม ${totalErrors} รายการ`);
  process.exit(1);
}

console.log(`\n🎉 ผ่านการตรวจสอบสมบูรณ์! การ์ดทั้งหมด ${allCards.length} ใบ และเด็คทั้ง ${PRESET_DECKS.length} เด็คพร้อมใช้งาน!`);
