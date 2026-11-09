// Visual review uses the existing model and supports both already-configured API formats.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { reviewImage } = require('../images/review.cjs')
const { estimate } = require('../bot/tokens.cjs')
const { modelResponse } = require('../../tests/helpers/model-response.cjs')
const { imageInputSupport } = require('../bot/capabilities.cjs')

const verdict = { decision: 'approved', relevant: true, risks: [], description: 'A simple colored test image.', reason: 'Suitable and relevant.' }

for (const format of ['chat-completions', 'responses']) {
  test(`visual review sends actual pixels to the current model using ${format}`, async t => {
    let seen
    const server = http.createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      seen = JSON.parse(Buffer.concat(chunks).toString())
      if (format === 'chat-completions') modelResponse(response, { role: 'assistant', content: JSON.stringify(verdict) })
      else {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const result = { id: 'resp-review', status: 'completed', output: [{ type: 'message', role: 'assistant',
          content: [{ type: 'output_text', text: JSON.stringify(verdict) }] }] }
        response.end(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: result })}\n\n`)
      }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(() => { server.closeAllConnections(); server.close() })
    const settings = { private: () => ({ model: { name: 'current-writing-model', apiKey: 'test-secret',
      apiFormat: format, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, contextWindow: 128000 },
      bot: { instructions: '作者允许来源水印。' } }) }
    let calls = 0
    const result = await reviewImage(settings, { bytes: Buffer.from('test-image-pixels') }, 'colors', {
      title: 'Untrusted caption', sourcePage: 'https://example.com/source', license: '来源未提供明确授权', licenseVerified: false,
    }, { beforeModelCall: () => { calls += 1 }, authorMemories: '作者长期偏好：保留署名。', authorRequest: '本篇允许品牌标识。' })
    assert.equal(result.approved, true)
    assert.equal(result.model, 'current-writing-model')
    assert.equal(calls, 1)
    assert.equal(seen.model, 'current-writing-model')
    assert.equal(seen.stream, true)
    const content = format === 'responses' ? seen.input.at(-1).content : seen.messages.at(-1).content
    const data = JSON.parse(content.find(item => item.type === (format === 'responses' ? 'input_text' : 'text')).text)
    assert.equal(data.source.license, undefined)
    assert.equal(data.source.licenseVerified, undefined)
    const preferences = data.authorPreferences
    assert.equal(preferences.instructions, '作者允许来源水印。')
    assert.match(preferences.memory, /保留署名/)
    assert.match(preferences.currentRequest, /允许品牌标识/)
    const instructions = format === 'responses' ? seen.input[0].content : seen.messages[0].content
    assert.match(instructions, /本身不是默认安全风险，不自动拒绝/)
    assert.equal(instructions.includes('watermark_or_advertisement'), false)
    assert.doesNotMatch(instructions, /版权许可|使用授权|核实授权/)
    const image = content.find(item => item.type === (format === 'responses' ? 'input_image' : 'image_url'))
    assert.equal(format === 'responses' ? image.image_url : image.image_url.url,
      'data:image/png;base64,' + Buffer.from('test-image-pixels').toString('base64'))
  })
}

test('confirmed text-only Pro cannot perform a visual review or consume a model call', async () => {
  let calls = 0
  const settings = { private: () => ({ model: { name: 'cn:deepseek-v4-pro' } }) }
  await assert.rejects(reviewImage(settings, { bytes: Buffer.from('pixels') }, 'topic', { title: 'Image' }, {
    beforeModelCall: () => { calls += 1 },
  }), error => error.code === 'MODEL_IMAGE_UNSUPPORTED')
  assert.equal(calls, 0)
  assert.equal(imageInputSupport('cn:deepseek-v4.1-flash'), true)
  assert.equal(imageInputSupport('cn:deepseek-v4-pro'), false)
  assert.equal(imageInputSupport('other-vision-model'), null)
})

test('image context accounting does not tokenize its entire base64 transport payload', () => {
  const messages = length => [{ role: 'user', content: [{ type: 'text', text: 'Review image' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'a'.repeat(length) } }] }]
  assert.equal(estimate(messages(100)), estimate(messages(1000000)))
  assert.ok(estimate(messages(100)) > 4096)
  assert.ok(estimate(messages(100)) < 6000)
})
