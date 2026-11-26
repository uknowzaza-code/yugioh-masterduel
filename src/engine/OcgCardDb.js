/**
 * @fileoverview Official YGOPro Card Database (cards.cdb) & Lua Script Loader
 * ใช้ฐานข้อมูล cards.cdb และสคริปต์ Lua จาก ProjectIgnis / YGOPro
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { OcgAttribute, OcgType, cardMatchesOpcode } from 'ocgcore-wasm';
import { CARD_REGISTRY } from '../cards/index.js';
import {
  OCG_SYSTEM_STRINGS,
  OCG_SYSTEM_STRINGS_TH,
  getLocalizedOcgSystemString,
  loadStringsConf,
  createDescriptionResolver,
  genericOptionLabel
} from './ocgSystemStrings.js';

export { OCG_SYSTEM_STRINGS, OCG_SYSTEM_STRINGS_TH, getLocalizedOcgSystemString, genericOptionLabel };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..', '..');
const CDB_DIR = path.join(ROOT_DIR, 'data', 'ygopro', 'cdb');
const CDB_PATH = path.join(CDB_DIR, 'cards.cdb');
const SCRIPT_DIR = path.join(ROOT_DIR, 'data', 'ygopro', 'scripts');

const RACE_NAMES = {
  0x1: 'Warrior',
  0x2: 'Spellcaster',
  0x4: 'Fairy',
  0x8: 'Fiend',
  0x10: 'Zombie',
  0x20: 'Machine',
  0x40: 'Aqua',
  0x80: 'Pyro',
  0x100: 'Rock',
  0x200: 'Winged Beast',
  0x400: 'Plant',
  0x800: 'Insect',
  0x1000: 'Thunder',
  0x2000: 'Dragon',
  0x4000: 'Beast',
  0x8000: 'Beast-Warrior',
  0x10000: 'Dinosaur',
  0x20000: 'Fish',
  0x40000: 'Sea Serpent',
  0x80000: 'Reptile',
  0x100000: 'Psychic',
  0x200000: 'Divine-Beast',
  0x400000: 'Creator God',
  0x800000: 'Wyrm',
  0x1000000: 'Cyberse',
  0x2000000: 'Illusion'
};

let dbEntries = null;

const ocgDataCache = new Map();
const uiMetaCache = new Map();
const scriptCache = new Map();

// Build passcode -> local card registry lookup for Thai name/desc fallback
const localByPasscode = new Map();
for (const card of CARD_REGISTRY.values()) {
  if (card?.passcode) {
    localByPasscode.set(Number(card.passcode), card);
  }
}

function ensureDb() {
  if (dbEntries) return;
  dbEntries = [];

  const candidatePaths = [];
  if (fs.existsSync(CDB_PATH)) {
    candidatePaths.push(CDB_PATH);
  }
  if (fs.existsSync(CDB_DIR)) {
    const extraFiles = fs
      .readdirSync(CDB_DIR)
      .filter((name) => {
        if (!name.endsWith('.cdb') || name === 'cards.cdb') return false;
        const lower = name.toLowerCase();
        if (lower.includes('rush') || lower.includes('skill') || lower.includes('unofficial') || lower.includes('goat')) {
          return false;
        }
        return lower.startsWith('release-') || lower.startsWith('prerelease-');
      })
      .sort((a, b) => {
        const aRel = a.startsWith('release-') ? 0 : 1;
        const bRel = b.startsWith('release-') ? 0 : 1;
        return aRel - bRel || a.localeCompare(b);
      });
    for (const file of extraFiles) {
      candidatePaths.push(path.join(CDB_DIR, file));
    }
  }

  for (const dbPath of candidatePaths) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const dataStmt = db.prepare(
        'SELECT id, alias, setcode, type, level, race, attribute, atk, def FROM datas WHERE id = ?'
      );
      dataStmt.setReadBigInts(true);
      const textStmt = db.prepare(
        'SELECT id, name, desc, str1, str2, str3, str4, str5, str6, str7, str8, str9, str10, str11, str12, str13, str14, str15, str16 FROM texts WHERE id = ?'
      );
      dbEntries.push({ db, dataStmt, textStmt });
    } catch (err) {
      console.warn(`[OcgCardDb] Skipping ${path.basename(dbPath)}:`, err.message);
    }
  }
}

function queryDataRow(numCode) {
  ensureDb();
  for (const entry of dbEntries) {
    const row = entry.dataStmt.get(numCode);
    if (row) return row;
  }
  return null;
}

function queryTextRow(numCode) {
  ensureDb();
  for (const entry of dbEntries) {
    const row = entry.textStmt.get(numCode);
    if (row) return row;
  }
  return null;
}

/**
 * อ่านข้อมูลการ์ดดิบสำหรับส่งให้ ocgcore-wasm
 * @param {number} code
 */
