/// <reference types="vitepress/client" />
import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import MermaidDiagram from './components/MermaidDiagram.vue'
import EditorPlayground from './components/EditorPlayground.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('MermaidDiagram', MermaidDiagram)
    app.component('EditorPlayground', EditorPlayground)
  }
} satisfies Theme
