// =====================================================
//  試験モード（学習モードとは独立した機能）
//
//  ・問題と模範解答は Google スプレッドシートで教員が管理します
//  ・模範解答はブラウザに渡らず、採点は GAS（サーバー側）で行います
//  ・試験中は学習支援機能（模範解答・解説・シナリオ一覧など）を使えません
//
//  script.js の関数（appendMessage, speak, getDeviceId など）を使うため、
//  index.html では script.js の後に読み込んでください。
// =====================================================
(function () {

  const EXAM_TYPE_LABEL = {
    ja: "和訳（英文を日本語に訳してください）",
    en: "英訳（日本語を英語に訳してください）",
    listening: "リスニング（聞こえた英文を入力してください）",
    short: "応答（英語で答えてください）"
  };

  const state = {
    phase: "idle",      // idle / list / intro / running / finished
    exam: null,         // { examId, name, timeLimit, ... }
    attemptId: null,
    questions: [],
    index: 0,
    answers: {},        // questionId → 解答
    maxScore: 0,
    startedAt: null,
    questionStartedAt: null,
    deadline: null,
    timer: null,
    pasteCount: 0,
    submitting: false
  };

  // =====================================================
  //  共通の小道具
  // =====================================================
  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function box() { return document.getElementById("exam-box"); }

  function gasUrl() {
    return (typeof APP_CONFIG !== "undefined" && APP_CONFIG.gasUrl) ? APP_CONFIG.gasUrl : "";
  }

  // GAS への問い合わせ（開発者ページと同じく text/plain で送ります）
  async function api(action, payload) {
    const url = gasUrl();
    if (!url) throw new Error("試験モードを使うには、config.js に GAS の URL を設定してください。");

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ action }, payload || {}))
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "通信に失敗しました。");
    return data;
  }

  function isRunning() { return state.phase === "running"; }

  function fmtTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(total / 60)}:${("0" + (total % 60)).slice(-2)}`;
  }

  // =====================================================
  //  試験中の固定表示（残り時間・進捗）
  // =====================================================
  function showBanner() {
    const banner = document.getElementById("exam-banner");
    if (!banner) return;
    banner.style.display = "block";
    updateBanner();
  }

  function hideBanner() {
    const banner = document.getElementById("exam-banner");
    if (banner) banner.style.display = "none";
  }

  function updateBanner() {
    const banner = document.getElementById("exam-banner");
    if (!banner || !state.exam) return;

    const remain = state.deadline ? state.deadline - Date.now() : null;
    banner.textContent = "";
    banner.appendChild(el("span", "exam-banner-title", "📋 現在試験モード中"));
    banner.appendChild(el("span", "exam-banner-item", `試験名: ${state.exam.name}`));
    banner.appendChild(el("span", "exam-banner-item",
      remain === null ? "残り時間: 制限なし" : `残り時間: ${fmtTime(remain)}`));
    banner.appendChild(el("span", "exam-banner-item",
      `問題: ${Math.min(state.index + 1, state.questions.length)} / ${state.questions.length}`));

    // 残り1分を切ったら色を変える
    banner.classList.toggle("urgent", remain !== null && remain <= 60 * 1000);

    // 画面中ほどの状態表示も試験の状況にそろえる
    if (typeof updateStatusBar === "function") updateStatusBar();
  }

  function startTimer() {
    stopTimer();
    state.timer = setInterval(() => {
      updateBanner();
      if (state.deadline && Date.now() >= state.deadline) {
        stopTimer();
        finishExam("Completed", "時間切れのため自動提出しました。");
      }
    }, 1000);
  }

  function stopTimer() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  // =====================================================
  //  学習モード側の制限
  // =====================================================
  function lockLearningUI(locked) {
    document.body.classList.toggle("exam-running", locked);

    // 学習モードのボタン（船舶・VTS・ランダム・リスニング・フレーズ練習）
    document.querySelectorAll(".role-button").forEach(b => {
      if (b.id === "exam-button") return;
      b.disabled = locked;
    });

    // 他ページ（使い方・解説・シナリオ一覧）へのリンク
    document.querySelectorAll(".site-nav a.nav-item").forEach(a => {
      a.classList.toggle("nav-locked", locked);
    });

    // 学習モードのサブUIを隠す
    if (locked) {
      ["ship-scenario-select", "vts-scenario-select", "listening-level-box", "practice-box", "scenario-image"]
        .forEach(id => { const e = document.getElementById(id); if (e) e.style.display = "none"; });
    }
  }

  // =====================================================
  //  画面
  // =====================================================
  function showMessage(text, className) {
    box().textContent = "";
    box().style.display = "block";
    box().appendChild(el("p", className || "exam-note", text));
  }

  // ① 試験一覧
  async function openExamList() {
    state.phase = "list";
    showMessage("試験の一覧を読み込んでいます…");

    let exams;
    try {
      exams = (await api("getExamList")).exams;
    } catch (e) {
      showMessage(e.message, "exam-error");
      return;
    }

    const host = box();
    host.textContent = "";
    host.appendChild(el("h3", null, "試験一覧"));

    if (!exams.length) {
      host.appendChild(el("p", "exam-note", "受験できる試験がありません。教員が試験を公開するまでお待ちください。"));
      return;
    }

    exams.forEach(exam => {
      const card = el("div", "exam-card");
      card.appendChild(el("div", "exam-card-name", exam.name));
      if (exam.description) card.appendChild(el("div", "exam-card-desc", exam.description));
      card.appendChild(el("div", "exam-card-meta",
        `問題数: ${exam.questionCount}問　/　制限時間: ${exam.timeLimit > 0 ? exam.timeLimit + "分" : "なし"}`));

      const btn = el("button", "send-button", exam.available ? "この試験を受ける" : "準備中");
      btn.type = "button";
      btn.disabled = !exam.available;
      btn.addEventListener("click", () => showIntro(exam));
      card.appendChild(btn);
      host.appendChild(card);
    });
  }

  // ② 試験開始前の説明
  function showIntro(exam) {
    state.phase = "intro";
    const host = box();
    host.textContent = "";

    host.appendChild(el("h3", null, "試験モードです"));
    host.appendChild(el("div", "exam-card-name", exam.name));

    const ul = document.createElement("ul");
    [
      "結果は記録されます（学籍番号・端末・解答内容・所要時間）。",
      "試験終了まで中断できません。中断した場合は Aborted として記録されます。",
      "時間切れになると自動提出されます。",
      "試験中は、模範解答・解説ページ・シナリオ一覧・学習モードを利用できません。",
      "1問ずつ解答します。前の問題には戻れません。",
      `問題数: ${exam.questionCount}問　/　制限時間: ${exam.timeLimit > 0 ? exam.timeLimit + "分" : "なし"}`
    ].forEach(t => ul.appendChild(el("li", null, t)));
    host.appendChild(ul);

    const row = el("div", "exam-actions");
    const start = el("button", "send-button", "試験を開始する");
    start.type = "button";
    start.addEventListener("click", () => beginExam(exam, start));
    const back = el("button", "mini-button", "一覧に戻る");
    back.type = "button";
    back.addEventListener("click", openExamList);
    row.appendChild(start);
    row.appendChild(back);
    host.appendChild(row);
  }

  // ③ 試験開始
  async function beginExam(exam, button) {
    const studentId = getStudentId();
    if (!studentId) {
      systemMessage("試験を受けるには、学籍番号を入力してください。");
      document.getElementById("student-id")?.focus();
      return;
    }

    if (button) { button.disabled = true; button.textContent = "準備中…"; }

    let data;
    try {
      data = await api("getExamQuestions", { examId: exam.examId, studentId });
    } catch (e) {
      showMessage(e.message, "exam-error");
      return;
    }

    state.phase = "running";
    state.exam = data.exam;
    state.attemptId = data.attemptId;
    state.questions = data.questions;
    state.maxScore = data.maxScore;
    state.index = 0;
    state.answers = {};
    state.pasteCount = 0;
    state.startedAt = new Date();
    state.deadline = data.exam.timeLimit > 0 ? Date.now() + data.exam.timeLimit * 60 * 1000 : null;

    clearChat();
    lockLearningUI(true);
    showBanner();
    startTimer();
    window.addEventListener("beforeunload", warnBeforeUnload);

    appendMessage("reply-message", "試験開始", `${state.exam.name}（全${state.questions.length}問）`);
    askQuestion();
  }

  // ④ 出題
  function askQuestion() {
    const q = state.questions[state.index];
    if (!q) { finishExam("Completed"); return; }

    state.questionStartedAt = Date.now();
    speakingRate = DEFAULT_RATE;   // script.js の読み上げ速度を毎問リセット
    updateBanner();
    renderQuestionPanel(q);

    const head = `第${q.no}問 / ${state.questions.length}（${q.points}点・${q.category}）`;
    appendMessage("reply-message vts", head, EXAM_TYPE_LABEL[q.type] || "");
    if (q.prompt) appendMessage("reply-message", "", q.prompt);
    if (q.speakText) {
      const result = speak(q.speakText);
      if (result !== "ok") explainSpeakFailure(result);
    }
  }

  // 問題パネル（試験中の操作ボタン）
  function renderQuestionPanel(q) {
    const host = box();
    host.textContent = "";
    host.appendChild(el("div", "exam-card-name", `${state.exam.name}　第${q.no}問`));
    host.appendChild(el("div", "exam-card-meta", EXAM_TYPE_LABEL[q.type] || ""));

    const row = el("div", "exam-actions");

    if (q.speakText) {
      const again = el("button", "mini-button", "🔊 もう一度聞く");
      again.type = "button";
      again.addEventListener("click", () => explainSpeakFailure(speak(q.speakText)));
      row.appendChild(again);

      const slower = el("button", "mini-button", "🐢 ゆっくり");
      slower.type = "button";
      slower.addEventListener("click", () => {
        speakingRate = Math.max(MIN_RATE, +(speakingRate - 0.3).toFixed(1));
        explainSpeakFailure(speak(q.speakText));
      });
      row.appendChild(slower);
    }

    const skip = el("button", "mini-button", "この問題を飛ばす");
    skip.type = "button";
    skip.addEventListener("click", () => submitAnswer("", true));
    row.appendChild(skip);

    const quit = el("button", "exam-quit", "試験を中断する");
    quit.type = "button";
    quit.addEventListener("click", confirmAbort);
    row.appendChild(quit);

    host.appendChild(row);
    host.appendChild(el("p", "exam-note", "解答は下の入力欄に入力し、Send を押してください。前の問題には戻れません。"));
  }

  // ⑤ 解答
  async function submitAnswer(answer, skipped) {
    if (!isRunning() || state.submitting) return;
    const q = state.questions[state.index];
    if (!q) return;

    state.submitting = true;
    const answerTime = Math.round((Date.now() - state.questionStartedAt) / 1000);
    state.answers[q.questionId] = answer;
    state.pasteCount += consumePasteCount();   // script.js が数えた貼り付け回数

    if (!skipped) appendMessage("user-message", MY_ROLE, answer);
    else appendMessage("reply-message", "", "（この問題を飛ばしました）");

    try {
      await api("saveExamAnswer", {
        examId: state.exam.examId, attemptId: state.attemptId, studentId: getStudentId(),
        questionId: q.questionId, answer, answerTime
      });
    } catch (e) {
      // 通信が一時的に失敗しても試験は続けます（未解答として扱われます）
      console.warn("解答の送信に失敗しました:", e);
      appendMessage("reply-message system", "注意", "解答の送信に失敗しました。通信環境を確認してください。", { error: true });
    }

    state.submitting = false;
    state.index++;

    if (state.index >= state.questions.length) {
      finishExam("Completed");
    } else {
      askQuestion();
    }
  }

  // 学習支援機能の呼び出し（試験中は使えません）
  const LEARNING_COMMANDS = ["what's the answer", "whats the answer", "what is the answer"];

  // script.js の送信ボタンから呼ばれます
  function handleInput(message) {
    if (!isRunning()) return;

    // 模範解答の要求は、解答として記録せずに案内だけ出します
    const n = (typeof normalize === "function") ? normalize(message) : String(message).toLowerCase().trim();
    if (LEARNING_COMMANDS.indexOf(n) >= 0) {
      blockLearningFeature();
      return;
    }

    submitAnswer(message, false);
  }

  // ⑥ 終了・採点
  async function finishExam(status, reason) {
    if (!state.exam || state.phase === "finished") return;
    state.phase = "finished";

    stopTimer();
    window.removeEventListener("beforeunload", warnBeforeUnload);
    hideBanner();
    lockLearningUI(false);

    if (reason) appendMessage("reply-message system", "", reason);
    showMessage("採点しています…");

    let result;
    try {
      result = await api("saveExamResult", {
        examId: state.exam.examId, attemptId: state.attemptId,
        studentId: getStudentId(), deviceId: getDeviceId(),
        startTime: state.startedAt ? state.startedAt.toISOString() : null,
        endTime: new Date().toISOString(),
        pasteCount: state.pasteCount, status
      });
    } catch (e) {
      showMessage("採点結果を取得できませんでした: " + e.message, "exam-error");
      return;
    }

    showResult(result);
  }

  // ⑦ 結果表示
  function showResult(result) {
    const host = box();
    host.textContent = "";

    host.appendChild(el("h3", null, result.status === "Aborted" ? "試験を中断しました" : "試験が終了しました"));
    host.appendChild(el("div", "exam-card-name", result.examName));

    const cards = el("div", "stat-cards");
    [
      ["点数", `${result.score} / ${result.maxScore}`],
      ["正答数", result.correctCount],
      ["誤答数", result.wrongCount],
      ["正答率", result.rate + "%"],
      ["所要時間", result.completionTime]
    ].forEach(([label, value]) => {
      const card = el("div", "stat-card");
      card.appendChild(el("div", "stat-value", String(value)));
      card.appendChild(el("div", "stat-label", label));
      cards.appendChild(card);
    });
    host.appendChild(cards);

    if (result.byCategory && result.byCategory.length) {
      host.appendChild(el("h4", null, "分野別正答率"));
      const table = el("table", "doc-table");
      const head = document.createElement("tr");
      ["分野", "正答", "正答率"].forEach(t => head.appendChild(el("th", null, t)));
      table.appendChild(head);
      result.byCategory.forEach(c => {
        const tr = document.createElement("tr");
        tr.appendChild(el("td", null, c.category));
        tr.appendChild(el("td", null, `${c.correct} / ${c.total}`));
        tr.appendChild(el("td", null, Math.round((c.correct / c.total) * 100) + "%"));
        table.appendChild(tr);
      });
      host.appendChild(table);
    }

    // 模範解答は、教員が「Show Answers」を有効にした試験でのみ表示されます
    if (result.showAnswers && result.review && result.review.length) {
      host.appendChild(el("h4", null, "問題ごとの結果"));
      const table = el("table", "doc-table");
      const head = document.createElement("tr");
      ["問題", "あなたの解答", "模範解答", "正誤"].forEach(t => head.appendChild(el("th", null, t)));
      table.appendChild(head);
      result.review.forEach(r => {
        const tr = document.createElement("tr");
        tr.appendChild(el("td", null, r.prompt));
        tr.appendChild(el("td", null, r.yourAnswer || "（未解答）"));
        tr.appendChild(el("td", "en", r.correctAnswer));
        tr.appendChild(el("td", r.correct ? "exam-correct" : "exam-wrong", r.correct ? "○" : "×"));
        table.appendChild(tr);
      });
      host.appendChild(table);
    }

    const row = el("div", "exam-actions");
    const again = el("button", "mini-button", "試験一覧に戻る");
    again.type = "button";
    again.addEventListener("click", openExamList);
    const back = el("button", "mini-button", "学習モードに戻る");
    back.type = "button";
    back.addEventListener("click", close);
    row.appendChild(again);
    row.appendChild(back);
    host.appendChild(row);

    state.exam = null;
    state.attemptId = null;
  }

  // =====================================================
  //  離脱の防止
  // =====================================================
  function warnBeforeUnload(event) {
    // ブラウザの確認ダイアログを出します（文面はブラウザが決めます）
    event.preventDefault();
    event.returnValue = "試験中です。ページを離れると試験が終了する可能性があります。";
    return event.returnValue;
  }

  function confirmAbort() {
    if (!isRunning()) return false;
    const yes = window.confirm("試験を終了しますか？\n\n終了すると、この試験は中断（Aborted）として記録されます。");
    if (yes) finishExam("Aborted", "試験を中断しました。");
    return yes;
  }

  // 他ページへのリンクを押したときの確認
  function guardNavigation(event) {
    if (!isRunning()) return;
    const link = event.target.closest ? event.target.closest("a[href]") : null;
    if (!link) return;
    const href = link.getAttribute("href") || "";
    if (href.startsWith("#")) return;

    event.preventDefault();
    if (confirmAbort()) {
      setTimeout(() => { window.location.href = href; }, 600);   // 記録を送ってから移動
    }
  }

  // 学習支援機能が押されたときの案内
  function blockLearningFeature() {
    systemMessage("試験モード中は利用できません。");
  }

  // =====================================================
  //  入口
  // =====================================================
  function open() {
    if (isRunning()) { blockLearningFeature(); return; }
    openExamList();
  }

  function close() {
    if (isRunning()) { blockLearningFeature(); return; }
    state.phase = "idle";
    hideBanner();
    lockLearningUI(false);
    const host = box();
    if (host) { host.textContent = ""; host.style.display = "none"; }
    clearChat();
  }

  function init() {
    const button = document.getElementById("exam-button");
    if (button) button.addEventListener("click", () => {
      document.querySelectorAll(".role-button").forEach(b => b.classList.remove("active"));
      button.classList.add("active");
      if (typeof mode !== "undefined") mode = "exam";
      open();
    });

    document.addEventListener("click", guardNavigation, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // script.js から使う入口
  window.Exam = {
    isRunning,
    handleInput,
    blockLearningFeature,
    open,
    close,
    statusText() {
      if (!isRunning() || !state.exam) return "";
      const remain = state.deadline ? fmtTime(state.deadline - Date.now()) : "制限なし";
      return `試験モード / ${state.exam.name} / 残り ${remain} / ${state.index + 1}問目`;
    },
    _state: state   // テスト・開発用
  };
})();
