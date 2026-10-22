# Revisor de código con IA en CI

Diseño de cómo pasar un revisor de IA de una prueba manual a un paso del pipeline sin perder la confianza del equipo. Cuatro partes: el flujo en modo shadow, el router por tipo de archivo, la política por fase y el control de costo.

**Qué está implementado y qué no:** hay scripts deterministas con pruebas (`validate_review.py`, `review_policy.py`, `route_review.py`, `stability.py`), probados con datos simulados. **Ningún workflow está activo y no se ha llamado a ningún modelo desde el CI.**

---

## Flujo de revisión en CI (modo shadow)

**Estado: diseño. No hay workflow activo en este repo ni en el caso de estudio.**

### Objetivo
Correr el revisor en cada PR **sin afectar** el merge, guardando resultados para medirlo.

### Las cuatro piezas de un workflow de CI
1. **Trigger:** cada pull request.
2. **Entrada:** el diff contra la rama base.
3. **Acción:** correr el prompt revisor.
4. **Salida:** el veredicto en JSON, validado por `scripts/validate_review.py`.

### Archivos del sistema
| Archivo | Papel |
|---|---|
| `.github/workflows/ai-review.yml` | Orquesta: dispara, arma el diff, llama al modelo, valida y guarda. GitHub lo reconoce solo por su ubicación |
| El prompt del revisor (`prompts/reviewer/vN.md`) | Las reglas de revisión; debe ser la versión más iterada y medida, no una básica |
| El esquema (`schemas/review.schema.json`) | La estructura de la salida; se mantiene aparte para que el prompt solo hable de reglas |

El modelo y el proveedor se eligen por variable (`REVIEW_MODEL`). El curso usa OpenRouter con un modelo gratuito para probar; para el lab es razonable, para código privado hay que mirar antes qué hace el proveedor con los datos (ver abajo).

### Esquema (no activo)
```yaml
# .github/workflows/ai-review.yml  -- BORRADOR
name: ai-review
on:
  pull_request:            # nunca pull_request_target: ejecutaría código del PR con secretos
permissions:
  contents: read
  pull-requests: read      # sin escritura en la fase shadow
jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@<sha-fijo>
        with: { fetch-depth: 0 }
      - name: Diff contra la base
        run: git diff -U6 origin/${{ github.base_ref }}...HEAD > diff.patch
      - name: Revisor (modelo por variable)
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          REVIEW_MODEL: ${{ vars.REVIEW_MODEL }}
        run: python scripts/run_review.py diff.patch review.json      # por escribir
      - name: Validar sin IA
        run: python scripts/validate_review.py review.json --diff diff.patch
      - uses: actions/upload-artifact@<sha-fijo>
        with: { name: ai-review, path: review.json }
```

### Decisiones y riesgos a resolver antes de activarlo
- **PRs desde forks no tienen acceso a secretos**: el job debe saltarse sin fallar.
- **El diff es una superficie de inyección.** El prompt lo trata como dato y el validador comprueba la forma, pero ninguna de las dos cosas garantiza resistencia general.
- **Costo:** modelo configurable por variable, tope de tokens por PR y límite de tiempo; el enrutado por tamaño y la clave de caché ya existen (la sección «Costo, latencia y variabilidad»). Modelos baratos o gratuitos para la fase shadow; un modelo más fuerte como juez de referencia solo al calibrar.
- **Registro:** guardar `review.json` como artefacto es suficiente al inicio; el flujo de calibración lo lee después.
- **Estabilidad:** una corrida por PR no mide la variabilidad del modelo; la calibración debe repetir muestras.

### Política: qué hace el revisor con cada hallazgo
La decisión más importante del workflow es de política, no técnica. Tres acciones, que se corresponden con las severidades del esquema:

| Severidad del hallazgo | Acción | Cuándo |
|---|---|---|
| `blocker` | **Bloquear**: impide el merge hasta resolverlo | Solo para reglas de alto acuerdo con humanos o de alta severidad |
| `advisory` | **Advertir**: comentario visible, no frena el merge | Hallazgos relevantes pero no críticos, o de acuerdo medio |
| `info` | **Reportar**: se registra en silencio para análisis | Observaciones; alimentan la calibración |

