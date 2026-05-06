const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const users = new Map();
const messages = [];
const privateMessages = new Map();
const channels = [
  { id: 'general', name: 'Основной', type: 'text' },
  { id: 'voice-lobby', name: 'Войс-лобби', type: 'voice' },
  { id: 'random', name: 'Рандом', type: 'text' }
];
const servers = [
  { id: 'main', name: 'NeonCity', icon: '', channels: ['general', 'voice-lobby', 'random'] }
];

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, function(m) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return map[m];
  });
}

const messageLimits = new Map();

app.get('/', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send('NeonChat Server is running!');
});

app.get('/api/servers', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(servers);
});

app.get('/api/channels/:serverId', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const srv = servers.find(s => s.id === req.params.serverId);
  if (!srv) return res.status(404).json({ error: 'Not found' });
  res.json(channels.filter(c => srv.channels.includes(c.id)));
});

app.get('/api/messages/:channelId', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(messages.filter(m => m.channel === req.params.channelId).slice(-100));
});

app.get('/api/private/:userId', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const chatKey = [req.params.userId, req.query.with].sort().join('_');
  const msgs = privateMessages.get(chatKey) || [];
  res.json(msgs.slice(-100));
});

io.on('connection', (socket) => {
  console.log('Connected: ' + socket.id);

  socket.on('user:join', ({ username, avatar }) => {
    const user = { id: socket.id, username: username || 'Guest', avatar: avatar || '', status: 'online' };
    users.set(socket.id, user);
    io.emit('users:update', Array.from(users.values()));
    io.emit('message:new', { id: uuidv4(), userId: 'system', username: 'NeonChat', text: user.username + ' joined', channel: 'general', timestamp: Date.now(), system: true });
  });

  socket.on('message:send', ({ text, channel }) => {
    const user = users.get(socket.id);
    if (!user || !text.trim()) return;
    const now = Date.now();
    const list = messageLimits.get(socket.id) || [];
    const recent = list.filter(t => now - t < 1000);
    if (recent.length > 3) return socket.emit('error', { text: 'Too fast!' });
    recent.push(now);
    messageLimits.set(socket.id, recent);
    const msg = { id: uuidv4(), userId: user.id, username: user.username, avatar: user.avatar, text: escapeHTML(text.trim()), channel, timestamp: now };
    messages.push(msg);
    if (messages.length > 500) messages.shift();
    io.emit('message:new', msg);
  });

  socket.on('private:send', ({ to, text }) => {
    const user = users.get(socket.id);
    const targetUser = users.get(to);
    if (!user || !targetUser || !text.trim()) return;
    const chatKey = [socket.id, to].sort().join('_');
    const msg = { id: uuidv4(), from: socket.id, to: to, username: user.username, avatar: user.avatar, text: escapeHTML(text.trim()), timestamp: Date.now() };
    if (!privateMessages.has(chatKey)) privateMessages.set(chatKey, []);
    privateMessages.get(chatKey).push(msg);
    if (privateMessages.get(chatKey).length > 500) privateMessages.get(chatKey).shift();
    io.to(socket.id).emit('private:new', msg);
    io.to(to).emit('private:new', msg);
    io.to(to).emit('private:notify', { from: socket.id, username: user.username });
  });

  socket.on('typing:start', ({ channel }) => {
    const user = users.get(socket.id);
    if (user) socket.broadcast.emit('typing:update', { userId: user.id, username: user.username, channel, typing: true });
  });

  socket.on('typing:stop', ({ channel }) => {
    const user = users.get(socket.id);
    if (user) socket.broadcast.emit('typing:update', { userId: user.id, username: user.username, channel, typing: false });
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    users.delete(socket.id);
    io.emit('users:update', Array.from(users.values()));
    if (user) io.emit('message:new', { id: uuidv4(), userId: 'system', username: 'NeonChat', text: user.username + ' left', channel: 'general', timestamp: Date.now(), system: true });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('NeonChat server started on port ' + PORT));
