import { describe, it, expect, vi } from 'vitest'
import { createOrder, getOrder } from './orders'
import { db } from './db'

let lastOrderId: string

describe('orders', () => {
  it('creates an order', async () => {
    const saveSpy = vi.spyOn(db, 'insert')
    await createOrder({ sku: 'A1', qty: 1 })
    expect(saveSpy).toHaveBeenCalled()
  })

  it('stores the order id', async () => {
    lastOrderId = await createOrder({ sku: 'A1', qty: 1 })
    expect(lastOrderId).toBeDefined()
  })

  it('reads the order created before', async () => {
    const order = await getOrder(lastOrderId)
    expect(order?.sku).toBe('A1')
  })
})
