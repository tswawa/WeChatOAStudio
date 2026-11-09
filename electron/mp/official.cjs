// 按公众号加密保存开发凭据，并把网页草稿转换为官方素材后调用官方发表及群发接口。
const { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } = require('node:fs')
const { dirname, join } = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { publicationVersion, createPublicationJournal } = require('./publications.cjs')
const { createOfficialImageReader } = require('./official-images.cjs')

const ORIGIN = 'https://api.weixin.qq.com'
const ENDPOINTS = new Set([
  '/cgi-bin/stable_token', '/cgi-bin/getcallbackip', '/cgi-bin/material/add_material',
  '/cgi-bin/media/uploadimg', '/cgi-bin/draft/add', '/cgi-bin/draft/count',
  '/cgi-bin/freepublish/submit', '/cgi-bin/freepublish/get', '/cgi-bin/message/mass/sendall',
  '/cgi-bin/message/mass/get', '/cgi-bin/message/mass/speed/get', '/cgi-bin/openapi/quota/get',
])
const ERROR_TEXT = {
  40001: '开发接口访问令牌无效，请重新验证接口', 40013: 'AppID 不正确',
  40014: '开发接口访问令牌无效', 42001: '开发接口访问令牌已过期',
  40125: 'AppSecret 不正确', 40164: '当前出口 IP 不在公众号开发接口白名单内',
  48001: '这个公众号没有该接口权限', 48002: '公众号没有发送权限',
  45009: '开发接口调用次数已达上限', 45028: '本次群发次数已用完',
  40007: '图片或图文素材编号无效', 40009: '图片文件大小超出微信限制',
  40005: '图片类型不被微信接受', 40035: '参数格式不被微信接受',
  40050: '分组参数无效', 40096: '群发素材无效', 45065: '相同内容已群发，请先核对发表记录',
}

function eligible(account) {
  return Boolean(account)
}

function failureState(error) {
  if ([48001, 48002].includes(Number(error.wxCode))) return 'denied'
  if ([45009, 45028].includes(Number(error.wxCode))) return 'quota_exhausted'
  if (/confirm|verification|security check|群发保护|安全验证|管理员确认|扫码确认/i.test(error.message || '')) return 'verification_required'
  return error.uncertain ? 'uncertain' : 'error'
}
const API_PATHS = { publish: '/cgi-bin/freepublish/submit', mass: '/cgi-bin/message/mass/sendall' }

