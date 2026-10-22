# Resultados de la primera ejecucion del banco envios (2026-10-22)

Protocolo e hipotesis: ver ../README.md (fijados antes de ejecutar). Salidas puntuadas con score.mjs: score-r1/r2/r3/ctl.json. 27 revisiones, todas validas a la primera (18 fusiones y 6 controles + 3 de infraestructura incluidas), sin reintentos.

| Corrida | Recall | Reales | Inventados | Omision | Alarmas en inofensivos | Exceso |
|---|---|---|---|---|---|---|
| 1 | 18 de 18 | 9 de 9 | 9 de 9 | 4 de 4 | 0 de 6 | 1 |
| 2 | 18 de 18 | 9 de 9 | 9 de 9 | 4 de 4 | 0 de 6 | 2 |
| 3 | 17 de 18 (falta D06) | 9 de 9 | 8 de 9 | 3 de 4 | 0 de 6 | 2 |
| Control (sin foco) | 18 de 18 | 9 de 9 | 9 de 9 | 4 de 4 | 0 de 6 | 3 |

Los aciertos se revisaron a mano: cada hallazgo que cae en una ventana describe el defecto correcto (rule_id coherente), no es casualidad de ventanas anchas.

## Lectura honesta
- Las hipotesis H1 (recall bajo o moderado), H2 (reales mejor que inventados) y H3 (omision peor que comision) NO se sostienen: hay efecto techo. El banco es demasiado facil: PR de 18 a 28 lineas, un defecto cada pocas lineas y comentarios del propio codigo que lo delatan. No distingue el proceso completo del control ni los defectos reales de los inventados.
- Lo que si dice: ante defectos evidentes en diffs pequenos, el revisor los ve (y lo hace tambien sin foco). Cero falsas alarmas en los 6 cambios inofensivos.
- Contrasta con el piloto sobre codigo real (recall de 0 de 5 a 6 de 11): la dificultad esta en diffs grandes, defectos de omision de validacion y archivos no visibles, que este banco no incluye.

## Pendiente
Etiquetar el exceso (8 hallazgos entre corridas y controles, ver excessDetail en cada score-*.json). Hacer el banco mas dificil: PR de 150 a 300 lineas con ruido, defectos sin comentario delator, omisiones de validacion, y mezcla de cambios.

## Etiquetas del exceso (usuario, 2026-10-22)
El exceso (8 hallazgos) son 3 temas repetidos mas 1 duplicado:
| Tema | Veces | Etiqueta |
|---|---|---|
| Renombre de `totalUsd` a `total_usd` en un tipo exportado (cambio de contrato; nadie mas lo usa en el modulo) | 4 (PR 6, las 3 corridas y el control) | M |
| El PR 3 cambia el manejo de arreglos pero no anade tests de arreglos | 3 (PR 3) | **A** |
| El test nuevo consagra que cualquier origen (por ejemplo "fax") se acepte | 2 (PR 3) | M |
| La opcion `--moneda` no esta documentada en el README | 1 (control, PR 5) | Duplicado de D15, citado en la linea 29: **la ventana de D15 (lineas 23 a 27) fue demasiado estrecha**; no cuenta como exceso |

Precision del exceso: 1 accionable, 2 menores, 0 ruido (3 temas). Ninguno de los tres es una falsa alarma; son aspectos reales pegados a los defectos plantados.

## Cosas a corregir en el banco
- Ampliar la ventana de D15 para incluir el mensaje de uso (linea 29).
- El banco es demasiado facil (efecto techo): ver la lectura de arriba.
