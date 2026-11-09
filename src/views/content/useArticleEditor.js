// 编辑器状态：同步正文与预览，隔离过期请求，保存普通图文和贴图图集。
import { reactive, ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ws, newDraftShell } from '../../store/workspace.js'
import { session } from '../../store/session.js'
import { openPublish, openPreview, toast } from '../../store/ui.js'
import { plainText } from '../../store/seed/articles.js'
import { pushBot, setFocusDraft } from '../../assistant/chatStore.js'
import { invokeAction, uploadImage } from '../../services/workspace.js'
import { isDesktop } from '../../services/desktop.js'
import { cleanArticleHtml } from '../../services/articleHtml.js'

export function useArticleEditor() {
  const route = useRoute()
  const router = useRouter()
  const draft = reactive(newDraftShell())
  const savedAt = ref(null)
  const bodyRef = ref(null)
  const fileInput = ref(null)
  const busy = ref(false)
  const loading = ref(false)
  const error = ref('')
  const dirty = ref(false)
  const versionConflict = ref(false)
  const isImagePost = computed(() => Number(draft.itemShowType) === 8)
  const wordCount = computed(() => plainText(draft.html || '').length)
  let imagePurpose = 'cover'
  let generation = 0
  let loadSequence = 0
  let disposed = false

  function changed() {
    dirty.value = true
  }

  async function paintBody() {
    await nextTick()
    if (bodyRef.value) bodyRef.value.innerHTML = cleanArticleHtml(draft.html || '')
  }

  function showError(cause) {
    error.value = cause.message || '操作失败，请重试'
    toast(error.value, 'warn')
    console.error('编辑器操作失败：', cause)
  }

  async function loadDraft({ reset = false } = {}) {
    const sequence = ++loadSequence
    const currentGeneration = generation
    const accountId = session.accountId
    const draftId = String(route.params.id || '')
    const wasDirty = dirty.value
    error.value = ''
    loading.value = false
    if (reset) {
      const source = ws.value.drafts.find((item) => item.id === draftId)
      for (const key of Object.keys(draft)) delete draft[key]
      const initial = source ? JSON.parse(JSON.stringify(source)) : newDraftShell()
      Object.assign(draft, initial, { images: initial.images || [] })
      draft.html = cleanArticleHtml(draft.html || '')
      dirty.value = false
      versionConflict.value = false
      savedAt.value = source?.updatedAt || null
    }
    await paintBody()
    if (!isDesktop || !draftId) return
    loading.value = true
    let timer
    try {
      const loaded = await Promise.race([
        invokeAction('content.getDraft', { draftId }, accountId),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('读取草稿超时，可重试；当前输入已保留')), 45000)
        }),
      ])
      if (disposed || sequence !== loadSequence || currentGeneration !== generation) return
      if (wasDirty && !reset) {
        if (!draft.dataSeq || loaded.dataSeq !== draft.dataSeq) {
          versionConflict.value = true
          showError(new Error('草稿版本已变化，当前输入已保留；请返回草稿箱重新打开后再修改'))
          return
        }
        draft.remote = loaded.remote
      } else {
        Object.assign(draft, loaded, { html: cleanArticleHtml(loaded.html || '') })
        await paintBody()
      }
      savedAt.value = loaded.updatedAt
    } catch (cause) {
      if (!disposed && sequence === loadSequence && currentGeneration === generation) showError(cause)
    } finally {
      clearTimeout(timer)
      if (sequence === loadSequence) loading.value = false
    }
  }

  onMounted(() => loadDraft({ reset: true }))
  watch(() => [route.params.id, session.accountId], () => {
    generation += 1
    busy.value = false
    loadDraft({ reset: true })
  })
  onBeforeUnmount(() => {
    disposed = true
    generation += 1
    loadSequence += 1
  })

  function onInput() {
    if (!bodyRef.value) return
    draft.html = cleanArticleHtml(bodyRef.value.innerHTML)
    changed()
  }

  async function save() {
    if (busy.value || loading.value) return null
    if (versionConflict.value || (isDesktop && route.params.id && !draft.dataSeq)) {
      showError(new Error('当前草稿版本无法确认，输入已保留，请重新打开草稿后再保存'))
      return null
    }
    busy.value = true
    error.value = ''
    const ownGeneration = generation
    const accountId = session.accountId
    try {
      onInput()
      const value = JSON.parse(JSON.stringify(draft))
      const result = isDesktop ? await invokeAction('content.saveDraft', { draft: value }, accountId)
        : { ...value, updatedAt: Date.now() }
      if (disposed || ownGeneration !== generation) return null
      Object.assign(draft, result)
      dirty.value = false
      savedAt.value = result.updatedAt || Date.now()
      ws.value.drafts = [result, ...ws.value.drafts.filter((item) => item.id !== result.id)]
      await paintBody()
      toast('已保存为草稿')
      return result
    } catch (cause) {
      if (!disposed && ownGeneration === generation) showError(cause)
      return null
    } finally {
      if (ownGeneration === generation) busy.value = false
    }
  }

  function preview() {
    onInput()
    openPreview(JSON.parse(JSON.stringify(draft)))
  }

  async function publish() {
    if (!draft.title.trim()) return toast('请填写标题', 'warn')
    const saved = await save()
    if (saved) openPublish(saved.id, () => router.push('/published'))
  }

  async function handToAssistant() {
    const saved = await save()
    if (!saved) return
    setFocusDraft(saved.id)
    if (!isDesktop) pushBot(`收到《${saved.title || '无标题'}》，请告诉我如何修改。`)
    router.push('/bot')
  }

  function chooseImage(purpose = 'cover') {
    if (loading.value || busy.value) return
    imagePurpose = purpose
    fileInput.value.click()
  }

  async function selectImage(event) {
    const file = event.target.files[0]
    if (!file) return
    const ownGeneration = generation
    const accountId = session.accountId
    busy.value = true
    error.value = ''
    try {
      const material = await uploadImage(file, accountId)
      if (disposed || ownGeneration !== generation) return
      const url = material.url || material.cover?.url
      if (!url) throw new Error('微信没有返回图片地址')
      if (imagePurpose === 'cover') {
        draft.cover = { ...(material.cover || {}), url, mediaId: material.mediaId || '', fileId: material.fileId || material.id }
        draft.thumbMediaId = material.mediaId || ''
        draft.thumbFileId = material.fileId || material.id
      } else if (imagePurpose === 'gallery' || isImagePost.value) {
        draft.images ||= []
        draft.images.push({ id: material.id, fileId: material.fileId || material.id, url,
          width: material.width || 0, height: material.height || 0 })
      } else {
        const image = document.createElement('img')
        image.src = url
        image.style.maxWidth = '100%'
        bodyRef.value.appendChild(image)
        onInput()
      }
      changed()
    } catch (cause) {
      if (!disposed && ownGeneration === generation) showError(cause)
    } finally {
      if (ownGeneration === generation) busy.value = false
      event.target.value = ''
    }
  }

  async function onInsert(item) {
    if (!isDesktop) return toast(`原型暂未实现「${item}」`, 'warn')
    if (item === '图片') return chooseImage(isImagePost.value ? 'gallery' : 'body')
    // 视频、小程序、投票等是公众平台自己的组件，只能在官方编辑器里插入：先保存，再在公众平台打开这篇草稿
    const saved = dirty.value || !draft.id ? await save() : draft
    if (!saved?.id) return
    try {
      await invokeAction('content.openEditor', { draftId: saved.id }, session.accountId)
      toast(`已在公众平台打开这篇草稿，请在那里插入「${item}」`)
    } catch (cause) {
      showError(cause)
    }
  }

  return {
    router, draft, savedAt, bodyRef, fileInput, busy, loading, error, wordCount, isImagePost,
    onInsert, onInput, save, preview, publish, handToAssistant, chooseImage, selectImage, loadDraft, changed,
  }
}
