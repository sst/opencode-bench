export namespace Logger {
  export type Instance = ReturnType<typeof create>;

  export function create(prefix?: string) {
    const format = (...messages: any[]) => {
      return `${prefix} ${messages.join(" ")}`;
    };
    const date = () => new Date().toISOString();
    return {
      debug: (...messages: any[]) => {
        if (process.env.DEBUG !== "true") return;
        console.debug(date(), format(...messages));
      },
      log: (...messages: any[]) => {
        console.log(date(), format(...messages));
      },
      error: (...messages: any[]) => {
        console.error(date(), format(...messages));
      },
      format,
      child: (childPrefix: string) =>
        create(prefix ? `${prefix} ${childPrefix}` : childPrefix),
    };
  }
}
