import { describe, it, expect, vi } from 'vitest'
import { Subscription, DataType } from '../src/index'

describe('Subscription — construction and basic dispatch', () => {
  it('subscribes to values pushed via resolve()', () => {
    const sub = new Subscription<number>()
    const seen: number[] = []
    sub.subscribe((v) => seen.push(v))
    sub.resolve(1)
    sub.resolve(2)
    sub.resolve(3)
    expect(seen).toEqual([1, 2, 3])
  })

  it('catches errors pushed via reject()', () => {
    const sub = new Subscription<number>()
    const errors: Error[] = []
    sub.subscribe(() => {}, (err) => errors.push(err))
    sub.reject(new Error('boom'))
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('boom')
  })

  it('reject() coerces strings to Errors', () => {
    const sub = new Subscription<number>()
    const errors: Error[] = []
    sub.subscribe(() => {}, (err) => errors.push(err))
    sub.reject('something broke')
    expect(errors[0]).toBeInstanceOf(Error)
    expect(errors[0].message).toBe('something broke')
  })

  it('replays the last event to late subscribers', () => {
    const sub = new Subscription<number>()
    sub.resolve(42)
    const seen: number[] = []
    sub.subscribe((v) => seen.push(v))
    expect(seen).toEqual([42])
  })
})

describe('Subscription — static constructors', () => {
  it('Subscription.of wraps an immediate value', async () => {
    const sub = Subscription.of(99)
    const value = await sub.toPromise()
    expect(value).toBe(99)
  })

  it('Subscription.from accepts a Promise', async () => {
    const promise = Promise.resolve('from-promise')
    const sub = Subscription.from<string>(promise as any)
    const value = await sub.toPromise()
    expect(value).toBe('from-promise')
  })

  it('Subscription.after waits for all subscriptions to resolve', async () => {
    const a = new Subscription<number>()
    const b = new Subscription<number>()
    const done = Subscription.after(a, b).toPromise()
    setTimeout(() => a.resolve(1), 10)
    setTimeout(() => b.resolve(2), 20)
    const result = await done
    // `after` merges and resolves once everything has produced something
    expect(result).toBeDefined()
  })

  it('Subscription.merge resolves with all values once they all arrive', async () => {
    const a = new Subscription<number>()
    const b = new Subscription<number>()
    const merged = Subscription.merge(a, b)
    const done = merged.toPromise()
    a.resolve(10)
    b.resolve(20)
    const results = await done
    expect(new Set(results)).toEqual(new Set([10, 20]))
  })
})

describe('Subscription — chaining', () => {
  it('then() transforms values', async () => {
    const sub = new Subscription<number>()
    const doubled = sub.then((v) => v * 2)
    const seen: number[] = []
    doubled.subscribe((v) => seen.push(v))
    sub.resolve(5)
    sub.resolve(10)
    expect(seen).toEqual([10, 20])
  })

  it('first() only delivers one value then unsubscribes', () => {
    const sub = new Subscription<number>()
    const seen: number[] = []
    sub.first((v) => { seen.push(v); return v })
    sub.resolve(1)
    sub.resolve(2)  // should be ignored
    expect(seen).toEqual([1])
  })

  it('catch() receives errors and can transform them', () => {
    const sub = new Subscription<number>()
    const handled: string[] = []
    sub.catch((err) => handled.push(err.message))
    sub.reject(new Error('oops'))
    expect(handled).toEqual(['oops'])
  })

  it('compute() is a named alias for pipeline creation', () => {
    const sub = new Subscription<number>()
    const seen: number[] = []
    const computed = sub.compute<string>({
      data: (data: string) => { seen.push(data as any); return null as any },
      done: () => {},
      error: () => {},
    } as any)
    // Smoke: just verify the chain doesn't throw
    expect(computed).toBeInstanceOf(Subscription)
  })
})

describe('Subscription — lifecycle', () => {
  it('unsubscribe stops delivery', () => {
    const sub = new Subscription<number>()
    const seen: number[] = []
    const unsub = sub.subscribe((v) => seen.push(v))
    sub.resolve(1)
    unsub()
    sub.resolve(2)
    expect(seen).toEqual([1])
  })

  it('onDelete registers cleanup that fires when all subscribers leave', () => {
    const sub = new Subscription<number>()
    const cleanup = vi.fn()
    sub.onDelete(cleanup)
    const unsub = sub.subscribe(() => {})
    unsub()
    expect(cleanup).toHaveBeenCalled()
  })

  it('as() sets a symbolic id and returns the subscription', () => {
    const sub = new Subscription<number>()
    const result = sub.as('my-stream')
    expect(result).toBe(sub)
    expect(sub.id).toBe('my-stream')
  })
})

describe('Subscription — integration (timers)', () => {
  it('resolves deferred values from setTimeout', async () => {
    const sub = new Subscription<number>()
    const promise = sub.toPromise()
    setTimeout(() => sub.resolve(777), 20)
    const value = await promise
    expect(value).toBe(777)
  })

  it('toPromise rejects on error', async () => {
    const sub = new Subscription<number>()
    setTimeout(() => sub.reject(new Error('async-fail')), 10)
    await expect(sub.toPromise()).rejects.toThrow('async-fail')
  })
})

describe('Subscription — DataType namespace enum', () => {
  it('exports SUCCESS and ERROR constants', () => {
    expect(DataType.SUCCESS).toBe('SUCCESS')
    expect(DataType.ERROR).toBe('ERROR')
  })
})
