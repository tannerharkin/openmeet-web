import { AlertTriangle, BluetoothSearching, Headphones, Link2, Loader2, PlugZap, Power, RotateCw, Usb, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useStore } from "@/store";

function Notice({ icon, title, text, action, role = "status", tone = "" }: { icon: React.ReactNode; title: string; text?: React.ReactNode; action?: React.ReactNode; role?: "status" | "alert"; tone?: string }) {
  return (
    <Card className={tone}>
      <CardContent className="flex flex-wrap items-center gap-4" role={role}>
        {icon}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          {text ? <p className="text-sm text-muted-foreground">{text}</p> : null}
        </div>
        {action}
      </CardContent>
    </Card>
  );
}

// One panel for every state in which the headset cannot be controlled yet.
export function PhasePanel() {
  const { phase, busy, busyDetail, lastError, connect, retry, scanning, found, startScan, stopScan, pairHeadset, isInFlight } = useStore();

  if (lastError && !busy) {
    return (
      <Notice role="alert" tone="border-destructive/50" icon={<AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden />}
              title={`${lastError.label} failed`} text={lastError.message}
              action={phase === "disconnected"
                ? <Button onClick={() => void connect()}><Usb aria-hidden /> Connect dongle</Button>
                : <Button variant="outline" onClick={() => void retry()}><RotateCw aria-hidden /> Retry</Button>} />
    );
  }
  if (phase === "disconnected") {
    return (
      <Notice icon={<PlugZap className="size-5 shrink-0 text-muted-foreground" aria-hidden />} title="Plug in the Loop120 and connect"
              text={<span id="connect-hint">Chrome asks which device to use the first time; after that the page reconnects on its own.</span>} />
    );
  }
  if (scanning) {
    return (
      <Card>
        <CardContent className="space-y-4" role="status">
          <div className="flex flex-wrap items-center gap-4">
            <BluetoothSearching className="size-5 shrink-0 text-sky-500 animate-pulse motion-reduce:animate-none" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Looking for headsets</p>
              <p className="text-sm text-muted-foreground">Put the headset in pairing mode (hold its multifunction button until it announces pairing).</p>
            </div>
            <Button variant="outline" onClick={() => void stopScan()}><X aria-hidden /> Stop</Button>
          </div>
          <ul className="divide-y divide-border/60">
            {found.length === 0 ? <li className="py-3 text-sm text-muted-foreground">Nothing found yet.</li> : null}
            {found.map((h) => (
              <li key={h.address} className="flex min-h-13 items-center gap-4 py-2">
                <Headphones className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-sm leading-5 font-medium">{h.name || "Unnamed headset"}</div>
                  <div className="font-mono text-xs leading-4 text-muted-foreground">{h.address}</div>
                </div>
                <Button size="sm" className="w-20" aria-disabled={isInFlight(`Pair ${h.name}`)} onClick={() => { if (!isInFlight(`Pair ${h.name}`)) void pairHeadset(h); }} aria-label={`Pair ${h.name}`}>
                  {isInFlight(`Pair ${h.name}`) ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <><Link2 aria-hidden /> Pair</>}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }
  if (busy) {
    return <Notice icon={<Loader2 className="size-5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />} title={busy} text={busyDetail ? `${busyDetail}\u2026` : undefined} />;
  }
  return (
    <Notice icon={<Power className="size-5 shrink-0 text-muted-foreground" aria-hidden />} title="Turn the headset on" text="Waiting for it to link to the dongle"
            action={<Button variant="outline" onClick={() => void startScan()}><BluetoothSearching aria-hidden /> Pair a new headset</Button>} />
  );
}
