export let counter = 0;

export const bump = (): number => {
  counter += 1;
  return counter;
};
