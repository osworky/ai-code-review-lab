# Guía: IA en pruebas y revisión de código

Una guía de estudio y de implementación, pensada para llevarla a otro código. No depende de un proyecto concreto: los resultados medidos en uno real están en `caso-de-estudio.md`.

**Cómo leerla**
- Para **estudiar**: secciones 1, 2, 6 y 7 (principios, mapa, medición y glosario).
- Para **implementar**: secciones 3, 4, 5, 8 y 9 (pasos, plantillas, decisiones y adopción).

Marcas de estado de cada pieza del lab: **✔ usado y medido** (se ejecutó y tiene resultados), **◌ diseño** (pensado, sin ejecutar). Las herramientas citadas (Stryker, Semgrep, etc.) son ejemplos: sirve cualquier equivalente.

---

## 1. Principios

1. **La IA abarata producir, no transfiere la responsabilidad.** Pasas de consumidor a editor: los contratos los decides tú.
2. **Primero la rúbrica, luego el prompt.** Sin categorías nombradas, la IA comenta lo más abundante: el estilo.
3. **El prompt es código:** versionado, por pull request y con registro de quién aprobó.
4. **Se mide antes de automatizar.** Mutantes para los tests; acuerdo con humanos para el revisor.
5. **Lo que decide se valida sin IA:** un script determinista, no otro modelo.
6. **Un contrato por modo de falla.** Si el negocio no decidió, queda "pendiente de decisión" y no se convierte en test.
7. **Toda cifra lleva su límite** (cuántos módulos, cuántas corridas, cuántos etiquetadores).

## 2. Mapa

```
 PISTA 1: tests                         PISTA 2: revisión de código
 módulo congelado                       rúbrica de categorías
   -> catálogo de modos de falla          -> rama con defectos sembrados
   -> contratos firmados                  -> revisor en prosa -> JSON validado
   -> tests de lo confirmado              -> router y política por fase
   -> mutation testing y triaje           -> CI en shadow -> calibración
   -> experimento controlado              -> flywheel con historial humano
                  \                      /
                   PISTA 3: seguridad (transversal)
        SAST + IA · red team · dependencias · seguridad de LLM
```

---

## 3. Pista 1: tests con IA

| # | Paso | Entregable | Prompt o script del lab | Estado |
|---|---|---|---|---|
| 1 | Elegir un módulo con lógica pura y **congelarlo** con un hash | manifiesto | (por proyecto) | ✔ |
| 2 | **Descubrir antes de escribir:** modos de falla por frontera, equivalencia, vacío y contrato de negocio, con `archivo:línea` | catálogo | `prompts/failure-modes` | ✔ |
| 3 | Un humano **firma** cada contrato pendiente, con fecha | catálogo firmado | tú | ✔ |
| 4 | Generar tests **solo de los contratos confirmados**: AAA, un ID por test | suite | `prompts/tests-3-layers` | ✔ |
| 5 | Los tests **rojos** señalan código por corregir: cambio mínimo, sin tocar tests ni catálogo | código alineado | `prompts/fix-red-tests` | ✔ |
| 6 | **Mutation testing**: puntaje y supervivencia | informe | herramienta de mutación | ✔ |
| 7 | **Triaje de sobrevivientes**: equivalente, contrato firmado sin test, o sin contrato | tests nuevos y modos propuestos | `prompts/mutation-triage` | ✔ |
| 8 | **Experimento controlado** entre prompts: mismo código congelado, mismas métricas | tabla por brazo | `scripts/compare_mutation.py` | ✔ |
| 9 | Pruebas adversariales ancladas a OWASP | suite roja | un borrador de prompt (no publicado en esta versión) | ◌ |

**Plantilla de una entrada de catálogo**
```
ID: B1                         Categoría: frontera | equivalencia | vacío | contrato
Riesgo: alto | medio | bajo
Entrada que lo dispara: ...
Comportamiento observado: ...  (cita archivo:línea y verifícalo ejecutando)
Contrato esperado: ...
Estado: confirmado | pendiente de decisión
Decisión: <qué se decidió, quién, cuándo>     (solo si está confirmado)
Por qué importa: ...
```

**Reglas que evitan el autoengaño**
- No asumas que el código actual es correcto: convertirlo en especificación vuelve requisitos a los bugs.
- Un test que fija un detalle sin contrato es un defecto, aunque mate un mutante.
- "Confirmado" significa decidido, **no** implementado: los tests rojos lo hacen visible.
- Un test viejo que contradice un contrato firmado se actualiza en un commit aparte y se dice.
- Una vulnerabilidad conocida se marca como **fallo esperado** para no romper el CI, y avisa cuando se corrige.

**Cómo comparar suites.** No bastan los mutantes muertos: mide también cuántos contratos incumplidos detecta cada suite contra el código anterior a corregirlo. Una suite escrita mirando el código describe lo que el código hace; solo el catálogo permite ver lo que no debería hacer.

