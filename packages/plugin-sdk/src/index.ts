// @teactjs/plugin-sdk — author Teact plugins.

export { definePlugin } from './define-plugin';
export type { PluginContext, PluginDefinition, PluginFactory } from './define-plugin';

// Re-export the plugin/DI types from core so plugin authors have one import.
export type { TeactPlugin, ServiceMap, Adapter, Middleware } from '@teactjs/core';
