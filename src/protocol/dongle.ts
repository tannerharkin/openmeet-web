import {
  buildFrame, deviceText, parseReport, type Frame, type Kind, type Target, type Bytes, PRODUCT_ID, REPLY_TIMEOUT_MS, ROUTE, VENDOR_ID, WRITE_SPACING_MS, sleep,
  type DongleGetTag, type DongleSetTag, type HeadsetGetTag, type HeadsetSetTag,
} from "./frames";

export type FrameListener = (direction: "IN" | "OUT", reportId: number, bytes: Uint8Array) => void;
export type NotificationListener = (frame: Frame) => void;

// One WebHID device: requests run one at a time (like the official app) and replies are matched by
// tag, so notifications that arrive in between are routed separately instead of being mistaken.
export class Dongle {
  // Reopens a dongle the user already granted in an earlier session (no picker needed). Prefers
  // `device` (e.g. the one just plugged in) when it is a control collection.
  static async reopenPermitted(device?: HIDDevice): Promise<Dongle | null> {
    if (!device || !Dongle.isControlCollection(device)) {
      device = (await navigator.hid.getDevices()).find((candidate) => Dongle.isControlCollection(candidate));
    }
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
  private closedReason: string | null = null;         // set by close(); later and queued requests fail with it

  constructor(device: HIDDevice) {
    this.device = device;
    for (const collection of device.collections) {
      for (const report of collection.outputReports ?? []) {
        const bits = (report.items ?? []).reduce((n, item) => n + (item.reportSize ?? 0) * (item.reportCount ?? 0), 0);
        if (report.reportId !== undefined) this.outputLength.set(report.reportId, Math.ceil(bits / 8));
      }
    }
    device.addEventListener("inputreport", this.listener);
  }

  private readonly listener = (event: HIDInputReportEvent) => this.handleReport(event);

  // Sanitized: the product string comes from the USB descriptor and is shown in the UI.
  get productName() { return deviceText(new TextEncoder().encode(this.device.productName)); }

  // Fails every request still waiting for a reply or queued (used when the dongle is unplugged) and closes the device.
  async close(reason = "Dongle closed"): Promise<void> {
    this.closedReason = reason;
    this.device.removeEventListener("inputreport", this.listener);  // a later Dongle may reuse this HIDDevice
    for (const waiter of [...this.pending.values()]) waiter(new Error(reason));
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

  // Internal: public callers go through the typed dongleGet/Set and headsetGet/Set below.
  private request(target: Target, kind: Kind, tag2: number, value: Bytes = []): Promise<Uint8Array> {
    const run = async () => {
      if (this.closedReason !== null) throw new Error(this.closedReason);
      const route = ROUTE[`${target}.${kind}`];
      const spacing = WRITE_SPACING_MS - (performance.now() - this.lastWrite);
      if (spacing > 0) await sleep(spacing);
      if (this.closedReason !== null) throw new Error(this.closedReason);

      const key = `${route.tag1}:${tag2 | 0x8000}`;
      let settle!: (result: Uint8Array | Error) => void;
      const reply = new Promise<Uint8Array>((resolve, reject) => {
        // Only remove the map entry if it is still ours: a retry with the same key may have replaced it.
        const release = () => { if (this.pending.get(key) === settle) this.pending.delete(key); };
        const timer = setTimeout(() => {
          release();
          reject(new Error(`No reply from ${target} to ${kind} command ${tag2} within ${REPLY_TIMEOUT_MS / 1000} s.`));
        }, REPLY_TIMEOUT_MS);
        settle = (result) => {
          clearTimeout(timer);
          release();
          if (result instanceof Error) reject(result); else resolve(result);
        };
        this.pending.set(key, settle);
      });
      reply.catch(() => {});  // close() may reject it while sendReport is still in flight; callers get it via `return reply`

      const frame = buildFrame(route.tag1, tag2, value);
      const padded = new Uint8Array(Math.max(frame.length, this.outputLength.get(route.reportId) ?? 0));
      padded.set(frame);
      this.onFrame("OUT", route.reportId, frame);
      try {
        await this.device.sendReport(route.reportId, padded);
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
        // A send that fails because close() closed the device reports the close reason, not a DOMException.
        if (this.closedReason !== null) throw new Error(this.closedReason);
        throw error;
      }
      this.lastWrite = performance.now();
      return reply;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  dongleGet(tag2: DongleGetTag, value?: Bytes) { return this.request("Dongle", "Get", tag2, value); }
  dongleSet(tag2: DongleSetTag, value?: Bytes) { return this.request("Dongle", "Set", tag2, value); }
  headsetGet(tag2: HeadsetGetTag, value?: Bytes) { return this.request("Headset", "Get", tag2, value); }
  headsetSet(tag2: HeadsetSetTag, value?: Bytes) { return this.request("Headset", "Set", tag2, value); }
}
