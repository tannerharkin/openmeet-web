import { useState } from "react";
import { ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStore } from "@/store";

// Firmware versions, addresses and the prompt language: rarely needed, so collapsed by default.
export function DetailsSection() {
  const { info, headset, profile } = useStore();
  const [open, setOpen] = useState(false);
  const rows: [string, string | undefined][] = [
    ["Dongle", info ? `${info.product} \u00b7 ${info.firmware}` : undefined],
    ["Dongle address", info?.address],
    ["Headset", info?.headsetModel ? `${profile?.model ?? ""} ${info.headsetModel}${headset ? ` \u00b7 ${headset.firmware}` : ""}`.trim() : undefined],
    ["Prompt language", headset?.language],
  ];
  const copy = async () => {
    await navigator.clipboard.writeText(rows.map(([label, value]) => `${label}\t${value ?? ""}`).join("\n"));
    toast.success("Copied");
  };
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border">
      <div className="flex items-center pr-2">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex flex-1 items-center gap-2 px-4 py-3 text-left text-sm font-medium">
            <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden /> Details
          </button>
        </CollapsibleTrigger>
        <Tooltip>
          <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Copy details" disabled={!info} onClick={() => void copy()}><Copy aria-hidden /></Button></TooltipTrigger>
          <TooltipContent>Copy</TooltipContent>
        </Tooltip>
      </div>
      <CollapsibleContent className="px-4 pb-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono text-xs leading-5">{value ?? "-"}</dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}
