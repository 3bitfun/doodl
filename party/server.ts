// ═══════════════════════════════════════════════════════════════
//  doodl game server — Cloudflare Durable Object
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
//  TYPES
// ═══════════════════════════════════════════════════════════════

type RoomEntry = {
  code: string;
  host: string;
  players: number;
};

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

// ═══════════════════════════════════════════════════════════════
//  DURABLE OBJECT
// ═══════════════════════════════════════════════════════════════

export class DoodlRoom implements DurableObject {
  private state: DurableObjectState;
  private env: unknown;

  private sockets = new Map<WebSocket, { id: string; player: Player | null }>();

  private players = new Map<string, Player>();
  private drawerId: string | null = null;
  private currentWord = "";
  private round = 0;
  private timeLeft = ROUND_TIME;
  private phase: Phase = "lobby";
  private strokes: Stroke[] = [];
  private currentStroke: Stroke | null = null;
  private guessedPlayers = new Set<string>();
  private hostId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private revealTimer: ReturnType<typeof setTimeout> | null = null;

  // Directory-only state
  private directoryRooms = new Map<string, RoomEntry>();
  private directoryBeacons = new Map<string, string>();
  private roomName = "";

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state;
    this.env = env;
  }

  private isDirectory(): boolean {
    return this.roomName === DIRECTORY_ROOM;
  }

  // ─── WebSocket entry ────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    const match = url.pathname.match(/\/parties\/[^/]+\/(.+)$/);
    if (match) {
      this.roomName = decodeURIComponent(match[1]);
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();

    const id = crypto.randomUUID();
    this.sockets.set(server, { id, player: null });

    server.addEventListener("message", (event: MessageEvent) => {
      const raw = typeof event.data === "string" ? event.data : "";
      if (this.isDirectory()) {
        this.handleDirectoryMessage(server, id, raw);
      } else {
        this.handleGameMessage(server, id, raw);
      }
    });

    server.addEventListener("close", () => {
      if (this.isDirectory()) {
        this.handleDirectoryClose(server, id);
      } else {
        this.handleGameClose(server, id);
      }
    });

    server.addEventListener("error", () => {
      this.sockets.delete(server);
    });

    if (this.isDirectory()) {
      this.send(server, {
        type: "rooms",
        rooms: [...this.directoryRooms.values()],
      });
    } else {
      this.send(server, {
        type: "state",
        state: this.getPublicState(),
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ═══════════════════════════════════════════════════════════════
  //  DIRECTORY
  // ═══════════════════════════════════════════════════════════════

  private handleDirectoryMessage(ws: WebSocket, id: string, raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "register":
        this.directoryBeacons.set(id, msg.code);
        this.directoryRooms.set(msg.code, {
          code: msg.code,
          host: msg.host || "Anonymous",
          players: msg.players || 1,
        });
        this.broadcastDirectory();
        break;

      case "update": {
        const existing = this.directoryRooms.get(msg.code);
        if (existing) {
          existing.players = msg.players;
          if (msg.host) existing.host = msg.host;
          this.broadcastDirectory();
        }
        break;
      }
    }
  }

  private handleDirectoryClose(ws: WebSocket, id: string): void {
    this.sockets.delete(ws);
    const code = this.directoryBeacons.get(id);
    if (code) {
      this.directoryBeacons.delete(id);
      this.directoryRooms.delete(code);
      this.broadcastDirectory();
    }
  }

  private broadcastDirectory(): void {
    const payload = JSON.stringify({
      type: "rooms",
      rooms: [...this.directoryRooms.values()],
    });
    for (const ws of this.sockets.keys()) {
      try {
        ws.send(payload);
      } catch {
        // closed
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  GAME
  // ═══════════════════════════════════════════════════════════════

  private handleGameMessage(ws: WebSocket, id: string, raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "join":
        this.handleJoin(ws, id, msg.username);
        break;

      case "start-game":
        if (id === this.hostId && this.phase === "lobby") {
          this.startRound();
        }
        break;

      case "stroke-start":
        if (id !== this.drawerId) return;
        this.currentStroke = {
          points: [msg.point],
          color: msg.color,
          size: msg.size,
        };
        this.broadcastExcept(ws, {
          type: "stroke-start",
          point: msg.point,
          color: msg.color,
          size: msg.size,
        });
        break;

      case "stroke-move":
        if (id !== this.drawerId) return;
        if (!this.currentStroke) return;
        this.currentStroke.points.push(msg.point);
        this.broadcastExcept(ws, {
          type: "stroke-move",
          point: msg.point,
        });
        break;

      case "stroke-end":
        if (id !== this.drawerId) return;
        if (this.currentStroke) {
          this.strokes.push(this.currentStroke);
          this.currentStroke = null;
        }
        this.broadcastExcept(ws, { type: "stroke-end" });
        break;

      case "cursor":
        if (id !== this.drawerId) return;
        this.broadcastExcept(ws, {
          type: "cursor",
          senderId: id,
          username: this.players.get(id)?.username || "Player",
          point: msg.point,
        });
        break;

      case "cursor-leave":
        this.broadcastExcept(ws, {
          type: "cursor-leave",
          senderId: id,
        });
        break;

      case "fill":
        if (id !== this.drawerId) return;
        this.strokes.push({
          points: [msg.point],
          color: msg.color,
          size: -1,
        });
        this.broadcastExcept(ws, {
          type: "fill",
          point: msg.point,
          color: msg.color,
          senderId: id,
        });
        break;

      case "undo":
        if (id !== this.drawerId) return;
        this.strokes.pop();
        this.broadcastExcept(ws, { type: "undo" });
        break;

      case "clear":
        if (id !== this.drawerId) return;
        this.strokes = [];
        this.currentStroke = null;
        this.broadcastExcept(ws, { type: "clear" });
        break;

      case "chat":
        this.handleChat(ws, id, msg.message);
        break;
    }
  }

  private handleGameClose(ws: WebSocket, id: string): void {
    this.sockets.delete(ws);
    const player = this.players.get(id);
    this.players.delete(id);

    if (player) {
      this.broadcast({
        type: "system",
        message: `👋 ${player.username} left`,
      });
    }

    this.broadcast({ type: "cursor-leave", senderId: id });

    if (id === this.hostId) {
      const remaining = [...this.players.values()];
      if (remaining.length > 0) {
        remaining[0].isHost = true;
        this.hostId = remaining[0].id;
        this.broadcast({
          type: "system",
          message: `👑 ${remaining[0].username} is now the host`,
        });
      }
    }

    if (id === this.drawerId && this.phase === "playing") {
      this.endRound();
    }

    this.broadcastState();
  }

  private handleJoin(ws: WebSocket, id: string, username: string): void {
    const isFirst = this.players.size === 0;
    const player: Player = {
      id,
      username: username || "Anonymous",
      score: 0,
      isHost: isFirst,
    };

    if (isFirst) this.hostId = id;

    this.players.set(id, player);
    this.send(ws, { type: "you", playerId: id });

    const socketInfo = this.sockets.get(ws);
    if (socketInfo) socketInfo.player = player;

    this.broadcast({
      type: "system",
      message: `🎉 ${player.username} joined`,
    });

    this.broadcastState();
  }

  private handleChat(ws: WebSocket, id: string, text: string): void {
    const player = this.players.get(id);
    if (!player) return;

    const trimmed = text.trim().toLowerCase();
    const isDrawer = id === this.drawerId;
    const alreadyGuessed = this.guessedPlayers.has(id);

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
      this.guessedPlayers.add(id);

      this.broadcast({
        type: "correct-guess",
        playerId: id,
        username: player.username,
        points,
      });

      const drawer = this.drawerId ? this.players.get(this.drawerId) : null;
      if (drawer) drawer.score += 5;

      this.broadcastState();

      const guessers = [...this.players.keys()].filter(
        (pid) => pid !== this.drawerId
      );
      if (
        guessers.length > 0 &&
        guessers.every((pid) => this.guessedPlayers.has(pid))
      ) {
        setTimeout(() => this.endRound(), 1000);
      }
      return;
    }

    this.broadcast({
      type: "chat",
      playerId: id,
      username: player.username,
      message: text,
    });
  }

  private startRound(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.revealTimer) clearTimeout(this.revealTimer);

    this.round++;
    this.strokes = [];
    this.currentStroke = null;
    this.guessedPlayers.clear();
    this.timeLeft = ROUND_TIME;
    this.phase = "playing";

    const ids = [...this.players.keys()];
    if (ids.length === 0) return;
    const idx = (this.round - 1) % ids.length;
    this.drawerId = ids[idx];

    this.currentWord = WORDS[Math.floor(Math.random() * WORDS.length)];

    for (const [ws, info] of this.sockets) {
      const isDrawer = info.id === this.drawerId;
      this.send(ws, {
        type: "round-start",
        round: this.round,
        maxRounds: MAX_ROUNDS,
        drawerId: this.drawerId,
        drawerName: this.players.get(this.drawerId)?.username,
        word: isDrawer ? this.currentWord : null,
        wordLength: this.currentWord.length,
        timeLeft: ROUND_TIME,
      });
    }

    this.broadcastState();

    this.timer = setInterval(() => {
      this.timeLeft--;
      this.broadcast({ type: "tick", timeLeft: this.timeLeft });
      if (this.timeLeft <= 0) this.endRound();
    }, 1000);
  }

  private endRound(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.phase = "reveal";

    this.broadcast({
      type: "round-end",
      word: this.currentWord,
      scores: Object.fromEntries(
        [...this.players].map(([id, p]) => [id, p.score])
      ),
      round: this.round,
      maxRounds: MAX_ROUNDS,
    });

    this.revealTimer = setTimeout(() => {
      if (this.round >= MAX_ROUNDS) {
        this.phase = "ended";
        this.broadcast({
          type: "game-over",
          scores: Object.fromEntries(
            [...this.players].map(([id, p]) => [id, p.score])
          ),
          players: Object.fromEntries(
            [...this.players].map(([id, p]) => [id, { username: p.username }])
          ),
        });
      } else {
        this.startRound();
      }
    }, REVEAL_TIME);
  }

  private getPublicState() {
    // Only include completed strokes, never the in-progress one
    // (receivers build their own in-progress stroke from start/move messages)
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

  private broadcastState(): void {
    this.broadcast({
      type: "state",
      state: this.getPublicState(),
    });
  }

  // ─── WebSocket helpers ──────────────────────────────────────

  private send(ws: WebSocket, obj: unknown): void {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      // closed
    }
  }

  private broadcast(obj: unknown): void {
    const payload = JSON.stringify(obj);
    for (const ws of this.sockets.keys()) {
      try {
        ws.send(payload);
      } catch {
        // closed
      }
    }
  }

  private broadcastExcept(except: WebSocket, obj: unknown): void {
    const payload = JSON.stringify(obj);
    for (const ws of this.sockets.keys()) {
      if (ws === except) continue;
      try {
        ws.send(payload);
      } catch {
        // closed
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  WORKER ENTRY — routes requests to the right Durable Object
// ═══════════════════════════════════════════════════════════════

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    const match = url.pathname.match(/^\/parties\/[^/]+\/(.+)$/);
    if (!match) {
      return new Response("Not found", { status: 404 });
    }

    const roomId = decodeURIComponent(match[1]);
    const id = env.DOODL_ROOM.idFromName(roomId);
    const stub = env.DOODL_ROOM.get(id);

    return stub.fetch(request);
  },
};