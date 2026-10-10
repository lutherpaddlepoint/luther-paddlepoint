import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F5F8F7", // cool white page
        ink: "#13232B", // text
        muted: "#55676D",
        line: "#D2DEDB",
        court: "#1D5A45", // deep court green
        pool: "#1C7F99", // pool blue
        ball: "#E6E23C", // pickleball yellow: selection only
        dusk: "#2C3170", // night rate, after the lights come on
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
