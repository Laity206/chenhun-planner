// 通过 Chrome DevTools Protocol 在 WebView / Electron 里执行 JS
// 用法: CDP_PORT=9222 node cdp.js "<js表达式>"   （表达式可返回 Promise）
const http = require('http');

const PORT = Number(process.env.CDP_PORT || 9222);

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('解析失败: ' + d.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('连接调试端口超时')); });
  });
}

(async () => {
  const expr = process.argv[2];
  if (!expr) { console.error('缺少表达式'); process.exit(2); }

  const list = await getJson('/json');
  const pages = (Array.isArray(list) ? list : []).filter((p) => p.webSocketDebuggerUrl);
  if (!pages.length) { console.error('没有可调试页面'); process.exit(3); }

  const target = pages.find((p) => /appassets|index\.html/.test(p.url || '')) || pages[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  const timer = setTimeout(() => { console.error('CDP 超时'); process.exit(4); }, 30000);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
        allowUnsafeEvalBlockedByCSP: true
      }
    }));
  };

  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id !== 1) return;
    clearTimeout(timer);
    if (m.result && m.result.exceptionDetails) {
      console.log('EXCEPTION ' + JSON.stringify(m.result.exceptionDetails.exception || m.result.exceptionDetails.text));
    } else {
      const v = m.result && m.result.result ? m.result.result.value : undefined;
      console.log('RESULT ' + JSON.stringify(v));
    }
    ws.close();
    process.exit(0);
  };

  ws.onerror = (e) => { clearTimeout(timer); console.error('WS 错误', e.message || e); process.exit(5); };
})();
