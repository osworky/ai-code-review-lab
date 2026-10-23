# Estado y próximos pasos

Fecha de corte: 2026-10-22. El lab cubre el ciclo completo en estructura y en herramientas, y ya se aplicó a un repositorio real. Lo que sigue es darle uso para reunir datos y medirlo mejor.

## Qué hay
| Área | Contenido | Estado |
|---|---|---|
| Método | `docs/guia.md` (conceptos e implementación), `docs/caso-de-estudio.md` (dos fases) | Escrito y actualizado |
| Prompts usados y medidos | `failure-modes`, `tests-3-layers`, `fix-red-tests`, `mutation-triage`, `naive-tests`, `reviewer` v1 y v2 | ✔ Primera fase |
| Prompts de borrador ya ejecutados | Red team, cadena de suministro, regla de Semgrep, auditoría y recorrido legacy, cuatro revisores y router, revisión diferencial, triaje de Semgrep, generador de política de calibración | ✔ Una corrida cada uno, con límites; siguen en un borrador de prompt (no publicado en esta versión) hasta repetirlos |
| Prompts sin ejecutar | Auditoría de aplicaciones con LLM | ◌ Aplazado: Traslados no usa ningún modelo; se hará sobre otro proyecto propio que sí use un modelo |
| Herramientas con pruebas | `validate_review`, `compare_mutation`, `review_policy`, `calibrate`, `regression_check`, `check_commit_msg` | ✔ |
| Herramientas que corrieron con datos reales | `audit_dependencies` (registro de npm, 61 dependencias) y los scripts de la evidencia privada del caso (termómetros, verificadores de citas, puntuación del piloto) | ✔ |
| Herramientas aún sin datos reales | `route_review`, `stability`, `calibrate` | Probadas con datos simulados; ver "Qué falta" |
| Sistema de revisión | `qa/review/` y `/review` en el repositorio del caso (privado), con CI que valida la revisión y no llama al modelo | ✔ Fase consultiva |
| Skill | `skills/ai-code-review/`: el mismo sistema portable (`.ai-review/` en el repo revisado, contexto por proyecto), con ledger y informe de precisión y recall | ✔ v0 con 168 tests y una prueba de punta a punta; sin datos reales propios todavía |
| Experimentos | los dos experimentos de la primera fase y los diez de la segunda (evidencia privada) | ✔ con límites declarados |
| Diseño | `design/revisor-en-ci.md`, `design/calibracion.md` | ◌ Parcialmente validado: lo que el CI valida y la fase consultiva se aplicaron; los umbrales siguen siendo propuestas |
| Material de estudio | las notas de estudio (no publicadas), las notas de estudio (no publicadas) | ◌ Apuntes de un curso |

## Qué falta para subir de fase
La política de calibración generada con datos reales (la evidencia privada del caso) lista las carencias. Con la evidencia actual no se cumple el umbral de 30 filas en ninguna categoría y la precisión amplia es del 79 % frente al 90 % propuesto para bloquear.

| # | Falta | Esfuerzo |
|---|---|---|
| 1 | Categoría de la rúbrica en cada etiqueta | Bajo: los archivos de revisión ya la traen |
| 2 | Casos donde el revisor calla: defectos sembrados y cambios inofensivos | Alto |
| 3 | Muestra aleatoria etiquetada antes de ver la salida del revisor | Medio |
| 4 | Decisiones en formato bloquear, avisar, pasar y una ejecución real de `calibrate.py` | Bajo, tras el 1 y el 3 |
| 5 | Un segundo etiquetador sobre una parte de la muestra | Medio |
| 6 | Más corridas y un conjunto fuera de la fuga del foco | Medio |
| 7 | Guía de etiquetado escrita (qué es A, M y R) | Bajo |
| 8 | Cubrir con mutación el módulo que decide la fase (61,7 %) y decidir qué hace una revisión desactualizada | Medio |

Dos límites que no son tareas: un solo modelo y un solo etiquetador no generalizan, y faltan la política de acción del equipo y el flujo que convierte un override en una fila.

## Otras carencias de evidencia
- Réplica del experimento de tests en otro módulo, con varias corridas por brazo.
- Segunda ronda: generar los brazos contra el código anterior, para quitar el sesgo del diseño.
- Revisión manual de mutantes equivalentes.
- Costo y latencia reales a lo largo de más corridas.
- Ejecutar de verdad el análisis estático con reglas ampliadas en CI y el auditor contra el registro con el árbol completo, no solo las dependencias directas.

## Reproducibilidad
El código bajo prueba del caso no está en el lab (es privado y contiene tarifas reales). Para que cualquiera pueda repetir el método de punta a punta falta el **módulo público sembrado** (siguiente bloque).

## Próximos pasos, en orden
1. **Actualizar el lab** *(hecho en esta pasada)*: caso de estudio, roadmap, guía y README al día con lo medido.
2. **Convertir el sistema en skill** *(hecho, v0)*: `skills/ai-code-review/`, consultiva, con registro automático de cada revisión (`ledger.jsonl`) y de lo que el humano decide con ella, y con el aviso de que no ve defectos de omisión ni de interfaz. Probada de punta a punta sobre otro repositorio (`experiments/skill-e2e/`). Falta usarla en proyectos reales para reunir datos.
3. **Módulo público sembrado:** un código pequeño con tarifas ficticias y defectos plantados con respuesta conocida (de clases públicas y de errores reales de los PR, no inventados al gusto), más casos inofensivos. Cierra el hueco de recall y de verdaderos negativos y permite repetir el método.
4. **Panel estático** de las métricas, generado desde el registro.
5. **Mejorar lo medido:** categoría por fila, segunda etiquetadora, muestra aleatoria y cubrir `policy.mjs` con mutación.
6. **Más fuentes de datos:** otros proyectos propios y pull requests públicos de otros proyectos cuyos arreglos posteriores se conocen (solo medición; no se publican hallazgos a sus responsables).
7. **Repo público anonimizado, guía personal y publicaciones:** al final, sobre cifras ya medidas.
8. **Subir de fase** solo cuando la calibración lo justifique; con la evidencia actual no se puede.

**Transversal:** publicar por hitos, con números y sus límites, y no antes de medir. Cada pieza nueva con su medición propia antes de darla por terminada, y una a la vez.
