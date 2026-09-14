/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Design §25: motion is subtle and functional, 120–220ms. Tab
      // content fades in 120ms; `motion-safe:` keeps it off when the
      // operator prefers reduced motion (design §34).
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 120ms ease-out",
      },
    },
  },
  plugins: [],
};
