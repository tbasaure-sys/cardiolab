// Standard pediatric TTE views defined from atlas landmarks (not from hand-placed poses),
// plus plane-agreement scoring and maneuver hints for the acquisition coach.
import {surface,poseFromState,defaultState,PRESETS,CHEST_X,CHEST_Y,BODY} from './geometry.mjs';

const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],norm=a=>Math.hypot(...a),unit=a=>mul(a,1/(norm(a)||1));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const mid=(...p)=>p.reduce((s,v)=>add(s,v),[0,0,0]).map(v=>v/p.length);
const rotate=(v,axis,ang)=>add(add(mul(v,Math.cos(ang)),mul(cross(axis,v),Math.sin(ang))),mul(axis,dot(axis,v)*(1-Math.cos(ang))));
const deg=r=>r*180/Math.PI,rad=d=>d*Math.PI/180;

// Find where a line from `target` going back along -dir meets the chest surface.
function skinAlong(target,dir){
 let lo=0,hi=.35;const inside=t=>{const p=sub(target,mul(dir,t)),s=surface(p[0],p[2]);return p[1]>s[1]};
 for(let i=0;i<48;i++){const m=(lo+hi)/2;if(inside(m))lo=m;else hi=m}
 return sub(target,mul(dir,(lo+hi)/2));
}
// Build a pose from a plane (normal n through point c), a skin window, a beam target and a marker hint (image-right side).
// The contact point is searched on the chest surface ∩ plane, near the window, avoiding ribs and lung when a
// tissue model is given.
function skinOnPlane(c,n,W,obstruct,span=.07){
 let best=null;const step=span>.04?.002:.001;
 for(let ix=-span;ix<=span+1e-9;ix+=step)for(let iz=-span;iz<=span+1e-9;iz+=step){
  const x=W[0]+ix,z=W[2]+iz;if(x<-.11||x>.11||z<-.155||z>.2)continue;
  const s=surface(x,z),d=dot(sub(s,c),n);if(Math.abs(d)>(step>.001?.0012:.0007))continue;
  const cost=norm(sub(s,W))*40+(obstruct?obstruct(s):0);
  if(!best||cost<best.cost)best={s,cost};
 }
 return best?best.s:null;
}
function planePose({c,n,window,target,markerToward,depth=.16,sector=80,obstruct,span}){
 const origin=skinOnPlane(c,n,window,obstruct?o=>obstruct(o,target,n):null,span)||window;
 let d=unit(sub(target,origin));d=unit(sub(d,mul(n,dot(d,n))));
 let u=unit(cross(d,n));if(markerToward&&dot(u,markerToward)<0)u=mul(u,-1);
 return {origin,u,d,n:unit(cross(u,d)),depth,sector};
}

// Clock position of the marker on the chest, seen from the examiner facing the patient's chest:
// 12 = head, 3 = patient's left, 6 = feet, 9 = patient's right.
export function markerClock(u){const a=Math.atan2(u[0],u[2]);let h=(deg(a)/30+12)%12;return h===0?12:h}
export function clockText(u){const h=Math.round(markerClock(u))%12||12;return `${h}`}

// Acoustic obstruction of a fan (ribs, lung) from a contact point toward a target, in the plane with normal n.
export function fanObstruction(tissue,LUNG,BONE,CARTILAGE=6){
 return (o,target,n)=>{const d0=sub(target,o),L=norm(d0),d=mul(d0,1/L),u=n?unit(cross(d,n)):unit(cross(d,[0,0,1]));let cost=0;
  for(let a=-36;a<=36;a+=9){const c=Math.cos(rad(a)),s=Math.sin(rad(a)),dir=add(mul(d,c),mul(u,s)),w=1-Math.abs(a)/60;
   for(let r=.002;r<L*.95;r+=.0015){const p=add(o,mul(dir,r)),l=tissue.tissueAt(p[0],p[1],p[2]);if(l===BONE){cost+=4*w*(r<.03?1.5:1);break}if(l===CARTILAGE){cost+=1.2*w;break}if(l===LUNG){cost+=3*w;break}}}
  return cost}}

