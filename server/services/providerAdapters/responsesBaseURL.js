export function normalizeResponsesBaseURL(baseURL) {
  const value = `${baseURL ?? ""}`.trim();
  if (!value) return "";

  const match = value.match(/^([^?#]*)([?#].*)?$/);
  const path = (match?.[1] ?? value).replace(/\/+$/, "");
  const suffix = match?.[2] ?? "";

  if (/(^|\/)v1$/i.test(path)) {
    return `${path}${suffix}`;
  }

  return `${path}/v1${suffix}`;
}
