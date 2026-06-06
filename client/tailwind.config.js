/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: '#1A1A2E',
        ac: '#C0392B',
        mb: '#1A3A5C',
        healthy: '#1E6B4A',
        warn: '#B45309',
        sand: '#F5F2EC',
      },
    },
  },
  plugins: [],
}
