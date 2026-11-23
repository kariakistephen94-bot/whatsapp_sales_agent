export function renderTemplate(tpl: string, vars: Record<string, string | undefined>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}