En la fase shadow **las tres acciones se reducen a reportar**. Qué severidades pasan a bloquear y cuándo lo decide `design/calibracion.md` (sección «Política de calibración»), con datos; no se enciende el modo bloqueante para todos desde el primer día.

### Datos que viajan a un tercero
El revisor envía código a un proveedor externo. Controles mínimos:
- Enviar **solo el diff necesario**, con un tope de tamaño por PR; nada de archivos completos ni de `.env`.
- **Excluir rutas sensibles** del diff (secretos, datos de clientes, archivos generados).
- Revisar la **política de retención y entrenamiento** del proveedor y del modelo concreto antes de enviar código privado. No está verificado qué hacen con los datos los modelos gratuitos de ningún proveedor; no se asume.
- La **clave de API** vive como *secret* del repositorio y nunca dentro del proyecto. Con `pull_request`, los PR de forks no la reciben: el job debe saltarse sin fallar.
- **Registro de auditoría:** guardar quién abrió el PR, qué commit se revisó, qué modelo y versión del prompt se usaron, y cuándo. Sin ese registro no se sabe qué diff viajó a un tercero ni con qué reglas se revisó.
- Un tope de costo por ejecución.

### Lo que falta
`scripts/run_review.py` (llamada al modelo con límites y filtro de rutas), el registro de auditoría (la política por fase ya existe: `scripts/review_policy.py`), pruebas del job con un PR sintético y una decisión sobre dónde viven las variables y secretos.

---

## Router por tipo de archivo

**Estado: diseño. No se ha ejecutado ni medido.**

### Problema
Un revisor genérico suelta decenas de comentarios por PR y mezcla un hallazgo crítico de seguridad con observaciones de estilo; la gente deja de leerlo. Python, TypeScript e infraestructura tienen riesgos distintos.

### Diseño
```
diff -> split por extensión -> revisor especializado por bloque -> consolidar -> un JSON
```
1. **Separar** por extensión: `.py`, `.ts .tsx .js .mjs`, `.yml .yaml Dockerfile` y config de despliegue. Lo demás pasa por la rúbrica genérica.
2. **Revisar** cada bloque con su prompt (un borrador de prompt (no publicado en esta versión)), que mira solo los riesgos de su tecnología.
3. **Consolidar** en **un único** JSON (`schemas/review.schema.json`). No se separa el JSON por archivo.
4. **Controlar el volumen** con tres mecanismos: severidad con etiquetas, tope de hallazgos por PR y deduplicación entre archivos.

### Qué va en el prompt y qué va en código
| Mecanismo | En el prompt | En código (determinista) |
|---|---|---|
| Separar por extensión | Puede hacerlo | Mejor aquí: una lista de extensiones no se equivoca |
| Severidad | El modelo la asigna | El validador comprueba que sea `blocker`, `advisory` o `info` |
| Tope de hallazgos | Se le pide | Se **recorta** después, conservando la severidad más alta |
| Deduplicación | Se le pide | Clave `(file, line, rule_id)`; el modelo puede olvidarla |

Decisión pendiente: si el ruteo lo hace un solo prompt orquestador o tres llamadas separadas. Un solo prompt cuesta menos y centraliza las reglas de salida; tres llamadas permiten modelos distintos por tecnología y paralelismo.

### Cómo se mediría (aún no hecho)
- Misma rama sembrada, con defectos de más de una tecnología.
- Comparar revisor genérico (v2) contra router: hallazgos totales, defectos sembrados encontrados, falsos positivos sobre señuelos, y fracción de comentarios de estilo.
- Varias corridas por variante para separar el efecto del ruido del modelo.

### Riesgos
- Un archivo de una tecnología no prevista queda con criterio genérico.
- El router consolida y puede perder un hallazgo legítimo al deduplicar de más.
- Más fases significan más costo y más superficie para inyección en el diff.

---

## Escalado de shadow a bloqueante

**Estado: la política por fase está implementada y probada (`scripts/review_policy.py`, 25 pruebas); el resto es diseño sin ejecutar. Ningún gate está activo.**

