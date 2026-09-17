import type * as Party from "partykit/server";

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DIRECTORY_ROOM = "__directory__";

const WORDS = [
  "cat","dog","house","tree","car","sun","moon","star","fish","bird",
  "book","chair","table","phone","computer","pizza","cake","apple",
  "banana","orange","grape","cherry","flower","mountain","river","ocean",
  "beach","forest","desert","rainbow","cloud","lightning","snowflake",
  "fire","water","bicycle","airplane","train","boat","rocket","balloon",
  "guitar","piano","drum","trumpet","violin","camera","soccer","basketball",
  "tennis","baseball","football","hockey","tiger","lion","elephant",
  "giraffe","monkey","penguin","robot","alien","ghost","witch","wizard",
  "dragon","unicorn"
];

const ROUND_TIME = 60;
const MAX_ROUNDS = 3;
const REVEAL_TIME = 5000;

// ═══════════════════════════════════════════════════════════════
//  DIRECTORY SERVER — tracks active game rooms
// ═══════════════════════════════════════════════════════════════

type RoomEntry = {
  code: string;
  host: string;
  players: number;
};

class DirectoryServer {
  rooms = new Map<string, RoomEntry>();
  // Maps connection id -> room code, so we know what to clean up
  beacons = new Map<string, string>();

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    conn.send(
      JSON.stringify({
        type: "rooms",
        rooms: [...this.rooms.values()],
      })
    );
  }

  onMessage(raw: string, sender: Party.Connection) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "register":
        this.beacons.set(sender.id, msg.code);
        this.rooms.set(msg.code, {
          code: msg.code,
          host: msg.host || "Anonymous",
          players: msg.players || 1,
        });
        this.broadcast();
        break;

      case "update": {
        const existing = this.rooms.get(msg.code);
        if (existing) {
          existing.players = msg.players;
          if (msg.host) existing.host = msg.host;
          this.broadcast();
        }
        break;
      }
    }
  }

  onClose(conn: Party.Connection) {
    const code = this.beacons.get(conn.id);
    if (code) {
      this.beacons.delete(conn.id);
      this.rooms.delete(code);
      this.broadcast();
    }
  }

  broadcast() {
    this.room.broadcast(
      JSON.stringify({
        type: "rooms",
        rooms: [...this.rooms.values()],
      })
    );
  }
}

// ═══════════════════════════════════════════════════════════════
//  GAME SERVER — the actual doodl game
// ═══════════════════════════════════════════════════════════════

type Player = {
  id: string;
  username: string;
  score: number;
  isHost: boolean;
};

type Stroke = {
  points: { x: number; y: number }[];
  color: string;
  size: number;
};

type Phase = "lobby" | "playing" | "reveal" | "ended";

