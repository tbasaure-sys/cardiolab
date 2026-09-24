# CardioLab · Eco pediátrico

Simulador docente de ecocardiografía transtorácica que funciona en el navegador, sin instalación ni servidor propio.

> Herramienta docente. No es un ecógrafo, no está validada clínicamente y no sustituye la práctica supervisada.

*English summary: a browser-based transthoracic echocardiography teaching simulator (UI in Spanish). A virtual probe on a 3D chest cuts a reference heart; the image is ray-traced through an acoustic tissue model with rib/lung shadowing, a beating heart, colour Doppler and PW/CW spectral Doppler. It includes a view coach, congenital lesions and a guided course. Not a medical device.*

## Qué incluye

- **Tres vistas sincronizadas**: la sonda sobre el tórax, el plano de corte en el corazón 3D (con mapa del haz) y la imagen eco del mismo plano.
- **Imagen eco simulada** trazada rayo a rayo sobre un volumen de tejidos: atenuación dependiente de la frecuencia, reflexión especular, speckle ligado a la anatomía, sombra de costillas y pulmón, latido esquemático y válvulas móviles.
- **Doppler color, PW y CW** sobre un campo de flujo docente, con límite de Nyquist, aliasing y Bernoulli simplificada.
- **Tamaño del paciente**: de recién nacido a adolescente (y adulto). La anatomía se escala con √(superficie corporal); la acústica sigue siendo física, así que cambian la profundidad y la frecuencia adecuadas. Frecuencia cardíaca típica por edad.
- **Consola** con ganancia, TGC, profundidad, sector, frecuencia, zoom, contraste, cáliper y grabación; atajos de teclado.
- **Entrenador de vistas**: 11 vistas estándar calculadas a partir de la anatomía. *Practicar* con el corazón visible, medidor y pistas; *Ponerme a prueba* con el corazón oculto, guiándose solo por la imagen, y evaluación al terminar.
- **Leer la imagen**: preguntas generadas por el simulador (vista, estructura, maniobra, ajuste) respondidas solo con la imagen eco, con repaso espaciado de los fallos.
- **Cardiopatías**: CIA, CIV, canal AV, ductus, coartación, derrame e hipertrofias editadas en el volumen acústico; modo de caso incógnito.
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
| `chd-data.mjs`, `chd-panel.mjs` | Cardiopatías |
| `beam-map.mjs`, `instrument.mjs`, `cabina.mjs` | Mapa del haz, consola y diseño cabina |
| `echo4d.*`, `volume-*.mjs` | Página del volumen 4D |
| `assets/` | Atlas, volúmenes de tejido y volumen mitral 4D |
| `node_modules/three/` | Copia de three.js (MIT) usada directamente por el navegador |

Los volúmenes `assets/tissue-*` se generaron a partir de las mallas del atlas con un script que no forma parte de este repositorio.

## Limitaciones conocidas

- El corazón es un atlas **adulto** (BodyParts3D) escalado de forma uniforme al tamaño del paciente elegido: no reproduce las proporciones ni la orientación propias del lactante.
- Las puntuaciones Z solo incluyen por ahora los coeficientes PHN verificados (anillo mitral).
- No hay insuficiencias ni estenosis valvulares ni modo M.
- El latido, las velocidades y las lesiones son esquemáticos: sirven para aprender orientación y conceptos, no para medir.

## Licencias

- Anatomía y volúmenes derivados: Z-Anatomy (CC BY-SA 4.0), derivado de BodyParts3D / DBCLS (CC BY-SA 2.1 Japan). Ver `assets/LICENSE-anatomy.txt` y `LICENCIAS.txt`.
- three.js: MIT (`node_modules/three/LICENSE`).
- Volumen mitral 4D: datos de prueba públicos de [SlicerHeart](https://github.com/SlicerHeart/SlicerHeart/releases/tag/TestingData).
- Código de CardioLab: licencia pendiente de definir.
