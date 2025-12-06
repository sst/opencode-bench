export namespace Logger {
  export type Instance = ReturnType<typeof create>;

  export function create(prefix: string) {
    const format = (...messages: string[]) => {
      return `${prefix} ${messages.join(" ")}`;
    };
    return {
      debug: (...messages: string[]) => {
        if (process.env.DEBUG !== "true") return;
        console.debug(format(...messages));
      },
      log: (...messages: string[]) => {
        console.log(format(...messages));
      },
      error: (...messages: string[]) => {
        console.error(format(...messages));
      },
      format,
      child: (childPrefix: string) => create(`${prefix} ${childPrefix}`),
    };
  }
}
