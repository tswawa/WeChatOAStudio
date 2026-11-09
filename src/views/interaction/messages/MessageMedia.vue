<!-- 私信多媒体内容：图片（点击查看大图）、语音、视频播放器与图文卡片，内容从公众平台按需读取 -->
<script setup>
import { onMounted, ref } from 'vue'
import { ExternalLink } from 'lucide-vue-next'
import { invokeAction } from '../../../services/workspace.js'
import { isDesktop } from '../../../services/desktop.js'
import { toast } from '../../../store/ui.js'

const props = defineProps({ message: { type: Object, required: true } })
const src = ref('')
const large = ref('')
const failed = ref(false)
const loading = ref(false)

function payload(extra = {}) {
  const { id, kind, fileId, source } = props.message
  return { messageId: id, kind, fileId, source, ...extra }
}

async function load(extra) {
  const value = await invokeAction('interaction.messageFile', payload(extra))
  return value.url
}

// 图片缩略图随消息加载；语音、视频在点击播放时才读取，避免一次拉取大量文件
onMounted(async () => {
  if (!isDesktop || props.message.expired || props.message.kind !== 'image') return
  try {
    src.value = await load()
  } catch (error) {
    failed.value = true
  }
})

async function play() {
  if (loading.value || src.value) return
  loading.value = true
  try {
    src.value = await load()
  } catch (error) {
    failed.value = true
    toast(error.message, 'warn')
  } finally {
    loading.value = false
  }
}

async function enlarge() {
  if (large.value) {
    large.value = ''
    return
  }
  try {
    large.value = await load({ large: true })
  } catch (error) {
    toast(error.message, 'warn')
  }
}

async function openArticle() {
  try {
    await window.mpDesktop.openUrl(props.message.url)
  } catch (error) {
    toast(error.message || '无法打开文章', 'warn')
  }
}
</script>

<template>
  <span v-if="message.expired" class="faint">{{ message.content }}（已过期）</span>
  <template v-else-if="message.kind === 'image'">
    <img v-if="src" :src="src" alt="私信图片" class="thumb" @click="enlarge">
    <span v-else class="faint">{{ failed ? '[图片无法加载]' : '[图片加载中]' }}</span>
    <div v-if="large" class="viewer" @click="large = ''">
      <img :src="large" alt="私信图片大图">
    </div>
  </template>
  <template v-else-if="message.kind === 'voice'">
    <audio v-if="src" :src="src" controls autoplay class="voice" />
    <button v-else class="play" :disabled="loading" @click="play">
      ▶ 语音{{ message.duration ? ` ${Math.round(message.duration)}″` : '' }}{{ loading ? ' 加载中' : '' }}
    </button>
  </template>
  <template v-else-if="message.kind === 'video'">
    <video v-if="src" :src="src" controls autoplay class="video" />
    <button v-else class="play" :disabled="loading" @click="play">▶ 播放视频{{ loading ? ' 加载中' : '' }}</button>
  </template>
  <button v-else-if="message.kind === 'appmsg'" class="article" :disabled="!message.url" @click="openArticle">
    <img v-if="message.cover" :src="message.cover" alt="" referrerpolicy="no-referrer">
    <span>{{ message.title || '图文消息' }}</span>
    <ExternalLink v-if="message.url" :size="12" />
  </button>
  <span v-else class="faint">{{ message.content }}</span>
</template>

<style scoped>
.thumb {
  display: block;
  max-width: 220px;
  max-height: 220px;
  border-radius: 4px;
  cursor: zoom-in;
}

.viewer {
  position: fixed;
  inset: 0;
  z-index: 6000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  cursor: zoom-out;
}

.viewer img {
  max-width: 90vw;
  max-height: 90vh;
}

.voice {
  width: 240px;
  height: 36px;
}

.video {
  display: block;
  max-width: 320px;
  max-height: 240px;
}

.play {
  border: 0;
  background: none;
  color: var(--link);
  font: inherit;
  cursor: pointer;
}

.article {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 260px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-1);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.article:disabled {
  cursor: default;
}

.article img {
  width: 48px;
  height: 48px;
  flex: none;
  border-radius: 4px;
  object-fit: cover;
}
</style>
