const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createOpsStore } = require('../ops/store.cjs')
const { createSettingsStore } = require('../ops/settings.cjs')
const { normalizeBot } = require('./config.cjs')
const { createMemory } = require('./memory.cjs')
const { createChat } = require('../ops/chat.cjs')
const { createServer } = require('node:http')
const { modelResponse } = require('../../tests/helpers/model-response.cjs')
const { initializeBotPreset, FACTORY_MEMORIES } = require('./preset.cjs')

const encryption = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text).map(byte => byte ^ 123),
  decryptString: value => Buffer.from(value).map(byte => byte ^ 123).toString() }
function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-preset-'))
  const dbPath = path.join(directory, 'ops.sqlite')
  const settingsPath = path.join(directory, 'settings.json')
  const store = createOpsStore(dbPath)
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  return { directory, dbPath, settingsPath, store, memory: createMemory(store) }
}

test('factory identity is editable and an explicitly saved blank is retained across reopening', t => {
  const f = setup(t)
  const settings = createSettingsStore(f.settingsPath, encryption)
  assert.equal(settings.get().bot.name, '小微')
  assert.ok(settings.get().bot.instructions.length > 100)
  assert.match(settings.get().bot.instructions, /写文章时默认自行联网搜索、挑选并添加至少一张/)
  assert.match(settings.get().bot.instructions, /短文同样适用/)
  assert.match(settings.get().bot.instructions, /作者明确要求纯文字、不配图或指定图片时，优先遵从当前要求/)
  assert.match(settings.get().bot.instructions, /优先从社交媒体.*原始发布.*新闻媒体.*原创报道/)
  assert.match(settings.get().bot.instructions, /核对发布时间、事件背景和关键信息/)
  settings.save({ bot: { name: '作者自定义助手', instructions: '只用简短段落。' } })
  const reopened = createSettingsStore(f.settingsPath, encryption)
  assert.equal(reopened.get().bot.name, '作者自定义助手')
  assert.equal(reopened.get().bot.instructions, '只用简短段落。')
  reopened.save({ bot: { instructions: '' } })
  assert.equal(createSettingsStore(f.settingsPath, encryption).get().bot.instructions, '')
})

test('legacy custom identity and encrypted model credentials are not overwritten by factory presets', t => {
  const f = setup(t)
  fs.writeFileSync(f.settingsPath, JSON.stringify({ bot: { name: 'Existing Name', instructions: 'Existing author rules.' },
    model: { name: 'existing-model', encryptedKey: encryption.encryptString('secret-key').toString('base64') } }))
  const settings = createSettingsStore(f.settingsPath, encryption)
  assert.equal(settings.get().bot.name, 'Existing Name')
  assert.equal(settings.get().bot.instructions, 'Existing author rules.')
  assert.equal(settings.private().model.apiKey, 'secret-key')
  assert.equal(settings.get().model.apiKey, undefined)
})

test('legacy empty identity receives starter instructions once without changing its custom name', t => {
  const f = setup(t)
  fs.writeFileSync(f.settingsPath, JSON.stringify({ bot: { name: 'Existing Name', instructions: '' }, model: {} }))
  const settings = createSettingsStore(f.settingsPath, encryption)
  assert.equal(settings.get().bot.name, 'Existing Name')
  assert.ok(settings.get().bot.instructions.length > 100)
  settings.save({ bot: { instructions: '' } })
  assert.equal(createSettingsStore(f.settingsPath, encryption).get().bot.instructions, '')
})

