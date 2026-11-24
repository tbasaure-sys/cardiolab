// The thorax fitted to the heart (thorax-fit.mjs): an invertible radial map that leaves the heart untouched, brings the
// anterior wall onto the heart and gives the newborn the published cardiothoracic ratio. Skin, tissue and views agree.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL} from '../tissue.mjs';import {buildViews,fanObstruction} from '../views.mjs';
import {createFit,fitAgeFor,ctrTarget,ageFactor,envelopeRadius,capFactor,NEWBORN_CTR,ATLAS_CTR,CAP_GAP,FIT_SOURCES,THYMUS_SOURCES,thymusFor,bodyFor} from '../thorax-fit.mjs';import {FIT_DATA} from '../thorax-fit-data.mjs';
import {surface,atlasSurface,insideBody,skinParams,setBodyFit,BODY} from '../geometry.mjs';
import {projectChest,cardiothoracic} from '../cxr.mjs';import {createRemodel,referenceShapes} from '../remodel.mjs';
import {PATIENTS,PATIENT_BY_ID,ageYears} from '../patient.mjs';

const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
const lm=tissue.landmarks,C=lm.heartCenter,dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const rnd=(()=>{let s=7;return ()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff}})();
const sources=JSON.parse(fs.readFileSync(new URL('../lessons/sources.json',import.meta.url))).sources;

