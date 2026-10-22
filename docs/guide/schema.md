# 文档数据结构

业务持久化保存 `IEditorData`，不保存字形、页面坐标或内部行对象。运行期元素与原生布局几何都是派生层，关系见[架构说明](./architecture.md)。本页类型与枚举均可从包根导入。

## 文档、元素与段落

```typescript
import { RowFlex, TextDirection, ElementType } from '@herberthe/canvas-editor'
import type { IEditorData } from '@herberthe/canvas-editor'

const data: IEditorData = {
  header: [{ value: '周末计划', rowFlex: RowFlex.CENTER }],
  main: [
    { value: '购物清单', bold: true, spacingAfter: 8 },
    { value: '\n' },
    { value: 'مرحبا بالعائلة', direction: TextDirection.RTL },
    { value: '\n' },
    {
      type: ElementType.HYPERLINK,
      value: '',
      url: 'https://example.com',
      valueList: [{ value: '社区活动日历' }]
    }
  ],
  footer: [{ value: '记得带购物袋。', size: 12 }]
}
```

结构化数据中的 `main` 必填，header/footer 和 graffiti 可选；`Editor.create` 也接受只含正文的 `IElement[]`。`value` 保存文字或对应元素的内容，复合元素可使用 `valueList`。输入换行会被标准化为内部段落标记；外部不要自行制造补偿标记，也不要假设一个运行期元素等于一个 UTF-16 单元。

段落内容方向使用 `element.direction`，对齐使用 `rowFlex`。段落属性由元素承载并由编辑器标准化，运行期修改应使用段落命令。`options.direction` 控制 UI 镜像，与内容方向分离。段前/段后间距不是行高的替代品。

## 元素字段分组

| 分组       | 常用字段                                                                                        | 说明                                 |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------ |
| 身份与扩展 | id、externalId、extension、type、value                                                          | 业务扩展放入 extension；校验外部输入 |
| 文字样式   | font、size、bold、italic、color、highlight、underline、strikeout、letterSpacing、textDecoration | 字体家族需要实际注册的可用字节       |
| 段落       | rowFlex、direction、rowMargin、spacingBefore、spacingAfter                                      | 上下文影响整形和分页                 |
| 标题/列表  | level、title、listType、listStyle、listLevel、listWrap、valueList                               | 运行期 ID 由编辑器维护               |
| 表格       | colgroup、trList、borderType、borderColor、borderWidth                                          | 单元格 value 递归包含元素数组        |
| 超链接     | url、valueList                                                                                  | 外部 URL 需校验                      |
| 图片       | width、height、imgDisplay、imgFloatPosition、imgCrop、imgCaption                                | 资源与尺寸影响绘制及导出             |
| 控件       | control、valueList                                                                              | 参见控件配置和级联参考               |
| 其他对象   | block、dateFormat、laTexSVG、dashArray、lineWidth                                               | SVG 公式/图片数据不代表 SVG 页面引擎 |
| 业务标注   | groupIds、trace、area、label、hide、hint                                                        | 参见对应命令与配置                   |

可选字段和完整枚举成员以包根导出的 `IElement` 类型为准。本表用于按职责查找，不维护一份容易漂移的伪类型声明。

## 表格嵌套示例

```typescript
import { ElementType } from '@herberthe/canvas-editor'
import type { IElement } from '@herberthe/canvas-editor'

const table: IElement = {
  type: ElementType.TABLE,
  value: '',
  colgroup: [{ width: 220 }, { width: 220 }],
  trList: [
    {
      height: 40,
      tdList: [
        { colspan: 1, rowspan: 1, value: [{ value: '周六' }] },
        { colspan: 1, rowspan: 1, value: [{ value: '去图书馆借书' }] }
      ]
    }
  ]
}
```

表格、控件、超链接和复合对象各自有结构约束。编辑时使用公开 command，使 ID、选区、脏区和缓存失效保持一致。参见[控件配置](./control/option.md)与[执行命令](./command-execute.md)。

## 保存与恢复

`command.getValue()` 返回 `{ version, data, options }`。ready 后通过 `command.executeSetValue(saved.data)` 恢复内容，也可在创建实例时传入 saved.data。配置和字体资源由宿主管理，不应直接信任外部存储的 options。字体字节、缓存和原生几何不是可移植的文档内容。完整持久化示例见[快速上手](./start.md)。
