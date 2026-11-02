import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import workspaceUtilities from './scripts/postcss/workspace-utilities.js'

export default {
  plugins: [tailwindcss(), workspaceUtilities(), autoprefixer()],
}