export function readOcgCardData(code) {
  const numCode = Number(code);
  if (!numCode) return null;
  if (ocgDataCache.has(numCode)) return ocgDataCache.get(numCode);

  const row = queryDataRow(numCode);
  if (!row) {
    ocgDataCache.set(numCode, null);
    return null;
  }

  const rawSetcode = BigInt(row.setcode || 0);
  const setcodes = [];
  for (let i = 0; i < 4; i++) {
    const sc = Number((rawSetcode >> BigInt(i * 16)) & 0xffffn);
    if (sc !== 0) setcodes.push(sc);
  }

  const rawLevel = Number(row.level || 0);
  const result = {
    code: Number(row.id),
    alias: Number(row.alias || 0),
    setcodes,
    type: Number(row.type || 0),
    level: rawLevel & 0xff,
    attribute: Number(row.attribute || 0),
    race: BigInt(row.race || 0),
    attack: Number(row.atk || 0),
    defense: Number(row.def || 0),
    lscale: (rawLevel >> 24) & 0xff,
    rscale: (rawLevel >> 16) & 0xff,
    link_marker: Number(row.def || 0)
  };
  ocgDataCache.set(numCode, result);
  return result;
}

/**
 * อ่านไฟล์สคริปต์ Lua สำหรับ ocgcore-wasm
 * @param {string} scriptName
 */
export function readOcgScript(scriptName) {
  if (scriptCache.has(scriptName)) return scriptCache.get(scriptName);

  const candidates = [
    path.join(SCRIPT_DIR, 'official', scriptName),
    path.join(SCRIPT_DIR, 'pre-release', scriptName),
    path.join(SCRIPT_DIR, scriptName)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      scriptCache.set(scriptName, content);
      return content;
    }
  }
  scriptCache.set(scriptName, null);
  return null;
}

export function getCoreInitScripts() {
  return {
    constant: readOcgScript('constant.lua') || '',
    utility: readOcgScript('utility.lua') || ''
  };
}

function mapAttribute(attrMask) {
  if (attrMask & OcgAttribute.EARTH) return 'EARTH';
  if (attrMask & OcgAttribute.WATER) return 'WATER';
  if (attrMask & OcgAttribute.FIRE) return 'FIRE';
  if (attrMask & OcgAttribute.WIND) return 'WIND';
  if (attrMask & OcgAttribute.LIGHT) return 'LIGHT';
  if (attrMask & OcgAttribute.DARK) return 'DARK';
  if (attrMask & OcgAttribute.DIVINE) return 'DIVINE';
  return 'DARK';
}

function mapKindAndFrame(typeMask) {
  if (typeMask & OcgType.SPELL) {
    let subtype = 'NORMAL';
    if (typeMask & OcgType.QUICKPLAY) subtype = 'QUICK_PLAY';
    else if (typeMask & OcgType.CONTINUOUS) subtype = 'CONTINUOUS';
    else if (typeMask & OcgType.EQUIP) subtype = 'EQUIP';
    else if (typeMask & OcgType.FIELD) subtype = 'FIELD';
    else if (typeMask & OcgType.RITUAL) subtype = 'RITUAL';
    return { kind: 'SPELL', frame: 'SPELL', subtype };
  }
  if (typeMask & OcgType.TRAP) {
    let subtype = 'NORMAL';
    if (typeMask & OcgType.CONTINUOUS) subtype = 'CONTINUOUS';
    else if (typeMask & OcgType.COUNTER) subtype = 'COUNTER';
    return { kind: 'TRAP', frame: 'TRAP', subtype };
  }
  let frame = 'EFFECT';
  if (typeMask & OcgType.TOKEN) frame = 'TOKEN';
  else if (typeMask & OcgType.LINK) frame = 'LINK';
  else if (typeMask & OcgType.XYZ) frame = 'XYZ';
  else if (typeMask & OcgType.SYNCHRO) frame = 'SYNCHRO';
  else if (typeMask & OcgType.FUSION) frame = 'FUSION';
  else if (typeMask & OcgType.RITUAL) frame = 'RITUAL';
  else if ((typeMask & OcgType.NORMAL) && !(typeMask & OcgType.EFFECT)) frame = 'NORMAL';
  return { kind: 'MONSTER', frame, subtype: null };
}

