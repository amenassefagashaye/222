import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Server } from "https://deno.land/x/socket_io@0.2.0/mod.ts";

// Game state storage
const activeGames = new Map();
const connectedPlayers = new Map();

// WebSocket server setup with proper CORS
const io = new Server({
  cors: {
    origin: [
      "https://assefabingogame.github.io",  // Your GitHub Pages URL
      "http://localhost:8000",              // Local development
      "http://localhost:8080",              // Alternative local port
      "https://assefabingogame.github.io",  // GitHub Pages HTTPS
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  },
});

// Handle socket connections
io.on("connection", (socket) => {
  console.log(`🎮 Player connected: ${socket.id}`);

  // Join game room
  socket.on("join-game", (data) => {
    const { gameId, playerData } = data;
    
    socket.join(gameId);
    connectedPlayers.set(socket.id, {
      ...playerData,
      socketId: socket.id,
      gameId: gameId,
      joinedAt: new Date().toISOString(),
    });

    // Initialize game if doesn't exist
    if (!activeGames.has(gameId)) {
      activeGames.set(gameId, {
        id: gameId,
        players: [],
        calledNumbers: [],
        gameType: playerData.gameType || "75ball",
        status: "waiting",
        host: socket.id,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      });
      console.log(`🆕 Game created: ${gameId} (${playerData.gameType})`);
    }

    // Add player to game
    const game = activeGames.get(gameId);
    const existingPlayerIndex = game.players.findIndex(p => p.socketId === socket.id);
    
    if (existingPlayerIndex === -1) {
      game.players.push({
        socketId: socket.id,
        ...playerData,
        joinedAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        boardId: playerData.boardId || 1,
        stake: playerData.stake || 25,
      });
    } else {
      // Update existing player
      game.players[existingPlayerIndex] = {
        ...game.players[existingPlayerIndex],
        ...playerData,
        lastSeen: new Date().toISOString(),
      };
    }

    // Update game activity
    game.lastActivity = new Date().toISOString();

    // Broadcast player joined
    socket.to(gameId).emit("player-joined", {
      playerId: socket.id,
      playerName: playerData.name,
      totalPlayers: game.players.length,
      timestamp: new Date().toISOString(),
    });

    // Send current game state to new player
    socket.emit("game-state", {
      gameId,
      players: game.players.map(p => ({
        name: p.name,
        boardId: p.boardId,
        stake: p.stake,
        joinedAt: p.joinedAt,
      })),
      calledNumbers: game.calledNumbers,
      gameType: game.gameType,
      status: game.status,
      host: game.host,
    });

    console.log(`👤 ${playerData.name} joined game ${gameId} (${game.players.length} players)`);
  });

  // Handle number calls
  socket.on("call-number", (data) => {
    const { gameId, number, displayText } = data;
    const game = activeGames.get(gameId);
    
    if (game && (game.host === socket.id || !game.host)) {
      const numberData = {
        number,
        displayText: displayText || number.toString(),
        calledAt: new Date().toISOString(),
        calledBy: socket.id,
      };
      
      game.calledNumbers.push(numberData);
      game.lastActivity = new Date().toISOString();

      // Limit stored numbers to prevent memory issues
      if (game.calledNumbers.length > 100) {
        game.calledNumbers = game.calledNumbers.slice(-50);
      }

      // Broadcast to all players in room
      io.to(gameId).emit("number-called", {
        number,
        displayText: displayText || number.toString(),
        calledNumbers: game.calledNumbers.slice(-10), // Send last 10 numbers
        totalCalled: game.calledNumbers.length,
        timestamp: new Date().toISOString(),
      });

      console.log(`🔢 Number called in ${gameId}: ${displayText || number}`);
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
        wonAt: new Date().toISOString(),
      };
      game.lastActivity = new Date().toISOString();

      // Broadcast winner to all players
      io.to(gameId).emit("winner-announced", {
        playerName,
        pattern,
        winAmount,
        calledNumbers: game.calledNumbers.length,
        timestamp: new Date().toISOString(),
      });

      // Log the win
      console.log(`🏆 Winner in game ${gameId}: ${playerName} won ${winAmount} with pattern ${pattern}`);
    }
  });

  // Handle payment verification
  socket.on("verify-payment", (data, callback) => {
    const { phone, amount, transactionId } = data;
    
    // Simulate payment verification with better validation
    const isValidPhone = /^09\d{8}$/.test(phone);
    const isValidAmount = [25, 50, 100, 200, 500, 1000, 2000, 5000].includes(amount);
    
    const paymentSuccessful = isValidPhone && isValidAmount && Math.random() > 0.05; // 95% success rate
    
    if (paymentSuccessful) {
      console.log(`💰 Payment verified: ${phone} - ${amount} birr - ${transactionId}`);
      callback({ 
        success: true, 
        transactionId: transactionId || `PAY-${Date.now()}`,
        verifiedAt: new Date().toISOString(),
        amount,
        serviceFee: amount * 0.03,
        netAmount: amount * 0.97,
      });
    } else {
      console.log(`❌ Payment failed: ${phone} - ${amount} birr`);
      callback({ 
        success: false, 
        error: isValidPhone && isValidAmount ? "Payment verification failed. Please try again." : "Invalid payment details.",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Handle withdrawal request
  socket.on("request-withdrawal", (data, callback) => {
    const { account, amount, playerId } = data;
    
    // Validate withdrawal request
    const isValidAccount = /^\d{10,15}$/.test(account);
    const isValidAmount = amount >= 25 && amount <= 50000;
    
    if (!isValidAccount) {
      callback({ 
        success: false, 
        error: "Invalid account number. Must be 10-15 digits.",
        timestamp: new Date().toISOString(),
      });
      return;
    }
    
    if (!isValidAmount) {
      callback({ 
        success: false, 
        error: "Amount must be between 25 and 50,000 birr.",
        timestamp: new Date().toISOString(),
      });
      return;
    }
    
    // Simulate withdrawal processing
    setTimeout(() => {
      const withdrawalSuccessful = Math.random() > 0.1; // 90% success rate
      
      if (withdrawalSuccessful) {
        const serviceFee = amount * 0.03;
        const netAmount = amount - serviceFee;
        
        console.log(`💸 Withdrawal processed: ${account} - ${amount} birr (Fee: ${serviceFee})`);
        callback({ 
          success: true, 
          transactionId: `WDR-${Date.now()}`,
          processedAt: new Date().toISOString(),
          amount,
          serviceFee,
          netAmount,
          account: account.slice(-4).padStart(account.length, '*'), // Mask account for security
        });
      } else {
        callback({ 
          success: false, 
          error: "Withdrawal processing failed. Please try again in 5 minutes.",
          timestamp: new Date().toISOString(),
        });
      }
    }, 1500);
  });

  // Handle chat messages
  socket.on("send-message", (data) => {
    const { gameId, message, playerName } = data;
    const game = activeGames.get(gameId);
    
    if (game) {
      game.lastActivity = new Date().toISOString();
      
      io.to(gameId).emit("new-message", {
        playerName: playerName || "Anonymous",
        message,
        timestamp: new Date().toISOString(),
        playerId: socket.id,
      });
      
      console.log(`💬 Chat in ${gameId}: ${playerName}: ${message.substring(0, 50)}...`);
    }
  });

  // Handle game state updates
  socket.on("update-board", (data) => {
    const { gameId, boardState } = data;
    const game = activeGames.get(gameId);
    
    if (game) {
      game.lastActivity = new Date().toISOString();
      socket.to(gameId).emit("board-updated", {
        playerId: socket.id,
        boardState,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Ping to keep connection alive
  socket.on("ping", (callback) => {
    callback({
      status: "pong",
      timestamp: new Date().toISOString(),
      serverTime: Date.now(),
    });
  });

  // Get game info
  socket.on("get-game-info", (data, callback) => {
    const { gameId } = data;
    const game = activeGames.get(gameId);
    
    if (game) {
      callback({
        success: true,
        gameId: game.id,
        gameType: game.gameType,
        players: game.players.length,
        status: game.status,
        calledNumbers: game.calledNumbers.length,
        createdAt: game.createdAt,
        lastActivity: game.lastActivity,
        host: game.host,
        winner: game.winner,
      });
    } else {
      callback({
        success: false,
        error: "Game not found",
      });
    }
  });

  // Handle disconnection
  socket.on("disconnect", (reason) => {
    const player = connectedPlayers.get(socket.id);
    
    if (player) {
      const game = activeGames.get(player.gameId);
      
      if (game) {
        // Remove player from game
        game.players = game.players.filter(p => p.socketId !== socket.id);
        game.lastActivity = new Date().toISOString();
        
        // Notify other players
        socket.to(player.gameId).emit("player-left", {
          playerId: socket.id,
          playerName: player.name,
          totalPlayers: game.players.length,
          reason,
          timestamp: new Date().toISOString(),
        });

        // Clean up empty games after 5 minutes
        if (game.players.length === 0) {
          setTimeout(() => {
            const gameCheck = activeGames.get(player.gameId);
            if (gameCheck && gameCheck.players.length === 0) {
              activeGames.delete(player.gameId);
              console.log(`🗑️ Game ${player.gameId} removed (no players)`);
            }
          }, 5 * 60 * 1000); // 5 minutes
        }
        
        console.log(`👋 ${player.name} left game ${player.gameId} (${game.players.length} players left)`);
      }

      connectedPlayers.delete(socket.id);
    }
    
    console.log(`❌ Player disconnected: ${socket.id} (Reason: ${reason})`);
  });

  // Error handling
  socket.on("error", (error) => {
    console.error(`⚠️ Socket error for ${socket.id}:`, error);
  });
});

// HTTP server for API endpoints
const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  
  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders,
    });
  }

  // API Routes
  if (url.pathname === "/api/health") {
    return new Response(
      JSON.stringify({ 
        status: "healthy", 
        timestamp: new Date().toISOString(),
        server: "Assefa Digital Bingo Game",
        version: "1.0.0",
        activeGames: activeGames.size,
        connectedPlayers: connectedPlayers.size,
        uptime: process.uptime ? process.uptime() : "unknown",
      }),
      { 
        status: 200,
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
      lastActivity: game.lastActivity,
      host: game.host ? game.host.substring(0, 8) + "..." : null,
      winner: game.winner ? {
        playerName: game.winner.playerName,
        pattern: game.winner.pattern,
        winAmount: game.winner.winAmount,
      } : null,
    }));
    
    return new Response(
      JSON.stringify({ 
        success: true,
        count: games.length,
        games,
        timestamp: new Date().toISOString(),
      }),
      { 
        status: 200,
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
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        settings: {
          maxPlayers: body.maxPlayers || 100,
          stake: body.stake || 25,
          autoStart: body.autoStart !== false,
        }
      });
      
      console.log(`🆕 API created game: ${gameId} (${body.gameType || "75ball"})`);
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          gameId,
          message: "Game created successfully",
          timestamp: new Date().toISOString(),
        }),
        { 
          status: 201,
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders,
          } 
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: error.message,
          timestamp: new Date().toISOString(),
        }),
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

  if (url.pathname === "/api/game" && req.method === "GET") {
    const gameId = url.searchParams.get("id");
    
    if (!gameId) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Game ID is required",
          timestamp: new Date().toISOString(),
        }),
        { 
          status: 400,
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders,
          } 
        }
      );
    }
    
    const game = activeGames.get(gameId);
    
    if (!game) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Game not found",
          timestamp: new Date().toISOString(),
        }),
        { 
          status: 404,
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders,
          } 
        }
      );
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        game: {
          id: game.id,
          gameType: game.gameType,
          players: game.players.map(p => ({
            name: p.name,
            boardId: p.boardId,
            stake: p.stake,
            joinedAt: p.joinedAt,
          })),
          calledNumbers: game.calledNumbers.slice(-20),
          status: game.status,
          createdAt: game.createdAt,
          lastActivity: game.lastActivity,
          host: game.host,
          winner: game.winner,
        },
        timestamp: new Date().toISOString(),
      }),
      { 
        status: 200,
        headers: { 
          "Content-Type": "application/json",
          ...corsHeaders,
        } 
      }
    );
  }

  // Static file serving for frontend (optional)
  if (url.pathname === "/" || url.pathname === "/index.html") {
    try {
      const fileContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Assefa Digital Bingo Game - API Server</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            h1 { color: #2c3e50; }
            .endpoint { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 5px; }
            code { background: #e9ecef; padding: 2px 5px; border-radius: 3px; }
            .status { display: inline-block; padding: 5px 10px; border-radius: 3px; font-weight: bold; }
            .healthy { background: #d4edda; color: #155724; }
          </style>
        </head>
        <body>
          <h1>🎮 Assefa Digital Bingo Game Server</h1>
          <div class="status healthy">🟢 Server is running</div>
          
          <h2>📊 Server Stats</h2>
          <ul>
            <li>Active Games: ${activeGames.size}</li>
            <li>Connected Players: ${connectedPlayers.size}</li>
            <li>Uptime: ${new Date().toISOString()}</li>
          </ul>
          
          <h2>🔧 Available Endpoints</h2>
          
          <div class="endpoint">
            <h3>GET <code>/api/health</code></h3>
            <p>Check server health status</p>
          </div>
          
          <div class="endpoint">
            <h3>GET <code>/api/games</code></h3>
            <p>List all active games</p>
          </div>
          
          <div class="endpoint">
            <h3>POST <code>/api/create-game</code></h3>
            <p>Create a new game</p>
            <p>Body: <code>{"gameType": "75ball", "maxPlayers": 100}</code></p>
          </div>
          
          <div class="endpoint">
            <h3>GET <code>/api/game?id=GAME_ID</code></h3>
            <p>Get specific game details</p>
          </div>
          
          <h2>🔌 WebSocket Endpoint</h2>
          <p>Connect to WebSocket at: <code>wss://${req.headers.get("host")}</code></p>
          
          <h2>📱 Game Clients</h2>
          <ul>
            <li><a href="https://assefabingogame.github.io" target="_blank">GitHub Pages Frontend</a></li>
            <li><a href="http://localhost:8000" target="_blank">Local Development</a></li>
          </ul>
          
          <footer style="margin-top: 50px; color: #6c757d; font-size: 14px;">
            <p>© ${new Date().getFullYear()} Assefa Digital Bingo Game - Backend Server v1.0.0</p>
          </footer>
        </body>
        </html>
      `;
      
      return new Response(fileContent, {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          ...corsHeaders,
        },
      });
    } catch (error) {
      return new Response("Server info page error", { 
        status: 500,
        headers: corsHeaders,
      });
    }
  }

  // Default 404 response
  return new Response(
    JSON.stringify({ 
      success: false, 
      error: "Endpoint not found",
      timestamp: new Date().toISOString(),
    }),
    { 
      status: 404,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    }
  );
};

// Start the server
const port = parseInt(Deno.env.get("PORT") || "8000");
console.log(`🚀 Assefa Digital Bingo Game Server starting on port ${port}`);
console.log(`📡 WebSocket Server ready for connections`);
console.log(`🌐 CORS allowed origins:`);
console.log(`   - https://assefabingogame.github.io`);
console.log(`   - http://localhost:8000`);
console.log(`   - http://localhost:8080`);

// Cleanup inactive games every 30 minutes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [gameId, game] of activeGames.entries()) {
    const lastActivity = new Date(game.lastActivity).getTime();
    const inactiveTime = now - lastActivity;
    
    // Remove games inactive for more than 2 hours
    if (inactiveTime > 2 * 60 * 60 * 1000) {
      activeGames.delete(gameId);
      cleaned++;
      console.log(`🧹 Cleaned up inactive game: ${gameId}`);
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} inactive games`);
  }
}, 30 * 60 * 1000); // Every 30 minutes

// Start the server
await serve(handler, { port });
