<script setup lang="ts">
import { KeyRound, LoaderCircle, LogOut } from 'lucide-vue-next'
import { onMounted } from 'vue'
import AdminDrawings from '../components/AdminDrawings.vue'
import AdminLogin from '../components/AdminLogin.vue'
import AdminSettings from '../components/AdminSettings.vue'
import { useAdminStore } from '../stores/admin'

const admin = useAdminStore()

onMounted(() => admin.init())
</script>

<template>
  <div class="h-full overflow-y-auto bg-black text-zinc-200">
    <div
      v-if="!admin.ready"
      class="flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-500"
    >
      <template v-if="admin.error">
        <p role="alert" class="text-red-400">{{ admin.error }}</p>
        <button
          type="button"
          class="rounded-md border border-zinc-700 px-4 py-2 text-zinc-200 hover:bg-zinc-800"
          @click="admin.init()"
        >
          再試行
        </button>
      </template>
      <p v-else class="flex items-center gap-2">
        <LoaderCircle class="size-5 animate-spin text-scope-500" aria-hidden="true" />
        読み込み中…
      </p>
    </div>

    <div v-else-if="!admin.signedIn" class="flex min-h-full items-center justify-center p-4">
      <AdminLogin />
    </div>

    <div v-else class="mx-auto flex max-w-5xl flex-col gap-4 p-4 pb-12">
      <header class="flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-3">
        <h1 class="mr-auto text-lg font-semibold text-zinc-100">
          oscillofloat <span class="text-scope-400">管理</span>
        </h1>
        <span
          v-if="admin.noAuth"
          class="rounded border border-amber-700 px-2 py-0.5 text-xs text-amber-400"
        >
          認証なしモード（開発用）
        </span>
        <template v-else>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
            :disabled="admin.busy"
            @click="admin.addPasskey()"
          >
            <KeyRound class="size-4" aria-hidden="true" />
            パスキーを追加
          </button>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
            @click="admin.signOut()"
          >
            <LogOut class="size-4" aria-hidden="true" />
            ログアウト
          </button>
        </template>
      </header>

      <p v-if="admin.error" role="alert" class="text-sm text-red-400">{{ admin.error }}</p>
      <p v-if="admin.notice" role="status" class="text-sm text-scope-400">{{ admin.notice }}</p>

      <AdminSettings />
      <AdminDrawings />
    </div>
  </div>
</template>
