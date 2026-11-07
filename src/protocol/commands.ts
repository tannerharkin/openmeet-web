import type { Dongle } from "./dongle";
import {
  DONGLE_GET, DONGLE_SET, EQ_CODE, EQ_NAME, HEADSET_GET, HEADSET_SET, LANGUAGE_NAME,
  PROMPT_BYTES, PROMPT_VOLUME_CODE, PROMPT_VOLUME_NAME, deviceText, flagValue, le32, macBytes, macString, paddedText, sleep, u16, u32,
  type HeadsetGetTag,
  type Eq, type Prompt, type PromptVolume, type HeadsetProfile, profileForModel,
} from "./frames";

export interface DongleInfo { product: string; firmware: string; address: string; headsetLinked: boolean; headsetModel: string }
export interface HeadsetStatus { firmware: string; batteryPercent: number | null; charging: boolean; language: string }
export interface Settings {
  eq: string; prompt: Prompt; promptVolume: PromptVolume; buttonSound: boolean; busylight: boolean; focusMode: boolean;
  muteReminder: boolean; pcAudioPriority: boolean; autoOffMinutes: number; multipoint: boolean;
}
export interface PairedDevice { name: string; address: string; connected: boolean }

// Dongle replies: version = zero-padded ASCII; address = 6 bytes in display order + 2 zero bytes;
// headsetLinked = int32 1/0; headsetModel = 4 ASCII chars ("C610").
export async function readDongleInfo(dongle: Dongle): Promise<DongleInfo> {
  const version = await dongle.dongleGet(DONGLE_GET.version);
  const address = await dongle.dongleGet(DONGLE_GET.address);
  const linked = await dongle.dongleGet(DONGLE_GET.headsetLinked);
  const model = await dongle.dongleGet(DONGLE_GET.headsetModel);
  return {
    product: dongle.productName,
    firmware: deviceText(version),
    address: macString(address.slice(0, 6)),
    headsetLinked: le32(linked) === 1,
    headsetModel: deviceText(model),
  };
}

export interface FoundHeadset { address: string; name: string }

// Dongle-side pairing, for a dongle that has never met the headset. The headset must be in its own
// pairing mode (held button) so the dongle's scan can see it.
export function startScan(dongle: Dongle) { return dongle.dongleSet(DONGLE_SET.startScan); }
export function stopScan(dongle: Dongle) { return dongle.dongleSet(DONGLE_SET.stopScan); }
export function pairHeadset(dongle: Dongle, address: string) { return dongle.dongleSet(DONGLE_SET.pair, [...macBytes(address), 0, 0]); }
// ScanResult payload: mac(6) nameLen(1) name
export function parseFoundHeadset(value: Uint8Array): FoundHeadset {
  return { address: macString(value.subarray(0, 6)), name: deviceText(value.subarray(7, 7 + value[6])) };
}

// Unpairs this dongle from the headset on both sides: the headset forgets the dongle, and the dongle
// forgets the headset so it stops trying to reconnect. The control channel is gone afterwards.
export async function unpairDongle(dongle: Dongle, dongleAddress: string, headsetAddress: string): Promise<void> {
  // Validate both addresses before sending anything, so a bad one cannot leave the unpair half done.
  const dongleMac = macBytes(dongleAddress);
  const headsetMac = macBytes(headsetAddress);
  if (headsetMac.every((b) => b === 0)) throw new Error("The headset address is unknown (all zero); not unpairing.");
  await dongle.headsetSet(HEADSET_SET.forget, [...dongleMac, 0, 0]);
  await dongle.dongleSet(DONGLE_SET.deletePaired, [...headsetMac, 0, 0]);
}

// Reply of GET channelStatus: [2] = 1 when the SPP control channel is open, [3..8] = headset address.
export async function readChannelStatus(dongle: Dongle, uuid: number) {
  const reply = await dongle.dongleGet(DONGLE_GET.channelStatus, u32(uuid));
  if (reply.length < 9) throw new Error("The dongle sent a truncated channel status.");
  return { open: reply[2] === 1, headsetAddress: reply.slice(3, 9) };
}