test('starter memories initialize once and edits or deletions survive database reopening', t => {
  const f = setup(t)
  assert.equal(initializeBotPreset(f.store, 'a'), true)
  assert.equal(f.memory.list('a').length, FACTORY_MEMORIES.length)
  assert.equal(f.memory.list('a').every(item => item.source === 'preset'), true)
  const [edit, remove] = f.memory.list('a')
  f.memory.save('a', { id: edit.id, content: '作者自己的编辑偏好。' })
  f.memory.remove('a', remove.id)
  assert.equal(initializeBotPreset(f.store, 'a'), false)
  const reopened = createOpsStore(f.dbPath)
  try {
    assert.equal(initializeBotPreset(reopened, 'a'), false)
    const memory = createMemory(reopened)
    assert.equal(memory.list('a').length, FACTORY_MEMORIES.length - 1)
    assert.equal(memory.list('a').find(item => item.id === edit.id).content, '作者自己的编辑偏好。')
    assert.equal(memory.list('a').some(item => item.id === remove.id), false)
  } finally { reopened.close() }
})

test('existing author memories remain untouched and presets are isolated by account', t => {
  const f = setup(t)
  const custom = f.memory.save('a', { title: 'Author', content: 'Do not replace my preferences.' })
  assert.equal(initializeBotPreset(f.store, 'a'), false)
  assert.deepEqual(f.memory.list('a').map(item => item.id), [custom.id])
  assert.equal(initializeBotPreset(f.store, 'b'), true)
  assert.equal(f.memory.list('b').length, FACTORY_MEMORIES.length)
  assert.equal(f.memory.list('b').some(item => item.id === custom.id), false)
})

test('disabling memory prevents initial seeding until the author enables it', t => {
  const f = setup(t)
  assert.equal(initializeBotPreset(f.store, 'a', { memoryEnabled: false }), false)
  assert.equal(f.memory.list('a').length, 0)
  assert.equal(initializeBotPreset(f.store, 'a', { memoryEnabled: true }), true)
})

test('legacy factory licensing text is removed without replacing author edits or restoring deleted memories', t => {
  const f = setup(t)
  const current = FACTORY_MEMORIES.find(item => item.title === '配图与素材偏好')
  const legacy = `${current.content}保留真实来源，使用授权与视觉安全分别核实。`
  for (const account of ['a', 'b', 'c', 'd']) f.store.claimMarker(account, 'bot-factory-memories-v1')
  const original = f.memory.save('a', { title: current.title, content: legacy, pinned: false }, 'preset')
  const edited = f.memory.save('b', { title: current.title, content: legacy + '作者增加的规则。' }, 'preset')
  const authored = f.memory.save('c', { title: current.title, content: legacy }, 'user')
  for (const account of ['a', 'b', 'c', 'd']) initializeBotPreset(f.store, account, { memoryEnabled: false })
  const migrated = f.memory.list('a')[0]
  assert.equal(migrated.content, current.content)
  for (const field of ['id', 'source', 'title', 'createdAt', 'pinned']) assert.equal(migrated[field], original[field])
  assert.deepEqual(f.memory.list('b'), [edited])
  assert.deepEqual(f.memory.list('c'), [authored])
  assert.deepEqual(f.memory.list('d'), [])
  for (const account of ['a', 'b', 'c', 'd']) initializeBotPreset(f.store, account)
  assert.equal(f.memory.list('a').length, 1)
  assert.equal(f.memory.list('d').length, 0)
  assert.doesNotMatch(FACTORY_MEMORIES.map(item => item.content).join('\n'), /使用授权|核实授权/)
})

