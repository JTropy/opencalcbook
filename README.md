# OpenCalcBook · 开源计算书

[![CI](https://github.com/JTropy/opencalcbook/actions/workflows/ci.yml/badge.svg)](https://github.com/JTropy/opencalcbook/actions/workflows/ci.yml)

一个面向**工程量计算书**场景的开源工具：树形计算式 + 表达式引擎 + 计量单位/常量库 + 自定义函数 + 区带报表。

**零依赖、零构建、纯前端可用**。双击 `index.html` 就能跑；也可以只用它的计算内核做 Node 脚本。

```
[1] × [2] × @H1        →  带行引用、常量、单位精度的表达式
圆形面积(换算(r,'cm','m'))  →  自定义中文函数 + 单位换算
```

---

## 目录

- [它能做什么](#它能做什么)
- [快速开始](#快速开始)
- [计算语义](#计算语义)
- [表达式语法](#表达式语法)
- [工程文件格式](#工程文件格式)
- [命令行](#命令行)
- [项目结构](#项目结构)
- [测试](#测试)
- [设计取舍](#设计取舍)
- [许可与声明](#许可与声明)

---

## 它能做什么

| 能力 | 说明 |
| --- | --- |
| **树形计算式** | 计算式可以分组、缩进、折叠。分组行自动汇总，支持"部位"、"备注"等附加字段 |
| **表达式引擎** | 支持行引用 `[1.2]`、常量 `@K1`、变量 `$HNT`、区间 `[1]..[5]`、`^` 幂、`div` 整除、字符串拼接、三元表达式 |
| **中文函数名** | 自定义函数可以用中文命名、中文参数名，函数内部还能定义中间变量（逐步计算） |
| **计量单位与精度** | 每个单位有独立小数位精度；内置长度/面积/体积/质量/时间量纲换算 |
| **常量库** | 放坡系数、埋深、含钢量这类全局参数集中管理 |
| **汇总变量** | 把若干行的结果合成一个命名变量，别处用 `$名字` 引用 |
| **区带报表** | 页眉 / 列头 / 正文 / 页脚四条区带，单元格支持 `%参数` 与表达式，一键打印或导出 PDF |
| **多格式导出** | CSV（Excel 直接打开）、TSV、Markdown、纯文本计算书、可打印 HTML、工程 JSON |
| **实时校验** | 语法错误、循环引用、重复编号、未使用常量、多单位汇总，全部即时提示并可点击定位 |
| **本地优先** | 数据保存在浏览器本地，也可以随时导出成普通 JSON 文件做版本管理。不联网、不上传 |

---

## 快速开始

### 方式一：直接打开

```bash
git clone https://github.com/JTropy/opencalcbook.git
cd opencalcbook
```

然后双击 `index.html`。首次打开会自动载入示例工程（某住宅楼工程量计算书，48 行）。
**不需要 `npm install`** —— 运行时零依赖。

### 方式二：本地服务器

```bash
node bin/serve.js          # http://127.0.0.1:5180/
```

### 方式三：只用计算内核

```js
const CBModel = require('./src/model.js');
const CBExpr  = require('./src/expr.js');
const CBUnits = require('./src/units.js');
CBExpr.setUnitConverter(CBUnits.convert);

const p = CBModel.newProject({ name: '小工程' });
const g = CBModel.addRow(p, null, { no: '一', name: '基础', unit: 'm2' });
CBModel.addRow(p, g.id, { no: '1', name: '长', expr: '12', unit: 'm' });
CBModel.addRow(p, g.id, { no: '2', name: '宽', expr: '8',  unit: 'm' });
CBModel.addRow(p, g.id, { no: '3', name: '面积', expr: '[1] * [2]', unit: 'm2' });

const calc = CBModel.recalc(p);
console.log(calc.results[g.id].gcl);   // 96
```

---

## 计算语义

每一行有三个关键量：

```
计算结果 = eval(表达式)                                  按行的单位精度取整
工程量   = eval(工程量表达式)   若填了
           否则 计算结果 × 系数
```

分组行的工程量按下面的规则汇总——**这条规则很重要**：

1. 勾了「不计」的行不参与汇总；
2. 勾了「汇总行」的行视为人为小计，不参与汇总（避免重复累加）；
3. **分组行填了单位** → 只累加"单位与之相同"的叶子后代；
4. **分组行没填单位** → 后代单位一致时求和；单位不一致时**不给汇总值**，并提示填写单位。

> 为什么这么设计：不同计量单位的工程量相加是没有意义的（3 m³ + 5 m² = ?）。
> 与其给一个看起来像那么回事的错误数字，不如什么都不给，并明确告诉用户原因。
> 报表的「合计」也是同理——单单位时一行合计，多单位时附一张分单位小计表（对应工程上
> 常见的"汇总表：名称 / 单位 / 汇总工程量"）。

行引用取值可以指定字段：

```js
[1.2]            // 该行的计算结果
[1.2].gcl        // 该行的工程量
[1.2].name       // 项目名称      （还支持 part / unit / factor / remark / code / depth 及自定义字段）
```

---

## 表达式语法

### 字面量与引用

| 写法 | 含义 |
| --- | --- |
| `12`、`3.14`、`1.5e3` | 数字 |
| `'文本'`、`"文本"` | 字符串（单引号内 `''` 表示一个单引号） |
| `[1]`、`[1.2]`、`[A-1]` | 行引用（按编号，编号里可以有 `.` `-`） |
| `@K1` | 常量 |
| `$HNT` | 汇总变量（没有同名变量时会去找引用代码相同的行） |
| `[1]..[5]` | 行区间，配合 `sum()` / `avg()` / `count()` 使用 |

### 运算符（优先级从低到高）

```
条件 ? 甲 : 乙          // 三元
or  ||
and  &&
=  ==  <>  !=  <  <=  >  >=
+  -                   // 任一侧是字符串则为拼接
*  /  mod  div         // div 为整除（向零取整）
^                      // 幂（右结合）
-  +  !                // 一元
```

可选写法：`and` / `or` / `not` / `div` / `mod` 与 `&&` / `||` / `!` 等价。

### 内置函数

```
数学    abs  round(x,n)  ceil  floor  int  sqrt  pow  mod  pi()  e()  clamp(x,lo,hi)
聚合    sum  avg  count  min  max                     // 接区间：[1]..[5]
逻辑    iif(条件,a,b)  if  and  or  not
字符串  upper  lower  trim  len  left  right  mid(s,起点,长度)  concat
转换    num  str  formatnum(值,精度,千分位)
日期    today()  now()  formatdatetime('yyyy-mm-dd', 值)
工程    convert(值,'m','mm')   换算(值,'m','mm')
```

中文别名：`绝对值` `四舍五入` `向上取整` `向下取整` `取整` `平方根` `幂` `取余` `求和` `平均` `计数` `最小值` `最大值` `条件` `大写` `小写` `长度` `拼接` `数值` `文本` `格式化` `限制`。

完整清单见 [`docs/expression.md`](docs/expression.md)。

### 自定义函数

函数是工程数据的一部分，在界面左侧「函数」页维护。示例：

```jsonc
{
  "name": "圆柱体积",
  "description": "圆柱体积 = π × r² × h",
  "unit": "m3",
  "precision": 4,
  "params": [
    { "name": "r", "description": "半径", "unit": "m" },
    { "name": "h", "description": "高",   "unit": "m" }
  ],
  "codes": [],                                  // 内部中间变量，按顺序求值
  "expr": "PI() * r^2 * h"
}
```

带中间变量的例子（`DD` 在 `expr` 里可以直接用）：

```jsonc
{
  "name": "圆木侧面积",
  "params": [ { "name": "d", "description": "小头直径", "unit": "cm" },
              { "name": "h", "description": "长度",     "unit": "m"  } ],
  "codes":  [ { "name": "DD", "description": "大头直径", "expr": "d * 1.2", "precision": 0 } ],
  "expr":   "PI() * h * (DD/100 + d/100) / 2",
  "unit": "m2", "precision": 4
}
```

调用：`圆木侧面积(20, 5)`

---

## 工程文件格式

工程文件是**普通 JSON**，扩展名 `.ocb.json`，可以直接用文本编辑器改、用 Git 做版本管理。

```jsonc
{
  "format": "opencalcbook",
  "version": 1,
  "meta":      { "name": "某住宅楼工程量计算书", "author": "张三" },
  "unitTable": [ { "name": "m3", "order": 3, "precision": 3 } ],
  "constants": [ { "code": "H1", "value": "1.8", "description": "基础埋深 (m)" } ],
  "variables": [ { "code": "HNT", "expr": "[2.5] + [2.10] + [2.15]", "description": "混凝土总量" } ],
  "columns":   [ { "key": "gcl", "title": "工程量", "field": "GCL", "visible": true,
                   "reportVisible": true, "locked": true, "width": 110, "type": "result" } ],
  "functions": [ /* 见上 */ ],
  "rows": [
    { "id": "r1", "pid": null, "no": "一", "name": "土石方工程", "unit": "m3", "summary": true },
    { "id": "r2", "pid": "r1", "no": "1.9", "name": "平整场地",
      "expr": "[1.3]", "unit": "m2", "factor": 1, "remark": "按首层建筑面积计" }
  ]
}
```

字段说明见 [`docs/format.md`](docs/format.md)。

---

## 命令行

```bash
node bin/ocb.js calc   examples/demo.ocb.json            # 终端打印计算书
node bin/ocb.js check  examples/demo.ocb.json            # 校验（语法 / 循环 / 重复编号）
node bin/ocb.js csv    examples/demo.ocb.json -o out.csv # 导出 CSV
node bin/ocb.js md     examples/demo.ocb.json -o out.md
node bin/ocb.js txt    examples/demo.ocb.json -o out.txt
node bin/ocb.js report examples/demo.ocb.json -o out.html
node bin/ocb.js demo   -o my.ocb.json                    # 生成示例工程
```

`check` 与 `calc` 在发现问题时返回退出码 `2`，适合放进 CI。

---

## 项目结构

```
opencalcbook/
├── index.html              界面（无构建，直接打开）
├── src/
│   ├── expr.js             表达式引擎：词法 / Pratt 语法 / 求值 / 内置函数
│   ├── units.js            单位表、量纲换算、精度
│   ├── model.js            工程模型、行树、求值调度、循环检测、分组汇总
│   ├── report.js           区带报表模型 → 可打印 HTML
│   ├── exporter.js         CSV / TSV / Markdown / 纯文本
│   ├── app.js              界面逻辑
│   └── style.css           样式（浅色/深色）
├── bin/
│   ├── ocb.js              命令行
│   └── serve.js            开发用静态服务器
├── examples/
│   ├── demo-project.js     示例工程的构造代码（浏览器与 Node 共用）
│   ├── demo.ocb.json       由 npm run demo:json 生成
│   └── demo.html           由 npm run demo:report 生成的报表样例
├── docs/
│   ├── expression.md       表达式语法与函数清单
│   └── format.md           工程文件字段说明
├── tests/
│   ├── run-tests.js        引擎与模型测试（Node）
│   └── smoke-ui.js         界面冒烟测试（jsdom）
└── .github/
    └── workflows/ci.yml    CI：Node 18/20/22 跑测试 + 校验示例工程
```

模块都是 UMD 写法，浏览器挂到 `window.CB*`，Node 下 `require` 即可，两边共用同一份代码。

---

## 测试

```bash
npm test              # 引擎测试 + 界面测试
npm run test:engine   # 只跑引擎/模型（无需额外依赖）
npm run test:ui       # 界面冒烟测试（需要 jsdom：npm i -D jsdom）
```

CI 见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)：在 Node 18 / 20 / 22 上跑 `npm test`，
并额外用 `node bin/ocb.js check examples/demo.ocb.json` 校验示例工程
（该命令发现问题时退出码为 `2`，可以直接当作 CI 门禁）。

- 引擎测试覆盖词法、优先级、字符串、常量/变量、单位换算、行引用、区间、循环检测、
  自定义函数、序列化、报表渲染、导出格式、边界与异常。
- 界面测试用 jsdom 真跑一遍 `index.html`：初始化、行操作、折叠、公式编辑器（含试算与
  语法报错）、函数编辑器、报表预览、导出、主题切换、新建/载入示例，并断言无运行期错误。

---

## 设计取舍

- **不做增量重算**：一次编辑后全量重算。计算式行数在几百到几千量级，全量重算足够快，
  换来的是逻辑简单、不会出现缓存不一致。
- **行引用按"编号"而不是按 id**：编号是人写的、可读的、可以出现在报表和打印稿上，
  这也符合工程算量的习惯。代价是编号重复时只能取最先出现的那一行——所以会有重复编号告警。
- **求值结果区分"数字"和"文本"**：文本结果不会被当成 0 参与算术，`'' = 0` 为假，
  避免把没填的单元格静默算成 0。
- **多单位不做自动换算求和**：见上文「计算语义」。宁可留空也不给错误数字。
- **不引入框架**：整个界面是原生 DOM，没有构建步骤。代价是 app.js 偏长，好处是
  `git clone` 完就能用，也方便把这个计算内核嵌到别的地方。

---

## 许可与声明

MIT License，见 [LICENSE](LICENSE)。

本项目是**独立实现**：全部代码自行编写，数据格式自定义为开放 JSON，
不包含任何第三方软件的代码、图标、帮助文档或私有文件格式，也不包含任何授权/登录绕过逻辑。
数据模型参考的是工程量计算这一行业中通行的概念（计算式树、计量单位与精度、常量库、
自定义函数、区带报表），这些概念本身是通用的工程实践。

计算内核是不带任何保证的通用工具，**算量结果请务必人工复核**。
