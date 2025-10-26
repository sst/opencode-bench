/**
 * Utility functions for building QuickChart URLs for benchmark visualizations.
 */

const QUICKCHART_BASE_URL = "https://quickchart.io/chart";

interface RadarChartData {
  labels: string[];
  values: number[];
  title: string;
  datasetLabel?: string;
}

interface BarChartData {
  labels: string[];
  values: number[];
  title: string;
}

/**
 * Builds a radar chart URL for displaying per-metric scores.
 *
 * @param data Chart data including labels, values, and title
 * @param options Optional styling options
 * @returns QuickChart URL for the radar chart
 */
export function buildRadarChartUrl(
  data: RadarChartData,
  options?: {
    width?: number;
    height?: number;
    backgroundColor?: string;
    includeBackground?: boolean;
  },
): string {
  const {
    width = 600,
    height = 500,
    backgroundColor = "#FDFBF9",
    includeBackground = false,
  } = options || {};

  const config = {
    type: "radar",
    backgroundColor,
    data: {
      labels: data.labels,
      datasets: [
        {
          label: data.datasetLabel || data.title,
          data: data.values,
          backgroundColor: "rgba(188, 187, 187, 0.3)",
          borderColor: "#1F1E1E",
          borderWidth: 2,
          pointBackgroundColor: "rgba(31, 30, 29, 0.9)",
          pointBorderColor: "#FDFBF9",
          pointHoverRadius: 5,
          lineTension: 0.1,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      defaultFontFamily:
        "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace",
      defaultFontColor: "hsl(0, 1%, 39%)",
      layout: {
        padding: {
          top: 24,
          right: 32,
          bottom: 16,
          left: 32,
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        title: {
          display: true,
          text: data.title,
          color: "hsl(0, 5%, 12%)",
          font: {
            size: 18,
            family: "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace",
            weight: "500",
          },
        },
        datalabels: false,
      },
      scale: {
        ticks: {
          beginAtZero: true,
          min: 0,
          max: 1,
          stepSize: 0.2,
          showLabelBackdrop: false,
          fontColor: "hsl(0, 1%, 39%)",
          fontFamily:
            "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace",
        },
        gridLines: {
          color: "rgba(176, 176, 176, 0.35)",
        },
        angleLines: {
          color: "rgba(143, 139, 139, 0.3)",
        },
        pointLabels: {
          fontColor: "hsl(0, 1%, 39%)",
          fontFamily:
            "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: 12,
        },
      },
      elements: {
        line: {
          borderJoinStyle: "round",
        },
      },
    },
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(config));
  const bkgParam = includeBackground ? `&bkg=${backgroundColor.replace("#", "")}` : "";
  return `${QUICKCHART_BASE_URL}?c=${encodedConfig}&w=${width}&h=${height}${bkgParam}`;
}

/**
 * Builds a horizontal bar chart URL for comparing model scores.
 *
 * @param data Chart data including labels, values, and title
 * @param options Optional styling options
 * @returns QuickChart URL for the bar chart
 */
export function buildBarChartUrl(
  data: BarChartData,
  options?: {
    width?: number;
    height?: number;
    backgroundColor?: string;
  },
): string {
  const {
    width = 700,
    height = 400,
    backgroundColor = "white",
  } = options || {};

  const fillColor = "rgba(31,30,29,0.94)";
  const strokeColor = "rgba(31,30,29,1)";

  const config = {
    type: "bar",
    data: {
      labels: data.labels,
      datasets: [
        {
          label: "Score",
          data: data.values,
          backgroundColor: Array(data.labels.length).fill(fillColor),
          borderColor: Array(data.labels.length).fill(strokeColor),
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: data.title,
        },
      },
      scales: {
        yAxes: [
          {
            ticks: {
              beginAtZero: true,
              min: 0,
              max: 1,
            },
          },
        ],
        xAxes: [
          {
            ticks: { autoSkip: false },
          },
        ],
      },
    },
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(config));
  return `${QUICKCHART_BASE_URL}?c=${encodedConfig}&w=${width}&h=${height}&bkg=${backgroundColor}`;
}
