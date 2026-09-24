// Original teaching activities; references point to the official guideline, not a copied protocol.
export const COURSE_VERSION=1;
export const GUIDE={title:'ASE · Ecocardiografía pediátrica completa · 2024',url:'https://www.asecho.org/wp-content/uploads/2024/02/2024-Peds-TTE_PIIS0894731723006223.pdf',doi:'10.1016/j.echo.2023.11.015',localFileStatus:'La copia local indicada tenía 0 bytes. Se consultó la edición oficial de ASE; pendiente de confirmar que corresponde al documento solicitado.'};
export const WINDOW_GUIDANCE={
 subcostal:{position:'Paciente en decúbito supino; en niños mayores, flexionar las rodillas puede facilitar el acceso. Apoya la sonda bajo el xifoides.',marker:'Para el plano coronal, referencia de marcador a las 3: hacia la izquierda del paciente.',look:'Empieza reconociendo la referencia y explora con barridos cortos. El estudio de situs necesita además referencias abdominales ausentes de este atlas.'},
 plax:{position:'Habitualmente decúbito lateral izquierdo, con el brazo izquierdo elevado. Busca el acceso junto al borde esternal izquierdo.',marker:'Referencia a las 10: hacia el hombro derecho del paciente.',look:'Busca el eje largo del VI y la continuidad hacia la raíz aórtica. Ajusta contacto y angulación hasta reconocer la referencia; no fijes una profundidad universal.'},
 psax:{position:'Desde el acceso paraesternal izquierdo, conserva el contacto mientras ajustas la orientación.',marker:'Referencia a las 2: hacia el hombro izquierdo del paciente.',look:'Reconoce el nivel antes de seguir el barrido. Compara válvula aórtica, nivel mitral, músculos papilares y ápex en el estudio real.'},
 apical:{position:'Habitualmente decúbito lateral izquierdo, brazo izquierdo elevado. Busca el acceso lateral a nivel del ápex.',marker:'Referencia a las 3: hacia la izquierda del paciente.',look:'Busca ambas aurículas y ventrículos con las válvulas AV en el centro. Revisa que el plano alcance el ápex real antes de medir.'}
};
const q=(prompt,options,answer,explanation)=>({prompt,options,answer,explanation});
export const LESSONS=[
 {id:'prepare',title:'Antes de apoyar la sonda',group:'Preparación',page:5,section:'General principles · p. 123',preset:'plax',
  intro:'Primero formula qué necesitas conocer del corazón. Después decide cómo obtener imágenes que permitan responderlo.',
  points:['En la práctica clínica: confirmar identidad e indicación, explicar el examen y atender comodidad, posición y estabilidad.','Aquí trabajarás con un corazón adulto de referencia y una imagen eco simulada. Practicas orientación y conceptos; no examinas a un niño ni acreditas competencia clínica.'],
  task:'Observa las tres vistas. El contacto está a la izquierda, el plano anatómico en el centro y su sección a la derecha.',
  quiz:q('¿Qué acredita terminar este recorrido?',['Que puedes excluir una cardiopatía','Que has practicado sus actividades docentes','Que la ventana obtenida es diagnóstica'],1,'El progreso registra aprendizaje dentro de la aplicación. La adquisición e interpretación clínicas se aprenden y evalúan con supervisión.')},
 {id:'orientation',title:'Sonda, plano e imagen',group:'Primeros movimientos',page:6,section:'Orientación de imagen · p. 124',preset:'apical',rule:'orientation',
  intro:'El sector representa una lámina del corazón. Lo que queda fuera de esa lámina no aparece en el corte.',
  points:['El punto verde de la sonda corresponde al marcador verde de la imagen. En esta aplicación está a la derecha.','Compara «Pediátrica» y «Vértice arriba»: cambia la presentación vertical, no el plano ni la anatomía. La convención pediátrica coloca el vértice abajo en apical y subcostal.'],
  task:'Cambia entre ambas presentaciones y vuelve a Pediátrica. Mira el vértice y el marcador.',
  quiz:q('Al invertir la presentación vertical, ¿qué cambia?',['La posición física de la sonda','El corazón del paciente','La forma de mostrar el mismo corte'],2,'Separar presentación y adquisición evita confundir un cambio de pantalla con una maniobra de la sonda.')},
 {id:'moves',title:'Una maniobra cada vez',group:'Primeros movimientos',page:6,section:'Barridos · p. 124; ejercicios propios',preset:'plax',rule:'moves',
  intro:'Predice qué cambiará antes de mover un control. Luego comprueba tu predicción en las tres vistas.',
  points:['Desplazar cambia el punto de contacto. Rotar gira el marcador alrededor del haz.','Inclinar cambia el plano fuera del corte; bascular orienta el haz dentro del plano. Estos controles separan movimientos que tu mano puede combinar.'],
  task:'Desde el inicio del ejercicio: desplaza ≥5 mm, rota ≥20°, inclina ≥8° y bascula ≥8°. Hazlo con los controles; los umbrales son docentes, no clínicos.',
  quiz:q('¿Qué maniobra cambia el contacto sobre el tórax?',['Desplazar','Rotar en el mismo sitio','Cambiar la ganancia'],0,'Al deslizar la sonda cambia el origen del haz; observa cómo se desplaza también el sector sobre el corazón.')},
 {id:'quality',title:'Encuadrar antes de interpretar',group:'Calidad de imagen',page:10,section:'Tabla 7 · p. 128',preset:'plax',rule:'quality',
  intro:'Busca un campo que permita reconocer tu objetivo. Una imagen grande no siempre contiene más información útil.',
  points:['Prueba las perillas de la consola. Profundidad y sector cambian el campo; ganancia y TGC amplifican la señal (y el ruido); la frecuencia cambia resolución y penetración.','Observa las sombras: costillas y pulmón bloquean el haz. Una buena ventana empieza por un espacio intercostal libre.'],
  task:'Reduce el sector a 70° o menos y ajusta la profundidad a 16 cm o menos conservando alguna estructura en el campo. Es una práctica de encuadre, no un ajuste recomendado para pacientes.',
  quiz:q('¿Qué demuestra que aún aparezca una estructura?',['Que el estudio está completo','Que parte del atlas sigue dentro del sector','Que la ganancia clínica es correcta'],1,'El motor comprueba intersecciones. No evalúa si el endocardio se distingue adecuadamente en una ecografía real.')},
 {id:'subcostal',title:'Entrar desde subcostal',group:'Recorrido anatómico',page:12,section:'Tabla 9 · pp. 130–131',preset:'subcostal',rule:'tilt',
  intro:'Explora el corazón desde abajo y relaciona cada estructura con el recorrido del haz.',
  points:['En un examen real, esta familia de vistas permite estudiar situs y conexiones venosas, además de las cámaras y septos.','Este atlas no contiene un abdomen completo: no permite establecer situs visceral. El botón Subcostal es una orientación geométrica aproximada.'],
  task:'Inclina al menos 8° desde el punto de partida. Observa cómo entran o salen contornos; después restablece la ventana para compararla.',
  quiz:q('Si no ves una estructura en un corte, ¿qué puedes concluir?',['Que está ausente','Que es anormal','Que necesitas buscarla en otros planos'],2,'Un corte solo muestra lo que intersecta su plano. La ausencia en pantalla no demuestra ausencia anatómica.')},
 {id:'segments',title:'Seguir las conexiones',group:'Recorrido anatómico',page:19,section:'Segmental protocols · desde p. 137',preset:'plax',
  intro:'Aprende a describir relaciones, no solo siluetas. ¿De dónde llega la sangre y hacia dónde continúa?',
  points:['Guion de estudio: venas → aurículas → conexiones auriculoventriculares → ventrículos → salidas → grandes arterias.','La identidad de una cámara no se decide solo por estar a la derecha o izquierda de la pantalla. El atlas muestra una anatomía de referencia, no sus variantes congénitas.'],
  task:'Recorre mentalmente ambos circuitos y localiza las etiquetas disponibles debajo del simulador. No marques conexiones no vistas como normales.',
  quiz:q('Una conexión no documentada debería registrarse como…',['No evaluada o no concluyente, según corresponda','Normal porque otras vistas son normales','Ausente'],0,'Distinguir lo visto de lo no evaluado es parte del razonamiento y de la comunicación del estudio.')},
 {id:'plax',title:'Paraesternal: eje largo',group:'Ventanas',page:15,section:'Tabla 9 · p. 133',preset:'plax',rule:'plax',
  intro:'Usa las relaciones entre ventrículo izquierdo, aurícula izquierda y aorta para orientarte.',
  points:['En el paciente se busca un acceso junto al borde esternal izquierdo. El plano inicial se ajusta, no se acepta por su nombre.','Seleccionar un contorno enlaza 2D y 3D. El resaltado identifica una pieza del atlas; no identifica automáticamente tejidos en una eco real.'],
  task:'Pulsa las etiquetas «Ventrículo izquierdo» y «Aorta ascendente», una después de otra. También puedes seleccionarlas por sus contornos.',
  quiz:q('¿Basta con seleccionar «Paraesternal largo»?',['Sí, el nombre garantiza la ventana','No: hay que reconocer y optimizar el plano','Sí, si aparecen colores'],1,'Los puntos de partida de este modelo son aproximados. La calidad de una ventana clínica exige revisar los reparos anatómicos.')},
 {id:'psax',title:'Paraesternal: explorar niveles',group:'Ventanas',page:11,section:'Tabla 8 · p. 129',preset:'psax',rule:'tilt',
  intro:'Un eje corto es una familia de cortes. La pregunta es qué nivel del corazón está cruzando el haz.',
  points:['En una adquisición se exploran distintos niveles entre base y ápex. En este ejercicio observa qué cambia al desplazar el plano.','No confundas el cambio de nivel con el latido: pausa el latido (selector «Latido») para separar ambos efectos.'],
  task:'Inclina al menos 8° y compara con el inicio. Activa «Exponer corte» para comprender por qué cambia el contorno.',
  quiz:q('¿Qué hace el botón «Barrido»?',['Acelera el latido','Calcula el flujo coronario','Oscila la inclinación de la sonda y recorre planos'],2,'El barrido mueve el plano de corte; el latido es independiente y puede pausarse.')},
 {id:'apical',title:'Apical: relacionar las cámaras',group:'Ventanas',page:14,section:'Tabla 9 · p. 132',preset:'apical',rule:'apical',
  intro:'Observa los ventrículos y su relación con las aurículas desde el acceso apical aproximado.',
  points:['En el ecógrafo hay que reconocer el ápex real y evitar un plano que acorte artificialmente el ventrículo.','Las vistas de dos y tres cámaras requieren ajustes adicionales. Este modelo no ofrece aún referencias adjudicadas para esas ventanas.'],
  task:'Selecciona «Ventrículo izquierdo» y «Ventrículo derecho». Alterna la presentación vertical para comprobar que siguen siendo las mismas estructuras.',
  quiz:q('Un ventrículo aparentemente corto puede indicar…',['Un plano que no pasa por el ápex real','Siempre un ventrículo pequeño','Una medición válida sin más comprobaciones'],0,'La geometría del plano puede cambiar la longitud aparente. Es necesario revisar la adquisición antes de medir.')},
 {id:'suprasternal',title:'Lo que falta en cuatro ventanas',group:'Ventanas',page:17,section:'Tabla 9 · pp. 134–135',preset:'plax',
  intro:'Aprender un examen completo también significa reconocer qué no has adquirido.',
  points:['La ventana supraesternal y el acceso paraesternal alto aportan información adicional sobre grandes vasos.','Este simulador no tiene todavía una ventana supraesternal calibrada, un estudio completo de venas pulmonares ni coronarias. Ver la aorta en 3D no equivale a haberla evaluado.'],
  task:'Abre la referencia y revisa la posición de la sonda de la tabla 9. Esta lección es conceptual; no se registra como una adquisición.',
  quiz:q('¿Cuatro botones de ventanas equivalen a un examen pediátrico completo?',['Sí','No','Solo si el modelo se ve bien'],1,'El estudio completo exige cobertura anatómica, modalidades y documentación que van más allá de esta demostración.')},
 {id:'doppler',title:'Doppler: dirección y alineación',group:'Más allá del corte',page:6,section:'Doppler · p. 124',preset:'apical',rule:'doppler',
  intro:'La imagen bidimensional describe anatomía. Doppler aporta información sobre movimiento a lo largo del haz.',
  points:['Ejemplo matemático: v proyectada = v × cos(θ). Mantén v = 1 m/s y cambia el ángulo: la proyección disminuye hacia 90°.','PW localiza una muestra y puede presentar aliasing; CW registra a lo largo del haz. El color expresa dirección según el mapa, no oxigenación. Este laboratorio no mide flujo del corazón 3D.'],
  task:'Prueba 0°, 60° y 90° en el control de abajo. Los resultados pertenecen a un vector inventado, no a un paciente.',
  quiz:q('Con un ángulo de 60° y velocidad ilustrativa de 1 m/s, la proyección es…',['2 m/s','1 m/s','0,5 m/s'],2,'cos(60°) = 0,5. Una mala alineación puede subestimar la magnitud de la velocidad. No es una medición ni una corrección clínica.')},
 {id:'measure',title:'Antes de colocar un cáliper',group:'Más allá del corte',page:9,section:'Z scores · pp. 127–128',preset:'apical',
  intro:'Una cifra necesita una definición: estructura, plano, fase cardíaca, bordes y unidades.',
  points:['Una medición pediátrica se interpreta con referencias apropiadas; al comparar Z scores en el tiempo se debe conservar el modelo de referencia.','El ECG de la imagen marca la fase: la telediástole coincide con el QRS. El latido del simulador es esquemático y no tiene superficie corporal: no sirve para calcular FE ni Z scores.'],
  task:'Congela la imagen justo en el QRS del ECG y compara con un cuadro en sístole. Explica por qué la fase importa antes de medir.',
  quiz:q('¿Podemos calcular una fracción de eyección válida en este simulador?',['No: el movimiento es esquemático, no medido en un paciente','Sí, con una captura','Sí, aumentando la ganancia'],0,'El latido es un modelo docente. Una cifra calculada aquí daría una precisión que los datos no sostienen.')},
 {id:'artifacts',title:'No confundir ausencia y defecto',group:'Integración',page:7,section:'Septos y orientación · p. 125',preset:'subcostal',
  intro:'Cuando una estructura parece interrumpida, vuelve a la adquisición antes de interpretar.',
  points:['La pérdida de señal por orientación puede imitar una discontinuidad. Hay que contrastar planos y modalidades.','El simulador reproduce parte de este efecto: una pared paralela al haz devuelve menos señal. Compara el septo interauricular en apical y en subcostal.'],
  task:'Carga «CIA ostium secundum» en Cardiopatías y compara la vista apical con la subcostal: ¿dónde es convincente el defecto?',
  quiz:q('Un hueco en la malla del simulador demuestra…',['Una comunicación interventricular','Una limitación o intersección de la geometría, no un diagnóstico','Un flujo patológico'],1,'La geometría y la señal ecográfica son datos diferentes. Su interpretación requiere conocer cómo se produjeron.')},
 {id:'finish',title:'Revisar y documentar',group:'Integración',page:45,section:'Reporting y quality assurance · pp. 163–165',preset:'plax',rule:'review',
  intro:'Termina revisando la cobertura y las limitaciones. Una vista atractiva no resuelve por sí sola la pregunta inicial.',
  points:['El registro de este curso conserva ejercicios y respuestas. No contiene un informe de paciente ni certifica un estudio completo.','El siguiente entrenamiento debe usar clips reales identificados por ventana y revisión con un ecocardiografista.'],
  task:'Completa la revisión docente de abajo y descarga tu progreso si quieres conservarlo fuera de este navegador.',
  quiz:q('Si una parte del examen no pudo evaluarse, corresponde…',['Omitirla del informe','Asumir que es normal','Documentar la limitación y planificar cómo resolverla'],2,'La cobertura y las limitaciones deben quedar explícitas. Los hallazgos clínicos y su comunicación requieren revisión profesional.')}
];

