// js/upload/index.js
// Static registry of parser modules. Adding a format is adding a module
// and one line here.

import { winexrayParser } from './winexray.js';
import { recepcionParser } from './recepcion.js';
import { prerecepcionParser } from './prerecepcion.js';
import { seguimientoParser } from './seguimiento.js';

export const PARSERS = {
  winexray:     winexrayParser,
  recepcion:    recepcionParser,
  prerecepcion: prerecepcionParser,
  seguimiento:  seguimientoParser,
};

// Ordered list for UI button rendering
export const PARSER_ORDER = ['winexray', 'recepcion', 'prerecepcion', 'seguimiento'];
