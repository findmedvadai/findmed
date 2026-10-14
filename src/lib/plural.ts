/** Número con su sustantivo en singular o plural: plural(1, "error", "errores") → "1 error". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
