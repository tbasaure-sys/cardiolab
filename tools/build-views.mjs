// Precomputes the standard views (buildViews over the atlas volume) into assets/views.json, so the page does not wait
// for a worker to compute them at start-up. Run after changing views.mjs or the tissue volume: node tools/build-views.mjs
import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL} from '../tissue.mjs';import {buildViews,fanObstruction,VIEWS_VERSION} from '../views.mjs';
import {setBodyFit} from '../geometry.mjs';import {createFit,fitAgeFor} from '../thorax-fit.mjs';import {PATIENTS,ageYears} from '../patient.mjs';
const A=new URL('../assets/',import.meta.url),meta=JSON.parse(fs.readFileSync(new URL('tissue.json',A)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(meta.fine.file,A))),zlib.gunzipSync(fs.readFileSync(new URL(meta.coarse.file,A))));
// one set per thorax fit of the patient presets (thorax-fit.mjs): the windows are found on each patient's own chest
const fits={};
for(const p of PATIENTS){const age=fitAgeFor(ageYears(p)),key=String(age);if(fits[key])continue;setBodyFit(age);tissue.setFit(createFit(age));fits[key]=buildViews(tissue.landmarks,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE))}
fs.writeFileSync(new URL('views.json',A),JSON.stringify({schema:'cardiolab.views/2',version:VIEWS_VERSION,geometrySHA256:meta.geometrySHA256,fits})+'\n');
console.log(`assets/views.json: ${Object.keys(fits).length} ajustes de tórax (${Object.keys(fits).join(', ')}), ${Object.keys(Object.values(fits)[0]).length} vistas cada uno`);
