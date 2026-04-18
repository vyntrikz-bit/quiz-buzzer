const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const QUIZ_DATA_PATH = path.join(DATA_DIR, "quizData.json");

app.use(express.static(PUBLIC_DIR));

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function createDefaultQuizData() {
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
  if (!fs.existsSync(QUIZ_DATA_PATH)) {
    const defaults = createDefaultQuizData();
    fs.writeFileSync(QUIZ_DATA_PATH, JSON.stringify(defaults, null, 2), "utf8");
    return defaults;
  }

  try {
    const raw = fs.readFileSync(QUIZ_DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed.categories || !parsed.questions) {
      throw new Error("Invalid quizData structure");
    }

    for (const board of [1, 2]) {
      if (!Array.isArray(parsed.questions[board])) {
        parsed.questions[board] = createDefaultQuizData().questions[board];
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
  } catch (err) {
    const defaults = createDefaultQuizData();
    fs.writeFileSync(QUIZ_DATA_PATH, JSON.stringify(defaults, null, 2), "utf8");
    return defaults;
  }
}

function saveQuizData() {
  fs.writeFileSync(QUIZ_DATA_PATH, JSON.stringify(quizData, null, 2), "utf8");
}

let quizData = loadQuizData();

function createRuntimeState() {
  return {
    currentBoard: 1,
    currentQuestion: null,
    questionVisible: false,
    answerVisible: false,
    usedCellsBoards: {
      1: [],
      2: []
    },
    scores: {},
    lobbyPlayers: [],
    firstBuzz: null,
    eliminatedPlayers: [],
    timer: {
      total: 0,
      remaining: 0,
      running: false
    }
  };
}

let state = createRuntimeState();
let timerInterval = null;

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  state.timer.running = false;
}

function currentCategories() {
  return quizData.categories[state.currentBoard] || [];
}

function currentUsedCells() {
  return state.usedCellsBoards[state.currentBoard] || [];
}

function emitQuizData(target = null) {
  if (target) {
    target.emit("quizData", quizData);
  } else {
    io.emit("quizData", quizData);
  }
}

function emitLobby() {
  io.emit("lobbyUpdate", state.lobbyPlayers);
}

function emitState(target = null) {
  const payload = {
    currentBoard: state.currentBoard,
    currentQuestion: state.currentQuestion,
    questionVisible: state.questionVisible,
    answerVisible: state.answerVisible,
    usedCellsBoards: state.usedCellsBoards,
    usedCells: currentUsedCells(),
    categoriesBoards: quizData.categories,
    categories: currentCategories(),
    scores: state.scores,
    lobbyPlayers: state.lobbyPlayers,
    firstBuzz: state.firstBuzz,
    eliminatedPlayers: state.eliminatedPlayers,
    timer: state.timer
  };

  if (target) {
    target.emit("syncState", payload);
  } else {
    io.emit("syncState", payload);
  }
}

function upsertLobbyPlayer(socketId, name) {
  const cleanName = String(name || "").trim().slice(0, 24);
  if (!cleanName) return null;

  let existing = state.lobbyPlayers.find(
    (p) => p.name.toLowerCase() === cleanName.toLowerCase()
  );

  if (existing) {
    existing.socketId = socketId;
    existing.name = cleanName;
    if (typeof state.scores[cleanName] === "undefined") {
      state.scores[cleanName] = 0;
    }
    return existing;
  }

  const usedSlots = state.lobbyPlayers.map((p) => p.slot);
  let slot = 1;
  while (usedSlots.includes(slot) && slot <= 5) slot++;

  if (slot > 5) return null;

  const player = { socketId, name: cleanName, slot };
  state.lobbyPlayers.push(player);

  if (typeof state.scores[cleanName] === "undefined") {
    state.scores[cleanName] = 0;
  }

  return player;
}

io.on("connection", (socket) => {
  emitQuizData(socket);
  emitState(socket);
  emitLobby();

  socket.on("joinLobby", (name) => {
    const player = upsertLobbyPlayer(socket.id, name);
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

    quizData.categories[boardNum] = categories.map(
      (c) => String(c || "").trim().slice(0, 40) || "Category"
    );

    saveQuizData();
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

    saveQuizData();
    emitQuizData();
    emitState();
  });

  socket.on("showSelectedQuestion", (payload) => {
    if (!payload) return;

    const board = Number(payload.board);
    const index = Number(payload.index);

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

    state.questionVisible = true;
    state.answerVisible = false;
    state.firstBuzz = null;
    state.eliminatedPlayers = [];

    if (!state.usedCellsBoards[board].includes(index)) {
      state.usedCellsBoards[board].push(index);
    }

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
    state.eliminatedPlayers = [];
    stopTimer();
    state.timer.total = 0;
    state.timer.remaining = 0;
    emitState();
  });

  socket.on("buzz", (name) => {
    const cleanName = String(name || "").trim().slice(0, 24);
    if (!cleanName) return;
    if (!state.currentQuestion) return;
    if (!state.questionVisible) return;
    if (state.firstBuzz) return;
    if (state.eliminatedPlayers.includes(cleanName)) return;

    state.firstBuzz = cleanName;
    io.emit("playerBuzzed", { name: cleanName });
    emitState();
  });

  socket.on("resetBuzzer", () => {
    state.firstBuzz = null;
    emitState();
  });

  socket.on("markCorrect", () => {
    if (!state.firstBuzz || !state.currentQuestion) return;

    const name = state.firstBuzz;
    const points = Number(state.currentQuestion.value || 0);

    if (typeof state.scores[name] === "undefined") {
      state.scores[name] = 0;
    }

    state.scores[name] += points;

    io.emit("answerResult", {
      result: "correct",
      name,
      points
    });

    state.firstBuzz = null;
    emitState();
  });

  socket.on("markWrong", () => {
    if (!state.firstBuzz || !state.currentQuestion) return;

    const name = state.firstBuzz;
    const points = Number(state.currentQuestion.value || 0);

    if (typeof state.scores[name] === "undefined") {
      state.scores[name] = 0;
    }

    state.scores[name] -= points;

    if (!state.eliminatedPlayers.includes(name)) {
      state.eliminatedPlayers.push(name);
    }

    io.emit("answerResult", {
      result: "wrong",
      name,
      points
    });

    state.firstBuzz = null;
    emitState();
  });

  socket.on("manualAddPoints", ({ name, points }) => {
    const cleanName = String(name || "").trim().slice(0, 24);
    const amount = Number(points) || 0;
    if (!cleanName || amount <= 0) return;

    if (typeof state.scores[cleanName] === "undefined") {
      state.scores[cleanName] = 0;
    }

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

    if (typeof state.scores[cleanName] === "undefined") {
      state.scores[cleanName] = 0;
    }

    state.scores[cleanName] -= amount;

    io.emit("manualScoreChanged", {
      type: "subtract",
      name: cleanName,
      points: amount
    });

    emitState();
  });

  socket.on("timerStart", (seconds) => {
    const secs = Number(seconds) || 0;
    if (!state.currentQuestion || secs <= 0) return;

    stopTimer();
    state.timer.total = secs;
    state.timer.remaining = secs;
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

  socket.on("resetCurrentBoard", () => {
    state.usedCellsBoards[state.currentBoard] = [];

    if (state.currentQuestion && state.currentQuestion.board === state.currentBoard) {
      state.currentQuestion = null;
      state.questionVisible = false;
      state.answerVisible = false;
      state.firstBuzz = null;
      state.eliminatedPlayers = [];
    }

    emitState();
  });

  socket.on("newGameReset", () => {
    const existingPlayers = [...state.lobbyPlayers];
    state = createRuntimeState();
    state.lobbyPlayers = existingPlayers;

    for (const player of existingPlayers) {
      if (typeof state.scores[player.name] === "undefined") {
        state.scores[player.name] = 0;
      }
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

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
