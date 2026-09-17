import PartySocket from 'partysocket'

export default class GameRoom {
  constructor(app, state, router) {
    this.app = app
    this.state = state
    this.router = router
    this.directoryBeacon = null

    this.socket = null
    this.canvas = null
    this.ctx = null
    this.isDrawing = false
    this.strokes = []
    this.currentStroke = null
    this.remoteCursors = new Map()
    this.lastCursorBroadcast = 0
    this.fillMode = false
    this.guessedPlayers = new Set()
    this.roundStartTime = 0
    this.drawerId = null
    this.currentWord = null
    this.hostId = null

    this.render()
    this.connectSocket()
  }

  connectSocket() {
    const host = import.meta.env.DEV
      ? `${window.location.hostname}:1999`
      : 'doodl.3bitfun.partykit.dev'

    // Main game socket
    this.socket = new PartySocket({
      host,
      room: this.state.roomCode,
    })

    this.socket.addEventListener('open', () => {
      this.socket.send(JSON.stringify({
        type: 'join',
        username: this.state.username,
      }))
      this.addSystemMessage('Connected')
    })

    this.socket.addEventListener('message', (event) => {
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      this.handleServerMessage(msg)
    })

    this.socket.addEventListener('close', () => {
      this.addSystemMessage('Disconnected from room')
    })

    this.socket.addEventListener('error', (err) => {
      console.error('Socket error:', err)
    })

    // Directory beacon — announces this room so others can find it
    this.directoryBeacon = new PartySocket({
      host,
      room: '__directory__',
    })

    this.directoryBeacon.addEventListener('open', () => {
      this.directoryBeacon.send(JSON.stringify({
        type: 'register',
        code: this.state.roomCode,
        host: this.state.username,
        players: 1,
      }))
    })
  }
  updateBeacon() {
    if (!this.directoryBeacon || this.directoryBeacon.readyState !== 1) return
    try {
      this.directoryBeacon.send(JSON.stringify({
        type: 'update',
        code: this.state.roomCode,
        players: Object.keys(this.state.players).length,
      }))
    } catch (e) {
      console.error('Beacon update failed:', e)
    }
  }
  handleServerMessage(msg) {
    switch (msg.type) {
      case 'state':
        this.applyState(msg.state)
        break

      case 'round-start':
        this.handleRoundStart(msg)
        break

      case 'tick':
        this.updateTimer(msg.timeLeft)
        break

      case 'stroke':
        this.receiveStroke(msg.stroke)
        break

      case 'cursor':
        this.updateRemoteCursor(msg)
        break

      case 'cursor-leave':
        this.removeRemoteCursor(msg.senderId)
        break

      case 'fill':
        this.fillAt(msg.point, msg.color)
        break

      case 'undo':
        this.undoStroke()
        break

      case 'clear':
        this.clearCanvas()
        break

      case 'chat':
        this.state.chatMessages.push({
          username: msg.username,
          message: msg.message,
          isSystem: false,
        })
        this.updateChat()
        break

      case 'correct-guess':
        this.state.scores[msg.playerId] = (this.state.scores[msg.playerId] || 0) + msg.points
        this.addSystemMessage(`🎯 ${msg.username} guessed it! (+${msg.points})`)
        this.showFeedback(`${msg.username} guessed it!`)
        break

      case 'round-end':
        this.handleRoundEnd(msg)
        break

      case 'game-over':
        this.endGame(msg.scores, msg.players)
        break

      case 'system':
        this.addSystemMessage(msg.message)
        break
    }
  }

  applyState(serverState) {
    this.state.players = serverState.players
    this.state.round = serverState.round
    this.state.maxRounds = serverState.maxRounds
    this.state.isDrawer = serverState.drawerId === this.getPlayerId()
    this.drawerId = serverState.drawerId
    this.state.drawingEnabled = this.state.isDrawer && serverState.phase === 'playing'
    this.hostId = serverState.hostId
    this.state.isHost = serverState.hostId === this.getPlayerId()
    this.updateBeacon()

    if (!this.state.isDrawer && serverState.strokes.length !== this.strokes.length) {
      this.strokes = serverState.strokes
      this.redrawCanvas()
    }

    this.updatePlayersList()
    this.updateStartButton()
    this.updateWordDisplay()
    this.updateTurnStatus()
  }