export function buildViews(lm,obstruct=null){
 const apex=lm.lvApexCavity,mv=lm.mitralValve,tv=lm.tricuspidValve,av=lm.aorticValve,pv=lm.pulmonaryValve;
 const long=unit(sub(mv,apex)); // apex → base
 const head=[0,0,1],pLeft=[1,0,0],pRight=[-1,0,0];
 const views={},o=obstruct;
 const PARA=surface(.004,.012),APEX_W=skinAlong(apex,unit(sub(mid(mv,tv),apex))),SUBX=surface(CHEST_X+.004,-.128),SSN=surface(CHEST_X,.13);
 // Parasternal long axis: plane through apex, mitral and aortic valves; marker to the right shoulder
 {const n=unit(cross(sub(av,apex),sub(mv,apex))),c=add(mid(mv,av),mul(long,-.01));
  views.plax=planePose({c,n,window:PARA,target:c,markerToward:add(head,mul(pRight,.9)),depth:.15,obstruct:o});
  views.plax.meta={center:c,landmarks:{'Válvula mitral':mv,'Válvula aórtica':av,'VI medio':mid(mv,mv,apex)}};}
 // Parasternal short axis: same window as PLAX, plane contains the beam and is as perpendicular as possible to the
 // LV long axis (to the aortic root at valve level); marker to the left shoulder
 const W2=views.plax.origin;
 const psax=(target,axis,depth)=>{
  let best=null;
  for(let x=-.015;x<=.045+1e-9;x+=.003)for(let z=-.01;z<=.085+1e-9;z+=.003){
   const origin=surface(x,z),d=unit(sub(target,origin)),n=unit(sub(axis,mul(d,dot(d,axis))));
   const tiltCost=deg(Math.acos(Math.min(1,Math.abs(dot(n,axis)))));
   const cost=tiltCost*.8+norm(sub(origin,W2))*25+(o?o(origin,target,n)*3:0);
   if(!best||cost<best.cost)best={cost,origin,n};
  }
  const d=unit(sub(target,best.origin));let u=unit(cross(d,best.n));if(dot(u,add(head,pLeft))<0)u=mul(u,-1);
  return {origin:best.origin,u,d,n:unit(cross(u,d)),depth,sector:80};
 };
 {const root=unit(sub(av,mid(mv,apex)));
  views.psaxAV=psax(av,unit(add(mul(long,.3),mul(root,.7))),.14);views.psaxAV.meta={center:av,landmarks:{'Válvula aórtica':av,'Válvula pulmonar':pv}};}
 // mitral leaflet level, 16 mm (atlas) below the orifice: the annulus of the atlas is tilted, so a plane closer to it
 // cuts the aortic root and the left atrium instead of both leaflets (fish mouth)
 const mvLevel=add(mv,mul(long,-.012)),papLevel=add(mv,mul(sub(apex,mv),.5));
 // the plane follows the leaflet tips: deeper on the anterior (aortic) side, where the long anterior leaflet reaches,
 // which also keeps the aortic root out of the section (tilted 12° from the LV short axis)
 const toAo=sub(av,mv),antDir=unit(sub(toAo,mul(long,dot(toAo,long)))),mvAxis=unit(add(long,mul(antDir,Math.tan(rad(12)))));
 views.psaxMV=psax(mvLevel,mvAxis,.16);views.psaxMV.meta={center:mvLevel,landmarks:{'Mitral · nivel de velos':mvLevel}};
 views.psaxPM=psax(papLevel,long,.16);views.psaxPM.meta={center:papLevel,landmarks:{'Músculos papilares':papLevel}};
 // Apical views: probe on the true apex
 {const n4=unit(cross(sub(mv,apex),sub(tv,apex))),c4=mid(mv,tv);
  views.a4c=planePose({c:apex,n:n4,window:APEX_W,target:c4,markerToward:pLeft,depth:.17,obstruct:o,span:.03});views.a4c.meta={center:c4,landmarks:{'Ápex VI':apex,'Válvula mitral':mv,'Válvula tricúspide':tv}};
  const n5=unit(cross(sub(av,apex),sub(c4,apex)));
  // five-chamber: from the same apical window as the four-chamber, tilted anteriorly toward the outflow tract
  // five-chamber: the four-chamber tilted anteriorly onto the LV outflow tract and aortic valve (same contact, same marker)
  {const b=views.a4c,tgt=av;let nn=unit(cross(b.u,sub(tgt,b.origin)));let dd=unit(sub(tgt,b.origin));dd=unit(sub(dd,mul(nn,dot(dd,nn))));let uu=unit(cross(dd,nn));if(dot(uu,b.u)<0)uu=mul(uu,-1);
   views.a5c={origin:b.origin,u:uu,d:dd,n:unit(cross(uu,dd)),depth:.17,sector:80};void n5;}views.a5c.meta={center:av,landmarks:{'Ápex VI':apex,'Válvula aórtica':av,'Válvula mitral':mv}};
  const axis=long;let best=null;
  for(const sgn of [1,-1]){const n2=rotate(n4,axis,sgn*rad(62));const p=planePose({c:apex,n:n2,window:APEX_W,target:mv,markerToward:head,depth:.17,obstruct:o,span:.03});const off=Math.abs(dot(sub(tv,p.origin),p.n));if(!best||off>best.off)best={p,off}}
  views.a2c=best.p;views.a2c.meta={center:mv,landmarks:{'Ápex VI':apex,'Válvula mitral':mv}};
  const n3=unit(cross(sub(av,apex),sub(mv,apex)));
  views.a3c=planePose({c:apex,n:n3,window:APEX_W,target:mid(mv,av),markerToward:add(head,pRight),depth:.17,obstruct:o,span:.03});views.a3c.meta={center:mid(mv,av),landmarks:{'Ápex VI':apex,'Válvula mitral':mv,'Válvula aórtica':av}};}
 // Subcostal: from below the xiphoid, through the liver. Plane contains the beam to the atrial septum and best
 // contains both AV valves (septum ⟂ to the beam — the classic view for the atrial septum).
 {const tgt=mid(mv,tv,lm.asdSecundum);let origin=SUBX;
  const fit=(org)=>{const n=unit(cross(sub(lm.asdSecundum,org),sub(mid(mv,tv),org)));return {c:dot(sub(apex,org),n)**2*.2,n}};
  let best=null;for(let ix=-.024;ix<=.024+1e-9;ix+=.003)for(let iz=-.025;iz<=.02+1e-9;iz+=.003){const org=surface(SUBX[0]+ix,SUBX[2]+iz),f=fit(org),cost=f.c*4e4+(o?o(org,tgt,f.n):0)+norm(sub(org,SUBX))*30;if(!best||cost<best.cost)best={cost,org,n:f.n}}
  origin=best.org;const d=unit(sub(tgt,origin));let u=unit(cross(d,best.n));if(dot(u,pLeft)<0)u=mul(u,-1);
  views.sc4c={origin,u,d,n:unit(cross(u,d)),depth:.19,sector:85};views.sc4c.meta={center:tgt,landmarks:{'Septo interauricular':lm.asdSecundum,'Válvula mitral':mv,'Válvula tricúspide':tv}};
  // subcostal short axis / IVC view: marker to the head, plane through the IVC entering the right atrium
  {const ra=mid(tv,lm.asdSecundum),ivc=lm.ivcLow||add(tv,[0,.01,-.05]);
   let n=unit(cross(sub(ra,origin),sub(ivc,origin)));const tgt=mid(ra,lm.ivcJunction||ra);let d2=unit(sub(tgt,origin));d2=unit(sub(d2,mul(n,dot(d2,n))));
   let u2=unit(cross(d2,n));if(dot(u2,head)<0)u2=mul(u2,-1);
   views.scSAX={origin,u:u2,d:d2,n:unit(cross(u2,d2)),depth:.17,sector:85};views.scSAX.meta={center:tgt,landmarks:{'Aurícula derecha':ra,'Vena cava inferior':ivc}};}}
 // Suprasternal long axis of the aortic arch: probe in the notch above the manubrium; plane through the notch,
 // the ascending and the descending aorta
 {const arch=lm.archTop,asc=add(av,mul(unit(sub(arch,av)),.035)),desc=lm.ductAortic;
  let best=null;for(let ix=-.02;ix<=.02+1e-9;ix+=.002)for(let iz=0;iz<=.02+1e-9;iz+=.002){const org=surface(SSN[0]+ix,SSN[2]+iz) /* never below the notch (manubrium) */,n=unit(cross(sub(asc,org),sub(desc,org))),tgt=add(arch,[0,0,-.012]);const cost=(o?o(org,tgt,n):0)+norm(sub(org,SSN))*40;if(!best||cost<best.cost)best={cost,org,n,tgt}}
  let d=unit(sub(best.tgt,best.org));d=unit(sub(d,mul(best.n,dot(d,best.n))));let u=unit(cross(d,best.n));if(dot(u,head)<0)u=mul(u,-1);
  views.ssn={origin:best.org,u,d,n:unit(cross(u,d)),depth:.18,sector:80};views.ssn.meta={center:arch,landmarks:{'Arco aórtico':arch,'Aorta ascendente':asc,'Istmo aórtico':desc}};}
 // ---------------------------------------------------------------- extended pediatric views (derived landmarks)
 // A pose from a fixed contact point: the plane (normal n) contains the probe; the beam points at `target`.
 const poseAt=(org,n,target,markerToward,depth,sector=80)=>{n=unit(n);let d=unit(sub(target,org));d=unit(sub(d,mul(n,dot(d,n))));let u=unit(cross(d,n));if(dot(u,markerToward)<0)u=mul(u,-1);return {origin:org,u,d,n:unit(cross(u,d)),depth,sector}};
 // a sweep step: same contact and same marker as `base`, the beam tilted until the plane contains `target` (pure tilt)
 const tiltOf=(base,target,depth=base.depth)=>poseAt(base.origin,cross(base.u,sub(target,base.origin)),target,base.u,depth,base.sector);
 const has=(...k)=>k.every(x=>lm[x]);
 const HIGH=surface(PARA[0]+.004,PARA[2]+.034);
 // parasternal long-axis sweep: tilted toward the right hip (RV inflow: RA, tricuspid valve, RV) and toward the left
 // shoulder (RV outflow: infundibulum, pulmonary valve, main PA)
 if(has('raCentre')){views.plaxRVIn=tiltOf(views.plax,mid(tv,lm.raCentre),.14);views.plaxRVIn.meta={center:tv,landmarks:{'Válvula tricúspide':tv,'Aurícula derecha':lm.raCentre,...(lm.coronarySinus?{'Seno coronario':lm.coronarySinus}:{})}}}
 if(has('paBifurcation')){views.plaxRVOut=tiltOf(views.plax,pv,.13);views.plaxRVOut.meta={center:pv,landmarks:{'Válvula pulmonar':pv,'Tronco pulmonar':mid(pv,lm.paBifurcation)}}}
 // short axis at the apex: the LV cavity tapering beyond the papillary muscles
 {const apexLevel=add(mv,mul(sub(apex,mv),.78));views.psaxApex=psax(apexLevel,long,.12);views.psaxApex.meta={center:apexLevel,landmarks:{'VI apical':apexLevel}}}
 // high left parasternal short axis: main PA and its branches («pantalón» de la bifurcación), transverse plane
 if(has('rpaProximal','paBifurcation')){const n=unit(cross(sub(lm.rpaProximal,pv),sub(lm.ductPulmonary,pv)));
  views.psaxBranch=planePose({c:lm.paBifurcation,n,window:HIGH,target:lm.paBifurcation,markerToward:add(head,pLeft),depth:.13,obstruct:o,span:.03});
  views.psaxBranch.meta={center:lm.paBifurcation,landmarks:{'Válvula pulmonar':pv,'Rama pulmonar derecha':lm.rpaProximal,'Rama pulmonar izquierda':lm.ductPulmonary}}}
 // ductal view: a near-sagittal plane through the pulmonary valve and the origin of the left pulmonary artery, marker to
 // the head. In this adult atlas it is reached from the short-axis contact (the same cut as the ductus lesson).
 {const org=views.psaxAV.origin,tgt=mid(pv,lm.ductPulmonary),d=unit(sub(tgt,org));let n=unit(cross(d,sub(lm.ductPulmonary,pv)));
  views.ductal=poseAt(org,n,tgt,head,.14);views.ductal.meta={center:lm.ductPulmonary,landmarks:{'Válvula pulmonar':pv,'Origen de la rama izquierda':lm.ductPulmonary}}}
 // apical RV-focused four-chamber: the RV long axis (tricuspid → RV apex) centred
 if(has('rvCentre')){const n=unit(cross(sub(lm.rvApex,tv),sub(mv,tv)));
  // from the four-chamber contact (moving laterally lands on lung in this atlas): the plane through the tricuspid valve and the RV apex
  // same contact and plane as the four-chamber, the beam rocked onto the RV and turned a few degrees so its free wall
  // and apex are complete (RV-focused); lateral contacts land on lung in this atlas
  const b=views.a4c,org=b.origin,n2=rotate(b.n,b.d,rad(-8));views.a4cRV=poseAt(org,n2,mid(tv,lm.rvCentre),pLeft,.17);void n;
  views.a4cRV.meta={center:lm.rvCentre,landmarks:{'Válvula tricúspide':tv,'Ápex VD':lm.rvApex,'Válvula mitral':mv}}}
 // apical sweep, posterior: the four-chamber tilted back to the coronary sinus in the AV groove
 if(has('coronarySinus')){views.a4cCS=tiltOf(views.a4c,lm.coronarySinus);views.a4cCS.meta={center:lm.coronarySinus,landmarks:{'Seno coronario':lm.coronarySinus,'Válvula tricúspide':tv}}}
 // subcostal coronal sweep, anterior: LV outflow tract and aortic valve (subcostal «cinco cámaras»)
 views.scLVOT=tiltOf(views.sc4c,add(av,mul(sub(av,mv),.4)));views.scLVOT.meta={center:av,landmarks:{'Válvula aórtica':av,'Válvula mitral':mv}};
 // subcostal sagittal sweep from the short axis (marker to the head): toward the left, RV outflow and pulmonary valve;
 // toward the right, both venae cavae entering the RA (bicaval)
 if(has('rvCentre'))views.scRVOT=tiltOf(views.scSAX,mid(pv,lm.rvCentre),.18),views.scRVOT.meta={center:pv,landmarks:{'Válvula pulmonar':pv,'Tracto de salida del VD':mid(pv,lm.rvCentre)}};
 if(has('svcJunction','raCentre'))views.scBicaval=tiltOf(views.scSAX,lm.svcJunction,.21),views.scBicaval.meta={center:lm.raCentre,landmarks:{'Vena cava superior':lm.svcJunction,'Aurícula derecha':lm.raCentre}};
 // suprasternal short axis: transverse arch in section with the right pulmonary artery beneath it (marker to the
 // patient's left); tilted further back, the left atrium with the pulmonary veins («cangrejo»)
 if(has('rpa','ascendingAorta')){const org=views.ssn.origin,axis=unit(sub(lm.ductAortic,lm.ascendingAorta)),d=unit(sub(lm.rpa,org)),n=unit(sub(axis,mul(d,dot(d,axis))));
  views.ssnSAX=poseAt(org,n,mid(lm.rpa,lm.rpaProximal),pLeft,.17);views.ssnSAX.meta={center:lm.rpaProximal,landmarks:{'Rama pulmonar derecha':lm.rpaProximal,'Arco aórtico':lm.archTop,...(lm.laCentre?{'Aurícula izquierda':lm.laCentre}:{})}}}
 // landmarks and centre are used for scoring: keep them on the ideal plane itself (project the near ones, drop far ones)
 for(const v of Object.values(views)){
  const proj=p=>sub(p,mul(v.n,dot(sub(p,v.origin),v.n)));v.meta.center=proj(v.meta.center);
  v.meta.landmarks=Object.fromEntries(Object.entries(v.meta.landmarks).filter(([,p])=>Math.abs(dot(sub(p,v.origin),v.n))<.016).map(([k,p])=>[k,proj(p)]));
  if(!Object.keys(v.meta.landmarks).length)v.meta.landmarks={'Centro de la vista':v.meta.center};
 }
 return views;
}

