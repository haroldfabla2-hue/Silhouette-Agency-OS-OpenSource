'use strict'
// Trusted fixed-inventory byte transport only. No pacote/installer/Git/product API.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const base = '/mnt/silhouette-genuine-vitest'
const fixtures = base + '/fixtures'
const out = base + '/transport'
const fetch = require(fixtures + '/toolchain/npm/node_modules/make-fetch-happen')
const inventory = JSON.parse(fs.readFileSync(fixtures + '/public-transport-inventory.json', 'utf8'))
assert.equal(inventory.lockSha256, '0aab8555d2b4615e2ff2a55df8920b18bd846a3cc2524d55cfe95fef2d278f89')
assert.equal(inventory.requests.length, 1187)
assert.equal(inventory.requests.reduce((n, r) => n + r.bytes, 0), 443014963)
const cache = out + '/cache/_cacache'
const began = Date.now()
const deadline = began + 170000
let aggregate = 0
let next = 0
const complete = []
const controllers = new Set()
const stopped = () => { for (const c of controllers) c.abort() }
const timer = setTimeout(stopped, 170000)
async function consume(row, offline) {
  assert(Date.now() < deadline)
  assert(row.url.startsWith('https://registry.npmjs.org/') || row.url === 'https://codeload.github.com/whiskeysockets/libsignal-node/tar.gz/1c30d7d7e76a3b0aa120b04dc6a26f5a12dccf67')
  assert(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 67108864)
  const controller = new AbortController()
  controllers.add(controller)
  const requestTimer = setTimeout(() => controller.abort(), Math.min(15000, deadline - Date.now()))
  let archive = null
  let received = 0
  const alg = row.integrity ? row.integrity.split('-')[0] : 'sha256'
  const expected = row.integrity ? Buffer.from(row.integrity.split('-')[1], 'base64').toString('hex') : row.sha256
  assert(['sha512', 'sha256', 'sha1'].includes(alg))
  const digest = crypto.createHash(alg)
  try {
    const response = await fetch(row.url, {
      cachePath: cache, cache: offline ? 'only-if-cached' : 'default',
      integrity: row.integrity || undefined, algorithms: [alg], strictSSL: true,
      retry: { retries: 0 }, redirect: 'error', timeout: 15000,
      signal: controller.signal, headers: {}, compress: true,
    })
    assert.equal(response.status, 200)
    assert.equal(response.url, row.url)
    const length = response.headers.get('content-length')
    if (length !== null) assert.equal(Number(length), row.bytes)
    if (row.sha256 && !offline) archive = fs.openSync(out + '/libsignal-source.tar.gz', 'wx', 0o600)
    for await (const chunk of response.body) {
      received += chunk.length
      assert(received <= row.bytes && Date.now() < deadline)
      if (!offline) {
        aggregate += chunk.length
        assert(aggregate <= 443014963)
      }
      digest.update(chunk)
      if (archive !== null) fs.writeSync(archive, chunk)
    }
    assert.equal(received, row.bytes)
    assert.equal(digest.digest('hex'), expected)
    assert.notEqual(response.headers.get('x-local-cache-status'), 'skip')
  } finally {
    if (archive !== null) fs.closeSync(archive)
    clearTimeout(requestTimer)
    controllers.delete(controller)
  }
}
async function worker() {
  for (;;) {
    const index = next++
    if (index >= inventory.requests.length) return
    const row = inventory.requests[index]
    await consume(row, false)
    // Same real HTTP cache, no index synthesis and no network fallback permitted.
    await consume(row, true)
    complete.push(index)
  }
}
function cacheSize(p) {
  let n = 0
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const q = path.join(p, e.name)
    assert(!e.isSymbolicLink())
    n += e.isDirectory() ? cacheSize(q) : fs.statSync(q).size
    assert(n <= 536870912)
  }
  return n
}
;(async () => {
  await Promise.all(Array.from({ length: 4 }, () => worker()))
  assert.equal(complete.length, inventory.requests.length)
  assert.equal(aggregate, 443014963)
  const bytes = cacheSize(out + '/cache')
  const proof = { status: 'PUBLIC_BYTES_CACHED_NOT_INSTALL_OR_PRODUCT_PASS', requests: complete.length, downloadedBytes: aggregate, cacheBytes: bytes, elapsedMilliseconds: Date.now() - began, lockSha256: inventory.lockSha256 }
  fs.writeFileSync(out + '/complete.json', JSON.stringify(proof) + '\n', { flag: 'wx', mode: 0o600 })
  const payload = JSON.parse(fs.readFileSync(fixtures + '/audit-payload.json', 'utf8'))
  const auditResponse = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
    method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' },
    retry: { retries: 0 }, redirect: 'error', strictSSL: true, timeout: 15000,
    signal: AbortSignal.timeout(Math.min(15000, Math.max(1, deadline - Date.now()))),
  })
  assert.equal(auditResponse.status, 200)
  const auditChunks = []; let auditBytes = 0
  for await (const chunk of auditResponse.body) {
    auditBytes += chunk.length; assert(auditBytes <= 4194304 && Date.now() < deadline); auditChunks.push(chunk)
  }
  const auditRaw = Buffer.concat(auditChunks)
  assert.equal(typeof JSON.parse(auditRaw.toString('utf8')), 'object')
  fs.writeFileSync(out + '/audit-response.json', auditRaw, { flag: 'wx', mode: 0o600 })
  clearTimeout(timer)
})().catch(() => { stopped(); clearTimeout(timer); process.exitCode = 1 })
