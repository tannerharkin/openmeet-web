// =================================================================================================
// Loop120 / OpenMeet vendor protocol: constants and framing
//
// The headset talks Bluetooth to the dongle; the dongle talks USB HID to the PC. Every command is a
// frame carrying "tag1" (who it is for and whether it reads or writes), "tag2" (which command) and
// an optional value. Dongle frames go on HID report 0x12; headset frames go on report 0x14 and the
// dongle relays them over a Bluetooth serial (SPP) channel, UUID 0xFEF0, that it only opens when
// asked. Replies come back on reports 0x13 / 0x15 with tag2 | 0x8000.
// =================================================================================================
export const VENDOR_ID = 0x3511;             // Shokz
export const PRODUCT_ID = 0x2f06;            // Loop120

// Per-model differences. The OpenMeet (C610) is what this project was captured from; the OpenMeet 2
// (C62x, "IWE" in the vendor app) uses the same frames except for the SPP channel UUID and the
// mute-reminder tags, so it is offered as experimental: nothing here has been verified on one.
// The mute-reminder tags are per model; they are part of the tag2 allowlist below.
export type MuteReminderGetTag = 21 | 113;
export type MuteReminderSetTag = 25 | 81;
export interface HeadsetProfile {
  model: string;             // display name
  channelUuid: number;       // SPP channel the dongle tunnels headset commands through
  muteReminderGet: MuteReminderGetTag;  // tag2 of the GET, and which reply byte holds the on/off flag
  muteReminderFlagIndex: number;
  muteReminderSet: MuteReminderSetTag;  // tag2 of the SET
  experimental: boolean;
}
const OPENMEET: HeadsetProfile = { model: "OpenMeet", channelUuid: 0xfef0, muteReminderGet: 21, muteReminderFlagIndex: 0, muteReminderSet: 25, experimental: false };
const OPENMEET2: HeadsetProfile = { model: "OpenMeet 2", channelUuid: 0xfc4a, muteReminderGet: 113, muteReminderFlagIndex: 1, muteReminderSet: 81, experimental: true };

// The dongle reports a 4-character model code; like the vendor app (Connector.cs), "C610" must match exactly
// and "C62" anywhere in the code (substring, `model.Contains("C62")`).
export function profileForModel(code: string): HeadsetProfile | null {
  if (code === "C610") return OPENMEET;
  if (code.includes("C62")) return OPENMEET2;
  return null;
}

export type Target = "Dongle" | "Headset";
export type Kind = "Get" | "Set";
export const ROUTE: Record<`${Target}.${Kind}`, { reportId: number; tag1: number }> = {
  "Dongle.Get": { reportId: 0x12, tag1: 0x11 },
  "Dongle.Set": { reportId: 0x12, tag1: 0x10 },
  "Headset.Get": { reportId: 0x14, tag1: 0x02 },
  "Headset.Set": { reportId: 0x14, tag1: 0x01 },
};
export const DONGLE_SYNC_TAG1 = 0x12;   // unsolicited dongle notifications
export const HEADSET_SYNC_TAG1 = 0x03;  // unsolicited headset notifications

// Command numbers (tag2). Firmware-update, reset and factory commands are intentionally left out, and
// the *Tag types below make Dongle's public methods accept only these numbers, so tsc enforces it.
export const DONGLE_GET = { address: 1, headsetLinked: 9, version: 10, headsetModel: 12, pairedList: 6, channelStatus: 7 } as const;
export const DONGLE_SET = { startScan: 1, stopScan: 2, connectChannel: 5, pair: 13, deletePaired: 14 } as const;
export const HEADSET_GET = {
  version: 2, battery: 3, pairedList: 4, language: 6, eq: 8, multipoint: 16, promptVolume: 17,
  buttonSound: 18, focusMode: 19, busylight: 20, pcAudioPriority: 22,  // mute reminder: see HeadsetProfile
  autoOff: 23, prompt: 24, charging: 25, inCall: 30,
} as const;
export const HEADSET_SET = {
  forget: 9, connect: 11, disconnect: 12, eq: 14, multipointOff: 16, multipointOn: 17,
  promptVolume: 21, buttonSound: 22, focusMode: 23, busylight: 24,  // mute reminder: see HeadsetProfile
  pcAudioPriority: 26, autoOff: 27, prompt: 28, startPairing: 29, previewPrompt: 30, stopPairing: 35,
} as const;
export type DongleGetTag = (typeof DONGLE_GET)[keyof typeof DONGLE_GET];
export type DongleSetTag = (typeof DONGLE_SET)[keyof typeof DONGLE_SET];
export type HeadsetGetTag = (typeof HEADSET_GET)[keyof typeof HEADSET_GET] | MuteReminderGetTag;
export type HeadsetSetTag = (typeof HEADSET_SET)[keyof typeof HEADSET_SET] | MuteReminderSetTag;

