import { defineConfig } from 'vitepress'

function sidebar(prefix = '', english = false) {
  const item = (text: string, path: string) => ({
    text,
    link: `${prefix}/guide/${path}`
  })
  return [
    {
      text: english ? 'Get started' : '快速上手',
      items: [
        item(english ? 'Online playground' : '在线体验', 'playground'),
        item(
          english ? 'Installation and first document' : '安装与第一个文档',
          'start'
        ),
        item(
          english ? 'Fonts, readiness and migration' : '字体、初始化与迁移',
          'font-and-esm-migration'
        ),
        item(english ? 'Supported features' : '能力与支持边界', 'features'),
        item(english ? 'Troubleshooting' : '常见问题', 'faq')
      ]
    },
    {
      text: english ? 'Rendering internals' : '渲染原理',
      items: [
        item(english ? 'Architecture' : '架构与模块职责', 'architecture'),
        item(
          english ? 'Rendering pipeline' : '渲染管线与时序',
          'rendering-pipeline'
        ),
        item(english ? 'Document model' : '文档数据结构', 'schema'),
        item(
          english ? 'Experimental configuration' : '实验配置与增量边界',
          'lab'
        )
      ]
    },
    {
      text: english ? 'API reference' : 'API 参考',
      items: [
        item(english ? 'Options' : '编辑器配置', 'option'),
        item(
          english ? 'Editor lifecycle and fonts' : '实例、生命周期与字体',
          'api-instance'
        ),
        item(english ? 'Mutation commands' : '执行命令', 'command-execute'),
        item(english ? 'Query commands' : '查询与导出', 'command-get'),
        item(english ? 'Common utilities' : '通用工具', 'api-common'),
        item('EventBus', 'eventbus'),
        item('Listener', 'listener'),
        item(english ? 'Localization' : '国际化', 'i18n')
      ]
    },
    {
      text: english ? 'Form controls' : '表单控件',
      items: [
        item(english ? 'Configuration' : '控件配置', 'control/option'),
        item(english ? 'Commands' : '控件命令', 'control/command'),
        item(english ? 'Cascades' : '级联表达式', 'control/cascade'),
        item(english ? 'Validation' : '校验', 'control/validate')
      ]
    },
    {
      text: english ? 'Extension' : '扩展集成',
      collapsed: true,
      items: [
        item(
          english ? 'Built-in shortcuts' : '内置快捷键',
          'shortcut-internal'
        ),
        item(english ? 'Custom shortcuts' : '自定义快捷键', 'shortcut-custom'),
        item(
          english ? 'Built-in context menu' : '内置右键菜单',
          'contextmenu-internal'
        ),
        item(
          english ? 'Custom context menu' : '自定义右键菜单',
          'contextmenu-custom'
        ),
        item(english ? 'Plugins' : '插件接入', 'plugin-custom'),
        item(english ? 'Overrides' : '重写方法', 'override'),
        item(english ? 'Macros' : '宏', 'macro'),
        item('DevTools', 'devtools')
      ]
    },
    {
      text: english ? 'Project' : '项目与维护',
      items: [
        item(
          english ? 'Origin and upstream differences' : '项目来源与上游差异',
          'fork-and-differences'
        ),
        item(
          english ? 'GitHub Pages deployment' : '文档站部署',
          'docs-deployment'
        ),
        item(
          english ? 'Engineering records' : '验收与历史记录',
          'engineering-records'
        )
      ]
    }
  ]
}

export default defineConfig({
  base: process.env.DOCS_BASE || '/canvas-editor/',
  title: '@herberthe/canvas-editor',
  description: 'HarfBuzz-only typography and Canvas document rendering',
  lastUpdated: true,
  markdown: {
    config(md) {
      const fence = md.renderer.rules.fence!
      md.renderer.rules.fence = (tokens, index, options, env, self) => {
        if (tokens[index].info.trim() === 'mermaid') {
          const code = md.utils.escapeHtml(
            JSON.stringify(tokens[index].content)
          )
          return `<MermaidDiagram :code="${code}" />`
        }
        return fence(tokens, index, options, env, self)
      }
    }
  },
  themeConfig: {
    i18nRouting: false,
    logo: '/favicon.png',
    outline: { level: [2, 3], label: '本页目录' },
    search: { provider: 'local' },
    nav: [
      { text: '在线体验', link: '/guide/playground' },
      { text: '快速上手', link: '/guide/start' },
      { text: '渲染管线', link: '/guide/rendering-pipeline' },
      { text: '项目关系', link: '/guide/fork-and-differences' },
      { text: '文档部署', link: '/guide/docs-deployment' }
    ],
    sidebar: sidebar(),
    socialLinks: [
      { icon: 'github', link: 'https://github.com/HerbertHe/canvas-editor' }
    ],
    editLink: {
      pattern:
        'https://github.com/HerbertHe/canvas-editor/edit/main/docs/:path',
      text: '在 GitHub 编辑本页'
    },
    footer: {
      message: 'MIT · Independent fork of Hufe921/canvas-editor · Canvas-only',
      copyright:
        'Fork modifications © 2026-present Herbert He · Original © 2021-present hufe'
    }
  },
  locales: {
    root: { label: '简体中文', lang: 'zh-CN' },
    en: {
      label: 'English',
      lang: 'en',
      link: '/en/',
      themeConfig: {
        outline: { level: [2, 3], label: 'On this page' },
        nav: [
          { text: 'Playground', link: '/en/guide/playground' },
          { text: 'Get started', link: '/en/guide/start' },
          { text: 'Rendering pipeline', link: '/en/guide/rendering-pipeline' },
          { text: 'Project origin', link: '/en/guide/fork-and-differences' },
          { text: 'Deploy docs', link: '/en/guide/docs-deployment' }
        ],
        sidebar: sidebar('/en', true),
        editLink: {
          pattern:
            'https://github.com/HerbertHe/canvas-editor/edit/main/docs/:path',
          text: 'Edit this page on GitHub'
        }
      }
    }
  }
})
