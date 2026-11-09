<!-- 素材库：显示公众号图片素材，上传与删除通过账号对应的真实接口执行。 -->
<script setup>
import { ref } from 'vue'
import { LoaderCircle, Trash2, Upload } from 'lucide-vue-next'
import CoverThumb from '../../components/CoverThumb.vue'
import WorkspaceEmptyState from '../../components/WorkspaceEmptyState.vue'
import { ws, loadWorkspace, executeAction } from '../../store/workspace.js'
import { toast, confirmAction } from '../../store/ui.js'
import { uid } from '../../utils/time.js'
import { isDesktop, desktopAccounts } from '../../services/desktop.js'
import { uploadImage } from '../../services/workspace.js'
import { session } from '../../store/session.js'

const fileInput = ref(null)
const uploading = ref(false)
const deletingIds = ref(new Set())

const tab = ref('image')
const TABS = [
  { key: 'image', label: '图片' },
  { key: 'audio', label: '音频' },
  { key: 'video', label: '视频' },
]

const PALETTE = [
  ['#ff7a45', '#ffb37a'],
  ['#722ed1', '#b37feb'],
  ['#13c2c2', '#73e0e0'],
]

function upload() {
  if (isDesktop) {
    if (tab.value === 'image') fileInput.value.click()
    else desktopAccounts.openPlatform(session.accountId).catch((error) => toast(error.message, 'warn'))
    return
  }
  const [from, to] = PALETTE[ws.value.materials.length % PALETTE.length]
  ws.value.materials.unshift({ id: uid('m'), name: '新上传图片.png', size: '220KB', cover: { from, to, label: '新图片' } })
  toast('已上传')
}

async function remove(item) {
  if (deletingIds.value.has(item.id)) return
  if (!await confirmAction({ title: '删除素材', message: `删除「${item.name || '这张图片'}」？${isDesktop ? '公众平台素材库中也会删除，' : ''}删除后无法恢复。` })) return
  deletingIds.value.add(item.id)
  try {
    if (isDesktop) {
      await executeAction('content.deleteMaterial', { id: item.id, materialId: item.id })
    } else {
      ws.value.materials = ws.value.materials.filter((entry) => entry.id !== item.id)
    }
    toast('素材已删除')
  } catch (error) {
    toast(error.message, 'warn')
    console.error('删除素材失败：', error)
  } finally {
    deletingIds.value.delete(item.id)
  }
}

function lockLeavingSize(element) {
  const bounds = element.getBoundingClientRect()
  element.style.width = `${bounds.width}px`
  element.style.height = `${bounds.height}px`
}

async function selectFile(event) {
  uploading.value = true
  try {
    await uploadImage(event.target.files[0])
    await loadWorkspace()
    toast('已上传')
  } catch (error) {
    toast(error.message, 'warn')
    console.error('上传素材失败：', error)
  } finally {
    uploading.value = false
    event.target.value = ''
  }
}
</script>

<template>
  <div class="page">
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      hidden
      @change="selectFile"
    >
    <div class="page-head">
      <div>
        <h1 class="page-title">
          素材库
        </h1>
      </div>
      <button
        class="weui-btn weui-btn_mini weui-btn_primary head-btn"
        :disabled="uploading"
        @click="upload"
      >
        <Upload class="icon-16" />上传
      </button>
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
        </button>
      </div>
      <TransitionGroup
        v-if="tab === 'image' && ws.materials.length"
        tag="div"
        name="material"
        class="grid"
        @before-leave="lockLeavingSize"
      >
        <figure
          v-for="item in ws.materials"
          :key="item.id"
          class="item"
          :class="{ deleting: deletingIds.has(item.id) }"
          :aria-busy="deletingIds.has(item.id)"
        >
          <CoverThumb
            :cover="item.cover"
            :width="180"
            :ratio="1.5"
          />
          <figcaption>
            <span
              class="name"
              :title="item.name"
            >{{ item.name }}</span>
            <button
              class="delete-button"
              :disabled="deletingIds.has(item.id)"
              :aria-label="deletingIds.has(item.id) ? '正在删除：' + item.name : '删除：' + item.name"
              :title="deletingIds.has(item.id) ? '正在删除' : '删除素材'"
              @click="remove(item)"
            >
              <LoaderCircle
                v-if="deletingIds.has(item.id)"
                class="delete-spinner"
                :size="14"
              />
              <Trash2
                v-else
                :size="14"
              />
              <span>{{ deletingIds.has(item.id) ? '删除中' : '删除' }}</span>
            </button>
          </figcaption>
          <span class="faint size">{{ item.size }}</span>
        </figure>
      </TransitionGroup>
      <WorkspaceEmptyState
        v-else-if="tab === 'image'"
        section="materials"
        text="没有图片素材"
      />
      <WorkspaceEmptyState
        v-else
        :text="isDesktop ? '请在公众平台管理这类素材' : '暂无' + TABS.find((item) => item.key === tab).label + '素材'"
      />
    </div>
  </div>
</template>

<style scoped src="./MaterialsView.css"></style>
