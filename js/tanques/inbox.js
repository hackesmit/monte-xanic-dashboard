// js/tanques/inbox.js - the Tanques inbox: trasiegos the lab's samples propose,
// confirmed or dismissed by a person.
//
// Bead xd-qrn.6. js/tanques/inferencia.js decides WHICH movements the samples
// name (and which they refuse to name); this file draws them and routes the two
// answers:
//
//   Confirmar  opens the xd-qrn.5 move dialog (TanquesMoves.abrir) prefilled
//              with the proposal and fuente 'lab'. It is NOT a second write
//              path: every duplicate-protection mechanism that bead built (the
//              client_id written down before the request leaves, the pending
//              banner, the twin check, the stale-view refusal) applies to a
//              confirmed proposal unchanged, and a POST of our own here would
//              have none of it.
//   Descartar  DataStore.descartarPropuesta, which remembers the "no" server
//              side so the proposal does not come back on the next reload.
//              It asks first, because the API offers no undo.
//
// Like js/tanques/moves.js this module draws its own chrome and only for a user
// who may write, so index.html needs no markup for it and a viewer has no write
// control in the DOM at all. It restates no tank semantics: whether a proposal
// can actually be recorded is answered by planearMovimiento, the same planner
// the dialog uses, so the inbox and the dialog cannot disagree.

import { DataStore } from '../dataLoader.js';
import { escapeHtml } from '../utils.js';
import { TanquesMoves, planearMovimiento, etiquetaMovimiento } from './moves.js';
import { inferirMovimientos } from './inferencia.js';
import { fechaCorta, variedadDeLote, tokenVariedad } from './plan.js';

const ID = {
  caja: 'tanques-inbox',
  lista: 'tanques-inbox-lista',
};

// How many proposals are drawn in full before the rest becomes a count. The
// tab's search box filters the list, so the remainder stays reachable; the cap
// also bounds the work, because each visible proposal costs one replay of the
// log through planearMovimiento.
const VISIBLES = 8;
// How many entries each of the two "could not be read" lists shows before it
// becomes a count. These are diagnostics, not work.
const DIAGNOSTICO_MAX = 12;

const texto = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

const fmtL = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return (Math.round(v * 10) / 10).toLocaleString('es-MX');
};

const dia = (f) => fechaCorta(f) || texto(f);

// Why a stretch of a lote's route got no proposal. The inference decides this
// (js/tanques/inferencia.js); the inbox only says it in Spanish.
const MOTIVO = {
  simultaneo: (t) => `${t.a} y ${t.b} a la vez (una división, una mezcla, o un tanque mal escrito)`,
  mismo_dia: (t) => `${t.a} y ${t.b} el mismo día, sin nada que diga cuál fue primero`,
  sin_tanque_en_medio: (t) => `entre ${t.a} y ${t.b} solo hay muestras de una vasija `
    + 'que el catálogo no tiene',
};

