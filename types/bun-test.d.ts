declare module "bun:test" {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function expect<T>(value: T): Expectation<T>;

  interface Expectation<T> {
    toEqual(expected: unknown): void;
    toBe(expected: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toThrow(error?: unknown): void;
    toMatchObject(expected: unknown): void;
    toMatch(expected: unknown): void;
    not: Expectation<T>;
  }
}
