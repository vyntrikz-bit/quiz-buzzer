const path = require("node:path");
const { Server } = require("socket.io");

const HOST_PASSWORD = process.env.HOST_PASSWORD || "changeme123";

const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const quizDataPath = path.join(dataDir, "quizData.json");

const server = http.createServer((req, res) => {
  let filePath = req.url === "/" ? "/host.html" : req.url;
  filePath = path.join(publicDir, filePath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav"
function getDefaultQuizData() {
  return {
    categories: {
      1: ["Dragons", "LCK", "Lore", "Riot Pls", "Order Must Be"],
      2: ["Champion Details", "Pick & Ban", "Who Am I", "Abilities", "Ingame Quest"]
    },
    questions: {
      1: Array.from({ length: 25 }, (_, i) => ({
        category: "",
        question: `Question ${i + 1}`,
        answer: `Answer ${i + 1}`,
        image: ""
      })),
      2: Array.from({ length: 25 }, (_, i) => ({
        category: "",
        question: `Question ${i + 26}`,
        answer: `Answer ${i + 26}`,
        image: ""
      }))
    }
};
}

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("File not found");
      return;
    }
function loadQuizData() {
  if (!fs.existsSync(quizDataPath)) {
    const defaults = getDefaultQuizData();
    fs.writeFileSync(quizDataPath, JSON.stringify(defaults, null, 2), "utf8");
    return defaults;
  }

    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream"
    });
    res.end(content);
  });
});
  try {
    const parsed = JSON.parse(fs.readFileSync(quizDataPath, "utf8"));
    if (!parsed.categories || !parsed.questions) {
      throw new Error("Invalid quizData.json structure");
    }
    return parsed;
  } catch {
    const defaults = getDefaultQuizData();
    fs.writeFileSync(quizDataPath, JSON.stringify(defaults, null, 2), "utf8");
    return defaults;
  }
}

const io = new Server(server);
function saveQuizData(data) {
  fs.writeFileSync(quizDataPath, JSON.stringify(data, null, 2), "utf8");
}

const defaultCategories1 = ["Basics", "Warframes", "Weapons", "Enemies", "Mods"];
const defaultCategories2 = ["Planets & Locations", "Resources & Crafting", "Abilites & Energie", "Companions", "Game Modes"];
let quizData = loadQuizData();

