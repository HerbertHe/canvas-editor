# 自定义插件

::: warning 兼容性暂未验证
本分支暂未测试上游插件的兼容性，包括 Word 和 Excel 插件。接入前请在实际项目中验证异步初始化、字体注册和插件使用的 API。 [上游插件文档](https://hufe.club/canvas-editor-plugin)
:::

## 开发插件

```javascript
export function myPlugin(editor: Editor, options?: Option) {
  // 1. 修改方法，详见：src/plugins/copy
  editor.command.updateFunction = () => {}

  // 2. 增加方法，详见：src/plugins/markdown
  editor.command.addFunction = () => {}

  // 3. 事件监听、快捷键、右键菜单、重写方法等组合处理
}
```

## 使用插件

```javascript
instance.use(myPlugin, options?: Option)
```
