
const socket = io();
const $ = id => document.getElementById(id);
let room = null, myRole = null, hasVoted = false, latestResult = null, spyGuessDone = false;
const sessionToken = sessionStorage.getItem("spyfallSession") || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
sessionStorage.setItem("spyfallSession", sessionToken);
let resumeAttempted = false;

function show(view) {
  ["homeView","roomView","gameView","resultView"].forEach(id => $(id).classList.toggle("hidden", id !== view));
}
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
}
function setError(id, message="") { $(id).textContent = message; }
function ackEmit(event, payload={}) {
  return new Promise(resolve => socket.emit(event, payload, result => resolve(result || {ok:false,error:"Нет ответа сервера."})));
}
function setTargetImage(id, url, name) {
  const image = $(id);
  if (!url) { image.removeAttribute("src"); image.hidden = true; return; }
  image.src = url;
  image.alt = name || "";
  image.hidden = false;
  image.onerror = () => { image.hidden = true; };
}
function categoryName(key) {
  return ({champions:"ЧЕМПИОН LEAGUE OF LEGENDS",items:"ПРЕДМЕТ LEAGUE OF LEGENDS"})[key] || "LEAGUE OF LEGENDS";
}
function renderRoom() {
  if (!room) return;
  $("inviteCode").textContent = room.code;
  $("gameRoomCode").textContent = room.code;
  $("playerCount").textContent = `${room.players.length}/10`;
  $("pauseOverlay").classList.toggle("hidden", !room.paused);
  $("endEarlyBtn").classList.toggle("hidden", !room.paused || room.hostId !== socket.id);
  $("pauseTimer").textContent = room.paused && room.pauseDeadline
    ? `Вернуться можно до ${new Date(room.pauseDeadline).toLocaleTimeString("ru-RU", {hour:"2-digit",minute:"2-digit"})}.`
    : "";
  $("playersList").innerHTML = room.players.map(p => `
    <div class="player-row ${p.connected === false ? "player-disconnected" : ""}"><div class="player-avatar">${escapeHtml(p.name.slice(0,1).toUpperCase())}</div>
      <div class="player-name">${escapeHtml(p.name)}</div>${p.isHost?'<span class="player-badge">ВЕДУЩИЙ</span>':''}${p.connected === false?'<span class="player-offline">НЕ В СЕТИ</span>':''}</div>`).join("");
  const isHost = room.hostId === socket.id;
  $("categorySelect").disabled = !isHost;
  $("spiesSelect").disabled = !isHost;
  $("roundsSelect").disabled = !isHost;
  $("startBtn").classList.toggle("hidden", !isHost);
  $("startBtn").disabled = room.players.length < 3;
  $("categorySelect").value = room.settings.category;
  $("spiesSelect").value = String(room.settings.spies);
  $("roundsSelect").value = String(room.settings.rounds || 4);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
const PLAYER_NAME_KEY = "spyfallPlayerName";
const playerNameInput = $("playerName");
playerNameInput.value = localStorage.getItem(PLAYER_NAME_KEY) || "";
playerNameInput.addEventListener("input", () => localStorage.setItem(PLAYER_NAME_KEY, playerNameInput.value.trim()));

async function createRoom() {
  const name = playerNameInput.value.trim();
  if (!name) return toast("Сначала введи своё имя.");
  localStorage.setItem(PLAYER_NAME_KEY, name);
  const res = await ackEmit("room:create", {name, sessionToken, settings:{category:"champions",spies:1,rounds:4}});
  if (!res.ok) return toast(res.error);
  room = res.room; setPrivacyHidden(true); show("roomView"); renderRoom();
}
$("createBtn").onclick = createRoom;
$("showJoinBtn").onclick = () => $("joinPanel").classList.remove("hidden");
$("closeJoin").onclick = () => $("joinPanel").classList.add("hidden");
$("joinBtn").onclick = async () => {
  setError("joinError");
  const name = playerNameInput.value.trim();
  if (!name) return setError("joinError","Сначала введи своё имя на главном экране.");
  localStorage.setItem(PLAYER_NAME_KEY, name);
  const res = await ackEmit("room:join", {name,code:$("joinCode").value,sessionToken});
  if (!res.ok) return setError("joinError",res.error);
  room = res.room; setPrivacyHidden(true); $("joinPanel").classList.add("hidden"); show("roomView"); renderRoom();
};
$("joinCode").addEventListener("input", e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,5));
const inviteRoomCode = new URLSearchParams(window.location.search).get("room");
if (inviteRoomCode) {
  $("joinCode").value = inviteRoomCode.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,5);
  $("joinPanel").classList.remove("hidden");
}
$("categorySelect").onchange = () => updateSettings();
$("spiesSelect").onchange = () => updateSettings();
$("roundsSelect").onchange = () => updateSettings();
async function updateSettings() {
  // Settings are changed by the host and synchronized through a dedicated server event.
  const res = await ackEmit("room:settings", {category:$("categorySelect").value,spies:Number($("spiesSelect").value),rounds:Number($("roundsSelect").value)});
  if (!res.ok) toast(res.error);
}
$("passTurnBtn").onclick = async () => {
  const res = await ackEmit("game:passTurn");
  if (!res.ok) toast(res.error);
};

