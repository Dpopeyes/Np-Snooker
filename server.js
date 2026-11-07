/**
 * Np-Snooker Real-time Multi-device Server
 * ระบบเซิร์ฟเวอร์ซิงก์ข้อมูลโต๊ะสนุ๊กเกอร์แบบ Real-time ทุกอุปกรณ์
 * ทำงานด้วย Node.js Built-in Modules (ไม่ต้องติดตั้ง npm เสริม)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// Default initial state
const DEFAULT_STATE = {
  auth: {
    cashier: { name: 'แคชเชียร์', pin: '1234', pass: '1234', role: 'cashier' },
    admin: { name: 'เจ้าของร้าน (Admin)', pin: '9999', pass: 'admin1234', role: 'admin' }
  },
  tables: [
    { id: 'T1', name: 'โต๊ะ 1', group: 'group1', status: 'available', startTime: null, pausedTime: 0, items: [] },
    { id: 'T2', name: 'โต๊ะ 2', group: 'group2', status: 'available', startTime: null, pausedTime: 0, items: [] },
    { id: 'T3', name: 'โต๊ะ 3', group: 'group1', status: 'available', startTime: null, pausedTime: 0, items: [] },
    { id: 'T4', name: 'โต๊ะ 4', group: 'group2', status: 'available', startTime: null, pausedTime: 0, items: [] },
    { id: 'V1', name: 'โต๊ะ V1 (VIP)', group: 'group1', status: 'available', startTime: null, pausedTime: 0, items: [] },
    { id: 'V2', name: 'โต๊ะ V2 (VIP)', group: 'group1', status: 'available', startTime: null, pausedTime: 0, items: [] }
  ],
  history: [],
  config: {
    promptPayNo: '0812345678',
    shopName: 'Np-Snooker Club'
  }
};

let db = loadDatabase();
let sseClients = [];

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('Error reading database file, using defaults:', err.message);
  }
  saveDatabase(DEFAULT_STATE);
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function saveDatabase(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data || db, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving database:', err.message);
  }
}

// Broadcast updated state to all connected devices via SSE
function broadcastUpdate() {
  const payload = JSON.stringify({
    type: 'sync',
    serverTime: Date.now(),
    data: db
  });

  sseClients.forEach((res, index) => {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (e) {
      sseClients.splice(index, 1);
    }
  });
}

function getLocalIpAddresses() {
  const ifaces = os.networkInterfaces();
  const addresses = [];
  for (const name in ifaces) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ name, ip: net.address });
      }
    }
  }
  return addresses;
}

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. API: Server Info (IPs, Port, Connection QR)
  if (pathname === '/api/info' && req.method === 'GET') {
    const ips = getLocalIpAddresses();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      port: PORT,
      localIps: ips,
      serverTime: Date.now(),
      connectedClients: sseClients.length
    }));
    return;
  }

  // 2. API: Get Full Sync Data
  if (pathname === '/api/data' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      serverTime: Date.now(),
      data: db
    }));
    return;
  }

  // 3. API: SSE Real-time Stream
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('\n');
    sseClients.push(res);

    // Initial sync
    res.write(`data: ${JSON.stringify({ type: 'sync', serverTime: Date.now(), data: db })}\n\n`);

    req.on('close', () => {
      const idx = sseClients.indexOf(res);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
    return;
  }

  // 4. API: Process Actions (Start table, pause, add drink, checkout, etc.)
  if (pathname === '/api/action' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { action, params } = payload;
        let responsePayload = { success: true };

        switch (action) {
          case 'login': {
            const { pin, user, pass } = params;
            if (pin) {
              if (pin === db.auth.admin.pin) {
                responsePayload.user = { name: db.auth.admin.name, role: 'admin' };
              } else if (pin === db.auth.cashier.pin) {
                responsePayload.user = { name: db.auth.cashier.name, role: 'cashier' };
              } else {
                responsePayload = { success: false, error: 'รหัส PIN ไม่ถูกต้อง' };
              }
            } else if (user && pass) {
              if ((user === 'admin' || user === 'owner') && pass === db.auth.admin.pass) {
                responsePayload.user = { name: db.auth.admin.name, role: 'admin' };
              } else if ((user === 'staff' || user === 'cashier') && pass === db.auth.cashier.pass) {
                responsePayload.user = { name: db.auth.cashier.name, role: 'cashier' };
              } else {
                responsePayload = { success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
              }
            } else {
              responsePayload = { success: false, error: 'กรุณาระบุข้อมูลเข้าสู่ระบบ' };
            }
            break;
          }

          case 'startTable': {
            const t = db.tables.find(x => x.id === params.tableId);
            if (t) {
              t.status = 'playing';
              t.startTime = params.startTime || Date.now();
              t.pausedTime = 0;
              saveDatabase();
              broadcastUpdate();
            }
            break;
          }

          case 'togglePauseTable': {
            const t = db.tables.find(x => x.id === params.tableId);
            if (t) {
              if (t.status === 'playing') {
                t.status = 'paused';
              } else if (t.status === 'paused') {
                t.status = 'playing';
              }
              saveDatabase();
              broadcastUpdate();
            }
            break;
          }

          case 'adjustTableStartTime': {
            const t = db.tables.find(x => x.id === params.tableId);
            if (t && params.newStartTime) {
              t.startTime = params.newStartTime;
              saveDatabase();
              broadcastUpdate();
            }
            break;
          }

          case 'addDrink': {
            const t = db.tables.find(x => x.id === params.tableId);
            if (t) {
              if (!t.items) t.items = [];
              t.items.push({
                name: params.name,
                price: params.price,
                time: Date.now()
              });
              saveDatabase();
              broadcastUpdate();
            }
            break;
          }

          case 'removeDrink': {
            const t = db.tables.find(x => x.id === params.tableId);
            if (t && t.items && t.items[params.index] !== undefined) {
              t.items.splice(params.index, 1);
              saveDatabase();
              broadcastUpdate();
            }
            break;
          }

          case 'checkoutTable': {
            const t = db.tables.find(x => x.id === params.tableId);
            if (t) {
              // Add to history
              if (params.bill) {
                if (!db.history) db.history = [];
                db.history.unshift(params.bill);
              }
              // Reset table
              t.status = 'available';
              t.startTime = null;
              t.pausedTime = 0;
              t.items = [];
              saveDatabase();
              broadcastUpdate();
            }
            break;
          }

          case 'addTable': {
            if (params.newTable) {
              db.tables.push(params.newTable);
              saveDatabase();
              broadcastUpdate();
            }
            break;
          }

          case 'updatePin': {
            const { role, newPin } = params;
            if (db.auth[role] && newPin) {
              db.auth[role].pin = newPin;
              db.auth[role].pass = newPin;
              saveDatabase();
              broadcastUpdate();
            }
            break;
          }

          case 'updateConfig': {
            if (params.promptPayNo) {
              db.config.promptPayNo = params.promptPayNo;
              saveDatabase();
              broadcastUpdate();
            }
            break;
          }

          case 'clearHistory': {
            db.history = [];
            saveDatabase();
            broadcastUpdate();
            break;
          }

          default:
            responsePayload = { success: false, error: 'คำสั่งไม่ถูกต้อง' };
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(responsePayload));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 5. Static File Serving
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(__dirname, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Server Error');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log('\n======================================================');
  console.log('🎱 Np-Snooker Server กำลังทำงานเรียบร้อยแล้ว!');
  console.log('======================================================');
  console.log(`💻 ใช้งานบนเครื่องนี้:         http://localhost:${PORT}`);
  ips.forEach(net => {
    console.log(`📱 มือถือ/แท็บเล็ตในวง Wi-Fi:  http://${net.ip}:${PORT}  (${net.name})`);
  });
  console.log('======================================================\n');
});
