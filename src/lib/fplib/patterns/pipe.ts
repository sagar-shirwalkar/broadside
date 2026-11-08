export const pipe = <A, B>(
    value: A,
    fn1: (a: A) => B,
    ...fns: Array<(arg: any) => any>
): B => {
    return fns.reduce((acc, fn) => fn(acc), fn1(value));
};
