import { encode } from './encode.js'
import { Html } from './html.js'
import { javascriptEscaper, jsonEscaper } from './util.js'

type NestedArray<V> = V | readonly NestedArray<V>[]

export { Html }

/**
 * Escapes code to use as a JavaScript string inside a `<script>` tag.
 */
export const javascriptCode = (code: string) =>
  Html.dangerouslyCreate(javascriptEscaper(code))

/**
 * Escapes a value to use as an JSON variable definition inside a `<script>` tag.
 */
export const jsonCode = (value: unknown) =>
  Html.dangerouslyCreate(jsonEscaper(value))

export function html(
  htmlFragment: TemplateStringsArray,
  ...values: readonly NestedArray<string | Html>[]
): Html {
  const fragments: Iterable<string> = combineTemplateStringsFragments(
    htmlFragment,
    values,
  )
  return Html.dangerouslyCreate(fragments)
}

function* combineTemplateStringsFragments(
  htmlFragment: TemplateStringsArray,
  values: readonly NestedArray<string | Html>[],
): Generator<string, void, undefined> {
  for (let i = 0; i < htmlFragment.length; i++) {
    yield htmlFragment[i]!
    if (i < values.length) {
      yield* valueToFragment(values[i]!)
    }
  }
}

function* valueToFragment(
  value: NestedArray<string | Html>,
): Generator<string, void, undefined> {
  if (typeof value === 'string') {
    yield encode(value)
  } else if (value instanceof Html) {
    yield* value.fragments
  } else {
    for (const v of value) {
      yield* valueToFragment(v)
    }
  }
}