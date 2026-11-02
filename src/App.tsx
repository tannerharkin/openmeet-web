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
      </div>
      <Toaster theme={theme} richColors closeButton position="bottom-right" />
    </TooltipProvider>
  );
}
