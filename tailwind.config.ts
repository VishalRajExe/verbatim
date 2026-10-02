import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        surface: "var(--surface)",
        "surface-subtle": "var(--surface-subtle)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        ink: "var(--ink)",
        "ink-muted": "var(--ink-muted)",
        "ink-faint": "var(--ink-faint)",
        accent: {
          DEFAULT: "var(--accent)",
          soft: "var(--accent-soft)",
        },
        "on-accent": "var(--on-accent)",
        verified: {
          DEFAULT: "var(--verified)",
          soft: "var(--verified-soft)",
          line: "var(--verified-line)",
        },
        caution: {
          DEFAULT: "var(--caution)",
          soft: "var(--caution-soft)",
          line: "var(--caution-line)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          soft: "var(--danger-soft)",
        },
        slate: {
          DEFAULT: "var(--slate)",
          soft: "var(--slate-soft)",
        },
        faint: {
          DEFAULT: "var(--faint)",
          soft: "var(--faint-soft)",
        },
      },
      fontFamily: {
        sans: ["var(--font-ui)", "system-ui", "sans-serif"],
        serif: ["var(--font-doc)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
