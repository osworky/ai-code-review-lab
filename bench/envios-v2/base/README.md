# Envíos por zona y peso (módulo de ejemplo)

Un cotizador de envíos ficticio. Las tarifas, las zonas y las monedas son inventadas.

## Qué hay
| Archivo | Para qué |
|---|---|
| `src/tarifas.ts` | La tabla de tarifas por zona y peso |
| `src/cotizar.ts` | Elige la opción más barata de una zona |
| `src/fechas.ts` | Fechas de entrega y totales en centavos |
| `src/api-eventos.ts` | Validación del cuerpo de `POST /eventos` (ver `docs/api.md`) |
| `src/reporte.ts` | Resumen por zona e ingreso estimado |
| `scripts/importar_tarifas.py` | Lee un CSV de `data/` |

## Zonas
`local`, `regional`, `nacional`, `internacional`.

## Importar tarifas
```
python scripts/importar_tarifas.py tarifas.csv
```
El archivo debe estar en `data/`.

## Pruebas
```
npm test
```
