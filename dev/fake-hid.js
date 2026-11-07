// Scripted Loop120 + OpenMeet for driving the UI without hardware. Injected as a page init script by
// the test harness; reply shapes are captured from a real session, identifiers are synthetic (RFC 7042
// documentation MACs). Not part of the build.
(() => {
  const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const crc16 = b => { let c = 0; for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xA001 : c >>> 1; } return c ^ 0xFFFF; };
  const tlv = (t, v) => [...u32(t), ...u32(v.length), ...v];
  const frame = (t1, t2, v) => { const p = tlv(1, [...tlv(2, u32(t1)), ...tlv(3, u32(t2)), ...tlv(4, v)]); const c = crc16(p), n = p.length + 4; return [0xA5, 0x5A, n & 255, n >> 8, 1, 1, 0, 0, p.length & 255, p.length >> 8, c & 255, c >> 8, ...p]; };
  const rd32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  // Mirrors what the headset checks: magic, consistent lengths, CRC over the payload, then the fixed TLV layout.
  const parse = d => {
    if (d.length < 12 || d[0] !== 0xA5 || d[1] !== 0x5A) throw new Error("bad magic");
    const total = d[2] | (d[3] << 8), plen = d[8] | (d[9] << 8);
    // 40 = outer TLV header (8) + tag1 TLV (12) + tag2 TLV (12) + value TLV header (8): a GET with no value.
    if (total !== plen + 4 || 12 + plen > d.length || plen < 40) throw new Error("bad length");
    const p = d.slice(12, 12 + plen);
    if (crc16(p) !== (d[10] | (d[11] << 8))) throw new Error("bad crc");
    const n = rd32(p, 36);
    if (rd32(p, 0) !== 1 || rd32(p, 4) !== plen - 8 || 40 + n > plen) throw new Error("bad tlv");
    return { t1: rd32(p, 16), t2: rd32(p, 28), v: Array.from(p.slice(40, 40 + n)) };
  };
  const ascii = (s, n) => { const b = Array.from(new TextEncoder().encode(s)); while (b.length < n) b.push(0); return b; };
  const mac = [0x00, 0x00, 0x5E, 0x00, 0x53, 0x01];
  const state = window.__state = { model: "C610", eq: 1, prompt: [0, 0, 1, 0], vol: 0, btn: 1, busy: 1, focus: 0, mute: 0, pc: 1, autoOff: 480, mp: 1, channel: 0, linked: 1, inCall: 0, uuids: [], devices: [
    { mac: [0x00,0x00,0x5E,0x00,0x53,0x03], name: "Example iPhone", connected: 1 }, { mac: [0x00,0x00,0x5E,0x00,0x53,0x02], name: "Loop120 by Shokz", connected: 1 }, { mac: [1,2,3,4,5,6], name: "ThinkPad", connected: 0 } ] };
  const list = () => [0, state.devices.length, ...state.devices.flatMap((d, i) => [i, ...d.mac, d.connected, 31, ...ascii(d.name, 31)])];
  const findDevice = v => state.devices.find(x => x.mac.every((b, i) => b === v[i]));
  let fake;
  const replies = {
    "17:10": () => ascii("D120_DU_V_09_20260722", 32), "17:1": () => [0x00, 0x00, 0x5E, 0x00, 0x53, 0x02, 0, 0], "17:9": () => u32(state.linked), "17:12": () => ascii(state.model, 4),
    "17:7": v => { state.uuids.push("get:" + (v[0] | (v[1] << 8)).toString(16)); return [1, 0, state.channel, ...mac, ...new Array(59).fill(0)]; },
    "16:1": () => { state.scanning = true; clearInterval(state.scanTimer); state.scanTimer = setInterval(() => { if (state.scanning) fake.notify(0x12, 3, [...mac, 17, ...ascii("OpenMeet by Shokz", 17)]); }, 700); return [0, 0, 0, 0]; },
    "16:2": () => { state.scanning = false; clearInterval(state.scanTimer); return [0, 0, 0, 0]; },
    "16:13": v => { setTimeout(() => { fake.notify(0x12, 4, [...v.slice(0, 6), 0, 0]); state.linked = 1; fake.notify(0x12, 1, [...v.slice(0, 6), 1, 0]); }, 1200); return [...v]; },
    "16:14": v => { state.dongleDeleted = true; return [...v]; },
    "16:5": v => { state.uuids.push("set:" + (v[6] | (v[7] << 8)).toString(16)); state.channel = 1; return [...mac, v[6], v[7], 0, 0, 0, 0]; },
    "2:2": () => [0, ...ascii("VA_HU_V_02_20250110", 34)], "2:25": () => state.chargingReply ?? [0, 0, 1, 0], "2:3": () => [0, state.batteryLevel ?? 5, 0xFF, 0], "2:6": () => [0, 0],
    "2:8": () => [0, state.eq, 0, 0, 0, 0, 0, 0], "2:24": () => state.prompt, "2:17": () => [state.vol, 0, 0, 0], "2:18": () => u32(state.btn), "2:20": () => u32(state.busy),
    "2:19": () => u32(state.focus), "2:22": () => u32(state.pc), "2:23": () => u32(state.autoOff), "2:16": () => [0, state.mp, 1, 0], "2:30": () => [0, state.inCall, 0, 0], "2:4": () => { if (state.pendingConnect && --state.pendingConnect.reads <= 0) { state.pendingConnect.device.connected = 1; state.pendingConnect = null; } return list(); },
    "2:21": () => u32(state.mute), "2:113": () => [0, state.mute, 0, 0],
    "1:14": v => { state.eq = v[0]; return [0]; }, "1:28": v => { state.prompt = [...v]; return v; }, "1:21": v => { state.vol = v[0]; return v; }, "1:22": v => { state.btn = v[0]; return v; },
    "1:24": v => { state.busy = v[0]; return v; }, "1:23": v => { state.focus = v[0]; return v; }, "1:25": v => { state.mute = v[0]; return v; }, "1:81": v => { state.mute = v[0]; return [0]; }, "1:26": v => { state.pc = v[0]; return v; },
    "1:27": v => { state.autoOff = v[0] | (v[1] << 8); return v; }, "1:17": () => { state.mp = 1; return [0]; }, "1:16": () => { state.mp = 0; return [0]; }, "1:30": v => v, "1:29": () => [0], "1:35": () => [0],
    "1:9": v => { const d = findDevice(v); state.devices = state.devices.filter(x => x !== d); if (d && d.name.startsWith("Loop120")) { state.linked = 0; state.channel = 0; setTimeout(() => fake.notify(0x12, 1, [...mac, 0, 0]), 300); } return [0]; }, "1:11": v => { const d = findDevice(v); if (d && !state.ignoreConnect) { if (state.slowConnectReads) state.pendingConnect = { device: d, reads: state.slowConnectReads }; else d.connected = 1; } return [0]; }, "1:12": v => { const d = findDevice(v); if (d) d.connected = 0; return [0]; },
  };
  window.__sets = [];
  class FakeDevice extends EventTarget {
    constructor() { super(); this.productName = "Loop120 by Shokz"; this.vendorId = 0x3511; this.productId = 0x2F06; this.opened = false;
      this.collections = [{ usagePage: 0x0C, usage: 0x01, outputReports: [{ reportId: 0x12, items: [{ reportSize: 8, reportCount: 511 }] }, { reportId: 0x14, items: [{ reportSize: 8, reportCount: 511 }] }] }]; }
    async open() { if (state.unplugged) throw new DOMException("Failed to open the device.", "NotAllowedError"); this.opened = true; }
    async close() { this.opened = false; }
    async forget() { this.opened = false; window.__permitted = false; }
    notify(t1, t2, v) { if (state.unplugged) return; const out = new Uint8Array(512); out.set(frame(t1, t2, v)); this.dispatchEvent(Object.assign(new Event("inputreport"), { reportId: t1 === 0x12 ? 0x13 : 0x15, data: new DataView(out.buffer) })); }
    async sendReport(id, data) {
      if (state.unplugged || !this.opened) throw new DOMException("Failed to write the report.", "NotAllowedError");
      if (id !== 0x12 && id !== 0x14) throw new DOMException("Invalid report ID.", "NotAllowedError");
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
      const { t1, t2, v } = (() => { try { return parse(bytes); } catch (e) { throw new DOMException(e.message, "NotAllowedError"); } })();
      if (t1 === 1 || t1 === 16) window.__sets.push({ t1, t2, v });
      const r = replies[t1 + ":" + t2]; if (!r) return;
      const out = new Uint8Array(512); out.set(frame(t1, t2 | 0x8000, r(v)));
      setTimeout(() => { if (!state.unplugged) this.dispatchEvent(Object.assign(new Event("inputreport"), { reportId: id + 1, data: new DataView(out.buffer) })); }, state.replyDelayMs ?? 3);
    }
  }
  fake = window.__fake = new FakeDevice();
  const hid = window.__hid = Object.assign(new EventTarget(), {
    requestDevice: async () => { if (window.__pickerCancel) return []; window.__permitted = true; return [fake]; },
    getDevices: async () => (window.__permitted === false ? [] : [fake]) });
  const hidEvent = type => Object.assign(new Event(type), { device: fake });
  window.__unplug = () => { state.unplugged = true; state.scanning = false; clearInterval(state.scanTimer); fake.opened = false; hid.dispatchEvent(hidEvent("disconnect")); };
  window.__replug = () => { state.unplugged = false; hid.dispatchEvent(hidEvent("connect")); };
  Object.defineProperty(navigator, "hid", { value: hid });
})();
