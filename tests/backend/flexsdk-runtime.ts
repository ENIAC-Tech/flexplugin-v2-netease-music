export class FlexPluginBase {
  protected hostApi: any;
  protected logger: any;
  pluginVersion = '1.0.1';
  async onLoad(ctx: any) { this.hostApi = ctx.hostApi; this.logger = ctx.logger; }
  async onUnload() {}
  createDefaultLibrary(value: any) { return value; }
  createUnitTemplate(value: any) { return value; }
  registerRendererRpc(name: string, handler: any) { this.hostApi.__rpcs.set(name, handler); }
  registerDependencyApi() {}
  unregisterDependencyApi() {}
  onUnitEvent(type: string, event: string, handler: any, options?: any) {
    this.hostApi.__unitEvents.push({ type, event, handler, options });
    return Promise.resolve();
  }
  registerRendererStateChannel(channel: string) { return this.hostApi.plugin.registerRendererStateChannel(channel); }
  publishRendererState(channel: string, update: any) { return this.hostApi.plugin.publishRendererState(channel, update); }
  onDependencyState(uuid: string, channel: string, handler: any, options?: any) {
    this.hostApi.__dependencyHandler = handler;
    return this.hostApi.plugin.subscribe(uuid, channel, options);
  }
}
