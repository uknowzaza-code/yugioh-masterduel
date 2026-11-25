/**
 * @fileoverview Dual-Mode Multiplayer Manager (WebSocket Server + PeerJS WebRTC Cross-Network P2P)
 * รองรับการเล่นกับเพื่อนทั้ง:
 * 1. ผ่านเซิร์ฟเวอร์ WebSocket (Wi-Fi เดียวกัน / LAN / Cloud Server / Reverse Tunnel พร้อม Heartbeat & Auto-Rejoin)
 * 2. ผ่านระบบ Peer-to-Peer ข้ามเครือข่าย (WebRTC / PeerJS พร้อม Multi-STUN + TURN Relay Config & NAT Diagnostics)
 */

import { DuelEngine } from '/src/engine/DuelEngine.js';
import { RpsSession } from '/src/engine/RpsSession.js';
import { MqttWssClient, CloudRelayPeerConnection, sliceUtf16Safe } from '/src/engine/CloudRelay.js';
import { registerRuntimeCards, registerCustomDecks } from '/src/cards/index.js';

export const DEFAULT_STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

const TURN_STORAGE_KEY = 'ygo_md_turn_config';
const PEERJS_CDN_URLS = [
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
];
const P2P_CONNECT_TIMEOUT_MS = 15000;
const PEER_DIRECT_MAX_BYTES = 11000;
const PEER_CHUNK_CHAR_LEN = 4000;
let peerChunkSeq = 0;

/**
 * Send JSON payload over a PeerJS DataConnection without hitting PeerJS's
 * ~16 KB "Message too big for JSON channel" limit.
 * @param {import('peerjs').DataConnection|null} conn
 * @param {Object} payload
 */
export function sendPeerJson(conn, payload) {
  if (!conn || !conn.open) return false;
  const serialized = JSON.stringify(payload);
  const byteLen = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(serialized).length
    : serialized.length * 2;

  if (byteLen <= PEER_DIRECT_MAX_BYTES) {
    conn.send(payload);
    return true;
  }

  const chunkId = `ygo_${Date.now().toString(36)}_${++peerChunkSeq}`;
  const slices = sliceUtf16Safe(serialized, PEER_CHUNK_CHAR_LEN);
  const total = slices.length;
  for (let index = 0; index < total; index++) {
    conn.send({
      __ygoChunk: {
        id: chunkId,
        index,
        total,
        slice: slices[index]
      }
    });
  }
  return true;
}

/**
 * Reassemble chunked PeerJS JSON payloads while passing regular objects through untouched.
 * @param {(msg: Object) => void} onMessage
 * @returns {(data: any) => void}
 */
export function createPeerDataDispatcher(onMessage) {
  const inflight = new Map();
  return (data) => {
    const chunk = data && data.__ygoChunk;
    if (!chunk) {
      onMessage(data);
      return;
    }

    const { id, index, total, slice } = chunk;
    if (!id || typeof index !== 'number' || typeof total !== 'number' || typeof slice !== 'string') {
      return;
    }

    let entry = inflight.get(id);
    if (!entry) {
      // Bound in-flight map in case an aborted transfer leaves stale chunks
      if (inflight.size > 32) {
        const oldestKey = inflight.keys().next().value;
        inflight.delete(oldestKey);
      }
      entry = { parts: new Array(total), received: 0, total };
      inflight.set(id, entry);
    }

    if (entry.parts[index] === undefined) {
      entry.parts[index] = slice;
      entry.received += 1;
    }

    if (entry.received >= entry.total) {
      inflight.delete(id);
      try {
        const parsed = JSON.parse(entry.parts.join(''));
        onMessage(parsed);
      } catch (err) {
        console.error('[P2P] Failed to reassemble chunked message:', err);
      }
    }
  };
}

export function isPrivateOrLocalHost(hostname = '') {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '::1' || host === '[::1]' || host === '0.0.0.0' || host.endsWith('.local')) {
    return true;
  }
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
    return true;
  }
  const match172 = host.match(/^172\.(\d+)\./);
  if (match172) {
    const secondOctet = Number(match172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }
  return false;
}

export function resolveDistinctPlayerNames(hostName, guestName) {
  const cleanHost = String(hostName || '').trim() || 'Duelist 1';
  let cleanGuest = String(guestName || '').trim() || 'Duelist 2';
  if (cleanGuest.toLowerCase() === cleanHost.toLowerCase()) {
    cleanGuest = cleanGuest === 'Duelist 1' ? 'Duelist 2' : `${cleanGuest} (P2)`;
  }
  return { hostName: cleanHost, guestName: cleanGuest };
}

export function readSavedTurnConfig() {
  try {
    const raw = localStorage.getItem(TURN_STORAGE_KEY);
    if (!raw) return { urls: '', username: '', credential: '', forceRelay: false };
    const parsed = JSON.parse(raw);
    return {
      urls: typeof parsed?.urls === 'string' ? parsed.urls.trim() : '',
      username: typeof parsed?.username === 'string' ? parsed.username.trim() : '',
      credential: typeof parsed?.credential === 'string' ? parsed.credential : '',
      forceRelay: Boolean(parsed?.forceRelay)
    };
  } catch {
    return { urls: '', username: '', credential: '', forceRelay: false };
  }
}

export function saveTurnConfig(config = {}) {
  try {
    const urls = String(config.urls || '').trim();
    const username = String(config.username || '').trim();
    const credential = String(config.credential || '');
    const forceRelay = Boolean(config.forceRelay);
    if (!urls && !username && !credential && !forceRelay) {
      localStorage.removeItem(TURN_STORAGE_KEY);
      return { urls: '', username: '', credential: '', forceRelay: false };
    }
    const clean = { urls, username, credential, forceRelay };
    localStorage.setItem(TURN_STORAGE_KEY, JSON.stringify(clean));
    return clean;
  } catch {
    return { urls: '', username: '', credential: '', forceRelay: false };
  }
}

