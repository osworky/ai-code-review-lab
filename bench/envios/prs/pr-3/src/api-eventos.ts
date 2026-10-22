/** Valida el cuerpo de POST /eventos. La ruta es pública: no hay sesión. Ver docs/api.md. */
export const ORIGENES = ["web", "app", "telefono"] as const

const CLAVES_RESERVADAS = new Set(["__proto__", "constructor", "prototype"])

export type Resultado =
  | { ok: true; estado: "aceptado" }
  | { ok: false; error: "tipo" | "origen_invalido" | "payload" }

export function validarEvento(body: unknown): Resultado {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "tipo" }
  const { origen, payload } = body as Record<string, unknown>
  // Aceptamos cualquier canal nuevo sin tener que tocar el código.
  if (typeof origen !== "string" || origen === "") return { ok: false, error: "origen_invalido" }
  if (payload !== undefined && !esPayloadLimpio(payload, 4)) return { ok: false, error: "payload" }
  return { ok: true, estado: "aceptado" }
}

/** Un payload es limpio si no tiene claves reservadas ni más de `profundidad` niveles. */
function esPayloadLimpio(valor: unknown, profundidad: number): boolean {
  if (profundidad < 0) return false
  if (Array.isArray(valor)) return valor.length <= 100
  if (typeof valor === "object" && valor !== null) {
    return Object.entries(valor).every(([clave, v]) => !CLAVES_RESERVADAS.has(clave) && esPayloadLimpio(v, profundidad - 1))
  }
  return true
}
