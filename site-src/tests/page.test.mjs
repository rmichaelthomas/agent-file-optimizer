import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OUT_DIR, REPO_ROOT } from '../tools/lib/paths.mjs';

const html = readFileSync(path.join(OUT_DIR, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body'));
const count = (pattern, text = html) => (text.match(pattern) ?? []).length;

test('the page has one h1, one main, a language, and a viewport', () => {
  assert.equal(count(/<h1[\s>]/g), 1);
  assert.equal(count(/<main[\s>]/g), 1);
  assert.match(html, /<html lang="en"/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('the skip link is the first thing in the tab order and targets main', () => {
  assert.match(body, /^<body[^>]*>\s*<a class="skip" href="#main">/);
  assert.ok(html.includes('<main id="main">'));
});

test('every navigation landmark and every section with a heading is labelled', () => {
  for (const nav of html.matchAll(/<nav\b[^>]*>/g)) assert.match(nav[0], /aria-label="[^"]+"/);
  for (const section of html.matchAll(/<section\b[^>]*\bid="[^"]+"[^>]*>/g)) assert.match(section[0], /aria-labelledby="[^"]+"/);
});

test('there are no duplicate ids, and every aria-labelledby points at one', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), []);
  for (const [, value] of html.matchAll(/aria-labelledby="([^"]+)"/g)) for (const id of value.split(' ')) assert.ok(ids.includes(id), `aria-labelledby points at missing id ${id}`);
});

test('every disclosure has a summary, and every scrolling code block can be reached by keyboard', () => {
  for (const details of html.matchAll(/<details\b[\s\S]*?<\/details>/g)) assert.match(details[0], /<summary>/);
  for (const pre of html.matchAll(/<pre\b[^>]*>/g)) assert.match(pre[0], /tabindex="0"/);
});

test('every link has text, and every table has a caption and column headers', () => {
  for (const anchor of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) assert.ok(anchor[1].replace(/<[^>]+>/g, '').trim() !== '', anchor[0]);
  for (const table of html.matchAll(/<table\b[\s\S]*?<\/table>/g)) {
    assert.match(table[0], /<caption>/);
    assert.match(table[0], /<th scope="col">/);
  }
});

test('each instrument declares the element it is, and the page uses no more than the registry names', () => {
  const marks = [...html.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-ahi="([^"]+)"[^>]*\bdata-ahi-element="([^"]+)"/g)];
  assert.ok(marks.length >= 20);
  for (const [, tag, id, element] of marks) assert.equal(tag, element, `${id} is a <${tag}>, its contract says ${element}`);
  const ids = new Set(marks.map((mark) => mark[2]));
  assert.ok(ids.size >= 13, `only ${ids.size} instruments`);
  const catalog = path.join(path.dirname(REPO_ROOT), 'allherehtml', 'instruments', 'registry', 'catalog.json');
  if (existsSync(catalog)) {
    const known = new Set(JSON.parse(readFileSync(catalog, 'utf8')).instruments.map((entry) => entry.id));
    for (const id of ids) assert.ok(known.has(id), `${id} is not in the AllHereHTML catalog`);
  }
});

test('no fixed instrument label or filler text leaks into the page', () => {
  for (const phrase of ['Another part of the story appears here', 'Start / Then / Next', 'Here / There', 'Before / During', 'Lorem ipsum', 'TODO', 'undefined', '[object']) assert.ok(!html.includes(phrase), phrase);
});

test('AllHereHTML is credited in the footer only, in one plain line', () => {
  const mentions = [...html.matchAll(/AllHere/g)].length;
  const visible = html.replace(/<[^>]+>/g, ' ').match(/AllHere\w*/g) ?? [];
  assert.deepEqual(visible, ['AllHereHTML']);
  assert.match(html, /Page made with AllHereHTML\./);
  assert.equal(mentions, 1, 'AllHere is named once, in the footer');
});

test('the page states its own weight and promises no scripts, and the claim is true', () => {
  assert.match(html, /This page is \d+ KB in all\. It runs no scripts and makes no requests to other sites\./);
  assert.equal(count(/<script\b(?![^>]*application\/ld\+json)/g), 0);
  assert.equal(count(/\b(?:src|href)="https?:\/\/[^"]*"/g, body.replace(/<a\b[^>]*>/g, '')), 0);
});
