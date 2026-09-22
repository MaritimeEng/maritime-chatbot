/**
 * 海事英語教育支援システム ― Google Apps Script（バックエンド）
 *
 * 役割
 *  1. 監視モード・コピペ禁止モードの設定を保存し、GitHub Pages に配信する
 *  2. フォームの回答シートを集計し、開発者ページにだけ返す（パスワード必須）
 *
 * 設置場所: フォームの回答先スプレッドシート →「拡張機能」→「Apps Script」
 * パスワード: コードには書かず、「プロジェクトの設定」→「スクリプト プロパティ」に
 *             ADMIN_PASSWORD という名前で登録してください。
 */

// =====================================================
//  設定
// =====================================================
const APP = {
  RESPONSE_SHEET_NAME: "",      // 回答シート名。空ならヘッダーに「タイムスタンプ」がある最初のシートを自動検出
  ROSTER_SHEET_NAME: "名簿",     // 未利用者一覧に使う名簿シート（A列に学籍番号。1行目は見出し）
  TIMEZONE: "Asia/Tokyo",

  TOKEN_TTL_SECONDS: 6 * 60 * 60, // ログインの有効時間（最大6時間）
  MAX_LOGIN_FAILS: 5,             // この回数間違えると一時ロック
  LOCK_MINUTES: 10,

  // 不正利用検知のしきい値
  DETECTION_DAYS: 30,             // 直近何日分を検知対象にするか
  SESSION_MINUTES: 100,           // 「同一授業時間」とみなす間隔（90分授業＋前後）
  BULK_WINDOW_MINUTES: 5,         // 大量送信を判定する時間幅
  BULK_MAX_POSTS: 40              // 上の時間幅でこれを超えたら警告
};

// フォームの質問タイトル（シートの見出し）。日本語の見出しでも認識できるよう別名を並べています。
const COLUMNS = {
  timestamp:   ["タイムスタンプ", "Timestamp"],
  studentId:   ["Student ID", "学籍番号"],
  deviceId:    ["Device ID", "端末ID"],
  opponent:    ["Opponent", "相手役"],
  scenario:    ["Scenario", "シナリオ", "シナリオ名"],
  userInput:   ["User Input", "ユーザー入力"],
  response:    ["System Response", "応答", "システム応答"],
  recognized:  ["Speech Recognition Result", "音声認識の結果"],
  inputMethod: ["Input Method", "入力方法"],
  pasteCount:  ["Paste Count", "貼り付け回数"]
};

// =====================================================
//  入口
// =====================================================

// GET: 学生用ページが設定を読み込む（パスワード不要・設定値のみ）
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "settings";
  if (action === "settings") return json_({ ok: true, settings: getSettings_() });
  return json_({ ok: false, error: "unknown action" });
}

// POST: 開発者ページからの要求（ログイン以外はトークン必須）
// ※ GitHub Pages から送るときは Content-Type: text/plain にします（CORS の事前確認を避けるため）
function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "invalid request" });
  }

  try {
    if (body.action === "login") return json_(login_(body.password));
    if (!isValidToken_(body.token)) return json_({ ok: false, error: "unauthorized" });

    switch (body.action) {
      case "logout":
        CacheService.getScriptCache().remove("token_" + body.token);
        return json_({ ok: true });
      case "getSettings":
        return json_({ ok: true, settings: getSettings_() });
      case "setSettings":
        return json_({ ok: true, settings: setSettings_(body.settings || {}) });
      case "dashboard":
        return json_(Object.assign({ ok: true }, dashboard_()));
      case "search":
        return json_(Object.assign({ ok: true }, searchStudent_(body.studentId)));
      case "classMonitor":
        return json_(Object.assign({ ok: true }, classMonitor_(body.date, body.start, body.end)));
      default:
        return json_({ ok: false, error: "unknown action" });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// =====================================================
//  認証
// =====================================================
function login_(password) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get("login_fails") || 0);
  if (fails >= APP.MAX_LOGIN_FAILS) {
    return { ok: false, error: `ログインの失敗が続いたため、${APP.LOCK_MINUTES}分間ロックしています。` };
  }

  const expected = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD");
  if (!expected) return { ok: false, error: "ADMIN_PASSWORD がスクリプト プロパティに設定されていません。" };

  if (String(password || "") !== expected) {
    cache.put("login_fails", String(fails + 1), APP.LOCK_MINUTES * 60);
    return { ok: false, error: "パスワードが違います。" };
  }

  cache.remove("login_fails");
  const token = Utilities.getUuid();
  cache.put("token_" + token, "1", APP.TOKEN_TTL_SECONDS);
  return { ok: true, token: token };
}

