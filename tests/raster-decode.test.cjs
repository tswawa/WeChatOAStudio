// Exercise the real raster codec instead of stubbing image normalization.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const sharp = require('sharp')
const { imageSize } = require('image-size')
const { inspectRaster, normalizeRaster } = require('../electron/images/review.cjs')
const { createImageService } = require('../electron/images/index.cjs')
const { createOpsStore } = require('../electron/ops/store.cjs')
const { prepareTemplateImage } = require('../electron/ops/template-images.cjs')

const source = (width = 128, height = 96) => sharp({ create: { width, height, channels: 4, background: { r: 25, g: 85, b: 170, alpha: 0.5 } } })

for (const format of ['png', 'jpeg', 'webp']) test(`the actual codec decodes ${format} and produces a complete static PNG`, async () => {
  const bytes = await source().toFormat(format).toBuffer()
  const image = await normalizeRaster(bytes, `image/${format}`)
  assert.equal(image.mimeType, 'image/png')
  assert.deepEqual({ width: image.width, height: image.height }, { width: 128, height: 96 })
  assert.equal(imageSize(image.bytes).type, 'png')
  const raw = await sharp(image.bytes).raw().toBuffer({ resolveWithObject: true })
  assert.ok(raw.data.length >= 128 * 96 * 3)
  assert.equal(raw.info.width, 128)
  assert.equal(raw.info.height, 96)
})

test('WebP transparency survives normalization and a png-named CDN URL cannot change the actual byte encoding', async () => {
  const bytes = await source().webp({ lossless: true }).toBuffer()
  assert.equal(inspectRaster(bytes, 'image/webp').type, 'webp')
  const image = await normalizeRaster(bytes, 'image/webp')
  const { data, info } = await sharp(image.bytes).raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.channels, 4)
  assert.ok(data[3] >= 126 && data[3] <= 129)
  const genericType = await normalizeRaster(bytes, 'application/octet-stream')
  assert.equal(imageSize(genericType.bytes).type, 'png')
  await assert.rejects(normalizeRaster(bytes, 'image/png'), /类型与实际文件不一致/)
})

test('large valid images resize inside 1600 pixels without enlarging smaller sources', async () => {
  const bytes = await source(3200, 1600).webp().toBuffer()
  const image = await normalizeRaster(bytes, 'image/webp')
  assert.deepEqual({ width: image.width, height: image.height }, { width: 1600, height: 800 })
  assert.deepEqual(await sharp(image.bytes).metadata().then(value => ({ width: value.width, height: value.height })), { width: 1600, height: 800 })
})

test('EXIF orientation is applied before model review and is not left as hidden display metadata', async () => {
  const bytes = await source(128, 64).withMetadata({ orientation: 6 }).jpeg().toBuffer()
  const image = await normalizeRaster(bytes, 'image/jpeg')
  assert.deepEqual({ width: image.width, height: image.height }, { width: 64, height: 128 })
  assert.equal((await sharp(image.bytes).metadata()).orientation, undefined)
})

test('truncated WebP passes header recognition but fails full pixel decoding before it can be reviewed or saved', async () => {
  const bytes = await source().webp({ lossless: true }).toBuffer()
  const truncated = bytes.subarray(0, Math.max(32, Math.floor(bytes.length * 0.6)))
  assert.equal(imageSize(truncated).type, 'webp')
  await assert.rejects(normalizeRaster(truncated, 'image/webp'), error => error.code === 'IMAGE_DECODE_FAILED')
})

test('changing the decoder does not relax type, size, pixel limits or the static-image boundary', async () => {
  await assert.rejects(normalizeRaster(Buffer.from('<svg><script>invalid</script></svg>'), 'image/svg+xml'), /无法识别|只接受/)
  await assert.rejects(normalizeRaster(Buffer.alloc(8 * 1024 * 1024 + 1), 'image/png'), /8MB/)
  const png = await source().png().toBuffer()
  await assert.rejects(normalizeRaster(png, 'text/html'), /类型与实际文件不一致/)
  const excessive = Buffer.from(png)
  excessive.writeUInt32BE(5000, 16)
  excessive.writeUInt32BE(4000, 20)
  await assert.rejects(normalizeRaster(excessive, 'image/png'), /尺寸异常|解码后过大/)
  const frames = Buffer.concat([await source().raw().toBuffer(), await source().negate({ alpha: false }).raw().toBuffer()])
  const animated = await sharp(frames, { raw: { width: 128, height: 192, pageHeight: 96, channels: 4 } }).webp({ delay: [100, 100], loop: 0 }).toBuffer()
  assert.equal((await sharp(animated).metadata()).pages, 2)
  await assert.rejects(normalizeRaster(animated, 'image/webp'), /静态图片/)
})

