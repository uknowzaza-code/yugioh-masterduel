/**
 * @fileoverview Yu-Gi-Oh! Master Duel Web & Multiplayer Server
 * - ให้บริการหน้าเว็บ (`public/`) และโมดูลเกม (`src/`) แบบ ES Modules โดยตรง (ไม่ต้องรัน Bundler ซ้ำเมื่อ AI เพิ่มการ์ด)
 * - ระบบห้องเล่นหลายคนแบบ Real-Time WebSocket (เล่นกับเพื่อนผ่านมือถือ/คอมพิวเตอร์เครื่องอื่นใน Wi-Fi/LAN หรือ Cloud)
 * - API `/api/custom-cards` สำหรับบันทึกและตรวจสอบการ์ดที่เพิ่มจาก AI Card Studio ลงไฟล์ `src/cards/custom_cards.json`
 * - API `/api/network-info` แสดง IP Address ในวงแลนเพื่อให้มือถือสแกนหรือพิมพ์เข้าเล่นได้ทันที
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { getSharedOcgCore, YGOProEngine } from './src/engine/YGOProEngine.js';
import { RpsSession } from './src/engine/RpsSession.js';
import { MqttWssClient } from './src/engine/CloudRelay.js';
import { getUiCardMeta } from './src/engine/OcgCardDb.js';
import {
  registerCustomCards,
  registerRuntimeCards,
  registerCustomDecks,
  getCardById,
  getAllCards,
  PRESET_DECKS,
  getPresetDeckById,
  expandDeckRecipe
} from './src/cards/index.js';
import { validateCardSchema } from './src/cards/schema.js';
import { parseYdkeUrl } from './src/cards/ydke.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const CUSTOM_CARDS_FILE = path.join(__dirname, 'src', 'cards', 'custom_cards.json');
const CUSTOM_DECKS_FILE = path.join(__dirname, 'src', 'cards', 'custom_decks.json');

// Load persisted custom cards on startup
function loadPersistedCustomCards() {
  if (!fs.existsSync(CUSTOM_CARDS_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(CUSTOM_CARDS_FILE, 'utf8'));
    if (Array.isArray(raw)) {
      registerCustomCards(raw);
      return raw;
    }
  } catch (err) {
    console.error('Failed to load custom_cards.json:', err.message);
  }
  return [];
}

function loadPersistedCustomDecks() {
  if (!fs.existsSync(CUSTOM_DECKS_FILE)) return { decks: [], cards: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(CUSTOM_DECKS_FILE, 'utf8'));
    const decks = Array.isArray(raw?.decks) ? raw.decks : (Array.isArray(raw) ? raw : []);
    const cards = Array.isArray(raw?.cards) ? raw.cards : [];
    if (cards.length > 0) registerRuntimeCards(cards);
    if (decks.length > 0) registerCustomDecks(decks);
    return { decks, cards };
  } catch (err) {
    console.error('Failed to load custom_decks.json:', err.message);
  }
  return { decks: [], cards: [] };
}

function savePersistedCustomDecks(decks, cards) {
  fs.writeFileSync(CUSTOM_DECKS_FILE, JSON.stringify({ decks, cards }, null, 2), 'utf8');
}

loadPersistedCustomCards();
loadPersistedCustomDecks();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

/**
 * ดึงรายการ IPv4 ของเครื่องโฮสต์ในวงแลน (Wi-Fi / Ethernet) โดยเรียงลำดับการ์ดแลนจริงไว้ก่อน
 */
function classifyInterfacePriority(name = '', address = '') {
  const lower = String(name).toLowerCase();
  if (/vethernet|wsl|hyper-v|virtualbox|vmware|docker|br-|tun|tap|tailscale|zerotier|loopback/.test(lower)) {
    return 4;
  }
  if (address.startsWith('192.168.137.') || /local area connection\*/.test(lower)) {
    return 1; // Windows Mobile Hotspot
  }
  if (/wi-fi|wifi|wlan|wireless|en0|eth|ethernet/.test(lower)) {
    return 0;
  }
  return 2;
}

function getLocalNetworkIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const [name, netList] of Object.entries(interfaces)) {
    for (const net of netList || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        ips.push({
          interface: name,
          address: net.address,
          url: `http://${net.address}:${PORT}`,
          priority: classifyInterfacePriority(name, net.address)
        });
      }
    }
  }
  ips.sort((a, b) => a.priority - b.priority);
  return ips.map(({ interface: iface, address, url }) => ({ interface: iface, address, url }));
}

