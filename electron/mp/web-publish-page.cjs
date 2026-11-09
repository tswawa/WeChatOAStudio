// Native-page automation never acts while identity is unknown, and only exposes genuine manual steps.
const { nativePublicationStep } = require('./web-publish-dom.cjs')
const { readIdentity, publicationIdentity, MP_ORIGIN } = require('./identity.cjs')
const { EDITOR_DATA, parseEditorDraft } = require('./draft-data.cjs')

function finalRequest(request) {
  const url = new URL(request.url)
  if (url.origin !== MP_ORIGIN || url.pathname !== '/cgi-bin/masssend' || request.method !== 'POST') return null
  if (url.searchParams.get('for_check') === '1') return null
  const action = url.searchParams.get('action') || ''
  if (['get_appmsg_copyright_stat','check_ad','check_music','check_same_material','check_send_time','check_hot_time'].includes(action)) return null
  if (action) throw new Error('微信发送流程已变化，已停止未确认的发送请求')
  const params = new URLSearchParams(request.postData || '')
  if ([...new Set(params.keys())].some(key => params.getAll(key).length > 1)) throw new Error('微信发送参数重复，已停止请求以免发送方式不一致')
  if (!/^\d+$/.test(params.get('appmsgid') || '') || Number(params.get('send_time') || 0) !== 0) throw new Error('微信发送的稿件或时间与本次确认不一致')
  if (params.get('groupid') && !['','-1'].includes(params.get('groupid')) || params.get('card_tag_id')
    || ['country','province','city'].some(key => params.get(key)) || !['','0'].includes(params.get('sex') || '')) throw new Error('微信页面启用了分组或筛选，本次发送已阻止')
  return { draftId: params.get('appmsgid'), massNotify: url.searchParams.get('is_release_publish_page') !== '1' }
}