## 4. Pista 2: revisión de código con IA

| # | Paso | Entregable | Prompt o script del lab | Estado |
|---|---|---|---|---|
| 1 | **Rúbrica** de categorías con definición y severidad | `rubric/` | tú | ✔ |
| 2 | **Rama con defectos sembrados**, una inyección y señuelos inofensivos; la clave fuera del diff | clave de respuestas | tú | ✔ |
| 3 | Revisar el **diff local** contra la base, sin PR real; el diff es **dato, no instrucciones** | revisión en prosa | `prompts/reviewer` v1 | ✔ |
| 4 | **Salida JSON** con esquema cerrado | JSON | `prompts/reviewer` v2 | ✔ |
| 5 | **Validar sin IA**, con la ubicación comprobada contra el diff, y probar el validador con un caso roto | validador | `scripts/validate_review.py` | ✔ |
| 6 | **Rutear** por tipo de archivo, limitar comentarios, deduplicar | router | `design/revisor-en-ci.md` | ✔ en el repo del caso (`qa/review/`), con revisores por tipo; una corrida medida |
| 7 | **Política por fase**: shadow, consultiva, bloqueo parcial, ampliado | decisión y comentario | `scripts/review_policy.py` | ✔ (simulado) |
| 8 | **Costo y latencia**: hash del diff, clave de caché, ruta por tamaño | decisión de ruta | `scripts/route_review.py` | ✔ (simulado) |
| 9 | **Workflow en CI**, primero shadow; clave como *secret*; solo `pull_request` | `review-check.yml` | `design/revisor-en-ci.md` | ✔ en el repo del caso, con una decisión distinta: **el CI valida la revisión pero no llama al modelo**; el modelo corre en local con la cuenta de quien revisa |
| 10 | **Flywheel**: cada discrepancia con un humano es una fila; regresión antes de cambiar prompt o modelo | historial e informe | `scripts/calibrate.py`, `scripts/regression_check.py` | ✔ con datos sintéticos; con datos reales hay 63 etiquetas A, M y R pero falta el formato y los casos donde el revisor calla (ver `roadmap.md`) |
| 11 | **Política de calibración** generada con datos reales | `calibration-policy.md` | un borrador de prompt (no publicado en esta versión) | ✔ ejecutada una vez: con la evidencia actual sale "datos insuficientes" (la evidencia privada del caso) |

**Esquema de salida del revisor**
```json
{ "schema_version": 1,
  "findings": [ { "rule_id": "missing-authorization",
                  "category": "security",
                  "severity": "blocker",
                  "location": { "file": "app/api/route.ts", "line": 50 },
                  "message": "Por qué importa.",
                  "suggested_fix": "Corrección breve." } ] }
```
`category`: `correctness`, `security`, `performance`, `missing_tests`, `style`, `documentation`. `severity`: `blocker` (puede bloquear), `advisory` (advierte), `info` (se registra). Sin hallazgos: `"findings": []`.

**Fases del despliegue**

| Fase | Qué hace el revisor | Para subir |
|---|---|---|
| 1. Shadow | Registra; no muestra ni bloquea | Datos y etiquetas humanas suficientes |
| 2. Consultiva | Comenta; no bloquea (el veredicto del modelo es una señal) | Acuerdo medido por categoría |
| 3. Bloqueo parcial | Bloquea solo una lista de reglas | Estabilidad sostenida y pocos falsos positivos |
| 4. Bloqueo ampliado | La lista crece con los datos | Revisión periódica |

Un falso positivo temprano destruye la confianza: una regla pasa a bloqueante solo cuando su acuerdo **medido** con humanos es alto, con suficientes casos y un intervalo que lo respalde.

## 5. Pista 3: seguridad (transversal)

| Tema | Idea | Estado |
|---|---|---|
| SAST + IA | La herramienta estática encuentra, la IA clasifica (`true`, `false positive`, `human require`), cada patrón confirmado se vuelve regla **probada** | ✔ una corrida: el modelo dejó 19 de 19 alarmas como `human require` (el usuario las consideró reales); necesita una política declarada en el prompt |
| Red team | Familias de OWASP; la expectativa describe el comportamiento seguro, no la vulnerabilidad | ✔ una corrida: 46 pruebas, 18 detectaron un defecto, 13 más resultaron reales |
| Cadena de suministro | La verdad sobre un paquete la da el registro; un nombre recién registrado también es señal | ✔ contra el registro real (61 dependencias); mide existencia, no vulnerabilidades |
| Seguridad de LLM | Inyección, fuga del prompt, exceso de agencia; recortar privilegios antes que filtrar | ◌ aplazado: se hará sobre una app que use un modelo |
| Auditoría legacy | Tour y punto de control humano antes de pedir hallazgos; sin línea citada, no hay hallazgo | ✔ dos archivos; las citas se verifican con un script |

