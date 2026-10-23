# Resultados: prueba de punta a punta de la skill `ai-code-review`

Fecha: 2026-10-22. Protocolo y respuesta conocida en `README.md` (escritos antes de ejecutar a los agentes). Evidencia completa en `run/`: el plan, los diffs anotados, la salida de cada revisor, la revisión fusionada, el ledger y el informe.

## Qué se comprobó
Que la skill funciona **fuera de Traslados**, en una copia del propio lab, siguiendo `SKILL.md` paso a paso:
1. `prepare` partió el cambio en dos bloques (`python` e `infra`) y numeró las líneas.
2. Dos agentes nuevos y aislados, uno por bloque, con el prompt base, el foco del bloque, la rúbrica genérica y sin contexto de proyecto.
3. `merge` validó los dos bloques (esquema, valores permitidos y líneas citadas dentro del diff), los fusionó y **registró 11 hallazgos en el ledger**.
4. Se etiquetaron los hallazgos con `ledger resolve`, se marcó el PR como auditado con `ledger audit` y se emitió el informe.

Todo salió a la primera, sin reintentos: las dos salidas fueron válidas. Coste: 62 mil y 62 mil tokens por agente (dato de la herramienta), unos 17 s cada uno.

## Contra la respuesta conocida
| ID | Defecto plantado | ¿Lo vio? | Hallazgo |
|---|---|---|---|
| P1 | El límite de 72 caracteres se omite con alcance | Sí | `length-check-skipped-by-group` (línea 36) |
| P2 | Inyección de comandos con `os.system` | Sí | `shell-command-injection` (línea 94) |
| P3 | `open(path).read()` sin cerrar (menor) | Sí | `unclosed-file-handle` (línea 93) |
| I1 | `pull_request_target` con el código del PR | Sí | `pull-request-target-untrusted-code` (línea 12) |
| I2 | El secreto se imprime en el registro | Sí | `secret-printed-in-logs` (línea 14) |
| I3 | `actions/checkout@main` | Sí | `unpinned-action` (línea 10) |
| I4 | El secreto en el `env` visible para `build` | Sí | Dentro del hallazgo de I1, que cita `DEPLOY_TOKEN` en el entorno del job |

**7 de 7.** Esto **no es una medida de acierto**: los defectos los plantó quien escribió la skill, son de manual, y el foco de infraestructura menciona los secretos en registros. Prueba que el flujo funciona.

## Hallazgos fuera de la lista (etiquetados por el usuario)
| Hallazgo | Comprobación | Etiqueta |
|---|---|---|
| `check_file` se define tras el bloque principal y no se usa desde `main` | Cierto | M |
| El validador ejecuta `prettier --write` sobre su propia entrada | Cierto (el texto se lee antes de formatear) | A |
| El workflow no declara `permissions` | Cierto; el revisor avisó de que no ve la configuración del repo | A |
| El job no define `timeout-minutes` | Cierto | M |
| Faltan tests de la lógica cambiada | **Artefacto**: los tests existen fuera del diff; sin etiquetar | (pendiente) |

Dos de los cuatro etiquetados son accionables y ninguno es ruido: son hallazgos reales que la respuesta conocida no contenía.

## El informe del ledger
Con 10 filas etiquetadas dice **datos insuficientes** en todas las categorías (mínimo 30): precisión estricta 70 % (intervalo 40 a 89 %), amplia 100 % (72 a 100 %), ruido 0 %. El recall sobre el PR auditado sale 10 de 10, también como datos insuficientes. Los 7 defectos plantados se registraron con `--by answer-key` para distinguirlos de las etiquetas humanas.

## Lo que se aprendió
- **La estructura portable funciona:** rutas en `.ai-review/`, contexto y configuración por proyecto, la skill sin nada de Traslados.
- **Un defecto de redacción del informe** apareció al leerlo ("Hallazgos reales del revisor 10 de 10 defectos conocidos") y se corrigió con su test.
- **Un error de proceso mío:** al preparar la skill, un `git add -A` incluyó un enlace a `node_modules`; se detectó antes de confirmar, se deshizo y se añadió `node_modules/` al `.gitignore`.

## Límites
Una corrida, un modelo, defectos plantados y evidentes, un solo etiquetador y 10 filas. No dice nada sobre el acierto real de la skill ni sobre otros lenguajes; solo que el flujo y el ledger funcionan de punta a punta.
