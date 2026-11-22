# 🤖 AI Card & Deck Development Guide (`yugioh-masterduel`)

เอกสารนี้ออกแบบมาโดยเฉพาะสำหรับ **AI Agent ตัวอื่น (เช่น Claude, ChatGPT, Gemini, Cursor, Antigravity)** หรือนักพัฒนาที่ต้องการเพิ่มการ์ดใหม่และเด็คใหม่เข้าสู่เกม **Yu-Gi-Oh! Master Duel Web Engine** โดยไม่ต้องแก้ไขโค้ดระบบหลักของเกม

---

## 1. ภาพรวมสถาปัตยกรรมระบบการ์ด (Card System Architecture)

เกมนี้ใช้ระบบ **Hybrid Declarative + Scriptable Card Engine**:
- **ไม่ต้องรัน Build / Bundler ซ้ำ**: โฟลเดอร์ `src/` ถูกแชร์ร่วมกันเป็น ES Modules ระหว่าง Node.js (`server.js`) และ Browser (`public/js/app.js`) ทันทีที่เพิ่มการ์ดและรีเฟรชหน้าเว็บ การ์ดใหม่จะพร้อมใช้งานทันที และบอท `AIPlayer` จะสามารถเล่นการ์ดใหม่ได้อัตโนมัติ!
- **ช่องทางในการเพิ่มการ์ดใหม่ (เลือกได้ 3 วิธี)**:
  1. **วิธีที่ 1 (แนะนำเมื่อเพิ่มทั้งเด็ค):** สร้างไฟล์เด็คใหม่ใน `src/cards/decks/<deck_name>.js` แล้วนำเข้าใน `src/cards/index.js` (`BUILT_IN_CARDS` และ `PRESET_DECKS`)
  2. **วิธีที่ 2 (เพิ่มการ์ดรายใบแบบ JSON):** เพิ่มข้อมูลการ์ดลงใน `src/cards/custom_cards.json`
  3. **วิธีที่ 3 (เพิ่มผ่านหน้าเว็บ UI):** เปิดปุ่ม **"🤖 AI Card Studio"** บนแถบเมนูด้านบนของเว็บ วาง JSON การ์ด แล้วกดบันทึก

หลังจากเพิ่มการ์ดแล้ว ให้รันคำสั่งตรวจสอบความถูกต้องเสมอ:
```powershell
npm run validate-cards
npm test
```

---

## 2. โครงสร้างข้อมูลการ์ด (`CardSchema`)

### 2.1 ตัวอย่างมอนสเตอร์เอฟเฟค / จูนเนอร์ / อัญเชิญพิเศษจากมือ
```javascript
{
  id: 'swordsoul_of_mo_ye',          // รหัสอ้างอิงเฉพาะ (snake_case, ห้ามซ้ำ)
  passcode: '20001443',              // รหัสการ์ดจริง 8 หลักของ Konami (ใช้ดึงรูปจริงอัตโนมัติ ถ้าไม่มีใส่ '' ระบบจะวาดรูป SVG ให้อัตโนมัติ)
  name: 'Swordsoul of Mo Ye',        // ชื่อการ์ดภาษาอังกฤษ
  nameTh: 'ซอร์ดโซล โม่เย่ (Mo Ye)',  // ชื่อการ์ดภาษาไทยสำหรับแสดงใน UI
  kind: 'MONSTER',                   // 'MONSTER' | 'SPELL' | 'TRAP' | 'TOKEN'
  frame: 'EFFECT',                   // 'NORMAL' | 'EFFECT' | 'FUSION' | 'SYNCHRO' | 'XYZ' | 'LINK' | 'TOKEN'
  attribute: 'WATER',                // 'LIGHT' | 'DARK' | 'WATER' | 'FIRE' | 'EARTH' | 'WIND' | 'DIVINE'
  race: 'Wyrm',                      // เช่น 'Dragon', 'Spellcaster', 'Warrior', 'Machine', 'Wyrm', 'Fiend', 'Fairy', 'Zombie', 'Cyberse'
  level: 4,                          // เลเวล 1-12 (สำหรับ Xyz ใช้ `rank: 1-13`, สำหรับ Link ใช้ `linkRating: 1-6`)
  isTuner: false,                    // true หากเป็นมอนสเตอร์จูนเนอร์ (สำหรับ Synchro Summon)
  atk: 1700,
  def: 1800,
  archetype: 'Swordsoul',            // ชื่อสายเด็คหลัก
  subArchetypes: ['Tenyi'],          // (Optional) สายเด็ครอง
  mentions: ['Fallen of Albaz'],     // (Optional) รายชื่อการ์ดที่ถูกกล่าวถึงในเท็กซ์

  // (Optional) เงื่อนไขการอัญเชิญพิเศษจากมือโดยไม่เปิดเชน (Inherent Special Summon)
  specialSummonRule: {
    fromZone: 'HAND',
    labelTh: 'อัญเชิญพิเศษจากมือ',
    opt: 'unique_ss_opt_id',         // (Optional) จำกัดเทิร์นละ 1 ครั้ง
    cost: { discardHandCount: 1 },   // (Optional) ทิ้งการ์ดบนมือ 1 ใบ
    condition: {
      hasCardInHandOrField: { archetype: 'Blue-Eyes' }
    }
  },

  description: 'Original English card text...',
  descriptionTh: 'คำอธิบายเอฟเฟคภาษาไทยที่เข้าใจง่าย...',
  effects: [
    // ดูรายละเอียดโครงสร้าง Effect ในหัวข้อถัดไป
  ]
}
```