| Fase | Qué hace el revisor | Qué se registra | Para subir a la siguiente |
|---|---|---|---|
| 1. Shadow | Corre en silencio; todo se reporta, nada comenta ni bloquea | Todos los hallazgos y las decisiones humanas sobre el PR | Datos suficientes y etiquetas humanas (ver calibración) |
| 2. Consultivo | Comenta de forma visible, sin bloquear | Qué hallazgos se aceptan o se descartan | Umbral de calibración por categoría |
| 3. Bloqueante parcial | Bloquea solo un subconjunto de reglas con alta precisión | Bloqueos, anulaciones y su motivo | Estabilidad sostenida y pocos falsos positivos |
| 4. Bloqueante ampliado | La cobertura crece según los datos previos | Igual, más degradaciones | Revisión periódica |

### Por qué no se enciende el bloqueo el primer día
Un falso positivo temprano genera fricción y desconfianza, y una herramienta desconfiada se ignora. **Una regla pasa de consultiva a bloqueante solo cuando su acuerdo medido con humanos es lo bastante alto**; la decisión es el resultado de datos, no una opinión.

### La fase consultiva en la práctica
- El gate corre y deja un comentario con el veredicto y los hallazgos, **pero no bloquea**, aunque el modelo diga "bloquear".
- El veredicto del modelo **no es la autoridad final**: se registra como señal (`would_block`) y se compara con la decisión humana. Ese acuerdo acumulado es lo que justificará el bloqueo real.
- **JSON por dentro, prosa por fuera:** el gate necesita el JSON validado para procesar; el comentario al PR se genera **desde ese JSON con código** y puede ser prosa legible. No hace falta pedir un segundo formato al modelo.
- El texto del modelo se **sanea** antes de publicarlo (menciones, HTML, enlaces), porque proviene de un modelo que lee código no confiable.

### Cómo se aplica con el script
```bash
py scripts/review_policy.py review.json --phase advisory --comment comment.md --decision decision.json
py scripts/review_policy.py review.json --phase partial --blocking-rules missing-authorization
```
El código de salida es 1 solo si el PR queda bloqueado; el resto de fases y de severidades salen con 0. La lista de reglas que pueden bloquear es una **entrada humana**, fruto de la calibración, y no la decide el modelo.

### Lo que queda abierto: costo, latencia y no determinismo
Cada llamada al modelo cuesta dinero y tiempo, y multiplicada por cientos de PRs se nota en la factura. Además, un modelo no es determinista: el mismo diff puede dar hallazgos distintos en corridas distintas. Eso afecta a la calibración (hay que repetir muestras) y al diseño de reintentos y topes. Ver la sección «Costo, latencia y variabilidad»: el enrutado y la clave de caché están implementados y probados; el costo real y la variabilidad **no están medidos**.

Qué significa cada acción (bloquear, advertir, reportar) y cómo se relaciona con la severidad está en la sección «Flujo de revisión en CI (modo shadow)». Encender el modo bloqueante para todos a la vez rompe el ritmo del equipo: por eso se sube por reglas y con datos.

### Enrutado por tamaño de PR
Implementado en `scripts/route_review.py` (ver la sección «Costo, latencia y variabilidad»): la regla es determinista (tipo de archivo y líneas cambiadas) y los umbrales son valores de partida sin evidencia.

### Flywheel
Cada decisión humana (aceptar, descartar, anular) alimenta el conjunto de calibración. `scripts/calibrate.py` recalcula acuerdo, precisión y kappa por regla y categoría, y `scripts/regression_check.py` impide un cambio que rompa casos ya acertados. Detalle, alcance y límites en `design/calibracion.md` (sección «Flywheel de mejora continua»). Cambios de prompt pasan por PR y reinician la fase de la categoría afectada.

---

## Costo, latencia y variabilidad

**Estado: parte implementada y probada con datos simulados (`scripts/route_review.py`, `scripts/stability.py`, 37 pruebas); nada medido contra un proveedor real ni con costos reales.**

### El problema
Cada pull request llama a una API que cuesta dinero y tiempo; multiplicado por cientos de PRs al mes aparece en la factura. Y la integración continua se apoya en que la misma entrada dé la misma salida, algo que un modelo no garantiza: el mismo diff puede dar un veredicto algo distinto. El diseño **acepta la variabilidad y reduce el margen donde afecta a decisiones importantes**; no pretende eliminarla.

### Palancas y su estado

