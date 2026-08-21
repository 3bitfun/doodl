export default class Lobby {
  constructor(app, state, router) {
    this.app = app
    this.state = state
    this.router = router
    this.render()
    this.attachEventListeners()
  }

  render() {
    this.app.innerHTML = `
      <div class="min-h-screen flex items-center justify-center p-4">
        <div class="bg-gray-800 rounded-xl shadow-2xl p-8 w-full max-w-md border border-gray-700">
          <div class="text-center mb-8">
            <h1 class="text-5xl font-bold text-purple-400 mb-2">doodl</h1>
            <p class="text-gray-400">Draw & Guess Game</p>
          </div>
          
          <div class="space-y-6">
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">Username</label>
              <input 
                type="text" 
                id="username" 
                placeholder="Enter your name"
                class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-white placeholder-gray-400"
                maxlength="12"
              />
            </div>
            
            <div class="border-t border-gray-700 pt-6">
              <button 
                id="createRoom"
                class="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-lg transition-all duration-200 transform hover:scale-[1.02] mb-4"
              >
                Create New Room
              </button>
              
              <div class="relative my-6">
                <div class="absolute inset-0 flex items-center">
                  <div class="w-full border-t border-gray-700"></div>
                </div>
                <div class="relative flex justify-center text-sm">
                  <span class="px-4 bg-gray-800 text-gray-400">OR</span>
                </div>
              </div>
              
              <div class="flex gap-3">
                <input 
                  type="text" 
                  id="roomCode" 
                  placeholder="Room Code"
                  class="flex-1 px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-white placeholder-gray-400 uppercase"
                  maxlength="6"
                />
                <button 
                  id="joinRoom"
                  class="px-6 py-3 bg-gray-600 hover:bg-gray-500 text-white font-semibold rounded-lg transition-all duration-200"
                >
                  Join
                </button>
              </div>
            </div>
            
            <div id="error" class="hidden text-red-400 text-center text-sm mt-4"></div>
          </div>
          
          <div class="mt-8 text-center text-xs text-gray-500">
            <p>Powered by Supabase Realtime</p>
          </div>
        </div>
      </div>
    `
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
    }

    const generateRoomCode = () => {
      return Math.random().toString(36).substring(2, 8).toUpperCase()
    }

    createRoomBtn.addEventListener('click', async () => {
      const username = usernameInput.value.trim()
      if (!username) {
        showError('Please enter a username')
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
        showError('Please enter a username')
        return
      }
      
      if (!roomCode || roomCode.length !== 6) {
        showError('Please enter a valid 6-character room code')
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
    roomCodeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        joinRoomBtn.click()
      }
    })
  }

  destroy() {
    // Cleanup if needed
  }
}
