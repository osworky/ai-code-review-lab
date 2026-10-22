/** Valida el cuerpo de POST /eventos. La ruta es pública: no hay sesión. Ver docs/api.md. */
export const ORIGENES = ["web", "app", "telefono"] as const

const CLAVES_RESERVADAS = new Set(["__proto__", "constructor", "prototype"])

/** Niveles de objetos y arreglos que se aceptan dentro de un payload. */
const PROFUNDIDAD_MAXIMA = 4

export type Resultado = { ok: true } | { ok: false; error: "tipo" | "origen" | "payload" }

export function validarEvento(body: unknown): Resultado {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "tipo" }
  const { origen, payload } = body as Record<string, unknown>
  if (typeof origen !== "string" || !(ORIGENES as readonly string[]).includes(origen)) return { ok: false, error: "origen" }
  if (payload !== undefined && !esPayloadLimpio(payload, PROFUNDIDAD_MAXIMA)) return { ok: false, error: "payload" }
  return { ok: true }
}

/** Un payload es limpio si no tiene claves reservadas ni más de `profundidad` niveles, arreglos incluidos. */
function esPayloadLimpio(valor: unknown, profundidad: number): boolean {
  if (profundidad < 0) return false
  if (Array.isArray(valor)) return valor.every((v) => esPayloadLimpio(v, profundidad - 1))
  if (typeof valor === "object" && valor !== null) {
    return Object.entries(valor).every(([clave, v]) => !CLAVES_RESERVADAS.has(clave) && esPayloadLimpio(v, profundidad - 1))
  }
  return true
}
