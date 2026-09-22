// =====================================================
//  開発者ページ
//  パスワードの確認とデータの取り出しは、すべて GAS 側で行います。
//  このファイルにはパスワードもデータも含まれていません（GitHub で公開されても問題ありません）。
// =====================================================

const TOKEN_KEY = "adminToken";
let token = null;
try { token = sessionStorage.getItem(TOKEN_KEY); } catch (e) { /* 使えなければ毎回ログイン */ }

const $ = id => document.getElementById(id);

// ---------- GAS との通信 ----------
async function api(action, payload = {}) {
  const url = (typeof APP_CONFIG !== "undefined") ? APP_CONFIG.gasUrl : "";
  if (!url) throw new Error("config.js に GAS の URL が設定されていません。");

  // Content-Type を text/plain にすると、ブラウザの事前確認（CORS）なしで GAS に送れます
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, token, ...payload })
  });
  const data = await res.json();

  if (data.error === "unauthorized") {
    showLogin("ログインの有効期限が切れました。もう一度ログインしてください。");
    throw new Error("unauthorized");
  }
  if (!data.ok) throw new Error(data.error || "エラーが発生しました。");
  return data;
}

// ---------- 表の描画（学生の入力は textContent で表示し、HTML として解釈させない） ----------
function renderTable(table, headers, rows, emptyText = "データがありません。") {
  table.textContent = "";
  if (!rows.length) {
    const tr = table.insertRow();
    const td = tr.insertCell();
    td.textContent = emptyText;
    td.className = "empty";
    return;
  }
  const head = table.createTHead().insertRow();
  headers.forEach(h => { const th = document.createElement("th"); th.textContent = h; head.appendChild(th); });
  const body = table.createTBody();
  rows.forEach(r => {
    const tr = body.insertRow();
    r.forEach(v => { tr.insertCell().textContent = v == null ? "" : String(v); });
  });
}

function renderCards(container, items) {
  container.textContent = "";
  items.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    const v = document.createElement("div"); v.className = "stat-value"; v.textContent = value;
    const l = document.createElement("div"); l.className = "stat-label"; l.textContent = label;
    card.appendChild(v); card.appendChild(l);
    container.appendChild(card);
  });
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  if (busy) { button.dataset.label = button.textContent; button.textContent = "読み込み中…"; }
  else if (button.dataset.label) button.textContent = button.dataset.label;
}

// ---------- ログイン ----------
function showLogin(message = "") {
  token = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  $("admin-main").style.display = "none";
  $("login-section").style.display = "block";
  $("login-message").textContent = message;
}

async function login() {
  const btn = $("login-button");
  setBusy(btn, true);
  $("login-message").textContent = "";
  try {
    const data = await api("login", { password: $("admin-password").value });
    token = data.token;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) {}
    $("admin-password").value = "";
    await showMain();
  } catch (e) {
    $("login-message").textContent = e.message;
  } finally {
    setBusy(btn, false);
  }
}

async function logout() {
  try { await api("logout"); } catch (e) { /* 失効済みでも画面は戻す */ }
  showLogin("ログアウトしました。");
}

async function showMain() {
  $("login-section").style.display = "none";
  $("admin-main").style.display = "block";
  await Promise.all([loadSettings(), loadDashboard()]);
}

// ---------- 設定 ----------
async function loadSettings() {
  const { settings } = await api("getSettings");
  $("monitor-toggle").checked = settings.monitorMode;
  $("copypaste-toggle").checked = settings.copyPasteBan;
  $("settings-message").textContent = settings.updatedAt ? `最終変更: ${settings.updatedAt}` : "";
}

async function saveSettings() {
  const btn = $("save-settings");
  setBusy(btn, true);
  try {
    const { settings } = await api("setSettings", {
      settings: { monitorMode: $("monitor-toggle").checked, copyPasteBan: $("copypaste-toggle").checked }
    });
    $("settings-message").textContent =
      `保存しました（監視モード: ${settings.monitorMode ? "ON" : "OFF"} / コピペ禁止: ${settings.copyPasteBan ? "ON" : "OFF"}）`;
  } catch (e) {
    $("settings-message").textContent = e.message;
  } finally {
    setBusy(btn, false);
  }
}

