/**
 * @fileoverview Port-443/TLS Cloud Relay Transport (MQTT 3.1.1 over WSS)
 * Bypasses Wi-Fi AP Client Isolation (e.g. Cisco Enterprise/Campus Wi-Fi), Symmetric NAT,
 * UDP blocks, and 0.peerjs.com blocks using standard TLS WebSockets in both Node.js and Browsers.
 */

export const RELAY_BROKER_URLS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt'
];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const RELAY_CHUNK_CHARS = 7500;
let relaySeq = 0;

function encodeRemainingLength(length) {
  const bytes = [];
  let rem = length;
  do {
    let digit = rem % 128;
    rem = Math.floor(rem / 128);
    if (rem > 0) digit |= 0x80;
    bytes.push(digit);
  } while (rem > 0);
  return bytes;
}

function encodeMqttString(str) {
  const bytes = textEncoder.encode(str);
  return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
}

function buildMqttPacket(headerByte, bodyBytes) {
  const rem = encodeRemainingLength(bodyBytes.length);
  const out = new Uint8Array(1 + rem.length + bodyBytes.length);
  out[0] = headerByte;
  out.set(rem, 1);
  out.set(bodyBytes, 1 + rem.length);
  return out;
}

function buildConnectPacket(clientId) {
  // Protocol "MQTT" (level 4), Clean Session (0x02), KeepAlive 45s
  const body = new Uint8Array([
    0x00, 0x04, 0x4d, 0x51, 0x54, 0x54,
    0x04,
    0x02,
    0x00, 0x2d,
    ...encodeMqttString(clientId)
  ]);
  return buildMqttPacket(0x10, body);
}

function buildSubscribePacket(packetId, topic) {
  const body = new Uint8Array([
    (packetId >> 8) & 0xff,
    packetId & 0xff,
    ...encodeMqttString(topic),
    0x00
  ]);
  return buildMqttPacket(0x82, body);
}

function buildPublishPacket(topic, payloadString) {
  const topicPart = encodeMqttString(topic);
  const payloadBytes = textEncoder.encode(payloadString);
  const body = new Uint8Array(topicPart.length + payloadBytes.length);
  body.set(topicPart, 0);
  body.set(payloadBytes, topicPart.length);
  return buildMqttPacket(0x30, body);
}

const PINGREQ_PACKET = new Uint8Array([0xc0, 0x00]);

/**
 * Slices a string into chunks without splitting UTF-16 surrogate pairs across chunk boundaries,
 * preventing TextEncoder.encode() from replacing split surrogates with U+FFFD.
 * @param {string} str
 * @param {number} maxChunkChars
 * @returns {string[]}
 */
export function sliceUtf16Safe(str, maxChunkChars = RELAY_CHUNK_CHARS) {
  const slices = [];
  let offset = 0;
  while (offset < str.length) {
    let end = Math.min(offset + maxChunkChars, str.length);
    if (end < str.length && end > offset + 1) {
      const code = str.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) {
        end -= 1;
      }
    }
    slices.push(str.slice(offset, end));
    offset = end;
  }
  return slices;
}

function resolveDefaultBrokerUrls() {
  if (typeof globalThis !== 'undefined' && Array.isArray(globalThis.__YGO_CLOUD_RELAY_URLS) && globalThis.__YGO_CLOUD_RELAY_URLS.length > 0) {
    return globalThis.__YGO_CLOUD_RELAY_URLS;
  }
  if (typeof process !== 'undefined' && process.env?.CLOUD_RELAY_URLS) {
    const envUrls = process.env.CLOUD_RELAY_URLS.split(',').map((s) => s.trim()).filter(Boolean);
    if (envUrls.length > 0) return envUrls;
  }
  return RELAY_BROKER_URLS;
}

/**
 * Low-level MQTT-over-WSS Pub/Sub client supporting both Browser WebSocket and Node 'ws'.
 */
