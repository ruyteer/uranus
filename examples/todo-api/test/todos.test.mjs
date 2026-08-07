import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../src/todos.mjs'

test('adiciona e lista todos', () => {
  const store = createStore()
  const todo = store.add('comprar café')
  assert.equal(todo.title, 'comprar café')
  assert.equal(store.list().length, 1)
})

test('completa um todo', () => {
  const store = createStore()
  const todo = store.add('escrever testes')
  assert.equal(store.complete(todo.id).done, true)
})

test('rejeita título vazio', () => {
  const store = createStore()
  assert.throws(() => store.add('  '))
})
