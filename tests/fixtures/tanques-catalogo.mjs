// The real tank catalog, parsed out of sql/migration_tanques.sql.
//
// The inventory workbook lives outside the repo, so that migration IS the source
// of truth for dim_tanque (see tests/mt50-tanques-schema.test.mjs). Tests that
// need the actual 121 vessels read them from here instead of restating a copy
// that would drift: a hand edit to the seed then shows up as a layout failure.
//
// Not a *.test.mjs file on purpose, so `node --test tests/*.test.mjs` does not
// run it and importing it never re-runs another suite's assertions.

import { readFileSync } from 'node:fs';

const SQL = readFileSync(new URL('../../sql/migration_tanques.sql', import.meta.url), 'utf8');

/** Split a `('A1', 'A', 1, 7400, ...)` tuple line, honouring quoted commas. */
function tuple(line) {
  const body = line.trim().replace(/^\(/, '').replace(/\),?$/, '');
  const out = [];
  let campo = '';
  let citado = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (citado) {
      if (ch === "'" && body[i + 1] === "'") { campo += "'"; i++; continue; }
      if (ch === "'") { citado = false; continue; }
      campo += ch;
      continue;
    }
    if (ch === "'") { citado = true; continue; }
    if (ch === ',') { out.push(campo.trim()); campo = ''; continue; }
    campo += ch;
  }
  out.push(campo.trim());
  return out;
}

function valuesBlock(tabla) {
  const re = new RegExp(
    `INSERT INTO public\\.${tabla} \\([^)]*\\) VALUES\\n([\\s\\S]*?)\\nON CONFLICT`
  );
  const m = SQL.match(re);
  if (!m) throw new Error(`no seed INSERT found for ${tabla}`);
  return m[1];
}

/** dim_tanque rows in the shape /api/tanques hands the client. */
export function catalogoTanques() {
  return valuesBlock('dim_tanque').split('\n').filter(Boolean).map((line) => {
    const [codigo, fila, posicion, capacidad, tipo, area, orden] = tuple(line);
    return {
      codigo,
      fila: fila === 'NULL' ? null : fila,
      posicion: posicion === 'NULL' ? null : Number(posicion),
      capacidad_l: Number(capacidad),
      tipo,
      area,
      activo: true,
      orden: Number(orden),
    };
  });
}

/** dim_tanque_sinonimo as the {alias: codigo} index the client gets. */
export function sinonimosTanques() {
  const indice = Object.create(null);
  for (const line of valuesBlock('dim_tanque_sinonimo').split('\n').filter(Boolean)) {
    const [sinonimo, codigo] = tuple(line);
    indice[sinonimo] = codigo;
  }
  return indice;
}