| Palanca | Qué hace | Estado |
|---|---|---|
| Caché por hash del diff | Reutiliza un veredicto si el diff no cambió | **Calculado**: `diff_hash` y `cache_key` en `route_review.py`. El almacenamiento (por ejemplo, la caché del CI) no está diseñado ni probado |
| Enrutar por tamaño y tipo | Modelo pequeño para cambios chicos o documentación, uno más capaz para cambios grandes | **Decisión implementada** (`route_review.py`); qué modelo hay detrás de cada ruta lo ponen personas por variable |
| Tope de presupuesto | Un PR que excede el límite no se envía entero | **Implementado con una estimación**: caracteres / 4 como aproximación de tokens, etiquetada como heurística |
| Paralelizar archivos | Revisar bloques a la vez | Solo diseño (ver la sección «Router por tipo de archivo») |
| *Fail fast* | Cortar pronto lo que no hace falta revisar | Parcial: un diff vacío sale como `skip`; el resto sin diseñar |
| `temperature` en 0 y `seed` fijo | Salidas más estables | Sin probar; depende de que el proveedor y el modelo lo soporten |

### La clave de caché
Un veredicto guardado solo se puede reutilizar si coincide **todo** lo que lo produjo: el diff, la versión del prompt, la del esquema, el modelo y los parámetros. Si la clave dependiera solo del diff, cambiar el prompt o el modelo devolvería un veredicto viejo sin avisar. El hash del diff ignora lo que cambia sin cambiar el contenido (saltos de línea, identificadores de blobs).

### El enrutado
`route_review.py` clasifica los archivos (documentación, código, infraestructura u otro) y decide una ruta:

| Ruta | Cuándo |
|---|---|
| `skip` | El diff no cambia archivos |
| `docs` | Solo documentación |
| `small` | Cambio de código por debajo del umbral (200 líneas cambiadas por defecto) |
| `large` | Cambio de código en el umbral o por encima |
| `over_budget` | La estimación de tokens supera el tope; no se envía entero y el workflow decide si dividir por tipo de archivo o saltar |

Los tipos de archivo desconocidos cuentan como código para el tamaño (lo conservador), y la documentación grande **no** vuelve grande un cambio pequeño de código. Los umbrales viven en `config/routing.json`.

**Qué modelo usa cada ruta no se decide aquí.** La salida nombra una variable de entorno por ruta (`REVIEW_MODEL_DOCS`, `REVIEW_MODEL_SMALL`, `REVIEW_MODEL_LARGE`) y las personas fijan su valor.

### Afirmaciones del curso que este lab no valida
- "Cuanto más pequeño el modelo, más barato." Es la suposición de trabajo del curso, razonable, pero los precios reales no se han consultado ni medido.
- Qué familia de modelos es mejor para documentación y cuál para código: es una afirmación del curso, sin medición propia aquí. El diseño deja la elección en variables precisamente para no atar el lab a ninguna.
- Los umbrales de 200 líneas y de 120 000 caracteres son valores de partida **sin evidencia**.

### Medir la variabilidad
`stability.py` recibe varias revisiones del **mismo diff** y calcula la similitud (Jaccard) entre pares, si todas coinciden en "hay un bloqueante" y qué hallazgos aparecen solo en algunas corridas. Con `--loose` perdona un número de línea o un nombre de regla distintos para el mismo problema.

Para qué sirve: decidir qué reglas pueden bloquear. Una regla cuyo veredicto cambia entre corridas no debe bloquear; la preferencia es por **reglas binarias de alto acuerdo**, donde una variación menor no cambia la decisión. Hoy solo hay una corrida por versión del revisor, así que **la variabilidad real no está medida**.

### Lo que falta
- Medir costo real por PR (hace falta el recuento de tokens que devuelve el proveedor) y la latencia.
- Medir la variabilidad con varias corridas, con y sin `temperature` en 0.
- Diseñar el almacenamiento de la caché y su caducidad.
- Decidir qué hace el workflow ante `over_budget`.
- Las llamadas paralelas por tipo de archivo.

### Relación con el resto del lab
- La decisión de ruta y la clave de caché se calculan antes de llamar al modelo (la sección «Flujo de revisión en CI (modo shadow)»).
- La estabilidad entre corridas alimenta la calibración (`design/calibracion.md` (sección «Política de calibración»)) y la lista de reglas que pueden bloquear (la sección «Escalado de shadow a bloqueante»).
