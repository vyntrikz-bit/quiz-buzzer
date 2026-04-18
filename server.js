const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const DATA_PATH = path.join(__dirname, "data", "quizData.json");

// ===== LOAD DATA =====
function loadData() {
  if (!fs.existsSync(DATA_PATH)) {
    return {
      categories: {
        1: ["Dragons", "LCK", "Lore", "Riot Pls", "Order Must Be"],
        2: ["Champion Details", "Pick & Ban", "Who Am I", "Abilities", "Ingame Quest"]
      },
      questions: {
        1: {},
        2: {}
      }
    };
  }
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
}

function saveData() {
  fs.writeFileSync(DATA_PATH, JSON.stringify(quizData, null, 2));
}

let quizData = loadData();

// ===== RUNTIME STATE =====
let state = {
  currentBoard: 1,
  currentQuestion: null,
  questionVisible: false,
  answerVisible: false,
  usedCellsBoards: { 1: [], 2: [] },
  scores: {},
  lobbyPlayers: [],
  firstBuzz: null,
  eliminatedPlayers: [],
  categoriesBoards: quizData.categories
};

// ===== HELPERS =====
function broadcast() {
  io.emit("syncState", {
    ...state,
    categories: state.categoriesBoards[state.currentBoard],
    usedCells: state.usedCellsBoards[state.currentBoard]
  });
}

// ===== SOCKET =====
io.on("connection", (socket) => {

  // SEND INITIAL DATA
  socket.emit("quizData", quizData);
  socket.emit("syncState", {
    ...state,
    categories: state.categoriesBoards[state.currentBoard],
    usedCells: state.usedCellsBoards[state.currentBoard]
  });

  // ===== LOBBY =====
  socket.on("joinLobby", (name) => {
    name = name.trim();
    if (!name) return;

    let existing = state.lobbyPlayers.find(p => p.name === name);
    if (existing) return;

    let slot = 1;
    while (state.lobbyPlayers.some(p => p.slot === slot)) slot++;

    state.lobbyPlayers.push({ name, slot });
    state.scores[name] = 0;

    io.emit("lobbyUpdate", state.lobbyPlayers);
    broadcast();
  });

  // ===== BOARD SWITCH =====
  socket.on("setCurrentBoard", (board) => {
    state.currentBoard = board;
    broadcast();
  });

  // ===== QUESTION CONTROL =====
  socket.on("openQuestion", (q) => {
    state.currentQuestion = q;
    state.questionVisible = false;
    state.answerVisible = false;
    state.firstBuzz = null;
    state.eliminatedPlayers = [];

    if (!state.usedCellsBoards[q.board].includes(q.index)) {
      state.usedCellsBoards[q.board].push(q.index);
    }

    broadcast();
  });

  socket.on("showQuestion", () => {
    state.questionVisible = true;
    broadcast();
  });

  socket.on("showAnswer", () => {
    state.answerVisible = true;
    broadcast();
  });

  socket.on("hideAnswer", () => {
    state.answerVisible = false;
    broadcast();
  });

  socket.on("closeQuestion", () => {
    state.currentQuestion = null;
    state.questionVisible = false;
    state.answerVisible = false;
    state.firstBuzz = null;
    state.eliminatedPlayers = [];
    broadcast();
  });

  // ===== BUZZER =====
  socket.on("buzz", (name) => {
    if (!state.questionVisible) return;
    if (state.firstBuzz) return;
    if (state.eliminatedPlayers.includes(name)) return;

    state.firstBuzz = name;
    io.emit("playerBuzzed");
    broadcast();
  });

  socket.on("resetBuzzer", () => {
    state.firstBuzz = null;
    broadcast();
  });

  // ===== ANSWERS =====
  socket.on("markCorrect", () => {
    if (!state.firstBuzz) return;

    const name = state.firstBuzz;
    const points = state.currentQuestion?.value || 0;

    state.scores[name] += points;

    io.emit("answerResult", { result: "correct", name, points });
    state.firstBuzz = null;
    broadcast();
  });

  socket.on("markWrong", () => {
    if (!state.firstBuzz) return;

    const name = state.firstBuzz;
    const points = state.currentQuestion?.value || 0;

    state.scores[name] -= points;
    state.eliminatedPlayers.push(name);

    io.emit("answerResult", { result: "wrong", name, points });
    state.firstBuzz = null;
    broadcast();
  });

  // ===== MANUAL SCORE =====
  socket.on("manualAddPoints", ({ name, points }) => {
    if (!state.scores[name]) state.scores[name] = 0;
    state.scores[name] += points;
    io.emit("manualScoreChanged", { type: "add", name, points });
    broadcast();
  });

  socket.on("manualSubtractPoints", ({ name, points }) => {
    if (!state.scores[name]) state.scores[name] = 0;
    state.scores[name] -= points;
    io.emit("manualScoreChanged", { type: "subtract", name, points });
    broadcast();
  });

  // ===== SAVE DATA =====
  socket.on("saveCategories", ({ board, categories }) => {
    quizData.categories[board] = categories;
    state.categoriesBoards = quizData.categories;
    saveData();
    broadcast();
  });

  socket.on("saveQuestion", ({ board, index, data }) => {
    if (!quizData.questions[board]) quizData.questions[board] = {};
    quizData.questions[board][index] = data;
    saveData();
    socket.emit("quizData", quizData);
  });

  // ===== RESET =====
  socket.on("resetCurrentBoard", () => {
    state.usedCellsBoards[state.currentBoard] = [];
    broadcast();
  });

  socket.on("newGameReset", () => {
    state.usedCellsBoards = { 1: [], 2: [] };
    state.scores = {};
    state.lobbyPlayers = [];
    state.currentQuestion = null;
    state.firstBuzz = null;
    state.eliminatedPlayers = [];
    io.emit("lobbyUpdate", []);
    broadcast();
  });

});

// ===== START =====
server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
