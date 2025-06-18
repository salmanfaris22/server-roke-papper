const WebSocket = require('ws');
const server = new WebSocket.Server({ port: 8080 });

let players = [];
let choices = {};

server.on('connection', socket => {
  if (players.length >= 2) {
    socket.send(JSON.stringify({ type: 'full' }));
    socket.close();
    return;
  }

  const playerId = players.length + 1;
  players.push(socket);
  socket.send(JSON.stringify({ type: 'welcome', playerId }));

  socket.on('message', message => {
    const data = JSON.parse(message);
    if (data.type === 'choice') {
      choices[playerId] = data.choice;

      if (choices[1] && choices[2]) {
        const result = determineWinner(choices[1], choices[2]);
        players.forEach(p =>
          p.send(JSON.stringify({ type: 'result', choices, result }))
        );
        choices = {};
      }
    }
  });

  socket.on('close', () => {
    players = players.filter(p => p !== socket);
    choices = {};
  });
});

function determineWinner(p1, p2) {
  if (p1 === p2) return 'Draw';
  if (
    (p1 === 'rock' && p2 === 'scissors') ||
    (p1 === 'paper' && p2 === 'rock') ||
    (p1 === 'scissors' && p2 === 'paper')
  ) {
    return 'Player 1 Wins';
  }
  return 'Player 2 Wins';
}

console.log('Server running on ws://localhost:8080');
