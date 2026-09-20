// help.html の「シナリオ全文」を scenario.json から自動生成する
// （シナリオを追加しても、この解説ページを手で書き換える必要はありません）

const SHIP_LABEL = { meeting: "行き会い", crossing: "横切り", overtaking: "追い越し", other: "その他" };
const VTS_LABEL = { report: "通報", notice: "報告", ask: "問いかけ" };

function vtsLabel(key) {
  const m = key.match(/^([a-z]+)(\d+)$/);
  return m && VTS_LABEL[m[1]] ? `${VTS_LABEL[m[1]]}${m[2]}` : key;
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
    const list = group[key];
    const h4 = document.createElement("h4");
    h4.textContent = `${labelFn(key)}（${key}）`;
    container.appendChild(h4);

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

fetch("scenario.json")
  .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then(data => {
    const container = document.getElementById("scenario-dump");
    container.textContent = "";
    renderGroup(container, "船舶間通信訓練", data.ship, k => SHIP_LABEL[k] || k);
    renderGroup(container, "VTS通信訓練", data.vts, vtsLabel);
    renderListening(container, data.listening);
  })
  .catch(error => {
    console.error(error);
    document.getElementById("scenario-dump").textContent =
      "scenario.json を読み込めませんでした。ローカルサーバーまたは GitHub Pages 経由で開いてください。";
  });
