import { ObservableQueue as Queue } from '@console-one/collections'


/**
 * @typedef Late
 * 
 * Represents a late-bound type that could be a Subscription, Promise, or an actual value.
 * 
 * @example
 * const lateValue: Late<number> = 42;
 * const lateSub: Late<number> = Subscription.of(42);
 * 
 */
export type Late<T, E=Error> = Subscription.Late<T, E> | Promise<T> 

export enum DataType {
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export type Handler<T> = {
  onSuccess: (data: T, unsubscribe: () => void) => void
  onError?: (error: Error,  unsubscribe: () => void) => void
}

export type Emittor<T> = {
  data: (data: T) => void
  error: (error: Error) => void
  done: (scope?: any) => void
  
}

export type Unsubscribe = (fn?: () => void) => void

export type Source<T> = (onSuccess: (data: T) => void) => any
export type Transform<Input, Output> = (emittor: Emittor<Output>) => Handler<Input>
export enum Status {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}
type LatentSubscriptionFactory<T> =  (sub: Subscription<T>, toCleanup: (garbageCollection: (() => void)) => void) => any


/**
 * @class Subscription
 * @template T - The data type for successful responses.
 * @template E - The error type, defaulting to JavaScript's built-in Error.
 * 
 * Subscription class that serves as a container for subscriptions and 
 * events with robust event handling and management features.
 */
export class Subscription<T, E=Error> {
  /** Total number of listeners registered. */
  numTotalListeners: number
  /** Number of listeners waiting for successful responses. */
  numCurrentSuccessListeners: number
  /** Number of listeners waiting for error responses. */
  numCurrentErrorListeners: number 
  /** Object containing the success handlers keyed by listener ID. */
  onSuccess: { [key: number]: ((data: T) => void) }
  /** Object containing the error handlers keyed by listener ID. */
  onError: { [key: number]: ((err: Error) => void) }
  /** Bootstrapping functions to be executed when starting up. */
  boot: (() => void)[]
  /** Cleanup functions to be executed when deleting a subscription. */
  cleanup: (() => void)[]
  /** Teardown functions for destructuring the class. */
  teardowns: (() => void)[]
  /** Queue holding events to be broadcasted. */
  output: Queue<[type: DataType, data: T | Error]>
  /** The last processed event. */
  lastEvent: [type: DataType, data: T | Error]
  /** Upstream subscriptions to unsubscribe from when no more listeners. */
  upstream: (() => void)[]
  /** Flag indicating if the source has been started. */
  started: boolean
  /** Data source for the subscription. It could be a function, 
   * another Subscription, or an object with both. */
  source: LatentSubscriptionFactory<T> | Source<T> | {
    subscription: Subscription<any>,
    transform: Transform<any, T>
  }
  /**  Checks for additional conditions or configurations. */
  check: any

  ___sym: string
  /**
   * @constructor
   * @param {any} id - Optional identifier for the subscription.
   */
  constructor(public id?: any) {
    this.numTotalListeners = 0;
    this.numCurrentSuccessListeners = 0;
    this.numCurrentErrorListeners = 0;
    this.onSuccess = {};
    this.onError = {};
    this.boot = [];
    this.cleanup = [];
    this.teardowns = [];
    this.output = new Queue<[type: DataType, data: T | Error]>();
    this.upstream = [];
    this.started = false;
    this.check = {};
    this.___sym = ''
  }

  private get canProcessData() {
    return this.numCurrentSuccessListeners > 0
  }

  private processEvent(nextEvent: [type: DataType, data: T | Error]) {
    switch (nextEvent[0]) {
      case 'SUCCESS':
        this.succeed(nextEvent[1] as T);
        break;
      case 'ERROR':
        this.fail(nextEvent[1] as Error);
        break;
    }
  }

