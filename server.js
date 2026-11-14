
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

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

const items = [
  "Клинок падшего короля","Мучения Лиандри","Песочные часы Жони","Ангел-хранитель",
  "Посох архангела","Клинок ярости Гинсу","Смерть Разума","Затмение","Сила триединства",
  "Край ночи","Шипованный доспех","Мореллономикон","Сфера бесконечности","Шляпа Рабадона",
  "Поклон лорда Доминика","Сборщик долгов","Сумрачный клинок Драктарра","Сердце стали",
  "Призрачный танцор","Посох Бездны"
];

let championCache = { at: 0, names: fallbackChampions };

async function getChampions() {
  if (Date.now() - championCache.at < 6 * 60 * 60 * 1000) return championCache.names;
  try {
    const versions = await fetch("https://ddragon.leagueoflegends.com/api/versions.json").then(r => r.json());
    const version = versions[0];
    const data = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ru_RU/champion.json`).then(r => r.json());
    const names = Object.values(data.data).map(c => c.name).sort((a,b) => a.localeCompare(b, "ru"));
    if (names.length) championCache = { at: Date.now(), names };
  } catch (e) {
    console.warn("Не удалось обновить список чемпионов Data Dragon; используется встроенный список.");
  }
  return championCache.names;
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
    voted: [...room.votes.keys()]
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

function pickTarget(category, champions) {
  const source = category === "items" ? items : champions;
  return choose(source);
}

function removePlayer(room, socketId) {
  room.players.delete(socketId);
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
    room.votes.clear();
    for (const p of room.players.values()) p.role = null;
    io.to(room.code).emit("game:notice", "Игроков стало меньше трёх. Раунд остановлен.");
  }
  emitRoom(room);
}

io.on("connection", socket => {
  socket.on("room:create", ({ name, settings } = {}, ack = () => {}) => {
    name = cleanName(name);
    if (!name) return ack({ ok: false, error: "Введи имя игрока." });
    const code = makeCode();
    const room = {
      code, hostId: socket.id, players: new Map(),
      settings: {
        category: ["champions","items"].includes(settings?.category) ? settings.category : "champions",
        spies: Math.max(1, Math.min(3, Number(settings?.spies) || 1))
      },
      phase: "lobby", round: 0, target: null, spyIds: [], votes: new Map()
    };
    room.players.set(socket.id, { id: socket.id, name, role: null });
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    ack({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:join", ({ code, name } = {}, ack = () => {}) => {
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
    room.players.set(socket.id, { id: socket.id, name, role: null });
    socket.join(code);
    socket.data.roomCode = code;
    ack({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:settings", ({ category, spies } = {}, ack = () => {}) => {
    const room = getRoomBySocket(socket);
    if (!room) return ack({ ok: false, error: "Комната не найдена." });
    if (socket.id !== room.hostId) return ack({ ok: false, error: "Настройки меняет только ведущий." });
    if (room.phase !== "lobby") return ack({ ok: false, error: "Настройки нельзя менять во время раунда." });
    if (["champions","items"].includes(category)) room.settings.category = category;
    if (Number.isInteger(Number(spies))) room.settings.spies = Math.max(1, Math.min(3, Number(spies)));
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on("game:start", async (ack = () => {}) => {
    const room = getRoomBySocket(socket);
    if (!room) return ack({ ok: false, error: "Комната не найдена." });
    if (socket.id !== room.hostId) return ack({ ok: false, error: "Начать раунд может только ведущий." });
    if (room.players.size < 3) return ack({ ok: false, error: "Нужно минимум 3 игрока." });
    const spiesCount = Math.min(room.settings.spies, room.players.size - 1);
    const ids = [...room.players.keys()];
    const shuffled = ids.sort(() => Math.random() - 0.5);
    room.spyIds = shuffled.slice(0, spiesCount);
    const champions = await getChampions();
    room.target = pickTarget(room.settings.category, champions);
    room.phase = "playing";
    room.round += 1;
    room.votes.clear();
    for (const p of room.players.values()) p.role = room.spyIds.includes(p.id) ? "spy" : "player";
    for (const p of room.players.values()) {
      io.to(p.id).emit("game:role", {
        role: p.role,
        target: p.role === "spy" ? null : room.target,
        category: room.settings.category,
        round: room.round
      });
    }
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on("game:vote", ({ targetId } = {}, ack = () => {}) => {
    const room = getRoomBySocket(socket);
    if (!room || room.phase !== "playing") return ack({ ok: false, error: "Сейчас нельзя голосовать." });
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
      io.to(room.code).emit("game:result", {
        ...room.result,
        spyNames: room.spyIds.map(id => room.players.get(id)?.name).filter(Boolean),
        target: room.target,
        votedOutName: room.result.votedOut ? room.players.get(room.result.votedOut)?.name : null,
        category: room.settings.category
      });
      emitRoom(room);
    }
    ack({ ok: true });
  });

  socket.on("game:guess", ({ guess } = {}, ack = () => {}) => {
    const room = getRoomBySocket(socket);
    if (!room || room.phase !== "reveal" || !room.spyIds.includes(socket.id)) {
      return ack({ ok: false, error: "Сейчас нельзя угадывать." });
    }
    const normalized = String(guess || "").trim().toLocaleLowerCase("ru");
    const correct = normalized === String(room.target).trim().toLocaleLowerCase("ru");
    io.to(room.code).emit("game:spyGuess", { player: room.players.get(socket.id)?.name, correct, target: room.target });
    ack({ ok: true, correct });
  });

  socket.on("game:next", (ack = () => {}) => {
    const room = getRoomBySocket(socket);
    if (!room || socket.id !== room.hostId) return ack({ ok: false, error: "Только ведущий может начать следующий раунд." });
    room.phase = "lobby";
    room.target = null;
    room.spyIds = [];
    room.votes.clear();
    room.result = null;
    for (const p of room.players.values()) p.role = null;
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on("room:leave", (ack = () => {}) => {
    const room = getRoomBySocket(socket);
    if (!room) return ack({ ok: true });
    socket.leave(room.code);
    socket.data.roomCode = null;
    removePlayer(room, socket.id);
    ack({ ok: true });
  });

  socket.on("disconnect", () => {
    const room = getRoomBySocket(socket);
    if (room) removePlayer(room, socket.id);
  });
});

server.listen(PORT, () => console.log(`Spyfall: Rift Edition running on http://localhost:${PORT}`));
