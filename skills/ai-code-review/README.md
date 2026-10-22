# ai-code-review (skill)

Una revisión de código con IA **medida y consultiva**, empaquetada como skill de Claude Code. Sale del procedimiento que se probó sobre un repositorio real (ver `docs/caso-de-estudio.md`, segunda fase) y le añade lo que le faltaba para poder medirse sola: un registro de lo que una persona decide con cada hallazgo.

## Qué hace
1. `prepare`: parte el diff de la rama por tipo de archivo y numera las líneas del archivo nuevo, para que un revisor pueda citar `archivo:línea`.
2. Un agente nuevo por bloque revisa con el prompt base, el foco de su tipo, la rúbrica y el contexto del proyecto.
3. `merge`: valida (esquema, valores permitidos y que cada línea citada esté en el diff), descarta duplicados, aplica un tope y **registra cada hallazgo** en `.ai-review/ledger.jsonl`.
4. `ledger`: una persona etiqueta cada hallazgo (A real y accionable, M real pero menor, R ruido), anota lo que la revisión no vio y marca PR auditados por otra vía. `ledger report` calcula precisión con su intervalo y recall solo sobre lo auditado.
5. `check` (CI): valida la revisión que viaja con el pull request. **El CI no llama al modelo.**

## Instalar
Copia esta carpeta como skill personal o de proyecto:
```
~/.claude/skills/ai-code-review/      # personal
<repo>/.claude/skills/ai-code-review/ # de proyecto (necesaria si el CI la usa)
```
Hace falta Node 20 o superior y `git`. Para el CI, copia `templates/review-check.yml` a `.github/workflows/` y ajusta `SKILL_DIR`.

## Primer uso
```
cd <repo que quieres revisar>
# en Claude Code: pídele "revisa esta rama con ai-code-review"
```
La primera vez te propondrá crear `.ai-review/context.md` desde `templates/context.md`: qué mirar sobre todo en ese código y qué zonas son de decisión humana.

## Dónde queda lo que genera
| Archivo (en el repo revisado) | Qué es | ¿Se sube? |
|---|---|---|
| `.ai-review/context.md` | Contexto del proyecto para los revisores | Sí |
| `.ai-review/config.json` | Fase y topes del proyecto (sobrescribe `config.default.json`) | Sí |
| `.ai-review/reviews/<rama>.json` y `.meta.json` | La revisión validada y con qué se hizo | Sí, con el PR |
| `.ai-review/ledger.jsonl` | Un evento por línea: hallazgos, etiquetas, escapes y auditorías | A tu criterio (guarda hasta 300 caracteres del mensaje de cada hallazgo) |
| `.review-work/` | Archivos de trabajo | No |

## Probar la skill
```
npm install       # vitest
npm test          # 168 tests, incluido el flujo completo con git real en un repositorio temporal
```

## Límites
- **Consultiva.** Con la evidencia del lab (63 hallazgos etiquetados por una persona: 79 % de precisión amplia, 40 % de accionables, 21 % de ruido) no se cumplen los umbrales propuestos para bloquear.
- **Recall bajo y variable** en el piloto del lab: de 0 de 5 a 6 de 11 según el caso y la corrida. No vio los defectos de omisión de una API ni los de interfaz de un formulario.
- Un modelo, un etiquetador y un repositorio de origen. Las cifras del lab no son del repositorio donde la uses: el registro las reemplaza con las tuyas.
- Los prompts y la rúbrica están en español.

## Origen
El procedimiento se construyó y se auto-revisó en tres rondas dentro del repositorio del caso. Esta versión le quita las rutas fijas de ese proyecto (`qa/review/` pasa a `.ai-review/`), saca lo específico a `context.md`, incluye la rúbrica en la clave de caché (antes no entraba) y añade el registro.
