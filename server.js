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
  activeQuestion: null,
  firstBuzz: null,
  buzzLocked: false
};

io.on("connection", (socket) => {
  socket.emit("syncState", state);

  socket.on("openQuestion", (questionText) => {
    state.activeQuestion = questionText;
    state.firstBuzz = null;
    state.buzzLocked = false;

    io.emit("syncState", state);
  });

  socket.on("closeQuestion", () => {
    state.activeQuestion = null;
    state.firstBuzz = null;
    state.buzzLocked = false;

    io.emit("syncState", state);
  });

  socket.on("resetBuzzer", () => {
    state.firstBuzz = null;
    state.buzzLocked = false;

    io.emit("syncState", state);
  });

  socket.on("buzz", (playerName) => {
    if (!state.activeQuestion) return;
    if (state.buzzLocked) return;

    state.firstBuzz = playerName || "Ein Spieler";
    state.buzzLocked = true;

    io.emit("syncState", state);
    io.emit("playerBuzzed", state.firstBuzz);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
