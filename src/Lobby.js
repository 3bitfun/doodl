export default class Lobby {
  constructor(app, state, router) {
    this.app = app
    this.state = state
    this.router = router
    this.lobbyChannel = null
    this.openRooms = {}
    this.render()
    this.attachEventListeners()
    this.initLobbyChannel()
  }

  render() {
    this.app.innerHTML = `
      <div class="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        <!-- Background decoration -->
        <div class="absolute inset-0 overflow-hidden pointer-events-none">
          <div class="absolute -top-40 -right-40 w-80 h-80 bg-purple-600/20 rounded-full blur-3xl animate-pulse"></div>
          <div class="absolute -bottom-40 -left-40 w-80 h-80 bg-pink-600/20 rounded-full blur-3xl animate-pulse" style="animation-delay: 1s;"></div>
        </div>
        
        <div class="glass rounded-2xl shadow-2xl p-8 w-full max-w-md border border-gray-700/50 relative z-10">
          <div class="text-center mb-8">
            <h1 class="text-6xl font-bold gradient-text mb-2 animate-float">doodl</h1>
            <p class="text-gray-400 text-lg">Draw & Guess Game</p>
          </div>
          
          <div class="space-y-6">
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">Username</label>
              <input 
                type="text" 
                id="username" 
                placeholder="Enter your name"
                class="w-full px-4 py-3 bg-gray-800/80 border border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-white placeholder-gray-500 transition-all duration-200 hover:border-gray-500"
                maxlength="12"
              />
            </div>
            
            <div class="border-t border-gray-700/50 pt-6">
              <button 
                id="createRoom"
                class="w-full py-4 px-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-xl transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg hover:shadow-purple-500/25 mb-4 relative overflow-hidden group"
              >
                <span class="relative z-10">✨ Create New Room</span>
                <div class="shimmer absolute inset-0"></div>
              </button>
              
              <div class="relative my-6">
                <div class="absolute inset-0 flex items-center">
                  <div class="w-full border-t border-gray-700/50"></div>
                </div>
                <div class="relative flex justify-center text-sm">
                  <span class="px-4 bg-[#1a1a3e] text-gray-400">OR</span>
                </div>
              </div>
              
              <div class="flex gap-3">
                <input 
                  type="text" 
                  id="roomCode" 
                  placeholder="Room Code"
                  class="flex-1 px-4 py-3 bg-gray-800/80 border border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-white placeholder-gray-500 transition-all duration-200 uppercase tracking-wider hover:border-gray-500"
                  maxlength="6"
                />
                <button 
                  id="joinRoom"
                  class="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl transition-all duration-200 hover:shadow-lg"
                >
                  Join
                </button>
              </div>
            </div>

            <div class="border-t border-gray-700/50 pt-6">
              <div class="flex items-center justify-between mb-3">
                <h2 class="text-sm font-semibold text-gray-300">Open Rooms</h2>
                <span id="roomCount" class="text-xs text-gray-500">0 available</span>
              </div>
              <div id="openRooms" class="space-y-2 max-h-48 overflow-y-auto">
                <p class="text-sm text-gray-500 text-center py-3">Looking for open rooms...</p>
              </div>
            </div>
            
            <div id="error" class="hidden bg-red-500/10 border border-red-500/50 text-red-400 text-center text-sm mt-4 p-3 rounded-lg"></div>
          </div>
          
          <div class="mt-8 text-center text-xs text-gray-500">
            <p>🚀 Powered by Supabase Realtime</p>
          </div>
        </div>
      </div>
    `
  }

  initLobbyChannel() {
    if (!this.state.supabase) {
      this.updateOpenRooms()
      return
    }

    this.lobbyChannel = this.state.supabase
      .channel('doodl-lobby')
      .on('presence', { event: 'sync' }, () => {
        this.openRooms = this.getRoomsFromPresence()
        this.updateOpenRooms()
      })
      .subscribe()
  }

  getRoomsFromPresence() {
    const presence = this.lobbyChannel.presenceState()
    return Object.fromEntries(Object.entries(presence).map(([roomCode, entries]) => {
      const room = entries[entries.length - 1] || {}
      return [roomCode, {
        host: room.host || 'Anonymous',
        players: entries.length
      }]
    }))
  }

  updateOpenRooms() {
    const roomsEl = document.getElementById('openRooms')
    const countEl = document.getElementById('roomCount')
    if (!roomsEl || !countEl) return

    const rooms = Object.entries(this.openRooms)
    countEl.textContent = `${rooms.length} available`
    roomsEl.innerHTML = rooms.length
      ? rooms.map(([roomCode, room]) => `
          <button data-room-code="${roomCode}" class="w-full flex items-center justify-between gap-3 px-3 py-2 bg-gray-800/60 border border-gray-700/50 rounded-lg text-left hover:border-purple-500/60 hover:bg-purple-500/10 transition-all">
            <span class="min-w-0"><span class="block font-mono text-purple-400 tracking-wider">${roomCode}</span><span class="block text-xs text-gray-500 truncate">${room.host}'s room</span></span>
            <span class="shrink-0 text-xs text-gray-400">${room.players} ${room.players === 1 ? 'player' : 'players'}</span>
          </button>`).join('')
      : '<p class="text-sm text-gray-500 text-center py-3">No open rooms yet</p>'

    roomsEl.querySelectorAll('[data-room-code]').forEach((button) => {
      button.addEventListener('click', () => {
        const roomCodeInput = document.getElementById('roomCode')
        roomCodeInput.value = button.dataset.roomCode
        document.getElementById('joinRoom').click()
      })
    })
  }

  attachEventListeners() {
    const usernameInput = document.getElementById('username')
    const roomCodeInput = document.getElementById('roomCode')
    const createRoomBtn = document.getElementById('createRoom')
    const joinRoomBtn = document.getElementById('joinRoom')
    const errorDiv = document.getElementById('error')

    const showError = (msg) => {
      errorDiv.textContent = msg
      errorDiv.classList.remove('hidden')
      setTimeout(() => errorDiv.classList.add('hidden'), 3000)
    }

    const generateRoomCode = () => {
      return Math.random().toString(36).substring(2, 8).toUpperCase()
    }

    createRoomBtn.addEventListener('click', async () => {
      const username = usernameInput.value.trim()
      if (!username) {
        showError('⚠️ Please enter a username')
        usernameInput.focus()
        return
      }

      const roomCode = generateRoomCode()
      this.state.username = username
      this.state.roomCode = roomCode
      
      // Store in localStorage for persistence
      localStorage.setItem('doodl_username', username)
      
      this.router.navigate('/room')
    })

    joinRoomBtn.addEventListener('click', async () => {
      const username = usernameInput.value.trim()
      const roomCode = roomCodeInput.value.trim().toUpperCase()
      
      if (!username) {
        showError('⚠️ Please enter a username')
        usernameInput.focus()
        return
      }
      
      if (!roomCode || roomCode.length !== 6) {
        showError('⚠️ Please enter a valid 6-character room code')
        roomCodeInput.focus()
        return
      }

      this.state.username = username
      this.state.roomCode = roomCode
      
      localStorage.setItem('doodl_username', username)
      
      this.router.navigate('/room')
    })

    // Load saved username
    const savedUsername = localStorage.getItem('doodl_username')
    if (savedUsername) {
      usernameInput.value = savedUsername
    }

    // Allow Enter key to submit
    usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        createRoomBtn.click()
      }
    })
    
    roomCodeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        joinRoomBtn.click()
      }
    })
    
    // Auto-uppercase room code input
    roomCodeInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase()
    })
  }

  destroy() {
    if (this.lobbyChannel) this.lobbyChannel.unsubscribe()
  }
}
