export type Moneda = "USD" | "EUR"
export type Zona = "local" | "regional" | "nacional" | "internacional"

export type Tarifa = {
  id: string
  zona: Zona
  /** Peso máximo que cubre esta tarifa, en kilos (inclusive). */
  maxKg: number
  precio: number
  moneda: Moneda
}

/** Cuántos dólares vale una unidad de cada moneda. */
export const aDolares: Record<Moneda, number> = { USD: 1, EUR: 1.1 }

export const tarifas: Tarifa[] = [
  { id: "loc-1", zona: "local", maxKg: 5, precio: 4, moneda: "USD" },
  { id: "loc-2", zona: "local", maxKg: 20, precio: 9, moneda: "USD" },
  { id: "reg-1", zona: "regional", maxKg: 5, precio: 10, moneda: "EUR" },
  { id: "reg-2", zona: "regional", maxKg: 5, precio: 10.5, moneda: "USD" },
  { id: "reg-3", zona: "regional", maxKg: 20, precio: 17, moneda: "USD" },
  { id: "nac-1", zona: "nacional", maxKg: 10, precio: 22, moneda: "USD" },
  { id: "nac-2", zona: "nacional", maxKg: 30, precio: 41, moneda: "EUR" },
  { id: "int-1", zona: "internacional", maxKg: 10, precio: 55, moneda: "USD" },
  { id: "int-2", zona: "internacional", maxKg: 30, precio: 120, moneda: "USD" },
]
