import './style.css'
import GameRoom from './GameRoom.js'
import Lobby from './Lobby.js'

// Simple hash router
class Router {
  constructor() {
    this.routes = {}
    this.currentRoute = null
    window.addEventListener('hashchange', () => this.handleRoute())
  }

  addRoute(path, handler) {
    this.routes[path] = handler
  }

  handleRoute() {
    const hash = window.location.hash.slice(1) || '/'
    const handler = this.routes[hash] || this.routes['/']

    if (handler) {
      if (this.currentRoute && this.currentRoute.destroy) {
        this.currentRoute.destroy()
      }
      this.currentRoute = handler()
    }
  }

  navigate(path) {
    window.location.hash = path
  }
}

// App state — no supabase anymore
const state = {
  username: localStorage.getItem('doodl_username') || '',
  roomCode: localStorage.getItem('doodl_room_code') || '',
  isHost: localStorage.getItem('doodl_host_room') === localStorage.getItem('doodl_room_code'),
  players: {},
  currentPlayer: null,
  isDrawer: false,
  currentWord: '',
  scores: {},
  round: 1,
  maxRounds: 3,
  drawingEnabled: false,
  brushColor: '#000000',
  brushSize: 5,
  isEraser: false,
  strokes: [],
  chatMessages: [],
  guessedWords: new Set(),
}

const app = document.getElementById('app')
const router = new Router()

router.addRoute('/', () => new Lobby(app, state, router))
router.addRoute('/room', () => new GameRoom(app, state, router))

if (!window.location.hash) {
  window.location.hash = '/'
}

router.handleRoute()

export { state }