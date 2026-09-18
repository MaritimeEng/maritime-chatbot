// =====================================================
//  海事英語教育支援システム（Maritime English Training System）
//  - 船舶間通信 / VTS通信 / ランダム / リスニング訓練
//  - 模範解答表示・音声読み上げ・音声入力（発音訓練）
//  - 学習データの Google Forms 送信
// =====================================================

// =====================================================
//  設定（ここだけ書き換えれば運用を変更できます）
// =====================================================
const CONFIG = {
  // Googleフォームの送信先URL（フォームURLの末尾を /formResponse にしたもの）
  formUrl: "https://docs.google.com/forms/d/e/1FAIpQLSd-VVaYg6OGow30tJb_w9Uzit4v_DDF7_FLIbIASbT_52d2nA/formResponse",

  // 各質問の entry 番号。「事前入力したURLを取得」で確認できます。
  entries: {
    studentId: "entry.504566204",   // 学籍番号
    opponent:  "entry.715153589",   // 相手役（Umitakamaru / Tokyo Martis / Listening）
    userInput: "entry.633984331",   // ユーザー入力
    response:  "entry.502434052",   // システム応答
    // ★フォームに「シナリオ名」の質問を追加したら、その entry 番号をここに入れてください。
    //   空のままでも、シナリオ名は「相手役」の欄に "Umitakamaru / crossing" の形で記録されます。
    scenario:    "",   // 例: "entry.123456789"

    // ★音声入力の分析用。質問を追加したら entry 番号を入れてください。
    //   recognized  : 音声認識がそのまま返した文（修正前）
    //   inputMethod : typing（手入力） / voice（認識結果をそのまま送信） / voice-edited（修正して送信）
    recognized:  "",   // 例: "entry.234567890"
    inputMethod: ""    // 例: "entry.345678901"
  },

  logListening: true,          // リスニング訓練も記録するか
  replyDelayMs: 3000,          // 相手が応答するまでの待ち時間（ミリ秒）
  showHints: true,             // 不正解時に、惜しい入力との違いを表示するか
  hintThreshold: 0.6,          // ヒントを出す類似度のしきい値（0〜1）
  showRecognitionDiff: true    // 認識結果を修正して送信したとき、元の認識結果を表示するか
};

const MY_ROLE = "Shiojimaru";
const MY_CALL_SIGN = "7KJH";
const DEFAULT_RATE = 1.3;
const MIN_RATE = 0.5;
const INPUT_MAX_HEIGHT = 200;   // style.css の #message-input max-height と合わせる

const OPPONENT_LABEL = { "Umitakamaru": "船舶", "Tokyo Martis": "VTS" };
const SHIP_SCENARIO_LABEL = { meeting: "行き会い", crossing: "横切り", overtaking: "追い越し", other: "その他" };

// =====================================================
//  状態
// =====================================================
let scenario = {};
let scenarioLoaded = false;
let scenarioLoadFailed = false;

let mode = null;                  // "ship" | "vts" | "random" | "listening"
let currentOpponent = null;       // "Umitakamaru" | "Tokyo Martis"
let shipScenario = null;
let vtsScenario = null;
let hideScenarioName = false;     // ランダム訓練ではシナリオ名を伏せる
let lastOpponentMessage = null;

let isListeningTest = false;
let currentListeningSentence = "";
let listeningLevel = 1;

// 音声入力の状態（送信時に「認識結果」と「実際に送信した文」を分けて記録するために保持）
let recognizedText = null;    // 直近の音声認識の結果（未修正の生データ）
let recognitionLang = null;   // そのときの認識言語

let speakingRate = DEFAULT_RATE;
let currentVoiceName = null;
let currentVoiceLang = null;

const stats = { attempts: 0, correct: 0 };

// =====================================================
//  文字列ユーティリティ
// =====================================================

// 大文字小文字・余分な空白・句読点の違いを吸収する（数字中の "." ":" は残す）
function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[,!?;]/g, "")
    .replace(/[.:](?!\d)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text) {
  const n = normalize(text);
  return n ? n.split(" ") : [];
}

