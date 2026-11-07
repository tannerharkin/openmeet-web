import { describe, expect, it } from "vitest";
import { isMobileDevice } from "./device";

const desktopChrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const macSafari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15";

describe("isMobileDevice", () => {
  it("treats desktops as desktops, including touch-screen laptops with a trackpad", () => {
    expect(isMobileDevice({ userAgent: desktopChrome, platform: "Win32", maxTouchPoints: 10, coarseOnly: false })).toBe(false);
    expect(isMobileDevice({ userAgent: macSafari, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
  });

  it("recognises phones and tablets by user agent or client hints", () => {
    expect(isMobileDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Mobile/15E148" })).toBe(true);
    expect(isMobileDevice({ userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 10) Chrome/142.0 Mobile Safari/537.36" })).toBe(true);
    expect(isMobileDevice({ userAgent: "Mozilla/5.0 (Linux; Android 16; SM-X910) Chrome/142.0 Safari/537.36" })).toBe(true);
    expect(isMobileDevice({ userAgent: desktopChrome, uaDataMobile: true })).toBe(true);
  });

  it("recognises iPadOS, which reports a Mac user agent", () => {
    expect(isMobileDevice({ userAgent: macSafari, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
  });

  it("treats a touch-only device with a desktop user agent as mobile", () => {
    expect(isMobileDevice({ userAgent: desktopChrome, platform: "Linux x86_64", maxTouchPoints: 5, coarseOnly: true })).toBe(true);
  });
});
