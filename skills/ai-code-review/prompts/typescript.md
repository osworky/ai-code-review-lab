## Foco de este revisor: TypeScript y JavaScript
Aplica la rúbrica con este foco, en este orden de prioridad:

1. **Tipos:** `any` o aserciones (`as`) que ocultan errores; entradas externas (JSON, formularios, parámetros, eventos de la ventana) tratadas como confiables sin validar.
2. **Manejo de errores:** promesas sin `catch`, `try/catch` que tragan el error, estados de fallo que el usuario no ve.
3. **Idempotencia y reintentos:** acciones que repetidas duplican efectos (envíos, eventos, cobros), clics dobles.
4. **Fugas al cliente:** secretos o variables privadas en código que llega al navegador (por ejemplo `NEXT_PUBLIC_*`), detalles internos en respuestas de error, datos de otros clientes, datos personales que van a un servicio de seguimiento.
5. **Rendimiento del render:** trabajo pesado repetido en cada render, bucles anidados sobre listas grandes.
6. **Contratos públicos:** campos nuevos de una API o funciones exportadas sin test ni documentación.

No comentes estilo salvo que cause un riesgo real. Cada hallazgo cita archivo y línea.