// Headset commands are relayed over a Bluetooth SPP channel that the dongle opens on request.
// Returns the profile of the connected headset once its control channel is open.
export async function ensureHeadsetChannel(dongle: Dongle, progress: (step: string) => void = () => {}): Promise<HeadsetProfile> {
  progress("Checking headset link");
  const linked = le32(await dongle.dongleGet(DONGLE_GET.headsetLinked)) === 1;
  if (!linked) throw new Error("The headset is not connected to the dongle. Power it on and wait for the link.");
  const code = paddedText(await dongle.dongleGet(DONGLE_GET.headsetModel));
  const profile = profileForModel(code || "C610");  // an empty code right after linking is the C610 in practice
  if (!profile) throw new Error(`The connected headset reports model '${code}'; this page knows the OpenMeet (C610) and, experimentally, the OpenMeet 2 (C62x).`);

  const channel = await readChannelStatus(dongle, profile.channelUuid);
  if (channel.open) return profile;
  if (channel.headsetAddress.every((b) => b === 0)) throw new Error("The dongle did not report the headset address; wait a few seconds and retry.");

  progress("Opening control channel");
  await dongle.dongleSet(DONGLE_SET.connectChannel, [...channel.headsetAddress, ...u16(profile.channelUuid)]);
  for (let attempt = 1; attempt <= 5; attempt++) {
    progress(`Opening control channel (${attempt}/5, takes a few seconds)`);
    await sleep(1000);
    if ((await readChannelStatus(dongle, profile.channelUuid)).open) return profile;
  }
  throw new Error("The dongle could not open the control channel to the headset.");
}

export async function assertHeadsetIdle(dongle: Dongle): Promise<void> {
  const reply = await dongle.headsetGet(HEADSET_GET.inCall);
  if (reply.length < 2) throw new Error("Could not read the headset's call state.");  // fail closed
  if (reply[0] === 0 && reply[1] === 1) throw new Error("The headset is in a call; try again afterwards.");
}

// Battery reply: [0] status, [1] level 0..9 -> 10..100 %. Charging: "[2] or [3] set" means running
// on battery, anything else means on the charger.
export async function readHeadsetStatus(dongle: Dongle): Promise<HeadsetStatus> {
  const version = await dongle.headsetGet(HEADSET_GET.version);
  const charging = await dongle.headsetGet(HEADSET_GET.charging);
  const battery = await dongle.headsetGet(HEADSET_GET.battery);
  const language = await dongle.headsetGet(HEADSET_GET.language);
  return {
    firmware: deviceText(version, 1),
    batteryPercent: battery[0] === 0 ? (battery[1] + 1) * 10 : null,
    charging: !(charging[2] === 1 || charging[3] === 1),
    language: LANGUAGE_NAME[language[1]] ?? `code ${language[1]}`,
  };
}

// Reply layouts: EQ = [0] status, [1] preset; prompt type = [0] off flag, [2] tone flag;
// prompt volume = [0] level; on/off settings = [0] 1/0; auto-off = int32 minutes (0 = never);
// multipoint = [0] status, [1] enabled.
export async function readSettings(dongle: Dongle, profile: HeadsetProfile): Promise<Settings> {
  const get = (tag2: HeadsetGetTag) => dongle.headsetGet(tag2);
  const eq = await get(HEADSET_GET.eq);
  const prompt = await get(HEADSET_GET.prompt);
  const volume = await get(HEADSET_GET.promptVolume);
  const button = await get(HEADSET_GET.buttonSound);
  const busylight = await get(HEADSET_GET.busylight);
  const focus = await get(HEADSET_GET.focusMode);
  const reminder = await get(profile.muteReminderGet);
  const pcPriority = await get(HEADSET_GET.pcAudioPriority);
  const autoOff = await get(HEADSET_GET.autoOff);
  const multipoint = await get(HEADSET_GET.multipoint);
  return {
    eq: EQ_NAME[eq[1]] ?? `code ${eq[1]}`,
    prompt: prompt[0] === 1 ? "Off" : prompt[2] === 1 ? "Tone" : "Voice",
    promptVolume: PROMPT_VOLUME_NAME[volume[0]] ?? "Medium",
    buttonSound: button[0] === 1,
    busylight: busylight[0] === 1,
    focusMode: focus[0] === 1,
    muteReminder: reminder[profile.muteReminderFlagIndex] === 1,
    pcAudioPriority: pcPriority[0] === 1,
    autoOffMinutes: le32(autoOff) | 0,
    multipoint: multipoint[1] !== 0,
  };
}