// 語の重なりから類似度（0〜1）を求める
function similarity(a, b) {
  const wa = words(a), wb = words(b);
  if (wa.length === 0 || wb.length === 0) return 0;
  const pool = [...wb];
  let common = 0;
  for (const w of wa) {
    const i = pool.indexOf(w);
    if (i >= 0) { common++; pool.splice(i, 1); }
  }
  return (2 * common) / (wa.length + wb.length);
}

// 正解と入力の語の差分（不足語・余分語）
function wordDiff(correct, input) {
  const missing = [...words(correct)];
  const extra = [];
  for (const w of words(input)) {
    const i = missing.indexOf(w);
    if (i >= 0) missing.splice(i, 1); else extra.push(w);
  }
  return { missing, extra };
}

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// =====================================================
//  画面表示
// =====================================================

// innerHTML ではなく textContent を使う（入力に "<" 等が含まれても壊れない）
function appendMessage(className, label, text, { error = false } = {}) {
  const chatBox = document.getElementById("chat-box");
  const div = document.createElement("div");
  div.className = className;
  if (error) div.classList.add("error");

  if (label) {
    const strong = document.createElement("strong");
    strong.textContent = text ? label + ": " : label;
    div.appendChild(strong);
  }
  if (text) div.appendChild(document.createTextNode(text));

  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  return div;
}

function systemMessage(text, { error = true } = {}) {
  return appendMessage("reply-message system", "System", text, { error });
}

function hintMessage(text) {
  return appendMessage("reply-message hint", "Hint", text, { error: false });
}

function clearChat() { document.getElementById("chat-box").innerHTML = ""; }

function scenarioDisplayName() {
  if (mode === "listening") return `Level ${listeningLevel}`;
  if (currentOpponent === "Umitakamaru" && shipScenario) {
    return SHIP_SCENARIO_LABEL[shipScenario] || shipScenario;
  }
  if (currentOpponent === "Tokyo Martis" && vtsScenario) return vtsScenario;
  return null;
}

function updateStatusBar() {
  const el = document.getElementById("status-bar");
  if (!el) return;

  let text;
  if (mode === null) {
    text = "訓練モードを選択してください";
  } else if (mode === "listening") {
    text = currentListeningSentence ? `リスニング訓練 / Level ${listeningLevel}` : "リスニング訓練 / レベルを選択してください";
  } else if (!currentOpponent) {
    text = "訓練モードを選択してください";
  } else {
    const name = scenarioDisplayName();
    const scenarioPart = hideScenarioName ? "シナリオ非公開" : (name ? `シナリオ: ${name}` : "シナリオ未選択");
    text = `相手役: ${currentOpponent}（${OPPONENT_LABEL[currentOpponent]}） / ${scenarioPart}`;
  }

  const rate = stats.attempts ? Math.round((stats.correct / stats.attempts) * 100) : 0;
  el.textContent = `${text}　|　今回の練習: ${stats.correct} / ${stats.attempts} 正答（${rate}%）`;
}

function countAttempt(isCorrect) {
  stats.attempts++;
  if (isCorrect) stats.correct++;
  updateStatusBar();
}

function resizeInput(input) {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, INPUT_MAX_HEIGHT) + "px";
  input.style.overflowY = input.scrollHeight > INPUT_MAX_HEIGHT ? "auto" : "hidden";
}

function clearInput(input) { input.value = ""; resizeInput(input); }

function getStudentId() {
  const field = document.getElementById("student-id");
  return field ? field.value.trim() : "";
}

// =====================================================
//  音声読み上げ（Web Speech API / SpeechSynthesis）
// =====================================================
const speechSupported = "speechSynthesis" in window;
let currentUtterance = null; // Chrome で読み上げが途中で消える問題への対策として参照を保持

function setVoice(voiceName, lang = null) {
  currentVoiceName = voiceName || null;
  currentVoiceLang = lang || null;
  console.log("Voice set to:", currentVoiceName, currentVoiceLang);
}

