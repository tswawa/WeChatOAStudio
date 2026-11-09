<!-- 自定义菜单：左侧手机预览，右侧编辑；最多 3 个一级菜单，每个最多 5 个子菜单。编辑内容在发布成功前一直保留 -->
<script setup>
import { ref, computed, watch } from 'vue'
import { ws, executeAction } from '../../store/workspace.js'
import { toast } from '../../store/ui.js'
import { isDesktop } from '../../services/desktop.js'
import { currentAccount } from '../../store/session.js'
import MenuTargetField from './MenuTargetField.vue'
import MenuPhonePreview from './MenuPhonePreview.vue'

const activeIndex = ref(0)
const busy = ref(false)
const normalize = (items) => (items || []).map((item) => ({
  type: 'view', url: '', content: '', ...item,
  subs: (item.subs || item.sub_button || []).map((sub) => ({
    type: 'view', url: '', content: '', ...(typeof sub === 'string' ? { name: sub } : sub),
  })),
}))
const editable = (items) => JSON.stringify(normalize(items).map(({ name, type, url, content, subs }) => ({
  name, type, url, content, subs: subs.map(({ name: n, type: t, url: u, content: c }) => ({ n, t, u, c })),
})))
const menus = ref(normalize(ws.value.menu))
// base：当前线上菜单（含刚发布成功的内容），编辑内容与它不同即为未发布的修改；seen：上次读到的线上菜单
const base = ref(editable(ws.value.menu))
let seen = base.value
const active = computed(() => menus.value[activeIndex.value])
const dirty = computed(() => editable(menus.value) !== base.value)

// 只在读到与上次不同的线上菜单时处理：没有未发布修改就换成新版本；有修改或正在发布时保留编辑内容
watch(() => ws.value.menu, (value) => {
  const next = editable(value)
  if (next === seen) return
  seen = next
  if (next === base.value) return
  const keep = busy.value || dirty.value
  base.value = next
  if (keep) return
  menus.value = normalize(value)
  if (activeIndex.value >= menus.value.length) activeIndex.value = 0
})

function addMenu() {
  menus.value.push({ name: '菜单名称', subs: [], type: 'view', url: '', content: '' })
  activeIndex.value = menus.value.length - 1
}

function addSub() {
  active.value.subs.push({ name: '子菜单', type: 'view', url: '', content: '' })
}

function removeMenu() {
  menus.value.splice(activeIndex.value, 1)
  activeIndex.value = 0
}

async function save() {
  if (busy.value) return
  busy.value = true
  const draft = JSON.parse(JSON.stringify(menus.value))
  const before = seen
  try {
    if (isDesktop) await executeAction('interaction.saveMenu', { menu: draft })
    else ws.value.menu = draft
    // 发布成功后线上就是发布的内容；发布期间读到了新的线上菜单时以读到的为准。发布期间又做的修改仍算未发布
    if (seen === before) base.value = editable(draft)
    toast(draft.length ? '已保存并发布菜单' : '已删除全部菜单')
  } catch (error) {
    toast(error.message, 'warn')
    console.error('保存自定义菜单失败：', error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">
          自定义菜单
        </h1>
      </div>
    </div>

    <div class="card layout">
      <MenuPhonePreview
        :menus="menus"
        :active-index="activeIndex"
        :title="currentAccount?.name || '公众号'"
        @select="activeIndex = $event"
        @add="addMenu"
      />
      <div class="side">
      <div
        v-if="!active"
        class="editor editor-empty"
      >
        <p class="muted">用户在公众号会话底部看到的菜单。最多 3 个一级菜单，每个最多 5 个子菜单。</p>
        <button class="weui-btn weui-btn_mini weui-btn_default" @click="addMenu">添加菜单</button>
      </div>
      <div
        v-else
        class="editor"
      >
        <div class="ed-head">
          <strong>编辑一级菜单</strong>
          <a
            class="text-danger"
            @click="removeMenu"
          >删除菜单</a>
        </div>
        <label class="ed-row">
          <span class="muted">菜单名称</span>
          <input
            v-model="active.name"
            maxlength="8"
          >
        </label>
        <div v-if="!active.subs.length" class="ed-row">
          <span class="muted">菜单内容</span>
          <div class="target">
            <MenuTargetField :item="active" />
          </div>
        </div>
        <div class="ed-row">
          <span class="muted">子菜单</span>
          <div class="subs">
            <div
              v-for="(sub, index) in active.subs"
              :key="index"
              class="sub"
            >
              <input v-model="sub.name">
              <a
                class="text-danger"
                @click="active.subs.splice(index, 1)"
              >删除</a>
              <MenuTargetField :item="sub" />
            </div>
            <a
              v-if="active.subs.length < 5"
              @click="addSub"
            >＋ 添加子菜单</a>
          </div>
        </div>
      </div>
      <!-- 保存并发布放在编辑区下方，改完就近提交；删光菜单后也能发布 -->
      <div class="ed-foot">
        <span class="dirty">{{ dirty ? '有未发布的修改' : '菜单已是最新' }}</span>
        <button
          class="weui-btn weui-btn_mini weui-btn_primary"
          :disabled="busy || !dirty"
          @click="save"
        >
          {{ busy ? '正在发布…' : '保存并发布' }}
        </button>
      </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  gap: 40px;
}

.side {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 12px;
  min-width: 0;
}

.ed-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.dirty {
  color: var(--text-3);
  font-size: 13px;
}

.editor {
  min-width: 0;
  padding: 20px 24px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: #fafbfa;
}

.editor-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 14px;
}

.editor-empty .weui-btn {
  width: auto;
  margin: 0;
}

.ed-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
}

.ed-row {
  display: flex;
  gap: 16px;
  padding: 10px 0;
}

.ed-row > span {
  width: 64px;
  flex: none;
  padding-top: 5px;
}

.ed-row > input {
  flex: 1;
  max-width: 280px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
}

.target {
  flex: 1;
  min-width: 0;
}

.subs {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 8px;
  min-width: 0;
}

.sub {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: #fff;
}
</style>
