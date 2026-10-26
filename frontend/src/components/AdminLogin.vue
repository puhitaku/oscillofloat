<script setup lang="ts">
import { ChevronDown, KeyRound, LoaderCircle } from 'lucide-vue-next'
import { ref } from 'vue'
import { useAdminStore } from '../stores/admin'

const admin = useAdminStore()

const email = ref('')
const setupOpen = ref(false)
const setupEmail = ref('')
const temporaryPassword = ref('')

function signIn() {
  admin.signInWithPasskey(email.value.trim())
}

function setUp() {
  admin.setUpPasskey(setupEmail.value.trim(), temporaryPassword.value)
}

const input =
  'w-full rounded-md border border-zinc-700 bg-black px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-scope-500 focus:outline-none'
const primary =
  'flex w-full items-center justify-center gap-2 rounded-md bg-scope-500 px-4 py-2 text-sm font-medium text-black hover:bg-scope-400 disabled:opacity-50'
</script>

<template>
  <section
    class="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6"
    aria-labelledby="admin-login-title"
  >
    <h1 id="admin-login-title" class="text-lg font-semibold text-zinc-100">管理ページにログイン</h1>

    <form class="mt-5 flex flex-col gap-3" @submit.prevent="signIn">
      <label class="flex flex-col gap-1 text-sm text-zinc-400">
        メールアドレス
        <input
          v-model="email"
          type="email"
          autocomplete="username webauthn"
          required
          :class="input"
        />
      </label>
      <button type="submit" :class="primary" :disabled="admin.busy || !email.trim()">
        <LoaderCircle v-if="admin.busy" class="size-4 animate-spin" aria-hidden="true" />
        <KeyRound v-else class="size-4" aria-hidden="true" />
        パスキーでログイン
      </button>
    </form>

    <p v-if="admin.error" role="alert" class="mt-4 text-sm text-red-400">{{ admin.error }}</p>
    <p v-if="admin.notice" role="status" class="mt-4 text-sm text-scope-400">{{ admin.notice }}</p>

    <div class="mt-6 border-t border-zinc-800 pt-4">
      <button
        type="button"
        class="flex w-full items-center justify-between text-sm text-zinc-300 hover:text-zinc-100"
        :aria-expanded="setupOpen"
        aria-controls="admin-setup"
        @click="setupOpen = !setupOpen"
      >
        初回設定
        <ChevronDown
          class="size-4 transition-transform"
          :class="setupOpen && 'rotate-180'"
          aria-hidden="true"
        />
      </button>
      <form
        v-show="setupOpen"
        id="admin-setup"
        class="mt-3 flex flex-col gap-3"
        @submit.prevent="setUp"
      >
        <p class="text-xs text-zinc-500">
          管理者から届いた仮パスワードで一度だけログインし、この端末のパスキーを登録します。以後はパスキーでログインします。
        </p>
        <label class="flex flex-col gap-1 text-sm text-zinc-400">
          メールアドレス
          <input
            v-model="setupEmail"
            type="email"
            autocomplete="username"
            required
            :class="input"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm text-zinc-400">
          仮パスワード
          <input
            v-model="temporaryPassword"
            type="password"
            autocomplete="current-password"
            required
            :class="input"
          />
        </label>
        <button
          type="submit"
          :class="primary"
          :disabled="admin.busy || !setupEmail.trim() || !temporaryPassword"
        >
          <LoaderCircle v-if="admin.busy" class="size-4 animate-spin" aria-hidden="true" />
          仮パスワードでログインしてパスキーを登録
        </button>
      </form>
    </div>
  </section>
</template>