export class MqttWssClient {
  /**
   * @param {Object} [opts]
   * @param {typeof WebSocket} [opts.WebSocketImpl]
   * @param {typeof WebSocket} [opts.WebSocketClass]
   * @param {string[]} [opts.brokerUrls]
   * @param {string} [opts.clientIdPrefix]
   * @param {boolean} [opts.autoReconnect]
   * @param {number} [opts.reconnectRetries]
   * @param {number} [opts.reconnectDelayMs]
   * @param {number} [opts.reconnectTimeoutMs]
   */
  constructor(opts = {}) {
    this.WebSocketImpl =
      opts.WebSocketClass ||
      opts.WebSocketImpl ||
      (typeof WebSocket !== 'undefined' ? WebSocket : null);
    this.brokerUrls = Array.isArray(opts.brokerUrls) && opts.brokerUrls.length > 0
      ? opts.brokerUrls
      : resolveDefaultBrokerUrls();
    this.clientIdPrefix = String(opts.clientIdPrefix || 'ygo').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'ygo';
    this.autoReconnect = opts.autoReconnect !== false;
    this.reconnectRetries = typeof opts.reconnectRetries === 'number' ? opts.reconnectRetries : 3;
    this.reconnectDelayMs = typeof opts.reconnectDelayMs === 'number' ? opts.reconnectDelayMs : 120;
    this.reconnectTimeoutMs = typeof opts.reconnectTimeoutMs === 'number' ? opts.reconnectTimeoutMs : 2000;
    this.activeBrokerUrl = null;
    this.ws = null;
    this.connected = false;
    this.closed = false;
    this._reconnecting = false;
    this._outboundQueue = [];
    this.pingTimer = null;
    this.rxBuffer = new Uint8Array(0);
    this.packetIdSeq = 1;
    this.pendingSubAcks = new Map();
    this.topicHandlers = new Map();
    this.onDisconnect = null;
    this.onReconnect = null;
  }

  async connect(timeoutMs = 5000) {
    if (!this.WebSocketImpl) {
      throw new Error('WebSocket implementation is required for MqttWssClient');
    }
    let lastErr = null;
    for (const url of this.brokerUrls) {
      try {
        await this._connectToBroker(url, timeoutMs);
        this.activeBrokerUrl = url;
        return url;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Unable to connect to any Cloud Relay WSS broker');
  }

  _connectToBroker(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new this.WebSocketImpl(url, ['mqtt']);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      this.rxBuffer = new Uint8Array(0);

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error(`Cloud Relay connect timeout (${url})`));
      }, timeoutMs);

      const handleRawData = (rawData) => {
        if (this.ws !== ws) return;
        let chunk;
        if (rawData instanceof ArrayBuffer) {
          chunk = new Uint8Array(rawData);
        } else if (ArrayBuffer.isView(rawData)) {
          chunk = new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength);
        } else if (typeof rawData === 'string') {
          chunk = textEncoder.encode(rawData);
        } else {
          return;
        }

        const combined = new Uint8Array(this.rxBuffer.length + chunk.length);
        combined.set(this.rxBuffer, 0);
        combined.set(chunk, this.rxBuffer.length);
        this.rxBuffer = combined;

