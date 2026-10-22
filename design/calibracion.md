# Calibración del revisor contra decisiones humanas

Cómo saber si el revisor acierta y cómo usar esa evidencia para decidir qué puede bloquear. Dos partes: la política de calibración (umbrales, matriz por categoría, zonas no IA) y el flywheel (cómo cada error se vuelve un dato).

**Qué está implementado y qué no:** `calibrate.py` y `regression_check.py` están probados con un historial **sintético**. No hay historial real de decisiones humanas, así que no se ha calculado ninguna cifra de calibración del revisor.

---

## Política de calibración

**Estado: diseño. Los umbrales son una propuesta propia, no un estándar ni un resultado medido. Los cálculos los hace `scripts/calibrate.py` (con datos sintéticos); el documento de política final no se ha generado porque no hay historial real.**

> Un evaluador que nadie ha calibrado contra decisiones humanas es una opinión con formato JSON.

### Definiciones
Se comparan los hallazgos del revisor con las etiquetas humanas sobre las mismas muestras:
- **Verdadero positivo (TP):** el revisor señala un problema real.
- **Falso positivo (FP):** señala algo que no es un problema.
- **Falso negativo (FN):** no señala un problema real (por ejemplo, un defecto sembrado que no vio).
- **Verdadero negativo (TN):** no señala algo que no era un problema (por ejemplo, un señuelo).

Precisión = TP / (TP + FP). Recall = TP / (TP + FN).

### Por qué kappa y no solo el porcentaje de acuerdo
Si el 95 % de los casos son "sin problema", un revisor que siempre diga "sin problema" acierta el 95 % y su kappa es 0. Cohen's kappa mide el acuerdo descontando el azar:

`kappa = (p_o - p_e) / (1 - p_e)`

Lectura orientativa (Landis y Koch): menos de 0,20 pobre; 0,21 a 0,40 débil; 0,41 a 0,60 moderado; 0,61 a 0,80 sustancial; más de 0,80 casi perfecto. Es una convención, no una norma.

### Condiciones para que el número signifique algo
- **Conjunto congelado** y versionado, etiquetado por humanos **antes** de ver la salida del revisor.
- **Guía de etiquetado escrita** que define cada categoría.
- **Al menos 30 a 50 muestras por categoría** y un intervalo de confianza (por ejemplo, bootstrap); con 10 muestras el kappa es ruido.
- **Clase negativa real**: señuelos y cambios inofensivos. Sin ellos no hay falsos positivos que medir.
- **Un segundo etiquetador** en una submuestra: el acuerdo humano-humano es el techo realista.
- **Repetir corridas** para separar el efecto del prompt de la variación del modelo.
- Una categoría rara (seguridad) da kappa inestable: decirlo.

### Umbrales propuestos para pasar de fase (a validar con datos)
La lógica: bloquear cuesta más que comentar, así que se exige más evidencia cuanto más fuerte es la acción.

| Fase | Condición | Métrica que manda |
|---|---|---|
| Shadow | Ninguna | Solo registrar |
| Consultivo | kappa >= 0,50 con n >= 30 en la categoría | Recall |
| Bloqueante parcial | kappa >= 0,70, precisión >= 90 % y límite inferior del IC 95 % de kappa >= 0,60 | Precisión |
| Bloqueante ampliado | Lo anterior sostenido cuatro semanas y pocos falsos positivos por cada 20 PRs | Precisión y tasa de anulación humana |

Reglas adicionales:
- **Seguridad** se mide por recall, no por precisión; para bloquear, se exige además una regla determinista (SAST) o confirmación humana.
- **Degradación automática:** si el kappa móvil de una categoría bloqueante cae por debajo de 0,60, vuelve a consultivo.
- **Cualquier cambio de prompt o de modelo** reinicia el conteo de las categorías afectadas.

### La política como documento ejecutable
El entregable final es un documento `calibration-policy.md` que se genera a partir de la evidencia del repositorio (pruebas, prompts, historial, reglas de seguridad y workflow) con el prompt un borrador de prompt (no publicado en esta versión). **Los ejemplos del formato se reemplazan con datos reales; si falta evidencia, se declara como limitación.** Se revisa en cada pull request y su resumen aparece en el pipeline: así el equipo ve en vivo si las pruebas pasan, si el historial de regresión es consistente y si la matriz está bien escrita.

### Matriz de confusión por categoría
Cada categoría de la rúbrica tiene su propia matriz, porque **el costo de cada error cambia según el contexto**. Dejar pasar un acceso sin autorización es gravísimo; un falso positivo de estilo solo molesta.

| Categoría | TP | FP | FN | TN | n | Fuente |
|---|---|---|---|---|---|---|
| correctness | _de `calibrate.py`_ | | | | | historial, solo filas de muestra aleatoria |
| security | | | | | | |
| performance | | | | | | |
| missing_tests | | | | | | |
| style | | | | | | |
| documentation | | | | | | |

