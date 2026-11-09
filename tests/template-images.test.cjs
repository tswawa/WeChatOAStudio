const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createOpsStore } = require('../electron/ops/store.cjs')
const { cleanTemplateHtml, templateMarkdown, applyTemplate } = require('../electron/ops/content.cjs')
const { normalizeTemplate } = require('../electron/ops/tasks.cjs')
const { templateImageSource, prepareTemplateImage } = require('../electron/ops/template-images.cjs')
const { createSettingsStore } = require('../electron/ops/settings.cjs')
const png = fs.readFileSync(path.join(__dirname, '../electron/assets/app-icon.png'))
const src = 'data:image/png;base64,' + png.toString('base64')
const encryption = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: value => value.toString() }

test('template HTML retains raster examples, alt text, image layout and safe external images but strips executable content', () => {
  const html = cleanTemplateHtml(`<p>Before</p><img src="${src}" alt="Example &amp; subject" style="width:65%;height:auto;margin:12px auto" onerror="alert(1)"><p>After</p>`
    + '<img src="https://images.example.com/photo.png"><script>alert(1)</script>')
  assert.match(html, /data:image\/png;base64,/)
  assert.match(html, /width:65%/)
  assert.match(html, /Example &amp; subject/)
  assert.match(html, /https:\/\/images.example.com/)
  assert.doesNotMatch(html, /onerror|<script/)
  for (const unsafe of ['data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)', 'file:///C:/secret.png', 'http://127.0.0.1/private', 'data:image/png;base64,YmFk']) {
    assert.throws(() => templateImageSource(unsafe))
    assert.doesNotMatch(cleanTemplateHtml(`<p>Text</p><img src="${unsafe}">`), /<img/)
  }
})

test('template image examples survive saving and reopening without uploading or relying on a temporary file', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-template-images-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const filename = path.join(directory, 'templates.sqlite')
  let store = createOpsStore(filename)
  const value = normalizeTemplate({ name: 'Image example', html: `<p>Before</p><img src="${src}" alt="Article subject" style="width:70%"><p>After</p>` }, null, 'a')
  store.put('templates', 'a', value)
  store.close()
  store = createOpsStore(filename)
  try {
    assert.equal(store.get('templates', 'a', value.id).html, value.html)
    assert.equal(store.list('templates', 'b').length, 0)
  } finally { store.close() }
})

test('the Bot sees image positions and descriptions, not data URLs or instructions to reuse example photos', async () => {
  const sample = await templateMarkdown(`<h2>Heading</h2><p>Before</p><img src="${src}" alt="Subject overview"><p>After</p>`
    + `<p>Closing <img src="${src}" alt="Closing image"></p>`)
  assert.match(sample, /【配图位置 1：Subject overview】/)
  assert.match(sample, /【配图位置 2：Closing image】/)
  assert.ok(sample.indexOf('Before') < sample.indexOf('配图位置 1') && sample.indexOf('配图位置 1') < sample.indexOf('After'))
  assert.doesNotMatch(sample, /data:image|base64/)
})

test('article images inherit template image width and spacing without copying example image data', async () => {
  const result = await applyTemplate('<section><p>New text</p><img src="https://example.com/new-reviewed-image.png"></section>',
    `<p style="text-indent:2em">Example</p><img src="${src}" style="width:70%;margin:24px auto;border-radius:4px">`)
  assert.match(result, /width:70%/)
  assert.match(result, /margin:24px auto/)
  assert.match(result, /height:auto/)
  assert.match(result, /new-reviewed-image/)
  assert.doesNotMatch(result, /data:image/)
})

test('template images are validated and normalized without any network or account write', async () => {
  const image = await prepareTemplateImage({ bytes: [...png], mimeType: 'image/png', name: 'example.png' }, async bytes => ({ bytes, width: 512, height: 512 }))
  assert.equal(image.src, src)
  assert.equal(image.alt, 'example')
  assert.equal(image.width, 512)
  await assert.rejects(prepareTemplateImage({ bytes: [-1], mimeType: 'image/png' }), /8MB/)
  await assert.rejects(prepareTemplateImage({ bytes: [256], mimeType: 'image/png' }), /8MB/)
})

test('default image directory is supplied by the application location while existing chosen directories survive', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-image-directory-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const filename = path.join(directory, 'settings.json')
  const imageDirectory = path.join(directory, 'Application', 'ArticleImages')
  let settings = createSettingsStore(filename, encryption, { imageDirectory })
  assert.equal(settings.get().images.downloadDirectory, imageDirectory)
  const selected = path.join(directory, 'AuthorFolder')
  const legacyImageDirectory = path.join(directory, 'Pictures', 'WeChatOAStudio', 'ArticleImages')
  settings.save({ images: { downloadDirectory: legacyImageDirectory } })
  assert.equal(createSettingsStore(filename, encryption, { imageDirectory, legacyImageDirectory }).get().images.downloadDirectory, imageDirectory)
  settings.save({ images: { downloadDirectory: selected } })
  settings = createSettingsStore(filename, encryption, { imageDirectory, legacyImageDirectory })
  assert.equal(settings.get().images.downloadDirectory, selected)
  settings.save({ images: { downloadDirectory: '' } })
  assert.equal(createSettingsStore(filename, encryption, { imageDirectory }).get().images.downloadDirectory, imageDirectory)
})
