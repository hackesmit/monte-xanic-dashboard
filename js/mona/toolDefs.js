// js/mona/toolDefs.js - Mona's tool schemas, the one copy. Pure data, no imports,
// so api/mona.js sends exactly these to Anthropic and the client cannot swap them (xd-aiz).

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
