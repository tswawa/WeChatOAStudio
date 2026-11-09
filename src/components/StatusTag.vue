<!-- 状态标签：success / warning / danger / info / muted 五种色调 -->
<script setup>
defineProps({
  tone: { type: String, default: 'muted' },
})
</script>

<template>
  <span
    class="tag"
    :class="'tag-' + tone"
  ><slot /></span>
</template>

<style scoped>
.tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}

.tag-success {
  color: var(--brand);
  background: var(--brand-light);
}

.tag-warning {
  color: #d4790b;
  background: var(--warning-light);
}

.tag-danger {
  color: var(--danger);
  background: var(--danger-light);
}

.tag-info {
  color: var(--info);
  background: var(--info-light);
}

.tag-muted {
  color: var(--text-2);
  background: #f2f2f4;
}
</style>
