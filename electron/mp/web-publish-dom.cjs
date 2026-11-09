// Classify native dialogs before acting; page text alone never authorizes an unfamiliar confirmation.
function nativePublicationStep({ step, massNotify, observeOnly = false }) {
  const visible = element => element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
    && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[aria-hidden="true"]')
  const text = element => String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim()
  const modalSelector = '.weui-desktop-dialog,.dialog_wrp,[role="dialog"]'
  const allDialogs = [...document.querySelectorAll(modalSelector)].filter(visible)
  const dialogs = allDialogs.filter(element => !allDialogs.some(other => other !== element && element.contains(other)))
  const root = element => {
    if (!element) return null
    if (element.matches(modalSelector)) return element
    return element.closest(modalSelector) || [...element.querySelectorAll(modalSelector)].find(visible) || element
  }
  const notificationRow = [...document.querySelectorAll('.mass_send__notify')].find(visible)
  const settings = root(notificationRow) || root([...document.querySelectorAll('.new_mass_send_dialog')].find(visible))
  const doubleCheck = root([...document.querySelectorAll('.double_check_dialog,.double_check_container')].find(visible))
  const security = dialogs.find(element => /扫码|扫描.{0,20}二维码|安全验证|身份验证|手机.{0,20}确认|验证码|运营规则学习|人脸|开始答题/.test(text(element)))
  const processing = dialogs.find(element => /原创校验中|正在校验|正在加载|正在发表/.test(text(element))
    && !/超时|失败/.test(text(element)))
  const known = [settings, doubleCheck, security, processing].filter(Boolean)
  const unknown = dialogs.find(element => !known.some(item => item === element || item.contains(element) || element.contains(item)))
  const button = (element, labels) => element && [...element.querySelectorAll('button,.weui-desktop-btn')]
    .filter(visible).find(item => labels.includes(text(item)))
  const disabled = element => !element || element.disabled || element.getAttribute('aria-disabled') === 'true'
    || Boolean(element.closest('[aria-disabled="true"],.weui-desktop-switch_disabled,.weui-desktop-btn_disabled'))
    || /(?:^|\s)(?:disabled|btn_disabled|weui-desktop-(?:btn|switch)_disabled|weui-desktop-btn_loading)(?:\s|$)/.test(element.className)
  const click = element => { if (disabled(element)) return false; element.click(); return true }
  const toggle = element => {
    if (!element) return null
    const control = element.querySelector('input[type="checkbox"],[role="switch"],.weui-desktop-switch')
    if (!control) return null
    const input = control.matches('input') ? control : control.querySelector('input[type="checkbox"]')
    const aria = control.getAttribute('aria-checked')
    const checked = input ? input.checked : aria === 'true' ? true : aria === 'false' ? false
      : /weui-desktop-switch_on|weui-desktop-switch_checked/.test(control.className) ? true
        : /weui-desktop-switch/.test(control.className) ? false : null
    return { element: input || control, checked }
  }
  const notify = toggle(settings?.querySelector('.mass_send__notify'))
  const diagnostics = { dialog: security ? 'security' : unknown ? 'unknown' : doubleCheck ? 'confirmation' : settings ? 'settings' : processing ? 'processing' : 'none',
    notification: typeof notify?.checked === 'boolean' ? notify.checked : null,
    settingsVisible: Boolean(settings), confirmationVisible: Boolean(doubleCheck), unknownDialog: Boolean(unknown) }
  const result = (state, message = '', code = '') => ({ state, ...(message ? { message } : {}), ...(code ? { code } : {}), diagnostics })
  if (security) return result('waiting_verification', '微信要求安全验证，请在微信窗口或手机上完成确认', 'WX_SECURITY_VERIFICATION')
  if (unknown) return result('waiting_confirmation', '微信显示未识别的额外确认，已暂停，请在微信窗口核对', 'WX_UNKNOWN_CONFIRMATION')
  if (observeOnly) return result(processing ? 'processing' : 'observed')
  if (step === 'open') {
    if (!document.documentElement.hasAttribute('data-oa-publication-guard')) {
      const guard = event => { if (!event.target.closest?.(modalSelector)) event.preventDefault() }
      const protect = current => { current.addEventListener('beforeinput', guard, true); current.addEventListener('paste', guard, true); current.addEventListener('drop', guard, true) }
      protect(document)
      for (const frame of document.querySelectorAll('iframe')) { try { if (frame.contentDocument) protect(frame.contentDocument) } catch {} }
      document.documentElement.setAttribute('data-oa-publication-guard', 'true')
    }
    if (settings) return result('settings_ready')
    if (doubleCheck) return result('confirmation_ready')
    if (processing) return result('processing')
    return click(document.querySelector('#js_send button.mass_send')) ? result('clicked') : result('processing')
  }
  if (step === 'settings') {
    if (doubleCheck) return result('confirmation_ready')
    if (!settings) return result('processing')
    if (!notify || notify.checked === null) return result('waiting_confirmation', '无法核实微信原生群发开关，未自动发送，请在微信窗口核对', 'WX_NOTIFICATION_UNAVAILABLE')
    if (notify.checked !== massNotify) return click(notify.element) ? result('changed')
      : result('waiting_confirmation', '微信不允许切换当前群发方式，未发送', 'WX_NOTIFICATION_DISABLED')
    const group = toggle(settings.querySelector('.group_setting'))
    if (group?.checked) return click(group.element) ? result('changed')
      : result('waiting_confirmation', '无法关闭微信分组发送，未发送', 'WX_RECIPIENT_FILTER')
    const timer = [...settings.querySelectorAll('.publish_container')].find(element => /定时发表/.test(text(element)))
    const timed = toggle(timer)
    if (timed?.checked) return click(timed.element) ? result('changed')
      : result('waiting_confirmation', '无法关闭微信定时设置，未发送', 'WX_SCHEDULE_ENABLED')
    return click(button(settings.querySelector('.mass-send__footer') || settings, ['发表']))
      ? result('settings_submitted') : result('processing')
  }
  if (step === 'confirm') {
    if (doubleCheck) {
      const notice = text(doubleCheck.querySelector('.weui-desktop-msg'))
      const matches = massNotify ? /已开启群发通知/.test(notice) && !/未开启群发通知/.test(notice) : /未开启群发通知/.test(notice)
      if (!matches) return result('waiting_confirmation', '微信确认的群发方式与本次指令不一致，未发送', 'WX_NOTIFICATION_MISMATCH')
      return click(button(doubleCheck, ['继续发表'])) ? result('confirmed') : result('processing')
    }
    return result('processing')
  }
  return result('processing')
}
module.exports = { nativePublicationStep }
