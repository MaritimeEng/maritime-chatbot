let scenario = {};
let myRole = "Shiojimaru";        // 自船は常にShiojimaru
let myCallSign = "7KJH";          // 自船のコールサイン
let currentOpponent = null;       // 相手役（Umitakamaru or Tokyo Martis）

// ページ読み込み時にlocalStorageから学籍番号を復元
window.addEventListener("DOMContentLoaded", () => {
  // ★ 学籍番号の復元
  const savedId = localStorage.getItem("studentId");
  if (savedId) {
    document.getElementById("student-id").value = savedId;
  }

  // ★ メッセージ入力欄の自動リサイズ
  const messageInput = document.getElementById("message-input");
  messageInput.addEventListener("input", () => {
    messageInput.style.height = "auto";
    messageInput.style.height = messageInput.scrollHeight + "px";
  });
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

// ★ 音声リストが読み込まれたら再取得
speechSynthesis.onvoiceschanged = () => {
  speechSynthesis.getVoices();
  console.log("Voices loaded:", speechSynthesis.getVoices());
};

// 相手役ボタンのクリック処理
document.querySelectorAll('.role-button').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.role-button').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    currentOpponent = button.textContent === "船舶" ? "Umitakamaru" : "Tokyo Martis";
  });
});

// ★ グローバル変数と関数をここにまとめる
// ★ グローバル変数（最初は音声なし）
let currentVoiceName = null;

// ★ 訛り切り替え関数
function setVoice(voiceName) {
  currentVoiceName = voiceName;
  console.log("Voice set to:", voiceName);
}

// ★ 訛りボタンの active 切り替え
document.querySelectorAll('#voice-buttons button').forEach(button => {
  button.addEventListener('click', () => {

    // active を全て外す
    document.querySelectorAll('#voice-buttons button').forEach(btn => btn.classList.remove('active'));

    // 押したボタンに active を付ける
    button.classList.add('active');

    // onclick の voiceName を取得して setVoice に渡す
    const voiceName = button.getAttribute('onclick').match(/'(.*)'/)[1];
    setVoice(voiceName);
  });
});

// ★ 読み上げ関数
function speak(text) {

  // 声が選択されていない場合は読み上げしない
  if (!currentVoiceName) {
    console.log("No voice selected. Skipping speech.");
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  let voices = speechSynthesis.getVoices();

  const selectedVoice = voices.find(voice => voice.name === currentVoiceName);

  if (!selectedVoice) {
    console.warn("Selected voice not found:", currentVoiceName);
    return;
  }

  utterance.voice = selectedVoice;
  utterance.lang = selectedVoice.lang; // ★ これが重要（日本語読み防止）

  utterance.rate = 1.3;
  utterance.pitch = 1.0;

  speechSynthesis.speak(utterance);
}

// 送信ボタンのクリック処理
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
      replyMessage.innerHTML = "<strong>" + currentOpponent + ":</strong> " + responseText;
      speak(responseText); // ★読み上げ
    } else {
      replyMessage.innerHTML = "<span style='color:red'><strong>" + currentOpponent + ":</strong> Say again.</span>";
      speak("Say again."); // ★読み上げ
    }

    chatBox.appendChild(replyMessage);
    sendToGoogleForm(studentId, currentOpponent, message, responseText || "Say again.");
    chatBox.scrollTop = chatBox.scrollHeight;
  }, 3000);

  input.value = "";
});

const messageInput = document.getElementById("message-input");

messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";          // 一度リセット
  messageInput.style.height = messageInput.scrollHeight + "px"; // 内容に合わせて伸ばす
});


let shipScenario = null;   // 船舶のシチュエーション（行き会い・横切りなど）
document.getElementById("ship-button").addEventListener("click", () => {
  document.getElementById("ship-scenario-select").style.display = "block";
});

document.getElementById("vts-button").addEventListener("click", () => {
  document.getElementById("ship-scenario-select").style.display = "none";
  shipScenario = null;
});

document.getElementById("random-button").addEventListener("click", () => {
  document.getElementById("ship-scenario-select").style.display = "none";
  shipScenario = null;
});

document.querySelectorAll(".ship-scenario").forEach(btn => {
  btn.addEventListener("click", () => {
    shipScenario = btn.dataset.scenario;
    console.log("選択されたシチュエーション:", shipScenario);
  });
});

document.getElementById("random-button").addEventListener("click", () => {
  const roles = ["Umitakamaru", "Tokyo Martis"];
  currentOpponent = roles[Math.floor(Math.random() * roles.length)];

  if (currentOpponent === "Umitakamaru") {
    const scenarios = ["meeting", "crossing", "overtaking", "other"];
    shipScenario = scenarios[Math.floor(Math.random() * scenarios.length)];
  }

  console.log("ランダム選択:", currentOpponent, shipScenario);
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