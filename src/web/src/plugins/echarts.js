import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components'

use([CanvasRenderer, BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent])
