(() => {
  'use strict';

  const COLS = 8, ROWS = 8;
  const CANDY_TYPES = ['🍎', '🍋', '🍊', '🥝', '🫐', '🍫'];
  const CANDY_COLORS = ['#ff4d6d', '#ffd13d', '#ff9a3d', '#3dd68c', '#4da3ff', '#8b5a2b'];
  const BAR_MAX = 100;
  const BAR_DIVISOR = 8;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const ROOM_PREFIX = 'doceduelo-';
  const HOST_ID = 'p1';
  const HEARTBEAT_MS = 3000;
  const TIMEOUT_MS = 9000;
  const BOMB_BONUS = 40;
  const STRIPED_BONUS = 20;
  const ACTIVATION_BONUS = 25;
  const STREAK_TIMEOUT_MS = 5000;
  const STREAK_STEP = 0.25;
  const STREAK_CAP = 6;

  // ---------- DOM ----------
  const screens = {
    Lobby: document.getElementById('screenLobby'),
    Waiting: document.getElementById('screenWaiting'),
    Countdown: document.getElementById('screenCountdown'),
    Battle: document.getElementById('screenBattle'),
    GameOver: document.getElementById('screenGameOver'),
  };
  const playersSelect = document.getElementById('playersSelect');
  const btnCreate = document.getElementById('btnCreate');
  const btnJoin = document.getElementById('btnJoin');
  const joinCodeInput = document.getElementById('joinCodeInput');
  const lobbyStatus = document.getElementById('lobbyStatus');
  const hostCodeBox = document.getElementById('hostCodeBox');
  const hostCodeDisplay = document.getElementById('hostCodeDisplay');
  const copyCodeBtn = document.getElementById('copyCodeBtn');
  const waitingSub = document.getElementById('waitingSub');
  const rosterList = document.getElementById('rosterList');
  const btnStartGame = document.getElementById('btnStartGame');
  const btnCancelWait = document.getElementById('btnCancelWait');
  const countdownNum = document.getElementById('countdownNum');
  const opponentsRow = document.getElementById('opponentsRow');
  const boardEl = document.getElementById('board');
  const myScoreEl = document.getElementById('myScore');
  const comboBadgeEl = document.getElementById('comboBadge');
  const connStatusEl = document.getElementById('connStatus');
  const myBarFillEl = document.getElementById('myBarFill');
  const resultTitle = document.getElementById('resultTitle');
  const resultSub = document.getElementById('resultSub');
  const btnRematch = document.getElementById('btnRematch');
  const btnBackLobby = document.getElementById('btnBackLobby');
  const hitFlashOverlay = document.getElementById('hitFlashOverlay');

  // ---------- Local match state ----------
  let grid = [];
  let cellEls = [];
  let animating = false;
  let gameActive = false;
  let myScore = 0;
  let myBar = 0;
  let candyIdCounter = 0;
  let selectedIdx = null;
  let dragState = null;
  let comboStreak = 0;
  let lastMoveTime = 0;

  // ---------- Networking / roster state ----------
  let peer = null;
  let isHost = false;
  let myId = null;
  let maxPlayers = 2;
  let roster = []; // [{id, label, alive, score, bar, boardTypes}]
  let hostConns = new Map(); // id -> DataConnection (host only)
  let hostLastMsg = new Map(); // id -> timestamp (host only)
  let guestConn = null; // (guest only)
  let nextIdCounter = 2;
  let opponentCardEls = new Map(); // id -> {cardEl, nameEl, scoreEl, barFillEl, miniCellEls}
  let heartbeatInterval = null;
  let watchdogInterval = null;
  let lastMessageTime = 0; // guest only

  function vibrate(pattern) { if (navigator.vibrate) navigator.vibrate(pattern); }
  function wait(ms) { return new Promise((res) => setTimeout(res, ms)); }
  function idx(r, c) { return r * COLS + c; }
  function inBounds(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }

  function showScreen(name) {
    for (const key in screens) screens[key].classList.toggle('hidden', key !== name);
  }

  // ---------- Grid logic ----------
  function randomType() { return Math.floor(Math.random() * CANDY_TYPES.length); }
  function makeCandy() { return { type: randomType(), id: candyIdCounter++ }; }

  function createInitialGrid() {
    let attempt = 0;
    do {
      grid = new Array(COLS * ROWS);
      for (let i = 0; i < grid.length; i++) grid[i] = makeCandy();
      attempt++;
    } while ((findMatches().size > 0 || !hasValidMove()) && attempt < 50);
  }

  function findMatches() {
    const matched = new Set();
    for (let r = 0; r < ROWS; r++) {
      let runStart = 0;
      for (let c = 1; c <= COLS; c++) {
        const same = c < COLS && grid[idx(r, c)] && grid[idx(r, runStart)] &&
          grid[idx(r, c)].type === grid[idx(r, runStart)].type;
        if (!same) {
          if (c - runStart >= 3) for (let k = runStart; k < c; k++) matched.add(idx(r, k));
          runStart = c;
        }
      }
    }
    for (let c = 0; c < COLS; c++) {
      let runStart = 0;
      for (let r = 1; r <= ROWS; r++) {
        const same = r < ROWS && grid[idx(r, c)] && grid[idx(runStart, c)] &&
          grid[idx(r, c)].type === grid[idx(runStart, c)].type;
        if (!same) {
          if (r - runStart >= 3) for (let k = runStart; k < r; k++) matched.add(idx(k, c));
          runStart = r;
        }
      }
    }
    return matched;
  }

  // Like findMatches(), but grouped into runs with type/orientation so resolveBoard
  // can decide where special candies (striped / bomb) should be created.
  function scanRuns() {
    const hRuns = [];
    for (let r = 0; r < ROWS; r++) {
      let runStart = 0;
      for (let c = 1; c <= COLS; c++) {
        const same = c < COLS && grid[idx(r, c)] && grid[idx(r, runStart)] &&
          grid[idx(r, c)].type === grid[idx(r, runStart)].type;
        if (!same) {
          if (c - runStart >= 3) {
            const cells = [];
            for (let k = runStart; k < c; k++) cells.push(idx(r, k));
            hRuns.push({ orientation: 'h', cells, type: grid[idx(r, runStart)].type });
          }
          runStart = c;
        }
      }
    }
    const vRuns = [];
    for (let c = 0; c < COLS; c++) {
      let runStart = 0;
      for (let r = 1; r <= ROWS; r++) {
        const same = r < ROWS && grid[idx(r, c)] && grid[idx(runStart, c)] &&
          grid[idx(r, c)].type === grid[idx(runStart, c)].type;
        if (!same) {
          if (r - runStart >= 3) {
            const cells = [];
            for (let k = runStart; k < r; k++) cells.push(idx(k, c));
            vRuns.push({ orientation: 'v', cells, type: grid[idx(runStart, c)].type });
          }
          runStart = r;
        }
      }
    }
    return { hRuns, vRuns };
  }

  function swapCells(i1, i2) {
    const tmp = grid[i1];
    grid[i1] = grid[i2];
    grid[i2] = tmp;
  }

  function areAdjacent(i1, i2) {
    const r1 = Math.floor(i1 / COLS), c1 = i1 % COLS;
    const r2 = Math.floor(i2 / COLS), c2 = i2 % COLS;
    return (Math.abs(r1 - r2) === 1 && c1 === c2) || (Math.abs(c1 - c2) === 1 && r1 === r2);
  }

  function hasValidMove() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = idx(r, c);
        if (c < COLS - 1) {
          swapCells(i, idx(r, c + 1));
          const found = findMatches().size > 0;
          swapCells(i, idx(r, c + 1));
          if (found) return true;
        }
        if (r < ROWS - 1) {
          swapCells(i, idx(r + 1, c));
          const found = findMatches().size > 0;
          swapCells(i, idx(r + 1, c));
          if (found) return true;
        }
      }
    }
    return false;
  }

  function applyGravityAndRefill() {
    for (let c = 0; c < COLS; c++) {
      const colVals = [];
      for (let r = 0; r < ROWS; r++) {
        const v = grid[idx(r, c)];
        if (v) colVals.push(v);
      }
      const missing = ROWS - colVals.length;
      const full = [];
      for (let i = 0; i < missing; i++) full.push(makeCandy());
      for (const v of colVals) full.push(v);
      for (let r = 0; r < ROWS; r++) grid[idx(r, c)] = full[r];
    }
  }

  function computePoints(count, cascadeLevel) {
    const multiplier = 1 + (cascadeLevel - 1) * 0.5;
    return Math.round(count * 10 * multiplier);
  }

  function gridTypes() { return grid.map((c) => c.type); }

  // ---------- Rendering: own board ----------
  function buildBoardDOM() {
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = `repeat(${COLS}, var(--cell-size, 36px))`;
    cellEls = new Array(COLS * ROWS);

    const availableWidth = Math.min(window.innerWidth - 24, 460);
    const gap = 4, padding = 16;
    const cellSize = Math.max(24, Math.floor((availableWidth - padding - gap * (COLS - 1)) / COLS));
    boardEl.style.setProperty('--cell-size', cellSize + 'px');

    const frag = document.createDocumentFragment();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const el = document.createElement('div');
        el.className = 'candy';
        const i = idx(r, c);
        el.dataset.i = i;
        attachCandyEvents(el, i);
        frag.appendChild(el);
        cellEls[i] = el;
      }
    }
    boardEl.appendChild(frag);
  }

  function renderAll() {
    for (let i = 0; i < grid.length; i++) {
      const el = cellEls[i];
      const cell = grid[i];
      const special = cell && cell.special;
      el.textContent = cell ? CANDY_TYPES[cell.type] : '';
      el.classList.remove('matched');
      el.classList.toggle('selected', i === selectedIdx);
      el.classList.toggle('special-striped-h', !!(special && special.type === 'striped' && special.orientation === 'h'));
      el.classList.toggle('special-striped-v', !!(special && special.type === 'striped' && special.orientation === 'v'));
      el.classList.toggle('special-bomb', !!(special && special.type === 'bomb'));
    }
  }

  function updateScoreUI() { myScoreEl.textContent = myScore; }
  function updateMyBarUI() { myBarFillEl.style.width = Math.min(100, myBar) + '%'; }

  function updateComboUI() {
    if (comboStreak >= 2) {
      const mult = 1 + Math.min(comboStreak - 1, STREAK_CAP) * STREAK_STEP;
      comboBadgeEl.textContent = `🔥 Combo x${mult.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
      comboBadgeEl.classList.remove('hidden');
      comboBadgeEl.classList.remove('pop');
      void comboBadgeEl.offsetWidth;
      comboBadgeEl.classList.add('pop');
    } else {
      comboBadgeEl.classList.add('hidden');
    }
  }

  // ---------- Juice: score popups, flashes, confetti ----------
  function spawnScorePopup(text, i1, i2) {
    const el1 = cellEls[i1], el2 = cellEls[i2];
    if (!el1 || !el2) return;
    const boardRect = boardEl.getBoundingClientRect();
    const r1 = el1.getBoundingClientRect(), r2 = el2.getBoundingClientRect();
    const x = (r1.left + r1.width / 2 + r2.left + r2.width / 2) / 2 - boardRect.left;
    const y = (r1.top + r1.height / 2 + r2.top + r2.height / 2) / 2 - boardRect.top;
    const popup = document.createElement('div');
    popup.className = 'score-popup';
    popup.textContent = text;
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
    boardEl.appendChild(popup);
    setTimeout(() => popup.remove(), 900);
  }

  function flashHit() {
    hitFlashOverlay.classList.remove('flash');
    void hitFlashOverlay.offsetWidth;
    hitFlashOverlay.classList.add('flash');
  }

  function spawnConfetti() {
    const colors = ['#ff4d8d', '#ffd13d', '#3dd68c', '#4da3ff', '#ff9a3d', '#8b5a2b'];
    const container = document.createElement('div');
    container.className = 'confetti-container';
    for (let i = 0; i < 40; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDelay = (Math.random() * 0.4) + 's';
      p.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
      container.appendChild(p);
    }
    document.body.appendChild(container);
    setTimeout(() => container.remove(), 3200);
  }

  async function animateSwapVisual(i1, i2) {
    const el1 = cellEls[i1], el2 = cellEls[i2];
    if (!el1 || !el2) return;
    const r1 = Math.floor(i1 / COLS), c1 = i1 % COLS;
    const r2 = Math.floor(i2 / COLS), c2 = i2 % COLS;
    const cellSize = parseFloat(getComputedStyle(boardEl).getPropertyValue('--cell-size')) || 36;
    const gap = 4;
    const dx = (c2 - c1) * (cellSize + gap);
    const dy = (r2 - r1) * (cellSize + gap);
    el1.style.transition = 'transform 0.15s ease';
    el2.style.transition = 'transform 0.15s ease';
    el1.style.transform = `translate(${dx}px, ${dy}px)`;
    el2.style.transform = `translate(${-dx}px, ${-dy}px)`;
    await wait(150);
    el1.style.transition = '';
    el2.style.transition = '';
    el1.style.transform = '';
    el2.style.transform = '';
  }

  // ---------- Rendering: opponents row ----------
  function ensureOpponentCard(id) {
    if (opponentCardEls.has(id)) return opponentCardEls.get(id);
    const cardEl = document.createElement('div');
    cardEl.className = 'opponent-card';
    cardEl.dataset.id = id;

    const nameEl = document.createElement('div');
    nameEl.className = 'opponent-name';

    const miniBoard = document.createElement('div');
    miniBoard.className = 'mini-board';
    miniBoard.style.gridTemplateColumns = `repeat(${COLS}, var(--mini-cell-size, 9px))`;
    const miniCellEls = new Array(COLS * ROWS);
    for (let i = 0; i < COLS * ROWS; i++) {
      const mc = document.createElement('div');
      mc.className = 'mini-cell';
      miniBoard.appendChild(mc);
      miniCellEls[i] = mc;
    }

    const barTrack = document.createElement('div');
    barTrack.className = 'opponent-bar-track';
    const barFillEl = document.createElement('div');
    barFillEl.className = 'opponent-bar-fill';
    barTrack.appendChild(barFillEl);

    const scoreEl = document.createElement('div');
    scoreEl.className = 'opponent-score';

    cardEl.appendChild(nameEl);
    cardEl.appendChild(miniBoard);
    cardEl.appendChild(barTrack);
    cardEl.appendChild(scoreEl);
    opponentsRow.appendChild(cardEl);

    const refs = { cardEl, nameEl, scoreEl, barFillEl, miniCellEls };
    opponentCardEls.set(id, refs);
    return refs;
  }

  function updateOpponentCard(id, { label, score, bar, boardTypes, alive }) {
    const refs = ensureOpponentCard(id);
    if (label !== undefined) refs.nameEl.textContent = label;
    if (score !== undefined) refs.scoreEl.textContent = score + ' pts';
    if (bar !== undefined) refs.barFillEl.style.width = Math.min(100, bar) + '%';
    if (boardTypes) {
      for (let i = 0; i < boardTypes.length; i++) {
        refs.miniCellEls[i].style.background = CANDY_COLORS[boardTypes[i]];
      }
    }
    if (alive !== undefined) refs.cardEl.classList.toggle('eliminated', !alive);
  }

  function removeOpponentCard(id) {
    const refs = opponentCardEls.get(id);
    if (refs) { refs.cardEl.remove(); opponentCardEls.delete(id); }
  }

  function rebuildOpponentsRow() {
    opponentsRow.innerHTML = '';
    opponentCardEls.clear();
    for (const p of roster) {
      if (p.id === myId) continue;
      updateOpponentCard(p.id, { label: p.label, score: p.score, bar: p.bar, boardTypes: p.boardTypes, alive: p.alive });
    }
  }

  // ---------- Move resolution ----------
  async function resolveBoard() {
    let cascadeLevel = 0;
    let totalPoints = 0;
    while (true) {
      const { hRuns, vRuns } = scanRuns();
      if (hRuns.length === 0 && vRuns.length === 0) break;
      cascadeLevel++;
      if (cascadeLevel > 40) break; // safety net against pathological chains

      const matched = new Set();
      const specialsToCreate = [];
      const usedV = new Set();

      for (const h of hRuns) {
        h.cells.forEach((i) => matched.add(i));
        let mergedV = null;
        for (const v of vRuns) {
          if (usedV.has(v)) continue;
          const shared = h.cells.filter((i) => v.cells.includes(i));
          if (shared.length >= 1) { mergedV = { v, at: shared[0] }; break; }
        }
        if (mergedV) {
          mergedV.v.cells.forEach((i) => matched.add(i));
          usedV.add(mergedV.v);
          specialsToCreate.push({ index: mergedV.at, type: 'bomb', matchType: h.type });
        } else if (h.cells.length >= 5) {
          specialsToCreate.push({ index: h.cells[Math.floor(h.cells.length / 2)], type: 'bomb', matchType: h.type });
        } else if (h.cells.length === 4) {
          specialsToCreate.push({ index: h.cells[Math.floor(h.cells.length / 2)], type: 'striped', orientation: 'h', matchType: h.type });
        }
      }
      for (const v of vRuns) {
        if (usedV.has(v)) continue;
        v.cells.forEach((i) => matched.add(i));
        if (v.cells.length >= 5) {
          specialsToCreate.push({ index: v.cells[Math.floor(v.cells.length / 2)], type: 'bomb', matchType: v.type });
        } else if (v.cells.length === 4) {
          specialsToCreate.push({ index: v.cells[Math.floor(v.cells.length / 2)], type: 'striped', orientation: 'v', matchType: v.type });
        }
      }

      // Chain-activate any special candies swept into this match (their own
      // creation cells are skipped so a brand-new special can't pop itself).
      const specialIndexSet = new Set(specialsToCreate.map((s) => s.index));
      const queue = [...matched];
      const processed = new Set();
      let activationCount = 0;
      while (queue.length) {
        const i = queue.pop();
        if (processed.has(i) || specialIndexSet.has(i)) continue;
        const cell = grid[i];
        if (!cell || !cell.special) continue;
        processed.add(i);
        activationCount++;
        const r = Math.floor(i / COLS), c = i % COLS;
        const affected = [];
        if (cell.special.type === 'striped') {
          if (cell.special.orientation === 'h') for (let cc = 0; cc < COLS; cc++) affected.push(idx(r, cc));
          else for (let rr = 0; rr < ROWS; rr++) affected.push(idx(rr, c));
        } else {
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr, cc = c + dc;
            if (inBounds(rr, cc)) affected.push(idx(rr, cc));
          }
        }
        for (const a of affected) {
          if (!matched.has(a)) matched.add(a);
          queue.push(a);
        }
      }

      totalPoints += computePoints(matched.size, cascadeLevel);
      totalPoints += activationCount * ACTIVATION_BONUS;
      for (const s of specialsToCreate) totalPoints += s.type === 'bomb' ? BOMB_BONUS : STRIPED_BONUS;

      matched.forEach((i) => cellEls[i].classList.add('matched'));
      vibrate(activationCount > 0 ? 25 : 12);
      await wait(300);

      matched.forEach((i) => { if (!specialIndexSet.has(i)) grid[i] = null; });
      for (const s of specialsToCreate) {
        grid[s.index] = {
          type: s.matchType,
          id: candyIdCounter++,
          special: s.type === 'bomb' ? { type: 'bomb' } : { type: 'striped', orientation: s.orientation },
        };
      }

      applyGravityAndRefill();
      renderAll();
      for (const s of specialsToCreate) {
        const el = cellEls[s.index];
        if (!el) continue;
        el.classList.remove('special-created');
        void el.offsetWidth;
        el.classList.add('special-created');
      }
      await wait(160);
    }
    return totalPoints;
  }

  function broadcastOwnState() {
    const payload = { type: 'state', score: myScore, bar: Math.min(BAR_MAX, myBar), boardTypes: gridTypes() };
    if (isHost) {
      payload.id = HOST_ID;
      const meEntry = roster.find((p) => p.id === HOST_ID);
      if (meEntry) { meEntry.score = myScore; meEntry.bar = payload.bar; meEntry.boardTypes = payload.boardTypes; }
      broadcastFromHost(payload);
    } else {
      sendToHost(payload);
    }
  }

  function applyMoveResult(points) {
    if (points <= 0) return 0;
    const now = Date.now();
    if (now - lastMoveTime > STREAK_TIMEOUT_MS) comboStreak = 0;
    comboStreak++;
    lastMoveTime = now;
    const streakMult = 1 + Math.min(comboStreak - 1, STREAK_CAP) * STREAK_STEP;
    const finalPoints = Math.round(points * streakMult);
    updateComboUI();

    myScore += finalPoints;
    updateScoreUI();

    const power = finalPoints / BAR_DIVISOR;
    let overflow = 0;
    if (myBar >= power) {
      myBar -= power;
    } else {
      overflow = power - myBar;
      myBar = 0;
    }
    updateMyBarUI();
    broadcastOwnState();

    if (overflow > 0) {
      if (isHost) pickTargetAndApplyAttack(HOST_ID, overflow);
      else sendToHost({ type: 'attackRequest', amount: overflow });
    }
    return finalPoints;
  }

  async function attemptSwap(i1, i2) {
    if (animating || !gameActive) return;
    if (!areAdjacent(i1, i2)) return;
    animating = true;
    selectedIdx = null;

    await animateSwapVisual(i1, i2);
    swapCells(i1, i2);
    renderAll();

    const matched = findMatches();
    if (matched.size === 0) {
      await animateSwapVisual(i1, i2);
      swapCells(i1, i2);
      renderAll();
      animating = false;
      return;
    }

    vibrate(15);
    const points = await resolveBoard();
    renderAll();
    const finalPoints = applyMoveResult(points);
    if (finalPoints > 0) spawnScorePopup(`+${finalPoints}`, i1, i2);

    if (!hasValidMove()) {
      createInitialGrid();
      renderAll();
      broadcastOwnState();
    }
    animating = false;
  }

  // ---------- Input handling ----------
  function attachCandyEvents(el, i) {
    el.addEventListener('pointerdown', (e) => {
      if (animating || !gameActive) return;
      el.setPointerCapture(e.pointerId);
      dragState = { startIdx: i, startX: e.clientX, startY: e.clientY, moved: false };
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragState || dragState.startIdx !== i || dragState.moved) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      const THRESH = 14;
      if (Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) return;
      dragState.moved = true;

      const r = Math.floor(i / COLS), c = i % COLS;
      let targetR = r, targetC = c;
      if (Math.abs(dx) > Math.abs(dy)) targetC += dx > 0 ? 1 : -1;
      else targetR += dy > 0 ? 1 : -1;

      if (inBounds(targetR, targetC)) attemptSwap(i, idx(targetR, targetC));
      selectedIdx = null;
      renderAll();
      dragState = null;
    });

    el.addEventListener('pointerup', () => {
      if (dragState && dragState.startIdx === i && !dragState.moved) {
        if (selectedIdx === null) selectedIdx = i;
        else if (selectedIdx === i) selectedIdx = null;
        else if (areAdjacent(selectedIdx, i)) {
          const other = selectedIdx;
          selectedIdx = null;
          attemptSwap(other, i);
        } else selectedIdx = i;
        renderAll();
      }
      dragState = null;
    });
  }

  window.addEventListener('resize', () => {
    if (screens.Battle.classList.contains('hidden')) return;
    buildBoardDOM();
    renderAll();
  });

  // ---------- Game lifecycle ----------
  function resetLocalState() {
    myScore = 0;
    myBar = 0;
    selectedIdx = null;
    animating = false;
    comboStreak = 0;
    lastMoveTime = 0;
    createInitialGrid();
  }

  function startCountdown() {
    showScreen('Countdown');
    let n = 3;
    countdownNum.textContent = n;
    const t = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(t);
        beginBattle();
      } else {
        countdownNum.textContent = n;
      }
    }, 1000);
  }

  function beginBattle() {
    resetLocalState();
    gameActive = true;
    updateScoreUI();
    updateMyBarUI();
    updateComboUI();
    for (const p of roster) { p.alive = true; p.score = 0; p.bar = 0; p.boardTypes = null; }
    showScreen('Battle');
    buildBoardDOM();
    renderAll();
    rebuildOpponentsRow();
    broadcastOwnState();
  }

  function opponentLabel(id) {
    const p = roster.find((x) => x.id === id);
    return p ? p.label : id;
  }

  function showEliminated() {
    gameActive = false;
    resultTitle.textContent = 'Você perdeu!';
    resultTitle.className = 'lose';
    resultSub.textContent = 'Sua barra encheu. Aguardando o fim da partida...';
    btnRematch.classList.toggle('hidden', !isHost);
    vibrate([80, 60, 200]);
    showScreen('GameOver');
    const card = screens.GameOver.querySelector('.card');
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  }

  function showVictory() {
    gameActive = false;
    resultTitle.textContent = 'Você venceu! 🎉';
    resultTitle.className = 'win';
    resultSub.textContent = 'Você foi o último a sobreviver!';
    btnRematch.classList.toggle('hidden', !isHost);
    vibrate([20, 40, 20, 40, 60]);
    showScreen('GameOver');
    spawnConfetti();
  }

  function announceFinalResult(winnerId) {
    if (winnerId === myId) {
      showVictory();
    } else if (!screens.GameOver.classList.contains('hidden')) {
      resultSub.textContent = `${opponentLabel(winnerId)} venceu a partida!`;
      btnRematch.classList.toggle('hidden', !isHost);
    } else {
      // still active but not the winner: defensive fallback
      gameActive = false;
      resultTitle.textContent = 'Fim de jogo';
      resultTitle.className = 'lose';
      resultSub.textContent = `${opponentLabel(winnerId)} venceu a partida!`;
      btnRematch.classList.toggle('hidden', !isHost);
      showScreen('GameOver');
    }
  }

  // ---------- Host authority (roster / attacks / elimination) ----------
  function pickTargetAndApplyAttack(fromId, amount) {
    const aliveOthers = roster.filter((p) => p.alive && p.id !== fromId);
    if (aliveOthers.length === 0) return;
    const target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
    if (target.id === HOST_ID) {
      myBar = Math.min(BAR_MAX + 50, myBar + amount);
      updateMyBarUI();
      flashHit();
      broadcastOwnState();
      if (myBar >= BAR_MAX) markPlayerLost(HOST_ID);
    } else {
      sendToPlayer(target.id, { type: 'attack', amount });
    }
  }

  function markPlayerLost(id) {
    const p = roster.find((x) => x.id === id);
    if (!p || !p.alive) return;
    p.alive = false;
    broadcastFromHost({ type: 'playerLost', id });
    updateOpponentCard(id, { alive: false });
    if (id === HOST_ID) showEliminated();

    const aliveList = roster.filter((x) => x.alive);
    if (aliveList.length === 1) {
      const winner = aliveList[0];
      broadcastFromHost({ type: 'gameEnd', winnerId: winner.id });
      announceFinalResult(winner.id);
    }
  }

  // ---------- Networking plumbing ----------
  function sendToHost(msg) {
    if (guestConn && guestConn.open) { try { guestConn.send(msg); } catch (e) {} }
  }
  function sendToPlayer(id, msg) {
    const c = hostConns.get(id);
    if (c && c.open) { try { c.send(msg); } catch (e) {} }
  }
  function broadcastFromHost(msg, excludeId) {
    for (const [id, c] of hostConns) {
      if (id === excludeId) continue;
      if (c.open) { try { c.send(msg); } catch (e) {} }
    }
  }

  function renderRosterList() {
    rosterList.innerHTML = '';
    for (const p of roster) {
      const li = document.createElement('li');
      const tag = p.id === myId ? ' (você)' : (p.id === HOST_ID ? ' (anfitrião)' : '');
      li.innerHTML = `<span>${p.label}</span><span class="tag">${tag || '&nbsp;'}</span>`;
      rosterList.appendChild(li);
    }
    if (isHost) {
      waitingSub.textContent = `Aguardando jogadores... (${roster.length}/${maxPlayers})`;
      btnStartGame.classList.toggle('hidden', roster.length < 2);
    } else {
      waitingSub.textContent = 'Aguardando o anfitrião iniciar a partida...';
    }
  }

  // ---- Host-side message handling (from a specific guest connection) ----
  function handleHostMessage(fromId, msg) {
    hostLastMsg.set(fromId, Date.now());
    switch (msg.type) {
      case 'ping':
        break;
      case 'state': {
        const p = roster.find((x) => x.id === fromId);
        if (p) { p.score = msg.score; p.bar = msg.bar; p.boardTypes = msg.boardTypes; }
        updateOpponentCard(fromId, { score: msg.score, bar: msg.bar, boardTypes: msg.boardTypes });
        broadcastFromHost({ type: 'state', id: fromId, score: msg.score, bar: msg.bar, boardTypes: msg.boardTypes }, fromId);
        break;
      }
      case 'attackRequest':
        pickTargetAndApplyAttack(fromId, msg.amount);
        break;
      case 'lose':
        markPlayerLost(fromId);
        break;
    }
  }

  // ---- Guest-side message handling (from host) ----
  function handleGuestMessage(msg) {
    lastMessageTime = Date.now();
    switch (msg.type) {
      case 'ping':
        break;
      case 'welcome':
        myId = msg.id;
        roster = msg.players;
        showScreen('Waiting');
        renderRosterList();
        break;
      case 'roomFull':
        lobbyStatus.textContent = 'Sala cheia. Tente outro código.';
        destroyPeer();
        resetLobbyButtons();
        showScreen('Lobby');
        break;
      case 'roster':
        roster = msg.players;
        renderRosterList();
        break;
      case 'start':
        roster = msg.players;
        startCountdown();
        break;
      case 'state': {
        const p = roster.find((x) => x.id === msg.id);
        if (p) { p.score = msg.score; p.bar = msg.bar; p.boardTypes = msg.boardTypes; }
        updateOpponentCard(msg.id, { score: msg.score, bar: msg.bar, boardTypes: msg.boardTypes });
        break;
      }
      case 'attack': {
        if (!gameActive) return;
        myBar = Math.min(BAR_MAX + 50, myBar + msg.amount);
        updateMyBarUI();
        flashHit();
        broadcastOwnState();
        if (myBar >= BAR_MAX) {
          sendToHost({ type: 'lose' });
          showEliminated();
        }
        break;
      }
      case 'playerLost': {
        const p = roster.find((x) => x.id === msg.id);
        if (p) p.alive = false;
        updateOpponentCard(msg.id, { alive: false });
        break;
      }
      case 'gameEnd':
        announceFinalResult(msg.winnerId);
        break;
      case 'restart':
        roster = msg.players;
        startCountdown();
        break;
    }
  }

  // ---------- Heartbeats ----------
  function startGuestHeartbeat() {
    stopHeartbeats();
    lastMessageTime = Date.now();
    heartbeatInterval = setInterval(() => sendToHost({ type: 'ping' }), HEARTBEAT_MS);
    watchdogInterval = setInterval(() => {
      if (guestConn && Date.now() - lastMessageTime > TIMEOUT_MS) handleGuestDisconnect();
    }, 2000);
  }

  function startHostHeartbeat() {
    stopHeartbeats();
    heartbeatInterval = setInterval(() => {
      for (const [id, c] of hostConns) if (c.open) { try { c.send({ type: 'ping' }); } catch (e) {} }
    }, HEARTBEAT_MS);
    watchdogInterval = setInterval(() => {
      const now = Date.now();
      for (const [id] of hostConns) {
        const last = hostLastMsg.get(id) || now;
        if (now - last > TIMEOUT_MS) handleGuestVanished(id);
      }
    }, 2000);
  }

  function stopHeartbeats() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (watchdogInterval) clearInterval(watchdogInterval);
    heartbeatInterval = null;
    watchdogInterval = null;
  }

  function handleGuestDisconnect() {
    stopHeartbeats();
    connStatusEl.textContent = '🔴 desconectado';
    if (gameActive) {
      gameActive = false;
      resultTitle.textContent = 'Conexão perdida';
      resultTitle.className = 'lose';
      resultSub.textContent = 'A conexão com o anfitrião foi perdida.';
      btnRematch.classList.add('hidden');
      showScreen('GameOver');
    }
  }

  function handleGuestVanished(id) {
    hostConns.delete(id);
    hostLastMsg.delete(id);
    const wasAlive = roster.find((p) => p.id === id && p.alive);
    if (gameActive) {
      if (wasAlive) markPlayerLost(id);
    } else {
      roster = roster.filter((p) => p.id !== id);
      removeOpponentCard(id);
      renderRosterList();
      broadcastFromHost({ type: 'roster', players: roster });
    }
  }

  // ---------- Room lifecycle ----------
  function iceConfig() {
    return {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
        ],
      },
    };
  }

  function generateRoomCode() {
    let code = '';
    for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return code;
  }

  function destroyPeer() {
    stopHeartbeats();
    for (const [, c] of hostConns) { try { c.close(); } catch (e) {} }
    hostConns.clear();
    hostLastMsg.clear();
    if (guestConn) { try { guestConn.close(); } catch (e) {} guestConn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    roster = [];
    opponentCardEls.clear();
    opponentsRow.innerHTML = '';
  }

  function createRoom() {
    destroyPeer();
    isHost = true;
    myId = HOST_ID;
    nextIdCounter = 2;
    const code = generateRoomCode();
    lobbyStatus.textContent = '';
    btnCreate.disabled = true;
    btnJoin.disabled = true;

    peer = new Peer(ROOM_PREFIX + code, iceConfig());

    peer.on('open', () => {
      roster = [{ id: HOST_ID, label: 'Jogador 1', alive: true, score: 0, bar: 0, boardTypes: null }];
      hostCodeDisplay.textContent = code;
      hostCodeBox.classList.remove('hidden');
      showScreen('Waiting');
      renderRosterList();
      startHostHeartbeat();
    });

    peer.on('connection', (c) => {
      if (hostConns.size >= maxPlayers - 1 || gameActive) {
        c.on('open', () => { c.send({ type: 'roomFull' }); setTimeout(() => c.close(), 300); });
        return;
      }
      const id = 'p' + nextIdCounter++;
      hostConns.set(id, c);
      hostLastMsg.set(id, Date.now());

      c.on('open', () => {
        roster.push({ id, label: 'Jogador ' + id.slice(1), alive: true, score: 0, bar: 0, boardTypes: null });
        c.send({ type: 'welcome', id, players: roster });
        broadcastFromHost({ type: 'roster', players: roster }, id);
        renderRosterList();
      });
      c.on('data', (msg) => handleHostMessage(id, msg));
      c.on('close', () => handleGuestVanished(id));
      c.on('error', () => {});
    });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        createRoom();
      } else {
        lobbyStatus.textContent = 'Erro ao criar sala: ' + err.type;
        resetLobbyButtons();
      }
    });
  }

  function joinRoom() {
    const raw = joinCodeInput.value.trim().toUpperCase();
    if (!raw) { lobbyStatus.textContent = 'Digite um código de sala.'; return; }
    destroyPeer();
    isHost = false;
    lobbyStatus.textContent = 'Conectando...';
    btnCreate.disabled = true;
    btnJoin.disabled = true;

    peer = new Peer(iceConfig());

    peer.on('open', () => {
      guestConn = peer.connect(ROOM_PREFIX + raw, { reliable: true });
      guestConn.on('open', () => {
        connStatusEl.textContent = '🟢 conectado';
        guestConn.on('data', handleGuestMessage);
        startGuestHeartbeat();
      });
      guestConn.on('close', () => handleGuestDisconnect());
      guestConn.on('error', () => {
        lobbyStatus.textContent = 'Não foi possível conectar.';
        resetLobbyButtons();
      });
    });

    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') lobbyStatus.textContent = 'Sala não encontrada. Confira o código.';
      else lobbyStatus.textContent = 'Erro de conexão: ' + err.type;
      resetLobbyButtons();
    });
  }

  function resetLobbyButtons() {
    btnCreate.disabled = false;
    btnJoin.disabled = false;
    hostCodeBox.classList.add('hidden');
  }

  function cancelWaiting() {
    destroyPeer();
    lobbyStatus.textContent = '';
    resetLobbyButtons();
    showScreen('Lobby');
  }

  function backToLobby() {
    destroyPeer();
    showScreen('Lobby');
    lobbyStatus.textContent = '';
    resetLobbyButtons();
  }

  // ---------- UI wiring ----------
  playersSelect.addEventListener('click', (e) => {
    const btn = e.target.closest('.player-count-btn');
    if (!btn) return;
    maxPlayers = parseInt(btn.dataset.n, 10);
    playersSelect.querySelectorAll('.player-count-btn').forEach((b) => b.classList.toggle('active', b === btn));
  });

  btnCreate.addEventListener('click', createRoom);
  btnJoin.addEventListener('click', joinRoom);
  btnCancelWait.addEventListener('click', cancelWaiting);
  btnStartGame.addEventListener('click', () => {
    if (!isHost || roster.length < 2) return;
    broadcastFromHost({ type: 'start', players: roster });
    startCountdown();
  });

  copyCodeBtn.addEventListener('click', () => {
    const code = hostCodeDisplay.textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => {
        copyCodeBtn.textContent = 'Copiado!';
        setTimeout(() => (copyCodeBtn.textContent = 'Copiar código'), 1500);
      }).catch(() => {});
    }
  });

  btnRematch.addEventListener('click', () => {
    if (!isHost) return;
    for (const p of roster) { p.alive = true; p.score = 0; p.bar = 0; p.boardTypes = null; }
    broadcastFromHost({ type: 'restart', players: roster });
    startCountdown();
  });
  btnBackLobby.addEventListener('click', backToLobby);

  const aboutBtn = document.getElementById('aboutBtn');
  const aboutModal = document.getElementById('aboutModal');
  const closeAbout = document.getElementById('closeAbout');
  aboutBtn.addEventListener('click', () => aboutModal.classList.remove('hidden'));
  closeAbout.addEventListener('click', () => aboutModal.classList.add('hidden'));
  aboutModal.addEventListener('click', (e) => { if (e.target === aboutModal) aboutModal.classList.add('hidden'); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  setInterval(() => {
    if (comboStreak > 0 && Date.now() - lastMoveTime > STREAK_TIMEOUT_MS) {
      comboStreak = 0;
      updateComboUI();
    }
  }, 1000);

  showScreen('Lobby');
})();
