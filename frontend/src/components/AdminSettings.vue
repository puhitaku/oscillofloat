<script setup lang="ts">
import { Save } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { parseAspect } from '../lib/aspect'
import { useAdminStore } from '../stores/admin'
import { useConfigStore } from '../stores/config'

const admin = useAdminStore()
const config = useConfigStore()

const aspect = ref(config.aspect)
const touched = ref(false)
watch(
  () => config.aspect,
  (value) => (aspect.value = value),
)

const invalid = computed(() => parseAspect(aspect.value) === null)
const showInvalid = computed(() => touched.value && invalid.value)

async function save() {
  touched.value = true
  if (invalid.value) return
  const [w, h] = parseAspect(aspect.value)!
  if (await admin.saveAspect(`${w}:${h}`)) touched.value = false
}
</script>

<template>
  <section
    class="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
    aria-labelledby="admin-settings-title"
  >
    <h2 id="admin-settings-title" class="text-sm font-semibold text-zinc-200">設定</h2>
    <form class="mt-3 flex flex-col gap-1" novalidate @submit.prevent="save">
      <label for="admin-aspect" class="text-sm text-zinc-400">
        オシロスコープ画面のアスペクト比（W:H）
      </label>
      <div class="flex items-center gap-3">
        <input
          id="admin-aspect"
          v-model="aspect"
          type="text"
          inputmode="text"
          placeholder="5:4"
          class="w-40 rounded-md border bg-black px-3 py-2 text-sm text-zinc-100 tabular-nums focus:outline-none"
          :class="showInvalid ? 'border-red-500' : 'border-zinc-700 focus:border-scope-500'"
          :aria-invalid="showInvalid"
          aria-describedby="admin-aspect-help"
          @input="touched = true"
        />
        <button
          type="submit"
          class="flex items-center gap-2 rounded-md bg-scope-500 px-4 py-2 text-sm font-medium text-black hover:bg-scope-400 disabled:opacity-50"
          :disabled="admin.busy"
        >
          <Save class="size-4" aria-hidden="true" />
          保存
        </button>
      </div>
    </form>
    <p
      id="admin-aspect-help"
      class="mt-2 text-xs"
      :class="showInvalid ? 'text-red-400' : 'text-zinc-500'"
      :role="showInvalid ? 'alert' : undefined"
    >
      {{
        showInvalid
          ? '「5:4」のように正の整数を「:」で区切って入力してください。'
          : `現在の設定: ${config.aspect}。描画ページはこの比率の範囲だけ描けるようになります。`
      }}
    </p>
  </section>
</template>
