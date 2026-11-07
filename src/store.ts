import { create } from "zustand";
import { toast } from "sonner";
import { Dongle } from "@/protocol/dongle";
import { readLocal, readSession, removeSession, writeLocal, writeSession } from "@/lib/storage";
import { framed } from "@/lib/env";
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
  // Disconnects and revokes the page's permission, so the browser asks again on the next connect.
  forgetDongle(): Promise<void>;
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
  logError(text: string): void;
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
// Set by a manual disconnect/forget: no automatic reopen for the rest of this tab's session.
const MANUAL_KEY = "openmeet-manual-disconnect";
// One tab at a time drives the dongle; two would interleave requests and steal each other's answers.
const LOCK_NAME = "openmeet-loop120";
// Pairing mode and scanning leave the headset/dongle open to strangers; end them on our side after this.
const OPEN_WINDOW_MS = 180_000;
const MAX_FOUND = 32;
const MAX_RUNTIME_ERRORS = 50;

// Label of a per-device operation. It doubles as the `inFlight` key, so the address keeps two devices
// with the same (device-chosen) name apart.
export const deviceLabel = (verb: string, device: { name: string; address: string }, unnamed = "Unnamed device") =>
  `${verb} ${device.name || unnamed} (${device.address})`;

export const useStore = create<State>((set, get) => {
  const append = (text: string, level: LogLevel = "info") =>
    set((s) => ({ log: [...s.log.slice(-499), { id: nextLogId++, time: new Date().toLocaleTimeString(undefined, { hour12: false }), text, level }] }));

  // Names of notification-driven refreshes already queued, so a burst of notifications runs one refresh.
  const queuedRefresh = new Set<string>();
  const warnedModels = new Set<string>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pairingTimer: ReturnType<typeof setTimeout> | undefined;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let lockHeld = false;                         // this tab holds the Web Lock (or Web Locks are unavailable)
  let lockPending: Promise<boolean> | null = null;  // an acquisition in progress; same-tab callers share it
  let releaseLock: (() => void) | null = null;  // resolves the Web Lock callback, releasing the lock
  let reopening: Promise<void> | null = null;   // single-flight reconnectPermitted (boot + HID connect event)
  // Also kept in memory: with storage blocked the session flag is never written.
  let manualDisconnect = false;
  // Set when another tab held the lock: this (likely background) tab must not grab the dongle on a
  // replug or boot and steal it from the tab in use. Only an explicit connect() clears it.
  let refusedByOtherTab = false;
  let runtimeErrors = 0;

  // Ends pairing mode / scanning after OPEN_WINDOW_MS unless the user or a result ended it first.
  // An operation still running (e.g. a pair waiting for the headset) postpones the stop a little.
  const armPairingCap = (delay = OPEN_WINDOW_MS) => {
    clearTimeout(pairingTimer);
    pairingTimer = setTimeout(() => {
      const { dongle, pairingRequested, busy } = get();
      if (!dongle || !pairingRequested) return;
      if (busy) { armPairingCap(10_000); return; }
      append("Pairing mode ended after 3 minutes");
      void get().stopPairing();
    }, delay);
  };
  const armScanCap = (delay = OPEN_WINDOW_MS) => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const { dongle, scanning, busy } = get();
      if (!dongle || !scanning) return;
      if (busy) { armScanCap(10_000); return; }
      append("Search for headsets ended after 3 minutes");
      void get().stopScan();
    }, delay);
  };

  // Resolves false when another tab holds the dongle. Without Web Locks, every tab may proceed.
  // A second caller while an acquisition is pending awaits the same result instead of assuming ownership.
  const acquireLock = (): Promise<boolean> => {
    if (lockHeld) return Promise.resolve(true);
    if (lockPending) return lockPending;
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) { lockHeld = true; return Promise.resolve(true); }
    lockPending = new Promise<boolean>((resolve) => {
      locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (!lock) { resolve(false); return; }
        lockHeld = true;
        resolve(true);
        return new Promise<void>((done) => { releaseLock = done; });
      }).catch(() => { lockHeld = true; resolve(true); });
    }).finally(() => { lockPending = null; });
    return lockPending;
  };
  const freeLock = () => { releaseLock?.(); releaseLock = null; lockHeld = false; };
  const lockRefused = () => {
    refusedByOtherTab = true;
    const message = "The dongle is in use in another tab of this page. Close that tab or disconnect there, then connect here.";
    append(`Connect: ${message}`, "error");
    set({ lastError: { label: "Connect", message } });
  };

  // Before a manual close: leave pairing mode / stop scanning so the headset is not left discoverable.
  // Best effort with a short timeout; the dongle is closed regardless.
  const endOpenWindows = async () => {
    const { dongle, pairingRequested, scanning } = get();
    if (!dongle) return;
    if (pairingRequested) await Promise.race([stopPairing(dongle).catch(() => {}), sleep(1500)]);
    if (scanning) await Promise.race([stopScan(dongle).catch(() => {}), sleep(1500)]);
  };

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
    // Pairing state is owned by stopPairing, the DeviceConnection handler and disconnected(); a refresh
    // only drops it when the headset is gone (then it is no longer discoverable through us).
    set({ info });
    if (!info.headsetLinked) {
      clearTimeout(pairingTimer);
      set({ pairingRequested: false, phase: "unlinked", headsetReady: false, profile: null, headset: null, settings: null, devices: [] });
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
        clearTimeout(pairingTimer);
        toast.success("Paired", { description: describeNotification(frame) });
        queueRefresh("stopPairing");
      }
    }
    // Results are only expected while we asked for them; a flood of fake ones is capped.
    if (name === "Dongle.ScanResult" && get().scanning) {
      const headset = parseFoundHeadset(frame.value);
      set((st) => (st.found.length >= MAX_FOUND || st.found.some((h) => h.address === headset.address) ? {} : { found: [...st.found, headset] }));
    }
    if (name === "Dongle.PairResult" && frame.value[6] === 1) toast.error("Pairing failed", { description: "Put the headset in pairing mode and try again." });
    if (name === "Dongle.BluetoothLink" && frame.value[6] === 1 && get().scanning) { clearTimeout(scanTimer); set({ scanning: false, found: [] }); queueRefresh("stopScan"); }
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
    toast.warning(`${device.name || "Unnamed device"} did not ${wantConnected ? "connect" : "disconnect"}`, { description: wantConnected ? "Make sure it is nearby with Bluetooth on." : undefined });
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
    clearTimeout(pairingTimer);
    clearTimeout(scanTimer);
    freeLock();
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
      if (!get().dongle && !refusedByOtherTab && Dongle.isControlCollection(event.device)) void get().reconnectPermitted();
    });
  }

  return {
    dongle: null, phase: "disconnected", busy: null, busyDetail: null, inFlight: {}, deviceBusy: {}, headsetReady: false,
    info: null, profile: null, headset: null, settings: null, devices: [], lastError: null, pairingRequested: false, scanning: false, found: [], rowState: {},
    log: [], dropped: 0, showRaw: false,
    diagnosticsOpen: readLocal(DIAGNOSTICS_KEY) === "1",

    async connect() {
      if (framed) return;  // the page shows why instead (see App)
      if (reopening) await reopening;  // an automatic reopen in flight may already adopt the dongle
      if (get().dongle) return;
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
      removeSession(MANUAL_KEY);
      manualDisconnect = false;
      refusedByOtherTab = false;
      if (!(await acquireLock())) { void dongle.close("In use in another tab"); lockRefused(); return; }
      // Adopted meanwhile (e.g. by a replug reopen): never close the device that is in use.
      const current = get().dongle;
      if (current) { if (current.device !== dongle.device) void dongle.close("Already connected"); return; }
      await adopt(dongle);
    },

    reconnectPermitted() {
      if (reopening) return reopening;
      reopening = (async () => {
        // Not after a manual disconnect or a lock refusal in this tab, and never inside another site's frame.
        if (get().dongle || manualDisconnect || readSession(MANUAL_KEY) || refusedByOtherTab || framed) return;
        if (!(await acquireLock())) { lockRefused(); return; }
        try {
          const dongle = await Dongle.reopenPermitted();
          const current = get().dongle;
          if (dongle && !current) await adopt(dongle);
          else {
            if (dongle && dongle.device !== current?.device) void dongle.close("Already connected");
            if (!current) freeLock();
          }
        } catch (error) {
          append(`Reopen: ${error instanceof Error ? error.message : String(error)}`, "error");
          if (!get().dongle) freeLock();
        }
      })().finally(() => { reopening = null; });
      return reopening;
    },

    async disconnect() {
      writeSession(MANUAL_KEY, "1");
      manualDisconnect = true;
      await endOpenWindows();
      disconnected("Dongle closed");
      set({ lastError: null });
    },

    async forgetDongle() {
      const device = get().dongle?.device;
      if (!device) return;
      writeSession(MANUAL_KEY, "1");
      manualDisconnect = true;
      await endOpenWindows();
      // Torn down first, so the HID disconnect event that forget() may raise is not taken for an unplug.
      disconnected("Dongle forgotten");
      set({ lastError: null });
      const forget = (device as HIDDevice & { forget?: () => Promise<void> }).forget;
      if (typeof forget !== "function") { append("This browser cannot revoke device permission; remove it in the site settings instead.", "error"); return; }
      try { await forget.call(device); } catch (error) { append(`Forget dongle: ${error instanceof Error ? error.message : String(error)}`, "error"); }
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
      // Marked first (like startScan) so a Disconnect while the command runs still sends stopPairing.
      set({ pairingRequested: true });
      armPairingCap();
      try { await startPairing(dongle); } catch (error) { set({ pairingRequested: false }); clearTimeout(pairingTimer); throw error; }
    }),

    stopPairing: () => guarded("Leave pairing mode", async (dongle) => {
      await stopPairing(dongle);
      set({ pairingRequested: false });
      clearTimeout(pairingTimer);
    }),

    toggleDevice: (device) => withDeviceBusy(device, deviceLabel(device.connected ? "Disconnect" : "Connect", device), async (dongle) => {
      await assertHeadsetIdle(dongle);
      await (device.connected ? disconnectDevice : connectDevice)(dongle, device.address);
      await settleDevices(dongle, device, !device.connected);
    }),

    switchDevice: (device, plan) => withDeviceBusy(device, deviceLabel("Connect", device), async (dongle) => {
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
      await assertHeadsetIdle(dongle);  // the vendor app refuses connection changes during a call
      await unpairDongle(dongle, info.address, hex(channel.headsetAddress, ":"));
      set({ phase: "unlinked", headsetReady: false, profile: null, headset: null, settings: null, devices: [] });
      startLinkPolling();
      toast.success("Unpaired", { description: "Pair the headset again from this panel when you need it." });
    }),

    startScan: () => guarded("Search for headsets", async (dongle) => {
      // Marked first: results can arrive before the command's answer and are ignored unless scanning.
      set({ scanning: true, found: [] });
      try { await startScan(dongle); } catch (error) { set({ scanning: false }); throw error; }
      armScanCap();
    }),

    stopScan: () => guarded("Stop searching", async (dongle) => {
      await stopScan(dongle);
      set({ scanning: false, found: [] });
      clearTimeout(scanTimer);
    }),

    // The outcome arrives as notifications: PairResult (failure) or BluetoothLink (success, which
    // stops the scan and reads the headset like any other link).
    pairHeadset: (headset) => guarded(deviceLabel("Pair", headset, "Unnamed headset"), async (dongle) => {
      await pairHeadset(dongle, headset.address);
      set({ busyDetail: "Waiting for the headset to accept" });
      for (let attempt = 0; attempt < 10 && get().scanning; attempt++) await sleep(1000);
    }),

    forget: (device) => withDeviceBusy(device, deviceLabel("Forget", device), async (dongle) => {
      await assertHeadsetIdle(dongle);
      await forgetDevice(dongle, device.address);
      set({ devices: await readHeadsetDevices(dongle) });
      toast.success(`Removed ${device.name || device.address}`);
    }),

    setShowRaw: (showRaw) => set({ showRaw }),
    setDiagnosticsOpen: (diagnosticsOpen) => { writeLocal(DIAGNOSTICS_KEY, diagnosticsOpen ? "1" : "0"); set({ diagnosticsOpen }); },
    clearLog: () => set({ log: [], dropped: 0 }),
    // Fed by window error handlers; capped so an error raised while logging cannot flood the log.
    logError: (text) => {
      if (runtimeErrors >= MAX_RUNTIME_ERRORS) return;
      if (++runtimeErrors === MAX_RUNTIME_ERRORS) text += " (further errors not logged)";
      append(text, "error");
    },
    logText: () => get().log.map((l) => `${l.time}\t${l.level}\t${l.text}`).join("\n"),
  };
});