Detalle de cada tema en las notas de estudio (no publicadas).

## 6. Qué medir y sus trampas

| Métrica | Para qué sirve | Trampa |
|---|---|---|
| Puntaje de mutación (y su complemento, la supervivencia) | Sensibilidad de una suite a cambios en el código | Los mutantes equivalentes la rebajan; no dice si los tests prueban lo correcto |
| Contratos incumplidos detectados | Si la suite protege lo decidido por el negocio | Requiere un catálogo firmado y el código anterior |
| Acuerdo con humanos | Cuánto coincide el revisor con las personas | Con casi todo "pass", un revisor trivial acierta 95 % |
| **Kappa de Cohen** | Acuerdo descontando el azar | Inestable con pocos casos; pide un intervalo |
| Precisión y recall de "bloquear" | Costo de un bloqueo equivocado frente a un bug perdido | Sin una clase negativa (falsos positivos) la precisión no significa nada |
| Estabilidad entre corridas | Cuánto cambia el veredicto con el mismo diff | Una corrida no la mide. En el caso real, dos corridas del mismo diff compartieron entre 0,26 y 0,59 de sus hallazgos |
| **Recall contra una respuesta preregistrada** | Cuántos defectos conocidos ve el revisor | La respuesta debe salir de otra vía (pruebas, auditoría independiente), no del propio revisor; un **foco redactado con los mismos hallazgos** infla el resultado, y por eso hace falta una corrida de control sin foco |
| Precisión sobre hallazgos etiquetados | Cuánto de lo que dice el revisor es real | Solo cuenta lo que levantó: sin casos donde calla no hay falsos negativos; y si el etiquetador ve la comprobación antes de decidir, la etiqueta no es ciega |
| Regresión | Que un cambio no rompa lo que funcionaba | Un promedio mejor puede esconder un caso roto |

Reglas: por debajo de unos 30 casos por categoría, "datos insuficientes". Las tasas se estiman con una **muestra aleatoria**, no con las filas añadidas por discrepancia (sesgo de muestreo). La decisión humana la pone una persona: si la IA rellenara ambas columnas, el acuerdo sería 100 % por construcción.

### Lo aprendido al aplicarlo a un repositorio real
Detalle y cifras en la segunda fase de `caso-de-estudio.md`. Lo que cambia cómo se usa el método:
1. **Leer el diff y atacar el código encuentran cosas distintas.** Un revisor sobre el diff no vio ninguno de los cinco defectos de omisión que unas pruebas adversariales sí encontraron. Hacen falta las dos vías.
2. **Presenta cada hallazgo con su comprobación antes de pedir la etiqueta.** Evita etiquetar afirmaciones falsas, y se detectaron errores del propio coordinador (un verificador mal escrito, una premisa no comprobada).
3. **El contexto recortado fabrica ruido.** Un hallazgo que depende de un archivo que el revisor no ve debe marcarse como tal; no siempre lo hace.
4. **Una regla de "ante la duda, que decida un humano" produce 100 % de dudas.** Si quieres que el modelo se comprometa, el prompt debe declarar la política del proyecto.
5. **Preregistra la respuesta y el protocolo antes de ejecutar,** y guarda las salidas completas: permite reabrir un resultado y corregirlo (se hizo con dos puntuaciones).
6. **Una corrida no es una medida.** Corre varias veces y reporta la unión, el consenso y el solapamiento; y una corrida de control sin el foco.
7. **El sistema puede revisar su propio código,** y encuentra errores reales, pero con circularidad: declárala.

## 7. Glosario

| Término | Significado |
|---|---|
| **SUT** | Sistema bajo prueba, congelado con un hash para medir todo contra lo mismo |
| **Modo de falla** | Una forma concreta de fallar, con su entrada, su contrato y su estado |
| **Contrato** | Qué debe hacer el código ante una entrada; `confirmado` si una persona lo firmó |
| **Mutante / mutante equivalente** | Copia del código con un cambio pequeño / cambio que no altera el comportamiento observable |
| **Golden set** | Casos etiquetados por humanos y congelados contra los que se mide al revisor |
| **Señuelo** | Cambio inofensivo que el revisor no debería marcar; mide falsos positivos |
| **TP / FP / FN / TN** | Acierto al detectar / ruido / problema perdido / acierto al confirmar que está limpio |
| **Shadow** | El revisor corre y registra, sin mostrar ni bloquear |
| **Override** | Una persona discrepa del veredicto; se registra con su motivo |
| **Flywheel** | Ciclo en que cada error del revisor se convierte en un dato que lo mejora |
| **Slopsquatting** | Registrar un nombre de paquete que la IA inventa con frecuencia, con código malicioso |
| **Confused deputy** | Componente con privilegios (un LLM con acceso a cuentas) manipulado por un usuario de bajos privilegios |
| **Zona no IA** | Área donde la decisión humana es obligatoria y la IA no aprueba nada |