### 2.2 ตัวอย่างมอนสเตอร์ Extra Deck (`FUSION`, `SYNCHRO`, `XYZ`, `LINK`)
- **Synchro Monster (`frame: 'SYNCHRO'`)**:
  ```javascript
  summonMaterials: {
    type: 'SYNCHRO',
    tunerCount: 1,
    nonTunerMin: 1,
    descriptionTh: 'จูนเนอร์ 1 ใบ + มอนสเตอร์ที่ไม่ใช่จูนเนอร์ 1 ใบขึ้นไป (ผลรวมเลเวล = 8)'
  }
  ```
- **Xyz Monster (`frame: 'XYZ'`, ใช้ `rank` แทน `level`)**:
  ```javascript
  rank: 8,
  summonMaterials: {
    type: 'XYZ',
    level: 8,
    count: 2,
    descriptionTh: 'มอนสเตอร์เลเวล 8 จำนวน 2 ใบ'
  }
  ```
- **Link Monster (`frame: 'LINK'`, ใช้ `linkRating` และ `def: 0`)**:
  ```javascript
  linkRating: 1,
  linkArrows: ['BOTTOM_LEFT'],
  summonMaterials: {
    type: 'LINK',
    minMonsters: 1,
    maxMonsters: 1,
    filter: { archetype: 'Sky Striker', notAttribute: 'FIRE' },
    descriptionTh: 'มอนสเตอร์ "Sky Striker Ace" ที่ไม่ใช่ธาตุไฟ 1 ใบ'
  }
  ```

---

## 3. โครงสร้างเอฟเฟค (`effects`) และจังหวะการทำงาน (`TRIGGERS`)

แต่ละการ์ดมี `effects: [...]` ได้หลายเอฟเฟค โดยแต่ละเอฟเฟคมีโครงสร้างดังนี้:

```javascript
{
  id: 'unique_effect_id',
  labelTh: 'ข้อความปุ่มกดภาษาไทยที่จะแสดงเมื่อผู้เล่นคลิกการ์ด',
  trigger: 'IGNITION',       // ดูตาราง TRIGGERS ด้านล่าง
  spellSpeed: 1,             // 1 (SS1), 2 (SS2 - เชนได้), 3 (SS3 - Counter Trap)
  zones: ['MMZ', 'EMZ'],     // โซนที่กดใช้ได้: ['HAND'], ['MMZ', 'EMZ'], ['STZ'], ['FIELD'], ['GY']
  opt: 'unique_opt_key',     // ชื่อ Once Per Turn (ถ้าใส่ จะใช้ได้เทิร์นละ 1 ครั้ง)
  condition: { ... },        // เงื่อนไขก่อนสั่งใช้งาน
  cost: { ... },             // ต้นทุนที่ต้องจ่ายทันทีเมื่อสั่งใช้งาน (ก่อนเข้าเชน)
  actions: [ ... ]           // รายการ Atomic Actions ที่จะทำงานเมื่อเชนคลี่คลาย
}
```

