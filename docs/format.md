# 工程文件格式（`.ocb.json`）

工程文件就是一份普通 JSON。没有二进制、没有加密、没有压缩。
可以直接用文本编辑器打开修改，也可以纳入 Git 做版本管理（建议配合格式化工具做 diff）。

```jsonc
{
  "format": "opencalcbook",
  "version": 1,

  "meta": { … },        // 工程信息
  "unitTable": [ … ],   // 计量单位表
  "constants": [ … ],   // 常量库
  "variables": [ … ],   // 汇总变量
  "columns": [ … ],     // 列配置
  "functions": [ … ],   // 自定义函数
  "rows": [ … ]         // 计算式（树形）
}
```

除 `rows` 外，其余字段缺失时会自动补默认值（见 `CBModel.normalize`），
所以最小可用的工程文件只需要：

```json
{ "rows": [ { "id": "r1", "no": "1", "name": "长", "expr": "12", "unit": "m" } ] }
```

---

## `format` / `version`

- `format` 固定为 `"opencalcbook"`。读到别的值会在校验里报错，但仍会尝试加载。
- `version` 当前为 `1`。

## `meta`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 工程名称，也用作用户导出时的默认文件名 |
| `author` | string | 编制人 |
| `remark` | string | 说明 |
| `createdAt` | string | ISO 时间，创建时自动填写 |
| `updatedAt` | string | ISO 时间，每次序列化时刷新 |
| `precisionGeneral` | number | 保留字段（当前未参与计算） |

## `unitTable[]` — 计量单位表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 单位名，如 `m` `m2` `m3` `个`。空字符串表示"无单位" |
| `order` | number | 显示序号 |
| `precision` | number | 保留小数位。计算结果是按该单位精度取整的 |

单位名会做归一化处理：大小写不敏感，`㎡` `m²` `平方米` 都会归到 `m2`，`米` 归到 `m`。

内建量纲换算表（用于 `换算()` / `convert()`）：

| 量纲 | 基准 | 单位 |
| --- | --- | --- |
| 长度 | m | mm cm dm m km 10m 100m 英寸 英尺 |
| 面积 | m2 | mm2 cm2 dm2 m2 km2 ha 公顷 亩 |
| 体积 | m3 | mm3 cm3 dm3 m3 L mL 升 毫升 |
| 质量 | kg | g kg t 吨 斤 两 |
| 时间 | d | h d 工日 台班 min s |

## `constants[]` — 常量库

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | string | 常量代码，写作 `@code` 引用。不要带 `@` |
| `value` | string | 值。纯数字直接解析；否则当作表达式求值（可以引用其他常量） |
| `description` | string | 说明 |

```json
{ "code": "N1", "value": "24", "description": "基坑 / 柱数量 (个)" }
```

## `variables[]` — 汇总变量

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | string | 代码，写作 `$code` 引用（大小写不敏感） |
| `expr` | string | 表达式，可以引用行、常量、其他变量 |
| `description` | string | 说明 |

变量之间互相引用会检测循环。变量求值后再被行引用时按数值处理。

## `columns[]` — 列配置

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | string | 列标识，决定这一列绑定到哪个字段（见下表） |
| `title` | string | 表头显示名 |
| `field` | string | 对应数据库/接口字段名，导出与对接时用 |
| `visible` | boolean | 是否在界面表格里显示 |
| `reportVisible` | boolean | 是否进入报表 |
| `locked` | boolean | 是否只读（结果列默认只读） |
| `width` | number | 列宽（像素） |
| `type` | string | `text` / `formula` / `number` / `unit` / `flag` / `result` |
| `align` | string | `left` / `center` / `right` |

内置列 `key` 与行字段的对应：

| key | 行字段 | 含义 |
| --- | --- | --- |
| `no` | `no` | 编号 |
| `name` | `name` | 项目名称 |
| `part` | `part` | 部位 |
| `expr` | `expr` | 计算公式 |
| `unit` | `unit` | 单位 |
| `factor` | `factor` | 系数 |
| `value` | — | 计算结果（只读，由引擎算） |
| `gcl` | — | 工程量（只读，由引擎算） |
| `gclExpr` | `gclExpr` | 工程量表达式 |
| `code` | `code` | 引用代码 |
| `remark` | `remark` | 备注 |
| `ignore` | `ignore` | 不计标志 |
| `summary` | `summary` | 汇总行标志 |

不在上表里的 `key` 会绑定到行的 `fields` 对象：`row.fields[key]`。
这样想加"施工班组""验收状态"这类自定义列，只要往 `columns` 里加一项就行，不用改代码。

## `functions[]` — 自定义函数

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 函数名，可以用中文。在当前工程内必须唯一 |
| `description` | string | 说明 |
| `expr` | string | 函数体表达式 |
| `unit` | string | 返回值的单位（仅作标注） |
| `precision` | number | 返回值的取整精度；`-1` 表示不取整 |
| `catalog` | string | 分类，仅用于界面分组 |
| `library` | boolean | 是否为随附函数库（`true` 时不报"未使用"告警） |
| `params[]` | array | 形参，见下 |
| `codes[]` | array | 函数内部中间变量，按顺序求值，后面的可以引用前面的 |

