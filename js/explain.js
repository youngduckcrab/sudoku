/* Step-by-step visual explanations for hints.
 *
 * Every hint is turned into a list of pages. Each page has a short text and the
 * complete picture to draw for it (pictures build up page by page):
 *   units:   houses to shade
 *   cells:   cells to outline
 *   refs:    supporting cells (light shade)
 *   marks:   [{cell, digit, role}]   role: key (is the digit) | off (is NOT the digit)
 *                                     | alt (related candidate) | node (neutral) | elim
 *   links:   [{a:{cell,digit}, b:{cell,digit}, type}]
 *            type: strong (solid) | weak (dashed) | arrow (implication) | band (group)
 *                  | ray (blocking line) | elim (to a removed candidate) | frame
 *   crosses: [cell]   cells ruled out (drawn as ✕)
 *   place:   [{cell, digit}]   digit to fill (conclusion only)
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('./core.js') : root.SudokuCore;
  const { ROW, COL, BOX, UNITS, CELL_UNITS, PEERS, DIGITS, sees, fixJosa } = C;
  const N = C.cellName, U = C.unitName, L = C.cellList;
  const has = (m, d) => (m & (1 << d)) !== 0;
  const KEYS = ['units', 'cells', 'refs', 'marks', 'links', 'crosses', 'place'];

  const mk = (cell, digit, role) => ({ cell, digit, role });
  const lk = (c1, d1, c2, d2, type) => ({ a: { cell: c1, digit: d1 }, b: { cell: c2, digit: d2 }, type });
  const empty = () => ({ units: [], cells: [], refs: [], marks: [], links: [], crosses: [], place: [] });

  function Builder() { this.pages = []; this.state = empty(); }
  /** Add a page. `add` is merged into the picture so far; marks on the same candidate are replaced. */
  Builder.prototype.page = function (text, add, opts) {
    opts = opts || {};
    const next = {};
    const prev = opts.reset ? empty() : this.state;
    for (const k of KEYS) next[k] = prev[k].slice();
    if (opts.clearLinks) next.links = [];
    if (add) for (const k of Object.keys(add)) {
      if (k === 'marks') {
        for (const m of add.marks) {
          const i = next.marks.findIndex(x => x.cell === m.cell && x.digit === m.digit);
          if (i >= 0) next.marks[i] = m; else next.marks.push(m);
        }
      } else next[k] = next[k].concat(add[k]);
    }
    this.state = next;
    this.pages.push(Object.assign({ text: fixJosa(text), lead: opts.lead || '', conclusion: !!opts.conclusion }, next));
    return this;
  };

  /** Wording of the conclusion, reused from the technique's own text. */
  function conclusionText(step) {
    const t = fixJosa(step.text);
    const i = t.lastIndexOf('→');
    return i >= 0 ? t.slice(i + 1).trim() : '';
  }
  function elimLinks(step, targets, digitOf) {
    const out = [];
    const cells = [...new Set(step.eliminations.map(e => e.cell))].slice(0, 6);
    for (const c of cells) {
      const ds = step.eliminations.filter(e => e.cell === c).map(e => e.digit);
      for (const t of targets) {
        const d = digitOf ? digitOf(t) : ds[0];
        if (ds.includes(d) && sees(c, t)) out.push(lk(t, d, c, d, 'elim'));
      }
    }
    return out;
  }
  function finish(b, step, text, extra) {
    const add = Object.assign({ marks: step.eliminations.map(e => mk(e.cell, e.digit, 'elim')), place: step.placements }, extra || {});
    if (add.extraMarks) { add.marks = add.extraMarks.concat(add.marks); delete add.extraMarks; }
    const c = conclusionText(step);
    b.page(text ? `${text} → ${c}` : c, add, { conclusion: true, lead: '결론' });
  }
  function placeConclusion(b, step) {
    const p = step.placements[0];
    b.page(`${N(p.cell)}에 ${p.digit}을(를) 채울 수 있습니다.`, { place: step.placements, marks: [mk(p.cell, p.digit, 'key')] }, { conclusion: true, lead: '결론' });
  }
  function sameHouse(a, b) {
    if (ROW[a] === ROW[b]) return `같은 행(${ROW[a] + 1}행)`;
    if (COL[a] === COL[b]) return `같은 열(${COL[a] + 1}열)`;
    return `같은 박스(${BOX[a] + 1}번 박스)`;
  }
  /** House in which a and b are the only two places for d (a strong link). */
  function strongUnit(cand, a, b, d) {
    for (const u of CELL_UNITS[a]) {
      if (!UNITS[u].includes(b)) continue;
      if (UNITS[u].filter(c => has(cand[c], d)).length === 2) return u;
    }
    return CELL_UNITS[a].find(u => UNITS[u].includes(b));
  }
  const digitsOf = (cand, c) => DIGITS[cand[c]];
  const brace = ds => `{${ds.join(', ')}}`;

  /* ------------------------------------------------------------------ */

  const BUILDERS = {
    'full-house'(b, s, info) {
      const { u, c, d } = info;
      b.page(`${U(u)}을(를) 보세요. 빈칸이 ${N(c)} 하나만 남았습니다.`, { units: [u], cells: [c] }, { lead: '살펴볼 곳' });
      b.page(`1~9 중 ${U(u)}에 아직 없는 숫자는 ${d}뿐입니다.`, {});
      placeConclusion(b, s);
    },

    'hidden-single'(b, s, info, cand, grid) {
      const { u, c, d, blockers } = info;
      b.page(`${U(u)}에서 숫자 ${d}가 들어갈 자리를 찾아봅시다.`, { units: [u] }, { lead: '살펴볼 곳' });
      const others = UNITS[u].filter(x => !grid[x] && x !== c);
      if (blockers.length) {
        const links = [];
        for (const k of blockers) {
          const hit = others.filter(x => sees(k, x));
          if (!hit.length) continue;
          const line = hit.every(x => ROW[x] === ROW[k]) || hit.every(x => COL[x] === COL[k]);
          if (line) {
            const far = hit.reduce((a, x) => (Math.abs(ROW[x] - ROW[k]) + Math.abs(COL[x] - COL[k]) > Math.abs(ROW[a] - ROW[k]) + Math.abs(COL[a] - COL[k]) ? x : a));
            links.push(lk(k, 0, far, 0, 'ray'));
          } else for (const x of hit) links.push(lk(k, 0, x, 0, 'ray'));
        }
        const covered = others.filter(x => blockers.some(k => sees(k, x)));
        const rest = others.filter(x => !covered.includes(x));
        b.page(`${L(blockers)}에 이미 ${d}가 있습니다. 같은 행·열·박스에는 ${d}가 두 번 올 수 없으니, ✕ 표시한 칸에는 ${d}가 올 수 없습니다.` +
          (rest.length ? ` (${L(rest)}은(는) 후보에 ${d}가 없습니다.)` : ''),
        { refs: blockers, crosses: others, links });
      } else {
        b.page(`${U(u)}의 다른 빈칸들은 후보에 ${d}가 없습니다.`, { crosses: others });
      }
      b.page(`${U(u)}에서 ${d}가 들어갈 수 있는 칸은 ${N(c)} 하나만 남습니다.`, { cells: [c], marks: [mk(c, d, 'key')] });
      placeConclusion(b, s);
    },

    'naked-single'(b, s, info, cand, grid) {
      const { c, d } = info;
      b.page(`${N(c)}을(를) 봅시다.`, { cells: [c], units: CELL_UNITS[c].slice() }, { lead: '살펴볼 곳' });
      const refs = PEERS[c].filter(p => grid[p]);
      const seen = [...new Set(refs.map(p => grid[p]))].sort();
      const gone = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(x => x !== d && !seen.includes(x));
      b.page(`같은 행·열·박스에 이미 ${seen.join(', ')}이(가) 있습니다.` + (gone.length ? ` ${gone.join(', ')}도 후보에서 지워져 있습니다.` : ''), { refs });
      b.page(`그래서 ${N(c)}에 남은 후보는 ${d} 하나뿐입니다.`, { marks: [mk(c, d, 'key')] });
      placeConclusion(b, s);
    },

    pointing(b, s, info) {
      const { box, line, d, cells } = info;
      b.page(`${U(box)}에서 숫자 ${d}의 자리를 살펴봅시다.`, { units: [box] }, { lead: '살펴볼 곳' });
      b.page(`${U(box)}에서 ${d}가 들어갈 수 있는 칸은 ${L(cells)}뿐이고, 모두 ${U(line)} 위에 있습니다.`,
        { cells, marks: cells.map(c => mk(c, d, 'key')), links: [lk(cells[0], d, cells[cells.length - 1], d, 'band')] });
      b.page(`그러니 ${U(box)}의 ${d}는 반드시 ${U(line)}의 이 칸들 중 하나에 들어갑니다. ${U(line)}의 ${d}가 이 박스 안에서 정해지는 셈이라, ${U(line)}의 박스 밖 칸에는 ${d}가 올 수 없습니다.`,
        { units: [line] });
      finish(b, s, '', { links: elimLinks(s, [cells[0]]) });
    },

    claiming(b, s, info) {
      const { line, box, d, cells } = info;
      b.page(`${U(line)}에서 숫자 ${d}의 자리를 살펴봅시다.`, { units: [line] }, { lead: '살펴볼 곳' });
      b.page(`${U(line)}에서 ${d}가 들어갈 수 있는 칸은 ${L(cells)}뿐이고, 모두 ${U(box)} 안에 있습니다.`,
        { cells, marks: cells.map(c => mk(c, d, 'key')), links: [lk(cells[0], d, cells[cells.length - 1], d, 'band')] });
      b.page(`그러니 ${U(line)}의 ${d}는 반드시 ${U(box)}의 이 칸들 중 하나입니다. ${U(box)}의 ${d}도 여기서 정해지므로, ${U(box)}의 나머지 칸에는 ${d}가 올 수 없습니다.`,
        { units: [box] });
      finish(b, s, '');
    },

    naked(b, s, info, cand) {
      const { unit, units, cells, digits } = info;
      const n = cells.length;
      const m = digits.reduce((a, d) => a | (1 << d), 0);
      b.page(`${U(unit)}에서 후보가 적은 칸들을 비교해 봅시다.`, { units: [unit] }, { lead: '살펴볼 곳' });
      b.page(`${cells.map(c => `${N(c)}${brace(digitsOf(cand, c))}`).join(', ')} — 이 ${n}칸의 후보를 모두 모으면 ${brace(digits)} ${n}개뿐입니다.`,
        { cells, marks: cells.flatMap(c => DIGITS[cand[c] & m].map(d => mk(c, d, 'key'))) });
      b.page(`${n}칸에 ${n}개의 숫자가 하나씩 들어가야 하므로 ${brace(digits)}는 이 칸들이 모두 차지합니다. 따라서 ${units.map(U).join('와(과) ')}의 다른 칸에는 이 숫자들이 올 수 없습니다.`,
        { units });
      finish(b, s, '');
    },

    hidden(b, s, info, cand) {
      const { unit, digits, cells } = info;
      const n = cells.length;
      const m = digits.reduce((a, d) => a | (1 << d), 0);
      b.page(`${U(unit)}에서 숫자 ${digits.join(', ')}의 자리를 찾아봅시다.`, { units: [unit] }, { lead: '살펴볼 곳' });
      b.page(`${U(unit)}에서 ${digits.join(', ')}이(가) 들어갈 수 있는 칸은 ${L(cells)} ${n}칸뿐입니다.`,
        { cells, marks: cells.flatMap(c => DIGITS[cand[c] & m].map(d => mk(c, d, 'key'))) });
      b.page(`${n}개의 숫자가 이 ${n}칸을 모두 차지해야 하므로, 이 칸들에는 다른 숫자가 들어갈 자리가 없습니다.`, {});
      finish(b, s, '');
    },

    fish(b, s, info) {
      const { d, base, cover, pos, rowsBase } = info;
      const n = base.length;
      const bw = rowsBase ? '행' : '열', cw = rowsBase ? '열' : '행';
      b.page(`숫자 ${d}가 들어갈 수 있는 자리를 ${bw}마다 살펴봅시다.`, { units: base }, { lead: '살펴볼 곳' });
      base.forEach((u, i) => {
        const cs = pos[i];
        const links = cs.length === 2 ? [lk(cs[0], d, cs[1], d, 'strong')] : [lk(cs[0], d, cs[cs.length - 1], d, 'band')];
        b.page(`${U(u)}에서 ${d}는 ${L(cs)}에만 올 수 있습니다.`, { cells: cs, marks: cs.map(c => mk(c, d, 'key')), links });
      });
      const coverLinks = cover.map(v => {
        const cs = pos.flat().filter(c => UNITS[v].includes(c));
        return lk(cs[0], d, cs[cs.length - 1], d, 'band');
      });
      b.page(`이 ${n}개 ${bw}의 ${d}는 모두 ${cover.map(U).join(', ')} 위에 있습니다. ${n}개 ${bw}에 ${d}가 하나씩 들어가면, ${cover.map(U).join(', ')} ${n}개 ${cw}에도 ${d}가 하나씩 정해집니다.`,
        { units: cover, links: coverLinks });
      b.page(`따라서 ${cover.map(U).join(', ')}의 나머지 칸에는 ${d}가 올 수 없습니다.`, {});
      finish(b, s, '');
    },

    turbot(b, s, info) {
      const { d, a1, b1, a2, b2, u1, u2, conn } = info;
      b.page(`숫자 ${d}가 딱 두 칸에만 들어갈 수 있는 집을 찾아봅시다: ${U(u1)}, ${U(u2)}.`, { units: [u1, u2] }, { lead: '살펴볼 곳' });
      b.page(`${U(u1)}에서 ${d}가 들어갈 수 있는 칸은 ${N(a1)}, ${N(b1)} 두 칸뿐입니다. 그래서 한쪽이 ${d}가 아니면 다른 쪽이 반드시 ${d}입니다. 이 관계를 실선으로 표시합니다.`,
        { cells: [a1, b1], marks: [mk(a1, d, 'alt'), mk(b1, d, 'alt')], links: [lk(a1, d, b1, d, 'strong')] });
      b.page(`${U(u2)}에서도 ${d}는 ${N(a2)}, ${N(b2)} 두 칸뿐이므로 실선으로 잇습니다.`,
        { cells: [a2, b2], marks: [mk(a2, d, 'alt'), mk(b2, d, 'alt')], links: [lk(a2, d, b2, d, 'strong')] });
      b.page(`${N(a1)}과 ${N(a2)}는 ${conn}에 있어서, 한쪽이 ${d}이면 다른 쪽은 ${d}가 될 수 없습니다. 이 관계를 점선으로 표시합니다.`,
        { links: [lk(a1, d, a2, d, 'weak')] });
      b.page(`${N(b1)}이 ${d}가 아니라고 가정해 봅시다.`, { marks: [mk(b1, d, 'off')] }, { lead: '가정' });
      b.page(`실선을 따라가면 ${N(a1)}이 ${d}입니다. 그러면 점선을 따라 ${N(a2)}는 ${d}가 될 수 없습니다.`,
        { marks: [mk(a1, d, 'key'), mk(a2, d, 'off')] });
      b.page(`${N(a2)}가 ${d}가 아니므로, 실선을 따라 ${N(b2)}가 반드시 ${d}입니다.`, { marks: [mk(b2, d, 'key')] });
      b.page(`정리하면, ${N(b1)}이 ${d}가 아니면 ${N(b2)}가 ${d}입니다. 즉 ${N(b1)}과 ${N(b2)} 중 적어도 하나는 반드시 ${d}입니다.`,
        { marks: [mk(b1, d, 'key'), mk(b2, d, 'key'), mk(a1, d, 'alt'), mk(a2, d, 'alt')] });
      finish(b, s, `${N(b1)}과 ${N(b2)}를 모두 보는 칸에는 ${d}가 올 수 없습니다.`, { links: elimLinks(s, [b1, b2], () => d) });
    },

    'xy-wing'(b, s, info, cand) {
      const { p, a, b: w, x, y, z } = info;
      b.page(`후보가 두 개인 ${N(p)}${brace([x, y].sort())}를 축으로 삼습니다. 이 칸은 ${x} 아니면 ${y}입니다.`,
        { cells: [p], marks: [mk(p, x, 'alt'), mk(p, y, 'alt')] }, { lead: '살펴볼 곳' });
      b.page(`${N(p)}가 ${x}라면 → 같은 집의 ${N(a)}${brace(digitsOf(cand, a))}는 ${x}가 될 수 없으니 ${z}가 됩니다.`,
        { cells: [a], marks: [mk(a, x, 'off'), mk(a, z, 'key')], links: [lk(p, x, a, x, 'arrow')] });
      b.page(`${N(p)}가 ${y}라면 → ${N(w)}${brace(digitsOf(cand, w))}는 ${y}가 될 수 없으니 ${z}가 됩니다.`,
        { cells: [w], marks: [mk(w, y, 'off'), mk(w, z, 'key')], links: [lk(p, y, w, y, 'arrow')] });
      b.page(`${N(p)}는 ${x} 아니면 ${y}이므로, 어느 경우든 ${N(a)}와 ${N(w)} 중 하나는 반드시 ${z}입니다.`, {});
      finish(b, s, `두 칸을 모두 보는 칸에는 ${z}가 올 수 없습니다.`, { links: elimLinks(s, [a, w], () => z) });
    },

    'xyz-wing'(b, s, info, cand) {
      const { p, a, b: w, z } = info;
      b.page(`후보가 세 개인 ${N(p)}${brace(digitsOf(cand, p))}를 축으로 삼습니다.`,
        { cells: [p], marks: digitsOf(cand, p).map(d => mk(p, d, 'alt')) }, { lead: '살펴볼 곳' });
      b.page(`${N(p)}가 보는 ${N(a)}${brace(digitsOf(cand, a))}와 ${N(w)}${brace(digitsOf(cand, w))}의 후보는 모두 ${N(p)}의 후보 안에 있습니다.`,
        { cells: [a, w], marks: [a, w].flatMap(c => digitsOf(cand, c).map(d => mk(c, d, 'alt'))), links: [lk(p, 0, a, 0, 'weak'), lk(p, 0, w, 0, 'weak')] });
      b.page(`${N(p)}가 ${z}가 아니라면, 남은 두 숫자를 ${N(p)}와 날개가 나눠 가지게 되어 날개 중 하나가 ${z}가 됩니다. 즉 세 칸 중 적어도 하나는 반드시 ${z}입니다.`,
        { marks: [p, a, w].map(c => mk(c, z, 'key')) });
      finish(b, s, `세 칸을 모두 보는 칸에는 ${z}가 올 수 없습니다.`, { links: elimLinks(s, [p, a, w], () => z) });
    },

    'w-wing'(b, s, info) {
      const { A, B, x, y, p, q, u } = info;
      const xy = [x, y].sort();
      b.page(`${N(A)}와 ${N(B)}는 후보가 똑같이 ${brace(xy)}인 두 칸입니다. 이 두 칸 중 적어도 하나는 반드시 ${y}라는 것을 차례로 보여 드릴게요.`,
        { cells: [A, B], marks: [A, B].flatMap(c => xy.map(d => mk(c, d, 'alt'))) }, { lead: '살펴볼 곳' });
      b.page(`${U(u)}에서 ${x}가 들어갈 수 있는 칸은 ${N(p)}, ${N(q)} 두 칸뿐입니다. 그래서 한쪽이 ${x}가 아니면 다른 쪽이 반드시 ${x}입니다. 이 관계를 실선으로 표시합니다.`,
        { units: [u], cells: [p, q], marks: [mk(p, x, 'alt'), mk(q, x, 'alt')], links: [lk(p, x, q, x, 'strong')] });
      b.page(`${N(A)}가 ${y}가 아니라고 가정해 봅시다. 그러면 ${N(A)}는 ${x}입니다.`,
        { marks: [mk(A, y, 'off'), mk(A, x, 'key')] }, { lead: '가정' });
      b.page(`${N(A)}가 ${x}이면, ${sameHouse(A, p)}에 있는 ${N(p)}는 ${x}가 될 수 없습니다. 같은 집에 같은 숫자가 두 번 올 수 없기 때문이고, 이 관계를 점선으로 표시합니다.`,
        { links: [lk(A, x, p, x, 'weak')], marks: [mk(p, x, 'off')] });
      b.page(`${N(p)}가 ${x}가 아니므로, 실선을 따라 ${N(q)}가 반드시 ${x}입니다.`,
        { marks: [mk(q, x, 'key')] });
      b.page(`${N(q)}가 ${x}이면, 점선을 따라 ${sameHouse(q, B)}의 ${N(B)}는 ${x}가 될 수 없습니다. 그러면 ${N(B)}에 남은 후보는 ${y}뿐입니다.`,
        { links: [lk(q, x, B, x, 'weak')], marks: [mk(B, x, 'off'), mk(B, y, 'key')] });
      b.page(`정리하면, ${N(A)}가 ${y}가 아니면 ${N(B)}가 ${y}입니다. 즉 두 칸 중 적어도 하나는 반드시 ${y}입니다.`,
        { marks: [mk(A, y, 'key'), mk(B, y, 'key'), mk(A, x, 'alt'), mk(B, x, 'alt'), mk(p, x, 'alt'), mk(q, x, 'alt')] });
      finish(b, s, `${N(A)}와 ${N(B)}를 모두 보는 칸에는 ${y}가 올 수 없습니다.`, { links: elimLinks(s, [A, B], () => y) });
    },

    'unique-rectangle'(b, s, info) {
      const { cells, bvs, D, a, b: bb } = info;
      const [c1, c2, c3, c4] = cells; // r1c1, r1c2, r2c1, r2c2
      b.page(`${L(cells)} 네 칸은 2개의 행, 2개의 열, 2개의 박스에 걸친 직사각형입니다.`,
        { cells, links: [lk(c1, 0, c2, 0, 'frame'), lk(c2, 0, c4, 0, 'frame'), lk(c4, 0, c3, 0, 'frame'), lk(c3, 0, c1, 0, 'frame')] }, { lead: '살펴볼 곳' });
      b.page(`이 중 세 칸(${L(bvs)})의 후보는 ${brace([a, bb])}뿐입니다.`,
        { marks: bvs.flatMap(c => [mk(c, a, 'key'), mk(c, bb, 'key')]) });
      b.page(`만약 ${N(D)}까지 ${a} 또는 ${bb}가 된다면, 네 칸의 ${a}와 ${bb}를 서로 맞바꿔도 규칙에 맞아 답이 두 개가 됩니다(치명적 패턴).`,
        { marks: [mk(D, a, 'alt'), mk(D, bb, 'alt')] });
      b.page(`올바른 스도쿠의 답은 하나뿐이므로 ${N(D)}에는 ${a}, ${bb}가 올 수 없습니다.`, {});
      finish(b, s, '');
    },

    'simple-coloring'(b, s, info) {
      const { d, g0, g1, rule, links } = info;
      const strong = links.map(([x, y]) => lk(x, d, y, d, 'strong'));
      b.page(`숫자 ${d}만 봅니다. 한 집에 ${d}가 두 칸에만 들어갈 수 있으면 그 두 칸을 실선으로 잇습니다. 이어진 두 칸은 정확히 하나만 ${d}입니다.`,
        { cells: g0.concat(g1), marks: g0.concat(g1).map(c => mk(c, d, 'node')), links: strong }, { lead: '살펴볼 곳' });
      b.page(`연결을 따라가며 칸을 초록과 파랑으로 번갈아 칠합니다. 실선의 양 끝은 색이 다르므로, 초록이 모두 ${d}이거나 파랑이 모두 ${d}입니다.`,
        { marks: g0.map(c => mk(c, d, 'key')).concat(g1.map(c => mk(c, d, 'alt'))) });
      if (rule === 'wrap') {
        const [x, y] = info.clash;
        const label = info.falseGroup === 0 ? '초록' : '파랑';
        const grp = info.falseGroup === 0 ? g0 : g1;
        b.page(`그런데 같은 ${label} 칸인 ${N(x)}과 ${N(y)}가 ${sameHouse(x, y)}에 있습니다. 둘 다 ${d}일 수는 없으므로 ${label}은 거짓입니다.`,
          { links: [lk(x, d, y, d, 'weak')], marks: grp.map(c => mk(c, d, 'off')) });
        finish(b, s, `${label} 칸들은 ${d}가 아닙니다 (반대 색 칸들이 ${d}가 됩니다).`);
      } else {
        const targets = [...new Set(s.eliminations.map(e => e.cell))];
        const tl = [];
        for (const t of targets.slice(0, 4)) {
          const x = g0.find(c => sees(c, t)), y = g1.find(c => sees(c, t));
          if (x !== undefined) tl.push(lk(x, d, t, d, 'elim'));
          if (y !== undefined) tl.push(lk(y, d, t, d, 'elim'));
        }
        b.page(`${L(targets)}은(는) 초록 칸과 파란 칸을 동시에 봅니다. 어느 색이 ${d}이든 이 칸과 같은 집에 ${d}가 생깁니다.`, { cells: targets, links: tl });
        finish(b, s, '');
      }
    },

    'x-chain'(b, s, info, cand) {
      const { d, path } = info;
      const last = path.length - 1;
      b.page(`숫자 ${d}만 봅니다. 실선은 '둘 중 하나는 반드시 ${d}', 점선은 '둘 다 ${d}일 수는 없음'입니다. 시작 칸 ${N(path[0])}가 ${d}가 아니라고 가정해 봅시다.`,
        { cells: [path[0]], marks: [mk(path[0], d, 'off')] }, { lead: '가정' });
      for (let i = 0; i < last; i += 2) {
        const a = path[i], c = path[i + 1];
        const u = strongUnit(cand, a, c, d);
        let text = `${U(u)}에서 ${d}는 ${N(a)} 아니면 ${N(c)}인데, ${N(a)}가 아니므로 ${N(c)}가 ${d}입니다.`;
        const add = { cells: [c], marks: [mk(c, d, 'key')], links: [lk(a, d, c, d, 'strong')] };
        if (i + 2 <= last) {
          const n = path[i + 2];
          text += ` 그러면 ${sameHouse(c, n)}의 ${N(n)}는 ${d}가 아닙니다.`;
          add.cells.push(n);
          add.marks.push(mk(n, d, 'off'));
          add.links.push(lk(c, d, n, d, 'weak'));
        }
        b.page(text, add);
      }
      b.page(`결국 ${N(path[0])}가 ${d}가 아니면 ${N(path[last])}가 ${d}입니다. 즉 두 끝 중 적어도 하나는 반드시 ${d}입니다.`,
        { marks: [mk(path[0], d, 'key'), mk(path[last], d, 'key')] });
      finish(b, s, `두 끝을 모두 보는 칸에는 ${d}가 올 수 없습니다.`, { links: elimLinks(s, [path[0], path[last]], () => d) });
    },

    'xy-chain'(b, s, info, cand) {
      const { z, path } = info;
      const last = path.length - 1;
      const other = (c, x) => DIGITS[cand[c] & ~(1 << x)][0];
      let x = other(path[0], z);
      b.page(`후보가 두 개인 칸들을 사슬로 잇습니다. 첫 칸 ${N(path[0])}${brace(digitsOf(cand, path[0]))}가 ${z}가 아니라고 가정해 봅시다. 그러면 이 칸은 ${x}입니다.`,
        { cells: [path[0]], marks: [mk(path[0], z, 'off'), mk(path[0], x, 'key')] }, { lead: '가정' });
      const per = path.length > 6 ? 2 : 1;
      for (let i = 1; i <= last; i += per) {
        const parts = [], add = { cells: [], marks: [], links: [] };
        for (let k = i; k < i + per && k <= last; k++) {
          const prev = path[k - 1], c = path[k], y = other(c, x);
          parts.push(`${N(prev)}가 ${x}이므로 같은 집의 ${N(c)}${brace(digitsOf(cand, c))}는 ${x}가 아닌 ${y}입니다.`);
          add.cells.push(c);
          add.marks.push(mk(c, x, 'off'), mk(c, y, 'key'));
          add.links.push(lk(prev, x, c, x, 'arrow'));
          x = y;
        }
        b.page(parts.join(' '), add);
      }
      b.page(`결국 ${N(path[0])}가 ${z}가 아니면 ${N(path[last])}가 ${z}입니다. 즉 두 끝 중 적어도 하나는 반드시 ${z}입니다.`,
        { marks: [mk(path[0], z, 'key'), mk(path[last], z, 'key')] });
      finish(b, s, `두 끝을 모두 보는 칸에는 ${z}가 올 수 없습니다.`, { links: elimLinks(s, [path[0], path[last]], () => z) });
    },
  };
  for (const id of ['naked-pair', 'naked-triple', 'naked-quad']) BUILDERS[id] = BUILDERS.naked;
  for (const id of ['hidden-pair', 'hidden-triple', 'hidden-quad']) BUILDERS[id] = BUILDERS.hidden;
  for (const id of ['x-wing', 'swordfish', 'jellyfish']) BUILDERS[id] = BUILDERS.fish;
  for (const id of ['skyscraper', '2-string-kite', 'turbot']) BUILDERS[id] = BUILDERS.turbot;

  /* Fallback for steps without a dedicated builder: one sentence per page. */
  function fallback(step, special) {
    const b = new Builder();
    let text = fixJosa(step.text);
    let concl = '';
    const arrow = text.lastIndexOf('→');
    if (arrow >= 0) { concl = text.slice(arrow + 1).trim(); text = text.slice(0, arrow).trim(); }
    const sentences = text.replace(/([다\d)열]\.)\s+/g, '$1\n').split('\n').map(x => x.trim()).filter(Boolean);
    if (!concl && sentences.length > 1) concl = sentences.pop();
    const pattern = { units: step.units || [], cells: step.cells || [], refs: step.refs || [], marks: step.marks.filter(m => m.role !== 'elim' && m.role !== 'place') };
    if (!special && step.summary) b.page(step.summary, { units: step.units || [] }, { lead: '살펴볼 곳' });
    sentences.forEach((t, i) => b.page(t, i === 0 ? pattern : {}));
    const fin = { marks: step.marks.filter(m => m.role === 'elim'), place: step.placements };
    if (!b.pages.length) Object.assign(fin, pattern);
    b.page(concl || text, fin, { conclusion: !!concl, lead: concl ? '결론' : '' });
    return b.pages;
  }

  /** Build the pages for a hint step. `cand` and `grid` are the state the step was found in. */
  function build(step, cand, grid, special) {
    const fn = !special && step.info && BUILDERS[step.id];
    if (fn) {
      try {
        const b = new Builder();
        fn(b, step, step.info, cand, grid);
        if (b.pages.length) return b.pages;
      } catch (e) {
        if (typeof console !== 'undefined') console.error('explain failed for', step.id, e);
      }
    }
    return fallback(step, special);
  }

  const api = { build };
  if (isNode) module.exports = api; else root.SudokuExplain = api;
})(typeof self !== 'undefined' ? self : this);