// ---------- ダッシュボード ----------
async function loadDashboard() {
  const btn = $("refresh-button");
  setBusy(btn, true);
  try {
    const d = await api("dashboard");
    $("generated-at").textContent = `集計日時: ${d.generatedAt}`;

    const s = d.stats;
    renderCards($("stat-cards"), [
      ["総利用回数", s.total],
      ["本日の利用回数", s.today],
      ["利用学生数", s.studentCount],
      ["音声入力", s.voiceCount],
      ["手入力", s.typingCount],
      ["平均 Paste Count", s.averagePaste]
    ]);
    renderTable($("scenario-table"), ["シナリオ", "利用回数"], s.byScenario.map(x => [x.scenario, x.count]));

    renderTable($("suspicious-table"), ["区分", "内容", "対象", "詳細", "日時"],
      d.suspicious.map(a => [a.level, a.type, a.target, a.detail, a.time]),
      "検知された不正利用の疑いはありません。");

    renderTable($("students-table"), ["学籍番号", "Device ID", "利用回数", "最終利用日時"],
      d.students.map(x => [x.studentId, x.deviceIds.join(", "), x.count, x.lastUsed]));

    const p = d.paste;
    renderCards($("paste-overall"), [
      ["全体 Paste Count", p.overall.total],
      ["送信数", p.overall.posts],
      ["1送信あたり", p.overall.average]
    ]);
    renderTable($("paste-table"), ["学籍番号", "Paste Count 合計", "送信数", "1送信あたり"],
      p.byStudent.map(x => [x.studentId, x.total, x.posts, x.average]));
  } catch (e) {
    if (e.message !== "unauthorized") alert(e.message);
  } finally {
    setBusy(btn, false);
  }
}

// ---------- 学籍番号検索 ----------
async function search() {
  const btn = $("search-button");
  setBusy(btn, true);
  try {
    const r = await api("search", { studentId: $("search-id").value });
    const top = r.byScenario.slice(0, 5).map(x => `${x.scenario}（${x.count}回）`).join("、");
    $("search-summary").textContent = `${r.studentId}：利用回数 ${r.count} 回${top ? "　よく使うシナリオ: " + top : ""}`;
    renderTable($("search-table"), ["利用日時", "相手役", "シナリオ", "入力方法", "Paste Count", "Device ID", "応答"],
      r.rows.map(x => [x.time, x.opponent, x.scenario, x.inputMethod, x.pasteCount, x.deviceId, x.response]),
      "この学籍番号の利用履歴はありません。");
  } catch (e) {
    $("search-summary").textContent = e.message;
  } finally {
    setBusy(btn, false);
  }
}

// ---------- 授業監視 ----------
async function classMonitor() {
  const btn = $("class-button");
  setBusy(btn, true);
  try {
    const r = await api("classMonitor", {
      date: $("class-date").value, start: $("class-start").value, end: $("class-end").value
    });
    $("class-summary").textContent = `${r.range}　利用者 ${r.users.length} 名` +
      (r.rosterLoaded ? `　／　未利用者 ${r.nonUsers.length} 名` : "");

    renderTable($("class-users"), ["学籍番号", "送信数", "最初", "最後", "Device ID", "Paste Count"],
      r.users.map(u => [u.studentId, u.count, u.first, u.last, u.deviceIds.join(", "), u.pasteTotal]),
      "この時間帯の利用者はいません。");

    const box = $("class-nonusers");
    box.textContent = "";
    const p = document.createElement("p");
    if (!r.rosterLoaded) {
      p.textContent = "未利用者を表示するには、スプレッドシートに「名簿」シートを作成し、A列に学籍番号を入力してください。";
    } else {
      p.textContent = r.nonUsers.length ? r.nonUsers.join("、") : "全員が利用しています。";
    }
    box.appendChild(p);
    if (r.notInRoster && r.notInRoster.length) {
      const warn = document.createElement("p");
      warn.className = "admin-error";
      warn.textContent = `名簿にない学籍番号: ${r.notInRoster.join("、")}（入力ミスの可能性があります）`;
      box.appendChild(warn);
    }
  } catch (e) {
    $("class-summary").textContent = e.message;
  } finally {
    setBusy(btn, false);
  }
}

// ---------- 初期化 ----------
document.addEventListener("DOMContentLoaded", () => {
  const today = new Date();
  const pad = n => String(n).padStart(2, "0");
  $("class-date").value = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  $("login-button").addEventListener("click", login);
  $("admin-password").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
  $("logout-button").addEventListener("click", logout);
  $("refresh-button").addEventListener("click", loadDashboard);
  $("save-settings").addEventListener("click", saveSettings);
  $("search-button").addEventListener("click", search);
  $("search-id").addEventListener("keydown", e => { if (e.key === "Enter") search(); });
  $("class-button").addEventListener("click", classMonitor);

  if (token) showMain().catch(() => {}); else showLogin();
});
