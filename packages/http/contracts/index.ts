/**
 * The framework-agnostic seams of the HTTP layer.
 *
 * Everything here is a contract, not an implementation. An adapter package
 * implements these against one framework; `@glandjs/http` implements them once
 * for the whole ecosystem. Nothing in this folder imports a framework, and
 * nothing in it imports from `@glandjs/core`, which is what lets the contracts
 * be read in isolation.
 *
 * | Contract        | Implemented by                                   |
 * | --------------- | ------------------------------------------------ |
 * | reply           | `toReplyPayload()` + the adapter's `write()`      |
 * | middleware      | the adapter's `useOne()` and Gland's onion        |
 * | route action    | the adapter's `registerRoute()`                   |
 *
 * @packageDocumentation
 */
export * from './middleware';
export * from './reply';
export * from './route-action';
