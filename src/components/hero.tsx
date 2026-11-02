import { Bluetooth } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStore } from "@/store";

// Lucide-style battery outline whose fill tracks the level; a bolt overlays it while charging.
function BatteryGlyph({ percent, charging, className }: { percent: number | null; charging: boolean; className?: string }) {
  const width = percent === null ? 0 : (13 * percent) / 100;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2" y="7" width="17" height="10" rx="2" />
      <line x1="21.5" y1="10.5" x2="21.5" y2="13.5" />
      {width > 0 ? <rect x="4" y="9" width={width} height="6" rx="0.5" fill="currentColor" stroke="none" /> : null}
      {charging ? <path d="m11 7-3 5h4l-3 5" stroke="var(--card)" strokeWidth="2.5" /> : null}
    </svg>
  );
}

// The two things people check most: battery and which devices the headset is talking to.
export function Hero() {
  const { headset, devices, info, profile } = useStore();
  const percent = headset?.batteryPercent ?? null;
  const low = percent !== null && percent <= 20;
  const charging = headset?.charging ?? false;
  const connected = devices.filter((d) => d.connected).map((d) => (d.address === info?.address ? "this computer" : d.name));
  const valueText = percent === null ? "unknown" : `${percent} percent${low ? ", low" : ""}${charging ? ", charging" : ""}`;
  return (
    <Card>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        <div className="flex min-h-16 items-center gap-4">
          <BatteryGlyph percent={percent} charging={charging} className={`size-9 shrink-0 ${charging ? "text-emerald-500" : low ? "text-destructive" : "text-muted-foreground"}`} />
          <div className="min-w-0">
            <div className="text-3xl font-semibold tabular-nums" role="meter" aria-label="Battery" aria-valuemin={0} aria-valuemax={100}
                 aria-valuenow={percent ?? undefined} aria-valuetext={valueText}>
              {percent === null ? "--" : `${percent} %`}
            </div>
            <p className="text-sm text-muted-foreground">{charging ? "Charging" : low ? "Low" : "Battery"}</p>
          </div>
        </div>
        <div className="flex min-h-16 items-center gap-4">
          <Bluetooth className="size-9 shrink-0 text-sky-500" aria-hidden />
          <div className="flex min-w-0 flex-col justify-center">
            <div className="flex flex-wrap items-center gap-2 font-medium">
              {profile?.model ?? "Headset"}
              {profile?.experimental ? (
                <Tooltip>
                  <TooltipTrigger asChild><Badge variant="outline" className="cursor-help font-normal">experimental</Badge></TooltipTrigger>
                  <TooltipContent>Same commands as the OpenMeet; not verified on this model.</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {connected.length === 0 ? "Not connected to anything" : `Connected to ${connected.length > 1 ? `${connected.slice(0, -1).join(", ")} and ${connected[connected.length - 1]}` : connected[0]}`}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
