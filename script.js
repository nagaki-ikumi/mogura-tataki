/* =========================================================
   もぐら叩き - ゲームロジック
   スタート → 30秒ゲーム → 得点 → 終了 → 結果表示 → 再プレイ
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 設定値 ---------- */
  const GAME_SECONDS = 30;          // 制限時間（秒）
  const WARNING_SECONDS = 5;        // 残り何秒から時間表示を強調するか
  const SPAWN_MIN = 500;            // もぐらが場所を変える間隔：最小(ms)
  const SPAWN_MAX = 900;            // もぐらが場所を変える間隔：最大(ms)
  const HIT_HIDE_DELAY = 170;       // 叩かれてから引っ込むまで(ms)
  const TIMEUP_DISPLAY = 1100;      // 「TIME UP」表示時間(ms)
  const RETRY_LOCK = 700;           // 結果画面で誤タップを防ぐロック時間(ms)
  const STORAGE_KEY = 'moguraTataki.bestScore';

  /* ---------- 要素の取得 ---------- */
  const screens = {
    start: document.getElementById('start-screen'),
    game: document.getElementById('game-screen'),
    result: document.getElementById('result-screen'),
  };
  const startBtn = document.getElementById('start-btn');
  const retryBtn = document.getElementById('retry-btn');
  const board = document.getElementById('board');
  const timeBox = document.getElementById('time-box');
  const timeValue = document.getElementById('time-value');
  const scoreValue = document.getElementById('score-value');
  const timeupEl = document.getElementById('timeup');
  const resultScoreEl = document.getElementById('result-score');
  const bestScoreEl = document.getElementById('best-score');
  const startBestEl = document.getElementById('start-best');
  const newRecordEl = document.getElementById('new-record');

  /* ---------- ゲームの状態 ---------- */
  const state = {
    running: false,     // ゲーム中かどうか
    starting: false,    // スタートボタン連打防止用
    score: 0,
    endAt: 0,           // 終了予定時刻（performance.now 基準）
    lastShownSec: -1,   // 表示中の残り秒数（無駄な再描画を防ぐ）
    activeIndex: -1,    // 今もぐらが出ている穴の番号（-1 = なし）
    moleId: 0,          // 出現ごとに増えるID（同じもぐらの2回得点を防ぐ）
    hitMoleId: -1,      // 最後に叩いたもぐらのID
    timerId: null,
    spawnTimer: null,
    hideTimer: null,
    endTimer: null,
  };

  /* ---------- 便利関数 ---------- */
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  /** 画面を切り替える */
  function showScreen(name) {
    Object.keys(screens).forEach((key) => {
      screens[key].classList.toggle('active', key === name);
    });
  }

  /** ハイスコアを読み込む（プライベートモード等で失敗しても動くように） */
  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch (e) {
      return 0;
    }
  }

  /** ハイスコアを保存する */
  function saveBest(score) {
    try {
      localStorage.setItem(STORAGE_KEY, String(score));
    } catch (e) {
      /* 保存できない環境では何もしない */
    }
  }

  /** 対応端末のみ軽くバイブレーション */
  function vibrate(ms) {
    if (typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(ms); } catch (e) { /* 無視 */ }
    }
  }

  /* ---------- ゲーム盤（9つの穴）を生成 ---------- */
  const holes = [];

  function buildBoard() {
    for (let i = 0; i < 9; i++) {
      const hole = document.createElement('button');
      hole.type = 'button';
      hole.className = 'hole';
      hole.dataset.index = String(i);
      hole.setAttribute('aria-label', '穴 ' + (i + 1));
      // 穴の奥 → もぐら → 穴の手前のフチ の順に重ねて立体感を出す
      hole.innerHTML =
        '<div class="pit"></div>' +
        '<div class="mole-window">' +
          '<div class="mole">' +
            '<div class="mole-face">' +
              '<span class="ear left"></span><span class="ear right"></span>' +
              '<span class="eye left"></span><span class="eye right"></span>' +
              '<span class="cheek left"></span><span class="cheek right"></span>' +
              '<span class="muzzle"><span class="nose"></span><span class="teeth"></span></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="pit-front"></div>';

      // タッチ操作を最優先：click ではなく pointerdown で即座に反応
      hole.addEventListener('pointerdown', onHolePress);
      holes.push(hole);
      board.appendChild(hole);
    }
  }

  /* ---------- もぐらの出現・退場 ---------- */

  /** 次のもぐらを出す（0.5〜0.9秒ごとにランダムな穴へ） */
  function spawnMole() {
    if (!state.running) return;

    // 前のもぐらが残っていれば引っ込める
    hideMole();

    const interval = randInt(SPAWN_MIN, SPAWN_MAX);
    // 表示時間も少しランダムに（次の出現より少し前に引っ込む）
    const visible = randInt(Math.max(320, interval - 260), interval - 100);

    const index = randInt(0, 8);     // 同じ穴に連続で出てもOK
    const hole = holes[index];

    state.moleId += 1;
    state.activeIndex = index;
    const thisId = state.moleId;

    // 同じ穴に連続で出た場合でも「引っ込む → ポンッ」と見えるよう、
    // 次のフレームで up を付ける
    hole.classList.remove('hit');
    requestAnimationFrame(() => {
      if (state.running && state.moleId === thisId) {
        hole.classList.add('up');
      }
    });

    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => {
      if (state.moleId === thisId) hideMole();
    }, visible);

    clearTimeout(state.spawnTimer);
    state.spawnTimer = setTimeout(spawnMole, interval);
  }

  /** 今出ているもぐらを引っ込める */
  function hideMole() {
    if (state.activeIndex >= 0) {
      holes[state.activeIndex].classList.remove('up');
    }
    state.activeIndex = -1;
  }

  /** すべての穴をリセット */
  function resetHoles() {
    holes.forEach((h) => h.classList.remove('up', 'hit'));
    state.activeIndex = -1;
  }

  /* ---------- タップ処理 ---------- */
  function onHolePress(e) {
    e.preventDefault(); // ダブルタップズーム・ゴーストクリック防止
    if (!state.running) return;

    const index = Number(e.currentTarget.dataset.index);

    // もぐらが出ていない穴 / 既に叩いたもぐら は無視（連打・二重得点防止）
    if (index !== state.activeIndex) return;
    if (state.hitMoleId === state.moleId) return;

    state.hitMoleId = state.moleId;
    const hole = holes[index];
    const hitId = state.moleId;

    // 得点
    state.score += 1;
    updateScore();

    // 演出
    hole.classList.add('hit');
    showBurst(hole);
    showPlusOne(e.clientX, e.clientY, hole);
    vibrate(25);

    // 叩かれたもぐらはすぐ引っ込む
    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => {
      if (state.moleId === hitId) hideMole();
    }, HIT_HIDE_DELAY);
  }

  /** 穴の中にリングのエフェクト */
  function showBurst(hole) {
    const ring = document.createElement('span');
    ring.className = 'burst';
    hole.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove(), { once: true });
    setTimeout(() => ring.remove(), 600); // 念のための保険
  }

  /** タップした場所に「+1」を表示 */
  function showPlusOne(x, y, hole) {
    // 座標が取れない場合は穴の中心に出す
    if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) {
      const r = hole.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    const el = document.createElement('span');
    el.className = 'plus-one';
    el.textContent = '+1';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 900); // 念のための保険
  }

  /* ---------- 表示更新 ---------- */
  function updateScore() {
    scoreValue.textContent = String(state.score);
    // ポップアニメーションを毎回再生させる
    scoreValue.classList.remove('bump');
    void scoreValue.offsetWidth;
    scoreValue.classList.add('bump');
  }

  /** 残り時間の更新（実時間ベースなのでズレにくい） */
  function tick() {
    if (!state.running) return;

    const remainMs = Math.max(0, state.endAt - performance.now());
    const sec = Math.ceil(remainMs / 1000);

    if (sec !== state.lastShownSec) {
      state.lastShownSec = sec;
      timeValue.textContent = String(sec);
      timeBox.classList.toggle('warning', sec <= WARNING_SECONDS && sec > 0);
    }

    if (remainMs <= 0) {
      endGame();
    }
  }

  /* ---------- ゲームの流れ ---------- */

  /** ゲーム開始 */
  function startGame() {
    if (state.running || state.starting) return; // 連打防止
    state.starting = true;
    startBtn.disabled = true;
    retryBtn.disabled = true;

    // 状態をリセット
    clearAllTimers();
    resetHoles();
    state.score = 0;
    state.moleId = 0;
    state.hitMoleId = -1;
    state.lastShownSec = -1;
    scoreValue.textContent = '0';
    timeValue.textContent = String(GAME_SECONDS);
    timeBox.classList.remove('warning');
    timeupEl.classList.remove('show');

    showScreen('game');

    // 画面切り替えのアニメーションが落ち着いてからスタート
    setTimeout(() => {
      state.starting = false;
      state.running = true;
      state.endAt = performance.now() + GAME_SECONDS * 1000;
      state.timerId = setInterval(tick, 100);
      tick();
      state.spawnTimer = setTimeout(spawnMole, 250);
    }, 350);
  }

  /** ゲーム終了 */
  function endGame() {
    if (!state.running) return;
    state.running = false;
    clearAllTimers();
    hideMole();

    timeValue.textContent = '0';
    timeBox.classList.remove('warning');
    timeupEl.classList.add('show');
    vibrate([60, 60, 60]);

    // ハイスコア判定
    const prevBest = loadBest();
    const isNewRecord = state.score > prevBest;
    const best = isNewRecord ? state.score : prevBest;
    if (isNewRecord) saveBest(best);

    state.endTimer = setTimeout(() => {
      showResult(state.score, best, isNewRecord);
    }, TIMEUP_DISPLAY);
  }

  /** 結果画面を表示 */
  function showResult(score, best, isNewRecord) {
    timeupEl.classList.remove('show');
    resetHoles();

    resultScoreEl.textContent = String(score);
    bestScoreEl.textContent = String(best);
    startBestEl.textContent = String(best);
    newRecordEl.classList.toggle('show', isNewRecord);

    showScreen('result');

    // 連打の勢いで即リトライしないよう、少しだけボタンをロック
    retryBtn.disabled = true;
    setTimeout(() => {
      retryBtn.disabled = false;
      startBtn.disabled = false;
    }, RETRY_LOCK);
  }

  function clearAllTimers() {
    clearInterval(state.timerId);
    clearTimeout(state.spawnTimer);
    clearTimeout(state.hideTimer);
    clearTimeout(state.endTimer);
    state.timerId = state.spawnTimer = state.hideTimer = state.endTimer = null;
  }

  /* ---------- スマホ向けの操作ガード ---------- */
  function setupTouchGuards() {
    // ゲーム中は画面スクロールを完全に止める（ピンチも常に止める）
    document.addEventListener('touchmove', (e) => {
      if (state.running || e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    // 盤面上のタッチは既定動作（スクロール・ズーム・長押し選択）をすべて止める
    board.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

    // iOS Safari のピンチズーム防止
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
      document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    });

    // ダブルタップズーム防止（300ms以内の連続タップの既定動作を止める）
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });

    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

    // 長押しメニューを出さない
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* ---------- 初期化 ---------- */
  function init() {
    buildBoard();
    setupTouchGuards();

    const best = loadBest();
    startBestEl.textContent = String(best);
    bestScoreEl.textContent = String(best);

    startBtn.addEventListener('click', startGame);
    retryBtn.addEventListener('click', startGame);
  }

  init();
})();