// version of the view definitions: bump when buildViews changes, then regenerate assets/views.json (tools/build-views.mjs);
// tests/views.test.mjs fails when the precomputed file no longer matches the computation
export const VIEWS_VERSION=2;
export const VIEW_INFO={
 plax:{name:'Paraesternal eje largo',short:'PLAX',window:'plax',clock:'10–11',goal:'VI, septo, raíz aórtica, válvula mitral y AI en un mismo corte; ápex a la izquierda de la pantalla y aorta a la derecha.',checks:['Septo y pared posterior casi horizontales y paralelos','Válvula aórtica y mitral visibles a la vez','El ápex no se ve (es normal)'],pitfall:'Si el VI se ve redondo o el septo muy inclinado, estás oblicuo: rota o inclina, no te conformes.'},
 psaxAV:{name:'Paraesternal eje corto · válvula aórtica',short:'PSAX-VA',window:'psax',clock:'1–2',goal:'La válvula aórtica en corte transversal (la «Y» de Mercedes) rodeada por AD, VD, tracto de salida y arteria pulmonar.',checks:['Tres velos aórticos visibles','Tricúspide a la izquierda y pulmonar a la derecha de la pantalla'],pitfall:'Una aorta ovalada indica que el plano está oblicuo al anillo.'},
 psaxMV:{name:'Paraesternal eje corto · mitral',short:'PSAX-VM',window:'psax',clock:'1–2',goal:'La «boca de pez» mitral dentro de un VI circular.',checks:['VI circular','Ambos velos mitrales'],pitfall:'Un VI elíptico sugiere un corte oblicuo: corrige la rotación.'},
 psaxPM:{name:'Paraesternal eje corto · papilares',short:'PSAX-PM',window:'psax',clock:'1–2',goal:'VI circular a la altura de los músculos papilares; nivel habitual para valorar motilidad regional y la forma del septo. En el paciente se ven dos papilares; el atlas solo incluye el posteromedial.',checks:['VI circular','Septo convexo hacia el VD'],pitfall:'El septo aplanado solo es interpretable si el corte es realmente transversal.'},
 a4c:{name:'Apical cuatro cámaras',short:'A4C',window:'apical',clock:'3',goal:'Las cuatro cámaras, ambas válvulas AV y los dos septos, con el ápex real del VI.',checks:['Ápex del VI en el vértice del sector','Septo interventricular vertical','Tricúspide algo más apical que la mitral'],pitfall:'Un VI corto y redondeado es un corte «acortado» (foreshortening): desliza la sonda hacia el ápex verdadero.'},
 a5c:{name:'Apical cinco cámaras',short:'A5C',window:'apical',clock:'3',goal:'Desde la cuatro cámaras, inclina hacia anterior hasta ver el tracto de salida del VI y la válvula aórtica.',checks:['Tracto de salida y válvula aórtica visibles'],pitfall:'Es la vista típica para alinear el Doppler del tracto de salida.'},
 a2c:{name:'Apical dos cámaras',short:'A2C',window:'apical',clock:'12–1',goal:'Solo VI y AI: el VD sale del plano al rotar ~60° en sentido antihorario.',checks:['No aparece VD','Paredes anterior e inferior del VI'],pitfall:'Si todavía ves VD, falta rotación.'},
 a3c:{name:'Apical tres cámaras',short:'A3C',window:'apical',clock:'11',goal:'Eje largo apical: VI, AI y tracto de salida con válvula aórtica.',checks:['Mitral y aórtica en el mismo corte','Ápex en el vértice'],pitfall:'Es el mismo plano anatómico del eje largo paraesternal, visto desde el ápex.'},
 sc4c:{name:'Subcostal cuatro cámaras',short:'SC4C',window:'subcostal',clock:'3',goal:'Las cuatro cámaras desde abajo, con el septo interauricular perpendicular al haz.',checks:['Septo interauricular visible y perpendicular al haz','Hígado como ventana acústica'],pitfall:'Es la mejor vista para el septo interauricular: en apical el haz es paralelo al septo y aparece un falso «hueco».'},
 scSAX:{name:'Subcostal eje corto',short:'SC-SAX',window:'subcostal',clock:'12',goal:'Desde la cuatro cámaras subcostal, rota 90° hacia la cabeza para barrer de la vena cava a los tractos de salida.',checks:['Vena cava inferior entrando a la AD'],pitfall:'Barre lentamente: cada inclinación muestra un nivel distinto.'},
 ssn:{name:'Supraesternal eje largo del arco',short:'SSN',window:'ssn',clock:'12–1',goal:'El arco aórtico completo: aorta ascendente, vasos del cuello y aorta descendente.',checks:['Arco completo en un solo corte','Istmo visible'],pitfall:'Clave para coartación y ductus: sin esta ventana el estudio pediátrico está incompleto.'},
 plaxRVIn:{name:'Paraesternal · entrada del VD',short:'PLAX-EVD',window:'plax',clock:'10–11',goal:'AD, válvula tricúspide y VD en un mismo corte: desde el eje largo, el haz inclinado hacia la cadera derecha.',checks:['Válvula tricúspide en el centro, entre AD y VD','No se ven la aorta ni la mitral'],pitfall:'Si aparece la aorta, todavía estás en el eje largo: inclina más hacia la cadera derecha.'},
 plaxRVOut:{name:'Paraesternal · salida del VD',short:'PLAX-SVD',window:'plax',clock:'10–11',goal:'Infundíbulo, válvula pulmonar y tronco pulmonar: desde el eje largo, el haz inclinado hacia el hombro izquierdo.',checks:['Válvula pulmonar en el centro','Tronco pulmonar que se aleja hacia la bifurcación'],pitfall:'Buena alineación para el Doppler del tracto de salida y de la válvula pulmonar.'},
 psaxApex:{name:'Paraesternal eje corto · ápex',short:'PSAX-AP',window:'psax',clock:'1–2',goal:'VI pequeño y circular más allá de los papilares: los segmentos apicales y el septo trabecular.',checks:['VI circular sin músculos papilares','VD pequeño o ausente'],pitfall:'Es el último nivel del barrido del eje corto; con color, busca CIV musculares apicales.'},
 psaxBranch:{name:'Paraesternal alto · ramas pulmonares',short:'PSAX-RP',window:'psax',clock:'2–3',goal:'El tronco pulmonar y su bifurcación en ramas derecha e izquierda, desde un espacio intercostal más alto que el eje corto.',checks:['Tronco pulmonar que se divide en dos ramas','La rama derecha pasa por detrás de la aorta ascendente'],pitfall:'Sube un espacio intercostal desde el eje corto aórtico; es la vista de las ramas pulmonares.'},
 ductal:{name:'Paraesternal alto · vista ductal',short:'DUCTAL',window:'psax',clock:'11–12',goal:'Tronco pulmonar a lo largo hasta el origen de la rama izquierda, donde se busca el ductus, con el marcador hacia la cabeza.',checks:['Válvula pulmonar y tronco a lo largo','Origen de la rama pulmonar izquierda'],pitfall:'En el neonato es un plano sagital paraesternal izquierdo alto; en este atlas adulto se alcanza desde el contacto del eje corto.'},
 a4cRV:{name:'Apical 4C centrada en el VD',short:'A4C-VD',window:'apical',clock:'1–2',goal:'El VD en el centro del sector, con su pared libre y su ápex completos: el plano para valorar el tamaño del VD.',checks:['VD más ancho que en la cuatro cámaras estándar','Pared libre del VD completa hasta su ápex'],pitfall:'El tamaño aparente del VD cambia mucho con el plano: no lo compares entre vistas distintas.'},
 a4cCS:{name:'Apical 4C posterior · seno coronario',short:'A4C-SC',window:'apical',clock:'2–3',goal:'La cuatro cámaras inclinada hacia posterior: el seno coronario recorre el surco auriculoventricular y desemboca en la AD.',checks:['Seno coronario a lo largo del surco auriculoventricular','Las válvulas auriculoventriculares ya no se ven completas'],pitfall:'Es el extremo posterior del barrido apical: anterior verás la salida del VI (cinco cámaras).'},
 scLVOT:{name:'Subcostal · salida del VI',short:'SC-TSVI',window:'subcostal',clock:'3',goal:'La subcostal cuatro cámaras inclinada hacia anterior: tracto de salida del VI y válvula aórtica.',checks:['Válvula aórtica y tracto de salida del VI','Las cámaras posteriores pasan a segundo plano'],pitfall:'Es un paso del barrido coronal subcostal: de posterior (aurículas) a anterior (salidas ventriculares).'},
 scRVOT:{name:'Subcostal eje corto · salida del VD',short:'SC-TSVD',window:'subcostal',clock:'12–1',goal:'Desde el eje corto subcostal, inclinando hacia la izquierda del paciente: infundíbulo, válvula pulmonar y tronco.',checks:['Válvula pulmonar','Infundíbulo del VD'],pitfall:'En lactantes con mala ventana paraesternal, el tracto de salida del VD se ve bien desde aquí.'},
 scBicaval:{name:'Subcostal · bicava',short:'SC-BICAVA',window:'subcostal',clock:'12–1',goal:'Desde el eje corto subcostal, inclinando hacia la derecha: la vena cava superior y la inferior entrando en la AD, con el septo interauricular.',checks:['Vena cava superior entrando en la AD','Septo interauricular a lo largo'],pitfall:'Es la vista de la porción superior del septo (seno venoso, no simulado en este atlas).'},
 ssnSAX:{name:'Supraesternal eje corto',short:'SSN-EC',window:'ssn',clock:'3',goal:'Desde el eje largo del arco, rota 90°: la aorta en corte transversal y la rama pulmonar derecha por debajo; más hacia posterior, la AI con las venas pulmonares.',checks:['Aorta en corte transversal (círculo) arriba','Rama pulmonar derecha a lo largo, por debajo'],pitfall:'En el atlas las venas pulmonares son parciales: el «cangrejo» completo no se puede reproducir.'}
};

