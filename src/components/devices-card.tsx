import { useRef, useState } from "react";
import { BluetoothSearching, Laptop, Loader2, Plus, Smartphone, Trash2, X } from "lucide-react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { deviceLabel, useStore } from "@/store";
import type { PairedDevice } from "@/protocol/commands";

export function DevicesCard() {
  const { devices, info, settings, headsetReady, rowState, pairingRequested, deviceBusy, toggleDevice, switchDevice, forget, unpairDongle, pair, stopPairing, changeSetting, isInFlight } = useStore();
  const [toForget, setToForget] = useState<PairedDevice | null>(null);
  const [toSwitch, setToSwitch] = useState<PairedDevice | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // Radix's own close focus goes to the dialog trigger, and these dialogs have none; send it to the heading.
  const returnFocus = (event: Event) => { event.preventDefault(); heading.current?.focus(); };
  // Radix keeps a closing dialog mounted for its exit animation; keep showing the last device so the text
  // does not flash "Unnamed device (undefined)" while it fades out.
  const lastForget = useRef<PairedDevice | null>(null);
  const lastSwitch = useRef<PairedDevice | null>(null);
  if (toForget) lastForget.current = toForget;
  if (toSwitch) lastSwitch.current = toSwitch;
  const shownForget = toForget ?? lastForget.current;
  const shownSwitch = toSwitch ?? lastSwitch.current;
  const disabled = !headsetReady;
  const pairingBusy = isInFlight("Enter pairing mode") || isInFlight("Leave pairing mode");
  const connectedCount = devices.filter((d) => d.connected).length;
  const slots = settings?.multipoint ? 2 : 1;
  const isDongle = (d: PairedDevice) => d.address === info?.address;
  // Connecting into a full headset fails silently, so a connect that needs a slot goes through a dialog
  // that frees one first: disconnect the other device, or turn multipoint on when only this computer is connected.
  const release = devices.find((d) => d.connected && !isDongle(d)) ?? null;
  const plan = release ? { release } : { enableMultipoint: true };
  const requestConnect = (d: PairedDevice) => { if (connectedCount >= slots) setToSwitch(d); else void toggleDevice(d); };
  // The dongle itself is in the headset's list; it is shown first and left alone (disconnecting it would cut us off).
  // Stable order (dongle first, then by name) so rows do not jump when a device connects.
  const rows = [...devices].sort((a, b) => Number(b.address === info?.address) - Number(a.address === info?.address) || a.name.localeCompare(b.name));
  return (
    <Card>
      <CardHeader>
        <CardTitle ref={heading} tabIndex={-1} className="flex items-center gap-2 outline-none"><Smartphone className="size-4" aria-hidden /> Devices</CardTitle>
        <CardAction className="flex items-center gap-3">
          {pairingRequested ? (
            <>
              <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <BluetoothSearching className="size-4 text-sky-500 animate-pulse motion-reduce:animate-none" aria-hidden />
                Discoverable as <b className="font-medium text-foreground">OpenMeet by Shokz</b>
              </span>
              <Button variant="outline" size="sm" className="w-20" aria-disabled={pairingBusy} onClick={() => { if (!pairingBusy) void stopPairing(); }}>{pairingBusy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <X aria-hidden />} Stop</Button>
            </>
          ) : (
            <Button variant="outline" size="sm" className="w-20" aria-disabled={disabled || pairingBusy} onClick={() => { if (!disabled && !pairingBusy) void pair(); }}>{pairingBusy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Plus aria-hidden />} Add</Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent>
        <SettingGroup title="Paired">
          {rows.length === 0 ? <p className="py-3 text-sm text-muted-foreground">Nothing paired yet.</p> : null}
          {rows.map((d) => (
            <div key={d.address} className={`-mx-3 flex min-h-13 flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-2 ${isDongle(d) ? "bg-muted/50" : ""}`}>
              {isDongle(d) ? (
                <Tooltip>
                  <TooltipTrigger asChild><Laptop className="size-4 shrink-0 text-muted-foreground" aria-label="This computer" /></TooltipTrigger>
                  <TooltipContent>This computer, through the dongle</TooltipContent>
                </Tooltip>
              ) : <Smartphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <div className="min-w-0 flex-1">
                <div className="text-sm leading-5 font-medium">{d.name || "Unnamed device"}</div>
                <div className="font-mono text-xs leading-4 text-muted-foreground">{d.address}</div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`size-2 rounded-full ${d.connected ? "bg-emerald-500" : "bg-border"}`} aria-hidden />
                {d.connected ? "Connected" : "Not connected"}
              </span>
              <span className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="w-24" disabled={isDongle(d)} aria-disabled={disabled || !!deviceBusy[d.address]}
                        onClick={() => { if (disabled || deviceBusy[d.address]) return; if (d.connected) void toggleDevice(d); else requestConnect(d); }} aria-label={deviceLabel(d.connected ? "Disconnect" : "Connect", d)}>
                  {deviceBusy[d.address] ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : d.connected ? "Disconnect" : "Connect"}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-disabled={disabled || !!deviceBusy[d.address] || isInFlight("Unpair this computer")} aria-label={deviceLabel("Forget", d)} onClick={() => { if (!disabled && !deviceBusy[d.address] && !isInFlight("Unpair this computer")) setToForget(d); }}>
                      <Trash2 aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Forget</TooltipContent>
                </Tooltip>
              </span>
            </div>
          ))}
        </SettingGroup>

        <SettingGroup title="Connections">
          <SettingRow id="multipoint" label="Multipoint" hint={settings?.multipoint ? `${connectedCount} of 2 connected` : "One device at a time"} state={rowState.multipoint}>
            <Switch id="multipoint" aria-labelledby="multipoint-label" aria-describedby="multipoint-hint" checked={settings?.multipoint ?? false} disabled={disabled}
                    onCheckedChange={(v) => void changeSetting({ name: "multipoint", value: v })} />
          </SettingRow>
          <SettingRow id="pcAudioPriority" label="Prioritize computer audio" hint="When both devices play audio, prioritize the Loop120's audio" state={rowState.pcAudioPriority}>
            <Switch id="pcAudioPriority" aria-labelledby="pcAudioPriority-label" aria-describedby="pcAudioPriority-hint" checked={settings?.pcAudioPriority ?? false} disabled={disabled}
                    onCheckedChange={(v) => void changeSetting({ name: "pcAudioPriority", value: v })} />
          </SettingRow>
        </SettingGroup>
      </CardContent>

      <Dialog open={toSwitch !== null} onOpenChange={(open) => { if (!open) setToSwitch(null); }}>
        <DialogContent onCloseAutoFocus={returnFocus}>
          <DialogHeader>
            <DialogTitle>Connect {shownSwitch?.name || "Unnamed device"}?</DialogTitle>
            <DialogDescription>
              {plan.release
                ? `The headset's ${slots === 1 ? "connection is" : "two connections are"} in use. ${plan.release.name || "Unnamed device"} (${plan.release.address}) will be disconnected first, then ${shownSwitch?.name || "Unnamed device"} (${shownSwitch?.address}) connects.`
                : "With multipoint off the headset holds one connection, and this computer has it. Multipoint will be turned on so both can connect."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" autoFocus onClick={() => setToSwitch(null)}>Cancel</Button>
            <Button onClick={() => { if (toSwitch) void switchDevice(toSwitch, plan); setToSwitch(null); }}>
              {plan.release ? `Disconnect ${plan.release.name || "Unnamed device"} (${plan.release.address}) and connect` : "Turn on multipoint and connect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={toForget !== null} onOpenChange={(open) => { if (!open) setToForget(null); }}>
        <DialogContent onCloseAutoFocus={returnFocus}>
          {shownForget && isDongle(shownForget) ? (
            <>
              <DialogHeader>
                <DialogTitle>Unpair this computer?</DialogTitle>
                <DialogDescription>
                  The headset and the dongle forget each other and the connection drops. This page cannot reach the headset again until you pair them from the "not linked" panel, with the headset in pairing mode.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" autoFocus onClick={() => setToForget(null)}>Cancel</Button>
                <Button variant="destructive" onClick={() => { void unpairDongle(); setToForget(null); }}>Unpair</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Forget {shownForget?.name || "Unnamed device"}?</DialogTitle>
                <DialogDescription>Removes {shownForget?.address} from the headset's pairing list{shownForget?.connected ? " and disconnects it" : ""}.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" autoFocus onClick={() => setToForget(null)}>Cancel</Button>
                <Button variant="destructive" onClick={() => { if (toForget) void forget(toForget); setToForget(null); }}>Forget</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
