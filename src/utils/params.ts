// ============================================================
// Express request param narrowing helper
//
// Express types req.params values as string | string[].
// In practice they are always string in our codebase. This
// helper narrows the type cleanly so we don't have to litter
// the controllers with String() casts.
// ============================================================

export function pid(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export function qs(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}
