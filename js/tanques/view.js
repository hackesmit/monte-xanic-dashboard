// js/tanques/view.js - the Tanques tab: bodega plan, colour modes, search and
// the tank side panel. READ ONLY in this bead (xd-qrn.4): it renders what the
// movement log says and writes nothing.
//
// Division of labour:
//   js/tanques/estado.js - what each tank holds, derived from the log
//   js/tanques/plan.js   - where each vessel is drawn and which token colours it
//   this file            - SVG and HTML, event delegation, selection state
// No Supabase calls live here (DataStore owns them) and no tank semantics are
// restated here: a litre count or a stage that is not in `estado` is not shown.

import { DataStore } from '../dataLoader.js';
import { DemoMode } from '../demoMode.js';
import { escapeHtml } from '../utils.js';
import { replayMovimientos, historialTanque, recorridoLote, ETAPAS, TIPOS } from './estado.js';
import {
  POSICION_1_AL, GEOMETRIA, construirPlano,
  MODOS, MODO_ETIQUETAS, ETAPA_ETIQUETAS, ETAPA_ABREV,
  TOKEN_VACIO, TOKEN_ETAPA_ND, ETAPA_ND_ETIQUETA, NIVELES_OCUPACION,
  variedadDeLote, tokenVariedad, tokenEtapa, tokenBanda, nivelOcupacion, fechaCorta,
  cadenasRecorrido,
} from './plan.js';

