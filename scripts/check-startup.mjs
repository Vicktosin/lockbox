import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBackendApp } from '../server/http/app.ts'

await test('slow mandatory initialization completes before health becomes ready, without opening a listener or disabling request limits', async () => {
  const app = createBackendApp()
  let initialized = false,
    responded = false
  app.register(async () => {
    await new Promise((resolve) => setTimeout(resolve, 11000))
    initialized = true
  })
  try {
    const health = app.inject({ url: '/healthz' }).then((response) => {
      responded = true
      return response
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(initialized, false)
    assert.equal(responded, false)
    assert.equal((await health).statusCode, 200)
    assert.equal(initialized, true)
    assert.equal(app.server.listening, false)
    assert.equal(app.initialConfig.requestTimeout, 10000)
  } finally {
    await app.close()
  }
})
