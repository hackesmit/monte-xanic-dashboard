// js/pronostico/view.js (xd-2ov.2) - "Fecha a Brix objetivo por lote" section
// of the Prediccion tab. Reads /api/pronostico through DataStore (the server
// fits and records); computes nothing itself. Text cells go through escapeHtml.
import { DemoMode } from '../demoMode.js';
import { DataStore } from '../dataLoader.js';
import { escapeHtml, todayInVineyard } from '../utils.js';
import { MIN_MUESTRAS, HORIZONTE_MAX, MAX_SIN_MUESTRA } from './brix.js';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]}` : '';
}

// The text of the "Fecha estimada" cell for one row of /api/pronostico.
export function textoEstado(f) {
  switch (f.estado) {
    case 'pronostico': return `${fechaCorta(f.fechaObjetivo)} ± ${f.bandaDias} d`;
    case 'sin-banda': return 'Sin margen medido';
    case 'fuera-de-rango': return `Más de ${HORIZONTE_MAX / 7} semanas`;
    case 'sin-tendencia': return 'Brix sin tendencia al alza';
    case 'alcanzado': return 'Objetivo alcanzado';
    case 'pocas-muestras': return `Faltan muestras (${f.n} de ${MIN_MUESTRAS})`;
    case 'sin-objetivo': return 'Sin objetivo en catálogo';
    case 'cosechado': return 'Cosechado';
    case 'sin-muestra-reciente': return `Sin muestra en ${MAX_SIN_MUESTRA} días`;
    default: return '';
  }
}

const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '');

// Lots that get a table row: those with a forecast or a reason a winemaker
// acts on. Harvested, stale and under-3-sample lots are counted below it.
const AL_PIE = {
  cosechado: (n) => `${n} lotes ya cosechados.`,
  'sin-muestra-reciente': (n) => `${n} lotes sin muestra en ${MAX_SIN_MUESTRA} días.`,
  'pocas-muestras': (n) => `${n} lotes con menos de ${MIN_MUESTRAS} muestras: sin fecha todavía.`,
};

export function tablaHtml(filas) {
  const activos = filas.filter(f => !AL_PIE[f.estado]);
  const pie = Object.entries(AL_PIE)
    .map(([estado, texto]) => [filas.filter(f => f.estado === estado).length, texto])
    .filter(([n]) => n > 0)
    .map(([n, texto]) => `<div class="pronostico-pie">${texto(n)}</div>`).join('');
  if (!activos.length) {
    return `<div class="pronostico-vacio">Sin lotes con pronóstico.</div>${pie}`;
  }
  const cuerpo = activos.map(f => `
    <tr class="pronostico-${escapeHtml(f.estado)}">
      <td>${escapeHtml(f.codigo ?? f.lote)}</td>
      <td class="pronostico-fecha">${escapeHtml(textoEstado(f))}</td>
      <td class="num">${num(f.brixUltimo)} <span class="pronostico-dia">${escapeHtml(fechaCorta(f.fechaUltima))}</span></td>
      <td class="num">${num(f.objetivo)}</td>
      <td class="num pronostico-opcional">${f.n}</td>
      <td class="pronostico-opcional">${escapeHtml(f.variedad ?? '')}</td>
    </tr>`).join('');
  return `<div class="pronostico-scroll"><table class="settings-table pronostico-tabla">
    <thead><tr><th>Lote</th><th>Fecha estimada</th><th class="num">Último Brix</th>
      <th class="num">Objetivo</th><th class="num pronostico-opcional">Muestras</th>
      <th class="pronostico-opcional">Varietal</th></tr></thead>
    <tbody>${cuerpo}</tbody></table></div>${pie}`;
}

let pedido = 0;

export const PronosticoBrix = {
  async render() {
    const caja = document.getElementById('pronostico-brix');
    const corteInput = document.getElementById('pronostico-brix-corte');
    if (!caja) return;
    if (DemoMode.isActive()) {
      caja.innerHTML = '<div class="pronostico-vacio">No disponible en modo demo.</div>';
      return;
    }
    const hoy = todayInVineyard();
    if (corteInput && !corteInput.dataset.listo) {
      corteInput.max = hoy;
      corteInput.value = hoy;
      corteInput.dataset.listo = '1';
      corteInput.addEventListener('change', () => this.render());
    }
    const corte = corteInput?.value && corteInput.value < hoy ? corteInput.value : null;
    const id = ++pedido;
    caja.innerHTML = '<div class="pronostico-vacio">Cargando…</div>';
    try {
      const body = await DataStore.loadPronosticoBrix(corte);
      if (id !== pedido) return;
      caja.innerHTML = tablaHtml(body.filas || []);
    } catch (e) {
      if (id !== pedido) return;
      console.error('[pronostico]', e);
      caja.innerHTML = '<div class="pronostico-vacio">No se pudo cargar el pronóstico.</div>';
    }
  },
};
