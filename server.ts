import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Server } from "https://deno.land/x/socket_io@0.2.0/mod.ts";

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
    socket.to(gameId).emit("player-joined", {
      playerId: socket.id,
      playerName: playerData.name,
    });
  });

  // Handle number calls
  socket.on("call-number", (data) => {
    socket.to(data.gameId).emit("number-called", data);
  });

  // Handle winner announcement
  socket.on("announce-winner", (data) => {
    socket.to(data.gameId).emit("winner-announced", data);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
  });
});

// HTTP server handler
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

  // Health check endpoint
  if (url.pathname === "/api/health") {
    return new Response(
      JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }

  // Handle WebSocket upgrade for Socket.IO
  const { socket, response } = Deno.upgradeWebSocket(req);
  
  // Forward WebSocket events to Socket.IO
  io.attach(socket as any);

  return response;
};

// Start the server
const port = parseInt(Deno.env.get("PORT") || "8000");
console.log(`🚀 Server running on port ${port}`);

await serve(handler, { port });
