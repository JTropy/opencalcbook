/*!
 * OpenCalcBook / 开源计算书 — 应用界面
 * ---------------------------------------------------------------------------
 * 纯前端（无构建、无依赖），直接双击 index.html 即可运行。
 * 数据全部保存在浏览器 localStorage，导出为普通 JSON 文件。
 *
 * License: MIT
 */
(function () {
  'use strict';

  var M = window.CBModel;
  var U = window.CBUnits;
  var E = window.CBExpr;
  var R = window.CBReport;
  var X = window.CBExport;

  var LS_KEY = 'opencalcbook.project.v1';
  var LS_REPORT = 'opencalcbook.report.v1';
  var LS_THEME = 'opencalcbook.theme';

  /* 本地存储封装：file:// 或隐私模式下 localStorage 可能不可用，退化为内存存储 */
  var store = (function () {
    var mem = Object.create(null);
    var usable = false;
    try {
      window.localStorage.setItem('__ocb_probe', '1');
      window.localStorage.removeItem('__ocb_probe');
      usable = true;
    } catch (e) { usable = false; }
    return {
      usable: usable,
      get: function (k) {
        try { return usable ? window.localStorage.getItem(k) : (k in mem ? mem[k] : null); }
        catch (e) { return k in mem ? mem[k] : null; }
      },
      set: function (k, v) {
        mem[k] = v;
        try { if (usable) window.localStorage.setItem(k, v); } catch (e) { /* 容量超限等忽略 */ }
      }
    };
  })();

  /* =====================================================================
   * 状态
   * =================================================================== */
  var state = {
    project: null,
    report: null,
    calc: null,
    selectedId: null,
    collapsed: Object.create(null),
    editingFn: null,
    rowEls: Object.create(null),
    dirty: false
  };

  /* =====================================================================
   * DOM 小工具
   * =================================================================== */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else if (k === 'style') n.setAttribute('style', attrs[k]);
        else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] === true) n.setAttribute(k, '');
        else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
      }
    }
    if (kids) {
      (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
        if (c === null || c === undefined) return;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* =====================================================================
   * 列定义辅助
   * =================================================================== */
  var SIMPLE_FIELDS = {
    no: 'no', name: 'name', part: 'part', expr: 'expr', unit: 'unit',
    factor: 'factor', gclExpr: 'gclExpr', code: 'code', remark: 'remark',
    ignore: 'ignore', summary: 'summary'
  };

  function visibleColumns() {
    return (state.project.columns || []).filter(function (c) { return c.visible; });
  }

  function getField(row, key) {
    if (Object.prototype.hasOwnProperty.call(SIMPLE_FIELDS, key)) {
      return row[SIMPLE_FIELDS[key]];
    }
    return (row.fields || {})[key];
  }

  function setField(row, key, value) {
    if (Object.prototype.hasOwnProperty.call(SIMPLE_FIELDS, key)) {
      row[SIMPLE_FIELDS[key]] = value;
    } else {
      if (!row.fields) row.fields = {};
      row.fields[key] = value;
    }
  }

  /* =====================================================================
   * 计算
   * =================================================================== */
  function recalc() {
    state.calc = M.recalc(state.project);
    return state.calc;
  }

  function resultOf(rowId) {
    return state.calc && state.calc.results[rowId];
  }

  function fmtResult(row, key) {
    var e = resultOf(row.id);
    if (!e) return { text: '', cls: '' };
    var v = (key === 'value') ? e.value : e.gcl;
    if (e.error) return { text: '错误', cls: 'cell-err' };
    if (v === null || v === undefined) return { text: '', cls: '' };
    if (typeof v === 'number') return { text: U.format(v, state.project.unitTable, row.unit, false), cls: 'value' };
    return { text: String(v), cls: 'value' };
  }

  /* =====================================================================
   * 主表格渲染
   * =================================================================== */
  function isHidden(row) {
    var p = row.pid;
    while (p) {
      if (state.collapsed[p]) return true;
      var pr = M.findRow(state.project, p);
      p = pr ? pr.pid : null;
    }
    return false;
  }

  function renderGrid() {
    var cols = visibleColumns();
    var head = $('#gridHead');
    var body = $('#gridBody');
    clear(head); clear(body);
    state.rowEls = Object.create(null);

    /* --- 表头 --- */
    var trh = el('tr');
    trh.appendChild(el('th', { style: 'width:132px', class: 'ctr', text: '操作' }));
    trh.appendChild(el('th', { style: 'width:34px', class: 'ctr', text: '#' }));
    cols.forEach(function (c) {
      trh.appendChild(el('th', {
        style: 'width:' + (c.width || 100) + 'px',
        class: c.align === 'right' ? 'num' : (c.align === 'center' ? 'ctr' : ''),
        text: c.title
      }));
    });
    head.appendChild(trh);

    /* --- 数据行 --- */
    var ordered = M.flatten(state.project);
    ordered.forEach(function (row, index) {
      if (isHidden(row)) return;
      var res = resultOf(row.id);
      var hasKids = res ? res.hasChildren : M.hasChildren(state.project, row.id);

      var tr = el('tr', { 'data-id': row.id });
      if (row.id === state.selectedId) tr.className = 'selected';
      if (res && res.error) tr.className = (tr.className ? tr.className + ' ' : '') + 'err';
      if (hasKids) tr.className = (tr.className ? tr.className + ' ' : '') + 'grp';

      /* 操作列 */
      var ops = el('td');
      ops.appendChild(el('div', { class: 'col-ops' }, [
        opBtn('＋', '插入同级行', function () { addSibling(row.id); }),
        opBtn('⤵', '插入子行', function () { addChild(row.id); }),
        opBtn('↑', '上移', function () { move(row.id, -1); }),
        opBtn('↓', '下移', function () { move(row.id, 1); }),
        opBtn('⇥', '降为上一行的子行', function () { indent(row.id); }),
        opBtn('⇤', '升一级', function () { outdent(row.id); }),
        opBtn('✕', '删除（含子行）', function () { del(row.id); }, 'del')
      ]));
      tr.appendChild(ops);

      /* 行号 */
      tr.appendChild(el('td', { class: 'ctr' }, [
        el('span', { class: 'row-no-badge', text: String(index + 1) })
      ]));

      /* 各列 */
      cols.forEach(function (c) {
        tr.appendChild(buildCell(row, c, hasKids));
      });

      body.appendChild(tr);
      state.rowEls[row.id] = { tr: tr, cells: {} };
    });

    if (!ordered.length) {
      body.appendChild(el('tr', {}, [
        el('td', { colspan: cols.length + 2, class: 'ctr', style: 'padding:28px;color:var(--text-mute)' },
          ['还没有任何计算式，点左上角「＋ 同级行」开始。'])
      ]));
    }

    /* --- 事件委托 --- */
    if (!body.__bound) {
      body.__bound = true;
      body.addEventListener('focusin', function (ev) {
        var tr = ev.target.closest ? ev.target.closest('tr[data-id]') : null;
        if (tr) select(tr.getAttribute('data-id'), false);
      });
    }
  }

  function opBtn(label, title, fn, cls) {
    return el('button', { type: 'button', title: title, class: cls || '', text: label, onclick: function (e) { e.stopPropagation(); fn(); } });
  }

  function buildCell(row, col, hasKids) {
    var td = el('td', { class: col.align === 'right' ? 'num' : (col.align === 'center' ? 'ctr' : '') });
    var key = col.key;

    /* 只读结果列 */
    if (col.type === 'result' || key === 'value' || key === 'gcl') {
      var r = fmtResult(row, key === 'gcl' ? 'gcl' : 'value');
      var span = el('span', { class: 'cell-read ' + r.cls, 'data-read': key });
      span.textContent = r.text;
      if (hasRowError(row)) {
        var e = resultOf(row.id);
        span.title = e.error.message;
      }
      td.appendChild(span);
      return td;
    }

    /* 勾选列 */
    if (col.type === 'flag' || key === 'ignore' || key === 'summary') {
      var cb = el('input', {
        type: 'checkbox',
        'data-key': key,
        checked: !!getField(row, key)
      });
      cb.addEventListener('change', function () {
        setField(row, key, cb.checked);
        afterEdit();
      });
      td.appendChild(el('div', { class: 'ctr' }, [cb]));
      return td;
    }

    /* 单位列：带下拉建议 */
    if (col.type === 'unit' || key === 'unit') {
      var ui = el('input', { type: 'text', 'data-key': key, value: getField(row, key) || '', list: 'unitList' });
      bindInput(ui, row, key, 'unit');
      td.appendChild(ui);
      return td;
    }

    /* 数值列 */
    if (col.type === 'number') {
      var ni = el('input', { type: 'text', 'data-key': key, value: (getField(row, key) === undefined || getField(row, key) === null) ? '' : getField(row, key), class: 'mono' });
      bindInput(ni, row, key, 'number');
      td.appendChild(ni);
      return td;
    }

    /* 文本 / 公式列 */
    var inp = el('input', {
      type: 'text',
      'data-key': key,
      value: getField(row, key) === undefined || getField(row, key) === null ? '' : getField(row, key),
      class: col.type === 'formula' ? 'mono' : '',
      title: col.type === 'formula' ? '双击打开发公式编辑器' : ''
    });

    /* 名称列加树形缩进与折叠箭头 */
    if (key === 'name') {
      var wrap = el('div', { class: 'cell-tree' });
      var depth = row.__depth || 0;
      if (depth > 0) wrap.appendChild(el('span', { style: 'width:' + (depth * 13) + 'px;flex:0 0 auto' }));
      var tg = el('button', {
        type: 'button',
        class: 'tree-toggle' + (hasKids ? '' : ' empty'),
        text: state.collapsed[row.id] ? '▶' : '▼',
        onclick: function (e) { e.stopPropagation(); toggleCollapse(row.id); }
      });
      wrap.appendChild(tg);
      wrap.appendChild(inp);
      td.appendChild(wrap);
    } else {
      td.appendChild(inp);
    }

    bindInput(inp, row, key, col.type);
    if (col.type === 'formula') {
      inp.addEventListener('dblclick', function () { openFormula(row.id); });
    }
    return td;
  }

  function hasRowError(row) {
    var e = resultOf(row.id);
    return !!(e && e.error);
  }

  function bindInput(inp, row, key, type) {
    var original = inp.value;

    inp.addEventListener('input', function () {
      var v = inp.value;
      if (type === 'number') {
        var n = parseFloat(v);
        setField(row, key, isFinite(n) ? n : (v.trim() === '' ? 1 : v));
      } else {
        setField(row, key, v);
      }
      inp.classList.toggle('err-input', false);
      scheduleRecalc();
      state.dirty = true;
    });

    inp.addEventListener('change', function () {
      if (inp.value !== original) {
        original = inp.value;
        afterEdit();
      }
    });

    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        afterEdit();
        if (row.id === lastVisibleRowId()) addSibling(row.id);
      } else if (ev.key === 'Escape') {
        inp.value = original;
        setField(row, key, original);
        recalc(); applyResults();
      } else if (ev.key === 'Delete' && ev.ctrlKey) {
        ev.preventDefault();
        del(row.id);
      }
    });
  }

  function lastVisibleRowId() {
    var ordered = M.flatten(state.project).filter(function (r) { return !isHidden(r); });
    return ordered.length ? ordered[ordered.length - 1].id : null;
  }

  /* =====================================================================
   * 局部刷新（避免丢失输入焦点）
   * =================================================================== */
  var recalcTimer = null;
  function scheduleRecalc() {
    clearTimeout(recalcTimer);
    recalcTimer = setTimeout(function () {
      recalc();
      applyResults();
      renderStatus();
      renderProblems();
      renderDetail();
      invalidateReportPreview();
      saveLocalSoon();
    }, 120);
  }

  function afterEdit() {
    clearTimeout(recalcTimer);
    recalc();
    applyResults();
    renderStatus();
    renderProblems();
    renderDetail();
    invalidateReportPreview();
    saveLocalSoon();
  }

  function applyResults() {
    Object.keys(state.rowEls).forEach(function (id) {
      var entry = state.rowEls[id];
      var row = M.findRow(state.project, id);
      if (!row || !entry) return;
      var res = resultOf(id);

      $$('[data-read]', entry.tr).forEach(function (span) {
        var key = span.getAttribute('data-read');
        var f = fmtResult(row, key);
        span.textContent = f.text;
        span.className = 'cell-read ' + f.cls;
        span.title = (res && res.error) ? res.error.message : '';
      });

      var hasErr = !!(res && res.error);
      entry.tr.classList.toggle('err', hasErr);
      entry.tr.classList.toggle('grp', !!(res && res.hasChildren));

      // 标记公式输入框语法错误
      $$('input[data-key="expr"], input[data-key="gclExpr"]', entry.tr).forEach(function (inp) {
        inp.classList.toggle('err-input', hasErr);
      });
    });

    if (state.selectedId) renderDetail();
  }

  /* =====================================================================
   * 左侧面板
   * =================================================================== */
  function renderConstPanel() {
    var body = $('#constBody');
    clear(body);
    (state.project.constants || []).forEach(function (c, i) {
      var tr = el('tr');
      tr.appendChild(el('td', {}, [bindMini(el('input', { type: 'text', value: c.code || '', placeholder: '代码' }), function (v) { c.code = v.replace(/^@/, ''); afterEdit(); })]));
      tr.appendChild(el('td', {}, [bindMini(el('input', { type: 'text', value: c.value === undefined ? '' : c.value, placeholder: '值或表达式' }), function (v) { c.value = v; afterEdit(); })]));
      tr.appendChild(el('td', {}, [bindMini(el('input', { type: 'text', value: c.description || '' }), function (v) { c.description = v; afterEdit(); })]));
      tr.appendChild(el('td', {}, [rowDel(function () { state.project.constants.splice(i, 1); afterEdit(); renderConstPanel(); })]));
      body.appendChild(tr);
    });
    if (!(state.project.constants || []).length) {
      body.appendChild(el('tr', {}, [el('td', { colspan: 4, class: 'ctr', style: 'color:var(--text-mute);padding:10px', text: '暂无常量' })]));
    }
  }

  function renderUnitPanel() {
    var body = $('#unitBody');
    clear(body);
    (state.project.unitTable || []).forEach(function (u, i) {
      var tr = el('tr');
      tr.appendChild(el('td', {}, [bindMini(el('input', { type: 'text', value: u.name || '', placeholder: '如 m2' }), function (v) { u.name = v; afterEdit(); })]));
      tr.appendChild(el('td', {}, [bindMini(el('input', { type: 'text', value: u.order === undefined ? '' : u.order }), function (v) { u.order = parseInt(v, 10) || 0; afterEdit(); })]));
      tr.appendChild(el('td', {}, [bindMini(el('input', { type: 'text', value: u.precision === undefined ? '' : u.precision }), function (v) { var n = parseInt(v, 10); u.precision = isFinite(n) ? n : 2; afterEdit(); })]));
      tr.appendChild(el('td', {}, [rowDel(function () { state.project.unitTable.splice(i, 1); afterEdit(); renderUnitPanel(); fillUnitDatalist(); })]));
      body.appendChild(tr);
    });
    fillUnitDatalist();
  }

  function renderVarPanel() {
    var body = $('#varBody');
    clear(body);
    (state.project.variables || []).forEach(function (v, i) {
      var tr = el('tr');
      tr.appendChild(el('td', {}, [bindMini(el('input', { type: 'text', value: v.code || '', placeholder: '代码' }), function (x) { v.code = x.replace(/^\$/, ''); afterEdit(); })]));
      tr.appendChild(el('td', {}, [bindMini(el('input', { type: 'text', value: v.expr || '', class: 'mono' }), function (x) { v.expr = x; afterEdit(); })]));
      tr.appendChild(el('td', {}, [rowDel(function () { state.project.variables.splice(i, 1); afterEdit(); renderVarPanel(); })]));
      body.appendChild(tr);
    });
    if (!(state.project.variables || []).length) {
      body.appendChild(el('tr', {}, [el('td', { colspan: 3, class: 'ctr', style: 'color:var(--text-mute);padding:10px', text: '暂无变量' })]));
    }
  }

  function renderFnPanel() {
    var body = $('#fnBody');
    clear(body);
    (state.project.functions || []).forEach(function (f, i) {
      var tr = el('tr');
      var nameTd = el('td');
      var link = el('span', {
        class: 'link',
        text: f.name,
        title: f.description || '点击编辑'
      });
      link.addEventListener('click', function () { openFnEditor(f); });
      nameTd.appendChild(link);
      tr.appendChild(nameTd);
      tr.appendChild(el('td', { class: 'ctr', text: f.unit || '' }));
      tr.appendChild(el('td', { class: 'ctr', text: f.precision === -1 || f.precision === undefined ? '—' : String(f.precision) }));
      tr.appendChild(el('td', {}, [rowDel(function () { state.project.functions.splice(i, 1); afterEdit(); renderFnPanel(); })]));
      body.appendChild(tr);
    });
  }

  function bindMini(inp, onChange) {
    var orig = inp.value;
    inp.addEventListener('change', function () {
      if (inp.value !== orig) { orig = inp.value; onChange(inp.value); }
    });
    return inp;
  }

  function rowDel(fn) {
    return el('button', { type: 'button', class: 'row-del', text: '✕', title: '删除', onclick: fn });
  }

  function fillUnitDatalist() {
    var dl = $('#unitList');
    clear(dl);
    var seen = Object.create(null);
    (state.project.unitTable || []).forEach(function (u) {
      if (!u.name || seen[u.name]) return;
      seen[u.name] = 1;
      dl.appendChild(el('option', { value: u.name }));
    });
  }

  /* =====================================================================
   * 右侧详情面板
   * =================================================================== */
  function renderDetail() {
    var host = $('#detailBody');
    var row = state.selectedId ? M.findRow(state.project, state.selectedId) : null;
    $('#detailNo').textContent = row ? ('编号 ' + (row.no || '—')) : '';
    clear(host);

    if (!row) {
      host.appendChild(el('div', { class: 'empty-hint' }, ['点击左侧任意一行查看详情，或点「＋ 同级行」新增。']));
      renderProblems(host);
      return;
    }

    var res = resultOf(row.id);

    /* --- 基本字段 --- */
    function field(label, node) {
      var d = el('div', { class: 'field' });
      d.appendChild(el('label', { text: label }));
      d.appendChild(node);
      return d;
    }

    var row1 = el('div', { class: 'field-row' });
    row1.appendChild(field('编号', bindDetail(el('input', { type: 'text', value: row.no || '' }), function (v) { row.no = v; afterEdit(); renderGrid(); })));
    row1.appendChild(field('单位', bindDetail(el('input', { type: 'text', value: row.unit || '', list: 'unitList' }), function (v) { row.unit = v; afterEdit(); renderGrid(); })));
    host.appendChild(row1);

    host.appendChild(field('项目名称', bindDetail(el('input', { type: 'text', value: row.name || '' }), function (v) { row.name = v; afterEdit(); refreshGridText('name', row.id, v); })));
    host.appendChild(field('部位', bindDetail(el('input', { type: 'text', value: row.part || '' }), function (v) { row.part = v; afterEdit(); refreshGridText('part', row.id, v); })));

    host.appendChild(field('计算公式', (function () {
      var ta = el('textarea', { class: '', spellcheck: 'false', style: 'font-family:var(--mono);min-height:56px' });
      ta.value = row.expr || '';
      var t = null;
      ta.addEventListener('input', function () {
        row.expr = ta.value;
        clearTimeout(t);
        t = setTimeout(function () { afterEdit(); }, 200);
      });
      ta.addEventListener('dblclick', function () { openFormula(row.id); });
      return ta;
    })()));

    /* 公式状态 */
    host.appendChild(formulaStatus(row.expr));

    var row2 = el('div', { class: 'field-row' });
    row2.appendChild(field('系数', bindDetail(el('input', { type: 'text', value: row.factor === undefined ? '1' : row.factor }), function (v) { var n = parseFloat(v); row.factor = isFinite(n) ? n : 1; afterEdit(); })));
    row2.appendChild(field('引用代码', bindDetail(el('input', { type: 'text', value: row.code || '' }), function (v) { row.code = v; afterEdit(); })));
    host.appendChild(row2);

    host.appendChild(field('工程量表达式（可选，留空则 = 计算结果 × 系数）',
      bindDetail(el('input', { type: 'text', value: row.gclExpr || '', class: 'mono' }), function (v) { row.gclExpr = v; afterEdit(); })));

    host.appendChild(field('备注', bindDetail(el('input', { type: 'text', value: row.remark || '' }), function (v) { row.remark = v; afterEdit(); refreshGridText('remark', row.id, v); })));

    var checks = el('div');
    [['ignore', '不计入汇总'], ['summary', '汇总行标记']].forEach(function (pair) {
      var cb = el('input', { type: 'checkbox', checked: !!row[pair[0]] });
      cb.addEventListener('change', function () { row[pair[0]] = cb.checked; afterEdit(); renderGrid(); });
      checks.appendChild(el('label', { class: 'checkline' }, [cb, pair[1]]));
    });
    host.appendChild(checks);

    /* --- 计算结果 --- */
    host.appendChild(el('div', { class: 'section-title', text: '计算结果' }));
    if (res && res.error) {
      host.appendChild(el('div', { class: 'formula-status bad', text: '⚠ ' + res.error.message }));
    } else {
      var kv = el('div', { class: 'formula-status ok' });
      var parts = [];
      parts.push('计算结果 = ' + (res.value === null || res.value === undefined ? '—' : (typeof res.value === 'number' ? U.format(res.value, state.project.unitTable, row.unit, false) : res.value)) + (row.unit ? ' ' + row.unit : ''));
      parts.push('工程量 = ' + U.format(res.gcl || 0, state.project.unitTable, row.unit, false) + (row.unit ? ' ' + row.unit : ''));
      if (res.hasChildren) parts.push('（分组行，含 ' + res.childCount + ' 个直接子行）');
      if (row.ignore) parts.push('（不计入汇总）');
      kv.textContent = parts.join('　｜　');
      host.appendChild(kv);
    }

    /* --- 引用关系 --- */
    var dep = state.calc.deps[row.id];
    if (dep && (dep.rows.length || dep.constants.length || dep.variables.length || dep.functions.length)) {
      host.appendChild(el('div', { class: 'section-title', text: '本行引用了' }));
      var chips = el('div', { class: 'chip-row' });
      dep.rows.forEach(function (no) {
        chips.appendChild(el('span', {
          class: 'chip', text: '[' + no + ']', title: '点击跳转',
          onclick: function () { var r = findByNo(no); if (r) select(r.id); }
        }));
      });
      dep.constants.forEach(function (c) { chips.appendChild(el('span', { class: 'chip cw', text: '@' + c })); });
      dep.variables.forEach(function (v) { chips.appendChild(el('span', { class: 'chip', text: '$' + v })); });
      dep.functions.forEach(function (f) { chips.appendChild(el('span', { class: 'chip', text: f + '()' })); });
      host.appendChild(chips);
    }

    /* --- 谁引用了我 --- */
    var refBy = [];
    Object.keys(state.calc.deps).forEach(function (id) {
      if (id === row.id) return;
      var d = state.calc.deps[id];
      if (d.rows.indexOf(row.no) >= 0) refBy.push(M.findRow(state.project, id));
    });
    if (refBy.length) {
      host.appendChild(el('div', { class: 'section-title', text: '被以下行引用' }));
      var chips2 = el('div', { class: 'chip-row' });
      refBy.forEach(function (r) {
        if (!r) return;
        chips2.appendChild(el('span', {
          class: 'chip', text: '[' + (r.no || '?') + '] ' + (r.name || ''),
          onclick: function () { select(r.id); }
        }));
      });
      host.appendChild(chips2);
    }

    renderProblems(host);
  }

  function findByNo(no) {
    var key = String(no).trim();
    var rows = state.project.rows;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].no == null ? '' : rows[i].no).trim() === key) return rows[i];
    }
    return null;
  }

  function bindDetail(node, onChange) {
    var orig = node.value;
    node.addEventListener('change', function () {
      if (node.value !== orig) { orig = node.value; onChange(node.value); }
    });
    return node;
  }

  function formulaStatus(expr) {
    var box = el('div', { class: 'formula-status' });
    var text = String(expr || '').trim();
    if (!text) { box.textContent = '未填写表达式'; return box; }
    var r = M.checkFormula(text);
    if (!r.ok) {
      box.className = 'formula-status bad';
      box.textContent = '⚠ ' + r.message;
    } else {
      box.className = 'formula-status ok';
      var d = r.deps;
      var bits = [];
      if (d.rows.length) bits.push('行 ' + d.rows.map(function (x) { return '[' + x + ']'; }).join(' '));
      if (d.constants.length) bits.push('常量 ' + d.constants.map(function (x) { return '@' + x; }).join(' '));
      if (d.variables.length) bits.push('变量 ' + d.variables.map(function (x) { return '$' + x; }).join(' '));
      if (d.functions.length) bits.push('函数 ' + d.functions.join(' '));
      box.textContent = '语法正确' + (bits.length ? '　·　引用：' + bits.join('；') : '');
    }
    return box;
  }

  function refreshGridText(key, rowId, value) {
    var entry = state.rowEls[rowId];
    if (!entry) return;
    var inp = $('input[data-key="' + key + '"]', entry.tr);
    if (inp && inp.value !== value) inp.value = value;
  }

  /* =====================================================================
   * 问题列表
   * =================================================================== */
  function renderProblems(host) {
    if (!host) host = $('#detailBody');
    var c = state.calc;
    if (!c) return;
    var wrap = el('div');
    wrap.appendChild(el('div', { class: 'section-title', text: '问题（' + (c.errors.length + c.warnings.length) + '）' }));

    if (!c.errors.length && !c.warnings.length) {
      wrap.appendChild(el('div', { class: 'formula-status ok', text: '✓ 没有发现问题' }));
    } else {
      var ul = el('ul', { class: 'problem-list' });
      c.errors.forEach(function (e) {
        ul.appendChild(el('li', {
          class: 'err',
          html: '<span class="where">[' + esc(e.no || '—') + ']</span> ' + esc(e.message),
          title: '点击定位到该行',
          onclick: function () { select(e.rowId); }
        }));
      });
      c.warnings.forEach(function (w) {
        var li = el('li', { class: 'warn', html: esc(w.message) });
        if (w.rowId) li.addEventListener('click', function () { select(w.rowId); });
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
    }
    host.appendChild(wrap);
  }

  /* =====================================================================
   * 状态栏
   * =================================================================== */
  function renderStatus() {
    var bar = $('#statusBar');
    clear(bar);
    var s = state.calc.stats;
    var dotCls = s.errors ? 'err' : (s.warnings ? 'warn' : '');
    bar.appendChild(el('span', {}, [el('span', { class: 'dot ' + dotCls }), ' ']));
    bar.appendChild(el('span', { text: '行 ' + s.rows + '（叶子 ' + s.leaves + '）' }));
    bar.appendChild(el('span', { text: '错误 ' + s.errors }));
    bar.appendChild(el('span', { text: '告警 ' + s.warnings }));

    var totals = Object.keys(state.calc.unitTotals).map(function (k) { return state.calc.unitTotals[k]; });
    if (totals.length) {
      bar.appendChild(el('span', { class: 'sep' }));
      bar.appendChild(el('span', {
        text: '合计：' + totals.map(function (t) {
          return U.format(t.total, state.project.unitTable, t.unit === '(无单位)' ? '' : t.unit, false) + (t.unit === '(无单位)' ? '' : ' ' + t.unit);
        }).join('　')
      }));
    }

    bar.appendChild(el('span', { class: 'spacer' }));
    bar.appendChild(el('span', { text: state.dirty ? '未保存' : '已保存到本地' }));
    bar.appendChild(el('span', { text: '单位 ' + Object.keys(state.calc.unitTotals).length + ' 类' }));
  }

  /* =====================================================================
   * 行操作
   * =================================================================== */
  function select(id, rerender) {
    if (state.selectedId === id && rerender === false) { renderDetail(); return; }
    state.selectedId = id;
    if (rerender !== false) renderGrid();
    renderDetail();
  }

  function insertAfter(refRow, data) {
    var rows = state.project.rows;
    var idx = rows.findIndex(function (r) { return r.id === refRow.id; });
    // 插到该行整棵子树之后
    var last = idx;
    (function walk(pid) {
      rows.forEach(function (r, i) {
        if (r.pid === pid && i > last) { last = i; walk(r.id); }
      });
    })(refRow.id);
    var row = {
      id: M.uid('r'), pid: refRow.pid || null, no: '', name: '', part: '',
      expr: '', unit: '', factor: 1, gclExpr: '', code: '', remark: '',
      ignore: false, summary: false, image: '', fields: {}
    };
    for (var k in data) row[k] = data[k];
    rows.splice(last + 1, 0, row);
    return row;
  }

  function addSibling(id) {
    var ref = id ? M.findRow(state.project, id) : null;
    var row;
    if (ref) {
      row = insertAfter(ref, { unit: ref.unit || '', part: ref.part || '' });
    } else {
      row = M.addRow(state.project, null, {});
    }
    afterEdit();
    select(row.id);
    focusExprOf(row.id);
  }

  function addChild(id) {
    var ref = id ? M.findRow(state.project, id) : null;
    if (!ref) return addSibling(null);
    if (state.collapsed[ref.id]) { delete state.collapsed[ref.id]; }
    var row = M.addRow(state.project, ref.id, { unit: ref.unit || '', part: ref.part || '' });
    afterEdit();
    select(row.id);
    focusExprOf(row.id);
  }

  function focusExprOf(id) {
    var entry = state.rowEls[id];
    if (!entry) return;
    var inp = $('input[data-key="name"]', entry.tr) || $('input', entry.tr);
    if (inp) inp.focus();
  }

  function del(id) {
    var row = M.findRow(state.project, id);
    if (!row) return;
    var kids = M.descendants(state.project, id);
    var msg = kids.length ? ('删除「' + (row.name || row.no || '该行') + '」及其 ' + kids.length + ' 个子行？') : ('删除「' + (row.name || row.no || '该行') + '」？');
    if (!window.confirm(msg)) return;
    M.removeRow(state.project, id);
    if (state.selectedId === id) state.selectedId = null;
    afterEdit();
    renderGrid();
  }

  function move(id, delta) {
    var rows = state.project.rows;
    var i = rows.findIndex(function (r) { return r.id === id; });
    if (i < 0) return;
    var row = rows[i];
    // 同父级内交换
    var sibs = rows.filter(function (r) { return (r.pid || null) === (row.pid || null); });
    var si = sibs.findIndex(function (r) { return r.id === id; });
    var target = sibs[si + delta];
    if (!target) return;

    if (delta < 0) {
      // 把 row 移到 target 之前的整棵子树之前
      var ti = rows.findIndex(function (r) { return r.id === target.id; });
      rows.splice(i, 1);
      rows.splice(ti, 0, row);
    } else {
      // 把 row 移到 target 子树之后
      var ti2 = rows.findIndex(function (r) { return r.id === target.id; });
      var last = ti2;
      (function walk(pid) {
        rows.forEach(function (r, k) {
          if (r.pid === pid && k > last) { last = k; walk(r.id); }
        });
      })(target.id);
      rows.splice(i, 1);
      var insertAt = last > i ? last - 1 : last;
      rows.splice(insertAt + 1, 0, row);
    }
    afterEdit();
    renderGrid();
  }

  function indent(id) {
    var rows = state.project.rows;
    var i = rows.findIndex(function (r) { return r.id === id; });
    if (i <= 0) return;
    var row = rows[i];
    var sibs = rows.filter(function (r) { return (r.pid || null) === (row.pid || null); });
    var si = sibs.findIndex(function (r) { return r.id === id; });
    if (si <= 0) { toast('已是同级第一行，无法缩进'); return; }
    var prev = sibs[si - 1];
    row.pid = prev.id;
    delete state.collapsed[prev.id];
    afterEdit();
    renderGrid();
  }

  function outdent(id) {
    var row = M.findRow(state.project, id);
    if (!row || !row.pid) { toast('已在顶层'); return; }
    var parent = M.findRow(state.project, row.pid);
    if (!parent) { row.pid = null; }
    else row.pid = parent.pid || null;
    afterEdit();
    renderGrid();
  }

  function toggleCollapse(id) {
    if (state.collapsed[id]) delete state.collapsed[id];
    else state.collapsed[id] = true;
    renderGrid();
  }

  /* =====================================================================
   * 公式编辑器
   * =================================================================== */
  var fmRowId = null;

  function openFormula(id) {
    var row = M.findRow(state.project, id);
    if (!row) return;
    fmRowId = id;
    $('#fmRowLabel').textContent = '　[' + (row.no || '—') + '] ' + (row.name || '');
    $('#fmText').value = row.expr || '';
    renderFormulaPalettes();
    updateFormulaPreview();
    openModal('#modalFormula');
    setTimeout(function () { $('#fmText').focus(); }, 30);
  }

  function renderFormulaPalettes() {
    /* 函数 */
    var fp = $('#fmFnPalette');
    clear(fp);
    var fns = (state.project.functions || []).slice();
    // 常用内建
    [['iif(条件,a,b)', 'iif()'], ['round(x,n)', 'round()'], ['sum()', 'sum()'],
    ['avg()', 'avg()'], ['abs(x)', 'abs()'], ['sqrt(x)', 'sqrt()'],
    ['pi()', 'pi()'], ['格式化(值,精度)', 'formatnum()'], ['换算(值,单位1,单位2)', '换算()']]
      .forEach(function (p) { fns.push({ name: p[0], _snippet: p[1], catalog: '内建' }); });

    fns.forEach(function (f) {
      if (f._snippet) {
        fp.appendChild(el('button', { type: 'button', title: '内建函数', onclick: function () { insertAtCursor('#fmText', f._snippet, 0); } },
          [el('b', { text: f.name })]));
      } else {
        var params = (f.params || []).map(function (p) { return p.name; }).join(', ');
        var snippet = f.name + '(' + params + ')';
        fp.appendChild(el('button', {
          type: 'button',
          title: (f.description || '') + (f.unit ? '　单位 ' + f.unit : ''),
          onclick: function () { insertAtCursor('#fmText', snippet, 0); }
        }, [el('b', { text: f.name }), el('span', { text: '(' + params + ')' })]));
      }
    });

    /* 行引用 */
    var rp = $('#fmRowPalette');
    clear(rp);
    var ordered = M.flatten(state.project);
    ordered.forEach(function (r) {
      if (r.id === fmRowId) return;
      if (!r.no) return;
      rp.appendChild(el('button', {
        type: 'button',
        title: r.name || '',
        onclick: function () { insertAtCursor('#fmText', '[' + r.no + ']', 0); }
      }, [el('b', { text: '[' + r.no + ']' }), el('span', { text: ' ' + (r.name || '') })]));
      rp.appendChild(el('button', {
        type: 'button',
        title: (r.name || '') + ' 的工程量',
        onclick: function () { insertAtCursor('#fmText', '[' + r.no + '].gcl', 0); }
      }, [el('span', { text: '⤷ .gcl' })]));
    });
    if (!rp.children.length) rp.appendChild(el('span', { style: 'color:var(--text-mute);font-size:11px', text: '还没有其他带编号的行' }));

    /* 常量 / 变量 */
    var cp = $('#fmConstPalette');
    clear(cp);
    (state.project.constants || []).forEach(function (c) {
      if (!c.code) return;
      cp.appendChild(el('button', {
        type: 'button', title: c.description || '',
        onclick: function () { insertAtCursor('#fmText', '@' + c.code, 0); }
      }, [el('b', { text: '@' + c.code })]));
    });
    (state.project.variables || []).forEach(function (v) {
      if (!v.code) return;
      cp.appendChild(el('button', {
        type: 'button', title: v.expr || '',
        onclick: function () { insertAtCursor('#fmText', '$' + v.code, 0); }
      }, [el('b', { text: '$' + v.code })]));
    });
  }

  function insertAtCursor(sel, text, back) {
    var ta = $(sel);
    var s = ta.selectionStart === undefined ? ta.value.length : ta.selectionStart;
    var e2 = ta.selectionEnd === undefined ? ta.value.length : ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e2);
    var caret = s + text.length - (back || 0);
    ta.focus();
    try { ta.setSelectionRange(caret, caret); } catch (err) { }
    if (sel === '#fmText') updateFormulaPreview();
    if (sel === '#fnExpr') updateFnStatus();
  }

  function updateFormulaPreview() {
    var text = $('#fmText').value;
    var status = $('#fmStatus');
    var box = $('#fmResult');
    var r = M.checkFormula(text);
    if (!r.ok) {
      status.className = 'formula-status bad';
      status.textContent = '⚠ 语法错误：' + r.message;
      box.className = 'result-box bad';
      box.textContent = r.message;
      return;
    }
    status.className = 'formula-status ok';
    var bits = [];
    if (r.deps.rows.length) bits.push('行 ' + r.deps.rows.map(function (x) { return '[' + x + ']'; }).join(' '));
    if (r.deps.constants.length) bits.push('常量 ' + r.deps.constants.map(function (x) { return '@' + x; }).join(' '));
    if (r.deps.variables.length) bits.push('变量 ' + r.deps.variables.map(function (x) { return '$' + x; }).join(' '));
    if (r.deps.functions.length) bits.push('函数 ' + r.deps.functions.join(' '));
    status.textContent = '语法正确' + (bits.length ? '　·　引用：' + bits.join('；') : '');

    // 试算：在副本上跑一遍，避免污染工程
    try {
      var copy = JSON.parse(M.serialize(state.project));
      var target = copy.rows.filter(function (x) { return x.id === fmRowId; })[0];
      if (!target) { box.textContent = '—'; return; }
      target.expr = text;
      var c = M.recalc(copy);
      var res = c.results[fmRowId];
      if (res && res.error) {
        box.className = 'result-box bad';
        box.textContent = '求值错误：' + res.error.message;
      } else if (res) {
        box.className = 'result-box';
        var v = res.value;
        var txt = (v === null || v === undefined) ? '—' : (typeof v === 'number' ? U.format(v, state.project.unitTable, target.unit, false) : String(v));
        box.textContent = '结果 = ' + txt + (target.unit ? ' ' + target.unit : '') +
          '　｜　工程量 = ' + U.format(res.gcl || 0, state.project.unitTable, target.unit, false);
      }
    } catch (err) {
      box.className = 'result-box bad';
      box.textContent = '试算失败：' + err.message;
    }
  }

  function applyFormula() {
    var row = M.findRow(state.project, fmRowId);
    if (!row) return;
    row.expr = $('#fmText').value;
    closeModal('#modalFormula');
    afterEdit();
    renderGrid();
    toast('公式已更新', 'ok');
  }

  /* =====================================================================
   * 函数编辑器
   * =================================================================== */
  var fnDraft = null;

  function openFnEditor(fn) {
    fnDraft = JSON.parse(JSON.stringify(fn));
    $('#fnName').value = fnDraft.name || '';
    $('#fnUnit').value = fnDraft.unit || '';
    $('#fnPrecision').value = fnDraft.precision === undefined ? -1 : fnDraft.precision;
    $('#fnDesc').value = fnDraft.description || '';
    $('#fnExpr').value = fnDraft.expr || '';
    renderFnEditorTables();
    updateFnStatus();
    openModal('#modalFn');
  }

  function renderFnEditorTables() {
    var pb = $('#fnParamBody');
    clear(pb);
    (fnDraft.params || []).forEach(function (p, i) {
      var tr = el('tr');
      tr.appendChild(el('td', {}, [editable(p.name, function (v) { p.name = v; updateFnStatus(); }, '参数名')]));
      tr.appendChild(el('td', {}, [editable(p.description, function (v) { p.description = v; }, '说明')]));
      tr.appendChild(el('td', {}, [editable(p.unit, function (v) { p.unit = v; }, '如 m')]));
      tr.appendChild(el('td', {}, [rowDel(function () { fnDraft.params.splice(i, 1); renderFnEditorTables(); updateFnStatus(); })]));
      pb.appendChild(tr);
    });

    var cb = $('#fnCodeBody');
    clear(cb);
    (fnDraft.codes || []).forEach(function (c, i) {
      var tr = el('tr');
      tr.appendChild(el('td', {}, [editable(c.name, function (v) { c.name = v; updateFnStatus(); }, '变量名')]));
      tr.appendChild(el('td', {}, [editable(c.expr, function (v) { c.expr = v; updateFnStatus(); }, '表达式', 'mono')]));
      tr.appendChild(el('td', {}, [editable(c.precision, function (v) { var n = parseInt(v, 10); c.precision = isFinite(n) ? n : -1; }, '-1')]));
      tr.appendChild(el('td', {}, [rowDel(function () { fnDraft.codes.splice(i, 1); renderFnEditorTables(); updateFnStatus(); })]));
      cb.appendChild(tr);
    });
  }

  function editable(value, onChange, placeholder, cls) {
    var inp = el('input', { type: 'text', value: value === undefined || value === null ? '' : value, placeholder: placeholder || '', class: cls || '' });
    var orig = inp.value;
    inp.addEventListener('change', function () {
      if (inp.value !== orig) { orig = inp.value; onChange(inp.value); }
    });
    return inp;
  }

  function updateFnStatus() {
    var text = $('#fnExpr').value;
    var box = $('#fnStatus');
    var r = M.checkFormula(text);
    if (!r.ok) {
      box.className = 'formula-status bad';
      box.textContent = '⚠ 语法错误：' + r.message;
      return;
    }
    var known = {};
    (fnDraft.params || []).forEach(function (p) { if (p.name) known[p.name] = 1; });
    (fnDraft.codes || []).forEach(function (c) { if (c.name) known[c.name] = 1; });
    var unknown = r.deps.variables.filter(function (n) { return !known[n] && !E.builtins[String(n).toLowerCase()]; });
    box.className = 'formula-status ' + (unknown.length ? '' : 'ok');
    box.textContent = '语法正确' +
      (unknown.length ? '　·　⚠ 未定义的标识符：' + unknown.join(' ') : '　·　所有标识符都有定义') +
      (r.deps.functions.length ? '　·　调用：' + r.deps.functions.join(' ') : '');
  }

  function applyFn() {
    var name = $('#fnName').value.trim();
    if (!name) { toast('请填写函数名称', 'err'); return; }
    var exists = state.project.functions.filter(function (f) { return f !== fnDraft && f.name === name; });
    if (exists.length) { toast('已存在同名函数', 'err'); return; }
    fnDraft.name = name;
    fnDraft.unit = $('#fnUnit').value.trim();
    var pn = parseInt($('#fnPrecision').value, 10);
    fnDraft.precision = isFinite(pn) ? pn : -1;
    fnDraft.description = $('#fnDesc').value.trim();
    fnDraft.expr = $('#fnExpr').value;

    var idx = state.project.functions.indexOf(fnDraft);
    if (idx < 0) state.project.functions.push(fnDraft);
    closeModal('#modalFn');
    afterEdit();
    renderFnPanel();
    toast('函数「' + name + '」已保存', 'ok');
  }

  /* =====================================================================
   * 列设置
   * =================================================================== */
  function renderColumnsModal() {
    var body = $('#colBody');
    clear(body);
    (state.project.columns || []).forEach(function (c) {
      var tr = el('tr');
      tr.appendChild(el('td', {}, [editable(c.title, function (v) { c.title = v; afterEdit(); renderGrid(); }, '显示名')]));
      var v1 = el('input', { type: 'checkbox', checked: c.visible !== false });
      v1.addEventListener('change', function () { c.visible = v1.checked; afterEdit(); renderGrid(); });
      tr.appendChild(el('td', { class: 'ctr' }, [v1]));
      var v2 = el('input', { type: 'checkbox', checked: c.reportVisible !== false });
      v2.addEventListener('change', function () { c.reportVisible = v2.checked; invalidateReportPreview(); });
      tr.appendChild(el('td', { class: 'ctr' }, [v2]));
      tr.appendChild(el('td', {}, [editable(c.width, function (v) { c.width = parseInt(v, 10) || 100; afterEdit(); renderGrid(); }, '100')]));
      body.appendChild(tr);
    });
  }

  /* =====================================================================
   * 报表
   * =================================================================== */
  var reportDirty = true;
  function invalidateReportPreview() { reportDirty = true; }

  function ensureReport() {
    if (!state.report) {
      state.report = window.CBDemo && window.CBDemo.reportTemplate
        ? window.CBDemo.reportTemplate(state.project, R)
        : R.defaultTemplate(state.project, '计算书');
    }
    return state.report;
  }

  function openReport() {
    var tpl = ensureReport();
    /* 同步列到报表模板 */
    tpl.columns = (state.project.columns || []).filter(function (c) { return c.reportVisible; }).map(function (c) {
      return {
        field: c.key, title: c.title, width: c.width || 100,
        align: c.align || (c.type === 'result' || c.type === 'number' ? 'right' : 'left'),
        isNo: c.key === 'no',
        isNumber: c.type === 'result' || c.type === 'number'
      };
    });
    tpl.params.forEach(function (p) {
      if (p.name === 'GCMC' && !p.default) p.default = state.project.meta.name;
    });

    /* 参数字段 */
    var host = $('#rpParams');
    clear(host);
    tpl.params.forEach(function (p) {
      var d = el('div', { class: 'field' });
      d.appendChild(el('label', { text: p.label || p.name }));
      var inp = el('input', { type: p.type === 'date' ? 'date' : 'text', value: p.default || '' });
      inp.addEventListener('input', function () { p.default = inp.value; reportDirty = true; refreshReportPreview(); });
      d.appendChild(inp);
      host.appendChild(d);
    });

    $('#rpOrientation').value = tpl.page.orientation || 'portrait';
    $('#rpTotal').value = tpl.body.showTotalRow === false ? '0' : '1';
    $('#rpBold').value = tpl.body.boldGroup === false ? '0' : '1';

    refreshReportPreview();
    openModal('#modalReport');
  }

  function refreshReportPreview() {
    var tpl = ensureReport();
    tpl.page.orientation = $('#rpOrientation').value;
    tpl.body.showTotalRow = $('#rpTotal').value === '1';
    tpl.body.boldGroup = $('#rpBold').value === '1';
    var html = R.renderHTML(state.project, state.calc, tpl, null, { standalone: true });
    var frame = $('#rpFrame');
    frame.srcdoc = html;
    reportDirty = false;
    return html;
  }

  /* =====================================================================
   * 文件
   * =================================================================== */
  function projectFileName(ext) {
    var n = (state.project.meta && state.project.meta.name) || '未命名工程';
    return n.replace(/[\\/:*?"<>|]/g, '_') + (ext || '.ocb.json');
  }

  function doSave() {
    try {
      var text = M.serialize(state.project);
      X.download(projectFileName('.ocb.json'), text, 'application/json');
      state.dirty = false;
      saveLocal();
      renderStatus();
      toast('已导出工程文件', 'ok');
    } catch (e) {
      toast('保存失败：' + e.message, 'err');
    }
  }

  function doOpen() { $('#fileInput').click(); }

  function handleFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var p = M.deserialize(reader.result);
        state.project = p;
        state.report = null;
        state.collapsed = Object.create(null);
        state.selectedId = null;
        $('#projName').value = p.meta.name;
        afterEdit();
        renderAll();
        toast('已打开：' + p.meta.name, 'ok');
      } catch (e) {
        toast('文件解析失败：' + e.message, 'err');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function doNew() {
    if (!window.confirm('新建工程会丢弃当前内容（可先保存），继续？')) return;
    state.project = M.newProject({ name: '未命名工程' });
    state.report = null;
    state.collapsed = Object.create(null);
    state.selectedId = null;
    $('#projName').value = state.project.meta.name;
    afterEdit();
    renderAll();
    toast('已新建工程');
  }

  function doDemo() {
    if (!window.CBDemo) { toast('示例模块未加载', 'err'); return; }
    if (!window.confirm('载入示例工程会覆盖当前内容，继续？')) return;
    state.project = window.CBDemo.build();
    state.report = null;
    state.collapsed = Object.create(null);
    state.selectedId = null;
    $('#projName').value = state.project.meta.name;
    afterEdit();
    renderAll();
    toast('示例工程已载入', 'ok');
  }

  function doCSV() {
    try {
      X.download(projectFileName('.csv'), X.toCSV(state.project, state.calc), 'text/csv');
      toast('已导出 CSV', 'ok');
    } catch (e) { toast('导出失败：' + e.message, 'err'); }
  }

  function saveLocal() {
    try {
      store.set(LS_KEY, M.serialize(state.project));
      if (state.report) store.set(LS_REPORT, JSON.stringify(state.report));
      state.dirty = false;
    } catch (e) { /* 容量超限等忽略 */ }
  }

  var saveTimer = null;
  function saveLocalSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveLocal(); renderStatus(); }, 800);
  }

  function loadLocal() {
    try {
      var raw = store.get(LS_KEY);
      if (!raw) return null;
      return M.deserialize(raw);
    } catch (e) { return null; }
  }

  /* =====================================================================
   * 弹窗
   * =================================================================== */
  function openModal(sel) {
    $$('.modal-mask').forEach(function (m) { m.classList.remove('open'); });
    $(sel).classList.add('open');
  }
  function closeModal(sel) { $(sel).classList.remove('open'); }

  /* =====================================================================
   * 主题
   * =================================================================== */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    store.set(LS_THEME, t);
  }

  /* =====================================================================
   * 总渲染
   * =================================================================== */
  function renderAll() {
    recalc();
    renderGrid();
    renderConstPanel();
    renderUnitPanel();
    renderVarPanel();
    renderFnPanel();
    renderDetail();
    renderStatus();
    fillUnitDatalist();
    $('#projName').value = (state.project.meta && state.project.meta.name) || '';
  }

  /* =====================================================================
   * 事件绑定
   * =================================================================== */
  function bindEvents() {
    /* 顶栏 */
    $('#projName').addEventListener('input', function () {
      state.project.meta.name = $('#projName').value;
      state.dirty = true;
      saveLocalSoon();
    });

    $('#btnNew').addEventListener('click', doNew);
    $('#btnOpen').addEventListener('click', doOpen);
    $('#btnSave').addEventListener('click', doSave);
    $('#btnCsv').addEventListener('click', doCSV);
    $('#btnReport').addEventListener('click', openReport);
    $('#btnTheme').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'dark' ? 'light' : 'dark');
    });
    $('#btnHelp').addEventListener('click', function () { openModal('#modalHelp'); });

    $('#fileInput').addEventListener('change', function (ev) {
      if (ev.target.files && ev.target.files[0]) handleFile(ev.target.files[0]);
      ev.target.value = '';
    });

    /* 左侧标签页 */
    $('#sideTabs').addEventListener('click', function (ev) {
      var tab = ev.target.closest('.tab');
      if (!tab) return;
      $$('#sideTabs .tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var name = tab.getAttribute('data-tab');
      $$('.tab-panel').forEach(function (p) {
        p.classList.toggle('active', p.getAttribute('data-panel') === name);
      });
    });

    /* 左侧新增按钮 */
    $('#btnAddConst').addEventListener('click', function () {
      state.project.constants.push({ code: '', value: '', description: '' });
      renderConstPanel();
      var inputs = $$('#constBody input');
      if (inputs.length) inputs[inputs.length - 3].focus();
    });
    $('#btnAddUnit').addEventListener('click', function () {
      state.project.unitTable.push({ name: '', order: state.project.unitTable.length + 1, precision: 2 });
      renderUnitPanel();
    });
    $('#btnAddVar').addEventListener('click', function () {
      state.project.variables.push({ code: '', expr: '', description: '' });
      renderVarPanel();
    });
    $('#btnAddFn').addEventListener('click', function () {
      openFnEditor({ name: '', description: '', expr: '', unit: '', precision: -1, catalog: '自定义', params: [], codes: [] });
    });

    /* 工具栏 */
    $('#btnAddSibling').addEventListener('click', function () { addSibling(state.selectedId); });
    $('#btnAddChild').addEventListener('click', function () { addChild(state.selectedId); });
    $('#btnUp').addEventListener('click', function () { if (state.selectedId) move(state.selectedId, -1); });
    $('#btnDown').addEventListener('click', function () { if (state.selectedId) move(state.selectedId, 1); });
    $('#btnIndent').addEventListener('click', function () { if (state.selectedId) indent(state.selectedId); });
    $('#btnOutdent').addEventListener('click', function () { if (state.selectedId) outdent(state.selectedId); });
    $('#btnFormula').addEventListener('click', function () {
      if (!state.selectedId) { toast('请先选中一行', 'err'); return; }
      openFormula(state.selectedId);
    });
    $('#btnDeleteRow').addEventListener('click', function () {
      if (!state.selectedId) { toast('请先选中一行', 'err'); return; }
      del(state.selectedId);
    });
    $('#btnExpandAll').addEventListener('click', function () {
      state.collapsed = Object.create(null);
      renderGrid();
    });
    $('#btnCollapseAll').addEventListener('click', function () {
      state.collapsed = Object.create(null);
      state.project.rows.forEach(function (r) {
        if (M.hasChildren(state.project, r.id)) state.collapsed[r.id] = true;
      });
      renderGrid();
    });
    $('#btnColumns').addEventListener('click', function () {
      renderColumnsModal();
      openModal('#modalColumns');
    });
    $('#btnLoadDemo').addEventListener('click', doDemo);

    /* 公式编辑器 */
    $('#fmText').addEventListener('input', updateFormulaPreview);
    $('#fmText').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.ctrlKey) { ev.preventDefault(); applyFormula(); }
    });
    $('#fmApply').addEventListener('click', applyFormula);

    /* 函数编辑器 */
    $('#fnAddParam').addEventListener('click', function () {
      fnDraft.params.push({ name: '', description: '', unit: '', dataType: 'float', precision: -1 });
      renderFnEditorTables();
    });
    $('#fnAddCode').addEventListener('click', function () {
      fnDraft.codes.push({ name: '', expr: '', precision: -1, unit: '', description: '' });
      renderFnEditorTables();
    });
    $('#fnExpr').addEventListener('input', updateFnStatus);
    $('#fnApply').addEventListener('click', applyFn);
    $('#fnName').addEventListener('input', updateFnStatus);

    /* 报表 */
    $('#rpOrientation').addEventListener('change', refreshReportPreview);
    $('#rpTotal').addEventListener('change', refreshReportPreview);
    $('#rpBold').addEventListener('change', refreshReportPreview);
    $('#rpPrint').addEventListener('click', function () {
      var html = refreshReportPreview();
      var w = X.openPrintWindow(html);
      if (w) setTimeout(function () { try { w.print(); } catch (e) { } }, 400);
    });
    $('#rpExportHtml').addEventListener('click', function () {
      X.download(projectFileName('.计算书.html'), refreshReportPreview(), 'text/html');
    });
    $('#rpExportMd').addEventListener('click', function () {
      X.download(projectFileName('.md'), X.toMarkdown(state.project, state.calc), 'text/markdown');
    });
    $('#rpExportTxt').addEventListener('click', function () {
      X.download(projectFileName('.txt'), X.toPlainText(state.project, state.calc), 'text/plain');
    });

    /* 弹窗关闭 */
    document.addEventListener('click', function (ev) {
      if (ev.target.classList && ev.target.classList.contains('modal-mask')) {
        ev.target.classList.remove('open');
      }
      var closer = ev.target.closest ? ev.target.closest('[data-close]') : null;
      if (closer) {
        var mask = closer.closest('.modal-mask');
        if (mask) mask.classList.remove('open');
        if (mask && mask.id === 'modalColumns') { afterEdit(); renderGrid(); }
      }
    });

    /* 全局快捷键 */
    document.addEventListener('keydown', function (ev) {
      var tag = (ev.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';

      if (ev.key === 'Escape') {
        var open = $('.modal-mask.open');
        if (open) { open.classList.remove('open'); ev.preventDefault(); }
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        doSave();
        return;
      }
      if (ev.key === 'F2') {
        ev.preventDefault();
        if (state.selectedId) openFormula(state.selectedId);
        return;
      }
      if (typing) return;

      if (ev.key === 'ArrowUp' && state.selectedId) { ev.preventDefault(); move(state.selectedId, -1); }
      else if (ev.key === 'ArrowDown' && state.selectedId) { ev.preventDefault(); move(state.selectedId, 1); }
      else if (ev.key === 'Delete' && state.selectedId) { ev.preventDefault(); del(state.selectedId); }
      else if (ev.key === 'Enter' && state.selectedId) { ev.preventDefault(); addSibling(state.selectedId); }
    });

    /* 离开页面提示 */
    window.addEventListener('beforeunload', function (ev) {
      if (state.dirty) { saveLocal(); }
    });
  }

  /* =====================================================================
   * 启动
   * =================================================================== */
  function boot() {
    $('#verLabel').textContent = 'v' + E.VERSION;

    applyTheme(store.get(LS_THEME) || 'light');

    var saved = loadLocal();
    if (saved && saved.rows && saved.rows.length) {
      state.project = saved;
    } else if (window.CBDemo) {
      state.project = window.CBDemo.build();
    } else {
      state.project = M.newProject();
    }

    if (!state.project.meta) state.project.meta = {};
    if (!state.project.meta.name) state.project.meta.name = '未命名工程';

    try {
      var rt = store.get(LS_REPORT);
      state.report = rt ? JSON.parse(rt) : null;
    } catch (e) { state.report = null; }

    state.selectedId = state.project.rows.length ? state.project.rows[0].id : null;

    bindEvents();
    renderAll();

    if (!saved || !saved.rows.length) saveLocal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