async function fetchServerIceConfig() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch('/api/ice-servers', { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) {
        return { iceServers: data.iceServers, hasTurn: Boolean(data.hasTurn) };
      }
    }
  } catch {
    // Fallback cleanly when hosted statically or offline
  }
  return { iceServers: [...DEFAULT_STUN_SERVERS], hasTurn: false };
}

async function buildEffectiveIceConfig(overrideTurn = null) {
  const serverCfg = await fetchServerIceConfig();
  const iceServers = [...serverCfg.iceServers];
  let hasTurn = serverCfg.hasTurn;

  const userTurn = overrideTurn || readSavedTurnConfig();
  if (userTurn?.urls) {
    const urlList = userTurn.urls.split(',').map((u) => u.trim()).filter(Boolean);
    if (urlList.length > 0) {
      const entry = { urls: urlList };
      if (userTurn.username) entry.username = userTurn.username;
      if (userTurn.credential) entry.credential = userTurn.credential;
      iceServers.push(entry);
      if (urlList.some((u) => /^turns?:/i.test(u))) hasTurn = true;
    }
  }

  return {
    iceServers,
    hasTurn,
    iceTransportPolicy: userTurn?.forceRelay && hasTurn ? 'relay' : 'all'
  };
}

export async function testWebRtcConnectivity(overrideTurn = null) {
  if (typeof RTCPeerConnection === 'undefined') {
    return { supported: false, hasHost: false, hasSrflx: false, hasRelay: false, publicIps: [], candidateCount: 0 };
  }
  const iceCfg = await buildEffectiveIceConfig(overrideTurn);
  const pc = new RTCPeerConnection({
    iceServers: iceCfg.iceServers,
    iceTransportPolicy: iceCfg.iceTransportPolicy
  });
  const types = new Set();
  const publicIps = new Set();
  let candidateCount = 0;

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      try {
        pc.close();
      } catch {
        // ignore close failure
      }
      resolve({
        supported: true,
        hasTurnConfigured: iceCfg.hasTurn,
        hasHost: types.has('host'),
        hasSrflx: types.has('srflx'),
        hasRelay: types.has('relay'),
        publicIps: Array.from(publicIps),
        candidateCount
      });
    };

    const timeoutId = setTimeout(finish, 3800);
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) {
        finish();
        return;
      }
      candidateCount++;
      const cStr = ev.candidate.candidate || '';
      const typeMatch = cStr.match(/\btyp\s+(host|srflx|prflx|relay)\b/i);
      const candType = ev.candidate.type || (typeMatch ? typeMatch[1].toLowerCase() : '');
      if (candType) types.add(candType);
      if (candType === 'srflx' && ev.candidate.address) {
        publicIps.add(ev.candidate.address);
      }
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };

    try {
      pc.createDataChannel('ygo-nat-probe');
      pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(() => finish());
    } catch {
      finish();
    }
  });
}

function loadScriptWithTimeout(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      script.remove();
      reject(new Error(`Timeout loading ${url}`));
    }, timeoutMs);

    script.src = url;
    script.async = true;
    script.onload = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (window.Peer) resolve(window.Peer);
      else reject(new Error('PeerJS loaded without global window.Peer'));
    };
    script.onerror = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      script.remove();
      reject(new Error(`Failed loading ${url}`));
    };
    document.head.appendChild(script);
  });
}

export class MultiplayerManager {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.mode = 'WS'; // 'WS' | 'P2P'
    this.ws = null;
    this.peer = null;
    this.peerConn = null;
    this.p2pHostEngine = null;
    this.roomCode = null;
    this.playerIndex = 0;
    this.hostInfo = null;
    this.guestInfo = null;

    this.wsSession = null;
    this.intentionalDisconnect = false;
    this.wsReconnectTimer = null;
    this.wsReconnectAttempt = 0;
    this.wsPingTimer = null;

