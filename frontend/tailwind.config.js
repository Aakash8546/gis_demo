/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Outfit', 'sans-serif'],
      },
      colors: {
        ink: '#0a192f',
        mist: '#f8fafc',
        aqua: '#00f2fe',
        amber: '#ffb703',
        coral: '#ff4d4d',
        glass: 'rgba(255, 255, 255, 0.08)',
        'glass-border': 'rgba(255, 255, 255, 0.15)',
        'dark-glass': 'rgba(15, 23, 42, 0.65)',
        'dark-glass-border': 'rgba(255, 255, 255, 0.08)'
      },
      boxShadow: {
        soft: '0 20px 40px -10px rgba(10, 25, 47, 0.15)',
        glow: '0 0 20px rgba(0, 242, 254, 0.3)',
        'dark-glow': '0 0 30px rgba(0, 0, 0, 0.5)'
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-glow': 'conic-gradient(from 180deg at 50% 50%, #2a8af6 0deg, #a853ba 180deg, #e92a67 360deg)',
      }
    }
  },
  plugins: []
};

