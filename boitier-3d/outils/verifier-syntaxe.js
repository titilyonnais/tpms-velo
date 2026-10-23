// Analyseur syntaxique (sous-ensemble d'OpenSCAD) : vérifie la syntaxe,
// l'équilibre des parenthèses et les noms non définis. Usage : node scadcheck.js fichier.scad
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

// ---------- lexer ----------
const toks = [];
{
  let i = 0, line = 1;
  const push = (t, v) => toks.push({ t, v, line });
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); if (e < 0) throw new Error('commentaire /* non fermé ligne ' + line); for (let k = i; k < e; k++) if (src[k] === '\n') line++; i = e + 2; continue; }
    if (c === '"') { let j = i + 1; while (j < src.length && src[j] !== '"') { if (src[j] === '\\') j++; if (src[j] === '\n') throw new Error('chaîne non fermée ligne ' + line); j++; } push('str', src.slice(i + 1, j)); i = j + 1; continue; }
    const num = /^(\d+\.?\d*(e[+-]?\d+)?|\.\d+(e[+-]?\d+)?)/i.exec(src.slice(i, i + 40));
    if (num) { push('num', num[0]); i += num[0].length; continue; }
    const id = /^\$?[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 80));
    if (id) { push('id', id[0]); i += id[0].length; continue; }
    const ops = ['<=', '>=', '==', '!=', '&&', '||'];
    const op = ops.find(o => src.startsWith(o, i));
    if (op) { push('op', op); i += 2; continue; }
    if ('(){}[];,=+-*/%<>?:!.#^'.includes(c)) { push('op', c); i++; continue; }
    throw new Error(`caractère inattendu '${c}' ligne ${line}`);
  }
  toks.push({ t: 'eof', v: '<fin>', line });
}

// ---------- parser ----------
let p = 0;
const peek = (k = 0) => toks[p + k];
const is = (v, k = 0) => toks[p + k].v === v && toks[p + k].t !== 'str';
function expect(v) { if (!is(v)) err(`attendu '${v}', trouvé '${peek().v}'`); return toks[p++]; }
function err(m) { throw new Error(`ligne ${peek().line} : ${m}`); }
const keywords = new Set(['module', 'function', 'if', 'else', 'for', 'let', 'true', 'false', 'undef', 'each', 'intersection_for']);

const defs = { vars: new Map(), modules: new Map(), functions: new Map() };
const uses = []; // {name, line, kind, scope}
let scope = { names: new Set(), parent: null, label: 'global' };
function declare(name, line) {
  if (scope.names.has(name) && scope.label !== 'for') console.log(`AVERTISSEMENT ligne ${line} : '${name}' affecté deux fois dans la même portée (${scope.label})`);
  scope.names.add(name);
}
function pushScope(label) { scope = { names: new Set(), parent: scope, label }; }
function popScope() { scope = scope.parent; }
function useVar(name, line) { uses.push({ name, line, kind: 'var', scope }); }

