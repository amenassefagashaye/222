import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Simple game state
interface GameState {
  id: string;
  players: Array<{
    id: string;
    name: string;
    phone: string;
    boardId: number;
    stake: number;
    joinedAt: number;
  }>;
  calledNumbers: number[];
  gameType: string;
  status: string;
  createdAt: number;
}

interface PlayerState {
  id: string;
  ws: WebSocket;
  gameId?: string;
  name?: string;
  phone?: string;
}

// Simple in-memory storage
const activeGames = new Map<string, GameState>();
const activePlayers = new Map<string, PlayerState>();

// Helper function to broadcast to all players in a game
function broadcastToGame(gameId: string, message: any, excludePlayerId?: string) {
  const game = activeGames.get(gameId);
  if (!game) return;
  
  for (const player of game.players) {
    const playerState = activePlayers.get(player.id);
    if (playerState && playerState.ws.readyState === WebSocket.OPEN) {
      if (excludePlayerId && player.id === excludePlayerId) continue;
      playerState.ws.send(JSON.stringify(message));
    }
  }
}

// HTTP and WebSocket server
const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  
  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // WebSocket endpoint
  if (url.pathname === "/ws") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    
    const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store player connection
    activePlayers.set(playerId, {
      id: playerId,
      ws: socket,
    });
    
    // Handle WebSocket events
    socket.onopen = () => {
      console.log(`Player connected: ${playerId}`);
      socket.send(JSON.stringify({
        type: "connected",
        playerId,
        timestamp: Date.now(),
      }));
    };
    
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(playerId, data, socket);
      } catch (error) {
        console.error("Error parsing message:", error);
        socket.send(JSON.stringify({
          type: "error",
          message: "Invalid message format",
        }));
      }
    };
    
    socket.onclose = () => {
      console.log(`Player disconnected: ${playerId}`);
      const playerState = activePlayers.get(playerId);
      if (playerState?.gameId) {
        // Remove player from game
        const game = activeGames.get(playerState.gameId);
        if (game) {
          game.players = game.players.filter(p => p.id !== playerId);
          
          // Notify other players
          broadcastToGame(playerState.gameId, {
            type: "player-left",
            playerId,
            playerName: playerState.name,
            timestamp: Date.now(),
          }, playerId);
          
          // Remove empty games
          if (game.players.length === 0) {
            activeGames.delete(playerState.gameId);
            console.log(`Game ${playerState.gameId} removed (no players)`);
          }
        }
      }
      activePlayers.delete(playerId);
    };
    
    socket.onerror = (error) => {
      console.error(`WebSocket error for ${playerId}:`, error);
    };
    
    return response;
  }

  // REST API endpoints
  if (url.pathname === "/api/health") {
    return new Response(
      JSON.stringify({
        status: "healthy",
        server: "Simple Bingo Server",
        activeGames: activeGames.size,
        activePlayers: activePlayers.size,
        timestamp: Date.now(),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }

  if (url.pathname === "/api/games") {
    const games = Array.from(activeGames.values()).map(game => ({
      id: game.id,
      gameType: game.gameType,
      players: game.players.length,
      status: game.status,
      calledNumbers: game.calledNumbers.length,
      createdAt: game.createdAt,
    }));
    
    return new Response(
      JSON.stringify({ games }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }

  if (url.pathname === "/api/create-game" && req.method === "POST") {
    try {
      const body = await req.json();
      const gameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      activeGames.set(gameId, {
        id: gameId,
        players: [],
        calledNumbers: [],
        gameType: body.gameType || "75ball",
        status: "waiting",
        createdAt: Date.now(),
      });
      
      return new Response(
        JSON.stringify({
          success: true,
          gameId,
          message: "Game created successfully",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }
  }

  // Default 404 response
  return new Response("Not Found", {
    status: 404,
    headers: corsHeaders,
  });
};

// Handle WebSocket messages
function handleWebSocketMessage(playerId: string, data: any, ws: WebSocket) {
  const playerState = activePlayers.get(playerId);
  if (!playerState) return;
  
  switch (data.type) {
    case "join-game":
      handleJoinGame(playerId, data.data, ws);
      break;
      
    case "call-number":
      handleCallNumber(playerId, data.data, ws);
      break;
      
    case "announce-winner":
      handleAnnounceWinner(playerId, data.data, ws);
      break;
      
    case "send-chat":
      handleChatMessage(playerId, data.data, ws);
      break;
      
    case "ping":
      ws.send(JSON.stringify({
        type: "pong",
        timestamp: Date.now(),
      }));
      break;
      
    default:
      ws.send(JSON.stringify({
        type: "error",
        message: `Unknown message type: ${data.type}`,
      }));
  }
}

// Handle player joining a game
function handleJoinGame(playerId: string, data: any, ws: WebSocket) {
  const { gameId, name, phone, gameType, boardId, stake } = data;
  
  // Update player state
  const playerState = activePlayers.get(playerId);
  if (playerState) {
    playerState.gameId = gameId;
    playerState.name = name;
    playerState.phone = phone;
  }
  
  // Get or create game
  let game = activeGames.get(gameId);
  if (!game) {
    game = {
      id: gameId,
      players: [],
      calledNumbers: [],
      gameType: gameType || "75ball",
      status: "waiting",
      createdAt: Date.now(),
    };
    activeGames.set(gameId, game);
  }
  
  // Add player to game
  if (!game.players.find(p => p.id === playerId)) {
    game.players.push({
      id: playerId,
      name: name || "Anonymous",
      phone: phone || "",
      boardId: boardId || 1,
      stake: stake || 25,
      joinedAt: Date.now(),
    });
  }
  
  // Send current game state to player
  ws.send(JSON.stringify({
    type: "game-state",
    data: {
      gameId,
      players: game.players,
      calledNumbers: game.calledNumbers,
      gameType: game.gameType,
      status: game.status,
    },
  }));
  
  // Notify other players
  broadcastToGame(gameId, {
    type: "player-joined",
    data: {
      playerId,
      playerName: name,
      totalPlayers: game.players.length,
      timestamp: Date.now(),
    },
  }, playerId);
  
  console.log(`Player ${name} joined game ${gameId}`);
}

// Handle number calling
function handleCallNumber(playerId: string, data: any, ws: WebSocket) {
  const { gameId, number, displayText } = data;
  const game = activeGames.get(gameId);
  
  if (!game) {
    ws.send(JSON.stringify({
      type: "error",
      message: "Game not found",
    }));
    return;
  }
  
  // Add number to called numbers
  game.calledNumbers.push(number);
  
  // Broadcast to all players
  broadcastToGame(gameId, {
    type: "number-called",
    data: {
      number,
      displayText: displayText || number.toString(),
      calledNumbers: game.calledNumbers,
      totalCalled: game.calledNumbers.length,
      timestamp: Date.now(),
    },
  });
  
  console.log(`Number called in ${gameId}: ${displayText || number}`);
}

// Handle winner announcement
function handleAnnounceWinner(playerId: string, data: any, ws: WebSocket) {
  const { gameId, playerName, pattern, winAmount } = data;
  const game = activeGames.get(gameId);
  
  if (!game) {
    ws.send(JSON.stringify({
      type: "error",
      message: "Game not found",
    }));
    return;
  }
  
  // Update game status
  game.status = "finished";
  
  // Broadcast winner to all players
  broadcastToGame(gameId, {
    type: "winner-announced",
    data: {
      playerName,
      pattern,
      winAmount,
      calledNumbers: game.calledNumbers.length,
      timestamp: Date.now(),
    },
  });
  
  console.log(`Winner in game ${gameId}: ${playerName} won ${winAmount} with pattern ${pattern}`);
}

// Handle chat messages
function handleChatMessage(playerId: string, data: any, ws: WebSocket) {
  const { gameId, message } = data;
  const playerState = activePlayers.get(playerId);
  
  if (!playerState?.gameId) return;
  
  broadcastToGame(gameId, {
    type: "chat-message",
    data: {
      playerId,
      playerName: playerState.name || "Anonymous",
      message,
      timestamp: Date.now(),
    },
  }, playerId);
}

// Start the server
const port = parseInt(Deno.env.get("PORT") || "8000");
console.log(`🚀 Simple Bingo Server running on http://localhost:${port}`);
console.log(`🔗 WebSocket endpoint: ws://localhost:${port}/ws`);

// Clean up inactive games every 10 minutes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [gameId, game] of activeGames.entries()) {
    // Remove games inactive for more than 1 hour
    if (now - game.createdAt > 60 * 60 * 1000) {
      activeGames.delete(gameId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} inactive games`);
  }
}, 10 * 60 * 1000);

await serve(handler, { port });
