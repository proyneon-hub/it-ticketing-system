import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Trends } from '../types';

type Day = Trends['series'][number];

// Two lines on one axis: tickets opened and tickets resolved per day. Plain SVG, no chart
// library. The chart is a picture of the numbers, so the same numbers are always available as
// a table (the "Show as table" button), and the crosshair works from the keyboard too.

const WIDTH = 720;
const HEIGHT = 260;
const MARGIN = { top: 12, right: 16, bottom: 28, left: 40 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

const SERIES = [
  { key: 'opened', label: 'Opened', className: 'series-opened' },
  { key: 'resolved', label: 'Resolved', className: 'series-resolved' },
] as const;

// A round top for the axis and evenly spaced ticks from 0: 0, 5, 10, 15 rather than 0, 4.3, 8.6.
// The axis counts tickets, so a step is never smaller than one.
export function niceScale(max: number): { top: number; ticks: number[] } {
  const target = Math.max(max, 1);
  const rough = target / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(
    1,
    ([1, 2, 5, 10].find((multiple) => multiple * magnitude >= rough) ?? 10) * magnitude
  );
  const top = Math.ceil(target / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

// "2026-06-13" as "Jun 13". The date is already a calendar date, so no time zone applies.
export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function TrendChart({ series }: { series: Day[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const plot = useRef<SVGSVGElement>(null);
  const tableId = useId();

  const count = series.length;
  const max = Math.max(0, ...series.flatMap((day) => [day.opened, day.resolved]));
  const { top, ticks } = niceScale(max);
  const x = (index: number) =>
    MARGIN.left + (count > 1 ? (index / (count - 1)) * PLOT_WIDTH : PLOT_WIDTH / 2);
  const y = (value: number) => MARGIN.top + PLOT_HEIGHT - (value / top) * PLOT_HEIGHT;
  const path = (key: 'opened' | 'resolved') =>
    series.map((day, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(day[key])}`).join(' ');

  // The day nearest the pointer, so aiming at a date (not at a 2px line) is enough.
  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = plot.current?.getBoundingClientRect();
    if (!box || box.width === 0 || count === 0) return;
    const at = ((event.clientX - box.left) / box.width) * WIDTH - MARGIN.left;
    const index = count > 1 ? Math.round((at / PLOT_WIDTH) * (count - 1)) : 0;
    setActive(Math.min(count - 1, Math.max(0, index)));
  }

  function onKeyDown(event: KeyboardEvent) {
    if (count === 0) return;
    if (event.key === 'ArrowLeft') setActive((current) => Math.max(0, (current ?? count) - 1));
    else if (event.key === 'ArrowRight')
      setActive((current) => Math.min(count - 1, (current ?? -1) + 1));
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(count - 1);
    else if (event.key === 'Escape') setActive(null);
    else return;
    event.preventDefault();
  }

  const day = active === null ? undefined : series[active];
  // Keep the readout inside the chart near either edge.
  const tooltipLeft = active === null ? 0 : (x(active) / WIDTH) * 100;
  const flip = tooltipLeft > 60;

  const xLabels = count > 0 ? [0, Math.floor((count - 1) / 2), count - 1] : [];

  return (
    <figure className="trend-chart">
      <figcaption>
        <ul className="trend-legend" aria-label="Legend">
          {SERIES.map((item) => (
            <li key={item.key}>
              <span className={`legend-key ${item.className}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="secondary-button"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((current) => !current)}
        >
          {showTable ? 'Hide table' : 'Show as table'}
        </button>
      </figcaption>

      <div
        className="trend-plot"
        role="group"
        aria-label="Tickets opened and resolved per day. Use the arrow keys to read each day."
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((current) => current ?? count - 1)}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        <svg
          ref={plot}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          aria-hidden="true"
          onPointerMove={onPointerMove}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="grid"
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                className="axis-label"
                x={MARGIN.left - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {tick}
              </text>
            </g>
          ))}
          {xLabels.map((index, position) => (
            <text
              key={`${series[index]?.date}-${position}`}
              className="axis-label"
              x={x(index)}
              y={HEIGHT - 8}
              textAnchor={
                position === 0 ? 'start' : position === xLabels.length - 1 ? 'end' : 'middle'
              }
            >
              {shortDate(series[index]?.date ?? '')}
            </text>
          ))}

          {SERIES.map((item) => (
            <path key={item.key} className={`line ${item.className}`} d={path(item.key)} />
          ))}

          {day && active !== null ? (
            <g>
              <line
                className="crosshair"
                x1={x(active)}
                x2={x(active)}
                y1={MARGIN.top}
                y2={MARGIN.top + PLOT_HEIGHT}
              />
              {SERIES.map((item) => (
                <circle
                  key={item.key}
                  className={`dot ${item.className}`}
                  cx={x(active)}
                  cy={y(day[item.key])}
                  r={4}
                />
              ))}
            </g>
          ) : null}
        </svg>

        {day ? (
          <div
            className={flip ? 'trend-tooltip flip' : 'trend-tooltip'}
            style={{ left: `${tooltipLeft}%` }}
            role="status"
          >
            <span className="tooltip-date">{shortDate(day.date)}</span>
            {SERIES.map((item) => (
              <span key={item.key} className="tooltip-row">
                <span className={`legend-key ${item.className}`} aria-hidden="true" />
                <strong>{day[item.key]}</strong> {item.label.toLowerCase()}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div id={tableId} hidden={!showTable}>
        <table className="trend-table">
          <caption className="sr-only">Tickets opened and resolved per day</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Opened</th>
              <th scope="col">Resolved</th>
            </tr>
          </thead>
          <tbody>
            {series.map((row) => (
              <tr key={row.date}>
                <th scope="row">{shortDate(row.date)}</th>
                <td>{row.opened}</td>
                <td>{row.resolved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
