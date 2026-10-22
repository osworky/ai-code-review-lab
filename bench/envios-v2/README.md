# Banco de pruebas v2: envíos por zona y peso (más difícil)

Misma idea que `../envios/` (módulo ficticio, defectos plantados, respuesta conocida y puntuación automática), pero construido para evitar el **efecto techo** de la v1, donde el revisor encontró 18 de 18 defectos con y sin foco.

**Estado:** construido y verificado; **todavía no se ha ejecutado ningún revisor sobre él.** Hipótesis fijadas antes de ejecutar (2026-10-22).

## Qué cambia respecto de la v1
| | v1 | v2 |
|---|---|---|
| PR | 6, de 18 a 28 líneas cambiadas | 4, de 68 a 108 líneas cambiadas |
| Defectos | 18 (3 por PR) | 12 (2 a 4 por PR), con menos densidad |
| Comentarios que delatan | Varios ("aceptamos cualquier canal nuevo", "corrección: ...") | Ninguno: el código no explica el defecto |
| Omisiones | Tests y documentación | **Validaciones que faltan**, que solo se ven comparando con otra función del mismo archivo (cotizar frente a cotizarLote, etiqueta frente a nota) |
| Cambios inofensivos | 6 | 8, mezclados con el código nuevo |
| Dónde viven los defectos | Una línea cambiada | Código nuevo de 50 a 70 líneas por archivo; a veces repartido entre una función y su llamador |

## Los defectos (12: 6 reales y 6 inventados)
| | Correctness | Security | Performance | Missing tests |
|---|---|---|---|---|
| Defectos | 5 | 5 | 1 | 1 |

(La v2 deja fuera estilo y documentación, que dependen del criterio del prompt y no discriminaban.)

- **Reales (6):** orden por precio entre monedas sin convertir, función pública nueva sin test, fecha de hoy calculada en UTC, campo de texto sin validar frente a otro que sí se valida, ruta que no exige el tipo de contenido, workflow `pull_request_target` con el código del PR y un secreto.
- **Inventados (6):** descuento con `>` en vez de `>=`, lote que no valida sus líneas, función que modifica el `Date` que recibe, `Set` armado en cada llamada, error que devuelve el texto rechazado tal cual, inyección de comandos con `shell=True`.
- `origin` y `source` de cada defecto están en `answer-key.json`.

## Cómo se puntúa
Igual que en la v1: cada defecto lleva un texto ancla, `build-repos.mjs` lo convierte en la línea y en una ventana, y `score.mjs` cuenta un acierto si el hallazgo cita ese archivo y una línea de la ventana. Un defecto puede tener varias ventanas (`also`). Lo que cae en una ventana inofensiva es una falsa alarma; lo demás es exceso para etiquetar.

## Protocolo (fijado antes de ejecutar)
1. `node build-repos.mjs <carpeta nueva>` y `node check-citable.mjs`.
2. Por cada rama `pr-N`: la skill `ai-code-review` contra `main`, **3 corridas** con agentes aislados, más **1 control** con solo el prompt base.
3. Puntuar con `score.mjs`: por corrida, unión y consenso; por categoría, origen y tipo.
4. Etiquetar el exceso (A, M o R) al final.

## Hipótesis (descriptivas, sin umbral de aprobado)
- **H1.** El recall bajará frente a la v1 (18 de 18) porque ya no hay comentarios que delaten ni defectos cada pocas líneas. Si sigue en 11 de 12 o más, el banco continúa siendo demasiado fácil.
- **H2.** Los defectos reales (los que el foco conoce) se verán más que los inventados.
- **H3.** Las omisiones (E04, E08, E09, E03) se verán menos que los defectos de comisión.
- **H4.** El control sin foco verá menos defectos que el proceso completo, sobre todo los reales.
- **H5.** El solapamiento entre corridas será mayor que 0,3.

Si los resultados contradicen alguna, se publica igual. **Criterio de fallo del banco:** si el recall vuelve a ser casi perfecto en el control, el banco no discrimina y hay que endurecerlo otra vez.

## Verificaciones ya hechas
- Los tests pasan en el base y en las cuatro ramas: los defectos son silenciosos.
- Las 20 anclas (12 defectos y 8 cambios inofensivos) caen en líneas cambiadas y sus ventanas no se solapan.
- El Python compila.

## Límites
- 12 defectos son pocos: intervalos anchos. Los PR siguen siendo pequeños frente a un PR real (de 68 a 108 líneas, no de 300).
- La circularidad persiste: los defectos los eligió el mismo tipo de modelo que los revisa; la mitad reales y la procedencia declarada la atenúan, no la eliminan.
- Un dominio, tres lenguajes, un modelo.

## Reproducir
```
node build-repos.mjs ./envios2-repo          # crea el repositorio y envios2-repo.key.json fuera de él
node check-citable.mjs ./envios2-repo ./envios2-repo.key.json
# ... revisar cada rama con la skill ...
node score.mjs ./envios2-repo.key.json ./reviews --json resultado.json
```
