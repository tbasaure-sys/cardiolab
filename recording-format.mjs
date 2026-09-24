// Prefer a real H.264 MP4 recording; never rename WebM bytes to .mp4.
export const RECORDING_TYPES=['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
export function recordingExtension(type){return type.split(';')[0].trim().toLowerCase()==='video/mp4'?'mp4':'webm'}
export function createVideoRecorder(stream,Recorder=MediaRecorder){
 for(const mimeType of RECORDING_TYPES){if(!Recorder.isTypeSupported(mimeType))continue;try{return new Recorder(stream,{mimeType,videoBitsPerSecond:4500000})}catch{}}
 throw new Error('El navegador no permite grabar vídeo. Abre el simulador en una versión actual de Edge o Chrome.');
}
