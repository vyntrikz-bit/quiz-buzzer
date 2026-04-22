const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;

const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const quizDataPath = path.join(dataDir, "quizData.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

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

function loadQuizData() {
  if (!fs.existsSync(quizDataPath)) {
    const defaults = getDefaultQuizData();
    fs.writeFileSync(quizDataPath, JSON.stringify(defaults, null, 2), "utf8");
    return defaults;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(quizDataPath, "utf8"));

    if (!parsed.categories || !parsed.questions) {
      throw new Error("Invalid quizData.json structure");
    }

    for (const board of [1, 2]) {
      if (!Array.isArray(parsed.questions[board])) {
        parsed.questions[board] = getDefaultQuizData().questions[board];
      }

      while (parsed.questions[board].length < 25) {
        parsed.questions[board].push({
          category: "",
          question: "",
          answer: "",
          image: ""
        });
      }
    }

    return parsed;
  } catch {
    const defaults = getDefaultQuizData();
    fs.writeFileSync(quizDataPath, JSON.stringify(defaults, null, 2), "utf8");
    return defaults;
  }
}

function saveQuizData(data) {
  fs.writeFileSync(quizDataPath, JSON.stringify(data, null, 2), "utf8");
}

let quizData = loadQuizData();

function createInitialState() {
  return {
    currentBoard: 1,
    usedCellsBoards: {
      1: [],
      2: []
    },

    currentQuestion: null,
    questionVisible: false,
    answerVisible: false,

    firstBuzz: null,
    buzzLocked: false,
    eliminatedPlayers: [],

    scores: {},
    lobbyPlayers: [],
    lastAction: null,

    timer: {
      total: 0,
      remaining: 0,
      running: false
    }
  };
}

let state = createInitialState();
let timerInterval = null;

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  state.timer.running = false;
}

function getCurrentBoardCategories() {
  return quizData.categories[state.currentBoard] || [];
}

function getCurrentBoardUsedCells() {
  return state.usedCellsBoards[state.currentBoard] || [];
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

function emitQuizData(target = null) {
  if (target) target.emit("quizData", quizData);
  else io.emit("quizData", quizData);
}

function emitLobby() {
  io.emit("lobbyUpdate", state.lobbyPlayers);
}

function emitState(target = null) {
  const payload = {
    ...state,
    categories: getCurrentBoardCategories(),
    usedCells: getCurrentBoardUsedCells(),
    categoriesBoards: quizData.categories
  };

  if (target) target.emit("syncState", payload);
  else io.emit("syncState", payload);
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

  const newPlayer = { socketId, name: cleanName, slot: freeSlot };
  state.lobbyPlayers.push(newPlayer);

  if (!(cleanName in state.scores)) state.scores[cleanName] = 0;
  return newPlayer;
}

const server = http.createServer((req, res) => {
  const requestedPath = req.url === "/" ? "/host.html" : req.url;
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
  emitQuizData(socket);
  emitState(socket);
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

  socket.on("saveCategories", ({ board, categories }) => {
    const boardNum = Number(board);
    if (boardNum !== 1 && boardNum !== 2) return;
    if (!Array.isArray(categories) || categories.length !== 5) return;

    quizData.categories[boardNum] = categories.map((c) =>
      String(c || "").trim().slice(0, 40) || "Category"
    );

    saveQuizData(quizData);
    emitQuizData();
    emitState();
  });

  socket.on("saveQuestion", ({ board, index, data }) => {
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

    saveQuizData(quizData);
    emitQuizData();
    emitState();
  });

  socket.on("showSelectedQuestion", (payload) => {
    const board = Number(payload?.board);
    const index = Number(payload?.index);

    if (board !== 1 && board !== 2) return;
    if (!Number.isInteger(index) || index < 0 || index > 24) return;

    state.currentBoard = board;
    state.currentQuestion = {
      board,
      index,
      category: String(payload.category || ""),
      value: Number(payload.value) || 0,
      question: String(payload.question || ""),
      answer: String(payload.answer || ""),
      image: String(payload.image || "")
    };

    if (!state.usedCellsBoards[board].includes(index)) {
      state.usedCellsBoards[board].push(index);
    }

    state.questionVisible = true;
    state.answerVisible = false;
    state.firstBuzz = null;
    state.buzzLocked = false;
    state.eliminatedPlayers = [];
    state.lastAction = null;

    stopTimer();
    state.timer.total = 0;
    state.timer.remaining = 0;

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
    state.questionVisible = false;
    state.answerVisible = false;
    state.firstBuzz = null;
    state.buzzLocked = false;
    state.eliminatedPlayers = [];
    state.lastAction = null;

    stopTimer();
    state.timer.total = 0;
    state.timer.remaining = 0;

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
    if (!state.currentQuestion || secs <= 0) return;

    if (state.timer.remaining <= 0) {
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
    if (!state.currentQuestion || !state.firstBuzz) return;

    saveLastAction();

    const name = state.firstBuzz;
    const points = Number(state.currentQuestion.value || 0);

    if (!(name in state.scores)) state.scores[name] = 0;
    state.scores[name] += points;

    io.emit("answerResult", { result: "correct", name, points });
    emitState();
  });

  socket.on("markWrong", () => {
    if (!state.currentQuestion || !state.firstBuzz) return;

    saveLastAction();

    const name = state.firstBuzz;
    const points = Number(state.currentQuestion.value || 0);

    if (!(name in state.scores)) state.scores[name] = 0;
    state.scores[name] -= points;

    if (!state.eliminatedPlayers.includes(name)) {
      state.eliminatedPlayers.push(name);
    }

    state.firstBuzz = null;
    state.buzzLocked = false;

    io.emit("answerResult", { result: "wrong", name, points });
    emitState();
  });

  socket.on("manualAddPoints", ({ name, points }) => {
    const cleanName = String(name || "").trim().slice(0, 24);
    const amount = Number(points) || 0;
    if (!cleanName || amount <= 0) return;

    saveLastAction();

    if (!(cleanName in state.scores)) state.scores[cleanName] = 0;
    state.scores[cleanName] += amount;

    io.emit("manualScoreChanged", {
      type: "add",
      name: cleanName,
      points: amount
    });

    emitState();
  });

  socket.on("manualSubtractPoints", ({ name, points }) => {
    const cleanName = String(name || "").trim().slice(0, 24);
    const amount = Number(points) || 0;
    if (!cleanName || amount <= 0) return;

    saveLastAction();

    if (!(cleanName in state.scores)) state.scores[cleanName] = 0;
    state.scores[cleanName] -= amount;

    io.emit("manualScoreChanged", {
      type: "subtract",
      name: cleanName,
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

  socket.on("resetCurrentBoard", () => {
    state.usedCellsBoards[state.currentBoard] = [];

    if (state.currentQuestion && state.currentQuestion.board === state.currentBoard) {
      state.currentQuestion = null;
      state.questionVisible = false;
      state.answerVisible = false;
      state.firstBuzz = null;
      state.buzzLocked = false;
      state.eliminatedPlayers = [];
    }

    stopTimer();
    state.timer.total = 0;
    state.timer.remaining = 0;

    emitState();
  });

  socket.on("newGameReset", () => {
    const oldPlayers = [...state.lobbyPlayers];
    state = createInitialState();
    state.lobbyPlayers = oldPlayers;

    for (const p of state.lobbyPlayers) {
      if (!(p.name in state.scores)) state.scores[p.name] = 0;
    }

    stopTimer();
    emitLobby();
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
