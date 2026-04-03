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
  activeQuestion: null,
  activeQuestionValue: 0,
  activeQuestionIndex: null,
  currentAnswer: "",
  answerVisible: false,
  firstBuzz: null,
  buzzLocked: false,
  eliminatedPlayers: [],
  scores: {},
  lastAction: null,
  usedCells: [],
  lobbyPlayers: [],
  timer: {
    total: 0,
    remaining: 0,
    running: false
  }
};

function saveLastAction() {
  state.lastAction = {
    firstBuzz: state.firstBuzz,
    buzzLocked: state.buzzLocked,
    eliminatedPlayers: [...state.eliminatedPlayers],
    scores: { ...state.scores }
  };
}

function getRemainingCellCount() {
  return 25 - state.usedCells.length;
}

function getCurrentQuestionMultiplier() {
  return getRemainingCellCount() <= 5 ? 2 : 1;
}

function getFreeSlot() {
  const usedSlots = state.lobbyPlayers.map(p => p.slot);
  for (let i = 1; i <= 4; i++) {
    if (!usedSlots.includes(i)) return i;
  }
  return null;
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
    currentMultiplier: getCurrentQuestionMultiplier(),
    remainingCells: getRemainingCellCount()
  });
}

function emitLobby() {
  io.emit("lobbyUpdate", state.lobbyPlayers);
}

io.on("connection", (socket) => {
  emitState();
  emitLobby();

  socket.on("joinLobby", (playerName) => {
    const name = String(playerName || "").trim().slice(0, 20);
    if (!name) return;

    let existing = state.lobbyPlayers.find(p => p.socketId === socket.id);
    if (existing) {
      existing.name = name;
      emitLobby();
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

    emitLobby();
  });

  socket.on("updateCategories", (categories) => {
    if (!Array.isArray(categories) || categories.length !== 5) return;
    state.categories = categories.map((x) => String(x || "").slice(0, 30));
    emitState();
  });

  socket.on("openQuestion", ({ questionText, answer, value, index }) => {
    state.activeQuestion = questionText;
    state.currentAnswer = answer || "";
    state.answerVisible = false;
    state.activeQuestionValue = Number(value) || 0;
    state.activeQuestionIndex = Number.isInteger(index) ? index : null;
    state.firstBuzz = null;
    state.buzzLocked = false;
    state.eliminatedPlayers = [];
    state.lastAction = null;

    if (
      state.activeQuestionIndex !== null &&
      !state.usedCells.includes(state.activeQuestionIndex)
    ) {
      state.usedCells.push(state.activeQuestionIndex);
    }

    stopTimer();
    state.timer.total = 0;
    state.timer.remaining = 0;

    emitState();
  });

  socket.on("closeQuestion", () => {
    state.activeQuestion = null;
    state.activeQuestionValue = 0;
    state.activeQuestionIndex = null;
    state.currentAnswer = "";
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

  socket.on("showCorrectAnswer", () => {
    if (!state.activeQuestion) return;
    state.answerVisible = true;
    emitState();
  });

  socket.on("hideCorrectAnswer", () => {
    state.answerVisible = false;
    emitState();
  });

  socket.on("resetBuzzer", () => {
    if (!state.activeQuestion) return;
    state.firstBuzz = null;
    state.buzzLocked = false;
    emitState();
  });

  socket.on("timerStart", (seconds) => {
    const secs = Number(seconds) || 0;
    if (!state.activeQuestion) return;

    if (state.timer.remaining > 0) {
      state.timer.running = true;
    } else {
      if (secs <= 0) return;
      state.timer.total = secs;
      state.timer.remaining = secs;
      state.timer.running = true;
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

  socket.on("markCorrect", () => {
    if (!state.activeQuestion) return;
    if (!state.firstBuzz) return;

    saveLastAction();

    const name = state.firstBuzz;
    const multiplier = getCurrentQuestionMultiplier();
    const points = state.activeQuestionValue * multiplier;

    if (!state.scores[name]) {
      state.scores[name] = 0;
    }

    state.scores[name] += points;

    io.emit("answerResult", { result: "correct", name, points });
    emitState();
  });

  socket.on("markWrong", () => {
    if (!state.activeQuestion) return;
    if (!state.firstBuzz) return;

    saveLastAction();

    const name = state.firstBuzz;
    const multiplier = getCurrentQuestionMultiplier();
    const points = state.activeQuestionValue * multiplier;

    if (!state.scores[name]) {
      state.scores[name] = 0;
    }

    state.scores[name] -= points;

    if (!state.eliminatedPlayers.includes(name)) {
      state.eliminatedPlayers.push(name);
    }

    state.firstBuzz = null;
    state.buzzLocked = false;

    io.emit("answerResult", { result: "wrong", name, points });
    emitState();
  });

  socket.on("undoLastAction", () => {
    if (!state.lastAction) return;

    state.firstBuzz = state.lastAction.firstBuzz;
    state.buzzLocked = state.lastAction.buzzLocked;
    state.eliminatedPlayers = [...state.lastAction.eliminatedPlayers];
    state.scores = { ...state.lastAction.scores };

    state.lastAction = null;
    emitState();
  });

  socket.on("buzz", (playerName) => {
    const name = String(playerName || "").trim().slice(0, 20);

    if (!name) return;
    if (!state.activeQuestion) return;
    if (state.buzzLocked) return;
    if (state.eliminatedPlayers.includes(name)) return;

    state.firstBuzz = name;
    state.buzzLocked = true;

    if (!(name in state.scores)) {
      state.scores[name] = 0;
    }

    io.emit("playerBuzzed", state.firstBuzz);
    emitState();
  });

  socket.on("disconnect", () => {
    const before = state.lobbyPlayers.length;
    state.lobbyPlayers = state.lobbyPlayers.filter(p => p.socketId !== socket.id);
    if (state.lobbyPlayers.length !== before) {
      emitLobby();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
