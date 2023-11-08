import { createClient, getTasks } from '@vitest/ws-client'
import type { WebSocketStatus } from '@vueuse/core'
import type { File, ResolvedConfig } from 'vitest'
import type { Ref } from 'vue'
import { reactive } from 'vue'
import type { RunState } from '../../../types'
import { ENTRY_URL, isReport } from '../../constants'
import { activeFileId } from '../params'
import { createStaticClient } from './static'

export { ENTRY_URL, PORT, HOST, isReport } from '../../constants'

export const testRunState: Ref<RunState> = ref('idle')
export const unhandledErrors: Ref<unknown[]> = ref([])
const filesRef = ref<File[]>([])
export const files = computed({
  get: () => filesRef.value,
  set: files => filesRef.value = files,
})

export const client = (function createVitestClient() {
  if (isReport) {
    return createStaticClient()
  }
  else {
    return createClient(ENTRY_URL, {
      reactive: reactive as any,
      handlers: {
        onTaskUpdate() {
          testRunState.value = 'running'
        },
        onFinished(_files, errors) {
          testRunState.value = 'idle'
          unhandledErrors.value = errors || []
          files.value = _files || []
        },
      },
    })
  }
})()

export const config = shallowRef<ResolvedConfig>({} as any)
export const status = ref<WebSocketStatus>('CONNECTING')
export const current = computed(() => files.value.find(file => file.id === activeFileId.value))
export const currentLogs = computed(() => getTasks(current.value).map(i => i?.logs || []).flat() || [])

export function findById(id: string) {
  return files.value.find(file => file.id === id)
}

export const isConnected = computed(() => status.value === 'OPEN')
export const isConnecting = computed(() => status.value === 'CONNECTING')
export const isDisconnected = computed(() => status.value === 'CLOSED')

export function runAll(files = client.state.getFiles()) {
  return runFiles(files)
}

export function runFiles(files: File[]) {
  files.forEach((f) => {
    delete f.result
    getTasks(f).forEach(i => delete i.result)
  })
  return client.rpc.rerun(files.map(i => i.filepath))
}

export function runCurrent() {
  if (current.value)
    return runFiles([current.value])
}

watch(
  () => client.ws,
  (ws) => {
    status.value = isReport ? 'OPEN' : 'CONNECTING'

    ws.addEventListener('open', async () => {
      status.value = 'OPEN'
      client.state.filesMap.clear()
      const [files, _config] = await Promise.all([
        client.rpc.getFiles(),
        client.rpc.getConfig(),
      ])
      client.state.collectFiles(files)
      unhandledErrors.value = await client.rpc.getUnhandledErrors()
      config.value = _config
    })

    ws.addEventListener('close', () => {
      setTimeout(() => {
        if (status.value === 'CONNECTING')
          status.value = 'CLOSED'
      }, 1000)
    })
  },
  { immediate: true },
)

// display the first file on init
// if (!activeFileId.value) {
//   const stop = watch(
//     () => client.state.getFiles(),
//     (files) => {
//       if (activeFileId.value) {
//         stop()
//         return
//       }
//
//       if (files.length && files[0].id) {
//         activeFileId.value = files[0].id
//         stop()
//       }
//     },
//     { immediate: true },
//   )
// }