test('the tables belong to this tissue volume and the sources are in the catalogue',()=>{
 assert.equal(FIT_DATA.geometrySHA256,meta.geometrySHA256,'regenerate with: node tools/build-thorax-fit.mjs');
 assert.deepEqual(FIT_DATA.centre,C);assert.equal(FIT_DATA.envelopeMM.length,FIT_DATA.rows*FIT_DATA.cols);
 for(const id of [...FIT_SOURCES,...THYMUS_SOURCES])assert.ok(sources[id],id);
 assert.ok(Math.abs(ATLAS_CTR-cardiothoracic(projectChest(tissue,{})).ctr)<1e-3,'the atlas ratio stored with the tables is the measured one');
});
test('the map is exactly invertible and keeps every ray: points only slide toward the heart',()=>{
 for(const age of [1,.92,.826])for(const cap of [true,false]){const f=createFit(age,{cap});
  for(let i=0;i<400;i++){const p=[C[0]+(rnd()-.5)*.36,C[1]+(rnd()-.5)*.3,C[2]+(rnd()-.5)*.4],q=f.forward(p),b=f.inverse(q);
   assert.ok(dist(b,p)<1e-9,'inverse(forward(p)) = p');
   const rp=dist(p,C),rq=dist(q,C);assert.ok(rq<=rp+1e-12,'never away from the heart');
   if(rp>1e-6&&rq>1e-6){const c=((p[0]-C[0])*(q[0]-C[0])+(p[1]-C[1])*(q[1]-C[1])+(p[2]-C[2])*(q[2]-C[2]))/(rp*rq);assert.ok(c>1-1e-9,'same ray')}}
  // monotone along a ray (no folding)
  const d=[.5,-.7,-.5],l=Math.hypot(...d);let prev=0;for(let r=.01;r<.3;r+=.005){const q=f.forward([C[0]+d[0]/l*r,C[1]+d[1]/l*r,C[2]+d[2]/l*r]),rq=dist(q,C);assert.ok(rq>prev);prev=rq}}
});
test('the heart and the great vessels are untouched: every voxel of the cardiac envelope stays where it is',()=>{
 const f=createFit(.826),d=tissue.fine.data,[nx,ny,nz]=tissue.fine.dims,h=tissue.fh,o=tissue.fo;let n=0,moved=0,worst=0;
 for(let k=0;k<nz;k+=3)for(let j=0;j<ny;j+=3)for(let i=0;i<nx;i+=3){const idx=((k*ny+j)*nx+i)*2;if(d[idx+1]!==0)continue;n++;
  const p=[o[0]+i*h,o[1]+j*h,o[2]+k*h],m=dist(f.forward(p),p);if(m>1e-12){moved++;worst=Math.max(worst,m)}}
 assert.ok(n>20000);assert.ok(moved/n<.002&&worst<.0012,`${moved} of ${n} voxels move, at most ${(worst*1000).toFixed(2)} mm`);
 for(const k of ['aorticValve','pulmonaryValve','mitralValve','tricuspidValve','lvApex','rvApex','asdSecundum','ductAortic','ductPulmonary'])assert.deepEqual(f.forward(lm[k]),lm[k],k);
});
test('newborn: the cardiothoracic ratio of the fitted chest is the midpoint of the published normal range',()=>{
 assert.ok(Math.abs(ctrTarget(3/365)-NEWBORN_CTR.mid)<1e-9);assert.ok(Math.abs(ctrTarget(2)-ATLAS_CTR)<1e-9&&Math.abs(ctrTarget(30)-ATLAS_CTR)<1e-9);
 assert.ok(ctrTarget(.5)<NEWBORN_CTR.mid&&ctrTarget(.5)>ATLAS_CTR,'interpolated in between (teaching model)');
 assert.equal(ageFactor(ATLAS_CTR),1);
 const age=fitAgeFor(ageYears(PATIENT_BY_ID.neonate));assert.ok(age<.9&&age>.75,`age factor ${age}`);
 tissue.setFit(createFit(age));const ct=cardiothoracic(projectChest(tissue,{remodel:tissue.remodel})).ctr;tissue.setFit(null);
 assert.ok(ct>NEWBORN_CTR.low&&ct<NEWBORN_CTR.high,`within 43.2–56.5 %: ${ct.toFixed(3)}`);assert.ok(Math.abs(ct-NEWBORN_CTR.mid)<.02,`near the midpoint ${NEWBORN_CTR.mid.toFixed(3)}: ${ct.toFixed(3)}`);
 // presets from two years on keep the atlas thorax (only the anterior cap applies)
 for(const id of ['toddler','child','preteen','teen','adult'])assert.equal(fitAgeFor(ageYears(PATIENT_BY_ID[id])),1,id);
 assert.equal(new Set(PATIENTS.map(p=>fitAgeFor(ageYears(p)))).size,3);
});
test('the cap brings the anterior wall onto the heart: the apex lies under the apical window',()=>{
 const gapAlong=(o,d)=>{let r=0;for(;r<.2;r+=.0005){const l=tissue.bodyAt(o[0]+d[0]*r,o[1]+d[1]*r,o[2]+d[2]*r);if(l>=10&&l<30)break}return r};
 setBodyFit(null);tissue.setFit(null);const bare=buildViews(lm,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE)).a4c,g0=gapAlong(bare.origin,bare.d);
 setBodyFit(1);tissue.setFit(createFit(1));const fit=buildViews(lm,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE)),g1=gapAlong(fit.a4c.origin,fit.a4c.d);
 assert.ok(g0>.035,`bare atlas: ${(g0*1000).toFixed(0)} mm of chest before the apex`);assert.ok(g1<.03,`fitted: ${(g1*1000).toFixed(0)} mm`);
 // the same plane through the heart: only the contact moved
 const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];assert.ok(Math.abs(dot(bare.n,fit.a4c.n))>.995);
 // lateral and posterior directions are not capped
 assert.ok(capFactor([1,.3,0])>.98&&capFactor([0,1,0])>.99&&capFactor([-1,0,0])>.99&&capFactor([0,0,1])>.99);assert.ok(capFactor(lm.lvApex.map((v,i)=>v-C[i]))<.75);
 // subcostal: the probe just below the xiphoid looks at the heart through less liver than the atlas' low epigastric contact did
 const sc=gapAlong(fit.sc4c.origin,fit.sc4c.d);assert.ok(sc<.07,`liver before the heart from the subcostal window: ${(sc*1000).toFixed(0)} mm`);
 setBodyFit(null);tissue.setFit(null);
});
test('skin, probe coordinates and the tissue under the probe agree in the fitted thorax',()=>{
 setBodyFit(.826);tissue.setFit(createFit(.826));
 for(const [x,z] of [[.02,.03],[.07,-.05],[-.02,-.09],[-.02,.12],[.0,.0]]){const s=surface(x,z),a=atlasSurface(x,z);
  assert.ok(dist(BODY.fit.forward(a),s)<1e-12);const [px,pz]=skinParams(s);assert.ok(Math.abs(px-x)<2e-4&&Math.abs(pz-z)<2e-4,`skin coordinates of surface(${x}, ${z})`);
  const inward=[C[0]-s[0],C[1]-s[1],C[2]-s[2]],l=Math.hypot(...inward),at=t=>s.map((v,i)=>v+inward[i]/l*t);
  assert.ok(insideBody(at(.004))&&!insideBody(at(-.004)),'inside just under the skin, outside just above it');
  assert.notEqual(tissue.bodyAt(...at(.004)),LABEL.AIR,'tissue under the skin');}
 setBodyFit(null);tissue.setFit(null);
});
test('with a lesion the chamber remodelling and the thorax fit compose and stay invertible',()=>{
 tissue.setFit(createFit(.826));tissue.remodel=createRemodel(referenceShapes(tissue),{RV:.25,RA:.2});const w=tissue.remodel;
 for(let i=0;i<200;i++){const p=[C[0]+(rnd()-.5)*.3,C[1]+(rnd()-.5)*.24,C[2]+(rnd()-.5)*.3],b=w.inverse(w.forward(p));assert.ok(dist(b,p)<2e-5,`${dist(b,p)}`)}
 tissue.remodel=null;assert.equal(tissue.remodel,tissue.fit,'without a lesion only the fit remains');tissue.setFit(null);assert.equal(tissue.remodel,null);
});
test('the body by age: thorax fit and thymus, one key per distinct body',()=>{
 assert.equal(thymusFor(3/365),1);assert.equal(thymusFor(.5),1);assert.equal(thymusFor(6),0);assert.equal(thymusFor(15),0);assert.ok(thymusFor(2)>0&&thymusFor(2)<1);
 const keys=PATIENTS.map(p=>bodyFor(ageYears(p)).key);assert.equal(new Set(keys).size,4,keys.join(' '));
 assert.deepEqual(bodyFor(6),{fit:1,thymus:0,key:'1|0'});
});
test('thymus of the infant: in front of the great vessels, behind the chest wall, where the adult atlas has lung and loose tissue',()=>{
 const count=()=>{let n=0,lung=0;const pv=lm.pulmonaryValve;for(let z=pv[2]-.02;z<lm.archTop[2]+.03;z+=.003)for(let y=-.09;y<.05;y+=.003)for(let x=-.07;x<.08;x+=.003){const l=tissue.tissueAt(x,y,z);if(l===LABEL.THYMUS)n++;else if(l===LABEL.LUNG)lung++}return {n,lung}};
 tissue.setThymus(0);const none=count();assert.equal(none.n,0,'no thymus in the older child and the adult');
 tissue.setThymus(1);const full=count();assert.ok(full.n>1500,`${full.n} samples of thymus`);assert.ok(full.lung<none.lung,'it takes the place of lung in front of the vessels');
 tissue.setThymus(.5);const half=count();assert.ok(half.n>0&&half.n<full.n*.6,'smaller with age');
 tissue.setThymus(1);
 // never inside the heart, the vessels, bone or cartilage; never in the chest wall (17 mm under the anterior skin)
 const asc=lm.ascendingAorta;assert.equal(tissue.tissueAt(...asc),LABEL.AO_BLOOD);
 const front=[asc[0],asc[1]-.022,asc[2]+.01];assert.equal(tissue.tissueAt(...front),LABEL.THYMUS,'in front of the ascending aorta');
 for(let y=-.09;y<asc[1];y+=.001){const l=tissue.tissueAt(asc[0],y,asc[2]+.01);if(l===LABEL.THYMUS){assert.ok(y-atlasSurface(asc[0],asc[2]+.01)[1]>.017-1e-9,'behind the chest wall');break}}
 // behind the vessels there is none
 assert.notEqual(tissue.tissueAt(asc[0],asc[1]+.03,asc[2]),LABEL.THYMUS);
 tissue.setThymus(0);
});
test('the pericardium stops at its reflection on the great arteries; the liver reaches the diaphragm under the heart',()=>{
 const zr=tissue.reflectionZ;assert.ok(zr>lm.pulmonaryValve[2]&&zr<lm.archTop[2],`reflection at z = ${zr.toFixed(3)}`);
 let above=0,below=0;for(let z=lm.aorticValve[2]-.04;z<lm.archTop[2]+.02;z+=.002)for(let y=-.07;y<.07;y+=.002)for(let x=-.06;x<.08;x+=.002){if(tissue.tissueAt(x,y,z)===LABEL.PERICARDIUM){if(z>=zr)above++;else below++}}
 assert.equal(above,0,'no pericardium around the arch');assert.ok(below>2000,'pericardium around the heart');
 // liver dome: filled at load; along the subcostal beam the abdominal wall is followed by liver up to the diaphragm
 assert.ok(tissue.liverDome&&tissue.liverDome.fineVoxels>20000,JSON.stringify(tissue.liverDome));
 setBodyFit(1);tissue.setFit(createFit(1));const v=buildViews(lm,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE)).sc4c;let liver=0,soft=0,r=0;
 for(;r<.12;r+=.0005){const l=tissue.bodyAt(v.origin[0]+v.d[0]*r,v.origin[1]+v.d[1]*r,v.origin[2]+v.d[2]*r);if(l>=10&&l<30)break;if(l===LABEL.LIVER)liver+=.0005;else if(l===LABEL.SOFT&&r>.02)soft+=.0005}
 assert.ok(liver>.02,`liver in the subcostal near field: ${(liver*1000).toFixed(0)} mm`);assert.ok(soft<.012,`unlabelled tissue between liver and heart: ${(soft*1000).toFixed(0)} mm`);
 setBodyFit(null);tissue.setFit(null);
});
