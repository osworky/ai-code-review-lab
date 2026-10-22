# Prueba de punta a punta de la skill `ai-code-review` sobre una copia del propio lab

Fecha: 2026-10-22. Objetivo: comprobar que la skill funciona fuera del proyecto original, siguiendo `SKILL.md` al pie de la letra: `prepare`, un agente nuevo por bloque, `merge` (que registra en el ledger), etiquetar, `report`.

## Material
Una copia local del propio lab con una rama `feat/demo-skill` y un cambio con **defectos plantados** (la respuesta conocida está abajo y se escribió antes de ejecutar a los agentes). El lab no tiene `.ai-review/context.md`: se revisa con la rúbrica genérica.

## Respuesta conocida (no se entrega a los agentes)
Python (`scripts/check_commit_msg.py`):
| ID | Defecto |
|---|---|
| P1 | El límite de 72 caracteres se omite cuando el asunto lleva alcance (`and not match.group(2)`): lógica incorrecta |
| P2 | `os.system("prettier --write " + path)`: inyección de comandos con una ruta que controla quien llama |
| P3 | `open(path).read()` sin cerrar ni indicar la codificación (menor) |

Infraestructura (`.github/workflows/deploy.yml`):
| ID | Defecto |
|---|---|
| I1 | `pull_request_target` con `checkout` del SHA del PR y `npm ci && npm run build`: ejecuta código no confiable con acceso a los secretos |
| I2 | `echo "deploying with $DEPLOY_TOKEN"` imprime el secreto en el registro |
| I3 | `actions/checkout@main`: referencia mutable |
| I4 | El secreto está en el `env` del job y lo ve el paso de `build` (relacionado con I1) |

Puntuación: recall = elementos que el hallazgo describe, con la línea del cambio. Los hallazgos fuera de la lista se etiquetan después (A, M o R) y alimentan el ledger.

## Límites
Una corrida, un modelo, defectos plantados por quien escribió la skill (no independientes) y un repositorio donde las cifras del proyecto original no se aplican. Es una prueba de que el flujo funciona, no una medida de acierto.
