// js/mona/tools.js — Mona tool schemas + executors.
// Executors call ONLY public APIs of DataStore/KPIs and delegate DOM/app effects
// to ctx callbacks, so this module stays free of direct DOM access.
import { DataStore } from '../dataLoader.js';
import { KPIs } from '../kpis.js';
import { queryData, aggregateData, listFields } from './dataAccess.js';
import { validateChartSpec, validateTableSpec } from './chartSpec.js';

export function resolveDataset(name) {
  switch (name) {
    case 'berry': return DataStore.berryData || [];
    case 'wine': return DataStore.wineRecepcion || [];
    case 'preferment': return DataStore.winePreferment || [];
    case 'mediciones': return DataStore.medicionesData || [];
    default: return [];
  }
}

const DATASET_ENUM = ['berry', 'wine', 'preferment', 'mediciones'];

export const TOOL_DEFS = [
  {
    name: 'query_data',
    description: 'Filtra y proyecta filas de un conjunto de datos. Devuelve como máximo 200 filas; si hay más, agrega en su lugar.',
    input_schema: {
      type: 'object',
      properties: {
        dataset: { type: 'string', enum: DATASET_ENUM },
        filters: { type: 'array', items: { type: 'object' }, description: 'Lista de {field, op, value}. op: eq|ne|in|gt|gte|lt|lte|between.' },
        fields: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number' },
      },
      required: ['dataset'],
    },
  },
  {
    name: 'aggregate_data',
    description: 'Agrupa por un campo y calcula avg/min/max/sum/count sobre un campo numérico. Base para las gráficas.',
    input_schema: {
      type: 'object',
      properties: {
        dataset: { type: 'string', enum: DATASET_ENUM },
        groupBy: { type: 'string' },
        metric: { type: 'string', enum: ['avg', 'min', 'max', 'sum', 'count'] },
        field: { type: 'string' },
        filters: { type: 'array', items: { type: 'object' } },
      },
      required: ['dataset', 'metric'],
    },
  },
  {
    name: 'list_fields',
    description: 'Lista los campos numéricos y categóricos disponibles en un conjunto de datos.',
    input_schema: { type: 'object', properties: { dataset: { type: 'string', enum: DATASET_ENUM } }, required: ['dataset'] },
  },
  {
    name: 'compute_kpis',
    description: 'Calcula los KPIs de bayas (°Bx, pH, AT, taninos, peso de baya) ponderados por tonelaje sobre un subconjunto filtrado.',
    input_schema: { type: 'object', properties: { filters: { type: 'array', items: { type: 'object' } } } },
  },
  {
    name: 'render_chart',
    description: 'Renderiza una gráfica declarativa en el chat. Provee los datos ya agregados en series de puntos {x, y}.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['line', 'bar', 'stackedBar', 'scatter', 'pie', 'area'] },
        title: { type: 'string' }, xLabel: { type: 'string' }, yLabel: { type: 'string' },
        series: { type: 'array', items: { type: 'object' } },
        options: { type: 'object' },
      },
      required: ['type', 'series'],
    },
  },
  {
    name: 'render_table',
    description: 'Renderiza una tabla en el chat.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        columns: { type: 'array', items: { type: 'object' } },
        rows: { type: 'array' },
      },
      required: ['columns', 'rows'],
    },
  },
  {
    name: 'apply_filters',
    description: 'Aplica filtros del panel para enfocar la vista (variedades, orígenes, añadas, tipo de uva).',
    input_schema: {
      type: 'object',
      properties: {
        varieties: { type: 'array', items: { type: 'string' } },
        origins: { type: 'array', items: { type: 'string' } },
        vintages: { type: 'array', items: { type: 'number' } },
        grapeType: { type: 'string' },
      },
    },
  },
  {
    name: 'set_view',
    description: 'Navega a una vista del panel (berry, wine, extraction, vintage, map, explorer, mediciones, prediccion).',
    input_schema: { type: 'object', properties: { view: { type: 'string' } }, required: ['view'] },
  },
  {
    name: 'propose_fact',
    description: 'Propone un hecho duradero sobre la bodega para el conocimiento de Mona. Requiere aprobación de un usuario de laboratorio.',
    input_schema: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] },
  },
];

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
