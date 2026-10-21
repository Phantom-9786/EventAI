'use client';

import { useId, useState } from 'react';

type Datum = { label: string; value: number; detailLabel?: string };
const number = (value: number) => value.toLocaleString('en-IN');

/** A zero-based count chart with the same interaction on touch, mouse and keyboard. */
export function DashboardChart({
  data,
  label,
  xLabel,
  note,
  horizontal = false,
}: {
  data: Datum[];
  label: string;
  xLabel: string;
  note: string;
  horizontal?: boolean;
}) {
  const tooltipId = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const active = hovered ?? pinned;
  const selected = active === null ? null : data[active];
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const max = Math.max(1, ...data.map((item) => item.value));
  const roughStep = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = Math.max(
    1,
    [1, 2, 5, 10].map((n) => n * magnitude).find((n) => n >= roughStep) ?? magnitude * 10,
  );
  const ceiling = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: ceiling / step + 1 }, (_, i) => i * step);
  const interact = (index: number) => ({
    onMouseEnter: () => setHovered(index),
    onMouseLeave: () => setHovered(null),
    onFocus: () => setHovered(index),
    onBlur: () => setHovered(null),
    onClick: () => {
      setHovered(null);
      setPinned((old) => (old === index ? null : index));
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHovered(null);
        setPinned(null);
      }
    },
    'aria-pressed': pinned === index,
    'aria-describedby': active === index ? tooltipId : undefined,
    'aria-label': `${data[index].detailLabel ?? data[index].label}: ${number(data[index].value)} events`,
  });

  return (
    <figure className="ep-data-chart" aria-label={label}>
      <figcaption className="ep-chart-context">{note}</figcaption>
      <div className="ep-chart-readout" aria-live="polite">
        {selected ? (
          <div id={tooltipId} className="ep-chart-tooltip" role="status">
            <strong>{selected.detailLabel ?? selected.label}</strong>
            <span>
              {number(selected.value)} {selected.value === 1 ? 'event' : 'events'}
              {horizontal &&
                ` · ${total ? Math.round((selected.value / total) * 100) : 0}% of shown events`}
            </span>
          </div>
        ) : (
          <span className="ep-chart-hint">Tap, hover or focus a bar for details</span>
        )}
      </div>
      {horizontal ? (
        <div className="ep-chart-distribution">
          {data.map((item, i) => (
            <button
              key={item.label}
              type="button"
              {...interact(i)}
              className={'ep-chart-category' + (active === i ? ' is-active' : '')}
            >
              <span className="ep-chart-category-label">
                <span>{item.label}</span>
                <strong>
                  {number(item.value)}{' '}
                  <small>({total ? Math.round((item.value / total) * 100) : 0}%)</small>
                </strong>
              </span>
              <span className="ep-chart-track" aria-hidden="true">
                <span style={{ width: `${total ? (item.value / total) * 100 : 0}%` }} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="ep-chart-axis-title">Number of events</div>
          <div className="ep-chart-columns">
            <div className="ep-chart-plot">
              {ticks.map((tick) => (
                <div
                  key={tick}
                  className="ep-chart-gridline"
                  style={{ bottom: `${(tick / ceiling) * 100}%` }}
                  aria-hidden="true"
                >
                  <span>{number(tick)}</span>
                </div>
              ))}
              <div
                className="ep-chart-bars"
                style={{
                  gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))`,
                }}
              >
                {data.map((item, i) => (
                  <button
                    key={item.label}
                    type="button"
                    {...interact(i)}
                    className={'ep-chart-column' + (active === i ? ' is-active' : '')}
                  >
                    <span
                      className="ep-chart-bar"
                      style={{ height: `${(item.value / ceiling) * 100}%` }}
                      aria-hidden="true"
                    >
                      <span>{number(item.value)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div
              className="ep-chart-x-labels"
              style={{
                gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))`,
              }}
              aria-hidden="true"
            >
              {data.map((item) => (
                <span key={item.label}>{item.label}</span>
              ))}
            </div>
            <p className="ep-chart-axis-bottom">{xLabel}</p>
          </div>
        </>
      )}
      {!total && (
        <p className="ep-chart-empty">
          No events in this view yet. Zero values are shown above.
        </p>
      )}
    </figure>
  );
}
