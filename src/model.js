/*!
 * OpenCalcBook / 开源计算书 — 数据模型与计算引擎
 * ---------------------------------------------------------------------------
 * 工程（Project）结构：
 *   meta        工程信息（名称/编制人/备注/时间）
 *   unitTable   计量单位表  —— 名称 / 序号 / 精度        （对应 JLDW）
 *   constants   常量库      —— 代码 / 值 / 说明          （对应 CLB）
 *   variables   汇总变量    —— 代码 / 表达式 / 说明      （对应 CodeSummary）
 *   columns     列配置      —— 显示名 / 是否可见 / 是否上报 / 锁定 / 宽度（对应 BGPZ）
 *   functions   自定义函数  —— 参数 / 内部变量 / 表达式 / 单位 / 精度
 *   rows        计算式行    —— 树形，按 pid 组织
 *
 * 计算语义：
 *   计算结果 = 表达式求值（按单位精度取整）
 *   工程量   = 工程量表达式（若填）否则 计算结果 × 系数
 *   分组行的工程量 = 其所有后代行工程量之和（不计标志为真的行不参与）
 *
 * License: MIT
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./expr.js'), require('./units.js'));
  } else {
    root.CBModel = factory(root.CBExpr, root.CBUnits);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CBExpr, CBUnits) {
  'use strict';

  var FORMAT = 'opencalcbook';
  var FORMAT_VERSION = 1;
  var MAX_DEPTH = 64;

  /* =======================================================================
   * 实用函数
   * ===================================================================== */
  var seq = 0;
  function uid(prefix) {
    seq += 1;
    return (prefix || 'r') + Date.now().toString(36) + '-' + seq.toString(36);
  }

  function nowISO() { return new Date().toISOString(); }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function num(v, dflt) {
    var n = Number(v);
    return isFinite(n) ? n : (dflt === undefined ? 0 : dflt);
  }

  /* =======================================================================
   * 默认列配置（对应 BGPZ）
   * ===================================================================== */
  var DEFAULT_COLUMNS = [
    { key: 'no', title: '编号', field: 'XMBH', visible: true, reportVisible: true, locked: false, width: 90, type: 'text', align: 'center' },
    { key: 'name', title: '项目名称', field: 'XMMC', visible: true, reportVisible: true, locked: false, width: 220, type: 'text', align: 'left' },
    { key: 'part', title: '部位', field: 'BW', visible: true, reportVisible: false, locked: false, width: 120, type: 'text', align: 'left' },
    { key: 'expr', title: '计算公式', field: 'JSGS', visible: true, reportVisible: true, locked: false, width: 280, type: 'formula', align: 'left' },
    { key: 'unit', title: '单位', field: 'JSDW', visible: true, reportVisible: true, locked: false, width: 70, type: 'unit', align: 'center' },
    { key: 'factor', title: '系数', field: 'XS', visible: true, reportVisible: false, locked: false, width: 70, type: 'number', align: 'right' },
    { key: 'value', title: '计算结果', field: 'JSJG', visible: true, reportVisible: true, locked: true, width: 110, type: 'result', align: 'right' },
    { key: 'gcl', title: '工程量', field: 'GCL', visible: true, reportVisible: true, locked: true, width: 110, type: 'result', align: 'right' },
    { key: 'gclExpr', title: '工程量表达式', field: 'GCLBDS', visible: false, reportVisible: false, locked: false, width: 200, type: 'formula', align: 'left' },
    { key: 'code', title: '引用代码', field: 'Code', visible: false, reportVisible: false, locked: false, width: 100, type: 'text', align: 'left' },
    { key: 'remark', title: '备注', field: 'BZ', visible: true, reportVisible: true, locked: false, width: 160, type: 'text', align: 'left' },
    { key: 'ignore', title: '不计', field: 'IgnoreFlag', visible: true, reportVisible: false, locked: false, width: 50, type: 'flag', align: 'center' },
    { key: 'summary', title: '汇总行', field: 'SummaryLineFlag', visible: true, reportVisible: false, locked: false, width: 60, type: 'flag', align: 'center' }
  ];

  /* =======================================================================
   * 常用几何函数库（示例内置，可自由增删）
   * —— 都是教科书级公式，作为"函数库"数据存在，可被用户覆盖
   * ===================================================================== */
  function builtinFunctions() {
    function F(name, description, expr, unit, precision, params, codes) {
      return {
        name: name,
        description: description,
        expr: expr,
        unit: unit || '',
        precision: precision === undefined ? 4 : precision,
        catalog: '几何',
        library: true,      // 随软件附带的函数库，不参与"未使用"告警
        params: params || [],
        codes: codes || []
      };
    }
    function P(name, description, unit) {
      return { name: name, description: description, unit: unit || 'm', dataType: 'float', precision: -1 };
    }

    return [
      F('矩形面积', '矩形面积 = 长 × 宽', 'a*b', 'm2', 4, [P('a', '长'), P('b', '宽')]),
      F('三角形面积', '三角形面积 = 底 × 高 / 2', 'a*h/2', 'm2', 4, [P('a', '底'), P('h', '高')]),
      F('梯形面积', '梯形面积 = (上底 + 下底) × 高 / 2', '(a+b)*h/2', 'm2', 4,
        [P('a', '上底'), P('b', '下底'), P('h', '高')]),
      F('圆形面积', '圆形面积 = π × r²', 'PI()*r^2', 'm2', 4, [P('r', '半径')]),
      F('环形面积', '环形面积 = π × (外半径² − 内半径²)', 'PI()*(R^2-r^2)', 'm2', 4,
        [P('R', '外半径'), P('r', '内半径')]),
      F('扇形面积', '扇形面积 = π × r² × 圆心角 / 360', 'PI()*r^2*angle/360', 'm2', 4,
        [P('r', '半径'), { name: 'angle', description: '圆心角(度)', unit: '°', dataType: 'float', precision: 2 }]),
      F('长方体体积', '长方体体积 = 长 × 宽 × 高', 'a*b*h', 'm3', 4,
        [P('a', '长'), P('b', '宽'), P('h', '高')]),
      F('圆柱体积', '圆柱体积 = π × r² × h', 'PI()*r^2*h', 'm3', 4,
        [P('r', '半径'), P('h', '高')]),
      F('棱台体积', '棱台体积 = h/6 × [ab + (a+A)(b+B) + AB]', 'h/6*(a*b+(a+A)*(b+B)+A*B)', 'm3', 4,
        [P('a', '下底长'), P('b', '下底宽'), P('A', '上底长'), P('B', '上底宽'), P('h', '高')]),
      F('斜面长度', '斜面长度 = √(水平长² + 高²)', 'sqrt(L^2+h^2)', 'm', 4,
        [P('L', '水平长'), P('h', '高')])
    ];
  }

  /* =======================================================================
   * 新建工程
   * ===================================================================== */
  function newProject(meta) {
    var p = {
      format: FORMAT,
      version: FORMAT_VERSION,
      meta: {
        name: '未命名工程',
        author: '',
        remark: '',
        createdAt: nowISO(),
        updatedAt: nowISO(),
        precisionGeneral: 2
      },
      unitTable: clone(CBUnits.DEFAULT_TABLE),
      constants: [],
      variables: [],
      columns: clone(DEFAULT_COLUMNS),
      functions: builtinFunctions(),
      rows: []
    };
    if (meta) for (var k in meta) p.meta[k] = meta[k];

    // 三行起步示例（扁平结构，方便直接改）
    addRow(p, null, { no: '1', name: '长', expr: '12', unit: 'm' });
    addRow(p, null, { no: '2', name: '宽', expr: '8', unit: 'm' });
    addRow(p, null, { no: '3', name: '矩形面积', expr: '矩形面积([1], [2])', unit: 'm2' });
    return p;
  }

  /* =======================================================================
   * 行的增删改
   * ===================================================================== */
  function addRow(project, pid, data) {
    var row = {
      id: uid('r'),
      pid: pid || null,
      no: '',
      name: '',
      part: '',
      expr: '',
      unit: '',
      factor: 1,
      gclExpr: '',
      code: '',
      remark: '',
      ignore: false,
      summary: false,
      image: '',
      fields: {}
    };
    if (data) for (var k in data) row[k] = data[k];
    project.rows.push(row);
    return row;
  }

  function findRow(project, id) {
    for (var i = 0; i < project.rows.length; i++) {
      if (project.rows[i].id === id) return project.rows[i];
    }
    return null;
  }

  function removeRow(project, id, cascade) {
    var doomed = Object.create(null);
    if (cascade === false) {
      doomed[id] = 1;
    } else {
      (function collect(pid) {
        doomed[pid] = 1;
        for (var i = 0; i < project.rows.length; i++) {
          if (project.rows[i].pid === pid) collect(project.rows[i].id);
        }
      })(id);
    }
    project.rows = project.rows.filter(function (r) { return !doomed[r.id]; });
    // 摘掉孤儿
    var alive = Object.create(null);
    project.rows.forEach(function (r) { alive[r.id] = 1; });
    project.rows.forEach(function (r) {
      if (r.pid && !alive[r.pid]) r.pid = null;
    });
  }

  function moveRow(project, id, delta) {
    var i = project.rows.findIndex(function (r) { return r.id === id; });
    if (i < 0) return false;
    var j = i + delta;
    if (j < 0 || j >= project.rows.length) return false;
    var t = project.rows[i];
    project.rows[i] = project.rows[j];
    project.rows[j] = t;
    return true;
  }

  /** 按显示顺序（深度优先）展平 */
  function flatten(project) {
    var childrenOf = Object.create(null);
    project.rows.forEach(function (r) {
      var k = r.pid || '__root__';
      (childrenOf[k] || (childrenOf[k] = [])).push(r);
    });
    var out = [];
    (function walk(pid, depth) {
      var list = childrenOf[pid] || [];
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        r.__depth = depth;
        out.push(r);
        walk(r.id, depth + 1);
      }
    })('__root__', 0);
    // 处理环导致的遗漏
    if (out.length < project.rows.length) {
      var seen = Object.create(null);
      out.forEach(function (r) { seen[r.id] = 1; });
      project.rows.forEach(function (r) {
        if (!seen[r.id]) { r.__depth = 0; out.push(r); }
      });
    }
    return out;
  }

  function descendants(project, id) {
    var out = [];
    (function walk(pid) {
      for (var i = 0; i < project.rows.length; i++) {
        if (project.rows[i].pid === pid) {
          out.push(project.rows[i]);
          walk(project.rows[i].id);
        }
      }
    })(id);
    return out;
  }

  function hasChildren(project, id) {
    for (var i = 0; i < project.rows.length; i++) {
      if (project.rows[i].pid === id) return true;
    }
    return false;
  }

  /* =======================================================================
   * 计算
   * ===================================================================== */
  /**
   * 全工程重算
   * @returns {{results:Object, order:Array, errors:Array, warnings:Array, totals:Object}}
   */
  function recalc(project) {
    var U = CBUnits;
    var results = Object.create(null);   // id -> {id,no,value,gcl,unit,precision,error,hasChildren}
    var byNo = Object.create(null);
    var byCode = Object.create(null);
    var errors = [];
    var warnings = [];
    var state = Object.create(null);     // id -> 1 访问中 / 2 完成 / 3 出错
    var depth = 0;

    var ordered = flatten(project);

    ordered.forEach(function (r) {
      var no = String(r.no == null ? '' : r.no).trim();
      if (no) {
        if (byNo[no] && byNo[no] !== r) {
          warnings.push({ type: 'duplicate-no', rowId: r.id, no: no, message: '编号「' + no + '」重复，行引用将指向最先出现的那一行' });
        } else {
          byNo[no] = r;
        }
      }
      var code = String(r.code || '').trim();
      if (code) {
        if (!byCode[code.toUpperCase()]) byCode[code.toUpperCase()] = r;
      }
    });

    var constMap = Object.create(null);
    (project.constants || []).forEach(function (c) {
      if (c.code) constMap[String(c.code).trim()] = c;
    });

    var varMap = Object.create(null);
    (project.variables || []).forEach(function (v) {
      if (v.code) varMap[String(v.code).trim().toUpperCase()] = v;
    });

    var fnMap = Object.create(null);
    (project.functions || []).forEach(function (f) {
      if (f.name) fnMap[String(f.name)] = f;
    });

    var unitTable = project.unitTable || U.DEFAULT_TABLE;

    /* ---- 上下文工厂 ---- */
    function makeContext(locals) {
      return {
        builtin: CBExpr.builtins,

        const: function (name) {
          if (locals && Object.prototype.hasOwnProperty.call(locals, '@' + name)) return locals['@' + name];
          var c = constMap[name];
          if (!c) {
            for (var k in constMap) { if (k.toUpperCase() === String(name).toUpperCase()) { c = constMap[k]; break; } }
          }
          if (!c) throw CBExpr.ExprError('未定义的常量 @' + name);
          return evalConstValue(c, name);
        },

        variable: function (name) {
          if (locals && Object.prototype.hasOwnProperty.call(locals, name)) return locals[name];
          var key = String(name).toUpperCase();
          var v = varMap[key];
          if (v) return varValue(v);
          var row = byCode[key];
          if (row) return rowRefValue(row, null);
          throw CBExpr.ExprError('未定义的变量 $' + name);
        },

        row: function (no) {
          var key = String(no).trim();
          var row = byNo[key];
          if (!row) throw CBExpr.ExprError('找不到编号为「' + no + '」的行');
          return { __cbRowRef: true, row: row };
        },

        deref: function (ref, field) {
          if (ref && ref.__cbRowRef) return rowRefValue(ref.row, field);
          return ref;
        },

        rowRange: function (fromNo, toNo) {
          var i = indexOfNo(fromNo), j = indexOfNo(toNo);
          if (i < 0) throw CBExpr.ExprError('找不到编号为「' + fromNo + '」的行');
          if (j < 0) throw CBExpr.ExprError('找不到编号为「' + toNo + '」的行');
          if (i > j) { var t = i; i = j; j = t; }
          var values = [];
          for (var k = i; k <= j; k++) values.push({ __cbRowRef: true, row: ordered[k] });
          return { __cbRange: true, values: values };
        },

        customFunction: function (name) { return fnMap[name] || null; },

        invokeCustom: function (fn, args, node) {
          return invokeFunction(fn, args, node);
        }
      };
    }

    function indexOfNo(no) {
      var key = String(no).trim();
      for (var i = 0; i < ordered.length; i++) {
        if (String(ordered[i].no == null ? '' : ordered[i].no).trim() === key) return i;
      }
      return -1;
    }

    function evalConstValue(c, name) {
      var raw = c.value;
      if (raw === '' || raw === null || raw === undefined) return 0;
      var s = String(raw).trim();
      if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return parseFloat(s);
      try {
        return CBExpr.run(s, makeContext(null));
      } catch (e) {
        return s;
      }
    }

    function varValue(v) {
      if (state['var:' + v.code] === 1) throw CBExpr.ExprError('汇总变量 $' + v.code + ' 存在循环引用');
      var key = 'var:' + v.code;
      var old = state[key];
      state[key] = 1;
      try {
        var out = CBExpr.run(String(v.expr || '0'), makeContext(null));
        return CBExpr.helpers.toNum(unRange(out));
      } finally {
        state[key] = old === 1 ? 2 : (old || 2);
      }
    }

    /** 行引用的取值 */
    function rowRefValue(row, field) {
      var f = field ? String(field).trim() : '';
      var res = rowResult(row);      // 递归求值（带环检测）
      if (f === '') return res.value;
      switch (f.toLowerCase()) {
        case 'no': case '编号': case 'xmbh': return row.no == null ? '' : String(row.no);
        case 'name': case '项目名称': case 'xmmc': return row.name || '';
        case 'part': case '部位': case 'bw': return row.part || '';
        case 'unit': case '单位': case 'jsdw': return row.unit || '';
        case 'value': case 'result': case '计算结果': case 'jsjg': return res.value;
        case 'gcl': case '工程量': return res.gcl;
        case 'factor': case '系数': case 'xs': return num(row.factor, 1);
        case 'remark': case '备注': case 'bz': return row.remark || '';
        case 'code': case '引用代码': return row.code || '';
        case 'depth': return row.__depth || 0;
        default:
          if (Object.prototype.hasOwnProperty.call(row.fields || {}, field)) {
            var fv = row.fields[field];
            var nv = Number(fv);
            return (fv === '' || fv === null || fv === undefined) ? 0 : (isFinite(nv) ? nv : fv);
          }
          throw CBExpr.ExprError('行「' + (row.no || '?') + '」上不存在字段 ' + field);
      }
    }

    /** 自定义函数调用 */
    function invokeFunction(fn, args, node) {
      if (depth > MAX_DEPTH) throw CBExpr.ExprError('函数调用层级过深（可能存在递归）');
      var params = fn.params || [];
      if (args.length > params.length) {
        throw CBExpr.ExprError('函数「' + fn.name + '」最多接受 ' + params.length + ' 个参数，实际收到 ' + args.length + ' 个',
          node ? node.pos : -1);
      }
      var locals = Object.create(null);
      for (var i = 0; i < params.length; i++) {
        var pName = params[i].name;
        var v = i < args.length ? args[i] : (params[i].defaultValue !== undefined ? params[i].defaultValue : 0);
        locals[pName] = CBExpr.helpers.isRowRef(v) ? rowRefValue(v.row, null) : unRange(v);
      }
      var ctx = makeContext(locals);
      // 函数内部中间变量（相当于函数内的局部计算式）
      var codes = fn.codes || [];
      for (var c = 0; c < codes.length; c++) {
        var cd = codes[c];
        if (!cd || !cd.name) continue;
        var val = CBExpr.run(String(cd.expr || '0'), ctx);
        val = CBExpr.helpers.toNum(val);
        var prec = parseInt(cd.precision, 10);
        locals[cd.name] = isFinite(prec) && prec >= 0 ? CBExpr.helpers.roundTo(val, prec) : val;
      }
      depth++;
      try {
        var out = CBExpr.run(String(fn.expr || '0'), locals ? makeContext(locals) : ctx);
        var p2 = parseInt(fn.precision, 10);
        var n2 = CBExpr.helpers.toNum(out);
        return isFinite(p2) && p2 >= 0 ? CBExpr.helpers.roundTo(n2, p2) : n2;
      } finally {
        depth--;
      }
    }

    function unRange(v) {
      if (CBExpr.helpers.isRange(v)) {
        return v.values.length ? unRange(v.values[0]) : 0;
      }
      if (CBExpr.helpers.isRowRef(v)) return rowRefValue(v.row, null);
      return v;
    }

    /** 数值按精度取整；非数值（文本/布尔）原样保留；NaN 视为无值 */
    function roundVal(v, precision) {
      var x = unRange(v);
      if (typeof x === 'number') return isFinite(x) ? CBExpr.helpers.roundTo(x, precision) : null;
      if (typeof x === 'boolean') return x;
      if (x === null || x === undefined) return x;
      return x;
    }

    /* ---- 单行求值 ---- */
    function rowResult(row) {
      var cached = results[row.id];
      if (cached && cached.__done) return cached;

      if (state[row.id] === 1) {
        throw CBExpr.ExprError('检测到循环引用：编号「' + (row.no || '?') + '」间接引用了自己');
      }
      if (state[row.id] === 2 || state[row.id] === 3) return results[row.id];

      state[row.id] = 1;
      var entry = {
        id: row.id,
        no: row.no == null ? '' : String(row.no),
        name: row.name || '',
        unit: row.unit || '',
        precision: CBUnits.precisionOf(unitTable, row.unit),
        value: 0,
        ownValue: null,
        gcl: 0,
        factor: num(row.factor, 1),
        error: null,
        __done: false
      };
      results[row.id] = entry;

      try {
        var ctx = makeContext(null);

        // 1) 计算结果
        var exprText = String(row.expr == null ? '' : row.expr).trim();
        if (exprText === '') {
          entry.value = hasChildren(project, row.id) ? 0 : null;   // 空表达式的叶子行 → 无值
          entry.empty = true;
        } else {
          var raw = CBExpr.run(exprText, ctx);
          entry.value = roundVal(raw, entry.precision);
          entry.empty = false;
        }

        // 2) 工程量
        var isGroup = hasChildren(project, row.id);
        entry.hasChildren = isGroup;

        if (isGroup) {
          entry.ownValue = entry.value;   // 分组行自身表达式的值（若有）
          entry.value = null;
          entry.empty = true;
        } else {
          var gclText = String(row.gclExpr == null ? '' : row.gclExpr).trim();
          if (gclText !== '') {
            var g = CBExpr.run(gclText, ctx);
            var gv = roundVal(g, entry.precision);
            entry.gcl = (typeof gv === 'number') ? gv : 0;
            entry.gclSource = 'expr';
          } else if (typeof entry.value !== 'number') {
            entry.gcl = 0;                 // 文本结果没有工程量
          } else {
            entry.gcl = CBExpr.helpers.roundTo(entry.value * entry.factor, entry.precision);
            entry.gclSource = 'value';
          }
        }
        entry.__done = true;
        state[row.id] = 2;
      } catch (e) {
        entry.error = {
          message: e && e.message ? e.message : String(e),
          pos: (e && typeof e.pos === 'number') ? e.pos : -1
        };
        entry.value = null;
        entry.gcl = 0;
        entry.__done = true;
        state[row.id] = 3;
        errors.push({
          rowId: row.id,
          no: entry.no,
          name: entry.name,
          message: entry.error.message,
          pos: entry.error.pos
        });
      }
      return entry;
    }

    /* ---- 全量求值 ---- */
    ordered.forEach(function (r) { rowResult(r); });

    /* ---- 分组汇总：按单位分开统计，自底向上 ----
     * 规则：
     *   1) 勾了"不计"的行不参与
     *   2) 勾了"汇总行"的行是人为小计，不参与（避免重复累加）
     *   3) 分组行指定了单位 → 只累加"单位与之相同"的叶子后代
     *   4) 分组行没有单位   → 后代单位一致则求和；否则不求和（多单位相加无意义）
     */
    var groupAggCache = Object.create(null);

    function groupAgg(id) {
      if (groupAggCache[id]) return groupAggCache[id];
      var agg = { byUnit: Object.create(null), total: 0, count: 0 };
      groupAggCache[id] = agg;               // 占位，防环
      project.rows.forEach(function (kid) {
        if (kid.pid !== id) return;
        var ke = results[kid.id];
        if (!ke) return;
        if (ke.hasChildren) {
          var sub = groupAgg(kid.id);
          for (var su in sub.byUnit) {
            if (!agg.byUnit[su]) agg.byUnit[su] = { unit: su, total: 0, count: 0 };
            agg.byUnit[su].total += sub.byUnit[su].total;
            agg.byUnit[su].count += sub.byUnit[su].count;
          }
          agg.total += sub.total;
          agg.count += sub.count;
        } else if (!kid.ignore && !kid.summary) {
          var u = CBUnits.normalize(kid.unit) || '';
          if (!agg.byUnit[u]) agg.byUnit[u] = { unit: u, total: 0, count: 0 };
          agg.byUnit[u].total += num(ke.gcl, 0);
          agg.byUnit[u].count += 1;
          agg.total += num(ke.gcl, 0);
          agg.count += 1;
        }
      });
      return agg;
    }

    ordered.forEach(function (r) {
      var e = results[r.id];
      if (!e || !e.hasChildren) return;

      var agg = groupAgg(r.id);
      e.childCount = project.rows.filter(function (x) { return x.pid === r.id; }).length;

      /* 按单位的明细小计（供界面与报表展示） */
      e.unitTotals = {};
      Object.keys(agg.byUnit).forEach(function (u) {
        var p = CBUnits.precisionOf(unitTable, u);
        e.unitTotals[u || '(无单位)'] = {
          total: CBExpr.helpers.roundTo(agg.byUnit[u].total, p),
          count: agg.byUnit[u].count,
          unit: u
        };
      });

      var gu = CBUnits.normalize(r.unit || '');
      if (gu) {
        var hit = agg.byUnit[gu];
        e.gcl = hit ? CBExpr.helpers.roundTo(hit.total, CBUnits.precisionOf(unitTable, gu)) : 0;
        e.gclSource = 'sum-unit';
        e.sumUnit = gu;
      } else {
        var units = Object.keys(agg.byUnit);
        if (units.length <= 1) {
          var only = units.length ? units[0] : '';
          e.gcl = CBExpr.helpers.roundTo(agg.total, CBUnits.precisionOf(unitTable, only));
          e.gclSource = 'sum';
        } else {
          e.gcl = null;
          e.mixed = true;
          e.gclSource = 'mixed';
          warnings.push({
            type: 'mixed-units',
            rowId: r.id,
            message: '分组「' + (r.no ? r.no + ' ' : '') + (r.name || '') + '」未指定单位，子行含 ' +
              units.length + ' 种单位（' + units.map(function (x) { return x || '无单位'; }).join('、') +
              '），未给出汇总值；如需汇总请给该分组填写单位'
          });
        }
      }
    });

    /* ---- 常数换算后的量：同一单位汇总 ---- */
    var unitTotals = Object.create(null);
    ordered.forEach(function (r) {
      var e = results[r.id];
      if (!e || e.hasChildren || r.ignore) return;
      var u = CBUnits.normalize(r.unit) || '(无单位)';
      if (!unitTotals[u]) unitTotals[u] = { unit: u, count: 0, total: 0, precision: e.precision };
      unitTotals[u].count += 1;
      unitTotals[u].total += num(e.gcl, 0);
    });
    for (var uk in unitTotals) {
      unitTotals[uk].total = CBExpr.helpers.roundTo(unitTotals[uk].total, unitTotals[uk].precision);
    }

    /* ---- 依赖图 ---- */
    var depsMap = Object.create(null);
    ordered.forEach(function (r) {
      var txt = String(r.expr == null ? '' : r.expr).trim();
      var txt2 = String(r.gclExpr == null ? '' : r.gclExpr).trim();
      var d = { rows: [], constants: [], variables: [], functions: [] };
      [txt, txt2].forEach(function (t) {
        if (!t) return;
        try {
          var an = CBExpr.deps(t);
          d.rows = d.rows.concat(an.rows);
          d.constants = d.constants.concat(an.constants);
          d.variables = d.variables.concat(an.variables);
          d.functions = d.functions.concat(an.functions);
        } catch (e) { /* 语法错误已在求值时报告 */ }
      });
      depsMap[r.id] = d;
    });

    /* ---- 未使用/未定义检查 ---- */
    var usedConst = Object.create(null);
    var usedFn = Object.create(null);
    for (var id in depsMap) {
      depsMap[id].constants.forEach(function (c) { usedConst[String(c).toUpperCase()] = 1; });
      depsMap[id].functions.forEach(function (f) { usedFn[String(f)] = 1; });
    }
    (project.constants || []).forEach(function (c) {
      if (c.code && !usedConst[String(c.code).toUpperCase()]) {
        warnings.push({ type: 'unused-constant', message: '常量 @' + c.code + ' 未被任何行引用' });
      }
    });
    (project.functions || []).forEach(function (f) {
      if (f.name && !usedFn[f.name] && !isBuiltinName(f.name) && !f.library) {
        warnings.push({ type: 'unused-function', message: '自定义函数「' + f.name + '」未被引用' });
      }
    });

    return {
      results: results,
      order: ordered.map(function (r) { return r.id; }),
      errors: errors,
      warnings: warnings,
      deps: depsMap,
      unitTotals: unitTotals,
      stats: {
        rows: project.rows.length,
        leaves: ordered.filter(function (r) { return !results[r.id].hasChildren; }).length,
        errors: errors.length,
        warnings: warnings.length
      }
    };
  }

  function isBuiltinName(name) {
    return !!CBExpr.builtins[String(name).toLowerCase()];
  }

  /* =======================================================================
   * 校验 / 迁移
   * ===================================================================== */
  function validate(project) {
    var errs = [], warns = [];
    if (!project || typeof project !== 'object') return { ok: false, errors: ['工程数据不是对象'], warnings: [] };
    if (project.format && project.format !== FORMAT) {
      errs.push('未知的文件格式标识：' + project.format);
    }
    if (!Array.isArray(project.rows)) errs.push('缺少 rows 数组');
    if (!Array.isArray(project.columns) || !project.columns.length) warns.push('列配置为空，将使用默认列');
    if (!Array.isArray(project.unitTable) || !project.unitTable.length) warns.push('单位表为空，将使用默认单位表');

    var seen = Object.create(null);
    (project.rows || []).forEach(function (r, i) {
      if (!r.id) warns.push('第 ' + (i + 1) + ' 行缺少 id，将自动补齐');
      var no = String(r.no == null ? '' : r.no).trim();
      if (no) {
        if (seen[no]) warns.push('编号「' + no + '」重复');
        seen[no] = 1;
      }
      if (r.expr) {
        var c = CBExpr.check(r.expr);
        if (!c.ok) errs.push('编号「' + (no || '?') + '」公式语法错误：' + c.message);
      }
    });
    return { ok: errs.length === 0, errors: errs, warnings: warns };
  }

  /** 容错加载：补齐缺失字段，修正版本 */
  function normalize(project) {
    if (!project || typeof project !== 'object') throw new Error('无法识别的工程数据');
    var p = project;
    p.format = FORMAT;
    p.version = FORMAT_VERSION;
    p.meta = p.meta || {};
    if (!p.meta.name) p.meta.name = '未命名工程';
    if (!p.meta.createdAt) p.meta.createdAt = nowISO();
    p.meta.updatedAt = nowISO();
    p.unitTable = (Array.isArray(p.unitTable) && p.unitTable.length) ? p.unitTable : clone(CBUnits.DEFAULT_TABLE);
    p.constants = Array.isArray(p.constants) ? p.constants : [];
    p.variables = Array.isArray(p.variables) ? p.variables : [];
    p.functions = Array.isArray(p.functions) ? p.functions : [];
    p.columns = (Array.isArray(p.columns) && p.columns.length) ? mergeColumns(p.columns) : clone(DEFAULT_COLUMNS);
    p.rows = Array.isArray(p.rows) ? p.rows : [];

    p.rows.forEach(function (r) {
      if (!r.id) r.id = uid('r');
      if (r.pid === undefined) r.pid = null;
      if (r.no === undefined) r.no = '';
      if (r.name === undefined) r.name = '';
      if (r.part === undefined) r.part = '';
      if (r.expr === undefined) r.expr = '';
      if (r.unit === undefined) r.unit = '';
      if (r.factor === undefined || r.factor === null || r.factor === '') r.factor = 1;
      if (r.gclExpr === undefined) r.gclExpr = '';
      if (r.code === undefined) r.code = '';
      if (r.remark === undefined) r.remark = '';
      r.ignore = !!r.ignore;
      r.summary = !!r.summary;
      if (!r.fields || typeof r.fields !== 'object') r.fields = {};
    });
    // 清理悬空父指针
    var ids = Object.create(null);
    p.rows.forEach(function (r) { ids[r.id] = 1; });
    p.rows.forEach(function (r) { if (r.pid && !ids[r.pid]) r.pid = null; });

    p.functions.forEach(function (f) {
      if (!f.params) f.params = [];
      if (!f.codes) f.codes = [];
      if (f.precision === undefined) f.precision = -1;
      if (f.unit === undefined) f.unit = '';
      if (!f.catalog) f.catalog = '自定义';
    });
    p.unitTable.forEach(function (u, i) {
      if (u.order === undefined) u.order = i + 1;
      if (u.precision === undefined) u.precision = CBUnits.suggestPrecision(u.name);
    });
    return p;
  }

  function mergeColumns(cols) {
    var byKey = Object.create(null);
    cols.forEach(function (c) { if (c && c.key) byKey[c.key] = c; });
    var out = cols.slice();
    DEFAULT_COLUMNS.forEach(function (d) {
      if (!byKey[d.key]) out.push(clone(d));
    });
    return out;
  }

  function serialize(project) {
    var p = clone(project);
    delete p.__runtime;
    p.format = FORMAT;
    p.version = FORMAT_VERSION;
    p.meta = p.meta || {};
    p.meta.updatedAt = nowISO();
    p.rows.forEach(function (r) { delete r.__depth; });
    return JSON.stringify(p, null, 2);
  }

  function deserialize(text) {
    var obj = typeof text === 'string' ? JSON.parse(text) : text;
    return normalize(obj);
  }

  /* =======================================================================
   * 公式语法检查（供编辑器实时提示）
   * ===================================================================== */
  function checkFormula(text) {
    var res = CBExpr.check(text);
    if (!res.ok) return res;
    try {
      var d = CBExpr.deps(text);
      return { ok: true, deps: d };
    } catch (e) {
      return { ok: false, message: e.message, pos: e.pos };
    }
  }

  return {
    FORMAT: FORMAT,
    FORMAT_VERSION: FORMAT_VERSION,
    DEFAULT_COLUMNS: DEFAULT_COLUMNS,
    newProject: newProject,
    builtinFunctions: builtinFunctions,
    addRow: addRow,
    findRow: findRow,
    removeRow: removeRow,
    moveRow: moveRow,
    flatten: flatten,
    descendants: descendants,
    hasChildren: hasChildren,
    recalc: recalc,
    validate: validate,
    normalize: normalize,
    serialize: serialize,
    deserialize: deserialize,
    checkFormula: checkFormula,
    uid: uid
  };
});
