/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#273046',
          teal: '#1DA39B',
          amber: '#F39C12',
        },
        slate: {
          bg: '#F7F8FA',
        }
      },
      spacing: {
        '13': '3.25rem',
        '15': '3.75rem',
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Arial"',
          'sans-serif'
        ],
        display: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Arial"',
          'sans-serif'
        ],
      }
    },
  },
  plugins: [],
}
