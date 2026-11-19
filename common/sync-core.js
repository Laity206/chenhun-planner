/* ====================================================================
 * 晨昏日程 · 同步内核 v1.0   sync-core.js
 * --------------------------------------------------------------------
 * 设计要点
 *  1. 合并逻辑只写一份 JS，桌面端与安卓端共用，避免两端行为分叉。
 *  2. 外壳只提供三件事：HTTP 客户端、局域网 JSON 中转、平台信息。
 *  3. 三向合并 base / local / remote；冲突时保留数据（删 vs 改 → 保留改动）。
 *  4. 基线 base 存本地，合并成功后更新，保证多次同步可重复执行。
 * ==================================================================== */
(function () {
  'use strict';

  var App = window.App;
  if (!App) { console.error('[同步] App 未就绪，同步模块未加载'); return; }
  var U = App.util, S = App.store;

  var K_BASE = 'chenxi.sync.base';
  var K_CFG = 'chenxi.sync.cfg';
  var K_STAT = 'chenxi.sync.stat';
  var K_DEV = 'chenxi.device.id';
  var LAN_PORT = 17520;

  var ID_COLL = {
    tasks: 1, expenses: 1, extraCourses: 1, courseTable: 1,
    roadmap: 1, milestones: 1, longTasks: 1, routines: 1
  };

  /* ---------------- 通用小工具 ---------------- */
  function isPlainObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function canon(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(canon);
    var o = {};
    Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); });
    return o;
  }

  function eq(a, b) {
    if (a === b) return true;
    if (a === undefined || b === undefined) return a === b;
    try { return JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }
    catch (e) { return false; }
  }

  function unionKeys() {
    var set = {}, out = [];
    for (var i = 0; i < arguments.length; i++) {
      var o = arguments[i] || {};
      Object.keys(o).forEach(function (k) { if (!set[k]) { set[k] = 1; out.push(k); } });
    }
    return out;
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  function deviceId() {
    var id = lsGet(K_DEV);
    if (!id) { id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); lsSet(K_DEV, id); }
    return id;
  }

  /* ==================================================================
   * 一、三向合并
   * ================================================================== */

  var stats = null;
  var preferFilled = false;   // 无基线合并时：冲突字段优先保留有内容的一侧
  function resetStats() { stats = { conflict: 0, added: 0, deleted: 0, kept: 0, days: 0 }; }

  function isBlank(v) {
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return false;
  }

  function pickScalar(base, local, remote) {
    if (eq(local, remote)) return local;
    if (eq(local, base)) return remote;
    if (eq(remote, base)) return local;
    if (preferFilled) {
      if (isBlank(local) && !isBlank(remote)) return remote;
      if (!isBlank(local) && isBlank(remote)) return local;
    }
    stats.conflict++;          // 两边都改了：以本机为准，但记一笔
    return local;
  }

  function idMap(arr) {
    var m = {};
    (arr || []).forEach(function (x) { if (x && typeof x.id === 'string' && x.id) m[x.id] = x; });
    return m;
  }

  /* 按 id 的集合合并 */
  function mergeColl(baseArr, localArr, remoteArr) {
    var b = idMap(baseArr), l = idMap(localArr), r = idMap(remoteArr);
    var outMap = {};
    unionKeys(b, l, r).forEach(function (k) {
      var bv = b[k], lv = l[k], rv = r[k];

      if (lv === undefined && rv === undefined) return;

      if (lv === undefined) {
        if (bv === undefined) { outMap[k] = rv; stats.added++; return; }   // 对端新增
        if (eq(rv, bv)) { stats.deleted++; return; }                        // 本机删除，对端没动
        outMap[k] = rv; stats.conflict++; stats.kept++; return;             // 本机删 / 对端改 → 保留
      }

      if (rv === undefined) {
        if (bv === undefined) { outMap[k] = lv; return; }                   // 本机新增
        if (eq(lv, bv)) { stats.deleted++; return; }                        // 对端删除，本机没动
        outMap[k] = lv; stats.conflict++; return;                           // 对端删 / 本机改 → 保留
      }

      if (isPlainObj(lv) && isPlainObj(rv)) outMap[k] = mergeNode(bv, lv, rv);
      else outMap[k] = pickScalar(bv, lv, rv);
    });

    var out = [];
    (localArr || []).forEach(function (x) { if (x && x.id && outMap[x.id] && out.indexOf(outMap[x.id]) < 0) out.push(outMap[x.id]); });
    (remoteArr || []).forEach(function (x) { if (x && x.id && outMap[x.id] && out.indexOf(outMap[x.id]) < 0) out.push(outMap[x.id]); });
    Object.keys(outMap).forEach(function (k) { if (out.indexOf(outMap[k]) < 0) out.push(outMap[k]); });
    return out;
  }

  /* 通用节点合并（对象 / 标量） */
  function mergeNode(base, local, remote) {
    if (!isPlainObj(local) || !isPlainObj(remote)) return pickScalar(base, local, remote);

    var out = {};
    var bObj = isPlainObj(base) ? base : {};

    unionKeys(bObj, local, remote).forEach(function (k) {
      var bv = bObj[k], lv = local[k], rv = remote[k];

      if (lv === undefined && rv === undefined) return;

      if (lv !== undefined && rv !== undefined) {
        if (ID_COLL[k] && Array.isArray(lv) && Array.isArray(rv)) {
          out[k] = mergeColl(bv, lv, rv);
        } else if (isPlainObj(lv) && isPlainObj(rv)) {
          out[k] = mergeNode(bv, lv, rv);
        } else {
          out[k] = pickScalar(bv, lv, rv);
        }
        return;
      }

      var present = lv !== undefined ? lv : rv;
      if (bv === undefined) { out[k] = present; return; }   // 一边新增
      if (eq(present, bv)) return;                          // 一边删除、另一边没动 → 尊重删除
      out[k] = present; stats.conflict++;                   // 删 vs 改 → 保留数据
    });

    return out;
  }

  /* 顶层合并 */
  function mergeState(base, local, remote) {
    resetStats();
    var out = mergeNode(base || {}, local, remote);
    out.v = Math.max(Number(local.v) || 1, Number(remote.v) || 1, Number(base && base.v) || 1);
    out.updatedAt = new Date().toISOString();
    var normalized;
    try { normalized = S.normalize(out); }
    catch (e) { console.warn('[同步] 合并结果清洗失败，沿用本机数据', e); normalized = local; }
    if (normalized && normalized.days && remote && remote.days) {
      stats.days = Object.keys(normalized.days).length;
    }
    return { state: normalized, stats: stats };
  }

  function isEmptyState(st) {
    if (!st) return true;
    var d = st.days && typeof st.days === 'object' ? Object.keys(st.days) : [];
    var c = Array.isArray(st.courseTable) ? st.courseTable.length : 0;
    var r = Array.isArray(st.roadmap) ? st.roadmap.length : 0;
    return d.length === 0 && c === 0 && r === 0;
  }

  /* 无基线时的引导：
     一边是空的就整份采纳；两边都有内容就做并集合并（base 当空），
     冲突项保留本机值，但另一台独有的条目/字段会全部并进来，保证不丢数据。 */
  function bootstrapMerge(local, remote) {
    resetStats();
    if (isEmptyState(local) && !isEmptyState(remote)) {
      stats.added = 1;
      return { state: S.normalize(remote), stats: stats, mode: 'adopt-remote' };
    }
    if (isEmptyState(remote) && !isEmptyState(local)) {
      return { state: local, stats: stats, mode: 'keep-local' };
    }
    preferFilled = true;
    var r;
    try { r = mergeState({}, local, remote); }
    finally { preferFilled = false; }
    r.mode = 'union';
    return r;
  }

  function merge3(base, local, remote) {
    if (!base) return bootstrapMerge(local, remote);
    var r = mergeState(base, local, remote);
    r.mode = 'three-way';
    return r;
  }

  /* ==================================================================
   * 二、基线 / 配置 / 统计
   * ================================================================== */
  function loadBase() {
    var raw = lsGet(K_BASE);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function saveBase(st) { lsSet(K_BASE, JSON.stringify(st)); }
  function clearBase() { try { localStorage.removeItem(K_BASE); } catch (e) { } }

  function loadCfg() {
    var raw = lsGet(K_CFG);
    var d = { webdav: { enabled: false, url: '', user: '', pass: '', path: '/chenhun/data.json', auto: true } };
    if (!raw) return d;
    try {
      var o = JSON.parse(raw);
      if (o && o.webdav) d.webdav = Object.assign(d.webdav, o.webdav);
    } catch (e) { }
    return d;
  }
  function saveCfg(o) { lsSet(K_CFG, JSON.stringify(o)); }

  function loadStat() {
    var raw = lsGet(K_STAT);
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  }
  function markSynced(report) {
    var st = loadStat();
    st.lastAt = new Date().toISOString();
    st.lastBy = report.channel;
    st.lastMsg = report.message || '';
    lsSet(K_STAT, JSON.stringify(st));
  }

  /* ==================================================================
   * 三、外壳桥接
   * ================================================================== */
  var Native = window.NativeBridge || null;

  /* 安卓把桥挂在 __CHX_NATIVE__ 上，方法末尾多一个回调 id。
     这里做一层适配，让上层代码两端完全一致。参数逐个写出而不是用 apply，
     因为 Java 桥对象的方法不是普通 JS 函数，apply/call 在部分 WebView 上会抛错。 */
  if (!Native && window.__CHX_NATIVE__) {
    var RN = window.__CHX_NATIVE__;
    Native = {
      platform: 'android',
      http: function (m, u, b, h, t, cb) { return RN.http(m, u, b, h, t, cb); },
      startHost: function (p, cb) { return RN.startHost(p, cb); },
      stopHost: function (cb) { return RN.stopHost(cb); },
      hostInfo: function (cb) { return RN.hostInfo(cb); },
      setHostState: function (j, cb) { return RN.setHostState(j, cb); },
      getIps: function (cb) { return RN.getIps(cb); }
    };
    window.NativeBridge = Native;
  }

  var cbSeq = 0, cbs = {};

  window.__chxResolve = function (id, ok, payload) {
    var cb = cbs[id];
    if (!cb) return;
    delete cbs[id];
    if (ok) {
      var v = payload;
      if (typeof payload === 'string') { try { v = JSON.parse(payload); } catch (e) { v = payload; } }
      cb.res(v);
    } else {
      cb.rej(new Error(payload || '原生调用失败'));
    }
  };

  function hasBridge() { return !!Native; }

  function callNative(method, args) {
    args = args || [];
    if (!Native) return Promise.reject(new Error('当前环境不支持同步（需要用桌面版或安卓版）'));
    if (Native.platform === 'android') {
      return new Promise(function (res, rej) {
        var id = 'cb' + (++cbSeq);
        cbs[id] = { res: res, rej: rej };
        try { Native[method].apply(Native, args.concat([id])); }
        catch (e) { delete cbs[id]; rej(e); }
      });
    }
    try { return Promise.resolve(Native[method].apply(Native, args)); }
    catch (e) { return Promise.reject(e); }
  }

  function httpJson(method, url, body, headers, timeout) {
    return callNative('http', [method, url, body == null ? '' : body, JSON.stringify(headers || {}), timeout || 15000]);
  }

  /* ==================================================================
   * 四、应用合并结果
   * ================================================================== */
  var suppressAuto = false;

  function applyState(st) {
    suppressAuto = true;
    try {
      S.state = S.normalize(st);
      S.save();
      if (App.applyTheme) App.applyTheme();
      if (App.refresh) App.refresh();
    } finally {
      setTimeout(function () { suppressAuto = false; }, 0);
    }
  }

  /* ==================================================================
   * 五、局域网同步
   * ================================================================== */
  var hostTimer = null, lastHostVer = 0;

  function lanBase(cfg) {
    var addr = String(cfg.addr || '').trim();
    if (!addr) throw new Error('请先填写对方地址，例如 192.168.1.23:17520');
    if (!/^https?:\/\//.test(addr)) addr = 'http://' + addr;
    if (!/:\d+$/.test(addr)) addr += ':' + LAN_PORT;
    return addr.replace(/\/+$/, '');
  }

  function lanSyncAsClient(addrIn) {
    var cfg = loadCfg();
    var root;
    try { root = lanBase({ addr: addrIn || cfg.webdav.lanAddr }); }
    catch (e) { return Promise.reject(e); }

    var base = loadBase();
    var local = S.state;

    return httpJson('GET', root + '/chx/state', null, {}, 8000).then(function (res) {
      if (!res || res.status !== 200) throw new Error('连不上对方（' + (res ? res.status : '无响应') + '），确认在同一 WiFi 且已开启接收');
      var payload;
      try { payload = JSON.parse(res.body); } catch (e) { throw new Error('对方返回的数据不是合法 JSON'); }
      var remote = payload && payload.state ? payload.state : null;
      if (!remote) throw new Error('对方还没有数据，先在电脑上添加点内容再同步');

      var r = merge3(base, local, remote);
      applyState(r.state);
      saveBase(r.state);

      return httpJson('POST', root + '/chx/state', JSON.stringify({ state: r.state, from: deviceId() }), { 'Content-Type': 'application/json' }, 8000)
        .then(function (pr) {
          if (!pr || pr.status < 200 || pr.status >= 300) throw new Error('把结果写回对方失败（' + (pr ? pr.status : '无响应') + '）');
          var rep = { channel: 'lan', stats: r.stats, mode: r.mode, message: '与 ' + root.replace(/^https?:\/\//, '') + ' 已对齐' };
          markSynced(rep);
          return rep;
        });
    });
  }

  function startHost() {
    return callNative('startHost', [LAN_PORT]).then(function (info) {
      if (!info || !info.ok) throw new Error((info && info.error) || '开启失败，端口可能被占用');
      lastHostVer = 0;
      hostRunning = true;
      hostInfoCache = info;
      hookRemotePush();
      if (hostTimer) clearInterval(hostTimer);
      hostTimer = setInterval(pollHost, 3000);
      pushHostState();
      return info;
    });
  }

  function stopHost() {
    if (hostTimer) { clearInterval(hostTimer); hostTimer = null; }
    return callNative('stopHost', []).catch(function () { });
  }

  /* 主机侧：把本机最新数据推给中转 blob，并轮询是否被对端写过 */
  var lastPushedJson = '';

  function pushHostState() {
    if (!hostRunning) return;
    var payload = JSON.stringify({ state: S.state, from: deviceId() });
    lastPushedJson = payload;
    callNative('setHostState', [payload]).catch(function () { });
  }

  var hostRunning = false;

  var remoteHooked = false;

  /* 接收到对端数据的统一处理入口 */
  function adoptRemote(remote, ver) {
    if (!remote) return;
    if (ver) lastHostVer = ver;

    /* 本机自从上次推送后没动过 → 对端发来的就是合并结果，直接采纳。
       否则说明两边都改过，需要再合一次。 */
    var mineNow = JSON.stringify({ state: S.state, from: deviceId() });
    var r = mineNow === lastPushedJson
      ? { state: S.normalize(remote), stats: { conflict: 0, added: 0, deleted: 0, kept: 0 }, mode: 'adopt' }
      : merge3(loadBase(), S.state, remote);

    applyState(r.state);
    saveBase(r.state);
    pushHostState();

    var rep = { channel: 'lan', stats: r.stats, mode: r.mode, message: '已接收对方数据' };
    markSynced(rep);
    if (App.toast) App.toast('已接收对方数据' + (r.stats && r.stats.conflict ? '（' + r.stats.conflict + ' 处冲突已保留）' : ''));
    renderPanel();
  }

  /* 桌面端主进程会主动推送对端写入，比轮询更及时，也不受后台节流影响 */
  function hookRemotePush() {
    if (!Native || typeof Native.onRemote !== 'function' || remoteHooked) return;
    remoteHooked = true;
    Native.onRemote(function (d) {
      if (!hostRunning || !d) return;
      if (d.from === deviceId()) return;
      adoptRemote(d.state, d.ver);
    });
  }

  function pollHost() {
    if (!hostRunning) return;
    callNative('hostInfo', []).then(function (info) {
      if (!info || !info.ok) return;
      if (!info.ver || info.ver === lastHostVer) return;
      if (info.from === deviceId()) { lastHostVer = info.ver; return; }
      adoptRemote(info.state, info.ver);
    }).catch(function () { });
  }

  /* ==================================================================
   * 六、WebDAV 同步
   * ================================================================== */
  function authHeaders(cfg) {
    var h = {};
    if (cfg.user || cfg.pass) {
      h['Authorization'] = 'Basic ' + btoa(unescape(encodeURIComponent(cfg.user + ':' + cfg.pass)));
    }
    return h;
  }

  function joinUrl(root, p) {
    root = String(root || '').replace(/\/+$/, '');
    p = String(p || '').replace(/^\/+/, '');
    return root + '/' + p;
  }

  function dirOf(url) {
    var i = url.lastIndexOf('/');
    return i > 8 ? url.slice(0, i) : url;
  }

  function webdavSync() {
    var cfg = loadCfg().webdav;
    if (!cfg.url) return Promise.reject(new Error('还没填 WebDAV 地址'));
    var url = joinUrl(cfg.url, cfg.path || '/chenhun/data.json');
    var h = authHeaders(cfg);
    var base = loadBase();
    var local = S.state;

    return httpJson('GET', url, null, h, 20000).then(function (res) {
      var remote = null;
      if (res && res.status === 200 && res.body) {
        try { remote = JSON.parse(res.body); } catch (e) { throw new Error('网盘上的文件不是有效 JSON，可能被别的程序改过'); }
      } else if (res && res.status === 404) {
        remote = null;
      } else if (res && (res.status === 401 || res.status === 403)) {
        throw new Error('网盘账号或应用密码不对（HTTP ' + res.status + '）');
      } else if (res && res.status !== 404) {
        throw new Error('读取网盘失败（HTTP ' + res.status + '）');
      }

      var r = remote ? merge3(base, local, remote) : { state: local, stats: { conflict: 0, added: 0, deleted: 0, kept: 0 }, mode: 'upload' };
      applyState(r.state);
      saveBase(r.state);

      var putHeaders = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, h);
      var body = JSON.stringify(r.state);

      return httpJson('PUT', url, body, putHeaders, 25000).then(function (pr) {
        if (pr && (pr.status === 409 || pr.status === 404)) {
          return httpJson('MKCOL', dirOf(url), null, h, 15000).then(function () {
            return httpJson('PUT', url, body, putHeaders, 25000);
          }).then(function (p2) {
            if (!p2 || p2.status >= 300) throw new Error('写入网盘失败（HTTP ' + (p2 ? p2.status : '无响应') + '），检查路径是否存在');
            return true;
          });
        }
        if (!pr || pr.status >= 300) throw new Error('写入网盘失败（HTTP ' + (pr ? pr.status : '无响应') + '）');
        return true;
      }).then(function () {
        var rep = { channel: 'webdav', stats: r.stats, mode: r.mode, message: remote ? '与网盘已对齐' : '已上传到网盘' };
        markSynced(rep);
        return rep;
      });
    });
  }

  /* ==================================================================
   * 七、自动同步钩子
   * ================================================================== */
  var autoTimer = null;

  function scheduleAuto() {
    var cfg = loadCfg();
    if (!cfg.webdav.enabled || !cfg.webdav.auto) return;
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(function () {
      webdavSync().then(function () { renderPanel(); }).catch(function (e) {
        if (App.toast) App.toast('自动同步失败：' + e.message, 'error');
      });
    }, 12000);
  }

  function installHooks() {
    var rawSave = S.save;
    S.save = function () {
      var ok = rawSave.apply(S, arguments);
      if (!suppressAuto) {
        if (hostRunning) pushHostState();
        scheduleAuto();
      }
      return ok;
    };
  }

  /* ==================================================================
   * 八、界面
   * ================================================================== */
  var hostInfoCache = null;

  function fmtTime(iso) {
    if (!iso) return '从未同步';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '从未同步';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }

  function reportLine(rep) {
    if (!rep) return '';
    var s = rep.stats || {};
    var parts = [];
    if (s.added) parts.push('新增 ' + s.added);
    if (s.deleted) parts.push('删除 ' + s.deleted);
    if (s.conflict) parts.push('冲突 ' + s.conflict + '（已保留）');
    if (!parts.length) parts.push('无变化');
    return parts.join(' · ');
  }

  function buildPanel() {
    var cfg = loadCfg();
    var st = loadStat();
    var wd = cfg.webdav;
    var dev = deviceId().slice(-4).toUpperCase();

    var h = [];
    h.push('<section class="card data-span2" data-chx-sync>');
    h.push('<div class="card-hd"><div><h3 class="card-title">双端同步</h3>');
    h.push('<p class="card-sub">手机和电脑互传全部数据，不用再复制分享码</p></div>');
    h.push('<span class="muted" style="font-size:12px;white-space:nowrap;flex:none">本机 ' + U.esc(dev) + '</span></div>');
    h.push('<div class="card-bd data-stack">');

    h.push('<p class="muted" style="font-size:12.5px">上次同步：' + U.esc(fmtTime(st.lastAt)) +
      (st.lastMsg ? ' · ' + U.esc(st.lastMsg) : '') + '</p>');

    /* ---- 局域网 ---- */
    h.push('<div style="border:1px solid var(--line);border-radius:var(--radius-sm);padding:14px">');
    h.push('<h4 style="margin:0 0 4px;font-size:13.5px;font-weight:600">局域网直连</h4>');
    h.push('<p class="hint" style="margin:0 0 10px">两台设备连同一个 WiFi 时最快，数据不出门。</p>');

    h.push('<div class="seg data-seg" data-chx-role style="margin-bottom:10px">');
    h.push('<button type="button" data-chx-setrole="off"' + (!hostRunning ? ' class="active"' : '') + '>不开放</button>');
    h.push('<button type="button" data-chx-setrole="host"' + (hostRunning ? ' class="active"' : '') + '>作为接收方</button>');
    h.push('</div>');

    if (hostRunning && hostInfoCache) {
      h.push('<div style="background:var(--accent-soft);border-radius:10px;padding:10px;margin-bottom:10px">');
      h.push('<p style="margin:0 0 4px;font-size:12px;color:var(--accent-ink)">让对方在下面填这个地址：</p>');
      h.push('<p style="margin:0;font-size:15px;font-weight:600;letter-spacing:0.02em;color:var(--accent-ink);word-break:break-all">' +
        U.esc((hostInfoCache.ips && hostInfoCache.ips[0] ? hostInfoCache.ips[0] : '未获取到本机 IP') + ':' + hostInfoCache.port) + '</p>');
      h.push('</div>');
    }

    h.push('<div class="field" style="margin-bottom:8px">');
    h.push('<label>对方地址</label>');
    h.push('<input class="input" data-chx-addr inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="192.168.1.23:17520" value="' + U.esc(wd.lanAddr || '') + '">');
    h.push('</div>');
    h.push('<button class="btn btn-primary btn-block" type="button" data-chx-act="lan-sync">立即与对方同步</button>');
    h.push('</div>');

    /* ---- WebDAV ---- */
    h.push('<div style="border:1px solid var(--line);border-radius:var(--radius-sm);padding:14px">');
    h.push('<h4 style="margin:0 0 4px;font-size:13.5px;font-weight:600">WebDAV 网盘</h4>');
    h.push('<p class="hint" style="margin:0 0 10px">走出门也能同步。坚果云免费版即可，填「应用密码」不是登录密码。</p>');

    h.push('<div class="field" style="margin-bottom:8px"><label>服务器地址</label>');
    h.push('<input class="input" data-chx-wd="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://dav.jianguoyun.com/dav/" value="' + U.esc(wd.url) + '"></div>');

    h.push('<div class="field" style="margin-bottom:8px"><label>账号</label>');
    h.push('<input class="input" data-chx-wd="user" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="邮箱" value="' + U.esc(wd.user) + '"></div>');

    h.push('<div class="field" style="margin-bottom:8px"><label>应用密码</label>');
    h.push('<input class="input" type="password" data-chx-wd="pass" placeholder="在坚果云「安全选项」里生成" value="' + U.esc(wd.pass) + '"></div>');

    h.push('<div class="field" style="margin-bottom:8px"><label>文件路径</label>');
    h.push('<input class="input" data-chx-wd="path" placeholder="/chenhun/data.json" value="' + U.esc(wd.path) + '"></div>');

    h.push('<div class="seg data-seg" data-chx-auto style="margin-bottom:10px">');
    h.push('<button type="button" data-chx-auto-val="1"' + (wd.auto ? ' class="active"' : '') + '>自动同步</button>');
    h.push('<button type="button" data-chx-auto-val="0"' + (!wd.auto ? ' class="active"' : '') + '>手动同步</button>');
    h.push('</div>');

    h.push('<button class="btn btn-ghost btn-block" type="button" data-chx-act="wd-save">保存并测试</button>');
    h.push('<button class="btn btn-primary btn-block" type="button" data-chx-act="wd-sync" style="margin-top:8px">立即从网盘同步</button>');
    h.push('</div>');

    if (!hasBridge()) {
      h.push('<p class="hint" style="color:var(--warm)">当前是浏览器直接打开，同步需要桌面版或安卓版。' +
        '这个页面里的「分享码」仍然可以手动传数据。</p>');
    }

    h.push('<button class="btn btn-ghost btn-block" type="button" data-chx-act="reset-base" style="margin-top:4px">重建同步基线</button>');
    h.push('<p class="hint">重建基线用于两端数据明显错乱时。会以当前数据为新起点，不会删除任何内容。</p>');

    h.push('</div></section>');
    return h.join('');
  }

  function renderPanel() {
    var view = document.getElementById('view');
    if (!view) return;
    var old = view.querySelector('[data-chx-sync]');
    if (!old) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = buildPanel();
    var fresh = tmp.firstChild;
    old.parentNode.replaceChild(fresh, old);
    bindPanel(fresh);
  }

  function bindPanel(root) {
    if (!root) return;

    root.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-chx-act],[data-chx-setrole],[data-chx-auto-val]');
      if (!t || !root.contains(t)) return;

      var role = t.getAttribute('data-chx-setrole');
      if (role) {
        Array.prototype.forEach.call(root.querySelectorAll('[data-chx-setrole]'), function (b) {
          b.classList.toggle('active', b === t);
        });
        if (role === 'host') {
          startHost().then(function (info) {
            hostRunning = true;
            hostInfoCache = info;
            pushHostState();
            renderPanel();
            if (App.toast) App.toast('已开放接收，等待对方连接');
          }).catch(function (e) {
            if (App.toast) App.toast('开启失败：' + e.message, 'error');
          });
        } else {
          hostRunning = false;
          hostInfoCache = null;
          stopHost();
          renderPanel();
        }
        return;
      }

      var autoVal = t.getAttribute('data-chx-auto-val');
      if (autoVal) {
        var c = loadCfg();
        c.webdav.auto = autoVal === '1';
        c.webdav.enabled = true;
        saveCfg(c);
        Array.prototype.forEach.call(root.querySelectorAll('[data-chx-auto-val]'), function (b) {
          b.classList.toggle('active', b === t);
        });
        if (c.webdav.auto) scheduleAuto();
        return;
      }

      var act = t.getAttribute('data-chx-act');
      if (act === 'lan-sync') {
        var addrEl = root.querySelector('[data-chx-addr]');
        var addr = addrEl ? addrEl.value.trim() : '';
        var c2 = loadCfg();
        c2.webdav.lanAddr = addr;
        saveCfg(c2);
        t.disabled = true;
        var old = t.textContent;
        t.textContent = '同步中…';
        lanSyncAsClient(addr).then(function (rep) {
          t.disabled = false; t.textContent = old;
          if (App.toast) App.toast('同步完成：' + reportLine(rep));
          renderPanel();
        }).catch(function (e) {
          t.disabled = false; t.textContent = old;
          if (App.toast) App.toast(e.message, 'error');
        });
        return;
      }

      if (act === 'wd-save') {
        if (!saveWdForm(root)) return;
        t.disabled = true; var o2 = t.textContent; t.textContent = '测试中…';
        webdavSync().then(function (rep) {
          t.disabled = false; t.textContent = o2;
          if (App.toast) App.toast('可用：' + reportLine(rep));
          renderPanel();
        }).catch(function (e) {
          t.disabled = false; t.textContent = o2;
          if (App.toast) App.toast(e.message, 'error');
        });
        return;
      }

      if (act === 'wd-sync') {
        if (!saveWdForm(root)) return;
        t.disabled = true; var o3 = t.textContent; t.textContent = '同步中…';
        webdavSync().then(function (rep) {
          t.disabled = false; t.textContent = o3;
          if (App.toast) App.toast('同步完成：' + reportLine(rep));
          renderPanel();
        }).catch(function (e) {
          t.disabled = false; t.textContent = o3;
          if (App.toast) App.toast(e.message, 'error');
        });
        return;
      }

      if (act === 'reset-base') {
        saveBase(S.state);
        if (App.toast) App.toast('基线已重建为当前数据');
        return;
      }
    });

    root.addEventListener('change', function (ev) {
      var el = ev.target;
      if (el && el.hasAttribute && el.hasAttribute('data-chx-addr')) {
        var c = loadCfg(); c.webdav.lanAddr = el.value.trim(); saveCfg(c);
      }
    });
  }

  function saveWdForm(root) {
    var get = function (k) {
      var el = root.querySelector('[data-chx-wd="' + k + '"]');
      return el ? el.value.trim() : '';
    };
    var url = get('url');
    if (!url) { if (App.toast) App.toast('请先填 WebDAV 服务器地址', 'error'); return false; }
    var c = loadCfg();
    c.webdav.url = url;
    c.webdav.user = get('user');
    c.webdav.pass = get('pass');
    c.webdav.path = get('path') || '/chenhun/data.json';
    c.webdav.enabled = true;
    saveCfg(c);
    return true;
  }

  /* ==================================================================
   * 九、安装
   * ================================================================== */
  function install() {
    installHooks();

    var view = App.views && App.views.data;
    if (!view || typeof view.render !== 'function') {
      console.warn('[同步] 没有找到数据页，同步面板未挂载');
      return;
    }

    var orig = view.render;
    view.render = function (viewEl) {
      orig.call(this, viewEl);
      try {
        var grid = viewEl.querySelector('.data-grid') || viewEl;
        var wrap = document.createElement('div');
        wrap.innerHTML = buildPanel();
        var card = wrap.firstChild;
        grid.insertBefore(card, grid.firstChild);
        bindPanel(card);
      } catch (e) {
        console.warn('[同步] 面板渲染失败', e);
      }
    };
  }

  window.ChxSync = {
    merge: mergeState,
    merge3: merge3,
    lanSync: lanSyncAsClient,
    webdavSync: webdavSync,
    startHost: startHost,
    stopHost: stopHost,
    applyState: applyState,
    saveBase: saveBase,
    loadBase: loadBase,
    clearBase: clearBase,
    deviceId: deviceId,
    refresh: renderPanel
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
