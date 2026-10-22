# Cómo contribuir

## Commits convencionales
Todos los commits siguen [Conventional Commits 1.0](https://www.conventionalcommits.org/es/v1.0.0/):

```
tipo(ámbito)!: descripción corta

Cuerpo opcional: qué cambia y por qué, no cómo.

BREAKING CHANGE: opcional, si rompe compatibilidad
Co-Authored-By: ...
```

| Tipo | Cuándo |
|---|---|
| `feat` | capacidad nueva (un script, un prompt usable, un esquema) |
| `fix` | corrección de un defecto |
| `docs` | documentación, diseños, changelog |
| `test` | pruebas nuevas o corregidas |
| `refactor` | cambio interno sin cambio de comportamiento |
| `perf` | mejora de rendimiento medida |
| `build`, `ci` | empaquetado, workflows |
| `chore` | mantenimiento sin efecto en el comportamiento |
| `revert` | deshace un commit anterior |

Ámbitos habituales: `prompts`, `scripts`, `schemas`, `rubric`, `experiments`, `design`, `ci`.
Un solo cambio lógico por commit; el asunto en imperativo, sin punto final y de 72 caracteres como máximo.

### Verificación
El hook `commit-msg` rechaza los mensajes que no cumplan, y el CI revisa todos los commits de un PR.
```bash
git config core.hooksPath .githooks      # activar el hook, una vez por clon
py scripts/check_commit_msg.py <archivo>  # comprobar un mensaje a mano
```

## Prompts
Un prompt publicado no se edita: se crea la versión siguiente, se anota en `prompts/CHANGELOG.md` y entra por PR. Estados y reglas en `prompts/README.md`.

## Pruebas
```bash
py -m unittest discover -s tests
```
