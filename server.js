require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");

const User = require("./models/User");
const GroupMessage = require("./models/GroupMessage");
const PrivateMessage = require("./models/PrivateMessage");

const app = express();
const server = http.createServer(app);

const { Server } = require("socket.io");
const io = new Server(server);

// -------------------- Middleware --------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -------------------- Static Routes --------------------
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/views", express.static(path.join(__dirname, "views")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

// -------------------- Mongo --------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Atlas connected"))
  .catch((err) => console.log("❌ Mongo Error:", err.message));

// -------------------- REST APIs --------------------
app.post("/api/signup", async (req, res) => {
  try {
    const { username, firstname, lastname, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "username and password required" });
    }

    const newUser = new User({
      username,
      firstname,
      lastname,
      password
    });

    await newUser.save();
    return res.json({ message: "Signup success" });
  } catch (err) {
    // duplicate key (unique username)
    if (err?.code === 11000) {
      return res.status(400).json({ error: "Username already exists" });
    }
    return res.status(500).json({ error: "Server error: " + err.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const found = await User.findOne({ username, password });
    if (!found) return res.status(401).json({ error: "Invalid credentials" });

    return res.json({ message: "Login success", username: found.username });
  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
});

app.get("/api/messages/:room", async (req, res) => {
  try {
    const roomName = req.params.room;

    const history = await GroupMessage.find({ room: roomName })
      .sort({ date_sent: 1 })
      .limit(200);

    return res.json(history);
  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
});

app.get("/api/private/:userA/:userB", async (req, res) => {
  try {
    const { userA, userB } = req.params;

    const history = await PrivateMessage.find({
      $or: [
        { from_user: userA, to_user: userB },
        { from_user: userB, to_user: userA }
      ]
    })
      .sort({ date_sent: 1 })
      .limit(200);

    return res.json(history);
  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
});

// -------------------- SOCKET.IO --------------------
// username -> socketId
const userSockets = new Map();

function registerSocketUser(sock, uname) {
  sock.username = uname;
  userSockets.set(uname, sock.id);
  console.log("registered:", uname, sock.id);
}

function getSocketIdByUser(uname) {
  return userSockets.get(uname);
}

function removeSocketUser(sock) {
  if (!sock.username) return;
  userSockets.delete(sock.username);
}

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  socket.on("registerUser", (uname) => {
    if (!uname) return;
    registerSocketUser(socket, uname);
  });

  socket.on("joinRoom", ({ room, username }) => {
    if (!room || !username) return;

    socket.join(room);
    socket.currentRoom = room;
    socket.username = username;

    socket.to(room).emit("systemMessage", `${username} joined ${room}`);
  });

  socket.on("leaveRoom", () => {
    const activeRoom = socket.currentRoom;
    if (!activeRoom) return;

    socket.leave(activeRoom);
    socket.to(activeRoom).emit("systemMessage", `${socket.username} left ${activeRoom}`);

    socket.currentRoom = null;
  });

  // ---------- typing (room) ----------
  socket.on("typing", ({ room, username }) => {
    if (!room || !username) return;
    socket.to(room).emit("typing", { type: "room", room, from: username });
  });

  socket.on("stopTyping", ({ room }) => {
    if (!room) return;
    socket.to(room).emit("stopTyping", { type: "room", room });
  });

  // ---------- typing (private) ----------
  socket.on("typingPrivate", ({ from_user, to_user }) => {
    if (!from_user || !to_user) return;

    const targetId = getSocketIdByUser(to_user);
    if (targetId) {
      io.to(targetId).emit("typing", { type: "private", from: from_user });
    }
  });

  socket.on("stopTypingPrivate", ({ from_user, to_user }) => {
    if (!from_user || !to_user) return;

    const targetId = getSocketIdByUser(to_user);
    if (targetId) {
      io.to(targetId).emit("stopTyping", { type: "private", from: from_user });
    }
  });

  // ---------- send messages ----------
  socket.on("sendMessage", async ({ room, username, message }) => {
    if (!room || !username || !message) return;

    try {
      const doc = await new GroupMessage({
        from_user: username,
        room,
        message
      }).save();

      io.to(room).emit("receiveMessage", {
        from_user: username,
        room,
        message,
        date_sent: doc.date_sent
      });
    } catch (err) {
      console.log("sendMessage error:", err.message);
    }
  });

  socket.on("sendPrivate", async ({ from_user, to_user, message }) => {
    if (!from_user || !to_user || !message) return;

    try {
      const doc = await new PrivateMessage({ from_user, to_user, message }).save();

      const payload = {
        from_user,
        to_user,
        message,
        date_sent: doc.date_sent
      };

      const targetId = getSocketIdByUser(to_user);
      if (targetId) {
        io.to(targetId).emit("receivePrivate", payload);
      }

      // echo back to sender
      socket.emit("receivePrivate", payload);
    } catch (err) {
      console.log("sendPrivate error:", err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("disconnected:", socket.id);
    removeSocketUser(socket);
  });
});

server.listen(3000, () => {
  console.log("Server running: http://localhost:3000");
});
