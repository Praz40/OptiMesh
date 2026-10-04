import type { FieldErrors } from "@/lib/registry";

/** The API's message for one field, placed under it and referenced by the input's aria-describedby. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span className="field-error" id={id}>
      {message}
    </span>
  );
}

/** Props that mark an input invalid and point it at its FieldError. */
export function invalid(id: string, message: string | undefined) {
  return message ? { "aria-invalid": true, "aria-describedby": id } : {};
}

/** Messages for fields the form does not show, so none of the API's answers is lost. */
export function otherErrors(errors: FieldErrors, placed: string[]): string[] {
  return Object.entries(errors)
    .filter(([path]) => !placed.includes(path))
    .map(([path, message]) => (path ? `${path}: ${message}` : message));
}
