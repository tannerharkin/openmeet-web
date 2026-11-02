import { create } from "zustand";
import { toast } from "sonner";
import { Dongle } from "@/protocol/dongle";
import { describeNotification, hex, notificationName, sleep, type Frame, type HeadsetProfile, type PromptVolume } from "@/protocol/frames";
import {
  assertHeadsetIdle, connectDevice, disconnectDevice, ensureHeadsetChannel, forgetDevice, pairHeadset, parseFoundHeadset, previewPrompt,
  readChannelStatus, readDongleInfo, readHeadsetDevices, readHeadsetLinked, readHeadsetStatus, readSettings, startPairing, startScan,
  stopPairing, stopScan, unpairDongle, writeSetting,
  type DongleInfo, type FoundHeadset, type HeadsetStatus, type PairedDevice, type SettingChange, type Settings,
} from "@/protocol/commands";

export type Phase = "disconnected" | "unlinked" | "connected";
export type LogLevel = "info" | "action" | "notify" | "error" | "drop" | "raw";
export interface LogLine { id: number; time: string; text: string; level: LogLevel }
export interface LastError { label: string; message: string; retry?: () => Promise<void> }
export type RowState = "pending" | "saved" | "kept";

interface State {
  dongle: Dongle | null;
  phase: Phase;
  busy: string | null;            // label of the operation currently running, null when idle
  inFlight: Record<string, true>; // labels of operations running or queued, for per-control spinners
  deviceBusy: Record<string, true>;  // addresses with a connect/disconnect/forget in progress
  busyDetail: string | null;      // sub-step of the operation, e.g. "Opening control channel (2/5)"
  headsetReady: boolean;
  info: DongleInfo | null;
  profile: HeadsetProfile | null;  // known once the control channel is open
  headset: HeadsetStatus | null;
  settings: Settings | null;
  devices: PairedDevice[];
  lastError: LastError | null;
  pairingRequested: boolean;
  scanning: boolean;                 // dongle is searching for headsets to pair with
  found: FoundHeadset[];
  rowState: Partial<Record<SettingChange["name"], RowState>>;
  log: LogLine[];
  dropped: number;
  showRaw: boolean;
  diagnosticsOpen: boolean;

  connect(): Promise<void>;
  reconnectPermitted(): Promise<void>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
  retry(): Promise<void>;
  dismissError(): void;
  changeSetting(change: SettingChange): Promise<void>;
  isInFlight(label: string): boolean;
  preview(volume: PromptVolume): Promise<void>;
  pair(): Promise<void>;
  stopPairing(): Promise<void>;
  toggleDevice(device: PairedDevice): Promise<void>;
  // Frees a slot first (disconnecting `release` or enabling multipoint), then connects `device`.
  switchDevice(device: PairedDevice, plan: { release?: PairedDevice; enableMultipoint?: boolean }): Promise<void>;
  forget(device: PairedDevice): Promise<void>;
  unpairDongle(): Promise<void>;
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  pairHeadset(headset: FoundHeadset): Promise<void>;
  setShowRaw(show: boolean): void;
  setDiagnosticsOpen(open: boolean): void;
  clearLog(): void;
  logText(): string;
}

const SETTING_LABEL: Record<SettingChange["name"], string> = {
  eq: "Equalizer", prompt: "Prompts", promptVolume: "Prompt volume", buttonSound: "Button sounds", busylight: "Busy light",
  focusMode: "Focus mode", muteReminder: "Mute reminder", pcAudioPriority: "Prioritize computer audio",
  autoOffMinutes: "Auto power off", multipoint: "Multipoint",
};
const describeValue = (value: Settings[keyof Settings]) =>
  typeof value === "boolean" ? (value ? "on" : "off") : typeof value === "number" ? (value === 0 ? "never" : `${value} min`) : value;

let nextLogId = 1;
const DIAGNOSTICS_KEY = "shokz-diagnostics-open";

