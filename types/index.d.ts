// Контракт состояния модулей хуков плагина: claude plugin validate сверяет с ним
// каждый ключ $.state, который называет модуль.

export type StepStatus = 'done' | 'current' | 'pending'

export type FleetTask = {
  id: string
  title: string
  level: string
  stage: string
  status: string
  waiting: string | null
  sinceMs: number
  steps: StepStatus[]
  isClosed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'oberemokis-skills': {
      fleetOrchestrator: Shaped<boolean>
      fleetRoot: Shaped<string>
      fleetTasks: Shaped<FleetTask[]>
      fleetNow: Shaped<number>
    }
  }
}
