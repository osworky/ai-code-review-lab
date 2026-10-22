import { validarEvento } from "./api-eventos"

const MAX_EVENTOS = 50
const MAX_TEXTO = 200

// Caracteres de control (saltos de línea incluidos): no deben llegar al registro ni al reporte.
const CONTROL = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]")

/** Un texto es seguro si cabe en el límite y no tiene caracteres de control ni marcas HTML. */
function textoSeguro(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length <= MAX_TEXTO && !CONTROL.test(valor) && !/[<>]/.test(valor)
}

export type EventoLote = { origen: string; etiqueta?: string; nota?: string; payload?: unknown }

export type ResultadoLote = { ok: true; cantidad: number } | { ok: false; error: string }

export function validarLote(cuerpo: unknown): ResultadoLote {
  if (!Array.isArray(cuerpo)) return { ok: false, error: "tipo" }
  if (cuerpo.length === 0 || cuerpo.length > MAX_EVENTOS) return { ok: false, error: "tamano" }

  for (const [indice, evento] of cuerpo.entries()) {
    const base = validarEvento(evento)
    if (!base.ok) return { ok: false, error: `evento ${indice}: ${base.error}` }

    const { etiqueta, nota } = evento as EventoLote
    if (etiqueta !== undefined && !textoSeguro(etiqueta)) {
      return { ok: false, error: `evento ${indice}: etiqueta invalida: ${etiqueta}` }
    }
    if (nota !== undefined && typeof nota !== "string") {
      return { ok: false, error: `evento ${indice}: nota` }
    }
  }
  return { ok: true, cantidad: cuerpo.length }
}

export type Respuesta = { status: 200; cantidad: number } | { status: 400 | 422; error: string }

/** Atiende POST /eventos/lote: recibe las cabeceras y el texto del cuerpo, y responde con un código HTTP. */
export function manejarSolicitud(encabezados: Record<string, string>, texto: string): Respuesta {
  let cuerpo: unknown
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    return { status: 400, error: "json" }
  }
  const resultado = validarLote(cuerpo)
  if (!resultado.ok) return { status: 422, error: resultado.error }
  return { status: 200, cantidad: resultado.cantidad }
}