function findVoice() {
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const norm = l => (l || "").replace("_", "-").toLowerCase();

  const byName = voices.find(v => v.name === currentVoiceName);
  if (byName) return byName;

  if (currentVoiceLang) {
    const byLang = voices.find(v => norm(v.lang) === norm(currentVoiceLang));
    if (byLang) return byLang;
  }
  return voices.find(v => norm(v.lang).startsWith("en")) || null;
}

// 戻り値: "ok" | "unsupported" | "no-voice-selected" | "voice-unavailable"
function speak(text) {
  if (!speechSupported) return "unsupported";
  if (!currentVoiceName && !currentVoiceLang) return "no-voice-selected";

  const voice = findVoice();
  if (!voice) return "voice-unavailable";

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;   // 日本語読みになるのを防ぐ
  utterance.rate = speakingRate;
  utterance.pitch = 1.0;
  currentUtterance = utterance;

  // Chrome では cancel 直後の speak が無視されることがあるため少し待つ
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    setTimeout(() => speechSynthesis.speak(utterance), 100);
  } else {
    speechSynthesis.speak(utterance);
  }
  return "ok";
}

function explainSpeakFailure(result) {
  const messages = {
    "unsupported": "このブラウザは音声読み上げに対応していません。Edge または Chrome をお使いください。",
    "no-voice-selected": "音声が選択されていません。先にアクセントのボタンを選んでください。",
    "voice-unavailable": "英語の音声が見つかりません。少し待ってから再度お試しいただくか、Edge をお使いください。"
  };
  if (messages[result]) systemMessage(messages[result]);
}

// =====================================================
//  音声入力（Web Speech API / SpeechRecognition）
//  Chrome・Edge のみ対応。HTTPS（GitHub Pages など）が必要です。
// =====================================================
const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let recognition = null;
let isRecording = false;

function setupRecognition() {
  const micButton = document.getElementById("mic-button");
  if (!micButton) return;

  if (!SpeechRecognitionClass) {
    micButton.disabled = true;
    micButton.title = "このブラウザは音声入力に対応していません（Chrome / Edge をお使いください）";
    micButton.textContent = "🎤 非対応";
    return;
  }

  recognition = new SpeechRecognitionClass();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = event => {
    const input = document.getElementById("message-input");
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    input.value = transcript.trim();
    resizeInput(input);

    // 最終結果のみ「認識結果」として保持する（途中経過は上書きされる）
    recognizedText = input.value;
    recognitionLang = recognition.lang;
  };

  recognition.onerror = event => {
    const messages = {
      "not-allowed": "マイクの使用が許可されていません。ブラウザのアドレスバーからマイクを許可してください。",
      "service-not-allowed": "マイクの使用が許可されていません。ブラウザの設定をご確認ください。",
      "no-speech": "音声を認識できませんでした。もう一度お試しください。",
      "audio-capture": "マイクが見つかりません。接続をご確認ください。",
      "network": "音声認識サーバーに接続できませんでした。通信環境をご確認ください。"
    };
    systemMessage(messages[event.error] || `音声認識でエラーが発生しました（${event.error}）。`);
  };

  recognition.onend = () => {
    isRecording = false;
    micButton.classList.remove("recording");
    micButton.textContent = "🎤 音声入力";
  };

  micButton.addEventListener("click", () => {
    if (isRecording) { recognition.stop(); return; }

    // 選択中のアクセントに合わせて認識言語を設定
    recognition.lang = currentVoiceLang || "en-US";
    try {
      recognition.start();
      isRecording = true;
      micButton.classList.add("recording");
      micButton.textContent = "■ 停止";
    } catch (e) {
      console.warn("音声認識を開始できませんでした:", e);
    }
  });
}

// =====================================================
//  シナリオ
// =====================================================

function getScenarioStatus() {
  if (scenarioLoadFailed) return { state: "load-failed" };
  if (!scenarioLoaded) return { state: "loading" };

  let key = null, list = null;
  if (currentOpponent === "Umitakamaru") {
    key = shipScenario;
    list = key ? scenario.ship?.[key] : null;
  } else if (currentOpponent === "Tokyo Martis") {
    key = vtsScenario;
    list = key ? scenario.vts?.[key] : null;
  }

  if (!key) return { state: "unselected" };
  if (!Array.isArray(list) || list.length === 0) return { state: "empty", key };
  return { state: "ready", key, list };
}

