// turndown-plugin-gfm ships no type declarations and @types/turndown covers only
// the core package, so under noImplicitAny the bare import is an error (TS7016).
// Declare the plugin's named + default exports with turndown's own Plugin type.
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  type Plugin = TurndownService.Plugin;
  export const gfm: Plugin;
  export const tables: Plugin;
  export const strikethrough: Plugin;
  export const taskListItems: Plugin;
  const plugins: { gfm: Plugin; tables: Plugin; strikethrough: Plugin; taskListItems: Plugin };
  export default plugins;
}
