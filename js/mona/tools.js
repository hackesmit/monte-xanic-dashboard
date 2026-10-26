// js/mona/tools.js — Mona tool executors (the schemas live in toolDefs.js).
// Executors call ONLY public APIs of DataStore/KPIs and delegate DOM/app effects
// to ctx callbacks, so this module stays free of direct DOM access.
import { DataStore } from '../dataLoader.js';
import { KPIs } from '../kpis.js';
import { queryData, aggregateData, listFields } from './dataAccess.js';
import { validateChartSpec, validateTableSpec } from './chartSpec.js';
import { TOOL_DEFS } from './toolDefs.js';

export { TOOL_DEFS };

export function resolveDataset(name) {
  switch (name) {
    case 'berry': return DataStore.berryData || [];
    case 'wine': return DataStore.wineRecepcion || [];
    case 'preferment': return DataStore.winePreferment || [];
    case 'mediciones': return DataStore.medicionesData || [];
    default: return [];
  }
}

// KPI keys → the berry JS field names used by KPIs.weightedAvg (see kpis.js).
const KPI_FIELDS = { brix: 'brix', ph: 'pH', ta: 'ta', taninos: 'tANT', pesoBaya: 'berryFW' };

export async function executeTool(name, input = {}, ctx = {}) {
  try {
    switch (name) {
      case 'query_data':
        return { content: JSON.stringify(queryData(resolveDataset(input.dataset), input)) };
      case 'aggregate_data':
        return { content: JSON.stringify(aggregateData(resolveDataset(input.dataset), input)) };
      case 'list_fields':
        return { content: JSON.stringify(listFields(resolveDataset(input.dataset))) };
      case 'compute_kpis': {
        const rows = queryData(resolveDataset('berry'), { filters: input.filters, limit: 1e9 }).rows;
        const kpis = { muestras: rows.length };
        for (const [k, field] of Object.entries(KPI_FIELDS)) kpis[k] = KPIs.weightedAvg(rows, field);
        return { content: JSON.stringify(kpis) };
      }
      case 'render_chart': {
        const v = validateChartSpec(input);
        if (!v.ok) return { content: `ERROR de validación: ${v.errors.join('; ')}` };
        ctx.onChart?.(v.spec);
        return { content: 'Gráfica renderizada correctamente en el chat.', display: { kind: 'chart', spec: v.spec } };
      }
      case 'render_table': {
        const v = validateTableSpec(input);
        if (!v.ok) return { content: `ERROR de validación: ${v.errors.join('; ')}` };
        ctx.onTable?.(v.spec);
        return { content: 'Tabla renderizada correctamente en el chat.', display: { kind: 'table', spec: v.spec } };
      }
      case 'apply_filters': {
        const n = ctx.onApplyFilters?.(input);
        return { content: `Filtros aplicados.${n != null ? ` ${n} muestras coinciden.` : ''}` };
      }
      case 'set_view': {
        const ok = ctx.onSetView?.(input.view);
        return { content: ok === false ? `Vista desconocida: ${input.view}` : `Vista cambiada a ${input.view}.` };
      }
      case 'propose_fact': {
        await ctx.onProposeFact?.(input.fact);
        return { content: 'Hecho propuesto. Un usuario de laboratorio debe aprobarlo antes de que Mona lo use.' };
      }
      default:
        return { content: `ERROR: herramienta desconocida ${name}` };
    }
  } catch (err) {
    return { content: `ERROR ejecutando ${name}: ${String(err)}` };
  }
}
