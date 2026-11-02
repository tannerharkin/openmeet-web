import { useEffect, useState } from "react";
import { Headphones, Loader2, Moon, RefreshCw, Sun, Unplug, Usb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStore } from "@/store";
import { useTheme } from "@/hooks/use-theme";

const PHASE_LABEL = { disconnected: "Not connected", unlinked: "Headset not linked", connected: "Connected" } as const;

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} aria-disabled={disabled} onClick={() => { if (!disabled) onClick(); }}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// True only once an operation has been running for a while; short ones should not flash the header.
function useLongRunning(busy: string | null, delayMs = 700) {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!busy) { setLong(false); return; }
    const timer = setTimeout(() => setLong(true), delayMs);
    return () => clearTimeout(timer);
  }, [busy, delayMs]);
  return long;
}

export function Header() {
  const { phase, busy, connect, refresh, disconnect, isInFlight } = useStore();
  const { theme, toggle } = useTheme();
  const longRunning = useLongRunning(busy);
  const refreshing = isInFlight("Refresh");
  return (
    <header className="flex flex-wrap items-center gap-3">
      <Headphones className="size-7" aria-hidden />
      <h1 className="text-xl font-semibold tracking-tight">Shokz OpenMeet</h1>
      {/* Live region for the phase. A spinner joins it only when an operation takes a while. */}
      <Badge variant={phase === "connected" ? "default" : phase === "unlinked" ? "secondary" : "outline"} className="w-36 justify-center" role="status" aria-live="polite" aria-atomic="true">
        {PHASE_LABEL[phase]}
        {longRunning ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-label="working" /> : null}
      </Badge>
      <div className="ml-auto flex items-center gap-1">
        {phase === "disconnected" ? (
          <Button onClick={() => void connect()} aria-describedby="connect-hint"><Usb aria-hidden /> Connect dongle</Button>
        ) : (
          <>
            <IconAction label="Refresh" disabled={refreshing} onClick={() => void refresh()}><RefreshCw className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden /></IconAction>
            <IconAction label="Disconnect dongle" onClick={() => void disconnect()}><Unplug aria-hidden /></IconAction>
          </>
        )}
        <IconAction label={theme === "dark" ? "Light theme" : "Dark theme"} onClick={toggle}>{theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}</IconAction>
      </div>
    </header>
  );
}
