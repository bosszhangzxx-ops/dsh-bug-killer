import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import React from 'react'
import { apply, inject, LogCaptureManager, name } from '../lib/index.js'

let registration
const ctx = {
  connection: {
    rpc: {
      handle(channel, handler, options) {
        registration = { channel, handler, options }
        return async () => {}
      },
    },
  },
}

apply(ctx, {
  maxCaptureBytes: 1_048_576,
  maxDiscoveryDepth: 4,
  redactSecrets: true,
})

assert.equal(name, 'dsh-bug-killer')
assert.deepEqual(inject, ['connection'])
assert.equal(registration.channel, '/bug-killer')
assert.deepEqual(registration.options, { authority: 'loopback' })
const health = await registration.handler('health', {}, new AbortController().signal)
assert.deepEqual(health, { ok: true, value: { plugin: 'dsh-bug-killer', ready: true } })

const clientBundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
assert.match(clientBundle, /__ModuleLoader__\.load/)
assert.match(clientBundle, /id: "dsh-bug-killer"/)
assert.match(clientBundle, /conversation\.input\.right/)
assert.match(clientBundle, /capture\/finish/)

let clientDefinition
vm.runInNewContext(clientBundle, {
  window: {
    __ModuleLoader__: {
      load(definition) {
        clientDefinition = definition
      },
    },
  },
  console,
})
assert.equal(clientDefinition.id, 'dsh-bug-killer')
const clientPlugin = clientDefinition.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error(`unexpected browser external: ${specifier}`)
})
assert.deepEqual(Array.from(clientPlugin.inject), ['slots', 'connection'])
let registeredClientSlot
clientPlugin.apply({
  connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
  slots: {
    inject(slotName, register) {
      assert.equal(slotName, 'conversation.input.right')
      register()
    },
    register(options, component) {
      registeredClientSlot = { options, component }
    },
  },
})
assert.equal(registeredClientSlot.options.name, 'conversation.input.right')
assert.equal(registeredClientSlot.options.id, 'dsh-bug-killer')
assert.equal(typeof registeredClientSlot.component, 'function')

const tempPrefix = '.tmp-bug-killer-built-smoke-'
const workspace = await mkdtemp(path.join(process.cwd(), tempPrefix))
try {
  await mkdir(path.join(workspace, 'logs'))
  const springLog = path.join(workspace, 'logs', 'application.log')
  await writeFile(springLog, '2026-08-19 INFO Spring Boot started\n', 'utf8')
  const manager = new LogCaptureManager({
    maxCaptureBytes: 1_048_576,
    maxDiscoveryDepth: 4,
    redactSecrets: true,
  })
  await manager.start('built-smoke', workspace, 'logs/application.log')
  await appendFile(springLog, '2026-08-19 INFO [BUG_KILLER:SMOKE] step=service result=ok\n', 'utf8')
  const captured = await manager.finish('built-smoke')
  assert.equal(captured.empty, false)
  assert.match(captured.logText, /step=service result=ok/)
  assert.doesNotMatch(captured.logText, /Spring Boot started/)
} finally {
  if (path.basename(workspace).startsWith(tempPrefix)) {
    await rm(workspace, { recursive: true, force: true })
  }
}

console.log('smoke ok')
