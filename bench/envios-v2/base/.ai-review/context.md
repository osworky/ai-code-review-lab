# Contexto del proyecto para el revisor

## Qué es el proyecto
Un cotizador de envíos ficticio por zona y peso, con una API pública de eventos, un reporte y un script que importa tarifas desde un CSV.

## Qué mirar sobre todo, por categoría
- **corrección:** el cálculo del precio y la moneda (`src/cotizar.ts`), las fechas de entrega (`src/fechas.ts`) y el dinero.
- **seguridad:** `src/api-eventos.ts` es una ruta pública sin sesión: se esperan listas de valores permitidos, rechazo de claves reservadas y límite de profundidad. También el script de Python que lee archivos y los workflows de `.github/workflows/`.
- **rendimiento:** el reporte (`src/reporte.ts`) recorre hasta 2000 eventos.
- **tests faltantes:** los tests viven en `tests/`. Un cambio de lógica o una corrección de un error debe traer su test.
- **documentación:** `docs/api.md` describe el contrato de la API y `README.md` el uso del script y las zonas.

## Zonas donde la decisión es siempre humana
Dinero que ve el cliente (tarifas y cálculo del precio), secretos y permisos de los workflows, y la validación de la API pública.

## Lo que el revisor no ve y suele causar falsos positivos
Los tests y la documentación solo aparecen si cambian en el diff; antes de decir que algo "no se valida" o "no está documentado", comprueba que no lo está en el propio diff.
