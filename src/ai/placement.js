import { LOC, TYPE, LINK_MARKER } from './constants.js';
import { isFaceUp, isLink } from './board.js';

/** แปลง field_mask (bit = 0 คือช่องว่างที่เลือกได้) เป็นรายการ { player, location, sequence, bit } */
export function decodeAvailablePlaces(mask, me) {
  const m = Number(mask ?? 0) >>> 0;
  const opp = 1 - me;
  const places = [];
  const check = (bit, player, location, sequence) => {
    if (((m >>> bit) & 1) === 0) {
      places.push({ player, location, sequence, bit });
    }
  };
  for (let i = 0; i < 7; i++) check(i, me, LOC.MZONE, i);
  for (let i = 0; i < 6; i++) check(8 + i, me, LOC.SZONE, i);
  for (let i = 0; i < 7; i++) check(16 + i, opp, LOC.MZONE, i);
  for (let i = 0; i < 6; i++) check(24 + i, opp, LOC.SZONE, i);
  return places;
}

/** หาช่อง MMZ (0..4) ที่ถูกชี้ด้วย Link Arrow ของมอนสเตอร์บนกระดาน */
function linkedMainMonsterZones(view) {
  const pointedByMe = new Set();
  const pointedByOpp = new Set();

  const scan = (mzone, targetSet, fromOpp) => {
    mzone.forEach((c, seq) => {
      if (!c || !isFaceUp(c) || !isLink(c)) return;
      const lm = c.linkMarkers ?? 0;
      if (!fromOpp) {
        if (seq === 5) { // EMZ ซ้าย (เหนือคอลัมน์ 1)
          if (lm & LINK_MARKER.BOTTOM_LEFT) targetSet.add(0);
          if (lm & LINK_MARKER.BOTTOM) targetSet.add(1);
          if (lm & LINK_MARKER.BOTTOM_RIGHT) targetSet.add(2);
        } else if (seq === 6) { // EMZ ขวา (เหนือคอลัมน์ 3)
          if (lm & LINK_MARKER.BOTTOM_LEFT) targetSet.add(2);
          if (lm & LINK_MARKER.BOTTOM) targetSet.add(3);
          if (lm & LINK_MARKER.BOTTOM_RIGHT) targetSet.add(4);
        } else {
          if ((lm & LINK_MARKER.LEFT) && seq > 0) targetSet.add(seq - 1);
          if ((lm & LINK_MARKER.RIGHT) && seq < 4) targetSet.add(seq + 1);
        }
      } else {
        // จากฝั่งตรงข้าม คอลัมน์กลับด้าน (4 - seq)
        if (seq === 5) { // EMZ ซ้ายของศัตรู = ตรงข้าม EMZ ขวาของเรา (คอลัมน์ 3)
          if (lm & LINK_MARKER.TOP_LEFT) targetSet.add(4);
          if (lm & LINK_MARKER.TOP) targetSet.add(3);
          if (lm & LINK_MARKER.TOP_RIGHT) targetSet.add(2);
        } else if (seq === 6) { // EMZ ขวาของศัตรู = ตรงข้าม EMZ ซ้ายของเรา (คอลัมน์ 1)
          if (lm & LINK_MARKER.TOP_LEFT) targetSet.add(2);
          if (lm & LINK_MARKER.TOP) targetSet.add(1);
          if (lm & LINK_MARKER.TOP_RIGHT) targetSet.add(0);
        }
      }
    });
  };

  scan(view.self.mzone, pointedByMe, false);
  scan(view.opp.mzone, pointedByOpp, true);
  return { pointedByMe, pointedByOpp };
}

const CENTER_ORDER = [2, 1, 3, 0, 4];