    this.p2pConnectTimer = null;
    this._peerLoadPromise = null;
    this._wakeListenersBound = false;
    this.bindNetworkWakeListeners();
  }

  bindNetworkWakeListeners() {
    if (this._wakeListenersBound || typeof window === 'undefined') return;
    this._wakeListenersBound = true;
    const ensureAlive = () => {
      if (this.mode !== 'WS' && !this.ws) return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'PING' }));
        } catch {
          this.connectWebSocket();
        }
        return;
      }
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.wsReconnectAttempt = 0;
        this.connectWebSocket();
      }
    };
    window.addEventListener('online', ensureAlive);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') ensureAlive();
      });
    }
  }

  /**
   * เชื่อมต่อกับเซิร์ฟเวอร์ WebSocket (พร้อม Keepalive Ping และ Auto-Rejoin เมื่อเน็ตสะดุด)
   */
  connectWebSocket() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}`;
    const socket = new WebSocket(wsUrl);
    this.ws = socket;

    socket.addEventListener('open', () => {
      if (this.ws !== socket) return;
      this.wsReconnectAttempt = 0;
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
      this.startWsKeepalive();
      this.callbacks.onWsConnected?.();

      if (this.mode === 'WS' && this.wsSession?.roomCode && this.wsSession?.reconnectToken) {
        socket.send(JSON.stringify({
          type: 'REJOIN_ROOM',
          roomCode: this.wsSession.roomCode,
          reconnectToken: this.wsSession.reconnectToken
        }));
      }
    });

    socket.addEventListener('message', (event) => {
      if (this.ws !== socket) return;
      try {
        const msg = JSON.parse(event.data);
        this.handleServerMessage(msg);
      } catch (e) {
        console.error('Invalid WS message:', e);
      }
    });

    socket.addEventListener('close', () => {
      if (this.ws !== socket) return;
      this.stopWsKeepalive();
      this.callbacks.onWsDisconnected?.();
      this.scheduleWsReconnect();
    });
  }

  startWsKeepalive() {
    this.stopWsKeepalive();
    this.wsPingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'PING' }));
        } catch {
          // ignore transient send errors
        }
      }
    }, 25000);
  }

  stopWsKeepalive() {
    if (this.wsPingTimer) {
      clearInterval(this.wsPingTimer);
      this.wsPingTimer = null;
    }
  }

  scheduleWsReconnect() {
    if (this.intentionalDisconnect) return;
    const inActiveRoom = this.mode === 'WS' && Boolean(this.wsSession?.roomCode);
    const maxAttempts = inActiveRoom ? 10 : 5;
    if (this.wsReconnectAttempt >= maxAttempts) {
      if (inActiveRoom) {
        this.wsSession = null;
        this.callbacks.onError?.('การเชื่อมต่อกับเซิร์ฟเวอร์ขาดหาย กรุณาลองเข้าร่วมใหม่อีกครั้ง');
      }
      return;
    }
    const delayMs = 1000 * Math.min(8, 2 ** this.wsReconnectAttempt);
    this.wsReconnectAttempt++;
    if (inActiveRoom) {
      this.callbacks.onWsReconnecting?.({ attempt: this.wsReconnectAttempt, delayMs });
    }
    clearTimeout(this.wsReconnectTimer);
    this.wsReconnectTimer = setTimeout(() => {
      this.connectWebSocket();
    }, delayMs);
  }

  handleServerMessage(msg) {
    switch (msg.type) {
      case 'PONG':
        break;

      case 'CONNECTED':
      case 'ROOM_LIST_UPDATE':
        this.callbacks.onRoomListUpdate?.(msg.openRooms || []);
        break;

      case 'ROOM_CREATED':
        this.mode = 'WS';
        this.roomCode = msg.roomCode;
        this.playerIndex = msg.playerIndex;
        this.wsSession = {
          roomCode: msg.roomCode,
          playerIndex: msg.playerIndex,
          reconnectToken: msg.reconnectToken || null
        };
        this.callbacks.onRoomCreated?.({
          roomCode: msg.roomCode,
          playerIndex: msg.playerIndex,
          mode: 'WS'
        });
        break;

      case 'RPS_STATE':
        if (Array.isArray(msg.opponentCustomCards) && msg.opponentCustomCards.length > 0) {
          registerRuntimeCards(msg.opponentCustomCards);
        }
        if (msg.opponentCustomDeck?.id) {
          registerCustomDecks([msg.opponentCustomDeck]);
        }
        this.mode = 'WS';
        this.roomCode = msg.roomCode;
        this.playerIndex = msg.seat;
        this.wsSession = {
          roomCode: msg.roomCode,
          playerIndex: msg.seat,
          reconnectToken: msg.reconnectToken || this.wsSession?.reconnectToken || null
        };
        this.callbacks.onRpsState?.({
          mode: 'WS',
          roomCode: msg.roomCode,
          seat: msg.seat,
          opponentName: msg.opponentName,
          rematch: Boolean(msg.rematch),
          rpsState: msg.rpsState
        });
        break;

      case 'MATCH_STARTED':
        if (Array.isArray(msg.opponentCustomCards) && msg.opponentCustomCards.length > 0) {
          registerRuntimeCards(msg.opponentCustomCards);
        }
        if (msg.opponentCustomDeck?.id) {
          registerCustomDecks([msg.opponentCustomDeck]);
        }
        this.mode = 'WS';
        this.roomCode = msg.roomCode;
        this.playerIndex = msg.playerIndex;
        this.wsSession = {
          roomCode: msg.roomCode,
          playerIndex: msg.playerIndex,
          reconnectToken: msg.reconnectToken || this.wsSession?.reconnectToken || null
        };
        this.callbacks.onMatchStarted?.({
          roomCode: msg.roomCode,
          playerIndex: msg.playerIndex,
          opponentName: msg.opponentName,
          mode: 'WS',
          rematch: Boolean(msg.rematch),
          rejoined: Boolean(msg.rejoined),
          rpsSummary: msg.rpsSummary || null
        });
        break;

      case 'DUEL_STATE_SYNC':
        this.callbacks.onStateSync?.({
          mode: msg.mode || null,
          state: msg.state,
          playerIndex: msg.playerIndex,
          legalActions: msg.legalActions
        });
        break;

      case 'REJOIN_FAILED':
        this.wsSession = null;
        this.callbacks.onError?.(msg.errorTh || 'ไม่สามารถกลับเข้าห้องเดิมได้');
        break;

      case 'ROOM_ERROR':
      case 'ACTION_ERROR':
        this.callbacks.onError?.(msg.errorTh || 'เกิดข้อผิดพลาด');
        break;

      case 'OPPONENT_EMOTE':
        this.callbacks.onOpponentEmote?.(msg.emote);
        break;

      case 'OPPONENT_RECONNECTING':
      case 'OPPONENT_RECONNECTED':
        this.callbacks.onError?.(msg.messageTh);
        break;

      case 'OPPONENT_DISCONNECTED':
        this.wsSession = null;
        this.callbacks.onOpponentDisconnected?.(msg.messageTh);
        break;
    }
  }

  /**
   * เริ่มโหมดเล่นคนเดียว (Solo vs AI) ผ่าน YGOPro Core (ocgcore-wasm) บนเซิร์ฟเวอร์
   */
  startSoloDuel({ playerName, playerDeckId, aiDeckId, aiDifficulty = 'normal', firstPlayer = 'human', customDeck = null, customCards = [] }) {
    this.destroyPeer();
    this.wsSession = null;
    this.intentionalDisconnect = false;
    this.mode = 'WS';
    const payload = JSON.stringify({
      type: 'START_SOLO_DUEL',
      playerName,
      playerDeckId,
      aiDeckId,
      aiDifficulty,
      firstPlayer,
      customDeck,
      customCards
    });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
      return;
    }
    this.connectWebSocket();
    const onOpen = () => {
      this.ws?.removeEventListener('open', onOpen);
      this.ws?.send(payload);
    };
    this.ws?.addEventListener('open', onOpen);
  }

  /**
   * สร้างห้องผ่านเซิร์ฟเวอร์ WebSocket
   */
  createWsRoom(playerName, deckId, customPayload = {}) {
    this.destroyPeer();
    this.intentionalDisconnect = false;
    this.wsSession = null;
    this.mode = 'WS';
    this.connectWebSocket();
    const sendCreate = () => {
      this.ws.send(JSON.stringify({
        type: 'CREATE_ROOM',
        playerName,
        deckId,
        customDeck: customPayload.customDeck || null,
        customCards: customPayload.customCards || []
      }));
    };
    if (this.ws.readyState === WebSocket.OPEN) {
      sendCreate();
    } else {
      this.ws.addEventListener('open', sendCreate, { once: true });
    }
  }

  /**
   * เข้าร่วมห้องผ่านเซิร์ฟเวอร์ WebSocket
   */
  joinWsRoom(roomCode, playerName, deckId, customPayload = {}) {
    this.destroyPeer();
    this.intentionalDisconnect = false;
    this.wsSession = null;
    this.mode = 'WS';
    this.connectWebSocket();
    const sendJoin = () => {
      this.ws.send(JSON.stringify({
        type: 'JOIN_ROOM',
        roomCode: String(roomCode).trim().replace(/^#/, '').toUpperCase(),
        playerName,
        deckId,
        customDeck: customPayload.customDeck || null,
        customCards: customPayload.customCards || []
      }));
    };
    if (this.ws.readyState === WebSocket.OPEN) {
      sendJoin();
    } else {
      this.ws.addEventListener('open', sendJoin, { once: true });
    }
  }

  leaveWsRoom() {
    this.wsSession = null;
    clearTimeout(this.wsReconnectTimer);
    this.wsReconnectTimer = null;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
      } catch {
        // ignore
      }
    }
  }

  /**
   * โหลดไลบรารี PeerJS แบบไดนามิกสำหรับโหมด P2P ข้ามเครือข่าย (ลองหลาย CDN อัตโนมัติ)
   */
  async ensurePeerJsLoaded() {
    if (window.Peer) return window.Peer;
    if (this._peerLoadPromise) return this._peerLoadPromise;

    this._peerLoadPromise = (async () => {
      let lastErr = null;
      for (const cdnUrl of PEERJS_CDN_URLS) {
        try {
          return await loadScriptWithTimeout(cdnUrl, 8000);
        } catch (err) {
          lastErr = err;
        }
      }
      throw new Error(
        `ไม่สามารถโหลดไลบรารี PeerJS สำหรับ P2P ได้ (${lastErr?.message || 'CDN unreachable'}) กรุณาเช็กเน็ตหรือใช้โหมดเซิร์ฟเวอร์`
      );
    })();

    try {
      return await this._peerLoadPromise;
    } catch (err) {
      this._peerLoadPromise = null;
      throw err;
    }
  }

  destroyPeer() {
    clearTimeout(this.p2pConnectTimer);
    this.p2pConnectTimer = null;
    if (this.p2pProbeInterval) {
      clearInterval(this.p2pProbeInterval);
      this.p2pProbeInterval = null;
    }
    if (this.peerConn) {
      const conn = this.peerConn;
      this.peerConn = null;
      try {
        conn.close({ notifyPeer: true });
      } catch {
        // ignore close errors
      }
    }
    if (this.relayClient) {
      const client = this.relayClient;
      this.relayClient = null;
      try {
        client.close();
      } catch {
        // ignore close errors
      }
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore destroy errors
      }
      this.peer = null;
    }
    this.p2pHostEngine = null;
    this.p2pRps = null;
    this.p2pIsRematch = false;
    this.activeP2PGuestId = null;
  }

  disconnectRoom() {
    this.leaveWsRoom();
    if (this.mode === 'P2P' && this.peerConn?.open) {
      try {
        sendPeerJson(this.peerConn, { type: 'P2P_LEAVE' });
      } catch {
        // ignore
      }
    }
    this.destroyPeer();
    this.roomCode = null;
  }

  attachPeerConnectionLifecycle(conn, role) {
    const bindIceMonitor = () => {
      const pc = conn.peerConnection;
      if (!pc || pc._ygoMonitored) return;
      pc._ygoMonitored = true;
      pc.addEventListener('iceconnectionstatechange', () => {
        const iceState = pc.iceConnectionState;
        if (iceState === 'checking') {
          this.callbacks.onP2PStatus?.({
            stage: 'ice',
            message: '🔄 กำลังเชื่อมต่อ WebRTC ข้ามเครือข่าย (NAT Traversal)...'
          });
        } else if (iceState === 'failed') {
          clearTimeout(this.p2pConnectTimer);
          this.p2pConnectTimer = null;
          this.callbacks.onP2PStatus?.({
            stage: 'error',
            message: '❌ WebRTC ICE ล้มเหลว — Wi-Fi/4G สองฝั่งมี Symmetric NAT หรือ Firewall บล็อก P2P'
          });
          this.callbacks.onError?.(
            'เชื่อมต่อข้าม Wi-Fi/4G ไม่สำเร็จ (NAT/Firewall บล็อก WebRTC) — กรุณาใส่ TURN Relay ใน "ตั้งค่า NAT" หรือเปิดลิงก์ผ่านโหมดเซิร์ฟเวอร์เดียวกัน'
          );
        }
      });
    };

    bindIceMonitor();
    // PeerJS creates peerConnection right as negotiation starts; poll once on next microtask if not ready yet
    if (!conn.peerConnection) {
      setTimeout(bindIceMonitor, 50);
    }

    conn.on('error', (err) => {
      clearTimeout(this.p2pConnectTimer);
      this.p2pConnectTimer = null;
      this.callbacks.onP2PStatus?.({
        stage: 'error',
        message: `❌ P2P DataChannel Error: ${err?.message || err?.type || 'Connection failed'}`
      });
      this.callbacks.onError?.(`เชื่อมต่อ P2P ไม่สำเร็จ: ${err?.message || err?.type || 'Connection error'}`);
    });

    conn.on('close', () => {
      clearTimeout(this.p2pConnectTimer);
      this.p2pConnectTimer = null;
      if (this.peerConn === conn) {
        this.peerConn = null;
        this.callbacks.onP2PStatus?.({
          stage: 'closed',
          message: role === 'host' ? '🔌 ผู้เล่นอีกฝ่ายตัดการเชื่อมต่อ P2P' : '🔌 การเชื่อมต่อกับโฮสต์สิ้นสุดลง'
        });
        this.callbacks.onOpponentDisconnected?.(
          role === 'host' ? 'ผู้เล่นอีกฝ่ายตัดการเชื่อมต่อ P2P' : 'การเชื่อมต่อกับโฮสต์สิ้นสุดลง'
        );
      }
    });
  }

  /**
   * สร้างห้องแบบ P2P / Cloud Relay ข้ามเครือข่าย (ทะลุ AP Client Isolation & Campus Firewall ผ่าน WSS Port 443)
   */
  async createP2PRoom(playerName, deckId, customPayload = {}) {
    this.leaveWsRoom();
    this.destroyPeer();

    try {
      this.callbacks.onP2PStatus?.({
        stage: 'signaling',
        message: '⏳ กำลังเชื่อมต่อ Cloud Relay (Port 443 TLS) และสร้างห้องออนไลน์...'
      });

      this.mode = 'P2P';
      this.playerIndex = 0;
      this.hostInfo = {
        name: String(playerName || '').trim() || 'Duelist 1',
        deckId: deckId || 'blue_eyes_meta',
        customDeck: customPayload.customDeck || null,
        customCards: Array.isArray(customPayload.customCards) ? customPayload.customCards : []
      };

      const shortCode = Math.floor(100000 + Math.random() * 900000).toString();
      this.roomCode = shortCode;

      const client = new MqttWssClient({
        WebSocketClass: globalThis.WebSocket,
        clientIdPrefix: `ygo_p2p_host_${shortCode}`
      });
      this.relayClient = client;
      await client.connect();
      if (this.relayClient !== client) return;

      const toHostTopic = `ygo_md_p2p_v1/${shortCode}/to_host`;
      const toGuestTopic = `ygo_md_p2p_v1/${shortCode}/to_guest`;
      const hostPeerId = `ygo-md-p2p-${shortCode}`;

      const conn = new CloudRelayPeerConnection({
        client,
        peerId: hostPeerId,
        sendTopic: toGuestTopic,
        role: 'host',
        serialization: 'json'
      });
      this.peerConn = conn;
      this.attachPeerConnectionLifecycle(conn, 'host');
      const dispatchHostData = createPeerDataDispatcher((data) => this.handleP2PMessageAsHost(data));
      conn.on('data', dispatchHostData);

      await client.subscribe(toHostTopic, (packet) => {
        if (this.relayClient !== client || !packet) return;
        if (packet.__ygoRelayProbe) {
          const incomingGuestId = packet.guestSessionId || null;
          const roomBusy = Boolean(
            (this.activeP2PGuestId && incomingGuestId && this.activeP2PGuestId !== incomingGuestId) ||
            ((this.p2pRps || this.p2pHostEngine) && (!incomingGuestId || this.activeP2PGuestId !== incomingGuestId))
          );
          if (roomBusy) {
            conn.send({
              __ygoRelayBusy: true,
              roomCode: shortCode,
              targetGuestId: incomingGuestId
            });
            return;
          }
          conn.send({
            __ygoRelayAck: true,
            roomCode: shortCode,
            targetGuestId: incomingGuestId
          });
          return;
        }
        if (packet.__ygoRelayClose) {
          if (!this.activeP2PGuestId || packet.sessionId !== this.activeP2PGuestId) {
            return;
          }
          conn.close({ notifyPeer: false });
          return;
        }
        conn._emitData(packet);
      });

      this.callbacks.onP2PStatus?.({
        stage: 'waiting',
        roomCode: shortCode,
        hasTurn: true,
        message: `✅ ห้องออนไลน์พร้อมแล้ว (${shortCode}) • ทะลุ Wi-Fi / Firewall อัตโนมัติ (Cloud Relay 443)`
      });
      this.callbacks.onRoomCreated?.({
        roomCode: shortCode,
        playerIndex: 0,
        mode: 'P2P'
      });
    } catch (err) {
      this.callbacks.onP2PStatus?.({ stage: 'error', message: `❌ ${err.message}` });
      this.callbacks.onError?.(err.message);
    }
  }

  /**
   * เข้าร่วมห้องแบบ P2P / Cloud Relay ข้ามเครือข่ายด้วยรหัสห้อง 6 หลัก (ทะลุ AP Client Isolation & Symmetric NAT)
   */
  async joinP2PRoom(roomCode, playerName, deckId, customPayload = {}) {
    const cleanCode = String(roomCode || '').trim().replace(/^#/, '').toUpperCase();
    if (!cleanCode) {
      this.callbacks.onError?.('กรุณากรอกรหัสห้อง P2P');
      return;
    }

    this.leaveWsRoom();
    this.destroyPeer();

    try {
      this.callbacks.onP2PStatus?.({
        stage: 'signaling',
        message: `⏳ กำลังเชื่อมต่อห้องออนไลน์ #${cleanCode} ผ่าน Cloud Relay...`
      });

      this.mode = 'P2P';
      this.roomCode = cleanCode;
      this.playerIndex = 1;
      this.guestInfo = {
        name: String(playerName || '').trim() || 'Duelist 2',
        deckId: deckId || 'swordsoul_tenyi',
        customDeck: customPayload.customDeck || null,
        customCards: Array.isArray(customPayload.customCards) ? customPayload.customCards : []
      };

      const failJoin = (reason) => {
        clearTimeout(this.p2pConnectTimer);
        this.p2pConnectTimer = null;
        this.destroyPeer();
        this.callbacks.onP2PStatus?.({ stage: 'error', message: `❌ ${reason}` });
        this.callbacks.onError?.(reason);
      };

      const client = new MqttWssClient({
        WebSocketClass: globalThis.WebSocket,
        clientIdPrefix: `ygo_p2p_guest_${cleanCode}`
      });
      this.relayClient = client;
      await client.connect();
      if (this.relayClient !== client) return;

      const toHostTopic = `ygo_md_p2p_v1/${cleanCode}/to_host`;
      const toGuestTopic = `ygo_md_p2p_v1/${cleanCode}/to_guest`;
      const targetPeerId = `ygo-md-p2p-${cleanCode}`;
      const guestSessionId = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

      const conn = new CloudRelayPeerConnection({
        client,
        peerId: targetPeerId,
        sessionId: guestSessionId,
        sendTopic: toHostTopic,
        role: 'guest',
        serialization: 'json'
      });
      this.peerConn = conn;
      this.attachPeerConnectionLifecycle(conn, 'guest');
      const dispatchGuestData = createPeerDataDispatcher((data) => this.handleP2PMessageAsGuest(data));
      conn.on('data', dispatchGuestData);

      let ackReceived = false;
      this.p2pConnectTimer = setTimeout(() => {
        if (!ackReceived) {
          if (this.peerConn === conn) {
            this.peerConn = null;
            conn.close({ notifyPeer: false });
          }
          failJoin(`ไม่พบห้องรหัส "${cleanCode}" หรือโฮสต์ปิดห้องไปแล้ว`);
        }
      }, 8000);

      await client.subscribe(toGuestTopic, (packet) => {
        if (this.relayClient !== client || !packet) return;
        if (packet.__ygoRelayBusy) {
          if (packet.targetGuestId && packet.targetGuestId !== guestSessionId) return;
          if (!ackReceived) {
            if (this.peerConn === conn) {
              this.peerConn = null;
              conn.close({ notifyPeer: false });
            }
            failJoin(`ห้องรหัส "${cleanCode}" มีผู้เล่นครบแล้ว`);
          }
          return;
        }
        if (packet.__ygoRelayAck) {
          if (packet.targetGuestId && packet.targetGuestId !== guestSessionId) return;
          if (ackReceived) return;
          ackReceived = true;
          clearTimeout(this.p2pConnectTimer);
          this.p2pConnectTimer = null;
          if (this.p2pProbeInterval) {
            clearInterval(this.p2pProbeInterval);
            this.p2pProbeInterval = null;
          }
          this.callbacks.onP2PStatus?.({
            stage: 'connected',
            message: '✅ เชื่อมต่อห้องสำเร็จ! กำลังเริ่มเกม...'
          });
          sendPeerJson(conn, {
            type: 'P2P_JOIN_HANDSHAKE',
            guestSessionId,
            playerName: this.guestInfo.name,
            deckId: this.guestInfo.deckId,
            customDeck: this.guestInfo.customDeck,
            customCards: this.guestInfo.customCards
          });
          return;
        }
        if (packet.__ygoRelayClose) {
          conn.close({ notifyPeer: false });
          return;
        }
        conn._emitData(packet);
      });

      const sendProbe = () => {
        if (!ackReceived && this.relayClient === client && (client.connected || client._reconnecting)) {
          conn.send({ __ygoRelayProbe: true, roomCode: cleanCode, guestSessionId });
        }
      };
      sendProbe();
      this.p2pProbeInterval = setInterval(sendProbe, 850);
    } catch (err) {
      this.callbacks.onP2PStatus?.({ stage: 'error', message: `❌ ${err.message}` });
      this.callbacks.onError?.(err.message);
    }
  }

  handleP2PMessageAsHost(msg) {
    if (!msg) return;
    if (msg.type === 'P2P_JOIN_HANDSHAKE') {
      if (this.activeP2PGuestId && msg.guestSessionId && this.activeP2PGuestId !== msg.guestSessionId) {
        return;
      }
      if (this.activeP2PGuestId && (this.p2pRps || this.p2pHostEngine)) {
        return;
      }
      this.activeP2PGuestId = msg.guestSessionId || 'joined';
      try {
        if (Array.isArray(msg.customCards) && msg.customCards.length > 0) {
          registerRuntimeCards(msg.customCards);
        }
        if (msg.customDeck?.id) {
          registerCustomDecks([msg.customDeck]);
        }

        const distinct = resolveDistinctPlayerNames(this.hostInfo?.name, msg.playerName);
        this.hostInfo.name = distinct.hostName;
        this.guestInfo = {
          name: distinct.guestName,
          deckId: msg.deckId || 'swordsoul_tenyi',
          customDeck: msg.customDeck || null,
          customCards: Array.isArray(msg.customCards) ? msg.customCards : []
        };

        this.callbacks.onP2PStatus?.({
          stage: 'connected',
          message: `✅ ${this.guestInfo.name} เข้าร่วมห้อง P2P แล้ว!`
        });

        this.beginHostP2PRps({ rematch: false, includeCustomDeck: true });
      } catch (err) {
        const errMsg = `เริ่มเกม P2P ไม่สำเร็จ: ${err.message}`;
        sendPeerJson(this.peerConn, { type: 'P2P_ERROR', errorTh: errMsg });
        this.callbacks.onError?.(errMsg);
      }
    } else if (msg.type === 'P2P_RPS_MOVE') {
      if (!this.p2pRps) return;
      const res = this.p2pRps.submitMove(1, msg.move);
      if (!res.ok) {
        sendPeerJson(this.peerConn, { type: 'P2P_ERROR', errorTh: res.error });
        return;
      }
      this.syncP2PRpsState();
    } else if (msg.type === 'P2P_RPS_CHOOSE_TURN') {
      if (!this.p2pRps) return;
      const res = this.p2pRps.chooseTurnOrder(1, msg.choice);
      if (!res.ok) {
        sendPeerJson(this.peerConn, { type: 'P2P_ERROR', errorTh: res.error });
        return;
      }
      this.startP2PDuelAfterRps(res.firstSeat);
    } else if (msg.type === 'P2P_DUEL_ACTION') {
      if (!this.p2pHostEngine) return;
      const res = this.p2pHostEngine.executeAction(1, msg.action || {});
      if (!res.ok) {
        sendPeerJson(this.peerConn, { type: 'P2P_ERROR', errorTh: res.errorTh });
        return;
      }
      this.syncP2PState();
    } else if (msg.type === 'P2P_EMOTE') {
      this.callbacks.onOpponentEmote?.(msg.emote);
    } else if (msg.type === 'P2P_REMATCH') {
      if (msg.deckId && this.guestInfo) this.guestInfo.deckId = msg.deckId;
      if (Array.isArray(msg.customCards) && msg.customCards.length > 0) {
        if (this.guestInfo) this.guestInfo.customCards = msg.customCards;
        registerRuntimeCards(msg.customCards);
      }
      if (msg.customDeck?.id) {
        if (this.guestInfo) this.guestInfo.customDeck = msg.customDeck;
        registerCustomDecks([msg.customDeck]);
      }
      this.beginHostP2PRps({ rematch: true, includeCustomDeck: true });
    } else if (msg.type === 'P2P_LEAVE') {
      this.destroyPeer();
      this.callbacks.onOpponentDisconnected?.('ผู้เล่นอีกฝ่ายออกจากห้องดวล P2P');
    }
  }

  beginHostP2PRps({ rematch = false, includeCustomDeck = false } = {}) {
    this.p2pHostEngine = null;
    this.p2pIsRematch = Boolean(rematch);
    this.p2pRps = new RpsSession([this.hostInfo.name, this.guestInfo.name]);
    this.syncP2PRpsState({ includeCustomDeck });
  }

  syncP2PRpsState({ includeCustomDeck = false } = {}) {
    if (!this.p2pRps) return;
    this.callbacks.onRpsState?.({
      mode: 'P2P',
      roomCode: this.roomCode,
      seat: 0,
      opponentName: this.guestInfo?.name || 'Duelist 2',
      rematch: Boolean(this.p2pIsRematch),
      rpsState: this.p2pRps.getPublicStateForSeat(0)
    });
    if (this.peerConn?.open) {
      sendPeerJson(this.peerConn, {
        type: 'P2P_RPS_STATE',
        roomCode: this.roomCode,
        seat: 1,
        opponentName: this.hostInfo?.name || 'Duelist 1',
        rematch: Boolean(this.p2pIsRematch),
        ...(includeCustomDeck ? {
          hostCustomDeck: this.hostInfo?.customDeck || null,
          hostCustomCards: this.hostInfo?.customCards || []
        } : {}),
        rpsState: this.p2pRps.getPublicStateForSeat(1)
      });
    }
  }

  startP2PDuelAfterRps(firstSeat = 0) {
    const firstPlayerIndex = firstSeat === 1 ? 1 : 0;
    const isRematch = Boolean(this.p2pIsRematch);
    this.p2pHostEngine = new DuelEngine({
      duelId: `p2p_${this.roomCode}_${Date.now()}`,
      p0Name: this.hostInfo.name,
      p0DeckId: this.hostInfo.deckId,
      p1Name: this.guestInfo.name,
      p1DeckId: this.guestInfo.deckId,
      firstPlayerIndex
    });
    const rpsSummary = this.p2pRps
      ? { winnerSeat: this.p2pRps.winnerSeat, chosenOrder: this.p2pRps.chosenOrder, firstSeat: firstPlayerIndex }
      : null;
    this.callbacks.onMatchStarted?.({
      roomCode: this.roomCode,
      playerIndex: 0,
      opponentName: this.guestInfo.name,
      mode: 'P2P',
      rematch: isRematch,
      rpsSummary
    });
    sendPeerJson(this.peerConn, {
      type: 'P2P_MATCH_STARTED',
      roomCode: this.roomCode,
      playerIndex: 1,
      opponentName: this.hostInfo.name,
      rematch: isRematch,
      rpsSummary
    });
    this.p2pRps = null;
    this.p2pIsRematch = false;
    this.syncP2PState();
  }

  handleP2PMessageAsGuest(msg) {
    if (!msg) return;
    if (msg.type === 'P2P_RPS_STATE') {
      if (Array.isArray(msg.hostCustomCards) && msg.hostCustomCards.length > 0) {
        registerRuntimeCards(msg.hostCustomCards);
      }
      if (msg.hostCustomDeck?.id) {
        registerCustomDecks([msg.hostCustomDeck]);
      }
      this.callbacks.onRpsState?.({
        mode: 'P2P',
        roomCode: msg.roomCode,
        seat: 1,
        opponentName: msg.opponentName,
        rematch: Boolean(msg.rematch),
        rpsState: msg.rpsState
      });
    } else if (msg.type === 'P2P_MATCH_STARTED') {
      if (Array.isArray(msg.hostCustomCards) && msg.hostCustomCards.length > 0) {
        registerRuntimeCards(msg.hostCustomCards);
      }
      if (msg.hostCustomDeck?.id) {
        registerCustomDecks([msg.hostCustomDeck]);
      }
      this.callbacks.onMatchStarted?.({
        roomCode: msg.roomCode,
        playerIndex: 1,
        opponentName: msg.opponentName,
        mode: 'P2P',
        rematch: Boolean(msg.rematch),
        rpsSummary: msg.rpsSummary || null
      });
    } else if (msg.type === 'P2P_STATE_SYNC') {
      this.callbacks.onStateSync?.({
        state: msg.state,
        playerIndex: 1,
        legalActions: msg.legalActions
      });
    } else if (msg.type === 'P2P_ERROR') {
      this.callbacks.onError?.(msg.errorTh);
    } else if (msg.type === 'P2P_EMOTE') {
      this.callbacks.onOpponentEmote?.(msg.emote);
    } else if (msg.type === 'P2P_LEAVE') {
      this.destroyPeer();
      this.callbacks.onOpponentDisconnected?.('โฮสต์ปิดห้องดวล P2P แล้ว');
    }
  }

  sendRpsMove(move) {
    if (this.mode === 'WS') {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'RPS_MOVE', move }));
      } else {
        this.callbacks.onError?.('กำลังเชื่อมต่อเซิร์ฟเวอร์ใหม่ กรุณารอสักครู่...');
      }
    } else if (this.mode === 'P2P') {
      if (this.playerIndex === 0 && this.p2pRps) {
        const res = this.p2pRps.submitMove(0, move);
        if (!res.ok) {
          this.callbacks.onError?.(res.error);
          return;
        }
        this.syncP2PRpsState();
      } else if (this.playerIndex === 1 && this.peerConn?.open) {
        sendPeerJson(this.peerConn, { type: 'P2P_RPS_MOVE', move });
      } else {
        this.callbacks.onError?.('การเชื่อมต่อ P2P ขาดหาย ไม่สามารถส่งคำสั่งเป่ายิ้งฉุบได้');
      }
    }
  }

  sendRpsTurnChoice(choice) {
    if (this.mode === 'WS') {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'RPS_CHOOSE_TURN', choice }));
      } else {
        this.callbacks.onError?.('กำลังเชื่อมต่อเซิร์ฟเวอร์ใหม่ กรุณารอสักครู่...');
      }
    } else if (this.mode === 'P2P') {
      if (this.playerIndex === 0 && this.p2pRps) {
        const res = this.p2pRps.chooseTurnOrder(0, choice);
        if (!res.ok) {
          this.callbacks.onError?.(res.error);
          return;
        }
        this.startP2PDuelAfterRps(res.firstSeat);
      } else if (this.playerIndex === 1 && this.peerConn?.open) {
        sendPeerJson(this.peerConn, { type: 'P2P_RPS_CHOOSE_TURN', choice });
      } else {
        this.callbacks.onError?.('การเชื่อมต่อ P2P ขาดหาย ไม่สามารถเลือกลำดับเทิร์นได้');
      }
    }
  }

  syncP2PState() {
    if (!this.p2pHostEngine) return;
    // Update Host UI
    this.callbacks.onStateSync?.({
      state: this.p2pHostEngine.state,
      playerIndex: 0,
      legalActions: this.p2pHostEngine.getLegalActions(0)
    });
    // Send to Guest UI
    if (this.peerConn?.open) {
      sendPeerJson(this.peerConn, {
        type: 'P2P_STATE_SYNC',
        state: this.p2pHostEngine.state,
        legalActions: this.p2pHostEngine.getLegalActions(1)
      });
    }
  }

  /**
   * ส่งคำสั่ง Action ระหว่างการดูเอลออนไลน์ (รองรับทั้ง WS และ P2P)
   */
  sendDuelAction(action) {
    if (this.mode === 'WS') {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'DUEL_ACTION',
          action
        }));
      } else {
        this.callbacks.onError?.('กำลังเชื่อมต่อเซิร์ฟเวอร์ใหม่ กรุณารอสักครู่...');
      }
    } else if (this.mode === 'P2P') {
      if (this.playerIndex === 0 && this.p2pHostEngine) {
        const res = this.p2pHostEngine.executeAction(0, action);
        if (!res.ok) {
          this.callbacks.onError?.(res.errorTh);
          return;
        }
        this.syncP2PState();
      } else if (this.playerIndex === 1 && this.peerConn?.open) {
        sendPeerJson(this.peerConn, {
          type: 'P2P_DUEL_ACTION',
          action
        });
      } else {
        this.callbacks.onError?.('การเชื่อมต่อ P2P ขาดหาย ไม่สามารถส่งคำสั่งได้');
      }
    }
  }

  sendRematch(deckId, customPayload = {}) {
    if (this.mode === 'WS' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'REMATCH',
        deckId,
        customDeck: customPayload.customDeck || null,
        customCards: customPayload.customCards || []
      }));
    } else if (this.mode === 'P2P') {
      if (this.playerIndex === 0 && (this.p2pHostEngine || this.peerConn?.open)) {
        if (deckId && this.hostInfo) this.hostInfo.deckId = deckId;
        if (customPayload.customCards?.length) {
          this.hostInfo.customCards = customPayload.customCards;
          registerRuntimeCards(customPayload.customCards);
        }
        if (customPayload.customDeck?.id) {
          this.hostInfo.customDeck = customPayload.customDeck;
          registerCustomDecks([customPayload.customDeck]);
        }
        this.beginHostP2PRps({ rematch: true, includeCustomDeck: true });
      } else if (this.peerConn?.open) {
        sendPeerJson(this.peerConn, {
          type: 'P2P_REMATCH',
          deckId,
          customDeck: customPayload.customDeck || null,
          customCards: customPayload.customCards || []
        });
      }
    }
  }

  sendEmote(emote) {
    if (this.mode === 'WS' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'EMOTE', emote }));
    } else if (this.mode === 'P2P' && this.peerConn?.open) {
      sendPeerJson(this.peerConn, { type: 'P2P_EMOTE', emote });
    }
  }
}