class GameServer {
  players = new Map<string, Player>();
  drawerId: string | null = null;
  currentWord = "";
  round = 0;
  timeLeft = ROUND_TIME;
  phase: Phase = "lobby";
  strokes: Stroke[] = [];
  guessedPlayers = new Set<string>();
  hostId: string | null = null;
  timer: ReturnType<typeof setInterval> | null = null;
  revealTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    conn.send(
      JSON.stringify({
        type: "state",
        state: this.getPublicState(),
      })
    );
  }

  onMessage(raw: string, sender: Party.Connection) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "join":
        this.handleJoin(sender, msg.username);
        break;

      case "start-game":
        if (sender.id === this.hostId && this.phase === "lobby") {
          this.startRound();
        }
        break;

      case "stroke":
        if (sender.id !== this.drawerId) return;
        this.strokes.push(msg.stroke);
        this.room.broadcast(
          JSON.stringify({
            type: "stroke",
            stroke: msg.stroke,
            senderId: sender.id,
          }),
          [sender.id]
        );
        break;

      case "cursor":
        if (sender.id !== this.drawerId) return;
        this.room.broadcast(
          JSON.stringify({
            type: "cursor",
            senderId: sender.id,
            username: this.players.get(sender.id)?.username || "Player",
            point: msg.point,
          }),
          [sender.id]
        );
        break;

      case "cursor-leave":
        this.room.broadcast(
          JSON.stringify({
            type: "cursor-leave",
            senderId: sender.id,
          }),
          [sender.id]
        );
        break;

      case "fill":
        if (sender.id !== this.drawerId) return;
        this.strokes.push({
          points: [msg.point],
          color: msg.color,
          size: -1,
        });
        this.room.broadcast(
          JSON.stringify({
            type: "fill",
            point: msg.point,
            color: msg.color,
            senderId: sender.id,
          }),
          [sender.id]
        );
        break;

      case "undo":
        if (sender.id !== this.drawerId) return;
        this.strokes.pop();
        this.room.broadcast(JSON.stringify({ type: "undo" }), [sender.id]);
        break;

      case "clear":
        if (sender.id !== this.drawerId) return;
        this.strokes = [];
        this.room.broadcast(JSON.stringify({ type: "clear" }), [sender.id]);
        break;

      case "chat":
        this.handleChat(sender, msg.message);
        break;
    }
  }

  onClose(conn: Party.Connection) {
    const player = this.players.get(conn.id);
    this.players.delete(conn.id);

    if (player) {
      this.room.broadcast(
        JSON.stringify({
          type: "system",
          message: `👋 ${player.username} left`,
        })
      );
    }

    this.room.broadcast(
      JSON.stringify({
        type: "cursor-leave",
        senderId: conn.id,
      })
    );

    if (conn.id === this.hostId) {
      const remaining = [...this.players.values()];
      if (remaining.length > 0) {
        remaining[0].isHost = true;
        this.hostId = remaining[0].id;
        this.room.broadcast(
          JSON.stringify({
            type: "system",
            message: `👑 ${remaining[0].username} is now the host`,
          })
        );
      }
    }

    if (conn.id === this.drawerId && this.phase === "playing") {
      this.endRound();
    }

    this.broadcastState();
  }

  handleJoin(sender: Party.Connection, username: string) {
    const isFirst = this.players.size === 0;
    const player: Player = {
      id: sender.id,
      username: username || "Anonymous",
      score: 0,
      isHost: isFirst,
    };

    if (isFirst) this.hostId = sender.id;

    this.players.set(sender.id, player);

    this.room.broadcast(
      JSON.stringify({
        type: "system",
        message: `🎉 ${player.username} joined`,
      })
    );

    this.broadcastState();
  }

  handleChat(sender: Party.Connection, text: string) {
    const player = this.players.get(sender.id);
    if (!player) return;

    const trimmed = text.trim().toLowerCase();
    const isDrawer = sender.id === this.drawerId;
    const alreadyGuessed = this.guessedPlayers.has(sender.id);

    if (
      this.phase === "playing" &&
      !isDrawer &&
      !alreadyGuessed &&
      trimmed === this.currentWord.toLowerCase()
    ) {
      const points = Math.max(
        10,
        Math.round(30 - (ROUND_TIME - this.timeLeft))
      );
      player.score += points;
      this.guessedPlayers.add(sender.id);

      this.room.broadcast(
        JSON.stringify({
          type: "correct-guess",
          playerId: sender.id,
          username: player.username,
          points,
        })
      );

      const drawer = this.drawerId ? this.players.get(this.drawerId) : null;
      if (drawer) drawer.score += 5;

      this.broadcastState();

      const guessers = [...this.players.keys()].filter(
        (id) => id !== this.drawerId
      );
      if (
        guessers.length > 0 &&
        guessers.every((id) => this.guessedPlayers.has(id))
      ) {
        setTimeout(() => this.endRound(), 1000);
      }
      return;
    }

    this.room.broadcast(
      JSON.stringify({
        type: "chat",
        playerId: sender.id,
        username: player.username,
        message: text,
      })
    );
  }

  startRound() {
    if (this.timer) clearInterval(this.timer);
    if (this.revealTimer) clearTimeout(this.revealTimer);

    this.round++;
    this.strokes = [];
    this.guessedPlayers.clear();
    this.timeLeft = ROUND_TIME;
    this.phase = "playing";

    const ids = [...this.players.keys()];
    if (ids.length === 0) return;
    const idx = (this.round - 1) % ids.length;
    this.drawerId = ids[idx];

    this.currentWord = WORDS[Math.floor(Math.random() * WORDS.length)];

    for (const conn of this.room.getConnections()) {
      const isDrawer = conn.id === this.drawerId;
      conn.send(
        JSON.stringify({
          type: "round-start",
          round: this.round,
          maxRounds: MAX_ROUNDS,
          drawerId: this.drawerId,
          drawerName: this.players.get(this.drawerId)?.username,
          word: isDrawer ? this.currentWord : null,
          wordLength: this.currentWord.length,
          timeLeft: ROUND_TIME,
        })
      );
    }

    this.broadcastState();

    this.timer = setInterval(() => {
      this.timeLeft--;
      this.room.broadcast(
        JSON.stringify({
          type: "tick",
          timeLeft: this.timeLeft,
        })
      );
      if (this.timeLeft <= 0) this.endRound();
    }, 1000);
  }

  endRound() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.phase = "reveal";

    this.room.broadcast(
      JSON.stringify({
        type: "round-end",
        word: this.currentWord,
        scores: Object.fromEntries(
          [...this.players].map(([id, p]) => [id, p.score])
        ),
        round: this.round,
        maxRounds: MAX_ROUNDS,
      })
    );

    this.revealTimer = setTimeout(() => {
      if (this.round >= MAX_ROUNDS) {
        this.phase = "ended";
        this.room.broadcast(
          JSON.stringify({
            type: "game-over",
            scores: Object.fromEntries(
              [...this.players].map(([id, p]) => [id, p.score])
            ),
            players: Object.fromEntries(
              [...this.players].map(([id, p]) => [
                id,
                { username: p.username },
              ])
            ),
          })
        );
      } else {
        this.startRound();
      }
    }, REVEAL_TIME);
  }

  getPublicState() {
    return {
      players: Object.fromEntries([...this.players].map(([id, p]) => [id, p])),
      drawerId: this.drawerId,
      round: this.round,
      maxRounds: MAX_ROUNDS,
      phase: this.phase,
      timeLeft: this.timeLeft,
      hostId: this.hostId,
      strokes: this.strokes,
    };
  }

  broadcastState() {
    this.room.broadcast(
      JSON.stringify({
        type: "state",
        state: this.getPublicState(),
      })
    );
  }
}

// ═══════════════════════════════════════════════════════════════
//  DISPATCHER — routes to DirectoryServer or GameServer by room id
// ═══════════════════════════════════════════════════════════════

export default class Dispatcher implements Party.Server {
  private impl: DirectoryServer | GameServer;

  constructor(readonly room: Party.Room) {
    if (room.id === DIRECTORY_ROOM) {
      this.impl = new DirectoryServer(room);
    } else {
      this.impl = new GameServer(room);
    }
  }

  onConnect(conn: Party.Connection) {
    return (this.impl as any).onConnect(conn);
  }

  onMessage(message: string, sender: Party.Connection) {
    return (this.impl as any).onMessage(message, sender);
  }

  onClose(conn: Party.Connection) {
    return (this.impl as any).onClose(conn);
  }
}