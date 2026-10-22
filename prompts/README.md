# Prompts

El prompt es código: se versiona, se audita y cambia por pull request.

## Reglas
- Un directorio por prompt; una versión por archivo (`v1.md`, `v2.md`). Una versión publicada **no se edita**: se crea la siguiente.
- Cada archivo empieza con un bloque de metadatos (nombre, versión, estado, entradas, salidas).
- Todo cambio entra por PR y se anota en `CHANGELOG.md` con qué cambió, por qué y quién lo aprobó.
- Estados: `usado` (se ejecutó y se midió), `borrador` (escrito, sin ejecutar), `descartado`.
- Los textos con `{{MARCADOR}}` son plantillas; la instancia usada en un experimento se guarda en `experiments/`.
- `_inbox/` recibe prompts sin probar. `_drafts/` guarda diseños de prompts que aún no se han corrido.

## Índice
| Directorio | Para qué | Última versión | Estado |
|---|---|---|---|
| `naive-tests/` | Línea base ingenua para comparar | v1 | usado |
| `failure-modes/` | Catálogo de modos de falla de un módulo | v1 | usado |
| `tests-3-layers/` | Tests desde el catálogo en tres capas | v1 | usado |
| `fix-red-tests/` | Corregir la lógica para tests rojos confirmados | v1 | usado |
| `mutation-triage/` | Clasificar mutantes sobrevivientes | v1 | usado |
| `reviewer/` | Revisor de PR (prosa v1, JSON v2) | v2 | usado |
| `_drafts/` | Router, revisores por tecnología, tour y auditoría de código legacy, revisión diferencial, triaje de Semgrep y reglas desde anti-patrones, red team con tests adversariales, auditoría de cadena de suministro, auditoría de seguridad de apps con LLM, generador de política de calibración | | borrador |