function createOfficialService({ settingsPath, getAccount, getDraft, readImage = createOfficialImageReader(), getMassQuota,
  encryption = require('electron').safeStorage, fetcher = fetch, journal: providedJournal, locks }) {
  let saved = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {}
  const tokens = new Map()
  const pendingTokens = new Map()
  const publishing = locks || new Set()
  const pendingPublications = new Set()
  let closed = false
  const journal = providedJournal || createPublicationJournal(join(dirname(settingsPath), 'official-publications.json'))

  function persist() {
    mkdirSync(dirname(settingsPath), { recursive: true })
    writeFileSync(`${settingsPath}.tmp`, JSON.stringify(saved, null, 2), { mode: 0o600 })
    renameSync(`${settingsPath}.tmp`, settingsPath)
  }
  function requireAccount(accountId) {
    const account = getAccount(accountId)
    if (!account) throw new Error('公众号不存在')
    return account
  }
  function getConfig(accountId) {
    const account = requireAccount(accountId)
    const item = saved[accountId] || {}
    return {
      appId: item.appId || '', appSecretConfigured: Boolean(item.encryptedSecret),
      secretConfigured: Boolean(item.encryptedSecret),
      connected: item.connected === true, eligible: eligible(account), checkedAt: item.checkedAt || null,
      capabilities: structuredClone(item.capabilities || { publish: { state: 'unknown' }, mass: { state: 'unknown' } }),
    }
  }
  function configure(accountId, input) {
    const account = requireAccount(accountId)
    const previous = saved[accountId] || {}
    if (input.connected === false && input.appId === undefined && !input.appSecret && !input.clearSecret) {
      saved = { ...saved, [accountId]: { ...previous, connected: false } }
      tokens.delete(accountId)
      persist()
      return getConfig(accountId)
    }
    const appId = String(input.appId ?? previous.appId ?? '').trim()
    if (!/^wx[0-9a-f]{16}$/i.test(appId)) throw new Error('请填写完整的公众号 AppID')
    if (account.appId && account.appId !== appId) throw new Error('AppID 与当前公众号不一致')
    const secret = String(input.appSecret || '').trim()
    if (previous.appId && previous.appId !== appId && !secret) throw new Error('修改 AppID 后需要重新填写 AppSecret')
    let encryptedSecret = previous.encryptedSecret || ''
    if (secret) {
      if (!encryption.isEncryptionAvailable()) throw new Error('Windows 密钥加密暂不可用，未保存开发凭据')
      encryptedSecret = encryption.encryptString(secret).toString('base64')
    }
    if (input.clearSecret === true) encryptedSecret = ''
    saved = { ...saved, [accountId]: { appId, encryptedSecret, connected: false, checkedAt: null } }
    tokens.delete(accountId)
    persist()
    return getConfig(accountId)
  }
  async function raw(path, { body, query = {}, method = 'POST', readonly = method === 'GET' } = {}) {
    if (!ENDPOINTS.has(path)) throw new Error('不支持的微信官方接口')
    const url = new URL(path, ORIGIN)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
    let response
    try {
      response = await fetcher(url.href, {
        method, redirect: 'error', signal: AbortSignal.timeout(45000),
        ...(body instanceof FormData
          ? { body } : body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      })
    } catch (error) {
      console.error('微信官方接口网络失败', path, error.name)
      const failure = new Error(readonly ? '微信官方接口连接失败，请检查网络后重试' : '微信官方接口响应不确定，请先核对公众平台结果，不会自动重发')
      failure.uncertain = !readonly
      throw failure
    }
    if (!response.ok) {
      const failure = new Error(`微信官方接口返回 HTTP ${response.status}`)
      failure.uncertain = !readonly
      throw failure
    }
    let value
    try {
      value = await response.json()
    } catch {
      const failure = new Error('微信官方接口返回内容无法读取，请核对平台结果')
      failure.uncertain = !readonly
      throw failure
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      const failure = new Error('微信官方接口返回结构无效，请核对平台结果')
      failure.uncertain = !readonly
      throw failure
    }
    if (value.errcode && Number(value.errcode) !== 0) {
      const failure = new Error(ERROR_TEXT[value.errcode] || `微信官方接口拒绝操作（错误码 ${value.errcode}）：${String(value.errmsg || '请到公众平台核对').slice(0, 180)}`)
      failure.wxCode = Number(value.errcode)
      failure.uncertain = !readonly && failure.wxCode === 45065
      throw failure
    }
    return value
  }
  async function getToken(accountId) {
    requireAccount(accountId)
    const cached = tokens.get(accountId)
    if (cached && cached.expiresAt > Date.now() + 60000) return cached.value
    if (pendingTokens.has(accountId)) return pendingTokens.get(accountId)
    const promise = (async () => {
      const config = saved[accountId]
      if (!config?.appId || !config.encryptedSecret) throw new Error('请先在开发接口页配置 AppID 和 AppSecret')
      const secret = encryption.decryptString(Buffer.from(config.encryptedSecret, 'base64'))
      const result = await raw('/cgi-bin/stable_token', { readonly: true, body: {
        grant_type: 'client_credential', appid: config.appId, secret, force_refresh: false,
      } })
      if (!result.access_token) throw new Error('微信未返回开发接口令牌')
      tokens.set(accountId, { value: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 })
      return result.access_token
    })()
    pendingTokens.set(accountId, promise)
    try {
      return await promise
    } finally {
      pendingTokens.delete(accountId)
    }
  }
  async function request(accountId, path, options = {}, retried = false) {
    const accessToken = await getToken(accountId)
    try {
      return await raw(path, { ...options, query: { ...options.query, access_token: accessToken } })
    } catch (error) {
      if (!retried && [40001, 40014, 42001].includes(error.wxCode)) {
        tokens.delete(accountId)
        if (options.method === 'GET' || options.readonly === true) return request(accountId, path, options, true)
      }
      throw error
    }
  }
  async function test(accountId) {
    const config = saved[accountId]
    if (!config) throw new Error('请先保存开发接口设置')
    tokens.delete(accountId)
    try {
      const result = await request(accountId, '/cgi-bin/draft/count', { method: 'GET' })
      const capabilities = {}
      for (const [kind, path] of Object.entries(API_PATHS)) {
        try {
          const result = await request(accountId, '/cgi-bin/openapi/quota/get', { readonly: true, body: { cgi_path: path } })
          const quota = result.quota || {}, remaining = quota.remain ?? quota.daily_remaining
          capabilities[kind] = { state: 'unknown', message: '已连接；提交权限由微信执行时校验', checkedAt: Date.now(),
            ...(Number.isSafeInteger(remaining) ? { remainingCalls: remaining } : {}),
            ...(Number.isSafeInteger(quota.daily_limit) ? { dailyCallLimit: quota.daily_limit } : {}) }
        } catch {
          capabilities[kind] = { state: 'unknown', message: '未验证该操作权限；连接测试不会发文', checkedAt: Date.now() }
        }
      }
      saved[accountId] = { ...config, connected: true, checkedAt: Date.now(), capabilities }
      persist()
      return { ...getConfig(accountId), draftCount: result.total_count ?? null, message: '开发接口连接成功，未执行发表或群发' }
    } catch (error) {
      saved[accountId] = { ...config, connected: false, checkedAt: Date.now() }
      persist()
      throw error
    }
  }
  async function imageBytes(accountId, image) {
    return readImage(accountId, image)
  }
  async function upload(accountId, image, permanent) {
    const value = await imageBytes(accountId, image)
    const bytes = Buffer.from(value.buffer || [])
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('图片为空或超过 2 MB，请重新选择')
    const mimeType = String(value.mimeType || 'image/jpeg').split(';')[0]
    if (!['image/jpeg', 'image/png', 'image/gif'].includes(mimeType)) throw new Error('请使用 JPG、PNG 或 GIF 图片')
    const form = new FormData()
    form.set('media', new Blob([bytes], { type: mimeType }), value.filename || 'image.jpg')
    return request(accountId, permanent ? '/cgi-bin/material/add_material' : '/cgi-bin/media/uploadimg', {
      body: form, query: permanent ? { type: 'image' } : {},
    })
  }
  function assertArticleSupported(draft) {
    if (Number(draft.itemShowType || 0) !== 0) throw new Error('该稿件不是普通图文，当前接口转换不支持此格式；请使用微信页面发表，原稿未修改')
    const native = draft.remote?.article || {}
    if (Number(native.is_pay_subscribe ?? draft.isPaySubscribe) === 1 || Number(native.can_reward ?? draft.canReward) === 1
      || Number(native.copyright_type ?? draft.copyrightType) > 0) throw new Error('这篇原稿包含接口转换无法完整保留的原生发表设置，请使用微信页面发表；原稿未修改')
  }
  async function prepareArticle(accountId, draft) {
    if (!draft.title?.trim() || !draft.html?.trim()) throw new Error('草稿标题或正文为空')
    if (!draft.cover?.url && !draft.cover?.mediaId) throw new Error('请先为草稿选择封面图片')
    const cover = await upload(accountId, draft.cover, true)
    if (!cover.media_id) throw new Error('微信未返回封面永久素材编号')
    const { parseHTML } = await import('linkedom')
    const { document } = parseHTML(`<html><body>${draft.html}</body></html>`)
    const uploaded = new Map()
    for (const image of document.querySelectorAll('img')) {
      const url = image.getAttribute('data-src') || image.getAttribute('src')
      if (!url) continue
      if (!uploaded.has(url)) {
        const result = await upload(accountId, { url }, false)
        if (!result.url) throw new Error('微信未返回正文图片地址')
        uploaded.set(url, result.url)
      }
      image.setAttribute('src', uploaded.get(url))
      image.removeAttribute('data-src')
      image.removeAttribute('srcset')
    }
    return {
      article_type: 'news', title: draft.title, author: draft.author || '', digest: draft.digest || '',
      content: document.body.innerHTML, content_source_url: draft.sourceUrl || '',
      thumb_media_id: cover.media_id, need_open_comment: draft.needOpenComment === true ? 1 : 0,
      only_fans_can_comment: draft.onlyFansCanComment === true ? 1 : 0,
    }
  }
  async function saveDraft(accountId, draft) {
    requireAccount(accountId)
    const originals = draft.articles?.length ? draft.articles : [draft]
    if (originals.length > 8) throw new Error('一组图文最多包含 8 篇文章')
    const articles = []
    for (const item of originals) assertArticleSupported(item)
    for (const item of originals) articles.push(await prepareArticle(accountId, item))
    const result = await request(accountId, '/cgi-bin/draft/add', { body: { articles } })
    if (!result.media_id) throw new Error('微信未返回官方草稿编号，不能确认保存结果')
    return { id: `api:${result.media_id}`, mediaId: result.media_id, sourceWebDraftId: draft.id || null }
  }
  async function publishArticle(accountId, { draftId, massNotify = false, expectedVersion, signal } = {}) {
    signal?.throwIfAborted()
    const account = requireAccount(accountId)
    if (typeof massNotify !== 'boolean') throw new Error('请明确选择普通发表或群发通知')
    if (!getConfig(accountId).connected) throw new Error('请先在开发接口中配置并验证 AppID 和 AppSecret')
    if (account.appId && account.appId !== saved[accountId].appId) throw new Error('开发接口 AppID 与当前公众号不一致')
    if (!draftId || String(draftId).startsWith('api:')) throw new Error('请从当前公众号网页草稿箱选择文章')
    const kind = massNotify ? 'mass' : 'publish'
    const capability = saved[accountId].capabilities?.[kind]
    if (['denied', 'verification_required'].includes(capability?.state)) throw new Error(`${capability.message}。处理后请在开发接口中重新检查，再确认提交`)
    if (capability?.remainingCalls === 0 && Date.now() - capability.checkedAt < 5 * 60000) throw new Error('该操作的接口调用额度不足，未提交发表；不会改用另一种发送方式')
    const lock = `${accountId}:${draftId}`
    if (publishing.has(lock)) throw new Error('这篇文章正在提交，请等待结果')
    publishing.add(lock)
    let entry, capturedResult
    try {
      const draft = await getDraft(accountId, draftId)
      signal?.throwIfAborted()
      if (!draft) throw new Error('网页草稿不存在')
      const version = publicationVersion(draft)
      if (expectedVersion && expectedVersion !== version) throw new Error('文章在确认后已被修改，请重新检查再发表')
      const id = createHash('sha256').update(JSON.stringify([accountId, saved[accountId].appId, String(draftId), version, kind])).digest('hex')
      entry = journal.get(accountId, id)
      const previous = journal.list(accountId).filter(item => item.draftId === String(draftId))
      const accepted = previous.find(item => item.version === version && item.result && ['submitted','succeeded'].includes(item.state))
      if (accepted) return { ...accepted.result, publicationId: accepted.id, reused: true,
        message: `该版本已有${accepted.kind === 'mass' ? '群发' : '普通发表'}提交，未重复发送` }
      if (previous.some(item => ['submitting','uncertain','waiting_verification','waiting_confirmation'].includes(item.state))) {
        const failure = new Error('这篇文章已有结果待核实的接口提交，已阻止重复发送，请先在公众平台核对')
        failure.publicationState = 'uncertain'
        throw failure
      }
      if (massNotify) {
        const quota = await getMassQuota?.(accountId)
        if (!Number.isSafeInteger(quota?.left)) throw new Error('群发剩余次数未获取，请先刷新公众平台群发额度')
        if (quota.left <= 0) throw new Error(`${quota.period || '当前周期'}群发剩余 0 次，未执行群发；草稿保留，不会自动改为普通发表`)
      }
      entry = journal.put(accountId, { ...entry, id, draftId: String(draftId), title: draft.title, kind,
        version, transport: 'api', appId: saved[accountId].appId, state: 'preparing', createdAt: entry?.createdAt || Date.now(), clientMessageId: entry?.clientMessageId || randomUUID() })
      if (!entry.mediaId) {
        const officialDraft = await saveDraft(accountId, draft)
        entry = journal.put(accountId, { ...entry, mediaId: officialDraft.mediaId, state: 'prepared' })
      }
      signal?.throwIfAborted()
      entry = journal.put(accountId, { ...entry, state: 'submitting', error: '' })
      const result = await request(accountId, API_PATHS[kind], { body: massNotify ? {
        filter: { is_to_all: true }, mpnews: { media_id: entry.mediaId }, msgtype: 'mpnews', send_ignore_reprint: 0,
        clientmsgid: entry.clientMessageId, enable_duplicate_check: 1,
      } : { media_id: entry.mediaId } })
      const receipt = massNotify ? result.msg_id : result.publish_id
      if (receipt === undefined || receipt === null || receipt === '') {
        const failure = new Error('微信未返回提交任务编号，结果待核实，已阻止自动重发')
        failure.uncertain = true
        throw failure
      }
      const value = { status: 'submitted', transport: 'api', massNotify, mediaId: entry.mediaId, publicationId: entry.id,
        ...(massNotify ? { messageId: String(receipt) } : { publishId: String(receipt) }) }
      capturedResult = value
      journal.put(accountId, { ...entry, state: 'submitted', result: value })
      saved[accountId] = { ...saved[accountId], capabilities: { ...saved[accountId].capabilities,
        [kind]: { state: 'allowed', checkedAt: Date.now(), message: '该接口已成功接收提交；最终结果以微信回执为准' } } }
      persist()
      return value
    } catch (error) {
      if (entry && !error.publicationState) {
        if (capturedResult) { error.uncertain = true; error.message = '微信已接收提交，但本地回执保存异常；请核对平台结果，不会自动重发' }
        if (entry.state !== 'submitting') error.uncertain = false
        const state = error.uncertain ? 'uncertain' : 'failed'
        const observation = failureState(error)
        error.publicationState = observation
        try { journal.put(accountId, { ...entry, state, ...(capturedResult ? { result: capturedResult } : {}), error: error.message, wxCode: error.wxCode || null }) }
        catch { console.error('发表回执持久化失败，保留原提交状态，禁止重试') }
        if (['denied', 'verification_required', 'quota_exhausted'].includes(observation)) {
          saved[accountId] = { ...saved[accountId], capabilities: { ...saved[accountId].capabilities,
            [kind]: { state: observation, message: error.message, wxCode: error.wxCode || null, checkedAt: Date.now() } } }
          try { persist() } catch { console.error('保存接口权限状态失败') }
        }
      }
      throw error
    } finally { publishing.delete(lock) }
  }
  function publish(accountId, input) {
    if (closed) return Promise.reject(new Error('应用正在关闭'))
    const pending = publishArticle(accountId,input).finally(()=>pendingPublications.delete(pending))
    pendingPublications.add(pending); return pending
  }
  function updateReceipt(accountId, field, id, result) {
    const entry = journal.list(accountId).find(item => String(item.result?.[field]) === String(id))
    if (entry) journal.put(accountId, { ...entry, state: result.status, result: { ...entry.result, status: result.status } })
  }
  async function getPublishStatus(accountId, publishId) {
    const result = await request(accountId, '/cgi-bin/freepublish/get', { readonly: true, body: { publish_id: publishId } })
    if (!Number.isInteger(result.publish_status) || result.publish_status < 0) throw new Error('微信尚未返回可识别的发表状态，保留待核实记录')
    const value = { ...result, publishId,
      status: result.publish_status === 0 ? 'succeeded' : result.publish_status === 1 ? 'submitted' : 'failed' }
    updateReceipt(accountId, 'publishId', publishId, value)
    return value
  }
  async function getMassStatus(accountId, messageId) {
    const result = await request(accountId, '/cgi-bin/message/mass/get', { readonly: true, body: { msg_id: messageId } })
    if (typeof result.msg_status !== 'string' || !/^(SEND_SUCCESS|SENDING|SEND_FAIL(?::.*)?)$/.test(result.msg_status)) throw new Error('微信尚未返回可识别的群发状态，保留待核实记录')
    const value = { ...result, messageId,
      status: result.msg_status === 'SEND_SUCCESS' ? 'succeeded' : result.msg_status === 'SENDING' ? 'submitted' : 'failed' }
    updateReceipt(accountId, 'messageId', messageId, value)
    return value
  }
  return {
    async close() { closed = true; await Promise.allSettled([...pendingPublications]) },
    configure, getConfig, test, publish, saveDraft, getPublishStatus, getMassStatus,
    listPublications: accountId => { requireAccount(accountId); return journal.list(accountId).slice(0, 50).map(({ clientMessageId, version, ...item }) => item) },
    uploadImage: (accountId, image) => upload(accountId, image, false),
    uploadMaterial: (accountId, image) => upload(accountId, image, true),
  }
}

module.exports = { createOfficialService, eligible }
