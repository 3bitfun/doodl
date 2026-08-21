export default class GameRoom {
  constructor(app, state, router) {
    this.app = app
    this.state = state
    this.router = router
    this.canvas = null
    this.ctx = null
    this.isDrawing = false
    this.strokes = []
    this.gameTimer = null
    this.roundStartTime = 0
    
    if (!state.supabase || state.supabase === null) {
      this.showConfigError()
      return
    }
    
    this.initChannel()
    this.render()
  }

  showConfigError() {
    this.app.innerHTML = `<div class="min-h-screen flex items-center justify-center p-4"><div class="bg-gray-800 rounded-xl p-8 max-w-md text-center border border-red-500"><h2 class="text-2xl font-bold text-red-400 mb-4">Supabase Not Configured</h2><p class="text-gray-300 mb-4">Please edit src/main.js and add your Supabase credentials</p><button onclick="window.location.hash='/'" class="mt-6 px-6 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg">Go Back</button></div></div>`
  }

  initChannel() {
    const { supabase, roomCode, username } = this.state
    const channelName = "room:" + roomCode
    this.state.channel = supabase.channel(channelName)
    
    this.state.channel.on("broadcast", { event: "drawing" }, (payload) => { this.handleDrawingEvent(payload.payload) })
    this.state.channel.on("broadcast", { event: "player-join" }, (payload) => { this.handlePlayerJoin(payload.payload) })
    this.state.channel.on("broadcast", { event: "player-leave" }, (payload) => { this.handlePlayerLeave(payload.payload) })
    this.state.channel.on("broadcast", { event: "chat" }, (payload) => { this.handleChatMessage(payload.payload) })
    this.state.channel.on("broadcast", { event: "new-word" }, (payload) => { this.handleNewWord(payload.payload) })
    this.state.channel.on("broadcast", { event: "correct-guess" }, (payload) => { this.handleCorrectGuess(payload.payload) })
    this.state.channel.on("broadcast", { event: "round-end" }, (payload) => { this.handleRoundEnd(payload.payload) })
    this.state.channel.on("broadcast", { event: "clear-canvas" }, (payload) => { this.clearCanvas() })
    this.state.channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        this.broadcast("player-join", { playerId: this.getPlayerId(), username: username, score: 0 })
      }
    })
  }

  getPlayerId() {
    if (!this.state.currentPlayer) { this.state.currentPlayer = "player_" + Math.random().toString(36).substr(2, 9) }
    return this.state.currentPlayer
  }

  broadcast(event, payload) {
    if (this.state.channel) { this.state.channel.send({ type: "broadcast", event: event, payload: { ...payload, senderId: this.getPlayerId() } }) }
  }

  handleDrawingEvent(data) {
    if (data.senderId === this.getPlayerId()) return
    if (data.type === "stroke-start") { this.strokes.push({ points: [data.point], color: data.color, size: data.size, isEraser: data.isEraser }) }
    else if (data.type === "stroke-move") { const s = this.strokes[this.strokes.length - 1]; if (s) { s.points.push(data.point); this.drawStroke(s) } }
  }

  handlePlayerJoin(data) {
    if (!this.state.players[data.playerId]) { this.state.players[data.playerId] = { username: data.username, score: 0 }; this.updatePlayersList(); this.addSystemMessage(data.username + " joined") }
  }

  handlePlayerLeave(data) {
    if (this.state.players[data.playerId]) { const p = this.state.players[data.playerId]; delete this.state.players[data.playerId]; this.updatePlayersList(); this.addSystemMessage(p.username + " left") }
  }

  handleChatMessage(data) {
    if (data.senderId === this.getPlayerId()) return
    this.state.chatMessages.push({ username: this.state.players[data.senderId]?.username || "Unknown", message: data.message, isSystem: false })
    this.updateChat()
  }

  handleNewWord(data) {
    if (data.drawerId === this.getPlayerId()) { this.state.isDrawer = true; this.state.currentWord = data.word; this.state.drawingEnabled = true; this.showWordToDrawer(data.word) }
    else { this.state.isDrawer = false; this.state.drawingEnabled = false; this.state.currentWord = ""; this.hideWordForGuesser() }
    this.updatePlayersList()
  }

  handleCorrectGuess(data) {
    this.state.guessedWords.add(data.word.toLowerCase())
    this.addSystemMessage(data.guesser + " guessed \"" + data.word + "\"! (+" + data.points + ")")
    this.updateScores(data.scores)
  }

  handleRoundEnd(data) {
    this.state.scores = data.scores; this.state.round = data.round
    if (data.round > this.state.maxRounds) { this.endGame(data.scores) } else { setTimeout(() => this.startRound(), 3000) }
  }

  render() {
    this.app.innerHTML = `<div class="min-h-screen flex flex-col"><header class="bg-gray-800 border-b border-gray-700 px-6 py-3"><div class="flex items-center justify-between"><div class="flex items-center gap-4"><h1 class="text-2xl font-bold text-purple-400">doodl</h1><span class="text-gray-400">|</span><span class="text-gray-300">Room: <span class="font-mono text-purple-400">${this.state.roomCode}</span></span><span class="text-gray-400">|</span><span class="text-gray-300">You: <span class="font-semibold">${this.state.username}</span></span></div><button id="leaveRoom" class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm">Leave</button></div></header><div class="flex-1 flex overflow-hidden"><div class="w-64 bg-gray-800 border-r border-gray-700 p-4 flex flex-col"><div class="mb-4"><h3 class="text-sm font-semibold text-gray-400 uppercase mb-2">Players</h3><div id="playersList" class="space-y-2"></div></div><div class="mt-auto"><div id="wordDisplay" class="bg-gray-900 rounded-lg p-4 text-center"><p class="text-gray-500 text-sm">Waiting...</p></div><div id="timerDisplay" class="mt-2 text-center text-3xl font-bold text-purple-400"></div></div></div><div class="flex-1 bg-gray-900 flex flex-col items-center justify-center p-4"><div class="bg-gray-800 rounded-lg shadow-xl overflow-hidden"><canvas id="gameCanvas" width="800" height="600" class="bg-white cursor-crosshair"></canvas></div><div class="mt-4 flex items-center gap-4 bg-gray-800 rounded-lg px-4 py-3"><div class="flex items-center gap-2"><label class="text-sm text-gray-400">Color:</label><input type="color" id="colorPicker" value="#000000" class="w-10 h-10 rounded border-0"/></div><div class="flex items-center gap-2"><label class="text-sm text-gray-400">Size:</label><input type="range" id="brushSize" min="1" max="50" value="5" class="w-32 accent-purple-500"/><span id="brushSizeValue" class="text-sm text-gray-300 w-8">5</span></div><button id="eraserBtn" class="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">Eraser</button><button id="clearBtn" class="px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-sm">Clear</button></div></div><div class="w-80 bg-gray-800 border-l border-gray-700 flex flex-col"><div class="p-4 border-b border-gray-700"><h3 class="text-sm font-semibold text-gray-400 uppercase">Chat</h3></div><div id="chatMessages" class="flex-1 overflow-y-auto p-4 space-y-2"></div><div class="p-4 border-t border-gray-700"><form id="chatForm" class="flex gap-2"><input type="text" id="chatInput" placeholder="Type guess..." class="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-white text-sm" maxlength="50"/><button type="submit" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg">Send</button></form></div></div></div></div>`
    this.setupCanvas()
    this.setupEventListeners()
    this.updatePlayersList()
  }

  setupCanvas() {
    this.canvas = document.getElementById("gameCanvas")
    this.ctx = this.canvas.getContext("2d")
    this.ctx.lineCap = "round"
    this.ctx.lineJoin = "round"
    this.strokes = []
    this.canvas.addEventListener("mousedown", (e) => this.startDrawing(e))
    this.canvas.addEventListener("mousemove", (e) => this.draw(e))
    this.canvas.addEventListener("mouseup", () => this.stopDrawing())
    this.canvas.addEventListener("mouseout", () => this.stopDrawing())
  }

  setupEventListeners() {
    document.getElementById("colorPicker").addEventListener("input", (e) => { this.state.brushColor = e.target.value; this.state.isEraser = false; document.getElementById("eraserBtn").classList.remove("bg-purple-600") })
    const bs = document.getElementById("brushSize"), bsv = document.getElementById("brushSizeValue")
    bs.addEventListener("input", (e) => { this.state.brushSize = parseInt(e.target.value); bsv.textContent = e.target.value })
    document.getElementById("eraserBtn").addEventListener("click", () => { this.state.isEraser = !this.state.isEraser; document.getElementById("eraserBtn").classList.toggle("bg-purple-600", this.state.isEraser) })
    document.getElementById("clearBtn").addEventListener("click", () => { if (this.state.isDrawer) { this.clearCanvas(); this.broadcast("clear-canvas", {}) } })
    document.getElementById("chatForm").addEventListener("submit", (e) => { e.preventDefault(); const input = document.getElementById("chatInput"); const msg = input.value.trim(); if (msg) { this.sendChat(msg); input.value = "" } })
    document.getElementById("leaveRoom").addEventListener("click", () => this.leaveRoom())
  }

  getMousePos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }

  startDrawing(e) {
    if (!this.state.drawingEnabled) return
    this.isDrawing = true
    const pos = this.getMousePos(e)
    const stroke = { points: [pos], color: this.state.isEraser ? "#ffffff" : this.state.brushColor, size: this.state.brushSize, isEraser: this.state.isEraser }
    this.strokes.push(stroke)
    this.broadcast("drawing", { type: "stroke-start", point: pos, color: stroke.color, size: stroke.size, isEraser: stroke.isEraser })
  }

  draw(e) {
    if (!this.isDrawing || !this.state.drawingEnabled) return
    const pos = this.getMousePos(e), s = this.strokes[this.strokes.length - 1]
    if (s) { s.points.push(pos); this.drawStroke(s) }
    this.broadcast("drawing", { type: "stroke-move", point: pos })
  }

  stopDrawing() { if (this.isDrawing) { this.isDrawing = false; this.broadcast("drawing", { type: "stroke-end" }) } }

  drawStroke(stroke) {
    if (stroke.points.length < 2) return
    this.ctx.beginPath(); this.ctx.strokeStyle = stroke.color; this.ctx.lineWidth = stroke.size
    this.ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
    for (let i = 1; i < stroke.points.length; i++) { this.ctx.lineTo(stroke.points[i].x, stroke.points[i].y) }
    this.ctx.stroke()
  }

  clearCanvas() { this.strokes = []; this.ctx.fillStyle = "#ffffff"; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height) }

  sendChat(message) {
    const isCorrect = !this.state.isDrawer && this.state.currentWord && message.toLowerCase() === this.state.currentWord.toLowerCase() && !this.state.guessedWords.has(message.toLowerCase())
    if (isCorrect) {
      const pts = Math.max(10, Math.floor(30 - (Date.now() - this.roundStartTime) / 1000))
      this.state.scores[this.getPlayerId()] = (this.state.scores[this.getPlayerId()] || 0) + pts
      this.broadcast("chat", { message, username: this.state.username })
      this.broadcast("correct-guess", { word: this.state.currentWord, guesser: this.state.username, points: pts, scores: this.state.scores })
      this.checkAllGuessed()
    } else { this.broadcast("chat", { message, username: this.state.username }) }
    this.state.chatMessages.push({ username: this.state.username, message, isSystem: false }); this.updateChat()
  }

  checkAllGuessed() { if (this.state.guessedWords.size >= Object.keys(this.state.players).length - 1) { setTimeout(() => this.endRound(), 2000) } }

  startRound() {
    this.state.guessedWords.clear(); this.clearCanvas(); this.broadcast("clear-canvas", {})
    const ids = Object.keys(this.state.players), drawer = ids[Math.floor(Math.random() * ids.length)]
    const word = this.state.wordList[Math.floor(Math.random() * this.state.wordList.length)]
    this.broadcast("new-word", { drawerId: drawer, word })
    this.roundStartTime = Date.now()
    let t = 60; const el = document.getElementById("timerDisplay")
    if (this.gameTimer) clearInterval(this.gameTimer)
    this.gameTimer = setInterval(() => { t--; el.textContent = t; if (t <= 0) this.endRound() }, 1000)
  }

  endRound() {
    if (this.gameTimer) clearInterval(this.gameTimer)
    if (this.state.guessedWords.size > 0) { const d = Object.keys(this.state.players)[0]; this.state.scores[d] = (this.state.scores[d] || 0) + this.state.guessedWords.size * 5 }
    this.broadcast("round-end", { scores: this.state.scores, round: this.state.round + 1 })
  }

  endGame(scores) {
    if (this.gameTimer) clearInterval(this.gameTimer)
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]), winner = sorted[0]
    const name = Object.keys(this.state.players).find(id => id === winner[0]) || "Unknown"
    this.app.innerHTML = `<div class="min-h-screen flex items-center justify-center p-4"><div class="bg-gray-800 rounded-xl p-8 max-w-lg text-center border border-purple-500"><h1 class="text-4xl font-bold text-purple-400 mb-4">Game Over!</h1><div class="text-6xl mb-4">🏆</div><p class="text-2xl text-gray-300 mb-6">${name} wins!</p><div class="bg-gray-900 rounded-lg p-4 mb-6"><h3 class="text-lg font-semibold text-gray-400 mb-3">Final Scores</h3>${sorted.map(([id, s]) => `<div class="flex justify-between text-gray-300"><span>${Object.keys(this.state.players).find(p => p === id) || "?"}</span><span class="font-bold text-purple-400">${s}</span></div>`).join("")}</div><button onclick="window.location.hash='/'" class="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold">Play Again</button></div></div>`
  }

  showWordToDrawer(word) { document.getElementById("wordDisplay").innerHTML = `<p class="text-gray-400 text-xs uppercase mb-1">Your Word</p><p class="text-2xl font-bold text-purple-400">${word}</p><p class="text-gray-500 text-xs mt-2">Draw this!</p>` }
  hideWordForGuesser() { document.getElementById("wordDisplay").innerHTML = `<p class="text-gray-400 text-xs uppercase mb-1">Current Word</p><p class="text-2xl font-bold text-gray-600">??????</p><p class="text-gray-500 text-xs mt-2">Guess in chat!</p>` }

  updatePlayersList() {
    const el = document.getElementById("playersList"); if (!el) return
    el.innerHTML = Object.entries(this.state.players).map(([id, p]) => `<div class="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2 ${id === this.getPlayerId() ? "border border-purple-500" : ""}"><span class="text-gray-300 text-sm truncate">${p.username}${id === this.getPlayerId() ? " (You)" : ""}</span><span class="text-purple-400 font-semibold text-sm">${p.score || 0}</span></div>`).join("")
  }

  updateScores(scores) { this.state.scores = scores; this.updatePlayersList() }

  updateChat() {
    const el = document.getElementById("chatMessages"); if (!el) return
    el.innerHTML = this.state.chatMessages.map(m => m.isSystem ? `<p class="text-gray-500 text-xs italic">${m.message}</p>` : `<div class="${m.username === this.state.username ? "text-right" : ""}"><span class="text-xs font-semibold text-purple-400">${m.username}</span><p class="text-gray-300 text-sm break-words">${m.message}</p></div>`).join(""); el.scrollTop = el.scrollHeight
  }

  addSystemMessage(msg) { this.state.chatMessages.push({ username: "System", message: msg, isSystem: true }); this.updateChat() }

  leaveRoom() {
    if (this.state.channel) { this.broadcast("player-leave", { playerId: this.getPlayerId() }); this.state.channel.unsubscribe() }
    if (this.gameTimer) clearInterval(this.gameTimer)
    this.router.navigate("/")
  }

  destroy() { this.leaveRoom() }
}
