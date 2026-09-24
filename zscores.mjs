// Pediatric Heart Network (PHN) Z-scores adjusted for body surface area (Haycock):
//   Z = (X / BSA^α − mean) / SD,  X in cm, BSA in m²
// Lopez L et al. Circ Cardiovasc Imaging 2017;10:e006979. doi:10.1161/CIRCIMAGING.117.006979
// Only coefficients checked against the published text are listed; the paper's worked example
// (mitral annulus 11 mm at BSA 0.3 m² → Z −1.0) is reproduced in tests/zscores.test.mjs.
export const PHN_SOURCE={label:'PHN · Lopez 2017',doi:'10.1161/CIRCIMAGING.117.006979'};
export const PHN={
 mitral:{name:'Anillo mitral',how:'Apical 4C, telediástole, de bisagra a bisagra',alpha:.5,mean:2.23,sd:.22}
};
export function zScore(key,cm,bsa){const c=PHN[key];if(!c||!(cm>0)||!(bsa>0))return null;return (cm/bsa**c.alpha-c.mean)/c.sd}
export function formatZ(z){return z==null?'':`Z ${z>=0?'+':'−'}${Math.abs(z).toFixed(1).replace('.',',')}`}
