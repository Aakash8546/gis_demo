/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#102a43',
        mist: '#f4f7fb',
        aqua: '#3ebd93',
        amber: '#f7b32b',
        coral: '#ff7a59'
      },
      boxShadow: {
        soft: '0 18px 45px rgba(16, 42, 67, 0.12)'
      }
    }
  },
  plugins: []
};

