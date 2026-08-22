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
    this.lobbyChannel = null
    this.remoteCursors = new Map()
    this.lastCursorBroadcast = 0
    this.fillMode = false
    this.roundEnding = false
    this.gameStarted = false
    this.guessedPlayers = new Set()
    this.roundStartTime = 0
    this.drawerId = null
    this.currentWord = null
    this.localScores = {}
    
    if (!state.supabase) {
      this.showConfigError()
      return
    }
    
    this.initChannel()
    this.render()
  }

  showConfigError() {
    this.app.innerHTML = `
      <div class="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        <div class="absolute inset-0 overflow-hidden pointer-events-none">
          <div class="absolute -top-40 -right-40 w-80 h-80 bg-purple-600/20 rounded-full blur-3xl animate-pulse"></div>
          <div class="absolute -bottom-40 -left-40 w-80 h-80 bg-pink-600/20 rounded-full blur-3xl animate-pulse" style="animation-delay: 1s;"></div>
        </div>
        <div class="glass rounded-2xl p-8 max-w-md text-center border border-red-500/50 shadow-2xl shadow-red-500/10 relative z-10">
          <div class="text-6xl mb-4">⚠️</div>
          <h2 class="text-2xl font-bold text-red-400 mb-4">Supabase Not Configured</h2>
          <p class="text-gray-300 mb-4">Please add your Supabase credentials in the .env file</p>
          <button onclick="window.location.hash='/'" class="mt-6 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-xl font-semibold transition-all duration-200 transform hover:scale-105">Go Back</button>
        </div>
      </div>
    `
  }

  initChannel() {
    const { supabase, roomCode, username } = this.state
    const channelName = `room:${roomCode}`
    this.lobbyChannel = supabase.channel('doodl-lobby', {
      config: { presence: { key: roomCode } }
    })
    this.lobbyChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.lobbyChannel.track({ host: username, roomCode, isHost: this.state.isHost })
      }
    })

    const playerId = this.getPlayerId()
    this.state.channel = supabase.channel(channelName, {
      config: { presence: { key: playerId } }
    })
    
    this.state.channel
      .on('broadcast', { event: 'drawing' }, (payload) => this.handleDrawingEvent(payload.payload))
      .on('presence', { event: 'sync' }, () => this.syncPlayersFromPresence())
      .on('presence', { event: 'join' }, () => {
        this.syncPlayersFromPresence()
        if (this.isRoomLeader() && this.currentWord) {
          setTimeout(() => this.broadcast('new-word', { drawerId: this.drawerId, word: this.currentWord }), 250)
        }
      })
      .on('presence', { event: 'leave' }, () => this.syncPlayersFromPresence())
      .on('broadcast', { event: 'chat' }, (payload) => this.handleChatMessage(payload.payload))
      .on('broadcast', { event: 'new-word' }, (payload) => this.handleNewWord(payload.payload))
      .on('broadcast', { event: 'correct-guess' }, (payload) => this.handleCorrectGuess(payload.payload))
      .on('broadcast', { event: 'round-end' }, (payload) => this.handleRoundEnd(payload.payload))
      .on('broadcast', { event: 'clear-canvas' }, () => this.clearCanvas())
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.state.channel.track({ playerId, username, score: 0, isHost: this.state.isHost })
        }
      })
  }

  isRoomLeader() {
    return this.state.isHost
  }

  getPlayerOrder() {
    const entries = Object.entries(this.state.players)
    const host = entries.find(([, player]) => player.isHost)
    const others = entries.filter(([playerId]) => !host || playerId !== host[0]).sort(([firstId], [secondId]) => firstId.localeCompare(secondId))
    return host ? [host, ...others].map(([playerId]) => playerId) : others.map(([playerId]) => playerId)
  }

  syncPlayersFromPresence() {
    if (!this.state.channel) return

    const presence = this.state.channel.presenceState()
    this.state.players = Object.fromEntries(Object.entries(presence).map(([playerId, entries]) => {
      const player = entries[entries.length - 1] || {}
      return [playerId, { username: player.username || 'Unknown', score: player.score || 0, isHost: player.isHost === true }]
    }))
    this.updatePlayersList()
  }

  getPlayerId() {
    if (!this.state.currentPlayer) {
      this.state.currentPlayer = 'player_' + Math.random().toString(36).substr(2, 9)
    }
    return this.state.currentPlayer
  }

  broadcast(event, payload) {
    if (this.state.channel) {
      this.state.channel.send({ 
        type: 'broadcast', 
        event: event, 
        payload: { ...payload, senderId: this.getPlayerId() } 
      })
    }
  }

  handleDrawingEvent(data) {
    if (data.senderId === this.getPlayerId()) return

    if (data.type === 'cursor') {
      this.updateRemoteCursor(data)
      return
    }

    if (data.type === 'cursor-leave') {
      this.removeRemoteCursor(data.senderId)
      return
    }

    if (data.type === 'undo') {
      this.undoStroke()
      return
    }

    if (data.type === 'fill') {
      this.fillAt(data.point, data.color)
      return
    }
    
    if (data.type === 'stroke-start') {
      this.strokes.push({ 
        points: [data.point], 
        color: data.color, 
        size: data.size, 
        isEraser: data.isEraser 
      })
      this.drawStroke(this.strokes[this.strokes.length - 1])
    } else if (data.type === 'stroke-move') {
      const stroke = this.strokes[this.strokes.length - 1]
      if (stroke) {
        stroke.points.push(data.point)
        this.drawStroke(stroke)
      }
    }
  }

  handlePlayerJoin(data) {
    if (!this.state.players[data.playerId]) {
      this.state.players[data.playerId] = { 
        username: data.username, 
        score: data.score || 0 
      }
      this.updatePlayersList()
      this.addSystemMessage(`🎉 ${data.username} joined the game!`)
    }
  }

  handlePlayerLeave(data) {
    if (this.state.players[data.playerId]) {
      const player = this.state.players[data.playerId]
      delete this.state.players[data.playerId]
      this.updatePlayersList()
      this.addSystemMessage(`👋 ${player.username} left the game`)
    }
  }

  handleChatMessage(data) {
    if (data.senderId === this.getPlayerId()) return
    this.state.chatMessages.push({ 
      username: this.state.players[data.senderId]?.username || 'Unknown', 
      message: data.message, 
      isSystem: false 
    })
    this.updateChat()
  }

  handleNewWord(data) {
    if (data.senderId === this.getPlayerId()) return
    this.drawerId = data.drawerId
    this.currentWord = data.word
    
    if (data.drawerId === this.getPlayerId()) {
      this.state.isDrawer = true
      this.state.currentWord = data.word
      this.state.drawingEnabled = true
      this.showWordToDrawer(data.word)
      this.addSystemMessage("🎨 You're drawing! Type hints in chat.")
      this.showFeedback('You are drawing this round', 'accent')
      this.updateTurnStatus('Your turn to draw', true)
    } else {
      this.state.isDrawer = false
      this.state.drawingEnabled = false
      this.state.currentWord = ''
      this.hideWordForGuesser()
      this.addSystemMessage("🤔 Guess what they're drawing!")
      this.showFeedback('Round started. Make your guess', 'accent')
      const drawerName = this.state.players[data.drawerId]?.username || 'Another player'
      this.updateTurnStatus(`${drawerName} is drawing`, false)
    }
    this.updatePlayersList()
  }

  handleCorrectGuess(data) {
    if (data.senderId === this.getPlayerId()) return
    this.guessedPlayers.add(data.guesserId)
    this.addSystemMessage(`🎯 ${data.guesser} guessed correctly! (+${data.points} points)`)
    this.state.scores = data.scores
    Object.entries(data.scores).forEach(([playerId, score]) => {
      if (this.state.players[playerId]) this.state.players[playerId].score = score
    })
    this.updatePlayersList()
    this.showFeedback(`${data.guesser} guessed correctly`, 'success')
  }

  handleRoundEnd(data) {
    if (data.round <= this.state.round) return
    this.clearCanvas()
    this.state.scores = data.scores
    this.state.round = data.round
    Object.entries(data.scores).forEach(([playerId, score]) => {
      if (this.state.players[playerId]) this.state.players[playerId].score = score
    })
    this.updatePlayersList()
    
    if (data.round > this.state.maxRounds) {
      this.endGame(data.scores)
    } else {
      this.addSystemMessage(`📦 Round ${data.round - 1} complete! Starting round ${data.round}...`)
      if (this.state.isHost) setTimeout(() => this.startRound(), 3000)
    }
  }

  render() {
    this.app.innerHTML = `<div class="min-h-screen flex flex-col"><header class="glass border-b border-gray-700/50 px-6 py-3 backdrop-blur-sm"><div class="flex items-center justify-between"><div class="flex items-center gap-4"><h1 class="text-2xl font-bold gradient-text">doodl</h1><span class="text-gray-500">|</span><span class="text-gray-300">Room: <span class="font-mono text-purple-400 bg-purple-500/10 px-2 py-1 rounded-lg">${this.state.roomCode}</span></span><span class="text-gray-500">|</span><span class="text-gray-300">You: <span class="font-semibold text-pink-400">${this.state.username}</span></span></div><div class="flex items-center gap-2"><button id="startGame" class="hidden px-4 py-2 bg-green-600/80 hover:bg-green-700 rounded-xl text-sm transition-all duration-200">▶ Start Game</button><button id="leaveRoom" class="px-4 py-2 bg-red-600/80 hover:bg-red-700 rounded-xl text-sm transition-all duration-200 hover:shadow-lg hover:shadow-red-500/25">🚪 Leave</button></div></div></header><div class="flex-1 flex overflow-hidden"><div class="w-64 glass border-r border-gray-700/50 p-4 flex flex-col backdrop-blur-sm"><div class="mb-4"><h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">👥 Players</h3><div id="playersList" class="space-y-2"></div></div><div class="mt-auto"><div id="wordDisplay" class="glass rounded-xl p-4 text-center border border-gray-700/50"><p class="text-gray-500 text-sm">Waiting for round...</p></div><div id="timerDisplay" class="mt-3 text-center text-4xl font-bold gradient-text animate-pulse"></div></div></div><div class="flex-1 bg-gray-900/50 flex flex-col items-center justify-center p-4"><div class="glass rounded-2xl shadow-2xl overflow-hidden border border-gray-700/50"><canvas id="gameCanvas" width="800" height="600" class="bg-white cursor-crosshair"></canvas></div><div class="mt-4 flex items-center gap-4 glass rounded-xl px-4 py-3 border border-gray-700/50"><div class="flex items-center gap-2"><label class="text-sm text-gray-400">🎨</label><input type="color" id="colorPicker" value="#000000" class="w-10 h-10 rounded-xl border-0 cursor-pointer"/></div><div class="flex items-center gap-2"><label class="text-sm text-gray-400">Size:</label><input type="range" id="brushSize" min="1" max="50" value="5" class="w-32 accent-purple-500"/><span id="brushSizeValue" class="text-sm text-gray-300 w-8 text-center">5</span></div><button id="eraserBtn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm transition-all duration-200">🧹 Eraser</button><button id="clearBtn" class="px-4 py-2 bg-red-600/80 hover:bg-red-700 rounded-xl text-sm transition-all duration-200">🗑️ Clear</button></div></div><div class="w-80 glass border-l border-gray-700/50 flex flex-col backdrop-blur-sm"><div class="p-4 border-b border-gray-700/50"><h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">💬 Chat</h3></div><div id="chatMessages" class="flex-1 overflow-y-auto p-4 space-y-2"></div><div class="p-4 border-t border-gray-700/50"><form id="chatForm" class="flex gap-2"><input type="text" id="chatInput" placeholder="Type your guess..." class="flex-1 px-3 py-2 bg-gray-800/80 border border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-white text-sm placeholder-gray-500" maxlength="50"/><button type="submit" class="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-xl transition-all duration-200">➤</button></form></div></div></div></div>`
    this.setupCanvas()
    this.addDrawControls()
    this.setupEventListeners()
    this.updatePlayersList()
    this.updateStartButton()
    this.updateTurnStatus('Waiting for the host to start', false)
  }

  addDrawControls() {
    const toolbar = document.getElementById('eraserBtn')?.parentElement
    if (!toolbar) return
    toolbar.insertAdjacentHTML('beforeend', '<button id="undoBtn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm transition-all duration-200" title="Undo last stroke">↶ Undo</button><button id="fillBtn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm transition-all duration-200" title="Fill an area">▧ Fill</button>')
  }

  setupCanvas() {
    this.canvas = document.getElementById("gameCanvas")
    this.ctx = this.canvas.getContext("2d")
    this.ctx.lineCap = "round"
    this.ctx.lineJoin = "round"
    this.strokes = []
    this.clearCanvas()
    const canvasFrame = this.canvas.parentElement
    canvasFrame.classList.add('canvas-frame')
    const cursorLayer = document.createElement('div')
    cursorLayer.id = 'remoteCursors'
    canvasFrame.appendChild(cursorLayer)
    
    // Mouse events
    this.canvas.addEventListener("mousedown", (e) => this.startDrawing(e))
    this.canvas.addEventListener("mousemove", (e) => { this.updateLocalCursor(e); this.draw(e) })
    this.canvas.addEventListener("mouseup", () => this.stopDrawing())
    this.canvas.addEventListener("mouseout", () => { this.stopDrawing(); this.broadcast('drawing', { type: 'cursor-leave' }) })
    
    // Touch events for mobile
    this.canvas.addEventListener("touchstart", (e) => { e.preventDefault(); this.handleTouchStart(e) })
    this.canvas.addEventListener("touchmove", (e) => { e.preventDefault(); this.handleTouchMove(e) })
    this.canvas.addEventListener("touchend", (e) => { e.preventDefault(); this.stopDrawing() })
  }
  
  handleTouchStart(e) {
    if (!this.state.drawingEnabled) return
    const touch = e.touches[0]
    const mouseEvent = new MouseEvent("mousedown", {
      clientX: touch.clientX,
      clientY: touch.clientY
    })
    this.canvas.dispatchEvent(mouseEvent)
  }
  
  handleTouchMove(e) {
    const touch = e.touches[0]
    const mouseEvent = new MouseEvent("mousemove", {
      clientX: touch.clientX,
      clientY: touch.clientY
    })
    this.canvas.dispatchEvent(mouseEvent)
  }

  setupEventListeners() {
    document.getElementById("colorPicker").addEventListener("input", (e) => { this.state.brushColor = e.target.value; this.state.isEraser = false; document.getElementById("eraserBtn").classList.remove("bg-purple-600", "ring-2", "ring-purple-500") })
    const bs = document.getElementById("brushSize"), bsv = document.getElementById("brushSizeValue")
    bs.addEventListener("input", (e) => { this.state.brushSize = parseInt(e.target.value); bsv.textContent = e.target.value })
    document.getElementById("eraserBtn").addEventListener("click", () => { this.state.isEraser = !this.state.isEraser; document.getElementById("eraserBtn").classList.toggle("bg-purple-600", this.state.isEraser); document.getElementById("eraserBtn").classList.toggle("ring-2", this.state.isEraser); document.getElementById("eraserBtn").classList.toggle("ring-purple-500", this.state.isEraser); this.showFeedback(this.state.isEraser ? 'Eraser enabled' : 'Brush enabled', 'accent') })
    document.getElementById("clearBtn").addEventListener("click", () => { if (this.state.isDrawer) { this.clearCanvas(); this.broadcast("clear-canvas", {}); this.showFeedback('Canvas cleared', 'accent') } })
    document.getElementById("undoBtn").addEventListener("click", () => { if (this.state.isDrawer) { this.undoStroke(); this.broadcast("drawing", { type: "undo" }); this.showFeedback('Last stroke undone', 'accent') } })
    document.getElementById("fillBtn").addEventListener("click", () => { if (this.state.isDrawer) { this.fillMode = !this.fillMode; document.getElementById("fillBtn").classList.toggle("bg-purple-600", this.fillMode); this.showFeedback(this.fillMode ? 'Fill tool enabled' : 'Brush tool enabled', 'accent') } })
    document.getElementById("chatForm").addEventListener("submit", (e) => { e.preventDefault(); const input = document.getElementById("chatInput"); const msg = input.value.trim(); if (msg) { this.sendChat(msg); input.value = "" } })
    document.getElementById("startGame").addEventListener("click", () => { if (!this.gameStarted) this.startRound() })
    document.getElementById("leaveRoom").addEventListener("click", () => this.leaveRoom())
  }

  updateStartButton() {
    const button = document.getElementById("startGame")
    if (!button) return
    button.classList.toggle("hidden", !this.state.isHost || this.gameStarted)
  }

  updateTurnStatus(message, isLocalTurn) {
    let status = document.getElementById('turnStatus')
    if (!status) {
      const wordPanel = document.getElementById('wordDisplay')
      if (!wordPanel) return
      status = document.createElement('div')
      status.id = 'turnStatus'
      wordPanel.parentElement.insertBefore(status, wordPanel)
    }
    status.textContent = message
    status.className = `turn-status ${isLocalTurn ? 'your-turn' : ''}`
  }

  getMousePos(e) { const r = this.canvas.getBoundingClientRect(); const scaleX = this.canvas.width / r.width; const scaleY = this.canvas.height / r.height; return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY } }

  updateLocalCursor(e) {
    const now = Date.now()
    if (now - this.lastCursorBroadcast < 50) return
    const position = this.getMousePos(e)
    this.lastCursorBroadcast = now
    this.broadcast('drawing', { type: 'cursor', point: position, username: this.state.username })
  }

  updateRemoteCursor(data) {
    const cursorLayer = document.getElementById('remoteCursors')
    if (!cursorLayer) return
    let cursor = this.remoteCursors.get(data.senderId)
    if (!cursor) {
      cursor = document.createElement('div')
      cursor.className = 'remote-cursor'
      cursor.innerHTML = '<span class="remote-cursor-dot"></span><span class="remote-cursor-label"></span>'
      cursorLayer.appendChild(cursor)
      this.remoteCursors.set(data.senderId, cursor)
    }
    cursor.style.left = `${(data.point.x / this.canvas.width) * 100}%`
    cursor.style.top = `${(data.point.y / this.canvas.height) * 100}%`
    cursor.querySelector('.remote-cursor-label').textContent = data.username || 'Player'
  }

  removeRemoteCursor(playerId) {
    const cursor = this.remoteCursors.get(playerId)
    if (cursor) cursor.remove()
    this.remoteCursors.delete(playerId)
  }

  showFeedback(message, tone = 'accent') {
    let toast = document.getElementById('feedbackToast')
    if (!toast) {
      toast = document.createElement('div')
      toast.id = 'feedbackToast'
      document.body.appendChild(toast)
    }
    toast.className = `feedback-toast ${tone}`
    toast.textContent = message
    clearTimeout(this.feedbackTimer)
    requestAnimationFrame(() => toast.classList.add('visible'))
    this.feedbackTimer = setTimeout(() => toast.classList.remove('visible'), 2200)
  }

  startDrawing(e) {
    if (!this.state.drawingEnabled) {
      this.showFeedback('Wait for your turn to draw', 'accent')
      return
    }
    if (this.fillMode) {
      const point = this.getMousePos(e)
      this.fillAt(point, this.state.isEraser ? '#ffffff' : this.state.brushColor)
      this.broadcast("drawing", { type: "fill", point, color: this.state.isEraser ? '#ffffff' : this.state.brushColor })
      return
    }
    this.isDrawing = true
    this.showFeedback('Drawing...', 'accent')
    const pos = this.getMousePos(e)
    const stroke = { points: [pos], color: this.state.isEraser ? "#ffffff" : this.state.brushColor, size: this.state.brushSize, isEraser: this.state.isEraser }
    this.strokes.push(stroke)
    this.drawStroke(stroke)
    this.broadcast("drawing", { type: "stroke-start", point: pos, color: stroke.color, size: stroke.size, isEraser: stroke.isEraser })
  }

  draw(e) {
    if (!this.isDrawing || !this.state.drawingEnabled) return
    const pos = this.getMousePos(e), s = this.strokes[this.strokes.length - 1]
    if (s) { s.points.push(pos); this.drawStroke(s) }
    this.broadcast("drawing", { type: "stroke-move", point: pos })
  }

  stopDrawing() { if (this.isDrawing) { this.isDrawing = false; this.broadcast("drawing", { type: "stroke-end" }) } }

  undoStroke() {
    if (this.strokes.length === 0) return
    this.strokes.pop()
    this.ctx.fillStyle = '#ffffff'
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    this.strokes.forEach((stroke) => this.drawStroke(stroke))
  }

  fillAt(point, color) {
    const x = Math.floor(point.x)
    const y = Math.floor(point.y)
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return
    const image = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
    const targetIndex = (y * this.canvas.width + x) * 4
    const target = image.data.slice(targetIndex, targetIndex + 4)
    const replacement = this.hexToRgb(color)
    if (!replacement || target[0] === replacement[0] && target[1] === replacement[1] && target[2] === replacement[2]) return
    const stack = [[x, y]]
    while (stack.length) {
      const [pixelX, pixelY] = stack.pop()
      if (pixelX < 0 || pixelY < 0 || pixelX >= this.canvas.width || pixelY >= this.canvas.height) continue
      const index = (pixelY * this.canvas.width + pixelX) * 4
      if (image.data[index] !== target[0] || image.data[index + 1] !== target[1] || image.data[index + 2] !== target[2] || image.data[index + 3] !== target[3]) continue
      image.data[index] = replacement[0]
      image.data[index + 1] = replacement[1]
      image.data[index + 2] = replacement[2]
      image.data[index + 3] = 255
      stack.push([pixelX + 1, pixelY], [pixelX - 1, pixelY], [pixelX, pixelY + 1], [pixelX, pixelY - 1])
    }
    this.ctx.putImageData(image, 0, 0)
  }

  hexToRgb(hex) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : null
  }

  drawStroke(stroke) {
    if (stroke.points.length < 2) return
    this.ctx.beginPath(); this.ctx.strokeStyle = stroke.color; this.ctx.lineWidth = stroke.size
    this.ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
    for (let i = 1; i < stroke.points.length; i++) { this.ctx.lineTo(stroke.points[i].x, stroke.points[i].y) }
    this.ctx.stroke()
  }

  clearCanvas() { this.strokes = []; this.ctx.fillStyle = "#ffffff"; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height) }

  sendChat(message) {
    const playerId = this.getPlayerId()
    const isCorrect = !this.state.isDrawer && this.currentWord && message.toLowerCase() === this.currentWord.toLowerCase() && !this.guessedPlayers.has(playerId)
    if (isCorrect) {
      const pts = Math.max(10, Math.floor(30 - (Date.now() - this.roundStartTime) / 1000))
      this.state.scores[playerId] = (this.state.scores[playerId] || 0) + pts
      if (this.state.players[playerId]) this.state.players[playerId].score = this.state.scores[playerId]
      const guessResult = { senderId: playerId, guesserId: playerId, word: this.currentWord, guesser: this.state.username, points: pts, scores: this.state.scores }
      this.guessedPlayers.add(playerId)
      this.addSystemMessage(`🎯 You guessed correctly! (+${pts} points)`)
      this.updatePlayersList()
      this.broadcast("chat", { message: "🎯 Correct guess!", username: this.state.username })
      this.broadcast("correct-guess", guessResult)
      this.checkAllGuessed()
    } else {
      this.broadcast("chat", { message, username: this.state.username })
      this.state.chatMessages.push({ username: this.state.username, message, isSystem: false })
      this.updateChat()
    }
  }

  checkAllGuessed() {
    const eligibleGuessers = Object.keys(this.state.players).filter((playerId) => playerId !== this.drawerId)
    if (eligibleGuessers.length > 0 && eligibleGuessers.every((playerId) => this.guessedPlayers.has(playerId))) {
      setTimeout(() => this.endRound(), 2000)
    }
  }

  startRound() {
    if (!this.state.isHost || this.roundEnding) return
    this.state.guessedWords.clear(); this.clearCanvas(); this.broadcast("clear-canvas", {})
    const ids = this.getPlayerOrder()
    if (ids.length === 0) return
    this.gameStarted = true
    this.updateStartButton()
    this.roundEnding = false
    this.guessedPlayers.clear()
    const drawer = ids[(this.state.round - 1) % ids.length]
    const word = this.state.wordList[Math.floor(Math.random() * this.state.wordList.length)]
    const roundData = { drawerId: drawer, word }
    this.handleNewWord(roundData)
    this.broadcast("new-word", { drawerId: drawer, word })
    this.roundStartTime = Date.now()
    let t = 60; const el = document.getElementById("timerDisplay")
    if (el) el.textContent = t
    if (this.gameTimer) clearInterval(this.gameTimer)
    this.gameTimer = setInterval(() => { t--; if (el) el.textContent = t; if (t <= 0) this.endRound() }, 1000)
  }

  endRound() {
    if (!this.state.isHost || this.roundEnding) return
    this.roundEnding = true
    this.clearCanvas()
    this.broadcast("clear-canvas", {})
    if (this.gameTimer) clearInterval(this.gameTimer)
    // Award points to drawer based on how many people guessed
    if (this.state.guessedWords.size > 0) { 
      // Find the drawer and award bonus points
      const allPlayers = Object.keys(this.state.players)
      if (allPlayers.length > 0) {
        const drawerId = allPlayers[0] // Simplified - in a real game you'd track who was drawer
        this.state.scores[drawerId] = (this.state.scores[drawerId] || 0) + this.state.guessedWords.size * 5
      }
    }
    this.broadcast("round-end", { scores: this.state.scores, round: this.state.round + 1 })
  }

  endGame(scores) {
    if (this.gameTimer) clearInterval(this.gameTimer)
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]), winner = sorted[0]
    const winnerPlayer = Object.values(this.state.players).find(p => p.score === winner[1]) || { username: "Unknown" }
    this.app.innerHTML = `<div class="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"><div class="absolute inset-0 overflow-hidden pointer-events-none"><div class="absolute -top-40 -right-40 w-80 h-80 bg-purple-600/20 rounded-full blur-3xl animate-pulse"></div><div class="absolute -bottom-40 -left-40 w-80 h-80 bg-pink-600/20 rounded-full blur-3xl animate-pulse" style="animation-delay: 1s;"></div></div><div class="glass rounded-2xl p-8 max-w-lg text-center border border-purple-500/50 shadow-2xl shadow-purple-500/20 relative z-10"><h1 class="text-4xl font-bold gradient-text mb-4">🎉 Game Over!</h1><div class="text-7xl mb-4 animate-float">🏆</div><p class="text-2xl text-gray-300 mb-6"><span class="gradient-text font-bold">${winnerPlayer.username}</span> wins!</p><div class="glass rounded-xl p-4 mb-6 border border-gray-700/50"><h3 class="text-lg font-semibold text-gray-400 mb-3">📊 Final Scores</h3>${sorted.map(([id, s], i) => { const player = Object.values(this.state.players).find(p => p.score === s); const name = player ? player.username : "Player " + (i + 1); return `<div class="flex justify-between items-center py-2 border-b border-gray-700/50 last:border-0"><span class="text-gray-300">${i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : ""}${name}</span><span class="font-bold gradient-text text-lg">${s} pts</span></div>` }).join("")}</div><button onclick="window.location.hash='/'" class="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-xl font-semibold transition-all duration-200 transform hover:scale-105 hover:shadow-lg hover:shadow-purple-500/25">🔄 Play Again</button></div></div>`
  }

  showWordToDrawer(word) { const el = document.getElementById("wordDisplay"); if (el) el.innerHTML = `<p class="text-gray-400 text-xs uppercase tracking-wider mb-2">✨ Your Word</p><p class="text-2xl font-bold gradient-text">${word.split('').map(l => '<span class="inline-block">' + l + '</span>').join('')}</p><p class="text-gray-500 text-xs mt-3">🎨 Draw this!</p>` }
  hideWordForGuesser() { const el = document.getElementById("wordDisplay"); if (el) el.innerHTML = `<p class="text-gray-400 text-xs uppercase tracking-wider mb-2">🤔 Guess the Word</p><p class="text-2xl font-bold text-gray-600">??????</p><p class="text-gray-500 text-xs mt-3">💬 Type in chat!</p>` }

  updatePlayersList() {
    const el = document.getElementById("playersList"); if (!el) return
    const currentPlayerId = this.getPlayerId()
    el.innerHTML = Object.entries(this.state.players).map(([id, p]) => `<div class="flex items-center justify-between glass rounded-xl px-3 py-2 border ${id === currentPlayerId ? "border-purple-500/50 bg-purple-500/10" : "border-gray-700/50"}"><span class="text-gray-300 text-sm truncate flex-1">${p.username}${p.isHost ? ' <span class="text-xs text-pink-400">(Host)</span>' : ""}${id === currentPlayerId ? ' <span class="text-xs text-purple-400">(You)</span>' : ""}</span><span class="text-purple-400 font-semibold text-sm ml-2">${p.score || 0}</span></div>`).join("")
  }

  updateScores(scores) { this.state.scores = scores; this.updatePlayersList() }

  updateChat() {
    const el = document.getElementById("chatMessages"); if (!el) return
    el.innerHTML = this.state.chatMessages.map(m => m.isSystem ? `<p class="text-gray-500 text-xs italic text-center py-1">${m.message}</p>` : `<div class="${m.username === this.state.username ? "text-right" : ""}"><span class="text-xs font-semibold text-purple-400">${m.username}</span><p class="text-gray-300 text-sm break-words">${m.message}</p></div>`).join(""); el.scrollTop = el.scrollHeight
  }

  addSystemMessage(msg) { this.state.chatMessages.push({ username: "System", message: msg, isSystem: true }); this.updateChat() }

  leaveRoom() {
    this.broadcast("drawing", { type: "cursor-leave" })
    if (this.state.channel) { this.state.channel.untrack(); this.state.channel.unsubscribe() }
    if (this.lobbyChannel) this.lobbyChannel.unsubscribe()
    if (this.gameTimer) clearInterval(this.gameTimer)
    localStorage.removeItem('doodl_room_code')
    this.router.navigate("/")
  }

  destroy() { this.leaveRoom() }
}