export const DONGLE_NOTIFICATION: Record<number, string> = { 1: "BluetoothLink", 2: "ControlChannel", 3: "ScanResult", 4: "PairResult" };
export const HEADSET_NOTIFICATION: Record<number, string> = { 2: "Charging", 3: "Battery", 9: "Eq", 11: "DeviceConnection" };

// Value encodings. Most on/off settings are a 4-byte little-endian 0/1; the exceptions are below.
export const EQ_NAME: Record<number, string> = { 0: "None", 1: "Standard", 2: "Vocal", 3: "Bass", 4: "High", 5: "Custom1", 6: "Custom2", 7: "Swimming", 8: "Bone" };
export const EQ_CODE = { Standard: 1, Vocal: 2 } as const;  // the only two presets the C610 offers
export const PROMPT_VOLUME_NAME: Record<number, PromptVolume> = { 0: "Medium", 1: "High", 2: "Low" };
export const PROMPT_VOLUME_CODE = { Medium: 0, High: 1, Low: 2 } as const;
// Prompt type is 4 bytes: byte 0 = prompts off, byte 2 = tone instead of voice.
export const PROMPT_BYTES = { Voice: [0, 0, 0, 0], Tone: [0, 0, 1, 0], Off: [1, 0, 0, 0] } as const;
export const LANGUAGE_NAME: Record<number, string> = { 0: "English", 1: "Chinese", 2: "Japanese", 3: "Korean", 4: "French", 5: "German", 6: "Spanish" };
export const AUTO_OFF_MINUTES = [0, 15, 30, 60, 120, 240, 360, 480] as const;

export type Eq = keyof typeof EQ_CODE;
export type Prompt = keyof typeof PROMPT_BYTES;
export type PromptVolume = keyof typeof PROMPT_VOLUME_CODE;

export const WRITE_SPACING_MS = 30;   // the official app never writes faster than this
export const REPLY_TIMEOUT_MS = 8000; // and gives up on a reply after this long

// =================================================================================================
// Framing (bytes after the HID report ID, which WebHID carries separately)
//
//   byte 0-1    A5 5A                           start marker
//   byte 2-3    payload length + 4 (u16 LE)     covers bytes 4-11 plus the payload
//   byte 4-7    packets total (1), packet index (1), protocol type (0 = TLV), reserved (0)
//   byte 8-9    payload length (u16 LE)
//   byte 10-11  CRC-16 of payload (u16 LE)
//   byte 12-    payload: TLV 1 { TLV 2 = tag1, TLV 3 = tag2, TLV 4 = value }  (u32 LE type/length)
//
// A TLV is "type (4 bytes), length (4 bytes), value"; the payload is one TLV of type 1 wrapping the
// three inner TLVs. One 512-byte report may hold several frames; the next starts at 8 + frame length.
// =================================================================================================
export type Bytes = ArrayLike<number> & Iterable<number>;
export interface Frame { tag1: number; tag2: number; value: Uint8Array }

export const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
export const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
export const le16 = (b: Bytes, o = 0) => b[o] | (b[o + 1] << 8);
export const le32 = (b: Bytes, o = 0) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export const hex = (bytes: Bytes, sep = " ") => Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(sep);
export const macString = (bytes: Bytes) => hex(bytes, ":");
const MAC_PATTERN = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
export function macBytes(text: string): number[] {
  if (!MAC_PATTERN.test(text)) throw new Error(`Not a Bluetooth address: '${text}'`);
  return text.split(":").map((h) => parseInt(h, 16));
}
export const paddedText = (bytes: Uint8Array, offset = 0) => new TextDecoder().decode(bytes.subarray(offset)).replace(/\0+$/, "");
// Device-supplied display text: control characters and bidi overrides could fake or reorder UI text,
// so they go; other format characters stay (ZWJ U+200D joins emoji). Clamped to 64 code points.
const UNSAFE_TEXT = /[\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
export const deviceText = (bytes: Uint8Array, offset = 0) => Array.from(paddedText(bytes, offset).replace(UNSAFE_TEXT, "")).slice(0, 64).join("");
export const flagValue = (on: boolean) => u32(on ? 1 : 0);
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// CRC-16/MAXIM (poly 0x8005 reflected = 0xA001, init 0, final xor 0xFFFF)
export function crc16(bytes: Bytes): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc ^ 0xffff;
}

const tlv = (type: number, value: Bytes) => [...u32(type), ...u32(value.length), ...value];

export function buildFrame(tag1: number, tag2: number, value: Bytes = []): Uint8Array {
  const payload = tlv(1, [...tlv(2, u32(tag1)), ...tlv(3, u32(tag2)), ...tlv(4, value)]);
  return Uint8Array.from([
    0xa5, 0x5a, ...u16(payload.length + 4), 1, 1, 0, 0, ...u16(payload.length), ...u16(crc16(payload)), ...payload,
  ]);
}

