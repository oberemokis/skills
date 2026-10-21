import { db } from './db'

export async function createOrder(input: { sku: string; qty: number }): Promise<string> {
  return db.insert('orders', input)
}

export async function getOrder(id: string): Promise<Record<string, unknown> | undefined> {
  return db.get('orders', id)
}