export const useStore = create<State>((set, get) => {
  const append = (text: string, level: LogLevel = "info") =>
    set((s) => ({ log: [...s.log.slice(-499), { id: nextLogId++, time: new Date().toLocaleTimeString(undefined, { hour12: false }), text, level }] }));

  // Names of notification-driven refreshes already queued, so a burst of notifications runs one refresh.
  const queuedRefresh = new Set<string>();
  const warnedModels = new Set<string>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Runs device operations one after another (the headset accepts one request at a time). A click
  // during another operation is queued, not refused, so nothing on the page needs to be disabled;
  // the control that was used shows its own spinner via `inFlight` until its turn is done.
  let chain: Promise<unknown> = Promise.resolve();
  const guarded = (label: string, action: (dongle: Dongle) => Promise<void>): Promise<void> => {
    if (!get().dongle) return Promise.resolve();
    set((st) => ({ inFlight: { ...st.inFlight, [label]: true } }));
    const run = () => runGuarded(label, action);
    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  };
  const runGuarded = async (label: string, action: (dongle: Dongle) => Promise<void>): Promise<void> => {
    const { dongle } = get();
    if (!dongle) { clearInFlight(label); return; }
    set({ busy: label, busyDetail: null });
    append(`> ${label}`, "action");
    const started = performance.now();
    try {
      await action(dongle);
      append(`${label} done (${Math.round(performance.now() - started)} ms)`, "action");
      set({ lastError: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      append(`${label} failed: ${message}`, "error");
      const retry = () => guarded(label, action);
      set({ lastError: { label, message, retry } });
      // Persistent (until dismissed) so it cannot be missed, but a toast so nothing on the page moves.
      if (get().phase === "connected") toast.error(`${label} failed`, { description: message, duration: Infinity, action: { label: "Retry", onClick: () => void retry() } });
    } finally {
      set({ busy: null, busyDetail: null });
      clearInFlight(label);
    }
  };
  const clearInFlight = (label: string) => set((st) => { const inFlight = { ...st.inFlight }; delete inFlight[label]; return { inFlight }; });

  const refreshAll = async (dongle: Dongle) => {
    set({ busyDetail: "Reading dongle" });
    const info = await readDongleInfo(dongle);
    set({ info, pairingRequested: false });
    if (!info.headsetLinked) {
      set({ phase: "unlinked", headsetReady: false, profile: null, headset: null, settings: null, devices: [] });
      startLinkPolling();
      return;
    }
    stopLinkPolling();
    // Existing values stay on screen while they are re-read, so a refresh does not blank the page.
    const profile = await ensureHeadsetChannel(dongle, (step) => set({ busyDetail: step }));
    if (profile.experimental && !warnedModels.has(profile.model)) { warnedModels.add(profile.model); append(`${profile.model} support is experimental: same commands as the OpenMeet, never verified on this model`, "error"); }
    set({ profile, busyDetail: "Reading headset status" });
    set({ headset: await readHeadsetStatus(dongle) });
    set({ busyDetail: "Reading settings (10 requests)" });
    set({ settings: await readSettings(dongle, profile) });
    set({ busyDetail: "Reading pairing list" });
    set({ devices: await readHeadsetDevices(dongle), headsetReady: true, phase: "connected" });
  };

  // While the headset is off, ask the dongle (one cheap request) every 3 s whether it has linked.
  const startLinkPolling = () => {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      const { dongle, phase, busy } = get();
      if (!dongle || phase !== "unlinked" || busy) return;
      try {
        if (await readHeadsetLinked(dongle)) { stopLinkPolling(); void guarded("Headset linked", refreshAll); }
      } catch { /* the next tick retries; a dead dongle surfaces through the disconnect event */ }
    }, 3000);
  };
  const stopLinkPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

  const refreshers: Record<string, (dongle: Dongle) => Promise<void>> = {
    "Headset.Battery": async (d) => set({ headset: await readHeadsetStatus(d) }),
    "Headset.Charging": async (d) => set({ headset: await readHeadsetStatus(d) }),
    "Headset.Eq": async (d) => { const profile = get().profile; if (profile) set({ settings: await readSettings(d, profile) }); },
    "Headset.DeviceConnection": async (d) => set({ devices: await readHeadsetDevices(d) }),
    "Dongle.BluetoothLink": refreshAll,
    "Dongle.ControlChannel": refreshAll,
  };

  const queueRefresh = (name: string) => {
    if (queuedRefresh.has(name)) return;
    queuedRefresh.add(name);
    void guarded(`Update after ${name}`, async (d) => { queuedRefresh.delete(name); await refreshers[name](d); });
  };

  const handleNotification = (frame: Frame) => {
    const name = notificationName(frame);
    append(describeNotification(frame), "notify");
    if (name === "Headset.DeviceConnection" && frame.value[6] === 1 && get().pairingRequested) {
      // A new device connected while pairing was requested: leave pairing mode and tell the user.
      const known = get().devices.some((d) => d.address === hex(frame.value.subarray(0, 6), ":"));
      if (!known) {
        set({ pairingRequested: false });
        toast.success("Paired", { description: describeNotification(frame) });
        queueRefresh("stopPairing");
      }
    }
    if (name === "Dongle.ScanResult") {
      const headset = parseFoundHeadset(frame.value);
      set((st) => (st.found.some((h) => h.address === headset.address) ? {} : { found: [...st.found, headset] }));
    }
    if (name === "Dongle.PairResult" && frame.value[6] === 1) toast.error("Pairing failed", { description: "Put the headset in pairing mode and try again." });
    if (name === "Dongle.BluetoothLink" && frame.value[6] === 1 && get().scanning) { set({ scanning: false, found: [] }); queueRefresh("stopScan"); }
    if (name === "Dongle.ControlChannel" && frame.value[8] !== 1) set({ headsetReady: false });
    if (name === "Dongle.BluetoothLink" && frame.value[6] !== 1) set({ headsetReady: false, phase: "unlinked", headset: null, settings: null, devices: [] });
    if (refreshers[name]) queueRefresh(name);
  };
  refreshers["stopPairing"] = async (d) => { await stopPairing(d); };
  refreshers["stopScan"] = async (d) => { await stopScan(d); };

  // The headset reports a connection change some time after the command: a reconnect can take
  // several seconds, longer still right after another device was dropped. Re-read the list every
  // 1.5 s for up to 12 s and only complain if the state never changed.
  const settleDevices = async (dongle: Dongle, device: PairedDevice, wantConnected: boolean) => {
    set({ busyDetail: "Waiting for the headset to report the new state" });
    for (let attempt = 1; attempt <= 8; attempt++) {
      await sleep(1500);
      const devices = await readHeadsetDevices(dongle);
      set({ devices });
      const now = devices.find((d) => d.address === device.address);
      if (!now || now.connected === wantConnected) return;
    }
    toast.warning(`${device.name} did not ${wantConnected ? "connect" : "disconnect"}`, { description: wantConnected ? "Make sure it is nearby with Bluetooth on." : undefined });
  };

  const withDeviceBusy = (device: PairedDevice, label: string, action: (dongle: Dongle) => Promise<void>) => {
    set((st) => ({ deviceBusy: { ...st.deviceBusy, [device.address]: true } }));
    const release = () => set((st) => { const deviceBusy = { ...st.deviceBusy }; delete deviceBusy[device.address]; return { deviceBusy }; });
    return guarded(label, (dongle) => action(dongle).finally(release)).finally(release);
  };

  const adopt = async (dongle: Dongle) => {
    dongle.onNotification = handleNotification;
    dongle.onWarning = (message) => { set((s) => ({ dropped: s.dropped + 1 })); append(message, "drop"); };
    dongle.onFrame = (direction, reportId, bytes) => {
      if (!get().showRaw) return;
      let end = bytes.length;                       // reports are zero-padded to 512 bytes; hide the padding
      while (end > 0 && bytes[end - 1] === 0) end--;
      append(`${direction.padEnd(3)} ${hex([reportId])} ${hex(bytes.subarray(0, end))}${end < bytes.length ? " .." : ""}`, "raw");
    };
    set({ dongle, phase: "unlinked", lastError: null, dropped: 0 });
    append(`Opened ${dongle.productName}`);
    await guarded("Connect", refreshAll);
  };

  const disconnected = (reason: string) => {
    toast.dismiss();
    stopLinkPolling();
    queuedRefresh.clear();
    const { dongle } = get();
    if (dongle) void dongle.close(reason);
    set({ dongle: null, phase: "disconnected", headsetReady: false, info: null, profile: null, headset: null, settings: null, devices: [], busy: null, busyDetail: null, inFlight: {}, deviceBusy: {}, pairingRequested: false, scanning: false, found: [], rowState: {} });
    append(reason);
  };

  if (typeof navigator !== "undefined" && navigator.hid) {
    navigator.hid.addEventListener("disconnect", (event) => {
      if (event.device === get().dongle?.device) {
        disconnected("Dongle unplugged");
        set({ lastError: { label: "Dongle unplugged", message: "Plug the Loop120 back in; it reconnects automatically." } });
      }
    });
    navigator.hid.addEventListener("connect", (event) => {
      if (!get().dongle && Dongle.isControlCollection(event.device)) void get().reconnectPermitted();
    });
  }

  return {
    dongle: null, phase: "disconnected", busy: null, busyDetail: null, inFlight: {}, deviceBusy: {}, headsetReady: false,
    info: null, profile: null, headset: null, settings: null, devices: [], lastError: null, pairingRequested: false, scanning: false, found: [], rowState: {},
    log: [], dropped: 0, showRaw: false,
    diagnosticsOpen: typeof localStorage !== "undefined" && localStorage.getItem(DIAGNOSTICS_KEY) === "1",

    async connect() {
      let dongle: Dongle;
      try {
        dongle = await Dongle.pick();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/No device selected|No dongle selected/i.test(message)) {
          append(`Connect: ${message}`, "error");
          set({ lastError: { label: "Connect", message } });
        }
        return;
      }
      await adopt(dongle);
    },

    async reconnectPermitted() {
      if (get().dongle) return;
      try {
        const dongle = await Dongle.reopenPermitted();
        if (dongle) await adopt(dongle);
      } catch (error) {
        append(`Reopen: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },

    async disconnect() {
      disconnected("Dongle closed");
      set({ lastError: null });
    },

    refresh: () => guarded("Refresh", refreshAll),

    dismissError: () => set({ lastError: null }),

    isInFlight: (label) => !!get().inFlight[label],

    retry: async () => { const retry = get().lastError?.retry; if (retry) await retry(); else await get().refresh(); },

    changeSetting: (change) => {
      // Reflect the choice at once and mark the row pending; the headset's answer replaces it later.
      set((st) => ({ settings: st.settings ? { ...st.settings, [change.name]: change.value } : st.settings, rowState: { ...st.rowState, [change.name]: "pending" } }));
      return guarded(`Set ${SETTING_LABEL[change.name]}`, async (dongle) => {
      const profile = get().profile;
      if (!profile) throw new Error("The headset's control channel is not open.");
      try {
        await writeSetting(dongle, profile, change);
        const settings = await readSettings(dongle, profile);  // show what the headset actually applied
        const applied = settings[change.name] === change.value;
        set((s) => ({ settings, rowState: { ...s.rowState, [change.name]: applied ? "saved" : "kept" } }));
        if (applied) toast.success(`${SETTING_LABEL[change.name]}: ${describeValue(change.value)}`);
        else toast.warning(`${SETTING_LABEL[change.name]}: headset kept ${describeValue(settings[change.name])}`);
        if (applied) setTimeout(() => set((s) => (s.rowState[change.name] === "saved" ? { rowState: { ...s.rowState, [change.name]: undefined } } : {})), 2500);
      } catch (error) {
        set((s) => ({ rowState: { ...s.rowState, [change.name]: undefined } }));
        throw error;
      }
      });
    },

    preview: (volume) => guarded("Play sample prompt", async (dongle) => { await previewPrompt(dongle, volume); }),

    pair: () => guarded("Enter pairing mode", async (dongle) => {
      await assertHeadsetIdle(dongle);
      await startPairing(dongle);
      set({ pairingRequested: true });
    }),

    stopPairing: () => guarded("Leave pairing mode", async (dongle) => {
      await stopPairing(dongle);
      set({ pairingRequested: false });
    }),

    toggleDevice: (device) => withDeviceBusy(device, device.connected ? `Disconnect ${device.name}` : `Connect ${device.name}`, async (dongle) => {
      await assertHeadsetIdle(dongle);
      await (device.connected ? disconnectDevice : connectDevice)(dongle, device.address);
      await settleDevices(dongle, device, !device.connected);
    }),

    switchDevice: (device, plan) => withDeviceBusy(device, `Connect ${device.name}`, async (dongle) => {
      await assertHeadsetIdle(dongle);
      const profile = get().profile;
      if (plan.enableMultipoint && profile) {
        await writeSetting(dongle, profile, { name: "multipoint", value: true });
        set({ settings: await readSettings(dongle, profile) });
      }
      if (plan.release) {
        await disconnectDevice(dongle, plan.release.address);
        await sleep(1500);
      }
      await connectDevice(dongle, device.address);
      await settleDevices(dongle, device, true);
    }),

    unpairDongle: () => guarded("Unpair this computer", async (dongle) => {
      const { info, profile } = get();
      if (!info || !profile) throw new Error("The headset's control channel is not open.");
      const channel = await readChannelStatus(dongle, profile.channelUuid);
      await unpairDongle(dongle, info.address, hex(channel.headsetAddress, ":"));
      set({ phase: "unlinked", headsetReady: false, profile: null, headset: null, settings: null, devices: [] });
      startLinkPolling();
      toast.success("Unpaired", { description: "Pair the headset again from this panel when you need it." });
    }),

    startScan: () => guarded("Search for headsets", async (dongle) => {
      await startScan(dongle);
      set({ scanning: true, found: [] });
    }),

    stopScan: () => guarded("Stop searching", async (dongle) => {
      await stopScan(dongle);
      set({ scanning: false, found: [] });
    }),

    // The outcome arrives as notifications: PairResult (failure) or BluetoothLink (success, which
    // stops the scan and reads the headset like any other link).
    pairHeadset: (headset) => guarded(`Pair ${headset.name}`, async (dongle) => {
      await pairHeadset(dongle, headset.address);
      set({ busyDetail: "Waiting for the headset to accept" });
      for (let attempt = 0; attempt < 10 && get().scanning; attempt++) await sleep(1000);
    }),

    forget: (device) => withDeviceBusy(device, `Forget ${device.name}`, async (dongle) => {
      await forgetDevice(dongle, device.address);
      set({ devices: await readHeadsetDevices(dongle) });
      toast.success(`Removed ${device.name}`);
    }),

    setShowRaw: (showRaw) => set({ showRaw }),
    setDiagnosticsOpen: (diagnosticsOpen) => { localStorage.setItem(DIAGNOSTICS_KEY, diagnosticsOpen ? "1" : "0"); set({ diagnosticsOpen }); },
    clearLog: () => set({ log: [], dropped: 0 }),
    logText: () => get().log.map((l) => `${l.time}\t${l.level}\t${l.text}`).join("\n"),
  };
});
