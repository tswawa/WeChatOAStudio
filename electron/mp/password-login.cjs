// 在公众平台官方登录页切换到账号登录并填写、提交保存的账号密码；后续安全验证仍由用户在微信完成。

const { isMpUrl } = require('./identity.cjs')

// 运行在微信登录页内：未显示账号表单时先切换，表单就绪后填写并点击登录
function fillPage(account, password) {
  const visible = (element) => element && element.getClientRects().length > 0
  const input = (name) => document.querySelector(`input[name="${name}"]`)
  if (!visible(input('account'))) {
    const link = [...document.querySelectorAll('a')]
      .find((element) => visible(element) && /^(使用)?账号登录$/.test((element.innerText || '').trim()))
    if (!link) return 'no-form'
    link.click()
    return 'switched'
  }
  for (const [name, value] of [['account', account], ['password', password]]) {
    const element = input(name)
    if (!visible(element)) return 'no-form'
    element.focus()
    element.value = value
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const button = document.querySelector('.btn_login')
  if (!visible(button)) return 'no-button'
  button.click()
  return 'submitted'
}

// 提交后的登录页状态：可见的失败提示（账号或密码不正确、操作频繁等），或已离开账号表单进入微信安全验证
function submittedState() {
  const visible = (element) => element && element.getClientRects().length > 0
  const text = [...document.querySelectorAll('body *')]
    .filter((element) => element.children.length === 0 && visible(element))
    .map((element) => (element.innerText || '').trim())
    .find((value) => value.length < 80 && /不正确|错误|频繁|冻结|锁定|异常|失败/.test(value))
  if (text) return { error: text }
  return { verify: !visible(document.querySelector('input[name="account"]')) }
}

function fillPasswordLogin(contents, { account, password }) {
  if (contents.isDestroyed()) return Promise.resolve('closed')
  if (!isMpUrl(contents.getURL())) return Promise.resolve('blocked')
  return contents.executeJavaScript(`(${fillPage.toString()})(${JSON.stringify(account)}, ${JSON.stringify(password)})`, false)
}

function readSubmittedState(contents) {
  if (contents.isDestroyed() || !isMpUrl(contents.getURL())) return Promise.resolve({})
  return contents.executeJavaScript(`(${submittedState.toString()})()`, false)
}

module.exports = { fillPasswordLogin, readSubmittedState }
