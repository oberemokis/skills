const rows = new Map<string, Record<string, unknown>>()
let next = 1

export const db = {
  async insert(table: string, row: object): Promise<string> {
    const id = String(next++)
    rows.set(`${table}:${id}`, { ...row })
    return id
  },
  async get(table: string, id: string): Promise<Record<string, unknown> | undefined> {
    return rows.get(`${table}:${id}`)
  },
}