function isValidToken_(token) {
  if (!token || typeof token !== "string") return false;
  return CacheService.getScriptCache().get("token_" + token) === "1";
}

// =====================================================
//  設定（監視モード・コピペ禁止モード）
// =====================================================
function getSettings_() {
  const p = PropertiesService.getScriptProperties();
  return {
    monitorMode: p.getProperty("MONITOR_MODE") === "true",
    copyPasteBan: p.getProperty("COPY_PASTE_BAN") === "true",
    updatedAt: p.getProperty("SETTINGS_UPDATED_AT") || ""
  };
}

function setSettings_(settings) {
  const p = PropertiesService.getScriptProperties();
  if (typeof settings.monitorMode === "boolean") p.setProperty("MONITOR_MODE", String(settings.monitorMode));
  if (typeof settings.copyPasteBan === "boolean") p.setProperty("COPY_PASTE_BAN", String(settings.copyPasteBan));
  p.setProperty("SETTINGS_UPDATED_AT", fmt_(new Date()));
  return getSettings_();
}

// =====================================================
//  データ読み込み
// =====================================================
function getResponseSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (APP.RESPONSE_SHEET_NAME) {
    const named = ss.getSheetByName(APP.RESPONSE_SHEET_NAME);
    if (!named) throw new Error(`シート「${APP.RESPONSE_SHEET_NAME}」が見つかりません。`);
    return named;
  }
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    const lastCol = sh.getLastColumn();
    if (lastCol < 1) continue;
    const header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    if (header.some(h => COLUMNS.timestamp.indexOf(h) >= 0)) return sh;
  }
  throw new Error("フォームの回答シートが見つかりません。フォームとスプレッドシートがリンクされているか確認してください。");
}

function readLogs_() {
  const values = getResponseSheet_().getDataRange().getValues();
  if (values.length < 2) return [];

  const header = values[0].map(h => String(h).trim());
  const idx = {};
  Object.keys(COLUMNS).forEach(key => {
    idx[key] = header.findIndex(h => COLUMNS[key].indexOf(h) >= 0);
  });
  const str = (row, key) => (idx[key] >= 0 ? String(row[idx[key]] == null ? "" : row[idx[key]]).trim() : "");

  const logs = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const rawTs = idx.timestamp >= 0 ? row[idx.timestamp] : "";
    const ts = rawTs instanceof Date ? rawTs : new Date(rawTs);
    if (isNaN(ts.getTime())) continue;

    let opponent = str(row, "opponent");
    let scenario = str(row, "scenario");
    // 旧形式（相手役の欄に "Umitakamaru / crossing1" とまとめて記録）にも対応
    if (!scenario && opponent.indexOf(" / ") >= 0) {
      const parts = opponent.split(" / ");
      opponent = parts[0];
      scenario = parts.slice(1).join(" / ");
    }

    logs.push({
      ts: ts,
      studentId: str(row, "studentId"),
      deviceId: str(row, "deviceId"),
      opponent: opponent,
      scenario: scenario,
      userInput: str(row, "userInput"),
      response: str(row, "response"),
      recognized: str(row, "recognized"),
      inputMethod: str(row, "inputMethod") || "typing",
      pasteCount: Number(str(row, "pasteCount")) || 0
    });
  }
  return logs;
}

function readRoster_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(APP.ROSTER_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return null;
  return sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
    .map(r => String(r[0]).trim())
    .filter(Boolean);
}

// =====================================================
//  集計
// =====================================================
function dashboard_() {
  const logs = readLogs_();
  return {
    generatedAt: fmt_(new Date()),
    stats: computeStats_(logs),
    students: computeStudents_(logs),
    suspicious: detectSuspicious_(logs),
    paste: computePaste_(logs)
  };
}

function computeStats_(logs) {
  const today = fmtDate_(new Date());
  const students = new Set();
  const byScenario = {};
  let todayCount = 0, voice = 0, typing = 0, pasteTotal = 0;

  logs.forEach(l => {
    if (fmtDate_(l.ts) === today) todayCount++;
    if (l.studentId) students.add(l.studentId);
    const key = l.scenario ? `${l.opponent} / ${l.scenario}` : (l.opponent || "(不明)");
    byScenario[key] = (byScenario[key] || 0) + 1;
    if (l.inputMethod.indexOf("voice") === 0) voice++; else typing++;
    pasteTotal += l.pasteCount;
  });

  return {
    total: logs.length,
    today: todayCount,
    studentCount: students.size,
    voiceCount: voice,
    typingCount: typing,
    averagePaste: logs.length ? Math.round((pasteTotal / logs.length) * 100) / 100 : 0,
    byScenario: Object.keys(byScenario)
      .map(k => ({ scenario: k, count: byScenario[k] }))
      .sort((a, b) => b.count - a.count)
  };
}

