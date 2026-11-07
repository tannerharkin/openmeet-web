import { useEffect, useRef, useState } from "react";
import { ChevronRight, Copy, Download, Maximize2, Minimize2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStore, type LogLevel } from "@/store";

type Filter = "all" | "actions" | "notifications" | "errors" | "raw";
const FILTERS: { id: Filter; label: string; levels: LogLevel[] }[] = [
  { id: "all", label: "All", levels: ["info", "action", "notify", "error", "drop", "raw"] },
  { id: "actions", label: "Actions", levels: ["action", "error"] },
  { id: "notifications", label: "Notifications", levels: ["notify"] },
  { id: "errors", label: "Errors", levels: ["error", "drop"] },
  { id: "raw", label: "Raw", levels: ["raw", "drop"] },
];
const PREFIX: Partial<Record<LogLevel, string>> = { error: "Error: ", drop: "Dropped: " };
const CLASS: Record<LogLevel, string> = {
  info: "", action: "font-medium", notify: "text-sky-600 dark:text-sky-400", error: "text-destructive",
  drop: "text-amber-600 dark:text-amber-400", raw: "text-muted-foreground",
};

// Activity log, errors and raw frames. Collapsed by default; opens itself when something fails.
export function Diagnostics() {
  const { log, dropped, showRaw, setShowRaw, clearLog, logText, lastError, diagnosticsOpen, setDiagnosticsOpen } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const levels = FILTERS.find((f) => f.id === filter)!.levels;
  const lines = log.filter((l) => levels.includes(l.level));

  useEffect(() => {
    const el = box.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const copy = async () => { await navigator.clipboard.writeText(logText()); toast.success(`Copied ${log.length} log lines`); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([logText()], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `shokz-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Collapsible open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen} className="rounded-xl border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium">
          <ChevronRight className={`size-4 transition-transform ${diagnosticsOpen ? "rotate-90" : ""}`} aria-hidden /> Diagnostics
          {lastError ? <Badge variant="destructive" className="font-normal">error</Badge> : null}
          {dropped > 0 ? <Badge variant="outline" className="font-normal">{dropped} dropped</Badge> : null}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-4 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Filter log" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Button key={f.id} size="sm" variant={filter === f.id ? "secondary" : "ghost"} className="h-8 px-2.5 text-xs" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</Button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Switch size="sm" checked={showRaw} onCheckedChange={setShowRaw} aria-label="Capture raw frames" /> raw
          </label>
          {[
            { label: "Copy", icon: <Copy aria-hidden />, onClick: () => void copy() },
            { label: "Download", icon: <Download aria-hidden />, onClick: download },
            { label: "Clear", icon: <Trash2 aria-hidden />, onClick: clearLog },
            { label: expanded ? "Shrink" : "Expand", icon: expanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />, onClick: () => setExpanded((e) => !e) },
          ].map((a) => (
            <Tooltip key={a.label}>
              <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={a.label} disabled={a.label !== "Expand" && a.label !== "Shrink" && log.length === 0} onClick={a.onClick}>{a.icon}</Button></TooltipTrigger>
              <TooltipContent>{a.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Copies and downloads include device names and Bluetooth addresses.</p>

        <div ref={box} tabIndex={0} aria-label="Activity log" onScroll={() => { const el = box.current!; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8; }}
             className={`overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-5 ${expanded ? "max-h-[70vh]" : "max-h-64"}`}>
          {lines.length === 0 ? <span className="text-muted-foreground">Nothing yet.</span> : null}
          <ol>
            {lines.map((line) => (
              <li key={line.id} className={`${CLASS[line.level]} ${line.level === "action" && !line.text.startsWith(">") ? "pl-4" : ""} whitespace-pre-wrap break-all`}>
                <span className="text-muted-foreground">{line.time}  </span>{PREFIX[line.level] ?? ""}{line.text}
              </li>
            ))}
          </ol>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
