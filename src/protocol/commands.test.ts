import { describe, expect, it, vi } from "vitest";
import {
  UnpairIncompleteError, assertHeadsetIdle, parseHeadsetDevices, readChannelStatus, readHeadsetStatus, readSettings, removePairedHeadset, unpairDongle, writeSetting,
} from "./commands";
import type { Dongle } from "./dongle";
import type { HeadsetProfile } from "./frames";

// Only the methods commands.ts calls; each answers with the given reply.
const fakeDongle = (reply: number[]) => {
  const send = vi.fn(async () => Uint8Array.from(reply));
  const dongle = { dongleGet: send, dongleSet: send, headsetGet: send, headsetSet: send } as unknown as Dongle;
  return { dongle, send };
};

describe("parseHeadsetDevices", () => {
  it("parses entries, drops a truncated last entry and skips duplicate addresses", () => {
    const name = new TextEncoder().encode("Phone\u202E");
    const entry = [0, 1, 2, 3, 4, 5, 6, 1, name.length, ...name];
    const other = [1, 9, 9, 9, 9, 9, 9, 0, 1, 0x41];
    const list = Uint8Array.from([0, 4, ...entry, ...other, 2, 1, 2, 3, 4, 5, 6, 0, 1, 0x42, 3, 7, 7, 7, 7, 7, 7, 0, 20, 0x43]);
    expect(parseHeadsetDevices(list)).toEqual([
      { name: "Phone", address: "01:02:03:04:05:06", connected: true },
      { name: "A", address: "09:09:09:09:09:09", connected: false },
    ]);
  });
});

// Answers each headset GET by tag; anything missing replies empty.
const replyByTag = (replies: Record<number, number[]>) =>
  ({ headsetGet: vi.fn(async (tag: number) => Uint8Array.from(replies[tag] ?? [])) }) as unknown as Dongle;

describe("readHeadsetStatus", () => {
  it.each([[[0, 9], 100], [[0, 0], 10], [[0, 10], null], [[0], null], [[1, 5], null], [[], null]])("battery %j -> %s", async (battery, percent) => {
    expect((await readHeadsetStatus(replyByTag({ 3: battery }))).batteryPercent).toBe(percent);
  });
  it.each([[[0, 0, 0, 0], true], [[0, 0, 1, 0], false], [[0, 0, 0, 1], false], [[0, 0, 0], null], [[], null]])("charging %j -> %s", async (charging, value) => {
    expect((await readHeadsetStatus(replyByTag({ 25: charging }))).charging).toBe(value);
  });
});

describe("readSettings", () => {
  const profile = { muteReminderGet: 21, muteReminderFlagIndex: 0 } as unknown as HeadsetProfile;
  it.each([[[0], "Medium"], [[2], "Low"], [[7], null], [[], null]])("prompt volume %j -> %s", async (volume, name) => {
    expect((await readSettings(replyByTag({ 17: volume }), profile)).promptVolume).toBe(name);
  });
  it("reads auto-off as unsigned", async () => {
    expect((await readSettings(replyByTag({ 23: [0xff, 0xff, 0xff, 0xff] }), profile)).autoOffMinutes).toBe(0xffffffff);
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
  const recorder = (failDongleSet = false) => {
    const calls: [string, number, number[]][] = [];
    const record = (method: string) => vi.fn(async (tag: number, value: number[] = []) => {
      calls.push([method, tag, [...value]]);
      if (failDongleSet && method === "dongleSet") throw new Error("No reply");
      return Uint8Array.of(0);
    });
    const dongle = { dongleGet: record("dongleGet"), dongleSet: record("dongleSet"), headsetGet: record("headsetGet"), headsetSet: record("headsetSet") } as unknown as Dongle;
    return { dongle, calls };
  };
  it("sends both commands for valid addresses", async () => {
    const { dongle, calls } = recorder();
    await unpairDongle(dongle, "01:02:03:04:05:06", "0A:0B:0C:0D:0E:0F");
    expect(calls).toEqual([
      ["headsetSet", 9, [1, 2, 3, 4, 5, 6, 0, 0]],
      ["dongleSet", 14, [10, 11, 12, 13, 14, 15, 0, 0]],
    ]);
  });
  it("reports a half-done unpair with the headset address", async () => {
    const error = await unpairDongle(recorder(true).dongle, "01:02:03:04:05:06", "0A:0B:0C:0D:0E:0F").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnpairIncompleteError);
    expect((error as UnpairIncompleteError).headsetAddress).toBe("0A:0B:0C:0D:0E:0F");
    expect((error as Error).message).toBe("The headset forgot this computer, but the dongle did not confirm removing the headset: No reply");
  });
  it("does not wrap a failure of the headset side", async () => {
    const { dongle, calls } = recorder();
    vi.mocked(dongle.headsetSet).mockRejectedValueOnce(new Error("timeout"));
    const error = await unpairDongle(dongle, "01:02:03:04:05:06", "0A:0B:0C:0D:0E:0F").catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UnpairIncompleteError);
    expect(calls).toEqual([]);
  });
  it("removePairedHeadset sends only the dongle-side delete", async () => {
    const { dongle, calls } = recorder();
    await removePairedHeadset(dongle, "0A:0B:0C:0D:0E:0F");
    expect(calls).toEqual([["dongleSet", 14, [10, 11, 12, 13, 14, 15, 0, 0]]]);
    await expect(removePairedHeadset(dongle, "00:00:00:00:00:00")).rejects.toThrow(/unknown/);
    await expect(removePairedHeadset(dongle, "bad")).rejects.toThrow();
    expect(calls).toHaveLength(1);
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
