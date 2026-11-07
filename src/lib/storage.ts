// Storage access throws (even the `localStorage` getter) when the browser blocks site data, e.g.
// third-party framing or "block all cookies". Preferences are optional, so every call degrades to a no-op.
type Kind = "localStorage" | "sessionStorage";

function get(kind: Kind, key: string): string | null {
  try { return window[kind].getItem(key); } catch { return null; }
}
function put(kind: Kind, key: string, value: string) {
  try { window[kind].setItem(key, value); } catch { /* not persisted */ }
}

export const readLocal = (key: string) => get("localStorage", key);
export const writeLocal = (key: string, value: string) => put("localStorage", key, value);
export const readSession = (key: string) => get("sessionStorage", key);
export const writeSession = (key: string, value: string) => put("sessionStorage", key, value);
export function removeSession(key: string) {
  try { window.sessionStorage.removeItem(key); } catch { /* nothing stored */ }
}
