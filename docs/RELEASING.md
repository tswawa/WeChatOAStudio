# 发布指南

## 发布前检查

1. 在独立目录检出源码，运行 `npm ci`。
2. 运行 `npm run test:desktop` 和 `npm run build`。
3. 检查生产依赖与开发依赖审计结果，分别记录。
4. 对准备提交的源码进行凭据扫描，人工复核测试中的占位数据。
5. 运行 `npm run desktop:installer` 构建 Windows 安装器。
6. 检查 `release/win-unpacked` 与 `resources/app.asar`，确认只包含应用文件和依赖。
7. 使用隔离应用数据目录检查首次启动、空账号状态、默认模型设置和原生模块加载。
8. 将源码、免安装目录分别压缩，生成 SHA-256 校验清单。

## GitHub 文件安排

源码提交到仓库，安装器与压缩包上传到版本 Release。GitHub 对普通 Git 文件设有大小限制，安装包使用 Releases 保存。

```powershell
git push origin main
gh release create v0.3.14 --draft --target main --title "v0.3.14" --notes-file RELEASE_NOTES.md
gh release upload v0.3.14 .\release-assets\WeChatOAStudio-Setup-0.3.14.exe .\release-assets\WeChatOAStudio-0.3.14-win-x64.zip .\release-assets\WeChatOAStudio-0.3.14-source.zip .\release-assets\SHA256SUMS.txt
```

上传后下载 Release 文件，对照本机校验值检查，再发布草稿。

## 包体检查

源码与安装包应排除这些内容：

- 用户数据目录、SQLite 数据库与 WAL 文件。
- Cookie、Local State、浏览器会话分区和登录凭据。
- 模型密钥、公众号 AppSecret、真实设置和发表回执。
- 聊天、模板实例、文章配图、附件、测试截图与日志。
- 旧安装包、调试服务、测试证书以及现场联调脚本。

保留依赖要求的许可证、Chromium 通知文件和 sharp/libvips 的原生组件。便携包中的应用目录需要完整分发。

## 验证范围

受控端点测试、首次启动检查和真实账号发表分别记录。微信出现管理员验证时由本人完成，最终发表成功以微信回执确认。Release 说明只列出已经验证的内容。
