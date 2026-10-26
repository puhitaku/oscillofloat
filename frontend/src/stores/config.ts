import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../lib/api'
import { DEFAULT_ASPECT, drawableArea } from '../lib/aspect'
import type { AppConfig } from '../lib/types'

/** The backend's public configuration, fetched once per page load. */
export const useConfigStore = defineStore('config', () => {
  const config = ref<AppConfig | null>(null)
  const error = ref('')

  const aspect = computed(() => config.value?.settings.aspect ?? DEFAULT_ASPECT)
  const area = computed(() => drawableArea(aspect.value))
  const auth = computed(() => config.value?.auth ?? null)

  async function load() {
    try {
      config.value = await api.config()
      error.value = ''
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  function setAspect(value: string) {
    if (config.value) config.value.settings.aspect = value
  }

  return { config, error, aspect, area, auth, load, setAspect }
})
