<!-- 正文排版工具栏：段落样式、字号、加粗/斜体/下划线/删除线、文字颜色与背景色、对齐、列表、首行缩进、行距、段距、
     分割线、链接、格式刷、清除格式；按钮按下时不抢走正文的选区 -->
<script setup>
import { nextTick, ref } from 'vue'
import {
  Undo2, Redo2, Bold, Italic, Underline, Strikethrough, Baseline, Highlighter,
  TextAlignStart, TextAlignCenter, TextAlignEnd, TextAlignJustify, List, ListOrdered, ListIndentIncrease,
  Minus, Link, Paintbrush, RemoveFormatting,
} from 'lucide-vue-next'

const props = defineProps({ rich: { type: Object, required: true }, disabled: Boolean })
const rich = props.rich
const linkOpen = ref(false)
const linkUrl = ref('')
const linkInput = ref(null)

const BLOCKS = [
  { value: 'p', label: '正文' },
  { value: 'h1', label: '标题 1' },
  { value: 'h2', label: '标题 2' },
  { value: 'h3', label: '标题 3' },
  { value: 'blockquote', label: '引用' },
]
const SIZES = [12, 14, 15, 16, 17, 18, 20, 24, 28]
const LINE_HEIGHTS = ['1.5', '1.75', '2', '2.5']
const SPACINGS = [{ value: '0px', label: '0' }, { value: '8px', label: '8' }, { value: '16px', label: '16' },
  { value: '24px', label: '24' }]
const MARKS = [
  { command: 'bold', icon: Bold, title: '加粗' },
  { command: 'italic', icon: Italic, title: '斜体' },
  { command: 'underline', icon: Underline, title: '下划线' },
  { command: 'strikeThrough', icon: Strikethrough, title: '删除线' },
]
const ALIGNS = [
  { command: 'justifyLeft', icon: TextAlignStart, title: '左对齐' },
  { command: 'justifyCenter', icon: TextAlignCenter, title: '居中' },
  { command: 'justifyRight', icon: TextAlignEnd, title: '右对齐' },
  { command: 'justifyFull', icon: TextAlignJustify, title: '两端对齐' },
]
const LISTS = [
  { command: 'insertUnorderedList', icon: List, title: '无序列表' },
  { command: 'insertOrderedList', icon: ListOrdered, title: '有序列表' },
]

function pick(event, run) {
  const value = event.target.value
  if (value) run(value)
  event.target.value = ''
}

// 超链接：顶部“超链接”按钮和这里共用
function openLink() {
  linkOpen.value = true
  linkUrl.value = 'https://'
  nextTick(() => linkInput.value?.select())
}

function applyLink() {
  const url = linkUrl.value.trim()
  if (/^https?:\/\/\S+\.\S+/.test(url)) rich.insertLink(url)
  linkOpen.value = false
}

defineExpose({ openLink })
</script>

