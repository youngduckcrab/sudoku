/* Puzzle generator + grader shared by the app and tools/generate.js. */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('./core.js') : root.SudokuCore;
  const T = isNode ? require('./techniques.js') : root.SudokuTechniques;

  const SINGLES = ['full-house', 'hidden-single', 'naked-single'];

  /** Map a solveLogically result to a difficulty label. */
  function grade(r) {
    if (!r.solved) return 'unsolvable';
    if (r.maxLevel <= 1) return 'easy';
    if (r.maxLevel >= 4) return 'expert';
    const advanced = Object.entries(r.counts).filter(([id]) => !SINGLES.includes(id)).reduce((a, [, n]) => a + n, 0);
    if (r.maxLevel === 3 || advanced >= 3) return 'hard';
    return 'medium';
  }

  /** Random minimal-ish puzzle with 180° symmetry and a unique solution. */
  function makePuzzle(rng) {
    const sol = C.randomSolution(rng);
    const g = sol.slice();
    for (const i of C.shuffle([...Array(41).keys()], rng)) {
      const j = 80 - i, a = g[i], b = g[j];
      g[i] = 0; g[j] = 0;
      if (C.solve(g, 2).count !== 1) { g[i] = a; g[j] = b; }
    }
    return { puzzle: g, solution: sol };
  }

  /** Try to generate a puzzle of `level` within `budgetMs`. Returns {puzzle, solution, result} or null. */
  function generate(level, rng, budgetMs) {
    const t0 = Date.now();
    do {
      const p = makePuzzle(rng);
      const r = T.solveLogically(p.puzzle);
      if (grade(r) === level) return Object.assign(p, { result: r });
    } while (Date.now() - t0 < budgetMs);
    return null;
  }

  /** Pick from the pre-built bank and shuffle it into an equivalent new puzzle. */
  function fromBank(bank, level, rng) {
    const list = bank[level];
    const src = list[Math.floor(rng() * list.length)];
    const puzzle = C.transform(src, rng);
    return { puzzle, solution: C.solve(puzzle, 1).solution };
  }

  const api = { grade, makePuzzle, generate, fromBank };
  if (isNode) module.exports = api; else root.SudokuGenerator = api;
})(typeof self !== 'undefined' ? self : this);
