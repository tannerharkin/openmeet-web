import { currentDeviceHints, isMobileDevice } from "./device";

// Framed by another site, the page could be clickjacked into device actions; it stays inert instead.
// (Identity comparison never throws, even cross-origin.)
export const framed = typeof window !== "undefined" && window.top !== window.self;

// WebHID needs Chrome/Edge on a desktop, in a secure context (https:// or file://).
export const hidSupported = typeof navigator !== "undefined" && "hid" in navigator && window.isSecureContext;

// A phone or tablet without WebHID gets the full-screen "use a computer" page instead of the app.
export const mobileWithoutHid = !hidSupported && typeof navigator !== "undefined" && isMobileDevice(currentDeviceHints());