$("startBtn").onclick = async () => {
  setError("roomError");
  const res = await ackEmit("game:start");
  if (!res.ok) setError("roomError",res.error);
};
$("copyCodeBtn").onclick = async () => {
  if (!room) return;
  try { await navigator.clipboard.writeText(room.code); toast("Код комнаты скопирован."); }
  catch { toast(`Код комнаты: ${room.code}`); }
};
$("copyLinkBtn").onclick = async () => {
  if (!room) return;
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(room.code)}`;
  try { await navigator.clipboard.writeText(inviteUrl); toast("Ссылка-приглашение скопирована."); }
  catch { toast(`Ссылка: ${inviteUrl}`); }
};
let privacyHidden = true;
function setPrivacyHidden(hidden) {
  privacyHidden = hidden;
  document.body.classList.toggle("privacy-mode", privacyHidden);
  $("privacyIcon").textContent = privacyHidden ? "◌" : "◉";
  $("privacyToggle").setAttribute("aria-label", privacyHidden ? "Показать код" : "Скрыть код");
  $("privacyToggle").title = privacyHidden ? "Показать код" : "Скрыть код";
}
setPrivacyHidden(true);
$("privacyToggle").onclick = () => setPrivacyHidden(!privacyHidden);
async function leaveRoom() {
  if (!room) { show("homeView"); return; }
  const res = await ackEmit("room:leave");
  if (!res.ok) return toast(res.error || "Не удалось покинуть комнату.");
  room = null;
  sessionStorage.removeItem("spyfallSession");
  myRole = null;
  hasVoted = false;
  latestResult = null;
  spyGuessDone = false;
  show("homeView");
  toast("Ты покинул комнату.");
}
["leaveBtn", "leaveGameBtn", "leaveResultBtn"].forEach(id => {
  const button = $(id);
  if (button) button.onclick = leaveRoom;
});
$("brandHome").onclick = e => { if(room) { e.preventDefault(); toast("Сначала покинь текущую комнату."); } };

socket.on("room:update", data => {
  if (!room || room.code === data.code) { room = data; renderRoom(); }
  if (data.phase === "lobby" && $("resultView").classList.contains("hidden") === false) show("roomView");
  if ((data.phase === "playing" || data.phase === "voting") && myRole) renderGame();
});
socket.on("game:role", data => {
  myRole = data; hasVoted=false; latestResult=null; spyGuessDone=false;
  $("roundNumber").textContent = String(data.round).padStart(2,"0");
  $("roleKicker").textContent = data.role === "spy" ? "СЕКРЕТНАЯ РОЛЬ" : "ТВОЯ РОЛЬ";
  $("roleTitle").innerHTML = data.role === "spy" ? "Ты — <em>шпион</em>" : "Ты — <em>не шпион</em>";
  $("roleDescription").textContent = data.role === "spy" ? "Твоя задача — вычислить секрет и не выдать себя." : "Твоя задача — вычислить шпиона, не раскрыв секрет.";
  $("secretWrap").classList.toggle("hidden", data.role === "spy");
  $("spyHint").classList.toggle("hidden", data.role !== "spy");
  $("secretName").textContent = data.target || "";
  setTargetImage("secretImage", data.targetImage, data.target);
  $("secretCategory").textContent = categoryName(data.category);
  renderGame(); show("gameView");
});
function renderGame() {
  if (!room) return;
  const votingStarted = room.phase === "voting";
  $("votePanel").classList.toggle("hidden", !votingStarted);
  $("turnPanel").classList.toggle("hidden", votingStarted);
  $("completedRounds").textContent = String(room.completedRounds || 0);
  $("totalRounds").textContent = String(room.settings.rounds || 4);
  const isMyTurn = room.currentTurnPlayerId === socket.id && !votingStarted;
  $("passTurnBtn").classList.toggle("hidden", !isMyTurn);
  $("passTurnBtn").disabled = !isMyTurn;
  const currentPlayer = room.players.find(p => p.id === room.currentTurnPlayerId);
  $("turnStatus").textContent = votingStarted ? "Все круги завершены. Голосуйте!" :
    isMyTurn ? "Сейчас твой ход." : `Ход игрока: ${currentPlayer?.name || "—"}`;
  $("voteProgress").textContent = `${room.votes || 0} / ${room.players.length} голосов`;
  $("voteList").innerHTML = room.players.filter(p => p.id !== socket.id).map(p => `
    <button class="vote-btn ${room.voted?.includes(socket.id) ? "selected" : ""}" data-id="${p.id}" ${hasVoted || room.voted?.includes(socket.id) ? "disabled":""}>
      <span class="player-avatar">${escapeHtml(p.name.slice(0,1).toUpperCase())}</span><span>${escapeHtml(p.name)}</span>
      ${room.voted?.includes(p.id)?'<span class="vote-mark">ГОЛОС</span>':''}
    </button>`).join("");
  document.querySelectorAll(".vote-btn").forEach(btn => btn.onclick = async () => {
    if (hasVoted) return;
    const res = await ackEmit("game:vote",{targetId:btn.dataset.id});
    if (res.ok) { hasVoted=true; toast("Твой голос принят."); }
    else toast(res.error);
  });
}
socket.on("game:result", result => {
  latestResult=result; hasVoted=false;
  $("resultSymbol").textContent = result.caught ? "✦" : "☽";
  $("resultTitle").textContent = result.tie ? "Ничья голосов" : result.caught ? "Шпион раскрыт!" : "Шпион избежал разоблачения";
  $("resultText").textContent = result.tie ? "Игроки не смогли решиться. Никто не был выбран." :
    result.caught ? `${result.votedOutName} оказался шпионом. Хорошая работа, призыватели.` :
    `${result.votedOutName || "Никто"} был выбран, но шпион остался среди вас.`;
  $("resultTarget").textContent = result.target || "";
  setTargetImage("resultImage", result.targetImage, result.target);
  $("resultSecret").classList.toggle("hidden", result.tie || myRole?.role === "spy");
  $("resultSpies").textContent = result.tie ? "" : result.spyNames.join(", ");
  $("resultSpiesPanel").classList.toggle("hidden", result.tie);
  $("spyGuessBox").classList.toggle("hidden", result.tie || myRole?.role !== "spy");
  $("revoteBtn").classList.toggle("hidden", !result.tie || room?.hostId !== socket.id);
  $("nextRoundBtn").classList.toggle("hidden", result.tie || room?.hostId !== socket.id);
  $("guessOutcome").classList.add("hidden");
  $("spyGuessInput").value = "";
  $("guessFeedback").textContent = "";
  show("resultView");
});
$("spyGuessBtn").onclick = async () => {
  const res = await ackEmit("game:guess",{guess:$("spyGuessInput").value});
  if (!res.ok) return $("guessFeedback").textContent=res.error;
  spyGuessDone=true;
  $("spyGuessBox").classList.add("hidden");
  $("guessFeedback").textContent = res.correct ? "Верно! Ты вычислил секрет." : "Не угадал. Секрет раскрыт.";
};
socket.on("game:spyGuess", data => {
  $("resultSecret").classList.remove("hidden");
  $("resultTarget").textContent = data.correct ? "Шпиону удалось угадать секрет!" : data.target;
  setTargetImage("resultImage", data.targetImage, data.target);
  $("spyGuessBox").classList.add("hidden");
  $("guessOutcome").classList.remove("hidden");
  $("guessOutcome").textContent = data.correct ? `${data.player} угадал секрет: ${data.target}.` : `${data.player} не смог угадать секрет. Это был: ${data.target}.`;
});
$("revoteBtn").onclick = async () => {
  const res = await ackEmit("game:revote");
  if (!res.ok) return toast(res.error);
};
socket.on("game:revote", () => {
  hasVoted = false;
  latestResult = null;
  show("gameView");
  renderGame();
});
$("nextRoundBtn").onclick = async () => {
  const res = await ackEmit("game:next");
  if (!res.ok) toast(res.error);
};
socket.on("game:paused", data => {
  $("pauseMessage").textContent = data.message || "Один или несколько игроков покинули матч.";
  $("pauseOverlay").classList.remove("hidden");
  $("endEarlyBtn").classList.toggle("hidden", room?.hostId !== socket.id);
});
socket.on("game:resumed", message => {
  $("pauseOverlay").classList.add("hidden");
  toast(message || "Игра продолжается.");
});
socket.on("game:ended", message => {
  $("pauseOverlay").classList.add("hidden");
  myRole = null; hasVoted = false; latestResult = null; spyGuessDone = false;
  show("roomView");
  toast(message || "Матч завершён. Все игроки в лобби.");
});
$("endEarlyBtn").onclick = async () => {
  const res = await ackEmit("game:endEarly");
  if (!res.ok) toast(res.error);
};
socket.on("game:notice", message => toast(message));
socket.on("disconnect", () => { resumeAttempted = false; toast("Соединение потеряно. Пытаемся переподключиться…"); });
socket.on("connect", async () => {
  if (resumeAttempted) return;
  resumeAttempted = true;
  const res = await ackEmit("room:resume", { sessionToken });
  if (res.ok) { room = res.room; setPrivacyHidden(true); renderRoom(); if (room.phase === "lobby") show("roomView"); }
});