  handleRoundStart(msg) {
    this.roundStartTime = Date.now()
    this.guessedPlayers.clear()
    this.clearCanvas()
    this.currentWord = msg.word
    this.drawerId = msg.drawerId

    if (msg.word) {
      this.state.isDrawer = true
      this.state.drawingEnabled = true
      this.state.currentWord = msg.word
      this.showWordToDrawer(msg.word)
      this.addSystemMessage("🎨 You're drawing!")
    } else {
      this.state.isDrawer = false
      this.state.drawingEnabled = false
      this.state.currentWord = ''
      this.showWordHint(msg.wordLength)
      this.addSystemMessage(`🤔 ${msg.drawerName} is drawing (${msg.wordLength} letters)`)
    }

    this.updateTimer(msg.timeLeft)
    this.updateWordDisplay()
    this.updatePlayersList()
  }

  handleRoundEnd(msg) {
    this.state.scores = msg.scores
    Object.entries(msg.scores).forEach(([id, score]) => {
      if (this.state.players[id]) this.state.players[id].score = score
    })
    this.updatePlayersList()

    if (msg.round < msg.maxRounds) {
      this.addSystemMessage(`📦 Round ${msg.round} complete! The word was "${msg.word}"`)
    }
  }

  endGame(scores, players) {
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
    const winnerId = sorted[0]?.[0]
    const winnerName = players[winnerId]?.username || 'Unknown'

    this.app.innerHTML = `
      <div class="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        <div class="absolute inset-0 overflow-hidden pointer-events-none">
          <div class="absolute -top-40 -right-40 w-80 h-80 bg-purple-600/20 rounded-full blur-3xl animate-pulse"></div>
          <div class="absolute -bottom-40 -left-40 w-80 h-80 bg-pink-600/20 rounded-full blur-3xl animate-pulse" style="animation-delay: 1s;"></div>
        </div>
        <div class="glass rounded-2xl p-8 max-w-lg text-center border border-purple-500/50 shadow-2xl shadow-purple-500/20 relative z-10">
          <h1 class="text-4xl font-bold gradient-text mb-4">🎉 Game Over!</h1>
          <div class="text-7xl mb-4 animate-float">🏆</div>
          <p class="text-2xl text-gray-300 mb-6">
            <span class="gradient-text font-bold">${winnerName}</span> wins!
          </p>
          <div class="glass rounded-xl p-4 mb-6 border border-gray-700/50">
            <h3 class="text-lg font-semibold text-gray-400 mb-3">📊 Final Scores</h3>
            ${sorted.map(([id, s], i) => {
              const name = players[id]?.username || 'Player'
              const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : ''
              return `<div class="flex justify-between items-center py-2 border-b border-gray-700/50 last:border-0">
                <span class="text-gray-300">${medal}${name}</span>
                <span class="font-bold gradient-text text-lg">${s} pts</span>
              </div>`
            }).join('')}
          </div>
          <button onclick="window.location.hash='/'" class="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-xl font-semibold transition-all duration-200 transform hover:scale-105">
            🔄 Play Again
          </button>
        </div>
      </div>
    `
  }

  // ─── Drawing ────────────────────────────────────────────────

  sendStrokeStart(point, color, size) {
    this.currentStroke = { points: [point], color, size }
    this.socket.send(JSON.stringify({
      type: 'stroke',
      stroke: { points: [point], color, size },
    }))
  }

  sendStrokeMove(point) {
    if (!this.currentStroke) return
    this.currentStroke.points.push(point)
    this.socket.send(JSON.stringify({
      type: 'stroke',
      stroke: {
        points: this.currentStroke.points,
        color: this.currentStroke.color,
        size: this.currentStroke.size,
      },
    }))
  }

  receiveStroke(stroke) {
    this.strokes.push(stroke)
    if (stroke.size === -1) {
      this.fillAt(stroke.points[0], stroke.color)
    } else {
      this.drawStroke(stroke)
    }
  }

  // ─── Render ─────────────────────────────────────────────────

