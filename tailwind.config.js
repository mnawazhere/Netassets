/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Raw navy scale for places where semantic tokens don't fit
        navy: {
          50: '#F2F6FC',
          100: '#DFE9F7',
          200: '#BFD2EE',
          300: '#93B2E0',
          400: '#5F8ACC',
          500: '#3D6AB5',
          600: '#2C5198',
          700: '#234078',
          800: '#1B3059',
          900: '#12213D',
          950: '#0B1D3A',
        },
        gain: 'hsl(var(--gain))',
        loss: 'hsl(var(--loss))',
      },
      fontFamily: {
        mono: ['Menlo', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
};
