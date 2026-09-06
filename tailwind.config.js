/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#0b0f19',
          card: '#121829',
          surface: '#1a233a',
          hover: '#222f4f',
        },
        primary: {
          DEFAULT: '#6366f1',
          hover: '#4f46e5',
          light: '#818cf8',
          glow: 'rgba(99, 102, 241, 0.25)',
        },
        accent: {
          teal: '#14b8a6',
          purple: '#a855f7',
          amber: '#f59e0b',
          rose: '#f43f5e',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['Merriweather', 'Georgia', 'Cambria', 'serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'sound-wave': 'soundwave 1.2s ease-in-out infinite',
      },
      keyframes: {
        soundwave: {
          '0%, 100%': { height: '4px' },
          '50%': { height: '24px' },
        }
      }
    },
  },
  plugins: [],
}