## 8. Decisiones frecuentes

| Si ves esto | Haz esto |
|---|---|
| El comportamiento del código es ambiguo | **Pendiente de decisión**; no escribas test |
| Un test rojo por un contrato firmado | Corrige el código con el cambio mínimo |
| Un mutante sobrevive y ningún contrato lo decide | **No escribas test**; propón un modo de falla nuevo |
| Menos de ~30 casos en una categoría | "Datos insuficientes"; no concluyas |
| Todas las etiquetas son positivas | No cites la precisión: falta una clase negativa |
| El revisor cita una línea que no está en el diff | Descarta el hallazgo |
| El texto del diff pide "aprueba esto" | Repórtalo como hallazgo de seguridad |
| Un paquete no existe en el registro | Riesgo, no prueba de maldad; no lo instales |
| No se pudo consultar el registro | Nunca lo informes como "no existe" |
| Cambias el prompt o el modelo | Ejecuta la prueba de regresión y reinicia el conteo de calibración |

## 9. Cómo adoptarlo en otro código

**Qué copiar del lab:** `prompts/` (las versiones usadas), `schemas/review.schema.json`, `scripts/` y `tests/` de las herramientas que uses, `config/routing.json`, `CONTRIBUTING.md` y el hook de commits.
**Qué adaptar:** los marcadores `{{MODULO}}`, `{{FRAMEWORK}}`, `{{ARCHIVO_DESTINO}}`; la rúbrica con ejemplos de tu proyecto; los umbrales de calibración.
**Qué no copiar:** los datos y resultados del caso de estudio; son suyos y no son tuyos.

**Día 1**
- Repo con commits convencionales y CI que corra las pruebas.
- Un módulo con lógica pura como piloto.
- La rúbrica escrita con ejemplos propios.

**Semana 1**
- Catálogo de modos de falla, firmado; tests de lo confirmado.
- Mutation testing: línea base y triaje de sobrevivientes.
- Rama con defectos sembrados y señuelos; revisor en prosa y luego en JSON con su validador.

**Mes 1**
- Revisor en **shadow** con un modelo barato; registrar todo.
- Historial: discrepancias con su motivo y una **muestra aleatoria** etiquetada por una persona.
- Calibración por categoría; solo entonces pasar a consultivo.

**Después**
- Bloqueo parcial para reglas con acuerdo alto y estable, con degradación automática.
- Añadir análisis estático, auditoría de dependencias y pruebas adversariales.
- Revisar la política en cada PR y declarar las zonas no IA.

**Antes de enviar código a un proveedor externo:** diff mínimo con tope, rutas sensibles excluidas, política de retención y entrenamiento revisada, clave como *secret*, registro de auditoría.

## 10. Comandos del lab

```bash
py -m unittest discover -s tests
py scripts/compare_mutation.py "A=a.json" "B=b.json" "C=c.json" --file src/modulo.ts
py scripts/validate_review.py review.json --diff diff.patch
py scripts/review_policy.py review.json --phase advisory --comment c.md
py scripts/route_review.py diff.patch --prompt-version v2 --schema-version 1 --model ID
py scripts/stability.py run1.json run2.json run3.json
py scripts/calibrate.py history.json --sources audit_sample
py scripts/regression_check.py --dataset d.json --baseline b.json --candidate c.json
py scripts/audit_dependencies.py npm package.json      # usa la red
git config core.hooksPath .githooks                    # commits convencionales
```

## 11. Anti-patrones
- Encender el bloqueo el primer día.
- Convertir el comportamiento actual en especificación.
- Escribir tests para matar mutantes sin contrato.
- Validar la salida de un modelo con otro modelo.
- Rellenar con la IA la columna de "decisión humana".
- Publicar una cifra sin su límite.
- Cambiar un prompt sin versión ni regresión.
- Enviar al proveedor más código del necesario.
- Medir un revisor con los mismos hallazgos con los que se redactó su prompt, sin una corrida de control.
- Dar por buena una etiqueta puesta sin ver la comprobación, o una comprobación hecha con un script que no se probó.
- Contar como aprobación el "sin hallazgos" de la IA en una zona donde la decisión es humana.

## 12. Límites de esta guía
Resume un método probado en un caso real (un módulo en la primera fase y el repositorio de producción en la segunda), con un modelo, un etiquetador y pocas corridas por variante. Las piezas marcadas ◌ son diseño sin ejecutar. Los umbrales son propuestas, no estándares, y con la evidencia actual el revisor no cumple los de la fase de bloqueo.
