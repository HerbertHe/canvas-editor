# 快速上手

`@herberthe/canvas-editor` 是 Herbert He 独立维护的 [Hufe921/canvas-editor fork](./fork-and-differences.md)，当前仓库版本为 **0.1.0**。它使用 HarfBuzz 排版、Canvas 字形轮廓绘制，包格式仅 ESM。**当前默认且仅支持 Canvas 页面；SVG 页面绘制与独立 SVG 导出暂缓，没有 renderer 开关。**

可以先打开[在线体验](./playground.md)，无需安装即可试用完整编辑器。

## 运行环境与安装

开发环境使用 Node.js `>=24.13.1`。宿主需提供支持 ESM、WebAssembly、Worker 和顶层 await 的现代浏览器及构建器。以下示例使用 Vite，构建目标配置为 `esnext`。编辑器需要浏览器 DOM；SSR 项目在客户端挂载后创建实例。

```sh
npm install @herberthe/canvas-editor@0.1.0
```

此命令用于消费已发布版本；仓库中的版本号不代表 npm 发布已完成。如果 registry 尚无该版本，先在本仓库 `npm run lib`，再 `npm pack`，在宿主中安装生成的 `.tgz`。不要改为安装原 npm 包，它们是独立版本线。

```typescript
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  build: { target: 'esnext' }
})
```

不支持 UMD `<script>` 全局变量、CommonJS `require()` 和内部模块深路径导入。部署时保留完整构建目录中的相对 chunk、Worker 和 WASM 资源，通过 HTTP(S) 访问。

## 创建日常场景文档

在页面中准备容器与两个按钮：

```html
<button id="save">保存周末计划</button>
<button id="print">打印</button>
<div id="editor"></div>
```

在 Vite 的 `main.ts` 中创建编辑器：

```typescript
import Editor, { RowFlex } from '@herberthe/canvas-editor'

const container = document.querySelector<HTMLDivElement>('#editor')
if (!container) throw new Error('Missing editor container')

try {
  const editor = await Editor.create(
    container,
    {
      header: [
        { value: '家庭周末安排 · Weekend plans', rowFlex: RowFlex.CENTER }
      ],
      main: [
        { value: '周六上午：去市场购买水果和面包。', bold: true },
        { value: '\n' },
        { value: '下午：与邻居一起整理花园。Hello · مرحبا · नमस्ते · สวัสดี' },
        { value: '\n' },
        { value: '周日：图书馆借书，然后为下周准备便当。' }
      ],
      footer: [{ value: '记得带购物袋和水杯。', size: 12 }]
    },
    { autoDownloadFonts: true }
  )

  const save = () => {
    const snapshot = editor.command.getValue()
    localStorage.setItem('weekend-plan', JSON.stringify(snapshot))
  }
  const print = () => {
    void editor.command.executePrint().catch(console.error)
  }
  document.querySelector('#save')?.addEventListener('click', save)
  document.querySelector('#print')?.addEventListener('click', print)

  // 框架组件卸载时执行相同清理。Vite 热更新时也释放实例。
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      document.querySelector('#save')?.removeEventListener('click', save)
      document.querySelector('#print')?.removeEventListener('click', print)
      editor.destroy()
    })
  }
} catch (error) {
  console.error('Editor initialization failed', error)
  container.textContent = '编辑器初始化失败，请检查浏览器及字体资源。'
}
```

此例演示内容、页眉页脚、持久化和打印。完整的日常多语种、控件、表格与图片示例在仓库 `src/main.ts`，执行 `npm run dev` 查看。工具栏属于宿主集成层，安装编辑器包不会自动创建仓库 Demo 的整套菜单。

## ready 与缺字提示

`await Editor.create(...)` 等待 HarfBuzz WASM、显式字体与首次布局；返回后可执行修改和几何命令。同步 `new Editor(...)` 也可用，但必须先 `await editor.ready`。初始化期间命令不会自动排队。

**ready 不等待后台自动下载字体。** 初次看到缺字方框不一定是初始化失败。默认 `autoDownloadFonts: true` 会依据实际缺字，尝试从 `fonts.bunny.net` 获取相应文字类别的基本字体，注册成功后自动重排。网络失败、罕见字、emoji 或无对应样式时，页面状态区域和控制台仍提示补充字体。不是每个语言、地区字形和样式都保证覆盖。