function loadingMessage() {
  return scenarioLoadFailed
    ? "scenario.json を読み込めませんでした。ファイルを直接開かず、ローカルサーバー（VS Code の Live Server など）または GitHub Pages 経由で開いてください。"
    : "シナリオを読み込み中です。少し待ってから再度お試しください。";
}

// 送信時に、その文が音声入力由来かどうかを判定して取り出す
// 戻り値: { recognized: 認識結果（手入力なら空）, method: "typing" | "voice" | "voice-edited" }
function consumeRecognition(sentText) {
  if (!recognizedText) return { recognized: "", method: "typing", lang: "" };

  const edited = normalize(recognizedText) !== normalize(sentText);
  const info = {
    recognized: recognizedText,
    method: edited ? "voice-edited" : "voice",
    lang: recognitionLang || ""
  };
  recognizedText = null;
  recognitionLang = null;
  return info;
}

function findResponse(list, userMessage) {
  const target = normalize(userMessage);
  for (const item of list) {
    if (Array.isArray(item.inputs) && item.inputs.some(i => normalize(i) === target)) {
      return item.response;
    }
  }
  return null;
}

// 入力に最も近い想定文（ヒント用）
function findClosestInput(list, userMessage) {
  let best = { text: null, score: 0 };
  for (const item of list) {
    for (const candidate of item.inputs || []) {
      const score = similarity(candidate, userMessage);
      if (score > best.score) best = { text: candidate, score };
    }
  }
  return best;
}

function showHint(list, userMessage) {
  if (!CONFIG.showHints) return;
  const best = findClosestInput(list, userMessage);
  if (!best.text || best.score < CONFIG.hintThreshold) return;

  const { missing, extra } = wordDiff(best.text, userMessage);
  const parts = [];
  if (missing.length) parts.push(`不足している語: ${missing.slice(0, 6).join(", ")}`);
  if (extra.length) parts.push(`余分な語: ${extra.slice(0, 6).join(", ")}`);
  if (parts.length) {
    hintMessage(`${Math.round(best.score * 100)}% 一致しています。${parts.join(" / ")}`);
  }
}

function findModelAnswer(list) {
  if (lastOpponentMessage === null) return list[0].inputs?.[0] ?? null;
  for (let i = 0; i < list.length - 1; i++) {
    if (list[i].response === lastOpponentMessage) {
      return list[i + 1].inputs?.[0] ?? null;
    }
  }
  return null;
}

function getValidScenarioKeys(group) {
  if (!group || typeof group !== "object") return [];
  return Object.keys(group).filter(k => Array.isArray(group[k]) && group[k].length > 0);
}

// ランダム訓練：中身のあるシナリオの中から相手役とシナリオを選ぶ
function pickRandomScenario() {
  const shipKeys = getValidScenarioKeys(scenario.ship);
  const vtsKeys = getValidScenarioKeys(scenario.vts);

  const candidates = [];
  if (shipKeys.length > 0) candidates.push("Umitakamaru");
  if (vtsKeys.length > 0) candidates.push("Tokyo Martis");
  if (candidates.length === 0) return false;

  currentOpponent = pickRandom(candidates);
  if (currentOpponent === "Umitakamaru") {
    shipScenario = pickRandom(shipKeys);
  } else {
    vtsScenario = pickRandom(vtsKeys);
    // ランダム訓練では状況を伏せるため、VTS画像は表示しない
  }
  return true;
}

// =====================================================
//  リセット
// =====================================================

function resetTrainingState() {
  mode = null;
  currentOpponent = null;
  shipScenario = null;
  vtsScenario = null;
  hideScenarioName = false;
  lastOpponentMessage = null;
  isListeningTest = false;
  currentListeningSentence = "";
  speakingRate = DEFAULT_RATE;
  if (speechSupported) speechSynthesis.cancel();
}

