// Keep observed source metadata without carrying forward application-invented rights judgments.
const PLACEHOLDERS = new Set(['授权待核实', '来源未提供明确授权'])

function sourceMetadata(item) {
  const license = typeof item.license === 'string' ? item.license.trim() : ''
  if (PLACEHOLDERS.has(license)) return {}
  return { ...(license ? { license } : {}),
    ...(typeof item.licenseUrl === 'string' && item.licenseUrl ? { licenseUrl: item.licenseUrl } : {}) }
}

function normalizeImageMetadata(item) {
  const { license, licenseUrl, licenseVerified, ...rest } = item
  return { ...rest, ...sourceMetadata(item) }
}

module.exports = { sourceMetadata, normalizeImageMetadata }