  private dequeue() {
    while (
      this.canProcessData
      && this.output.length > 0
    ) {
      let nextEvent: [type: DataType, data: T | Error] = this.output.shift();
      this.processEvent(nextEvent);
      this.lastEvent = nextEvent;
    }
  }


  private succeed(data: T) {
    for (let listener of Object.values(this.onSuccess)) listener(data);
  }

  private fail(error: Error) {
    if (this.numCurrentErrorListeners > 0) {
      for (let listener of Object.values(this.onError)) listener(error);
    } else {
      throw error;
    }
  }

  onDelete(fnc: () => void) {
    this.cleanup.push(fnc);
  }

  subscribe(
    success: (data: T, unsubscribe: Unsubscribe) => any, 
    error?: (err: Error, unsubscribe: Unsubscribe) => any): Unsubscribe {
  
    const subscriberID = this.numTotalListeners++;
    const hasErrorListener = (error !== undefined);
    let unsubscribed = false;

    const unsubscribe = (teardown?: () => void) => {
      if (!unsubscribed) {
        unsubscribed = true;
        delete this.onSuccess[subscriberID];
        this.numCurrentSuccessListeners -= 1;
        if (hasErrorListener) {
          delete this.onError[subscriberID];
          this.numCurrentErrorListeners -= 1;
        }
        if (typeof teardown === 'function') this.teardowns.push(teardown);

        if (this.numCurrentSuccessListeners === 0) {
          for (let unsub of this.upstream) unsub();
          for (let method of this.cleanup) method();
          for (let td of this.teardowns) {
            if (typeof td === 'function') td();
          }
        }
      }
    }

    this.onSuccess[subscriberID] = (data: T) => success(data, unsubscribe);
    if (hasErrorListener) this.onError[subscriberID] = (err: Error) => error(err, unsubscribe);

    if (this.numCurrentSuccessListeners === 0) this.spark();
    this.numCurrentSuccessListeners += 1;

    if (hasErrorListener) this.numCurrentErrorListeners += 1;

    if (this.lastEvent !== undefined) {
      if (this.lastEvent[0] === 'SUCCESS') this.onSuccess[subscriberID](this.lastEvent[1] as T);
      else if (hasErrorListener) this.onError[subscriberID](this.lastEvent[1] as Error);
    }
    this.dequeue();
    return unsubscribe;
  }
  /**
   * Initializes the subscription and begins data flow.
   * @public
   */
  spark() {
    if (this.source !== undefined && this.started === false) {
      this.started = true;
      if (typeof this.source === 'function') {
        try {
          (this.source as LatentSubscriptionFactory<T>)(this, (cb) => {
            this.cleanup.push(cb);
            return this;
          }); 
        } catch (err: any) {
          this.write(DataType.ERROR, err);
          this.cleanup.push(() => this.source = null)
        }
      } else {
        let handler = this.source.transform({
          data: (data) => this.succeed(data),
          done: () => {},
          error: (error) => this.fail(error)
        });
        this.cleanup.push(this.source.subscription.subscribe(handler.onSuccess, handler.onError));
      }
    }
  }

  subscriber(): (
    success: (data: T, unsubscribe: () => void) => any, 
    error?: (err: Error, unsubscribe: () => void) => any
  ) => void {
    const _that = this;
    return (
      success: (data: T, unsubscribe: () => void) => any,
      error?: (err: Error, unsubscribe: () => void) => any
    ) => {
      return _that.subscribe(success, error);
    };
  }

  write(dataType: DataType, data: T | Error) {
    this.output.push([dataType, data]);
    this.dequeue();
  }

  writer(): (dataType: DataType, data: T | Error) => void {
    const _that = this;
    return (dataType: DataType, data: T | Error) => {
      _that.write(dataType, data);
    }
  }

  from<I, E = Error>(subscription: Subscription<I, E>, transform: Transform<I, T>): Subscription<T> {
    this.source = {
      subscription: subscription,
      transform: transform
    }
    return this;
  }

