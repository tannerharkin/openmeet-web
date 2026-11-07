// What isMobileDevice needs from navigator/matchMedia, so it can be checked without a browser.
export interface DeviceHints {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  uaDataMobile?: boolean;
  coarseOnly?: boolean;  // touch is the only pointer (no mouse or trackpad)
}

// Phones and tablets. iPadOS reports a Mac user agent, so it is recognised by a Mac with a touch screen.
export function isMobileDevice(h: DeviceHints): boolean {
  if (h.uaDataMobile) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(h.userAgent)) return true;
  if (h.platform === "MacIntel" && (h.maxTouchPoints ?? 0) > 1) return true;
  return !!h.coarseOnly;
}

export function currentDeviceHints(): DeviceHints {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  const media = (query: string) => typeof matchMedia === "function" && matchMedia(query).matches;
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    uaDataMobile: nav.userAgentData?.mobile,
    coarseOnly: media("(pointer: coarse)") && !media("(any-pointer: fine)"),
  };
}