async function createNativePublicationPage({ transport, accountId, draftId, massNotify, beforeDispatch, onResult,
  onManual, onInterrupted, onProgress, signal, identityWait = 8000, identityReadTimeout = 2000 }) {
  const page = await transport.openForAutomation(accountId, `/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&type=10&appmsgid=${draftId}`)
  const contents = page.contents, debugger_ = contents.debugger
  let closed = false, sent = false, phase = 'open', timer = null, stepping = false, interrupted = false
  let identity = 'unavailable', identityMissingSince = null, requestReleased = false, requiresNativeRetry = false, closing
  let observed = { dialog: 'none', notification: null }
  const captured = new Set(), pending = new Set()
  const diagnostics = () => ({ phase, identity, requestReleased, requiresNativeRetry, ...observed })
  const progress = () => {
    try { return onProgress?.(diagnostics()) }
    catch { throw error('本地发送状态无法记录，已停止后续步骤，请核对结果', 'WX_PUBLICATION_STATE_UNAVAILABLE') }
  }
  const error = (message, code) => Object.assign(new Error(message), { code, diagnostics: diagnostics(), nativeDispatchAttempted: requestReleased })
  function locationState() {
    try {
      const url = new URL(contents.getURL())
      if (url.origin !== MP_ORIGIN) return 'unavailable'
      if (url.pathname !== '/cgi-bin/appmsg') return 'navigation'
      return url.searchParams.get('appmsgid') === String(draftId) ? 'editor' : 'different_draft'
    } catch { return 'unavailable' }
  }
  async function readIdentityState() {
    let timeout
    const value = await Promise.race([
      readIdentity(contents).catch(() => null),
      new Promise(resolve => { timeout = setTimeout(() => resolve(null), identityReadTimeout) }),
    ]).finally(() => clearTimeout(timeout))
    identity = publicationIdentity(value, accountId).state
    if (identity === 'mismatch') throw error('微信窗口已确认是另一个公众号，已阻止发送', 'MP_ACCOUNT_MISMATCH')
    if (identity === 'verified') identityMissingSince = null
    else identityMissingSince ??= Date.now()
    return identity
  }
  async function requireIdentity() {
    const deadline = Date.now() + identityWait
    do {
      signal?.throwIfAborted()
      if (closed || interrupted || contents.isDestroyed()) throw error('本次微信发送窗口已停止', 'WX_PUBLICATION_STOPPED')
      if (await readIdentityState() === 'verified') return
      if (identity === 'login_required') break
      await new Promise(resolve => setTimeout(resolve, 100))
    } while (Date.now() < deadline)
    throw error(identity === 'login_required' ? '微信要求重新验证登录，未提交发送' : '微信窗口身份暂时无法核实，未提交发送；请等待页面恢复或在微信窗口核对',
      identity === 'login_required' ? 'MP_LOGIN_REQUIRED' : 'MP_IDENTITY_UNAVAILABLE')
  }
  async function inspect(observeOnly) {
    const result = await contents.executeJavaScript(`(${nativePublicationStep.toString()})(${JSON.stringify({ step: phase, massNotify, observeOnly })})`, false)
    observed = result.diagnostics || observed
    return result
  }
  function manual(state, message, code) {
    try { return onManual({ state, message, code, diagnostics: diagnostics() }) }
    catch { throw error('本地发送状态无法记录，已停止后续步骤，请核对结果', 'WX_PUBLICATION_STATE_UNAVAILABLE') }
  }
  async function currentDraft() {
    if (locationState() !== 'editor') throw error('微信窗口不在本次草稿，未自动发送', 'MP_DRAFT_MISMATCH')
    await requireIdentity()
    return parseEditorDraft(await contents.executeJavaScript(EDITOR_DATA, false), String(draftId))
  }
  function stop(failure) {
    if (closed || interrupted) return
    interrupted = true
    failure.diagnostics = diagnostics()
    failure.nativeDispatchAttempted = requestReleased
    void Promise.resolve(onInterrupted(failure)).catch(() => {})
  }
  async function handleMessage(_event, method, params) {
    if (closed) return
    if (method === 'Fetch.requestPaused') {
      let details
      try { details = finalRequest(params.request) }
      catch (failure) { await debugger_.sendCommand('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Aborted' }); stop(failure); return }
      if (!details) { await debugger_.sendCommand('Fetch.continueRequest', { requestId: params.requestId }); return }
      let releaseAttempted = false
      try {
        if (sent || details.draftId !== String(draftId) || details.massNotify !== massNotify) throw error('微信稿件、通知范围或重复请求与本次指令不符，已阻止发送', 'WX_PUBLICATION_SCOPE_MISMATCH')
        sent = true
        requiresNativeRetry = false
        if (locationState() !== 'editor') throw error('微信窗口已离开本次稿件，未提交发送', 'MP_DRAFT_MISMATCH')
        await requireIdentity()
        if (closed || interrupted) throw error('发送窗口已停止，未继续请求', 'WX_PUBLICATION_STOPPED')
        if (!params.networkId) throw error('无法跟踪微信发送结果，已阻止请求', 'WX_RECEIPT_UNAVAILABLE')
        await beforeDispatch()
        if (closed || interrupted) throw error('发送窗口已停止，未继续请求', 'WX_PUBLICATION_STOPPED')
        captured.add(params.networkId)
        // From this point a failed CDP acknowledgement may still mean the request escaped.
        releaseAttempted = true
        requestReleased = true
        progress()
        await debugger_.sendCommand('Fetch.continueRequest', { requestId: params.requestId })
      } catch (failure) {
        await debugger_.sendCommand('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Aborted' }).catch(() => {})
        if (!releaseAttempted && ['MP_IDENTITY_UNAVAILABLE','MP_LOGIN_REQUIRED','MP_DRAFT_MISMATCH'].includes(failure.code)) {
          sent = false
          requiresNativeRetry = true
          manual(failure.code === 'MP_LOGIN_REQUIRED' ? 'waiting_verification' : 'waiting_confirmation', failure.message, failure.code)
        } else stop(failure)
      }
    } else if (method === 'Network.loadingFinished' && captured.has(params.requestId)) {
      captured.delete(params.requestId)
      try {
        const body = await debugger_.sendCommand('Network.getResponseBody', { requestId: params.requestId })
        const value = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body)
        const code = Number(value.base_resp?.ret ?? value.ret ?? value.errcode)
        if (!Number.isInteger(code)) throw error('微信发送响应无法核实，请查询公众平台结果', 'WX_RESPONSE_UNREADABLE')
        if (code === 0) await onResult({ accepted: true, nativeMessageId: typeof value.msgid === 'string' ? value.msgid : Number.isSafeInteger(value.msgid) ? String(value.msgid) : null })
        else if ([45065,67017].includes(code)) throw error('微信提示已有相同内容发送，请先核对发表记录', 'WX_DUPLICATE_RESPONSE')
        else {
          sent = false
          await onResult({ accepted: false, code })
          manual([200008,53504].includes(code) ? 'waiting_verification' : 'waiting_confirmation', `微信未接受发送（${code}），请在微信窗口核对`, 'WX_RESPONSE_REJECTED')
        }
      } catch (failure) { stop(error(failure.code ? failure.message : '微信发送响应无法核实，请查询结果，不会自动重发', failure.code || 'WX_RESPONSE_UNREADABLE')) }
    } else if (method === 'Network.loadingFailed' && captured.has(params.requestId)) {
      captured.delete(params.requestId)
      stop(error('微信发送响应中断，结果待核实，不会自动重发', 'WX_RESPONSE_INTERRUPTED'))
    }
  }
  function message(...args) {
    const job = handleMessage(...args).catch(() => stop(error('微信发送请求跟踪暂时无法完成，请核对结果', 'WX_TRACKING_ERROR'))).finally(() => pending.delete(job))
    pending.add(job)
  }
  function detached() { if (!closed) stop(error('微信窗口的发送跟踪已中断，请核对结果', 'WX_TRACKING_INTERRUPTED')) }
  function destroyed() { if (!closed) stop(error('微信发送窗口已关闭', 'WX_WINDOW_CLOSED')) }
  async function advance() {
    if (closed || stepping || interrupted) return
    stepping = true
    try {
      const state = await readIdentityState()
      if (closed || interrupted) return
      const location = locationState()
      if (location === 'different_draft') throw error('微信窗口已切换到其他稿件，已阻止发送', 'MP_DRAFT_MISMATCH')
      const snapshot = await inspect(true)
      if (['waiting_confirmation','waiting_verification'].includes(snapshot.state)) {
        manual(snapshot.state, snapshot.message, snapshot.code)
        return
      }
      if (state !== 'verified' || location !== 'editor') {
        progress()
        if (state === 'login_required') manual('waiting_verification', '微信要求重新验证登录，未继续发送', 'MP_LOGIN_REQUIRED')
        else if (location === 'navigation') manual('waiting_confirmation', '微信已进入其他确认页面，未自动继续，请在微信窗口核对', 'WX_PUBLICATION_NAVIGATION')
        else if (Date.now() - identityMissingSince >= identityWait) manual('waiting_confirmation', '微信窗口身份暂时无法核实，未继续发送；请等待页面恢复或在微信窗口核对', 'MP_IDENTITY_UNAVAILABLE')
        return
      }
      if (requiresNativeRetry) {
        manual('waiting_confirmation', '身份已恢复；先前请求已被阻止，请在微信窗口重新确认，不会自动重发', 'WX_FINAL_REQUEST_BLOCKED')
        return
      }
      const result = await inspect(false)
      if (['clicked','settings_ready'].includes(result.state)) phase = 'settings'
      if (['settings_submitted','confirmation_ready'].includes(result.state)) phase = 'confirm'
      if (result.state === 'confirmed') phase = 'observe'
      if (['waiting_confirmation','waiting_verification'].includes(result.state)) manual(result.state, result.message, result.code)
      else progress()
    } catch (failure) {
      if (closed || interrupted) return
      if (['MP_ACCOUNT_MISMATCH','MP_DRAFT_MISMATCH','WX_PUBLICATION_STATE_UNAVAILABLE'].includes(failure.code)) stop(failure)
      else {
        identity = 'unavailable'
        identityMissingSince ??= Date.now()
        progress()
        if (Date.now() - identityMissingSince >= identityWait) manual('waiting_confirmation', '微信页面暂时无法读取，已暂停发送，请在微信窗口核对', 'WX_PAGE_UNAVAILABLE')
      }
    } finally { stepping = false }
  }
  try {
    if (debugger_.isAttached()) throw error('该微信窗口已有请求跟踪，未执行自动发送', 'WX_TRACKING_OCCUPIED')
    debugger_.attach('1.3')
    debugger_.on('message', message); debugger_.on('detach', detached); contents.once('destroyed', destroyed)
    await debugger_.sendCommand('Network.enable', { maxTotalBufferSize: 4 * 1024 * 1024, maxResourceBufferSize: 512 * 1024 })
    await debugger_.sendCommand('Fetch.enable', { patterns: [{ urlPattern: 'https://mp.weixin.qq.com/cgi-bin/masssend*', requestStage: 'Request' }] })
  } catch (failure) { if (!page.window.isDestroyed()) page.window.destroy(); throw failure }
  return {
    currentDraft, advance,
    start() { timer = setInterval(() => void advance(), 500); timer.unref(); void advance() },
    focus() { if (!page.window.isDestroyed()) { page.window.show(); page.window.focus() } },
    close() {
      return closing ||= (async () => {
        closed = true; clearInterval(timer)
        // Destroy on a separate event-loop turn, never inside a native debugger callback.
        await new Promise(resolve => setImmediate(resolve))
        if (!page.window.isDestroyed()) page.window.destroy()
        contents.removeListener('destroyed', destroyed)
        debugger_.removeListener('message', message); debugger_.removeListener('detach', detached)
        await Promise.allSettled([...pending])
      })()
    },
  }
}
module.exports = { createNativePublicationPage, finalRequest }
