(function () {
  'use strict';
  const C = window.SudokuCore, T = window.SudokuTechniques, G = window.SudokuGenerator;
  const { ROW, COL, BOX, PEERS, DIGITS, BITCOUNT, cellName, cellList } = C;
  const bit = d => 1 << d;

  const STORE = 'sudoku.game.v1';
  const SETTINGS = 'sudoku.settings.v1';
  const LEVELS = { hard: '어려움', expert: '매우 어려움' };
  const LEVEL_STARS = ['', '★', '★★', '★★★', '★★★★', '★★★★★', '★★★★★★'];

  const $ = id => document.getElementById(id);
  const boardEl = $('board'), padEl = $('pad');

  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }

  const settings = Object.assign({ autoRemove: true, highlightSame: true, showMistakes: true, showTimer: true, quickPen: false }, load(SETTINGS) || {});
  // v2: wrong answers are shown immediately by default (older saves had it off).
  if (!(settings.version >= 2)) { settings.showMistakes = true; settings.version = 2; save(SETTINGS, settings); }
  let st = load(STORE);
  let hint = null; // { step, cand, pages, page }
  // Quick pen: 0 = none, 1..9 = digit pen, -1 = eraser.
  let pen = 0;
  let stroke = null; // active drag in quick-pen mode

  /* ------------------------------------------------------------ game */

  function newGame(level) {
    closeHint();
    $('busy').hidden = false;
    setTimeout(() => {
      const rng = C.mulberry32((Math.random() * 4294967296) >>> 0);
      let p = null;
      try { p = G.generate(level, rng, 1500); } catch (e) { p = null; }
      if (!p) p = G.fromBank(window.PUZZLE_BANK, level, rng);
      st = {
        level,
        givens: p.puzzle.slice(),
        solution: p.solution.slice(),
        values: p.puzzle.slice(),
        notes: new Array(81).fill(0),
        selected: p.puzzle.findIndex(v => !v),
        notesMode: false,
        undo: [], redo: [],
        elapsed: 0, hints: 0, mistakes: 0, done: false,
      };
      persist();
      render();
      $('busy').hidden = true;
    }, 40);
  }

  function persist() { if (st) save(STORE, st); }

  function snapshot() { return { v: st.values.slice(), n: st.notes.slice() }; }
  function pushUndo() {
    st.undo.push(snapshot());
    if (st.undo.length > 300) st.undo.shift();
    st.redo = [];
  }
  function undo() {
    if (!st || !st.undo.length || st.done) return;
    closeHint();
    st.redo.push(snapshot());
    const s = st.undo.pop();
    st.values = s.v; st.notes = s.n;
    persist(); render();
  }
  function redo() {
    if (!st || !st.redo.length || st.done) return;
    closeHint();
    st.undo.push(snapshot());
    const s = st.redo.pop();
    st.values = s.v; st.notes = s.n;
    persist(); render();
  }

  let flashCell = -1, flashTimer;
  function place(c, d) {
    const wrong = d !== st.solution[c];
    st.values[c] = d;
    st.notes[c] = 0;
    // A number already shown as wrong must not wipe the correct candidates around it.
    if (settings.autoRemove && !(wrong && settings.showMistakes)) for (const p of PEERS[c]) st.notes[p] &= ~bit(d);
    if (wrong) {
      st.mistakes++;
      if (settings.showMistakes) {
        flashCell = c;
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { flashCell = -1; render(); }, 450);
        if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) { /* unsupported */ }
      }
    }
  }

  /** Write digit d into cell c (value or note, depending on notes mode). Returns true if changed. */
  function writeDigit(c, d) {
    if (c < 0 || st.givens[c]) return false;
    if (st.notesMode) {
      if (st.values[c]) return false;
      st.notes[c] ^= bit(d);
    } else if (st.values[c] === d) st.values[c] = 0;
    else place(c, d);
    return true;
  }
  function eraseCell(c) {
    if (c < 0 || st.givens[c] || (!st.values[c] && !st.notes[c])) return false;
    if (st.values[c]) st.values[c] = 0; else st.notes[c] = 0;
    return true;
  }

  function inputDigit(d) {
    if (!st || st.done) return;
    if (settings.quickPen) { // pick (or drop) the pen
      closeHint();
      pen = pen === d ? 0 : d;
      render();
      return;
    }
    const c = st.selected;
    if (c < 0 || st.givens[c] || (st.notesMode && st.values[c])) return;
    closeHint();
    pushUndo();
    writeDigit(c, d);
    persist(); render(); checkWin();
  }

  function eraseSelected() {
    if (!st || st.done) return;
    const c = st.selected;
    if (c < 0 || st.givens[c] || (!st.values[c] && !st.notes[c])) return;
    closeHint();
    pushUndo();
    eraseCell(c);
    persist(); render();
  }
  function erase() {
    if (!st || st.done) return;
    if (settings.quickPen) { closeHint(); pen = pen === -1 ? 0 : -1; render(); return; }
    eraseSelected();
  }

  function toggleQuickPen() {
    settings.quickPen = !settings.quickPen;
    pen = 0;
    save(SETTINGS, settings);
    closeHint();
    render();
    toast(settings.quickPen ? '빠른펜: 숫자를 고른 뒤 칸을 누르세요' : '빠른펜을 껐습니다');
  }

  /* Quick-pen strokes. A tap applies the pen to one cell; dragging continues the
   * same action (add/remove note, erase) over every cell the finger passes. */
  function strokeStart(c) {
    if (st.done) return false;
    if (!pen && !st.values[c]) return false;
    let kind = null, pick = 0;
    if (pen === -1) kind = 'erase';
    else if (!pen || st.givens[c] || (st.values[c] && st.notesMode)) {
      // Starting on a number: a plain tap picks it as the pen; a drag that
      // continues into empty cells (notes mode) still writes notes there.
      pick = st.values[c];
    } else if (st.notesMode) kind = st.notes[c] & bit(pen) ? 'note-off' : 'note-on';
    else kind = 'value';
    stroke = { kind, pick, before: snapshot(), changed: false, last: -1, start: c };
    strokeApply(c);
    return true;
  }
  function strokeApply(c) {
    if (!stroke || c === stroke.last || c < 0) return;
    stroke.last = c;
    if (stroke.kind === null) {
      if (c === stroke.start || !(pen > 0) || !st.notesMode || st.values[c]) return;
      stroke.kind = st.notes[c] & bit(pen) ? 'note-off' : 'note-on';
      stroke.pick = 0;
    }
    if (st.givens[c]) return;
    let ch = false;
    if (stroke.kind === 'erase') ch = eraseCell(c);
    else if (stroke.kind === 'note-on' || stroke.kind === 'note-off') {
      const want = stroke.kind === 'note-on';
      if (!st.values[c] && !!(st.notes[c] & bit(pen)) !== want) { st.notes[c] ^= bit(pen); ch = true; }
    } else if (stroke.kind === 'value' && !stroke.changed) {
      ch = writeDigit(c, pen); // values are placed by tap only, never by dragging
    }
    if (ch) { stroke.changed = true; st.selected = c; render(); }
  }
  function strokeEnd() {
    if (!stroke) return;
    if (stroke.pick) { pen = stroke.pick; render(); }
    if (stroke.changed) {
      st.undo.push(stroke.before);
      if (st.undo.length > 300) st.undo.shift();
      st.redo = [];
      if (stroke.kind === 'value') advancePen();
      persist(); render(); checkWin();
    }
    stroke = null;
  }

  const placedCount = d => st.values.reduce((n, v) => n + (v === d ? 1 : 0), 0);
  /** After the pen's digit has all nine copies on the board, move the pen to the next unfinished digit. */
  function advancePen() {
    if (!(pen > 0) || placedCount(pen) < 9 || st.values.every(v => v)) return;
    for (let k = 1; k <= 8; k++) {
      const d = (pen - 1 + k) % 9 + 1;
      if (placedCount(d) < 9) {
        toast(`${pen} 완료 → 펜을 ${d}(으)로 바꿨습니다`);
        pen = d;
        return;
      }
    }
  }

  function fillCandidates() {
    if (!st || st.done) return;
    closeHint();
    pushUndo();
    const cand = C.computeCandidates(st.values);
    for (let c = 0; c < 81; c++) if (!st.values[c]) st.notes[c] = cand[c];
    persist(); render();
    toast('모든 빈칸에 후보를 채웠습니다');
  }
  function clearNotes() {
    if (!st || st.done) return;
    closeHint();
    pushUndo();
    st.notes.fill(0);
    persist(); render();
  }
  function restart() {
    if (!st) return;
    if (!confirm('이 퍼즐을 처음부터 다시 시작할까요?')) return;
    closeHint();
    Object.assign(st, { values: st.givens.slice(), notes: new Array(81).fill(0), undo: [], redo: [], elapsed: 0, hints: 0, mistakes: 0, done: false });
    persist(); render();
  }

  function checkWin() {
    if (st.values.every((v, i) => v === st.solution[i])) {
      st.done = true;
      st.selected = -1;
      persist(); render();
      $('win-text').textContent = `${LEVELS[st.level]} 퍼즐을 ${fmtTime(st.elapsed)}에 풀었습니다. 힌트 ${st.hints}회, 오답 ${st.mistakes}회.`;
      setTimeout(() => openDlg('win-dlg'), 250);
    }
  }

  /* ------------------------------------------------------------ hints */

  function computeHint() {
    const v = st.values, sol = st.solution;

    const wrong = [];
    for (let c = 0; c < 81; c++) if (v[c] && !st.givens[c] && v[c] !== sol[c]) wrong.push(c);
    if (wrong.length) {
      return {
        special: 'error',
        step: {
          name: '잘못 입력된 숫자', level: 0, cells: wrong, refs: [], units: [], marks: [], placements: [], eliminations: [],
          summary: '입력한 숫자 중 정답과 다른 것이 있습니다.',
          text: `${cellList(wrong)}에 입력한 숫자가 정답과 다릅니다. 이 숫자를 기준으로 진행하면 모순이 생깁니다. 적용하면 해당 칸을 지웁니다.`,
        },
      };
    }

    const basic = C.computeCandidates(v);
    const cand = new Array(81).fill(0);
    const missing = [], stale = [];
    for (let c = 0; c < 81; c++) {
      if (v[c]) continue;
      const n = st.notes[c];
      if (!n) { cand[c] = basic[c]; continue; }
      if (!(n & bit(sol[c]))) missing.push(c);
      for (const d of DIGITS[n & ~basic[c]]) stale.push({ cell: c, digit: d });
      cand[c] = (n & basic[c]) || basic[c];
    }
    if (missing.length) {
      return {
        special: 'missing', basic,
        step: {
          name: '후보 메모 확인', level: 0, cells: missing, refs: [], units: [], marks: [], placements: [], eliminations: [],
          summary: '후보 메모에 잘못 지워진 숫자가 있습니다.',
          text: `${cellList(missing)}의 후보 메모에서, 실제로 들어갈 수 있는 숫자가 지워져 있습니다. ` +
            `이 상태로는 논리적으로 풀 수 없습니다. 적용하면 이 칸들의 후보를 다시 계산해 채웁니다.`,
        },
      };
    }
    if (stale.length) {
      const cells = [...new Set(stale.map(e => e.cell))];
      return {
        special: 'cleanup', cand: st.notes.slice(),
        step: {
          name: '후보 정리', level: 1, cells, refs: [], units: [], placements: [], eliminations: stale,
          marks: stale.map(e => ({ cell: e.cell, digit: e.digit, role: 'elim' })),
          summary: '후보 메모 중 이미 불가능한 숫자가 남아 있습니다.',
          text: `같은 행·열·박스에 이미 놓인 숫자는 후보가 될 수 없습니다. → ` +
            stale.map(e => `${cellName(e.cell)}의 ${e.digit}`).join(', ') + `을(를) 지울 수 있습니다.`,
        },
      };
    }

    const step = T.findStep(v.slice(), cand.slice());
    if (step) return { cand, step };

    // Fallback: reveal one cell.
    let best = -1;
    for (let c = 0; c < 81; c++) if (!v[c] && (best < 0 || BITCOUNT[cand[c]] < BITCOUNT[cand[best]])) best = c;
    return {
      special: 'reveal', cand,
      step: {
        name: '정답 공개', level: 0, cells: [best], refs: [], units: [], eliminations: [],
        placements: [{ cell: best, digit: sol[best] }], marks: [{ cell: best, digit: sol[best], role: 'place' }],
        summary: '지금 상태에서 적용할 수 있는 기법을 찾지 못했습니다.',
        text: `현재 후보로는 이 앱이 아는 기법을 적용할 수 없어, ${cellName(best)}의 정답 ${sol[best]}을(를) 알려드립니다.`,
      },
    };
  }

  function showHint() {
    if (!st || st.done) return;
    if (hint) { hintNext(); return; }
    hint = computeHint();
    hint.pages = window.SudokuExplain.build(hint.step, hint.cand || C.computeCandidates(st.values), st.values.slice(), hint.special);
    hint.page = 0;
    st.hints++;
    persist();
    renderHint(); render();
  }

  function hintNext() {
    if (!hint) return;
    if (hint.page < hint.pages.length - 1) { hint.page++; renderHint(); render(); }
    else applyHint();
  }
  function hintPrev() {
    if (hint && hint.page > 0) { hint.page--; renderHint(); render(); }
  }

  function renderHint() {
    const panel = $('hint-panel');
    document.body.classList.toggle('hinting', !!hint);
    if (!hint) { panel.hidden = true; return; }
    const s = hint.step;
    panel.hidden = false;
    panel.scrollTop = 0;
    $('hint-kicker').textContent = s.level ? `힌트 · 기법 난이도 ${LEVEL_STARS[s.level]}` : '힌트';
    $('hint-title').textContent = s.name;
    const pg = hint.pages[hint.page];
    const last = hint.page === hint.pages.length - 1;
    const detailed = last;
    const textEl = $('hint-text');
    textEl.textContent = '';
    textEl.className = 'sheet-text' + (pg.conclusion ? ' conclusion' + (s.placements.length && !s.eliminations.length ? ' place' : '') : '');
    if (pg.lead) {
      const lead = document.createElement('span');
      lead.className = 'lead';
      lead.textContent = pg.lead;
      textEl.appendChild(lead);
    }
    textEl.appendChild(document.createTextNode(pg.text));
    $('hint-progress').textContent = hint.pages.length > 1 ? `${hint.page + 1} / ${hint.pages.length}` : '';
    $('hint-prev').hidden = hint.page === 0;
    $('hint-next').hidden = last;
    $('hint-apply').hidden = !last;
    renderLegend(pg);
    const note = $('hint-note');
    note.hidden = true;
    if (detailed && !hint.special && s.eliminations.length && st.values.some((v, c) => !v && !st.notes[c])) {
      note.hidden = false;
      note.textContent = '후보 메모가 없는 칸은 자동으로 계산한 후보를 기준으로 설명합니다. 적용하면 빈칸의 후보가 함께 채워집니다.';
    } else if (detailed && s.placements.length && !hint.special) {
      note.hidden = false;
      note.textContent = C.fixJosa(`적용하면 ${s.placements.map(p => `${cellName(p.cell)}에 ${p.digit}`).join(', ')}을(를) 채웁니다.`);
    }
  }

  const LEGEND = [
    ['key', 'dot key', '들어감'], ['off', 'dot off', '아님'], ['alt', 'dot alt', '관련 후보'], ['node', 'dot node', '연결 후보'],
    ['elim', 'dot elim', '지울 후보'], ['place', 'dot place', '채울 숫자'],
    ['strong', 'ln strong', '실선: 둘 중 하나는 참'], ['weak', 'ln weak', '점선: 둘 다 참일 수 없음'],
    ['arrow', 'ln arrow', '그러면'], ['cross', 'x', '올 수 없음'],
  ];
  function renderLegend(pg) {
    const el = $('hint-legend');
    const present = new Set(pg.marks.map(m => m.role).concat(pg.links.map(l => l.type)));
    if (pg.place.length) present.add('place');
    if (pg.crosses.length) present.add('cross');
    const items = LEGEND.filter(([k]) => present.has(k));
    el.hidden = !items.length;
    el.innerHTML = items.map(([, cls, label]) => `<span><i class="${cls}"></i>${label}</span>`).join('');
  }

  function applyHint() {
    if (!hint || st.done) return;
    const { step, special } = hint;
    pushUndo();
    if (special === 'error') {
      for (const c of step.cells) st.values[c] = 0;
    } else if (special === 'missing') {
      for (const c of step.cells) st.notes[c] = hint.basic[c];
    } else {
      if (special !== 'cleanup' && step.eliminations.length) {
        for (let c = 0; c < 81; c++) if (!st.values[c] && !st.notes[c]) st.notes[c] = hint.cand[c];
      }
      for (const e of step.eliminations) st.notes[e.cell] &= ~bit(e.digit);
      for (const p of step.placements) place(p.cell, p.digit);
      if (step.placements.length) st.selected = step.placements[0].cell;
    }
    hint = null;
    renderHint();
    persist(); render(); checkWin();
  }

  function closeHint() {
    if (!hint) return;
    hint = null;
    renderHint();
    render();
  }

  /* ------------------------------------------------------------ render */

  function buildBoard() {
    boardEl.innerHTML = '';
    for (let c = 0; c < 81; c++) {
      const el = document.createElement('div');
      el.className = `cell r${ROW[c]} c${COL[c]}`;
      el.dataset.cell = c;
      el.setAttribute('role', 'gridcell');
      boardEl.appendChild(el);
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'overlay');
    svg.setAttribute('viewBox', '0 0 900 900');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    boardEl.appendChild(svg);
    padEl.innerHTML = '';
    for (let d = 1; d <= 9; d++) {
      const b = document.createElement('button');
      b.dataset.digit = d;
      b.innerHTML = `<span>${d}</span><small></small>`;
      padEl.appendChild(b);
    }
  }

  function render() {
    if (!st) return;
    const sel = st.selected;
    const selVal = settings.quickPen ? Math.max(pen, 0) : sel >= 0 ? st.values[sel] : 0;
    const conflicts = C.conflicts(st.values);
    const h = hint;
    const hUnits = new Set(), hCells = new Set(), hRefs = new Set(), markMap = new Map(), places = new Map(), crosses = new Set();
    const pg = h ? h.pages[h.page] : null;
    if (pg) {
      for (const u of pg.units) for (const c of C.UNITS[u]) hUnits.add(c);
      for (const c of pg.cells) hCells.add(c);
      for (const c of pg.refs) hRefs.add(c);
      for (const c of pg.crosses) crosses.add(c);
      for (const m of pg.marks) {
        if (m.role === 'place') continue;
        if (!markMap.has(m.cell)) markMap.set(m.cell, new Map());
        markMap.get(m.cell).set(m.digit, m.role);
      }
      for (const p of pg.place) places.set(p.cell, p.digit);
    }
    drawOverlay(pg, crosses);

    const cells = boardEl.children;
    for (let c = 0; c < 81; c++) {
      const el = cells[c];
      const v = st.values[c];
      const cls = [`cell`, `r${ROW[c]}`, `c${COL[c]}`];
      if (st.givens[c]) cls.push('given');
      if (!h) {
        if (c === sel) cls.push('sel');
        else if (settings.highlightSame && selVal && v === selVal) cls.push('same');
        else if (sel >= 0 && !settings.quickPen && (ROW[c] === ROW[sel] || COL[c] === COL[sel] || BOX[c] === BOX[sel])) cls.push('peer');
      } else {
        if (hRefs.has(c)) cls.push('h-ref');
        else if (hUnits.has(c)) cls.push('h-unit');
        if (hCells.has(c)) cls.push('h-cell');
        if (places.has(c)) cls.push('h-place');
        if (crosses.has(c)) cls.push('h-cross');
      }
      if (v && conflicts.has(c) && !st.givens[c]) cls.push('conflict');
      if (v && !st.givens[c] && settings.showMistakes && v !== st.solution[c]) cls.push('wrong');
      if (c === flashCell) cls.push('shake');

      let html = '';
      if (v) {
        html = `<span class="v">${v}</span>`;
      } else if (places.has(c)) {
        html = `<span class="v preview">${places.get(c)}</span>`;
      } else {
        let mask = st.notes[c];
        const marks = markMap.get(c);
        const showGhost = h && h.cand && (hCells.has(c) || marks) && !h.special;
        if (showGhost && !mask) { mask = h.cand[c]; cls.push('h-ghost'); }
        if (h && h.special === 'cleanup' && marks) mask = st.notes[c];
        if (mask || marks) {
          html = '<div class="notes">';
          for (let d = 1; d <= 9; d++) {
            const role = marks && marks.get(d);
            const on = (mask & bit(d)) || role;
            let k = '';
            if (role) k = `m-${role}`;
            else if (on && !h && settings.highlightSame && selVal === d) k = 'hl';
            html += `<span class="${k}">${on ? d : ''}</span>`;
          }
          html += '</div>';
        }
      }
      el.className = cls.join(' ');
      if (el.innerHTML !== html) el.innerHTML = html;
    }

    // pad
    const count = new Array(10).fill(0);
    for (const v of st.values) if (v) count[v]++;
    for (const b of padEl.children) {
      const d = +b.dataset.digit;
      b.classList.toggle('done', count[d] >= 9);
      b.classList.toggle('pen', settings.quickPen && pen === d);
      b.querySelector('small').textContent = count[d] >= 9 ? '' : String(9 - count[d]);
    }
    padEl.classList.toggle('notes-mode', st.notesMode);
    padEl.classList.toggle('quick', settings.quickPen);
    $('pen-btn').setAttribute('aria-pressed', String(!!settings.quickPen));
    $('pen-state').textContent = settings.quickPen ? '켬' : '끔';
    $('erase-btn').setAttribute('aria-pressed', String(settings.quickPen && pen === -1));
    boardEl.classList.toggle('quick', !!settings.quickPen);
    $('notes-btn').setAttribute('aria-pressed', String(st.notesMode));
    $('notes-state').textContent = st.notesMode ? '켬' : '끔';
    $('undo-btn').disabled = !st.undo.length || st.done;
    const badge = $('level-badge');
    badge.textContent = LEVELS[st.level];
    badge.className = `badge ${st.level}`;
    renderTimer();
    const mk = $('mistakes');
    mk.hidden = !settings.showMistakes || !st.mistakes;
    mk.textContent = `오답 ${st.mistakes}`;
  }

  /* Lines between candidates for hint pages, drawn on an SVG layer over the board. */
  function candPoint(cell, digit) {
    const x0 = COL[cell] * 100, y0 = ROW[cell] * 100;
    if (!digit) return [x0 + 50, y0 + 50];
    return [x0 + ((digit - 1) % 3) * 100 / 3 + 100 / 6, y0 + Math.floor((digit - 1) / 3) * 100 / 3 + 100 / 6];
  }
  function drawOverlay(pg, crosses) {
    const svg = boardEl.querySelector('svg.overlay');
    if (!svg) return;
    if (!pg) { if (svg.innerHTML) svg.innerHTML = ''; return; }
    let out = '<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto">' +
      '<path d="M0,0 L10,5 L0,10 z" class="ah"/></marker></defs>';
    for (const c of crosses) {
      const x = COL[c] * 100, y = ROW[c] * 100;
      out += `<path class="cross" d="M${x + 32},${y + 32} L${x + 68},${y + 68} M${x + 68},${y + 32} L${x + 32},${y + 68}"/>`;
    }
    // bands and frames first (underneath), chains on top
    const order = { band: 0, frame: 1, ray: 2, elim: 3, weak: 4, strong: 5, arrow: 6 };
    const links = pg.links.slice().sort((a, b) => (order[a.type] || 0) - (order[b.type] || 0));
    for (const l of links) {
      let [x1, y1] = candPoint(l.a.cell, l.a.digit);
      let [x2, y2] = candPoint(l.b.cell, l.b.digit);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      if (len < 1) continue;
      if (l.type === 'band' || l.type === 'frame') {
        out += `<line class="lk-${l.type}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
        continue;
      }
      const ra = l.a.digit ? 14 : 32, rb = l.b.digit ? (l.type === 'arrow' ? 17 : 14) : 32;
      const ux = dx / len, uy = dy / len;
      x1 += ux * ra; y1 += uy * ra; x2 -= ux * rb; y2 -= uy * rb;
      if (l.type === 'ray') {
        out += `<line class="lk-ray" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
        continue;
      }
      // gentle curve so lines don't run straight through other candidates
      const bend = Math.min(36, len * 0.12);
      const cx = (x1 + x2) / 2 - uy * bend, cy = (y1 + y2) / 2 + ux * bend;
      out += `<path class="lk-${l.type}" d="M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}"` +
        (l.type === 'arrow' ? ' marker-end="url(#ah)"' : '') + '/>';
    }
    svg.innerHTML = out;
  }

  /* ------------------------------------------------------------ timer */

  const fmtTime = s => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const mm = String(m).padStart(2, '0'), ss = String(x).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };
  function renderTimer() {
    const t = $('timer');
    t.textContent = st ? fmtTime(st.elapsed) : '00:00';
    t.classList.toggle('hidden', !settings.showTimer);
  }
  setInterval(() => {
    if (!st || st.done || document.hidden || document.querySelector('dialog[open]')) return;
    st.elapsed++;
    renderTimer();
    if (st.elapsed % 5 === 0) persist();
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

  /* ------------------------------------------------------------ dialogs */

  function openDlg(id) {
    const d = $(id);
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
  }
  function closeDlg(d) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }

  document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', e => {
      if (e.target === d) closeDlg(d); // backdrop
      if (e.target.closest('[data-close]')) closeDlg(d);
    });
  });

  $('menu-btn').addEventListener('click', () => openDlg('menu-dlg'));
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const dlg = b.closest('dialog');
    if (dlg) closeDlg(dlg);
    const act = b.dataset.act;
    if (act === 'new') openDlg('new-dlg');
    else if (act === 'fill') fillCandidates();
    else if (act === 'clear-notes') clearNotes();
    else if (act === 'restart') restart();
    else if (act === 'settings') openDlg('settings-dlg');
    else if (act === 'help') openDlg('help-dlg');
  });
  $('new-dlg').addEventListener('click', e => {
    const b = e.target.closest('[data-level]');
    if (!b) return;
    closeDlg($('new-dlg'));
    newGame(b.dataset.level);
  });
  for (const k of Object.keys(settings)) {
    const input = $(`set-${k}`);
    if (!input) continue;
    input.checked = !!settings[k];
    input.addEventListener('change', () => { settings[k] = input.checked; save(SETTINGS, settings); render(); });
  }

  /* ------------------------------------------------------------ input */

  const cellAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest && el.closest('.cell');
    return cell && boardEl.contains(cell) ? +cell.dataset.cell : -1;
  };
  boardEl.addEventListener('pointerdown', e => {
    const el = e.target.closest('.cell');
    if (!el || !st) return;
    if (hint) { closeHint(); return; }
    const c = +el.dataset.cell;
    st.selected = c;
    if (settings.quickPen && strokeStart(c)) {
      if (stroke) { e.preventDefault(); try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
      return;
    }
    render();
  });
  boardEl.addEventListener('pointermove', e => {
    if (!stroke) return;
    e.preventDefault();
    strokeApply(cellAt(e.clientX, e.clientY));
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) boardEl.addEventListener(ev, strokeEnd);
  padEl.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) inputDigit(+b.dataset.digit);
  });
  $('undo-btn').addEventListener('click', undo);
  $('erase-btn').addEventListener('click', erase);
  $('notes-btn').addEventListener('click', () => { if (!st) return; st.notesMode = !st.notesMode; persist(); render(); });
  $('pen-btn').addEventListener('click', toggleQuickPen);
  $('hint-btn').addEventListener('click', showHint);
  $('hint-next').addEventListener('click', hintNext);
  $('hint-prev').addEventListener('click', hintPrev);
  $('hint-apply').addEventListener('click', applyHint);
  $('hint-close').addEventListener('click', closeHint);

  document.addEventListener('keydown', e => {
    if (!st || document.querySelector('dialog[open]')) return;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k >= '1' && k <= '9') { inputDigit(+k); return; }
    if (k === 'Backspace' || k === 'Delete' || k === '0') { eraseSelected(); return; }
    if (k === 'q' || k === 'Q') { toggleQuickPen(); return; }
    if (k === 'n' || k === 'N' || k === ' ') { e.preventDefault(); st.notesMode = !st.notesMode; persist(); render(); return; }
    if (k === 'h' || k === 'H') { showHint(); return; }
    if (hint && (k === 'Enter' || k === 'ArrowRight')) { e.preventDefault(); hintNext(); return; }
    if (hint && k === 'ArrowLeft') { e.preventDefault(); hintPrev(); return; }
    if (k === 'Escape') { closeHint(); return; }
    const mv = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[k];
    if (mv) {
      e.preventDefault();
      if (hint) closeHint();
      let c = st.selected < 0 ? 40 : st.selected;
      if (mv === -1 && COL[c] === 0) c += 8;
      else if (mv === 1 && COL[c] === 8) c -= 8;
      else c = (c + mv + 81) % 81;
      st.selected = c;
      render();
    }
  });

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
  }

  /* ------------------------------------------------------------ boot */

  buildBoard();
  if (st && Array.isArray(st.values) && st.values.length === 81 && LEVELS[st.level]) {
    render();
    if (st.done) openDlg('new-dlg');
  } else {
    st = null;
    newGame('hard');
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
