let scenario = {};
let myRole = "Shiojimaru";        // 自船は常にShiojimaru
let myCallSign = "7KJH";          // 自船のコールサイン
let currentOpponent = null;       // 相手役（Umitakamaru or Tokyo Martis）
let vtsScenario = null;
let shipScenario = null;
let lastOpponentMessage = null;

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

    // active 切り替え
    document.querySelectorAll('.role-button').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');

    // 役割の設定
   if (button.id === "ship-button") {
      currentOpponent = "Umitakamaru";
      document.getElementById("ship-scenario-select").style.display = "block";
      document.getElementById("vts-scenario-select").style.display = "none";
    }
    else if (button.id === "vts-button") {
      currentOpponent = "Tokyo Martis";
      document.getElementById("ship-scenario-select").style.display = "none";
      document.getElementById("vts-scenario-select").style.display = "block";   
    }
    else if (button.id === "random-button") {
      document.getElementById("ship-scenario-select").style.display = "none";
      document.getElementById("vts-scenario-select").style.display = "none";
    }

  });
});

// ★ 配列方式：船舶シナリオの応答検索
function findShipResponse(userMessage) {
  const list = scenario.ship[shipScenario]; // crossing などの配列
  if (!Array.isArray(list)) return null;

  for (const item of list) {
    if (item.inputs.includes(userMessage)) {
      return item.response;
    }
  }
  return null;
}

// ★ 配列方式：VTS シナリオの応答検索
function findVtsResponse(userMessage) {
  const list = scenario.vts[vtsScenario];
  if (!Array.isArray(list)) return null;

  for (const item of list) {
    if (item.inputs.includes(userMessage)) {
      return item.response;
    }
  }
  return null;
}

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

document.getElementById('send-button').addEventListener('click', () => {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    if (message === "" || !currentOpponent) return;

    const chatBox = document.getElementById('chat-box');
    const studentId = localStorage.getItem("studentId");

    const userMessage = message;

    // ★★★ ここに模範解答の if 文を入れる ★★★
    if (userMessage.toLowerCase() === "what's the answer?" ||
        userMessage.toLowerCase() === "whats the answer?") {

        let modelAnswer = null;

        if (currentOpponent === "Umitakamaru" && shipScenario) {
            const list = scenario.ship[shipScenario];
            for (let i = 0; i < list.length - 1; i++) {
                if (list[i].response === lastOpponentMessage) {
                    modelAnswer = list[i + 1].inputs[0];
                    break;
                }
            }
        }

        if (currentOpponent === "Tokyo Martis" && vtsScenario) {
            const list = scenario.vts[vtsScenario];
            for (let i = 0; i < list.length - 1; i++) {
                if (list[i].response === lastOpponentMessage) {
                    modelAnswer = list[i + 1].inputs[0];
                    break;
                }
            }
        }

        const replyMessage = document.createElement('div');
        replyMessage.classList.add("reply-message", "vts");

        if (modelAnswer) {
            replyMessage.innerHTML = "<strong>Model Answer:</strong> " + modelAnswer;
        } else {
            replyMessage.innerHTML = "<strong>Model Answer:</strong> No model answer found.";
        }

        chatBox.appendChild(replyMessage);
        chatBox.scrollTop = chatBox.scrollHeight;

        input.value = "";
        return;
    }

    // ★★★ ここから通常の処理 ★★★

  // 自分のメッセージ表示
  const newMessage = document.createElement('div');
  newMessage.className = "user-message";
  newMessage.innerHTML = "<strong>" + myRole + ":</strong> " + message;
  chatBox.appendChild(newMessage);

  // シナリオ応答を取得
  const key = userMessage;
  let responseText = null;

  try {
    if (currentOpponent === "Umitakamaru" && shipScenario) {
      responseText = findShipResponse(userMessage);
    } 
    else if (currentOpponent === "Tokyo Martis" && vtsScenario) {
      responseText = findVtsResponse(userMessage);
    }
  } catch (e) {
    console.error("シナリオ取得中にエラー:", e);
  }
  

  setTimeout(() => {
  const replyMessage = document.createElement('div');
  replyMessage.classList.add("reply-message");

  if (currentOpponent === "Umitakamaru") {
    replyMessage.classList.add("umitaka");
  } else if (currentOpponent === "Tokyo Martis") {
    replyMessage.classList.add("vts");
  }

  if (responseText) {
    replyMessage.innerHTML = "<strong>" + currentOpponent + ":</strong> " + responseText;

    // ★★★ ここで相手の発話を保存する ★★★
    lastOpponentMessage = responseText;

    speak(responseText);
  } else {
    replyMessage.innerHTML = "<span style='color:red'><strong>" + currentOpponent + ":</strong> Say again.</span>";
    speak("Say again.");
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

document.querySelectorAll(".ship-scenario").forEach(btn => {
  btn.addEventListener("click", () => {

    // すべての船舶サブボタンから active を外す
    document.querySelectorAll(".ship-scenario").forEach(b => b.classList.remove("active"));

    // 今押したボタンに active を付ける
    btn.classList.add("active");

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

// VTS サブ選択ボタンの処理
document.querySelectorAll(".vts-scenario").forEach(btn => {
  btn.addEventListener("click", () => {

    // すべての VTS サブボタンから active を外す
    document.querySelectorAll(".vts-scenario").forEach(b => b.classList.remove("active"));

    // 今押したボタンに active を付ける
    btn.classList.add("active");

    const type = btn.dataset.type;   // report / notice / ask
    const num = btn.dataset.num;     // 1〜5

    vtsScenario = `${type}${num}`;
    console.log("選択されたVTSシナリオ:", vtsScenario);

    // 画像表示（例：report1.png）
    const img = document.getElementById("scenario-image");
    if (img) {
      img.src = `images/${vtsScenario}.png`;
    }
  });
});