  as(name: string): Subscription<T> {
    this.id = name;
    return this;
  }

  compute<O>(transform: Transform<T, O>): Subscription<O> {
    let computed = new Subscription<O>();
    return computed.from(this, transform);
  }

  pipe(subscription: Subscription<any>): Subscription<T> {
    let refs = this.upstream;
    this.then((data, unsub) => {
      subscription.resolve(data);
      refs.push(unsub);
    }).catch(err => subscription.reject(err));
    return subscription;
  }

  resolve(data: T) {
    return this.write(DataType.SUCCESS, data);
  }

   /**
   * @method reject
   * 
   * Sends an error signal to the subscription.
   * 
   * @param {any} error - The error to emit.
   * @return {void}
   * 
   * @example
   * sub.reject(new Error("Something went wrong"));
   */
  reject(error: Error | string) {
    if (typeof error === 'string') error = new Error(error);
    return this.write(DataType.ERROR, error);
  }

  toPromise(): Promise<T> {
    return new Promise((resolve, reject) => {
      this.subscribe(resolve, reject);
    })
  }

  queue(successHandler: (data: Queue<T>, unsubscribe: () => void) => Queue<T>): Subscription<Queue<T>> {
    return queueify<T>(this, successHandler);
  }

  first<Output>(successHandler: (data: T) => Output) {
    return this.then((data, unsubscribe: Unsubscribe) => {
      const result = successHandler(data);
      unsubscribe();
      return result;
    });
  }

  then<Output>(successHandler: (data: T, unsubscribe: Unsubscribe) => Output): Subscription<Output> {
    const next = new Subscription<Output>();
    this.subscribe((data, unsubsribeBase) => {
      try {
        const result = successHandler(data, (cleanHandler?: () => void) => {
          unsubsribeBase(cleanHandler);
        });
        next.resolve(result);
      } catch (err) {
        next.reject(err as Error);
        unsubsribeBase();
      }
    }, (err, unsubscribeBase) => {
      next.reject(err);
      unsubscribeBase();
    });
    return next;
  }

