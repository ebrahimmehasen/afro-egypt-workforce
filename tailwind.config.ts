import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-cairo)", "Tajawal", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          50: "#fdf3f2",
          100: "#fbe3e0",
          200: "#f6c4be",
          300: "#ef9c92",
          400: "#e56d5d",
          500: "#d6392a", // brand red
          600: "#bd2a1d",
          700: "#9c2118",
          800: "#7f1e18",
          900: "#6a1d18",
          950: "#390c09",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        gold: {
          50: "#fdf9ec",
          100: "#faf0cc",
          200: "#f4de9b",
          300: "#edc75f",
          400: "#e7b13a", // brand gold
          500: "#d4972a",
          600: "#b47522",
          700: "#8f5820",
          800: "#75461f",
          900: "#633b1e",
        },
        ink: {
          DEFAULT: "#1c1113", // brand near-black
          50: "#f6f4f4",
          100: "#e7e2e2",
          200: "#cdc2c3",
          300: "#a89697",
          400: "#7c6567",
          500: "#5f4a4c",
          600: "#4c3b3d",
          700: "#3f3132",
          800: "#2c2223",
          900: "#1c1113",
          950: "#100a0b",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "#1a7f4e",
          foreground: "#ffffff",
        },
        warning: {
          DEFAULT: "#b47522",
          foreground: "#ffffff",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(28 17 19 / 0.06), 0 1px 3px 0 rgb(28 17 19 / 0.08)",
        elevated: "0 4px 12px -2px rgb(28 17 19 / 0.10), 0 2px 4px -2px rgb(28 17 19 / 0.06)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