function fixture(t, bytes, verdict = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-raster-codec-'))
  const store = createOpsStore(path.join(directory, 'ops.sqlite'))
  const imagesDirectory = path.join(directory, 'approved')
  const state = { reviews: 0, writes: 0, reviewedBytes: null, directory: imagesDirectory }
  const service = createImageService({ store, settings: { private: () => ({ model: { name: 'current-vision' }, images: { downloadDirectory: imagesDirectory } }) },
    mp: { uploadMaterial: async () => { state.writes += 1; throw new Error('Unexpected upload') } },
    searcher: async () => [{ imageUrl: 'https://cdn.example.com/example.png?image_process=resize,w_800', sourcePage: 'https://example.com/article', title: 'WebP behind a png URL' }],
    network: { fetchBytes: async () => ({ bytes, type: 'image/webp' }) },
    reviewer: async (_settings, image) => {
      state.reviews += 1
      assert.equal(fs.existsSync(imagesDirectory), false)
      assert.equal(imageSize(image.bytes).type, 'png')
      state.reviewedBytes = Buffer.from(image.bytes)
      return { approved: verdict, decision: verdict ? 'approved' : 'rejected', relevant: true, risks: [], description: 'The actual normalized pixels.', reason: 'Test review result', model: 'current-vision', reviewedAt: Date.now() }
    },
  })
  t.after(async () => { await service.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  return { service, state }
}

test('a real WebP candidate reaches the model as PNG, then stores exactly the reviewed bytes with no WeChat upload', async t => {
  const bytes = await source().webp().toBuffer()
  const { service, state } = fixture(t, bytes)
  const [candidate] = await service.search('account-a', { query: 'Example' })
  const result = await service.prepare('account-a', { id: candidate.id, topic: 'Image codec test' })
  const saved = await service.file('account-a', result.id)
  assert.ok(saved.bytes.equals(state.reviewedBytes))
  assert.equal(imageSize(saved.bytes).type, 'png')
  assert.equal(state.reviews, 1)
  assert.equal(state.writes, 0)
})

test('a decoded but rejected WebP is never committed to the author image directory', async t => {
  const { service, state } = fixture(t, await source().webp().toBuffer(), false)
  const [candidate] = await service.search('account-a', { query: 'Example' })
  await assert.rejects(service.prepare('account-a', { id: candidate.id, topic: 'Example' }), /未通过视觉审核/)
  assert.equal(state.reviews, 1)
  assert.equal(fs.existsSync(state.directory), false)
  assert.equal(state.writes, 0)
})

test('corrupt WebP never consumes a model call or creates the image directory', async t => {
  const bytes = await source().webp().toBuffer()
  const { service, state } = fixture(t, bytes.subarray(0, Math.max(32, Math.floor(bytes.length * 0.6))))
  const [candidate] = await service.search('account-a', { query: 'Example' })
  await assert.rejects(service.prepare('account-a', { id: candidate.id, topic: 'Example' }), /解码/)
  assert.equal(state.reviews, 0)
  assert.equal(fs.existsSync(state.directory), false)
  assert.equal(state.writes, 0)
})

test('manual template WebP insertion uses the same working codec and returns a PNG data URL', async () => {
  const bytes = await source().webp().toBuffer()
  const result = await prepareTemplateImage({ bytes: [...bytes], mimeType: 'image/webp', name: 'example.webp' })
  assert.match(result.src, /^data:image\/png;base64,/)
  assert.equal(imageSize(Buffer.from(result.src.split(',')[1], 'base64')).type, 'png')
  assert.equal(result.width, 128)
  assert.equal(result.height, 96)
})