<template>
  <div class="format-bar" :class="{ disabled }" @mousedown="$event.target.tagName === 'BUTTON' && $event.preventDefault()">
    <button title="撤销" @mousedown.prevent @click="rich.exec('undo')"><Undo2 :size="16" /></button>
    <button title="重做" @mousedown.prevent @click="rich.exec('redo')"><Redo2 :size="16" /></button>
    <span class="sep" />

    <select title="段落样式" :value="BLOCKS.some((item) => item.value === rich.state.block) ? rich.state.block : 'p'"
      @change="rich.setBlock($event.target.value)">
      <option v-for="item in BLOCKS" :key="item.value" :value="item.value">{{ item.label }}</option>
    </select>
    <select title="字号" class="narrow" @change="pick($event, (value) => rich.setFontSize(value))">
      <option value="">{{ rich.state.fontSize ? rich.state.fontSize + 'px' : '字号' }}</option>
      <option v-for="size in SIZES" :key="size" :value="size">{{ size }}px</option>
    </select>
    <span class="sep" />

    <button
      v-for="item in MARKS"
      :key="item.command"
      :title="item.title"
      :class="{ on: rich.state.marks[item.command] }"
      @mousedown.prevent
      @click="rich.exec(item.command)"
    ><component :is="item.icon" :size="16" /></button>
    <label class="color" title="文字颜色">
      <Baseline :size="16" />
      <input type="color" value="#fa5151" @change="rich.exec('foreColor', $event.target.value)">
    </label>
    <label class="color" title="背景色">
      <Highlighter :size="16" />
      <input type="color" value="#fff3a3" @change="rich.exec('hiliteColor', $event.target.value)">
    </label>
    <span class="sep" />

    <button
      v-for="item in ALIGNS"
      :key="item.command"
      :title="item.title"
      :class="{ on: rich.state.marks[item.command] }"
      @mousedown.prevent
      @click="rich.exec(item.command)"
    ><component :is="item.icon" :size="16" /></button>
    <span class="sep" />

    <button
      v-for="item in LISTS"
      :key="item.command"
      :title="item.title"
      :class="{ on: rich.state.marks[item.command] }"
      @mousedown.prevent
      @click="rich.exec(item.command)"
    ><component :is="item.icon" :size="16" /></button>
    <button title="首行缩进 2 字" @mousedown.prevent @click="rich.toggleIndent()"><ListIndentIncrease :size="16" /></button>
    <select title="行距" class="narrow" @change="pick($event, (value) => rich.setBlockStyle('lineHeight', value))">
      <option value="">行距</option>
      <option v-for="value in LINE_HEIGHTS" :key="value" :value="value">{{ value }} 倍</option>
    </select>
    <select title="段后距" class="narrow" @change="pick($event, (value) => rich.setBlockStyle('marginBottom', value))">
      <option value="">段距</option>
      <option v-for="item in SPACINGS" :key="item.value" :value="item.value">段后 {{ item.label }}</option>
    </select>
    <span class="sep" />

    <slot name="insert" />
    <button title="分割线" @mousedown.prevent @click="rich.insertDivider()"><Minus :size="16" /></button>
    <span class="link-wrap">
      <button title="超链接" @mousedown.prevent @click="openLink"><Link :size="16" /></button>
      <form v-if="linkOpen" class="link-pop" @submit.prevent="applyLink">
        <input ref="linkInput" v-model="linkUrl" placeholder="https://" @keydown.esc="linkOpen = false">
        <button type="submit" class="weui-btn weui-btn_xmini weui-btn_primary">确定</button>
      </form>
    </span>
    <button
      :title="rich.state.painter ? '格式刷：选中要刷的文字（再点一次取消）' : '格式刷：复制光标处的格式'"
      :class="{ on: rich.state.painter }"
      @mousedown.prevent
      @click="rich.copyFormat()"
    ><Paintbrush :size="16" /></button>
    <button title="清除格式" @mousedown.prevent @click="rich.clearFormat()"><RemoveFormatting :size="16" /></button>
  </div>
</template>

<style scoped>
.format-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 6px 20px;
  border-bottom: 1px solid var(--border);
  background: #fff;
  flex: none;
}

.format-bar.disabled {
  opacity: 0.5;
  pointer-events: none;
}

button,
.color {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--text-1);
  cursor: pointer;
}

button:hover,
.color:hover {
  background: var(--bg-hover);
}

button.on {
  background: var(--brand-light);
  color: var(--brand);
}

.color input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

select {
  height: 30px;
  margin: 0 2px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fff;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

select.narrow {
  width: 76px;
}

.sep {
  width: 1px;
  height: 18px;
  margin: 0 6px;
  background: var(--border);
}

.link-wrap {
  position: relative;
}

.link-pop {
  position: absolute;
  top: 36px;
  left: 0;
  z-index: 10;
  display: flex;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  box-shadow: var(--shadow-pop);
}

.link-pop input {
  width: 260px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font: inherit;
  font-size: 13px;
}

.link-pop button {
  width: auto;
  height: 26px;
}
</style>
