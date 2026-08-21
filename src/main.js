import './style.css'
import { createClient } from '@supabase/supabase-js'
import GameRoom from './GameRoom.js'
import Lobby from './Lobby.js'

// Supabase configuration
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Initialize Supabase client
let supabase = null
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  console.log('✅ Supabase client initialized')
} else {
  console.warn('⚠️ Supabase credentials not found. Please check your .env file')
}

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

// App state
const state = {
  username: localStorage.getItem('doodl_username') || '',
  roomCode: localStorage.getItem('doodl_room_code') || '',
  isHost: localStorage.getItem('doodl_host_room') === localStorage.getItem('doodl_room_code'),
  supabase: supabase,
  channel: null,
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
  wordList: [
    'cat', 'dog', 'house', 'tree', 'car', 'sun', 'moon', 'star',
    'fish', 'bird', 'book', 'chair', 'table', 'phone', 'computer',
    'pizza', 'cake', 'apple', 'banana', 'orange', 'grape', 'cherry',
    'flower', 'mountain', 'river', 'ocean', 'beach', 'forest', 'desert',
    'rainbow', 'cloud', 'lightning', 'snowflake', 'fire', 'water',
    'bicycle', 'airplane', 'train', 'boat', 'rocket', 'balloon',
    'guitar', 'piano', 'drum', 'trumpet', 'violin', 'camera',
    'soccer', 'basketball', 'tennis', 'baseball', 'football', 'hockey',
    'tiger', 'lion', 'elephant', 'giraffe', 'monkey', 'penguin',
    'robot', 'alien', 'ghost', 'witch', 'wizard', 'dragon', 'unicorn'
  ]
}

// Main app
const app = document.getElementById('app')

const router = new Router()

router.addRoute('/', () => {
  const lobby = new Lobby(app, state, router)
  return lobby
})

router.addRoute('/room', () => {
  const gameRoom = new GameRoom(app, state, router)
  return gameRoom
})

// Handle initial navigation
if (!window.location.hash) {
  window.location.hash = '/'
}

router.handleRoute()

export { state, supabase }