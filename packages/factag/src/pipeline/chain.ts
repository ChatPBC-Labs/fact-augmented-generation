export type Stage<I, O> = (input: I) => O | Promise<O>;

function pipeImpl(...stages: Stage<unknown, unknown>[]): Stage<unknown, unknown> {
  return (input: unknown) =>
    stages.reduce<Promise<unknown>>((acc, stage) => acc.then((value) => stage(value)), Promise.resolve(input));
}

export function pipe<A, B>(s1: Stage<A, B>): Stage<A, B>;
export function pipe<A, B, C>(s1: Stage<A, B>, s2: Stage<B, C>): Stage<A, C>;
export function pipe<A, B, C, D>(s1: Stage<A, B>, s2: Stage<B, C>, s3: Stage<C, D>): Stage<A, D>;
export function pipe<A, B, C, D, E>(
  s1: Stage<A, B>,
  s2: Stage<B, C>,
  s3: Stage<C, D>,
  s4: Stage<D, E>
): Stage<A, E>;
export function pipe(...stages: Stage<unknown, unknown>[]): Stage<unknown, unknown> {
  return pipeImpl(...stages);
}

export function composeStages<I, O>(...stages: Stage<unknown, unknown>[]): Stage<I, O> {
  return pipeImpl(...stages) as Stage<I, O>;
}
