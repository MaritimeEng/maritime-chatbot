let scenario = {};
let myRole = "Shiojimaru";        // 自船は常にShiojimaru
let myCallSign = "7KJH";          // 自船のコールサイン
let currentOpponent = null;       // 相手役（Umitakamaru or Tokyo Martis）

// ページ読み込み時にlocalStorageから学籍番号を復元
window.addEventListener("load", () => {
  const savedId = localStorage.getItem("studentId");
  if (savedId) {
    document.getElementById("student-id").value = savedId;
  }
});

// 学籍番号入力欄が変更されたら保存
document.getElementById("student-id").addEventListener("change", () => {
  const studentId = document.getElementById("student-id").value;
  localStorage.setItem("studentId", studentId);
});

// JSONファイルを読み込む
fetch("scenario.json")
  .then(response => response.json())
  .then(data => {
    scenario = data;
    console.log("シナリオを読み込みました:", scenario);
  })
  .catch(error => {
    console.error("シナリオの読み込みに失敗しました:", error);
  });

// 相手役ボタンのクリック処理
document.querySelectorAll('.role-button').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.role-button').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    currentOpponent = button.textContent === "船舶" ? "Umitakamaru" : "Tokyo Martis";
  });
});

// 送信ボタンのクリック処理
document.getElementById('send-button').addEventListener('click', () => {
  const input = document.getElementById('message-input');
  const message = input.value.trim();
  if (message === "" || !currentOpponent) return;

  const chatBox = document.getElementById('chat-box');
  const studentId = localStorage.getItem("studentId");
  const userMessage = myRole + ": " + message;

  // 自分のメッセージを表示（黒文字＋太字）
  const newMessage = document.createElement('div');
  newMessage.className = "user-message";
  newMessage.innerHTML = "<strong>" + myRole + ":</strong> " + message;
  chatBox.appendChild(newMessage);          

  // シナリオに応じた相手の応答を準備
  const key = userMessage;
  let responseText = scenario[key] || (currentOpponent + ": 応答例 " + message);

  // 3秒後に相手の応答を表示（青文字＋太字）
  setTimeout(() => {
    const replyMessage = document.createElement('div');
    replyMessage.className = "reply-message";
    replyMessage.innerHTML = "<strong>" + currentOpponent + ":</strong> " + responseText;
    chatBox.appendChild(replyMessage);

    sendToGoogleForm(studentId, currentOpponent, message, responseText);
    chatBox.scrollTop = chatBox.scrollHeight;
  }, 3000);

  // 入力欄をクリア
  input.value = "";
});

// Googleフォーム送信関数
function sendToGoogleForm(studentId, scenarioName, userInput, response) {
  const formUrl = "https://docs.google.com/forms/d/e/1FAIpQLSd-VVaYg6OGow30tJb_w9Uzit4v_DDF7_FLIbIASbT_52d2nA/formResponse";

  const formData = new FormData();
  formData.append("entry.504566204", studentId);      // 学籍番号
  formData.append("entry.715153589", scenarioName);   // 相手役
  formData.append("entry.633984331", userInput);      // ユーザー入力
  formData.append("entry.502434052", response);       // 応答

  fetch(formUrl, {
    method: "POST",
    body: formData,
    mode: "no-cors"
  }).then(() => {
    console.log("送信完了");
  }).catch(error => {
    console.error("送信エラー:", error);
  });
}