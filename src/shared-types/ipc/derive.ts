/**
 * IPC Type Derivation — auto-derives AbyssalAPI from IPC contracts.
 *
 * Naming convention:
 *   Invoke:          'a:b:c'          → a.b.c(...args): Promise<result>
 *   Event:           'a:b$event'      → a.onB(cb): UnsubscribeFn
 *   Push:            'push:name'      → on.name(cb): UnsubscribeFn
 *   Fire-and-forget: 'a:b'            → a.b(...args): void
 */

import type {
  IpcContract,
  IpcEventContract,
  IpcPushContract,
  IpcFireAndForgetContract,
} from './contract';

// ═══════════════════════════════════════════════════════════════════════
// Generic Utilities
// ═══════════════════════════════════════════════════════════════════════

/** Convert a union to an intersection via contra-variant inference */
type UnionToIntersection<U> =
  (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/** Recursively flatten intersection types for readable IDE tooltips */
type Prettify<T> =
  T extends (...args: any[]) => any ? T
  : { [K in keyof T]: Prettify<T[K]> } & {};

// ═══════════════════════════════════════════════════════════════════════
// String-Level Types
// ═══════════════════════════════════════════════════════════════════════

/** Split 'a:b:c' → ['a', 'b', 'c'] */
type Split<S extends string> =
  S extends `${infer H}:${infer T}` ? [H, ...Split<T>] : [S];

/** Strip '$event' suffix */
type StripEventSuffix<S extends string> =
  S extends `${infer Base}$event` ? Base : S;

// ═══════════════════════════════════════════════════════════════════════
// Structure Builder
// ═══════════════════════════════════════════════════════════════════════

/** Nest a value under a path: ['a','b','c'] + V → { a: { b: { c: V } } } */
type Nest<Path extends string[], V> =
  Path extends [infer H extends string, ...infer Rest extends string[]]
    ? Rest extends []
      ? { [K in H]: V }
      : { [K in H]: Nest<Rest, V> }
    : never;

// ═══════════════════════════════════════════════════════════════════════
// Contract Entry → Function Signature
// ═══════════════════════════════════════════════════════════════════════

/** Invoke: { args, result } → (...args) => Promise<result> */
type InvokeFn<E> = E extends { args: infer A extends any[]; result: infer R }
  ? (...args: A) => Promise<R>
  : never;

/** Event / Push subscription: Payload → (cb) => UnsubscribeFn */
type SubscribeFn<P> = (cb: (event: P) => void) => () => void;

/** Fire-and-forget: { args } → (...args) => void */
type FireAndForgetFn<E> = E extends { args: infer A extends any[] }
  ? (...args: A) => void
  : never;

// ═══════════════════════════════════════════════════════════════════════
// Path Extractors
// ═══════════════════════════════════════════════════════════════════════

/** Invoke: 'db:papers:list' → ['db','papers','list'] */
type InvokePath<S extends string> = Split<S>;

/** Event: 'pipeline:progress$event' → ['pipeline','onProgress'] */
type EventPath<S extends string> =
  Split<StripEventSuffix<S>> extends [...infer NS extends string[], infer Last extends string]
    ? [...NS, `on${Capitalize<Last>}`]
    : never;

/** Push: 'push:dbChanged' → ['on','dbChanged'] */
type PushPath<S extends string> =
  S extends `push:${infer Name}` ? ['on', Name] : never;

// ═══════════════════════════════════════════════════════════════════════
// Per-Contract Derivation
// ═══════════════════════════════════════════════════════════════════════

type DeriveInvoke<C> =
  UnionToIntersection<
    { [K in keyof C & string]: Nest<InvokePath<K>, InvokeFn<C[K]>> }[keyof C & string]
  >;

type DeriveEvents<E> =
  UnionToIntersection<
    { [K in keyof E & string]: Nest<EventPath<K>, SubscribeFn<E[K]>> }[keyof E & string]
  >;

type DerivePush<P> =
  UnionToIntersection<
    { [K in keyof P & string]: Nest<PushPath<K>, SubscribeFn<P[K]>> }[keyof P & string]
  >;

type DeriveFireAndForget<F> =
  UnionToIntersection<
    { [K in keyof F & string]: Nest<InvokePath<K>, FireAndForgetFn<F[K]>> }[keyof F & string]
  >;

// ═══════════════════════════════════════════════════════════════════════
// Composed API Type
// ═══════════════════════════════════════════════════════════════════════

/**
 * The full AbyssalAPI type, automatically derived from all IPC contracts.
 *
 * Adding a new channel to IpcContract (+ its handler) is sufficient —
 * AbyssalAPI, preload, and renderer types update automatically.
 */
export type DerivedAbyssalAPI = Prettify<
  DeriveInvoke<IpcContract>
  & DeriveEvents<IpcEventContract>
  & DerivePush<IpcPushContract>
  & DeriveFireAndForget<IpcFireAndForgetContract>
>;
