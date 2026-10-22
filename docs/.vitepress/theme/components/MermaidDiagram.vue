<template>
  <figure class="mermaid-diagram" :data-state="state">
    <div v-if="svg" role="img" :aria-label="label" v-html="svg" />
    <p v-else-if="state === 'failed'" role="alert">{{ error }}</p>
    <p v-else class="diagram-loading">{{ loading }}</p>
    <details>
      <summary>{{ sourceLabel }}</summary>
      <pre>{{ code }}</pre>
    </details>
  </figure>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'

const props = defineProps<{ code: string }>()
const { isDark, lang } = useData()
const svg = ref('')
const error = ref('')
const state = ref('loading')
const english = computed(() => lang.value.startsWith('en'))
const label = computed(() =>
  english.value ? 'Rendering architecture diagram' : '渲染架构图'
)
const loading = computed(() =>
  english.value ? 'Loading diagram…' : '正在加载图表…'
)
const sourceLabel = computed(() =>
  english.value ? 'Diagram source' : '查看图表源码'
)
let generation = 0
let active = true
async function renderDiagram() {
  const current = ++generation
  state.value = 'loading'
  try {
    const { default: mermaid } = await import('mermaid')
    if (!active || current !== generation) return
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark.value ? 'dark' : 'default',
      flowchart: { htmlLabels: false }
    })
    const id = `diagram-${globalThis.crypto.randomUUID()}`
    const result = await mermaid.render(id, props.code)
    if (!active || current !== generation) return
    svg.value = result.svg
    state.value = 'ready'
  } catch (cause) {
    if (!active || current !== generation) return
    error.value = String(cause)
    state.value = 'failed'
  }
}
onMounted(renderDiagram)
watch([() => props.code, isDark], renderDiagram)
onBeforeUnmount(() => {
  active = false
  generation++
})
</script>

<style scoped>
.mermaid-diagram {
  margin: 24px 0;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow-x: auto;
}
.mermaid-diagram :deep(svg) {
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
.mermaid-diagram pre {
  white-space: pre;
  font-size: 12px;
  overflow-x: auto;
}
.mermaid-diagram summary,
.diagram-loading {
  color: var(--vp-c-text-2);
  font-size: 13px;
}

@media (max-width: 640px) {
  .mermaid-diagram :deep(svg) {
    min-width: 560px;
  }
}
</style>
