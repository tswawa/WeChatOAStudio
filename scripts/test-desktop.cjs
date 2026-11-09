// 用 Electron 自带的 Node 运行桌面测试，确保原生 SQLite 与实际应用使用同一 ABI。
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { readdirSync } = require('node:fs');
const electron = require('electron');

const testDirectory = join(__dirname, '../tests');
const directories = [testDirectory, join(__dirname, '../electron/ops'),
  join(__dirname, '../electron/mp'), join(__dirname, '../electron/bot')];
const testFiles = directories.flatMap((directory) => readdirSync(directory)
  .filter((name) => name.endsWith('.test.cjs'))
  .map((name) => join(directory, name)));
const result = spawnSync(electron, ['--test', ...testFiles], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) {
  console.error('桌面测试无法启动：', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
