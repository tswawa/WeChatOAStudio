// 未获取的公众号工作区：列表为空、指标为未知，不携带演示内容。
export function emptyWorkspace() {
  return {
    drafts: [], published: [], materials: [], comments: [], messages: [], members: [], tags: [], sources: [], users: [], templates: [],
    followers: null,
    yesterday: { reads: null, shares: null, newFollowers: null, lost: null },
    weekReads: [],
    income: { channels: [], updatedAt: null },
    autoReply: { follow: '', fallback: '', keywords: [] },
    menu: [],
    api: { connected: false, appId: '' },
    chatMessages: [],
    shortcuts: [],
    errors: {},
    loaded: false,
  }
}
