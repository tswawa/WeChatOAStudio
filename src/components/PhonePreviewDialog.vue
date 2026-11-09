<!-- 手机预览：按微信文章页样式渲染草稿，查看排版效果 -->
<script setup>
import { computed } from 'vue'
import DeskDialog from './DeskDialog.vue'
import ArticleRender from './ArticleRender.vue'
import { ui, closePreview } from '../store/ui.js'
import { ws } from '../store/workspace.js'

const draft = computed(() => ui.preview && (ui.preview.draft
  || ws.value.drafts.find((item) => item.id === ui.preview.draftId)))
</script>

<template>
  <DeskDialog
    v-if="draft"
    title="手机预览"
    :width="440"
    @close="closePreview"
  >
    <div class="phone">
      <ArticleRender :draft="draft" />
    </div>
  </DeskDialog>
</template>

<style scoped>
.phone {
  height: 620px;
  overflow-y: auto;
  border: 8px solid #1f1f1f;
  border-radius: 28px;
  background: #fff;
}
</style>
