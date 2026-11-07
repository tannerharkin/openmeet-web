// Framed by another site, the page could be clickjacked into device actions; it stays inert instead.
// (Identity comparison never throws, even cross-origin.)
export const framed = typeof window !== "undefined" && window.top !== window.self;
