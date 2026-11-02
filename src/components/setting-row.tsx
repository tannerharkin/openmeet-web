import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RowState } from "@/store";

export function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `group-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="pt-5 first:pt-0">
      <h3 id={id} className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  );
}

// One labelled control. The label is a real <label> so clicking it focuses the control; the hint,
// when present, is wired through aria-describedby by the caller. The trailing state slot shows the
// write in progress and its outcome without moving the control.
export function SettingRow({ id, label, hint, state, children }: { id: string; label: string; hint?: string; state?: RowState; children: React.ReactNode }) {
  return (
    <div className="flex min-h-13 flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2">
      <div className="min-w-0">
        <label id={`${id}-label`} htmlFor={id} className="block text-sm leading-5 font-medium">{label}</label>
        {hint ? <p id={`${id}-hint`} className="text-xs leading-4 text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        <span className="flex size-5 items-center justify-center" role="status">
          {state === "pending" ? <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Saving" /> : null}
          {state === "saved" ? <Check className="size-4 text-emerald-500" aria-label="Saved" /> : null}
          {state === "kept" ? (
            <Tooltip>
              <TooltipTrigger asChild><TriangleAlert className="size-4 text-amber-500" aria-label="Not applied" tabIndex={0} /></TooltipTrigger>
              <TooltipContent>The headset kept its previous value</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        {children}
      </div>
    </div>
  );
}