La tabla se llena con datos reales o se deja con la nota "datos insuficientes". Hoy **no hay datos reales**: `calibrate.py` calcula TP, FP, FN y TN de "bloquear" por regla y por categoría, pero solo con un historial sintético de ejemplo.

### Acciones según el costo del error
| Situación | Acción |
|---|---|
| Falsos negativos raros y baratos, kappa estable y datos suficientes | La IA puede **autoaprobar** esa categoría |
| Evidencia insuficiente o kappa moderado | La IA es **consultiva**: comenta, no decide |
| Falsos negativos caros (seguridad, dinero) | **Revisión humana obligatoria**, aunque la IA haya aprobado |
| Zona declarada no IA | La IA **no aprueba nada**; solo puede señalar |

El cruce con el llamado *impuesto de alucinación* (cuánto se equivoca el modelo, medido por lenguaje y por código base) decide en qué categorías se puede subir de nivel. **Ese impuesto no se ha medido aquí**; es un concepto del curso sin dato propio.

### Zonas no IA
Áreas donde la decisión humana es obligatoria: criptografía, el núcleo de un sistema de pagos y contextos regulatorios. En un proyecto sin pagos propios conviene definir las equivalentes y escribirlas:
- Todo lo que cambie el **dinero que ve el cliente**.
- **Secretos, credenciales y permisos** de los workflows.
- La política de seguridad del propio proyecto (cabeceras, listas de permitidos).

En el caso de estudio esta lista es una **propuesta**: cuáles son las zonas no IA lo decide su responsable, no este documento.

### Protocolo de override
Cuando una persona discrepa del veredicto (fusiona lo que se bloqueó o bloquea lo que pasó) se registra: PR, regla, decisión de la IA, decisión humana, motivo en una frase, quién y cuándo. Es la fuente `override` del historial (la sección «Flywheel de mejora continua»). Sin motivo no se guarda.

### Cuando se añade una herramienta
Si se suma otra (por ejemplo, un analizador adicional además de Semgrep), hay que incorporarla **en dos sitios**: en la calibración y en el prompt que genera las revisiones. La calibración se alinea con el tiempo: más verdaderos positivos y negativos, menos zona gris.

### Implementación
`scripts/calibrate.py` aplica estos umbrales y se niega a sugerir nada por debajo de `--min-n` filas; ver la sección «Flywheel de mejora continua», que también explica por qué las tasas deben estimarse con una muestra no sesgada y no con las filas añadidas por discrepancia.

### Estado de los datos hoy
Ver la evidencia de la primera fase (privada): un solo etiquetador, nueve hallazgos etiquetados como válidos, ningún falso positivo y una corrida por versión. **No alcanza para calcular kappa.**

---

## Flywheel de mejora continua

**Estado: dos scripts implementados y probados con datos sintéticos (`scripts/calibrate.py`, `scripts/regression_check.py`). No hay historial real, ni etiquetas de más de una persona, ni un workflow que los ejecute.**

### La idea
Un revisor que se equivoca en un sistema estático solo acumula fallos. En uno con ciclo de retroalimentación, cada error es un dato:

```
error del revisor -> fila en el dataset -> ajuste de prompt o de política -> más precisión
      ^                                                                          |
      +---- más casos borde  <---- más uso  <---- más confianza del equipo <------+
```
El motor es un **dataset de regresión**. Sin él, el ciclo no gira.

### Piezas

| Pieza | Qué es | Estado |
|---|---|---|
| Histórico | JSON con la decisión de la IA y la de una persona, lado a lado (`block`, `warn`, `pass`) | Formato definido y validado; solo hay un ejemplo **sintético** (`data/history.example.json`) |
| Medición del acuerdo | Acuerdo, kappa de Cohen con intervalo, precisión y recall de "block", por regla y por categoría | `calibrate.py` |
| Sugerencia de política | Qué regla bajar a `warn`, cuál es candidata a bloquear | `calibrate.py`, con los umbrales de la sección «Política de calibración» (propuestas, no estándares) |
| Prueba de regresión | Antes de cambiar prompt o modelo, comprobar que no se rompe lo que funcionaba | `regression_check.py` |
| Protocolo de *override* | Cuando una persona discrepa del veredicto, queda registrado con su motivo | Solo diseño (abajo) |
| Auditoría activa | Muestrear revisiones pasadas para detectar patrones | Solo diseño (abajo) |

### Cada discrepancia es una fila
- **Falso positivo:** la IA marcó (`block`) algo que la persona consideró menos (`warn` o `pass`).
- **Falso negativo:** la IA dejó pasar algo que la persona habría bloqueado.

