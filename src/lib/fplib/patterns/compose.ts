export const compose = <A, B>(
    fn1: (a: A) => B,
    ...fns: Array<(arg: any) => any>
): ((a: A) => B) => {
    return fns.reduce((prevFn, nextFn) => (value: any) => prevFn(nextFn(value)), fn1);
};
