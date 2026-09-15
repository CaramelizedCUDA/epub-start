// Browser build binding for EPUB.js's optional non-browser XML implementation.
// The Reader already parses responses with the same native DOMParser. EPUB.js
// uses native XMLSerializer for sections on the supported WebView targets.
// This is not a Node/SSR or Internet Explorer compatibility implementation.
export const DOMParser = globalThis.DOMParser;
export const XMLSerializer = globalThis.XMLSerializer;
