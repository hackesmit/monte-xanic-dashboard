// MT.50 - design system guard.
//
// Every inconsistency found in the 2026-08-28 CSS audit was introduced by a
// feature built after the original dashboard, and none of it was caught,
// because nothing checked. This test is that check: it parses the stylesheets
// and fails when a rule invents a value instead of using the token scale.
//
// Deliberate exemptions live in the ALLOW lists below, each with a reason.
// Adding to those lists is a decision; drifting without noticing is not.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['css/styles.css', 'css/mona.css'];

const sources = FILES.map((f) => ({ file: f, css: readFileSync(join(ROOT, f), 'utf8') }));
const allCss = sources.map((s) => s.css).join('\n');

// The :root block is where tokens are defined, so its own literal values are
// the definitions themselves and must not be flagged as violations.
function stripTokenBlocks(css) {
  return css
    .replace(/:root\s*\{[^}]*\}/g, '')
    .replace(/\[data-theme="[^"]*"\]\s*\{[^}]*\}/g, '');
}

// Strip comments so prose examples inside them are never parsed as CSS.
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Inside @font-face, `font-family` is the face's registration name rather than
// a lookup, so it must stay a literal. Excluded from the fallback check.
function stripFontFace(css) {
  return css.replace(/@font-face\s*\{[^}]*\}/g, '');
}

function declarations(css, prop) {
  const re = new RegExp(`(^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(css)) !== null) out.push(m[2].trim());
  return out;
}

function lineOf(css, needle, from = 0) {
  const i = css.indexOf(needle, from);
  return i === -1 ? null : css.slice(0, i).split('\n').length;
}

describe('MT.50 - design system tokens', () => {
  test('every token referenced with var() is actually defined', () => {
    const defined = new Set(
      [...allCss.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1])
    );
    // Set from JS at runtime rather than in CSS.
    const RUNTIME = new Set(['--chip-color', '--chip-bg', '--modal-scroll-y', '--tile-hue']);
    const used = new Set([...allCss.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]));

    const missing = [...used].filter((t) => !defined.has(t) && !RUNTIME.has(t));
    assert.deepEqual(
      missing,
      [],
      `var() references a token that is never defined, so its fallback silently wins ` +
        `in every theme:\n  ${missing.join('\n  ')}`
    );
  });

  test('border-radius uses the shape scale', () => {
    const SCALE = new Set(['2px', '4px', '8px', '50%', '0', '0px', 'inherit', 'initial']);
    const violations = [];

    for (const { file, css } of sources) {
      const body = stripTokenBlocks(stripComments(css));
      for (const value of declarations(body, 'border-radius')) {
        if (value.includes('var(--radius-')) continue;
        // Multi-value corners (e.g. sheet tops) are checked per corner.
        const parts = value.split(/\s+/);
        const bad = parts.filter((p) => !SCALE.has(p) && !p.startsWith('var('));
        if (bad.length) {
          violations.push(`${file}:${lineOf(css, value)} -> border-radius: ${value}`);
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `border-radius must come from --radius-sharp/base/panel/round ` +
        `(2px, 4px, 8px, 50%):\n  ${violations.join('\n  ')}`
    );
  });

  test('font-size uses the type scale', () => {
    const SCALE = new Set(['8px', '9px', '11px', '13px', '16px', '20px', '24px', '30px', '48px']);
    // Relative and keyword sizes are intentional where they appear.
    const RELATIVE = /^(inherit|initial|smaller|larger|\d*\.?\d+(em|rem|%)|0\.\d+em)$/;
    const violations = [];

    for (const { file, css } of sources) {
      const body = stripTokenBlocks(stripComments(css));
      for (const value of declarations(body, 'font-size')) {
        if (value.includes('var(--text-')) continue;
        if (RELATIVE.test(value)) continue;
        if (!SCALE.has(value)) {
          violations.push(`${file}:${lineOf(css, `font-size: ${value}`)} -> font-size: ${value}`);
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `font-size must come from the --text-* scale ` +
        `(8/9/11/13/16/20/24/30/48px):\n  ${violations.join('\n  ')}`
    );
  });

  test('font-family never ships without a fallback', () => {
    const violations = [];
    for (const { file, css } of sources) {
      const body = stripFontFace(stripComments(css));
      for (const value of declarations(body, 'font-family')) {
        if (value.startsWith('var(--font-')) continue;
        if (value === 'inherit') continue;
        // A lone generic keyword is already a complete, safe stack.
        if (/^(sans-serif|serif|monospace|system-ui|ui-monospace|cursive)$/.test(value)) continue;
        // A single quoted family with nothing after it drops to the browser
        // default (a serif) if that font fails to load.
        if (!value.includes(',')) {
          violations.push(`${file}:${lineOf(css, `font-family: ${value}`)} -> font-family: ${value}`);
        }
      }
    }
    assert.deepEqual(
      violations,
      [],
      `font-family needs a fallback stack, or use --font-display/body/mono:\n  ${violations.join('\n  ')}`
    );
  });

  test('the @font-face registration name stays a literal', () => {
    // Regression guard. Sweeping this descriptor onto var(--font-display)
    // silently un-registers the face: every rule then falls through to the
    // fallback sans and the whole dashboard loses its typeface, while every
    // other test still passes.
    const faces = [...allCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
    assert.ok(faces.length > 0, 'expected at least one @font-face block');
    for (const face of faces) {
      const decl = /font-family\s*:\s*([^;}]+)/.exec(face);
      assert.ok(decl, '@font-face block has no font-family descriptor');
      assert.ok(
        !decl[1].includes('var('),
        `@font-face font-family must be a literal name, got: ${decl[1].trim()}`
      );
    }
    // And the token must name the same family the face registers.
    const registered = /@font-face\s*\{[^}]*font-family\s*:\s*([^;}]+)/.exec(allCss)[1].trim();
    const token = /--font-display\s*:\s*([^;}]+)/.exec(allCss)[1].trim();
    assert.ok(
      token.includes(registered),
      `--font-display (${token}) does not reference the registered face (${registered})`
    );
  });

  test('transitions and animations use the motion tokens', () => {
    // Keyframe-driven one-offs (login entrance, spinners, sheet slides) are
    // choreography rather than interaction feedback, so they are exempt.
    const ALLOW = /spin|loginCardFadeIn|loginFadeIn|sheetSlide|mona-in|mona-blink|pulse|shimmer|0\.01ms/;
    const violations = [];

    for (const { file, css } of sources) {
      const body = stripComments(css);
      for (const prop of ['transition', 'animation']) {
        for (const value of declarations(body, prop)) {
          if (ALLOW.test(value)) continue;
          if (!/[0-9.]+m?s/.test(value)) continue;
          if (value.includes('var(--motion-')) continue;
          violations.push(`${file}:${lineOf(css, `${prop}: ${value}`)} -> ${prop}: ${value}`);
        }
      }
    }
    assert.deepEqual(
      violations,
      [],
      `use var(--motion-fast|base|slow) instead of a literal duration:\n  ${violations.join('\n  ')}`
    );
  });
});
