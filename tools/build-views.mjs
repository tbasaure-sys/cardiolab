// Precomputes the standard views (buildViews over the atlas volume) into assets/views.json, so the page does not wait
// for a worker to compute them at start-up. Run after changing views.mjs or the tissue volume: node tools/build-views.mjs
import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL} from '../tissue.mjs';import {buildViews,fanObstruction,VIEWS_VERSION} from '../views.mjs';
const A=new URL('../assets/',import.meta.url),meta=JSON.parse(fs.readFileSync(new URL('tissue.json',A)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(meta.fine.file,A))),zlib.gunzipSync(fs.readFileSync(new URL(meta.coarse.file,A))));
const views=buildViews(tissue.landmarks,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE));
fs.writeFileSync(new URL('views.json',A),JSON.stringify({schema:'cardiolab.views/1',version:VIEWS_VERSION,geometrySHA256:meta.geometrySHA256,views})+'\n');
console.log(`assets/views.json: ${Object.keys(views).length} vistas`);
