// Phone-probe transports. The direct WebRTC link (PeerJS) is preferred; it often cannot open on hospital or
// university Wi-Fi (client isolation), between mobile data and Wi-Fi (carrier NAT) or when TURN is blocked.
// The relay then carries the same small messages through public MQTT brokers over secure WebSockets.
// Minimal MQTT 3.1.1 client (CONNECT, SUBSCRIBE and PUBLISH at QoS 0, PINGREQ): works in browsers and in Node 22.

export const PUBLIC_BROKERS=['wss://broker.hivemq.com:8884/mqtt','wss://broker.emqx.io:8084/mqtt'];
// ?relay=wss://my-broker/mqtt (comma-separated) replaces the public brokers, e.g. for a self-hosted relay
export const RELAY_PARAM=(()=>{try{const r=new URLSearchParams(globalThis.location?.search).get('relay');return r&&r.split(',').every(u=>/^wss?:\/\//.test(u))?r:null}catch{return null}})();
export const BROKERS=RELAY_PARAM?RELAY_PARAM.split(','):PUBLIC_BROKERS;
// STUN servers to find public addresses, plus the PeerJS TURN relays (PeerJS's own defaults, kept)
export const ICE_SERVERS=[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']},{urls:'stun:stun.cloudflare.com:3478'},
 {urls:['turn:eu-0.turn.peerjs.com:3478','turn:us-0.turn.peerjs.com:3478'],username:'peerjs',credential:'peerjsp'}];
export const relayTopics=code=>({up:`cardiolab/v1/${code}/up`,down:`cardiolab/v1/${code}/down`});

const enc=new TextEncoder(),dec=new TextDecoder();
function remaining(n){const out=[];do{let b=n%128;n=Math.floor(n/128);if(n>0)b|=128;out.push(b)}while(n>0);return out}
const utf8=s=>{const b=enc.encode(s);return [b.length>>8,b.length&255,...b]};
const packet=(first,body)=>new Uint8Array([first,...remaining(body.length),...body]);

// Parse complete MQTT packets from a byte buffer; returns [packets, leftover bytes]
export function parsePackets(buf){const out=[];let at=0;
 for(;;){if(buf.length-at<2)break;let mul=1,len=0,i=at+1,b;
  do{if(i>=buf.length)return [out,buf.slice(at)];b=buf[i++];len+=(b&127)*mul;mul*=128}while(b&128);
  if(buf.length<i+len)break;out.push({first:buf[at],body:buf.slice(i,i+len)});at=i+len}
 return [out,buf.slice(at)]}

export function connectRelay(url,{clientId,keepalive=30,onMessage,onOpen,onClose,WS=globalThis.WebSocket}={}){
 let ws,buf=new Uint8Array(0),open=false,ping=0,pid=1,closed=false;const subs=[];
 try{ws=new WS(url,'mqtt')}catch{queueMicrotask(()=>onClose?.());return {subscribe(){},publish(){return false},close(){},get open(){return false}}}
 ws.binaryType='arraybuffer';
 const send=bytes=>{if(ws.readyState===1)ws.send(bytes)};
 const subscribe=t=>{send(packet(0x82,[pid>>8,pid&255,...utf8(t),0]));pid=pid%65535+1};
 ws.onopen=()=>send(packet(0x10,[...utf8('MQTT'),4,2,keepalive>>8,keepalive&255,...utf8(clientId||'cl-'+Math.random().toString(36).slice(2,12))]));
 ws.onmessage=e=>{const d=new Uint8Array(e.data),nb=new Uint8Array(buf.length+d.length);nb.set(buf);nb.set(d,buf.length);let pk;[pk,buf]=parsePackets(nb);
  for(const {first,body} of pk){const type=first>>4;
   if(type===2){if(body[1]===0){open=true;for(const t of subs)subscribe(t);ping=setInterval(()=>send(new Uint8Array([0xc0,0])),keepalive*500);onOpen?.()}else ws.close()}
   else if(type===3){const tl=(body[0]<<8)|body[1],topic=dec.decode(body.subarray(2,2+tl)),qos=(first>>1)&3,start=2+tl+(qos?2:0);
    try{onMessage?.(topic,JSON.parse(dec.decode(body.subarray(start))))}catch{}}}};
 ws.onclose=()=>{const was=!closed;open=false;closed=true;clearInterval(ping);if(was)onClose?.()};
 ws.onerror=()=>{};
 return {subscribe(t){subs.push(t);if(open)subscribe(t)},
  publish(t,obj){if(!open)return false;send(packet(0x30,[...utf8(t),...enc.encode(JSON.stringify(obj))]));return true},
  close(){closed=true;clearInterval(ping);send(new Uint8Array([0xe0,0]));try{ws.close()}catch{}},get open(){return open}};
}

// One logical relay over several brokers: listens on all of them, answers on the one the other side used.
export function relayGroup({code,role,onMessage,onState,brokers=BROKERS,WS}){
 const {up,down}=relayTopics(code),listen=role==='computer'?up:down,talk=role==='computer'?down:up;let last=null;
 const links=brokers.map(url=>{const link=connectRelay(url,{WS,onOpen:()=>onState?.(),onClose:()=>onState?.(),onMessage:(t,m)=>{if(t===listen){last=link;onMessage?.(m)}}});link.subscribe(listen);return link});
 return {send(m){const l=last?.open?last:links.find(x=>x.open);return l?l.publish(talk,m):false},get open(){return links.some(l=>l.open)},close(){for(const l of links)l.close()}};
}
