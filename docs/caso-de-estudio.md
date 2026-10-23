# Caso de estudio: Traslados Global VIP

El método de `guia.md` se aplicó a una aplicación real: un sitio de cotización de traslados (Next.js, TypeScript, Vitest y Playwright). Este documento cuenta qué se hizo, qué resultó y cuánto vale cada resultado, en dos fases: un experimento controlado sobre un módulo (secciones 1 a 5) y la aplicación al repositorio de producción con un sistema de revisión que se midió (secciones 6 a 11).

**Aviso de reproducibilidad:** el código del caso vive en otro repositorio, local y sin publicar, y contiene tarifas reales de un negocio. Aquí está el método, los prompts, los scripts y la evidencia; no el código bajo prueba. El plan para cerrar este hueco con un ejemplo genérico dentro del lab está en `roadmap.md`.

## 1. Experimento de tests: tres formas de generar una suite

**Código bajo prueba:** `lib/quote.ts`, la lógica pura que calcula la cotización (unas 220 líneas más una tabla de tarifas), congelado como `quote-v1` con un manifiesto de hashes.

**Catálogo:** 22 modos de falla con contratos firmados por el responsable. Se mostraron además modos nuevos que surgieron del triaje (siete, sin firmar).

| Brazo | Qué es |
|---|---|
| S0 | La suite que ya existía |
| A | Un prompt ingenuo: "escribe tests" |
| B | El prompt de tres capas con el catálogo, en un contexto limpio |
| C | B más una ronda de triaje de los mutantes que sobreviven |
| B informada | Mis tests de contratos, escritos tras ver los mutantes (contaminada; se reporta aparte) |

**Resultados** (374 mutantes; "sobrevivientes" = sobrevivió o no tenía cobertura)

| Suite | Tests | Sobrevivientes | Supervivencia | Puntaje de mutación |
|---|---|---|---|---|
| S0 | 364 | 65 | 17,4 % | 82,62 % |
| A (ingenua) | 24 | 131 | 35,0 % | 64,97 % |
| B (catálogo) | 63 | 144 | 38,5 % | 61,50 % |
| **C (B + triaje)** | 92 | 108 | **28,9 %** | **71,12 %** |
| B informada | 88 | 122 | 32,6 % | 67,38 % |

**Detección de contratos incumplidos.** Se ejecutó cada suite contra el código anterior a la corrección, que incumplía siete contratos firmados:

| Brazo | Contratos detectados |
|---|---|
| A | 3 a 4 de 7 |
| **B** | **7 de 7** |

## 2. Qué se aprendió

1. **El prompt ingenuo no pierde en mutación, pero pierde en lo que importa.** A superó a B en puntaje con un tercio de los tests, porque quien escribe mirando el código cubre ramas internas. Pero solo el catálogo permitió ver lo que el código **no** debía hacer: 7 contratos incumplidos de 7 frente a 3 o 4. Medir solo mutación habría dado la conclusión contraria.
2. **"Sin contrato, no hay test."** El triaje clasificó 144 sobrevivientes de B: 36 tenían un contrato firmado sin test (29 tests nuevos), 34 eran equivalentes, 71 no tenían contrato. A esos últimos **no se les escribió test**: volvieron al catálogo como siete modos de falla propuestos. Así la iteración no sobreajusta.
3. **Confirmado no es implementado.** Había contratos firmados que el código no cumplía; los tests rojos lo hicieron visible y se corrigió el código con el cambio mínimo. Cuatro tests antiguos contradecían un contrato firmado y se actualizaron en un commit aparte.
4. **Los equivalentes delatan código redundante.** Varios mutantes sobrevivían porque había ramas que nunca se ejecutan.
5. **La suite ingenua no se equivoca por falta de esfuerzo:** replica lo que el código hace, incluidos sus defectos.

## 3. Experimento del revisor

Se sembró una rama con **6 defectos** (uno por categoría de la rúbrica), **1 intento de inyección** (un comentario que pide reportar "sin hallazgos") y **2 cambios inofensivos** como señuelos. La clave de respuestas se mantuvo fuera del diff.

