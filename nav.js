// =====================================================
//  全ページ共通のナビゲーションと目次
//
//  ・各ページの <body data-page="..."> を見て、現在地を判定します
//  ・#site-nav にナビゲーションを描画します
//  ・監視モード中は、指定したページを閲覧できないようにします
//  ・[data-toc] を付けた要素に、h2 見出しから目次を作ります
// =====================================================

const NAV_PAGES = [
  { id: "train",       href: "index.html",       label: "訓練画面",     hideInMonitor: false },
  { id: "guide",       href: "guide.html",       label: "使い方",       hideInMonitor: false },
  { id: "explanation", href: "explanation.html", label: "解説",         hideInMonitor: true  },
  { id: "scenarios",   href: "scenarios.html",   label: "シナリオ一覧", hideInMonitor: true  }
];

function currentPageId() {
  return document.body.dataset.page || "";
}

function buildNav() {
  const host = document.getElementById("site-nav");
  if (!host) return;
  host.textContent = "";

  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.setAttribute("aria-label", "ページ移動");

  NAV_PAGES.forEach(page => {
    const current = page.id === currentPageId();
    const item = document.createElement(current ? "span" : "a");
    item.className = "nav-item" + (current ? " current" : "");
    item.dataset.nav = page.id;
    if (page.hideInMonitor) item.classList.add("nav-hide-in-monitor");
    if (!current) item.href = page.href;
    if (current) item.setAttribute("aria-current", "page");
    item.textContent = page.label;
    nav.appendChild(item);
  });

  host.appendChild(nav);
}

// h2 見出しから目次を作る（[data-toc] を付けた要素に描画）
function buildToc() {
  const host = document.querySelector("[data-toc]");
  if (!host) return;

  const headings = [...document.querySelectorAll(".page-content h2[id]")];
  if (headings.length === 0) return;

  host.textContent = "";
  const title = document.createElement("div");
  title.className = "toc-title";
  title.textContent = "目次";
  host.appendChild(title);

  const ul = document.createElement("ul");
  ul.className = "toc-list";
  headings.forEach(h => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "#" + h.id;
    a.textContent = h.textContent;
    li.appendChild(a);
    ul.appendChild(li);
  });
  host.appendChild(ul);
}

// 監視モード中の表示制御
function applyMonitorMode(monitorMode) {
  document.body.classList.toggle("monitor-mode", monitorMode);

  // 閲覧できないページへのリンクを隠す
  document.querySelectorAll(".nav-hide-in-monitor").forEach(el => {
    el.style.display = monitorMode ? "none" : "";
  });

  if (!monitorMode) return;

  const page = NAV_PAGES.find(p => p.id === currentPageId());
  if (!page || !page.hideInMonitor) return;

  // このページ自体が閲覧不可の場合は、内容を置き換える
  const content = document.querySelector(".page-content");
  if (!content) return;
  content.textContent = "";

  const p = document.createElement("p");
  p.className = "notice";
  p.textContent = "現在監視モード中のため、このページは表示できません。";
  const a = document.createElement("a");
  a.href = "index.html";
  a.textContent = "← 訓練画面に戻る";
  content.appendChild(p);
  content.appendChild(a);
}

// 監視モードの判定結果を他のスクリプト（scenarios.js など）にも伝える。
// 値は「このページが監視モードで閲覧不可かどうか」。
let resolveMonitor;
window.MONITOR_READY = new Promise(resolve => { resolveMonitor = resolve; });

function finishMonitorCheck(monitorMode) {
  const page = NAV_PAGES.find(p => p.id === currentPageId());
  resolveMonitor(Boolean(monitorMode && page && page.hideInMonitor));
}

function loadMonitorSetting() {
  const url = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.gasUrl) ? APP_CONFIG.gasUrl : "";
  if (!url) { finishMonitorCheck(false); return; }

  fetch(`${url}?action=settings`, { cache: "no-store" })
    .then(r => r.json())
    .then(data => {
      const monitorMode = !!(data && data.ok && data.settings && data.settings.monitorMode);
      applyMonitorMode(monitorMode);
      finishMonitorCheck(monitorMode);
    })
    .catch(() => { finishMonitorCheck(false); });   // 設定を読めない場合は通常表示
}

function initNav() {
  buildNav();
  buildToc();
  loadMonitorSetting();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNav);
} else {
  initNav();
}
