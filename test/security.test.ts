import { describe, expect, it } from 'vitest'
import { redactLogSecrets, requireNonEmptyString } from '../src/security.ts'

describe('security helpers', () => {
  it('preserves normal business evidence', () => {
    const input = '2026-08-19 INFO orderId=10086 state=PENDING result=false'
    expect(redactLogSecrets(input)).toBe(input)
  })

  it('redacts header, key-value, quoted and URL secrets', () => {
    const input = [
      'Authorization: Bearer ey.fake.token',
      'x-api-key = abc123',
      'password="hello world"',
      'client_secret: top-secret',
      'jdbc:mysql://localhost/db?password=db-pass&useSSL=false',
    ].join('\n')
    const result = redactLogSecrets(input)

    expect(result).not.toContain('ey.fake.token')
    expect(result).not.toContain('abc123')
    expect(result).not.toContain('hello world')
    expect(result).not.toContain('top-secret')
    expect(result).not.toContain('db-pass')
    expect(result).toContain('useSSL=false')
  })

  it('validates required RPC strings without leaking their contents', () => {
    expect(() => requireNonEmptyString('   ', 'sessionId')).toThrow('sessionId 不能为空')
    expect(() => requireNonEmptyString(42, 'sessionId')).toThrow('sessionId 必须是字符串')
  })
})
