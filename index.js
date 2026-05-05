const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Хранилище (в продакшене — БД)
const users = new Map();
const messages = [];
const channels = [
  { id: 'general', name: 'Основной', type: 'text' },
  { id: 'voice-lobby', name: 'Войс-лобби', type: 'voice' },
  { id: 'random', name: 'Рандом', type: 'text' }
];
const servers = [
  { id: 'main', name: 'NeonCity', icon: '', channels: ['general', 'voice-lobby', 'random'] }
];

// Функция для защиты от XSS
function escapeHTML(str) {
  return str.replace(/[&<>"']/g, function(m) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return map[m];
  });
}

// Rate limiting
const messageLimits = new Map();

// REST API
app.get('/', (req, res) => {
  res.send('NeonChat Server is running!');
});

app.get('/api/servers', (req, res) => res.json(servers));

app.get('/api/channels/:serverId', (req, res) => {
  const server = servers.find(s => s.id === req.params.serverId);
  if (!server) return res.status(404).json({ error: 'Сервер не найден' });
  const serverChannels = channels.filter(c => server.channels.includes(c.id));
  res.json(serverChannels);
});

app.get('/api/messages/:channelId', (req, res) => {
  const channelMessages = messages.filter(m => m.channel === req.params.channelId).slice(-100);
  res.json(channelMessages);
});

// WebSocket
io.on('connection', (socket) => {
  console.log('Новое подключение: ' + socket.id);

  socket.on('user:join', ({ username, avatar }) => {
    const user = {
      id: socket.id,
      username: username || 'Гость',
      avatar: avatar || '',
      status: 'online'
    };
    users.set(socket.id, user);

    io.emit('users:update', Array.from(users.values()));
    io.emit('message:new', {
      id: uuidv4(),
      userId: 'system',
      username: 'NeonChat',
      text: user.username + ' присоединился',
      channel: 'general',
      timestamp: Date.now(),
      system: true
    });
  });

  socket.on('message:send', ({ text, channel }) => {
    const user = users.get(socket.id);
    if (!user || !text.trim()) return;

    // Rate limiting
    const now = Date.now();
    const userMessages = messageLimits.get(socket.id) || [];
    const recentMessages = userMessages.filter(t => now - t < 1000);
    if (recentMessages.length > 3) {
      return socket.emit('error', { text: 'Слишком быстро! Подожди секунду.' });
    }
    recentMessages.push(now);
    messageLimits.set(socket.id, recentMessages);

    const message = {
      id: uuidv4(),
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      text: escapeHTML(text.trim()),
      channel,
      timestamp: Date.now()
    };

    messages.push(message);
    if (messages.length > 500) messages.shift();

    io.emit('message:new', message);
  });

  socket.on('typing:start', ({ channel }) => {
    const user = users.get(socket.id);
    if (user) socket.broadcast.emit('typing:update', {
      userId: user.id,
      username: user.username,
      channel,
      typing: true
    });
  });

  socket.on('typing:stop', ({ channel }) => {
    const user = users.get(socket.id);
    if (user) socket.broadcast.emit('typing:update', {
      userId: user.id,
      username: user.username,
      channel,
      typing: false
    });
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    users.delete(socket.id);
    io.emit('users:update', Array.from(users.values()));
    if (user) {
      io.emit('message:new', {
        id: uuidv4(),
        userId: 'system',
        username: 'NeonChat',
        text: user.username + ' вышел',
        channel: 'general',
        timestamp: Date.now(),
        system: true
      });
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('NeonChat сервер запущен на порту ' + PORT);
});