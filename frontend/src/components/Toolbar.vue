<script setup lang="ts">
import { Eraser, Menu, Pen, Redo2, Send, Undo2 } from 'lucide-vue-next'
import { useDrawingStore } from '../stores/drawing'
import ToolButton from './ToolButton.vue'

defineProps<{ sending: boolean }>()
defineEmits<{ menu: []; send: [] }>()

const drawing = useDrawingStore()
</script>

<template>
  <header
    class="flex shrink-0 items-center justify-between gap-1 border-b border-zinc-800 bg-zinc-950 px-1.5 pt-[max(0.25rem,env(safe-area-inset-top))] pb-1 sm:px-3"
  >
    <ToolButton label="メニュー" @click="$emit('menu')">
      <Menu :size="22" />
    </ToolButton>

    <div role="toolbar" aria-label="道具" class="flex items-center gap-0.5 sm:gap-1">
      <ToolButton label="ペン" :pressed="drawing.tool === 'pen'" @click="drawing.setTool('pen')">
        <Pen :size="20" />
      </ToolButton>
      <ToolButton
        label="消しゴム（小）"
        :pressed="drawing.tool === 'eraserSmall'"
        @click="drawing.setTool('eraserSmall')"
      >
        <Eraser :size="15" :stroke-width="2" />
      </ToolButton>
      <ToolButton
        label="消しゴム（大）"
        :pressed="drawing.tool === 'eraserLarge'"
        @click="drawing.setTool('eraserLarge')"
      >
        <Eraser :size="26" :stroke-width="2.25" />
      </ToolButton>

      <div class="mx-0.5 h-6 w-px bg-zinc-700 sm:mx-1" aria-hidden="true" />

      <ToolButton label="元に戻す" :disabled="!drawing.canUndo" @click="drawing.undo()">
        <Undo2 :size="20" />
      </ToolButton>
      <ToolButton label="やり直す" :disabled="!drawing.canRedo" @click="drawing.redo()">
        <Redo2 :size="20" />
      </ToolButton>

      <div class="mx-0.5 h-6 w-px bg-zinc-700 sm:mx-1" aria-hidden="true" />

      <ToolButton label="送信" :disabled="drawing.isEmpty || sending" @click="$emit('send')">
        <Send :size="20" :class="drawing.isEmpty || sending ? '' : 'text-scope-400'" />
      </ToolButton>
    </div>
  </header>
</template>
