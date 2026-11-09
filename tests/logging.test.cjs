// 复现启动终端关闭后 stdout/stderr 管道断开，确认主进程日志仍落盘并脱敏。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { once } = require('node:events')

test('logger survives closed output pipes and retains reason without credentials', { timeout: 10000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'mp-logging-'))
  const log = join(directory, 'app.log')
  const modulePath = join(__dirname, '../electron/logging.cjs')
  const source = `
    const { installLogging } = require(${JSON.stringify(modulePath)});
    installLogging(process.argv[1]);
    process.send('ready');
    process.once('message', () => {
      process.stdout.write('closed stdout write');
      process.stderr.write('closed stderr write');
      console.error('reason=MODEL_NOT_CONFIGURED',
        'https://mp.weixin.qq.com/page?token=secret-token&access_token=secret-access',
        'Bearer secret-bearer');
      setTimeout(() => { console.info('still-alive'); process.disconnect(); }, 100);
    });
  `
  const child = spawn(process.execPath, ['-e', source, log], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  })
  t.after(() => {
    if (child.exitCode === null) child.kill()
    rmSync(directory, { recursive: true, force: true })
  })
  const exit = once(child, 'exit')
  await once(child, 'message')
  child.stdout.destroy()
  child.stderr.destroy()
  await new Promise((resolve) => setTimeout(resolve, 50))
  child.send('write-after-close')
  const [code, signal] = await exit
  assert.equal(code, 0)
  assert.equal(signal, null)
  const contents = readFileSync(log, 'utf8')
  assert.match(contents, /reason=MODEL_NOT_CONFIGURED/)
  assert.match(contents, /still-alive/)
  assert.match(contents, /EPIPE/)
  assert.match(contents, /\[redacted\]/)
  for (const secret of ['secret-token', 'secret-access', 'secret-bearer']) {
    assert.equal(contents.includes(secret), false)
  }
})
