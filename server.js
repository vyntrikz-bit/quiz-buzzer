const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Server } = require("socket.io");

const publicDir = path.join(__dirname, "public");

const server = http.createServer((req, res) => {
  let filePath = req.url === "/" ? "/host.html" : req.url;
  filePath = path.join(publicDir, filePath);

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
    ".ogg": "audio/ogg"
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Datei nicht gefunden");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
    });
    res.end(content);
  });
});

const io = new Server(server);

const defaultCategories1 = ["Thema 1", "Thema 2", "Thema 3", "Thema 4", "Thema 5"];
const defaultCategories2 = ["Thema 6", "Thema 7", "Thema 8", "Thema 9", "Thema 10"];

const state = {
  currentBoard: 1,
  categoriesBoards: {
    1: [...defaultCategories1],
    2: [...defaultCategories2]
  },
  usedCellsBoards: {
    1: [],
    2: []
  },

  currentQuestion: null,
  questionPanelOpen: false,
  questionVisible: false,
  answerVisible: false,

  firstBuzz: null,
  buzzLocked: false,
  eliminatedPlayers: [],

  scores: {},
  lastAction: null,
  lobbyPlayers: [],

  timer: {
    total: 0,
    remaining: 0,
    running: false
  }
};

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
}

function boardFinished(boardNumber) {
  return getUsedCells(boardNumber).length >= 25;
}

function maybeAutoSwitchToBoard2() {
  if (boardFinished(1) && !boardFinished(2) && state.currentBoard === 1) {
    state.currentBoard = 2;
  }
}

function getFreeSlot() {
  const usedSlots = state.lobbyPlayers.map((p) => p.slot);
  for (let i = 1; i <= 5; i++) {
    if (!usedSlots.includes(i)) return i;
  }
  return null;
}

function saveLastAction() {
  state.lastAction = {
    scores: { ...state.scores },
    firstBuzz: state.firstBuzz,
    buzzLocked: state.buzzLocked,
    eliminatedPlayers: [...state.eliminatedPlayers]
  };
}

let timerInterval = null;

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  state.timer.running = false;
}

function emitState() {
  io.emit("syncState", {
    ...state,
    categories: getCategories(state.currentBoard),
    usedCells: getUsedCells(state.currentBoard),
    remainingCells: getRemainingCellCount(state.currentBoard),
    currentMultiplier: getCurrentMultiplier(),
    board1Finished: boardFinished(1),
    board2Finished: boardFinished(2)
  });
}

function emitLobby() {
  io.emit("lobbyUpdate", state.lobbyPlayers);
}

function upsertLobbyPlayer(socketId, name) {
  const cleanName = String(name || "").trim().slice(0, 24);
  if (!cleanName) return null;

  let player = state.lobbyPlayers.find((p) => p.socketId === socketId);
  if (player) {
    player.name = cleanName;
    if (!(cleanName in state.scores)) state.scores[cleanName] = 0;
    return player;
  }

  player = state.lobbyPlayers.find(
    (p) => p.name.toLowerCase() === cleanName.toLowerCase()
  );
  if (player) {
    player.socketId = socketId;
    player.name = cleanName;
    if (!(cleanName in state.scores)) state.scores[cleanName] = 0;
    return player;
  }

  const freeSlot = getFreeSlot();
  if (!freeSlot) return null;

  const newPlayer = {
    socketId,
    name: cleanName,
    slot: freeSlot
  };

  state.lobbyPlayers.push(newPlayer);
  if (!(cleanName in state.scores)) state.scores[cleanName] = 0;
  return newPlayer;
}

