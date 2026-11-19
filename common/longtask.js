/* ====================================================================
 * 晨昏日程 · 长期任务 v1.0   longtask.js
 * --------------------------------------------------------------------
 * 跨多天推进、带进度和截止日期的任务（如"写毕业论文""刷完 1000 题"）。
 * 与「今日任务」的区别：不绑定某一天，随时推进一格。
 *
 * 接入方式（不改原应用代码）：
 *   1. 包装 S.normalize，给状态加上 longTasks 字段并做清洗
 *   2. 包装「规划」页的 render，在页头下方插入卡片
 * ==================================================================== */
(function () {
  'use strict';

  var App = window.App;
  if (!App) { console.error('[长期任务] App 未就绪'); return; }
  var U = App.util, S = App.store;

  var KEY = 'longTasks';
  var MAX_ITEMS = 200;
  var FORM_ID = 'lt-form';

  /* ---------------- 数据 ---------------- */
  function nowIso() { return new Date().toISOString(); }

  function sanitize(arr) {
    return (Array.isArray(arr) ? arr : [])
      .filter(function (x) { return x && typeof x === 'object' && !Array.isArray(x); })
      .slice(0, MAX_ITEMS)
      .map(function (x) {
        var total = Math.max(1, Math.min(9999, Math.round(Number(x.total) || 10)));
        var progress = Math.max(0, Math.min(total, Math.round(Number(x.progress) || 0)));
        return {
          id: typeof x.id === 'string' && x.id ? x.id : U.uid('lt'),
          title: x.title == null ? '' : String(x.title).slice(0, 80),
          note: x.note == null ? '' : String(x.note).slice(0, 200),
          due: U.validKey(x.due) ? x.due : '',
          total: total,
          progress: progress,
          done: !!x.done,
          createdAt: typeof x.createdAt === 'string' ? x.createdAt : nowIso()
        };
      });
  }

  function list() { return (S.state && S.state[KEY]) || []; }

  function persist() {
    S.save();
    if (App.refresh) App.refresh();
  }

  function find(id) {
    var arr = list();
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  function addItem(data) {
    if (!S.state[KEY]) S.state[KEY] = [];
    var item = sanitize([Object.assign({ id: U.uid('lt'), createdAt: nowIso() }, data)])[0];
    if (!item.title) return false;
    S.state[KEY].unshift(item);
    persist();
    return true;
  }

  function updateItem(id, patch) {
    var it = find(id);
    if (!it) return false;
    Object.assign(it, patch);
    var clean = sanitize([it])[0];
    Object.assign(it, clean);
    persist();
    return true;
  }

  function removeItem(id) {
    var arr = list();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) { arr.splice(i, 1); persist(); return true; }
    }
    return false;
  }

  function bump(id, delta) {
    var it = find(id);
    if (!it) return;
    var next = Math.max(0, Math.min(it.total, it.progress + delta));
    it.progress = next;
    if (next >= it.total) it.done = true;
    else if (it.done && next < it.total) it.done = false;
    persist();
  }

  /* ---------------- 小工具 ---------------- */
  function daysLeft(due) {
    if (!due) return null;
    var a = U.parseKey(due), b = U.parseKey(U.todayKey());
    return Math.round((a - b) / 86400000);
  }

  function dueText(it) {
    if (!it.due) return '';
    var d = daysLeft(it.due);
    var s = '截止 ' + U.fmtDate(it.due);
    if (d === null) return s;
    if (d < 0) return s + ' · 已逾期 ' + (-d) + ' 天';
    if (d === 0) return s + ' · 今天到期';
    return s + ' · 还剩 ' + d + ' 天';
  }

  function pct(it) {
    return it.total > 0 ? Math.round(it.progress / it.total * 100) : 0;
  }

  /* ---------------- 样式（只注入一次） ---------------- */
  function injectStyle() {
    if (document.getElementById('lt-style')) return;
    var st = document.createElement('style');
    st.id = 'lt-style';
    st.textContent = [
      '.lt-card{margin-bottom:16px}',
      '.lt-item{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--line)}',
      '.lt-item:first-child{border-top:0;padding-top:4px}',
      '.lt-main{flex:1;min-width:0}',
      '.lt-title{font-size:14px;font-weight:550;color:var(--ink);line-height:1.4;word-break:break-word}',
      '.lt-item.lt-done .lt-title{text-decoration:line-through;color:var(--muted)}',
      '.lt-meta{font-size:12px;color:var(--muted);margin-top:3px;line-height:1.5}',
      '.lt-bar{height:5px;border-radius:99px;background:var(--bg-soft);margin-top:8px;overflow:hidden}',
      '.lt-bar>i{display:block;height:100%;border-radius:99px;background:var(--accent);transition:width .25s ease}',
      '.lt-item.lt-done .lt-bar>i{background:var(--ok)}',
      '.lt-num{font-variant-numeric:tabular-nums;color:var(--accent-ink);font-weight:550}',
      '.lt-acts{display:flex;gap:4px;flex:none}',
      '.lt-acts button{width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink-soft);font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer}',
      '.lt-acts button:active{background:var(--accent-soft)}',
      '.lt-acts button.lt-danger{color:var(--danger)}',
      '.lt-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2);margin-bottom:12px}',
      '.lt-form .lt-full{grid-column:1/-1}',
      '.lt-form label{font-size:12px;color:var(--muted);display:block;margin-bottom:5px}',
      '.lt-form-acts{grid-column:1/-1;display:flex;gap:8px}',
      '.lt-empty{color:var(--muted);font-size:13px;padding:6px 0 2px}',
      '@media (max-width:520px){.lt-form{grid-template-columns:1fr}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------- 渲染 ---------------- */
  function itemHTML(it) {
    var p = pct(it);
    return '<div class="lt-item' + (it.done ? ' lt-done' : '') + '" data-lt-id="' + U.esc(it.id) + '">' +
      '<div class="lt-main">' +
        '<div class="lt-title">' + U.esc(it.title) + '</div>' +
        '<div class="lt-meta">' +
          '<span class="lt-num">' + it.progress + '/' + it.total + '</span>' +
          (it.due ? ' · ' + U.esc(dueText(it)) : '') +
          (it.note ? ' · ' + U.esc(it.note) : '') +
        '</div>' +
        '<div class="lt-bar"><i style="width:' + p + '%"></i></div>' +
      '</div>' +
      '<div class="lt-acts">' +
        '<button type="button" data-lt="minus" title="减一格">−</button>' +
        '<button type="button" data-lt="plus" title="推进一格">+</button>' +
        '<button type="button" data-lt="edit" title="编辑">改</button>' +
        '<button type="button" data-lt="del" class="lt-danger" title="删除">×</button>' +
      '</div>' +
    '</div>';
  }

  function formHTML(it) {
    it = it || {};
    return '<div class="lt-form" data-lt-form>' +
      '<div class="lt-full"><label>要做的事</label>' +
        '<input class="input" data-lt-f="title" maxlength="80" placeholder="如：写毕业论文" value="' + U.esc(it.title || '') + '"></div>' +
      '<div><label>总共多少格</label>' +
        '<input class="input" type="number" min="1" max="9999" data-lt-f="total" value="' + (it.total || 10) + '"></div>' +
      '<div><label>截止日期（可空）</label>' +
        '<input class="input" type="date" data-lt-f="due" value="' + U.esc(it.due || '') + '"></div>' +
      '<div class="lt-form-acts">' +
        '<button class="btn btn-primary" type="button" data-lt="form-save">保存</button>' +
        '<button class="btn btn-ghost" type="button" data-lt="form-cancel">取消</button>' +
      '</div>' +
    '</div>';
  }

  function cardHTML() {
    var arr = list();
    var doing = arr.filter(function (x) { return !x.done; }).length;
    var h = [];
    h.push('<section class="card lt-card" data-lt-root>');
    h.push('<div class="card-hd"><div><h3 class="card-title">长期任务</h3>');
    h.push('<p class="card-sub">跨好几天的事，按格子推进' + (arr.length ? ' · ' + doing + ' 项进行中' : '') + '</p></div>');
    h.push('<button class="btn btn-ghost" type="button" data-lt="new">新增</button></div>');
    h.push('<div class="card-bd" data-lt-body>');
    h.push(arr.length
      ? arr.map(itemHTML).join('')
      : '<p class="lt-empty">还没有长期任务。点右上角「新增」，像「刷完 1000 题」「写完初稿」这种跨多天的事放这里。</p>');
    h.push('</div></section>');
    return h.join('');
  }

  /* ---------------- 交互 ---------------- */
  var editingId = null;   // null = 未打开表单；'' = 新建

  function bind(card) {
    if (!card || card.__ltBound) return;
    card.__ltBound = true;

    card.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-lt]') : null;
      if (!btn || !card.contains(btn)) return;
      var act = btn.getAttribute('data-lt');
      var host = btn.closest('[data-lt-id]');
      var id = host ? host.getAttribute('data-lt-id') : null;

      if (act === 'new') { openForm(card, null); return; }
      if (act === 'form-cancel') { closeForm(card); return; }
      if (act === 'form-save') { saveForm(card); return; }
      if (!id) return;

      if (act === 'plus') { bump(id, 1); return; }
      if (act === 'minus') { bump(id, -1); return; }
      if (act === 'edit') { openForm(card, find(id)); return; }
      if (act === 'del') {
        App.confirm({
          title: '删除这个长期任务？',
          text: '只删这一条，不影响每天的日程记录。',
          okLabel: '删除',
          danger: true
        }).then(function (ok) { if (ok) removeItem(id); });
        return;
      }
    });

    card.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target && ev.target.getAttribute && ev.target.getAttribute('data-lt-f') === 'title') {
        ev.preventDefault();
        saveForm(card);
      }
    });
  }

  function openForm(card, item) {
    closeForm(card);
    editingId = item ? item.id : '';
    var body = card.querySelector('[data-lt-body]');
    if (!body) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = formHTML(item);
    body.insertBefore(wrap.firstChild, body.firstChild);
    var first = card.querySelector('[data-lt-f="title"]');
    if (first) setTimeout(function () { try { first.focus(); } catch (e) { } }, 30);
  }

  function closeForm(card) {
    var f = card.querySelector('[data-lt-form]');
    if (f) f.remove();
    editingId = null;
  }

  function saveForm(card) {
    var get = function (k) {
      var el = card.querySelector('[data-lt-f="' + k + '"]');
      return el ? el.value : '';
    };
    var title = String(get('title') || '').trim();
    if (!title) { App.toast('先写一句要做的事', 'error'); return; }
    var total = Math.max(1, Math.round(Number(get('total')) || 1));
    var due = String(get('due') || '').trim();

    if (editingId) {
      updateItem(editingId, { title: title, total: total, due: due });
      App.toast('已更新');
    } else {
      addItem({ title: title, total: total, due: due, progress: 0 });
      App.toast('已加入长期任务');
    }
    editingId = null;
  }

  /* ---------------- 安装 ---------------- */
  function installNormalize() {
    var orig = S.normalize;
    S.normalize = function (st) {
      var out = orig.apply(S, arguments);
      try {
        out[KEY] = sanitize(st && st[KEY]);
      } catch (e) {
        out[KEY] = [];
      }
      return out;
    };
  }

  function installView() {
    var v = App.views && App.views.roadmap;
    if (!v || typeof v.render !== 'function') {
      console.warn('[长期任务] 没有找到规划页，卡片未挂载');
      return;
    }
    var orig = v.render;
    v.render = function (el) {
      orig.apply(this, arguments);
      try {
        var page = el.querySelector('.rm-page');
        if (!page) return;
        var wrap = document.createElement('div');
        wrap.innerHTML = cardHTML();
        var card = wrap.firstChild;
        var head = page.querySelector('.rm-head');
        if (head && head.nextSibling) page.insertBefore(card, head.nextSibling);
        else page.insertBefore(card, page.firstChild);
        bind(card);
      } catch (e) {
        console.warn('[长期任务] 卡片渲染失败', e);
      }
    };
  }

  function install() {
    injectStyle();
    installNormalize();
    installView();
    if (S.state && !Array.isArray(S.state[KEY])) S.state[KEY] = [];
  }

  window.ChxLongTask = {
    list: list,
    add: addItem,
    update: updateItem,
    remove: removeItem,
    bump: bump
  };

  /* 必须同步安装：App.boot() 在解析阶段就会执行 S.load()，
     而 load 内部调用 S.normalize。晚一步安装就会在首次加载时把
     longTasks 丢掉，随后任何一次保存都会把"已丢失"的状态写回去。 */
  install();
})();