function cleanCdbDescription(rawDesc) {
  if (!rawDesc) return '';
  return String(rawDesc)
    .replace(/\r\n/g, '\n')
    .replace(/\n{1,2}\*\s*The above text is unofficial and describes the card's functionality in the OCG\.?\s*$/i, '')
    .trim();
}

/**
 * ดึงข้อมูลการ์ดสำหรับแสดงผลบนหน้าเว็บ (ใช้ข้อมูล Wiki / Official English ล่าสุด)
 * @param {number} code
 */
export function getUiCardMeta(code) {
  const numCode = Number(code);
  if (!numCode) return null;
  if (uiMetaCache.has(numCode)) return uiMetaCache.get(numCode);

  ensureDb();
  const data = readOcgCardData(numCode);
  const textRow = queryTextRow(numCode);
  const local = localByPasscode.get(numCode);

  if (!data && !textRow) {
    return local || null;
  }

  const typeMask = data?.type || 0;
  const { kind, frame, subtype } = mapKindAndFrame(typeMask);
  const raceVal = Number(data?.race || 0);
  const race = RACE_NAMES[raceVal] || local?.race || 'Unknown';
  const lv = data?.level || 0;
  const isXyz = frame === 'XYZ';
  const isLink = frame === 'LINK';
  const isExtra = ['FUSION', 'SYNCHRO', 'XYZ', 'LINK'].includes(frame);

  const strings = [];
  if (textRow) {
    for (let i = 1; i <= 16; i++) {
      strings.push(textRow[`str${i}`] || '');
    }
  }

  const cdbDesc = cleanCdbDescription(textRow?.desc || '');
  const wikiOrLocalDesc = local?.description ? String(local.description).replace(/\r\n/g, '\n').trim() : '';

  const meta = {
    id: local?.id || `cdb_${numCode}`,
    passcode: String(numCode),
    name: local?.name || textRow?.name || `Card #${numCode}`,
    nameTh: local?.nameTh || local?.name || textRow?.name || `Card #${numCode}`,
    description: wikiOrLocalDesc || cdbDesc || '',
    descriptionTh: local?.descriptionTh || wikiOrLocalDesc || cdbDesc || '',
    kind,
    frame,
    subtype,
    subType: subtype,
    attribute: kind === 'MONSTER' ? mapAttribute(data?.attribute || 0) : kind,
    race,
    level: (!isXyz && !isLink) ? lv : 0,
    rank: isXyz ? lv : 0,
    linkRating: isLink ? lv : 0,
    atk: data?.attack ?? 0,
    def: isLink ? 0 : (data?.defense ?? 0),
    isTuner: Boolean(typeMask & OcgType.TUNER),
    isPendulum: Boolean(typeMask & OcgType.PENDULUM),
    isExtraDeck: isExtra,
    strings,
    effects: local?.effects || []
  };

  uiMetaCache.set(numCode, meta);
  return meta;
}

loadStringsConf(path.join(ROOT_DIR, 'data', 'ygopro', 'strings.conf'), 'en', true);
loadStringsConf(path.join(ROOT_DIR, 'data', 'ygopro', 'strings.th.conf'), 'th', true);

const resolveRawDescription = createDescriptionResolver((code, idx) => {
  const meta = getUiCardMeta(code);
  return meta?.strings?.[idx] ?? null;
});

function resolveCardNameFallback(descId, fallbackCardCode) {
  let big = 0n;
  try {
    big = BigInt(descId || 0);
  } catch {
    big = 0n;
  }
  if (big >= 0x100000n) {
    const meta20 = getUiCardMeta(Number(big >> 20n));
    if (meta20?.name) return `Activate ${meta20.name}`;
  }
  if (big >= 16n && big < 0x100000000n) {
    const meta4 = getUiCardMeta(Number(big >> 4n));
    if (meta4?.name) return `Activate ${meta4.name}`;
  }
  if (fallbackCardCode) {
    const metaFb = getUiCardMeta(fallbackCardCode);
    if (metaFb?.name) return `Activate ${metaFb.name}`;
  }
  return null;
}

/**
 * Resolve an ocgcore description ID (system string or card Stringid) into readable text.
 */
export function resolveOcgDescription(descId, fallbackCardCode = null, lang = 'en') {
  const resolved = resolveRawDescription(descId, fallbackCardCode, lang);
  if (resolved) return resolved;
  const fallbackName = resolveCardNameFallback(descId, fallbackCardCode);
  if (fallbackName) return fallbackName;
  let big = 0n;
  try {
    big = BigInt(descId || 0);
  } catch {
    big = 0n;
  }
  if (big === 0n) return getLocalizedOcgSystemString(0, lang) || 'Activate Effect';
  return `Option #${Number(big)}`;
}

/**
 * Resolve a SELECT_OPTION item into a user-friendly label (never exposes raw "Option #573").
 */
export function resolveOcgOptionLabel(descId, index = 0, lang = 'en', fallbackCardCode = 0) {
  const resolved = resolveRawDescription(descId, fallbackCardCode, lang);
  if (resolved) return resolved;
  const fallbackName = resolveCardNameFallback(descId, fallbackCardCode);
  if (fallbackName) return fallbackName;
  return genericOptionLabel(index, lang);
}

let allDbCodes = null;
const opcodeMatchCache = new Map();

/**
 * Find passcodes in cards.cdb matching an ANNOUNCE_CARD opcode filter array.
 * Checks literal passcode operands and the local card registry before scanning cards.cdb.
 * @param {Array<bigint|number|string>} opcodes
 * @param {number} [limit]
 * @returns {number[]}
 */
export function findAnnounceCardCodes(opcodes, limit = 50) {
  if (!opcodes || opcodes.length === 0) return [14558127];
  const ops = opcodes.map((op) => {
    try {
      return typeof op === 'bigint' ? op : BigInt(op);
    } catch {
      return 0n;
    }
  });
  const cacheKey = `${limit}:${ops.map(o => o.toString()).join(',')}`;
  if (opcodeMatchCache.has(cacheKey)) return opcodeMatchCache.get(cacheKey);

  const found = [];
  const seen = new Set();
  const tryCode = (rawCode) => {
    const code = Number(rawCode);
    if (!code || code <= 0 || code > 999999999 || seen.has(code)) return false;
    seen.add(code);
    const data = readOcgCardData(code);
    if (!data || (data.type & OcgType.TOKEN)) return false;
    if (cardMatchesOpcode(data, ops)) {
      found.push(code);
      return found.length >= limit;
    }
    return false;
  };

  for (const op of ops) {
    if (op > 1000n && op < 1000000000n) {
      if (tryCode(Number(op))) {
        opcodeMatchCache.set(cacheKey, found);
        return found;
      }
    }
  }

  for (const code of localByPasscode.keys()) {
    if (tryCode(code)) {
      opcodeMatchCache.set(cacheKey, found);
      return found;
    }
  }

  // Only scan the full ~13k cards.cdb table when none of the local registry/opcode cards matched
  if (found.length === 0) {
    if (!allDbCodes) {
      ensureDb();
      const idSet = new Set();
      for (const entry of dbEntries) {
        for (const r of entry.db.prepare('SELECT id FROM datas').all()) {
          idSet.add(Number(r.id));
        }
      }
      allDbCodes = Array.from(idSet);
    }
    for (const code of allDbCodes) {
      if (tryCode(code)) break;
    }
  }

  opcodeMatchCache.set(cacheKey, found);
  return found;
}
