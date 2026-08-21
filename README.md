# doodl - Draw & Guess Game

A real-time multiplayer drawing and guessing game built with Vite, vanilla JavaScript, Tailwind CSS, and Supabase Realtime Broadcast.

## Features

- 🎨 **Real-time Drawing**: HTML5 canvas with smooth stroke synchronization across all players
- 🎯 **Multiplayer Gameplay**: Join rooms with friends using 6-character room codes
- 💬 **Live Chat**: Type guesses in real-time chat panel
- 🏆 **Scoring System**: Points awarded for correct guesses and successful drawings
- 🌓 **Dark Mode UI**: Clean, modern dark theme styled with Tailwind CSS
- 📱 **Touch Support**: Works on mobile devices with touch events

## Tech Stack

- **Vite** - Fast build tool and dev server
- **Vanilla JavaScript** - No framework overhead
- **Tailwind CSS** - Utility-first styling
- **Supabase Realtime** - Zero-backend WebSocket synchronization

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- A Supabase account (free tier works)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/3bitfun/doodl.git
cd doodl
```

2. Install dependencies:
```bash
npm install
```

3. Set up Supabase:
   - Go to [supabase.com](https://supabase.com) and create a free project
   - Get your project URL and anon key from Settings > API
   - Edit `src/main.js` and replace:
     ```javascript
     const SUPABASE_URL = 'YOUR_SUPABASE_URL'
     const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'
     ```

4. Start development server:
```bash
npm run dev
```

5. Open your browser to `http://localhost:5173`

## How to Play

1. Enter your username on the landing page
2. Create a new room or join an existing one with a room code
3. Share the room code with friends
4. Take turns being the drawer:
   - **Drawer**: See the word and draw it on the canvas
   - **Guesser**: Watch the drawing and type your guess in chat
5. First to guess correctly earns points based on speed
6. After 3 rounds, the player with the most points wins!

## Controls

- **Mouse/Touch**: Draw on the canvas
- **Color Picker**: Choose brush color
- **Size Slider**: Adjust brush size (1-50)
- **Eraser**: Toggle eraser mode
- **Clear**: Clear the canvas (drawer only)
- **Chat**: Type guesses and messages

## Deployment to GitHub Pages

1. Update `package.json` with your GitHub info:
```json
{
  "name": "doodl",
  "base": "/doodl/"
}
```

2. Build the project:
```bash
npm run build
```

3. Deploy to GitHub Pages:
```bash
npm install --save-dev gh-pages
npx gh-pages -d dist
```

4. Enable GitHub Pages in your repository settings:
   - Go to Settings > Pages
   - Select "gh-pages" branch as source
   - Your site will be live at `https://3bitfun.github.io/doodl/`

## Project Structure

```
doodl/
├── index.html          # Main HTML entry point
├── src/
│   ├── main.js         # App initialization and router
│   ├── style.css       # Tailwind CSS imports
│   ├── Lobby.js        # Landing/lobby view component
│   └── GameRoom.js     # Game room component with canvas
├── public/             # Static assets
├── package.json        # Dependencies and scripts
├── vite.config.js      # Vite configuration
├── tailwind.config.js  # Tailwind configuration
└── README.md           # This file
```

## Game Rules

- Each round lasts 60 seconds
- Random player is selected as drawer each round
- Drawer sees the word and must draw it
- Guessers type in chat to guess the word
- Points:
  - Correct guess: 10-30 points (based on speed)
  - Successful drawing: 5 points per correct guesser
- 3 rounds per game
- Highest score wins!

## Word List

The game includes 60+ words across categories:
- Animals (cat, dog, tiger, elephant...)
- Objects (house, car, phone, guitar...)
- Food (pizza, cake, apple, banana...)
- Nature (tree, sun, moon, rainbow...)
- Sports (soccer, basketball, tennis...)
- And more!

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT License - feel free to use this project for learning or fun!

## Credits

Built with ❤️ using:
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Supabase](https://supabase.com/)