// Clock time of the last good read, in the browser's own zone: this is "a
// moment ago in this session", not a business date, so Date is the right tool
// here (unlike a movement's `fecha`, see plan.fechaCorta).
function horaCorta(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function litros(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  if (v > 0 && v < 1) return '<1';
  return Math.round(v).toLocaleString('es-MX');
}

const TIPO_ETIQUETA = {
  TQ: 'Acero inoxidable',
  TIBOR: 'Tibor',
  DOMECQ: 'Tanque Domecq',
  KEG: 'Keg',
};

// Spanish plurals for the tray, written out rather than suffixed: 'Tibor' + 's'
// is not a word and 'Tanque Domecq' pluralizes on the first noun.
const TIPO_PLURAL = {
  TQ: 'Tanques',
  TIBOR: 'Tibores',
  DOMECQ: 'Tanques Domecq',
  KEG: 'Kegs',
};

const AREA_ETIQUETA = {
  fermentacion: 'Sala de fermentación',
  recepcion: 'Área de recepción y molienda',
  otras: 'Ubicación por definir',
};

// Spanish movement-type labels. Keyed off estado.js TIPOS so a type added to
// the log without a label here is shown verbatim instead of disappearing.
const TIPO_MOVIMIENTO = {
  recepcion: 'Recepción',
  trasiego: 'Trasiego',
  descube: 'Descube',
  sangrado: 'Sangrado',
  prensa: 'Prensa',
  ensamble: 'Ensamble',
  salida: 'Salida',
};

function etiquetaMovimiento(tipo) {
  const t = typeof tipo === 'string' ? tipo.trim() : '';
  if (TIPOS.includes(t)) return TIPO_MOVIMIENTO[t] || t;
  return t || 'Movimiento';
}

// `style="fill:var(--x)"` rather than `fill="var(--x)"`: a presentation
// attribute is not a reliable place for a custom property, and an inline style
// attribute is allowed by the CSP (style-src 'unsafe-inline').
const relleno = (token) => `style="fill:var(${token})"`;

// The movement log is shared: another lab session can append a trasiego while
// this tab is open, so a successful read is reused for a short while and then
// revalidated on the next mount. The revalidation keeps the current plan on
// screen; only an outright first failure leaves the tab empty.
const FRESCURA_MS = 15_000;
// A failed read is retried the next time the tab is mounted, but not on every
// App.refresh(): several of those fire in a row while the dashboard boots.
const REINTENTO_MS = 10_000;

export const TanquesView = {
  modo: 'variedad',
  seleccion: null,
  busqueda: '',
  _cargado: false,
  _cargando: false,
  _fallo: false,
  _ultimoIntento: 0,
  _ultimoExito: 0,
  _wired: false,

  /** Called by App.refresh() every time the tab is shown. Idempotent. */
  mount() {
    this._wire();
    this._quizaCargar();
    this.render();
  },

  // No state is terminal, so the decision is taken on each mount rather than
  // once: a read that failed while the network was down must load when the user
  // comes back to the tab, leaving demo mode must load the bodega that demo
  // mode refused to fetch, and a read that succeeded a while ago must be
  // revalidated because the log is shared with other sessions.
  _quizaCargar() {
    if (this._cargando) return;
    // DataStore refuses the read while the demo overlay owns the data layer.
    if (DemoMode.isActive()) return;
    const ahora = Date.now();
    if (this._fallo && ahora - this._ultimoIntento < REINTENTO_MS) return;
    if (this._cargado && ahora - this._ultimoExito < FRESCURA_MS) return;
    this._cargando = true;
    this._ultimoIntento = ahora;
    DataStore.loadTanques().then((ok) => {
      this._cargando = false;
      if (ok) {
        this._cargado = true;
        this._fallo = false;
        this._ultimoExito = Date.now();
      } else {
        // A read superseded by demo mode turning on mid-flight is not a failure.
        this._fallo = !DemoMode.isActive();
      }
      this.render();
    }).catch(() => {
      this._cargando = false;
      this._fallo = !DemoMode.isActive();
      this.render();
    });
  },

  _wire() {
    if (this._wired) return;
    const seg = document.getElementById('tanques-modos');
    if (seg) {
      seg.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-modo]');
        if (!btn || !MODOS.includes(btn.dataset.modo)) return;
        this.modo = btn.dataset.modo;
        this.render();
      });
    }
    const buscar = document.getElementById('tanques-buscar');
    if (buscar) {
      buscar.addEventListener('input', (e) => {
        this.busqueda = String(e.target.value || '').trim().toLowerCase();
        this._saltarAlPrimerResultado();
        this.render();
      });
    }
    const plano = document.getElementById('tanques-plano');
    if (plano) {
      plano.addEventListener('click', (e) => {
        const g = e.target.closest('[data-tanque]');
        if (!g) return;
        this.seleccion = g.dataset.tanque;
        this.render();
      });
      plano.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const g = e.target.closest('[data-tanque]');
        if (!g) return;
        e.preventDefault();
        this.seleccion = g.dataset.tanque;
        this.render();
      });
    }
    const irAVasija = (e) => {
      const ir = e.target.closest('[data-ir-tanque]');
      if (!ir) return;
      this.seleccion = ir.dataset.irTanque;
      this.render();
    };
    const panel = document.getElementById('tanques-panel');
    if (panel) panel.addEventListener('click', irAVasija);
    const bandeja = document.getElementById('tanques-otras');
    if (bandeja) bandeja.addEventListener('click', irAVasija);
    this._wired = true;
  },

  // --- data ------------------------------------------------------------------

  _bodega() {
    const catalogo = Array.isArray(DataStore.tanquesCatalogo) ? DataStore.tanquesCatalogo : [];
    const movimientos = Array.isArray(DataStore.movimientosTanque) ? DataStore.movimientosTanque : [];
    const sinonimos = DataStore.tanquesSinonimos || {};
    const { estado, avisos } = replayMovimientos(catalogo, movimientos, { sinonimos });
    const plan = construirPlano(catalogo, { direccion: POSICION_1_AL });
    return { catalogo, movimientos, sinonimos, estado, avisos, plan };
  },

  _coincide(t, estadoTanque) {
    if (!this.busqueda) return true;
    const q = this.busqueda;
    if (t.codigo.toLowerCase().includes(q)) return true;
    const partes = estadoTanque?.partes || [];
    return partes.some((p) => String(p.lot_code || '').toLowerCase().includes(q));
  },

  _saltarAlPrimerResultado() {
    if (!this.busqueda) return;
    const { estado, plan } = this._bodega();
    // The tray counts too: a lote can be in a vessel the plan cannot draw.
    const hit = [...plan.ubicados, ...plan.otras]
      .find((t) => this._coincide(t, estado[t.codigo]));
    if (hit) this.seleccion = hit.codigo;
  },

  // --- render ----------------------------------------------------------------

  render() {
    const planoEl = document.getElementById('tanques-plano');
    const panelEl = document.getElementById('tanques-panel');
    const estadoEl = document.getElementById('tanques-estado');
    if (!planoEl || !panelEl) return;

    const { estado, avisos, plan, catalogo, movimientos, sinonimos } = this._bodega();

    document.querySelectorAll('#tanques-modos button[data-modo]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.modo === this.modo));
    });

    if (estadoEl) estadoEl.innerHTML = this._avisoCarga(catalogo, movimientos);

    if (!plan.ubicados.length && !plan.otras.length) {
      planoEl.innerHTML = '';
      planoEl.setAttribute('viewBox', '0 0 1 1');
      panelEl.innerHTML = '<p class="tanques-hint">Sin catálogo de tanques que mostrar.</p>';
      this._pintarLeyenda(estado, plan);
      this._pintarBandeja(plan, estado);
      this._pintarAvisos(avisos);
      return;
    }

    // A lote can sit in a vessel the plan cannot draw (a CAVA tank, a tibor),
    // and its route then names that vessel. The SELECTION is therefore over the
    // whole catalog; only the highlight on the floor is limited to the plan.
    if (!this.seleccion || !this._vasija(plan, this.seleccion)) {
      const todas = [...plan.ubicados, ...plan.otras];
      const conVino = todas.find((t) => (estado[t.codigo]?.litros || 0) > 0);
      this.seleccion = (conVino || todas[0]).codigo;
    }

    const foco = this._claveFoco();
    planoEl.setAttribute('viewBox', `0 0 ${plan.ancho} ${plan.alto}`);
    planoEl.innerHTML = this._svgPlano(plan, estado);
    panelEl.innerHTML = this._htmlPanel(plan, estado, catalogo, movimientos, sinonimos);
    this._pintarLeyenda(estado, plan);
    this._pintarBandeja(plan, estado);
    this._pintarAvisos(avisos);
    this._restaurarFoco(foco);
  },

  _vasija(plan, codigo) {
    return plan.ubicados.find((t) => t.codigo === codigo)
      || plan.otras.find((t) => t.codigo === codigo)
      || null;
  },

  // render() replaces the plan and the panel through innerHTML, which throws
  // away the focused node. Without this a keyboard user who presses Enter on a
  // tank loses their place and has to Tab in from the top of the document
  // again. preventScroll because the focused element is already where the user
  // put it; re-focusing must not yank the plan's horizontal scroll.
  _claveFoco() {
    const el = document.activeElement;
    const d = el && el.dataset;
    if (!d) return null;
    // Only for a KEYBOARD user. A mouse click also focuses the tank's <g>, and
    // restoring that focus after the re-render draws a focus ring around the
    // tank the user just clicked, on top of the gold selected lid.
    if (typeof el.matches !== 'function' || !el.matches(':focus-visible')) return null;
    if (d.tanque) return { attr: 'data-tanque', valor: d.tanque };
    if (d.irTanque) return { attr: 'data-ir-tanque', valor: d.irTanque };
    return null;
  },

  _restaurarFoco(foco) {
    if (!foco) return;
    const sel = `[${foco.attr}="${CSS.escape(foco.valor)}"]`;
    const el = document.querySelector(`#tanques-panel ${sel}, #tanques-otras ${sel}, #tanques-plano ${sel}`)
      || document.querySelector(`#tanques-plano [data-tanque="${CSS.escape(foco.valor)}"]`);
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  },

  _avisoCarga(catalogo, movimientos) {
    if (DemoMode.isActive()) {
      return '<div class="tanques-alert">El modo demostración no incluye movimientos de tanque. '
        + 'Desactívelo para ver la bodega real.</div>';
    }
    if (this._cargando && !catalogo.length) {
      return '<p class="tanques-hint">Cargando el catálogo y la bitácora de tanques…</p>';
    }
    if (this._fallo) {
      // With a previous read on screen the failure is a stale view, not an
      // empty one, and saying "no se pudo leer" over a full plan would lie.
      return this._cargado
        ? '<div class="tanques-alert">No se pudo actualizar la bodega; se muestra la última lectura '
          + `del ${escapeHtml(horaCorta(this._ultimoExito))}.</div>`
        : '<div class="tanques-alert err">No se pudo leer la bodega. '
          + 'Revise su sesión; se reintenta al volver a abrir la pestaña.</div>';
    }
    if (DataStore.tanquesDesactualizado) {
      return '<div class="tanques-alert">Se registró el movimiento, pero no se pudo actualizar la vista.</div>';
    }
    if (this._cargado && catalogo.length && !movimientos.length) {
      return '<p class="tanques-hint">La bitácora de movimientos está vacía, '
        + 'así que todos los tanques se muestran vacíos.</p>';
    }
    return '';
  },

  // --- plan ------------------------------------------------------------------

  _svgPlano(plan, estado) {
    const G = GEOMETRIA;
    const W = plan.ancho, H = plan.alto;
    const yDe = {};
    for (const f of plan.filas) yDe[f.letra] = f.y;
    const piso = (letra, alterno) => (yDe[letra] ?? yDe[alterno] ?? plan.filas[0]?.y ?? 0);

    const etiqueta = (x, y, texto, fs = 9, ls = 3) =>
      `<text x="${x}" y="${y}" style="fill:var(--tank-path-text)" font-size="${fs}"`
      + ` letter-spacing="${ls}" text-anchor="middle">${escapeHtml(texto)}</text>`;

    let s = `<rect x="0" y="0" width="${W}" height="${H}" rx="6" ${relleno('--tank-floor')}/>`;
    // Service walkway along the north, exterior walkway along the south.
    s += `<rect x="8" y="6" width="${W - 16}" height="${G.PASILLO_H - 4}" rx="3" ${relleno('--tank-path')}/>`
      + etiqueta(W / 2, 20, 'PASILLO DE SERVICIO');
    s += `<rect x="8" y="${H - 26}" width="${W - 16}" height="20" rx="3" ${relleno('--tank-path')}/>`
      + etiqueta(W / 2, H - 12, 'PASILLO EXTERIOR');

    // Reception and crushing strip on the west, with the R/PD tanks and presses.
    const yA = piso('A'), yB = piso('B', 'A'), yD = piso('D', 'A');
    const yE = piso('E', 'D'), yG = piso('G', 'A'), yH = piso('H', 'G');
    s += `<rect x="10" y="${G.PASILLO_H + 10}" width="${G.REC_W}" height="${H - G.PASILLO_H - 42}"`
      + ` fill="none" stroke="var(--border-gold)" stroke-dasharray="5 4" rx="4"/>`;
    s += `<rect x="20" y="${yA - G.H_MAX - 20}" width="${G.REC_W - 20}"`
      + ` height="${yB - yA + G.H_MAX + 44}" rx="3" opacity="0.6" ${relleno('--tank-path')}/>`;
    s += etiqueta(10 + G.REC_W / 2, yA - G.H_MAX - 26, 'TANQUES R / PD', 8, 2);
    s += etiqueta(10 + G.REC_W / 2, (yD + yE) / 2, 'ÁREA DE RECEPCIÓN', 9, 2)
      + etiqueta(10 + G.REC_W / 2, (yD + yE) / 2 + 14, 'Y MOLIENDA', 9, 2);
    s += `<rect x="30" y="${yG - 40}" width="70" height="${yH - yG + 40}" rx="3"`
      + ` stroke="var(--border)" ${relleno('--tank-path')}/>`
      + etiqueta(65, (yG + yH) / 2 - 16, 'PRENSAS', 8, 2);

    // Inner walkways between row groups carry no text label (spec).
    for (const py of plan.pasillos) {
      s += `<rect x="${G.X0 - 30}" y="${py + 9}" width="${W - G.X0 + 22}"`
        + ` height="${G.PASILLO_H - 12}" rx="3" ${relleno('--tank-path')}/>`;
    }
    for (const f of plan.filas) {
      s += `<text x="${G.X0 - 38}" y="${f.y - 10}" style="fill:var(--gold)" font-size="14"`
        + ` font-weight="700" text-anchor="middle" font-family="var(--font-display)">${escapeHtml(f.letra)}</text>`;
    }
    // Anchored inside the right margin: with letter-spacing a centred label at
    // W - MARGEN_DER would spill past the viewBox and be clipped.
    s += etiqueta(W - 44, G.PASILLO_H + 18, 'LAB / CALIDAD', 7, 1)
      + etiqueta(W - 44, G.PASILLO_H + 28, 'AL ESTE', 7, 1);

    // North to south, west to east: a taller tank drawn later must overlap the
    // one behind it, never the other way round.
    const orden = [...plan.ubicados].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const t of orden) s += this._svgTanque(t, estado[t.codigo]);
    return s;
  },

  _svgTanque(t, est) {
    const G = GEOMETRIA;
    const { x, y } = t;
    const h = t.altura;
    const tapa = y - h;
    const cap = t.capacidad_l;
    const v = est?.litros || 0;
    const partes = est?.partes || [];
    const f = cap > 0 ? Math.min(1, v / cap) : 0;

    const clases = ['tanque'];
    if (t.codigo === this.seleccion) clases.push('sel');
    if (!this._coincide(t, est)) clases.push('dim');
    if (!t.activo) clases.push('inactivo');

    const lotes = partes.map((p) => p.lot_code).join(' y ');
    const aria = `Tanque ${t.codigo}, ${litros(cap)} litros, `
      + (v > 0 ? `${litros(v)} litros de ${lotes}` : 'vacío')
      + (t.activo ? '' : ', fuera de servicio');

    let g = `<g class="${clases.join(' ')}" data-tanque="${escapeHtml(t.codigo)}" tabindex="0"`
      + ` role="button" aria-label="${escapeHtml(aria)}">`;
    g += `<ellipse cx="${x}" cy="${y + 1.5}" rx="${G.R + 1}" ry="${G.RY + 1}" ${relleno('--tank-shadow')}/>`;
    g += `<path d="M${x - G.R} ${tapa} L${x - G.R} ${y} A${G.R} ${G.RY} 0 0 0 ${x + G.R} ${y}`
      + ` L${x + G.R} ${tapa} Z" stroke="var(--tank-steel-edge)" stroke-width="0.8"`
      + ` ${relleno('--tank-steel-side')}/>`;
    if (v > 0) {
      // The liquid band is stacked bottom-up, one slice per lote of a blend, so
      // a blend reads as its composition and not as a single colour.
      let base = y;
      const alturaLiquido = h * f;
      for (const p of partes) {
        const ph = alturaLiquido * (p.litros / v);
        const yt = base - ph;
        g += `<path d="M${x - G.R + 1} ${yt} L${x - G.R + 1} ${base}`
          + ` A${G.R - 1} ${G.RY - 0.5} 0 0 0 ${x + G.R - 1} ${base}`
          + ` L${x + G.R - 1} ${yt} A${G.R - 1} ${G.RY - 0.5} 0 0 1 ${x - G.R + 1} ${yt} Z"`
          + ` opacity="0.92" ${relleno(tokenBanda(this.modo, est, p))}/>`;
        base = yt;
      }
    }
    g += `<rect x="${x + G.R * 0.35}" y="${tapa}" width="${G.R * 0.4}" height="${h}" ${relleno('--tank-gloss')}/>`;
    g += `<ellipse class="tanque-tapa" cx="${x}" cy="${tapa}" rx="${G.R}" ry="${G.RY}"`
      + ` stroke="var(--tank-steel-edge)" stroke-width="0.8" ${relleno('--tank-steel-top')}/>`;
    if (v > 0 && est?.etapa) {
      g += `<circle cx="${x + G.R - 5}" cy="${tapa - 1}" r="2.6" stroke="var(--tank-steel-edge)"`
        + ` stroke-width="0.5" ${relleno(tokenEtapa(est.etapa))}/>`;
    }
    g += `<text x="${x}" y="${tapa + 3}" text-anchor="middle" font-size="8.5" font-weight="500"`
      + ` style="fill:var(--tank-steel-edge)">${escapeHtml(t.codigo)}</text>`;
    g += `<text x="${x}" y="${y + G.RY + 9}" text-anchor="middle" font-size="7"`
      + ` style="fill:var(--tank-path-text)">${(cap / 1000).toFixed(1)}k</text>`;
    return `${g}</g>`;
  },

  // --- legend and tray -------------------------------------------------------

  _pintarLeyenda(estado, plan) {
    const el = document.getElementById('tanques-leyenda');
    if (!el) return;
    let items;
    if (this.modo === 'etapa') {
      items = ETAPAS.map((e) => [ETAPA_ETIQUETAS[e] || e, tokenEtapa(e)]);
      items.push([ETAPA_ND_ETIQUETA, TOKEN_ETAPA_ND]);
    } else if (this.modo === 'ocupacion') {
      items = NIVELES_OCUPACION.map((n) => [n.etiqueta, n.token]);
    } else {
      // Only the varieties actually in a tank: the full token palette is 18
      // entries and a legend nobody can scan is not a legend.
      const vistas = new Map();
      for (const t of plan.ubicados) {
        for (const p of (estado[t.codigo]?.partes || [])) {
          const nombre = variedadDeLote(p.lot_code);
          vistas.set(nombre || 'Sin variedad', tokenVariedad(nombre));
        }
      }
      items = [...vistas.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
    }
    items.push(['Vacío', TOKEN_VACIO]);
    el.innerHTML = items.map(([texto, token]) =>
      `<span><i style="background:var(${token})"></i>${escapeHtml(texto)}</span>`).join('');
  },

  _pintarBandeja(plan, estado) {
    const el = document.getElementById('tanques-otras');
    if (!el) return;
    // A vessel with wine in it is always listed by name; the empty remainder is
    // grouped by type so 48 tibores, Domecq tanks and kegs stay one line each.
    const conVino = [];
    const grupos = new Map();
    for (const t of plan.otras) {
      const v = estado[t.codigo]?.litros || 0;
      if (v > 0) { conVino.push([t, v]); continue; }
      const clave = t.tipo === 'TQ' ? t.codigo : (TIPO_PLURAL[t.tipo] || t.tipo || 'Otras vasijas');
      const g = grupos.get(clave) || { n: 0, cap: 0, individual: t.tipo === 'TQ' };
      g.n += 1; g.cap += t.capacidad_l;
      grupos.set(clave, g);
    }
    const chips = [];
    const boton = (codigo, interior) =>
      `<button type="button" class="tanques-chip${codigo === this.seleccion ? ' cur' : ''}"`
      + ` data-ir-tanque="${escapeHtml(codigo)}">${interior}</button>`;
    for (const [t, v] of conVino) {
      const nombre = variedadDeLote(estado[t.codigo].partes[0]?.lot_code);
      chips.push(boton(t.codigo, `<i style="width:8px;height:8px;`
        + `border-radius:var(--radius-round);background:var(${tokenVariedad(nombre)})"></i>`
        + `${escapeHtml(t.codigo)} <small>${litros(v)} de ${litros(t.capacidad_l)} L</small>`));
    }
    for (const [clave, g] of grupos) {
      const cuerpo = `${escapeHtml(g.individual ? clave : `${clave} (${g.n})`)}`
        + ` <small>${litros(g.cap)} L</small>`;
      // A group chip names several vessels, so it opens nothing; only a chip
      // that IS one vessel is a control.
      chips.push(g.individual ? boton(clave, cuerpo) : `<span class="tanques-chip">${cuerpo}</span>`);
    }
    if (plan.sinUbicar.length) {
      chips.push(`<span class="tanques-chip">Sin ubicar en el plano`
        + ` <small>${escapeHtml(plan.sinUbicar.join(', '))}</small></span>`);
    }
    el.innerHTML = chips.join('') || '<span class="tanques-hint">Sin vasijas pendientes de ubicar.</span>';
  },

  _pintarAvisos(avisos) {
    const el = document.getElementById('tanques-avisos');
    if (!el) return;
    if (!avisos.length) { el.innerHTML = ''; return; }
    const primeros = avisos.slice(0, 8);
    const resto = avisos.length - primeros.length;
    el.innerHTML = '<div class="tanques-alert">La bitácora tiene '
      + `${avisos.length} aviso${avisos.length === 1 ? '' : 's'} de consistencia.</div>`
      + '<ul class="tanques-avisos">'
      + primeros.map((a) => `<li>${escapeHtml(a.codigo)}: ${escapeHtml(a.mensaje)}</li>`).join('')
      + (resto > 0 ? `<li>y ${resto} más.</li>` : '')
      + '</ul>';
  },

  // --- panel -----------------------------------------------------------------

  _htmlPanel(plan, estado, catalogo, movimientos, sinonimos) {
    const t = this._vasija(plan, this.seleccion);
    if (!t) return '<p class="tanques-hint">Seleccione un tanque en el plano.</p>';
    const est = estado[t.codigo];
    const v = est?.litros || 0;
    const cap = t.capacidad_l;
    const partes = est?.partes || [];
    const pct = cap > 0 ? Math.round((v / cap) * 100) : 0;
    const nivel = nivelOcupacion(v, cap);

    let s = '<div class="tanques-p-head"><div>'
      + '<div class="tanques-eyebrow">Tanque</div>'
      + `<h2>${escapeHtml(t.codigo)}</h2>`
      + `<div class="tanques-p-sub">${escapeHtml(TIPO_ETIQUETA[t.tipo] || t.tipo || 'Vasija')}, `
      + `${litros(cap)} L &middot; ${escapeHtml(AREA_ETIQUETA[t.area] || '')}`
      + (t.activo ? '' : ' &middot; fuera de servicio')
      + '</div></div>'
      + `<div class="tanques-p-right"><div class="tanques-p-fill">${pct}%</div>`
      + `<div class="tanques-p-sub">${litros(v)} L</div></div></div>`;

    s += '<div class="tanques-fillbar">'
      + partes.map((p) => `<div style="width:${(p.litros / cap) * 100}%;`
        + `background:var(${tokenBanda(this.modo, est, p)})"></div>`).join('')
      + '</div>';

    const historial = historialTanque(catalogo, movimientos, t.codigo,
      { sinonimos, incluirAnulados: true });

    if (v <= 0) {
      const ultimo = [...historial].reverse().find((h) => h.aplicado && !h.anulado);
      s += '<div class="tanques-alert">Vacío'
        + (ultimo ? ` desde el ${escapeHtml(fechaCorta(ultimo.fecha))}.`
          + ` Último lote: <b>${escapeHtml(ultimo.lot_code || 'sin código')}</b>` : '.')
        + '</div>';
    } else {
      if (partes.length > 1) {
        s += '<div class="tanques-sec"><h3>Ensamble</h3><div class="tanques-comp">'
          + partes.map((p) => {
            const nombre = variedadDeLote(p.lot_code);
            return `<div style="width:${(p.litros / v) * 100}%;`
              + `background:var(${tokenVariedad(nombre)})">`
              + `${escapeHtml(p.lot_code)} ${Math.round((p.litros / v) * 100)}%</div>`;
          }).join('')
          + '</div></div>';
      }
      const variedades = [...new Set(partes.map((p) => variedadDeLote(p.lot_code) || 'Sin variedad'))];
      s += '<div class="tanques-sec"><h3>Contenido</h3><dl class="tanques-kv">'
        + `<dt>Lote</dt><dd>${escapeHtml(partes.map((p) => p.lot_code).join(' + '))}</dd>`
        // The varietal is DERIVED from the lot code, not recorded on the
        // movement, so the panel says so instead of presenting it as a fact
        // the bodega wrote down.
        + `<dt>Variedad</dt><dd>${escapeHtml(variedades.join(' + '))}`
        + '<span class="tanques-tag">del código</span></dd>'
        + `<dt>En tanque desde</dt><dd>${escapeHtml(fechaCorta(est.desde) || 'sin fecha')}</dd>`
        + `<dt>Espacio libre</dt><dd>${litros(est.libres)} L</dd>`
        + `<dt>Ocupación</dt><dd>${escapeHtml(nivel.etiqueta)}</dd>`
        + '</dl></div>';

      if (est.etapa) {
        const i = ETAPAS.indexOf(est.etapa);
        s += '<div class="tanques-sec"><h3>Etapa</h3><div class="tanques-stages">'
          + ETAPAS.map((e, k) => `<div class="${k < i ? 'on' : k === i ? 'now' : ''}"`
            + ` title="${escapeHtml(ETAPA_ETIQUETAS[e] || e)}"></div>`).join('')
          + '</div><div class="tanques-stage-labels">'
          + ETAPAS.map((e) => `<span title="${escapeHtml(ETAPA_ETIQUETAS[e] || e)}">`
            + `${escapeHtml(ETAPA_ABREV[e] || e)}</span>`).join('')
          + '</div></div>';
      }

      for (const p of partes) {
        s += this._htmlRecorrido(catalogo, movimientos, sinonimos, p.lot_code, t.codigo);
      }
    }

    s += '<div class="tanques-sec"><h3>Historial del tanque</h3>'
      + (historial.length
        ? '<ul class="tanques-timeline">'
          + [...historial].reverse().map((h) => this._htmlFilaHistorial(h, t.codigo)).join('')
          + '</ul>'
        : '<p class="tanques-hint">Sin movimientos registrados.</p>')
      + '</div>';
    return s;
  },

  _htmlFilaHistorial(h, codigo) {
    const sentido = h.direccion === 'entrada'
      ? (h.origen ? `desde ${h.origen}` : '')
      : (h.destino ? `hacia ${h.destino}` : 'salida de bodega');
    const etiquetas = [];
    if (h.fuente === 'lab') etiquetas.push('<span class="tanques-tag lab">lab</span>');
    if (h.anulado) etiquetas.push('<span class="tanques-tag">anulado</span>');
    // delta_l comes from the replay, not from volumen_l, so a row the log could
    // not honour in full (an overdraw clamped to what the tank held, an overflow)
    // shows what the tank ACTUALLY gained or lost beside what was recorded. The
    // expected delta already accounts for merma, which is subtracted from what
    // arrives: tagging every row that carries merma would be noise, not a flag.
    const esperado = h.direccion === 'entrada' ? h.volumen_l - h.merma_l : h.volumen_l;
    if (!h.anulado && h.aplicado && Math.abs(Math.abs(h.delta_l) - esperado) > 0.001) {
      etiquetas.push(`<span class="tanques-tag">aplicado ${litros(Math.abs(h.delta_l))} L</span>`);
    }
    if (!h.anulado && !h.aplicado) etiquetas.push('<span class="tanques-tag">no aplicado</span>');
    return `<li class="${h.anulado ? 'anulado' : ''}">`
      + `<time>${escapeHtml(fechaCorta(h.fecha))}</time><div>`
      + `<b>${escapeHtml(etiquetaMovimiento(h.tipo))}</b> ${escapeHtml(h.lot_code || 'sin lote')}, `
      + `${litros(h.volumen_l)} L ${escapeHtml(sentido)}${etiquetas.join('')}`
      + (h.merma_l > 0 ? `<div class="tanques-p-sub">Merma ${litros(h.merma_l)} L</div>` : '')
      + (h.nota ? `<div class="tanques-p-sub">${escapeHtml(h.nota)}</div>` : '')
      + '</div></li>';
  },

  _htmlRecorrido(catalogo, movimientos, sinonimos, lot_code, actual) {
    if (!lot_code) return '';
    const r = recorridoLote(catalogo, movimientos, lot_code, { sinonimos });
    const cadenas = cadenasRecorrido(r.pasos);
    if (!cadenas.length) return '';
    const sep = '<span class="tanques-route-sep"></span>';
    const filas = cadenas.map((c) => '<div class="tanques-route">'
      + (c.entrada ? `<span class="tanques-tag">recepción</span>${c.codigos.length ? sep : ''}` : '')
      + c.codigos.map((codigo, i) => (i ? sep : '')
        + `<button type="button" class="tanques-route-stop${codigo === actual ? ' cur' : ''}"`
        + ` data-ir-tanque="${escapeHtml(codigo)}">${escapeHtml(codigo)}</button>`).join('')
      + (c.salida ? `${sep}<span class="tanques-tag">salida</span>` : '')
      + '</div>').join('');
    return '<div class="tanques-sec">'
      + `<h3>Recorrido del lote ${escapeHtml(lot_code)}</h3>${filas}`
      + `<div class="tanques-p-sub">Recibido ${litros(r.litros_recibidos)} L &middot; `
      + `merma ${litros(r.litros_merma)} L &middot; en tanques ${litros(r.litros_actuales)} L`
      + (r.litros_salidos > 0 ? ` &middot; salió ${litros(r.litros_salidos)} L` : '')
      + '</div></div>';
  },
};