### 3.1 ค่า `trigger` ที่รองรับทั้งหมด (`src/constants/gameConstants.js`)
| ค่า `trigger` | ความหมายตามกฎ Master Duel |
|---|---|
| `'IGNITION'` | เอฟเฟคมอนสเตอร์/เวทต่อเนื่อง/สุสาน ที่ผู้เล่นกดสั่งใช้เองใน Main Phase 1 หรือ 2 (Spell Speed 1) |
| `'QUICK_EFFECT'` | เอฟเฟคความเร็วสูง (Spell Speed 2) กดใช้ได้ใน Main Phase หรือใช้ **Chain ตอบโต้** เมื่ออีกฝ่ายสั่งใช้การ์ด! |
| `'SPELL_ACTIVATE'` | เอฟเฟคเมื่อสั่งเปิดใช้งานการ์ดเวทมนตร์หรือกับดักจากมือหรือที่หมอบไว้ |
| `'ON_NORMAL_SUMMON'` | ทำงานอัตโนมัติเมื่อการ์ดใบนี้อัญเชิญปกติสำเร็จ |
| `'ON_SPECIAL_SUMMON'` | ทำงานอัตโนมัติเมื่อการ์ดใบนี้อัญเชิญพิเศษสำเร็จ (รวมถึง Fusion / Synchro / Xyz / Link) |
| `'ON_SUMMON_ANY'` | ทำงานอัตโนมัติเมื่อการ์ดใบนี้อัญเชิญปกติหรืออัญเชิญพิเศษสำเร็จ |
| `'ON_SEND_TO_GY'` | ทำงานอัตโนมัติเมื่อการ์ดใบนี้ถูกส่งลงสุสาน (เช่น ใช้เป็นวัตถุดิบซิงโคร/ฟิวชั่น/ลิงก์ หรือถูกทำลาย) |
| `'ON_BANISHED'` | ทำงานอัตโนมัติเมื่อการ์ดใบนี้ถูกนำออกนอกเกม (Banished) |
| `'ON_DESTROYED'` | ทำงานอัตโนมัติเมื่อการ์ดใบนี้ถูกทำลายบนสนาม |
| `'ON_ATTACK_DECLARE'` | ทำงานอัตโนมัติเมื่อมอนสเตอร์ใบนี้ประกาศโจมตีใน Battle Phase |

### 3.2 ค่า `condition` ที่รองรับ
```javascript
condition: {
  opponentControlsMonster: true,      // อีกฝ่ายต้องมีมอนสเตอร์บนสนาม
  opponentControlsSpellTrap: true,    // อีกฝ่ายต้องมีเวท/กับดักบนสนาม
  opponentControlsAnyCard: true,      // อีกฝ่ายต้องมีการ์ดใดๆ บนสนาม
  selfControlsMonster: true,          // เราต้องมีมอนสเตอร์บนสนาม
  selfControlsCard: { archetype: 'Dark Magician', kind: 'MONSTER' },
  hasCardInHandOrField: { id: 'blue_eyes_white_dragon' },
  hasCardInFieldOrGY: { id: 'blue_eyes_white_dragon' },
  minSpellsInGY: 3,                   // มีการ์ดเวทมนตร์ในสุสานเราอย่างน้อย N ใบ (เช่น Sky Striker)
  requiresActiveChain: true,          // ต้องใช้เชนต่อจากการ์ดใบอื่นเท่านั้น (เช่น Ash Blossom / Baronne negate)
  opponentChainOnly: true,            // เชนต่อจากเอฟเฟคของอีกฝ่ายเท่านั้น
  chainIncludesActionTypes: ['SEARCH_DECK', 'DRAW', 'SPECIAL_SUMMON_FROM_DECK'] // กรองชนิดเอฟเฟคที่เชนได้
}
```

