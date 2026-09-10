/*!
 * OpenCalcBook / 开源计算书 — 表达式引擎
 * ---------------------------------------------------------------------------
 * 一个面向"工程量计算书"场景的表达式引擎。
 *
 * 词法：数字、字符串('..' 或 "..")、标识符(含中文)、内建常量引用 @NAME、
 *       变量引用 $NAME、行引用 [编号]、运算符与括号。
 * 语法：Pratt / 优先级爬升，支持三元、逻辑、比较、字符串拼接、
 *       四则、取模、幂、一元、函数调用、成员访问、区间 ..
 *
 * 设计目标：
 *   1) 中文函数名与中文参数名可用（工程量领域的自定义函数几乎都是中文）
 *   2) 行引用是"惰性"的 —— 求值靠回调，便于上层做循环引用检测与缓存
 *   3) 浏览器 / Node 双端可用（UMD）
 *
 * License: MIT
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CBExpr = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  /* =======================================================================
   * 错误类型
   * ===================================================================== */
  function ExprError(message, pos) {
    var e = new Error(message);
    e.name = 'ExprError';
    e.pos = typeof pos === 'number' ? pos : -1;
    return e;
  }

  /* =======================================================================
   * 词法分析
   * ===================================================================== */
  var IDENT_EXTRA = /[A-Za-z0-9_\u00a1-\uffff]/;

  function isIdentStart(ch) {
    return !!ch && (IDENT_EXTRA.test(ch)) && !/[0-9]/.test(ch);
  }
  function isIdentPart(ch) {
    return !!ch && IDENT_EXTRA.test(ch);
  }

  var OPERATORS = [
    '..', '<=', '>=', '<>', '!=', '==', '&&', '||',
    '+', '-', '*', '/', '%', '^',
    '(', ')', '[', ']', ',', '?', ':', '=', '<', '>', '!', '.'
  ];

  // 多字符运算符必须比单字符先尝试
  OPERATORS.sort(function (a, b) { return b.length - a.length; });

  var NUMBER_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

  var KEYWORDS = {
    'true': 'bool', 'false': 'bool',
    'null': 'null', 'nil': 'null',
    'and': 'and', 'or': 'or', 'not': 'not',
    'div': 'op', 'mod': 'op'
  };

  function tokenize(src) {
    var tokens = [];
    var i = 0, n = src.length;

    function push(type, value, pos) {
      tokens.push({ type: type, value: value, pos: pos });
    }

    while (i < n) {
      var c = src.charAt(i);

      // 空白
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\u3000') {
        i++; continue;
      }

      // 字符串
      if (c === "'" || c === '"') {
        var quote = c, j = i + 1, s = '';
        while (j < n) {
          if (src.charAt(j) === quote) {
            if (src.charAt(j + 1) === quote) { s += quote; j += 2; continue; }
            break;
          }
          s += src.charAt(j); j++;
        }
        if (j >= n) throw ExprError('字符串字面量未闭合', i);
        push('str', s, i);
        i = j + 1;
        continue;
      }

      // 行引用 [编号] —— 内部内容原样保留（编号里可能含 . 或 -）
      if (c === '[') {
        var close = src.indexOf(']', i + 1);
        if (close < 0) throw ExprError('行引用缺少 "]"', i);
        var raw = src.slice(i + 1, close);
        if (raw === '') throw ExprError('行引用内容为空', i);
        push('rowref', raw, i);
        i = close + 1;
        continue;
      }

      // 常量引用 @CODE
      if (c === '@') {
        var k = i + 1;
        while (k < n && isIdentPart(src.charAt(k))) k++;
        if (k === i + 1) throw ExprError('"@" 后缺少常量名', i);
        push('constref', src.slice(i + 1, k), i);
        i = k;
        continue;
      }

      // 变量 / 引用代码 $NAME
      if (c === '$') {
        var m = i + 1;
        while (m < n && isIdentPart(src.charAt(m))) m++;
        if (m === i + 1) throw ExprError('"$" 后缺少变量名', i);
        push('varref', src.slice(i + 1, m), i);
        i = m;
        continue;
      }

      // 数字
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src.charAt(i + 1)))) {
        var rest = src.slice(i);
        var mt = NUMBER_RE.exec(rest);
        if (mt) {
          push('num', parseFloat(mt[0]), i);
          i += mt[0].length;
          continue;
        }
      }

      // 标识符（含中文）
      if (isIdentStart(c)) {
        var p = i + 1;
        while (p < n && isIdentPart(src.charAt(p))) p++;
        var word = src.slice(i, p);
        var kw = KEYWORDS[word.toLowerCase()];
        if (kw === 'bool') push('bool', word.toLowerCase() === 'true', i);
        else if (kw === 'null') push('null', null, i);
        else if (kw === 'and') push('op', '&&', i);
        else if (kw === 'or') push('op', '||', i);
        else if (kw === 'not') push('op', '!', i);
        else if (kw === 'op') push('op', word.toLowerCase() === 'div' ? 'div' : '%', i);
        else push('ident', word, i);
        i = p;
        continue;
      }

      // 运算符
      var matched = null;
      for (var o = 0; o < OPERATORS.length; o++) {
        var op = OPERATORS[o];
        if (src.substr(i, op.length) === op) { matched = op; break; }
      }
      if (matched) {
        push('op', matched, i);
        i += matched.length;
        continue;
      }

      throw ExprError('无法识别的字符 "' + c + '"', i);
    }

    push('eof', null, n);
    return tokens;
  }

  /* =======================================================================
   * 语法分析（Pratt）
   * ===================================================================== */
  function Parser(tokens, src) {
    this.t = tokens;
    this.i = 0;
    this.src = src;
  }

  Parser.prototype.peek = function (k) { return this.t[this.i + (k || 0)]; };
  Parser.prototype.next = function () { return this.t[this.i++]; };
  Parser.prototype.isOp = function (v, k) {
    var t = this.peek(k);
    return t && t.type === 'op' && t.value === v;
  };
  Parser.prototype.eatOp = function (v) {
    if (this.isOp(v)) { this.next(); return true; }
    return false;
  };
  Parser.prototype.expectOp = function (v) {
    if (!this.eatOp(v)) {
      var t = this.peek();
      throw ExprError('应为 "' + v + '"，实际为 ' + describeToken(t), t.pos);
    }
  };

  function describeToken(t) {
    if (!t) return '结尾';
    if (t.type === 'eof') return '表达式结尾';
    if (t.type === 'str') return '字符串 ' + JSON.stringify(t.value);
    return String(t.value);
  }

  Parser.prototype.parse = function () {
    var node = this.parseExpr();
    var t = this.peek();
    if (t.type !== 'eof') {
      throw ExprError('表达式在 ' + describeToken(t) + ' 处存在多余内容', t.pos);
    }
    return node;
  };

  // 三元 ?:
  Parser.prototype.parseExpr = function () {
    var cond = this.parseBinary(0);
    if (this.isOp('?')) {
      this.next();
      var a = this.parseExpr();
      this.expectOp(':');
      var b = this.parseExpr();
      return { type: 'ternary', cond: cond, a: a, b: b, pos: cond.pos };
    }
    return cond;
  };

  // 二元优先级表（数字越大越紧）
  var BINOP = {
    '||': 1, '&&': 2,
    '=': 3, '==': 3, '<>': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3,
    '..': 4,
    '+': 5, '-': 5,
    '*': 6, '/': 6, '%': 6, 'div': 6
  };

  Parser.prototype.parseBinary = function (minPrec) {
    var left = this.parseUnary();
    for (;;) {
      var t = this.peek();
      if (!t || t.type !== 'op') break;
      var prec = BINOP[t.value];
      if (prec === undefined || prec < minPrec) break;

      var opTok = this.next();
      var right = this.parseBinary(prec + 1);     // 全部左结合
      left = {
        type: (t.value === '..') ? 'range' : 'binary',
        op: t.value,
        left: left,
        right: right,
        pos: opTok.pos
      };
    }
    return left;
  };

  // 一元前缀：优先级低于幂运算（-2^2 == -(2^2)）
  Parser.prototype.parseUnary = function () {
    if (this.isOp('-') || this.isOp('+') || this.isOp('!')) {
      var t = this.next();
      var arg = this.parseUnary();
      return { type: 'unary', op: t.value, arg: arg, pos: t.pos };
    }
    return this.parsePower();
  };

  // 幂运算：右结合，指数部分允许再出现一元符号（2^-3）
  Parser.prototype.parsePower = function () {
    var base = this.parsePostfix();
    if (this.isOp('^')) {
      var t = this.next();
      var exp = this.parseUnary();
      return { type: 'binary', op: '^', left: base, right: exp, pos: t.pos };
    }
    return base;
  };

  Parser.prototype.parsePostfix = function () {
    var node = this.parsePrimary();
    for (;;) {
      // 函数调用：标识符紧跟 '('  —— 已在 primary 里处理为 call
      if (this.isOp('.')) {
        // 成员访问： .字段名
        var save = this.i;
        this.next();
        var t = this.peek();
        if (t && t.type === 'ident') {
          this.next();
          node = { type: 'member', obj: node, name: t.value, pos: t.pos };
          continue;
        }
        this.i = save;
        break;
      }
      break;
    }
    return node;
  };

  Parser.prototype.parsePrimary = function () {
    var t = this.peek();

    if (t.type === 'num') { this.next(); return { type: 'num', value: t.value, pos: t.pos }; }
    if (t.type === 'str') { this.next(); return { type: 'str', value: t.value, pos: t.pos }; }
    if (t.type === 'bool') { this.next(); return { type: 'bool', value: t.value, pos: t.pos }; }
    if (t.type === 'null') { this.next(); return { type: 'null', value: null, pos: t.pos }; }
    if (t.type === 'constref') { this.next(); return { type: 'constref', name: t.value, pos: t.pos }; }
    if (t.type === 'varref') { this.next(); return { type: 'varref', name: t.value, pos: t.pos }; }
    if (t.type === 'rowref') { this.next(); return { type: 'rowref', no: t.value, pos: t.pos }; }

    if (t.type === 'ident') {
      this.next();
      // 函数调用
      if (this.isOp('(')) {
        this.next();
        var args = [];
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.parseExpr());
            if (this.eatOp(',')) continue;
            break;
          }
        }
        this.expectOp(')');
        return { type: 'call', name: t.value, args: args, pos: t.pos };
      }
      return { type: 'var', name: t.value, pos: t.pos };
    }

    if (this.isOp('(')) {
      this.next();
      var inner = this.parseExpr();
      this.expectOp(')');
      return { type: 'group', expr: inner, pos: t.pos };
    }

    throw ExprError('无法解析的记号：' + describeToken(t), t.pos);
  };

  /* =======================================================================
   * 值工具
   * ===================================================================== */
  function isRowRef(v) { return v !== null && typeof v === 'object' && v.__cbRowRef === true; }
  function isRange(v) { return v !== null && typeof v === 'object' && v.__cbRange === true; }

  function toNum(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'string') {
      var s = v.trim().replace(/,/g, '');
      if (s === '') return 0;
      var f = parseFloat(s);
      return isNaN(f) ? NaN : f;
    }
    if (isRange(v)) return toNum(v.values.length ? v.values[0] : 0);
    return NaN;
  }

  function toStr(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') {
      if (!isFinite(v)) return String(v);
      // 去掉浮点噪声
      var s = String(v);
      if (s.indexOf('.') >= 0 && s.indexOf('e') < 0 && s.indexOf('E') < 0) {
        s = s.replace(/0+$/, '').replace(/\.$/, '');
      }
      return s;
    }
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (isRange(v)) return v.values.map(toStr).join(',');
    return String(v);
  }

  function truthy(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0 && !isNaN(v);
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') {
      var s = v.trim().toLowerCase();
      return !(s === '' || s === '0' || s === 'false' || s === 'no' || s === '否');
    }
    return true;
  }

  /** 按精度取整（十进制四舍五入，规避二进制浮点噪声） */
  function roundTo(v, digits) {
    if (typeof v !== 'number' || !isFinite(v)) return v;
    var d = parseInt(digits, 10);
    if (!isFinite(d) || d < 0) d = 0;
    if (d > 15) d = 15;
    var neg = v < 0;
    var a = Math.abs(v);
    var s = String(a);
    var r;
    if (s.indexOf('e') < 0 && s.indexOf('E') < 0 && s.length < 16) {
      // 借指数记法做一次十进制意义上的进位，避免 1.005 → 1.00 这类误差
      r = Number(Math.round(Number(a + 'e' + d)) + 'e-' + d);
    } else {
      var f = Math.pow(10, d);
      r = Math.round(a * f) / f;
    }
    if (!isFinite(r)) r = a;
    return neg ? -r : r;
  }

  /* =======================================================================
   * 求值
   * ===================================================================== */
  function evaluate(ast, ctx) {
    return evalNode(ast, ctx || emptyContext());
  }

  function emptyContext() {
    return {
      const: function (name) { throw ExprError('未定义的常量 @' + name); },
      variable: function (name) { throw ExprError('未定义的变量 $' + name); },
      row: function (no) { throw ExprError('无法解析行引用 [' + no + ']'); },
      deref: function (ref, field) { return ref.value; },
      rowRange: function () { throw ExprError('当前上下文不支持行区间'); },
      customFunction: function () { return undefined; },
      builtin: undefined
    };
  }

  function evalNode(node, ctx) {
    switch (node.type) {
      case 'num': return node.value;
      case 'str': return node.value;
      case 'bool': return node.value;
      case 'null': return null;
      case 'group': return evalNode(node.expr, ctx);

      case 'constref': return ctx.const(node.name, node);
      case 'rowref': return ctx.row(node.no, node);
      case 'varref': case 'var':
        return ctx.variable(node.name, node);

      case 'member': {
        var obj = evalNode(node.obj, ctx);
        if (isRowRef(obj)) return ctx.deref(obj, node.name);
        if (obj && typeof obj === 'object') {
          var key = node.name;
          if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
          var lower = key.toLowerCase();
          for (var k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k) && k.toLowerCase() === lower) return obj[k];
          }
          throw ExprError('对象上不存在字段 "' + key + '"', node.pos);
        }
        throw ExprError('无法在 ' + typeof obj + ' 上取字段 "' + node.name + '"', node.pos);
      }

      case 'unary': {
        var v = evalNode(node.arg, ctx);
        if (node.op === '-') return -toNum(derefShallow(v, ctx));
        if (node.op === '+') return toNum(derefShallow(v, ctx));
        return !truthy(derefShallow(v, ctx));
      }

      case 'ternary': {
        var c = evalNode(node.cond, ctx);
        return truthy(derefShallow(c, ctx)) ? evalNode(node.a, ctx) : evalNode(node.b, ctx);
      }

      case 'range': {
        return evalRange(node, ctx);
      }

      case 'binary':
        return evalBinary(node, ctx);

      case 'call': {
        var args = node.args.map(function (a) { return evalNode(a, ctx); });
        return callFunction(node.name, args, ctx, node);
      }
    }
    throw ExprError('未知的语法节点：' + node.type, node.pos);
  }

  function derefShallow(v, ctx) {
    if (isRowRef(v)) return ctx.deref(v, null);
    if (isRange(v)) return v;
    return v;
  }

  function evalRange(node, ctx) {
    if (node.left.type !== 'rowref' || node.right.type !== 'rowref') {
      throw ExprError('区间 ".." 的两端必须是行引用，例如 [1]..[5]', node.pos);
    }
    return ctx.rowRange(node.left.no, node.right.no, node);
  }

  function evalBinary(node, ctx) {
    var op = node.op;

    // 逻辑短路
    if (op === '&&') {
      var l = derefShallow(evalNode(node.left, ctx), ctx);
      return truthy(l) ? truthy(derefShallow(evalNode(node.right, ctx), ctx)) : false;
    }
    if (op === '||') {
      var l2 = derefShallow(evalNode(node.left, ctx), ctx);
      return truthy(l2) ? true : truthy(derefShallow(evalNode(node.right, ctx), ctx));
    }

    var a = derefShallow(evalNode(node.left, ctx), ctx);
    var b = derefShallow(evalNode(node.right, ctx), ctx);

    switch (op) {
      case '+':
        // 任一侧是字符串 -> 拼接
        if (typeof a === 'string' || typeof b === 'string') return toStr(a) + toStr(b);
        return toNum(a) + toNum(b);
      case '-': return toNum(a) - toNum(b);
      case '*':
        if (isRange(a)) return mapRange(a, function (x) { return x * toNum(b); });
        if (isRange(b)) return mapRange(b, function (x) { return toNum(a) * x; });
        return toNum(a) * toNum(b);
      case '/': {
        var d = toNum(b);
        if (d === 0) throw ExprError('除数为零', node.pos);
        return toNum(a) / d;
      }
      case '%': {
        var m = toNum(b);
        if (m === 0) throw ExprError('取模运算的除数为零', node.pos);
        return toNum(a) % m;
      }
      case '^': return Math.pow(toNum(a), toNum(b));
      case 'div': {
        var dv = toNum(b);
        if (dv === 0) throw ExprError('div 的除数为零', node.pos);
        var q = toNum(a) / dv;
        return q < 0 ? Math.ceil(q) : Math.floor(q);   // 朝零取整
      }

      case '=': case '==': return looseEq(a, b);
      case '<>': case '!=': return !looseEq(a, b);
      case '<': return compare(a, b) < 0;
      case '<=': return compare(a, b) <= 0;
      case '>': return compare(a, b) > 0;
      case '>=': return compare(a, b) >= 0;
    }
    throw ExprError('不支持的运算符 "' + op + '"', node.pos);
  }

  function looseEq(a, b) {
    var aNull = (a === null || a === undefined), bNull = (b === null || b === undefined);
    if (aNull || bNull) return aNull && bNull;
    if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b);
    if (typeof a === 'number' && typeof b === 'number') return a === b;
    if (typeof a === 'string' && typeof b === 'string') return a === b;
    // 混合类型：只有当字符串能被严格解析为数字时，才按数值比较
    var s = (typeof a === 'string') ? a : b;
    var n = (typeof a === 'number') ? a : b;
    var t = String(s).trim();
    if (t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return false;
    return parseFloat(t) === n;
  }

  function compare(a, b) {
    if (typeof a === 'string' || typeof b === 'string') {
      if (typeof a !== 'string' || typeof b !== 'string') {
        return toNum(a) < toNum(b) ? -1 : (toNum(a) > toNum(b) ? 1 : 0);
      }
      return a < b ? -1 : (a > b ? 1 : 0);
    }
    var x = toNum(a), y = toNum(b);
    return x < y ? -1 : (x > y ? 1 : 0);
  }

  function mapRange(range, fn) {
    return { __cbRange: true, values: range.values.map(fn) };
  }

  function flattenRange(v, out) {
    if (isRange(v)) { v.values.forEach(function (x) { flattenRange(x, out); }); return out; }
    out.push(v);
    return out;
  }

  function callFunction(name, args, ctx, node) {
    // 1) 项目自定义函数优先（可覆盖内建）
    if (typeof ctx.customFunction === 'function') {
      var custom = ctx.customFunction(name);
      if (custom) return ctx.invokeCustom(custom, args, node);
    }
    // 2) 内建
    var builtins = ctx.builtin || BUILTINS;
    var key = String(name).toLowerCase();
    var fn = builtins[key];
    if (!fn) {
      throw ExprError('未定义的函数 "' + name + '"', node.pos);
    }
    try {
      return fn(args, ctx, node);
    } catch (e) {
      if (e && e.name === 'ExprError') throw e;
      throw ExprError('函数 "' + name + '" 求值失败：' + (e && e.message ? e.message : e), node.pos);
    }
  }

  /* =======================================================================
   * 内建函数库
   * ===================================================================== */
  function num(ctx, v) { return toNum(derefShallow(v, ctx)); }
  function scalarArgs(args, ctx) {
    var out = [];
    for (var i = 0; i < args.length; i++) {
      if (isRange(args[i])) flattenRange(args[i], out);
      else out.push(args[i]);
    }
    return out;
  }
  function argCount(name, args, min, max, node) {
    var n = args.length;
    if (n < min || (max !== undefined && max >= 0 && n > max)) {
      throw ExprError(
        '函数 "' + name + '" 需要 ' + (max === min ? min : (min + '~' + max)) + ' 个参数，实际收到 ' + n + ' 个',
        node ? node.pos : -1);
    }
  }

  var BUILTINS = {
    /* --- 数学 --- */
    abs: function (a, ctx, n) { argCount('abs', a, 1, 1, n); return Math.abs(num(ctx, a[0])); },
    '绝对值': function (a, ctx, n) { return BUILTINS.abs(a, ctx, n); },

    round: function (a, ctx, n) {
      argCount('round', a, 1, 2, n);
      var d = a.length > 1 ? num(ctx, a[1]) : 0;
      return roundTo(num(ctx, a[0]), d);
    },
    '四舍五入': function (a, ctx, n) { return BUILTINS.round(a, ctx, n); },

    ceil: function (a, ctx, n) { argCount('ceil', a, 1, 1, n); return Math.ceil(num(ctx, a[0])); },
    '向上取整': function (a, ctx, n) { return BUILTINS.ceil(a, ctx, n); },
    floor: function (a, ctx, n) { argCount('floor', a, 1, 1, n); return Math.floor(num(ctx, a[0])); },
    '向下取整': function (a, ctx, n) { return BUILTINS.floor(a, ctx, n); },
    int: function (a, ctx, n) { argCount('int', a, 1, 1, n); var v = num(ctx, a[0]); return v < 0 ? Math.ceil(v) : Math.floor(v); },
    '取整': function (a, ctx, n) { return BUILTINS.int(a, ctx, n); },

    sqrt: function (a, ctx, n) {
      argCount('sqrt', a, 1, 1, n);
      var v = num(ctx, a[0]);
      if (v < 0) throw ExprError('sqrt 的参数不能为负数');
      return Math.sqrt(v);
    },
    '平方根': function (a, ctx, n) { return BUILTINS.sqrt(a, ctx, n); },

    pow: function (a, ctx, n) { argCount('pow', a, 2, 2, n); return Math.pow(num(ctx, a[0]), num(ctx, a[1])); },
    '幂': function (a, ctx, n) { return BUILTINS.pow(a, ctx, n); },

    mod: function (a, ctx, n) {
      argCount('mod', a, 2, 2, n);
      var d = num(ctx, a[1]);
      if (d === 0) throw ExprError('mod 的除数为零');
      return num(ctx, a[0]) % d;
    },
    '取余': function (a, ctx, n) { return BUILTINS.mod(a, ctx, n); },

    pi: function () { return Math.PI; },
    e: function () { return Math.E; },

    clamp: function (a, ctx, n) {
      argCount('clamp', a, 3, 3, n);
      var v = num(ctx, a[0]), lo = num(ctx, a[1]), hi = num(ctx, a[2]);
      if (lo > hi) { var t = lo; lo = hi; hi = t; }
      return v < lo ? lo : (v > hi ? hi : v);
    },
    '限制': function (a, ctx, n) { return BUILTINS.clamp(a, ctx, n); },

    /* --- 聚合（支持 [1]..[5] 区间） --- */
    sum: function (a, ctx, n) {
      argCount('sum', a, 1, -1, n);
      var list = scalarArgs(a, ctx), s = 0;
      for (var i = 0; i < list.length; i++) s += num(ctx, list[i]);
      return s;
    },
    '求和': function (a, ctx, n) { return BUILTINS.sum(a, ctx, n); },

    avg: function (a, ctx, n) {
      argCount('avg', a, 1, -1, n);
      var list = scalarArgs(a, ctx);
      if (!list.length) return 0;
      var s = 0;
      for (var i = 0; i < list.length; i++) s += num(ctx, list[i]);
      return s / list.length;
    },
    '平均': function (a, ctx, n) { return BUILTINS.avg(a, ctx, n); },

    count: function (a, ctx, n) {
      argCount('count', a, 1, -1, n);
      var list = scalarArgs(a, ctx), c = 0;
      for (var i = 0; i < list.length; i++) {
        var v = derefShallow(list[i], ctx);
        if (v !== null && v !== undefined && v !== '') c++;
      }
      return c;
    },
    '计数': function (a, ctx, n) { return BUILTINS.count(a, ctx, n); },

    min: function (a, ctx, n) {
      argCount('min', a, 1, -1, n);
      var list = scalarArgs(a, ctx).map(function (x) { return num(ctx, x); });
      return list.length ? Math.min.apply(Math, list) : 0;
    },
    '最小值': function (a, ctx, n) { return BUILTINS.min(a, ctx, n); },

    max: function (a, ctx, n) {
      argCount('max', a, 1, -1, n);
      var list = scalarArgs(a, ctx).map(function (x) { return num(ctx, x); });
      return list.length ? Math.max.apply(Math, list) : 0;
    },
    '最大值': function (a, ctx, n) { return BUILTINS.max(a, ctx, n); },

    /* --- 逻辑 --- */
    iif: function (a, ctx, n) {
      argCount('iif', a, 3, 3, n);
      return truthy(derefShallow(a[0], ctx)) ? derefShallow(a[1], ctx) : derefShallow(a[2], ctx);
    },
    if: function (a, ctx, n) { return BUILTINS.iif(a, ctx, n); },
    '条件': function (a, ctx, n) { return BUILTINS.iif(a, ctx, n); },

    and: function (a, ctx, n) {
      for (var i = 0; i < a.length; i++) if (!truthy(derefShallow(a[i], ctx))) return false;
      return true;
    },
    or: function (a, ctx, n) {
      for (var i = 0; i < a.length; i++) if (truthy(derefShallow(a[i], ctx))) return true;
      return false;
    },
    not: function (a, ctx, n) { argCount('not', a, 1, 1, n); return !truthy(derefShallow(a[0], ctx)); },

    /* --- 字符串 --- */
    uppercase: function (a, ctx, n) { argCount('uppercase', a, 1, 1, n); return toStr(derefShallow(a[0], ctx)).toUpperCase(); },
    '大写': function (a, ctx, n) { return BUILTINS.uppercase(a, ctx, n); },
    upper: function (a, ctx, n) { return BUILTINS.uppercase(a, ctx, n); },
    lower: function (a, ctx, n) { argCount('lower', a, 1, 1, n); return toStr(derefShallow(a[0], ctx)).toLowerCase(); },
    ucase: function (a, ctx, n) { return BUILTINS.uppercase(a, ctx, n); },
    lcase: function (a, ctx, n) { return BUILTINS.lower(a, ctx, n); },
    lowercase: function (a, ctx, n) { argCount('lowercase', a, 1, 1, n); return toStr(derefShallow(a[0], ctx)).toLowerCase(); },
    '小写': function (a, ctx, n) { return BUILTINS.lowercase(a, ctx, n); },
    trim: function (a, ctx, n) { argCount('trim', a, 1, 1, n); return toStr(derefShallow(a[0], ctx)).trim(); },
    len: function (a, ctx, n) { argCount('len', a, 1, 1, n); return toStr(derefShallow(a[0], ctx)).length; },
    '长度': function (a, ctx, n) { return BUILTINS.len(a, ctx, n); },
    left: function (a, ctx, n) {
      argCount('left', a, 2, 2, n);
      return toStr(derefShallow(a[0], ctx)).substr(0, num(ctx, a[1]));
    },
    right: function (a, ctx, n) {
      argCount('right', a, 2, 2, n);
      var s = toStr(derefShallow(a[0], ctx)), k = num(ctx, a[1]);
      return k <= 0 ? '' : s.slice(-k);
    },
    mid: function (a, ctx, n) {
      argCount('mid', a, 3, 3, n);
      var s = toStr(derefShallow(a[0], ctx));
      var start = num(ctx, a[1]), len = num(ctx, a[2]);
      return s.substr(start - 1, len);
    },
    concat: function (a, ctx, n) {
      return a.map(function (x) { return toStr(derefShallow(x, ctx)); }).join('');
    },
    '拼接': function (a, ctx, n) { return BUILTINS.concat(a, ctx, n); },

    /* --- 类型转换与格式化 --- */
    num: function (a, ctx, n) { argCount('num', a, 1, 1, n); return num(ctx, a[0]); },
    '数值': function (a, ctx, n) { return BUILTINS.num(a, ctx, n); },
    str: function (a, ctx, n) { argCount('str', a, 1, 1, n); return toStr(derefShallow(a[0], ctx)); },
    '文本': function (a, ctx, n) { return BUILTINS.str(a, ctx, n); },

    /**
     * formatnum(值, 精度, 千分位?) —— 数值格式化
     * 例：formatnum(1234.5678, 2, true) -> "1,234.57"
     */
    formatnum: function (a, ctx, n) {
      argCount('formatnum', a, 1, 3, n);
      var v = num(ctx, a[0]);
      var d = a.length > 1 ? num(ctx, a[1]) : 0;
      var sep = a.length > 2 ? truthy(derefShallow(a[2], ctx)) : false;
      if (!isFinite(v)) return '';
      var s = roundTo(v, d).toFixed(Math.max(0, Math.min(15, d)));
      if (sep) {
        var parts = s.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        s = parts.join('.');
      }
      return s;
    },
    '格式化': function (a, ctx, n) { return BUILTINS.formatnum(a, ctx, n); },

    /* --- 日期 --- */
    today: function () {
      var d = new Date();
      return formatDate(d, 'yyyy-mm-dd');
    },
    now: function () {
      var d = new Date();
      return formatDate(d, 'yyyy-mm-dd hh:nn:ss');
    },
    formatdatetime: function (a, ctx, n) {
      argCount('formatdatetime', a, 2, 2, n);
      var fmt = toStr(derefShallow(a[0], ctx));
      var raw = derefShallow(a[1], ctx);
      var d = (raw instanceof Date) ? raw : new Date(raw);
      if (isNaN(d.getTime())) return toStr(raw);
      return formatDate(d, fmt);
    },

    /* --- 工程量领域辅助 --- */
    /** rect(长, 宽) —— 矩形面积 */
    rect: function (a, ctx, n) { argCount('rect', a, 2, 2, n); return num(ctx, a[0]) * num(ctx, a[1]); },
    /** 单位换算 convert(值, 源单位, 目标单位) */
    convert: function (a, ctx, n) {
      argCount('convert', a, 3, 3, n);
      var v = num(ctx, a[0]);
      var from = toStr(derefShallow(a[1], ctx));
      var to = toStr(derefShallow(a[2], ctx));
      if (typeof CONVERT_UNITS !== 'function') throw ExprError('单位换算表未加载');
      return CONVERT_UNITS(v, from, to);
    },
    '换算': function (a, ctx, n) { return BUILTINS.convert(a, ctx, n); }
  };

  var CONVERT_UNITS = null; // 由 units.js 注入，避免循环依赖
  function setUnitConverter(fn) { CONVERT_UNITS = fn; }

  function pad2(x) { return (x < 10 ? '0' : '') + x; }
  function formatDate(d, fmt) {
    var map = {
      yyyy: d.getFullYear(),
      mm: pad2(d.getMonth() + 1),
      dd: pad2(d.getDate()),
      hh: pad2(d.getHours()),
      nn: pad2(d.getMinutes()),
      ss: pad2(d.getSeconds())
    };
    return String(fmt).replace(/yyyy|mm|dd|hh|nn|ss/g, function (k) { return map[k]; });
  }

  /* =======================================================================
   * 依赖提取（供上层做数据流 / 循环检测）
   * ===================================================================== */
  function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (var k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      if (k === 'pos') continue;
      var v = node[k];
      if (Array.isArray(v)) v.forEach(function (x) { walk(x, visit); });
      else if (v && typeof v === 'object') walk(v, visit);
    }
  }

  /**
   * 收集表达式直接依赖的行编号 / 常量名 / 变量名 / 函数名
   */
  function analyze(ast) {
    var rows = [], consts = [], vars = [], funcs = [];
    walk(ast, function (n) {
      if (n.type === 'rowref') rows.push(n.no);
      else if (n.type === 'constref') consts.push(n.name);
      else if (n.type === 'varref' || n.type === 'var') vars.push(n.name);
      else if (n.type === 'call') funcs.push(n.name);
    });
    return {
      rows: uniq(rows),
      constants: uniq(consts),
      variables: uniq(vars),
      functions: uniq(funcs)
    };
  }

  function uniq(arr) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < arr.length; i++) {
      var k = String(arr[i]);
      if (!seen[k]) { seen[k] = 1; out.push(arr[i]); }
    }
    return out;
  }

  /* =======================================================================
   * 对外 API
   * ===================================================================== */
  var cache = Object.create(null);

  function compile(src) {
    var key = String(src);
    if (cache[key]) return cache[key];
    var ast = new Parser(tokenize(key), key).parse();
    cache[key] = ast;
    return ast;
  }

  function run(src, ctx) {
    return evaluate(compile(src), ctx);
  }

  function deps(src) {
    return analyze(compile(src));
  }

  /** 只做语法检查，不求值 */
  function check(src) {
    try {
      compile(src);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message, pos: e.pos };
    }
  }

  return {
    VERSION: VERSION,
    ExprError: ExprError,
    tokenize: tokenize,
    compile: compile,
    parse: compile,
    evaluate: evaluate,
    run: run,
    deps: deps,
    check: check,
    analyze: analyze,
    builtins: BUILTINS,
    setUnitConverter: setUnitConverter,
    helpers: {
      toNum: toNum,
      toStr: toStr,
      truthy: truthy,
      roundTo: roundTo,
      isRowRef: isRowRef,
      isRange: isRange,
      makeRange: function (values) { return { __cbRange: true, values: values }; }
    }
  };
});
