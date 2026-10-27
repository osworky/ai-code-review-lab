# Resultados de la primera ejecución del banco envíos v2 (2026-10-24)

Protocolo e hipótesis: ver `../README.md` (fijados antes de ejecutar, el 2026-10-22). Salidas puntuadas con `score.mjs`: `score-r1/r2/r3/ctl.json` (el texto de cada una está en `score-*.txt`). 20 revisiones de agentes aislados (cada uno con solo el prompt base, el foco de su tipo de archivo, la rúbrica, el esquema y el diff), todas válidas a la primera y fusionadas por la skill. Un modelo, 4 PR, 12 defectos, 8 cambios inofensivos.

| Corrida | Recall | Reales | Inventados | Omisión | Comisión | Alarmas en inofensivos | Exceso |
|---|---|---|---|---|---|---|---|
| 1 | 11 de 12 | 5 de 6 | 6 de 6 | 3 de 4 | 8 de 8 | 0 de 8 | 5 |
| 2 | 11 de 12 | 5 de 6 | 6 de 6 | 3 de 4 | 8 de 8 | 0 de 8 | 5 |
| 3 | 10 de 12 | 5 de 6 | 5 de 6 | 3 de 4 | 7 de 8 | 0 de 8 | 5 |
| Control (sin foco) | 11 de 12 | 5 de 6 | 6 de 6 | 3 de 4 | 8 de 8 | **1 de 8** | 4 |

Unión de las tres corridas: 11 de 12. Consenso (visto en al menos 2 de 3): 11 de 12. Solapamiento de hallazgos entre corridas del mismo PR, de 0,89 a 1,0 (mismo archivo, a 5 líneas o menos).

**Defectos no vistos.** E03 (función pública nueva sin ningún test) no lo vio ninguna corrida. E07 (`Set` armado en cada llamada, dentro de bucles) lo falló solo la corrida 3.

## Lectura honesta
- **El banco sigue siendo demasiado fácil.** El control sin foco ve 11 de 12, igual que las corridas con foco. El criterio de fallo del README se cumple: *«si el recall vuelve a ser casi perfecto en el control, el banco no discrimina»*. Bajó de 18 de 18 a 11 de 12, pero no lo suficiente para comparar el proceso completo con el control.
- **E03 es un fallo de puntuación, no de lectura.** Las cuatro revisiones de ese PR (tres corridas y el control) escriben que `resumenLote` no tiene tests, pero citan `tests/paquetes.test.ts` y no `src/paquetes.ts`, que es donde está la ventana del defecto. Con la regla estricta cuenta como no visto; leyendo los hallazgos, el revisor lo vio. Es el mismo problema de ventana estrecha que tuvo la D15 en la v1. **No se cambió la regla después de ver los datos**: se publica el 11 de 12 estricto y se dice que, leído a mano, serían 12 de 12.
- **El solapamiento es casi total.** Entre corridas del mismo PR coinciden de 0,89 a 1,0, mucho más que el 0,26 a 0,59 del piloto sobre código real. Un diff pequeño y limpio produce casi la misma revisión cada vez.
- **La alarma sobre un cambio inofensivo apareció en el control, no en las corridas con foco:** T08 (imports sin ordenar, PR 4). Una sola observación; no permite concluir nada.

## Hipótesis
| | Resultado |
|---|---|
| H1. El recall bajará frente a la v1 (18 de 18); si sigue en 11 de 12 o más, el banco continúa siendo demasiado fácil | Bajó a 11, 11 y 10 de 12, pero el control también da 11: **el banco continúa demasiado fácil** |
| H2. Los reales (que el foco conoce) se verán más que los inventados | **No se sostiene**: reales 5 de 6 e inventados 6 de 6 (5 de 6 y 5 de 6 en la corrida 3) |
| H3. Las omisiones se verán menos que las comisiones | **Se sostiene débilmente**: 3 de 4 frente a 8 de 8 (7 de 8 en la corrida 3); y la única omisión no vista es el artefacto de E03 |
| H4. El control verá menos que el proceso completo, sobre todo los reales | **No se sostiene**: el control iguala a las corridas con foco |
| H5. El solapamiento entre corridas será mayor que 0,3 | **Se sostiene**, y de sobra (0,89 a 1,0) |

## Exceso (a etiquetar por una persona)
Son 19 hallazgos que no caen en ningún defecto ni en ningún cambio inofensivo, que se reducen a **6 temas**. No se cuentan como errores: pueden ser problemas reales que nadie plantó. Etiquetas pendientes (A real y accionable, M real pero menor, R ruido).

| # | PR | Tema | Corridas | Etiqueta |
|---|---|---|---|---|
| 1 | 1 | Los tests del descuento solo prueban 1 y 40 (no los umbrales 5 y 20), ni monedas distintas, ni `resumenLote` | r1, r2, r3, ctl | pendiente |
| 2 | 2 | La lista de feriados solo cubre 2026 | r1, r2, r3, ctl | pendiente |
| 3 | 2 | `hoyIso` y `pedidoVigente` no tienen tests | r1, r2, r3, ctl | pendiente |
| 4 | 2 | `fechaDeEntrega` no tiene un máximo para `dias`: un valor enorme ejecuta un bucle enorme | r2, r3 | pendiente |
| 5 | 3 | Los tests no cubren la validación de `nota` (tipo), etiquetas largas o con control, ni un evento inválido dentro del lote | r1, r2, r3, ctl | pendiente |
| 6 | 4 | `comprimir_tarifas.py`: el argumento no se limita a `data/` (ruta fuera del directorio) | r1 | pendiente |

## Límites
12 defectos y 4 PR pequeños (de 68 a 108 líneas): intervalos muy anchos. Un modelo, un dominio, una sola ejecución de 3 corridas más 1 control. La circularidad persiste: los defectos y el revisor son del mismo tipo de modelo. El banco no sirve para decidir si el foco ayuda; para eso habría que endurecerlo otra vez (PR de 150 a 300 líneas con ruido, o defectos repartidos entre varios archivos).

## Cosas a corregir en el banco
- Ampliar la ventana de E03 para incluir `tests/paquetes.test.ts` (ahí se citan los tests que faltan).
- Endurecer el banco (ver Límites) antes de volver a ejecutarlo.
