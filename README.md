# CardioLab · Eco pediátrico

Simulador docente de ecocardiografía transtorácica que funciona en el navegador, sin instalación ni servidor propio.

> Herramienta docente. No es un ecógrafo, no está validada clínicamente y no sustituye la práctica supervisada.

*English summary: a browser-based transthoracic echocardiography teaching simulator (UI in Spanish). A virtual probe on a 3D chest cuts a reference heart; the image is ray-traced through an acoustic tissue model with rib/lung shadowing, a beating heart, colour Doppler and PW/CW spectral Doppler. It includes a view coach, congenital lesions and a guided course. Not a medical device.*

## Qué incluye

- **Tres vistas sincronizadas**: la sonda sobre el tórax, el plano de corte en el corazón 3D (con mapa del haz) y la imagen eco del mismo plano.
- **Imagen eco simulada** trazada rayo a rayo sobre un volumen de tejidos: atenuación dependiente de la frecuencia, reflexión especular, speckle ligado a la anatomía, sombra de costillas y pulmón, latido esquemático y válvulas móviles.
- **Doppler color, PW y CW** sobre un campo de flujo docente, con límite de Nyquist, aliasing y Bernoulli simplificada.
- **Tamaño del paciente**: de recién nacido a adolescente (y adulto). La anatomía se escala con √(superficie corporal); la acústica sigue siendo física, así que cambian la profundidad y la frecuencia adecuadas. Frecuencia cardíaca típica por edad.
- **Consola** con ganancia, TGC, profundidad, sector, frecuencia, foco, rango dinámico, armónico (THI), persistencia, zoom, contraste, cáliper y grabación; atajos de teclado. La pantalla imita un equipo: sonda y preset, frecuencia de cuadros calculada, regla de profundidad con el foco, cine al congelar. Cada maniobra se anuncia sobre la imagen con las mismas palabras que las pistas.
- **Tu teléfono como sonda**: empareja un teléfono por QR (WebRTC) y gíralo, inclínalo y bascúlalo como un transductor sobre un muñeco o una almohada; el deslizamiento se hace con un panel táctil. En un teléfono o tableta, el propio dispositivo puede ser la sonda.
- **Entrenador de vistas**: 11 vistas estándar calculadas a partir de la anatomía. *Practicar* con el corazón visible, medidor y pistas; *Ponerme a prueba* con el corazón oculto, guiándose solo por la imagen, y evaluación al terminar.
- **Leer la imagen**: preguntas generadas por el simulador (vista, estructura, maniobra, ajuste) respondidas solo con la imagen eco, con repaso espaciado de los fallos.
- **Cardiopatías**: CIA, CIV, canal AV, ductus, coartación, derrame e hipertrofias editadas en el volumen acústico, y anomalía de Ebstein (velos tricuspídeos desplazados hacia el ápex, con insuficiencia); modo de caso incógnito.
- **Curso guiado** de 14 lecciones con referencias a la guía ASE de ecocardiografía pediátrica 2024.
- **Volumen 4D real** (`echo4d.html`): cortes de un estudio mitral adquirido (datos de prueba de SlicerHeart).

## Ejecutarlo en local

Es un sitio estático con módulos ES; necesita servirse por HTTP (no con `file://`):

```sh
npx http-server -c-1 .     # o: python3 -m http.server
```

Abre `http://localhost:8080/`. Requiere un navegador actual con WebGL, Web Workers de módulo y `DecompressionStream` (Chrome, Edge, Firefox o Safari recientes).

## Pruebas

```sh
node --test tests/*.test.mjs
```

## Estructura