function resetSubUIs() {
  ["ship-scenario-select", "vts-scenario-select", "listening-level-box"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  document.querySelectorAll(".level-button, .ship-scenario, .vts-scenario")
    .forEach(b => b.classList.remove("active"));
  hideVtsImage();
}

function showVtsImage(key) {
  const img = document.getElementById("scenario-image");
  if (img && key) {
    img.style.display = "none";  // 読み込みに成功したら load イベントで表示
    img.src = `images/${key}.png`;
  }
}

function hideVtsImage() {
  const img = document.getElementById("scenario-image");
  if (img) {
    img.style.display = "none";
    img.removeAttribute("src");
  }
}

// =====================================================
//  リスニング訓練
// =====================================================

function startListening(level) {
  if (!scenarioLoaded) { systemMessage(loadingMessage()); return; }

  const list = scenario.listening?.["level" + level];
  if (!Array.isArray(list) || list.length === 0) {
    systemMessage(`Level ${level} の問題はまだ準備中です。`);
    return;
  }

  clearChat();
  listeningLevel = level;
  currentListeningSentence = pickRandom(list).sentence;
  isListeningTest = true;
  speakingRate = DEFAULT_RATE;
  updateStatusBar();

  const result = speak(currentListeningSentence);
  if (result === "ok") {
    appendMessage("reply-message", `Level ${level}`, "聞こえた文章を入力してください。");
  } else {
    explainSpeakFailure(result);
  }
}

function handleListeningInput(message) {
  const n = normalize(message);

  if (n === "slower please") {
    speakingRate = Math.max(MIN_RATE, +(speakingRate - 0.3).toFixed(1));
    explainSpeakFailure(speak(currentListeningSentence));
    return;
  }
  if (n === "say again") {
    explainSpeakFailure(speak(currentListeningSentence));
    return;
  }

  const source = consumeRecognition(message);
  appendMessage("user-message", MY_ROLE, message);
  if (source.method === "voice-edited" && CONFIG.showRecognitionDiff) {
    hintMessage(`音声認識の結果（修正前）: ${source.recognized}`);
  }
  const isCorrect = n === normalize(currentListeningSentence);

  if (isCorrect) {
    appendMessage("reply-message", "Correct!", "次の問題はレベルボタンを押してください。");
    isListeningTest = false;
  } else {
    appendMessage("reply-message", "Try again.", "");
    if (CONFIG.showHints) {
      const { missing, extra } = wordDiff(currentListeningSentence, message);
      hintMessage(`違いのある語: ${missing.length + extra.length} 語（正しい語数: ${words(currentListeningSentence).length}）`);
    }
  }

  countAttempt(isCorrect);
  if (CONFIG.logListening) {
    sendToGoogleForm({
      studentId: getStudentId(),
      opponent: "Listening",
      scenarioKey: `level${listeningLevel}`,
      userInput: message,
      response: isCorrect ? "Correct!" : "Try again.",
      recognized: source.recognized,
      method: source.method
    });
  }
}

// =====================================================
//  送信処理
// =====================================================

function handleSend() {
  const input = document.getElementById("message-input");
  const message = input.value.trim();
  if (message === "") return;

  // リスニングは currentOpponent が null のため、相手役の判定より前に処理する
  if (isListeningTest) {
    handleListeningInput(message);
    clearInput(input);
    return;
  }

  if (mode === "listening") {
    systemMessage("レベルボタン（Level 1〜3）を押して問題を再生してください。");
    return;
  }
  if (!currentOpponent) {
    systemMessage("訓練モード（船舶 / VTS / ランダム）を選択してください。");
    return;
  }

  const status = getScenarioStatus();
  switch (status.state) {
    case "loading":
    case "load-failed":
      systemMessage(loadingMessage()); return;
    case "unselected":
      systemMessage("シナリオを選択してください。"); return;
    case "empty":
      systemMessage("このシナリオは現在準備中です。別のシナリオを選択してください。"); return;
  }
  const list = status.list;

  // 模範解答
  const n = normalize(message);
  if (n === "what's the answer" || n === "whats the answer") {
    const answer = findModelAnswer(list);
    appendMessage("reply-message model-answer", "Model Answer", answer || "No model answer found.");
    clearInput(input);
    return;
  }

  const opponent = currentOpponent;     // 送信時点の状態を保持
  const scenarioKey = status.key;
  const studentId = getStudentId();
  const source = consumeRecognition(message);   // 音声入力かどうかを判定

  appendMessage("user-message", MY_ROLE, message);
  if (source.method === "voice-edited" && CONFIG.showRecognitionDiff) {
    hintMessage(`音声認識の結果（修正前）: ${source.recognized}`);
  }
  const responseText = findResponse(list, message);
  countAttempt(Boolean(responseText));
  clearInput(input);

  setTimeout(() => {
    sendToGoogleForm({
      studentId, opponent, scenarioKey,
      userInput: message,
      response: responseText || "Say again.",
      recognized: source.recognized,
      method: source.method
    });

    // 待機中にモードやシナリオが切り替えられていたら表示しない
    const currentKey = opponent === "Umitakamaru" ? shipScenario : vtsScenario;
    if (opponent !== currentOpponent || scenarioKey !== currentKey) return;

    const cls = "reply-message " + (opponent === "Umitakamaru" ? "umitaka" : "vts");
    if (responseText) {
      appendMessage(cls, opponent, responseText);
      lastOpponentMessage = responseText;
      speak(responseText);
    } else {
      appendMessage(cls, opponent, "Say again.", { error: true });
      speak("Say again.");
      showHint(list, message);
    }
  }, CONFIG.replyDelayMs);
}

// =====================================================
//  学習データの送信（Google Forms）
// =====================================================

function sendToGoogleForm({ studentId, opponent, scenarioKey, userInput, response, recognized = "", method = "typing" }) {
  // 学籍番号が未入力のときは記録しない（画面の説明文どおりの動作）
  if (!studentId) return;

  const e = CONFIG.entries;
  const formData = new FormData();
  formData.append(e.studentId, studentId);

  if (e.scenario && e.scenario.startsWith("entry.")) {
    formData.append(e.opponent, opponent);
    formData.append(e.scenario, scenarioKey || "");
  } else {
    // シナリオ用の質問が未追加の場合は、相手役の欄にまとめて記録する
    formData.append(e.opponent, scenarioKey ? `${opponent} / ${scenarioKey}` : opponent);
  }

  formData.append(e.userInput, userInput);   // 実際に送信された文（修正後）
  formData.append(e.response, response);

  // 音声認識の生結果と入力方法（フォームに質問を追加し、entry 番号を設定した場合のみ記録）
  if (e.recognized && e.recognized.startsWith("entry.")) {
    formData.append(e.recognized, recognized);
  } else if (recognized) {
    warnOnce("recognized", "音声認識の結果を記録するには、フォームに質問を追加し CONFIG.entries.recognized に entry 番号を設定してください。");
  }

  if (e.inputMethod && e.inputMethod.startsWith("entry.")) {
    formData.append(e.inputMethod, method);
  } else if (method !== "typing") {
    warnOnce("inputMethod", "入力方法を記録するには、フォームに質問を追加し CONFIG.entries.inputMethod に entry 番号を設定してください。");
  }

  // no-cors のため、送信の成否は JavaScript からは判定できません。
  // 実際に記録されたかどうかはフォームの回答一覧でご確認ください。
  fetch(CONFIG.formUrl, { method: "POST", body: formData, mode: "no-cors" })
    .then(() => console.log("送信しました:", { studentId, opponent, scenarioKey, method }))
    .catch(error => console.error("送信エラー:", error));
}

// 同じ警告を繰り返し出さないようにする
const warnedKeys = new Set();
function warnOnce(key, message) {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message);
}

