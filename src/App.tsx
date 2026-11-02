import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/header";
import { PhasePanel } from "@/components/phase-panel";
import { Hero } from "@/components/hero";
import { SettingsCard } from "@/components/settings-card";
import { DevicesCard } from "@/components/devices-card";
import { DetailsSection } from "@/components/details-section";
import { Diagnostics } from "@/components/diagnostics";
import { Unsupported } from "@/components/unsupported";
import { useTheme } from "@/hooks/use-theme";
import { useStore } from "@/store";

export default function App() {
  const theme = useTheme((s) => s.theme);
  const { phase, busy } = useStore();
  const supported = typeof navigator !== "undefined" && "hid" in navigator && window.isSecureContext;
  return (
    <TooltipProvider>
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <Header />
        {!supported ? (
          <Unsupported />
        ) : (
          <main className="mt-6 space-y-4" aria-busy={!!busy}>
            {phase !== "connected" ? <PhasePanel /> : null}
            {phase === "connected" ? (
              <>
                <Hero />
                <SettingsCard />
                <DevicesCard />
              </>
            ) : null}
            {phase !== "disconnected" ? <DetailsSection /> : null}
            <Diagnostics />
          </main>
        )}
        <footer className="mt-8 space-y-1 text-center text-xs text-muted-foreground">
          <p>
            <a href="https://github.com/tannerharkin/openmeet-web" className="underline underline-offset-4 hover:text-foreground">Source on GitHub</a>
          </p>
          <p>
            Independent project, not affiliated with or endorsed by Shokz. Shokz, OpenMeet and Loop120 are trademarks of their respective owners.
            Use at your own risk.
          </p>
        </footer>
      </div>
      <Toaster theme={theme} richColors closeButton position="bottom-right" />
    </TooltipProvider>
  );
}
