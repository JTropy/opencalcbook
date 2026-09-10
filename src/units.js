/*!
 * OpenCalcBook / 开源计算书 — 单位与精度
 * ---------------------------------------------------------------------------
 * 对应工程量领域的"计量单位表"：每个单位有 名称 / 序号 / 精度（小数位）。
 * 同时在内部维护一张量纲换算表，使 CONVERT() / 换算() 可用。
 *
 * License: MIT
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CBUnits = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* =======================================================================
   * 量纲表： 组名 -> { 单位: 相对基准的倍率 }
   * 基准：长度 m、面积 m2、体积 m3、质量 kg
   * ===================================================================== */
  var DIMENSIONS = {
    length: {
      base: 'm',
      units: {
        'mm': 0.001, 'cm': 0.01, 'dm': 0.1, 'm': 1,
        'km': 1000, '10m': 10, '100m': 100,
        '英寸': 0.0254, '英尺': 0.3048
      }
    },
    area: {
      base: 'm2',
      units: {
        'mm2': 1e-6, 'cm2': 1e-4, 'dm2': 1e-2, 'm2': 1,
        'km2': 1e6, 'ha': 1e4, '公顷': 1e4, '亩': 666.6666666666666
      }
    },
    volume: {
      base: 'm3',
      units: {
        'mm3': 1e-9, 'cm3': 1e-6, 'dm3': 1e-3, 'm3': 1,
        'l': 1e-3, 'ml': 1e-6, '升': 1e-3, '毫升': 1e-6
      }
    },
    mass: {
      base: 'kg',
      units: {
        'g': 0.001, 'kg': 1, 't': 1000, '吨': 1000,
        '斤': 0.5, '两': 0.05
      }
    },
    time: {
      base: 'd',
      units: { 'h': 1 / 24, 'd': 1, '工日': 1, '台班': 1, 'min': 1 / 1440, 's': 1 / 86400 }
    }
  };

  // 同义写法归一
  var ALIAS = {
    'm²': 'm2', '㎡': 'm2', '平方米': 'm2', '平米': 'm2', 'm^2': 'm2',
    'cm²': 'cm2', 'mm²': 'mm2', 'dm²': 'dm2', 'km²': 'km2',
    'm³': 'm3', 'm3': 'm3', '立方米': 'm3', '方': 'm3', 'm^3': 'm3',
    'cm³': 'cm3', 'mm³': 'mm3', '立方厘米': 'cm3',
    '米': 'm', '厘米': 'cm', '毫米': 'mm', '分米': 'dm', '千米': 'km', '公里': 'km',
    '公斤': 'kg', '千克': 'kg', '吨': 't', '克': 'g',
    '小时': 'h', '天': 'd', '日': 'd'
  };

  var LOWER = {};
  function buildLower() {
    LOWER = Object.create(null);
    for (var g in DIMENSIONS) {
      for (var u in DIMENSIONS[g].units) LOWER[u.toLowerCase()] = u;
    }
    for (var a in ALIAS) LOWER[a.toLowerCase()] = ALIAS[a];
  }
  buildLower();

  /** 归一化单位名（大小写、全角、别称） */
  function normalize(name) {
    if (name === null || name === undefined) return '';
    var s = String(name).trim();
    if (s === '') return '';
    s = s.replace(/[\uFF01-\uFF5E]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
    var hit = LOWER[s.toLowerCase()];
    return hit || s;
  }

  function findDimension(unit) {
    var u = normalize(unit);
    if (u === '') return null;
    for (var g in DIMENSIONS) {
      if (Object.prototype.hasOwnProperty.call(DIMENSIONS[g].units, u)) {
        return { name: g, base: DIMENSIONS[g].base, factor: DIMENSIONS[g].units[u] };
      }
    }
    return null;
  }

  /**
   * 单位换算
   * @throws 当两个单位不同量纲且不相等时抛出
   */
  function convert(value, from, to) {
    var a = normalize(from), b = normalize(to);
    var v = Number(value);
    if (!isFinite(v)) return NaN;
    if (a === b || b === '') return v;
    if (a === '') return v;

    var fa = findDimension(a), fb = findDimension(b);
    if (!fa || !fb) return v;           // 未知单位：视为同名，原样返回
    if (fa.name !== fb.name) {
      throw new Error('单位 "' + from + '" 与 "' + to + '" 不属于同一量纲，无法换算');
    }
    return v * fa.factor / fb.factor;
  }

  /** 判断两个单位是否可换算 */
  function compatible(a, b) {
    var fa = findDimension(a), fb = findDimension(b);
    return !!fa && !!fb && fa.name === fb.name;
  }

  /* =======================================================================
   * 默认单位表（对应 JLDW：名称 / 序号 / 精度）
   * ===================================================================== */
  var DEFAULT_TABLE = [
    { name: 'm', order: 1, precision: 3 },
    { name: 'm2', order: 2, precision: 2 },
    { name: 'm3', order: 3, precision: 2 },
    { name: 'mm', order: 4, precision: 0 },
    { name: 'cm', order: 5, precision: 1 },
    { name: 'kg', order: 6, precision: 2 },
    { name: 't', order: 7, precision: 3 },
    { name: '个', order: 8, precision: 0 },
    { name: '根', order: 9, precision: 0 },
    { name: '樘', order: 10, precision: 0 },
    { name: '处', order: 11, precision: 0 },
    { name: '套', order: 12, precision: 0 },
    { name: '台', order: 13, precision: 0 },
    { name: '工日', order: 14, precision: 2 },
    { name: '项', order: 15, precision: 0 },
    { name: '', order: 16, precision: 2 }
  ];

  /** 常用单位建议精度（新建单位时给默认值） */
  function suggestPrecision(unit) {
    var u = normalize(unit);
    var map = {
      'm': 3, 'm2': 2, 'm3': 2, 'mm': 0, 'cm': 1, 'dm': 2, 'km': 3,
      'kg': 2, 't': 3, 'g': 1, '个': 0, '根': 0, '樘': 0, '处': 0,
      '套': 0, '台': 0, '项': 0, '工日': 2
    };
    if (Object.prototype.hasOwnProperty.call(map, u)) return map[u];
    var d = findDimension(u);
    if (d && d.name === 'length') return 3;
    if (d && d.name === 'area') return 2;
    if (d && d.name === 'volume') return 2;
    return 2;
  }

  /** 在单位表里查精度；表里没有则给建议值；都没有则 2 */
  function precisionOf(table, unit) {
    var u = normalize(unit);
    if (Array.isArray(table)) {
      for (var i = 0; i < table.length; i++) {
        if (normalize(table[i].name) === u) {
          var p = parseInt(table[i].precision, 10);
          return isFinite(p) ? p : suggestPrecision(u);
        }
      }
    }
    return u === '' ? 2 : suggestPrecision(u);
  }

  /** 按单位精度格式化 */
  function format(value, table, unit, thousandSep) {
    var p = precisionOf(table, unit);
    var v = Number(value);
    if (!isFinite(v)) return '';
    var s = v.toFixed(Math.max(0, Math.min(15, p)));
    if (thousandSep) {
      var parts = s.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      s = parts.join('.');
    }
    return s;
  }

  /* =======================================================================
   * 单位表结构校验 / 工具
   * ===================================================================== */
  function tableToMap(table) {
    var m = Object.create(null);
    (table || []).forEach(function (it) { m[normalize(it.name)] = it; });
    return m;
  }

  function listDimensions() {
    var out = [];
    for (var g in DIMENSIONS) {
      out.push({ name: g, base: DIMENSIONS[g].base, units: Object.keys(DIMENSIONS[g].units) });
    }
    return out;
  }

  var api = {
    DIMENSIONS: DIMENSIONS,
    DEFAULT_TABLE: DEFAULT_TABLE,
    normalize: normalize,
    convert: convert,
    compatible: compatible,
    findDimension: findDimension,
    suggestPrecision: suggestPrecision,
    precisionOf: precisionOf,
    format: format,
    tableToMap: tableToMap,
    listDimensions: listDimensions
  };

  // 自动接入表达式引擎（浏览器全局 / Node 全局均可）
  try {
    var g = (typeof globalThis !== 'undefined') ? globalThis : root;
    if (g && g.CBExpr && typeof g.CBExpr.setUnitConverter === 'function') {
      g.CBExpr.setUnitConverter(convert);
    }
  } catch (e) { /* 忽略 */ }

  return api;
});
