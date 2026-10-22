## Foco de este revisor: Python
Aplica la rúbrica con este foco, en este orden de prioridad:

1. **SQL:** consultas construidas por concatenación o f-strings con datos externos; falta de parámetros enlazados; consultas sin límite.
2. **Autorización:** funciones o endpoints que ejecutan acciones sin verificar quién llama ni qué puede hacer.
3. **Async:** llamadas bloqueantes dentro de código `async`, tareas sin esperar, recursos sin cerrar, condiciones de carrera.
4. **Dinero y decimales:** uso de `float` para montos, redondeos sin criterio, comparaciones de igualdad con decimales.
5. **Errores:** excepciones tragadas, `except:` genérico, mensajes que filtran detalles internos.
6. **Rutas, archivos y datos del cliente:** rutas absolutas de una máquina, nombres de cliente o credenciales escritos en el archivo, scripts que sobrescriben su propia entrada o no se pueden repetir sin deshacer su resultado, copias de seguridad dentro de carpetas que se publican.

No comentes estilo salvo que cause un riesgo real. Cada hallazgo cita archivo y línea.
