import { describe, expect, it, vi } from "vitest";
import { buildFrame, crc16, describeNotification, deviceText, macBytes, parseReport, profileForModel, u16, u32 } from "./frames";

const report = (...frames: Uint8Array[]) => {
  const out = new Uint8Array(512);
  let o = 0;
  for (const f of frames) { out.set(f, o); o += f.length; }
  return out;
};
// A well-formed header around an arbitrary payload (for building hostile TLVs).
const rawFrame = (payload: number[], frameLength = payload.length + 4) =>
  Uint8Array.from([0xa5, 0x5a, ...u16(frameLength), 1, 1, 0, 0, ...u16(payload.length), ...u16(crc16(payload)), ...payload]);
const enc = (s: string) => new TextEncoder().encode(s);

describe("parseReport", () => {
  it("round-trips buildFrame, several frames per report", () => {
    const warn = vi.fn();
    const frames = parseReport(report(buildFrame(0x11, 0x800a, [1, 2, 3]), buildFrame(0x03, 3, [])), warn);
    expect(frames).toEqual([
      { tag1: 0x11, tag2: 0x800a, value: Uint8Array.from([1, 2, 3]) },
      { tag1: 0x03, tag2: 3, value: new Uint8Array(0) },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops a frame with a bad CRC", () => {
    const f = buildFrame(0x11, 1, [9]);
    f[10] ^= 0xff;
    const warn = vi.fn();
    expect(parseReport(report(f), warn)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bad CRC"));
  });

  it("drops a truncated frame", () => {
    const f = buildFrame(0x11, 1, [1, 2, 3, 4]);
    const warn = vi.fn();
    expect(parseReport(f.subarray(0, f.length - 3), warn)).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("drops a frame whose frame length disagrees with its payload length", () => {
    const f = buildFrame(0x11, 1, [1]);
    f[2] += 1;
    const warn = vi.fn();
    expect(parseReport(report(f), warn)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("inconsistent lengths"));
  });

  it("drops a frame with an empty tag TLV instead of reading tag 0", () => {
    const inner = [...u32(2), ...u32(0), ...u32(3), ...u32(4), ...u32(1)];
    const payload = [...u32(1), ...u32(inner.length), ...inner];
    const warn = vi.fn();
    expect(parseReport(report(rawFrame(payload)), warn)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("tag fields"));
  });

  it("terminates on frame length 0 repeated", () => {
    const bytes = new Uint8Array(512);
    for (let i = 0; i + 12 <= bytes.length; i += 8) bytes.set([0xa5, 0x5a, 0, 0, 1, 1, 0, 0], i);
    expect(parseReport(bytes)).toEqual([]);
  });

  it("warns once about trailing non-zero bytes", () => {
    const warn = vi.fn();
    const bytes = report(buildFrame(0x11, 1));
    bytes[500] = 7;
    expect(parseReport(bytes, warn)).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never throws on random input", () => {
    let seed = 1;
    const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
    for (let n = 0; n < 200; n++) {
      const bytes = Uint8Array.from({ length: 512 }, rand);
      if (n % 2) bytes.set([0xa5, 0x5a]);
      expect(() => parseReport(bytes)).not.toThrow();
    }
  });
});

describe("deviceText", () => {
  it("strips control and bidi characters", () => {
    expect(deviceText(enc("ab\u0007c\u202Ed\u2066e\u200Ff\n\0\0"))).toBe("abcdef");
  });
  it("keeps emoji ZWJ sequences", () => {
    expect(deviceText(enc("\u{1F468}\u200D\u{1F4BB}"))).toBe("\u{1F468}\u200D\u{1F4BB}");
  });
  it("clamps to 64 code points", () => {
    expect(Array.from(deviceText(enc("\u{1F600}".repeat(100))))).toHaveLength(64);
  });
});

describe("macBytes", () => {
  it("accepts a valid address", () => expect(macBytes("aa:BB:01:02:03:ff")).toEqual([0xaa, 0xbb, 1, 2, 3, 0xff]));
  it.each(["", "AA:BB:CC:DD:EE", "AA:BB:CC:DD:EE:FF:00", "AA-BB-CC-DD-EE-FF", "GG:BB:CC:DD:EE:FF", "A:BB:CC:DD:EE:FFF"])(
    "rejects %j", (text) => expect(() => macBytes(text)).toThrow(/Bluetooth address/));
});

describe("describeNotification / profileForModel", () => {
  it("shows ? for empty battery and eq values", () => {
    expect(describeNotification({ tag1: 0x03, tag2: 3, value: new Uint8Array(0) })).toBe("Battery ? %");
    expect(describeNotification({ tag1: 0x03, tag2: 9, value: new Uint8Array(0) })).toBe("Equalizer changed to ?");
    expect(describeNotification({ tag1: 0x03, tag2: 3, value: Uint8Array.of(10) })).toBe("Battery ? %");
    expect(describeNotification({ tag1: 0x03, tag2: 3, value: Uint8Array.of(9) })).toBe("Battery 100 %");
  });
  it("sanitizes scan result names", () => {
    const name = enc("a\u202Eb");
    const value = Uint8Array.from([1, 2, 3, 4, 5, 6, name.length, ...name]);
    expect(describeNotification({ tag1: 0x12, tag2: 3, value })).toBe("Found ab (01:02:03:04:05:06)");
  });
  it("matches C610 exactly and C62 as a substring, like the vendor app", () => {
    expect(profileForModel("C610")?.model).toBe("OpenMeet");
    expect(profileForModel("C610X")).toBeNull();
    expect(profileForModel("C620")?.model).toBe("OpenMeet 2");
    expect(profileForModel("XC62")?.model).toBe("OpenMeet 2");
    expect(profileForModel("C61")).toBeNull();
  });
});