// ---------------------------------------------------------------- scoring
// Short view card: where the probe goes and what the view shows (paediatric practice; marker clock as VIEW_INFO.clock)
export const VIEW_CARD={
 plax:{probe:'Borde esternal izquierdo, 3.er–4.º espacio intercostal; marcador hacia el hombro derecho (10–11 h).',shows:['Tracto de salida del VD','septo interventricular','VI','pared inferolateral','válvula mitral','raíz aórtica','AI','aorta descendente']},
 psaxAV:{probe:'Misma ventana, girada 90° en sentido horario (marcador hacia el hombro izquierdo, 1–2 h), basculada hacia la base.',shows:['Válvula aórtica («Y»)','AI','AD','septo interauricular','válvula tricúspide','tracto de salida del VD','válvula pulmonar']},
 psaxMV:{probe:'Eje corto paraesternal, inclinado desde la válvula aórtica hacia el ápex hasta los velos mitrales.',shows:['VI circular','velos mitrales anterior y posterior («boca de pez»)','VD']},
 psaxPM:{probe:'Eje corto paraesternal, más inclinado hacia el ápex que el mitral.',shows:['VI circular','músculos papilares','septo','paredes anterior, lateral e inferior','VD']},
 a4c:{probe:'Ápex (choque de punta), 4.º–5.º espacio intercostal, línea medioclavicular o algo lateral; marcador a la izquierda del paciente (3 h), haz hacia el hombro derecho.',shows:['Las cuatro cámaras','septos interventricular e interauricular','válvulas mitral y tricúspide (la tricúspide algo más apical)','venas pulmonares']},
 a5c:{probe:'Desde la apical 4C, inclina el haz hacia anterior.',shows:['Tracto de salida del VI','válvula aórtica','cuatro cámaras']},
 a2c:{probe:'Desde la apical 4C, rota ~60° en sentido antihorario (marcador a las 12–1 h).',shows:['VI (paredes anterior e inferior)','AI','válvula mitral','orejuela izquierda']},
 a3c:{probe:'Desde la apical 2C, sigue rotando antihorario (marcador a las 11 h).',shows:['VI (septo anterior y pared inferolateral)','tracto de salida del VI','válvula aórtica','válvula mitral','AI']},
 sc4c:{probe:'Bajo el apéndice xifoides, sonda casi plana apuntando al hombro izquierdo; marcador a las 3 h.',shows:['Hígado','cuatro cámaras','septo interauricular perpendicular al haz (ideal para CIA)']},
 scSAX:{probe:'Desde la subcostal 4C, rota 90° (marcador hacia la cabeza, 12 h).',shows:['Vena cava inferior','AD','septo interauricular (vista bicava)','barrido de las cavidades en eje corto']},
 ssn:{probe:'Hueco supraesternal con el cuello extendido; marcador a las 12–1 h, en el plano del arco.',shows:['Arco aórtico','troncos supraaórticos','aorta descendente e istmo','rama pulmonar derecha']},
 plaxRVIn:{probe:'Desde el eje largo paraesternal, inclina el haz hacia la cadera derecha del paciente; el marcador no cambia.',shows:['AD','válvula tricúspide','VD','seno coronario y vena cava inferior cerca de la AD']},
 plaxRVOut:{probe:'Desde el eje largo paraesternal, inclina el haz hacia el hombro izquierdo; el marcador no cambia.',shows:['Infundíbulo del VD','válvula pulmonar','tronco pulmonar']},
 psaxApex:{probe:'Eje corto paraesternal, inclinado hacia el ápex más allá de los papilares.',shows:['VI apical circular','septo trabecular','segmentos apicales']},
 psaxBranch:{probe:'Paraesternal izquierdo alto (un espacio por encima del eje corto), plano transversal; marcador hacia el hombro izquierdo.',shows:['Tronco pulmonar','bifurcación','rama pulmonar derecha','rama pulmonar izquierda','aorta ascendente en corte']},
 ductal:{probe:'Paraesternal izquierdo alto en plano sagital, marcador hacia la cabeza (en este atlas, desde el contacto del eje corto).',shows:['Válvula pulmonar','tronco pulmonar','origen de la rama izquierda','sitio del ductus']},
 a4cRV:{probe:'Desde la apical 4C, desliza un poco hacia lateral y orienta el haz para centrar el VD.',shows:['VD completo','pared libre del VD','válvula tricúspide','ápex del VD']},
 a4cCS:{probe:'Desde la apical 4C, inclina el haz hacia posterior (hacia la espalda).',shows:['Seno coronario','surco auriculoventricular','AD']},
 scLVOT:{probe:'Desde la subcostal 4C, inclina el haz hacia anterior; el marcador sigue a las 3 h.',shows:['Tracto de salida del VI','válvula aórtica','aorta ascendente']},
 scRVOT:{probe:'Desde el eje corto subcostal (marcador hacia la cabeza), inclina el haz hacia la izquierda del paciente.',shows:['Infundíbulo del VD','válvula pulmonar','tronco pulmonar']},
 scBicaval:{probe:'Desde el eje corto subcostal (marcador hacia la cabeza), inclina el haz hacia la derecha del paciente.',shows:['Vena cava inferior','vena cava superior','AD','septo interauricular']},
 ssnSAX:{probe:'Desde el eje largo supraesternal, rota 90° en sentido horario (marcador hacia la izquierda del paciente).',shows:['Aorta en corte transversal','rama pulmonar derecha','AI y venas pulmonares al inclinar hacia posterior']}
};
// Guided sweeps: one window, one dominant maneuver repeated, structures entering and leaving the plane in order.
export const SWEEPS=[
 {id:'barrido-plax',name:'Barrido paraesternal largo',window:'plax',views:['plaxRVIn','plax','plaxRVOut'],how:'Inclinar: de la cadera derecha (entrada del VD) al hombro izquierdo (salida del VD), sin mover el contacto ni el marcador.'},
 {id:'barrido-psax',name:'Barrido del eje corto, de la base al ápex',window:'psax',views:['psaxAV','psaxMV','psaxPM','psaxApex'],how:'Inclinar el haz desde la base hacia el ápex: válvula aórtica → mitral → papilares → ápex.'},
 {id:'barrido-apical',name:'Barrido apical, de posterior a anterior',window:'apical',views:['a4cCS','a4c','a5c'],how:'Inclinar: posterior (seno coronario) → cuatro cámaras → anterior (salida del VI).'},
 {id:'barrido-subcostal-coronal',name:'Barrido subcostal coronal',window:'subcostal',views:['sc4c','scLVOT'],how:'Con el marcador a las 3 h, inclinar de posterior (aurículas, septo interauricular) a anterior (salida del VI).'},
 {id:'barrido-subcostal-sagital',name:'Barrido subcostal sagital',window:'subcostal',views:['scBicaval','scSAX','scRVOT'],how:'Con el marcador hacia la cabeza, inclinar de la derecha (venas cavas) a la izquierda (salida del VD).'},
 {id:'barrido-supraesternal',name:'Supraesternal: eje largo y eje corto',window:'ssn',views:['ssn','ssnSAX'],how:'Rotar 90° desde el plano del arco al plano transversal.'}
];
// nearest standard view to a pose (best plane agreement), or null when nothing is close
export function nearestView(pose,targets){let best=null;for(const [id,t] of Object.entries(targets||{})){if(!VIEW_INFO[id]||!t?.meta)continue;const a=planeAgreement(pose,t);if(!best||a.score>best.score)best={id,score:a.score}}return best&&best.score>=25?best:null}
export function planeAgreement(pose,target){
 const n=pose.n,tn=target.n;const cosN=Math.max(-1,Math.min(1,dot(n,tn)));
 const angle=deg(Math.acos(Math.abs(cosN)));
 const flipped=dot(pose.u,target.u)<0; // marker on the wrong side = mirror image
 const c=target.meta.center,offset=Math.abs(dot(sub(c,pose.origin),n))*1000; // mm, target centre to the current plane
 const beam=deg(Math.acos(Math.max(-1,Math.min(1,dot(pose.d,target.d)))));
 const visible=Object.entries(target.meta.landmarks).map(([name,p])=>{const q=sub(p,pose.origin),x=dot(q,pose.u),y=dot(q,pose.d),z=dot(q,pose.n);const inSector=y>0&&Math.hypot(x,y)<=pose.depth&&Math.abs(Math.atan2(x,y))<=rad(pose.sector/2);return {name,off:Math.abs(z)*1000,inSector,ok:inSector&&Math.abs(z)<.007}});
 let score=100*Math.exp(-((angle/18)**2)-((offset/14)**2)-((Math.max(0,beam-22)/28)**2));
 if(flipped)score*=.35;
 score*=.55+.45*visible.filter(v=>v.ok).length/visible.length;
 const cost=angle+offset*.9+Math.max(0,beam-15)*.35+(flipped?120:0)+visible.filter(v=>!v.ok).length*3;
 return {score:Math.round(score),cost,angle,offset,beam,flipped,visible};
}

