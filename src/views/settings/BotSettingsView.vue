<!-- Bot 设置页：模型、Bot 规则与长期记忆；模型与规则一次保存，离开前提示未保存修改。 -->
<script setup>
import { computed, reactive, ref, onMounted } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { ArrowLeft, Cpu, LoaderCircle, Bot, Brain } from 'lucide-vue-next'
import ModelSettingsFields from './ModelSettingsFields.vue'
import BotProfileFields from './BotProfileFields.vue'
import BotMemoryPanel from './BotMemoryPanel.vue'
import { settings, loadSettings, saveSettings } from '../../store/settings.js'
import { invokeAction } from '../../services/workspace.js'
import { confirmAction } from '../../store/ui.js'
import { isDesktop } from '../../services/desktop.js'

const router = useRouter()
const tabs = [
  { id: 'model', label: '模型服务', icon: Cpu },
  { id: 'profile', label: 'Bot', icon: Bot },
  { id: 'memory', label: '长期记忆', icon: Brain },
]
const active = ref('model')
const form = reactive(JSON.parse(JSON.stringify(settings)))
const loading = ref(true)
const action = ref('')
const feedback = ref('')
const failed = ref(false)
const loadFailed = ref(false)
const saved = ref('')
const editable = (value) => JSON.stringify({
  model: { ...value.model, apiKey: value.model.apiKey || '' }, bot: value.bot, images: value.images, search: value.search,
})
const dirty = computed(() => !loading.value && saved.value && editable(form) !== saved.value)
const configured = computed(() => Boolean(settings.model.name && settings.model.apiKeyConfigured))

function updateForm() {
  Object.assign(form, JSON.parse(JSON.stringify(settings)))
  form.model.apiKey = ''
  saved.value = editable(form)
}

function showFailure(error, message) {
  failed.value = true
  feedback.value = error.message || message
  console.error(message, error)
}

async function readSettings() {
  loading.value = true
  feedback.value = ''
  loadFailed.value = false
  try {
    await loadSettings()
    updateForm()
  } catch (error) {
    loadFailed.value = true
    showFailure(error, '读取 Bot 设置失败')
  } finally {
    loading.value = false
  }
}

async function run(name, operation) {
  if (action.value || loading.value) return
  action.value = name
  failed.value = false
  feedback.value = ''
  try {
    await operation()
  } catch (error) {
    showFailure(error, name === 'test' ? '测试模型连接失败' : '保存 Bot 设置失败')
  } finally {
    action.value = ''
  }
}

function save() {
  return run('save', async () => {
    await saveSettings({ model: form.model, bot: form.bot, images: form.images, search: form.search })
    updateForm()
    feedback.value = '已保存'
  })
}

function testConnection() {
  return run('test', async () => {
    const response = await invokeAction('settings.test', { model: form.model })
    feedback.value = response.message || '连接成功'
  })
}

onMounted(readSettings)
onBeforeRouteLeave(async () => !dirty.value || confirmAction({
  title: '放弃未保存的修改？', message: '模型或 Bot 设置有修改尚未保存。', confirmText: '放弃修改',
}))
</script>

<template>
  <div class="page bot-settings-page">
    <div class="page-head settings-heading">
      <button type="button" class="back-button" title="返回 Bot" aria-label="返回 Bot"
        :disabled="Boolean(action)" @click="router.push('/bot')"><ArrowLeft :size="20" /></button>
      <h1 class="page-title">Bot 设置</h1>
    </div>
    <section class="card settings-panel" :aria-busy="loading || Boolean(action)">
      <div class="settings-tabs" role="tablist" aria-label="Bot 设置分组">
        <button
          v-for="tab in tabs"
          :id="'settings-tab-' + tab.id"
          :key="tab.id"
          type="button"
          role="tab"
          class="settings-tab"
          :class="{ active: active === tab.id }"
          :aria-selected="active === tab.id"
          :aria-controls="'settings-panel-' + tab.id"
          :disabled="loading || Boolean(action)"
          @click="active = tab.id; feedback = ''"
        >
          <component :is="tab.icon" :size="16" />
          {{ tab.label }}
          <span v-if="tab.id === 'model' && !loading && !configured" class="tab-dot" title="尚未配置" />
        </button>
      </div>
      <div
        :id="'settings-panel-' + active"
        class="settings-content"
        role="tabpanel"
        :aria-labelledby="'settings-tab-' + active"
      >
        <ModelSettingsFields
          v-if="active === 'model'"
          :form="form.model"
          :disabled="loading || Boolean(action) || loadFailed"
        />
        <BotProfileFields
          v-else-if="active === 'profile'"
          :form="form.bot"
          :images="form.images"
          :search="form.search"
          :disabled="loading || Boolean(action) || loadFailed"
        />
        <BotMemoryPanel v-else />
      </div>
      <div v-if="['model', 'profile'].includes(active)" class="settings-actions">
        <span class="feedback" :class="{ error: failed }" role="status">
          {{ loading ? '正在读取设置…' : feedback || (dirty ? '有未保存的修改' : '') }}
        </span>
        <button
          v-if="loadFailed"
          class="weui-btn weui-btn_mini weui-btn_default"
          :disabled="loading"
          @click="readSettings"
        >重新读取</button>
        <template v-else>
          <button
            v-if="isDesktop && active === 'model'"
            class="weui-btn weui-btn_mini weui-btn_default"
            :disabled="loading || Boolean(action)"
            @click="testConnection"
          >
            <LoaderCircle v-if="action === 'test'" :size="14" class="spinning" />
            {{ action === 'test' ? '正在测试…' : '测试连接' }}
          </button>
          <button
            class="weui-btn weui-btn_mini weui-btn_primary"
            :disabled="loading || Boolean(action) || !dirty"
            @click="save"
          >
            <LoaderCircle v-if="action === 'save'" :size="14" class="spinning" />
            {{ action === 'save' ? '正在保存…' : '保存' }}
          </button>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.bot-settings-page {
  max-width: 920px;
}

.settings-heading { justify-content: flex-start; gap: 12px; }
.back-button { display: grid; place-items: center; flex: none; width: 36px; height: 36px; padding: 0; border: 1px solid var(--border); border-radius: 4px; background: #fff; color: var(--text-1); cursor: pointer; }
.back-button:hover { background: var(--bg-hover); }
.back-button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.back-button:disabled { opacity: 0.5; cursor: default; }

.settings-panel {
  padding: 0;
  overflow: hidden;
}

.settings-tabs {
  display: flex;
  gap: 24px;
  padding: 0 28px;
  border-bottom: 1px solid var(--border-light);
  overflow-x: auto;
  white-space: nowrap;
}

.settings-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 56px;
  padding: 0;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--text-2);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.settings-tab.active {
  border-bottom-color: var(--brand);
  color: var(--brand);
}

.settings-content {
  padding: 30px 28px;
}

.settings-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 20px 28px;
  border-top: 1px solid var(--border-light);
}

.settings-actions .weui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.feedback {
  flex: 1;
  min-width: 120px;
  color: var(--text-2);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.feedback.error {
  color: var(--danger);
}

.tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger);
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
