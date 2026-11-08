export const trampoline = <A>(thunk: () => A | (() => A)): A => {
    let result: unknown = thunk();
    while (typeof result === "function") {
        result = (result as () => unknown)();
    }
    return result as A;
};
