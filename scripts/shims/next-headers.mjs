export async function cookies() {
  return { getAll: () => [], get: () => undefined, set: () => {}, delete: () => {} };
}
export async function headers() {
  return { get: () => null };
}
