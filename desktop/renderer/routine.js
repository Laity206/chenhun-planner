/* ====================================================================
 * 晨昏日程 · 每日定时任务 v1.0   routine.js
 * --------------------------------------------------------------------
 * 每天（或工作日 / 周末）自动出现在「今日」待办里的固定事项，
 * 例如"背 30 个单词""晚上复盘 10 分钟"。
 *
 * 实现要点
 *   1. 打开某一天时，把命中的定时任务"落地"成当天的真实任务，
 *      之后勾选、计时、统计全部沿用原有逻辑，不改动原应用。
 *   2. 落地任务用**确定性 id**（rt_<定时id>_<日期>），
 *      这样两端同一天各自落地也会在同步时按 id 去重，不会变成两条。
 *   3. routineLog 记录"这一天已经处理过这个定时任务"，
 *      用于尊重用户手动删除（删了就不再复活）。
 * ==================================================================== */
(function () {
  'use strict';

  var App = window.App;
  if (!App) { console.error('[每日定时] App 未就绪'); return; }
  var U = App.util, S = App.store;

  var K_ROUTINE = 'routines';
  var K_LOG = 'routineLog';
  var MAX_ITEMS = 60;

  var REPEATS = {
    daily: { label: '每天', match: function () { return true; } },
    workday: { label: '工作日', match: function (w) { return w >= 1 && w <= 5; } },
    weekend: { label: '周末', match: function (w) { return w >= 6; } }
  };

  /* ---------------- 数据 ---------------- */
  function nowIso() { return new Date().toISOString(); }

  function sanitize(arr) {
    return (Array.isArray(arr) ? arr : [])
      .filter(function (x) { return x && typeof x === 'object' && !Array.isArray(x); })
      .slice(0, MAX_ITEMS)
      .map(function (x) {
        return {
          id: typeof x.id === 'string' && x.id ? x.id : U.uid('rt'),
          title: x.title == null ? '' : String(x.title).slice(0, 60),
          slot: App.PERIODS[x.slot] ? x.slot : 'morning',
          duration: U.clamp(Math.round(Number(x.duration)) || 30, 5, 600),
          category: App.CATEGORIES.indexOf(x.category) >= 0 ? x.category : '学习',
          priority: App.PRIORITIES[x.priority] ? x.priority : 'normal',
          repeat: REPEATS[x.repeat] ? x.repeat : 'daily',
          active: x.active !== false,
          createdAt: typeof x.createdAt === 'string' ? x.createdAt : nowIso()
        };
      });
  }

  function list() { return (S.state && S.state[K_ROUTINE]) || []; }
  function logMap() {
    if (!S.state[K_LOG] || typeof S.state[K_LOG] !== 'object') S.state[K_LOG] = {};
    return S.state[K_LOG];
  }

  function persist() { S.save(); if (App.refresh) App.refresh(); }

  function find(id) {
    var arr = list();
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  function addItem(data) {
    if (!S.state[K_ROUTINE]) S.state[K_ROUTINE] = [];
    var it = sanitize([Object.assign({ id: U.uid('rt') }, data)])[0];
    if (!it.title) return false;
    S.state[K_ROUTINE].push(it);
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

  function toggleActive(id) {
    var it = find(id);
    if (!it) return;
    it.active = !it.active;
    persist();
  }

  /* ---------------- 落地到某一天的待办 ---------------- */
  function taskIdFor(routineId, dateKey) {
    return 'rt_' + String(routineId).replace(/[^A-Za-z0-9_-]/g, '') + '_' + dateKey.replace(/-/g, '');
  }

  function materialize(dateKey, silent) {
    if (!U.validKey(dateKey)) return 0;
    var arr = list().filter(function (r) { return r.active !== false; });
    if (!arr.length) return 0;

    var w = U.weekdayOf(dateKey);
    var log = logMap();
    if (!log[dateKey] || typeof log[dateKey] !== 'object') log[dateKey] = {};

    /* 先筛出今天该处理且没处理过的；一条都没有就完全不碰 state，
       避免给每个浏览过的日期建空记录 */
    var hits = arr.filter(function (r) {
      return REPEATS[r.repeat].match(w) && !log[dateKey][r.id];
    });
    if (!hits.length) return 0;

    var day = S.day(dateKey, true);
    var added = 0;
    hits.forEach(function (r) {
      var tid = taskIdFor(r.id, dateKey);
      /* 同一天的重复判定：id 相同，或已存在同名且同样是定时生成的条目。
         后者用于兜底——删掉定时任务再新建会拿到新 id，
         否则当天会出现两条一模一样的东西。 */
      var exists = (day.tasks || []).some(function (t) {
        if (!t) return false;
        if (t.id === tid) return true;
        return String(t.id).indexOf('rt_') === 0 && t.title === r.title;
      });
      if (!exists) {
        day.tasks.push({
          id: tid,
          title: r.title,
          slot: r.slot,
          duration: r.duration,
          done: false,
          priority: r.priority,
          category: r.category,
          start: '',
          end: '',
          note: '',
          createdAt: nowIso()
        });
        added++;
      }
      log[dateKey][r.id] = 1;
    });

    if (!silent) S.save();
    return added;
  }

  /* ---------------- 样式（复用长期任务的 .lt-* 基础样式） ---------------- */
  function injectStyle() {
    if (document.getElementById('rt-style')) return;
    var st = document.createElement('style');
    st.id = 'rt-style';
    st.textContent = [
      '.rt-tag{display:inline-block;padding:1px 7px;border-radius:99px;background:var(--accent-soft);color:var(--accent-ink);font-size:11.5px;margin-left:6px;vertical-align:1px}',
      '.rt-off .lt-title{color:var(--muted)}',
      '.rt-off{opacity:.62}',
      '.rt-acts button.rt-on{color:var(--accent-ink);border-color:var(--accent)}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------- 渲染 ---------------- */
  function metaText(r) {
    return (App.PERIODS[r.slot] ? App.PERIODS[r.slot].label : '早上') + ' · ' + r.duration + ' 分钟';
  }

  function itemHTML(r) {
    return '<div class="lt-item' + (r.active === false ? ' rt-off' : '') + '" data-rt-id="' + U.esc(r.id) + '">' +
      '<div class="lt-main">' +
        '<div class="lt-title">' + U.esc(r.title) +
          '<span class="rt-tag">' + U.esc(REPEATS[r.repeat].label) + '</span></div>' +
        '<div class="lt-meta">' + U.esc(metaText(r)) + ' · 自动出现在待办里</div>' +
      '</div>' +
      '<div class="lt-acts rt-acts">' +
        '<button type="button" data-rt="toggle" class="' + (r.active === false ? '' : 'rt-on') + '" title="启用/停用">' +
          (r.active === false ? '启' : '停') + '</button>' +
        '<button type="button" data-rt="del" class="lt-danger" title="删除">×</button>' +
      '</div>' +
    '</div>';
  }

  function formHTML() {
    var h = [];
    h.push('<div class="lt-form" data-rt-form>');
    h.push('<div class="lt-full"><label>每天要做的事</label>');
    h.push('<input class="input" data-rt-f="title" maxlength="60" placeholder="如：背 30 个单词"></div>');
    h.push('<div><label>放在哪个时段</label><select class="input" data-rt-f="slot">');
    ['morning', 'afternoon', 'evening'].forEach(function (k) {
      h.push('<option value="' + k + '">' + App.PERIODS[k].label + '（' + App.PERIODS[k].hint + '）</option>');
    });
    h.push('</select></div>');
    h.push('<div><label>预计用时（分钟）</label>');
    h.push('<input class="input" type="number" min="5" max="600" step="5" data-rt-f="duration" value="30"></div>');
    h.push('<div><label>重复</label><select class="input" data-rt-f="repeat">');
    ['daily', 'workday', 'weekend'].forEach(function (k) {
      h.push('<option value="' + k + '">' + REPEATS[k].label + '</option>');
    });
    h.push('</select></div>');
    h.push('<div class="lt-form-acts">');
    h.push('<button class="btn btn-primary" type="button" data-rt="save">保存</button>');
    h.push('<button class="btn btn-ghost" type="button" data-rt="cancel">取消</button>');
    h.push('</div></div>');
    return h.join('');
  }

  function cardHTML() {
    var arr = list();
    var on = arr.filter(function (r) { return r.active !== false; }).length;
    var h = [];
    h.push('<section class="card lt-card" data-rt-root>');
    h.push('<div class="card-hd"><div><h3 class="card-title">每日定时任务</h3>');
    h.push('<p class="card-sub">每天自动出现在「今天」的待办里' + (arr.length ? ' · ' + on + ' 项启用中' : '') + '</p></div>');
    h.push('<button class="btn btn-ghost" type="button" data-rt="new">新增</button></div>');
    h.push('<div class="card-bd" data-rt-body>');
    h.push(arr.length
      ? arr.map(itemHTML).join('')
      : '<p class="lt-empty">还没有定时任务。适合放「每天都要做一点」的事：背单词、练字、复盘。跨多天推进的大目标放上面的长期任务。</p>');
    h.push('</div></section>');
    return h.join('');
  }

  /* ---------------- 交互 ---------------- */
  function bind(card) {
    if (!card || card.__rtBound) return;
    card.__rtBound = true;

    card.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-rt]') : null;
      if (!btn || !card.contains(btn)) return;
      var act = btn.getAttribute('data-rt');
      var host = btn.closest('[data-rt-id]');
      var id = host ? host.getAttribute('data-rt-id') : null;

      if (act === 'new') { openForm(card); return; }
      if (act === 'cancel') { closeForm(card); return; }
      if (act === 'save') { saveForm(card); return; }
      if (!id) return;
      if (act === 'toggle') { toggleActive(id); return; }
      if (act === 'del') {
        App.confirm({
          title: '删除这个定时任务？',
          text: '以后每天不再自动生成。已经生成的待办会保留。',
          okLabel: '删除',
          danger: true
        }).then(function (ok) { if (ok) removeItem(id); });
        return;
      }
    });

    card.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target && ev.target.getAttribute &&
          ev.target.getAttribute('data-rt-f') === 'title') {
        ev.preventDefault();
        saveForm(card);
      }
    });
  }

  function openForm(card) {
    closeForm(card);
    var body = card.querySelector('[data-rt-body]');
    if (!body) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = formHTML();
    body.insertBefore(wrap.firstChild, body.firstChild);
    var first = card.querySelector('[data-rt-f="title"]');
    if (first) setTimeout(function () { try { first.focus(); } catch (e) { } }, 30);
  }

  function closeForm(card) {
    var f = card.querySelector('[data-rt-form]');
    if (f) f.remove();
  }

  function saveForm(card) {
    var get = function (k) {
      var el = card.querySelector('[data-rt-f="' + k + '"]');
      return el ? el.value : '';
    };
    var title = String(get('title') || '').trim();
    if (!title) { App.toast('先写一句要做的事', 'error'); return; }

    addItem({
      title: title,
      slot: get('slot') || 'morning',
      duration: Number(get('duration')) || 30,
      repeat: get('repeat') || 'daily',
      active: true
    });

    // 立刻为今天补上，不用等下次打开
    materialize(U.todayKey(), true);
    App.toast('已加入每日任务');
    if (App.refresh) App.refresh();
  }

  /* ---------------- 安装 ---------------- */
  function installNormalize() {
    var orig = S.normalize;
    S.normalize = function (st) {
      var out = orig.apply(S, arguments);
      try { out[K_ROUTINE] = sanitize(st && st[K_ROUTINE]); } catch (e) { out[K_ROUTINE] = []; }
      try {
        var lg = (st && st[K_LOG] && typeof st[K_LOG] === 'object') ? st[K_LOG] : {};
        var clean = {};
        Object.keys(lg).forEach(function (k) {
          if (!U.validKey(k)) return;
          var m = lg[k];
          if (!m || typeof m !== 'object') return;
          var item = {};
          Object.keys(m).forEach(function (id) { if (m[id]) item[id] = 1; });
          if (Object.keys(item).length) clean[k] = item;
        });
        out[K_LOG] = clean;
      } catch (e) { out[K_LOG] = {}; }
      return out;
    };
  }

  /* 今日页渲染前落地，保证打开就看到 */
  function installDaily() {
    var v = App.views && App.views.daily;
    if (!v || typeof v.render !== 'function') return;
    var orig = v.render;
    v.render = function (el) {
      try { materialize(App.ui.dateKey || U.todayKey()); } catch (e) { console.warn('[每日定时] 落地失败', e); }
      return orig.apply(this, arguments);
    };
  }

  /* 规划页追加卡片（长期任务卡由 longtask.js 插入，这里排在它后面） */
  function installPlan() {
    var v = App.views && App.views.roadmap;
    if (!v || typeof v.render !== 'function') {
      console.warn('[每日定时] 没有找到规划页');
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
        var anchor = page.querySelector('[data-lt-root]');
        if (anchor && anchor.nextSibling) page.insertBefore(card, anchor.nextSibling);
        else {
          var head = page.querySelector('.rm-head');
          if (head && head.nextSibling) page.insertBefore(card, head.nextSibling);
          else page.insertBefore(card, page.firstChild);
        }
        bind(card);
      } catch (e) {
        console.warn('[每日定时] 卡片渲染失败', e);
      }
    };
  }

  function install() {
    injectStyle();
    installNormalize();
    installDaily();
    installPlan();
    if (S.state) {
      if (!Array.isArray(S.state[K_ROUTINE])) S.state[K_ROUTINE] = [];
      try { materialize(U.todayKey(), true); } catch (e) { }
    }
  }

  window.ChxRoutine = {
    list: list,
    add: addItem,
    remove: removeItem,
    toggle: toggleActive,
    materialize: materialize
  };

  /* 同步安装，理由同 longtask.js：App.boot() 在解析阶段就会调用 S.normalize */
  install();
})();
