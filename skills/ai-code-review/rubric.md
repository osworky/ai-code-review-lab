# Rúbrica de revisión de código

Se define antes del prompt: sin categorías nombradas el revisor elige lo más superficial y abundante, que es el estilo. Cada categoría dice dónde mirar y permite medir el acuerdo por categoría. Lo específico del proyecto (rutas, contratos, zonas sensibles) va en `.ai-review/context.md`, no aquí.

| Categoría | Pregunta que responde | Mirar sobre todo |
|---|---|---|
| **corrección** | ¿El código hace lo que dice y respeta los contratos del proyecto? | Cálculos, casos límite, validación de entradas, contratos documentados |
| **seguridad** | ¿Se abre una vulnerabilidad? | Autorización o lista de permitidos ausente, secretos, errores que filtran detalles, inyección, XSS, datos personales |
| **rendimiento** | ¿Escala o se degrada? | Bucles anidados sobre listas grandes, consultas sin límite, trabajo repetido en cada ejecución |
| **tests faltantes** | ¿El cambio viene con pruebas? | Funciones nuevas o lógica cambiada sin test |
| **estilo** | ¿Respeta convenciones, nombres y legibilidad? | Nombres inconsistentes, formato, código muerto |
| **documentación** | ¿Los cambios públicos están documentados? | Campos nuevos de una API, funciones exportadas, documentos del proyecto |

## Severidad
- **crítica:** explotable o pierde dinero o datos sin condiciones especiales.
- **alta:** rompe un contrato o una barrera de seguridad definidos por el proyecto.
- **media:** degrada o deja un hueco que se agravará.
- **baja:** mejora de mantenimiento.

## Reglas de alcance
- Se revisa solo lo que cambia en el diff. Lo que ya estaba antes no es un hallazgo de este cambio.
- Un cambio inofensivo (renombrar una variable local, añadir un test de un comportamiento existente) no es un hallazgo.
- Una categoría sin hallazgos claros se declara "sin hallazgos".

## Valores para la salida JSON
| Categoría de la rúbrica | Valor de `category` |
|---|---|
| corrección | `correctness` |
| seguridad | `security` |
| rendimiento | `performance` |
| tests faltantes | `missing_tests` |
| estilo | `style` |
| documentación | `documentation` |

| Severidad | Valor de `severity` | Qué hace el pipeline |
|---|---|---|
| crítica o alta: rompe un contrato o una barrera de seguridad, o pierde datos o dinero | `blocker` | Puede bloquear el merge (solo en las fases de bloqueo) |
| media: problema real que conviene corregir pero no frena el cambio | `advisory` | Comenta de forma visible |
| baja: observación sin acción obligatoria | `info` | Se registra |