  render() {
    this.app.innerHTML = `
      <div class="min-h-screen flex flex-col">
        <header class="glass border-b border-gray-700/50 px-6 py-3 backdrop-blur-sm">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
              <h1 class="text-2xl font-bold gradient-text">doodl</h1>
              <span class="text-gray-500">|</span>
              <span class="text-gray-300">Room: <span class="font-mono text-purple-400 bg-purple-500/10 px-2 py-1 rounded-lg">${this.state.roomCode}</span></span>
              <span class="text-gray-500">|</span>
              <span class="text-gray-300">You: <span class="font-semibold text-pink-400">${this.state.username}</span></span>
            </div>
            <div class="flex items-center gap-2">
              <button id="startGame" class="hidden px-4 py-2 bg-green-600/80 hover:bg-green-700 rounded-xl text-sm transition-all">▶ Start Game</button>
              <button id="leaveRoom" class="px-4 py-2 bg-red-600/80 hover:bg-red-700 rounded-xl text-sm transition-all">🚪 Leave</button>
            </div>
          </div>
        </header>
        <div class="flex-1 flex overflow-hidden">
          <div class="w-64 glass border-r border-gray-700/50 p-4 flex flex-col backdrop-blur-sm">
            <div class="mb-4">
              <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">👥 Players</h3>
              <div id="playersList" class="space-y-2"></div>
            </div>
            <div class="mt-auto">
              <div id="wordDisplay" class="glass rounded-xl p-4 text-center border border-gray-700/50">
                <p class="text-gray-500 text-sm">Waiting for round...</p>
              </div>
              <div id="timerDisplay" class="mt-3 text-center text-4xl font-bold gradient-text"></div>
            </div>
          </div>
          <div class="flex-1 bg-gray-900/50 flex flex-col items-center justify-center p-4">
            <div class="glass rounded-2xl shadow-2xl overflow-hidden border border-gray-700/50 canvas-frame">
              <canvas id="gameCanvas" width="800" height="600" class="bg-white cursor-crosshair"></canvas>
            </div>
            <div class="mt-4 flex items-center gap-4 glass rounded-xl px-4 py-3 border border-gray-700/50">
              <div class="flex items-center gap-2">
                <label class="text-sm text-gray-400">🎨</label>
                <input type="color" id="colorPicker" value="#000000" class="w-10 h-10 rounded-xl border-0 cursor-pointer"/>
              </div>
              <div class="flex items-center gap-2">
                <label class="text-sm text-gray-400">Size:</label>
                <input type="range" id="brushSize" min="1" max="50" value="5" class="w-32 accent-purple-500"/>
                <span id="brushSizeValue" class="text-sm text-gray-300 w-8 text-center">5</span>
              </div>
              <button id="eraserBtn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm transition-all">🧹 Eraser</button>
              <button id="fillBtn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm transition-all">▧ Fill</button>
              <button id="undoBtn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm transition-all">↶ Undo</button>
              <button id="clearBtn" class="px-4 py-2 bg-red-600/80 hover:bg-red-700 rounded-xl text-sm transition-all">🗑️ Clear</button>
            </div>
          </div>
          <div class="w-80 glass border-l border-gray-700/50 flex flex-col backdrop-blur-sm">
            <div class="p-4 border-b border-gray-700/50">
              <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">💬 Chat</h3>
            </div>
            <div id="chatMessages" class="flex-1 overflow-y-auto p-4 space-y-2"></div>
            <div class="p-4 border-t border-gray-700/50">
              <form id="chatForm" class="flex gap-2">
                <input type="text" id="chatInput" placeholder="Type your guess..." class="flex-1 px-3 py-2 bg-gray-800/80 border border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-white text-sm placeholder-gray-500" maxlength="50"/>
                <button type="submit" class="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-xl transition-all">➤</button>
              </form>
            </div>
          </div>
        </div>
      </div>
    `

    this.setupCanvas()
    this.setupEventListeners()
    this.updatePlayersList()
    this.updateStartButton()
  }

