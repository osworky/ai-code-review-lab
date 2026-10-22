import { describe, expect, it } from "vitest"

import { manejarSolicitud, validarLote } from "../src/api-lotes"

describe("validarLote", () => {
  it("acepta un lote de eventos válidos", () => {
    expect(validarLote([{ origen: "web" }, { origen: "app", etiqueta: "campaña" }])).toEqual({ ok: true, cantidad: 2 })
  })

  it("rechaza lo que no es un arreglo", () => {
    expect(validarLote({ origen: "web" })).toEqual({ ok: false, error: "tipo" })
  })

  it("rechaza un lote vacío o demasiado grande", () => {
    expect(validarLote([])).toEqual({ ok: false, error: "tamano" })
    expect(validarLote(Array.from({ length: 51 }, () => ({ origen: "web" })))).toEqual({ ok: false, error: "tamano" })
  })

  it("rechaza un evento con un origen desconocido y dice cuál", () => {
    expect(validarLote([{ origen: "web" }, { origen: "fax" }])).toEqual({ ok: false, error: "evento 1: origen" })
  })

  it("rechaza una etiqueta con marcas HTML", () => {
    const resultado = validarLote([{ origen: "web", etiqueta: "<b>x</b>" }])
    expect(resultado.ok).toBe(false)
  })
})

describe("manejarSolicitud", () => {
  it("responde 400 si el texto no es JSON", () => {
    expect(manejarSolicitud({}, "{no")).toEqual({ status: 400, error: "json" })
  })

  it("responde 200 con la cantidad de eventos", () => {
    expect(manejarSolicitud({}, '[{"origen":"web"}]')).toEqual({ status: 200, cantidad: 1 })
  })

  it("responde 422 si el lote es inválido", () => {
    expect(manejarSolicitud({}, "[]").status).toBe(422)
  })
})
