#!/usr/bin/env node
/** Bake static advertorial.html fallback from template + default params. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderAdvertorial } from '../functions/lib/advertorial-config.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const template = readFileSync(
  join(root, 'public/advertorial.template.html'),
  'utf8',
);
const html = renderAdvertorial(template, new URLSearchParams());
writeFileSync(join(root, 'public/advertorial.html'), html, 'utf8');
console.log('Wrote public/advertorial.html (static fallback)');
