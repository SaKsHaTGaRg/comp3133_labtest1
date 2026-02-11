const socket = io();

// -------------------- Session --------------------
const loggedInUser = localStorage.getItem("username");
if (!loggedInUser) window.location.href = "/views/login.html";

const $ = (id) => document.getElementById(id);

$("who").innerText = `Logged in as: ${loggedInUser}`;
socket.emit("registerUser", loggedInUser);

// -------------------- App State --------------------
const appState = {
  mode: "room",          // "room" | "private"
  room: null,            // current room name
  dmUser: null,          // username for 1-to-1
  typingTimeoutId: null  // debounce timer
};

// -------------------- UI Helpers --------------------
function resetChatPanel() {
  $("messages").innerHTML = "";
  $("typingText").innerText = "";
}

function setTypingText(text) {
  $("typingText").innerText = text || "";
}

function showControlsForMode() {
  const roomUI = $("roomControls");
  const dmUI = $("privateControls");

  if (appState.mode === "room") {
    roomUI.style.display = "block";
    dmUI.style.display = "none";
  } else {
    roomUI.style.display = "none";
    dmUI.style.display = "block";
  }
}

function pushMessage(line) {
  const box = $("messages");
  const div = document.createElement("div");
  div.innerText = line;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function safeEncode(v) {
  return encodeURIComponent(v ?? "");
}

// -------------------- Auth --------------------
function logout() {
  localStorage.removeItem("username");
  window.location.href = "/views/login.html";
}

// -------------------- Mode Switch --------------------
function onModeChange() {
  appState.mode = $("mode").value;
  resetChatPanel();
  showControlsForMode();
}

// -------------------- Room Chat --------------------
function joinRoom() {
  const selectedRoom = $("room").value;
  appState.room = selectedRoom;

  $("currentRoom").innerText = selectedRoom;
  resetChatPanel();

  socket.emit("joinRoom", { room: selectedRoom, username: loggedInUser });

  fetch(`/api/messages/${safeEncode(selectedRoom)}`)
    .then((res) => res.json())
    .then((msgs) => {
      msgs.forEach((m) => pushMessage(`${m.from_user}: ${m.message}`));
    })
    .catch((err) => alert("Room history load failed: " + err.message));
}

function leaveRoom() {
  socket.emit("leaveRoom");
  appState.room = null;

  $("currentRoom").innerText = "None";
  setTypingText("");
  pushMessage("You left the room.");
}

// -------------------- Private Chat --------------------
function loadPrivateHistory() {
  const target = $("toUser").value.trim();
  if (!target) return alert("Enter a username to chat with.");

  appState.dmUser = target;
  $("currentPrivate").innerText = target;

  resetChatPanel();

  fetch(`/api/private/${safeEncode(loggedInUser)}/${safeEncode(target)}`)
    .then((res) => res.json())
    .then((msgs) => {
      msgs.forEach((m) => {
        pushMessage(`[PRIVATE] ${m.from_user} -> ${m.to_user}: ${m.message}`);
      });
    })
    .catch((err) => alert("Private history load failed: " + err.message));
}

// -------------------- Sending --------------------
function sendMessage() {
  const input = $("messageInput");
  const text = input.value.trim();
  if (!text) return;

  if (appState.mode === "room") {
    if (!appState.room) return alert("Join a room first!");

    socket.emit("sendMessage", {
      room: appState.room,
      username: loggedInUser,
      message: text
    });

    socket.emit("stopTyping", { room: appState.room });
  } else {
    if (!appState.dmUser) {
      return alert("Enter username and click Load Chat History first!");
    }

    socket.emit("sendPrivate", {
      from_user: loggedInUser,
      to_user: appState.dmUser,
      message: text
    });

    // optimistic UI (same as your original behavior)
    pushMessage(`[PRIVATE] ${loggedInUser} -> ${appState.dmUser}: ${text}`);
  }

  input.value = "";
}

// -------------------- Typing Indicator --------------------
function handleTyping() {
  clearTimeout(appState.typingTimeoutId);

  if (appState.mode === "room") {
    if (!appState.room) return;

    socket.emit("typing", { room: appState.room, username: loggedInUser });

    appState.typingTimeoutId = setTimeout(() => {
      socket.emit("stopTyping", { room: appState.room });
    }, 600);
  } else {
    if (!appState.dmUser) return;

    socket.emit("typingPrivate", {
      from_user: loggedInUser,
      to_user: appState.dmUser
    });

    appState.typingTimeoutId = setTimeout(() => {
      socket.emit("stopTypingPrivate", {
        from_user: loggedInUser,
        to_user: appState.dmUser
      });
    }, 600);
  }
}

// -------------------- Socket Receivers --------------------
socket.on("typing", (data) => {
  // Your server sends: { type: "room"/"private", ... }
  if (data.type === "room") {
    if (appState.room && data.room === appState.room) {
      setTypingText(`${data.from} is typing...`);
    }
    return;
  }

  if (data.type === "private") {
    setTypingText(`${data.from} is typing...`);
  }
});

socket.on("stopTyping", (data) => {
  if (data.type === "room" || data.type === "private") {
    setTypingText("");
  }
});

socket.on("receiveMessage", (data) => {
  pushMessage(`${data.from_user}: ${data.message}`);
});

socket.on("systemMessage", (text) => {
  pushMessage(`[SYSTEM] ${text}`);
});

socket.on("receivePrivate", (data) => {
  // ignore echo if server sends your own DM back
  if (data.from_user === loggedInUser) return;
  pushMessage(`[PRIVATE] ${data.from_user} -> ${data.to_user}: ${data.message}`);
});

// Default controls on load
showControlsForMode();
