<!-- 自动回复：关键词回复、收到消息回复、被关注回复三类，与公众平台一致；开关切换即生效，回复内容在各自区域保存 -->
<script setup>
import { computed, ref, reactive, watch } from 'vue'
import StatusTag from '../../components/StatusTag.vue'
import { ws, executeAction } from '../../store/workspace.js'
import { toast } from '../../store/ui.js'
import { uid } from '../../utils/time.js'
import { isDesktop } from '../../services/desktop.js'

const tab = ref('keyword')
const adding = ref(false)
const form = reactive({ keyword: '', match: '半匹配', reply: '' })
const replyDraft = reactive(JSON.parse(JSON.stringify(ws.value.autoReply)))
const busy = ref(false)

// 后台同步或切换开关后刷新线上数据，但保留尚未保存的回复文字，不覆盖正在编辑的内容
watch(() => ws.value.autoReply, (value, previous) => {
  const next = JSON.parse(JSON.stringify(value))
  for (const key of ['follow', 'fallback']) {
    if ((replyDraft[key] ?? '') !== (previous?.[key] ?? '')) next[key] = replyDraft[key]
  }
  Object.assign(replyDraft, next)
})

// 公众平台每类回复都有独立开关，内容已保存但开关关闭时不会回复
const SWITCH = { keyword: 'keywordOpen', fallback: 'fallbackOpen', follow: 'followOpen' }
const switchKey = computed(() => SWITCH[tab.value])
const switchReadable = computed(() => !isDesktop || typeof ws.value.autoReply?.[switchKey.value] === 'boolean')
// 当前分页的回复文字是否有未保存修改（关键词规则在添加/删除时即保存）
const textDirty = computed(() => tab.value !== 'keyword'
  && (replyDraft[tab.value] ?? '') !== (ws.value.autoReply?.[tab.value] ?? ''))

const TABS = [
  { key: 'keyword', label: '关键词回复' },
  { key: 'fallback', label: '收到消息回复' },
  { key: 'follow', label: '被关注回复' },
]

async function saveRules(value = replyDraft, message = '已保存') {
  if (busy.value) return false
  busy.value = true
  try {
    if (isDesktop) await executeAction('interaction.saveAutoReply', value)
    else ws.value.autoReply = JSON.parse(JSON.stringify(value))
    toast(message)
    return true
  } catch (error) {
    toast(error.message, 'warn')
    console.error('保存自动回复失败：', error)
    return false
  } finally {
    busy.value = false
  }
}

// 与公众平台一致：开关切换即提交，失败时恢复原状态
async function toggle(event) {
  const key = switchKey.value
  const open = event.target.checked
  if (!await saveRules({ [`${key}`]: open }, open ? '已开启' : '已关闭')) {
    replyDraft[key] = !open
    event.target.checked = !open
  }
}

function saveText() {
  return saveRules({ [tab.value]: replyDraft[tab.value] })
}

async function addRule() {
  const value = JSON.parse(JSON.stringify(replyDraft))
  value.keywords.push({ id: uid('k'), ...form })
  if (!await saveRules(value)) return
  Object.assign(form, { keyword: '', match: '半匹配', reply: '' })
  adding.value = false
  toast('已添加')
}

async function removeRule(rule) {
  const value = JSON.parse(JSON.stringify(replyDraft))
  value.keywords = value.keywords.filter((item) => item.id !== rule.id)
  await saveRules(value)
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">
          自动回复
        </h1>
      </div>
    </div>

    <div class="card">
      <div class="tabs">
        <button
          v-for="item in TABS"
          :key="item.key"
          :class="{ on: tab === item.key }"
          @click="tab = item.key"
        >
          {{ item.label }}
          <span v-if="ws.autoReply?.[SWITCH[item.key]] === false" class="off-tag">未开启</span>
        </button>
      </div>

      <label v-if="switchReadable" class="switch-row">
        <input
          v-model="replyDraft[switchKey]"
          type="checkbox"
          class="weui-switch"
          :disabled="busy"
          @change="toggle"
        >
        <span>{{ replyDraft[switchKey] ? '已开启' : '未开启，用户不会收到这类回复' }}</span>
        <span v-if="tab === 'fallback' && replyDraft.aiOpen" class="muted">当前开启的是微信 AI 回复，开启固定回复后 AI 回复会关闭</span>
      </label>
      <p v-else class="muted switch-row">同步数据后显示开启状态</p>

      <template v-if="tab === 'keyword'">
        <table class="table">
          <thead>
            <tr>
              <th>关键词</th>
              <th>匹配方式</th>
              <th>回复内容</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="rule in replyDraft.keywords"
              :key="rule.id"
            >
              <td>{{ rule.keyword }}</td>
              <td>
                <StatusTag tone="muted">
                  {{ rule.match }}
                </StatusTag>
              </td>
              <td class="muted">
                {{ rule.readonly ? '含非文字素材，请在公众平台编辑' : rule.reply }}
              </td>
              <td class="op">
                <a
                  class="text-danger"
                  v-if="!rule.readonly"
                  @click="removeRule(rule)"
                >删除</a>
              </td>
            </tr>
          </tbody>
        </table>
        <div
          v-if="adding"
          class="add-form"
        >
          <input
            v-model="form.keyword"
            placeholder="关键词"
          >
          <select v-model="form.match">
            <option>半匹配</option>
            <option>全匹配</option>
          </select>
          <input
            v-model="form.reply"
            class="wide"
            placeholder="回复内容"
          >
          <button
            class="weui-btn weui-btn_mini weui-btn_default"
            @click="adding = false"
          >
            取消
          </button>
          <button
            class="weui-btn weui-btn_mini weui-btn_primary"
            :disabled="!form.keyword || !form.reply"
            @click="addRule"
          >
            保存
          </button>
        </div>
        <button
          v-else
          class="weui-btn weui-btn_mini weui-btn_default weui-btn_outline add-btn"
          @click="adding = true"
        >
          添加回复
        </button>
      </template>

      <label
        v-else
        class="single"
      >
        <span class="muted">{{ tab === 'follow' ? '用户关注公众号后自动回复：' : '没有命中关键词时回复：' }}</span>
        <textarea
          v-model="replyDraft[tab]"
          maxlength="600"
          :disabled="replyDraft[tab + 'Readonly']"
          rows="4"
        />
        <span v-if="replyDraft[tab + 'Readonly']">{{ tab === 'fallback' && replyDraft.aiOpen ? '当前由微信 AI 回复接管，打开上方开关改用固定回复后可编辑。' : '这条回复包含非文字素材，请在公众平台编辑。' }}</span>
        <div v-else class="single-actions">
          <span class="faint">{{ (replyDraft[tab] || '').length }}/600</span>
          <button
            class="weui-btn weui-btn_mini weui-btn_primary"
            :disabled="busy || !textDirty"
            @click.prevent="saveText"
          >保存</button>
        </div>
      </label>
    </div>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-light);
}

.tabs button {
  padding: 0 0 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  font: inherit;
  color: var(--text-2);
  cursor: pointer;
}

.tabs button.on {
  color: var(--brand);
  border-bottom-color: var(--brand);
}

.off-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--warning-light);
  color: #b35c00;
  font-size: 12px;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  font-size: 13px;
}

.op {
  text-align: right;
}

.add-form {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

.add-form input,
.add-form select {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
}

.add-form .wide {
  flex: 1;
}

.add-btn {
  margin-top: 16px;
}

.single {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.single-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.single-actions .weui-btn {
  width: auto;
  margin: 0;
}

.single textarea {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  resize: vertical;
}
</style>