test('editable writing and source preferences reach desktop and scheduled prompts without becoming system mandates', async t => {
  const f = setup(t)
  const seen = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    seen.push(JSON.parse(Buffer.concat(chunks).toString()).messages[0].content)
    modelResponse(response, { role: 'assistant', content: '已收到。' })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const settings = createSettingsStore(f.settingsPath, encryption)
  settings.save({ model: { name: 'test-current', apiKey: 'local-test-key',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1` } })
  const chat = createChat({ store: f.store, settings, mp: {}, notify() {}, getAccount: () => ({ name: 'Account' }), act: async () => {} })
  t.after(() => chat.close())
  await chat.send('a', { text: '查看我的写稿偏好，不执行写稿。' })
  await chat.sendScheduled('a', { taskId: 'task-1', taskName: 'Preferences', runId: 'run-1', text: '查看我的资讯来源偏好，不执行写稿。' })
  for (const prompt of seen) {
    assert.match(prompt, /写文章时默认自行联网搜索、挑选并添加/)
    assert.match(prompt, /优先从社交媒体.*新闻媒体/)
    assert.match(prompt, /配图优先围绕文章主题搜索相关内容.*打开相关报道、帖子和原始发布页面/)
    assert.match(prompt, /图片搜索作为补充，不作为唯一入口，也不要求图片本身被图片搜索引擎收录/)
    assert.match(prompt, /作者明确要求纯文字、不配图或指定图片时，优先遵从当前要求/)
  }
  settings.save({ bot: { instructions: '作者要求：只写纯文字，优先查阅论文。' } })
  await chat.send('a', { text: '查看修改后的偏好。' })
  assert.match(seen.at(-1), /作者要求：只写纯文字，优先查阅论文/)
  assert.doesNotMatch(seen.at(-1), /写文章时默认自行联网搜索、挑选并添加|优先从社交媒体|配图优先围绕文章主题搜索相关内容|图片搜索作为补充/)
  settings.save({ bot: { instructions: '' } })
  await chat.send('a', { text: '查看清空后的偏好。' })
  assert.doesNotMatch(seen.at(-1), /写文章时默认自行联网搜索、挑选并添加|优先从社交媒体|优先查阅论文/)
  assert.equal(createSettingsStore(f.settingsPath, encryption).get().bot.instructions, '')
})

test('a new public install persists the content-first image preference and preserves subsequent author edits', t => {
  const f = setup(t)
  const defaults = createSettingsStore(f.settingsPath, encryption)
  const rules = defaults.get().bot.instructions
  assert.match(rules, /配图优先围绕文章主题搜索相关内容/)
  assert.match(rules, /结合正文寻找所需原图/)
  assert.match(rules, /图片搜索作为补充，不作为唯一入口/)
  assert.equal(createSettingsStore(f.settingsPath, encryption).get().bot.instructions, rules)
  defaults.save({ bot: { instructions: '作者要求：只使用我提供的图片。' } })
  assert.equal(createSettingsStore(f.settingsPath, encryption).get().bot.instructions, '作者要求：只使用我提供的图片。')
})

test('the model-call default is 256 but the program does not impose a fixed upper bound on author settings', t => {
  const f = setup(t)
  const settings = createSettingsStore(f.settingsPath, encryption)
  assert.equal(normalizeBot().maxSteps, 256)
  assert.equal(settings.get().bot.maxSteps, 256)
  assert.equal(normalizeBot({ maxSteps: 256 }).maxSteps, 256)
  assert.equal(normalizeBot({ maxSteps: 1024 }).maxSteps, 1024)
  for (const value of [0, 1.5, Infinity]) assert.throws(() => normalizeBot({ maxSteps: value }), /整数/)
  settings.save({ bot: { maxSteps: 256 } })
  assert.equal(createSettingsStore(f.settingsPath, encryption).get().bot.maxSteps, 256)
  settings.save({ bot: { maxSteps: 64 } })
  settings.save({ search: { engines: ['bing'] } })
  assert.equal(createSettingsStore(f.settingsPath, encryption).get().bot.maxSteps, 64)
})

test('configured search sources keep custom order across unrelated model saves and reopening', t => {
  const f = setup(t)
  const settings = createSettingsStore(f.settingsPath, encryption)
  settings.save({ search: { engines: ['google', 'baidu', 'yandex'] } })
  settings.save({ model: { name: 'another-model' } })
  assert.deepEqual(createSettingsStore(f.settingsPath, encryption).get().search.engines, ['google', 'baidu', 'yandex'])
  assert.throws(() => settings.save({ search: { engines: [] } }))
})
