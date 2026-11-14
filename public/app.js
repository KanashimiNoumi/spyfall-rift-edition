
const socket = io();
const $ = id => document.getElementById(id);
let room = null, myRole = null, hasVoted = false, latestResult = null, spyGuessDone = false;

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
function categoryName(key) {
  return ({champions:"ЧЕМПИОН LEAGUE OF LEGENDS",regions:"РЕГИОН РУНТЕРРЫ",items:"ПРЕДМЕТ LEAGUE OF LEGENDS",abilities:"СПОСОБНОСТЬ ЧЕМПИОНА"})[key] || "LEAGUE OF LEGENDS";
}
function renderRoom() {
  if (!room) return;
  $("roomCodeTitle").textContent = room.code;
  $("inviteCode").textContent = room.code;
  $("gameRoomCode").textContent = room.code;
  $("playerCount").textContent = `${room.players.length}/10`;
  $("playersList").innerHTML = room.players.map(p => `
    <div class="player-row"><div class="player-avatar">${escapeHtml(p.name.slice(0,1).toUpperCase())}</div>
      <div class="player-name">${escapeHtml(p.name)}</div>${p.isHost?'<span class="player-badge">ВЕДУЩИЙ</span>':''}</div>`).join("");
  const isHost = room.hostId === socket.id;
  $("categorySelect").disabled = !isHost;
  $("spiesSelect").disabled = !isHost;
  $("startBtn").classList.toggle("hidden", !isHost);
  $("startBtn").disabled = room.players.length < 3;
  $("categorySelect").value = room.settings.category;
  $("spiesSelect").value = String(room.settings.spies);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
async function createRoom() {
  const name = prompt("Как тебя зовут в игре?");
  if (!name) return;
  const res = await ackEmit("room:create", {name, settings:{category:"champions",spies:1}});
  if (!res.ok) return toast(res.error);
  room = res.room; show("roomView"); renderRoom();
}
$("createBtn").onclick = createRoom;
$("showJoinBtn").onclick = () => $("joinPanel").classList.remove("hidden");
$("closeJoin").onclick = () => $("joinPanel").classList.add("hidden");
$("joinBtn").onclick = async () => {
  setError("joinError");
  const res = await ackEmit("room:join", {name:$("joinName").value,code:$("joinCode").value});
  if (!res.ok) return setError("joinError",res.error);
  room = res.room; $("joinPanel").classList.add("hidden"); show("roomView"); renderRoom();
};
$("joinCode").addEventListener("input", e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,5));
$("categorySelect").onchange = () => updateSettings();
$("spiesSelect").onchange = () => updateSettings();
async function updateSettings() {
  // Settings are changed by the host and synchronized through a dedicated server event.
  const res = await ackEmit("room:settings", {category:$("categorySelect").value,spies:Number($("spiesSelect").value)});
  if (!res.ok) toast(res.error);
}
$("startBtn").onclick = async () => {
  setError("roomError");
  const res = await ackEmit("game:start");
  if (!res.ok) setError("roomError",res.error);
};
$("copyCodeBtn").onclick = async () => {
  try { await navigator.clipboard.writeText(room.code); toast("Код комнаты скопирован."); }
  catch { toast(`Код комнаты: ${room.code}`); }
};
$("leaveBtn").onclick = async () => {
  socket.emit("room:leave"); room=null; myRole=null; show("homeView");
};
$("brandHome").onclick = e => { if(room) { e.preventDefault(); toast("Сначала покинь текущую комнату."); } };

socket.on("room:update", data => {
  if (!room || room.code === data.code) { room = data; renderRoom(); }
  if (data.phase === "lobby" && $("resultView").classList.contains("hidden") === false) show("roomView");
  if (data.phase === "playing" && myRole) renderGame();
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
  $("secretCategory").textContent = categoryName(data.category);
  renderGame(); show("gameView");
});
function renderGame() {
  if (!room) return;
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
  $("resultText").textContent = result.tie ? "Игроки разделили голоса. Никто не был выбран." :
    result.caught ? `${result.votedOutName} оказался шпионом. Хорошая работа, призыватели.` :
    `${result.votedOutName || "Никто"} был выбран, но шпион остался среди вас.`;
  $("resultTarget").textContent = result.target;
  $("resultSpies").textContent = result.spyNames.join(", ");
  $("spyGuessBox").classList.toggle("hidden", myRole?.role !== "spy");
  $("guessOutcome").classList.add("hidden");
  $("spyGuessInput").value = "";
  $("guessFeedback").textContent = "";
  $("nextRoundBtn").classList.toggle("hidden", room?.hostId !== socket.id);
  show("resultView");
});
$("spyGuessBtn").onclick = async () => {
  const res = await ackEmit("game:guess",{guess:$("spyGuessInput").value});
  if (!res.ok) return $("guessFeedback").textContent=res.error;
  spyGuessDone=true;
  $("guessFeedback").textContent = res.correct ? "Верно! Ты вычислил секрет." : "Не угадал. Секрет раскрыт.";
};
socket.on("game:spyGuess", data => {
  $("guessOutcome").classList.remove("hidden");
  $("guessOutcome").textContent = data.correct ? `${data.player} угадал секрет: ${data.target}.` : `${data.player} не смог угадать секрет. Это был: ${data.target}.`;
});
$("nextRoundBtn").onclick = async () => {
  const res = await ackEmit("game:next");
  if (!res.ok) toast(res.error);
};
socket.on("game:notice", message => toast(message));
socket.on("disconnect", () => toast("Соединение потеряно. Пытаемся переподключиться…"));
socket.on("connect", () => { if (room) toast("Соединение восстановлено. Если комната пропала, создай новую."); });
