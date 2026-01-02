import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Server } from "https://deno.land/x/socket_io@0.2.0/mod.ts";

// Game state storage
const activeGames = new Map();
const connectedPlayers = new Map();

// WebSocket server setup
const io = new Server({
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Handle socket connections
io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Join game room
  socket.on("join-game", (data) => {
    const { gameId, playerData } = data;
    
    socket.join(gameId);
    connectedPlayers.set(socket.id, {
      ...playerData,
      socketId: socket.id,
      gameId: gameId,
    });

    // Initialize game if doesn't exist
    if (!activeGames.has(gameId)) {
      activeGames.set(gameId, {
        id: gameId,
        players: [],
        calledNumbers: [],
        gameType: playerData.gameType,
        status: "waiting",
        host: socket.id,
        createdAt: Date.now(),
      });
    }

    // Add player to game
    const game = activeGames.get(gameId);
    game.players.push({
      id: socket.id,
      ...playerData,
      joinedAt: Date.now(),
      boardId: playerData.boardId || 1,
      stake: playerData.stake || 25,
    });

    // Broadcast player joined
    socket.to(gameId).emit("player-joined", {
      playerId: socket.id,
      playerName: playerData.name,
      totalPlayers: game.players.length,
    });

    // Send current game state to new player
    socket.emit("game-state", {
      gameId,
      players: game.players,
      calledNumbers: game.calledNumbers,
      gameType: game.gameType,
      status: game.status,
    });
  });

  // Handle number calls
  socket.on("call-number", (data) => {
    const { gameId, number, displayText } = data;
    const game = activeGames.get(gameId);
    
    if (game && game.host === socket.id) {
      game.calledNumbers.push({
        number,
        displayText,
        calledAt: Date.now(),
        calledBy: socket.id,
      });

      // Broadcast to all players in room
      io.to(gameId).emit("number-called", {
        number,
        displayText,
        calledNumbers: game.calledNumbers,
        totalCalled: game.calledNumbers.length,
      });
    }
  });

  // Handle winner announcement
  socket.on("announce-winner", (data) => {
    const { gameId, playerName, pattern, winAmount } = data;
    const game = activeGames.get(gameId);
    
    if (game) {
      game.status = "finished";
      game.winner = {
        playerId: socket.id,
        playerName,
        pattern,
        winAmount,
        wonAt: Date.now(),
      };

      // Broadcast winner to all players
      io.to(gameId).emit("winner-announced", {
        playerName,
        pattern,
        winAmount,
        calledNumbers: game.calledNumbers.length,
      });

      // Log the win
      console.log(`Winner in game ${gameId}: ${playerName} won ${winAmount} with pattern ${pattern}`);
    }
  });

  // Handle payment verification
  socket.on("verify-payment", (data, callback) => {
    const { phone, amount, transactionId } = data;
    
    // Simulate payment verification
    const paymentSuccessful = Math.random() > 0.1; // 90% success rate
    
    if (paymentSuccessful) {
      console.log(`Payment verified: ${phone} - ${amount} birr`);
      callback({ success: true, transactionId: `TXN-${Date.now()}` });
    } else {
      callback({ success: false, error: "Payment verification failed" });
    }
  });

  // Handle withdrawal request
  socket.on("request-withdrawal", (data, callback) => {
    const { account, amount, playerId } = data;
    
    // Simulate withdrawal processing
    setTimeout(() => {
      const withdrawalSuccessful = Math.random() > 0.2; // 80% success rate
      
      if (withdrawalSuccessful) {
        console.log(`Withdrawal processed: ${account} - ${amount} birr`);
        callback({ 
          success: true, 
          transactionId: `WDR-${Date.now()}`,
          processedAt: new Date().toISOString(),
          amount: amount * 0.97 // 3% fee
        });
      } else {
        callback({ 
          success: false, 
          error: "Withdrawal processing failed. Try again." 
        });
      }
    }, 1500);
  });

  // Handle chat messages
  socket.on("send-message", (data) => {
    const { gameId, message, playerName } = data;
    io.to(gameId).emit("new-message", {
      playerName,
      message,
      timestamp: Date.now(),
    });
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    const player = connectedPlayers.get(socket.id);
    
    if (player) {
      const game = activeGames.get(player.gameId);
      
      if (game) {
        // Remove player from game
        game.players = game.players.filter(p => p.id !== socket.id);
        
        // Notify other players
        socket.to(player.gameId).emit("player-left", {
          playerId: socket.id,
          playerName: player.name,
          totalPlayers: game.players.length,
        });

        // Clean up empty games
        if (game.players.length === 0) {
          activeGames.delete(player.gameId);
          console.log(`Game ${player.gameId} removed (no players)`);
        }
      }

      connectedPlayers.delete(socket.id);
    }
    
    console.log(`Player disconnected: ${socket.id}`);
  });

  // Handle game state updates
  socket.on("update-board", (data) => {
    const { gameId, boardState } = data;
    socket.to(gameId).emit("board-updated", {
      playerId: socket.id,
      boardState,
    });
  });

  // Ping to keep connection alive
  socket.on("ping", (callback) => {
    callback("pong");
  });
});

// HTTP server for API endpoints
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

  // API Routes
  if (url.pathname === "/api/health") {
    return new Response(
      JSON.stringify({ 
        status: "ok", 
        timestamp: new Date().toISOString(),
        activeGames: activeGames.size,
        connectedPlayers: connectedPlayers.size,
      }),
      { 
        headers: { 
          "Content-Type": "application/json",
          ...corsHeaders,
        } 
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
        } 
      }
    );
  }

  if (url.pathname === "/api/create-game" && req.method === "POST") {
    try {
      const body = await req.json();
      const gameId = `game-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
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
          message: "Game created successfully" 
        }),
        { 
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders,
          } 
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
          } 
        }
      );
    }
  }

  // Static file serving for frontend
  if (url.pathname === "/" || url.pathname === "/index.html") {
    try {
      const file = await Deno.readFile("./frontend/index.html");
      return new Response(file, {
        headers: {
          "Content-Type": "text/html",
          ...corsHeaders,
        },
      });
    } catch {
      return new Response("Frontend not found", { status: 404 });
    }
  }

  // Default 404 response
  return new Response("Not Found", { 
    status: 404,
    headers: corsHeaders,
  });
};

// Start the server
const port = parseInt(Deno.env.get("PORT") || "8000");
console.log(`🚀 Server running on http://localhost:${port}`);

// Combine Socket.io with HTTP server
await serve(async (req) => {
  const { socket, response } = Deno.upgradeWebSocket(req);
  
  // Handle WebSocket upgrade for Socket.io
  if (req.headers.get("upgrade") === "websocket") {
    return response;
  }
  
  // Handle HTTP requests
  return handler(req);
}, { port });