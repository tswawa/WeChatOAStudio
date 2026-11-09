<!-- 图文编辑页：沿用公众平台编辑器布局（插入工具栏、排版工具栏、标题作者正文、底部保存/预览/发表），右侧实时手机预览；
     改稿交给运营助手。视频、小程序、投票等公众平台组件在官方编辑器里插入 -->
<script setup>
import { ref } from 'vue'
import { ChevronLeft, Bot, SquareArrowOutUpRight } from 'lucide-vue-next'
import FormatToolbar from './FormatToolbar.vue'
import { useRichText } from './useRichText.js'
import EditorMetadata from './EditorMetadata.vue'
import EditorImageGallery from './EditorImageGallery.vue'
import ArticleRender from '../../components/ArticleRender.vue'
import { currentAccount } from '../../store/session.js'
import { fmtTime } from '../../utils/time.js'
import { useArticleEditor } from './useArticleEditor.js'

const {
  router, draft, savedAt, bodyRef, fileInput, busy, loading, error, wordCount,
  onInsert, onInput, save, preview, publish, handToAssistant, chooseImage, selectImage,
  isImagePost, loadDraft, changed,
} = useArticleEditor()

const rich = useRichText(bodyRef, onInput)
const toolbar = ref(null)
// 图片、超链接在这里直接插入；其余是公众平台自己的组件，保存后在官方编辑器里插入
const LOCAL_INSERTS = ['图片', '超链接']
const INSERTS = ['图片', '超链接', '视频', '音频', '小程序', '模板', '投票', '搜索', '地理位置', '视频号', '账号名片', '问答']

function insert(item) {
  if (item === '超链接') toolbar.value?.openLink()
  else onInsert(item)
}

</script>

<template>
  <div class="editor">
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      hidden
      @change="selectImage"
    >
    <header class="ed-head">
      <a
        class="back"
        @click="router.back()"
      >
        <ChevronLeft class="icon-16" />返回
      </a>
      <span class="ed-account">{{ currentAccount.name }}</span>
      <div class="inserts">
        <button
          v-for="item in INSERTS"
          :key="item"
          class="insert"
          :title="LOCAL_INSERTS.includes(item) ? '' : '保存后在公众平台编辑器中插入'"
          @mousedown.prevent
          @click="insert(item)"
        >
          {{ item }}<SquareArrowOutUpRight v-if="!LOCAL_INSERTS.includes(item)" :size="11" class="out" />
        </button>
      </div>
    </header>
    <FormatToolbar
      v-if="!isImagePost"
      ref="toolbar"
      :rich="rich"
      :disabled="loading || busy"
    />

    <div class="ed-body">
      <main class="ed-main">
        <p v-if="loading">正在读取草稿…</p>
        <p
          v-if="error"
          class="text-danger"
          role="alert"
        >{{ error }}</p>
        <button
          v-if="error && !loading"
          class="weui-btn weui-btn_mini weui-btn_default"
          :disabled="busy"
          @click="loadDraft()"
        >重新读取</button>
        <div class="paper">
          <input
            v-model="draft.title"
            class="ed-title"
            maxlength="64"
            placeholder="请在这里输入标题"
            :disabled="loading || busy"
            @input="changed"
          >
          <input
            v-model="draft.author"
            class="ed-author"
            placeholder="请输入作者"
            :disabled="loading || busy"
            @input="changed"
          >
          <EditorImageGallery
            v-if="isImagePost"
            :draft="draft"
            :disabled="busy || loading"
            @add="chooseImage('gallery')"
            @change="changed"
          />
          <div
            ref="bodyRef"
            class="ed-content"
            :contenteditable="!loading && !busy"
            data-placeholder="从这里开始写正文"
            @input="onInput"
            @mouseup="rich.onMouseUp"
          />
          <EditorMetadata
            :draft="draft"
            :disabled="busy || loading"
            @choose-cover="chooseImage('cover')"
            @change="changed"
          />
        </div>
      </main>
      <aside class="ed-preview">
        <p class="faint ed-preview-title">
          手机预览
        </p>
        <div class="phone">
          <ArticleRender :draft="draft" />
        </div>
      </aside>
    </div>

    <footer class="ed-foot">
      <span class="faint">
        {{ savedAt ? fmtTime(savedAt) + ' 已保存' : '尚未保存' }} · 正文字数 {{ wordCount }}
      </span>
      <div class="row-actions">
        <button
          class="weui-btn weui-btn_mini weui-btn_default ed-assist"
          :disabled="busy || loading"
          @click="handToAssistant"
        >
          <Bot class="icon-16" />交给 Bot
        </button>
        <button
          class="weui-btn weui-btn_mini weui-btn_default"
          @click="save"
          :disabled="busy || loading"
        >
          保存为草稿
        </button>
        <button
          class="weui-btn weui-btn_mini weui-btn_default"
          @click="preview"
          :disabled="busy || loading"
        >
          预览
        </button>
        <button
          class="weui-btn weui-btn_mini weui-btn_primary"
          @click="publish"
          :disabled="busy || loading"
        >
          发表
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-page);
}

.ed-head {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 52px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
  background: #fff;
  flex: none;
}

.back {
  display: inline-flex;
  align-items: center;
  color: var(--text-2);
}

.ed-account {
  font-weight: 600;
}

.inserts {
  display: flex;
  gap: 4px;
  margin-left: 24px;
  overflow-x: auto;
}

.insert {
  padding: 4px 10px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text-1);
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}

.insert:hover {
  background: var(--bg-hover);
}

.insert .out {
  margin-left: 2px;
  color: var(--text-3);
  vertical-align: 1px;
}

.ed-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.ed-main {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.paper {
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 56px;
  background: #fff;
}

.ed-title {
  width: 100%;
  border: 0;
  outline: 0;
  font: inherit;
  font-size: 24px;
  font-weight: 600;
}

.ed-author {
  width: 100%;
  margin: 12px 0 20px;
  padding-bottom: 16px;
  border: 0;
  border-bottom: 1px solid var(--border-light);
  outline: 0;
  font: inherit;
  color: var(--text-2);
}

.ed-content {
  min-height: 360px;
  outline: 0;
}

.ed-content:empty::before {
  content: attr(data-placeholder);
  color: var(--text-3);
}

.ed-preview {
  display: flex;
  flex-direction: column;
  width: 360px;
  flex: none;
  padding: 16px;
  border-left: 1px solid var(--border);
  background: #fff;
}

.ed-preview-title {
  margin-bottom: 8px;
  font-size: 12px;
}

.phone {
  flex: 1;
  overflow-y: auto;
  border: 6px solid #1f1f1f;
  border-radius: 24px;
}

.ed-assist {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ed-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 24px;
  border-top: 1px solid var(--border);
  background: #fff;
  flex: none;
}
</style>
