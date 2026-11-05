// js/tanques/etiqueta.js - the text drawn under each tank on the bodega plan
// (xd-3c2.1). Pure, no DOM, no imports: tests/mt62-tanques-etiqueta.test.mjs.
//
// The label is the wine (lote) code the tank holds, not its capacity: the
// largest parte by litres, with '+N' for the other lotes of a blend. An empty
// tank gets no label. The full list of codes lives in the tank's aria label and
// the side panel; this text only has to fit under a 34-unit-wide tank.

// Characters of lote code drawn before the ellipsis (the '+N' suffix is extra).
export const ETIQUETA_MAX = 10;

function recortar(codigo) {
  const s = String(codigo ?? '');
  return s.length > ETIQUETA_MAX ? `${s.slice(0, ETIQUETA_MAX - 1)}…` : s;
}

export function etiquetaTanque(partes) {
  const llenas = (partes || []).filter((p) => p && Number(p.litros) > 0);
  if (!llenas.length) return '';
  let mayor = llenas[0];
  for (const p of llenas) if (Number(p.litros) > Number(mayor.litros)) mayor = p;
  const resto = llenas.length - 1;
  return recortar(mayor.lot_code) + (resto > 0 ? ` +${resto}` : '');
}
