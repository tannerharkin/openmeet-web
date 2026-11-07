import { create } from "zustand";
import { readLocal, writeLocal } from "@/lib/storage";

type Theme = "light" | "dark";
const KEY = "shokz-theme";

function initial(): Theme {
  const saved = readLocal(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  // The installed app's title bar follows these metas, which otherwise track the OS, not this toggle.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = theme === "dark" ? "#0a0a0a" : "#ffffff";
  writeLocal(KEY, theme);
  return theme;
}

export const useTheme = create<{ theme: Theme; toggle(): void }>((set, get) => ({
  theme: apply(initial()),
  toggle: () => set({ theme: apply(get().theme === "dark" ? "light" : "dark") }),
}));