通过字体报告订阅下载和缺字变化，而不是靠固定的 timeout 判断完成；报告中的空 issues 表示当前扫描未发现缺字，不保证外部图片等资源已完成。完整候选、网络与缓存语义见[字体指南](./font-and-esm-migration.md)。

## 离线使用与手动字体

系统安装字体、CSS `font-family` 和 `@font-face` 不能替代 HarfBuzz 需要的字体字节。将实际字体文件放在宿主的静态资源目录；以下路径是示例，需要自行提供文件。

```typescript
import Editor from '@herberthe/canvas-editor'

const editor = await Editor.create(container, [{ value: '周末一起去公园。' }], {
  autoDownloadFonts: false,
  defaultFont: 'Local Sans',
  fonts: [
    {
      family: 'Local Sans',
      url: `${import.meta.env.BASE_URL}fonts/LocalSans-Regular.ttf`,
      weight: 400,
      style: 'normal'
    }
  ]
})
```

关闭后不会自动下载 Bunny 字体，也不会自动注册下载缓存中的字体；仍会提醒缺字，允许上述显式 URL 和手动二进制注册。TTF/OTF/WOFF/WOFF2 均可注册。跨域资源需要 CORS，字体/WASM/Worker 需要符合宿主 CSP。字体应有适当授权，粗体与斜体应提供实际对应 face。

运行期补字体时使用 `await editor.register.fonts(...)`，不要只修改配置数组：

```typescript
const results = await editor.register.fonts([
  { family: 'Local Sans', data: await file.arrayBuffer(), weight: 400 }
])
for (const result of results) {
  if (result.status === 'failed') console.warn(result.failure)
}
console.log(editor.getFontCoverageReport())
```

这里的 `file` 来自宿主文件选择器。注册结果逐项返回，成功注册不等于文件覆盖了文档中的全部字符。

## 保存、恢复与导出

```typescript
// snapshot: { version, data: { header, main, footer, ... }, options }
const snapshot = editor.command.getValue()
const raw = localStorage.getItem('weekend-plan')
if (raw) {
  const saved = JSON.parse(raw) // 生产代码需校验数据结构并处理解析错误
  editor.command.executeSetValue(saved.data)
}

const pngPages: string[] = await editor.command.getImage()
```

恢复正文传 `saved.data`，不是把完整结果当成正文数组。生产环境应校验外部 JSON；不要自动信任已保存的 options，其中可能存在旧引擎配置或不适用的资源 URL。需要重建实例时由宿主管理配置和字体资源。序列化结果不替代随应用分发的字体文件。

`getImage()` 返回 Canvas 页面 PNG；打印也基于页面图片，不提供独立 SVG 或原生矢量 PDF。若需稳定分页和导出，在初始化时显式提供所有必要字体，并管理图片加载，避免后台补字体改变布局。详见[查询 API](./command-get.md)。

## 框架挂载与销毁

Vue/React 等框架需在 DOM 挂载后创建实例。异步 create 可能在组件已卸载后才返回：保留取消标记，若返回时已卸载，立即 destroy；不要将实例写回已失效组件。卸载时取消自己的 EventBus 订阅、释放事件处理器和工具栏，然后 `editor.destroy()`。同步构造方式还需捕获 ready 拒绝并清理失败实例。

## 本地开发与下一步

```sh
npm install
npm run dev
npm run docs:dev
npm run docs:build
```

CI 使用 pnpm 10.32.1 与已提交的 `pnpm-lock.yaml` 做冻结安装。本地也可用 `pnpm install --frozen-lockfile`。不要混用包管理器并提交额外 lockfile。

- [渲染管线与时序](./rendering-pipeline.md)：文字整形、分页、交互与导出。
- [实例 API](./api-instance.md)、[配置](./option.md)、[命令](./command-execute.md)：接入细节。
- [项目关系与差异](./fork-and-differences.md)：上游基线、兼容与许可证。
- [常见问题](./faq.md)：缺字、初始化、布局和路径排查。