/**
 * อ่าน JSON Body จาก HTTP Request
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// In-memory multiplayer rooms
// Map<roomCode, { code, hostWs, guestWs, hostInfo, guestInfo, engine, status, createdAt }>
const rooms = new Map();
const soloDuels = new Map();
const translationCache = new Map();

async function createYgoProEngineForDecks({
  p0Name,
  p0DeckId,
  p1Name,
  p1DeckId,
  isSoloVsAi = false,
  humanStartsFirst = true
}) {
  const core = await getSharedOcgCore();
  const d0 = getPresetDeckById(p0DeckId) || PRESET_DECKS[0];
  const d1 = getPresetDeckById(p1DeckId) || PRESET_DECKS[1] || PRESET_DECKS[0];
  const humanCards = [...expandDeckRecipe(d0.mainDeckRecipe || []), ...expandDeckRecipe(d0.extraDeckRecipe || [])];
  const oppCards = [...expandDeckRecipe(d1.mainDeckRecipe || []), ...expandDeckRecipe(d1.extraDeckRecipe || [])];

  if (isSoloVsAi && !humanStartsFirst) {
    return new YGOProEngine({
      core,
      player1Name: p1Name || 'YGOPro AI',
      player2Name: p0Name || 'Player 1',
      deck1Cards: oppCards,
      deck2Cards: humanCards,
      isSoloVsAi: true,
      aiIndex: 0
    });
  }

  return new YGOProEngine({
    core,
    player1Name: p0Name || 'Player 1',
    player2Name: p1Name || (isSoloVsAi ? 'YGOPro AI' : 'Player 2'),
    deck1Cards: humanCards,
    deck2Cards: oppCards,
    isSoloVsAi,
    aiIndex: 1
  });
}

function generateRoomCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function generateReconnectToken() {
  return crypto.randomBytes(12).toString('hex');
}

function resolveDistinctPlayerNames(hostName, guestName) {
  const cleanHost = String(hostName || '').trim() || 'Duelist 1';
  let cleanGuest = String(guestName || '').trim() || 'Duelist 2';
  if (cleanGuest.toLowerCase() === cleanHost.toLowerCase()) {
    cleanGuest = cleanGuest === 'Duelist 1' ? 'Duelist 2' : `${cleanGuest} (P2)`;
  }
  return { hostName: cleanHost, guestName: cleanGuest };
}

const DEFAULT_STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

async function getConfiguredIceServers() {
  const iceServers = [...DEFAULT_STUN_SERVERS];
  let hasTurn = false;

  if (process.env.METERED_APP_NAME && process.env.METERED_API_KEY) {
    try {
      const url = `https://${encodeURIComponent(process.env.METERED_APP_NAME)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(process.env.METERED_API_KEY)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const upstream = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (upstream.ok) {
        const dynamicServers = await upstream.json();
        if (Array.isArray(dynamicServers) && dynamicServers.length > 0) {
          for (const srv of dynamicServers) {
            if (srv?.urls) {
              iceServers.push(srv);
              if (String(srv.urls).includes('turn')) hasTurn = true;
            }
          }
        }
      }
    } catch {
      // Fallback gracefully to STUN / explicit TURN env config
    }
  }

  if (process.env.TURN_URLS) {
    const urls = process.env.TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) {
      const turnEntry = { urls };
      if (process.env.TURN_USERNAME) turnEntry.username = process.env.TURN_USERNAME;
      if (process.env.TURN_CREDENTIAL) turnEntry.credential = process.env.TURN_CREDENTIAL;
      iceServers.push(turnEntry);
      hasTurn = true;
    }
  }

  return { iceServers, hasTurn };
}

function getPublicRoomList() {
  const list = [];
  for (const room of rooms.values()) {
    if (room.status === 'WAITING' && room.hostWs?.readyState === 1) {
      list.push({
        code: room.code,
        hostName: room.hostInfo?.name || 'ผู้เล่นโฮสต์',
        hostDeckId: room.hostInfo?.deckId || 'blue_eyes_meta',
        createdAt: room.createdAt
      });
    }
  }
  return list;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // API: Google Translate proxy for Thai card text (with in-memory cache)
  if (pathname === '/api/translate' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      const target = typeof payload.target === 'string' ? payload.target : 'th';
      if (!text) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, translatedText: '' }));
        return;
      }

      const cacheKey = `${target}::${text}`;
      if (translationCache.has(cacheKey)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, translatedText: translationCache.get(cacheKey), cached: true }));
        return;
      }

      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
      const upstream = await fetch(url);
      if (!upstream.ok) {
        throw new Error(`Translate HTTP ${upstream.status}`);
      }
      const data = await upstream.json();
      const translatedText = Array.isArray(data?.[0])
        ? data[0].map(seg => (Array.isArray(seg) ? seg[0] : '')).join('')
        : text;

      translationCache.set(cacheKey, translatedText);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, translatedText }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // API: Network Info & Open Rooms
  if (pathname === '/api/network-info' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      port: PORT,
      ips: getLocalNetworkIPs(),
      openRooms: getPublicRoomList(),
      totalCardsCount: getAllCards().length,
      decksCount: PRESET_DECKS.length
    }));
    return;
  }

  // API: WebRTC STUN / TURN ICE Servers for Cross-Network P2P
  if (pathname === '/api/ice-servers' && req.method === 'GET') {
    const icePayload = await getConfiguredIceServers();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, ...icePayload }));
    return;
  }

  // API: Get Custom Cards
  if (pathname === '/api/custom-cards' && req.method === 'GET') {
    const customCards = loadPersistedCustomCards();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ customCards }));
    return;
  }

  // API: Add / Save Custom Card(s) (Used by AI Card Studio & External AI scripts)
  if (pathname === '/api/custom-cards' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const incoming = Array.isArray(payload.cards) ? payload.cards : (payload.card ? [payload.card] : []);
      if (incoming.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, errors: ['กรุณาส่งข้อมูลการ์ดในรูปแบบ Object หรือ Array'] }));
        return;
      }

      const allErrors = [];
      for (const c of incoming) {
        const check = validateCardSchema(c);
        if (!check.valid) {
          allErrors.push(...check.errors);
        }
      }

      if (allErrors.length > 0) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, errors: allErrors }));
        return;
      }

      const existing = loadPersistedCustomCards();
      const mapById = new Map(existing.map(c => [c.id, c]));
      for (const c of incoming) {
        mapById.set(c.id, c);
      }
      const merged = Array.from(mapById.values());
      fs.writeFileSync(CUSTOM_CARDS_FILE, JSON.stringify(merged, null, 2), 'utf8');
      registerCustomCards(merged);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        addedCount: incoming.length,
        totalCustomCards: merged.length,
        customCards: merged
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, errors: [err.message] }));
    }
    return;
  }

  // API: Get Custom YDK Decks
  if (pathname === '/api/custom-decks' && req.method === 'GET') {
    const { decks, cards } = loadPersistedCustomDecks();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ customDecks: decks, customCards: cards }));
    return;
  }

  // API: Delete Custom YDK Deck
  if (pathname === '/api/custom-decks' && req.method === 'DELETE') {
    const deckId = parsedUrl.searchParams.get('id');
    const { decks, cards } = loadPersistedCustomDecks();
    const filtered = decks.filter(d => d.id !== deckId);
    savePersistedCustomDecks(filtered, cards);
    registerCustomDecks(filtered, { replace: true });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, customDecks: filtered }));
    return;
  }

  // API: Import Deck from YDK Clipboard/File
  if (pathname === '/api/custom-decks/import-ydk' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const ydkText = String(payload.ydkText || '').trim();
      if (!ydkText) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'กรุณาวางโค้ด YDK ก่อนนำเข้า' }));
        return;
      }

      let section = 'main';
      let hasExplicitSection = false;
      const mainCodes = [];
      const extraCodes = [];
      let sideIgnoredCount = 0;
      let createdByHint = '';
      let isYdkeFormat = false;

      const ydkeParsed = parseYdkeUrl(ydkText);
      if (ydkeParsed.isYdke) {
        isYdkeFormat = true;
        hasExplicitSection = true;
        mainCodes.push(...ydkeParsed.mainCodes);
        extraCodes.push(...ydkeParsed.extraCodes);
        sideIgnoredCount = ydkeParsed.sideCodes.length;
      } else {
        for (const rawLine of ydkText.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          const lower = line.toLowerCase();
          if (lower.startsWith('#main')) {
            section = 'main';
            hasExplicitSection = true;
            continue;
          }
          if (lower.startsWith('#extra')) {
            section = 'extra';
            hasExplicitSection = true;
            continue;
          }
          if (lower.startsWith('!side') || lower.startsWith('#side')) {
            section = 'side';
            hasExplicitSection = true;
            continue;
          }
          if (line.startsWith('#') || line.startsWith('!')) {
            if (lower.startsWith('#created by')) {
              createdByHint = line.slice('#created by'.length).trim();
            }
            continue;
          }
          const match = line.match(/^(\d{1,10})/);
          if (!match) continue;
          const code = Number(match[1]);
          if (!code || Number.isNaN(code)) continue;
          if (section === 'main') mainCodes.push(code);
          else if (section === 'extra') extraCodes.push(code);
          else sideIgnoredCount++;
        }
      }

      if (mainCodes.length === 0 && extraCodes.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'ไม่พบรหัสการ์ด (Passcode) ที่ถูกต้องในข้อความ YDK / YDKE' }));
        return;
      }

      const resolvedNewCards = new Map();
      const missingPasscodes = [];
      const finalMainCodes = [];
      const finalExtraCodes = [...extraCodes];

      const resolveCode = (code) => {
        let card = getCardById(String(code));
        if (!card) {
          const meta = getUiCardMeta(code);
          if (meta) {
            card = meta;
            resolvedNewCards.set(meta.id, meta);
          } else {
            missingPasscodes.push(String(code));
          }
        }
        return card;
      };

      for (const code of mainCodes) {
        const card = resolveCode(code);
        const isExtraMonster = Boolean(card?.isExtraDeck || ['FUSION', 'SYNCHRO', 'XYZ', 'LINK'].includes(card?.frame));
        if (!hasExplicitSection && isExtraMonster) {
          finalExtraCodes.push(code);
        } else {
          finalMainCodes.push(code);
        }
      }
      for (const code of extraCodes) {
        resolveCode(code);
      }

      const toRecipe = (codes) => {
        const counts = new Map();
        const order = [];
        for (const code of codes) {
          const card = getCardById(String(code)) || resolvedNewCards.get(`cdb_${code}`);
          const cardId = card?.id || `cdb_${code}`;
          if (!counts.has(cardId)) {
            counts.set(cardId, 0);
            order.push(cardId);
          }
          counts.set(cardId, counts.get(cardId) + 1);
        }
        return order.map(id => ({ id, count: Math.min(3, counts.get(id)) }));
      };

      const mainDeckRecipe = toRecipe(finalMainCodes);
      const extraDeckRecipe = toRecipe(finalExtraCodes);

      const newCardsList = Array.from(resolvedNewCards.values());
      if (newCardsList.length > 0) {
        registerRuntimeCards(newCardsList);
      }

      const firstCoverId = extraDeckRecipe[0]?.id || mainDeckRecipe[0]?.id || 'blue_eyes_white_dragon';
      const firstCard = getCardById(firstCoverId);
      const rawName = String(payload.name || '').trim();
      const formatTag = isYdkeFormat ? 'YDKE' : 'YDK';
      const deckName = rawName || (firstCard ? `${firstCard.name} (${formatTag})` : `${formatTag} Deck (${finalMainCodes.length}+${finalExtraCodes.length})`);
      const deckId = `ydk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

      const detectedStyles = new Set();
      for (const r of extraDeckRecipe) {
        const c = getCardById(r.id);
        if (c?.frame && ['FUSION', 'SYNCHRO', 'XYZ', 'LINK'].includes(c.frame)) {
          detectedStyles.add(c.frame);
        }
      }
      if (detectedStyles.size === 0) detectedStyles.add('CONTROL');

      const deck = {
        id: deckId,
        name: deckName,
        nameTh: `📋 ${deckName}`,
        mdmRank: 0,
        mdmTier: 'YDK',
        styles: Array.from(detectedStyles),
        badge: 'YDK IMPORT',
        themeColor: '#38bdf8',
        coverCardId: firstCoverId,
        difficulty: `📋 Custom YDK (Main ${finalMainCodes.length} / Extra ${finalExtraCodes.length})`,
        summary: `Imported from YDK clipboard${createdByHint ? ` (${createdByHint})` : ''}. Main Deck: ${finalMainCodes.length} cards, Extra Deck: ${finalExtraCodes.length} cards.`,
        summaryTh: `นำเข้าจาก YDK Clipboard${createdByHint ? ` (${createdByHint})` : ''} • Main ${finalMainCodes.length} ใบ / Extra ${finalExtraCodes.length} ใบ`,
        comboGuide: [
          `Main Deck: ${finalMainCodes.length} cards • Extra Deck: ${finalExtraCodes.length} cards.`,
          'Click "Inspect Deck" to review all imported cards or "Copy YDK" to export anytime.'
        ],
        comboGuideTh: [
          `Main Deck: ${finalMainCodes.length} ใบ • Extra Deck: ${finalExtraCodes.length} ใบ`,
          'กด "ดูลิสต์การ์ดทั้งหมด" เพื่อเช็กการ์ดในเด็ค หรือกด "Copy YDK" เพื่อคัดลอกกลับเป็น YDK ได้ตลอดเวลา'
        ],
        mainDeckRecipe,
        extraDeckRecipe,
        isCustomYdk: true
      };

      const persisted = loadPersistedCustomDecks();
      const mergedCardMap = new Map(persisted.cards.map(c => [c.id, c]));
      for (const c of newCardsList) mergedCardMap.set(c.id, c);
      const updatedDecks = [deck, ...persisted.decks];
      const updatedCards = Array.from(mergedCardMap.values());
      savePersistedCustomDecks(updatedDecks, updatedCards);
      registerCustomDecks(updatedDecks);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        deck,
        cards: updatedCards,
        customDecks: updatedDecks,
        stats: {
          mainCount: finalMainCodes.length,
          extraCount: finalExtraCodes.length,
          sideIgnoredCount,
          missingPasscodes
        }
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // Serve shared ES Modules under `/src/*`
  let filePath = null;
  if (pathname.startsWith('/src/')) {
    const safeRel = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    filePath = path.join(__dirname, safeRel);
  } else {
    const rel = pathname === '/' ? '/index.html' : pathname;
    const safeRel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
    filePath = path.join(__dirname, 'public', safeRel);
  }

  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, must-revalidate'
  });
  fs.createReadStream(filePath).pipe(res);
});

// WebSocket Server for Real-Time Multiplayer Rooms
const wss = new WebSocketServer({ server });

function sendJson(ws, data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastRoomList() {
  const openRooms = getPublicRoomList();
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      sendJson(client, { type: 'ROOM_LIST_UPDATE', openRooms });
    }
  }
}

function broadcastRpsState(room, { reconnectTokens = false, opponentNames = false, rematch = false } = {}) {
  if (!room || !room.rps) return;
  const seats = [
    {
      seat: 0,
      ws: room.hostWs,
      token: room.hostToken,
      oppName: room.guestInfo?.name || 'Duelist 2',
      oppDeck: room.guestInfo?.customDeck || null,
      oppCards: room.guestInfo?.customCards || []
    },
    {
      seat: 1,
      ws: room.guestWs,
      token: room.guestToken,
      oppName: room.hostInfo?.name || 'Duelist 1',
      oppDeck: room.hostInfo?.customDeck || null,
      oppCards: room.hostInfo?.customCards || []
    }
  ];
  for (const s of seats) {
    if (!s.ws || s.ws.readyState !== 1) continue;
    const payload = {
      type: 'RPS_STATE',
      roomCode: room.code,
      seat: s.seat,
      rematch: Boolean(rematch),
      rpsState: room.rps.getPublicStateForSeat(s.seat)
    };
    if (reconnectTokens) payload.reconnectToken = s.token;
    if (opponentNames) {
      payload.opponentName = s.oppName;
      if (s.oppDeck) payload.opponentCustomDeck = s.oppDeck;
      if (Array.isArray(s.oppCards) && s.oppCards.length > 0) payload.opponentCustomCards = s.oppCards;
    }
    sendJson(s.ws, payload);
  }
}

async function startWsRoomDuelFromRps(room, firstSeat, { rematch = false } = {}) {
  const firstIdx = firstSeat === 1 ? 1 : 0;
  room.seatToEngineIndex = firstIdx === 0 ? [0, 1] : [1, 0];
  if (room.hostWs) room.hostWs.playerIndex = room.seatToEngineIndex[0];
  if (room.guestWs) room.guestWs.playerIndex = room.seatToEngineIndex[1];

  const firstInfo = firstIdx === 0 ? room.hostInfo : room.guestInfo;
  const secondInfo = firstIdx === 0 ? room.guestInfo : room.hostInfo;
  if (room.engine) room.engine.destroy();
  room.engine = await createYgoProEngineForDecks({
    p0Name: firstInfo?.name || 'Duelist 1',
    p0DeckId: firstInfo?.deckId || 'blue_eyes_meta',
    p1Name: secondInfo?.name || 'Duelist 2',
    p1DeckId: secondInfo?.deckId || 'swordsoul_tenyi',
    isSoloVsAi: false
  });
  room.status = 'PLAYING';
  room.isRematch = false;

  const rpsSummary = room.rps
    ? { winnerSeat: room.rps.winnerSeat, chosenOrder: room.rps.chosenOrder, firstSeat: idxOrZero(firstIdx) }
    : null;
  function idxOrZero(v) { return v === 1 ? 1 : 0; }

  sendJson(room.hostWs, {
    type: 'MATCH_STARTED',
    roomCode: room.code,
    playerIndex: room.seatToEngineIndex[0],
    reconnectToken: room.hostToken,
    opponentName: room.guestInfo?.name || 'Duelist 2',
    rematch: Boolean(rematch),
    rpsSummary
  });
  sendJson(room.guestWs, {
    type: 'MATCH_STARTED',
    roomCode: room.code,
    playerIndex: room.seatToEngineIndex[1],
    reconnectToken: room.guestToken,
    opponentName: room.hostInfo?.name || 'Duelist 1',
    rematch: Boolean(rematch),
    rpsSummary
  });

  broadcastRoomState(room, { rematch: Boolean(rematch) });
  broadcastRoomList();
}

function broadcastRoomState(room, extra = {}) {
  if (!room || !room.engine) return;
  const hostEngineIdx = room.seatToEngineIndex?.[0] ?? 0;
  const guestEngineIdx = room.seatToEngineIndex?.[1] ?? 1;
  const basePayload = {
    type: 'DUEL_STATE_SYNC',
    roomCode: room.code,
    state: room.engine.state,
    ...extra
  };
  if (room.hostWs) {
    sendJson(room.hostWs, {
      ...basePayload,
      playerIndex: hostEngineIdx,
      legalActions: room.engine.getLegalActions(hostEngineIdx)
    });
  }
  if (room.guestWs) {
    sendJson(room.guestWs, {
      ...basePayload,
      playerIndex: guestEngineIdx,
      legalActions: room.engine.getLegalActions(guestEngineIdx)
    });
  }
}

function closeSocketCloudGuestBridge(ws, { notifyHost = false, intentional = false } = {}) {
  if (!ws || !ws.cloudGuestBridge) return;
  const bridge = ws.cloudGuestBridge;
  ws.cloudGuestBridge = null;
  bridge.close({ notifyHost, intentional });
}

async function attachHostCloudRelay(room) {
  if (!room || process.env.ENABLE_CLOUD_RELAY === '0') return;
  const code = room.code;
  const client = new MqttWssClient({
    WebSocketClass: WebSocket,
    clientIdPrefix: `ygo_ws1_host_${code}`
  });
  room.cloudRelay = client;
  try {
    await client.connect();
    if (!rooms.has(code) || room.cloudRelay !== client) {
      client.close();
      return;
    }
    const toHostTopic = `ygo_md_ws1_v1/${code}/to_host`;
    const toGuestTopic = `ygo_md_ws1_v1/${code}/to_guest`;

    const virtualGuestWs = {
      readyState: 1,
      isCloudRelayVirtual: true,
      activeBridgeId: null,
      roomCode: null,
      roomSeat: null,
      playerIndex: null,
      intentionalLeave: false,
      send(rawStr) {
        if (client.closed || (!client.connected && !client._reconnecting)) return;
        try {
          const parsed = JSON.parse(rawStr);
          if (virtualGuestWs.activeBridgeId) {
            parsed.__targetBridgeId = virtualGuestWs.activeBridgeId;
          }
          client.publishChunkedJson(toGuestTopic, parsed);
        } catch {
          // ignore serialization errors
        }
      }
    };
    room.virtualGuestWs = virtualGuestWs;

    client.onDisconnect = () => {
      if (!rooms.has(code) || room.cloudRelay !== client) return;
      if (room.guestWs === virtualGuestWs) {
        virtualGuestWs.readyState = 3;
        detachSocketFromRoom(virtualGuestWs, { intentional: false });
      }
    };

    await client.subscribe(toHostTopic, async (packet) => {
      if (!rooms.has(code) || room.cloudRelay !== client || !packet) return;
      const incomingBridgeId = packet.bridgeId || null;

      if (packet.__ygoRelayDisconnect) {
        if (
          virtualGuestWs.activeBridgeId &&
          incomingBridgeId &&
          incomingBridgeId !== virtualGuestWs.activeBridgeId
        ) {
          return;
        }
        virtualGuestWs.activeBridgeId = null;
        virtualGuestWs.readyState = 3;
        detachSocketFromRoom(virtualGuestWs, { intentional: Boolean(packet.intentional) });
        return;
      }

      if (packet.clientMsg && typeof packet.clientMsg === 'object') {
        const cMsg = packet.clientMsg;
        if (cMsg.type === 'JOIN_ROOM') {
          if (room.status === 'WAITING' && (!room.guestWs || room.guestWs.readyState !== 1)) {
            virtualGuestWs.activeBridgeId = incomingBridgeId;
            virtualGuestWs.readyState = 1;
            await handleClientMessage(virtualGuestWs, cMsg);
            return;
          }
          if (
            room.guestWs === virtualGuestWs &&
            incomingBridgeId &&
            virtualGuestWs.activeBridgeId === incomingBridgeId &&
            room.status === 'RPS'
          ) {
            broadcastRpsState(room, { reconnectTokens: true, opponentNames: true });
            return;
          }
          client.publishChunkedJson(toGuestTopic, {
            __targetBridgeId: incomingBridgeId,
            type: 'ROOM_ERROR',
            errorTh: `ห้อง "${code}" มีผู้เล่นครบแล้ว`
          });
          return;
        }

        if (cMsg.type === 'REJOIN_ROOM') {
          const token = String(cMsg.reconnectToken || '').trim();
          if (token && token === room.guestToken) {
            virtualGuestWs.activeBridgeId = incomingBridgeId;
            virtualGuestWs.readyState = 1;
            await handleClientMessage(virtualGuestWs, cMsg);
          } else {
            client.publishChunkedJson(toGuestTopic, {
              __targetBridgeId: incomingBridgeId,
              type: 'REJOIN_FAILED',
              errorTh: 'โทเค็นเชื่อมต่อห้องเดิมไม่ถูกต้อง'
            });
          }
          return;
        }

        if (
          virtualGuestWs.activeBridgeId &&
          incomingBridgeId &&
          incomingBridgeId !== virtualGuestWs.activeBridgeId
        ) {
          return;
        }
        virtualGuestWs.readyState = 1;
        await handleClientMessage(virtualGuestWs, cMsg);
      }
    });
  } catch {
    if (room.cloudRelay === client) {
      room.cloudRelay = null;
    }
    client.close();
  }
}

async function connectSocketToRemoteCloudRoom(ws, code, initialMsg) {
  closeSocketCloudGuestBridge(ws, { notifyHost: true, intentional: true });
  ws.intentionalLeave = false;
  const bridgeId = crypto.randomBytes(8).toString('hex');
  const client = new MqttWssClient({
    WebSocketClass: WebSocket,
    clientIdPrefix: `ygo_ws1_guest_${code}`
  });
  const toHostTopic = `ygo_md_ws1_v1/${code}/to_host`;
  const toGuestTopic = `ygo_md_ws1_v1/${code}/to_guest`;
  let closed = false;
  let receivedHostReply = false;
  let initialRetryInterval = null;

  const stopInitialRetry = () => {
    if (initialRetryInterval) {
      clearInterval(initialRetryInterval);
      initialRetryInterval = null;
    }
  };

  const firstResponseTimer = setTimeout(() => {
    if (closed || receivedHostReply) return;
    closeSocketCloudGuestBridge(ws, { notifyHost: false });
    if (initialMsg.type === 'REJOIN_ROOM') {
      sendJson(ws, { type: 'REJOIN_FAILED', errorTh: `ไม่พบห้องเดิม "${code}" แล้ว` });
    } else {
      sendJson(ws, { type: 'ROOM_ERROR', errorTh: `ไม่พบห้องรหัส "${code}"` });
    }
  }, 4500);

  const bridge = {
    code,
    bridgeId,
    client,
    sendToHost(clientMsg) {
      if (closed || client.closed || (!client.connected && !client._reconnecting)) return;
      client.publishChunkedJson(toHostTopic, { bridgeId, clientMsg });
    },
    close({ notifyHost = false, intentional = false } = {}) {
      if (closed) return;
      closed = true;
      stopInitialRetry();
      clearTimeout(firstResponseTimer);
      if (notifyHost && (client.connected || client._reconnecting)) {
        try {
          client.publishChunkedJson(toHostTopic, {
            bridgeId,
            __ygoRelayDisconnect: true,
            intentional
          });
        } catch {
          // ignore
        }
        const t = setTimeout(() => client.close(), 120);
        if (typeof t?.unref === 'function') t.unref();
      } else {
        client.close();
      }
    }
  };
  ws.cloudGuestBridge = bridge;

  client.onDisconnect = () => {
    if (closed || ws.cloudGuestBridge !== bridge) return;
    closeSocketCloudGuestBridge(ws, { notifyHost: false });
    sendJson(ws, {
      type: 'ROOM_ERROR',
      errorTh: 'การเชื่อมต่อ Cloud Relay ขาดหาย กรุณาลองใหม่อีกครั้ง'
    });
  };

  try {
    await client.connect();
    if (closed || ws.cloudGuestBridge !== bridge) {
      client.close();
      return;
    }
    await client.subscribe(toGuestTopic, (hostMsg) => {
      if (closed || ws.cloudGuestBridge !== bridge || !hostMsg) return;
      if (hostMsg.__targetBridgeId && hostMsg.__targetBridgeId !== bridgeId) {
        return;
      }
      const cleanMsg = { ...hostMsg };
      delete cleanMsg.__targetBridgeId;
      const hadFirstReply = receivedHostReply;
      receivedHostReply = true;
      stopInitialRetry();
      clearTimeout(firstResponseTimer);
      sendJson(ws, cleanMsg);
      if (
        cleanMsg.type === 'REJOIN_FAILED' ||
        cleanMsg.type === 'OPPONENT_DISCONNECTED' ||
        (!hadFirstReply && cleanMsg.type === 'ROOM_ERROR')
      ) {
        closeSocketCloudGuestBridge(ws, { notifyHost: false });
      }
    });
    bridge.sendToHost(initialMsg);
    initialRetryInterval = setInterval(() => {
      if (!closed && !receivedHostReply && (client.connected || client._reconnecting)) {
        bridge.sendToHost(initialMsg);
      } else {
        stopInitialRetry();
      }
    }, 900);
  } catch {
    if (!closed && ws.cloudGuestBridge === bridge) {
      closeSocketCloudGuestBridge(ws, { notifyHost: false });
      if (initialMsg.type === 'REJOIN_ROOM') {
        sendJson(ws, { type: 'REJOIN_FAILED', errorTh: `ไม่พบห้องเดิม "${code}" แล้ว` });
      } else {
        sendJson(ws, { type: 'ROOM_ERROR', errorTh: `ไม่พบห้องรหัส "${code}"` });
      }
    }
  }
}

function cleanupRoom(room, reasonMessage = 'ผู้เล่นอีกฝ่ายตัดการเชื่อมต่อออกจากห้อง') {
  if (!room) return;
  if (room.disconnectTimers) {
    for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
    room.disconnectTimers.clear();
  }
  if (room.engine) {
    room.engine.destroy();
    room.engine = null;
  }
  room.rps = null;
  const peers = [room.hostWs, room.guestWs];
  for (const peerWs of peers) {
    if (peerWs) {
      if (peerWs.roomCode === room.code) {
        peerWs.roomCode = null;
        peerWs.roomSeat = null;
        peerWs.playerIndex = null;
      }
      if (peerWs.readyState === 1 && reasonMessage) {
        sendJson(peerWs, {
          type: 'OPPONENT_DISCONNECTED',
          messageTh: reasonMessage
        });
      }
    }
  }
  if (room.cloudRelay) {
    const relay = room.cloudRelay;
    room.cloudRelay = null;
    setTimeout(() => relay.close(), 150);
  }
  rooms.delete(room.code);
  broadcastRoomList();
}

function detachSocketFromRoom(ws, { intentional = false } = {}) {
  if (!ws.roomCode) return;
  const room = rooms.get(ws.roomCode);
  const code = ws.roomCode;
  const seat = ws.roomSeat ?? ws.playerIndex;
  ws.roomCode = null;
  ws.roomSeat = null;
  ws.playerIndex = null;
  if (!room) return;

  if (intentional || room.status === 'WAITING') {
    if (seat === 0) room.hostWs = null;
    if (seat === 1) room.guestWs = null;
    cleanupRoom(room, intentional ? 'ผู้เล่นอีกฝ่ายออกจากห้องดวล' : 'ผู้เล่นอีกฝ่ายตัดการเชื่อมต่อออกจากห้อง');
    return;
  }

  // Active RPS / PLAYING phase: keep room alive for 60s grace window so mobile/Wi-Fi drops can auto-rejoin
  if (seat === 0) room.hostWs = null;
  if (seat === 1) room.guestWs = null;
  const otherWs = seat === 0 ? room.guestWs : room.hostWs;
  if (otherWs && otherWs.readyState === 1) {
    sendJson(otherWs, {
      type: 'OPPONENT_RECONNECTING',
      graceSeconds: 60,
      messageTh: 'สัญญาณของอีกฝ่ายขาดหาย กำลังรอการเชื่อมต่อใหม่ภายใน 60 วินาที...'
    });
  }
  if (!room.disconnectTimers) room.disconnectTimers = new Map();
  if (room.disconnectTimers.has(seat)) clearTimeout(room.disconnectTimers.get(seat));
  room.disconnectTimers.set(seat, setTimeout(() => {
    room.disconnectTimers.delete(seat);
    const current = rooms.get(code);
    if (!current) return;
    const targetMissing = seat === 0 ? !current.hostWs : !current.guestWs;
    if (targetMissing) {
      cleanupRoom(current, 'ผู้เล่นอีกฝ่ายตัดการเชื่อมต่อเกินเวลาที่กำหนด');
    }
  }, 60000));
}

const wsHeartbeat = setInterval(() => {
  for (const client of wss.clients) {
    client.missedPongs = (client.missedPongs || 0) + 1;
    if (client.missedPongs >= 3) {
      client.terminate();
      continue;
    }
    try {
      client.ping();
    } catch {
      client.terminate();
    }
  }
}, 20000);
wsHeartbeat.unref();

wss.on('connection', (ws) => {
  ws.missedPongs = 0;
  ws.roomCode = null;
  ws.roomSeat = null;
  ws.playerIndex = null;
  ws.intentionalLeave = false;
  ws.on('pong', () => {
    ws.missedPongs = 0;
  });

  sendJson(ws, {
    type: 'CONNECTED',
    openRooms: getPublicRoomList()
  });

  ws.on('message', async (raw) => {
    ws.missedPongs = 0;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    await handleClientMessage(ws, msg);
  });

  ws.on('close', () => {
    const soloEngine = soloDuels.get(ws);
    if (soloEngine) {
      soloEngine.destroy();
      soloDuels.delete(ws);
    }
    if (ws.cloudGuestBridge) {
      closeSocketCloudGuestBridge(ws, {
        notifyHost: true,
        intentional: Boolean(ws.intentionalLeave)
      });
    }
    detachSocketFromRoom(ws, { intentional: Boolean(ws.intentionalLeave) });
  });
});

async function handleClientMessage(ws, msg) {
  if (!msg || typeof msg !== 'object') return;

  if (ws.cloudGuestBridge) {
    if (['RPS_MOVE', 'RPS_CHOOSE_TURN', 'DUEL_ACTION', 'REMATCH', 'EMOTE'].includes(msg.type)) {
      ws.cloudGuestBridge.sendToHost(msg);
      return;
    }
    if (msg.type === 'LEAVE_ROOM') {
      ws.intentionalLeave = true;
      closeSocketCloudGuestBridge(ws, { notifyHost: true, intentional: true });
      return;
    }
    if (['CREATE_ROOM', 'JOIN_ROOM', 'REJOIN_ROOM', 'START_SOLO_DUEL'].includes(msg.type)) {
      closeSocketCloudGuestBridge(ws, { notifyHost: true, intentional: true });
    }
  }

  switch (msg.type) {
      case 'PING': {
        sendJson(ws, { type: 'PONG', ts: Date.now() });
        break;
      }

      case 'START_SOLO_DUEL': {
        try {
          if (Array.isArray(msg.customCards) && msg.customCards.length > 0) {
            registerRuntimeCards(msg.customCards);
          }
          if (msg.customDeck?.id) {
            registerCustomDecks([msg.customDeck]);
          }
          const prev = soloDuels.get(ws);
          if (prev) prev.destroy();
          const humanStartsFirst = msg.firstPlayer !== 'ai' && msg.humanStartsFirst !== false;
          const engine = await createYgoProEngineForDecks({
            p0Name: msg.playerName || 'Player 1',
            p0DeckId: msg.playerDeckId || 'blue_eyes_meta',
            p1Name: 'YGOPro AI',
            p1DeckId: msg.aiDeckId || 'swordsoul_tenyi',
            isSoloVsAi: true,
            humanStartsFirst
          });
          soloDuels.set(ws, engine);
          const humanIdx = engine.humanIndex ?? 0;
          sendJson(ws, {
            type: 'DUEL_STATE_SYNC',
            mode: 'SOLO',
            playerIndex: humanIdx,
            state: engine.state,
            legalActions: engine.getLegalActions(humanIdx)
          });
        } catch (err) {
          sendJson(ws, { type: 'ACTION_ERROR', errorTh: err.message });
        }
        break;
      }

      case 'LIST_ROOMS': {
        sendJson(ws, { type: 'ROOM_LIST_UPDATE', openRooms: getPublicRoomList() });
        break;
      }

      case 'CREATE_ROOM': {
        detachSocketFromRoom(ws, { intentional: true });
        if (Array.isArray(msg.customCards) && msg.customCards.length > 0) {
          registerRuntimeCards(msg.customCards);
        }
        if (msg.customDeck?.id) {
          registerCustomDecks([msg.customDeck]);
        }
        const code = generateRoomCode();
        const hostToken = generateReconnectToken();
        const room = {
          code,
          hostWs: ws,
          guestWs: null,
          hostToken,
          guestToken: null,
          hostInfo: {
            name: String(msg.playerName || '').trim() || 'Duelist 1',
            deckId: msg.deckId || 'blue_eyes_meta',
            customDeck: msg.customDeck || null,
            customCards: Array.isArray(msg.customCards) ? msg.customCards : []
          },
          guestInfo: null,
          engine: null,
          rps: null,
          isRematch: false,
          seatToEngineIndex: [0, 1],
          status: 'WAITING',
          disconnectTimers: new Map(),
          createdAt: Date.now()
        };
        rooms.set(code, room);
        ws.roomCode = code;
        ws.roomSeat = 0;
        ws.playerIndex = 0;
        ws.intentionalLeave = false;
        attachHostCloudRelay(room);

        sendJson(ws, {
          type: 'ROOM_CREATED',
          roomCode: code,
          playerIndex: 0,
          reconnectToken: hostToken,
          hostInfo: room.hostInfo
        });
        broadcastRoomList();
        break;
      }

      case 'JOIN_ROOM': {
        const code = String(msg.roomCode || '').trim().replace(/^#/, '').toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          if (!ws.isCloudRelayVirtual && process.env.ENABLE_CLOUD_RELAY !== '0' && code.length >= 4) {
            await connectSocketToRemoteCloudRoom(ws, code, msg);
            break;
          }
          sendJson(ws, { type: 'ROOM_ERROR', errorTh: `ไม่พบห้องรหัส "${code}"` });
          break;
        }
        if (room.status !== 'WAITING' || (room.guestWs && room.guestWs.readyState === 1)) {
          if (room.guestWs === ws && room.status === 'RPS') {
            broadcastRpsState(room, { reconnectTokens: true, opponentNames: true });
            break;
          }
          sendJson(ws, { type: 'ROOM_ERROR', errorTh: `ห้อง "${code}" มีผู้เล่นครบแล้ว` });
          break;
        }

        if (Array.isArray(msg.customCards) && msg.customCards.length > 0) {
          registerRuntimeCards(msg.customCards);
        }
        if (msg.customDeck?.id) {
          registerCustomDecks([msg.customDeck]);
        }

        const distinct = resolveDistinctPlayerNames(room.hostInfo?.name, msg.playerName);
        room.hostInfo.name = distinct.hostName;
        const guestToken = generateReconnectToken();
        room.guestWs = ws;
        room.guestToken = guestToken;
        room.guestInfo = {
          name: distinct.guestName,
          deckId: msg.deckId || 'swordsoul_tenyi',
          customDeck: msg.customDeck || null,
          customCards: Array.isArray(msg.customCards) ? msg.customCards : []
        };
        room.status = 'RPS';
        room.isRematch = false;
        room.rps = new RpsSession([room.hostInfo.name, room.guestInfo.name]);
        ws.roomCode = code;
        ws.roomSeat = 1;
        ws.playerIndex = 1;
        ws.intentionalLeave = false;

        broadcastRpsState(room, { reconnectTokens: true, opponentNames: true });
        broadcastRoomList();
        break;
      }

      case 'RPS_MOVE': {
        const room = rooms.get(ws.roomCode);
        if (!room || room.status !== 'RPS' || !room.rps) break;
        const res = room.rps.submitMove(ws.roomSeat, msg.move);
        if (!res.ok) {
          sendJson(ws, { type: 'ROOM_ERROR', errorTh: res.error });
          break;
        }
        broadcastRpsState(room);
        break;
      }

      case 'RPS_CHOOSE_TURN': {
        const room = rooms.get(ws.roomCode);
        if (!room || room.status !== 'RPS' || !room.rps) break;
        const res = room.rps.chooseTurnOrder(ws.roomSeat, msg.choice);
        if (!res.ok) {
          sendJson(ws, { type: 'ROOM_ERROR', errorTh: res.error });
          break;
        }
        await startWsRoomDuelFromRps(room, res.firstSeat, { rematch: Boolean(room.isRematch) });
        break;
      }

      case 'REJOIN_ROOM': {
        const code = String(msg.roomCode || '').trim().toUpperCase();
        const token = String(msg.reconnectToken || '').trim();
        const room = rooms.get(code);
        if (!room || !token) {
          if (!ws.isCloudRelayVirtual && process.env.ENABLE_CLOUD_RELAY !== '0' && code && token) {
            await connectSocketToRemoteCloudRoom(ws, code, msg);
            break;
          }
          sendJson(ws, { type: 'REJOIN_FAILED', errorTh: `ไม่พบห้องเดิม "${code}" แล้ว` });
          break;
        }
        let rejoinIdx = -1;
        if (token === room.hostToken) rejoinIdx = 0;
        else if (token === room.guestToken) rejoinIdx = 1;
        if (rejoinIdx < 0) {
          sendJson(ws, { type: 'REJOIN_FAILED', errorTh: 'โทเค็นเชื่อมต่อห้องเดิมไม่ถูกต้อง' });
          break;
        }

        if (room.disconnectTimers?.has(rejoinIdx)) {
          clearTimeout(room.disconnectTimers.get(rejoinIdx));
          room.disconnectTimers.delete(rejoinIdx);
        }
        if (rejoinIdx === 0) room.hostWs = ws;
        else room.guestWs = ws;
        ws.roomCode = code;
        ws.roomSeat = rejoinIdx;
        ws.playerIndex = room.seatToEngineIndex?.[rejoinIdx] ?? rejoinIdx;
        ws.intentionalLeave = false;

        if (room.status === 'WAITING') {
          sendJson(ws, {
            type: 'ROOM_CREATED',
            roomCode: code,
            playerIndex: rejoinIdx,
            reconnectToken: token,
            hostInfo: room.hostInfo
          });
          broadcastRoomList();
          break;
        }

        const otherWs = rejoinIdx === 0 ? room.guestWs : room.hostWs;
        const otherName = rejoinIdx === 0 ? room.guestInfo?.name : room.hostInfo?.name;
        if (otherWs && otherWs.readyState === 1) {
          sendJson(otherWs, {
            type: 'OPPONENT_RECONNECTED',
            messageTh: 'ผู้เล่นอีกฝ่ายเชื่อมต่อกลับเข้ามาแล้ว!'
          });
        }

        if (room.status === 'RPS' && room.rps) {
          sendJson(ws, {
            type: 'RPS_STATE',
            roomCode: code,
            seat: rejoinIdx,
            reconnectToken: token,
            opponentName: otherName || 'Opponent',
            rematch: Boolean(room.isRematch),
            rpsState: room.rps.getPublicStateForSeat(rejoinIdx)
          });
          break;
        }

        sendJson(ws, {
          type: 'MATCH_STARTED',
          roomCode: code,
          playerIndex: ws.playerIndex,
          reconnectToken: token,
          opponentName: otherName || 'Opponent',
          rejoined: true
        });
        if (room.engine) {
          sendJson(ws, {
            type: 'DUEL_STATE_SYNC',
            roomCode: code,
            playerIndex: ws.playerIndex,
            state: room.engine.state,
            legalActions: room.engine.getLegalActions(ws.playerIndex)
          });
        }
        break;
      }

      case 'LEAVE_ROOM': {
        ws.intentionalLeave = true;
        detachSocketFromRoom(ws, { intentional: true });
        break;
      }

      case 'DUEL_ACTION': {
        const soloEngine = soloDuels.get(ws);
        if (soloEngine) {
          const humanIdx = soloEngine.humanIndex ?? 0;
          const aiStepSnapshots = [];
          soloEngine.onAiStep = (snap) => {
            if (aiStepSnapshots.length < 24) aiStepSnapshots.push(snap);
          };
          const result = soloEngine.dispatchAction(humanIdx, msg.action || {});
          soloEngine.onAiStep = null;
          const emptyLegal = { handActions: {}, fieldActions: {}, attackTargets: {}, canBattlePhase: false, canMainPhase2: false, canEndTurn: false, canChainRespond: false, chainPrompt: null };
          for (const snap of aiStepSnapshots) {
            sendJson(ws, {
              type: 'DUEL_STATE_SYNC',
              mode: 'SOLO',
              playerIndex: humanIdx,
              state: snap,
              legalActions: emptyLegal
            });
          }
          if (!result.ok) {
            if (result.state) {
              sendJson(ws, {
                type: 'DUEL_STATE_SYNC',
                mode: 'SOLO',
                playerIndex: humanIdx,
                state: result.state,
                legalActions: soloEngine.getLegalActions(humanIdx),
                lastAction: msg.action
              });
            }
            sendJson(ws, { type: 'ACTION_ERROR', errorTh: result.error });
            break;
          }
          sendJson(ws, {
            type: 'DUEL_STATE_SYNC',
            mode: 'SOLO',
            playerIndex: humanIdx,
            state: soloEngine.state,
            legalActions: soloEngine.getLegalActions(humanIdx),
            lastAction: msg.action
          });
          break;
        }
        const room = rooms.get(ws.roomCode);
        if (!room || !room.engine) break;
        const result = room.engine.dispatchAction(ws.playerIndex, msg.action || {});
        if (!result.ok) {
          if (result.state) {
            broadcastRoomState(room, { lastAction: msg.action });
          }
          sendJson(ws, { type: 'ACTION_ERROR', errorTh: result.error });
          break;
        }
        broadcastRoomState(room, { lastAction: msg.action });
        break;
      }

      case 'REMATCH': {
        const room = rooms.get(ws.roomCode);
        if (!room) break;
        if (Array.isArray(msg.customCards) && msg.customCards.length > 0) {
          registerRuntimeCards(msg.customCards);
        }
        if (msg.customDeck?.id) {
          registerCustomDecks([msg.customDeck]);
        }
        const seat = ws.roomSeat ?? ws.playerIndex;
        const targetInfo = seat === 0 ? room.hostInfo : room.guestInfo;
        if (targetInfo) {
          if (msg.deckId) targetInfo.deckId = msg.deckId;
          if (msg.customDeck?.id) targetInfo.customDeck = msg.customDeck;
          if (Array.isArray(msg.customCards) && msg.customCards.length > 0) {
            targetInfo.customCards = msg.customCards;
          }
        }
        if (room.engine) {
          room.engine.destroy();
          room.engine = null;
        }
        room.status = 'RPS';
        room.isRematch = true;
        room.rps = new RpsSession([room.hostInfo?.name || 'Duelist 1', room.guestInfo?.name || 'Duelist 2']);
        broadcastRpsState(room, { reconnectTokens: true, opponentNames: true, rematch: true });
        break;
      }

      case 'EMOTE': {
        const room = rooms.get(ws.roomCode);
        if (!room) break;
        const targetWs = (ws === room.hostWs || ws.roomSeat === 0) ? room.guestWs : room.hostWs;
        sendJson(targetWs, {
          type: 'OPPONENT_EMOTE',
          playerIndex: ws.playerIndex,
          emote: msg.emote
        });
        break;
      }
    }
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalNetworkIPs();
  console.log('==============================================================');
  console.log('🐉 Yu-Gi-Oh! Master Duel Web Server พร้อมทำงานแล้ว!');
  console.log(`💻 เล่นบนเครื่องนี้: http://localhost:${PORT}`);
  if (ips.length > 0) {
    console.log('📱 เล่นกับเพื่อนบนมือถือ/คอมเครื่องอื่นใน Wi-Fi เดียวกัน:');
    for (const ip of ips) {
      console.log(`   👉 ${ip.url} (${ip.interface})`);
    }
  }
  console.log('==============================================================');
});
