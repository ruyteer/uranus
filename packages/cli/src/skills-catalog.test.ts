import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withTempDir } from '@uranus/testkit'
import { SKILLS_CATALOG, installSkill, installedSkillIds } from './skills-catalog.js'

function fakeFetch(body: string, ok = true, status = 200): typeof fetch {
  const response = { ok, status, text: () => Promise.resolve(body) } as Response
  return () => Promise.resolve(response)
}

describe('SKILLS_CATALOG', () => {
  it('ids são únicos, e cada entrada tem título, descrição, sourceRepo e urls não vazios', () => {
    const ids = SKILLS_CATALOG.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const skill of SKILLS_CATALOG) {
      expect(skill.title.trim(), skill.id).not.toBe('')
      expect(skill.description.trim(), skill.id).not.toBe('')
      expect(skill.sourceRepo.trim(), skill.id).not.toBe('')
      expect(skill.sourceUrl, skill.id).toContain(skill.id)
      expect(skill.rawUrl, skill.id).toContain(skill.id)
      expect(skill.rawUrl, skill.id).toContain('SKILL.md')
    }
  })

  it('find-skills vem do repositório vercel-labs/skills, não de anthropics/skills', () => {
    const findSkills = SKILLS_CATALOG.find((s) => s.id === 'find-skills')
    expect(findSkills).toBeDefined()
    expect(findSkills?.sourceRepo).toBe('vercel-labs/skills')
    expect(findSkills?.sourceUrl).toContain('vercel-labs/skills')
    expect(findSkills?.rawUrl).toContain('vercel-labs/skills')
  })
})

describe('installSkill', () => {
  it('skill desconhecida devolve erro, não exceção', async () => {
    await withTempDir(async (dir) => {
      const result = await installSkill(dir, 'nao-existe', fakeFetch(''))
      expect(result.ok).toBe(false)
    })
  })

  it('baixa o SKILL.md e grava em .claude/skills/<id>/SKILL.md', async () => {
    await withTempDir(async (dir) => {
      const id = SKILLS_CATALOG[0]!.id
      const result = await installSkill(dir, id, fakeFetch('---\nname: x\n---\ncorpo'))
      expect(result.ok).toBe(true)

      const written = await readFile(join(dir, '.claude', 'skills', id, 'SKILL.md'), 'utf8')
      expect(written).toContain('corpo')
    })
  })

  it('falha de rede vira Result de erro', async () => {
    await withTempDir(async (dir) => {
      const id = SKILLS_CATALOG[0]!.id
      const brokenFetch = (() => {
        throw new Error('sem rede')
      }) as unknown as typeof fetch
      const result = await installSkill(dir, id, brokenFetch)
      expect(result.ok).toBe(false)
    })
  })

  it('resposta HTTP não-ok vira Result de erro', async () => {
    await withTempDir(async (dir) => {
      const id = SKILLS_CATALOG[0]!.id
      const result = await installSkill(dir, id, fakeFetch('', false, 404))
      expect(result.ok).toBe(false)
    })
  })
})

describe('installedSkillIds', () => {
  it('reflete o que já foi instalado, e nada mais', async () => {
    await withTempDir(async (dir) => {
      expect(await installedSkillIds(dir)).toEqual([])

      const id = SKILLS_CATALOG[1]!.id
      await installSkill(dir, id, fakeFetch('conteúdo'))
      expect(await installedSkillIds(dir)).toEqual([id])
    })
  })
})
