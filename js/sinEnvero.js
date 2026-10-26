// The "Sin envero" column of the maturity timeline charts.
// Pure and DOM-free so tests can import it directly.
//
// Every maturity timeline (chartBrix/Ant/PH/TA/Weight, chartEvolution) plots
// x = days post-envero. A lot whose Seguimiento workbook carries no readable
// Fecha de envero has no x, and before this module its readings simply
// vanished from every timeline while still counting in the KPIs and the table
// (xd-ayv). Inventing an envero would put a reading on a day nobody recorded,
// which the Seguimiento parser refuses to do, so the chart cannot either.
// Instead those readings stand in their own column, left of every dated
// point, under a tick that says what they are: the lot is visible, its values
// are readable, and nothing claims a day count the workbook never gave.

export const SIN_ENVERO_LABEL = 'Sin envero';

// Smallest distance, in days, between the column and the earliest dated
// point. A tenth of the dated span is used when that is wider, so the column
// reads as separate at any zoom.
const MIN_GAP = 5;
const GAP_SHARE = 0.1;

export function hasEnvero(d) {
  return !!d && Number.isFinite(d.daysPostCrush);
}

// Readings that belong in the column: no envero, but a numeric value to show.
export function sinEnveroRows(data, yField) {
  return (data || []).filter(d => !hasEnvero(d) && Number.isFinite(d?.[yField]));
}

// Where the column sits for a chart whose dated x values are `xs`.
// Returns { x, gap }: x is the column's position on the axis, gap the days
// between it and the earliest dated point. With no dated point at all the
// column stands alone at 0.
export function sinEnveroColumn(xs) {
  const finite = (xs || []).filter(Number.isFinite);
  if (!finite.length) return { x: 0, gap: MIN_GAP };
  let min = Infinity, max = -Infinity;
  for (const x of finite) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  const gap = Math.max(MIN_GAP, Math.ceil((max - min) * GAP_SHARE));
  return { x: Math.floor(min) - gap, gap };
}

// Chart.js axis options for an x axis that carries the column: the axis
// starts half a gap before the column, the auto ticks that would fall between
// the column and the dated points are removed, one tick is placed on the
// column, and that tick is labelled SIN_ENVERO_LABEL. `base` is the axis
// options the chart already uses; its ticks/grid styling is kept.
export function sinEnveroAxis(base, column) {
  const { x, gap } = column;
  const baseTicks = base?.ticks || {};
  const baseGrid = base?.grid || {};
  return {
    ...base,
    min: x - gap / 2,
    afterBuildTicks: (axis) => {
      axis.ticks = sinEnveroTicks(axis.ticks, column);
    },
    ticks: {
      ...baseTicks,
      callback: (value) => sinEnveroTickLabel(value, column),
    },
    grid: {
      ...baseGrid,
      // The column's own gridline is drawn heavier so it reads as a divider
      // between "no envero" and the dated timeline.
      lineWidth: (ctx) => (ctx?.tick?.value === x ? 1.5 : (baseGrid.lineWidth ?? 1)),
    },
  };
}

export function sinEnveroTicks(ticks, column) {
  const { x, gap } = column;
  const kept = (ticks || []).filter(t => t.value >= x + gap / 2);
  return [{ value: x }, ...kept];
}

export function sinEnveroTickLabel(value, column) {
  return value === column.x ? SIN_ENVERO_LABEL : value;
}

// The sample date of a reading as YYYY-MM-DD for a tooltip, or null.
export function fechaMuestra(d) {
  const v = d?.sampleDate;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'string' && v) return v.slice(0, 10);
  return null;
}