export const REVIEW_ITEMS=[
 'Distingo presentación en pantalla de orientación física de la sonda.',
 'Puedo explicar cómo desplazar, rotar, inclinar y bascular cambian el corte.',
 'Sé que faltan situs abdominal, ventanas y modalidades para un estudio completo.',
 'Distingo un ejercicio geométrico de una adquisición o medición clínica.'
];

export function projectedVelocity(angle,speed=1){return speed*Math.cos(angle*Math.PI/180)}
export function practiceSteps(lesson,e){
 const checks={
  orientation:[['Comparar ambas presentaciones',e.orientations.size===2]],
  moves:[['Desplazar ≥5 mm',e.move>=.005-1e-8],['Rotar ≥20°',e.rotation>=20],['Inclinar ≥8°',e.tilt>=8],['Bascular ≥8°',e.rock>=8]],
  quality:[['Sector ≤70°, profundidad ≤16 cm y anatomía visible',e.quality]],
  tilt:[['Inclinar ≥8° desde el inicio',e.tilt>=8]],
  plax:[['Seleccionar ventrículo izquierdo',e.selected.has('Left ventricle')],['Seleccionar aorta ascendente',e.selected.has('Ascending aorta')]],
  apical:[['Seleccionar ventrículo izquierdo',e.selected.has('Left ventricle')],['Seleccionar ventrículo derecho',e.selected.has('Right ventricle')]],
  doppler:[['Comparar 0°, 60° y 90°', [0,60,90].every(a=>e.angles.has(a))]],
  review:REVIEW_ITEMS.map((label,i)=>[label,e.review.has(i)])
 };
 return checks[lesson.rule]||[];
}