function createInitialState() {
return {
currentBoard: 1,
    categoriesBoards: {
      1: [...defaultCategories1],
      2: [...defaultCategories2]
    },
usedCellsBoards: {
1: [],
2: []
@@ -67,8 +80,8 @@ function createInitialState() {
eliminatedPlayers: [],

scores: {},
    lastAction: null,
lobbyPlayers: [],
    lastAction: null,

timer: {
total: 0,
@@ -79,31 +92,22 @@ function createInitialState() {
}

let state = createInitialState();
let timerInterval = null;

function getUsedCells(boardNumber) {
  return state.usedCellsBoards[boardNumber] || [];
}

function getCategories(boardNumber) {
  return state.categoriesBoards[boardNumber] || [];
}

function getRemainingCellCount(boardNumber) {
  return 25 - getUsedCells(boardNumber).length;
}

function getCurrentMultiplier() {
  return getRemainingCellCount(state.currentBoard) <= 5 ? 2 : 1;
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  state.timer.running = false;
}

function boardFinished(boardNumber) {
  return getUsedCells(boardNumber).length >= 25;
function getCurrentBoardCategories() {
  return quizData.categories[state.currentBoard] || [];
}

function maybeAutoSwitchToBoard2() {
  if (boardFinished(1) && !boardFinished(2) && state.currentBoard === 1) {
    state.currentBoard = 2;
  }
function getCurrentBoardUsedCells() {
  return state.usedCellsBoards[state.currentBoard] || [];
}

function getFreeSlot() {
@@ -123,30 +127,33 @@ function saveLastAction() {
};
}

let timerInterval = null;
function emitQuizData(target = null) {
  const payload = quizData;
  if (target) target.emit("quizData", payload);
  else io.emit("quizData", payload);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  state.timer.running = false;
function emitLobby() {
  io.emit("lobbyUpdate", state.lobbyPlayers);
}

function emitState() {
  io.emit("syncState", {
function emitState(target = null) {
  const payload = {
...state,
    categories: getCategories(state.currentBoard),
    usedCells: getUsedCells(state.currentBoard),
    remainingCells: getRemainingCellCount(state.currentBoard),
    currentMultiplier: getCurrentMultiplier(),
    board1Finished: boardFinished(1),
    board2Finished: boardFinished(2)
  });
    categories: getCurrentBoardCategories(),
    usedCells: getCurrentBoardUsedCells(),
    categoriesBoards: quizData.categories
  };

  if (target) target.emit("syncState", payload);
  else io.emit("syncState", payload);
}

function emitLobby() {
  io.emit("lobbyUpdate", state.lobbyPlayers);
function requireHost(socket, fn) {
  return (...args) => {
    if (!socket.data.isHost) return;
    fn(...args);
  };
}

function upsertLobbyPlayer(socketId, name) {
@@ -173,20 +180,63 @@ function upsertLobbyPlayer(socketId, name) {
const freeSlot = getFreeSlot();
if (!freeSlot) return null;

  const newPlayer = {
    socketId,
    name: cleanName,
    slot: freeSlot
  };

  const newPlayer = { socketId, name: cleanName, slot: freeSlot };
state.lobbyPlayers.push(newPlayer);

if (!(cleanName in state.scores)) state.scores[cleanName] = 0;
return newPlayer;
}

const server = http.createServer((req, res) => {
  let requestedPath = req.url === "/" ? "/host.html" : req.url;
  const filePath = path.join(publicDir, requestedPath);

  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg"
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("File not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream"
    });
    res.end(content);
  });
});

const io = new Server(server);

io.on("connection", (socket) => {
  emitState();
  socket.data.isHost = false;

  emitQuizData(socket);
  emitState(socket);
emitLobby();
  socket.emit("hostAuthStatus", { ok: false });

  socket.on("hostLogin", ({ password }) => {
    const ok = String(password || "") === HOST_PASSWORD;
    socket.data.isHost = ok;
    socket.emit("hostAuthStatus", { ok });
  });

socket.on("joinLobby", (playerName) => {
const player = upsertLobbyPlayer(socket.id, playerName);
@@ -198,52 +248,68 @@ io.on("connection", (socket) => {
emitState();
});

  socket.on("setCurrentBoard", (boardNumber) => {
  socket.on("setCurrentBoard", requireHost(socket, (boardNumber) => {
const board = Number(boardNumber);
if (board !== 1 && board !== 2) return;
state.currentBoard = board;
emitState();
  });
  }));

  socket.on("updateCategories", ({ board, categories }) => {
    const boardNumber = Number(board);
    if (boardNumber !== 1 && boardNumber !== 2) return;
  socket.on("saveCategories", requireHost(socket, ({ board, categories }) => {
    const boardNum = Number(board);
    if (boardNum !== 1 && boardNum !== 2) return;
if (!Array.isArray(categories) || categories.length !== 5) return;

    state.categoriesBoards[boardNumber] = categories.map(
      (x) => String(x || "").trim().slice(0, 40) || "Category"
    quizData.categories[boardNum] = categories.map((c) =>
      String(c || "").trim().slice(0, 40) || "Category"
);

    saveQuizData(quizData);
    emitQuizData();
emitState();
  });
  }));

  socket.on("saveQuestion", requireHost(socket, ({ board, index, data }) => {
    const boardNum = Number(board);
    const idx = Number(index);
    if (boardNum !== 1 && boardNum !== 2) return;
    if (!Number.isInteger(idx) || idx < 0 || idx > 24) return;
    if (!data) return;

    quizData.questions[boardNum][idx] = {
      category: String(data.category || "").trim().slice(0, 40),
      question: String(data.question || "").trim(),
      answer: String(data.answer || "").trim(),
      image: String(data.image || "").trim()
    };

  socket.on("openQuestion", (payload) => {
    const {
      board,
      index,
      category,
      value,
      question,
      answer,
      image = ""
    } = payload || {};
    saveQuizData(quizData);
    emitQuizData();
    emitState();
  }));

    const boardNumber = Number(board);
    if (boardNumber !== 1 && boardNumber !== 2) return;
    if (!Number.isInteger(index)) return;
  socket.on("openQuestion", requireHost(socket, (payload) => {
    const board = Number(payload?.board);
    const index = Number(payload?.index);

    state.currentBoard = boardNumber;
    if (board !== 1 && board !== 2) return;
    if (!Number.isInteger(index) || index < 0 || index > 24) return;

    state.currentBoard = board;
state.currentQuestion = {
      board: boardNumber,
      board,
index,
      category: String(category || ""),
      value: Number(value) || 0,
      question: String(question || ""),
      answer: String(answer || ""),
      image: String(image || "")
      category: String(payload.category || ""),
      value: Number(payload.value) || 0,
      question: String(payload.question || ""),
      answer: String(payload.answer || ""),
      image: String(payload.image || "")
};

    if (!state.usedCellsBoards[board].includes(index)) {
      state.usedCellsBoards[board].push(index);
    }

state.questionPanelOpen = true;
state.questionVisible = false;
state.answerVisible = false;
@@ -252,36 +318,31 @@ io.on("connection", (socket) => {
state.eliminatedPlayers = [];
state.lastAction = null;

    if (!state.usedCellsBoards[boardNumber].includes(index)) {
      state.usedCellsBoards[boardNumber].push(index);
    }

stopTimer();
state.timer.total = 0;
state.timer.remaining = 0;

    maybeAutoSwitchToBoard2();
emitState();
  });
  }));

  socket.on("showQuestion", () => {
  socket.on("showQuestion", requireHost(socket, () => {
if (!state.currentQuestion) return;
state.questionVisible = true;
emitState();
  });
  }));

  socket.on("showAnswer", () => {
  socket.on("showAnswer", requireHost(socket, () => {
if (!state.currentQuestion) return;
state.answerVisible = true;
emitState();
  });
  }));

  socket.on("hideAnswer", () => {
  socket.on("hideAnswer", requireHost(socket, () => {
state.answerVisible = false;
emitState();
  });
  }));

  socket.on("closeQuestion", () => {
  socket.on("closeQuestion", requireHost(socket, () => {
state.currentQuestion = null;
state.questionPanelOpen = false;
state.questionVisible = false;
@@ -295,23 +356,21 @@ io.on("connection", (socket) => {
state.timer.total = 0;
state.timer.remaining = 0;

    maybeAutoSwitchToBoard2();
emitState();
  });
  }));

  socket.on("resetBuzzer", () => {
  socket.on("resetBuzzer", requireHost(socket, () => {
if (!state.currentQuestion) return;
state.firstBuzz = null;
state.buzzLocked = false;
emitState();
  });
  }));

  socket.on("timerStart", (seconds) => {
  socket.on("timerStart", requireHost(socket, (seconds) => {
const secs = Number(seconds) || 0;
    if (!state.currentQuestion) return;
    if (!state.currentQuestion || secs <= 0) return;

if (state.timer.remaining <= 0) {
      if (secs <= 0) return;
state.timer.total = secs;
state.timer.remaining = secs;
}
@@ -330,18 +389,18 @@ io.on("connection", (socket) => {

emitState();
}, 1000);
  });
  }));

  socket.on("timerStop", () => {
  socket.on("timerStop", requireHost(socket, () => {
stopTimer();
emitState();
  });
  }));

  socket.on("timerReset", () => {
  socket.on("timerReset", requireHost(socket, () => {
stopTimer();
state.timer.remaining = state.timer.total;
emitState();
  });
  }));

socket.on("buzz", (playerName) => {
const name = String(playerName || "").trim().slice(0, 24);
@@ -365,43 +424,30 @@ io.on("connection", (socket) => {
emitState();
});

  socket.on("markCorrect", () => {
    if (!state.currentQuestion) return;
    if (!state.firstBuzz) return;
  socket.on("markCorrect", requireHost(socket, () => {
    if (!state.currentQuestion || !state.firstBuzz) return;

saveLastAction();

    const name = String(state.firstBuzz).trim();
    const points = Number(state.currentQuestion.value || 0) * getCurrentMultiplier();

    if (!(name in state.scores)) {
      state.scores[name] = 0;
    }
    const name = state.firstBuzz;
    const points = Number(state.currentQuestion.value || 0);

    if (!(name in state.scores)) state.scores[name] = 0;
state.scores[name] += points;

    io.emit("answerResult", {
      result: "correct",
      name,
      points
    });

    io.emit("answerResult", { result: "correct", name, points });
emitState();
  });
  }));

  socket.on("markWrong", () => {
    if (!state.currentQuestion) return;
    if (!state.firstBuzz) return;
  socket.on("markWrong", requireHost(socket, () => {
    if (!state.currentQuestion || !state.firstBuzz) return;

saveLastAction();

    const name = String(state.firstBuzz).trim();
    const points = Number(state.currentQuestion.value || 0) * getCurrentMultiplier();

    if (!(name in state.scores)) {
      state.scores[name] = 0;
    }
    const name = state.firstBuzz;
    const points = Number(state.currentQuestion.value || 0);

    if (!(name in state.scores)) state.scores[name] = 0;
state.scores[name] -= points;

if (!state.eliminatedPlayers.includes(name)) {
@@ -411,60 +457,49 @@ io.on("connection", (socket) => {
state.firstBuzz = null;
state.buzzLocked = false;

    io.emit("answerResult", {
      result: "wrong",
      name,
      points
    });

    io.emit("answerResult", { result: "wrong", name, points });
emitState();
  });
  }));

  socket.on("manualAddPoints", ({ name, points }) => {
    const playerName = String(name || "").trim().slice(0, 24);
  socket.on("manualAddPoints", requireHost(socket, ({ name, points }) => {
    const cleanName = String(name || "").trim().slice(0, 24);
const amount = Number(points) || 0;
    if (!playerName || amount <= 0) return;
    if (!cleanName || amount <= 0) return;

saveLastAction();

    if (!(playerName in state.scores)) {
      state.scores[playerName] = 0;
    }

    state.scores[playerName] += amount;
    if (!(cleanName in state.scores)) state.scores[cleanName] = 0;
    state.scores[cleanName] += amount;

io.emit("manualScoreChanged", {
type: "add",
      name: playerName,
      name: cleanName,
points: amount
});

emitState();
  });
  }));

  socket.on("manualSubtractPoints", ({ name, points }) => {
    const playerName = String(name || "").trim().slice(0, 24);
  socket.on("manualSubtractPoints", requireHost(socket, ({ name, points }) => {
    const cleanName = String(name || "").trim().slice(0, 24);
const amount = Number(points) || 0;
    if (!playerName || amount <= 0) return;
    if (!cleanName || amount <= 0) return;

saveLastAction();

    if (!(playerName in state.scores)) {
      state.scores[playerName] = 0;
    }

    state.scores[playerName] -= amount;
    if (!(cleanName in state.scores)) state.scores[cleanName] = 0;
    state.scores[cleanName] -= amount;

io.emit("manualScoreChanged", {
type: "subtract",
      name: playerName,
      name: cleanName,
points: amount
});

emitState();
  });
  }));

  socket.on("undoLastAction", () => {
  socket.on("undoLastAction", requireHost(socket, () => {
if (!state.lastAction) return;

state.scores = { ...state.lastAction.scores };
@@ -474,9 +509,9 @@ io.on("connection", (socket) => {
state.lastAction = null;

emitState();
  });
  }));

  socket.on("resetCurrentBoard", () => {
  socket.on("resetCurrentBoard", requireHost(socket, () => {
state.usedCellsBoards[state.currentBoard] = [];

if (state.currentQuestion && state.currentQuestion.board === state.currentBoard) {
@@ -494,12 +529,12 @@ io.on("connection", (socket) => {
state.timer.remaining = 0;

emitState();
  });
  }));

  socket.on("newGameReset", () => {
    const oldLobbyPlayers = [...state.lobbyPlayers];
  socket.on("newGameReset", requireHost(socket, () => {
    const oldPlayers = [...state.lobbyPlayers];
state = createInitialState();
    state.lobbyPlayers = oldLobbyPlayers;
    state.lobbyPlayers = oldPlayers;

for (const p of state.lobbyPlayers) {
if (!(p.name in state.scores)) state.scores[p.name] = 0;
@@ -508,7 +543,7 @@ io.on("connection", (socket) => {
stopTimer();
emitLobby();
emitState();
  });
  }));

socket.on("disconnect", () => {
const before = state.lobbyPlayers.length;