| Archivo | Función |
|---|---|
| `index.html`, `app.mjs` | Página principal: vistas 3D, imagen, controles y orquestación |
| `geometry.mjs` | Tórax, posición de la sonda, cortes de mallas |
| `slice-worker.mjs` | Corte de las mallas del atlas en un worker |
| `sim-engine.mjs`, `bmode-worker.mjs` | Planificador y workers de la imagen simulada |
| `tissue.mjs`, `bmode.mjs` | Modelo acústico de tejidos y simulación modo B |
| `flow.mjs`, `spectral.mjs` | Campo de flujo, Doppler color y espectral |
| `valves.mjs` | Velos valvulares paramétricos |
| `views.mjs` | Vistas estándar, puntuación y pistas de maniobra |
| `coach.mjs`, `tutor.mjs`, `course-data.mjs` | Entrenador de vistas y curso guiado |
| `drills.mjs` | Preguntas de lectura de imagen con repaso espaciado |
| `patient.mjs`, `zscores.mjs` | Tamaño del paciente y puntuaciones Z (PHN) |
| `probe-motion.mjs`, `phone-probe.mjs`, `relay.mjs`, `sonda.*` | Teléfono como sonda: orientación → maniobras, emparejamiento y página del teléfono |
| `chd-data.mjs`, `chd-panel.mjs` | Cardiopatías |
| `beam-map.mjs`, `instrument.mjs`, `cabina.mjs` | Mapa del haz, consola y diseño cabina |
| `echo4d.*`, `volume-*.mjs` | Página del volumen 4D |
| `assets/` | Atlas, volúmenes de tejido y volumen mitral 4D |
| `node_modules/` | Copias de three.js, PeerJS y qrcode-generator (MIT) usadas directamente por el navegador |

Los volúmenes `assets/tissue-*` se generaron a partir de las mallas del atlas con un script que no forma parte de este repositorio.

## Limitaciones conocidas

- El corazón es un atlas **adulto** (BodyParts3D) escalado de forma uniforme al tamaño del paciente elegido: no reproduce las proporciones ni la orientación propias del lactante.
- El corazón del atlas se desplazó 2 cm hacia la pared torácica (volumen, mallas y referencias con la misma deformación) para que el ápex quede cerca de la pared; la vista apical 4C sigue algo recargada porque el plano cruza los grandes músculos papilares del VD del atlas.
- En el volumen acústico se corrigieron dos defectos del atlas: el tabique interventricular venía partido en dos capas con sangre entre ellas (ahora es macizo) y el velo mitral anterior estaba fundido con el miocardio como una lámina fija en la cavidad (ahora lo dibuja el velo móvil). Los velos nacen del anillo medido hasta las paredes reales en cada dirección y, al cerrarse, se encuentran en su línea de coaptación (la «sonrisa» mitral, la «Y» tricuspídea), por lo que la válvula sella en sístole; el eje corto mitral se inclina hacia las puntas de los velos como haría el ecografista para ver la «boca de pez». El anillo tricuspídeo está más bajo en el tabique: su velo septal se inserta unos milímetros más cerca del ápex que la mitral, como en un corazón normal.
- El eje corto subcostal coincide peor con su definición que las demás vistas.
- Las puntuaciones Z solo incluyen por ahora los coeficientes PHN verificados (anillo mitral).
- La única insuficiencia valvular es la tricuspídea de la anomalía de Ebstein; no hay estenosis valvulares ni modo M.
- El teléfono solo aporta la orientación (no su posición sobre el tórax). La conexión directa (WebRTC, emparejada por el servidor público de PeerJS) falla en muchas redes de hospital o universidad; entonces los mensajes pasan por brókers MQTT públicos (HiveMQ, EMQX) por WebSocket seguro. Con `?relay=wss://tu-broker/mqtt` en la URL se usa un bróker propio.
- El latido, las velocidades y las lesiones son esquemáticos: sirven para aprender orientación y conceptos, no para medir.

## Licencias

- Anatomía y volúmenes derivados: Z-Anatomy (CC BY-SA 4.0), derivado de BodyParts3D / DBCLS (CC BY-SA 2.1 Japan). Ver `assets/LICENSE-anatomy.txt` y `LICENCIAS.txt`.
- three.js: MIT (`node_modules/three/LICENSE`). PeerJS: MIT (`node_modules/peerjs/LICENSE`). qrcode-generator: MIT (`node_modules/qrcode-generator/LICENSE`).
- Volumen mitral 4D: datos de prueba públicos de [SlicerHeart](https://github.com/SlicerHeart/SlicerHeart/releases/tag/TestingData).
- Código de CardioLab: [MIT](LICENSE). La licencia MIT cubre el código; los archivos de `assets/` conservan sus propias licencias.
