# Informe del registro de revisiones

Hallazgos registrados: 11. Sin etiqueta todavía: 1. Defectos que el revisor no vio (anotados): 0. PR auditados por otra vía: 1.

## Precisión (solo hallazgos con etiqueta)

n = 10 (**datos insuficientes**: menos de 30 filas)
- Accionables (A): 7, 70 % (IC 95 % 40 a 89 %)
- Accionables o menores (A + M): 10, 100 % (IC 95 % 72 a 100 %)
- Ruido (R): 0, 0 % (IC 95 % 0 a 28 %)

| Categoría | n | A | M | R | Precisión amplia | Estado |
|---|---|---|---|---|---|---|
| correctness | 4 | 2 | 2 | 0 | 100 % (IC 95 % 51 a 100 %) | datos insuficientes |
| security | 5 | 5 | 0 | 0 | 100 % (IC 95 % 57 a 100 %) | datos insuficientes |
| performance | 1 | 0 | 1 | 0 | 100 % (IC 95 % 21 a 100 %) | datos insuficientes |
| missing_tests | 0 | 0 | 0 | 0 | n/a | datos insuficientes |
| style | 0 | 0 | 0 | 0 | n/a | datos insuficientes |
| documentation | 0 | 0 | 0 | 0 | n/a | datos insuficientes |

## Recall (solo PR auditados)

El revisor vio 10 de los 10 defectos conocidos en esos PR: 100 % (IC 95 % 72 a 100 %) (**datos insuficientes**).

## Cómo leerlo

- La precisión sale de lo que el revisor **levantó**, no de una muestra aleatoria: describe cómo salieron esos hallazgos, no todo lo que podría decir. Las filas de un mismo PR no son independientes.
- El recall solo se estima con los PR que alguien auditó por otra vía sin mirar la salida del revisor. Sin auditorías no hay falsos negativos medidos.
- Un solo etiquetador y un solo modelo no generalizan a otros. Cambiar el prompt o el modelo reinicia la lectura de lo que viene después.
