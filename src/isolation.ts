import { Context } from '@deepseek-ai/cordis'

/** A scope shares the services its components provide, while inheriting host services. */
export function isolateProvidedServices(parent: Context, labels: Record<string, symbol>) {
  const reflect = parent.reflect
  return parent.extend({
    [Context.isolate]: labels,
    get reflect() {
      const ctx = this as Context
      return new Proxy(reflect, {
        get(target, key) {
          if (key === 'ctx') return ctx
          if (key === 'provide') return (name: string, value?: unknown, check?: () => boolean) => {
            if (!Object.hasOwn(labels, name) && ctx[Context.isolate][name] === labels[name]) labels[name] = Symbol(name)
            return Reflect.get(target, key).call(new Proxy(target, {
              get(object, property) { return property === 'ctx' ? ctx : Reflect.get(object, property) },
            }), name, value, check)
          }
          return Reflect.get(target, key)
        },
      })
    },
  })
}
