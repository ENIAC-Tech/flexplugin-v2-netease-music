<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  label: string;
  modelValue?: string;
}>();

const emit = defineEmits<{
  'update:model-value': [value: string];
}>();

const showPicker = ref(false);

const colorValue = computed(() => {
  const value = props.modelValue?.trim() || '#000000';
  if (value.startsWith('#')) return value;
  if (/^[0-9A-Fa-f]{6}$/.test(value)) return `#${value}`;
  return '#000000';
});

function handleColorChange(value: unknown) {
  if (typeof value === 'string') {
    emit('update:model-value', value);
    return;
  }
  if (value && typeof value === 'object' && 'hex' in value && typeof value.hex === 'string') {
    emit('update:model-value', value.hex);
  }
}

function handleTextChange(value: string) {
  emit('update:model-value', value);
}
</script>

<template>
  <v-row dense align="center" class="plugin-color-picker">
    <v-col cols="auto" class="color-label-col">
      <v-label class="text-body-2">{{ label }}</v-label>
    </v-col>
    <v-col cols="auto">
      <v-menu v-model="showPicker" :close-on-content-click="false" location="bottom end">
        <template #activator="{ props: activatorProps }">
          <button
            v-bind="activatorProps"
            class="color-preview-button"
            type="button"
            :style="{ backgroundColor: colorValue }"
            :aria-label="label"
          />
        </template>
        <v-sheet class="pa-2" elevation="8" rounded>
          <v-color-picker
            :model-value="colorValue"
            mode="hex"
            show-swatches
            hide-inputs
            @update:model-value="handleColorChange"
          />
          <v-text-field
            :model-value="modelValue"
            density="compact"
            variant="solo-filled"
            hide-details
            class="mt-2 ml-4 mr-6"
            @update:model-value="handleTextChange"
          />
        </v-sheet>
      </v-menu>
    </v-col>
  </v-row>
</template>

<style scoped>
.plugin-color-picker {
  min-height: 40px;
  align-items: center;
  margin: 0 !important;
}

.color-label-col {
  flex: 0 0 auto;
  padding-right: 4px !important;
}

.color-preview-button {
  width: 22px;
  height: 22px;
  margin-right: 0;
  border: 2px solid rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: all 0.2s;
}

.color-preview-button:hover {
  transform: scale(1.1);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.16);
}
</style>
