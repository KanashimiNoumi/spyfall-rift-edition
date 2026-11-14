const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const rooms = new Map();
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const fallbackChampions = [
  "Аатрокс","Акали","Акшан","Алистар","Амбесса","Амуму","Анивия","Анни","Афелий",
  "Ари","Аурелион Сол","Аурора","Азир","Бард","Бел'Вет","Блицкранк","Брайер","Брэнд",
  "Браум","Кейтлин","Камилла","Кассиопея","Чо'Гат","Корки","Дарий","Диана","Дрейвен",
  "Экко","Элиза","Эвелинн","Эзреаль","Фиддлстикс","Фиора","Физз","Галио","Гангпланк",
  "Гарен","Гнар","Грагас","Грейвз","Гвен","Хаймердингер","Иллаой","Ирелия","Иверн",
  "Джanna","Джарван IV","Джакс","Джин","Джинкс","Ка'Зикс","Калиста","Карма","Картус",
  "Кассадин","Катарина","Кейл","Кейн","Кеннен","Киндред","Клед","Ког'Мао","ЛеБлан",
  "Ли Син","Леона","Лилия","Лиссандра","Люциан","Лулу","Люкс","Мальфит","Мальзахар",
  "Маокай","Мастер Йи","Милио","Мисс Фортуна","Мордекайзер","Моргана","Наафири","Нами",
  "Насус","Наутилус","Нееко","Нидали","Нила","Ноктюрн","Нуну и Виллумп","Олаф","Орианна",
  "Орнн","Пантеон","Поппи","Пайк","Киана","Квинн","Рэйкан","Рамбл","Рек'Сай","Релл",
  "Рената Гласк","Ренектон","Ренгар","Ривен","Рамбл","Рукан","Райз","Самира","Седжуани",
  "Сенна","Серафина","Сетт","Шако","Шен","Шивана","Синджед","Сион","Сивир","Скарнер",
  "Сона","Сорака","Свейн","Сайлас","Синдра","Талия","Талон","Тарик","Тимо","Треш",
  "Тристана","Триндамир","Твистед Фэйт","Тwitch","Удир","Ургот","Варус","Вейн","Вейгар",
  "Вел'Коз","Векс","Ви","Виего","Виктор","Владимир","Волибир","Вуконг","Ксая","Ксерath",
  "Ксин Жао","Ясуо","Йone","Ёрик","Юми","Заахен","Зак","Зед","Зери","Зиггс","Зилеан",
  "Зои","Зыra"
];
const fallbackItems = [
  "Ботинки скорости","Ионийские сапоги просветления","Сапоги чародея",
  "Наголенники берсерка","Сапоги стремительности"
];

let championCache = { at: 0, names: fallbackChampions, images: {}, version: null };
let itemCache = { at: 0, images: {}, names: fallbackItems };

function normalizeTargetName(value) {
  return String(value || "").toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]/g, "");
}

async function getChampions() {
  if (Date.now() - championCache.at < 6 * 60 * 60 * 1000) return championCache.names;
  try {
    const versions = await fetch("https://ddragon.leagueoflegends.com/api/versions.json").then(r => r.json());
    const version = versions[0];
    const data = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ru_RU/champion.json`).then(r => r.json());
    const champions = Object.values(data.data);
    const names = champions.map(c => c.name).sort((a,b) => a.localeCompare(b, "ru"));
    const images = Object.fromEntries(champions.map(c => [c.name, `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${c.image.full}`]));
    if (names.length) championCache = { at: Date.now(), names, images, version };

    try {
      const itemData = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ru_RU/item.json`).then(r => r.json());
      const itemImages = {};
      const itemNames = [];
      for (const item of Object.values(itemData.data || {})) {
        const isNeutralCategory = (item.tags || []).some(tag => ["Boots", "Consumable", "Trinket"].includes(tag));
        const isSummonersRiftItem = item.maps?.["11"] === true;
        if (isNeutralCategory && isSummonersRiftItem && item.gold?.purchasable && item.name && item.image?.full) {
          itemNames.push(item.name);
          itemImages[normalizeTargetName(item.name)] = `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${item.image.full}`;
        }
      }
      itemCache = { at: Date.now(), images: itemImages, names: itemNames.length ? itemNames.sort((a,b) => a.localeCompare(b, "ru")) : fallbackItems };
    } catch (itemError) {
      console.warn("Не удалось загрузить список иконок предметов Data Dragon.");
      itemCache = { at: Date.now(), images: {}, names: fallbackItems };
    }
  } catch (e) {
    console.warn("Не удалось обновить список чемпионов Data Dragon; используется встроенный список.");
  }
  return championCache.names;
}

