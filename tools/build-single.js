#!/usr/bin/env node
/* Bundles the app into one self-contained HTML file (dist/sudoku.html)
 * that runs offline straight from the file system or an Android WebView. */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let html = read('index.html');
const svg = read('icons/icon.svg');
html = html
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`)
  .replace(/<link rel="stylesheet" href="([^"]+)">/, (m, f) => `<style>\n${read(f)}</style>`)
  .replace(/<script src="([^"]+)"><\/script>/g, (m, f) => `<script>\n${read(f).replace(/<\/script/gi, '<\\/script')}</script>`);

const out = process.argv[2] || path.join(root, 'dist', 'sudoku.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);
