import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dongle } from "./dongle";
import { DONGLE_GET, PRODUCT_ID, REPLY_TIMEOUT_MS, VENDOR_ID, buildFrame } from "./frames";

class FakeDevice extends EventTarget {
  opened = true;
  productName = "Loop120\u202E\u0000";
  collections = [{ outputReports: [{ reportId: 0x12, items: [{ reportSize: 8, reportCount: 63 }] }] }];
  sendReport = vi.fn(async (_reportId: number, _data: Uint8Array) => {});
  close = vi.fn(async () => { this.opened = false; });
  reply(tag1: number, tag2: number, value: number[] = []) {
    const event = Object.assign(new Event("inputreport"), { reportId: 0x13, data: new DataView(buildFrame(tag1, tag2, value).buffer) });
    this.dispatchEvent(event);
  }
}

const setup = () => {
  const device = new FakeDevice();
  const dongle = new Dongle(device as unknown as HIDDevice);
  return { device, dongle };
};
const DONGLE_GET_TAG1 = 0x11;

describe("Dongle", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("pads writes to the declared report size and sanitizes productName", async () => {
    const { device, dongle } = setup();
    const done = dongle.dongleGet(DONGLE_GET.version);
    await vi.advanceTimersByTimeAsync(50);
    expect(device.sendReport.mock.calls[0][1]).toHaveLength(63);
    device.reply(DONGLE_GET_TAG1, DONGLE_GET.version | 0x8000, [7]);
    await expect(done).resolves.toEqual(Uint8Array.from([7]));
    expect(dongle.productName).toBe("Loop120");
  });

  it("routes replies by tag and passes other frames to onNotification", async () => {
    const { device, dongle } = setup();
    const notes: number[] = [];
    dongle.onNotification = (frame) => notes.push(frame.tag2);
    const done = dongle.dongleGet(DONGLE_GET.address);
    await vi.advanceTimersByTimeAsync(50);
    device.reply(0x12, 3, [1]);                                    // notification in between
    device.reply(DONGLE_GET_TAG1, DONGLE_GET.version | 0x8000);    // reply to some other command
    device.reply(DONGLE_GET_TAG1, DONGLE_GET.address | 0x8000, [1, 2]);
    await expect(done).resolves.toEqual(Uint8Array.from([1, 2]));
    expect(notes).toEqual([3, DONGLE_GET.version | 0x8000]);
  });

  it("times out without a reply", async () => {
    const { dongle } = setup();
    const done = dongle.dongleGet(DONGLE_GET.address);
    const assertion = expect(done).rejects.toThrow(/No reply/);
    await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS + 100);
    await assertion;
  });

  it("a failed send settles its waiter and does not clobber a retry with the same key", async () => {
    const { device, dongle } = setup();
    device.sendReport.mockRejectedValueOnce(new Error("NotAllowedError"));
    const first = dongle.dongleGet(DONGLE_GET.address);
    const firstAssertion = expect(first).rejects.toThrow("NotAllowedError");
    await vi.advanceTimersByTimeAsync(50);
    await firstAssertion;

    // Retry halfway through the first request's timeout, then wait past where a stale first timer would
    // fire (and delete the retry's waiter) but before the retry's own timeout.
    await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS / 2);
    const retry = dongle.dongleGet(DONGLE_GET.address);
    let settled = false;
    retry.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS * 0.75);
    expect(settled).toBe(false);
    device.reply(DONGLE_GET_TAG1, DONGLE_GET.address | 0x8000, [9]);
    await expect(retry).resolves.toEqual(Uint8Array.from([9]));
  });

  it("close() during an in-flight sendReport rejects with the close reason", async () => {
    const { device, dongle } = setup();
    let failSend!: (error: unknown) => void;
    device.sendReport.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failSend = reject; }));
    const done = dongle.dongleGet(DONGLE_GET.address);
    const assertion = expect(done).rejects.toThrow("Unplugged");
    await vi.advanceTimersByTimeAsync(50);
    expect(device.sendReport).toHaveBeenCalledTimes(1);
    await dongle.close("Unplugged");  // rejects the reply promise while sendReport is still pending
    failSend(new DOMException("The device was closed.", "InvalidStateError"));
    await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS + 100);
    await assertion;
  });

  it("close() during a sendReport that then succeeds still rejects with the close reason", async () => {
    const { device, dongle } = setup();
    let finishSend!: () => void;
    device.sendReport.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSend = resolve; }));
    const done = dongle.dongleGet(DONGLE_GET.address);
    const assertion = expect(done).rejects.toThrow("Unplugged");
    await vi.advanceTimersByTimeAsync(50);
    await dongle.close("Unplugged");
    finishSend();
    await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS + 100);
    await assertion;
  });

  it("close() rejects pending and queued requests without sending them", async () => {
    const { device, dongle } = setup();
    const pending = dongle.dongleGet(DONGLE_GET.address);
    const queued = dongle.dongleGet(DONGLE_GET.version);
    const assertions = [expect(pending).rejects.toThrow("Unplugged"), expect(queued).rejects.toThrow("Unplugged")];
    await vi.advanceTimersByTimeAsync(50);
    expect(device.sendReport).toHaveBeenCalledTimes(1);
    await dongle.close("Unplugged");
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all(assertions);
    expect(device.sendReport).toHaveBeenCalledTimes(1);
    expect(device.close).toHaveBeenCalled();
    await expect(dongle.dongleGet(DONGLE_GET.address)).rejects.toThrow("Unplugged");
  });
});

describe("Dongle.reopenPermitted", () => {
  const hid = (vendorId: number, productId: number, usage = 0x01) =>
    Object.assign(new FakeDevice(), { vendorId, productId, opened: false, open: vi.fn(async function (this: FakeDevice) { this.opened = true; }),
      collections: [{ usagePage: 0x0c, usage, outputReports: [] }] });
  const stubHid = (devices: unknown[]) => vi.stubGlobal("navigator", { hid: { getDevices: vi.fn(async () => devices) } });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uses the given control collection and opens it", async () => {
    const given = hid(VENDOR_ID, PRODUCT_ID);
    stubHid([hid(VENDOR_ID, PRODUCT_ID)]);
    const dongle = await Dongle.reopenPermitted(given as unknown as HIDDevice);
    expect(dongle?.device).toBe(given);
    expect(given.open).toHaveBeenCalledOnce();
  });
  it("falls back to the first permitted control collection", async () => {
    const other = hid(VENDOR_ID, PRODUCT_ID, 0x02);
    const permitted = hid(VENDOR_ID, PRODUCT_ID);
    stubHid([hid(1, 2), other, permitted]);
    expect((await Dongle.reopenPermitted(other as unknown as HIDDevice))?.device).toBe(permitted);
    expect((await Dongle.reopenPermitted())?.device).toBe(permitted);
  });
  it("returns null when nothing is permitted", async () => {
    stubHid([hid(1, 2)]);
    expect(await Dongle.reopenPermitted()).toBeNull();
  });
});
