// 用 Windows safeStorage 加密保存公众号登录账号密码，仅主进程可读，界面只拿到是否已保存与登录名。
const { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } = require('node:fs')
const { dirname } = require('node:path')

const ATTEMPT_INTERVAL = 30 * 60 * 1000
const ATTEMPT_WINDOW = 24 * 60 * 60 * 1000
const MAX_ATTEMPTS = 3

function createCredentialStore(filename, encryption = require('electron').safeStorage) {
  let saved = {}
  if (existsSync(filename)) {
    try {
      const value = JSON.parse(readFileSync(filename, 'utf8'))
      if (value && typeof value === 'object' && !Array.isArray(value)) saved = value
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      console.warn('自动登录资料无法读取，已忽略')
    }
  }
  function persist() {
    mkdirSync(dirname(filename), { recursive: true })
    writeFileSync(`${filename}.tmp`, JSON.stringify(saved, null, 2), { mode: 0o600 })
    renameSync(`${filename}.tmp`, filename)
  }
  function save(id, { account, password } = {}) {
    if (!encryption.isEncryptionAvailable()) throw new Error('Windows 密钥加密暂不可用，无法保存密码')
    const login = typeof account === 'string' ? account.trim() : ''
    if (!login || login.length > 100) throw new Error('请填写公众号登录邮箱或微信号')
    if (typeof password !== 'string' || !password || password.length > 128) throw new Error('请填写登录密码')
    saved[id] = {
      account: login,
      password: encryption.encryptString(password).toString('base64'),
      savedAt: Date.now(), failure: '', attempts: attempts(id),
    }
    persist()
    return status(id)
  }
  function get(id) {
    const item = saved[id]
    if (!item?.password) return null
    try {
      return { account: item.account, password: encryption.decryptString(Buffer.from(item.password, 'base64')) }
    } catch (error) {
      console.warn('自动登录密码无法解密', error.name)
      return null
    }
  }
  function attempts(id, now = Date.now()) {
    return (Array.isArray(saved[id]?.attempts) ? saved[id].attempts : [])
      .filter(value => Number.isSafeInteger(value) && value > now - ATTEMPT_WINDOW)
      .sort((a, b) => a - b).slice(-MAX_ATTEMPTS)
  }
  function nextAttemptAt(id, now = Date.now()) {
    const recent = attempts(id, now)
    return Math.max(recent.length ? recent.at(-1) + ATTEMPT_INTERVAL : 0,
      recent.length >= MAX_ATTEMPTS ? recent[0] + ATTEMPT_WINDOW : 0)
  }
  function canAttempt(id) {
    return Boolean(saved[id]?.password && !saved[id].failure && Date.now() >= nextAttemptAt(id))
  }
  function claimAttempt(id) {
    if (!canAttempt(id)) return false
    saved[id].attempts = [...attempts(id), Date.now()]
    persist()
    return true
  }
  function status(id) {
    const item = saved[id]
    return item ? { saved: true, account: item.account, failure: item.failure || '', nextAttemptAt: nextAttemptAt(id) } : { saved: false }
  }
  function markFailed(id, failure) {
    if (!saved[id]) return
    saved[id].failure = String(failure || '').slice(0, 120)
    persist()
  }
  function clearFailure(id) {
    if (!saved[id]?.failure) return
    saved[id].failure = ''
    persist()
  }
  function remove(id) {
    if (!saved[id]) return
    delete saved[id]
    persist()
  }
  return { save, get, status, markFailed, clearFailure, remove, canAttempt, claimAttempt }
}

module.exports = { createCredentialStore }