function program() { while (peek().t !== 'eof') statement(); }
function statement() {
  if (is(';')) { p++; return; }
  if (is('{')) { p++; while (!is('}')) { if (peek().t === 'eof') err('accolade non fermée'); statement(); } p++; return; }
  if (is('module')) {
    p++; const n = expect_id(); defs.modules.set(n.v, n.line);
    pushScope('module ' + n.v); expect('('); params(); expect(')');
    // les affectations d'un module sont visibles dans tout son corps (OpenSCAD les remonte)
    statement(); popScope(); return;
  }
  if (is('function')) {
    p++; const n = expect_id(); defs.functions.set(n.v, n.line);
    pushScope('function ' + n.v); expect('('); params(); expect(')'); expect('='); expr(); expect(';'); popScope(); return;
  }
  if (peek().t === 'id' && is('=', 1)) { const n = toks[p]; p += 2; declare(n.v, n.line); defs.vars.set(n.v, n.line); expr(); expect(';'); return; }
  instantiation();
}
function expect_id() { if (peek().t !== 'id' || keywords.has(peek().v)) err(`nom attendu, trouvé '${peek().v}'`); return toks[p++]; }
function params() {
  if (is(')')) return;
  while (true) { const n = expect_id(); declare(n.v, n.line); if (is('=')) { p++; expr(); } if (is(',')) { p++; if (is(')')) return; continue; } return; }
}
function child() {
  if (is(';')) { p++; return; }
  if (is('{')) { p++; while (!is('}')) { if (peek().t === 'eof') err('accolade non fermée'); statement(); } p++; return; }
  instantiation();
}
function instantiation() {
  while (is('!') || is('#') || is('%') || is('*')) p++;
  if (is('if')) { p++; expect('('); expr(); expect(')'); child(); if (is('else')) { p++; child(); } return; }
  if (is('for') || is('intersection_for')) {
    p++; expect('('); pushScope('for');
    while (true) { const n = expect_id(); expect('='); expr(); declare(n.v, n.line); if (is(',')) { p++; continue; } break; }
    expect(')'); child(); popScope(); return;
  }
  if (is('let')) { p++; expect('('); pushScope('let'); letArgs(); expect(')'); child(); popScope(); return; }
  const n = expect_id();
  uses.push({ name: n.v, line: n.line, kind: 'module', scope });
  expect('('); args(); expect(')');
  const prim = ['cube', 'sphere', 'cylinder', 'square', 'circle', 'polygon', 'polyhedron', 'text', 'echo', 'assert'];
  if (prim.includes(n.v) && !is(';')) console.log(`AVERTISSEMENT ligne ${n.line} : '${n.v}' suivi d'un enfant (point-virgule oublié ?)`);
  child();
}
function letArgs() { if (is(')')) return; while (true) { const n = expect_id(); expect('='); expr(); declare(n.v, n.line); if (is(',')) { p++; continue; } return; } }
function args() {
  if (is(')')) return;
  while (true) {
    if (peek().t === 'id' && is('=', 1)) { p += 2; expr(); } else expr();
    if (is(',')) { p++; if (is(')')) return; continue; }
    return;
  }
}
// expressions
function expr() {
  if (is('let')) { p++; expect('('); pushScope('let'); letArgs(); expect(')'); expr(); popScope(); return; }
  if (is('function')) { p++; expect('('); pushScope('lambda'); params(); expect(')'); expr(); popScope(); return; }
  logicOr(); if (is('?')) { p++; expr(); expect(':'); expr(); }
}
function bin(next, opsList) { next(); while (opsList.some(o => is(o))) { p++; next(); } }
function logicOr() { bin(logicAnd, ['||']); }
function logicAnd() { bin(equality, ['&&']); }
function equality() { bin(comparison, ['==', '!=']); }
function comparison() { bin(additive, ['<', '<=', '>', '>=']); }
function additive() { bin(mult, ['+', '-']); }
function mult() { bin(unary, ['*', '/', '%']); }
function unary() { if (is('-') || is('+') || is('!')) { p++; unary(); return; } power(); }
function power() { postfix(); if (is('^')) { p++; unary(); } }
function postfix() {
  const startTok = peek();
  primary();
  while (true) {
    if (is('(')) { p++; args(); expect(')'); continue; }
    if (is('[')) { p++; expr(); expect(']'); continue; }
    if (is('.')) { p++; expect_id(); continue; }
    break;
  }
}
function primary() {
  const t = peek();
  if (t.t === 'num' || t.t === 'str') { p++; return; }
  if (is('true') || is('false') || is('undef')) { p++; return; }
  if (t.t === 'id') {
    p++;
    if (is('(')) uses.push({ name: t.v, line: t.line, kind: 'function', scope }); else useVar(t.v, t.line);
    return;
  }
  if (is('(')) { p++; expr(); expect(')'); return; }
  if (is('[')) {
    p++;
    if (is(']')) { p++; return; }
    if (is('for')) { p++; expect('('); pushScope('for'); while (true) { const n = expect_id(); expect('='); expr(); declare(n.v, n.line); if (is(',')) { p++; continue; } break; } expect(')'); expr(); popScope(); expect(']'); return; }
    expr();
    if (is(':')) { p++; expr(); if (is(':')) { p++; expr(); } expect(']'); return; }
    while (is(',')) { p++; if (is(']')) break; expr(); }
    expect(']'); return;
  }
  err(`expression attendue, trouvé '${t.v}'`);
}

try { program(); } catch (e) { console.log('ERREUR DE SYNTAXE : ' + e.message); process.exit(1); }

// ---------- résolution des noms ----------
const builtinModules = new Set(['cube', 'sphere', 'cylinder', 'polyhedron', 'square', 'circle', 'polygon', 'text', 'translate', 'rotate', 'scale', 'resize', 'mirror', 'multmatrix', 'color', 'offset', 'hull', 'minkowski', 'union', 'difference', 'intersection', 'linear_extrude', 'rotate_extrude', 'projection', 'surface', 'import', 'render', 'children', 'echo', 'assert', 'group']);
const builtinFunctions = new Set(['abs', 'sign', 'sin', 'cos', 'tan', 'acos', 'asin', 'atan', 'atan2', 'floor', 'round', 'ceil', 'ln', 'log', 'pow', 'sqrt', 'exp', 'min', 'max', 'norm', 'cross', 'len', 'concat', 'lookup', 'str', 'chr', 'ord', 'search', 'version', 'version_num', 'rands', 'is_undef', 'is_num', 'is_string', 'is_bool', 'is_list', 'is_function', 'echo', 'assert']);
const builtinVars = new Set(['PI', '$fn', '$fa', '$fs', '$t', '$children', '$preview', '$vpr', '$vpt', '$vpd']);
let bad = 0;
function visible(name, sc) { for (let s = sc; s; s = s.parent) if (s.names.has(name)) return true; return false; }
for (const u of uses) {
  if (u.kind === 'module' && !builtinModules.has(u.name) && !defs.modules.has(u.name)) { console.log(`module inconnu '${u.name}' ligne ${u.line}`); bad++; }
  if (u.kind === 'function' && !builtinFunctions.has(u.name) && !defs.functions.has(u.name)) { console.log(`fonction inconnue '${u.name}' ligne ${u.line}`); bad++; }
  if (u.kind === 'var' && !builtinVars.has(u.name) && !visible(u.name, u.scope)) { console.log(`variable non définie '${u.name}' ligne ${u.line} (portée ${u.scope.label})`); bad++; }
}
// variables globales jamais utilisées
const used = new Set(uses.filter(u => u.kind === 'var').map(u => u.name));
const unused = [...defs.vars.keys()].filter(v => !used.has(v) && !v.startsWith('$'));
console.log(`${toks.length} jetons, ${defs.modules.size} modules, ${defs.vars.size} variables, ${bad} problème(s).`);
if (unused.length) console.log('Affectées mais jamais lues : ' + unused.join(', '));
process.exit(bad ? 1 : 0);
