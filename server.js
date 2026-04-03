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

io.on("connection", (socket) => {
  console.log("Ein Nutzer ist verbunden");

  socket.on("buzz", () => {
    io.emit("playerBuzzed");
  });

  socket.on("disconnect", () => {
    console.log("Ein Nutzer hat getrennt");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
