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
// 読み上げ用の関数
function speak(text) {
  const utterance = new SpeechSynthesisUtterance(text);

  // 利用可能な音声一覧を取得
  const voices = speechSynthesis.getVoices();

  // 例: 英語（アメリカ）の声を選択
  const selectedVoice = voices.find(voice => voice.lang === "en-US");
  if (selectedVoice) {
    utterance.voice = en-US;
  }

  utterance.rate = 1.0;  // 読み上げ速度（0.1〜10.0）
  utterance.pitch = 1.0; // 声の高さ（0〜2）
  speechSynthesis.speak(utterance);
}

document.getElementById('send-button').addEventListener('click', () => {
  const input = document.getElementById('message-input');
  const message = input.value.trim();
  if (message === "" || !currentOpponent) return;

  const chatBox = document.getElementById('chat-box');
  const studentId = localStorage.getItem("studentId");

  // JSONキーと一致させるため、ラベルは付けない
  const userMessage = message;

  // 自分のメッセージ表示
  const newMessage = document.createElement('div');
  newMessage.className = "user-message";
  newMessage.innerHTML = "<strong>" + myRole + ":</strong> " + message;
  chatBox.appendChild(newMessage);

  // シナリオ応答を取得
  const key = userMessage;
  let responseText = scenario[key];

  setTimeout(() => {
    const replyMessage = document.createElement('div');
    replyMessage.className = "reply-message";

    if (responseText) {
      // シナリオ一致 → 青字で応答
      replyMessage.innerHTML = "<strong>" + currentOpponent + ":</strong> " + responseText;
      speak(responseText); // ★読み上げ
    } else {
      // シナリオ不一致 → 赤字で "Say again."
      replyMessage.innerHTML = "<span style='color:red'><strong>" + currentOpponent + ":</strong> Say again.</span>";
      speak("Say again."); // ★読み上げ
    }

    chatBox.appendChild(replyMessage);
    sendToGoogleForm(studentId, currentOpponent, message, responseText || "Say again.");
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