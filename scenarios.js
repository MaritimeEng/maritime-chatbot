// =====================================================
//  シナリオ一覧ページ
//  scenario.json と phrases.json を読み込み、全文を表示します。
//  シナリオを追加しても、このページを書き換える必要はありません。
// =====================================================

const SHIP_LABEL = { meeting: "行き会い", crossing: "横切り", overtaking: "追い越し", other: "その他" };
const VTS_LABEL = { report: "通報", notice: "報告", ask: "問いかけ" };
const PHRASE_SETS = {
  anchor: { title: "投錨・抜錨", letters: "A・B・C" },
  harbor: { title: "出入港・当直引き継ぎ", letters: "D・E・F" }
};
const SET_SIZE = 15;

function keyLabel(key, labels) {
  const m = String(key).match(/^([a-z]+)(\d+)$/);
  return m && labels[m[1]] ? `${labels[m[1]]}${m[2]}` : key;
}

// シナリオは配列形式と、{ opening, opponentName, turns } のオブジェクト形式に対応
function getTurns(entry) {
  if (Array.isArray(entry)) return entry;
  if (entry && Array.isArray(entry.turns)) return entry.turns;
  return null;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function section(container, id, title) {
  const h2 = el("h2", null, title);
  h2.id = id;   // 目次からのジャンプ先
  container.appendChild(h2);
}

function renderConversations(container, group, labelFn, opponentDefault) {
  const keys = Object.keys(group || {});
  if (keys.length === 0) {
    container.appendChild(el("p", "pending", "シナリオがありません。"));
    return;
  }

  keys.forEach(key => {
    const entry = group[key];
    const turns = getTurns(entry);
    const opponent = (entry && !Array.isArray(entry) && entry.opponentName) ? entry.opponentName : opponentDefault;

    const block = el("div", "scenario-block");
    block.appendChild(el("h3", null, `${labelFn(key)}（${key}）`));

    if (!Array.isArray(turns) || turns.length === 0) {
      block.appendChild(el("p", "pending", "準備中"));
      container.appendChild(block);
      return;
    }

    const opening = (entry && !Array.isArray(entry) && entry.opening) ? entry.opening : null;
    if (opening) {
      const div = el("div", "line-them opening", `${opponent}（シナリオ選択と同時に流れます）: ${opening}`);
      block.appendChild(div);
    }

    const ol = document.createElement("ol");
    turns.forEach(item => {
      const li = document.createElement("li");
      li.appendChild(el("div", "line-you", `自船: ${item.inputs?.[0] ?? ""}`));
      if ((item.inputs || []).length > 1) {
        const details = document.createElement("details");
        details.appendChild(el("summary", "line-alt", `他に許容される表現 ${item.inputs.length - 1} 通り`));
        const ul = document.createElement("ul");
        item.inputs.slice(1).forEach(x => ul.appendChild(el("li", "line-alt", x)));
        details.appendChild(ul);
        li.appendChild(details);
      }
      li.appendChild(el("div", "line-them", `${opponent}: ${item.response ?? ""}`));
      ol.appendChild(li);
    });
    block.appendChild(ol);
    container.appendChild(block);
  });
}

function renderListening(container, listening) {
  Object.keys(listening || {}).forEach(key => {
    const block = el("div", "scenario-block");
    block.appendChild(el("h3", null, key.replace("level", "Level ")));
    const ul = document.createElement("ul");
    (listening[key] || []).forEach(item => {
      ul.appendChild(el("li", null, item.image ? `${item.sentence}（画像: ${item.image}）` : item.sentence));
    });
    block.appendChild(ul);
    container.appendChild(block);
  });
}

function renderPhrases(container, list, info) {
  if (!Array.isArray(list) || list.length === 0) {
    container.appendChild(el("p", "pending", "フレーズが登録されていません。"));
    return;
  }

  container.appendChild(el("p", "doc-note",
    `全${list.length}問（${info.letters} の各形式で出題）。15問ごとのセットに分かれています。`));

  const setCount = Math.ceil(list.length / SET_SIZE);
  for (let s = 0; s < setCount; s++) {
    const block = el("div", "scenario-block");
    const letters = info.letters.split("・");
    block.appendChild(el("h3", null, `セット ${s + 1}（${letters.map(l => `${l}-${s + 1}`).join(" / ")}）`));

    const table = el("table", "doc-table phrase-table");
    const head = document.createElement("tr");
    head.appendChild(el("th", null, "No."));
    head.appendChild(el("th", null, "English"));
    head.appendChild(el("th", null, "日本語"));
    table.appendChild(head);

    list.slice(s * SET_SIZE, (s + 1) * SET_SIZE).forEach((item, i) => {
      const tr = document.createElement("tr");
      tr.appendChild(el("td", null, String(i + 1)));
      const en = el("td", "en");
      en.appendChild(document.createTextNode(item.en));
      if (item.note) en.appendChild(el("div", "line-alt", `（${item.note}）`));
      tr.appendChild(en);
      tr.appendChild(el("td", null, item.ja));
      table.appendChild(tr);
    });
    block.appendChild(table);
    container.appendChild(block);
  }
}

function renderAll(scenario, phrases) {
  const container = document.getElementById("scenario-dump");
  container.textContent = "";

  section(container, "ship", "船舶間通信（Umitakamaru）");
  renderConversations(container, scenario.ship, k => keyLabel(k, SHIP_LABEL), "Umitakamaru");

  section(container, "vts", "VTS通信");
  renderConversations(container, scenario.vts, k => keyLabel(k, VTS_LABEL), "Tokyo Martis");

  section(container, "listening", "リスニング");
  renderListening(container, scenario.listening);

  if (phrases) {
    Object.keys(PHRASE_SETS).forEach(kind => {
      const info = PHRASE_SETS[kind];
      section(container, kind, info.title);
      renderPhrases(container, phrases[kind], info);
    });
  }

  // 見出しが揃ってから目次を作り直す
  if (typeof buildToc === "function") buildToc();
}

function loadJson(path) {
  return fetch(path, { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.json(); });
}

// 監視モードの判定（nav.js）を待ってから描画する。
// 待たずに描画すると、いったん隠した内容を上書きして表示してしまうため。
const monitorCheck = () => (window.MONITOR_READY || Promise.resolve(false));

Promise.all([loadJson("scenario.json"), loadJson("phrases.json").catch(() => null)])
  .then(([scenario, phrases]) => monitorCheck().then(hidden => {
    if (hidden) return;   // 監視モード中は表示しない
    renderAll(scenario, phrases);
  }))
  .catch(error => {
    console.error(error);
    document.getElementById("scenario-dump").textContent =
      "データを読み込めませんでした。ローカルサーバーまたは GitHub Pages 経由で開いてください。";
  });
