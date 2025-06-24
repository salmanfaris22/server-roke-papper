const WebSocket = require('ws');
const server = new WebSocket.Server({ port: 8080 });

class GameRoom {
  constructor(id, name, creator) {
    this.id = id;
    this.name = name;
    this.players = [creator];
    this.choices = {};
    this.inviteCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    this.status = 'waiting';
  }

  addPlayer(player) {
    if (this.players.length < 2) {
      this.players.push(player);
      if (this.players.length === 2) {
        this.status = 'playing';
      }
      return true;
    }
    return false;
  }

  removePlayer(player) {
    this.players = this.players.filter(p => p !== player);
    if (this.players.length < 2) {
      this.status = 'waiting';
    }
    return this.players.length > 0;
  }

  makeChoice(playerId, choice) {
    this.choices[playerId] = choice;
    return Object.keys(this.choices).length === 2;
  }

  getResult() {
    const p1Choice = this.choices[1];
    const p2Choice = this.choices[2];
    
    if (p1Choice === p2Choice) return 'Draw';
    if (
      (p1Choice === 'rock' && p2Choice === 'scissors') ||
      (p1Choice === 'paper' && p2Choice === 'rock') ||
      (p1Choice === 'scissors' && p2Choice === 'paper')
    ) {
      return 'Player 1 Wins';
    }
    return 'Player 2 Wins';
  }

  resetRound() {
    this.choices = {};
  }
}

class GameServer {
  constructor() {
    this.rooms = new Map();
    this.roomClients = new Map();
  }

  generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  handleConnection(socket) {
    console.log('New client connected');
    
    const client = {
      socket,
      roomId: null,
      playerId: null
    };

    socket.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        this.handleMessage(client, data);
      } catch (e) {
        console.error('Error handling message:', e);
      }
    });

    socket.on('close', () => {
      this.handleDisconnect(client);
    });
  }

  handleMessage(client, data) {
    switch(data.type) {
      case 'createRoom':
        this.handleCreateRoom(client, data);
        break;
      case 'joinRoom':
        this.handleJoinRoom(client, data);
        break;
      case 'listRooms':
        this.handleListRooms(client);
        break;
      case 'choice':
        this.handleChoice(client, data.choice);
        break;
      case 'invite':
        this.handleInvite(client);
        break;
    }
  }

  handleCreateRoom(client, data) {
    const roomId = this.generateRoomId();
    const roomName = data.roomName || `Room ${roomId}`;
    const room = new GameRoom(roomId, roomName, client.socket);
    
    this.rooms.set(roomId, room);
    this.roomClients.set(client.socket, roomId);
    
    client.roomId = roomId;
    client.playerId = 1;
    
    client.socket.send(JSON.stringify({
      type: 'roomCreated',
      roomId,
      playerId: 1,
      inviteCode: room.inviteCode
    }));
    
    this.updateRoomList();
  }

  handleJoinRoom(client, data) {
    const room = this.rooms.get(data.roomId);
    
    if (!room) {
      client.socket.send(JSON.stringify({
        type: 'error',
        message: 'Room not found'
      }));
      return;
    }
    
    if (room.players.length >= 2) {
      client.socket.send(JSON.stringify({
        type: 'error',
        message: 'Room is full'
      }));
      return;
    }
    
    if (data.inviteCode && data.inviteCode !== room.inviteCode) {
      client.socket.send(JSON.stringify({
        type: 'error',
        message: 'Invalid invite code'
      }));
      return;
    }
    
    this.roomClients.set(client.socket, data.roomId);
    client.roomId = data.roomId;
    client.playerId = room.players.length + 1;
    
    room.addPlayer(client.socket);
    
    room.players.forEach((player, index) => {
      player.send(JSON.stringify({
        type: 'joinedRoom',
        roomId: data.roomId,
        playerId: index + 1,
        roomName: room.name,
        opponentConnected: room.players.length === 2
      }));
    });
    
    this.updateRoomList();
  }

  handleListRooms(client) {
    const availableRooms = Array.from(this.rooms.values())
      .filter(room => room.players.length < 2)
      .map(room => ({
        id: room.id,
        name: room.name,
        playerCount: room.players.length
      }));
    
    client.socket.send(JSON.stringify({
      type: 'roomList',
      rooms: availableRooms
    }));
  }

  handleChoice(client, choice) {
    const roomId = client.roomId;
    if (!roomId) return;
    
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    room.makeChoice(client.playerId, choice);
    
    room.players.forEach(player => {
      player.send(JSON.stringify({
        type: 'choiceMade',
        playerId: client.playerId,
        choice
      }));
    });
    
    if (Object.keys(room.choices).length === 2) {
      const result = room.getResult();
      
      room.players.forEach(player => {
        player.send(JSON.stringify({
          type: 'result',
          choices: room.choices,
          result
        }));
      });
      
      room.resetRound();
    }
  }

  handleInvite(client) {
    const roomId = client.roomId;
    if (!roomId) return;
    
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    client.socket.send(JSON.stringify({
      type: 'inviteGenerated',
      inviteLink: `${roomId}:${room.inviteCode}`
    }));
  }

  handleDisconnect(client) {
    const roomId = client.roomId;
    if (!roomId) return;
    
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    this.roomClients.delete(client.socket);
    
    const shouldKeepRoom = room.removePlayer(client.socket);
    
    if (!shouldKeepRoom) {
      this.rooms.delete(roomId);
    } else {
      room.players[0].send(JSON.stringify({
        type: 'opponentDisconnected'
      }));
    }
    
    this.updateRoomList();
  }

  updateRoomList() {
    const availableRooms = Array.from(this.rooms.values())
      .filter(room => room.players.length < 2)
      .map(room => ({
        id: room.id,
        name: room.name,
        playerCount: room.players.length
      }));
    
    server.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && !this.roomClients.has(client)) {
        client.send(JSON.stringify({
          type: 'roomListUpdate',
          rooms: availableRooms
        }));
      }
    });
  }
}

const gameServer = new GameServer();
server.on('connection', socket => gameServer.handleConnection(socket));
console.log('Server running on ws://localhost:8080');