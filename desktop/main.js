/* 晨昏日程 · 桌面端主进程
 * 职责：开窗口、跑局域网中转服务、代替页面发 HTTP（绕过 CORS） */
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const fs = require('fs');

let win = null;
let server = null;

/* 调试用：--profile x 使用独立的用户数据目录，便于同一台机器开两个实例做同步测试 */
const PROFILE_I = process.argv.indexOf('--profile');
const HAS_PROFILE = PROFILE_I > 0 && !!process.argv[PROFILE_I + 1];
if (HAS_PROFILE) {
  app.setPath('userData', app.getPath('userData') + '_' + process.argv[PROFILE_I + 1]);
}

/* 中转状态：只存一份 JSON 和"被对端写入过几次" */
const srv = { ver: 0, state: null, from: '', code: '' };

/* ---------------- 本机局域网 IP ---------------- */
function lanIps() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  const priv = out.filter((ip) =>
    /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
  return priv.length ? priv : out;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

/* ---------------- 局域网中转服务 ---------------- */
function startHost(port) {
  return new Promise((resolve) => {
    if (server) {
      return resolve({ ok: true, port: server.address().port, ips: lanIps(), code: srv.code });
    }
    server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

      let pathname = '/';
      try { pathname = new URL(req.url, 'http://x').pathname; } catch (e) { }

      if (pathname === '/chx/ping') {
        return json(res, 200, { app: 'chenhun', v: '1.0', ver: srv.ver });
      }
      if (pathname === '/chx/state' && req.method === 'GET') {
        return json(res, 200, { state: srv.state, ver: srv.ver });
      }
      if (pathname === '/chx/state' && req.method === 'POST') {
        let body = '';
        let tooBig = false;
        req.on('data', (c) => {
          body += c;
          if (body.length > 16 * 1024 * 1024) { tooBig = true; req.destroy(); }
        });
        req.on('end', () => {
          if (tooBig) return json(res, 413, { ok: false, error: 'too large' });
          try {
            const p = JSON.parse(body);
            srv.state = p.state || null;
            srv.from = p.from || '';
            srv.ver += 1;
            /* 主动通知页面有新数据，不依赖页面定时器（后台窗口会被节流） */
            if (win && !win.isDestroyed()) {
              win.webContents.send('chx:remote', { state: srv.state, from: srv.from, ver: srv.ver });
            }
            json(res, 200, { ok: true, ver: srv.ver });
          } catch (e) {
            json(res, 400, { ok: false, error: 'bad json' });
          }
        });
        return;
      }
      json(res, 404, { ok: false, error: 'not found' });
    });

    server.on('error', (e) => {
      server = null;
      resolve({ ok: false, error: e.code === 'EADDRINUSE' ? '端口 ' + port + ' 被占用' : e.message });
    });

    server.listen(port, '0.0.0.0', () => {
      srv.code = String(Math.floor(1000 + Math.random() * 9000));
      resolve({ ok: true, port: server.address().port, ips: lanIps(), code: srv.code });
    });
  });
}

function stopHost() {
  return new Promise((resolve) => {
    if (!server) return resolve(true);
    server.close(() => { server = null; resolve(true); });
    server = null;
  });
}

/* ---------------- 通用 HTTP 客户端 ---------------- */
function httpRequest(method, url, body, headers, timeout) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); }
    catch (e) { return resolve({ status: 0, body: '', error: '地址格式不对：' + url }); }

    const lib = u.protocol === 'https:' ? https : http;
    const hdrs = Object.assign({ 'User-Agent': 'Chenhun/1.0' }, headers || {});
    if (body != null && body !== '') hdrs['Content-Length'] = Buffer.byteLength(body);

    const req = lib.request(
      u,
      { method: method.toUpperCase(), headers: hdrs, timeout: timeout || 15000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
        });
      }
    );

    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: '请求超时' }); });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    if (body != null && body !== '') req.write(body);
    req.end();
  });
}

/* ---------------- IPC ---------------- */
ipcMain.handle('bridge:http', async (_e, a) => {
  let headers = {};
  try { headers = a.headersJson ? JSON.parse(a.headersJson) : {}; } catch (e) { }
  return httpRequest(a.method, a.url, a.body, headers, a.timeout);
});

ipcMain.handle('bridge:start-host', async (_e, port) => startHost(port || 17520));
ipcMain.handle('bridge:stop-host', async () => stopHost());
ipcMain.handle('bridge:get-ips', async () => lanIps());
ipcMain.handle('bridge:host-info', async () => ({
  ok: true, ver: srv.ver, state: srv.state, from: srv.from
}));
ipcMain.handle('bridge:set-host-state', async (_e, str) => {
  try {
    const p = JSON.parse(str);
    srv.state = p.state || null;
    srv.from = p.from || '';
  } catch (e) { return false; }
  return true;
});

/* ---------------- 窗口 ---------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 880,
    minWidth: 380,
    minHeight: 560,
    title: '晨昏日程',
    backgroundColor: '#f6f3ec',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  /* 调试/自检：--snapshot 输出.png [--tab data] [--delay 1200]
     用于无人工介入地核对界面渲染，正式使用不会触发 */
  const argv = process.argv;
  const si = argv.indexOf('--snapshot');
  if (si > 0 && argv[si + 1]) {
    const outFile = argv[si + 1];
    const ti = argv.indexOf('--tab');
    const tab = ti > 0 ? argv[ti + 1] : null;
    const di = argv.indexOf('--delay');
    const delay = di > 0 ? Number(argv[di + 1]) || 1200 : 1200;
    const zi = argv.indexOf('--size');
    if (zi > 0 && argv[zi + 1]) {
      const m = /^(\d+)x(\d+)$/.exec(argv[zi + 1]);
      if (m) win.setContentSize(Number(m[1]), Number(m[2]));
    }
    const hold = argv.indexOf('--hold') > 0;

    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (tab) {
            await win.webContents.executeJavaScript(
              "try{App.setTab('" + tab + "')}catch(e){console.error(e)}"
            );
            await new Promise((r) => setTimeout(r, 600));
          }
          const pi = argv.indexOf('--probe');
          if (pi > 0 && argv[pi + 1]) {
            const r = await win.webContents.executeJavaScript(argv[pi + 1]);
            console.log('PROBE ' + JSON.stringify(r));
          }
          if (!outFile || outFile === '-') { if (!hold) app.quit(); return; }
          const img = await win.webContents.capturePage();
          fs.writeFileSync(outFile, img.toPNG());
          console.log('SNAPSHOT_OK ' + outFile);
        } catch (e) {
          console.error('SNAPSHOT_FAIL ' + e.message);
        }
        if (!hold) app.quit();
      }, delay);
    });
  }

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // F5 刷新 / Ctrl+Shift+I 调试
  win.webContents.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') { win.webContents.reload(); ev.preventDefault(); }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.openDevTools({ mode: 'detach' });
      ev.preventDefault();
    }
  });
}

const gotLock = HAS_PROFILE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => {
    stopHost().finally(() => { if (process.platform !== 'darwin') app.quit(); });
  });
}
