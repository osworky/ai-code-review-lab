import { describe, expect, it } from "vitest"

import { cotizarLote, descuentoPorCantidad, mejorOpcion, ordenarPorCosto } from "../src/paquetes"
import { tarifas } from "../src/tarifas"

describe("descuentoPorCantidad", () => {
  it("no da descuento a un solo paquete", () => {
    expect(descuentoPorCantidad(1)).toBe(0)
  })

  it("da el descuento mayor a un lote grande", () => {
    expect(descuentoPorCantidad(40)).toBe(0.2)
  })
})

describe("ordenarPorCosto", () => {
  it("no modifica el arreglo que recibe", () => {
    const original = tarifas.filter((t) => t.zona === "local")
    const copia = [...original]
    ordenarPorCosto(original)
    expect(original).toEqual(copia)
  })

  it("pone primero la opción más barata de una zona en dólares", () => {
    const ordenadas = ordenarPorCosto(tarifas.filter((t) => t.zona === "local"))
    expect(ordenadas[0].id).toBe("loc-1")
  })
})

describe("mejorOpcion", () => {
  it("elige la tarifa local liviana", () => {
    expect(mejorOpcion("local", 3)?.id).toBe("loc-1")
  })

  it("devuelve null si ninguna tarifa cubre el peso", () => {
    expect(mejorOpcion("local", 99)).toBeNull()
  })
})

describe("cotizarLote", () => {
  it("suma las mejores opciones de cada línea", () => {
    const lote = cotizarLote([
      { zona: "local", kg: 3 },
      { zona: "local", kg: 12 },
    ])
    expect(lote.cantidad).toBe(2)
    expect(lote.subtotalUsd).toBe(13)
    expect(lote.totalUsd).toBe(13)
  })
})