function getTargetImage(category, target) {
  if (category === "champions") return championCache.images[target] || null;
  if (category !== "items") return null;

  const exact = itemCache.images[normalizeTargetName(target)];
  if (exact) return exact;

  return null;
}
function makeCode() {
  let code;
  do {
    code = Array.from({length: 5}, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}
function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, isHost: p.id === room.hostId })),
    settings: room.settings,
    phase: room.phase,
    round: room.round,
    votes: room.votes.size,
    voted: [...room.votes.keys()],
    currentTurnPlayerId: room.turnOrder?.[room.turnIndex] || null,
    completedRounds: room.completedRounds || 0
  };
}
function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}
function getRoomBySocket(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}
function cleanName(name) {
  return String(name || "").trim().replace(/[<>]/g, "").slice(0, 18);
}
function choose(list) {
  return list[Math.floor(Math.random() * list.length)];
}
function shuffle(list) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function pickTarget(category, champions) {
  const actualCategory = category === "all"
    ? (Math.random() < 0.5 ? "champions" : "items")
    : category;
  const source = actualCategory === "items" ? itemCache.names : champions;
  return { target: choose(source), category: actualCategory };
}
function removePlayer(room, socketId) {
  const previousOrder = room.turnOrder || [];
  const previousIndex = room.turnIndex || 0;
  const wasCurrent = previousOrder[previousIndex] === socketId;
  room.players.delete(socketId);
  if (previousOrder.length) {
    room.turnOrder = previousOrder.filter(id => id !== socketId && room.players.has(id));
    if (room.turnOrder.length) {
      if (wasCurrent) room.turnIndex = previousIndex % room.turnOrder.length;
      else {
        const currentId = previousOrder[previousIndex];
        const nextIndex = room.turnOrder.indexOf(currentId);
        room.turnIndex = nextIndex < 0 ? 0 : nextIndex;
      }
    } else room.turnIndex = 0;
  }
  room.votes.delete(socketId);
  for (const [voter, target] of room.votes.entries()) {
    if (target === socketId) room.votes.delete(voter);
  }
  if (room.hostId === socketId) {
    room.hostId = room.players.keys().next().value || null;
  }
  if (!room.players.size) {
    rooms.delete(room.code);
    return;
  }
  if (room.phase !== "lobby" && room.players.size < 3) {
    room.phase = "lobby";
    room.target = null;
    room.spyIds = [];
    room.turnOrder = [];
    room.turnIndex = 0;
    room.completedRounds = 0;
    room.votes.clear();
    for (const p of room.players.values()) p.role = null;
    io.to(room.code).emit("game:notice", "Игроков стало меньше трёх. Раунд остановлен.");
  }
  emitRoom(room);
}

