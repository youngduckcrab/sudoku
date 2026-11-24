/* Sudoku core: board geometry, candidates, backtracking solver, transforms.
 * Works in the browser (window.SudokuCore) and in Node (module.exports). */
(function (root) {
  'use strict';

  const ROW = new Array(81), COL = new Array(81), BOX = new Array(81);
  for (let i = 0; i < 81; i++) {
    ROW[i] = (i / 9) | 0;
    COL[i] = i % 9;
    BOX[i] = ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0);
  }

  // Units: 0-8 rows, 9-17 columns, 18-26 boxes.
  const UNITS = [];
  for (let r = 0; r < 9; r++) UNITS.push([0, 1, 2, 3, 4, 5, 6, 7, 8].map(c => r * 9 + c));
  for (let c = 0; c < 9; c++) UNITS.push([0, 1, 2, 3, 4, 5, 6, 7, 8].map(r => r * 9 + c));
  for (let b = 0; b < 9; b++) {
    const r0 = ((b / 3) | 0) * 3, c0 = (b % 3) * 3, cells = [];
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) cells.push((r0 + dr) * 9 + c0 + dc);
    UNITS.push(cells);
  }
  const CELL_UNITS = [];
  for (let i = 0; i < 81; i++) CELL_UNITS.push([ROW[i], 9 + COL[i], 18 + BOX[i]]);

  const SEE = new Uint8Array(81 * 81);
  const PEERS = [];
  for (let i = 0; i < 81; i++) {
    const p = [];
    for (let j = 0; j < 81; j++) {
      if (i !== j && (ROW[i] === ROW[j] || COL[i] === COL[j] || BOX[i] === BOX[j])) {
        SEE[i * 81 + j] = 1;
        p.push(j);
      }
    }
    PEERS.push(p);
  }
  const sees = (a, b) => SEE[a * 81 + b] === 1;

  const ALL = 0x3fe; // bits 1..9
  const BITCOUNT = new Uint8Array(1024);
  const DIGITS = [];
  for (let m = 0; m < 1024; m++) {
    const ds = [];
    for (let d = 1; d <= 9; d++) if (m & (1 << d)) ds.push(d);
    DIGITS.push(ds);
    BITCOUNT[m] = ds.length;
  }

  function parse(str) {
    const g = new Array(81);
    for (let i = 0; i < 81; i++) {
      const ch = str[i];
      g[i] = ch >= '1' && ch <= '9' ? ch.charCodeAt(0) - 48 : 0;
    }
    return g;
  }
  const stringify = g => g.map(v => (v ? String(v) : '.')).join('');

  function computeCandidates(grid) {
    const cand = new Array(81).fill(0);
    for (let i = 0; i < 81; i++) {
      if (grid[i]) continue;
      let m = ALL;
      const p = PEERS[i];
      for (let k = 0; k < p.length; k++) {
        const v = grid[p[k]];
        if (v) m &= ~(1 << v);
      }
      cand[i] = m;
    }
    return cand;
  }

  /** Cells whose value clashes with a peer. */
  function conflicts(grid) {
    const bad = new Set();
    for (let i = 0; i < 81; i++) {
      if (!grid[i]) continue;
      for (const j of PEERS[i]) if (grid[j] === grid[i]) { bad.add(i); bad.add(j); }
    }
    return bad;
  }

  /** Backtracking solver. Returns {count, solution} counting up to `limit` solutions. */
  function solve(grid, limit, rng) {
    limit = limit || 2;
    const g = grid.slice();
    const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
    for (let i = 0; i < 81; i++) {
      const v = g[i];
      if (!v) continue;
      const b = 1 << v;
      if ((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & b) return { count: 0, solution: null };
      rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b;
    }
    let count = 0, solution = null;

    function rec() {
      let best = -1, bestMask = 0, bestCount = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const m = ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]);
        const c = BITCOUNT[m];
        if (c < bestCount) {
          best = i; bestMask = m; bestCount = c;
          if (c <= 1) break;
        }
      }
      if (best < 0) {
        count++;
        if (!solution) solution = g.slice();
        return count >= limit;
      }
      if (bestCount === 0) return false;
      let ds = DIGITS[bestMask];
      if (rng) {
        ds = ds.slice();
        for (let k = ds.length - 1; k > 0; k--) {
          const j = Math.floor(rng() * (k + 1));
          [ds[k], ds[j]] = [ds[j], ds[k]];
        }
      }
      const r = ROW[best], c = COL[best], bx = BOX[best];
      for (const d of ds) {
        const b = 1 << d;
        g[best] = d; rows[r] |= b; cols[c] |= b; boxes[bx] |= b;
        if (rec()) return true;
        g[best] = 0; rows[r] &= ~b; cols[c] &= ~b; boxes[bx] &= ~b;
      }
      return false;
    }
    rec();
    return { count, solution };
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (let k = arr.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [arr[k], arr[j]] = [arr[j], arr[k]];
    }
    return arr;
  }

  function randomSolution(rng) {
    return solve(new Array(81).fill(0), 1, rng).solution;
  }

  /** Validity-preserving shuffle: relabel digits, permute rows/cols within bands, permute bands, transpose. */
  function transform(puzzle, rng) {
    const g = typeof puzzle === 'string' ? parse(puzzle) : puzzle;
    const digitMap = [0].concat(shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng));
    const perm = () => {
      const bands = shuffle([0, 1, 2], rng), out = [];
      for (const b of bands) for (const k of shuffle([0, 1, 2], rng)) out.push(b * 3 + k);
      return out;
    };
    const rp = perm(), cp = perm(), tr = rng() < 0.5;
    const out = new Array(81);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      let sr = rp[r], sc = cp[c];
      if (tr) [sr, sc] = [sc, sr];
      out[r * 9 + c] = digitMap[g[sr * 9 + sc]];
    }
    return out;
  }

  const cellName = i => `${ROW[i] + 1}행${COL[i] + 1}열`;
  const unitName = u => (u < 9 ? `${u + 1}행` : u < 18 ? `${u - 8}열` : `${u - 17}번 박스`);
  const cellList = cells => cells.map(cellName).join(', ');
  const digitList = ds => ds.join(', ');

  /* Korean particle (조사) correction after digits and cell/unit names,
   * e.g. "6가" → "6이", "3행9열와" → "3행9열과", "1를" → "1을". */
  const DIGIT_FINAL = { 0: 1, 1: 2, 2: 0, 3: 1, 4: 0, 5: 0, 6: 1, 7: 2, 8: 2, 9: 0 }; // 0 none, 1 consonant, 2 ㄹ
  function finalOf(ch) {
    if (ch >= '0' && ch <= '9') return DIGIT_FINAL[ch];
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return -1;
    const jong = code % 28;
    return jong === 0 ? 0 : jong === 8 ? 2 : 1;
  }
  const PARTICLES = [['이(가)', '이', '가'], ['을(를)', '을', '를'], ['은(는)', '은', '는'], ['와(과)', '과', '와'],
    ['이', '이', '가'], ['가', '이', '가'], ['을', '을', '를'], ['를', '을', '를'], ['은', '은', '는'], ['는', '은', '는'],
    ['과', '과', '와'], ['와', '과', '와']];
  const JOSA_RE = /([0-9열행스])([)}]?)(이\(가\)|을\(를\)|은\(는\)|와\(과\)|이|가|을|를|은|는|과|와)(?=[\s.,:;)→]|$)/g;
  function fixJosa(text) {
    return text.replace(JOSA_RE, (m, ch, br, pt) => {
      const f = finalOf(ch);
      if (f < 0) return m;
      const row = PARTICLES.find(r => r[0] === pt);
      return ch + br + (f ? row[1] : row[2]);
    });
  }

  const api = {
    ROW, COL, BOX, UNITS, CELL_UNITS, PEERS, ALL, BITCOUNT, DIGITS,
    sees, parse, stringify, computeCandidates, conflicts, solve, mulberry32, shuffle,
    randomSolution, transform, cellName, unitName, cellList, digitList, fixJosa,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SudokuCore = api;
})(typeof self !== 'undefined' ? self : this);
