import { reactive } from 'vue'
const drafts = reactive(new Map())
export function composerDraft(key) {
  if (!drafts.has(key)) drafts.set(key, { text: '', attachments: [] })
  return drafts.get(key)
}