const WORDS={x:['hacia la derecha del paciente','hacia la izquierda del paciente'],z:['hacia los pies','hacia la cabeza']};
function beamDirectionWords(delta){
 const axes=[[Math.abs(delta[2]),delta[2]>0?'hacia la cabeza':'hacia los pies'],[Math.abs(delta[0]),delta[0]>0?'hacia la izquierda del paciente':'hacia la derecha del paciente'],[Math.abs(delta[1]),delta[1]>0?'hacia la espalda':'hacia anterior']];
 axes.sort((a,b)=>b[0]-a[0]);return axes[0][1];
}
// One maneuver in clinical language (slide / rotate / tilt / rock): `state` changing `key` by `delta`.
export function describeManeuver(state,key,delta){const next={...state,[key]:state[key]+delta},p0=poseFromState(state),p1=poseFromState(next);const a=Math.abs(delta);const amt=key==='x'||key==='z'?`${Math.max(2,Math.round(a*1000*BODY.k))} mm`:`${Math.round(a)}°`;
  if(key==='x')return `desliza la sonda ${WORDS.x[delta>0?1:0]} (~${amt})`;
  if(key==='z'){const n=Math.round(a/.018);return `desliza la sonda ${WORDS.z[delta>0?1:0]} (~${amt}${n>=1?`, ${n===1?'un espacio intercostal':`unos ${n} espacios intercostales`}`:''})`}
  if(key==='rotation')return `rota la sonda en sentido ${delta>0?'horario':'antihorario'} (~${amt})`;
  if(key==='tilt')return `inclina la sonda para dirigir el haz ${beamDirectionWords(sub(p1.d,p0.d))} (~${amt})`;
  return `bascula (rock) ${dot(sub(p1.d,p0.d),p0.u)>0?'hacia el marcador':'alejándote del marcador'} (~${amt})`}
