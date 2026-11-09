// 将主进程日志写入本机文件，启动终端退出后也不会因控制台管道断开而崩溃。
const { appendFileSync, mkdirSync, renameSync, statSync, existsSync, rmSync } = require('node:fs');
const { dirname } = require('node:path');
const { format } = require('node:util');

function installLogging(filename) {
  mkdirSync(dirname(filename), { recursive: true });
  const original = {};
  let fileError = null;
  const clean = (value) => value
    .replace(/([?&](?:token|ticket|access_token|tempkey)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]');
  function write(level, values) {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${clean(format(...values))}\n`;
    try {
      if (existsSync(filename) && statSync(filename).size > 2 * 1024 * 1024) {
        if (existsSync(`${filename}.1`)) rmSync(`${filename}.1`);
        renameSync(filename, `${filename}.1`);
      }
      appendFileSync(filename, line, { encoding: 'utf8', mode: 0o600 });
      fileError = null;
    } catch (error) {
      // 不再向可能已断开的 stdout/stderr 写错误；保留错误供启动诊断读取。
      fileError = error;
    }
  }
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    original[level] = console[level];
    console[level] = (...values) => write(level, values);
  }
  const streamError = (error) => write(error.code === 'EPIPE' ? 'info' : 'error',
    ['控制台输出流已关闭', error.code || error.name]);
  process.stdout.on('error', streamError);
  process.stderr.on('error', streamError);
  return { getError: () => fileError, restore() {
    Object.assign(console, original);
    process.stdout.removeListener('error', streamError);
    process.stderr.removeListener('error', streamError);
  } };
}

module.exports = { installLogging };
