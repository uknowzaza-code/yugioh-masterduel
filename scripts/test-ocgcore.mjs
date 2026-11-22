import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import createCore, { OcgDuelMode, OcgLocation, OcgPosition, OcgMessageType } from 'ocgcore-wasm';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const cdbPath = path.join(rootDir, 'data', 'ygopro', 'cdb', 'cards.cdb');
const scriptPath = path.join(rootDir, 'data', 'ygopro', 'scripts');

const db = new DatabaseSync(cdbPath, { readOnly: true });
const stmt = db.prepare('SELECT id, alias, setcode, type, level, race, attribute, atk, def FROM datas WHERE id = ?');

function readCardFromCdb(code) {
  const row = stmt.get(code);
  if (!row) return null;
  const rawSetcode = BigInt(row.setcode || 0);
  const setcodes = [];
  for (let i = 0; i < 4; i++) {
    const sc = Number((rawSetcode >> BigInt(i * 16)) & 0xffffn);
    if (sc !== 0) setcodes.push(sc);
  }
  const rawLevel = Number(row.level || 0);
  return {
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
}

const core = await createCore({ sync: true });

const handle = core.createDuel({
  flags: OcgDuelMode.MODE_MR5,
  seed: [1n, 2n, 3n, 4n],
  team1: { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: 8000 },
  team2: { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: 8000 },
  cardReader: (code) => readCardFromCdb(code),
  scriptReader: (script) => {
    const candidates = [
      path.join(scriptPath, 'official', script),
      path.join(scriptPath, script)
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf8');
      }
    }
    return null;
  },
  errorHandler: (type, text) => {
    console.warn(`[OCGCORE ${type}]`, text);
  }
});

core.loadScript(handle, 'constant.lua', fs.readFileSync(path.join(scriptPath, 'constant.lua'), 'utf8'));
core.loadScript(handle, 'utility.lua', fs.readFileSync(path.join(scriptPath, 'utility.lua'), 'utf8'));

// Add 40 cards to each player (Blue-Eyes White Dragon 89631139, Ash Blossom 14558127, Raigeki 12580477, etc.)
const sampleCodes = [89631139, 14558127, 12580477, 53129443, 24224830, 8240199, 71039903, 38517737];
for (let i = 0; i < 40; i++) {
  const code = sampleCodes[i % sampleCodes.length];
  core.duelNewCard(handle, { team: 0, duelist: 0, code, controller: 0, location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE });
  core.duelNewCard(handle, { team: 1, duelist: 0, code, controller: 1, location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE });
}

core.startDuel(handle);
const status = core.duelProcess(handle);
const msgs = core.duelGetMessage(handle);
console.log('Process status:', status, 'Messages:', msgs.map(m => m.type));
const idle = msgs.find(m => m.type === OcgMessageType?.SELECT_IDLECMD || m.type === 11);
if (idle) {
  console.log('Idle commands:', {
    summons: idle.summons?.length,
    spsummons: idle.spsummons?.length,
    sets: idle.sets?.length,
    activates: idle.activates?.length,
    toBp: idle.toBp,
    toEp: idle.toEp
  });
}
core.destroyDuel(handle);
db.close();