function emzOpenMmzScore(seq, view, linkMarkers = 0) {
  const targets = seq === 5
    ? [
        [LINK_MARKER.BOTTOM_LEFT, 0],
        [LINK_MARKER.BOTTOM, 1],
        [LINK_MARKER.BOTTOM_RIGHT, 2],
      ]
    : [
        [LINK_MARKER.BOTTOM_LEFT, 2],
        [LINK_MARKER.BOTTOM, 3],
        [LINK_MARKER.BOTTOM_RIGHT, 4],
      ];
  const hasBottomInfo = (linkMarkers & (LINK_MARKER.BOTTOM_LEFT | LINK_MARKER.BOTTOM | LINK_MARKER.BOTTOM_RIGHT)) !== 0;
  let openCount = 0;
  for (const [marker, mmz] of targets) {
    if (hasBottomInfo && !(linkMarkers & marker)) continue;
    if (!view.self.mzone[mmz]) openCount++;
  }
  return openCount;
}

function scorePlace(p, strategy, view, linkInfo, hasPendulum, linkMarkers) {
  if (strategy === 'first') return -p.bit;

  let score = 0;
  const centerRank = CENTER_ORDER.indexOf(p.sequence);
  if (centerRank >= 0) score += (5 - centerRank) * 10;

  if (p.player === view.me && p.location === LOC.SZONE && p.sequence < 5) {
    // ถ้ามี Pendulum ในมือ/Extra หลีกเลี่ยงช่อง Pendulum Zone (0 และ 4) เพื่อไม่ให้ขวาง Scale
    if (hasPendulum && (p.sequence === 0 || p.sequence === 4)) {
      score -= 120;
    }
  }

  if (p.player === view.me && p.location === LOC.MZONE && (p.sequence === 5 || p.sequence === 6)) {
    // เลือก EMZ ที่ลูกศรล่างชี้ไปยัง MMZ ที่ว่างมากที่สุด (สำคัญสำหรับ Pendulum / Link climbing)
    score += emzOpenMmzScore(p.sequence, view, linkMarkers) * 25;
  }

  if (strategy === 'center') {
    if (p.sequence === 5) score += 25;
    if (p.sequence === 6) score += 20;
    return score;
  }

  // tactical (Hard):
  if (p.player === view.me && p.location === LOC.SZONE && p.sequence < 5) {
    // หลีกเลี่ยงคอลัมน์ Infinite Impermanence ที่ถูกเปิดไว้ในเทิร์นนี้
    if (view.impermColumns.has(p.sequence)) score -= 500;
  }

  if (p.player === view.me && p.location === LOC.MZONE) {
    if (p.sequence < 5) {
      if (linkInfo.pointedByMe.has(p.sequence)) score += 60;
      if (linkInfo.pointedByOpp.has(p.sequence)) score -= 40;
      if (view.impermColumns.has(p.sequence)) score -= 20;
    } else {
      // เลือก EMZ ที่ไม่ตรงหน้ามอนสเตอร์/คอลัมน์อันตรายของฝั่งตรงข้าม
      const col = p.sequence === 5 ? 1 : 3;
      const oppFacing = view.opp.mzone[4 - col];
      score += oppFacing ? 10 : 40;
      if (view.impermColumns.has(col)) score -= 30;
    }
  }

  return score;
}

export function decidePlace(brain, msg, view) {
  const count = Math.max(1, Number(msg.count ?? 1));
  const available = decodeAvailablePlaces(msg.field_mask ?? 0, view.me);
  if (!available.length) {
    return { type: msg.type ?? 'SELECT_PLACE', places: [], reason: 'no-place' };
  }

  const strategy = brain.profile.placeStrategy;
  const linkInfo = strategy === 'tactical' ? linkedMainMonsterZones(view) : { pointedByMe: new Set(), pointedByOpp: new Set() };
  const hasPendulum =
    view.self.hand.some((c) => c && (c.type & TYPE.PENDULUM)) ||
    view.self.extra.some((c) => c && (c.type & TYPE.PENDULUM));
  const linkMarkers = msg.linkMarkers ?? (msg.code ? brain.kb.stats(msg.code).linkMarkers : 0);

  const ranked = [...available].sort(
    (a, b) =>
      scorePlace(b, strategy, view, linkInfo, hasPendulum, linkMarkers) -
      scorePlace(a, strategy, view, linkInfo, hasPendulum, linkMarkers)
  );
  return {
    type: msg.type ?? 'SELECT_PLACE',
    places: ranked.slice(0, count).map(({ player, location, sequence }) => ({ player, location, sequence })),
    reason: `place-${strategy}`,
  };
}