io.on("connection", (socket) => {
  emitState();
  emitLobby();

  socket.on("joinLobby", (playerName) => {
    const player = upsertLobbyPlayer(socket.id, playerName);
    if (!player) {
      socket.emit("lobbyFull");
      return;
    }
    emitLobby();
    emitState();
  });

  socket.on("setCurrentBoard", (boardNumber) => {
    const board = Number(boardNumber);
    if (board !== 1 && board !== 2) return;
    state.currentBoard = board;
    emitState();
  });

  socket.on("updateCategories", ({ board, categories }) => {
    const boardNumber = Number(board);
    if (boardNumber !== 1 && boardNumber !== 2) return;
    if (!Array.isArray(categories) || categories.length !== 5) return;

    state.categoriesBoards[boardNumber] = categories.map(
      (x) => String(x || "").trim().slice(0, 40) || "Thema"
    );

    emitState();
  });

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

    const boardNumber = Number(board);
    if (boardNumber !== 1 && boardNumber !== 2) return;
    if (!Number.isInteger(index)) return;

    state.currentBoard = boardNumber;

    state.currentQuestion = {
      board: boardNumber,
      index,
      category: String(category || ""),
      value: Number(value) || 0,
      question: String(question || ""),
      answer: String(answer || ""),
      image: String(image || "")
    };

    state.questionPanelOpen = true;
    state.questionVisible = false;
    state.answerVisible = false;
    state.firstBuzz = null;
    state.buzzLocked = false;
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

  socket.on("showQuestion", () => {
    if (!state.currentQuestion) return;
    state.questionVisible = true;
    emitState();
  });

  socket.on("showAnswer", () => {
    if (!state.currentQuestion) return;
    state.answerVisible = true;
    emitState();
  });

  socket.on("hideAnswer", () => {
    state.answerVisible = false;
    emitState();
  });

  socket.on("closeQuestion", () => {
    state.currentQuestion = null;
    state.questionPanelOpen = false;
    state.questionVisible = false;
    state.answerVisible = false;
    state.firstBuzz = null;
    state.buzzLocked = false;
    state.eliminatedPlayers = [];
    state.lastAction = null;

    stopTimer();
    state.timer.total = 0;
    state.timer.remaining = 0;

    maybeAutoSwitchToBoard2();
    emitState();
  });

  socket.on("resetBuzzer", () => {
    if (!state.currentQuestion) return;
    state.firstBuzz = null;
    state.buzzLocked = false;
    emitState();
  });

  socket.on("timerStart", (seconds) => {
    const secs = Number(seconds) || 0;
    if (!state.currentQuestion) return;

    if (state.timer.remaining <= 0) {
      if (secs <= 0) return;
      state.timer.total = secs;
      state.timer.remaining = secs;
    }

    stopTimer();
    state.timer.running = true;
    emitState();

    timerInterval = setInterval(() => {
      state.timer.remaining -= 1;

      if (state.timer.remaining <= 0) {
        state.timer.remaining = 0;
        stopTimer();
      }

      emitState();
    }, 1000);
  });

  socket.on("timerStop", () => {
    stopTimer();
    emitState();
  });

  socket.on("timerReset", () => {
    stopTimer();
    state.timer.remaining = state.timer.total;
    emitState();
  });

  socket.on("buzz", (playerName) => {
    const name = String(playerName || "").trim().slice(0, 24);
    if (!name) return;
    if (!state.currentQuestion) return;
    if (!state.questionVisible) return;
    if (state.buzzLocked) return;
    if (state.eliminatedPlayers.includes(name)) return;

    upsertLobbyPlayer(socket.id, name);

    if (!(name in state.scores)) {
      state.scores[name] = 0;
    }

    state.firstBuzz = name;
    state.buzzLocked = true;

    io.emit("playerBuzzed", { name });
    emitLobby();
    emitState();
  });

 socket.on("markCorrect", () => {
  if (!state.currentQuestion) return;
  if (!state.firstBuzz) return;

  saveLastAction();

  const name = String(state.firstBuzz).trim();
  const points = Number(state.currentQuestion.value || 0) * getCurrentMultiplier();

  if (!(name in state.scores)) {
    state.scores[name] = 0;
  }

  state.scores[name] += points;

  io.emit("answerResult", {
    result: "correct",
    name,
    points
  });

  emitState();
});

  socket.on("markWrong", () => {
  if (!state.currentQuestion) return;
  if (!state.firstBuzz) return;

  saveLastAction();

  const name = String(state.firstBuzz).trim();
  const points = Number(state.currentQuestion.value || 0) * getCurrentMultiplier();

  if (!(name in state.scores)) {
    state.scores[name] = 0;
  }

  state.scores[name] -= points;

  if (!state.eliminatedPlayers.includes(name)) {
    state.eliminatedPlayers.push(name);
  }

  state.firstBuzz = null;
  state.buzzLocked = false;

  io.emit("answerResult", {
    result: "wrong",
    name,
    points
  });

  emitState();
});

  socket.on("manualAddPoints", ({ name, points }) => {
    const playerName = String(name || "").trim().slice(0, 24);
    const amount = Number(points) || 0;
    if (!playerName || amount <= 0) return;

    saveLastAction();

    if (!(playerName in state.scores)) {
      state.scores[playerName] = 0;
    }

    state.scores[playerName] += amount;

    io.emit("manualScoreChanged", {
      type: "add",
      name: playerName,
      points: amount
    });

    emitState();
  });

  socket.on("manualSubtractPoints", ({ name, points }) => {
    const playerName = String(name || "").trim().slice(0, 24);
    const amount = Number(points) || 0;
    if (!playerName || amount <= 0) return;

    saveLastAction();

    if (!(playerName in state.scores)) {
      state.scores[playerName] = 0;
    }

    state.scores[playerName] -= amount;

    io.emit("manualScoreChanged", {
      type: "subtract",
      name: playerName,
      points: amount
    });

    emitState();
  });

  socket.on("undoLastAction", () => {
    if (!state.lastAction) return;

    state.scores = { ...state.lastAction.scores };
    state.firstBuzz = state.lastAction.firstBuzz;
    state.buzzLocked = state.lastAction.buzzLocked;
    state.eliminatedPlayers = [...state.lastAction.eliminatedPlayers];
    state.lastAction = null;

    emitState();
  });

  socket.on("disconnect", () => {
    const before = state.lobbyPlayers.length;
    state.lobbyPlayers = state.lobbyPlayers.filter((p) => p.socketId !== socket.id);

    if (state.lobbyPlayers.length !== before) {
      emitLobby();
      emitState();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