io.on("connection", socket => {
  socket.on("room:create", ({ name, settings, sessionToken } = {}, ack = () => {}) => {
    name = cleanName(name);
    if (!name) return ack({ ok: false, error: "Введи имя игрока." });
    const code = makeCode();
    const room = {
      code, hostId: socket.id, players: new Map(),
      settings: {
        category: ["champions","items","all"].includes(settings?.category) ? settings.category : "champions",
        spies: Math.max(1, Math.min(3, Number(settings?.spies) || 1)),
        rounds: Math.max(3, Math.min(10, Number(settings?.rounds) || 4))
      },
      phase: "lobby", round: 0, target: null, spyIds: [], votes: new Map(),
      turnOrder: [], turnIndex: 0, completedRounds: 0,
      lastSpyIds: [], nextStarterId: socket.id
    };
    room.players.set(socket.id, { id: socket.id, name, role: null, sessionToken });
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    ack({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:join", ({ code, name, sessionToken } = {}, ack = () => {}) => {
    code = String(code || "").trim().toUpperCase();
    name = cleanName(name);
    const room = rooms.get(code);
    if (!name) return ack({ ok: false, error: "Введи имя игрока." });
    if (!room) return ack({ ok: false, error: "Комната не найдена. Проверь код." });
    if (room.phase !== "lobby") return ack({ ok: false, error: "Раунд уже начался. Попроси создать новую комнату." });
    if (room.players.size >= 10) return ack({ ok: false, error: "В комнате максимум 10 игроков." });
    if ([...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) {
      return ack({ ok: false, error: "Это имя уже занято в комнате." });
    }
    room.players.set(socket.id, { id: socket.id, name, role: null, sessionToken });
    socket.join(code);
    socket.data.roomCode = code;
    ack({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:resume", ({ sessionToken } = {}, ack = () => {}) => {
    if (!sessionToken) return ack({ ok: false, error: "Сессия не найдена." });
    let room, oldId, player;
    for (const candidate of rooms.values()) {
      for (const [id, p] of candidate.players.entries()) {
        if (p.sessionToken === sessionToken) { room = candidate; oldId = id; player = p; break; }
      }
      if (room) break;
    }
    if (!room || !player) return ack({ ok: false, error: "Комната больше недоступна." });
    if (oldId !== socket.id) {
      room.players.delete(oldId);
      player.id = socket.id;
      room.players.set(socket.id, player);
      if (room.hostId === oldId) room.hostId = socket.id;
      room.turnOrder = (room.turnOrder || []).map(id => id === oldId ? socket.id : id);
      room.spyIds = (room.spyIds || []).map(id => id === oldId ? socket.id : id);
      room.lastSpyIds = (room.lastSpyIds || []).map(id => id === oldId ? socket.id : id);
      if (room.nextStarterId === oldId) room.nextStarterId = socket.id;
      if (room.votes.has(oldId)) { const vote = room.votes.get(oldId); room.votes.delete(oldId); room.votes.set(socket.id, vote); }
      for (const [voter, target] of room.votes.entries()) if (target === oldId) room.votes.set(voter, socket.id);
    }
    socket.join(room.code);
    socket.data.roomCode = room.code;
    ack({ ok: true, room: publicRoom(room) });
    emitRoom(room);
    if (room.phase === "playing" || room.phase === "voting") {
      socket.emit("game:role", { role: player.role, target: player.role === "spy" ? null : room.target,
        targetImage: player.role === "spy" ? null : getTargetImage(room.targetCategory || room.settings.category, room.target),
        category: room.targetCategory || room.settings.category, round: room.round });
    } else if (room.phase === "reveal") {
      const resultData = {
        ...room.result,
        spyNames: room.spyIds.map(id => room.players.get(id)?.name).filter(Boolean),
        votedOutName: room.result?.votedOut ? room.players.get(room.result.votedOut)?.name : null,
        category: room.targetCategory || room.settings.category
      };
      const tie = !!room.result?.tie;
      socket.emit("game:result", tie || player.role === "spy"
        ? { ...resultData, target: null, targetImage: null }
        : { ...resultData, target: room.target, targetImage: getTargetImage(room.targetCategory || room.settings.category, room.target) });
      if (room.spyGuessResult) socket.emit("game:spyGuess", room.spyGuessResult);
    }
  });

  socket.on("room:settings", ({ category, spies, rounds } = {}, ack = () => {}) => {
    const room = getRoomBySocket(socket);
    if (!room) return ack({ ok: false, error: "Комната не найдена." });
    if (socket.id !== room.hostId) return ack({ ok: false, error: "Настройки меняет только ведущий." });
    if (room.phase !== "lobby") return ack({ ok: false, error: "Настройки нельзя менять во время раунда." });
    if (["champions","items","all"].includes(category)) room.settings.category = category;
    if (Number.isInteger(Number(spies))) room.settings.spies = Math.max(1, Math.min(3, Number(spies)));
    if (Number.isInteger(Number(rounds))) room.settings.rounds = Math.max(3, Math.min(10, Number(rounds)));
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on("game:start", async (_payload, ack = () => {}) => {
    const room = getRoomBySocket(socket);
    if (!room) return ack({ ok: false, error: "Комната не найдена." });
    if (socket.id !== room.hostId) return ack({ ok: false, error: "Начать раунд может только ведущий." });
    if (room.players.size < 3) return ack({ ok: false, error: "Нужно минимум 3 игрока." });
    const spiesCount = Math.min(room.settings.spies, room.players.size - 1);
    const ids = [...room.players.keys()];
    const previousSpies = new Set(room.lastSpyIds || []);
    const eligibleSpies = ids.filter(id => !previousSpies.has(id));
    const selectedSpies = shuffle(eligibleSpies).slice(0, spiesCount);
    if (selectedSpies.length < spiesCount) {
      const repeatCandidates = shuffle(ids.filter(id => previousSpies.has(id)));
      selectedSpies.push(...repeatCandidates.slice(0, spiesCount - selectedSpies.length));
    }
    room.spyIds = selectedSpies;
    room.lastSpyIds = [...room.spyIds];
    const champions = await getChampions();
    const pickedTarget = pickTarget(room.settings.category, champions);
    room.target = pickedTarget.target;
    room.targetCategory = pickedTarget.category;
    const targetImage = getTargetImage(room.targetCategory, room.target);
    room.phase = "playing";
    room.round += 1;
    const startIndex = Math.max(0, ids.indexOf(room.nextStarterId));
    room.turnOrder = [...ids.slice(startIndex), ...ids.slice(0, startIndex)];
    room.nextStarterId = ids[(startIndex + 1) % ids.length];
    room.turnIndex = 0;
    room.completedRounds = 0;
    room.votes.clear();
    room.spyGuessResult = null;
    for (const p of room.players.values()) p.role = room.spyIds.includes(p.id) ? "spy" : "player";
    for (const p of room.players.values()) {
      io.to(p.id).emit("game:role", {
        role: p.role,
        target: p.role === "spy" ? null : room.target,
        targetImage: p.role === "spy" ? null : targetImage,
        category: room.targetCategory || room.settings.category,
        round: room.round
      });
    }
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on("game:passTurn", (_payload, ack = () => {}) => {
    const room = getRoomBySocket(socket);
    if (!room || room.phase !== "playing") return ack({ ok: false, error: "Сейчас нельзя передать ход." });
    if (socket.id !== room.turnOrder[room.turnIndex]) return ack({ ok: false, error: "Сейчас не твой ход." });
    room.turnIndex += 1;
    if (room.turnIndex >= room.turnOrder.length) {
      room.turnIndex = 0;
      room.completedRounds += 1;
      if (room.completedRounds >= room.settings.rounds) room.phase = "voting";
    }
    emitRoom(room);
    ack({ ok: true, phase: room.phase, completedRounds: room.completedRounds });
  });

  socket.on("game:vote", ({ targetId } = {}, ack = () => {}) => {
    const room = getRoomBySocket(socket);
    if (!room || room.phase !== "voting") return ack({ ok: false, error: "Голосование ещё не началось." });
    if (!room.players.has(socket.id)) return ack({ ok: false, error: "Ты не в комнате." });
    if (!room.players.has(targetId) || targetId === socket.id) return ack({ ok: false, error: "Выбери другого игрока." });
    room.votes.set(socket.id, targetId);
    emitRoom(room);
    if (room.votes.size === room.players.size) {
      const counts = new Map();
      for (const id of room.votes.values()) counts.set(id, (counts.get(id) || 0) + 1);
      const max = Math.max(...counts.values());
      const leaders = [...counts.entries()].filter(([,n]) => n === max).map(([id]) => id);
      const caught = leaders.length === 1 && room.spyIds.includes(leaders[0]);
      room.phase = "reveal";
      room.result = { caught, votedOut: leaders.length === 1 ? leaders[0] : null, tie: leaders.length > 1 };
      const resultData = {
        ...room.result,
        spyNames: room.spyIds.map(id => room.players.get(id)?.name).filter(Boolean),
        votedOutName: room.result.votedOut ? room.players.get(room.result.votedOut)?.name : null,
        category: room.targetCategory || room.settings.category
      };
      const targetImage = getTargetImage(room.targetCategory || room.settings.category, room.target);
      for (const player of room.players.values()) {
        io.to(player.id).emit("game:result", room.result.tie
          ? { ...resultData, target: null, targetImage: null }
          : player.role === "spy"
            ? { ...resultData, target: null, targetImage: null }
            : { ...resultData, target: room.target, targetImage });
      }
      emitRoom(room);
    }
    ack({ ok: true });
  });

  socket.on("game:guess", ({ guess } = {}, ack = () => {}) => {
    const room = getRoomBySocket(socket);
    if (!room || room.phase !== "reveal" || room.result?.tie || !room.spyIds.includes(socket.id)) {
      return ack({ ok: false, error: "Сейчас нельзя угадывать." });
    }
    const normalized = String(guess || "").trim().toLocaleLowerCase("ru");
    const correct = normalized === String(room.target).trim().toLocaleLowerCase("ru");
    room.spyGuessResult = { player: room.players.get(socket.id)?.name, correct, target: room.target, targetImage: getTargetImage(room.targetCategory || room.settings.category, room.target), category: room.targetCategory || room.settings.category };
    io.to(room.code).emit("game:spyGuess", room.spyGuessResult);
    ack({ ok: true, correct });
  });

  socket.on("game:revote", (_payload, ack = () => {}) => {
    const room = getRoomBySocket(socket);
    if (!room || socket.id !== room.hostId) return ack({ ok: false, error: "Только ведущий может запустить переголосование." });
    if (room.phase !== "reveal" || !room.result?.tie) return ack({ ok: false, error: "Переголосование доступно только при ничьей." });
    room.votes.clear();
    room.result = null;
    room.phase = "voting";
    emitRoom(room);
    io.to(room.code).emit("game:revote");
    ack({ ok: true });
  });

  socket.on("game:next", (_payload, ack = () => {}) => {
    const room = getRoomBySocket(socket);
    if (!room || socket.id !== room.hostId) return ack({ ok: false, error: "Только ведущий может начать следующий раунд." });
    room.phase = "lobby";
    room.target = null;
    room.spyIds = [];
    room.votes.clear();
    room.result = null;
    room.spyGuessResult = null;
    for (const p of room.players.values()) p.role = null;
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on("room:leave", (...args) => {
    const ack = args.find(arg => typeof arg === "function");
    const room = getRoomBySocket(socket);
    if (!room) {
      if (ack) ack({ ok: true });
      return;
    }
    socket.leave(room.code);
    socket.data.roomCode = null;
    removePlayer(room, socket.id);
    if (ack) ack({ ok: true });
  });

  socket.on("disconnect", () => {
    const room = getRoomBySocket(socket);
    if (!room) return;
    const player = room.players.get(socket.id);
    const token = player?.sessionToken;
    socket.data.roomCode = null;
    setTimeout(() => {
      const currentRoom = rooms.get(room.code);
      const currentPlayer = currentRoom?.players.get(socket.id);
      if (currentRoom && currentPlayer && currentPlayer.sessionToken === token) removePlayer(currentRoom, socket.id);
    }, 300000);
  });
});

server.listen(PORT, () => console.log(`Spyfall: Rift Edition running on http://localhost:${PORT}`));
