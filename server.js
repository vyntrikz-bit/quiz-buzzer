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
  firstBuzz: null,
  buzzLocked: false,
  eliminatedPlayers: [],
  scores: {}
};

io.on("connection", (socket) => {
  socket.emit("syncState", state);

  socket.on("updateCategories", (categories) => {
    if (!Array.isArray(categories) || categories.length !== 5) return;
    state.categories = categories.map((x) => String(x || "").slice(0, 30));
    io.emit("syncState", state);
  });

  socket.on("openQuestion", ({ questionText, value }) => {
    state.activeQuestion = questionText;
    state.activeQuestionValue = Number(value) || 0;
    state.firstBuzz = null;
    state.buzzLocked = false;
    state.eliminatedPlayers = [];
    io.emit("syncState", state);
  });

  socket.on("closeQuestion", () => {
    state.activeQuestion = null;
    state.activeQuestionValue = 0;
    state.firstBuzz = null;
    state.buzzLocked = false;
    state.eliminatedPlayers = [];
    io.emit("syncState", state);
  });

  socket.on("resetBuzzer", () => {
    if (!state.activeQuestion) return;
    state.firstBuzz = null;
    state.buzzLocked = false;
    io.emit("syncState", state);
  });

  socket.on("markCorrect", () => {
    if (!state.activeQuestion) return;
    if (!state.firstBuzz) return;

    const name = state.firstBuzz;
    if (!state.scores[name]) state.scores[name] = 0;
    state.scores[name] += state.activeQuestionValue;

    io.emit("syncState", state);
  });

  socket.on("markWrong", () => {
    if (!state.activeQuestion) return;
    if (!state.firstBuzz) return;

    const name = state.firstBuzz;
    if (!state.scores[name]) state.scores[name] = 0;
    state.scores[name] -= state.activeQuestionValue;

    if (!state.eliminatedPlayers.includes(name)) {
      state.eliminatedPlayers.push(name);
    }

    state.firstBuzz = null;
    state.buzzLocked = false;

    io.emit("syncState", state);
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

    io.emit("syncState", state);
    io.emit("playerBuzzed", state.firstBuzz);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
