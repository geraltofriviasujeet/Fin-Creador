// Globals present in every runtime this package targets (browsers, Node, Hermes with the
// app's expo-crypto polyfill), declared here because the package compiles without the
// DOM or Node type libraries.
declare function atob(data: string): string
declare function btoa(data: string): string
declare const crypto: {
  randomUUID?: () => string
  getRandomValues<T extends Uint8Array>(array: T): T
}
