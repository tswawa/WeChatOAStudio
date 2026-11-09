# 贡献指南

## 开发环境

使用 Windows x64 和 Node.js 24。通过 `npm ci` 安装锁定的依赖，再运行桌面应用：

```powershell
npm ci
npm run desktop
```

`npm run desktop` 构建前端并启动 Electron。调试浏览器演示页面可使用 `npm run dev`。

## 测试

```powershell
npm run test:desktop
npm run build
```

桌面测试通过 Electron 自带的 Node 执行，以匹配 better-sqlite3 的原生 ABI。与模型、微信发送和会话有关的改动，需要同时覆盖错误结果、取消和重复操作。

测试使用临时目录、模拟账号和受控端点。提交测试前检查临时文件与日志，真实公众号的上传、保存、回复和发表需要账号作者的本次授权。

## 提交改动

1. 创建分支，保持改动范围集中。
2. 补充对应测试，并运行测试与前端构建。
3. 检查提交文件，排除账号数据库、浏览器会话、模型配置、附件、配图缓存和日志。
4. 在 Pull Request 中说明修改内容、复现步骤、测试结果和兼容性影响。

新增依赖时提交 `package.json` 和 `package-lock.json`，说明用途与许可证。开发调试端口、测试证书例外和真实账号数据应留在本机。
