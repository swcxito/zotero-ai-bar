/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./addon/content/*.{html,xhtml,js}",
    "./src/modules/**/*.ts",
    "./src/components/**/*.ts",
  ],
  theme: {
    container: {
      center: true,
    },
  },
  plugins: [],
};
