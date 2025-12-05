let scenario = {};
let currentRole = null;

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
  const userMessage = (currentRole ? currentRole + ": " : "") + message;

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