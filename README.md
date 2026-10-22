# ai-code-review-lab

> **Mide antes de confiar.** Cómo evaluar un revisor de código con IA con datos, con sus intervalos y con sus límites.

Este repositorio es un laboratorio para responder una pregunta concreta: *¿cuánto se puede confiar en un revisor de código con IA?* Reúne una **skill de Claude Code** que revisa y registra lo que decide una persona con cada hallazgo, **bancos de pruebas ficticios** con defectos plantados y respuesta conocida, las **herramientas** para medir y la **guía** de cómo se hizo.

**Vitrina (ES/EN):** <https://osworky.github.io/ai-code-review-lab/> · **Guía:** [`docs/guia.md`](docs/guia.md) · **Caso de estudio:** [`docs/caso-de-estudio.md`](docs/caso-de-estudio.md)

## Qué hay
| Carpeta | Qué es |
|---|---|
| [`skills/ai-code-review/`](skills/ai-code-review/) | La skill: revisores por tipo de archivo, validación determinista de lo que devuelven, y un registro (*ledger*) con la decisión humana sobre cada hallazgo. 168 tests |
| [`bench/envios/`](bench/envios/) | Banco v1: un módulo ficticio con 18 defectos plantados, **ya ejecutado** |
| [`bench/envios-v2/`](bench/envios-v2/) | Banco v2, más difícil: **construido, resultados pendientes** |
| [`scripts/`](scripts/) y [`tests/`](tests/) | Herramientas en Python: validador del revisor, comparador de mutantes, calibración, regresión, estabilidad |
| [`docs/`](docs/) | La guía, el caso de estudio y el roadmap |
| [`design/`](design/), [`prompts/`](prompts/), [`rubric/`](rubric/), [`schemas/`](schemas/) | Diseños, prompts versionados, rúbrica y esquema de salida |
| [`experiments/skill-e2e/`](experiments/skill-e2e/) | La skill probada de punta a punta sobre otro repositorio |

## Lo que se midió (piloto)
Un modelo, un solo etiquetador y muestras pequeñas: son cifras de un **piloto**, no una calibración. Los datos viven en [`site/data/results.json`](site/data/results.json) y de ahí salen todas las cifras de este documento y de la vitrina.

- **Precisión** sobre 63 hallazgos etiquetados como *real y accionable* (A), *real pero menor* (M) o *ruido* (R): **40 %** accionables, **79 %** accionables o menores (intervalo de 68 a 88 %) y **21 %** de ruido. Son hallazgos que el revisor levantó, no una muestra aleatoria.
- **Recall** en un piloto con tres casos de respuesta conocida: de **0 de 5** (una API, donde los defectos eran omisiones que solo encuentran pruebas adversariales) a **6 de 11** (un formulario) con tres corridas; el solapamiento entre corridas del mismo caso fue de 0,26 a 0,59.
- **Banco v1:** **18 de 18** defectos con el proceso completo y también **sin el foco** de cada tipo de archivo, y 0 falsas alarmas en 6 cambios inofensivos. Es un **efecto techo**: el banco era demasiado fácil y no distingue nada. Por eso existe el banco v2.
- **Política de calibración** generada con estos datos: **ninguna** de las 6 categorías llega al mínimo de 30 filas, así que no hay base para subir el revisor más allá de la fase consultiva.

## Pruébalo
Hace falta Node 20 o superior y Python 3.12.

```bash
# herramientas de Python
python -m unittest discover -s tests

# tests de la skill
cd skills/ai-code-review && npm install && npm test

# construir el banco v1 y comprobar que cada defecto se puede citar
node bench/envios/build-repos.mjs ./envios-repo
node bench/envios/check-citable.mjs ./envios-repo ./envios-repo.key.json
```

**Instalar la skill** en Claude Code: copia `skills/ai-code-review/` a `~/.claude/skills/ai-code-review/` (personal) o a `.claude/skills/ai-code-review/` de un proyecto, y pídele "revisa esta rama con ai-code-review". La primera vez te propondrá crear `.ai-review/context.md` con lo que importa en tu código. Detalles en su [README](skills/ai-code-review/README.md).

## Lo que no se puede afirmar todavía
- Que el revisor acierte **por categoría** de la rúbrica: las etiquetas no la llevan y falta la clase negativa (casos donde el revisor calla).
- Que detecte **defectos de omisión** o de interfaz: en el piloto no vio ninguno de los de la API.
- Que sea mejor que otro prompt en general: un modelo, tres casos y pocas corridas.
- Nada sobre otros modelos ni otros etiquetadores.

## Origen y atribución
El enfoque parte de un curso sobre IA aplicada a pruebas y revisión de código. Lo propio de este repositorio es la aplicación a un caso real (anonimizado), el registro de hallazgos, los bancos de pruebas, el experimento comparativo y las herramientas deterministas. El material del curso no se incluye. El caso real es un proyecto privado: aquí solo están sus cifras agregadas.

## Licencias
- **Código:** [MIT](LICENSE) © 2026 osworky.
- **Guía, caso de estudio y textos:** [CC BY 4.0](LICENSE-docs.md): puedes compartirlos y adaptarlos citando la autoría.
