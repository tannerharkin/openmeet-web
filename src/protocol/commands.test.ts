import { describe, expect, it, vi } from "vitest";
import { assertHeadsetIdle, parseHeadsetDevices, readChannelStatus, unpairDongle, writeSetting } from "./commands";
import type { Dongle } from "./dongle";
import type { HeadsetProfile } from "./frames";

// Only the methods commands.ts calls; each answers with the given reply.
const fakeDongle = (reply: number[]) => {
  const send = vi.fn(async () => Uint8Array.from(reply));
  const dongle = { dongleGet: send, dongleSet: send, headsetGet: send, headsetSet: send } as unknown as Dongle;
  return { dongle, send };
};

describe("parseHeadsetDevices", () => {
  it("parses entries and survives a truncated last entry", () => {
    const name = new TextEncoder().encode("Phone\u202E");
    const entry = [0, 1, 2, 3, 4, 5, 6, 1, name.length, ...name];
    const list = Uint8Array.from([0, 3, ...entry, 1, 9, 9, 9, 9, 9, 9, 0, 20, 0x41]);
    expect(parseHeadsetDevices(list)).toEqual([
      { name: "Phone", address: "01:02:03:04:05:06", connected: true },
      { name: "A", address: "09:09:09:09:09:09", connected: false },
    ]);
  });
});

describe("short replies fail closed", () => {
  it("readChannelStatus throws on fewer than 9 bytes", async () => {
    await expect(readChannelStatus(fakeDongle([0, 0, 1, 1, 2]).dongle, 0xfef0)).rejects.toThrow(/truncated/);
  });
  it("readChannelStatus reads a full reply", async () => {
    const status = await readChannelStatus(fakeDongle([0, 0, 1, 1, 2, 3, 4, 5, 6]).dongle, 0xfef0);
    expect(status.open).toBe(true);
    expect(Array.from(status.headsetAddress)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it.each([[[]], [[0]]])("assertHeadsetIdle throws on %j", async (reply) => {
    await expect(assertHeadsetIdle(fakeDongle(reply).dongle)).rejects.toThrow("Could not read the headset's call state");
  });
  it("assertHeadsetIdle passes when idle and throws in a call", async () => {
    await expect(assertHeadsetIdle(fakeDongle([0, 0]).dongle)).resolves.toBeUndefined();
    await expect(assertHeadsetIdle(fakeDongle([0, 1]).dongle)).rejects.toThrow(/in a call/);
  });
});

describe("unpairDongle", () => {
  it.each([["bad", "01:02:03:04:05:06"], ["01:02:03:04:05:06", "nope"], ["01:02:03:04:05:06", "00:00:00:00:00:00"]])(
    "validates %s / %s before sending anything", async (dongleAddress, headsetAddress) => {
      const { dongle, send } = fakeDongle([0]);
      await expect(unpairDongle(dongle, dongleAddress, headsetAddress)).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
    });
  it("sends both commands for valid addresses", async () => {
    const calls: [string, number, number[]][] = [];
    const record = (method: string) => vi.fn(async (tag: number, value: number[] = []) => { calls.push([method, tag, [...value]]); return Uint8Array.of(0); });
    const dongle = { dongleGet: record("dongleGet"), dongleSet: record("dongleSet"), headsetGet: record("headsetGet"), headsetSet: record("headsetSet") } as unknown as Dongle;
    await unpairDongle(dongle, "01:02:03:04:05:06", "0A:0B:0C:0D:0E:0F");
    expect(calls).toEqual([
      ["headsetSet", 9, [1, 2, 3, 4, 5, 6, 0, 0]],
      ["dongleSet", 14, [10, 11, 12, 13, 14, 15, 0, 0]],
    ]);
  });
});

describe("writeSetting multipoint off", () => {
  const profile = {} as HeadsetProfile;
  it.each([[[1, 2, 3]], [[0, 0, 0, 0, 0, 0, 0, 0]]])("refuses dongle address reply %j without sending", async (reply) => {
    const { dongle, send } = fakeDongle(reply);
    await expect(writeSetting(dongle, profile, { name: "multipoint", value: false })).rejects.toThrow(/dongle's address/);
    expect(send).toHaveBeenCalledTimes(1);  // only the address read
  });
  it("sends the dongle address", async () => {
    const { dongle, send } = fakeDongle([1, 2, 3, 4, 5, 6, 0, 0]);
    await writeSetting(dongle, profile, { name: "multipoint", value: false });
    expect(send).toHaveBeenLastCalledWith(16, Uint8Array.of(1, 2, 3, 4, 5, 6));
  });
});