Ejemplo del curso: faltaba un test. La IA lo trató como bloqueante y la persona como una advertencia. Se añade la fila; el informe sugiere que ese tipo de caso baje a `warn`; se cambia la política. La discrepancia deja de ser un problema y pasa a ser una decisión de diseño. En los tests de `regression_check.py` este caso aparece como un arreglo (de bloquear a advertir) y no como una regresión.

### Dos usos del dataset que no deben mezclarse
**Este es un punto que el curso no resalta y que cambia los números.**

- **Para no romper lo que funcionaba** (regresión) sirven los casos que fallaron: cada error pasado se convierte en un caso que ningún cambio futuro debe volver a romper.
- **Para estimar cuánto acierta el revisor** (precisión, kappa) **no sirven** si los casos se añaden solo cuando hubo discrepancia: el acuerdo calculado sobre un conjunto formado casi solo por errores es mucho menor que el real. Hace falta una **muestra no sesgada**: casos elegidos al azar, con independencia de si hubo discrepancia.

Por eso cada fila lleva un campo `source` (`override`, `audit_sample`...) y `calibrate.py` permite elegir qué filas cuentan con `--sources`. Si el historial mezcla filas de *override* con otras y no se elige, el script avisa de que las tasas están sesgadas. Está cubierto por una prueba: con 30 acuerdos de muestra y 30 desacuerdos de *override*, el acuerdo es 50 % con todas las filas y 100 % con la muestra.

### Regla de datos: las etiquetas las pone una persona
El curso integra el cálculo en el workflow para que "vaya agregando casos automáticamente". Aquí el criterio es más estricto: el workflow puede **proponer** una fila (el veredicto de la IA ya está registrado), pero la decisión humana debe venir de una persona (un *override*, un comentario del revisor humano, una muestra etiquetada). Si la IA rellenara ambas columnas, el acuerdo sería 100 % por construcción y no mediría nada.

### Con pocos casos el número no significa nada
El curso muestra cuatro casos con acuerdo casi del 100 %. Con tan pocos datos no se puede concluir nada. `calibrate.py` lo impone: por debajo de `--min-n` (30 por defecto) responde "datos insuficientes" y **no hace ninguna sugerencia**, ni para bien ni para mal. Una prueba lo comprueba con un caso de cuatro filas perfectas y otro de diez filas desastrosas.

Además, un acuerdo alto **no basta**: un revisor que siempre dice "pass" cuando el 95 % de los casos son "pass" acierta el 95 % y su kappa es 0 (también cubierto por una prueba).

### Cómo se usa
```bash
py scripts/calibrate.py history.json --sources audit_sample --json report.json
py scripts/regression_check.py --dataset dataset.json --baseline baseline.json --candidate candidate.json
```
`regression_check.py` sale con 1 si el candidato rompe un caso que el actual acertaba, aunque el acuerdo medio suba: una mejora media puede esconder una regresión (hay una prueba para esto).

### Protocolo de *override* (diseño)
Cuando una persona fusiona un PR que el gate bloqueó, o bloquea uno que pasó, se registra: PR, regla, decisión de la IA, decisión humana, motivo en una frase, quién y cuándo. Ese registro es la fuente `override`. Sin motivo no se guarda: un *override* sin explicación no enseña nada.

### Auditoría activa (diseño)
Cada cierto tiempo se toma una muestra **aleatoria** de revisiones pasadas, también de las que nadie discutió, y una persona las etiqueta. Es la fuente `audit_sample`, la única que permite estimar precisión sin sesgo. También busca patrones que ninguna discrepancia puntual revelaría.

### Lo que falta
- Un historial real y varias personas etiquetando (para medir el acuerdo humano-humano, que es el techo realista del kappa).
- El flujo que convierta un *override* en una fila con su motivo.
- Integrar `regression_check.py` como paso obligatorio antes de cambiar un prompt (`prompts/CHANGELOG.md`).
- La **política de acción**: cómo el equipo actúa a partir de estos veredictos. Es el último tema del curso y no está diseñado.
- Un solo modelo y una sola etiqueta no dicen nada sobre otros: los resultados no se generalizan.

### Relación con el resto del lab
- La sección «Política de calibración» define los umbrales que `calibrate.py` aplica.
- `design/revisor-en-ci.md` (sección «Escalado de shadow a bloqueante»): la lista de reglas que pueden bloquear sale de la sugerencia `eligible_to_block`, y una persona decide.
- `design/revisor-en-ci.md` (sección «Costo, latencia y variabilidad»): `stability.py` mide la variabilidad entre corridas; este flujo mide el acuerdo con las personas.
- la evidencia de la primera fase (privada): sus etiquetas son un golden set provisional de un solo etiquetador y sin falsos positivos, así que no sirve todavía como historial real.
