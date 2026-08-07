/** Loja de todos em memória — o alvo das tasks de exemplo do Uranus. */
export function createStore() {
  const todos = new Map()
  let nextId = 1

  return {
    add(title) {
      if (typeof title !== 'string' || title.trim() === '') {
        throw new Error('título obrigatório')
      }
      const todo = { id: nextId++, title: title.trim(), done: false }
      todos.set(todo.id, todo)
      return todo
    },
    complete(id) {
      const todo = todos.get(id)
      if (todo === undefined) throw new Error(`todo ${id} não existe`)
      todo.done = true
      return todo
    },
    list() {
      return [...todos.values()]
    },
  }
}
