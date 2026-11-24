/* Step-by-step soundness check: every elimination/placement must agree with the solution. */
'use strict';
const C = require('../js/core.js');
const T = require('../js/techniques.js');
const n = parseInt(process.argv[2] || '300', 10);
const rng = C.mulberry32(parseInt(process.argv[3]||"12345",10));
const used = {};
let unsolved = 0;
for (let k = 0; k < n; k++) {
  const sol = C.randomSolution(rng);
  const g = sol.slice();
  for (const i of C.shuffle([...Array(81).keys()], rng)) { const a = g[i]; g[i] = 0; if (C.solve(g, 2).count !== 1) g[i] = a; }
  const grid = g.slice(), cand = C.computeCandidates(grid);
  while (grid.some(v => !v)) {
    const st = T.findStep(grid, cand);
    if (!st) { unsolved++; break; }
    used[st.id] = (used[st.id] || 0) + 1;
    for (const p of st.placements) if (sol[p.cell] !== p.digit) throw new Error(`bad placement by ${st.id}: ${st.text}\n${C.stringify(grid)}`);
    for (const e of st.eliminations) if (sol[e.cell] === e.digit) throw new Error(`bad elimination by ${st.id}: ${st.text}\n${C.stringify(grid)}`);
    if (!st.placements.length && !st.eliminations.length) throw new Error('empty step ' + st.id);
    for (const e of st.eliminations) if (!(cand[e.cell] & (1 << e.digit))) throw new Error('no-op elim ' + st.id);
    T.applyStep(grid, cand, st);
  }
}
console.log('ok', { puzzles: n, unsolved, used });
