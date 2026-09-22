// =====================================================
//  フレーズ練習（投錨・抜錨 / 出入港・当直引き継ぎ）
//
//  出題データ: phrases.json
//    { "anchor": [ { "en": "...", "ja": "..." }, ... ],
//      "harbor": [ ... ] }
//
//  ・[left/right] のような [] 付き表現は、選択肢ごとに別の問題として展開します
//  ・15問ごとにセット（A-1, A-2, ...）に分けます
//  ・誤答はブラウザに記録し、「もう一度取り組む」で復習できます
//
//  script.js の関数（speak, appendMessage, sendToGoogleForm など）を使うため、
//  index.html では script.js の後に読み込んでください。
// =====================================================
(function () {
  const SET_SIZE = 15;
  const MISTAKE_KEY = "phraseMistakes";
  const NEXT_QUESTION_DELAY_MS = 1200;

  const CATEGORIES = {
    anchor: {
      title: "投錨・抜錨",
      modes: [
        { letter: "A", type: "ja",     label: "A 和訳" },
        { letter: "B", type: "en",     label: "B 英訳" },
        { letter: "C", type: "listen", label: "C Listening" }
      ]
    },
    harbor: {
      title: "出入港・当直引き継ぎ",
      modes: [
        { letter: "D", type: "ja",     label: "D 和訳" },
        { letter: "E", type: "en",     label: "E 英訳" },
        { letter: "F", type: "listen", label: "F Listening" }
      ]
    }
  };

  // 記号 → カテゴリと出題形式
  const LETTERS = {};
  Object.keys(CATEGORIES).forEach(kind => {
    CATEGORIES[kind].modes.forEach(m => { LETTERS[m.letter] = { kind, type: m.type, label: m.label }; });
  });

  let phrases = null;          // { anchor: [{en, ja, accept}], harbor: [...] }（展開済み）
  let loadError = false;

  const state = {
    kind: null,
    letter: null,
    queue: [],                 // [{ letter, index }]（index は展開後の通し番号 0 始まり）
    pos: 0,
    correct: 0,
    answered: false,
    isRetry: false,
    nextTimer: null
  };

  // =====================================================
  //  [] 付き表現の展開
  //  "x cables [left/right], sir." → "x cables left, sir." / "x cables right, sir."
  //  日本語側にも同じ数の [] があれば、同じ順番で対応づけます。
  // =====================================================
  function splitGroups(text) {
    const src = String(text || "").replace(/［/g, "[").replace(/］/g, "]").replace(/／/g, "/");
    const parts = [];
    const re = /\[([^\]]+)\]/g;
    let last = 0, m;
    while ((m = re.exec(src))) {
      parts.push(src.slice(last, m.index));
      parts.push(m[1].split("/").map(x => x.trim()));
      last = re.lastIndex;
    }
    parts.push(src.slice(last));
    return parts;
  }

  function build(parts, choice) {
    let g = 0;
    return parts.map(p => (Array.isArray(p) ? p[choice[g++]] : p)).join("").replace(/\s+/g, " ").trim();
  }

  function expandItem(item) {
    const ep = splitGroups(item.en);
    const jp = splitGroups(item.ja);
    const eg = ep.filter(Array.isArray);
    const jg = jp.filter(Array.isArray);
    const aligned = eg.length === jg.length && eg.every((g, i) => g.length === jg[i].length);

    if (eg.length && !aligned) {
      console.warn("英語と日本語の [] の数・選択肢数が一致しません。日本語はそのまま使います:", item);
    }

    // 選択肢の組み合わせをすべて作る
    let combos = [[]];
    eg.forEach(g => {
      const next = [];
      combos.forEach(c => g.forEach((_, i) => next.push(c.concat(i))));
      combos = next;
    });

    return combos.map(choice => ({
      en: build(ep, choice),
      ja: aligned ? build(jp, choice) : String(item.ja || ""),
      accept: Array.isArray(item.jaAccept) ? item.jaAccept : [],     // 別解として認める和訳（任意）
      enAccept: Array.isArray(item.enAccept) ? item.enAccept : [],   // 別解として認める英文（省略形・言い換え）
      note: item.note ? String(item.note) : ""                        // 補足（例: 船長の発言）
    }));
  }

  function loadPhrases() {
    return fetch("phrases.json", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(data => {
        phrases = {};
        Object.keys(CATEGORIES).forEach(kind => {
          const list = Array.isArray(data[kind]) ? data[kind] : [];
          phrases[kind] = list.flatMap(expandItem).filter(q => q.en);
        });
      })
      .catch(err => {
        loadError = true;
        console.error("phrases.json を読み込めませんでした:", err);
      });
  }

  // =====================================================
  //  判定
  // =====================================================
  function normalizeJa(text) {
    return String(text || "")
      .normalize("NFKC")
      .replace(/[\s、。,.．，・!?！？「」『』()（）"'“”‘’]/g, "")
      .trim();
  }

  // 英文は script.js の normalize に加え、引用符の有無も無視する
  function normalizeEn(text) {
    return normalize(String(text || "").replace(/["\u201C\u201D]/g, ""));
  }

  function isCorrect(item, type, answer) {
    if (type === "ja") {
      const a = normalizeJa(answer);
      return [item.ja].concat(item.accept).some(x => normalizeJa(x) === a);
    }
    const a = normalizeEn(answer);
    return [item.en].concat(item.enAccept || []).some(x => normalizeEn(x) === a);
  }

  // =====================================================
  //  誤答の記録（ブラウザに保存）
  // =====================================================
  function loadMistakes() {
    try { return JSON.parse(localStorage.getItem(MISTAKE_KEY) || "{}"); } catch (e) { return {}; }
  }
  function saveMistakes(m) {
    try { localStorage.setItem(MISTAKE_KEY, JSON.stringify(m)); } catch (e) { /* 保存できなくても継続 */ }
  }
  function mistakeKey(letter, index) { return `${letter}:${index}`; }

  function markResult(letter, index, correct) {
    const m = loadMistakes();
    if (correct) delete m[mistakeKey(letter, index)];
    else m[mistakeKey(letter, index)] = Date.now();
    saveMistakes(m);
  }

  // =====================================================
  //  セット番号・表示用ID
  // =====================================================
  function setCount(kind) {
    return phrases && phrases[kind] ? Math.ceil(phrases[kind].length / SET_SIZE) : 0;
  }
  function setOf(index) { return Math.floor(index / SET_SIZE) + 1; }
  function numberInSet(index) { return (index % SET_SIZE) + 1; }
  function questionId(letter, index) { return `${letter}-${setOf(index)}-${numberInSet(index)}`; }

  // =====================================================
  //  画面（#practice-box）
  // =====================================================
  function el(tag, attrs = {}, text = "") {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") e.className = v; else if (k.startsWith("data-")) e.setAttribute(k, v); else e[k] = v;
    });
    if (text) e.textContent = text;
    return e;
  }

  function renderBox() {
    const box = document.getElementById("practice-box");
    if (!box) return;
    box.textContent = "";
    box.style.display = "block";

    const cat = CATEGORIES[state.kind];
    box.appendChild(el("h4", {}, cat.title));

    if (loadError) {
      box.appendChild(el("p", { class: "practice-note" }, "phrases.json を読み込めませんでした。ファイルの配置と形式を確認してください。"));
      return;
    }
    if (!phrases) {
      box.appendChild(el("p", { class: "practice-note" }, "問題を読み込み中です…"));
      return;
    }
    if (setCount(state.kind) === 0) {
      box.appendChild(el("p", { class: "practice-note" }, "このカテゴリの問題はまだ登録されていません（phrases.json）。"));
      return;
    }

    // 出題形式（A/B/C または D/E/F）
    const modeRow = el("div", { class: "practice-row" });
    cat.modes.forEach(m => {
      const b = el("button", { type: "button", class: "practice-mode" + (state.letter === m.letter ? " active" : "") }, m.label);
      b.addEventListener("click", () => { state.letter = m.letter; renderBox(); });
      modeRow.appendChild(b);
    });
    box.appendChild(modeRow);

    // セット（A-1, A-2, ...）
    if (state.letter) {
      const setRow = el("div", { class: "practice-row" });
      for (let n = 1; n <= setCount(state.kind); n++) {
        const b = el("button", { type: "button", class: "practice-set" }, `${state.letter}-${n}`);
        b.addEventListener("click", () => {
          setRow.querySelectorAll("button").forEach(x => x.classList.remove("active"));
          b.classList.add("active");
          startSet(state.letter, n);
        });
        setRow.appendChild(b);
      }
      box.appendChild(setRow);
    }

    // もう一度取り組む
    const retryRow = el("div", { class: "practice-row practice-retry" });
    const input = el("input", { type: "text", id: "practice-retry-input", placeholder: "例: A-1　（複数なら A-1 B-2）", autocomplete: "off" });
    const btn = el("button", { type: "button", class: "practice-retry-button" }, "もう一度取り組む");
    btn.addEventListener("click", () => startRetry(input.value));
    input.addEventListener("keydown", e => { if (e.key === "Enter") startRetry(input.value); });
    retryRow.appendChild(input);
    retryRow.appendChild(btn);
    box.appendChild(retryRow);
  }

  // =====================================================
  //  出題
  // =====================================================
  function startSet(letter, setNo) {
    const { kind } = LETTERS[letter];
    const total = phrases[kind].length;
    const from = (setNo - 1) * SET_SIZE;
    const to = Math.min(from + SET_SIZE, total);
    const queue = [];
    for (let i = from; i < to; i++) queue.push({ letter, index: i });
    begin(queue, false, `${letter}-${setNo}`);
  }

  function startRetry(text) {
    if (!phrases) return;
    const tokens = String(text || "").toUpperCase().match(/[A-F]\s*-\s*\d+/g);
    if (!tokens) {
      systemMessage("「A-1」のように、記号とセット番号を入力してください。");
      return;
    }

    const mistakes = loadMistakes();
    const queue = [];
    const labels = [];
    tokens.forEach(t => {
      const [letter, num] = t.replace(/\s/g, "").split("-");
      const setNo = Number(num);
      const info = LETTERS[letter];
      if (!info || setNo < 1 || setNo > setCount(info.kind)) return;
      labels.push(`${letter}-${setNo}`);
      const from = (setNo - 1) * SET_SIZE;
      const to = Math.min(from + SET_SIZE, phrases[info.kind].length);
      for (let i = from; i < to; i++) {
        if (mistakes[mistakeKey(letter, i)]) queue.push({ letter, index: i });
      }
    });

    if (labels.length === 0) {
      systemMessage("該当するセットがありません。記号（A〜F）とセット番号を確認してください。");
      return;
    }
    if (queue.length === 0) {
      clearChat();
      appendMessage("reply-message practice-praise", "Great!",
        `You are really doing well. ${labels.join(", ")} に間違えた問題はありません。`);
      return;
    }
    begin(queue, true, labels.join(", "));
  }

  function begin(queue, isRetry, label) {
    clearTimeout(state.nextTimer);
    state.queue = queue;
    state.pos = 0;
    state.correct = 0;
    state.isRetry = isRetry;
    clearChat();
    appendMessage("reply-message", isRetry ? "復習" : "開始",
      `${label}（${queue.length}問）${isRetry ? "：過去に間違えた問題のみ出題します。" : ""}`);
    updateStatusBar();
    ask();
  }

  function current() {
    const q = state.queue[state.pos];
    if (!q) return null;
    const info = LETTERS[q.letter];
    return { ...q, type: info.type, kind: info.kind, item: phrases[info.kind][q.index] };
  }

  function ask() {
    const q = current();
    if (!q) return finish();
    state.answered = false;
    speakingRate = DEFAULT_RATE;   // script.js の読み上げ速度を毎問リセット

    const noteText = q.item.note ? `（${q.item.note}）` : "";
    const head = `${questionId(q.letter, q.index)}（${state.pos + 1}/${state.queue.length}）${noteText}`;
    if (q.type === "ja") {
      appendMessage("reply-message vts", head, q.item.en);
      appendMessage("reply-message", "", "日本語に訳して入力してください。");
      explainSpeakFailure(speak(q.item.en));
    } else if (q.type === "en") {
      appendMessage("reply-message vts", head, q.item.ja);
      appendMessage("reply-message", "", "英語に訳して入力してください。");
    } else {
      appendMessage("reply-message vts", head, "（音声を聞いてください）");
      appendMessage("reply-message", "", "聞こえた英文を入力してください。Say again / Slower please も使えます。");
      explainSpeakFailure(speak(q.item.en));
    }
  }

  function handleInput(message) {
    const q = current();
    if (!q) {
      systemMessage("出題形式とセット（例: A-1）を選んでください。");
      return;
    }
    if (state.answered) return;   // 次の問題へ進む間の二重送信を防ぐ

    // 英語音声がある問題では Say again / Slower please を受け付ける
    const n = normalize(message);
    if (q.type !== "en" && n === "say again") { explainSpeakFailure(speak(q.item.en)); return; }
    if (q.type !== "en" && n === "slower please") {
      speakingRate = Math.max(MIN_RATE, +(speakingRate - 0.3).toFixed(1));
      explainSpeakFailure(speak(q.item.en));
      return;
    }

    const source = consumeRecognition(message);
    const pastes = consumePasteCount();
    appendMessage("user-message", MY_ROLE, message);

    const ok = isCorrect(q.item, q.type, message);
    state.answered = true;
    record(q, message, ok, source, pastes, ok ? "Correct" : "Incorrect");

    if (ok) {
      state.correct++;
      appendMessage("reply-message", "Correct!", "");
      scheduleNext();
      return;
    }

    appendMessage("reply-message", "Incorrect.", "", { error: true });

    // 監視モード中は正答を表示しない
    if (!appSettings.monitorMode) {
      const answer = q.type === "ja" ? q.item.ja : q.item.en;
      appendMessage("reply-message model-answer", "正答", answer);

      // 和訳は表記ゆれで不正解になりやすいため、自己判定で正解にできる
      if (q.type === "ja") {
        const row = appendMessage("reply-message hint", "", "表記の違いだけで意味が合っている場合は、正解として記録できます。");
        const btn = el("button", { type: "button", class: "mini-button self-correct" }, "正解にする");
        btn.addEventListener("click", () => {
          btn.disabled = true;
          state.correct++;
          record(q, message, true, { recognized: "", method: "self-corrected" }, 0, "Self-corrected");
          appendMessage("reply-message", "正解として記録しました。", "");
        });
        row.appendChild(btn);
      }
    }
    scheduleNext();
  }

  function record(q, message, ok, source, pastes, response) {
    markResult(q.letter, q.index, ok);
    countAttempt(ok);   // script.js の正答数カウンタ
    sendToGoogleForm({
      studentId: getStudentId(),
      opponent: "Phrase",
      scenarioKey: questionId(q.letter, q.index) + (state.isRetry ? " (retry)" : ""),
      userInput: message,
      response,
      recognized: source.recognized,
      method: source.method,
      pasteCount: pastes
    });
  }

  function scheduleNext() {
    clearTimeout(state.nextTimer);
    state.nextTimer = setTimeout(() => { state.pos++; ask(); }, NEXT_QUESTION_DELAY_MS);
  }

  function finish() {
    const total = state.queue.length;
    appendMessage("reply-message practice-praise", "終了", `${total}問中 ${state.correct}問正解です。`);

    const left = state.queue.filter(q => loadMistakes()[mistakeKey(q.letter, q.index)]).length;
    if (left === 0) {
      appendMessage("reply-message practice-praise", "Great!", "You are really doing well.");
    } else {
      appendMessage("reply-message hint", "",
        `間違えた問題が ${left}問あります。「もう一度取り組む」に ${[...new Set(state.queue.map(q => `${q.letter}-${setOf(q.index)}`))].join(" ")} と入力すると復習できます。`);
    }
    state.queue = [];
    updateStatusBar();
  }

  // =====================================================
  //  script.js から呼ばれる入口
  // =====================================================
  window.Practice = {
    open(kind) {
      state.kind = kind;
      state.letter = null;
      state.queue = [];
      if (!phrases && !loadError) loadPhrases().then(renderBox);
      renderBox();
      updateStatusBar();
    },
    reset() {
      clearTimeout(state.nextTimer);
      state.kind = null;
      state.letter = null;
      state.queue = [];
    },
    handleInput,
    statusText() {
      if (!state.kind) return "";
      const cat = CATEGORIES[state.kind].title;
      const q = current();
      return q ? `${cat} / ${questionId(q.letter, q.index)}（${state.pos + 1}/${state.queue.length}）` : `${cat} / 出題形式とセットを選択してください`;
    },
    // テストや開発用
    _expandItem: expandItem
  };

  // 起動時に読み込んでおく
  loadPhrases();
})();
