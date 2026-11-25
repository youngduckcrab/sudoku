/* Human-style solving techniques. Each finder returns a "step" describing
 * what can be placed/eliminated and why (in Korean), or null.
 *
 * Step shape:
 * {
 *   id, name, level,
 *   placements:   [{cell, digit}],
 *   eliminations: [{cell, digit}],
 *   cells:  [cell]          // pattern cells (strong highlight)
 *   refs:   [cell]          // supporting cells (weak highlight)
 *   units:  [unit]          // houses to shade
 *   marks:  [{cell, digit, role}]   role: 'key' | 'alt' | 'elim' | 'place'
 *   summary: string         // first-level hint: where to look
 *   text:    string         // full explanation
 * }
 */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.SudokuCore;
  const { ROW, COL, BOX, UNITS, CELL_UNITS, PEERS, ALL, BITCOUNT, DIGITS, sees, cellName, unitName, cellList } = C;

  const bit = d => 1 << d;
  const has = (m, d) => (m & (1 << d)) !== 0;
  const unitKind = u => (u < 9 ? 'row' : u < 18 ? 'col' : 'box');

  function* combinations(arr, k, start = 0, acc = []) {
    if (acc.length === k) { yield acc.slice(); return; }
    for (let i = start; i <= arr.length - (k - acc.length); i++) {
      acc.push(arr[i]);
      yield* combinations(arr, k, i + 1, acc);
      acc.pop();
    }
  }

  function placedMask(s, u) {
    let m = 0;
    for (const c of UNITS[u]) if (s.grid[c]) m |= bit(s.grid[c]);
    return m;
  }
  const cellsWith = (s, u, d) => UNITS[u].filter(c => !s.grid[c] && has(s.cand[c], d));
  const empties = (s, u) => UNITS[u].filter(c => !s.grid[c]);

  /** Cells (other than `exclude`) that still have digit d and see every cell in `targets`. */
  function seeAll(s, targets, d, exclude) {
    const ex = new Set(exclude || targets);
    const out = [];
    for (let c = 0; c < 81; c++) {
      if (s.grid[c] || !has(s.cand[c], d) || ex.has(c)) continue;
      if (targets.every(t => sees(c, t))) out.push(c);
    }
    return out;
  }

  function step(o) {
    const st = Object.assign({ placements: [], eliminations: [], cells: [], refs: [], units: [], marks: [] }, o);
    st.summary = C.fixJosa(st.summary);
    st.text = C.fixJosa(st.text);
    return st;
  }

  function elimText(elims) {
    // group by digit
    const byDigit = new Map();
    for (const e of elims) {
      if (!byDigit.has(e.digit)) byDigit.set(e.digit, []);
      byDigit.get(e.digit).push(e.cell);
    }
    return [...byDigit.entries()].map(([d, cells]) => `${cellList(cells)}에서 후보 ${d}`).join(', ');
  }
  function elimTextByCell(elims) {
    const byCell = new Map();
    for (const e of elims) {
      if (!byCell.has(e.cell)) byCell.set(e.cell, []);
      byCell.get(e.cell).push(e.digit);
    }
    // group cells that lose the same digits
    const groups = new Map();
    for (const [c, ds] of byCell) {
      const key = ds.sort().join(', ');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    return [...groups.entries()].map(([ds, cells]) => `${cellList(cells)}에서 후보 ${ds}`).join('; ');
  }
  const elimMarks = elims => elims.map(e => ({ cell: e.cell, digit: e.digit, role: 'elim' }));
  const keyMarks = (cells, mask, role = 'key', s) =>
    cells.flatMap(c => DIGITS[mask & s.cand[c]].map(d => ({ cell: c, digit: d, role })));

  /* ------------------------------------------------------------------ */
  /* Level 1: singles                                                    */
  /* ------------------------------------------------------------------ */

  const UNIT_ORDER = [18, 19, 20, 21, 22, 23, 24, 25, 26, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

  function fullHouse(s) {
    for (const u of UNIT_ORDER) {
      const e = empties(s, u);
      if (e.length !== 1) continue;
      const c = e[0];
      const ds = DIGITS[ALL & ~placedMask(s, u)];
      if (ds.length !== 1 || !has(s.cand[c], ds[0])) continue;
      const d = ds[0];
      return step({
        id: 'full-house', name: '마지막 빈칸 (Full House)',
        info: { u, c, d },
        placements: [{ cell: c, digit: d }], cells: [c], units: [u],
        marks: [{ cell: c, digit: d, role: 'place' }],
        summary: `${unitName(u)}을(를) 살펴보세요. 빈칸이 하나만 남았습니다.`,
        text: `${unitName(u)}에는 빈칸이 ${cellName(c)} 하나만 남아 있습니다. 1~9 중 이 집에 아직 없는 숫자는 ${d}뿐이므로 ${cellName(c)}에 ${d}를 채울 수 있습니다.`,
      });
    }
    return null;
  }

  function hiddenSingle(s) {
    for (const u of UNIT_ORDER) {
      const placed = placedMask(s, u);
      for (let d = 1; d <= 9; d++) {
        if (has(placed, d)) continue;
        const cs = cellsWith(s, u, d);
        if (cs.length !== 1) continue;
        const c = cs[0];
        // Placed copies of d that block other cells of this unit.
        const others = empties(s, u).filter(x => x !== c);
        const blockers = [];
        for (let k = 0; k < 81; k++) if (s.grid[k] === d && others.some(o => sees(o, k))) blockers.push(k);
        return step({
          id: 'hidden-single', name: '히든 싱글 (Hidden Single)',
          info: { u, c, d, blockers },
          placements: [{ cell: c, digit: d }], cells: [c], refs: blockers, units: [u],
          marks: [{ cell: c, digit: d, role: 'place' }],
          summary: `${unitName(u)}에서 숫자 ${d}가 들어갈 자리를 찾아보세요.`,
          text: `${unitName(u)}에서 숫자 ${d}가 들어갈 수 있는 칸은 ${cellName(c)} 하나뿐입니다` +
            (blockers.length ? ` (다른 빈칸들은 ${cellList(blockers)}에 있는 ${d} 때문에 ${d}가 될 수 없습니다)` : '') +
            `. 따라서 ${cellName(c)}에 ${d}를 채웁니다.`,
        });
      }
    }
    return null;
  }

  function nakedSingle(s) {
    for (let c = 0; c < 81; c++) {
      if (s.grid[c] || BITCOUNT[s.cand[c]] !== 1) continue;
      const d = DIGITS[s.cand[c]][0];
      const seen = new Set();
      for (const p of PEERS[c]) if (s.grid[p]) seen.add(s.grid[p]);
      const seenList = [...seen].sort();
      return step({
        id: 'naked-single', name: '네이키드 싱글 (Naked Single)',
        info: { c, d },
        placements: [{ cell: c, digit: d }], cells: [c], units: CELL_UNITS[c].slice(),
        marks: [{ cell: c, digit: d, role: 'place' }],
        summary: `${cellName(c)}의 후보를 확인해 보세요.`,
        text: `${cellName(c)}에 남은 후보는 ${d} 하나뿐입니다` +
          (seenList.length ? ` (같은 행·열·박스에 ${seenList.join(', ')}이(가) 이미 있습니다)` : '') +
          `. 따라서 ${cellName(c)}에 ${d}를 채웁니다.`,
      });
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Level 2-4: intersections and subsets                                */
  /* ------------------------------------------------------------------ */

  function pointing(s) {
    for (let b = 18; b < 27; b++) {
      for (let d = 1; d <= 9; d++) {
        const cs = cellsWith(s, b, d);
        if (cs.length < 2) continue;
        for (const [kind, key] of [['row', ROW], ['col', COL]]) {
          if (!cs.every(c => key[c] === key[cs[0]])) continue;
          const line = kind === 'row' ? key[cs[0]] : 9 + key[cs[0]];
          const elims = cellsWith(s, line, d).filter(c => BOX[c] !== b - 18).map(c => ({ cell: c, digit: d }));
          if (!elims.length) continue;
          return step({
            id: 'pointing', name: '포인팅 (Pointing)',
            info: { box: b, line, d, cells: cs },
            eliminations: elims, cells: cs, units: [b, line],
            marks: cs.map(c => ({ cell: c, digit: d, role: 'key' })).concat(elimMarks(elims)),
            summary: `${unitName(b)}에서 숫자 ${d}의 위치를 살펴보세요.`,
            text: `${unitName(b)}에서 숫자 ${d}가 들어갈 수 있는 칸(${cellList(cs)})은 모두 ${unitName(line)}에 있습니다. ` +
              `따라서 ${unitName(b)}의 ${d}는 반드시 ${unitName(line)}에 놓이고, ${unitName(line)}의 박스 밖 칸에는 ${d}가 올 수 없습니다. ` +
              `→ ${elimText(elims)}를 지울 수 있습니다.`,
          });
        }
      }
    }
    return null;
  }

  function claiming(s) {
    for (let u = 0; u < 18; u++) {
      for (let d = 1; d <= 9; d++) {
        const cs = cellsWith(s, u, d);
        if (cs.length < 2 || !cs.every(c => BOX[c] === BOX[cs[0]])) continue;
        const b = 18 + BOX[cs[0]];
        const elims = cellsWith(s, b, d).filter(c => !UNITS[u].includes(c)).map(c => ({ cell: c, digit: d }));
        if (!elims.length) continue;
        return step({
          id: 'claiming', name: '클레이밍 (Claiming / 박스-라인)',
          info: { line: u, box: b, d, cells: cs },
          eliminations: elims, cells: cs, units: [u, b],
          marks: cs.map(c => ({ cell: c, digit: d, role: 'key' })).concat(elimMarks(elims)),
          summary: `${unitName(u)}에서 숫자 ${d}의 위치를 살펴보세요.`,
          text: `${unitName(u)}에서 숫자 ${d}가 들어갈 수 있는 칸(${cellList(cs)})은 모두 ${unitName(b)} 안에 있습니다. ` +
            `따라서 ${unitName(u)}의 ${d}는 반드시 ${unitName(b)}의 이 칸들 중 하나에 놓이므로, ${unitName(b)}의 나머지 칸에는 ${d}가 올 수 없습니다. ` +
            `→ ${elimText(elims)}를 지울 수 있습니다.`,
        });
      }
    }
    return null;
  }

  const SUBSET_NAMES = { 2: ['페어', 'Pair'], 3: ['트리플', 'Triple'], 4: ['쿼드', 'Quad'] };

  function nakedSubset(n) {
    return function (s) {
      for (const u of UNIT_ORDER) {
        const pool = empties(s, u).filter(c => BITCOUNT[s.cand[c]] >= 2 && BITCOUNT[s.cand[c]] <= n);
        if (pool.length < n) continue;
        for (const combo of combinations(pool, n)) {
          let m = 0;
          for (const c of combo) m |= s.cand[c];
          if (BITCOUNT[m] !== n) continue;
          // Every unit the combo cells share.
          const shared = [];
          for (const v of CELL_UNITS[combo[0]]) if (combo.every(c => UNITS[v].includes(c))) shared.push(v);
          const elims = [];
          const seen = new Set();
          for (const v of shared) for (const c of empties(s, v)) {
            if (combo.includes(c) || seen.has(c)) continue;
            seen.add(c);
            for (const d of DIGITS[s.cand[c] & m]) elims.push({ cell: c, digit: d });
          }
          if (!elims.length) continue;
          const ds = DIGITS[m];
          const [ko, en] = SUBSET_NAMES[n];
          const where = shared.map(unitName).join('와(과) ');
          return step({
            id: `naked-${en.toLowerCase()}`, name: `네이키드 ${ko} (Naked ${en})`,
            info: { unit: u, units: shared, cells: combo, digits: ds },
            eliminations: elims, cells: combo, units: shared,
            marks: keyMarks(combo, m, 'key', s).concat(elimMarks(elims)),
            summary: `${unitName(u)}에서 후보가 ${n}개 이하인 칸들을 비교해 보세요.`,
            text: `${where}의 ${n}칸 ${cellList(combo)}에 들어갈 수 있는 후보는 합쳐서 {${ds.join(', ')}} ${n}개뿐입니다. ` +
              `${n}칸에 ${n}개의 숫자가 나뉘어 들어가야 하므로, 이 숫자들은 ${where}의 다른 칸에 올 수 없습니다. ` +
              `→ ${elimTextByCell(elims)}를 지울 수 있습니다.`,
          });
        }
      }
      return null;
    };
  }

  function hiddenSubset(n) {
    return function (s) {
      for (const u of UNIT_ORDER) {
        const placed = placedMask(s, u);
        const pos = {};
        const pool = [];
        for (let d = 1; d <= 9; d++) {
          if (has(placed, d)) continue;
          const cs = cellsWith(s, u, d);
          pos[d] = cs;
          if (cs.length >= 2 && cs.length <= n) pool.push(d);
        }
        if (pool.length < n) continue;
        const nEmpty = empties(s, u).length;
        if (nEmpty <= n) continue;
        for (const combo of combinations(pool, n)) {
          const cells = new Set();
          for (const d of combo) for (const c of pos[d]) cells.add(c);
          if (cells.size !== n) continue;
          let m = 0;
          for (const d of combo) m |= bit(d);
          const cs = [...cells].sort((a, b) => a - b);
          const elims = [];
          for (const c of cs) for (const d of DIGITS[s.cand[c] & ~m]) elims.push({ cell: c, digit: d });
          if (!elims.length) continue;
          const [ko, en] = SUBSET_NAMES[n];
          return step({
            id: `hidden-${en.toLowerCase()}`, name: `히든 ${ko} (Hidden ${en})`,
            info: { unit: u, digits: combo, cells: cs },
            eliminations: elims, cells: cs, units: [u],
            marks: keyMarks(cs, m, 'key', s).concat(elimMarks(elims)),
            summary: `${unitName(u)}에서 숫자 ${combo.join(', ')}이(가) 들어갈 수 있는 칸을 살펴보세요.`,
            text: `${unitName(u)}에서 숫자 ${combo.join(', ')}이(가) 들어갈 수 있는 칸은 ${cellList(cs)} ${n}칸뿐입니다. ` +
              `${n}개의 숫자가 이 ${n}칸을 모두 차지해야 하므로, 이 칸들에는 다른 숫자가 올 수 없습니다. ` +
              `→ ${elimTextByCell(elims)}를 지울 수 있습니다.`,
          });
        }
      }
      return null;
    };
  }

  /* ------------------------------------------------------------------ */
  /* Fish                                                                */
  /* ------------------------------------------------------------------ */

  const FISH_NAMES = { 2: ['엑스윙', 'X-Wing'], 3: ['소드피시', 'Swordfish'], 4: ['젤리피시', 'Jellyfish'] };

  function fish(n) {
    return function (s) {
      for (let d = 1; d <= 9; d++) {
        for (const rowsBase of [true, false]) {
          const base = rowsBase ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [9, 10, 11, 12, 13, 14, 15, 16, 17];
          const lineOf = rowsBase ? c => 9 + COL[c] : c => ROW[c];
          const pool = [];
          const pos = {};
          for (const u of base) {
            const cs = cellsWith(s, u, d);
            if (cs.length >= 2 && cs.length <= n) { pool.push(u); pos[u] = cs; }
          }
          if (pool.length < n) continue;
          for (const combo of combinations(pool, n)) {
            const cover = new Set();
            for (const u of combo) for (const c of pos[u]) cover.add(lineOf(c));
            if (cover.size !== n) continue;
            const baseCells = combo.flatMap(u => pos[u]);
            const coverList = [...cover].sort((a, b) => a - b);
            const elims = [];
            for (const v of coverList) for (const c of cellsWith(s, v, d)) if (!baseCells.includes(c)) elims.push({ cell: c, digit: d });
            if (!elims.length) continue;
            const [ko, en] = FISH_NAMES[n];
            const bn = combo.map(unitName).join(', '), cn = coverList.map(unitName).join(', ');
            const lineWord = rowsBase ? '열' : '행';
            return step({
              id: en.toLowerCase(), name: `${ko} (${en})`,
              info: { d, base: combo, cover: coverList, cells: baseCells, pos: combo.map(u => pos[u]), rowsBase },
              eliminations: elims, cells: baseCells, units: combo.concat(coverList),
              marks: baseCells.map(c => ({ cell: c, digit: d, role: 'key' })).concat(elimMarks(elims)),
              summary: `숫자 ${d}가 들어갈 수 있는 위치를 ${rowsBase ? '행' : '열'}별로 비교해 보세요.`,
              text: `숫자 ${d}는 ${bn}에서 각각 ${cn} 위에만 올 수 있습니다 (${cellList(baseCells)}). ` +
                `이 ${n}개의 ${rowsBase ? '행' : '열'}에 들어갈 ${n}개의 ${d}가 ${cn} ${n}개의 ${lineWord}을(를) 하나씩 차지하게 되므로, ` +
                `${cn}의 다른 칸에는 ${d}가 올 수 없습니다. → ${elimText(elims)}를 지울 수 있습니다.`,
            });
          }
        }
      }
      return null;
    };
  }

  /* ------------------------------------------------------------------ */
  /* Single-digit patterns: Skyscraper, 2-String Kite, Turbot Fish       */
  /* ------------------------------------------------------------------ */

  function strongLinks(s, d) {
    const links = [];
    const seen = new Set();
    for (let u = 0; u < 27; u++) {
      const cs = cellsWith(s, u, d);
      if (cs.length !== 2) continue;
      const key = cs[0] * 81 + cs[1];
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ a: cs[0], b: cs[1], u });
    }
    return links;
  }

  function turbot(s) {
    const found = { skyscraper: null, kite: null, turbot: null };
    for (let d = 1; d <= 9; d++) {
      const links = strongLinks(s, d);
      for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++) {
        const L1 = links[i], L2 = links[j];
        const set = new Set([L1.a, L1.b, L2.a, L2.b]);
        if (set.size !== 4) continue;
        for (const [a1, b1] of [[L1.a, L1.b], [L1.b, L1.a]]) for (const [a2, b2] of [[L2.a, L2.b], [L2.b, L2.a]]) {
          if (!sees(a1, a2)) continue;
          const k1 = unitKind(L1.u), k2 = unitKind(L2.u);
          let type;
          if (k1 === k2 && k1 !== 'box') type = 'skyscraper';
          else if (((k1 === 'row' && k2 === 'col') || (k1 === 'col' && k2 === 'row')) && BOX[a1] === BOX[a2]) type = 'kite';
          else type = 'turbot';
          if (found[type]) continue;
          const elimCells = seeAll(s, [b1, b2], d, [a1, b1, a2, b2]);
          if (!elimCells.length) continue;
          const elims = elimCells.map(c => ({ cell: c, digit: d }));
          const names = {
            skyscraper: '스카이스크래퍼 (Skyscraper)',
            kite: '투 스트링 카이트 (2-String Kite)',
            turbot: '터보 피시 (Turbot Fish)',
          };
          const conn = BOX[a1] === BOX[a2] && type !== 'skyscraper' ? `같은 박스(${BOX[a1] + 1}번 박스)` :
            ROW[a1] === ROW[a2] ? `같은 행(${ROW[a1] + 1}행)` : COL[a1] === COL[a2] ? `같은 열(${COL[a1] + 1}열)` : `같은 박스(${BOX[a1] + 1}번 박스)`;
          found[type] = step({
            id: type === 'kite' ? '2-string-kite' : type, name: names[type],
            info: { d, a1, b1, a2, b2, u1: L1.u, u2: L2.u, conn },
            eliminations: elims, cells: [a1, b1, a2, b2], units: [L1.u, L2.u],
            marks: [b1, b2].map(c => ({ cell: c, digit: d, role: 'key' }))
              .concat([a1, a2].map(c => ({ cell: c, digit: d, role: 'alt' }))).concat(elimMarks(elims)),
            summary: `숫자 ${d}가 두 칸에만 들어갈 수 있는 집(${unitName(L1.u)}, ${unitName(L2.u)})을 살펴보세요.`,
            text: `숫자 ${d}는 ${unitName(L1.u)}에서 ${cellName(a1)} 또는 ${cellName(b1)}에만, ` +
              `${unitName(L2.u)}에서 ${cellName(a2)} 또는 ${cellName(b2)}에만 올 수 있습니다. ` +
              `${cellName(a1)}와 ${cellName(a2)}는 ${conn}에 있어 둘 다 ${d}일 수는 없습니다. ` +
              `따라서 둘 중 하나는 ${d}가 아니고, 그 짝인 ${cellName(b1)} 또는 ${cellName(b2)} 중 적어도 하나는 반드시 ${d}입니다. ` +
              `두 칸을 모두 보는 칸에는 ${d}가 올 수 없습니다. → ${elimText(elims)}를 지울 수 있습니다.`,
          });
        }
      }
    }
    return found.skyscraper || found.kite || found.turbot;
  }

  /* ------------------------------------------------------------------ */
  /* Wings                                                               */
  /* ------------------------------------------------------------------ */

  function bivalues(s) {
    const out = [];
    for (let c = 0; c < 81; c++) if (!s.grid[c] && BITCOUNT[s.cand[c]] === 2) out.push(c);
    return out;
  }

  function xyWing(s) {
    const bv = bivalues(s);
    for (const p of bv) {
      const pm = s.cand[p];
      const wings = bv.filter(c => c !== p && sees(c, p) && BITCOUNT[s.cand[c] & pm] === 1);
      for (const a of wings) {
        const x = s.cand[a] & pm;
        const z = s.cand[a] & ~pm;
        const want = (pm & ~x) | z;
        for (const b of wings) {
          if (b === a || s.cand[b] !== want) continue;
          const zd = DIGITS[z][0];
          const elimCells = seeAll(s, [a, b], zd, [p, a, b]);
          if (!elimCells.length) continue;
          const elims = elimCells.map(c => ({ cell: c, digit: zd }));
          const xd = DIGITS[x][0], yd = DIGITS[pm & ~x][0];
          return step({
            id: 'xy-wing', name: 'XY-윙 (XY-Wing)',
            info: { p, a, b, x: xd, y: yd, z: zd },
            eliminations: elims, cells: [p, a, b],
            marks: [{ cell: p, digit: xd, role: 'alt' }, { cell: p, digit: yd, role: 'alt' },
              { cell: a, digit: xd, role: 'alt' }, { cell: b, digit: yd, role: 'alt' },
              { cell: a, digit: zd, role: 'key' }, { cell: b, digit: zd, role: 'key' }].concat(elimMarks(elims)),
            summary: `후보가 2개인 칸 ${cellName(p)}와(과) 그 주변의 후보 2개짜리 칸들을 살펴보세요.`,
            text: `축이 되는 ${cellName(p)}의 후보는 {${xd}, ${yd}}입니다. ` +
              `${cellName(p)}가 ${xd}이면 같은 집에 있는 ${cellName(a)}(후보 ${xd}, ${zd})의 값은 ${zd}가 되고, ` +
              `${cellName(p)}가 ${yd}이면 ${cellName(b)}(후보 ${yd}, ${zd})의 값이 ${zd}가 됩니다. ` +
              `어느 경우든 ${cellName(a)}와 ${cellName(b)} 중 하나는 ${zd}이므로, 두 칸을 모두 보는 칸에는 ${zd}가 올 수 없습니다. ` +
              `→ ${elimText(elims)}를 지울 수 있습니다.`,
          });
        }
      }
    }
    return null;
  }

  function xyzWing(s) {
    const bv = bivalues(s);
    for (let p = 0; p < 81; p++) {
      if (s.grid[p] || BITCOUNT[s.cand[p]] !== 3) continue;
      const pm = s.cand[p];
      const wings = bv.filter(c => sees(c, p) && (s.cand[c] & ~pm) === 0);
      for (let i = 0; i < wings.length; i++) for (let j = i + 1; j < wings.length; j++) {
        const a = wings[i], b = wings[j];
        const am = s.cand[a], bm = s.cand[b];
        if (am === bm) continue;
        const z = am & bm;
        if (BITCOUNT[z] !== 1) continue;
        const zd = DIGITS[z][0];
        const elimCells = seeAll(s, [p, a, b], zd, [p, a, b]);
        if (!elimCells.length) continue;
        const elims = elimCells.map(c => ({ cell: c, digit: zd }));
        const pd = DIGITS[pm];
        return step({
          id: 'xyz-wing', name: 'XYZ-윙 (XYZ-Wing)',
          info: { p, a, b, z: zd },
          eliminations: elims, cells: [p, a, b],
          marks: [p, a, b].flatMap(c => DIGITS[s.cand[c]].map(d => ({ cell: c, digit: d, role: d === zd ? 'key' : 'alt' })))
            .concat(elimMarks(elims)),
          summary: `후보가 3개인 칸 ${cellName(p)}와(과) 그 주변을 살펴보세요.`,
          text: `${cellName(p)}의 후보는 {${pd.join(', ')}}이고, 이 칸이 보는 ${cellName(a)}(후보 ${DIGITS[am].join(', ')})와 ` +
            `${cellName(b)}(후보 ${DIGITS[bm].join(', ')})의 후보는 모두 그 일부입니다. ` +
            `세 칸 중 ${cellName(p)}가 ${zd}가 아니면 나머지 두 숫자를 가지는데, 그러면 두 날개 중 하나가 반드시 ${zd}가 됩니다. ` +
            `즉 세 칸 중 적어도 하나는 ${zd}이므로, 세 칸을 모두 보는 칸에는 ${zd}가 올 수 없습니다. ` +
            `→ ${elimText(elims)}를 지울 수 있습니다.`,
        });
      }
    }
    return null;
  }

  function wWing(s) {
    const bv = bivalues(s);
    for (let i = 0; i < bv.length; i++) for (let j = i + 1; j < bv.length; j++) {
      const A = bv[i], B = bv[j];
      if (s.cand[A] !== s.cand[B] || sees(A, B)) continue;
      const [d1, d2] = DIGITS[s.cand[A]];
      for (const [x, y] of [[d1, d2], [d2, d1]]) {
        const elimCells = seeAll(s, [A, B], y, [A, B]);
        if (!elimCells.length) continue;
        for (const L of strongLinks(s, x)) {
          if ([L.a, L.b].some(c => c === A || c === B)) continue;
          let p = -1, q = -1;
          if (sees(L.a, A) && sees(L.b, B)) { p = L.a; q = L.b; }
          else if (sees(L.b, A) && sees(L.a, B)) { p = L.b; q = L.a; }
          if (p < 0) continue;
          const elims = elimCells.map(c => ({ cell: c, digit: y }));
          return step({
            id: 'w-wing', name: 'W-윙 (W-Wing)',
            info: { A, B, x, y, p, q, u: L.u },
            eliminations: elims, cells: [A, B, p, q], units: [L.u],
            marks: [{ cell: A, digit: x, role: 'alt' }, { cell: B, digit: x, role: 'alt' },
              { cell: p, digit: x, role: 'alt' }, { cell: q, digit: x, role: 'alt' },
              { cell: A, digit: y, role: 'key' }, { cell: B, digit: y, role: 'key' }].concat(elimMarks(elims)),
            summary: `후보가 {${d1}, ${d2}}로 똑같은 두 칸 ${cellName(A)}, ${cellName(B)}을(를) 살펴보세요.`,
            text: `${cellName(A)}와 ${cellName(B)}의 후보는 모두 {${d1}, ${d2}}입니다. ` +
              `${unitName(L.u)}에서 숫자 ${x}는 ${cellName(p)} 또는 ${cellName(q)}에만 올 수 있는데, ${cellName(p)}는 ${cellName(A)}를, ${cellName(q)}는 ${cellName(B)}를 봅니다. ` +
              `만약 두 칸이 모두 ${x}라면 ${cellName(p)}와 ${cellName(q)} 둘 다 ${x}가 될 수 없어 모순입니다. ` +
              `따라서 ${cellName(A)}와 ${cellName(B)} 중 적어도 하나는 ${y}이므로, 두 칸을 모두 보는 칸에는 ${y}가 올 수 없습니다. ` +
              `→ ${elimText(elims)}를 지울 수 있습니다.`,
          });
        }
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Uniqueness                                                          */
  /* ------------------------------------------------------------------ */

  function uniqueRectangle(s) {
    for (let r1 = 0; r1 < 9; r1++) for (let r2 = r1 + 1; r2 < 9; r2++) {
      for (let c1 = 0; c1 < 9; c1++) for (let c2 = c1 + 1; c2 < 9; c2++) {
        const sameBand = ((r1 / 3) | 0) === ((r2 / 3) | 0), sameStack = ((c1 / 3) | 0) === ((c2 / 3) | 0);
        if (sameBand === sameStack) continue; // must span exactly two boxes
        const cells = [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
        if (cells.some(c => s.grid[c])) continue;
        const bvs = cells.filter(c => BITCOUNT[s.cand[c]] === 2);
        if (bvs.length !== 3) continue;
        const m = s.cand[bvs[0]];
        if (!bvs.every(c => s.cand[c] === m)) continue;
        const D = cells.find(c => !bvs.includes(c));
        if ((s.cand[D] & m) !== m) continue;
        const [a, b] = DIGITS[m];
        const elims = [{ cell: D, digit: a }, { cell: D, digit: b }];
        const rest = DIGITS[s.cand[D] & ~m];
        return step({
          id: 'unique-rectangle', name: '유일 사각형 (Unique Rectangle)',
          info: { cells, bvs, D, a, b },
          eliminations: elims, cells,
          marks: keyMarks(bvs, m, 'key', s).concat(elimMarks(elims)),
          summary: `후보가 {${a}, ${b}}인 칸들이 만드는 직사각형을 찾아보세요.`,
          text: `${cellList(cells)} 네 칸은 2개의 행, 2개의 열, 2개의 박스에 걸친 직사각형입니다. ` +
            `이 중 세 칸(${cellList(bvs)})의 후보가 {${a}, ${b}}뿐입니다. 만약 ${cellName(D)}도 ${a} 또는 ${b}가 된다면, ` +
            `네 칸의 ${a}와 ${b}를 서로 맞바꿔도 규칙에 맞아 답이 2개가 됩니다(치명적 패턴). ` +
            `올바른 스도쿠의 답은 하나뿐이므로 ${cellName(D)}에는 ${a}, ${b}가 아닌 숫자(${rest.length > 1 ? rest.join(', ') + ' 중 하나' : rest[0]})가 들어가야 합니다. ` +
            `→ ${cellName(D)}에서 후보 ${a}, ${b}를 지울 수 있습니다.`,
        });
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Coloring and chains                                                 */
  /* ------------------------------------------------------------------ */

  function simpleColoring(s) {
    for (let d = 1; d <= 9; d++) {
      const links = strongLinks(s, d);
      const adj = new Map();
      for (const L of links) {
        if (!adj.has(L.a)) adj.set(L.a, new Set());
        if (!adj.has(L.b)) adj.set(L.b, new Set());
        adj.get(L.a).add(L.b); adj.get(L.b).add(L.a);
      }
      const color = new Map();
      for (const start of adj.keys()) {
        if (color.has(start)) continue;
        const comp = [start];
        color.set(start, 0);
        for (let k = 0; k < comp.length; k++) {
          const n = comp[k];
          for (const m of adj.get(n)) if (!color.has(m)) { color.set(m, 1 - color.get(n)); comp.push(m); }
        }
        if (comp.length < 4) continue;
        const g0 = comp.filter(c => color.get(c) === 0), g1 = comp.filter(c => color.get(c) === 1);
        const compSet = new Set(comp);
        const compLinks = links.filter(L => compSet.has(L.a) && compSet.has(L.b)).map(L => [L.a, L.b]);
        const colorMarks = g0.map(c => ({ cell: c, digit: d, role: 'key' })).concat(g1.map(c => ({ cell: c, digit: d, role: 'alt' })));
        // Color wrap
        for (const [grp, other, label] of [[g0, g1, '파란색'], [g1, g0, '주황색']]) {
          let clash = null;
          for (let i = 0; i < grp.length && !clash; i++) for (let j = i + 1; j < grp.length; j++) if (sees(grp[i], grp[j])) { clash = [grp[i], grp[j]]; break; }
          if (!clash) continue;
          const elims = grp.map(c => ({ cell: c, digit: d }));
          return step({
            id: 'simple-coloring', name: '단순 색칠 (Simple Coloring)',
            info: { d, g0, g1, rule: 'wrap', falseGroup: grp === g0 ? 0 : 1, clash, links: compLinks },
            eliminations: elims, cells: comp,
            marks: colorMarks.filter(mk => !grp.includes(mk.cell)).concat(elimMarks(elims)),
            summary: `숫자 ${d}가 두 칸에만 들어갈 수 있는 집들을 따라 연결해 보세요.`,
            text: `숫자 ${d}가 한 집에 두 칸에만 올 수 있는 경우(강한 연결)를 이어 가며 칸을 두 색으로 번갈아 칠합니다: ` +
              `파란색 {${cellList(g0)}}, 주황색 {${cellList(g1)}}. 한 색이 모두 ${d}이면 다른 색은 모두 ${d}가 아닙니다. ` +
              `그런데 ${label} 칸 ${cellName(clash[0])}와 ${cellName(clash[1])}가 같은 집에 있어 둘 다 ${d}일 수 없으므로 ${label}은 거짓입니다. ` +
              `→ ${label} 칸들(${cellList(grp)})에서 후보 ${d}를 지울 수 있습니다 (그러면 반대 색 칸들이 ${d}가 됩니다).`,
          });
        }
        // Color trap
        const inComp = new Set(comp);
        const elimCells = [];
        for (let c = 0; c < 81; c++) {
          if (s.grid[c] || !has(s.cand[c], d) || inComp.has(c)) continue;
          if (g0.some(x => sees(x, c)) && g1.some(x => sees(x, c))) elimCells.push(c);
        }
        if (!elimCells.length) continue;
        const elims = elimCells.map(c => ({ cell: c, digit: d }));
        return step({
          id: 'simple-coloring', name: '단순 색칠 (Simple Coloring)',
          info: { d, g0, g1, rule: 'trap', links: compLinks },
          eliminations: elims, cells: comp,
          marks: colorMarks.concat(elimMarks(elims)),
          summary: `숫자 ${d}가 두 칸에만 들어갈 수 있는 집들을 따라 연결해 보세요.`,
          text: `숫자 ${d}가 한 집에 두 칸에만 올 수 있는 경우(강한 연결)를 이어 가며 칸을 두 색으로 번갈아 칠합니다: ` +
            `파란색 {${cellList(g0)}}, 주황색 {${cellList(g1)}}. 한 색이 모두 ${d}이면 다른 색은 모두 ${d}가 아니므로, ` +
            `둘 중 한 색은 반드시 전부 ${d}입니다. 파란색 칸과 주황색 칸을 동시에 보는 칸은 어느 경우든 ${d}가 될 수 없습니다. ` +
            `→ ${elimText(elims)}를 지울 수 있습니다.`,
        });
      }
    }
    return null;
  }

  const CHAIN_BUDGET = 60000;

  function xChain(s) {
    for (const maxLinks of [5, 7, 9]) {
      for (let d = 1; d <= 9; d++) {
        const links = strongLinks(s, d);
        const strong = new Map();
        for (const L of links) {
          if (!strong.has(L.a)) strong.set(L.a, new Set());
          if (!strong.has(L.b)) strong.set(L.b, new Set());
          strong.get(L.a).add(L.b); strong.get(L.b).add(L.a);
        }
        const nodes = [...strong.keys()];
        let budget = CHAIN_BUDGET;
        let result = null;
        const path = [];
        const inPath = new Set();
        // path[0] -strong- path[1] -weak- path[2] -strong- ...
        const dfs = () => {
          if (result || --budget < 0) return;
          const last = path[path.length - 1];
          const links = path.length - 1;
          if (links % 2 === 1) {
            // ended on a strong link
            if (links >= 5) {
              const elimCells = seeAll(s, [path[0], last], d, path);
              if (elimCells.length) { result = { path: path.slice(), elimCells }; return; }
            }
            if (links + 2 > maxLinks) return;
            for (const n of nodes) {
              if (inPath.has(n) || !sees(n, last)) continue;
              path.push(n); inPath.add(n);
              dfs();
              path.pop(); inPath.delete(n);
              if (result) return;
            }
          } else {
            for (const n of strong.get(last)) {
              if (inPath.has(n)) continue;
              path.push(n); inPath.add(n);
              dfs();
              path.pop(); inPath.delete(n);
              if (result) return;
            }
          }
        };
        for (const start of nodes) {
          path.length = 0; inPath.clear();
          path.push(start); inPath.add(start);
          dfs();
          if (result) break;
        }
        if (!result) continue;
        const p = result.path;
        const elims = result.elimCells.map(c => ({ cell: c, digit: d }));
        const proof = p.map((c, i) => `${cellName(c)}${i % 2 === 0 ? '≠' : '='}${d}`).join(' ⇒ ');
        return step({
          id: 'x-chain', name: 'X-체인 (X-Chain)',
          info: { d, path: p },
          eliminations: elims, cells: p,
          marks: p.map((c, i) => ({ cell: c, digit: d, role: i === 0 || i === p.length - 1 ? 'key' : 'alt' }))
            .concat(elimMarks(elims)),
          summary: `숫자 ${d}의 강한 연결(한 집에 두 칸뿐인 경우)과 약한 연결을 번갈아 이어 보세요.`,
          text: `숫자 ${d}로 이어진 체인을 봅니다: ${cellList(p)}. ` +
            `시작 칸 ${cellName(p[0])}가 ${d}가 아니라고 가정하면: ${proof}. ` +
            `즉 양 끝 ${cellName(p[0])}와 ${cellName(p[p.length - 1])} 중 적어도 하나는 반드시 ${d}입니다. ` +
            `두 끝을 모두 보는 칸에는 ${d}가 올 수 없습니다. → ${elimText(elims)}를 지울 수 있습니다.`,
        });
      }
    }
    return null;
  }

  function xyChain(s) {
    const bv = bivalues(s);
    for (const maxLen of [4, 6, 8]) {
      let budget = CHAIN_BUDGET;
      let result = null;
      const path = [];
      const digitsIn = []; // digit "entering" each cell is false, other is true
      const inPath = new Set();
      const dfs = (z, x) => {
        // current last cell's true digit is x
        if (result || --budget < 0) return;
        const last = path[path.length - 1];
        if (x === z && path.length >= 3) {
          const elimCells = seeAll(s, [path[0], last], z, path);
          if (elimCells.length) { result = { path: path.slice(), z, digits: digitsIn.slice() }; result.elimCells = elimCells; return; }
        }
        if (path.length >= maxLen) return;
        for (const n of bv) {
          if (inPath.has(n) || !sees(n, last) || !has(s.cand[n], x)) continue;
          const nx = DIGITS[s.cand[n] & ~bit(x)][0];
          path.push(n); inPath.add(n); digitsIn.push(x);
          dfs(z, nx);
          path.pop(); inPath.delete(n); digitsIn.pop();
          if (result) return;
        }
      };
      for (const start of bv) {
        for (const z of DIGITS[s.cand[start]]) {
          const x = DIGITS[s.cand[start] & ~bit(z)][0];
          path.length = 0; inPath.clear(); digitsIn.length = 0;
          path.push(start); inPath.add(start); digitsIn.push(z);
          dfs(z, x);
          if (result) break;
        }
        if (result) break;
      }
      if (!result) continue;
      const { path: p, z } = result;
      const elims = result.elimCells.map(c => ({ cell: c, digit: z }));
      const vals = p.map(c => DIGITS[s.cand[c]]);
      // true digit in cell i (under assumption start != z)
      const trueDigits = [];
      let x = z;
      for (let i = 0; i < p.length; i++) {
        const t = DIGITS[s.cand[p[i]] & ~bit(x)][0];
        trueDigits.push(t);
        x = t;
      }
      const proof = p.map((c, i) => `${cellName(c)}=${trueDigits[i]}`).join(' ⇒ ');
      return step({
        id: 'xy-chain', name: 'XY-체인 (XY-Chain)',
        info: { z, path: p },
        eliminations: elims, cells: p,
        marks: p.flatMap((c, i) => vals[i].map(d => ({ cell: c, digit: d, role: (i === 0 || i === p.length - 1) && d === z ? 'key' : 'alt' })))
          .concat(elimMarks(elims)),
        summary: `후보가 2개인 칸들을 사슬처럼 이어 보세요 (숫자 ${z}에 주목).`,
        text: `후보가 2개인 칸들을 이은 사슬을 봅니다: ${p.map((c, i) => `${cellName(c)}{${vals[i].join(',')}}`).join(' → ')}. ` +
          `첫 칸 ${cellName(p[0])}가 ${z}가 아니라고 가정하면: ${proof}. ` +
          `즉 양 끝 ${cellName(p[0])}와 ${cellName(p[p.length - 1])} 중 적어도 하나는 반드시 ${z}입니다. ` +
          `두 끝을 모두 보는 칸에는 ${z}가 올 수 없습니다. → ${elimText(elims)}를 지울 수 있습니다.`,
      });
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Driver                                                              */
  /* ------------------------------------------------------------------ */

  const TECHNIQUES = [
    [fullHouse, 1], [hiddenSingle, 1], [nakedSingle, 1],
    [pointing, 2], [claiming, 2], [nakedSubset(2), 2], [hiddenSubset(2), 2],
    [nakedSubset(3), 3], [hiddenSubset(3), 3],
    [fish(2), 4], [turbot, 4], [xyWing, 4], [nakedSubset(4), 4], [hiddenSubset(4), 4],
    [xyzWing, 5], [wWing, 5], [fish(3), 5], [uniqueRectangle, 5], [simpleColoring, 5],
    [fish(4), 6], [xChain, 6], [xyChain, 6],
  ];

  function findStep(grid, cand) {
    const s = { grid, cand };
    for (const [fn, level] of TECHNIQUES) {
      const st = fn(s);
      if (st) { st.level = level; return st; }
    }
    return null;
  }

  function applyStep(grid, cand, st) {
    for (const { cell, digit } of st.placements) {
      grid[cell] = digit;
      cand[cell] = 0;
      for (const p of PEERS[cell]) cand[p] &= ~bit(digit);
    }
    for (const { cell, digit } of st.eliminations) cand[cell] &= ~bit(digit);
  }

  /** Solve with techniques only; used for grading. */
  function solveLogically(puzzle, opts) {
    const grid = typeof puzzle === 'string' ? C.parse(puzzle) : puzzle.slice();
    const cand = C.computeCandidates(grid);
    const steps = [];
    let maxLevel = 0;
    const counts = {};
    const maxSteps = (opts && opts.maxSteps) || 1000;
    while (grid.some(v => !v) && steps.length < maxSteps) {
      const st = findStep(grid, cand);
      if (!st) break;
      applyStep(grid, cand, st);
      steps.push(opts && opts.keepSteps ? st : st.id);
      maxLevel = Math.max(maxLevel, st.level);
      counts[st.id] = (counts[st.id] || 0) + 1;
    }
    return { solved: grid.every(v => v), grid, steps, maxLevel, counts };
  }

  const api = { findStep, applyStep, solveLogically, TECHNIQUES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SudokuTechniques = api;
})(typeof self !== 'undefined' ? self : this);