  catch<Output>(errorHandler: (data: Error, unsubscribe: Unsubscribe) => Output): Subscription<Output> {
    let next = new Subscription<Output>();
    this.subscribe((data) => {}, (data: Error, unsubscribe: Unsubscribe) => {
      try {
        next.resolve(errorHandler(data, unsubscribe));
      } catch (err) {
        unsubscribe(() => {
          next = undefined; 
        })
        next.reject(err);
      }
    });
    return next;
  }
}


export namespace Subscription {

/**
 * @method of
 * 
 * Creates a new Subscription and immediately resolves it with the given data.
 * 
 * @param {any} data - The data with which to resolve the subscription.
 * @return {Subscription} A new subscription object.
 * 
 * @example
 * const mySub = Subscription.of(42);
 * 
 */
  export function of<T>(data: T) {
    let subscription = new Subscription<T>();
    subscription.resolve(data);
    return subscription;
  }

/**
 * @method subscriber
 * 
 * Creates a new Subscription that can be manually resolved or rejected through a given function.
 * 
 * @param {Function} fn - The function to execute when the Subscription is resolved.
 * @param {string} [name] - Optional name for the subscription.
 * @return {Subscription} A new subscription object.
 * 
 * @example
 * const mySub = Subscription.subscriber((data, unsub) => {
 *    // Do something
 * });
 * 
 */
  export function subscriber<T>(fn: (data, unsub) => Promise<any>, name?: string) {
    let subscription = name === undefined ? new Subscription<T>() : new Subscription<T>(name);
    subscription.then((data, unsub) => {
      fn(data, () => {
        unsub(() => {
          subscription = undefined;
        });
      });
    })
    subscription.catch((err, unsub) => {
      unsub(() => {
        subscription = undefined;
      });
    });
    return subscription;
  }


/**
 * @method from
 * 
 * Creates a new Subscription from an existing LatentSubscriptionFactory or Promise.
 * 
 * @param {LatentSubscriptionFactory|Promise} source - The source from which to create the subscription.
 * @param {string} [id] - Optional id for the subscription.
 * @return {Subscription} A new subscription object.
 * 
 * @example
 * const mySub = Subscription.from(existingPromise);
 * 
 */
  export function from<T, E = Error>(source: LatentSubscriptionFactory<T>, id?: string): Subscription<T> {
    if (typeof source === 'function') {
      let subscription = new Subscription<T>(id);
      subscription.source = source;
      return subscription;
    } else {
      let promise = source as Promise<T>;
      let subscription = new Subscription<T>();
      promise.then((val) => {
        subscription.resolve(val);

      }).catch(err => subscription.reject(err));
      return subscription;
    }
  }

/**
 * @method after
 * 
 * Creates a new Subscription that resolves after all the given subscriptions resolve.
 * 
 * @param {...Late<any>[]} subscriptions - An array of Late types to wait for.
 * @return {Subscription} A new subscription object.
 * 
 * @example
 * const mySub = Subscription.after(sub1, sub2);
 * 
 */
  export function after(...subscriptions: Late<any>[]): Subscription<any> {
    let subscription = new Subscription<any>();
    if (subscriptions.length < 1) subscription.resolve([]);
    else {
      merge(...subscriptions).first((data) => {
        return subscription.resolve(data);
      });
    }
    return subscription;
  }


/**
 * @method combine
 * 
 * Combines multiple Subscriptions into a single Subscription that resolves when all of the input Subscriptions resolve.
 * 
 * @param {...Late<T>[]} subscriptions - An array of Late types to combine.
 * @return {Subscription} A new subscription object that resolves with an array of the resolved values of the input Subscriptions.
 * 
 * @example
 * const mySub = Subscription.combine(sub1, sub2);
 * 
 */
  export function combine<T>(...subscriptions: Late<T>[]) {
    let output: any[] = new Array(subscriptions.length);
    let awaitingCount = subscriptions.length;
    let result = new Subscription<any[]>();
    function setOutput(data: any, index: number) {
      output[index] = data;
      result.resolve(output);
    }
    for (let index = 0; index < subscriptions.length; index++) {
      if (subscriptions[index] instanceof Subscription) {
        let sub = (subscriptions[index] as Subscription<any>);
        if (sub.lastEvent !== undefined && sub.lastEvent[0] === 'SUCCESS') output[index] = sub.lastEvent[1]
        (subscriptions[index] as Subscription<any>).subscribe((data) => setOutput(data, index))
      } else {
        output[index] = subscriptions[index];
      }
    }
    result.resolve(output);
    return result;
  }


/**
 * @method merge
 * 
 * Merges multiple Subscriptions into a single Subscription.
 * 
 * @param {...Late<T>[]} subscriptions - An array of Late types to merge.
 * @return {Subscription} A new subscription object that resolves with an array of the resolved values of the input Subscriptions.
 * 
 * @example
 * const mySub = Subscription.merge(sub1, sub2);
 * 
 */
  export function merge<T>(...subscriptions: Late<T>[]) {
    let results: any[] = new Array(subscriptions.length);
    let awaitingCount = subscriptions.length;
    let awaiting = new Set<number>();
    let found: { [key: number]: () => void } = {};
    let output = new Subscription<any[]>();

    output.check = () => {
      console.log('Awaiting: ', awaiting);
      console.log('Found: ', found);
      console.log('results: ', results);
    }

    function unpack<T>(late: Late<T>, 
      cback: (data: T, unsub: () => void) => void,
      err?: (err, unsub: any) => void) {
      if (late instanceof Subscription) {
        return late.subscribe(cback, err);
      }  else {
        return cback(late as T, () => { });
      }
    }
    
    if (subscriptions.length < 1) {
      output.resolve([]);
    } else {
      for (let index = 0; index < subscriptions.length; index++) {
        awaiting.add(index);
        unpack(subscriptions[index], (data: any, unsub: any) => {
          if (awaiting.has(index)) {
            awaiting.delete(index);
            awaitingCount -= 1;
            results[index] = data;
          }

          if (awaitingCount === 0) {
            output.resolve(results);
          }
        }, (err, unsub: any) => {
          for (let unsubscriber of Object.values(found)) unsubscriber();
          unsub();
          output.reject(err);
        });
      }
    }

    return output;
  }

