import type { RandomFunc } from "../../types";

export function randRange(params: {
  a: number;
  b: number;
  randFn: RandomFunc;
}) {
  return params.a + (params.b - params.a) * params.randFn();
}