        while (this.rxBuffer.length >= 2) {
          const headerByte = this.rxBuffer[0];
          const packetType = headerByte >> 4;
          let multiplier = 1;
          let remLength = 0;
          let idx = 1;
          let encodedByte = 0;
          let incomplete = false;

          do {
            if (idx >= this.rxBuffer.length) {
              incomplete = true;
              break;
            }
            encodedByte = this.rxBuffer[idx++];
            remLength += (encodedByte & 127) * multiplier;
            multiplier *= 128;
          } while ((encodedByte & 128) !== 0 && idx <= 5);

          if (incomplete || this.rxBuffer.length < idx + remLength) {
            break;
          }

          const payload = this.rxBuffer.subarray(idx, idx + remLength);
          const remaining = this.rxBuffer.subarray(idx + remLength);
          this.rxBuffer = remaining.length > 0 ? remaining : new Uint8Array(0);

          if (packetType === 2) {
            // CONNACK
            if (payload.length >= 2 && payload[1] !== 0) {
              clearTimeout(timer);
              if (!settled) {
                settled = true;
                try { ws.close(); } catch { /* ignore */ }
                reject(new Error(`MQTT CONNACK rejected with code ${payload[1]}`));
              }
              return;
            }
            this.connected = true;
            clearTimeout(timer);
            this._startKeepalive();
            if (!settled) {
              settled = true;
              resolve(url);
            }
          } else if (packetType === 9) {
            // SUBACK
            const pktId = (payload[0] << 8) | payload[1];
            const subResolver = this.pendingSubAcks.get(pktId);
            if (subResolver) {
              this.pendingSubAcks.delete(pktId);
              subResolver();
            }
          } else if (packetType === 3) {
            // PUBLISH
            const topicLen = (payload[0] << 8) | payload[1];
            const qos = (headerByte >> 1) & 0x03;
            const msgOffset = 2 + topicLen + (qos > 0 ? 2 : 0);
            const topic = textDecoder.decode(payload.subarray(2, 2 + topicLen));
            const msgStr = textDecoder.decode(payload.subarray(msgOffset));
            this._dispatchTopicMessage(topic, msgStr);
          }
        }
      };

      const onOpen = () => {
        if (this.ws !== ws) return;
        const clientId = `${this.clientIdPrefix}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 23);
        ws.send(buildConnectPacket(clientId));
      };

      const onError = (err) => {
        if (this.ws !== ws) return;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error('WebSocket error'));
        }
      };

      const onClose = () => {
        if (this.ws !== ws) return;
        this._stopKeepalive();
        const wasConnected = this.connected;
        this.connected = false;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('WebSocket closed before CONNACK'));
        } else if (wasConnected && !this.closed) {
          this._handleUnexpectedDisconnect();
        }
      };

      if (typeof ws.addEventListener === 'function') {
        ws.addEventListener('open', onOpen);
        ws.addEventListener('message', (ev) => handleRawData(ev.data));
        ws.addEventListener('error', onError);
        ws.addEventListener('close', onClose);
      } else if (typeof ws.on === 'function') {
        ws.on('open', onOpen);
        ws.on('message', (data) => handleRawData(data));
        ws.on('error', onError);
        ws.on('close', onClose);
      }
    });
  }

  _startKeepalive() {
    this._stopKeepalive();
    this.pingTimer = setInterval(() => {
      if (this.connected && this.ws) {
        try {
          this.ws.send(PINGREQ_PACKET);
        } catch {
          // ignore
        }
      }
    }, 22000);
    if (typeof this.pingTimer?.unref === 'function') {
      this.pingTimer.unref();
    }
  }

  _stopKeepalive() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  subscribe(topic, handler, timeoutMs = 4000) {
    this.topicHandlers.set(topic, handler);
    if (!this.connected || !this.ws) {
      if (this._reconnecting) {
        return Promise.resolve();
      }
      return Promise.reject(new Error('MQTT client not connected'));
    }
    return this._sendSubscribe(topic, timeoutMs);
  }

  _sendSubscribe(topic, timeoutMs = 4000) {
    if (!this.connected || !this.ws) {
      return Promise.reject(new Error('MQTT client not connected'));
    }
    const pktId = (this.packetIdSeq = (this.packetIdSeq % 65000) + 1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSubAcks.delete(pktId);
        reject(new Error(`SUBSCRIBE timeout for ${topic}`));
      }, timeoutMs);
      this.pendingSubAcks.set(pktId, () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.send(buildSubscribePacket(pktId, topic));
    });
  }

  async _handleUnexpectedDisconnect() {
    if (this.closed || this._reconnecting) return;
    if (!this.autoReconnect || this.reconnectRetries <= 0) {
      this.onDisconnect?.();
      return;
    }
    this._reconnecting = true;
    const candidateUrls = this.activeBrokerUrl
      ? [this.activeBrokerUrl, ...this.brokerUrls.filter((u) => u !== this.activeBrokerUrl)]
      : [...this.brokerUrls];

    for (let attempt = 0; attempt < this.reconnectRetries; attempt++) {
      if (this.closed) {
        this._reconnecting = false;
        return;
      }
      const waitMs = this.reconnectDelayMs * (attempt + 1);
      await new Promise((r) => setTimeout(r, waitMs));
      if (this.closed) {
        this._reconnecting = false;
        return;
      }
      for (const url of candidateUrls) {
        if (this.closed) break;
        try {
          await this._connectToBroker(url, this.reconnectTimeoutMs);
          this.activeBrokerUrl = url;
          for (const topic of this.topicHandlers.keys()) {
            await this._sendSubscribe(topic, this.reconnectTimeoutMs);
          }
          this._reconnecting = false;
          this._flushOutboundQueue();
          this.onReconnect?.(url);
          return;
        } catch {
          // Try next broker URL or retry attempt
        }
      }
    }

    this._reconnecting = false;
    this._outboundQueue.length = 0;
    if (!this.closed) {
      this.onDisconnect?.();
    }
  }

  _flushOutboundQueue() {
    if (!this.connected || !this.ws || this._outboundQueue.length === 0) return;
    const pending = this._outboundQueue.splice(0, this._outboundQueue.length);
    for (const item of pending) {
      try {
        this.ws.send(buildPublishPacket(item.topic, item.raw));
      } catch {
        // ignore transient flush error
      }
    }
  }

  publish(topic, objOrString) {
    if (this.closed) return false;
    const raw = typeof objOrString === 'string' ? objOrString : JSON.stringify(objOrString);
    if (!this.connected || !this.ws) {
      if (this._reconnecting) {
        if (this._outboundQueue.length < 128) {
          this._outboundQueue.push({ topic, raw });
        }
        return true;
      }
      return false;
    }
    try {
      this.ws.send(buildPublishPacket(topic, raw));
      return true;
    } catch {
      if (this._reconnecting && this._outboundQueue.length < 128) {
        this._outboundQueue.push({ topic, raw });
        return true;
      }
      return false;
    }
  }

  /**
   * Publishes an arbitrarily large JSON payload by splitting into safe chunks when needed.
   */
  publishChunkedJson(topic, payloadObj) {
    if (this.closed || (!this.connected && !this._reconnecting)) return false;
    const serialized = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
    if (serialized.length <= RELAY_CHUNK_CHARS) {
      return this.publish(topic, serialized);
    }
    const chunkId = `rc_${Date.now().toString(36)}_${++relaySeq}`;
    const slices = sliceUtf16Safe(serialized, RELAY_CHUNK_CHARS);
    const total = slices.length;
    for (let index = 0; index < total; index++) {
      this.publish(topic, JSON.stringify({
        __ygoRelayChunk: { id: chunkId, index, total, slice: slices[index] }
      }));
    }
    return true;
  }

  _dispatchTopicMessage(topic, msgStr) {
    const handler = this.topicHandlers.get(topic);
    if (!handler) return;
    let parsed;
    try {
      parsed = JSON.parse(msgStr);
    } catch {
      return;
    }
    const chunk = parsed && parsed.__ygoRelayChunk;
    if (!chunk) {
      handler(parsed);
      return;
    }
    if (!this._chunkMap) this._chunkMap = new Map();
    const { id, index, total, slice } = chunk;
    if (!id || typeof index !== 'number' || typeof total !== 'number' || typeof slice !== 'string') return;
    let entry = this._chunkMap.get(id);
    if (!entry) {
      if (this._chunkMap.size > 32) {
        const oldest = this._chunkMap.keys().next().value;
        this._chunkMap.delete(oldest);
      }
      entry = { parts: new Array(total), received: 0, total };
      this._chunkMap.set(id, entry);
    }
    if (entry.parts[index] === undefined) {
      entry.parts[index] = slice;
      entry.received++;
    }
    if (entry.received >= entry.total) {
      this._chunkMap.delete(id);
      try {
        const fullObj = JSON.parse(entry.parts.join(''));
        handler(fullObj);
      } catch {
        // ignore malformed chunked json
      }
    }
  }

  close() {
    this.closed = true;
    this.connected = false;
    this._reconnecting = false;
    this._outboundQueue.length = 0;
    this._stopKeepalive();
    this.pendingSubAcks.clear();
    this.topicHandlers.clear();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}

/**
 * PeerJS DataConnection-compatible wrapper over MqttWssClient so Mode 2 (P2P) works over
 * TCP/TLS Port 443 even when 0.peerjs.com and WebRTC UDP are completely blocked.
 */
export class CloudRelayPeerConnection {
  constructor({ client, sendTopic, role, peerId = null, sessionId = null, serialization = 'json' }) {
    this.client = client;
    this.sendTopic = sendTopic;
    this.role = role;
    this.peer = peerId;
    this.sessionId = sessionId;
    this.serialization = serialization;
    this.open = true;
    this.peerConnection = null;
    this._listeners = { open: [], data: [], close: [], error: [] };

    if (this.client) {
      const prevOnDisconnect = this.client.onDisconnect;
      this.client.onDisconnect = () => {
        prevOnDisconnect?.();
        this.close({ notifyPeer: false });
      };
    }
  }

  on(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event].push(fn);
    }
  }

  emit(event, arg) {
    for (const fn of (this._listeners[event] || [])) {
      try {
        fn(arg);
      } catch (err) {
        console.error(`[CloudRelayPeerConnection:${event}]`, err);
      }
    }
  }

  _emitData(data) {
    this.emit('data', data);
  }

  send(payload) {
    if (!this.open || !this.client || this.client.closed || (!this.client.connected && !this.client._reconnecting)) {
      return false;
    }
    return this.client.publishChunkedJson(this.sendTopic, payload);
  }

  close({ notifyPeer = true } = {}) {
    if (!this.open) return;
    this.open = false;
    const client = this.client;
    this.client = null;
    if (notifyPeer && (client?.connected || client?._reconnecting)) {
      try {
        client.publish(this.sendTopic, { __ygoRelayClose: true, sessionId: this.sessionId });
      } catch {
        // ignore
      }
      const timer = setTimeout(() => client.close(), 120);
      if (typeof timer?.unref === 'function') timer.unref();
    } else {
      client?.close();
    }
    this.emit('close');
  }
}