  setupCanvas() {
    this.canvas = document.getElementById('gameCanvas')
    this.ctx = this.canvas.getContext('2d')
    this.ctx.lineCap = 'round'
    this.ctx.lineJoin = 'round'
    this.strokes = []
    this.clearCanvas()

    const cursorLayer = document.createElement('div')
    cursorLayer.id = 'remoteCursors'
    this.canvas.parentElement.appendChild(cursorLayer)

    this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e))
    this.canvas.addEventListener('mousemove', (e) => this.draw(e))
    this.canvas.addEventListener('mouseup', () => this.stopDrawing())
    this.canvas.addEventListener('mouseout', () => {
      this.stopDrawing()
      if (this.socket) {
        this.socket.send(JSON.stringify({ type: 'cursor-leave' }))
      }
    })

    this.canvas.addEventListener('touchstart', (e) => { e.preventDefault(); this.handleTouch(e, 'start') })
    this.canvas.addEventListener('touchmove', (e) => { e.preventDefault(); this.handleTouch(e, 'move') })
    this.canvas.addEventListener('touchend', (e) => { e.preventDefault(); this.stopDrawing() })
  }

  handleTouch(e, phase) {
    const touch = e.touches[0]
    if (!touch) return
    const mouseEvent = new MouseEvent(phase === 'start' ? 'mousedown' : 'mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY,
    })
    this.canvas.dispatchEvent(mouseEvent)
  }

  setupEventListeners() {
    document.getElementById('colorPicker').addEventListener('input', (e) => {
      this.state.brushColor = e.target.value
      this.state.isEraser = false
      document.getElementById('eraserBtn').classList.remove('bg-purple-600')
    })

    const bs = document.getElementById('brushSize')
    const bsv = document.getElementById('brushSizeValue')
    bs.addEventListener('input', (e) => {
      this.state.brushSize = parseInt(e.target.value)
      bsv.textContent = e.target.value
    })

    document.getElementById('eraserBtn').addEventListener('click', () => {
      this.state.isEraser = !this.state.isEraser
      document.getElementById('eraserBtn').classList.toggle('bg-purple-600', this.state.isEraser)
    })

    document.getElementById('fillBtn').addEventListener('click', () => {
      if (!this.state.isDrawer) {
        this.showFeedback('Only the drawer can use the fill tool')
        return
      }
      this.fillMode = !this.fillMode
      document.getElementById('fillBtn').classList.toggle('bg-purple-600', this.fillMode)
      this.showFeedback(this.fillMode ? 'Fill tool enabled' : 'Brush tool enabled')
    })

    document.getElementById('undoBtn').addEventListener('click', () => {
      if (!this.state.isDrawer) return
      this.undoStroke()
      this.socket.send(JSON.stringify({ type: 'undo' }))
    })

    document.getElementById('clearBtn').addEventListener('click', () => {
      if (!this.state.isDrawer) return
      this.clearCanvas()
      this.socket.send(JSON.stringify({ type: 'clear' }))
    })

    document.getElementById('chatForm').addEventListener('submit', (e) => {
      e.preventDefault()
      const input = document.getElementById('chatInput')
      const msg = input.value.trim()
      if (msg) {
        this.socket.send(JSON.stringify({ type: 'chat', message: msg }))
        input.value = ''
      }
    })

    document.getElementById('startGame').addEventListener('click', () => {
      this.socket.send(JSON.stringify({ type: 'start-game' }))
    })

    document.getElementById('leaveRoom').addEventListener('click', () => this.leaveRoom())
  }

  getMousePos(e) {
    const r = this.canvas.getBoundingClientRect()
    const scaleX = this.canvas.width / r.width
    const scaleY = this.canvas.height / r.height
    return {
      x: (e.clientX - r.left) * scaleX,
      y: (e.clientY - r.top) * scaleY,
    }
  }

  startDrawing(e) {
    if (!this.state.drawingEnabled) {
      this.showFeedback('Wait for your turn to draw')
      return
    }

    const pos = this.getMousePos(e)

    if (this.fillMode) {
      const color = this.state.isEraser ? '#ffffff' : this.state.brushColor
      this.fillAt(pos, color)
      this.socket.send(JSON.stringify({ type: 'fill', point: pos, color }))
      return
    }

    this.isDrawing = true
    const color = this.state.isEraser ? '#ffffff' : this.state.brushColor
    this.sendStrokeStart(pos, color, this.state.brushSize)
  }

  draw(e) {
    if (!this.state.drawingEnabled) return

    const now = Date.now()
    if (now - this.lastCursorBroadcast > 50) {
      this.lastCursorBroadcast = now
      const pos = this.getMousePos(e)
      this.socket.send(JSON.stringify({
        type: 'cursor',
        point: pos,
      }))
    }

    if (!this.isDrawing) return
    const pos = this.getMousePos(e)
    this.sendStrokeMove(pos)
    if (this.currentStroke) {
      this.redrawCanvas()
    }
  }

  stopDrawing() {
    if (this.isDrawing) {
      this.isDrawing = false
      this.currentStroke = null
    }
  }

  updateRemoteCursor(msg) {
    const cursorLayer = document.getElementById('remoteCursors')
    if (!cursorLayer) return

    let cursor = this.remoteCursors.get(msg.senderId)
    if (!cursor) {
      cursor = document.createElement('div')
      cursor.className = 'remote-cursor'
      cursor.innerHTML = '<span class="remote-cursor-dot"></span><span class="remote-cursor-label"></span>'
      cursorLayer.appendChild(cursor)
      this.remoteCursors.set(msg.senderId, cursor)
    }
    cursor.style.left = `${(msg.point.x / this.canvas.width) * 100}%`
    cursor.style.top = `${(msg.point.y / this.canvas.height) * 100}%`
    cursor.querySelector('.remote-cursor-label').textContent = msg.username
  }

  removeRemoteCursor(playerId) {
    const cursor = this.remoteCursors.get(playerId)
    if (cursor) cursor.remove()
    this.remoteCursors.delete(playerId)
  }

  drawStroke(stroke) {
    if (!stroke.points || stroke.points.length < 2) return
    this.ctx.beginPath()
    this.ctx.strokeStyle = stroke.color
    this.ctx.lineWidth = stroke.size
    this.ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
    for (let i = 1; i < stroke.points.length; i++) {
      this.ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
    }
    this.ctx.stroke()
  }

  redrawCanvas() {
    this.ctx.fillStyle = '#ffffff'
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    for (const stroke of this.strokes) {
      if (stroke.size === -1) {
        this.fillAt(stroke.points[0], stroke.color)
      } else {
        this.drawStroke(stroke)
      }
    }
    if (this.currentStroke) this.drawStroke(this.currentStroke)
  }

  undoStroke() {
    this.strokes.pop()
    this.redrawCanvas()
  }

  clearCanvas() {
    this.strokes = []
    this.currentStroke = null
    this.ctx.fillStyle = '#ffffff'
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }

  fillAt(point, color) {
    const x = Math.floor(point.x)
    const y = Math.floor(point.y)
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return

    const image = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
    const targetIndex = (y * this.canvas.width + x) * 4
    const target = [
      image.data[targetIndex],
      image.data[targetIndex + 1],
      image.data[targetIndex + 2],
      image.data[targetIndex + 3],
    ]
    const replacement = this.hexToRgb(color)
    if (!replacement) return
    if (
      target[0] === replacement[0] &&
      target[1] === replacement[1] &&
      target[2] === replacement[2]
    ) return

    const stack = [[x, y]]
    while (stack.length) {
      const [px, py] = stack.pop()
      if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) continue
      const idx = (py * this.canvas.width + px) * 4
      if (
        image.data[idx] !== target[0] ||
        image.data[idx + 1] !== target[1] ||
        image.data[idx + 2] !== target[2] ||
        image.data[idx + 3] !== target[3]
      ) continue
      image.data[idx] = replacement[0]
      image.data[idx + 1] = replacement[1]
      image.data[idx + 2] = replacement[2]
      image.data[idx + 3] = 255
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1])
    }
    this.ctx.putImageData(image, 0, 0)
  }

  hexToRgb(hex) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return match
      ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)]
      : null
  }

  updateTimer(timeLeft) {
    const el = document.getElementById('timerDisplay')
    if (el) el.textContent = timeLeft > 0 ? timeLeft : ''
  }

  updateWordDisplay() {
    const el = document.getElementById('wordDisplay')
    if (!el) return
    if (this.state.isDrawer && this.currentWord) {
      el.innerHTML = `
        <p class="text-gray-400 text-xs uppercase tracking-wider mb-2">✨ Your Word</p>
        <p class="text-2xl font-bold gradient-text">${this.currentWord}</p>
        <p class="text-gray-500 text-xs mt-3">🎨 Draw this!</p>
      `
    } else if (this.currentWord) {
      el.innerHTML = `
        <p class="text-gray-400 text-xs uppercase tracking-wider mb-2">🤔 Guess the Word</p>
        <p class="text-2xl font-bold text-gray-600">${'_'.repeat(this.currentWord.length)}</p>
        <p class="text-gray-500 text-xs mt-3">💬 Type in chat!</p>
      `
    }
  }

  showWordToDrawer(word) {
    this.currentWord = word
    this.updateWordDisplay()
  }

  showWordHint(length) {
    const el = document.getElementById('wordDisplay')
    if (el) {
      el.innerHTML = `
        <p class="text-gray-400 text-xs uppercase tracking-wider mb-2">🤔 Guess the Word</p>
        <p class="text-2xl font-bold text-gray-600">${'_'.repeat(length)}</p>
        <p class="text-gray-500 text-xs mt-3">💬 Type in chat!</p>
      `
    }
  }

  updateTurnStatus() {
    let status = document.getElementById('turnStatus')
    if (!status) {
      const wordPanel = document.getElementById('wordDisplay')
      if (!wordPanel) return
      status = document.createElement('div')
      status.id = 'turnStatus'
      wordPanel.parentElement.insertBefore(status, wordPanel)
    }
    if (this.state.isDrawer) {
      status.textContent = 'Your turn to draw'
      status.className = 'turn-status your-turn'
    } else if (this.drawerId && this.state.players[this.drawerId]) {
      status.textContent = `${this.state.players[this.drawerId].username} is drawing`
      status.className = 'turn-status'
    } else {
      status.textContent = 'Waiting for round to start'
      status.className = 'turn-status'
    }
  }

  updateStartButton() {
    const button = document.getElementById('startGame')
    if (!button) return
    button.classList.toggle('hidden', !this.state.isHost)
  }

  updatePlayersList() {
    const el = document.getElementById('playersList')
    if (!el) return
    const myId = this.getPlayerId()
    el.innerHTML = Object.entries(this.state.players).map(([id, p]) => `
      <div class="flex items-center justify-between glass rounded-xl px-3 py-2 border ${id === myId ? 'border-purple-500/50 bg-purple-500/10' : 'border-gray-700/50'}">
        <span class="text-gray-300 text-sm truncate flex-1">
          ${p.username}
          ${p.isHost ? '<span class="text-xs text-pink-400">(Host)</span>' : ''}
          ${id === myId ? '<span class="text-xs text-purple-400">(You)</span>' : ''}
        </span>
        <span class="text-purple-400 font-semibold text-sm ml-2">${p.score || 0}</span>
      </div>
    `).join('')
  }

  updateChat() {
    const el = document.getElementById('chatMessages')
    if (!el) return
    el.innerHTML = this.state.chatMessages.map((m) =>
      m.isSystem
        ? `<p class="text-gray-500 text-xs italic text-center py-1">${m.message}</p>`
        : `<div class="${m.username === this.state.username ? 'text-right' : ''}">
            <span class="text-xs font-semibold text-purple-400">${m.username}</span>
            <p class="text-gray-300 text-sm break-words">${m.message}</p>
          </div>`
    ).join('')
    el.scrollTop = el.scrollHeight
  }

  addSystemMessage(msg) {
    this.state.chatMessages.push({ username: 'System', message: msg, isSystem: true })
    this.updateChat()
  }

  showFeedback(message) {
    let toast = document.getElementById('feedbackToast')
    if (!toast) {
      toast = document.createElement('div')
      toast.id = 'feedbackToast'
      document.body.appendChild(toast)
    }
    toast.className = 'feedback-toast accent'
    toast.textContent = message
    clearTimeout(this.feedbackTimer)
    requestAnimationFrame(() => toast.classList.add('visible'))
    this.feedbackTimer = setTimeout(() => toast.classList.remove('visible'), 2200)
  }

  getPlayerId() {
    return this.socket?.id || this.state.currentPlayer || ''
  }

  leaveRoom() {
    if (this.socket) {
      try { this.socket.send(JSON.stringify({ type: 'cursor-leave' })) } catch (e) {}
      this.socket.close()
    }
    if (this.directoryBeacon) {
      try { this.directoryBeacon.close() } catch (e) {}
      this.directoryBeacon = null
    }
    localStorage.removeItem('doodl_room_code')
    this.router.navigate('/')
  }

  destroy() {
    if (this.socket) {
      try { this.socket.close() } catch (e) {}
    }
    if (this.directoryBeacon) {
      try { this.directoryBeacon.close() } catch (e) {}
    }
  }
}