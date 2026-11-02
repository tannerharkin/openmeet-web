import { create } from "zustand";

type Theme = "light" | "dark";
const KEY = "shokz-theme";

function initial(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(KEY, theme);
  return theme;
}

export const useTheme = create<{ theme: Theme; toggle(): void }>((set, get) => ({
  theme: apply(initial()),
  toggle: () => set({ theme: apply(get().theme === "dark" ? "light" : "dark") }),
}));
