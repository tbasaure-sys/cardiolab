// The pages themselves: an import map only works if it is registered before anything starts loading a module. A
// <link rel="modulepreload"> ahead of it made the bare specifier "three" fail to resolve now and then, and the page never
// started («Cargando anatomía…» forever).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';

for(const page of ['index.html','echo4d.html','sonda.html'])test(`${page}: the import map, if any, comes before every module load`,()=>{
 const s=fs.readFileSync(new URL('../'+page,import.meta.url),'utf8'),im=s.indexOf('<script type="importmap">');
 const loads=[s.indexOf('rel="modulepreload"'),s.indexOf('<script type="module"')].filter(i=>i>=0);
 if(im<0){assert.ok(!/from\s*['"]three['"]/.test(s),'no import map, so no bare specifiers inline');return}
 for(const i of loads)assert.ok(im<i,'import map first');
});
