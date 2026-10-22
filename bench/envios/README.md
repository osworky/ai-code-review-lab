# Banco de pruebas: envíos por zona y peso

Un módulo público y ficticio con defectos plantados y respuesta conocida, para medir un revisor de código con IA (aquí, la skill `ai-code-review`) sin usar código de nadie. Cualquiera puede construirlo y repetir la medición.

**Estado:** construido y verificado; **todavía no se ha ejecutado ningún revisor sobre él.** Este documento fija el protocolo y las hipótesis antes de ejecutar (2026-10-22).

## Qué hay
| Carpeta o archivo | Qué es |
|---|---|
| `base/` | El módulo limpio: tarifas, cotización, fechas, validación de una API pública, reporte, un script de Python y un workflow de CI. 19 tests |
| `prs/pr-1` … `prs/pr-6` | Seis cambios independientes sobre `base/`: archivos que reemplazan a los del base. Cada uno planta 3 defectos y 1 cambio inofensivo |
| `answer-key.json` | La respuesta conocida, con el defecto, su categoría, su origen y un texto ancla para localizarlo. **No se entrega a los revisores** |
| `build-repos.mjs` | Arma un repositorio git con `main` y las ramas `pr-1` … `pr-6`, y resuelve la clave a líneas (fuera del repositorio) |
| `check-citable.mjs` | Comprueba que cada defecto cae en una línea cambiada del diff (si no, un revisor no podría citarlo) |
| `score.mjs` | Puntúa las revisiones contra la clave **sin juicio humano** |

## Los defectos
18 defectos y 6 cambios inofensivos.

| | Correctness | Security | Performance | Missing tests | Style | Documentation | Total |
|---|---|---|---|---|---|---|---|
| Defectos | 4 | 5 | 3 | 2 | 2 | 2 | **18** |

**Mitad reales y mitad inventados.** 9 defectos reproducen, en este dominio ficticio, defectos que de verdad aparecieron en un proyecto real (por ejemplo, ordenar precios de monedas distintas sin convertir, arreglos anidados que eluden un filtro de claves reservadas, una lista de valores eliminada de una ruta pública, un secreto impreso en el registro de CI). Los otros 9 los inventó quien armó el banco (límite de peso exclusivo, comparar dinero en coma flotante con `===`, una ruta sin comprobar, permisos `write-all`, un recorrido que ordena dentro del bucle, números mágicos…). Cada defecto lleva `origin` (`real` o `invented`) y, si es real, su fuente en `source`.

**Por qué la mezcla.** Los prompts del revisor se redactaron con los defectos reales: medir su recall sobre ellos está inflado por esa fuga. Los inventados no pueden estarlo. **La diferencia de recall entre ambos grupos es una estimación directa de cuánto de la medición es fuga.**

**Dos tipos.** `commission`: el defecto está en una línea que el diff cambia. `omission`: es lo que falta en el cambio (un test, una actualización de la documentación). En un piloto anterior, el revisor no vio ninguno de los defectos de omisión de una API; el banco los incluye a propósito, aunque aquí son de tests y documentación, no de validación.

## Cómo se puntúa
Cada defecto lleva un texto ancla; `build-repos.mjs` lo convierte en la línea donde está en el archivo final y en una ventana de líneas. **Un hallazgo acierta si cita el archivo del defecto y una línea dentro de su ventana.** Un hallazgo que cae en la ventana de un cambio inofensivo es una falsa alarma. Todo lo demás es **exceso**: puede ser un problema real que nadie plantó, así que se lista para que una persona lo etiquete A, M o R; no se cuenta como error.

Se informa: recall total, por categoría, por origen (real frente a inventado) y por tipo; falsas alarmas sobre los cambios inofensivos; exceso; y los defectos no vistos.

## Protocolo (fijado antes de ejecutar)
1. Construir el repositorio: `node build-repos.mjs <carpeta nueva>`; comprobar con `check-citable.mjs`.
2. Para cada rama `pr-N`, ejecutar la skill `ai-code-review` contra `main` (un agente nuevo y aislado por bloque), **3 corridas por PR**, más **1 corrida de control por PR** con solo el prompt base (sin el foco de cada tipo). El repositorio lleva su propio `.ai-review/context.md`.
3. Puntuar con `score.mjs`, por corrida, por unión y por consenso (visto en al menos 2 de 3), y el solapamiento de hallazgos entre corridas.
4. Etiquetar el exceso A, M o R una vez terminadas todas las corridas.

## Hipótesis (descriptivas, sin umbral de aprobado)
- **H1.** El recall total será bajo o moderado, no cercano a 18 de 18.
- **H2.** El recall de los defectos reales superará al de los inventados (fuga del foco).
- **H3.** Los defectos de omisión (tests y documentación) se verán menos que los de comisión.
- **H4.** Los cambios inofensivos darán pocas falsas alarmas.
- **H5.** El solapamiento entre corridas del mismo PR será parcial (entre 0,3 y 0,7), como en el piloto.

Si los resultados contradicen alguna hipótesis, se publica igual.

## Verificaciones ya hechas
- Los 19 tests del base pasan y los de cada rama también (el PR 3 añade uno): **los defectos son silenciosos.** Dos tests del base se debilitaron a propósito (no distinguían una moneda de otra ni rechazaban el 30 de febrero) para que no delataran un defecto de golpe.
- Las 24 anclas (18 defectos y 6 inofensivos) caen en líneas cambiadas del diff y sus ventanas no se solapan (`check-citable.mjs`).
- El script de Python compila.

## Límites
- **Circularidad.** Los defectos los eligió el mismo tipo de modelo que los revisa. La mitad reales y la procedencia declarada lo atenúan; **no sustituyen la revisión de una persona.** Si alguien revisa la clave y añade sus propios defectos, esos entran como un séptimo PR marcado como aportado por una persona.
- 18 defectos son pocos: los intervalos serán anchos.
- Un dominio, tres lenguajes (TypeScript, Python y YAML), un modelo.
- Los defectos de estilo y documentación dependen de que el revisor decida comentarlos: el prompt de TypeScript le pide no comentar estilo salvo riesgo real, así que su recall bajo es en parte una elección del prompt.
- Los cambios son pequeños y limpios; un PR real mezcla más cosas.

## Reproducir
```
node build-repos.mjs ./envios-repo        # crea el repositorio y envios-repo.key.json fuera de él
node check-citable.mjs ./envios-repo ./envios-repo.key.json
# ... revisar cada rama con la skill y guardar la revisión fusionada como reviews/pr-N.json ...
node score.mjs ./envios-repo.key.json ./reviews --json resultado.json
```
