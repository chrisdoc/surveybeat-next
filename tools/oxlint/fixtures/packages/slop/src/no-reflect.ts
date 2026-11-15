export const readValue = (target: object): unknown => Reflect.get(target, "value");
