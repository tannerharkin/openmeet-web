import { buildFrame, parseReport, type Frame, type Kind, type Target, type Bytes, PRODUCT_ID, REPLY_TIMEOUT_MS, ROUTE, VENDOR_ID, WRITE_SPACING_MS, sleep } from "./frames";

export type FrameListener = (direction: "IN" | "OUT", reportId: number, bytes: Uint8Array) => void;
export type NotificationListener = (frame: Frame) => void;

// One WebHID device: requests run one at a time (like the official app) and replies are matched by
// tag, so notifications that arrive in between are routed separately instead of being mistaken.
export class Dongle {
  // Reopens a dongle the user already granted in an earlier session (no picker needed).
  static async reopenPermitted(): Promise<Dongle | null> {
    const devices = await navigator.hid.getDevices();
    const device = devices.find((candidate) => Dongle.isControlCollection(candidate));
    if (!device) return null;
    if (!device.opened) await device.open();
    return new Dongle(device);
  }

  static isControlCollection(device: HIDDevice): boolean {
    return device.vendorId === VENDOR_ID && device.productId === PRODUCT_ID &&
      device.collections.some((c) => c.usagePage === 0x0c && c.usage === 0x01);
  }

  static async pick(): Promise<Dongle> {
    // Only the Consumer Control collection carries the protocol; the picker filters on it.
    const [device] = await navigator.hid.requestDevice({
      filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID, usagePage: 0x0c, usage: 0x01 }],
    });
    if (!device) throw new Error("No dongle selected.");
    if (!device.opened) await device.open();
    return new Dongle(device);
  }

  readonly device: HIDDevice;
  onNotification: NotificationListener = () => {};
  onWarning: (message: string) => void = () => {};
  onFrame: FrameListener = () => {};

  private pending = new Map<string, (result: Uint8Array | Error) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastWrite = 0;
  private outputLength = new Map<number, number>();  // report ID -> declared size, so writes can be zero-padded

  constructor(device: HIDDevice) {
    this.device = device;
    for (const collection of device.collections) {
      for (const report of collection.outputReports ?? []) {
        const bits = (report.items ?? []).reduce((n, item) => n + (item.reportSize ?? 0) * (item.reportCount ?? 0), 0);
        if (report.reportId !== undefined) this.outputLength.set(report.reportId, bits / 8);
      }
    }
    device.addEventListener("inputreport", this.listener);
  }

  private readonly listener = (event: HIDInputReportEvent) => this.handleReport(event);

  get productName() { return this.device.productName; }

  // Fails every request still waiting for a reply (used when the dongle is unplugged) and closes the device.
  async close(reason = "Dongle closed"): Promise<void> {
    this.device.removeEventListener("inputreport", this.listener);  // a later Dongle may reuse this HIDDevice
    for (const waiter of this.pending.values()) waiter(new Error(reason));
    this.pending.clear();
    if (this.device.opened) await this.device.close().catch(() => {});
  }

  private handleReport(event: HIDInputReportEvent) {
    if (event.reportId === 0x01) return;  // media-key report from the same collection
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    this.onFrame("IN", event.reportId, bytes);
    for (const frame of parseReport(bytes, this.onWarning)) {
      const waiter = this.pending.get(`${frame.tag1}:${frame.tag2}`);
      if (waiter) waiter(frame.value);
      else this.onNotification(frame);
    }
  }

  request(target: Target, kind: Kind, tag2: number, value: Bytes = []): Promise<Uint8Array> {
    const run = async () => {
      const route = ROUTE[`${target}.${kind}`];
      const spacing = WRITE_SPACING_MS - (performance.now() - this.lastWrite);
      if (spacing > 0) await sleep(spacing);

      const key = `${route.tag1}:${tag2 | 0x8000}`;
      const reply = new Promise<Uint8Array>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(key);
          reject(new Error(`No reply from ${target} to ${kind} command ${tag2} within ${REPLY_TIMEOUT_MS / 1000} s.`));
        }, REPLY_TIMEOUT_MS);
        this.pending.set(key, (result) => {
          clearTimeout(timer);
          this.pending.delete(key);
          if (result instanceof Error) reject(result); else resolve(result);
        });
      });

      const frame = buildFrame(route.tag1, tag2, value);
      const padded = new Uint8Array(Math.max(frame.length, this.outputLength.get(route.reportId) ?? 0));
      padded.set(frame);
      this.onFrame("OUT", route.reportId, frame);
      await this.device.sendReport(route.reportId, padded);
      this.lastWrite = performance.now();
      return reply;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  dongleGet(tag2: number, value?: Bytes) { return this.request("Dongle", "Get", tag2, value); }
  dongleSet(tag2: number, value?: Bytes) { return this.request("Dongle", "Set", tag2, value); }
  headsetGet(tag2: number, value?: Bytes) { return this.request("Headset", "Get", tag2, value); }
  headsetSet(tag2: number, value?: Bytes) { return this.request("Headset", "Set", tag2, value); }
}
