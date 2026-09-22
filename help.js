// help.html の「シナリオ全文」を scenario.json から自動生成する
// （シナリオを追加しても、この解説ページを手で書き換える必要はありません）

const SHIP_LABEL = { meeting: "行き会い", crossing: "横切り", overtaking: "追い越し", other: "その他" };
const VTS_LABEL = { report: "通報", notice: "報告", ask: "問いかけ" };

function keyLabel(key, labels) {
  const m = key.match(/^([a-z]+)(\d+)$/);
  return m && labels[m[1]] ? `${labels[m[1]]}${m[2]}` : key;
}

// シナリオは配列形式と、{ opening, opponentName, turns } のオブジェクト形式に対応
function getTurns(entry) {
  if (Array.isArray(entry)) return entry;
  if (entry && Array.isArray(entry.turns)) return entry.turns;
  return null;
}

function renderGroup(container, title, group, labelFn) {
  const h3 = document.createElement("h3");
  h3.textContent = title;
  container.appendChild(h3);

  const keys = Object.keys(group || {});
  if (keys.length === 0) {
    const p = document.createElement("p");
    p.textContent = "シナリオがありません。";
    container.appendChild(p);
    return;
  }

  for (const key of keys) {
    const entry = group[key];
    const list = getTurns(entry);
    const h4 = document.createElement("h4");
    h4.textContent = `${labelFn(key)}（${key}）`;
    container.appendChild(h4);

    const opening = (entry && !Array.isArray(entry) && entry.opening) ? entry.opening : null;
    if (opening) {
      const p = document.createElement("div");
      p.className = "line-them opening";
      const who = (entry.opponentName) ? entry.opponentName : "相手";
      p.textContent = `${who}（シナリオ選択と同時に流れます）: ${opening}`;
      container.appendChild(p);
    }

    if (!Array.isArray(list) || list.length === 0) {
      const p = document.createElement("p");
      p.className = "pending";
      p.textContent = "準備中";
      container.appendChild(p);
      continue;
    }

    const ol = document.createElement("ol");
    list.forEach(item => {
      const li = document.createElement("li");

      const you = document.createElement("div");
      you.className = "line-you";
      you.textContent = `自船: ${item.inputs?.[0] ?? ""}`;
      li.appendChild(you);

      if ((item.inputs || []).length > 1) {
        const alt = document.createElement("div");
        alt.className = "line-alt";
        alt.textContent = `（他に許容される表現: ${item.inputs.length - 1} 通り）`;
        li.appendChild(alt);
      }

      const them = document.createElement("div");
      them.className = "line-them";
      them.textContent = `相手: ${item.response ?? ""}`;
      li.appendChild(them);

      ol.appendChild(li);
    });
    container.appendChild(ol);
  }
}

function renderListening(container, listening) {
  const h3 = document.createElement("h3");
  h3.textContent = "リスニング訓練";
  container.appendChild(h3);

  for (const key of Object.keys(listening || {})) {
    const h4 = document.createElement("h4");
    h4.textContent = key.replace("level", "Level ");
    container.appendChild(h4);

    const ul = document.createElement("ul");
    (listening[key] || []).forEach(item => {
      const li = document.createElement("li");
      li.textContent = item.image ? `${item.sentence}（画像: ${item.image}）` : item.sentence;
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }
}

// 監視モード中は解説ページを表示しない（開発者ページで切り替え）
(function checkMonitorMode() {
  const url = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.gasUrl) ? APP_CONFIG.gasUrl : "";
  if (!url) return;
  fetch(`${url}?action=settings`, { cache: "no-store" })
    .then(r => r.json())
    .then(data => {
      if (data && data.ok && data.settings && data.settings.monitorMode) {
        const container = document.querySelector(".help-container");
        container.textContent = "";
        const p = document.createElement("p");
        p.textContent = "現在監視モード中のため、解説ページは表示できません。";
        const a = document.createElement("a");
        a.href = "index.html";
        a.textContent = "← 練習画面に戻る";
        container.appendChild(p);
        container.appendChild(a);
      }
    })
    .catch(() => { /* 設定を読めない場合は通常どおり表示 */ });
})();

fetch("scenario.json")
  .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then(data => {
    const container = document.getElementById("scenario-dump");
    container.textContent = "";
    renderGroup(container, "船舶間通信訓練", data.ship, k => keyLabel(k, SHIP_LABEL));
    renderGroup(container, "VTS通信訓練", data.vts, k => keyLabel(k, VTS_LABEL));
    renderListening(container, data.listening);
  })
  .catch(error => {
    console.error(error);
    document.getElementById("scenario-dump").textContent =
      "scenario.json を読み込めませんでした。ローカルサーバーまたは GitHub Pages 経由で開いてください。";
  });