function computeStudents_(logs) {
  const map = {};
  logs.forEach(l => {
    if (!l.studentId) return;
    const s = map[l.studentId] || (map[l.studentId] = { studentId: l.studentId, devices: {}, count: 0, last: null });
    s.count++;
    if (l.deviceId) s.devices[l.deviceId] = true;
    if (!s.last || l.ts > s.last) s.last = l.ts;
  });
  return Object.keys(map).map(k => map[k])
    .sort((a, b) => b.last - a.last)
    .map(s => ({ studentId: s.studentId, deviceIds: Object.keys(s.devices), count: s.count, lastUsed: fmt_(s.last) }));
}

function computePaste_(logs) {
  const map = {};
  let total = 0;
  logs.forEach(l => {
    total += l.pasteCount;
    if (!l.studentId) return;
    const s = map[l.studentId] || (map[l.studentId] = { studentId: l.studentId, total: 0, posts: 0 });
    s.total += l.pasteCount;
    s.posts++;
  });
  return {
    overall: {
      total: total,
      posts: logs.length,
      average: logs.length ? Math.round((total / logs.length) * 100) / 100 : 0
    },
    byStudent: Object.keys(map).map(k => map[k])
      .map(s => ({ studentId: s.studentId, total: s.total, posts: s.posts, average: Math.round((s.total / s.posts) * 100) / 100 }))
      .sort((a, b) => b.total - a.total)
  };
}

// 不正利用の検知（警告のみ。自動停止はしない）
function detectSuspicious_(logs) {
  const since = new Date(Date.now() - APP.DETECTION_DAYS * 24 * 60 * 60 * 1000);
  const recent = logs.filter(l => l.ts >= since).sort((a, b) => a.ts - b.ts);
  const sessionMs = APP.SESSION_MINUTES * 60 * 1000;
  const alerts = [];

  // 1. 同一端末から複数の学籍番号
  const byDevice = groupBy_(recent.filter(l => l.deviceId), l => l.deviceId);
  Object.keys(byDevice).forEach(deviceId => {
    const ids = unique_(byDevice[deviceId].map(l => l.studentId).filter(Boolean));
    if (ids.length >= 2) {
      alerts.push({
        level: "警告", type: "同一端末から複数の学籍番号",
        target: `端末 ${deviceId}`,
        detail: `学籍番号: ${ids.join(", ")}`,
        time: fmt_(byDevice[deviceId][byDevice[deviceId].length - 1].ts)
      });
    }
  });

  // 2. 同一授業時間中の不自然な利用
  //   a) 同じ学籍番号が短時間に別の端末から使われた（なりすまし・代理入力の可能性）
  const byStudent = groupBy_(recent.filter(l => l.studentId && l.deviceId), l => l.studentId);
  Object.keys(byStudent).forEach(studentId => {
    const rows = byStudent[studentId];
    const flagged = {};
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      if (a.deviceId !== b.deviceId && b.ts - a.ts <= sessionMs) {
        const day = fmtDate_(b.ts);
        if (flagged[day]) continue;
        flagged[day] = true;
        alerts.push({
          level: "注意", type: "同一授業時間中に複数の端末",
          target: `学籍番号 ${studentId}`,
          detail: `${fmtTime_(a.ts)} 端末 ${a.deviceId} → ${fmtTime_(b.ts)} 端末 ${b.deviceId}`,
          time: fmt_(b.ts)
        });
      }
    }
  });

  //   b) 同じ端末で短時間に学籍番号が切り替わった
  Object.keys(byDevice).forEach(deviceId => {
    const rows = byDevice[deviceId].filter(l => l.studentId);
    const flagged = {};
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      if (a.studentId !== b.studentId && b.ts - a.ts <= sessionMs) {
        const day = fmtDate_(b.ts);
        if (flagged[day]) continue;
        flagged[day] = true;
        alerts.push({
          level: "警告", type: "同一授業時間中に学籍番号を切り替え",
          target: `端末 ${deviceId}`,
          detail: `${fmtTime_(a.ts)} ${a.studentId} → ${fmtTime_(b.ts)} ${b.studentId}`,
          time: fmt_(b.ts)
        });
      }
    }
  });

  // 3. 異常な大量送信（端末ごと・学籍番号ごと）
  const windowMs = APP.BULK_WINDOW_MINUTES * 60 * 1000;
  [["deviceId", "端末"], ["studentId", "学籍番号"]].forEach(pair => {
    const key = pair[0], label = pair[1];
    const groups = groupBy_(recent.filter(l => l[key]), l => l[key]);
    Object.keys(groups).forEach(id => {
      const rows = groups[id];
      let start = 0, peak = 0, peakAt = null;
      for (let end = 0; end < rows.length; end++) {
        while (rows[end].ts - rows[start].ts > windowMs) start++;
        const n = end - start + 1;
        if (n > peak) { peak = n; peakAt = rows[end].ts; }
      }
      if (peak > APP.BULK_MAX_POSTS) {
        alerts.push({
          level: "警告", type: "異常な大量送信",
          target: `${label} ${id}`,
          detail: `${APP.BULK_WINDOW_MINUTES}分間に最大 ${peak} 回の送信`,
          time: fmt_(peakAt)
        });
      }
    });
  });

  return alerts.sort((a, b) => (a.time < b.time ? 1 : -1));
}

