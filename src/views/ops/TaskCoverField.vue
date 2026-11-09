<!-- 任务封面：从公众号已有图片素材中选择真实封面。 -->
<script setup>
import { computed, ref } from 'vue'
import { ws, loadWorkspace } from '../../store/workspace.js'
import CoverThumb from '../../components/CoverThumb.vue'
import { uploadImage } from '../../services/workspace.js'
import { toast } from '../../store/ui.js'

const props = defineProps({ form: { type: Object, required: true } })
const fileInput = ref(null)
const uploading = ref(false)

function choose(item) {
  props.form.cover = item ? {
    url: item.url || item.cover?.url,
    mediaId: item.mediaId || '',
    fileId: item.fileId || item.id,
  } : null
}

const selected = computed({
  get: () => props.form.cover?.assetId ? '__reviewed__' : props.form.cover?.url
    ? ws.value.materials.find((item) => (item.url || item.cover?.url) === props.form.cover.url)?.id || '' : '',
  set: (id) => {
    if (id === '__reviewed__') return
    choose(ws.value.materials.find((material) => String(material.id) === String(id)))
  },
})

async function upload(event) {
  const file = event.target.files[0]
  if (!file) return
  uploading.value = true
  try {
    const material = await uploadImage(file)
    choose(material)
    await loadWorkspace()
  } catch (error) {
    toast(error.message, 'warn')
    console.error('上传任务封面失败：', error)
  } finally {
    uploading.value = false
    event.target.value = ''
  }
}
</script>

<template>
  <label class="cover-field">
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      hidden
      @change="upload"
    >
    <span>文章封面</span>
    <select v-model="selected">
      <option value="">请选择封面素材</option>
      <option v-if="form.cover?.assetId" value="__reviewed__">本轮审核配图</option>
      <option
        v-for="item in ws.materials"
        :key="item.id"
        :value="item.id"
      >{{ item.name }}</option>
    </select>
    <button
      class="weui-btn weui-btn_xmini weui-btn_default"
      :disabled="uploading"
      @click.prevent="fileInput.click()"
    >{{ uploading ? '上传中…' : '上传封面' }}</button>
    <CoverThumb
      v-if="form.cover"
      :cover="form.cover"
      :width="72"
    />
  </label>
</template>

<style scoped>
.cover-field {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cover-field > span {
  width: 72px;
  flex: none;
  color: var(--text-2);
}

select {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
}
</style>
