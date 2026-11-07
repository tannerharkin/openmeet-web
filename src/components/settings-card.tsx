import { Loader2, Play, SlidersHorizontal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { useStore } from "@/store";
import { AUTO_OFF_MINUTES, type Eq, type Prompt, type PromptVolume } from "@/protocol/frames";
import type { SettingChange } from "@/protocol/commands";

type BoolSetting = Extract<SettingChange, { value: boolean }>["name"];
interface Toggle { name: BoolSetting; label: string; hint?: string }
const CALL_TOGGLES: Toggle[] = [
  { name: "busylight", label: "Busy light", hint: "Keep busy indicator light on during the call" },
  { name: "muteReminder", label: "Occasionally beep while muted as a reminder" },
  { name: "focusMode", label: "Focus mode", hint: "Auto-rejects calls from the other device while on an active call" },
];
const autoOffLabel = (m: number) => (m === 0 ? "Never" : m < 60 ? `${m} min` : `${m / 60} h`);

export function SettingsCard() {
  const { settings: s, headsetReady, rowState, changeSetting, preview, isInFlight } = useStore();
  const disabled = !headsetReady || !s;
  const playing = isInFlight("Play sample prompt");
  const promptsOff = s?.prompt === "Off";
  const volume = s?.promptVolume ?? null;
  // An unknown headset volume still previews, at the middle level.
  const sampleVolume: PromptVolume = volume ?? "Medium";
  const toggleRow = (t: Toggle) => (
    <SettingRow key={t.name} id={t.name} label={t.label} hint={t.hint} state={rowState[t.name]}>
      <Switch id={t.name} aria-labelledby={`${t.name}-label`} aria-describedby={t.hint ? `${t.name}-hint` : undefined} checked={s?.[t.name] ?? false} disabled={disabled}
              onCheckedChange={(v) => void changeSetting({ name: t.name, value: v })} />
    </SettingRow>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><SlidersHorizontal className="size-4" aria-hidden /> Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <SettingGroup title="Calls">{CALL_TOGGLES.map(toggleRow)}</SettingGroup>

        <SettingGroup title="Sounds">
          <SettingRow id="prompt" label="Prompts" state={rowState.prompt}>
            <Select value={s?.prompt ?? ""} disabled={disabled} onValueChange={(v) => void changeSetting({ name: "prompt", value: v as Prompt })}>
              <SelectTrigger id="prompt" aria-labelledby="prompt-label" className="w-32"><SelectValue placeholder="-" /></SelectTrigger>
              <SelectContent><SelectItem value="Voice">Voice</SelectItem><SelectItem value="Tone">Tone</SelectItem><SelectItem value="Off">Off</SelectItem></SelectContent>
            </Select>
          </SettingRow>
          <SettingRow id="promptVolume" label="Prompt volume" state={rowState.promptVolume}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-disabled={disabled || promptsOff} aria-label={`Play a sample prompt at ${sampleVolume} volume`}
                        onClick={() => { if (!disabled && !promptsOff && !playing) void preview(sampleVolume); }}>
                  {playing ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Play aria-hidden />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Play a sample</TooltipContent>
            </Tooltip>
            <Select value={volume ?? ""} disabled={disabled || promptsOff}
                    onValueChange={(v) => void changeSetting({ name: "promptVolume", value: v as PromptVolume })}>
              <SelectTrigger id="promptVolume" aria-labelledby="promptVolume-label" className="w-32"><SelectValue placeholder="-" /></SelectTrigger>
              <SelectContent><SelectItem value="High">High</SelectItem><SelectItem value="Medium">Medium</SelectItem><SelectItem value="Low">Low</SelectItem></SelectContent>
            </Select>
          </SettingRow>
          <SettingRow id="buttonSound" label="Button sounds" state={rowState.buttonSound}>
            <Switch id="buttonSound" aria-labelledby="buttonSound-label" checked={s?.buttonSound ?? false} disabled={disabled}
                    onCheckedChange={(v) => void changeSetting({ name: "buttonSound", value: v })} />
          </SettingRow>
          <SettingRow id="eq" label="Equalizer" state={rowState.eq}>
            <Select value={s?.eq ?? ""} disabled={disabled} onValueChange={(v) => void changeSetting({ name: "eq", value: v as Eq })}>
              <SelectTrigger id="eq" aria-labelledby="eq-label" className="w-32"><SelectValue placeholder="-" /></SelectTrigger>
              <SelectContent><SelectItem value="Standard">Standard</SelectItem><SelectItem value="Vocal">Vocal</SelectItem></SelectContent>
            </Select>
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="Power">
          <SettingRow id="autoOffMinutes" label="Auto power off" hint="Powers the headset off automatically after being idle for this long" state={rowState.autoOffMinutes}>
            <Select value={s ? String(s.autoOffMinutes) : ""} disabled={disabled} onValueChange={(v) => void changeSetting({ name: "autoOffMinutes", value: Number(v) })}>
              <SelectTrigger id="autoOffMinutes" aria-labelledby="autoOffMinutes-label" aria-describedby="autoOffMinutes-hint" className="w-32"><SelectValue placeholder="-" /></SelectTrigger>
              <SelectContent>{AUTO_OFF_MINUTES.map((m) => <SelectItem key={m} value={String(m)}>{autoOffLabel(m)}</SelectItem>)}</SelectContent>
            </Select>
          </SettingRow>
        </SettingGroup>
      </CardContent>
    </Card>
  );
}
