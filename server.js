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

const state = {
  categories: ["Thema 1", "Thema 2", "Thema 3", "Thema 4", "Thema 5"],
  usedCells: [],
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

function getRemainingCellCount() {
  return 25 - state.usedCells.length;
}

function getCurrentMultiplier() {
  return getRemainingCellCount() <= 5 ? 2 : 1;
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
    remainingCells: getRemainingCellCount(),
    currentMultiplier: getCurrentMultiplier()
  });
}

function emitLobby() {
  io.emit("lobbyUpdate", state.lobbyPlayers);
}

io.on("connection", (socket) => {
  emitState();
  emitLobby();

  socket.on("joinLobby", (playerName) => {
    const name = String(playerName || "").trim().slice(0, 24);
    if (!name) return;

    const existingBySocket = state.lobbyPlayers.find((p) => p.socketId === socket.id);
    if (existingBySocket) {
      existingBySocket.name = name;
      emitLobby();
      return;
    }

    const existingByName = state.lobbyPlayers.find(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    if (existingByName) {
      existingByName.socketId = socket.id;
      existingByName.name = name;
      emitLobby();
      emitState();
      return;
    }

    const freeSlot = getFreeSlot();
    if (!freeSlot) {
      socket.emit("lobbyFull");
      return;
    }

    state.lobbyPlayers.push({
      socketId: socket.id,
      name,
      slot: freeSlot
    });

    if (!(name in state.scores)) {
      state.scores[name] = 0;
    }

    emitLobby();
    emitState();
  });

  socket.on("updateCategories", (categories) => {
    if (!Array.isArray(categories) || categories.length !== 5) return;
    state.categories = categories.map((x) => String(x || "").trim().slice(0, 40) || "Thema");
    emitState();
  });

  socket.on("openQuestion", (payload) => {
    const {
      index,
      category,
      value,
      question,
      answer,
      image = ""
    } = payload || {};

    if (!Number.isInteger(index)) return;

    state.currentQuestion = {
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

    if (!state.usedCells.includes(index)) {
      state.usedCells.push(index);
    }

    stopTimer();
    state.timer.total = 0;
    state.timer.remaining = 0;

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

    state.firstBuzz = name;
    state.buzzLocked = true;

    if (!(name in state.scores)) {
      state.scores[name] = 0;
    }

    io.emit("playerBuzzed", { name });
    emitState();
  });

  socket.on("markCorrect", () => {
    if (!state.currentQuestion) return;
    if (!state.firstBuzz) return;

    saveLastAction();

    const name = state.firstBuzz;
    const points = state.currentQuestion.value * getCurrentMultiplier();

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

    const name = state.firstBuzz;
    const points = state.currentQuestion.value * getCurrentMultiplier();

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
