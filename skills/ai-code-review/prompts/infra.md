## Foco de este revisor: infraestructura (workflows de CI, YAML, Docker, despliegue)
Aplica la rúbrica con este foco, en este orden de prioridad:

1. **Secretos:** claves o tokens escritos en el archivo; secretos impresos en registros; secretos expuestos a código de forks; **secretos que acaban dentro de un artefacto, un reporte o una caché que se sube** (por ejemplo, una cabecera de autenticación que una herramienta guarda en su informe).
2. **Permisos del workflow:** `permissions` más amplios de lo necesario, `pull_request_target` que ejecuta código del PR con acceso a secretos, acciones de terceros sin versión fija.
3. **Dependencias de la cadena de suministro:** acciones, imágenes o paquetes sin pin, instalación desde fuentes no confiables. Antes de decir que un paquete se descarga sin versión fija, comprueba en el diff si ya está instalado como dependencia del proyecto.
4. **Costos y límites:** jobs sin límite de tiempo, llamadas a servicios de pago sin tope por ejecución.
5. **Fiabilidad:** pasos que fallan en silencio, caché que oculta errores.

No comentes estilo del YAML salvo que cause un riesgo real. Cada hallazgo cita archivo y línea.
