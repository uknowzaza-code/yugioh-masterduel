---
title: Yu-Gi-Oh! Master Duel Web
emoji: 🐉
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---

# 🐉 Yu-Gi-Oh! Master Duel Web Engine (5 Top Decks & Cross-Device Multiplayer)

เกมการ์ด **Yu-Gi-Oh!** บนเว็บที่อ้างอิงกติกาและระบบการใช้เอฟเฟค/เชน (Chain Link) ตาม **Yu-Gi-Oh! Master Duel (Master Rule 5)** พร้อม **5 เด็คยอดนิยมสูงสุด**, ระบบเล่นกับเพื่อนข้ามมือถือและคอมพิวเตอร์, และสถาปัตยกรรมที่ออกแบบมาให้ **AI ตัวอื่นสามารถเพิ่มการ์ดและเด็คใหม่ได้ง่ายที่สุด**

---

## ✨ คุณสมบัติเด่น (Key Features)

1. **กติกาและระบบเอฟเฟคตาม Master Duel จริง (Master Rule 5)**:
   - LP เริ่มต้น 8000, จั่วเริ่มต้น 5 ใบ, โซนมอนสเตอร์หลัก 5 ช่อง (`MMZ`), โซนเวทมนตร์/กับดัก 5 ช่อง (`STZ`), โซนมอนสเตอร์เอ็กซ์ตร้า (`EMZ`), โซนเวทสนาม (`Field`), สุสาน (`GY`), และนอกเกม (`Banished`)
   - ลำดับเฟสครบถ้วน: `DP` -> `SP` -> `MP1` -> `BP` -> `MP2` -> `EP`
   - **ระบบอัญเชิญครบทุกชนิด**: Normal Summon, Tribute Summon (1-2 สังเวย), Inherent Special Summon, **Fusion Summon**, **Synchro Summon (Tuner + Non-Tuner)**, **Xyz Summon (พร้อมระบบซ้อนและถอด Overlay Units)**, และ **Link Summon (Link-1 ถึง Link-4)**
   - **ระบบ Master Duel Chain Window (LIFO) & Hand Traps**: เมื่อผู้เล่นฝ่ายหนึ่งใช้การ์ด หากอีกฝ่ายมีการ์ดความเร็วสูง (Spell Speed 2+) เช่น *Ash Blossom (ฮารุ อุราระ)*, *Infinite Impermanence*, *Called by the Grave*, *Baronne de Fleur*, หรือ *Mirrorjade* ระบบจะเปิดหน้าต่างถามว่าจะ **เชนเอฟเฟคตอบโต้** หรือไม่ พร้อมปุ่มสลับ `Chain: AUTO / ON / OFF`

2. **5 เด็คยอดนิยมสูงสุดพร้อมเล่นทันที (ครบ 40 ใบ + Extra Deck)**:
   - **1. Blue-Eyes Chaos Dragon (บลูอายส์ ไวท์ดราก้อน)** — พลังทำลายล้าง 3000-4500 ATK ผสานฟิวชั่น, ซิงโคร Lv.9 และ Xyz Rank 8
   - **2. Dark Magician Spellcaster Control (แบล็คเมจิกเชี่ยน)** — คอมโบ *Dark Magical Circle* + *Eternal Soul* ชุบชีวิตและมูฟการ์ดอีกฝ่าย
   - **3. Sky Striker Ace (สกายสไตรเกอร์ เอซ)** — เมต้าสายคอนโทรล สลับเกราะ Link-1 (*Kagari*, *Shizuku*, *Hayate*) และสะสมเวทในสุสาน 3+ ใบ
   - **4. Swordsoul Tenyi (ซอร์ดโซล เทนยี่)** — เมต้าสายซิงโคร เสก *Swordsoul Token* (จูนเนอร์ Lv.4) เรียก *Chixiao* และ *Baronne de Fleur*
   - **5. Branded Despia (แบรนเด็ด เดสเปีย)** — เมต้าสายฟิวชั่นจากเด็คด้วย *Branded Fusion* เรียก *Mirrorjade the Iceblade Dragon*

3. **เล่นกับเพื่อนผ่านโทรศัพท์มือถือหรือคอมพิวเตอร์เครื่องอื่นได้ทันที**:
   - **โหมด Wi-Fi / LAN เดียวกัน (WebSocket Room)**: หน้าเว็บแสดงลิงก์ IP ของเครื่องและ **QR Code** ให้เพื่อนใช้กล้องมือถือสแกนเข้าห้องได้ในคลิกเดียว
   - **โหมดออนไลน์ข้ามเครือข่าย (4G/5G WebRTC P2P)**: สร้างรหัสห้อง 4 หลักเพื่อดวลกับเพื่อนที่อยู่คนละบ้านหรือใช้เน็ตมือถือคนละวงได้โดยไม่ต้องตั้งค่า Port Forwarding
   - **โหมดดวลกับบอท AI (Solo Mode)** และ **โหมดทดสอบ 2 ฝั่งในจอเดียว (Sandbox Mode)**

4. **โครงสร้างสำหรับให้ AI ตัวอื่นเพิ่มการ์ดใหม่ (`AI_CARD_DEVELOPMENT_GUIDE.md` & AI Card Studio)**:
   - มีคู่มือ [`AI_CARD_DEVELOPMENT_GUIDE.md`](./AI_CARD_DEVELOPMENT_GUIDE.md) อธิบาย Schema และ Atomic Actions ทั้งหมดสำหรับสั่งให้ AI ตัวอื่นเขียนการ์ดเพิ่ม
   - มีหน้าต่าง **🤖 AI Card Studio** ในตัวเกมสำหรับวาง JSON การ์ด ตรวจสอบความถูกต้อง และบันทึกเข้าเกมได้ทันที

---

## 🚀 วิธีรันเกม

```powershell
# 1. เข้าไปยังโฟลเดอร์โปรเจกต์
cd C:\Users\uknow\.gemini\antigravity\scratch\yugioh-masterduel

# 2. รันเซิร์ฟเวอร์เกมและระบบห้องออนไลน์
npm start
```

จากนั้นเปิดเบราว์เซอร์ไปที่ **`http://localhost:3000`** (หรือสแกน QR Code บนหน้าจอด้วยโทรศัพท์มือถือในวง Wi-Fi เดียวกัน)