形参 `params[]`：

| 字段 | 说明 |
| --- | --- |
| `name` | 参数名。**在函数体内直接用这个名字引用** |
| `description` | 参数说明 |
| `unit` | 参数单位（仅作标注） |
| `dataType` | `float` / `int`（仅作标注，引擎不做类型强制） |
| `precision` | 参数取整精度，`-1` 表示不取整 |

中间变量 `codes[]`：`name` / `expr` / `precision` / `unit` / `description`。

```jsonc
{
  "name": "圆木大头直径",
  "description": "圆木大头直径",
  "unit": "cm", "precision": 0, "catalog": "计算书",
  "params": [
    { "name": "d", "description": "小头直径", "unit": "cm" },
    { "name": "h", "description": "长度",     "unit": "m" }
  ],
  "codes": [],
  "expr": "100 * (sqrt(12 * 原木体积(d, h) / (PI() * h) - 3 * d^2 / 40000) - d / 200)"
}
```

## `rows[]` — 计算式

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 自动生成 | 行唯一标识，父指针靠它 |
| `pid` | string \| null | `null` | 父行 id；`null` 表示顶层 |
| `no` | string | `""` | 编号，**行引用 `[no]` 用的就是它**，全工程应唯一 |
| `name` | string | `""` | 项目名称 |
| `part` | string | `""` | 部位 |
| `expr` | string | `""` | 计算公式 |
| `unit` | string | `""` | 单位 |
| `factor` | number | `1` | 系数 |
| `gclExpr` | string | `""` | 工程量表达式；填了就以它为准 |
| `code` | string | `""` | 引用代码，`$名字` 找不到同名变量时会按它找行 |
| `remark` | string | `""` | 备注 |
| `ignore` | boolean | `false` | 不计入汇总 |
| `summary` | boolean | `false` | 汇总行标志，不参与累加 |
| `image` | string | `""` | 图片（保留字段，当前界面未使用） |
| `fields` | object | `{}` | 自定义列的值 |

### 行的拓扑

`rows` 数组的顺序就是**同级内的显示顺序**；父子关系完全由 `pid` 决定，与数组顺序无关。
读取时会做深度优先展平，得到一个带层级的顺序列表；行区间 `[起]..[止]` 就是按这个顺序取的。

不存在的 `pid` 会被清成 `null`（变成顶层行），不会导致数据丢失。

### 计算顺序

行与行之间可以任意互相引用，引擎用惰性求值 + 访问标记自动处理依赖顺序，
不要求你在文件里按顺序排列。检测到环（包括自引用）时会给出明确报错，不会死循环。

---

## 校验与容错

```bash
node bin/ocb.js check 你的工程.ocb.json
```

会检查：格式标识、`rows` 是否存在、公式语法、重复编号、悬空的 `pid`、
列配置与单位表是否为空，以及求值期的循环引用、未定义常量/变量/函数、多单位汇总等。

加载时（`CBModel.deserialize` / `normalize`）会：

- 补齐所有缺失字段（`factor` 补 1、`ignore` 补 false ……）；
- 给没有 `id` 的行生成 id；
- 缺列配置时补默认列，缺单位表时补默认单位表；
- 清除指向不存在行的 `pid`。

因此老版本文件、别人手写的残缺文件通常都能直接打开。

## 报表模板

报表模板是另一份独立的 JSON（存在浏览器本地，也可以单独保存），结构：

```jsonc
{
  "format": "opencalcbook-report",
  "version": 1,
  "name": "工程量计算书",
  "page": { "size": "A4", "orientation": "portrait",
            "margin": { "top": 15, "right": 12, "bottom": 15, "left": 12 },
            "baseFontSize": 10, "baseFont": "..." },
  "params": [ { "name": "GCMC", "label": "工程名称", "type": "text", "default": "" } ],
  "header": { "show": true, "title": "%BT", "titleSize": 18,
              "lines": [ "'工程名称：' + %GCMC", "'编制人：' + %BZR" ] },
  "columns": [ { "field": "gcl", "title": "工程量", "width": 110,
                 "align": "right", "isNumber": true } ],
  "body": { "indentName": true, "boldGroup": true, "repeatHeader": true,
            "showTotalRow": true, "totalLabel": "合计", "totalField": "gcl" },
  "footer": { "show": true, "note": "本计算书由 OpenCalcBook 生成",
              "showSignature": false, "signLabels": ["计算", "复核", "审核"] }
}
```

单元格文本里：

- `%参数名` 会被替换成参数值（作为字符串）；
- 整段文本可以写成表达式，例如 `'编制时间：' + %BZSJ`，会走表达式引擎求值；
- 正文列的 `field` 取上行字段（`no` / `name` / `expr` / `unit` / `value` / `gcl` / `remark` …）。

渲染结果是一份带 `@page` 打印样式的独立 HTML，浏览器里 Ctrl+P 可直接打印或存 PDF。

多单位时的合计：正文表格下方会追加一张「分单位小计」表（序号 / 计量单位 / 行数 / 汇总工程量）。
