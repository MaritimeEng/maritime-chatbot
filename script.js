let scenario = {};
let currentRole = null;

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

// 船舶・VTSボタンのクリック処理
document.querySelectorAll('.role-button').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.role-button').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    currentRole = button.textContent;
  });
});

// 送信ボタンのクリック処理
document.getElementById('send-button').addEventListener('click', () => {
  const input = document.getElementById('message-input');
  const message = input.value.trim();
  if (message === "") return;

  const chatBox = document.getElementById('chat-box');
  const studentId = localStorage.getItem("studentId"); // localStorageから取得
  const scenarioName = currentRole; // 船舶 or VTS
  const userMessage = (scenarioName ? scenarioName + ": " : "") + message;

  // ユーザーのメッセージを表示
  const newMessage = document.createElement('div');
  newMessage.textContent = userMessage;
  chatBox.appendChild(newMessage);

  // シナリオに応じた応答を表示
  const reply = scenario[userMessage];
  let responseText = "";
  if (reply) {
    responseText = reply;
    const replyMessage = document.createElement('div');
    replyMessage.textContent = reply;
    chatBox.appendChild(replyMessage);
  } else {
    responseText = "応答例: " + message; // 仮の応答
    const replyMessage = document.createElement('div');
    replyMessage.textContent = responseText;
    chatBox.appendChild(replyMessage);
  }

  // Googleフォーム送信
  sendToGoogleForm(studentId, scenarioName, message, responseText);

  // 入力欄をクリア
  input.value = "";
  chatBox.scrollTop = chatBox.scrollHeight;
});

// Googleフォーム送信関数
function sendToGoogleForm(studentId, scenarioName, userInput, response) {
  const formUrl = "https://docs.google.com/forms/d/e/1FAIpQLSd-VVaYg6OGow30tJb_w9Uzit4v_DDF7_FLIbIASbT_52d2nA/formResponse";

  const formData = new FormData();
  formData.append("entry.504566204", studentId);      // 学籍番号
  formData.append("entry.715153589", scenarioName);   // シナリオ名
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

  // ユーザーのメッセージを表示
  const newMessage = document.createElement('div');
  newMessage.textContent = userMessage;
  chatBox.appendChild(newMessage);

  // シナリオに応じた応答を表示
  const reply = scenario[userMessage];
  if (reply) {
    const replyMessage = document.createElement('div');
    replyMessage.textContent = reply;
    chatBox.appendChild(replyMessage);
  }

  // 入力欄をクリア
  input.value = "";
  chatBox.scrollTop = chatBox.scrollHeight;
});