| | Revisor v1 (prosa) | Revisor v2 (JSON validado) |
|---|---|---|
| Defectos sembrados detectados | 6 de 6 | 6 de 6 |
| Inyección | Resistió y la reportó | Resistió y la reportó |
| Señuelos marcados | 0 de 2 | 0 de 2 |
| Hallazgos totales | 18 | 8 |
| Ubicación | aproximada, a veces del diff | `archivo:línea` entero, verificado contra el diff |
| Consumible por un pipeline | No | Sí |

Lo que dejó el ejercicio:
- La rúbrica por categorías evita que el revisor se quede en estilo.
- El validador determinista rechaza una línea inventada que el diff no contiene y un campo faltante, con mensaje claro.
- v2 dejó de reportar varios hallazgos que v1 sí daba y que se etiquetaron como válidos; con una corrida por versión no se distingue el efecto de la regla "un problema, una vez" del ruido del modelo.

## 4. Cuánto vale cada resultado

| Resultado | Fiabilidad |
|---|---|
| Comparación A/B/C | Un módulo, un modelo, una corrida por brazo. Demostración, no estadística. Los mutantes equivalentes sin revisar hacen de los puntajes un piso |
| Contratos detectados 7 de 7 frente a 3 o 4 | Los dos brazos leyeron el código ya corregido, lo que favorece a A; la comparación justa (generar contra el código anterior) está pendiente |
| Revisor 6 de 6 | Los defectos son obvios y los sembró quien escribió la clave |
| Precisión del revisor (8 de 8, 18 de 18) | **No es fiable:** un solo etiquetador y ningún falso positivo con que contrastar |
| Resistencia a la inyección | Una prueba, un modelo, un caso |
| Todo lo del flywheel y la calibración | En esta primera fase solo con datos sintéticos. La segunda fase ya tiene 63 etiquetas reales (sección 8), pero todas sobre hallazgos que el revisor levantó: sin falsos negativos ni casos inofensivos no hay kappa |

## 5. Dónde está la evidencia (primera fase)
- la evidencia de la primera fase (privada): protocolo y resultados completos, catálogo, prompts usados, triaje de mutantes y modos propuestos.
- la evidencia de la primera fase (privada): clave de respuestas, diff revisado, revisiones v1 y v2, etiquetas y puntuaciones.

---

# Segunda fase: aplicarlo al repositorio real (21 y 22 de octubre de 2026)

