import { captureChartSvg, rasterizeChart, type ChartSeries } from '@pgmaps/geo-toolkit/visualizations/react'
import { downloadBlob } from '@/lib/download'

/** The toolkit captures the chart; PG Maps owns filenames, PDF dependency and browser downloads. */
export function chartDownloads(title: string, subtitle: string, series: readonly ChartSeries[]) {
  return (['png', 'jpeg', 'svg', 'pdf'] as const).map((format) => ({
    id: format,
    label: `Download ${format.toUpperCase()}`,
    disabled: !series.length,
    onSelect: async (panel: HTMLElement) => {
      const plot = panel.querySelector<HTMLElement>('.water-chart-area')
      if (!plot?.querySelector('svg')) throw new Error('Select observations to export a chart.')
      const snapshot = captureChartSvg(plot, { title, subtitle, series })
      const filename = `water-temperature-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      if (format === 'svg') return downloadBlob(snapshot.blob, `${filename}.svg`)
      const image = await rasterizeChart(snapshot, format === 'jpeg' ? 'image/jpeg' : 'image/png')
      if (format !== 'pdf') return downloadBlob(image, `${filename}.${format}`)
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({
        orientation: snapshot.width > snapshot.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [snapshot.width, snapshot.height],
        hotfixes: ['px_scaling'],
      })
      pdf.addImage(new Uint8Array(await image.arrayBuffer()), 'PNG', 0, 0, snapshot.width, snapshot.height)
      downloadBlob(pdf.output('blob'), `${filename}.pdf`)
    },
  }))
}