  export enum DataType {
    SUCCESS = 'SUCCESS',
    ERROR = 'ERROR'
  }


/**
 * @method immediate
 * 
 * Retrieves the immediate value of the subscription if available.
 * 
 * @param {Subscription|X} input - The Subscription object or value to retrieve.
 * @param {Function} errors - The error handling function.
 * @return {X} The immediate value.
 * 
 * @example
 * const value = Subscription.immediate(mySub, console.error);
 * 
 */
  export function immediate<X>(input: X | Subscription < X >, errors: (err: Error) => void): X {
    if (input instanceof Subscription) {
      if (input.lastEvent[0] === Subscription.DataType.SUCCESS) return input.lastEvent[1] as X;
      else if (input.lastEvent[0] === Subscription.DataType.ERROR) {
        errors(input.lastEvent[1] as Error);
      }
      else {
        new Error('Event type of immediate inptu not recognized')
      }
    } else {
      return input;
    }
  }

  export type Late<X, E=Error> = X | Subscription<X, E> | Promise<X> | E

}


export type transformer<InputType, OutputType> = (subscription: Subscription<InputType>,
  successHandler: (data: OutputType, unsubscribe: () => void) => OutputType,
  errorHandler?: (error: Error, unsubscribe: () => void) => void) =>
  Subscription<OutputType>

export const waitthen = <T, Q, E=Error>(awaited: Late<T, E>[] | Late<T, E>, fn: (...values: (T | E)[]) => Q | E): Late<Q, E> => {
  let subscriptions = [];
  let values = [];
  let all = [];
  if (!Array.isArray(awaited)) awaited = [awaited];
  for (let index = 0; index < awaited.length; index++) {
    let item = awaited[index];
    if (item instanceof Subscription) {
      if (item.lastEvent !== undefined && item.lastEvent[0] === Subscription.DataType.SUCCESS) {
        all[index] = item.lastEvent[1]
        values.push(index);
      } else {
        item.subscribe((data, unsub) => {
          all[index] = data;
          unsub();
        });
        item.catch((err, unsub) => {
          all[index] = err;
          unsub();
        });
        subscriptions.push(index);
      }
    } else if (item instanceof Promise) {
      item.then((data) => all[index] = data);
      item.catch((err) => all[index] = err);
    } else {
      all[index] = item;
      values.push(index);
    }
  }

  if (subscriptions.length > 0) {
    let result = new Subscription<Q>(); 
    let allDone = Subscription.after(...subscriptions.map(index => all[index]));
    allDone.then((results) => {
      for (let index = 0; index < results.length; index++) all[subscriptions[index]] = results[index]; 
      result.resolve(fn(...all as any[]) as Q); 
    })
    return result; 
  } else {
    return fn(...values); 
  }
}

export const queueify = <Output>(subscription: Subscription<Output>,
  successHandler: (data: Queue<Output>, unsubscribe: () => void) => Queue<Output>) => {
  let next = new Subscription<Queue<Output>>();
  let history = new Queue<Output>();
  subscription.subscribe((data: Output, unsubscribe) => {
    try {
      history.push(data);
      next.resolve(successHandler(history, unsubscribe));
    } catch (err) {
      next.reject(err);
    }
  }, (err) => {
    next.reject(err);
  });
  next.onDelete(() => history = null);
  return next;
}