// =====================================================
//  初期化
// =====================================================

function init() {
  // 学籍番号
  const studentField = document.getElementById("student-id");
  if (studentField) {
    try {
      const savedId = localStorage.getItem("studentId");
      if (savedId) studentField.value = savedId;
    } catch (e) { console.warn("localStorage を利用できません:", e); }

    studentField.addEventListener("input", () => {
      try { localStorage.setItem("studentId", studentField.value.trim()); } catch (e) { /* 継続 */ }
    });
  }

  // 入力欄
  const messageInput = document.getElementById("message-input");
  messageInput.addEventListener("input", () => {
    resizeInput(messageInput);
    // 入力欄を空にしたら、直前の認識結果とのひも付けを解除する
    if (messageInput.value.trim() === "") { recognizedText = null; recognitionLang = null; }
  });

  // 送信ボタン
  document.getElementById("send-button").addEventListener("click", handleSend);

  // 音声入力
  setupRecognition();

  // VTS画像（ファイルがなければ非表示のまま）
  const img = document.getElementById("scenario-image");
  if (img) {
    img.addEventListener("load", () => { img.style.display = "block"; });
    img.addEventListener("error", () => {
      if (img.getAttribute("src")) console.warn("画像が見つかりません:", img.getAttribute("src"));
      img.style.display = "none";
    });
  }

  // 訓練モードのボタン
  document.querySelectorAll(".role-button").forEach(button => {
    button.addEventListener("click", () => {
      if (button.id === "help-button") { window.location.href = "help.html"; return; }

      resetTrainingState();
      resetSubUIs();
      document.querySelectorAll(".role-button").forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");

      switch (button.id) {
        case "ship-button":
          mode = "ship";
          currentOpponent = "Umitakamaru";
          document.getElementById("ship-scenario-select").style.display = "block";
          break;

        case "vts-button":
          mode = "vts";
          currentOpponent = "Tokyo Martis";
          document.getElementById("vts-scenario-select").style.display = "block";
          break;

        case "random-button":
          mode = "random";
          hideScenarioName = true;   // 仕様どおり、シナリオは学生に知らせない
          clearChat();
          if (!scenarioLoaded) { systemMessage(loadingMessage()); break; }
          if (!pickRandomScenario()) { systemMessage("scenario.json に使用できるシナリオがありません。"); break; }
          appendMessage(
            "reply-message " + (currentOpponent === "Umitakamaru" ? "umitaka" : "vts"),
            "相手役",
            `${currentOpponent}（${OPPONENT_LABEL[currentOpponent]}）　※シナリオは非公開です`
          );
          console.log("ランダム選択:", currentOpponent, shipScenario || vtsScenario);
          break;

        case "listening-button":
          mode = "listening";
          clearChat();
          document.getElementById("listening-level-box").style.display = "block";
          break;
      }
      updateStatusBar();
    });
  });

  // リスニングのレベル
  document.querySelectorAll(".level-button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".level-button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      startListening(btn.dataset.level);
    });
  });

  // 船舶シナリオ
  document.querySelectorAll(".ship-scenario").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".ship-scenario").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      shipScenario = btn.dataset.scenario;
      lastOpponentMessage = null;
      updateStatusBar();
      if (getScenarioStatus().state === "empty") systemMessage("このシナリオは現在準備中です。");
    });
  });

  // VTSシナリオ
  document.querySelectorAll(".vts-scenario").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".vts-scenario").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      vtsScenario = `${btn.dataset.type}${btn.dataset.num}`;
      lastOpponentMessage = null;
      showVtsImage(vtsScenario);
      updateStatusBar();
      if (getScenarioStatus().state === "empty") systemMessage("このシナリオは現在準備中です。");
    });
  });

  // アクセント
  document.querySelectorAll("#voice-buttons button").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#voice-buttons button").forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");
      setVoice(button.dataset.voice, button.dataset.lang);
    });
  });

  updateStatusBar();
  if (!speechSupported) {
    systemMessage("このブラウザは音声読み上げに対応していません。Edge または Chrome をお使いください。");
  }
}

// =====================================================
//  起動
// =====================================================

if (speechSupported) {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => {
    console.log("Voices loaded:", speechSynthesis.getVoices().map(v => `${v.name} (${v.lang})`));
  };
}

fetch("scenario.json")
  .then(response => {
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  })
  .then(data => {
    scenario = data;
    scenarioLoaded = true;
    console.log("シナリオを読み込みました:", scenario);
  })
  .catch(error => {
    scenarioLoadFailed = true;
    console.error("シナリオの読み込みに失敗しました:", error);
    if (document.getElementById("chat-box")) systemMessage(loadingMessage());
  });

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