// 学籍番号検索
function searchStudent_(studentId) {
  const id = String(studentId || "").trim();
  if (!id) throw new Error("学籍番号を入力してください。");

  const rows = readLogs_().filter(l => l.studentId === id).sort((a, b) => b.ts - a.ts);
  const byScenario = {};
  rows.forEach(l => {
    const key = l.scenario ? `${l.opponent} / ${l.scenario}` : l.opponent;
    byScenario[key] = (byScenario[key] || 0) + 1;
  });

  return {
    studentId: id,
    count: rows.length,
    byScenario: Object.keys(byScenario).map(k => ({ scenario: k, count: byScenario[k] })).sort((a, b) => b.count - a.count),
    rows: rows.slice(0, 500).map(l => ({
      time: fmt_(l.ts), opponent: l.opponent, scenario: l.scenario,
      inputMethod: l.inputMethod, pasteCount: l.pasteCount, deviceId: l.deviceId, response: l.response
    }))
  };
}

// 授業監視（指定日時の利用者・未利用者）
function classMonitor_(date, start, end) {
  const d = String(date || "").split(/[-\/]/).map(Number);
  const s = String(start || "").split(":").map(Number);
  const e = String(end || "").split(":").map(Number);
  if (d.length !== 3 || s.length < 2 || e.length < 2 || [].concat(d, s, e).some(isNaN)) {
    throw new Error("日付と時刻を正しく入力してください。");
  }
  const from = new Date(d[0], d[1] - 1, d[2], s[0], s[1], 0);
  const to = new Date(d[0], d[1] - 1, d[2], e[0], e[1], 59);
  if (to <= from) throw new Error("終了時刻は開始時刻より後にしてください。");

  const inRange = readLogs_().filter(l => l.ts >= from && l.ts <= to && l.studentId);
  const groups = groupBy_(inRange, l => l.studentId);
  const users = Object.keys(groups).map(id => {
    const rows = groups[id];
    return {
      studentId: id,
      count: rows.length,
      first: fmtTime_(rows[0].ts),
      last: fmtTime_(rows[rows.length - 1].ts),
      deviceIds: unique_(rows.map(r => r.deviceId).filter(Boolean)),
      pasteTotal: rows.reduce((sum, r) => sum + r.pasteCount, 0)
    };
  }).sort((a, b) => (a.studentId < b.studentId ? -1 : 1));

  const roster = readRoster_();
  const used = new Set(users.map(u => u.studentId));
  return {
    range: `${fmt_(from)} 〜 ${fmtTime_(to)}`,
    users: users,
    rosterLoaded: Boolean(roster),
    nonUsers: roster ? roster.filter(id => !used.has(id)) : [],
    notInRoster: roster ? users.map(u => u.studentId).filter(id => roster.indexOf(id) < 0) : []
  };
}

// =====================================================
//  補助
// =====================================================
function groupBy_(arr, keyFn) {
  const out = {};
  arr.forEach(x => { const k = keyFn(x); (out[k] = out[k] || []).push(x); });
  Object.keys(out).forEach(k => out[k].sort((a, b) => a.ts - b.ts));
  return out;
}
function unique_(arr) { return arr.filter((x, i) => arr.indexOf(x) === i); }
function fmt_(d) { return d ? Utilities.formatDate(d, APP.TIMEZONE, "yyyy/MM/dd HH:mm:ss") : ""; }
function fmtDate_(d) { return Utilities.formatDate(d, APP.TIMEZONE, "yyyy/MM/dd"); }
function fmtTime_(d) { return Utilities.formatDate(d, APP.TIMEZONE, "HH:mm"); }

// =====================================================
//  動作確認用（エディタで選んで「実行」すると、ログに結果が出ます）
// =====================================================
function testDashboard() {
  const result = dashboard_();
  Logger.log(JSON.stringify(result.stats, null, 2));
  Logger.log(`不正利用の警告: ${result.suspicious.length} 件`);
}
