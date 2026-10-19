// Plays the synthesised phonocardiogram of one beat in a loop (Web Audio). Needs a user gesture (the «Auscultar» button).
// What it plays is bedside.mjs synthPhonocardiogram: S1, S2 (A2 and P2) and the murmur as band-limited noise from the envelope.
let ctx=null,src=null,gain=null;
export const audioAvailable=()=>typeof window!=='undefined'&&!!(window.AudioContext||window.webkitAudioContext);
export function listen(wave,sampleRate,volume=.8){
 stopListening();const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('Este navegador no permite reproducir audio.');
 ctx=ctx||new AC();const buf=ctx.createBuffer(1,wave.length,sampleRate);buf.copyToChannel(wave,0);
 src=ctx.createBufferSource();src.buffer=buf;src.loop=true;gain=ctx.createGain();gain.gain.value=volume;src.connect(gain);gain.connect(ctx.destination);src.start();ctx.resume?.();return ctx;
}
export function stopListening(){try{src?.stop()}catch{}src=null}
export const isListening=()=>!!src;
