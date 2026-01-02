// WebSocket Connection Manager
class BingoWebSocket {
    constructor() {
        this.socket = null;
        this.gameId = null;
        this.playerId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }

    connect(serverUrl) {
        try {
            this.socket = io(serverUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: this.maxReconnectAttempts,
                reconnectionDelay: 1000,
                timeout: 10000,
            });

            this.setupEventListeners();
            console.log('Connecting to WebSocket server...');
        } catch (error) {
            console.error('WebSocket connection error:', error);
            this.handleConnectionError();
        }
    }

    setupEventListeners() {
        // Connection events
        this.socket.on('connect', () => {
            console.log('✅ Connected to game server');
            this.reconnectAttempts = 0;
            this.playerId = this.socket.id;
            this.showNotification('በተሳካ ሁኔታ ተገናኝቷል', false);
        });

        this.socket.on('disconnect', (reason) => {
            console.log('❌ Disconnected:', reason);
            this.showNotification('ከሰርቨር ተገናኝተዋል፣ እንደገና በማገናኘት ላይ...', false);
        });

        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            this.reconnectAttempts++;
            
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.showNotification('የሰርቨር ግንኙነት አልተሳካም፣ እባክዎ እንደገና ይሞክሩ', false);
            }
        });

        // Game events
        this.socket.on('game-state', (data) => {
            console.log('Game state received:', data);
            this.handleGameState(data);
        });

        this.socket.on('number-called', (data) => {
            console.log('Number called by server:', data);
            this.handleServerNumberCall(data);
        });

        this.socket.on('player-joined', (data) => {
            console.log('New player joined:', data);
            this.showNotification(`${data.playerName} ወደ ጨዋታው ተጨምሯል`, false);
        });

        this.socket.on('player-left', (data) => {
            console.log('Player left:', data);
            this.showNotification(`${data.playerName} ከጨዋታው ወጥቷል`, false);
        });

        this.socket.on('winner-announced', (data) => {
            console.log('Winner announced:', data);
            this.handleRemoteWinner(data);
        });

        this.socket.on('new-message', (data) => {
            console.log('New chat message:', data);
            this.handleChatMessage(data);
        });

        this.socket.on('board-updated', (data) => {
            console.log('Board updated by player:', data);
            // Handle other player's board updates if needed
        });
    }

    joinGame(gameData) {
        if (!this.socket || !this.socket.connected) {
            this.showNotification('ከሰርቨር ጋር ግንኙነት የለም፣ እባክዎ ይጠብቁ', false);
            return false;
        }

        this.gameId = gameData.gameId || `game-${Date.now()}`;
        
        this.socket.emit('join-game', {
            gameId: this.gameId,
            playerData: {
                name: gameData.name,
                phone: gameData.phone,
                gameType: gameData.gameType,
                boardId: gameData.boardId,
                stake: gameData.stake,
            }
        });
        
        return true;
    }

    callNumber(numberData) {
        if (!this.socket || !this.socket.connected) return;
        
        this.socket.emit('call-number', {
            gameId: this.gameId,
            number: numberData.number,
            displayText: numberData.displayText,
        });
    }

    announceWinner(winData) {
        if (!this.socket || !this.socket.connected) return;
        
        this.socket.emit('announce-winner', {
            gameId: this.gameId,
            playerName: winData.playerName,
            pattern: winData.pattern,
            winAmount: winData.winAmount,
        });
    }

    verifyPayment(paymentData, callback) {
        if (!this.socket || !this.socket.connected) {
            callback({ success: false, error: 'No connection' });
            return;
        }
        
        this.socket.emit('verify-payment', paymentData, callback);
    }

    requestWithdrawal(withdrawalData, callback) {
        if (!this.socket || !this.socket.connected) {
            callback({ success: false, error: 'No connection' });
            return;
        }
        
        this.socket.emit('request-withdrawal', withdrawalData, callback);
    }

    sendChatMessage(messageData) {
        if (!this.socket || !this.socket.connected) return;
        
        this.socket.emit('send-message', {
            gameId: this.gameId,
            message: messageData.message,
            playerName: messageData.playerName,
        });
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    // Helper methods
    handleServerNumberCall(data) {
        // Update game with server-called number
        gameState.calledNumbers = data.calledNumbers;
        updateCalledNumbersDisplay();
    }

    handleRemoteWinner(data) {
        // Show remote winner notification
        if (data.playerName !== gameState.playerName) {
            showNotification(`${data.playerName} አሸንፏል! ንድፍ: ${data.pattern}`, false);
        }
    }

    handleChatMessage(data) {
        // Display chat message
        // You can implement a chat UI later
        console.log(`Chat: ${data.playerName}: ${data.message}`);
    }

    handleGameState(data) {
        // Sync game state with server
        gameState.calledNumbers = data.calledNumbers;
        updateCalledNumbersDisplay();
    }

    showNotification(message, isError = false) {
        // Use your existing notification system
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${isError ? '#dc3545' : '#28a745'};
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            z-index: 9999;
            animation: slideIn 0.3s;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    handleConnectionError() {
        // Fallback to offline mode
        console.log('Running in offline mode');
        this.showNotification('ኦፍላይን ሁነት ውስጥ ነዎት፣ የነጠላ ተጫዋች ሁነት', false);
    }
}

// Initialize WebSocket
const bingoWS = new BingoWebSocket();

// Update your existing functions to use WebSocket:

// 1. In confirmRegistration function, add:
function confirmRegistration() {
    // ... existing code ...
    
    // Join game via WebSocket
    const joinSuccess = bingoWS.joinGame({
        gameId: `game-${gameState.gameType}-${Date.now()}`,
        name: gameState.playerName,
        phone: gameState.playerPhone,
        gameType: gameState.gameType,
        boardId: gameState.boardId,
        stake: gameState.stake,
    });
    
    if (!joinSuccess) {
        showNotification('ወደ መስመር ላይ ጨዋታ መግባት አልተሳካም፣ ኦፍላይን በመጫወት ላይ...', true);
    }
    
    showPage(3);
}

// 2. Update callNextNumber function:
function callNextNumber() {
    if (!gameState.gameActive || !gameState.isCalling) return;
    
    const type = boardTypes.find(t => t.id === gameState.gameType);
    let number;
    
    do {
        number = Math.floor(Math.random() * type.range) + 1;
    } while (gameState.calledNumbers.includes(number));
    
    gameState.calledNumbers.push(number);
    
    let displayText = number.toString();
    
    if (gameState.gameType === '75ball' || gameState.gameType === '50ball' || gameState.gameType === 'pattern') {
        const letters = 'BINGO';
        let columnSize, columnIndex;
        
        if (gameState.gameType === '75ball' || gameState.gameType === 'pattern') {
            columnSize = 15;
            columnIndex = Math.floor((number - 1) / columnSize);
        } else {
            columnSize = 10;
            columnIndex = Math.floor((number - 1) / columnSize);
        }
        
        columnIndex = Math.min(columnIndex, 4);
        const letter = letters[columnIndex];
        displayText = `${letter}-${number}`;
    }
    
    // Send to server if connected
    if (bingoWS.socket && bingoWS.socket.connected) {
        bingoWS.callNumber({
            number: number,
            displayText: displayText,
        });
    }
    
    // ... rest of existing code ...
}

// 3. Update announceWin function:
function announceWin() {
    if (!gameState.gameActive) return;
    
    const win = calculateWin();
    if (win) {
        const winAmount = calculatePotentialWin(gameState.stake);
        gameState.totalWon += winAmount;
        
        // Announce to server if connected
        if (bingoWS.socket && bingoWS.socket.connected) {
            bingoWS.announceWinner({
                playerName: gameState.playerName,
                pattern: win.pattern,
                winAmount: winAmount,
            });
        }
        
        // ... rest of existing code ...
    }
}

// 4. Update processPayment function:
function processPayment() {
    const amount = parseInt(document.getElementById('paymentAmount').value);
    
    if (!amount || amount < 25) {
        return;
    }
    
    // Verify payment with server
    bingoWS.verifyPayment({
        phone: gameState.playerPhone,
        amount: amount,
        transactionId: `PAY-${Date.now()}`,
    }, (response) => {
        if (response.success) {
            gameState.payment = amount;
            gameState.paymentAmount = amount;
            
            const select = document.getElementById('paymentAmount');
            select.style.background = '#28a745';
            select.style.color = 'white';
            
            showNotification('ክፍያዎ በተሳካ ሁኔታ ተረጋግጧል!', false);
        } else {
            showNotification('የክፍያ ማረጋገጫ አልተሳካም፣ እባክዎ እንደገና ይሞክሩ', true);
        }
    });
}

// 5. Update processWithdrawal function:
function processWithdrawal() {
    const account = document.getElementById('withdrawAccount').value;
    const amount = parseInt(document.getElementById('withdrawAmount').value.replace(/,/g, ''));
    
    if (!account) {
        showNotification('የአካውንት ቁጥር ያስገቡ', false);
        return;
    }
    
    // Process withdrawal through server
    bingoWS.requestWithdrawal({
        account: account,
        amount: amount,
        playerId: gameState.playerPhone,
    }, (response) => {
        if (response.success) {
            gameState.totalWithdrawn += amount;
            updateFinance();
            showNotification(`${response.amount.toLocaleString()} ብር በተሳካ ሁኔታ ተወግዷል!`, false);
        } else {
            showNotification(`የማውጣት ሂደት አልተሳካም: ${response.error}`, true);
        }
    });
}

// 6. Connect to WebSocket when game starts
function init() {
    // ... existing init code ...
    
    // Connect to WebSocket server
    // Change this URL to your actual server URL when deployed
    const serverUrl = window.location.hostname === 'localhost' 
        ? 'http://localhost:8000'
        : 'https://your-deno-deploy-url.deno.dev';
    
    bingoWS.connect(serverUrl);
    
    // Auto-connect on page load
    setTimeout(() => {
        if (!bingoWS.socket || !bingoWS.socket.connected) {
            bingoWS.connect(serverUrl);
        }
    }, 2000);
}
