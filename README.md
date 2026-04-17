# @console-one/subscription

Observable/promise hybrid for values that arrive over time. A `Subscription<T>` is a container you can `resolve()` / `reject()` like a promise, but it can fire multiple times like an event stream, supports backpressure via an internal queue, and composes with `.then()` / `.first()` / `.catch()` / `.compute()`. It also replays the last event to late subscribers, so it's useful as a state holder, not just a stream.

Use this when:
- You need a value that might already be available OR might arrive later, and you don't want to commit to Promise semantics (one-shot, no replay).
- You want multiple consumers of the same stream with independent unsubscribe lifecycles.
- You want to compose async operations without an rxjs-sized dependency.

## Install

```bash
npm install @console-one/subscription
```

## Usage

### Basic

```ts
import { Subscription } from '@console-one/subscription'

const sub = new Subscription<number>()

sub.subscribe((value) => {
  console.log('got', value)
})

sub.resolve(1)  // → got 1
sub.resolve(2)  // → got 2
```

### Promise interop

```ts
// From a subscription to a promise
const value = await sub.toPromise()

// Immediate value
const ready = Subscription.of(42)
console.log(await ready.toPromise())  // 42

// From a promise
const fromPromise = Subscription.from(fetch('/api/user').then(r => r.json()))
```

### Chaining

```ts
const doubled = sub.then((n) => n * 2)
doubled.subscribe((v) => console.log(v))

sub.resolve(5)   // → 10
sub.resolve(10)  // → 20

// Take only the first value, then unsubscribe
sub.first((n) => console.log('first was', n))

// Handle errors
sub.catch((err) => console.error('upstream failed:', err.message))
```

### Composition of many subscriptions

```ts
const a = new Subscription<number>()
const b = new Subscription<number>()

// Wait for all of them (like Promise.all, but subscription-aware)
const combined = await Subscription.merge(a, b).toPromise()

// Or wait for any of them
Subscription.after(a, b).subscribe((values) => {
  console.log('something arrived:', values)
})
```

### Late subscribers replay the last event

```ts
const sub = new Subscription<string>()
sub.resolve('hello')

// This subscriber is added AFTER resolve() and still gets 'hello'
sub.subscribe((v) => console.log(v))  // → hello
```

This makes `Subscription` usable as a state container, not just an event stream.

## API

### Class methods

| Method | Description |
|---|---|
| `new Subscription<T>(id?)` | Construct an unresolved subscription. |
| `subscribe(success, error?)` | Register listeners. Returns an `unsubscribe` function. |
| `resolve(value)` | Push a successful value to all subscribers. |
| `reject(err)` | Push an error. Accepts `Error` or `string` (auto-wrapped). |
| `then(fn)` | Transform values; returns a new `Subscription`. |
| `first(fn)` | Take the first value, then auto-unsubscribe. Returns a new `Subscription`. |
| `catch(fn)` | Handle errors; returns a new `Subscription`. |
| `compute(transform)` | Create a derived subscription with a custom transform. |
| `pipe(target)` | Forward values into another subscription. |
| `queue(handler)` | Accumulate values into a history queue. |
| `toPromise()` | Resolve on first success or first error. |
| `onDelete(fn)` | Register cleanup when all subscribers leave. |
| `as(name)` | Assign a symbolic id (for debugging). |
| `from(sub, transform)` | Chain from another subscription via a transform. |
| `writer()` | Returns a bound `write(dataType, data)` function. |
| `subscriber()` | Returns a bound subscribe function. |

### Static constructors

| Static | Description |
|---|---|
| `Subscription.of(value)` | Pre-resolved with a value. |
| `Subscription.from(source, id?)` | From a `Promise` or a factory function. |
| `Subscription.subscriber(fn, name?)` | Construct and wire up a handler that auto-unsubscribes on catch. |
| `Subscription.after(...subs)` | Resolve when any input resolves (via internal merge + first). |
| `Subscription.combine(...subs)` | Resolve with an array of current values. |
| `Subscription.merge(...subs)` | Resolve when ALL inputs have produced at least one value. |
| `Subscription.immediate(inputOrSub, errorHandler)` | Synchronously unwrap a known-resolved subscription. |

### Helpers (top-level exports)

- `waitthen(awaited, fn)` — "wait for all, then call fn." Handles mixed `Subscription | Promise | raw-value` inputs.
- `queueify(subscription, handler)` — Turn a subscription into one whose values are accumulated `Queue<T>` history snapshots.

## Dependencies

- [`@console-one/collections`](../collections) — `Subscription` uses `ObservableQueue` internally as its event buffer. You don't need to import it directly; `Subscription` wraps it.

## Notes on behavior

Three paths behave the way callers would reasonably expect, which not every early iteration of this library got right:

- **`fail()` invokes error listeners when present and throws only when there's nobody to catch** — so `.subscribe(_, err => ...)` and `sub.reject(...)` both work.
- **`unsubscribe()` can be called with or without a teardown argument.** Calls without an argument are no-ops.
- **`then()` and `first()` preserve the downstream subscription.** `first()` calls the handler before unsubscribing, so you get the value, not a reference error.

## Tests

```bash
npm test
```

18 tests covering construction, dispatch, static constructors, chaining, lifecycle, and async-timer integration.
