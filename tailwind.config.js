/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "pd-base": "#0d1117",
        "pd-surface": "#161b22",
        "pd-elevated": "#21262d",
        "pd-border": "#30363d",
        "pd-text-primary": "#c9d1d9",
        "pd-text-secondary": "#8b949e",
        "pd-text-tertiary": "#6e7681",
        "pd-text-inverse": "#0d1117",
        "pd-accent": "#58a6ff",
        "pd-accent-hover": "#79c0ff",
        "pd-success": "#3fb950",
        "pd-warning": "#d29922",
        "pd-danger": "#f85149",
      },
      fontFamily: {
        sans: ["Inter", "SF Pro Display", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        "pd-xs": ["11px", { lineHeight: "1.4", letterSpacing: "0.01em" }],
        "pd-sm": ["12px", { lineHeight: "1.5" }],
        "pd-base": ["13px", { lineHeight: "1.5" }],
        "pd-md": ["14px", { lineHeight: "1.5" }],
        "pd-lg": ["16px", { lineHeight: "1.4", letterSpacing: "-0.01em" }],
        "pd-xl": ["20px", { lineHeight: "1.3", letterSpacing: "-0.02em" }],
        "pd-2xl": ["24px", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
      },
      borderRadius: {
        "pd-sm": "4px",
        "pd-md": "6px",
        "pd-lg": "8px",
      },
      transitionTimingFunction: {
        "pd-snap": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
