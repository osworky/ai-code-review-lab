import { describe, expect, it } from "vitest"

import { validarEvento } from "../src/api-eventos"

describe("validarEvento", () => {
  it("acepta un evento con un origen conocido", () => {
    expect(validarEvento({ origen: "web" })).toEqual({ ok: true })
  })

  it("rechaza lo que no es un objeto", () => {
    expect(validarEvento(null)).toEqual({ ok: false, error: "tipo" })
    expect(validarEvento([1])).toEqual({ ok: false, error: "tipo" })
    expect(validarEvento("web")).toEqual({ ok: false, error: "tipo" })
  })

  it("rechaza un origen que no está en la lista", () => {
    expect(validarEvento({ origen: "fax" })).toEqual({ ok: false, error: "origen" })
    expect(validarEvento({ origen: 3 })).toEqual({ ok: false, error: "origen" })
  })

  it("rechaza claves reservadas en el payload, también dentro de objetos", () => {
    const sucio = JSON.parse('{"origen":"app","payload":{"a":{"__proto__":{"x":1}}}}')
    expect(validarEvento(sucio)).toEqual({ ok: false, error: "payload" })
  })

  it("rechaza un payload demasiado profundo", () => {
    let payload: unknown = 1
    for (let i = 0; i < 6; i++) payload = { siguiente: payload }
    expect(validarEvento({ origen: "app", payload })).toEqual({ ok: false, error: "payload" })
  })
})
