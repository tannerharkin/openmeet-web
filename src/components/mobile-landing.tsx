import { useState, type ComponentType } from "react";
import { Building2, Check, Code, Copy, Headphones, MonitorSmartphone, Share2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

// The address of this page without query or fragment, so a saved copy or another host shares itself.
const pageUrl = () => location.href.split(/[?#]/)[0];

const REASONS: { icon: ComponentType<{ className?: string }>; title: string; text: string }[] = [
  { icon: Building2, title: "Locked-down work laptops", text: "If Chrome or Edge runs, so does this. No installer and no admin rights needed." },
  { icon: Users, title: "Shared and borrowed computers", text: "A hot desk, a meeting-room PC or a friend's laptop. Close the tab and there's nothing to uninstall." },
  { icon: MonitorSmartphone, title: "Any desktop", text: "Windows, macOS, Linux or ChromeOS." },
  { icon: Code, title: "Nothing hidden", text: "Every line of code is open on GitHub, so if you're curious you can see exactly what it sends to your headset and how it works." },
];

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* blocked or unavailable: try the legacy path */ }
  const area = Object.assign(document.createElement("textarea"), { value: text, readOnly: true });
  area.style.position = "fixed"; area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try { return document.execCommand("copy"); } catch { return false; } finally { area.remove(); }
}

// Phones and tablets cannot reach the dongle (no WebHID), so they get a full-screen hand-off to a computer.
export function MobileLanding() {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const canShare = typeof navigator.share === "function";
  const share = () => navigator.share({ title: "OpenMeet Web", url: pageUrl() }).catch(() => {});  // cancelling the sheet rejects
  const copyLink = async () => { setCopy((await copyText(pageUrl())) ? "copied" : "failed"); setTimeout(() => setCopy("idle"), 2500); };
  return (
    <div className="flex min-h-dvh flex-col px-6 pt-[max(env(safe-area-inset-top),2rem)]">
      <div className="flex items-center gap-2 text-sm font-medium"><Headphones className="size-5" aria-hidden /> OpenMeet Web</div>
      <main className="mt-8">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Adjust your OpenMeet from any computer</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          For the times installing an app isn't an option or isn't worth it: change the busy light, prompts, EQ and paired devices straight from a browser tab.
        </p>
        <ul className="mt-8 space-y-5">
          {REASONS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted"><Icon className="size-[18px]" aria-hidden /></span>
              <div><p className="text-[15px] font-medium">{title}</p><p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{text}</p></div>
            </li>
          ))}
        </ul>
      </main>
      <footer className="mt-auto pt-10 text-center text-[11px] text-muted-foreground">
        Independent project, not affiliated with Shokz. <a className="underline underline-offset-2" href="https://github.com/tannerharkin/openmeet-web">Source on GitHub</a>
      </footer>
      <div className="sticky bottom-0 -mx-6 mt-4 border-t bg-background/90 px-6 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur">
        {copy === "failed" ? <p className="mb-2 text-center text-xs text-muted-foreground select-all" role="status">{pageUrl()}</p> : null}
        <div className={`grid gap-2 ${canShare ? "grid-cols-2" : ""}`}>
          {canShare ? <Button size="lg" onClick={() => void share()}><Share2 aria-hidden /> Send to computer</Button> : null}
          <Button size="lg" variant="outline" onClick={() => void copyLink()} aria-live="polite">
            {copy === "copied" ? <><Check aria-hidden /> Copied</> : <><Copy aria-hidden /> Copy link</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
