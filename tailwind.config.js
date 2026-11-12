import { toolkitTheme, touchVariant } from '@pgmaps/geo-toolkit/tailwind-theme.mjs'

/**
 * Token names (radius scale, colours, font sizes, z-index) come from the toolkit's
 * theme module, so a class means the same here as inside a `.geo-toolkit` workspace.
 * Change a token's value in `src/index.css`; add a token name in the toolkit.
 * @type {import('tailwindcss').Config}
 */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    // Shared controls and charts also render outside scoped map workspaces.
    "./node_modules/@pgmaps/geo-toolkit/dist/ui/**/*.js",
    "./node_modules/@pgmaps/geo-toolkit/dist/visualizations/charts/**/*.js",
  ],
  theme: {
    extend: toolkitTheme,
  },
  plugins: [
    // `touch:` targets coarse pointers (phones, tablets) so controls can grow
    // to a finger-sized hit area without changing the mouse layout.
    touchVariant,
  ],
}
