# API de eventos

`POST /eventos` recibe un JSON. La ruta es pública (no hay sesión).

## Cuerpo
| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `origen` | texto | sí | Uno de `web`, `app`, `telefono` |
| `payload` | objeto | no | Datos libres; hasta 4 niveles, sin las claves `__proto__`, `constructor` ni `prototype` |

## Respuesta
`{ "ok": true }` si el evento es válido, o `{ "ok": false, "error": "<código>" }` con uno de:

| Código | Cuándo |
|---|---|
| `tipo` | El cuerpo no es un objeto |
| `origen` | `origen` falta o no está en la lista |
| `payload` | El payload tiene claves reservadas o es demasiado profundo |