### 3.3 ค่า `cost` ที่รองรับ
```javascript
cost: {
  discardSelf: true,                  // ทิ้งการ์ดใบนี้จากมือลงสุสานเป็น Cost (เช่น Hand Trap)
  banishSelf: true,                   // มูฟการ์ดใบนี้จากสุสาน/สนามออกนอกเกมเป็น Cost
  tributeSelf: true,                  // สังเวยการ์ดใบนี้บนสนามลงสุสานเป็น Cost
  discardHandCount: 1,                // ทิ้งการ์ดใบอื่นบนมือ N ใบเป็น Cost
  sendControlledMonsterToGY: 1,       // ส่งมอนสเตอร์บนสนามเรา N ใบลงสุสานเป็น Cost
  detachCount: 1                      // ถอด Xyz Overlay Unit N ใบเป็น Cost
}
```

---

## 4. รายการ `ACTION_TYPES` ทั้งหมดสำหรับประกอบเอฟเฟค (`actions: [...]`)

AI สามารถเรียงต่อ `actions` หลายตัวในเอฟเฟคเดียวได้ (ทำงานตามลำดับจากบนลงล่าง):

1. **จั่วการ์ด (`DRAW`)**:
   ```javascript
   { type: 'DRAW', count: 1 }
   ```
2. **ค้นหาการ์ดจากเด็คขึ้นมือ (`SEARCH_DECK`)**:
   ```javascript
   {
     type: 'SEARCH_DECK',
     count: 1,
     filter: { archetype: 'Blue-Eyes', kind: ['MONSTER', 'SPELL'], excludeId: 'bingo_machine_go' }
   }
   ```
3. **ส่งการ์ดจากเด็คลงสุสาน (`SEND_FROM_DECK_TO_GY`)**:
   ```javascript
   {
     type: 'SEND_FROM_DECK_TO_GY',
     count: 1,
     filter: { archetype: 'Despia', kind: 'MONSTER' }
   }
   ```
4. **อัญเชิญพิเศษจากเด็ค (`SPECIAL_SUMMON_FROM_DECK`)**:
   ```javascript
   {
     type: 'SPECIAL_SUMMON_FROM_DECK',
     count: 1,
     filter: { race: 'Wyrm', kind: 'MONSTER' }
   }
   ```
5. **อัญเชิญพิเศษจากสุสาน (`SPECIAL_SUMMON_FROM_GY`)**:
   ```javascript
   {
     type: 'SPECIAL_SUMMON_FROM_GY',
     targetOwner: 'SELF', // 'SELF' | 'OPPONENT' | ไม่ใส่=ทั้งสองสุสาน
     count: 1,
     filter: { kind: 'MONSTER', levelMin: 7 }
   }
   ```
6. **อัญเชิญพิเศษจาก Extra Deck (`SPECIAL_SUMMON_FROM_EXTRA`)**:
   ```javascript
   {
     type: 'SPECIAL_SUMMON_FROM_EXTRA',
     count: 1,
     filter: { archetype: 'Sky Striker', frame: 'LINK' }
   }
   ```
7. **อัญเชิญพิเศษตัวเองจากมือหรือสุสาน (`SPECIAL_SUMMON_SELF_FROM_HAND` / `SPECIAL_SUMMON_SELF_FROM_GY`)**:
   ```javascript
   { type: 'SPECIAL_SUMMON_SELF_FROM_HAND' }
   ```
8. **อัญเชิญฟิวชั่น (`FUSION_SUMMON`)**:
   ```javascript
   {
     type: 'FUSION_SUMMON',
     allowGYMaterials: true,
     allowDeckMaterials: false,
     fusionFilter: { archetype: ['Branded', 'Despia'] }
   }
   ```
