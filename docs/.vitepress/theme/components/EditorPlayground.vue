<template>
  <section
    class="editor-playground"
    :aria-label="english ? 'Online editor' : '编辑器在线体验'"
  >
    <div class="playground-actions">
      <a :href="url" target="_blank" rel="noopener noreferrer">
        {{ english ? 'Open in a separate window ↗' : '独立窗口打开 ↗' }}
      </a>
      <button type="button" @click="generation++">
        {{ english ? 'Reset demo' : '重置示例' }}
      </button>
    </div>
    <iframe
      :key="generation"
      :src="url"
      :title="
        english ? 'Canvas Editor interactive demo' : 'Canvas Editor 交互示例'
      "
      loading="lazy"
      allow="fullscreen"
      allowfullscreen
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData, withBase } from 'vitepress'

const { lang } = useData()
const english = computed(() => lang.value.startsWith('en'))
const url = withBase('/playground/')
const generation = ref(0)
</script>

<style scoped>
.editor-playground {
  margin: 24px 0;
}
.playground-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 20px;
  margin-bottom: 16px;
}
.playground-actions a {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.playground-actions button {
  padding: 6px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  cursor: pointer;
}
.playground-actions button:hover {
  border-color: var(--vp-c-brand-1);
}
iframe {
  display: block;
  width: 100%;
  height: 820px;
  scroll-margin-top: 80px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: #f2f4f7;
  color-scheme: light;
}
</style>