export type SettingChange =
  | { name: "eq"; value: Eq }
  | { name: "prompt"; value: Prompt }
  | { name: "promptVolume"; value: PromptVolume }
  | { name: "buttonSound" | "busylight" | "focusMode" | "muteReminder" | "pcAudioPriority" | "multipoint"; value: boolean }
  | { name: "autoOffMinutes"; value: number };

export async function writeSetting(dongle: Dongle, profile: HeadsetProfile, change: SettingChange): Promise<void> {
  switch (change.name) {
    case "eq": await dongle.headsetSet(HEADSET_SET.eq, [EQ_CODE[change.value], 0, 0, 0, 0, 0, 0, 0]); break;
    case "prompt": await dongle.headsetSet(HEADSET_SET.prompt, PROMPT_BYTES[change.value]); break;
    case "promptVolume": await dongle.headsetSet(HEADSET_SET.promptVolume, [PROMPT_VOLUME_CODE[change.value], 0, 0, 0]); break;
    case "buttonSound": await dongle.headsetSet(HEADSET_SET.buttonSound, flagValue(change.value)); break;
    case "busylight": await dongle.headsetSet(HEADSET_SET.busylight, flagValue(change.value)); break;
    case "focusMode": await dongle.headsetSet(HEADSET_SET.focusMode, flagValue(change.value)); break;
    case "muteReminder": await dongle.headsetSet(profile.muteReminderSet, flagValue(change.value)); break;
    case "pcAudioPriority": await dongle.headsetSet(HEADSET_SET.pcAudioPriority, flagValue(change.value)); break;
    case "autoOffMinutes": await dongle.headsetSet(HEADSET_SET.autoOff, u32(change.value)); break;
    case "multipoint": {
      if (change.value) { await dongle.headsetSet(HEADSET_SET.multipointOn); break; }
      // Turning multipoint off takes the address of the one link to keep: the dongle's.
      const address = (await dongle.dongleGet(DONGLE_GET.address)).slice(0, 6);
      // A short or all-zero reply would tell the headset to keep no known link; refuse instead.
      if (address.length < 6 || address.every((b) => b === 0)) throw new Error("Could not read the dongle's address; multipoint not changed.");
      await dongle.headsetSet(HEADSET_SET.multipointOff, address);
      break;
    }
  }
}

export function previewPrompt(dongle: Dongle, volume: PromptVolume) {
  return dongle.headsetSet(HEADSET_SET.previewPrompt, [PROMPT_VOLUME_CODE[volume], 0, 0, 0]);
}
export function startPairing(dongle: Dongle) { return dongle.headsetSet(HEADSET_SET.startPairing); }
export function stopPairing(dongle: Dongle) { return dongle.headsetSet(HEADSET_SET.stopPairing); }
export function connectDevice(dongle: Dongle, address: string) { return dongle.headsetSet(HEADSET_SET.connect, macBytes(address)); }
export function disconnectDevice(dongle: Dongle, address: string) { return dongle.headsetSet(HEADSET_SET.disconnect, macBytes(address)); }
export function forgetDevice(dongle: Dongle, address: string) { return dongle.headsetSet(HEADSET_SET.forget, [...macBytes(address), 0, 0]); }

// Headset pairing list: [0] status, [1] count, then per entry
//   index(1) address(6) connected(1) nameLength(1) name(nameLength bytes, UTF-8, zero padded)
export function parseHeadsetDevices(list: Uint8Array): PairedDevice[] {
  const devices: PairedDevice[] = [];
  let offset = 2;
  for (let i = 0; i < list[1] && offset + 9 <= list.length; i++) {
    const nameLength = list[offset + 8];
    devices.push({
      name: deviceText(list.subarray(offset + 9, offset + 9 + nameLength)),
      address: macString(list.subarray(offset + 1, offset + 7)),
      connected: list[offset + 7] === 1,
    });
    offset += 9 + nameLength;
  }
  return devices;
}

export async function readHeadsetLinked(dongle: Dongle): Promise<boolean> {
  return le32(await dongle.dongleGet(DONGLE_GET.headsetLinked)) === 1;
}

export async function readHeadsetDevices(dongle: Dongle): Promise<PairedDevice[]> {
  return parseHeadsetDevices(await dongle.headsetGet(HEADSET_GET.pairedList));
}
