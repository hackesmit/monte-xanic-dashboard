// js/tanques/filtro.js - the stage filter of the bodega plan (xd-3c2.3).
// Pure, no DOM, no imports: tests/mt61-tanques-filtros.test.mjs.
//
// Daniel 2026-11-05: chips that light up only the tanks in crianza,
// fermentacion alcoholica or monitoreo FML. Several chips can be on at once.
// With none on, every tank is lit. With one or more on, a tank is lit only
// when its derived stage (estado.js `etapa`) is one of them; a tank with no
// stage, or an empty one, goes dark. The filter does not touch the colour
// mode, the selection or the side panel.

// The chips, in the order they are drawn. Codes are estado.js ETAPAS.
export const FILTROS_ETAPA = ['cri', 'fa', 'fml'];

export const FILTRO_ETIQUETAS = {
  cri: 'Crianza',
  fa: 'Fermentación alcohólica',
  fml: 'Monitoreo FML',
};

/** Is this tank lit? `activos` is an iterable of stage codes that are on. */
export function tanqueIluminado(est, activos) {
  const on = [...(activos || [])].filter((e) => FILTROS_ETAPA.includes(e));
  if (!on.length) return true;
  if (!est || !(Number(est.litros) > 0)) return false;
  return on.includes(est.etapa);
}

/** Turn one chip on or off; returns a new Set, ignores unknown codes. */
export function alternarFiltro(activos, etapa) {
  const s = new Set([...(activos || [])].filter((e) => FILTROS_ETAPA.includes(e)));
  if (!FILTROS_ETAPA.includes(etapa)) return s;
  if (s.has(etapa)) s.delete(etapa); else s.add(etapa);
  return s;
}