// Splits one input report into its frames; malformed frames are dropped through `warn`.
export function parseReport(bytes: Uint8Array, warn: (message: string) => void = () => {}): Frame[] {
  const frames: Frame[] = [];
  let offset = 0;
  while (offset + 12 <= bytes.length && bytes[offset] === 0xa5 && bytes[offset + 1] === 0x5a) {
    const frameLength = le16(bytes, offset + 2);
    const packets = bytes[offset + 4];
    const payloadLength = le16(bytes, offset + 8);
    const crc = le16(bytes, offset + 10);
    const start = offset + 12;
    offset += 8 + frameLength;  // always advances by at least 8, so the loop terminates

    if (frameLength !== payloadLength + 4) {
      warn(`Dropping frame with inconsistent lengths (frame length=${frameLength}, payload length=${payloadLength})`);
      continue;
    }
    if (packets !== 1 || start + payloadLength > bytes.length) {
      warn(`Dropping unsupported frame (packets=${packets}, payload length=${payloadLength})`);
      continue;
    }
    const payload = bytes.subarray(start, start + payloadLength);
    if (crc16(payload) !== crc) {
      warn(`Dropping frame with bad CRC: ${hex(payload)}`);
      continue;
    }
    const fields = new Map<number, Uint8Array>();
    for (let pos = 8; pos + 8 <= payload.length; ) {
      const type = le32(payload, pos);
      const length = le32(payload, pos + 4);
      if (pos + 8 + length > payload.length) break;
      fields.set(type, payload.slice(pos + 8, pos + 8 + length));
      pos += 8 + length;
    }
    const tag1 = fields.get(2);
    const tag2 = fields.get(3);
    if (!tag1 || !tag2 || tag1.length < 4 || tag2.length < 4) {
      warn(`Dropping frame without valid tag fields: ${hex(payload)}`);
      continue;
    }
    frames.push({ tag1: le32(tag1), tag2: le32(tag2), value: fields.get(4) ?? new Uint8Array(0) });
  }
  // Reports are zero padded; anything else left over is a frame that was not recognised.
  if (offset < bytes.length && bytes.subarray(offset).some((b) => b !== 0)) warn(`Ignoring ${bytes.length - offset} unparsed bytes at offset ${offset}`);
  return frames;
}

export function notificationName(frame: Frame): string {
  if (frame.tag1 === DONGLE_SYNC_TAG1 && DONGLE_NOTIFICATION[frame.tag2]) return `Dongle.${DONGLE_NOTIFICATION[frame.tag2]}`;
  if (frame.tag1 === HEADSET_SYNC_TAG1 && HEADSET_NOTIFICATION[frame.tag2]) return `Headset.${HEADSET_NOTIFICATION[frame.tag2]}`;
  if (frame.tag2 & 0x8000) return `Late reply (tag1=${frame.tag1} tag2=${frame.tag2 & 0x7fff})`;  // its request already timed out
  return `Unknown tag1=${frame.tag1} tag2=${frame.tag2}`;
}

// Human-readable notification payloads. Layouts: link = mac(6) status(1); channel = mac(6) uuid(2) status(1);
// scan/connection = mac(6) [status(1)] nameLen(1) name; pair = mac(6) result(1, 1 = failed); battery = level 0..9;
// charging = [0] (0 = on charger); eq = preset.
export function describeNotification(frame: Frame): string {
  const v = frame.value;
  const name = notificationName(frame);
  const mac = () => (v.length >= 6 ? macString(v.subarray(0, 6)) : "?");
  const text = (offset: number) => (v.length > offset ? deviceText(v.subarray(offset + 1, offset + 1 + v[offset])) : "");
  switch (name) {
    case "Dongle.BluetoothLink": return `Headset ${mac()} ${v[6] === 1 ? "linked" : "link lost"}`;
    case "Dongle.ControlChannel": return `Control channel to ${mac()} ${v[8] === 1 ? "open" : "closed"}`;
    case "Dongle.ScanResult": return `Found ${text(6)} (${mac()})`;
    case "Dongle.PairResult": return `Pairing with ${mac()} ${v[6] === 1 ? "failed" : "succeeded"}`;
    case "Headset.Battery": return `Battery ${v.length === 0 ? "?" : (v[0] + 1) * 10} %`;
    case "Headset.Charging": return v[0] === 0 ? "Charger connected" : "Running on battery";
    case "Headset.Eq": return `Equalizer changed to ${v.length === 0 ? "?" : EQ_NAME[v[0]] ?? `code ${v[0]}`}`;
    case "Headset.DeviceConnection": return `${text(7) || mac()} ${v[6] === 1 ? "connected" : "disconnected"}`;
    default: return `${name}: ${hex(v)}`;
  }
}
