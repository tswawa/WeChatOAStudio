<!-- Render model answers as sanitized Markdown, including tables and code. -->
<script setup>
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { toast } from '../../store/ui.js'

const props = defineProps({ text: { type: String, default: '' } })
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true })
const html = computed(() => DOMPurify.sanitize(markdown.render(props.text)))
async function openLink(event) {
  const anchor = event.target.closest('a[href]')
  if (!anchor) return
  event.preventDefault()
  try {
    if (window.mpDesktop?.openUrl) await window.mpDesktop.openUrl(anchor.href)
    else window.open(anchor.href, '_blank', 'noopener,noreferrer')
  } catch (error) {
    toast(error.message, 'warn')
  }
}
</script>

<template>
  <div class="bot-answer" @click="openLink" v-html="html" />
</template>

<style scoped>
.bot-answer {
  min-width: 0;
  line-height: 1.85;
  overflow-wrap: anywhere;
}
.bot-answer :deep(p) {
  margin: 0 0 12px;
}
.bot-answer :deep(p:last-child) {
  margin-bottom: 0;
}
.bot-answer :deep(h1),
.bot-answer :deep(h2),
.bot-answer :deep(h3) {
  margin: 18px 0 10px;
  font-size: 18px;
}
.bot-answer :deep(pre) {
  max-width: 100%;
  overflow: auto;
  margin: 12px 0;
  padding: 14px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  background: #f5f7f6;
  line-height: 1.6;
}
.bot-answer :deep(code) {
  font-size: 13px;
}
.bot-answer :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}
.bot-answer :deep(td),
.bot-answer :deep(th) {
  padding: 7px 10px;
  border: 1px solid var(--border);
  text-align: left;
}
.bot-answer :deep(ul),
.bot-answer :deep(ol) {
  padding-left: 24px;
}
.bot-answer :deep(blockquote) {
  margin: 12px 0;
  padding-left: 14px;
  border-left: 3px solid var(--border);
  color: var(--text-2);
}
</style>