// Greedy one-maneuver hint: which single control change improves agreement the most.
// Hint: solve the whole maneuver from the current state, then name the one or two largest corrections in
// clinical language (slide / rotate / tilt / rock).
export function suggestManeuver(state,target){
 const base=planeAgreement(poseFromState(state),target);
 const sol=solveState(target,state.preset,state).state;
 const scale={x:.005,z:.005,rotation:8,tilt:6,rock:6};const wrap=d=>((d+540)%360)-180;
 const diffs=Object.keys(scale).map(k=>{const d=k==='rotation'?wrap(sol[k]-state[k]):sol[k]-state[k];return {key:k,delta:d,weight:Math.abs(d)/scale[k]}}).filter(m=>m.weight>=1).sort((a,b)=>b.weight-a.weight);
 if(!diffs.length)return {base:base.score,text:null};
 const say=m=>describeManeuver(state,m.key,m.delta);
 const [a,b]=diffs;const text=b?`Primero ${say(a)}; después ${say(b)}`:say(a).replace(/^./,c=>c.toUpperCase());
 return {base:base.score,text,move:{next:{...state,[a.key]:state[a.key]+a.delta}},solution:sol};
}

// Solve the control state that reproduces a target view from a given window preset (for "show me").
export function solveState(target,preset,start=null){
 let s=start?{...start}:{...defaultState(preset)};
 const f=st=>{const p=poseFromState(st),a=planeAgreement(p,target);return a.angle*1+a.offset*.8+Math.max(0,a.beam-8)*.4+(a.flipped?200:0)+Math.hypot(p.origin[0]-target.origin[0],p.origin[2]-target.origin[2])*2000}; // the probe must land on the view's own window (a few mm off can be a rib)
 // coarse search on rotation (marker side matters), then coordinate descent
 let best=s,bv=f(s);for(let r=-180;r<180;r+=15){const t={...s,rotation:r};const v=f(t);if(v<bv){bv=v;best=t}}s=best;
 const steps={x:.008,z:.008,rotation:8,tilt:8,rock:8},lim={x:[-.11,.11],z:[-.155,.13],rotation:[-180,180],tilt:[-60,60],rock:[-50,50]};
 for(let it=0;it<60;it++){let improved=false;for(const k of Object.keys(steps))for(const sg of [1,-1]){const t={...s,[k]:Math.max(lim[k][0],Math.min(lim[k][1],s[k]+sg*steps[k]))};const v=f(t);if(v<bv-1e-6){bv=v;s=t;improved=true}}if(!improved){for(const k in steps)steps[k]/=2;if(steps.tilt<.25)break}}
 return {state:s,cost:bv};
}