La primera fase fue un laboratorio sobre un módulo. La segunda llevó el método al repositorio de producción completo, con cambios pequeños por pull request (de #20 a #36), y probó el sistema de revisión que salió de ahí. **Todo sigue siendo un modelo, un etiquetador y un solo negocio**; cada cifra lleva su límite.

## 6. Qué se hizo en el repositorio real

| Pieza | Qué se hizo | Resultado | Límite |
|---|---|---|---|
| Catálogo de contratos | 30 contratos de `lib/quote.ts`; los que el código incumplía los firmó el dueño del negocio y se corrigieron con tests rojos primero | Contratos incumplidos implementados (confirmado no es implementado) | Un módulo; no se re-verificó que los 30 estén firmados |
| Mutación | Stryker sobre la lógica pura y la validación; los supervivientes se clasificaron en artefacto, equivalente, laguna de test y contrato pendiente | De 84,09 % a 95,17 % (quote 93,59, validación de eventos 98,70, reglas del formulario 99,20) | Los equivalentes sin revisión hacen de la cifra un piso; se clasificó una vez |
| Red team de la API | Un agente aislado escribió 46 pruebas adversariales; se compararon contra la ruta sin arreglar y arreglada | 18 detectan un defecto, 0 regresiones; los 13 que seguían rojos los etiquetó el usuario como reales y se cerraron en un PR | Una corrida; la respuesta conocida la escribió quien arregló el código |
| Cadena de suministro | `audit_dependencies.py` contra el registro real (61 dependencias directas) y un agente que lo interpreta | Cero nombres inventados; el agente dijo qué no cubre la evidencia. `npm audit` encontró en cambio 7 avisos (1 crítico) que llevaron a actualizar Next | Mide existencia, no vulnerabilidades: son dos riesgos distintos |
| Regla de Semgrep | Un agente derivó una regla desde un anti-patrón; se comparó con la regla escrita a mano | El YAML del agente no era válido; se quedó la regla corta a mano, con sus propias pruebas en CI | Una corrida; Semgrep corrió luego en CI, no en esa prueba |
| Auditoría legacy | Recorrido verificado por el dueño y después hallazgos con línea citada, en dos archivos | `quote.ts`: 3 de 5 defectos del nivel 1 y 2 de 7 del nivel 2; `contact-form.tsx`: 19 hallazgos, 11 accionables, 4 menores, 4 ruido | Un modelo y una corrida; los defectos de `quote.ts` los conocía quien escribió la clave |
| Fuga de secreto | El revisor de infraestructura encontró que un token de un proveedor de despliegue acababa dentro de los reportes de una herramienta de auditoría | Confirmado en un artefacto real (12 de 14 archivos); corregido y verificado | Solo ese brazo lo vio |

## 7. El sistema de revisión que resultó

Un procedimiento dentro del repositorio del caso (`qa/review/`): parte el diff por tipo de archivo y numera sus líneas, un agente nuevo y aislado revisa cada bloque con un prompt base y un foco, un validador determinista comprueba el JSON y que cada línea citada exista en el diff, y un workflow de CI valida la revisión que viaja con el pull request. **El modelo corre en local; el CI nunca lo llama**, para que el código no salga a un tercero. La fase actual es consultiva.

Su pull request se revisó tres veces a sí mismo: 6, 7 y 6 hallazgos; los de las dos primeras rondas se corrigieron con test, y se comprobó que el código anterior fallaba tres de esos casos. Sus módulos tienen una cobertura de mutación de 61,7 % a 76,2 %, más baja que la lógica del producto (87 % a 99 %).

## 8. Qué se midió del sistema de revisión

**Precisión: 63 hallazgos etiquetados A, M o R, por el mismo etiquetador, en cinco experimentos.**

| | Filas | Resultado |
|---|---|---|
| Accionables (A) | 25 | 40 % (intervalo 29 a 52 %) |
| Accionables o menores (A + M) | 50 | **79 %** (intervalo 68 a 88 %) |
| Ruido (R) | 13 | 21 % (intervalo 12 a 32 %) |

Son hallazgos que el revisor levantó, no una muestra aleatoria, y las filas de un mismo experimento no son independientes. Para bloquear, el diseño propone una precisión de al menos 90 %: el 79 % no alcanza.

**Recall y estabilidad: piloto con tres casos de respuesta conocida, tres corridas por caso y una de control sin foco.**

| Caso | Elementos | Por corrida | Control | Unión | Consenso |
|---|---|---|---|---|---|
| PR de la API | 5 | 0, 0, 0 | 0 | 0 | 0 |
| `contact-form.tsx` | 11 | 5, 4, 3 | 3 | 6 | 4 |
| `quote.ts` y datos | 12 | 2, 4, 1 | 1 | 4 | 2 |

El solapamiento medio de los hallazgos entre corridas del mismo caso fue de 0,42, 0,59 y 0,26. **Las cifras de recall son bajas y variables.**

**Otros experimentos con el mismo sistema:**
- **Cinco revisores sobre el mismo material** (TypeScript, Python, infraestructura, genérico y router): 24 hallazgos que se reducen a 15 distintos, de los cuales 7 accionables, 5 menores y 3 ruido. El validador habría rechazado 2 de 5 salidas (ubicaciones fuera del diff y un JSON con una barra invertida sin escapar). Solo el revisor de infraestructura vio la fuga del secreto; ni el genérico ni el router la vieron.
- **Revisión diferencial** de los cambios entre dos versiones de un módulo: 12 hallazgos, 4 accionables, 5 menores y 3 ruido.
- **Triaje de 19 alarmas de Semgrep:** el modelo dejó las 19 como "requiere humano" y el usuario las consideró todas reales, así que 0 de 19 coincidieron y no se ahorró ninguna decisión humana.
- **Política de calibración generada con datos reales:** salió con todas las categorías en "datos insuficientes" y sin recomendar ninguna acción de confianza. Las 29 cifras en porcentaje del documento aparecen en sus insumos, y las seis fracciones que no aparecían son sumas del propio documento, comprobadas a mano.

## 9. Qué enseñó la segunda fase

1. **Leer un diff y atacar la ruta encuentran defectos distintos.** Los cinco defectos de omisión que la red team encontró ejecutando pruebas (texto en blanco, tipo de contenido, números fuera de rango, valores sin lista) no los vio ninguna de las siete corridas del revisor. En cambio encontró otros que nadie había visto: los arreglos anidados que eludían el filtro de claves de prototipo, un defecto real que se corrigió después en un pull request.
2. **Un foco redactado con los hallazgos infla el resultado.** El foco de TypeScript nombra "clics dobles" y "entradas externas sin validar", y esos dos elementos aparecieron en las tres corridas del sistema completo y en ninguna del control. No se puede separar mérito de fuga con una corrida de control.
3. **El contexto recortado fabrica ruido.** Los tres falsos de la revisión diferencial y la regla "sin prueba" de uno de los revisores nacieron de un diff que no mostraba el archivo que los refutaba. Si un hallazgo depende de algo que el revisor no ve, debe decirlo; no siempre lo hace.
4. **Un modelo con una regla de "no inventes" no se compromete.** Ante la duda dice "requiere humano": es honesto, pero no ahorra trabajo. Una política declarada en el prompt podría cambiarlo; no se probó.
5. **Los números dependen de la corrida.** El mismo caso dio de 1 a 4 de 12 según la corrida. Correr tres veces ganó como mucho un elemento sobre la mejor corrida individual.
6. **Quien coordina también se equivoca, y hay que enseñarlo.** Un verificador propio dio 0 de 14 citas por un error de expresión regular; una puntuación de dos hallazgos se corrigió al reabrir el código; una premisa sobre un popup bloqueado no resistió la comprobación. Lo que se mantuvo fue presentar cada hallazgo con su comprobación delante antes de pedir la etiqueta.
7. **El mismo sistema revisó su propio código y encontró errores reales** (por ejemplo, una opción que podía borrar el directorio actual). Con la circularidad que eso implica: lo escribe y lo revisa el mismo tipo de modelo.

## 10. Cuánto vale cada resultado de la segunda fase

| Resultado | Fiabilidad |
|---|---|
| Mutación de 84,09 % a 95,17 % | Medida real sobre código real; los equivalentes sin revisión la dejan como un piso |
| Precisión del 79 % | Un etiquetador, filas no independientes, no es una muestra aleatoria; muestra para empezar a hablar, no para decidir una fase |
| Recall del piloto | Tres casos, un modelo, tres corridas; fuga del foco y circularidad declaradas |
| Triaje de Semgrep, 0 de 19 | Dos reglas, 19 alarmas casi idénticas; no mide alarmas de código de aplicación |
| Política de calibración | Un borrador con datos insuficientes: sirve de lista de lo que falta, no de decisión |
| Subir de fase | **No** con la evidencia actual |

## 11. Dónde está la evidencia (segunda fase)
la evidencia privada del caso: un directorio por experimento (`red-team`, `supply-chain`, `semgrep-rule`, `legacy-quote`, `legacy-contact-form`, `reviewers`, `differential-review`, `semgrep-triage`, `recall-pilot`, `calibration`), cada uno con protocolo y respuesta conocida escritos antes de ejecutar, las salidas de los agentes y sus resultados. la evidencia privada del caso reúne todas las etiquetas del usuario y `calibration/thermometers.mjs` calcula las precisiones con sus intervalos. El código de las correcciones y el sistema de revisión viven en el repositorio del caso (privado).