export const TanquesInbox = {
  _ctx: null,
  _todas: false,           // the user asked to see past the cap
  _confirmarDescarte: null, // the clave whose Descartar is waiting for a yes
  _ocupado: false,          // a dismissal is in flight
  _wired: false,

  /** Called by TanquesView.mount(). Idempotent. */
  mount(ctx) {
    if (ctx) this._ctx = ctx;
    if (!this._ctx || typeof document === 'undefined') return;
    this._wire();
  },

  /**
   * Called at the end of every TanquesView.render(). `bodega` is the replay the
   * render already paid for; without it this would be a third one per repaint.
   */
  pintar(bodega) {
    if (!this._ctx) return;
    const tarjeta = document.querySelector('#view-tanques .tanques-plan-card');
    const previo = document.getElementById(ID.caja);
    // The role can change under an open tab (the session is re-read and is no
    // longer lab), and demo mode owns the data layer. Either way every control
    // here leaves the DOM rather than sitting there refusing.
    if (!tarjeta || !TanquesMoves.puedeEscribir()) {
      if (previo) previo.remove();
      this._confirmarDescarte = null;
      return;
    }
    const caja = previo || document.createElement('section');
    if (!previo) {
      caja.id = ID.caja;
      caja.className = 'tanques-tray tanques-inbox';
      caja.setAttribute('aria-label', 'Trasiegos propuestos por el laboratorio');
      tarjeta.appendChild(caja);
    }
    caja.innerHTML = this._html(bodega || this._ctx.bodega());
  },

  // --- data ------------------------------------------------------------------

  // The whole inference, over the bodega the view already derived. The samples
  // are DataStore.wineRecepcion, the same rows the rest of the dashboard reads.
  _inferir(bodega) {
    const b = bodega || this._ctx.bodega();
    return {
      bodega: b,
      out: inferirMovimientos(DataStore.wineRecepcion, b, {
        descartadas: DataStore.tanquesDescartadas || [],
      }),
    };
  },

  // --- render ----------------------------------------------------------------

  _html(entrada) {
    const { bodega, out } = this._inferir(entrada);
    const q = (this._ctx.busqueda && this._ctx.busqueda()) || '';
    const todas = out.propuestas;
    const lista = q
      ? todas.filter((p) => p.lot_code.toLowerCase().includes(q)
        || p.origen.toLowerCase().includes(q) || p.destino.toLowerCase().includes(q))
      : todas;

    let s = '<h3>Trasiegos propuestos por el laboratorio</h3>';

    if (!todas.length) {
      s += '<p class="tanques-hint">Las muestras no proponen ningún trasiego que falte en la '
        + 'bitácora. Un cambio de tanque entre dos muestras del mismo lote aparece aquí.</p>';
      return s + this._htmlDiagnostico(out);
    }

    s += `<p class="tanques-hint">${todas.length === 1 ? 'Una propuesta' : `${todas.length} propuestas`}`
      + ', de los cambios de <code>vessel_id</code> en las muestras de WineXRay. '
      + 'Confirmar abre el formulario de registro con el movimiento ya puesto; '
      + 'el volumen es una propuesta, no una medición. En orden de fecha, porque un '
      + 'trasiego no se puede registrar antes del que llenó su tanque origen.</p>';

    // The log is empty, so every origin is empty too and nothing here can be
    // confirmed yet. Said once, at the top, instead of eight times over.
    if (!(bodega.movimientos || []).some((m) => m && !m.anulado)) {
      s += '<div class="tanques-alert">La bitácora de movimientos está vacía, así que todos los '
        + 'tanques origen están vacíos. Asigne primero cada lote a su tanque en «Lotes sin tanque» '
        + 'y después confirme los trasiegos.</div>';
    }

    if (!lista.length) {
      s += '<p class="tanques-hint">Ninguna propuesta coincide con la búsqueda.</p>';
      return s + this._htmlDiagnostico(out);
    }

    const visibles = this._todas ? lista : lista.slice(0, VISIBLES);
    const resto = lista.length - visibles.length;
    s += `<div class="tanques-props" id="${ID.lista}">`
      + visibles.map((p) => this._htmlPropuesta(p, bodega)).join('')
      + '</div>';
    if (resto > 0) {
      s += `<div class="tanques-acciones"><button type="button" class="tanques-btn" data-inbox="todas">`
        + `Ver las ${resto} restantes</button></div>`;
    } else if (this._todas && lista.length > VISIBLES) {
      s += '<div class="tanques-acciones"><button type="button" class="tanques-btn" data-inbox="menos">'
        + `Ver solo las ${VISIBLES} primeras</button></div>`;
    }
    return s + this._htmlDiagnostico(out);
  },

  _htmlPropuesta(p, bodega) {
    // The same planner the dialog opens with, at the proposal's own date: what
    // the origin held THEN bounds the volume, and its own avisos are the reason
    // a confirmation would fail. Nothing about a tank is decided here.
    const modelo = planearMovimiento(
      { origen: p.origen, destino: p.destino, fecha: p.fecha, fuente: 'lab' }, bodega);
    const clave = escapeHtml(p.clave);
    const variedad = variedadDeLote(p.lot_code);

    let s = '<div class="tanques-prop">';
    s += '<div class="tanques-prop-cab">'
      + `<i style="background:var(${tokenVariedad(variedad)})"></i>`
      + `<b>${escapeHtml(p.lot_code)}</b>`
      + `<span class="tanques-prop-ruta">${escapeHtml(p.origen)} a ${escapeHtml(p.destino)}</span>`
      + `<span class="tanques-p-sub">${escapeHtml(dia(p.fecha))}</span>`
      + '</div>';
    // The evidence, in the lab's own terms, so a user can judge the proposal
    // without leaving the tab: how many samples in each vessel and until when.
    s += `<div class="tanques-p-sub">${p.muestras_origen} `
      + `${p.muestras_origen === 1 ? 'muestra' : 'muestras'} en ${escapeHtml(p.origen)} `
      + `hasta el ${escapeHtml(dia(p.origen_hasta))}; ${p.muestras_destino} `
      + `${p.muestras_destino === 1 ? 'muestra' : 'muestras'} en ${escapeHtml(p.destino)} `
      + `desde el ${escapeHtml(dia(p.fecha))}.</div>`;

    // What the log says about the origin at that date. A disagreement with the
    // lote the samples name is the most important thing on this card: recording
    // the movement would move whatever the origin really holds, under that
    // lote's name, not under the one the lab wrote down.
    const errores = modelo.avisos.filter((a) => a.nivel === 'error');
    // Confirmar stays ENABLED when the planner refuses: the dialog is where the
    // date can be moved, and an empty origin on the proposal's day often means
    // the trasiego really happened on another one. It stops being the primary
    // action, though, so the card does not urge a click that will not land.
    const listo = !errores.length;
    if (errores.length) {
      s += `<div class="tanques-alert err">${escapeHtml(errores[0].texto)}</div>`;
    } else {
      if (modelo.lot_code && modelo.lot_code !== p.lot_code) {
        s += '<div class="tanques-alert err">La bitácora dice que '
          + `${escapeHtml(p.origen)} tiene ${escapeHtml(modelo.lot_code)}, no `
          + `${escapeHtml(p.lot_code)}. Revise antes de registrar.</div>`;
      }
      s += `<div class="tanques-p-sub">${escapeHtml(p.origen)} tenía `
        + `${fmtL(modelo.disponible_l)} L el ${escapeHtml(dia(p.fecha))}`
        + (modelo.tipo !== 'trasiego'
          ? `; se registraría como ${escapeHtml(etiquetaMovimiento(modelo.tipo).toLowerCase())}`
          : '')
        + '.</div>';
    }

    if (this._confirmarDescarte === p.clave) {
      s += '<div class="tanques-anular-confirma" role="alert">'
        + '<span>¿Descartar esta propuesta? No se puede deshacer.</span>'
        + `<button type="button" class="tanques-anular" data-inbox="descartar-si" data-clave="${clave}">`
        + 'Sí, descartar</button>'
        + '<button type="button" class="tanques-anular" data-inbox="descartar-no">No</button>'
        + '</div>';
    } else {
      const etiqueta = `${p.lot_code}, ${p.origen} a ${p.destino}, ${dia(p.fecha)}`;
      s += '<div class="tanques-acciones">'
        + `<button type="button" class="tanques-btn${listo ? ' primary' : ''}" data-inbox="confirmar"`
        + ` data-clave="${clave}" aria-label="${escapeHtml(`Confirmar: ${etiqueta}`)}">`
        + 'Confirmar</button>'
        + '<button type="button" class="tanques-btn" data-inbox="descartar"'
        + ` data-clave="${clave}" aria-label="${escapeHtml(`Descartar: ${etiqueta}`)}">`
        + 'Descartar</button>'
        + '</div>';
    }
    return s + '</div>';
  },

  // The two things the inference refuses to turn into proposals. Shown, never
  // silenced: a vessel id the catalog does not have and a lote sampled in two
  // tanks at once are both facts about the data that somebody has to fix, and
  // hiding them would make the inbox look complete when it is not.
  _htmlDiagnostico(out) {
    let s = '';
    const sin = out.sinResolver;
    if (sin.length) {
      // The coverage figure is the NEWEST vendimia's, not the whole table's: a
      // 2023 lote that moved to barrels years ago is mostly BCA, and averaging
      // it in hides how well the vintage being worked is covered (lucy,
      // 2026-10-15).
      const v = out.resumen.por_vendimia[0];
      const pct = Math.round((v ? v.fraccion : out.resumen.fraccion_sin_tanque) * 1000) / 10;
      s += '<details class="tanques-inbox-mas"><summary>'
        + `${sin.length} ${sin.length === 1 ? 'vasija' : 'vasijas'} que el catálogo no tiene `
        + (v
          ? `(vendimia ${v.vendimia}: ${v.sin_tanque} de ${v.muestras} muestras, ${pct}%)`
          : `(${out.resumen.muestras_sin_tanque} de ${out.resumen.muestras} muestras, ${pct}%)`)
        + '</summary>'
        + '<p class="tanques-hint">BIN y BCA son áreas (bins, barricas), no vasijas; el resto son '
        + 'códigos que el inventario no incluye. No se adivina ninguno, así que los lotes que pasan '
        + 'por ellos no reciben propuesta de ese tramo.</p><ul class="tanques-inbox-ul">'
        + sin.slice(0, DIAGNOSTICO_MAX).map((e) =>
          `<li><b>${escapeHtml(e.vessel_id)}</b>: ${e.muestras} `
          + `${e.muestras === 1 ? 'muestra' : 'muestras'} de ${e.lotes.length} `
          + `${e.lotes.length === 1 ? 'lote' : 'lotes'}, del ${escapeHtml(dia(e.desde))} `
          + `al ${escapeHtml(dia(e.hasta))}</li>`).join('')
        + '</ul>'
        + (sin.length > DIAGNOSTICO_MAX
          ? `<p class="tanques-hint">y ${sin.length - DIAGNOSTICO_MAX} más.</p>` : '')
        + '</details>';
    }
    const tr = out.traslapes;
    if (tr.length) {
      s += '<details class="tanques-inbox-mas"><summary>'
        + `${tr.length} ${tr.length === 1 ? 'tramo que las muestras no' : 'tramos que las muestras no'} `
        + 'convierten en movimiento</summary>'
        + '<p class="tanques-hint">Aquí las muestras no nombran un solo movimiento, y no se inventa '
        + 'uno. Revise el tanque de cada muestra en el Explorador si cree que falta un trasiego.</p>'
        + '<ul class="tanques-inbox-ul">'
        + tr.slice(0, DIAGNOSTICO_MAX).map((t) =>
          `<li><b>${escapeHtml(t.lot_code)}</b>: ${escapeHtml(MOTIVO[t.motivo] || MOTIVO.simultaneo)(t)}`
          + `, del ${escapeHtml(dia(t.desde))} al ${escapeHtml(dia(t.hasta))}</li>`).join('')
        + '</ul>'
        + (tr.length > DIAGNOSTICO_MAX
          ? `<p class="tanques-hint">y ${tr.length - DIAGNOSTICO_MAX} más.</p>` : '')
        + '</details>';
    }
    return s;
  },

  // --- wiring ---------------------------------------------------------------

  _wire() {
    if (this._wired) return;
    const vista = document.getElementById('view-tanques');
    if (!vista) return;
    vista.addEventListener('click', (e) => {
      const b = e.target.closest(`#${ID.caja} [data-inbox]`);
      if (!b) return;
      // The role can have changed since this button was drawn.
      if (!TanquesMoves.puedeEscribir()) { this._ctx.render(); return; }
      const accion = b.dataset.inbox;
      if (accion === 'todas' || accion === 'menos') {
        this._todas = accion === 'todas';
        this._ctx.render();
        return;
      }
      if (accion === 'descartar-no') {
        this._confirmarDescarte = null;
        this._ctx.render();
        return;
      }
      if (accion === 'descartar') {
        this._confirmarDescarte = texto(b.dataset.clave);
        this._ctx.render();
        return;
      }
      if (accion === 'descartar-si') {
        const clave = texto(b.dataset.clave);
        // Only the proposal the question was asked about: a re-render between
        // the question and the yes could have put another card in that place.
        if (clave && clave === this._confirmarDescarte) this._descartar(clave);
        else { this._confirmarDescarte = null; this._ctx.render(); }
        return;
      }
      if (accion === 'confirmar') this._confirmar(texto(b.dataset.clave));
    });
    // Escape backs out of the inline question exactly like "No", unless the
    // move dialog is open and owns the key.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this._confirmarDescarte == null) return;
      const dlg = document.getElementById('tanques-dialogo');
      if (dlg && dlg.open) return;
      this._confirmarDescarte = null;
      this._ctx.render();
    });
    this._wired = true;
  },

  // --- the two answers -------------------------------------------------------

  // Confirmar hands the proposal to the move dialog and stops. The proposal is
  // looked up again from the CURRENT inference rather than read off the button,
  // because another session can record the movement (or dismiss the proposal)
  // while this tab is open, and opening the dialog for a movement that is
  // already in the log is how an append-only ledger gets two rows for it.
  _confirmar(clave) {
    const { out } = this._inferir();
    const p = out.propuestas.find((x) => x.clave === clave);
    if (!p) {
      this._ctx.render();
      TanquesMoves.avisar('Esa propuesta ya no está: la bitácora o los descartes cambiaron. '
        + 'Revise la lista otra vez.');
      return;
    }
    this._confirmarDescarte = null;
    TanquesMoves.abrir({ origen: p.origen, destino: p.destino, fecha: p.fecha, fuente: 'lab' });
  },

  async _descartar(clave) {
    if (this._ocupado) return;
    this._ocupado = true;
    try {
      await DataStore.descartarPropuesta(clave);
    } catch (err) {
      TanquesMoves.avisar(err && err.message ? err.message : 'No se pudo descartar la propuesta.');
      return;
    } finally {
      this._ocupado = false;
      this._confirmarDescarte = null;
      this._ctx.render();
    }
    TanquesMoves.avisar('Propuesta descartada. No volverá a aparecer.');
  },
};