9. **เสกมอนสเตอร์โทเค็นลงสนาม (`SPAWN_TOKEN`)**:
   ```javascript
   {
     type: 'SPAWN_TOKEN',
     token: {
       id: 'swordsoul_token',
       name: 'Swordsoul Token',
       nameTh: 'ซอร์ดโซล โทเค็น (จูนเนอร์ Lv.4)',
       kind: 'MONSTER',
       frame: 'TOKEN',
       attribute: 'WATER',
       race: 'Wyrm',
       level: 4,
       isTuner: true,
       atk: 0,
       def: 0,
       archetype: 'Swordsoul',
       descriptionTh: 'โทเค็นจูนเนอร์ Lv.4'
     }
   }
   ```
10. **ทำลายการ์ดบนสนาม (`DESTROY_CARDS`)**:
    ```javascript
    {
      type: 'DESTROY_CARDS',
      targetOwner: 'OPPONENT',
      targetZone: 'ANY_FIELD', // 'MONSTER' | 'SPELL_TRAP' | 'ANY_FIELD'
      count: 1
    }
    ```
11. **นำการ์ดออกนอกเกม (`BANISH_CARDS`)**:
    ```javascript
    {
      type: 'BANISH_CARDS',
      sourceZone: 'ANY_FIELD', // 'GY' | 'MONSTER' | 'SPELL_TRAP' | 'ANY_FIELD'
      targetOwner: 'OPPONENT',
      count: 1
    }
    ```
12. **ดีดการ์ดกลับขึ้นมือ/Extra Deck (`RETURN_TO_HAND`)**:
    ```javascript
    {
      type: 'RETURN_TO_HAND',
      targetOwner: 'OPPONENT',
      targetZone: 'ANY_FIELD',
      count: 1
    }
    ```
13. **ยกเลิกการสั่งใช้งานเอฟเฟคในเชนก่อนหน้า (`NEGATE_ACTIVATION`)**:
    ```javascript
    { type: 'NEGATE_ACTIVATION', destroyNegated: true }
    ```
14. **ใบ้เอฟเฟคมอนสเตอร์ที่หงายหน้าบนสนาม (`NEGATE_FACEUP_EFFECT`)**:
    ```javascript
    {
      type: 'NEGATE_FACEUP_EFFECT',
      targetOwner: 'OPPONENT',
      count: 1,
      filter: { kind: 'MONSTER', faceUp: true }
    }
    ```
15. **ยึดการควบคุมมอนสเตอร์อีกฝ่าย (`TAKE_CONTROL`)**:
    ```javascript
    {
      type: 'TAKE_CONTROL',
      targetOwner: 'OPPONENT',
      count: 1,
      bonusCondition: { minSpellsInGY: 3 }
    }
    ```
16. **เพิ่ม/ลดค่าพลัง (`MODIFY_STATS`), ฟื้นฟู LP (`GAIN_LP`), ยิงดาเมจ (`INFLICT_DAMAGE`), เก็บการ์ดจากสุสานขึ้นมือ (`RECOVER_FROM_GY_TO_HAND`), โจมตีหลายครั้ง (`GRANT_MULTI_ATTACK`)**

---

## 5. การเขียน Custom Script Hook (`customExecute`) สำหรับการ์ดที่มีเงื่อนไขซับซ้อนพิเศษ

หากการ์ดใบใหม่มีกลไกเฉพาะตัวที่ซับซ้อนเกินกว่า `actions` มาตรฐาน สามารถใส่ฟังก์ชัน `customExecute(engine, ctx)` ลงใน Effect ได้โดยตรง:

```javascript
{
  id: 'custom_special_effect',
  labelTh: 'ใช้เอฟเฟคพิเศษเฉพาะตัว',
  trigger: 'IGNITION',
  spellSpeed: 1,
  zones: ['MMZ'],
  customExecute(engine, { playerIndex, card }) {
    const oppIndex = 1 - playerIndex;
    engine.drawCards(playerIndex, 1, 'EFFECT');
    engine.state.players[oppIndex].lp = Math.max(0, engine.state.players[oppIndex].lp - 1000);
    engine.log(`🔥 "${card.nameTh}" จั่ว 1 ใบและสร้างความเสียหาย 1000 LP!`);
    engine.checkWinCondition();
  }
}
```
