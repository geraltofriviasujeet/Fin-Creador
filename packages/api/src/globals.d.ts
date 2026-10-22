// Base64 helpers present in every runtime this package targets (browsers, Node, Hermes),
// declared here because the package compiles without the DOM or Node type libraries.
declare function atob(data: string): string
declare function btoa(data: string): string
